import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nmshConfigDirectory} from '../src/configuration/paths.js';
import {DraftStore} from '../src/viewer/draftRecovery.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #463 hunk-by-hunk review through the real TerminalApp and real files: the person edits, something else changes the file,
 * saving reports the conflict, and Review changes merges the two with every hunk decided by the person.
 */
type Fixture = ReturnType<typeof executionFrameFixture>;
async function settled(check: () => boolean, what: string): Promise<void> {
  // The frame fixture freezes Date.now(); the real clock bounds the wait.
  const deadline = process.hrtime.bigint() + 8_000_000_000n;
  while (!check()) {
    if (process.hrtime.bigint() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(done => setTimeout(done, 5));
  }
}
const press = (f: Fixture, bytes: string) => { for (const key of decodeKeys(bytes)) (f.app as unknown as {handleKey(key: unknown): void}).handleKey(key); };
const screen = (f: Fixture) => f.capture().frame.rows.map(row => stripAnsi(row)).join('\n');
const editorOf = (f: Fixture) => f.app['textEditor']!;
const lines = (...items: string[]) => `${items.join('\n')}\n`;

async function opened(f: Fixture, name: string, content: string | Buffer) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-review-')));
  const file = join(root, name);
  writeFileSync(file, content);
  f.app['openTextEditor'](file, `/edit ${name}`);
  await settled(() => Boolean(f.app['textEditor']), 'the editor');
  return {root, file};
}
/** Save and wait for the conflict dialog. */
async function conflictOnSave(f: Fixture) {
  press(f, '\u0013');
  await settled(() => editorOf(f).dialog?.kind === 'conflict' && !editorOf(f).busy, 'the conflict dialog');
}
async function startReview(f: Fixture) {
  await conflictOnSave(f);
  press(f, 'v');
  await settled(() => Boolean(editorOf(f).review) && !editorOf(f).busy, 'the review');
}
async function apply(f: Fixture) {
  press(f, '\r');
  await settled(() => !editorOf(f).busy, 'the apply');
}
const typeAt = (f: Fixture, line: number, column: number, text: string) => { editorOf(f).buffer.caret = {line, column}; press(f, text); };

