import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DraftKeeper, DraftStore, describeDifference, type Draft} from '../src/viewer/draftRecovery.js';
import {createEditor, editorKey, offerDraft, renderEditor} from '../src/viewer/EditorPanel.js';
import {openForEdit, saveFile, type EditableFile} from '../src/viewer/fileEdit.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {stripAnsi} from '../src/util/text.js';

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-draft-')));
const DEAD = 2 ** 22 + 12345; // beyond any pid_max here: never a live process
async function opened(path: string): Promise<EditableFile> {
  const result = await openForEdit(path, '/');
  if (!result.ok) throw new Error(result.reason);
  return result.file;
}
const typed = (state: ReturnType<typeof createEditor>, text: string) => { for (const key of decodeKeys(text)) editorKey(state, key, 80, 24); };
const sample = (over: Partial<Draft> = {}): Draft => ({version: 1, path: '/w/a.md', realPath: '/w/a.md', baseHash: 'abc', lines: ['one', 'two'], caret: {line: 1, column: 2}, top: 0, savedAt: 1000, pid: DEAD, ...over});

test('store: a private directory and 0600 files; the draft round-trips exactly', () => {
  const root = scratch();
  try {
    const store = new DraftStore(join(root, 'recovery'));
    assert.equal(store.write(sample({pid: process.pid})).ok, true);
    assert.equal(statSync(join(root, 'recovery')).mode & 0o777, 0o700);
    const [name] = readdirSync(join(root, 'recovery'));
    assert.equal(statSync(join(root, 'recovery', name!)).mode & 0o777, 0o600);
    assert.deepEqual(store.own('/w/a.md')?.lines, ['one', 'two']);
    assert.equal(readdirSync(join(root, 'recovery')).length, 1, 'no temporary file is left behind');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('store: a looser directory is tightened; a symlinked directory is refused', () => {
  const root = scratch();
  try {
    mkdirSync(join(root, 'loose'), {mode: 0o755}); chmodSync(join(root, 'loose'), 0o755);
    assert.equal(new DraftStore(join(root, 'loose')).write(sample()).ok, true);
    assert.equal(statSync(join(root, 'loose')).mode & 0o777, 0o700);
    mkdirSync(join(root, 'elsewhere')); symlinkSync(join(root, 'elsewhere'), join(root, 'link'));
    const refused = new DraftStore(join(root, 'link')).write(sample());
    assert.equal(refused.ok, false);
    assert.deepEqual(readdirSync(join(root, 'elsewhere')), [], 'nothing was written through the link');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('store: a draft of a running process is not offered; a dead process\'s, and a kept one, are', () => {
  const root = scratch();
  try {
    const store = new DraftStore(join(root, 'r'));
    store.write(sample({pid: process.pid, lines: ['mine']}));
    assert.deepEqual(store.recoverable('/w/a.md'), [], 'this process is alive: its draft is its own');
    store.write(sample({pid: DEAD, lines: ['crashed']}));
    assert.deepEqual(store.recoverable('/w/a.md').map(item => item.draft.lines), [['crashed']]);
    store.write(sample({pid: DEAD + 1, lines: ['other file'], realPath: '/w/b.md'}));
    assert.equal(store.recoverable('/w/a.md').length, 1, 'drafts are per file');
    const [found] = store.recoverable('/w/a.md');
    store.keep(found!);
    const kept = store.recoverable('/w/a.md');
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.kept, true);
    store.retire(kept[0]!);
    assert.deepEqual(store.recoverable('/w/a.md'), []);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('store: corrupt, foreign or oversize files are ignored and never thrown; pruning bounds count and age', () => {
  const root = scratch();
  try {
    const dir = join(root, 'r');
    const store = new DraftStore(dir, {maxFiles: 3, maxAgeMs: 10_000, now: () => 100_000});
    store.write(sample());
    const [good] = readdirSync(dir);
    writeFileSync(join(dir, good!.replace(/\.json$/u, 'x.json')), '{not json', {mode: 0o600});
    writeFileSync(join(dir, 'zzzz-1.json'), JSON.stringify({version: 99}), {mode: 0o600});
    assert.equal(store.recoverable('/w/a.md').length, 1);
    for (let index = 0; index < 5; index += 1) store.write(sample({realPath: `/w/n${index}.md`, path: `/w/n${index}.md`, pid: DEAD + index, savedAt: 99_000 + index}));
    store.prune();
    assert.ok(readdirSync(dir).filter(name => name.endsWith('.json')).length <= 3);
    store.write(sample({realPath: '/w/old.md', pid: DEAD + 9, savedAt: 1}));
    store.prune();
    assert.deepEqual(store.recoverable('/w/old.md'), [], 'older than the retention');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('store: an over-limit draft is refused with a reason', () => {
  const root = scratch();
  try {
    const result = new DraftStore(join(root, 'r'), {maxBytes: 64}).write(sample({lines: ['x'.repeat(200)]}));
    assert.equal(result.ok, false);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('keeper: a dirty buffer is written after the debounce and retired when it is clean again; a clean one is never written', async () => {
  const root = scratch();
  try {
    const file = join(root, 'a.md'); writeFileSync(file, 'hello\n');
    const editor = createEditor(await opened(file));
    const store = new DraftStore(join(root, 'r'));
    const keeper = new DraftKeeper(store, {debounceMs: 10});
    keeper.note(editor);
    await new Promise(done => setTimeout(done, 40));
    assert.equal(store.own(editor.file.realPath), undefined, 'clean: nothing written');
    typed(editor, 'abc');
    keeper.note(editor);
    assert.equal(store.own(editor.file.realPath), undefined, 'debounced: not yet');
    await new Promise(done => setTimeout(done, 60));
    assert.deepEqual(store.own(editor.file.realPath)?.lines, ['abchello']);
    editor.buffer.undo();
    keeper.note(editor);
    assert.equal(store.own(editor.file.realPath), undefined, 'undone back to the saved text: retired');
    keeper.dispose();
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('keeper: closing flushes a dirty buffer at once (a window that is closed keeps its text); a save retires it', async () => {
  const root = scratch();
  try {
    const file = join(root, 'a.md'); writeFileSync(file, 'hello\n');
    const editor = createEditor(await opened(file));
    const store = new DraftStore(join(root, 'r'));
    const keeper = new DraftKeeper(store, {debounceMs: 60_000});
    typed(editor, 'X');
    keeper.note(editor);
    keeper.flush();
    assert.deepEqual(store.own(editor.file.realPath)?.lines, ['Xhello']);
    const saved = await saveFile(editor.file, editor.buffer.lines);
    assert.equal(saved.ok, true);
    editor.buffer.markSaved();
    keeper.note(editor);
    assert.equal(store.own(editor.file.realPath), undefined);
    typed(editor, 'Y'); keeper.note(editor); keeper.flush();
    keeper.discard(editor);
    assert.equal(store.own(editor.file.realPath), undefined, 'an explicit discard removes only its own draft');
    keeper.dispose();
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('keeper: a write failure is reported once and typing is never interrupted', async () => {
  const root = scratch();
  try {
    const file = join(root, 'a.md'); writeFileSync(file, 'hello\n');
    const editor = createEditor(await opened(file));
    mkdirSync(join(root, 'e')); symlinkSync(join(root, 'e'), join(root, 'link'));
    const errors: string[] = [];
    const keeper = new DraftKeeper(new DraftStore(join(root, 'link')), {debounceMs: 0, onError: reason => errors.push(reason)});
    typed(editor, 'a'); keeper.note(editor); keeper.flush();
    typed(editor, 'b'); keeper.note(editor); keeper.flush();
    assert.equal(errors.length, 1);
    assert.equal(editor.buffer.lines[0], 'abhello');
    keeper.dispose();
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('keeper: recovery decision gates the draft; an undecided offer is never retired by a clean buffer', async () => {
  const root = scratch();
  try {
    const file = join(root, 'a.md'); writeFileSync(file, 'disk\n');
    const store = new DraftStore(join(root, 'r'));
    store.write(sample({realPath: realpathSync(file), path: file, lines: ['draft text'], baseHash: undefined, savedAt: Date.now()}));
    const editor = createEditor(await opened(file));
    const keeper = new DraftKeeper(store, {debounceMs: 10});
    const [found] = store.recoverable(editor.file.realPath);
    offerDraft(editor, found!);
    keeper.note(editor);
    assert.equal(store.recoverable(editor.file.realPath).length, 1);
    // Keep for later (Esc): the draft stays, in a file of its own, and typing now writes a separate draft.
    editorKey(editor, decodeKeys('\u001b')[0]!, 80, 24);
    assert.equal(editor.dialog, undefined);
    keeper.kept(editor, found!);
    assert.equal(store.recoverable(editor.file.realPath)[0]!.kept, true);
    typed(editor, 'n'); keeper.note(editor); keeper.flush();
    assert.equal(store.recoverable(editor.file.realPath).length, 1, 'the kept draft is still offered');
    assert.deepEqual(store.own(editor.file.realPath)?.lines, ['ndisk'], 'new edits are written to a draft of their own');
    assert.deepEqual(store.recoverable(editor.file.realPath)[0]!.draft.lines, ['draft text']);
    keeper.dispose();
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('editor: Restore puts the draft in the buffer as one undoable, unsaved edit; the disk is untouched', async () => {
  const root = scratch();
  try {
    const file = join(root, 'a.md'); writeFileSync(file, 'disk\n');
    const editor = createEditor(await opened(file));
    const draft = sample({realPath: editor.file.realPath, lines: ['draft one', 'draft two'], caret: {line: 1, column: 3}, baseHash: editor.file.identity!.hash});
    offerDraft(editor, {draft, kept: false, path: ''});
    const view = stripAnsi(renderEditor(editor, 80, 24).join('\n'));
    assert.match(view, /recovered draft/iu);
    assert.match(view, /Restore/u); assert.match(view, /Discard/u); assert.match(view, /Keep for later/u);
    const action = editorKey(editor, decodeKeys('r')[0]!, 80, 24);
    assert.equal(action?.kind, 'draft');
    assert.deepEqual(editor.buffer.lines, ['draft one', 'draft two']);
    assert.deepEqual(editor.buffer.caret, {line: 1, column: 3});
    assert.equal(editor.buffer.dirty, true);
    assert.equal(readFileSync(file, 'utf8'), 'disk\n');
    editor.buffer.undo();
    assert.deepEqual(editor.buffer.lines, ['disk']);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('editor: Discard asks the app to retire that draft only; a changed file is called out and Compare says what differs', async () => {
  const root = scratch();
  try {
    const file = join(root, 'a.md'); writeFileSync(file, 'one\ntwo\nthree\n');
    const editor = createEditor(await opened(file));
    const draft = sample({realPath: editor.file.realPath, lines: ['one', 'TWO', 'three'], baseHash: 'not-the-disk'});
    offerDraft(editor, {draft, kept: false, path: '/x/y.json'});
    assert.match(stripAnsi(renderEditor(editor, 100, 24).join('\n')), /changed on disk since/iu);
    editorKey(editor, decodeKeys('c')[0]!, 100, 24);
    assert.match(stripAnsi(renderEditor(editor, 100, 24).join('\n')), /line 2/u);
    assert.ok(editor.dialog, 'Compare keeps the choice open');
    const action = editorKey(editor, decodeKeys('d')[0]!, 100, 24);
    assert.deepEqual(action, {kind: 'draft-discard', target: {draft, kept: false, path: '/x/y.json'}});
    assert.equal(editor.dialog, undefined);
    assert.deepEqual(editor.buffer.lines, ['one', 'two', 'three']);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('describeDifference: counts and locates the first change, identical text says so', () => {
  assert.match(describeDifference(['a', 'b', 'c'], ['a', 'B', 'c']), /line 2/u);
  assert.match(describeDifference(['a'], ['a', 'b', 'c']), /adds 2 lines/u);
  assert.match(describeDifference(['a'], ['a']), /identical/u);
});

test('review: an interrupted write leaves no permanent debris; pruning removes stale temporaries but not a fresh one', () => {
  const root = scratch();
  try {
    const dir = join(root, 'r');
    const store = new DraftStore(dir, {now: () => Date.now()});
    store.write(sample({savedAt: Date.now()}));
    const stale = join(dir, '.aaaa.tmp'), fresh = join(dir, '.bbbb.tmp');
    writeFileSync(stale, 'partial', {mode: 0o600}); writeFileSync(fresh, 'partial', {mode: 0o600});
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(stale, old, old);
    store.prune();
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(fresh), true, 'a write in progress is not removed');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('review: a draft whose process id now belongs to something else is still offered once it is a day old', () => {
  const root = scratch();
  try {
    const store = new DraftStore(join(root, 'r'));
    // pid 1 is always running: it stands for a reused process id.
    store.write(sample({pid: 1, savedAt: Date.now() - 1000}));
    assert.equal(store.recoverable('/w/a.md').length, 0, 'a recent draft of a running process is its own');
    store.write(sample({pid: 1, savedAt: Date.now() - 25 * 60 * 60 * 1000}));
    assert.equal(store.recoverable('/w/a.md').length, 1);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('review (reviewer finding 3): a draft is retired under the path it was written for, even if the editor\'s file changed since', async () => {
  const root = scratch();
  try {
    const file = join(root, 'a.md'); writeFileSync(file, 'hello\n');
    const editor = createEditor(await opened(file));
    const store = new DraftStore(join(root, 'r'));
    const keeper = new DraftKeeper(store, {debounceMs: 60_000});
    const original = editor.file.realPath;
    typed(editor, 'x'); keeper.note(editor); keeper.flush();
    assert.ok(store.own(original));
    editor.file = {...editor.file, realPath: join(root, 'elsewhere.md')};
    keeper.discard(editor);
    assert.equal(store.own(original), undefined, 'the draft written for the original path is gone');
    keeper.dispose();
  } finally { rmSync(root, {recursive: true, force: true}); }
});
