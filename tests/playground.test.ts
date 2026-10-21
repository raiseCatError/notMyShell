import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {nmshConfigDirectory} from '../src/configuration/paths.js';
import {parseSlashCommand, slashSuggestions} from '../src/commands/slashCommands.js';
import {DraftStore} from '../src/viewer/draftRecovery.js';
import {createEditor, editorKey, renderEditor} from '../src/viewer/EditorPanel.js';
import {createScratchFile, saveFile} from '../src/viewer/fileEdit.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #468 Playground: an unsaved Markdown or HTML document that opens at once, previews, is saved only by an explicit Save As
 * (the editor's checked save, never over an existing file), and survives a crash as a recoverable draft.
 */
type Fixture = ReturnType<typeof executionFrameFixture>;
const DEAD = 2 ** 22 + 4242;
async function settled(check: () => boolean, what: string): Promise<void> {
  const deadline = process.hrtime.bigint() + 8_000_000_000n;
  while (!check()) {
    if (process.hrtime.bigint() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(done => setTimeout(done, 5));
  }
}
const press = (f: Fixture, bytes: string) => { for (const key of decodeKeys(bytes)) (f.app as unknown as {handleKey(key: unknown): void}).handleKey(key); };
const screen = (f: Fixture) => f.capture().frame.rows.map(row => stripAnsi(row)).join('\n');
const store = () => new DraftStore(join(nmshConfigDirectory(), 'recovery'));
const sessionOf = (f: Fixture) => f.app['docSession']!;

// ---- The scratch document -------------------------------------------------------------------------------------

test('scratch file: a stable identity that is not a path, no disk identity, and it can never be saved by path', async () => {
  const a = createScratchFile('markdown'), b = createScratchFile('html');
  assert.notEqual(a.scratch!.id, createScratchFile('markdown').scratch!.id);
  assert.match(a.realPath, /^scratch:[0-9a-f]{16,}$/u);
  assert.equal(a.identity, undefined);
  assert.match(a.path, /\.md$/u); assert.match(b.path, /\.html$/u);
  assert.equal(createScratchFile('markdown', 'abc123abc123abc123').realPath, 'scratch:abc123abc123abc123');
  assert.match(b.lines.join('\n'), /<!doctype html>/u);
  assert.deepEqual(a.lines, ['']);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-play-')));
  try {
    const before = readdirSync(process.cwd()).length;
    const result = await saveFile(a, ['text']);
    assert.equal(result.ok, false);
    assert.match((result as {reason: string}).reason, /Save As/u);
    assert.equal(readdirSync(process.cwd()).length, before, 'nothing was created');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('slash: /playground is parsed with its format, listed in the suggestions, and does not shadow another command', () => {
  assert.deepEqual(parseSlashCommand('/playground'), {kind: 'playground'});
  assert.deepEqual(parseSlashCommand('/playground md'), {kind: 'playground', format: 'markdown'});
  assert.deepEqual(parseSlashCommand('/playground markdown'), {kind: 'playground', format: 'markdown'});
  assert.deepEqual(parseSlashCommand('/playground html'), {kind: 'playground', format: 'html'});
  assert.deepEqual(parseSlashCommand('/playground recover'), {kind: 'playground', format: 'recover'});
  assert.equal(parseSlashCommand('/playground nonsense')?.kind, 'playground');
  assert.ok(slashSuggestions('/play').some(command => command.name === '/playground'));
  assert.equal(parseSlashCommand('/view x')?.kind, 'view');
});

test('draft store: scratch drafts are listed on their own, newest first, only those no running window owns', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-play-')));
  try {
    const s = new DraftStore(join(root, 'r'));
    const base = {version: 1 as const, caret: {line: 0, column: 0}, top: 0, path: 'Untitled.md'};
    s.write({...base, realPath: 'scratch:aaaaaaaaaaaaaaaa', lines: ['old'], savedAt: Date.now() - 5000, pid: DEAD});
    s.write({...base, realPath: 'scratch:bbbbbbbbbbbbbbbb', lines: ['new'], savedAt: Date.now() - 1000, pid: DEAD + 1});
    s.write({...base, realPath: 'scratch:cccccccccccccccc', lines: ['mine'], savedAt: Date.now(), pid: process.pid});
    s.write({...base, realPath: '/some/file.md', lines: ['file'], savedAt: Date.now(), pid: DEAD + 2});
    assert.deepEqual(s.recoverableScratch().map(offer => offer.draft.lines[0]), ['new', 'old']);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

// ---- The editor: Save As and dirty close -----------------------------------------------------------------------

test('editor: Ctrl+S on a scratch document asks for a name instead of saving; Enter returns the request; Esc cancels', () => {
  const editor = createEditor(createScratchFile('markdown'));
  const press_ = (bytes: string) => { let last; for (const key of decodeKeys(bytes)) last = editorKey(editor, key, 80, 24) ?? last; return last; };
  press_('draft');
  assert.equal(press_('\u0013'), undefined);
  assert.equal(editor.input?.kind, 'saveas');
  assert.match(renderEditor(editor, 80, 24).map(row => stripAnsi(row)).join('\n'), /Save as/u);
  press_('\u0015');
  press_('notes.md');
  assert.deepEqual(press_('\r'), {kind: 'save-as', path: 'notes.md'});
  press_('\u0013'); press_('\u001b');
  assert.equal(editor.input, undefined);
});

test('editor: closing a dirty scratch document asks; Save goes to the name prompt and closes after, Discard drops it, Esc keeps editing', () => {
  const editor = createEditor(createScratchFile('markdown'));
  const send = (bytes: string) => { let last; for (const key of decodeKeys(bytes)) last = editorKey(editor, key, 80, 24) ?? last; return last; };
  assert.deepEqual(send('\u001b'), {kind: 'close'}, 'an untouched scratch document just closes');
  send('x'); send('\u001b');
  assert.equal(editor.dialog?.kind, 'unsaved');
  assert.equal(send('s'), undefined);
  assert.equal(editor.input?.kind, 'saveas');
  assert.deepEqual(send('a.md\r'), {kind: 'save-as', path: 'a.md', thenClose: true});
  send('\u001b');
  assert.equal(editor.dialog?.kind, 'unsaved');
  assert.deepEqual(send('d'), {kind: 'close'});
});

// ---- Through the app -------------------------------------------------------------------------------------------

test('app: /playground md opens an editable Markdown scratch document at once; preview is NMSh\'s own renderer (no browser, no folder, no network)', async () => {
  const f = executionFrameFixture(110, 30);
  try {
    await f.app['openPlayground']('markdown');
    const session = sessionOf(f);
    assert.equal(session.mode, 'edit');
    assert.ok(session.editor.file.scratch);
    press(f, '# Hello\n\n[a](http://example.com) ![i](x.png)');
    assert.equal(session.editor.buffer.dirty, true);
    press(f, '\u000f');
    assert.equal(session.mode, 'preview');
    await new Promise(done => setTimeout(done, 30));
    assert.equal(session.preview, undefined, 'no browser page for a document without a folder');
    assert.equal(f.app['previewStarting'], undefined);
    assert.match(screen(f), /Hello/u);
    press(f, '\u000f');
    assert.equal(session.mode, 'edit');
  } finally { f.dispose(); }
});

test('app: an HTML scratch document with a script previews as inert text; nothing runs', async () => {
  const f = executionFrameFixture(110, 30);
  try {
    await f.app['openPlayground']('html');
    const session = sessionOf(f);
    session.editor.buffer.replaceAll(['<h1>Title</h1>', '<script>globalThis.__ran = true</script>']);
    press(f, '\u000f');
    await new Promise(done => setTimeout(done, 30));
    assert.equal((globalThis as {__ran?: boolean}).__ran, undefined);
    assert.equal(session.preview, undefined);
    assert.match(screen(f), /Title/u);
  } finally { f.dispose(); }
});

test('app: Save As writes a new file with the checked save, refuses an existing name, then the document is that file', async () => {
  const f = executionFrameFixture(110, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-play-')));
  try {
    await f.app['openPlayground']('markdown');
    const session = sessionOf(f);
    press(f, 'kept text');
    const scratchPath = session.editor.file.realPath;
    f.app['draftKeeper'].flush();
    assert.ok(store().own(scratchPath), 'the scratch draft exists while it is unsaved');
    writeFileSync(join(root, 'taken.md'), 'precious\n');
    press(f, '\u0013');
    press(f, join(root, 'taken.md') + '\r');
    await settled(() => !session.editor.busy && Boolean(session.editor.note), 'the refusal');
    assert.match(session.editor.note!.text, /already exists/u);
    assert.equal(readFileSync(join(root, 'taken.md'), 'utf8'), 'precious\n');
    assert.ok(session.editor.file.scratch, 'still a scratch document');
    press(f, '\u0013');
    press(f, join(root, 'new.md') + '\r');
    await settled(() => !session.editor.file.scratch, 'the Save As');
    assert.equal(readFileSync(join(root, 'new.md'), 'utf8'), 'kept text\n');
    assert.equal(session.editor.buffer.dirty, false);
    assert.equal(store().own(scratchPath), undefined, 'the scratch draft is retired once the file exists');
    assert.equal(session.editor.file.realPath, join(root, 'new.md'));
    press(f, '!');
    press(f, '\u0013');
    await settled(() => readFileSync(join(root, 'new.md'), 'utf8') === 'kept text!\n', 'an ordinary save afterwards');
  } finally { f.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('app: Save As into a missing folder or with an empty name reports why and keeps the document', async () => {
  const f = executionFrameFixture(110, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-play-')));
  try {
    await f.app['openPlayground']('markdown');
    const session = sessionOf(f);
    press(f, 'text');
    press(f, '\u0013'); press(f, join(root, 'missing', 'x.md') + '\r');
    await settled(() => !session.editor.busy && Boolean(session.editor.note), 'the refusal');
    assert.match(session.editor.note!.text, /does not exist/u);
    assert.ok(session.editor.file.scratch);
    assert.equal(session.editor.buffer.dirty, true);
  } finally { f.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('app: dirty close asks; Save As then closes; a window that ends keeps a recoverable draft; /playground recover offers it', async () => {
  const f = executionFrameFixture(110, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-play-')));
  try {
    await f.app['openPlayground']('html');
    const session = sessionOf(f);
    const id = session.editor.file.scratch!.id;
    press(f, 'unsaved words');
    f.app['stop'](0);
    const offers = store().recoverableScratch();
    assert.equal(offers.length, 0, 'this very process still owns its draft, so it is not offered to itself');
    // A later window finds the draft once its owner is gone: model that with the same draft under a dead pid.
    const draft = store().own(`scratch:${id}`)!;
    assert.match(draft.lines.join('\n'), /unsaved words/u);
    store().retireOwn(`scratch:${id}`);
    const g = executionFrameFixture(110, 30);
    try {
      // The new window has its own configuration folder (each fixture isolates it): put the dead window's draft there.
      store().write({...draft, pid: DEAD});
      await g.app['openPlayground']('recover');
      const recovered = g.app['docSession']!;
      assert.equal(recovered.editor.dialog?.kind, 'recover');
      assert.equal(recovered.editor.file.realPath, `scratch:${id}`, 'the same document identity');
      assert.match(recovered.editor.file.path, /\.html$/u);
      press(g, 'r');
      assert.match(recovered.editor.buffer.text, /unsaved words/u);
      assert.equal(recovered.editor.buffer.dirty, true);
      press(g, '\u001b'); press(g, '\u001b');
      assert.equal(recovered.editor.dialog?.kind, 'unsaved', 'Esc leaves edit mode, the next one asks about the unsaved text');
      press(g, 's'); press(g, join(root, 'saved.html') + '\r');
      await settled(() => !g.app['docSession'], 'the close after Save As');
      assert.match(readFileSync(join(root, 'saved.html'), 'utf8'), /unsaved words/u);
      assert.equal(store().recoverableScratch().length, 0);
    } finally { g.dispose(); }
  } finally { f.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('app: /playground with no format asks Markdown or HTML (and offers recovery only when a draft exists); Esc creates nothing', async () => {
  const f = executionFrameFixture(110, 30);
  try {
    await f.app['openPlayground'](undefined);
    assert.equal(f.app['docSession'], undefined);
    const editor = f.app['textEditor']!;
    assert.equal(editor.dialog?.kind, 'playground');
    const view = screen(f);
    assert.match(view, /Markdown/u); assert.match(view, /HTML/u); assert.doesNotMatch(view, /Recover/u);
    for (const columns of [30, 50, 80, 120]) for (const row of renderEditor(editor, columns, 20)) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
    press(f, '\u001b');
    assert.equal(f.app['textEditor'], undefined);
    assert.equal(store().recoverableScratch().length, 0);
    await f.app['openPlayground'](undefined);
    press(f, 'h');
    await settled(() => Boolean(f.app['docSession']), 'the HTML playground');
    assert.match(f.app['docSession']!.editor.file.path, /\.html$/u);
  } finally { f.dispose(); }
});

test('app: a scratch document has no reload, no disk review, no relative links or images to follow', async () => {
  const f = executionFrameFixture(110, 30);
  try {
    await f.app['openPlayground']('markdown');
    const session = sessionOf(f);
    press(f, '[x](other.md) ![y](pic.png)');
    f.app['runDocumentAction'](session, {kind: 'reload'});
    await new Promise(done => setTimeout(done, 20));
    assert.ok(sessionOf(f).editor.file.scratch);
    assert.equal(sessionOf(f).editor.buffer.dirty, true, 'reload is not available and did not discard anything');
    f.app['runDocumentAction'](session, {kind: 'open', path: join(process.cwd(), 'other.md')});
    assert.equal(f.app['docSession'], session, 'no relative link is followed from a document with no folder');
  } finally { f.dispose(); }
});

test('SIGKILL: a Playground killed with unsaved text leaves a draft the next window can recover', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-play-kill-')));
  try {
    const dir = join(root, 'recovery');
    const script = join(root, 'victim.mts');
    const url = (path: string) => JSON.stringify(pathToFileURL(join(process.cwd(), path)).href);
    writeFileSync(script, `
      import {createScratchFile} from ${url('src/viewer/fileEdit.ts')};
      import {createEditor} from ${url('src/viewer/EditorPanel.ts')};
      import {DraftKeeper, DraftStore} from ${url('src/viewer/draftRecovery.ts')};
      const editor = createEditor(createScratchFile('markdown'));
      const keeper = new DraftKeeper(new DraftStore(${JSON.stringify(dir)}), {debounceMs: 20});
      editor.buffer.insert('KILLED SCRATCH');
      keeper.note(editor);
      setInterval(() => {}, 1000);
      process.stdout.write('ready\\n');
    `);
    const child = spawn(process.execPath, ['--import=tsx', script], {stdio: ['ignore', 'pipe', 'inherit'], cwd: process.cwd()});
    await new Promise<void>((resolve, reject) => { child.stdout.on('data', () => resolve()); child.on('exit', code => reject(new Error(`victim exited ${code}`))); });
    await settled(() => existsSync(dir) && readdirSync(dir).some(name => name.endsWith('.json')), 'the draft');
    child.kill('SIGKILL');
    await new Promise(done => child.on('exit', done));
    const found = new DraftStore(dir).recoverableScratch();
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]!.draft.lines, ['KILLED SCRATCH']);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
