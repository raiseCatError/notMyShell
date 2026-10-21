import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {nmshConfigDirectory} from '../src/configuration/paths.js';
import {DraftStore} from '../src/viewer/draftRecovery.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #469 through the real TerminalApp, and across a real process kill: a window that dies with unsaved text leaves a
 * private draft; the next window offers it, restores it only on request, and never touches the file by itself.
 */
const DEAD = 2 ** 22 + 777;
async function settled(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(done => setTimeout(done, 10));
  }
}
const press = (app: {handleKey?: unknown}, text: string) => { for (const key of decodeKeys(text)) (app as unknown as {handleKey(key: unknown): void}).handleKey(key); };
const screen = (f: ReturnType<typeof executionFrameFixture>) => f.capture().frame.rows.map(row => stripAnsi(row)).join('\n');

test('/edit offers a crashed window\'s draft; Restore fills the buffer, the file stays as it was until a normal save', async () => {
  const f = executionFrameFixture(100, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-draft-app-')));
  try {
    const file = join(root, 'notes.txt'); writeFileSync(file, 'saved\n');
    const store = new DraftStore(join(nmshConfigDirectory(), 'recovery'));
    assert.equal(store.write({version: 1, path: file, realPath: realpathSync(file), lines: ['unsaved work'], caret: {line: 0, column: 4}, top: 0, savedAt: Date.now(), pid: DEAD}).ok, true);
    f.app['openTextEditor'](file, '/edit notes.txt');
    await settled(() => Boolean(f.app['textEditor']), 'the editor');
    assert.match(screen(f), /Recovered draft of/u);
    assert.deepEqual(f.app['textEditor']!.buffer.lines, ['saved'], 'nothing is applied before the choice');
    press(f.app, 'r');
    assert.deepEqual(f.app['textEditor']!.buffer.lines, ['unsaved work']);
    assert.equal(readFileSync(file, 'utf8'), 'saved\n');
    assert.equal(store.recoverable(realpathSync(file)).length, 0, 'the offered draft was replaced by this window\'s own');
    assert.equal(store.own(realpathSync(file))?.lines[0], 'unsaved work');
    // A normal checked save is what writes the file; it also retires the draft.
    press(f.app, '\u0013');
    await settled(() => readFileSync(file, 'utf8') === 'unsaved work\n', 'the save');
    await settled(() => !store.own(realpathSync(file)), 'the draft retired');
  } finally { f.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('/edit: Discard removes only the chosen draft; closing a window with unsaved text keeps its text', async () => {
  const f = executionFrameFixture(100, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-draft-app-')));
  try {
    const file = join(root, 'a.txt'); const other = join(root, 'b.txt');
    writeFileSync(file, 'a\n'); writeFileSync(other, 'b\n');
    const store = new DraftStore(join(nmshConfigDirectory(), 'recovery'));
    const base = {version: 1 as const, caret: {line: 0, column: 0}, top: 0, savedAt: Date.now(), pid: DEAD};
    store.write({...base, path: file, realPath: realpathSync(file), lines: ['stale a']});
    store.write({...base, path: other, realPath: realpathSync(other), lines: ['stale b']});
    f.app['openTextEditor'](file, '/edit a.txt');
    await settled(() => Boolean(f.app['textEditor']), 'the editor');
    press(f.app, 'd');
    assert.equal(store.recoverable(realpathSync(file)).length, 0);
    assert.equal(store.recoverable(realpathSync(other)).length, 1, 'another file\'s draft is untouched');
    press(f.app, 'typed ');
    f.app['stop'](0);
    assert.deepEqual(store.own(realpathSync(file))?.lines, ['typed a'], 'ending the window wrote the unsaved text');
    assert.equal(readFileSync(file, 'utf8'), 'a\n');
  } finally { f.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('SIGKILL: the draft survives a process killed with unsaved text and is offered by the next process', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-draft-kill-')));
  try {
    const file = join(root, 'doc.md'); writeFileSync(file, 'original\n');
    const dir = join(root, 'recovery');
    const script = join(root, 'victim.mts');
    writeFileSync(script, `
      import {openForEdit} from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/viewer/fileEdit.ts')).href)};
      import {createEditor} from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/viewer/EditorPanel.ts')).href)};
      import {DraftKeeper, DraftStore} from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'src/viewer/draftRecovery.ts')).href)};
      const opened = await openForEdit(${JSON.stringify(file)}, '/');
      if (!opened.ok) throw new Error(opened.reason);
      const editor = createEditor(opened.file);
      const keeper = new DraftKeeper(new DraftStore(${JSON.stringify(dir)}), {debounceMs: 20});
      editor.buffer.insert('KILLED ');
      keeper.note(editor);
      setInterval(() => {}, 1000);
      process.stdout.write('ready\\n');
    `);
    const child = spawn(process.execPath, ['--import=tsx', script], {stdio: ['ignore', 'pipe', 'inherit'], cwd: process.cwd()});
    await new Promise<void>((resolve, reject) => { child.stdout.on('data', () => resolve()); child.on('exit', code => reject(new Error(`victim exited ${code}`))); });
    await settled(() => existsSync(dir) && readdirSync(dir).some(name => name.endsWith('.json')), 'the draft');
    child.kill('SIGKILL');
    await new Promise(done => child.on('exit', done));
    const found = new DraftStore(dir).recoverable(realpathSync(file));
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]!.draft.lines, ['KILLED original']);
    assert.equal(readFileSync(file, 'utf8'), 'original\n');
  } finally { rmSync(root, {recursive: true, force: true}); }
});