test('review: disk-only changes and my own merge; nothing is written until the normal save, and the draft goes only then', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const opened_ = await opened(f, 'a.txt', lines('one', 'two', 'three', 'four', 'five'));
    root = opened_.root; const file = opened_.file;
    typeAt(f, 1, 3, 'X');
    const external = lines('one', 'two', 'three', 'FOUR', 'five');
    writeFileSync(file, external);
    await startReview(f);
    assert.match(screen(f), /Review changes to/u);
    assert.match(screen(f), /Hunk 1 of 1 · changed on disk · → the file's version/u);
    assert.equal(readFileSync(file, 'utf8'), external, 'reviewing never writes');
    assert.deepEqual(editorOf(f).buffer.lines, ['one', 'twoX', 'three', 'four', 'five'], 'the buffer is untouched while reviewing');
    await apply(f);
    assert.equal(editorOf(f).review, undefined);
    assert.deepEqual(editorOf(f).buffer.lines, ['one', 'twoX', 'three', 'FOUR', 'five']);
    assert.equal(readFileSync(file, 'utf8'), external, 'applying changes the buffer only');
    // One undo step puts back exactly what I had.
    press(f, '\u001a');
    assert.deepEqual(editorOf(f).buffer.lines, ['one', 'twoX', 'three', 'four', 'five']);
    press(f, '\u0019');
    assert.deepEqual(editorOf(f).buffer.lines, ['one', 'twoX', 'three', 'FOUR', 'five']);
    press(f, '\u0013');
    await settled(() => readFileSync(file, 'utf8') === lines('one', 'twoX', 'three', 'FOUR', 'five'), 'the save');
    await settled(() => !editorOf(f).buffer.dirty, 'clean');
    assert.equal(new DraftStore(join(nmshConfigDirectory(), 'recovery')).own(realpathSync(file)), undefined);
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review: a conflict needs a choice (Enter refuses), every choice works, and a decision can be taken back', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const { root: r, file } = await opened(f, 'a.txt', lines('one', 'two', 'three'));
    root = r;
    typeAt(f, 2, 5, '!');
    writeFileSync(file, lines('one', 'two', 'THREE'));
    await startReview(f);
    assert.match(screen(f), /conflict · undecided/u);
    assert.match(screen(f), /1 conflict needs a choice/u);
    press(f, '\r');
    await new Promise(done => setTimeout(done, 20));
    assert.ok(editorOf(f).review, 'Enter does not apply while a conflict is undecided');
    assert.match(screen(f), /still needs a choice/u);
    press(f, 'm'); assert.match(screen(f), /→ your version/u);
    press(f, 'z'); assert.match(screen(f), /undecided/u);
    press(f, 'b'); assert.match(screen(f), /→ both/u);
    press(f, 'r');
    assert.match(screen(f), /result preview/u);
    assert.match(screen(f), /three!/u); assert.match(screen(f), /THREE/u);
    press(f, 'r');
    press(f, 't');
    await apply(f);
    assert.deepEqual(editorOf(f).buffer.lines, ['one', 'two', 'THREE']);
    assert.equal(readFileSync(file, 'utf8'), lines('one', 'two', 'THREE'));
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review: the file changing again during the review restarts it; the buffer and the disk are untouched', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const { root: r, file } = await opened(f, 'a.txt', lines('a', 'b', 'c', 'd'));
    root = r;
    typeAt(f, 0, 1, '1');
    writeFileSync(file, lines('a', 'b', 'C', 'd'));
    await startReview(f);
    const second = lines('a', 'b', 'C', 'D');
    writeFileSync(file, second);
    await apply(f);
    assert.ok(editorOf(f).review, 'a new review is open');
    assert.match(screen(f), /changed again while you were reviewing/u);
    assert.deepEqual(editorOf(f).buffer.lines, ['a1', 'b', 'c', 'd']);
    assert.equal(readFileSync(file, 'utf8'), second);
    await apply(f);
    assert.deepEqual(editorOf(f).buffer.lines, ['a1', 'b', 'C', 'D']);
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review: the file replaced atomically right after applying is a conflict again at save; my text and its draft survive', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const { root: r, file } = await opened(f, 'a.txt', lines('a', 'b', 'c'));
    root = r;
    typeAt(f, 0, 1, '1');
    writeFileSync(file, lines('a', 'b', 'C'));
    await startReview(f);
    await apply(f);
    const replacement = join(root, 'replacement'); writeFileSync(replacement, lines('totally', 'different'));
    renameSync(replacement, file);
    press(f, '\u0013');
    await settled(() => editorOf(f).dialog?.kind === 'conflict' && !editorOf(f).busy, 'the second conflict');
    assert.equal(readFileSync(file, 'utf8'), lines('totally', 'different'), 'nothing was overwritten');
    assert.deepEqual(editorOf(f).buffer.lines, ['a1', 'b', 'C']);
    f.app['draftKeeper'].flush();
    assert.deepEqual(new DraftStore(join(nmshConfigDirectory(), 'recovery')).own(realpathSync(file))?.lines, ['a1', 'b', 'C'], 'the draft stays until a save really happens');
    press(f, 'v');
    await settled(() => Boolean(editorOf(f).review) && !editorOf(f).busy, 'the new review');
    assert.match(screen(f), /conflict/u);
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review: a file deleted before or during the review is reported, never recreated by the review', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const { root: r, file } = await opened(f, 'a.txt', lines('a', 'b', 'c'));
    root = r;
    typeAt(f, 0, 1, '1');
    writeFileSync(file, lines('a', 'b', 'C'));
    await startReview(f);
    unlinkSync(file);
    await apply(f);
    assert.equal(editorOf(f).review, undefined);
    assert.match(editorOf(f).note?.text ?? '', /was deleted while you were reviewing/u);
    assert.deepEqual(editorOf(f).buffer.lines, ['a1', 'b', 'c']);
    assert.throws(() => statSync(file), 'the review did not recreate the file');
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review: navigating, previewing, toggling the base and closing never touch the file; Esc leaves the text as it was', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const { root: r, file } = await opened(f, 'a.txt', lines('1', '2', '3', '4', '5', '6', '7'));
    root = r;
    typeAt(f, 0, 1, 'm'); typeAt(f, 6, 1, 'm');
    writeFileSync(file, lines('1', 'T', '3', '4', '5', 'T', '7'));
    const before = statSync(file);
    await startReview(f);
    for (const keys of ['n', 'n', 'p', 'c', 'r', 'r', 'v', 'v', 'z', '\u001b[B', '\u001b[A']) press(f, keys);
    press(f, '\u001b');
    assert.equal(editorOf(f).review, undefined);
    assert.deepEqual(editorOf(f).buffer.lines, ['1m', '2', '3', '4', '5', '6', '7m']);
    const after = statSync(file);
    assert.deepEqual([after.mtimeMs, after.size, after.ino], [before.mtimeMs, before.size, before.ino]);
    assert.equal(readFileSync(file, 'utf8'), lines('1', 'T', '3', '4', '5', 'T', '7'));
    // Saving still refuses while the file differs.
    await conflictOnSave(f);
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review: CRLF and Unicode survive; the merged file keeps the disk\'s CRLF and BOM-free bytes exactly', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const { root: r, file } = await opened(f, 'u.txt', Buffer.from('héllo\r\n日本語\r\n😀 emoji\r\nlast\r\n'));
    root = r;
    typeAt(f, 0, 5, ' wörld');
    writeFileSync(file, Buffer.from('héllo\r\n日本語\r\n😀 EMOJI\r\nlast\r\n'));
    await startReview(f);
    await apply(f);
    press(f, '\u0013');
    await settled(() => readFileSync(file, 'utf8') === 'héllo wörld\r\n日本語\r\n😀 EMOJI\r\nlast\r\n', 'the save');
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review: a large file with edits on both sides merges exactly and saves', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const base = Array.from({length: 20_000}, (_, index) => `line ${index}`);
    const { root: r, file } = await opened(f, 'big.txt', lines(...base));
    root = r;
    typeAt(f, 100, 8, '-mine'); typeAt(f, 19_000, 10, '-mine');
    const theirs = [...base]; theirs[5000] = 'theirs 5000'; theirs[12_000] = 'theirs 12000';
    writeFileSync(file, lines(...theirs));
    await startReview(f);
    assert.match(screen(f), /Hunk 1 of 2/u);
    await apply(f);
    press(f, '\u0013');
    const expected = [...theirs]; expected[100] = 'line 100-mine'; expected[19_000] = 'line 19000-mine';
    await settled(() => readFileSync(file, 'utf8') === lines(...expected), 'the save');
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review: it works in the Markdown document workspace too, and a deleted file offers only Save anyway', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-review-')));
    const file = join(root, 'n.md'); writeFileSync(file, lines('# T', '', 'one', 'two'));
    await f.app['openDocumentSession'](file, '/edit n.md', 'edit', false);
    const session = f.app['docSession']!;
    session.editor.buffer.caret = {line: 0, column: 3}; press(f, '!');
    writeFileSync(file, lines('# T', '', 'one', 'TWO'));
    press(f, '\u0013');
    await settled(() => session.editor.dialog?.kind === 'conflict' && !session.editor.busy, 'the conflict');
    press(f, 'v');
    await settled(() => Boolean(session.editor.review) && !session.editor.busy, 'the review');
    assert.match(screen(f), /Review changes/u);
    press(f, '\r');
    await settled(() => !session.editor.busy && !session.editor.review, 'the apply');
    assert.deepEqual(session.editor.buffer.lines, ['# T!', '', 'one', 'TWO']);
    unlinkSync(file);
    press(f, '\u0013');
    await settled(() => session.editor.dialog?.kind === 'conflict' && !session.editor.busy, 'the deleted conflict');
    assert.doesNotMatch(screen(f), /Review changes/u, 'there is nothing on disk to review');
    assert.match(screen(f), /Save anyway/u);
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review: panel rows fit 30–120 columns and the narrowest layout still names the choices', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const { root: r, file } = await opened(f, 'a.txt', lines('a', 'b', 'c'));
    root = r;
    typeAt(f, 1, 1, 'B'.repeat(80));
    writeFileSync(file, lines('a', `${'日本語'.repeat(30)}`, 'c'));
    await startReview(f);
    const { renderEditor } = await import('../src/viewer/EditorPanel.js');
    const { displayWidth } = await import('../src/util/text.js');
    for (const columns of [30, 50, 80, 120]) for (const row of renderEditor(editorOf(f), columns, 20)) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
    assert.match(renderEditor(editorOf(f), 30, 20).map(row => stripAnsi(row)).join('\n'), /Enter/u);
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review (reviewer finding 1): undoing the merge puts the old base back, so saving then is a conflict again and nothing external is overwritten', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const { root: r, file } = await opened(f, 'a.txt', lines('one', 'two', 'three', 'four'));
    root = r;
    typeAt(f, 0, 3, 'X');
    const external = lines('one', 'two', 'three', 'FOUR-EXTERNAL');
    writeFileSync(file, external);
    await startReview(f);
    await apply(f);
    press(f, '\u001a');
    assert.deepEqual(editorOf(f).buffer.lines, ['oneX', 'two', 'three', 'four']);
    await conflictOnSave(f);
    assert.equal(readFileSync(file, 'utf8'), external, 'the external edit is still on disk');
    press(f, '\u001b');
    press(f, '\u0019');
    assert.deepEqual(editorOf(f).buffer.lines, ['oneX', 'two', 'three', 'FOUR-EXTERNAL']);
    press(f, '\u0013');
    await settled(() => readFileSync(file, 'utf8') === lines('oneX', 'two', 'three', 'FOUR-EXTERNAL'), 'the save after redo');
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review (reviewer finding 2): a link retargeted to another file is not reviewed against the old file; nothing is written there', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-review-')));
    const a = join(root, 'a.txt'), b = join(root, 'b.txt'), link = join(root, 'link.txt');
    writeFileSync(a, lines('alpha', 'common', 'end')); writeFileSync(b, lines('beta', 'common', 'end'));
    symlinkSync(a, link);
    f.app['openTextEditor'](link, '/edit link.txt');
    await settled(() => Boolean(f.app['textEditor']), 'the editor');
    typeAt(f, 2, 3, '!');
    unlinkSync(link); symlinkSync(b, link);
    await conflictOnSave(f);
    press(f, 'v');
    await settled(() => !editorOf(f).busy, 'the review request');
    assert.equal(editorOf(f).review, undefined, 'no review across different files');
    assert.match(editorOf(f).note?.text ?? '', /different file/u);
    assert.equal(readFileSync(b, 'utf8'), lines('beta', 'common', 'end'));
    assert.equal(readFileSync(a, 'utf8'), lines('alpha', 'common', 'end'));
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});

test('review (reviewer finding 4): a draft written before a no-change apply gets the new base hash', async () => {
  const f = executionFrameFixture(110, 30);
  let root = '';
  try {
    const { root: r, file } = await opened(f, 'a.txt', lines('one', 'two'));
    root = r;
    typeAt(f, 0, 3, 'X');
    f.app['draftKeeper'].flush();
    writeFileSync(file, lines('oneX', 'two'));
    await conflictOnSave(f);
    press(f, 'v');
    await settled(() => !editorOf(f).busy, 'the rebase');
    assert.equal(editorOf(f).review, undefined, 'nothing to decide');
    f.app['draftKeeper'].note(editorOf(f));
    f.app['draftKeeper'].flush();
    const draft = new DraftStore(join(nmshConfigDirectory(), 'recovery')).own(realpathSync(file));
    assert.equal(draft?.baseHash, editorOf(f).file.identity?.hash);
  } finally { f.dispose(); if (root) rmSync(root, {recursive: true, force: true}); }
});
