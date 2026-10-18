import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TextBuffer} from '../src/viewer/textBuffer.js';
import {encodeLines, openForEdit, saveFile, type EditableFile} from '../src/viewer/fileEdit.js';
import {createEditor, editorKey, renderEditor, type EditorState} from '../src/viewer/EditorPanel.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-edit-')));
async function opened(path: string): Promise<EditableFile> {
  const result = await openForEdit(path, '/');
  if (!result.ok) throw new Error(result.reason);
  return result.file;
}
const refusal = async (path: string) => {
  const result = await openForEdit(path, '/');
  assert.equal(result.ok, false);
  return (result as {reason: string}).reason;
};

// ---- Buffer -------------------------------------------------------------------------------------------------------

test('buffer: typing, line breaks, tabs and pasted CR LF; control characters never enter the text', () => {
  let clock = 0;
  const buffer = new TextBuffer(['ab'], () => clock);
  buffer.end();
  buffer.insert('c\u001b[2J\u0007');
  buffer.insert('\n\tline two\r\nthree\rfour');
  assert.deepEqual(buffer.lines, ['abc[2J', '\tline two', 'three', 'four']);
  assert.deepEqual(buffer.caret, {line: 3, column: 4});
  buffer.backspace();
  buffer.home();
  buffer.backspace();
  assert.deepEqual(buffer.lines, ['abc[2J', '\tline two', 'threefou'], 'backspace at a line start joins the lines');
  clock += 5000;
  assert.ok(buffer.dirty);
});

test('buffer: grapheme, word and vertical movement keep a display column across tabs and wide characters', () => {
  const buffer = new TextBuffer(['hello world  next', '\tx', '中文字符', 'éé']);
  buffer.wordRight();
  assert.deepEqual(buffer.caret, {line: 0, column: 6});
  buffer.wordRight();
  assert.deepEqual(buffer.caret, {line: 0, column: 13});
  buffer.wordLeft();
  assert.deepEqual(buffer.caret, {line: 0, column: 6});
  buffer.setCaret({line: 0, column: 5});
  buffer.vertical(1);
  assert.deepEqual(buffer.caret, {line: 1, column: 2}, 'column 5 lands after the tab (4 cells) and x');
  buffer.vertical(1);
  assert.deepEqual(buffer.caret, {line: 2, column: 2}, 'wide characters: column 5 falls inside the third, so the caret stops before it');
  buffer.vertical(1);
  assert.deepEqual(buffer.caret, {line: 3, column: 4}, 'the preferred column survives a shorter line');
  buffer.left();
  assert.deepEqual(buffer.caret, {line: 3, column: 2}, 'a combining sequence is one step');
});

test('buffer: a selection is replaced by typing, cut by delete, and Left/Right collapse it like the composer', () => {
  const buffer = new TextBuffer(['one two', 'three']);
  buffer.wordRight(true);
  assert.equal(buffer.selectedText(), 'one ');
  buffer.insert('1 ');
  assert.deepEqual(buffer.lines, ['1 two', 'three']);
  buffer.selectAll();
  assert.equal(buffer.selectedText(), '1 two\nthree');
  buffer.left();
  assert.deepEqual(buffer.caret, {line: 0, column: 0});
  buffer.vertical(1, true);
  buffer.delete();
  assert.deepEqual(buffer.lines, ['three']);
});

test('buffer: undo and redo coalesce bursts, restore the caret, and the saved text reads clean again', () => {
  let clock = 0;
  const buffer = new TextBuffer(['x'], () => clock);
  buffer.end();
  for (const character of 'abc') { buffer.insert(character); clock += 100; }
  clock += 5000;
  buffer.insert('!');
  buffer.markSaved();
  assert.equal(buffer.dirty, false);
  buffer.backspace();
  assert.equal(buffer.dirty, true);
  assert.ok(buffer.undo());
  assert.equal(buffer.dirty, false, 'back to the saved text');
  assert.ok(buffer.undo());
  assert.deepEqual(buffer.lines, ['xabc']);
  assert.ok(buffer.undo(), 'typing abc was one step');
  assert.deepEqual(buffer.lines, ['x']);
  assert.deepEqual(buffer.caret, {line: 0, column: 1});
  assert.equal(buffer.dirty, true);
  assert.ok(buffer.redo() && buffer.redo());
  assert.deepEqual(buffer.lines, ['xabc!']);
  assert.equal(buffer.dirty, false);
  // A saved state pushed out of the bounded history can never read as clean again.
  const long = new TextBuffer(['']);
  long.markSaved();
  for (let step = 0; step < 520; step += 1) { long.insert('\n'); }
  while (long.undo()) { /* as far back as the history goes */ }
  assert.equal(long.dirty, true);
});

test('buffer: find selects the next match, smart case, wrapping', () => {
  const buffer = new TextBuffer(['Alpha beta', 'gamma ALPHA', 'alpha']);
  assert.deepEqual(buffer.find('alpha'), {wrapped: false});
  assert.equal(buffer.selectedText(), 'Alpha');
  buffer.find('alpha');
  assert.deepEqual(buffer.caret, {line: 1, column: 11});
  buffer.find('alpha');
  assert.deepEqual(buffer.find('alpha'), {wrapped: true});
  assert.deepEqual(buffer.anchor, {line: 0, column: 0});
  assert.equal(buffer.find('Zeta'), undefined);
});

// ---- Opening and saving ---------------------------------------------------------------------------------------------

test('open: only files that can be saved back exactly and safely; every refusal says why', async () => {
  const root = scratch();
  try {
    writeFileSync(join(root, 'mixed.txt'), 'a\r\nb\nc\n');
    assert.match(await refusal(join(root, 'mixed.txt')), /mixes LF and CRLF/u);
    writeFileSync(join(root, 'bad.txt'), Buffer.from([0x61, 0xff, 0x0a]));
    assert.match(await refusal(join(root, 'bad.txt')), /not valid UTF-8/u);
    writeFileSync(join(root, 'bin'), Buffer.from([1, 0, 2]));
    assert.match(await refusal(join(root, 'bin')), /binary/u);
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(2 * 1024 * 1024));
    assert.match(await refusal(join(root, 'big.txt')), /larger than 1024 KiB/u);
    writeFileSync(join(root, 'linked.txt'), 'a\n');
    linkSync(join(root, 'linked.txt'), join(root, 'second-link.txt'));
    assert.match(await refusal(join(root, 'linked.txt')), /other hard links/u);
    mkdirSync(join(root, 'dir'));
    assert.match(await refusal(join(root, 'dir')), /is a directory/u);
    assert.match(await refusal(join(root, 'nowhere', 'x.txt')), /does not exist; create the directory first/u);
    symlinkSync(join(root, 'absent.txt'), join(root, 'dangling.txt'));
    assert.match(await refusal(join(root, 'dangling.txt')), /symlink to a missing file/u);
    if (process.getuid?.() !== 0) {
      writeFileSync(join(root, 'ro.txt'), 'r\n');
      chmodSync(join(root, 'ro.txt'), 0o444);
      assert.match(await refusal(join(root, 'ro.txt')), /read-only/u);
      mkdirSync(join(root, 'locked'));
      writeFileSync(join(root, 'locked', 'in.txt'), 'i\n');
      chmodSync(join(root, 'locked'), 0o555);
      assert.match(await refusal(join(root, 'locked', 'in.txt')), /folder holding .* is not writable/u);
      chmodSync(join(root, 'locked'), 0o755);
    }
    const fresh = await opened(join(root, 'new.txt'));
    assert.equal(fresh.identity, undefined);
    assert.deepEqual(fresh.lines, ['']);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('save: atomic replacement keeps mode, BOM, CRLF and a missing final newline; through a symlink the link stays', async () => {
  const root = scratch();
  try {
    const path = join(root, 'notes.txt');
    writeFileSync(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo', 'utf8')]));
    chmodSync(path, 0o640);
    const file = await opened(path);
    assert.deepEqual(file.lines, ['one', 'two']);
    assert.equal(file.lineEnding, 'crlf');
    assert.equal(file.bom, true);
    assert.equal(file.finalNewline, false);
    const saved = await saveFile(file, ['one', 'two', 'three']);
    assert.ok(saved.ok);
    assert.deepEqual(readFileSync(path), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\nthree', 'utf8')]));
    assert.equal(statSync(path).mode & 0o777, 0o640);
    assert.deepEqual(readdirSync(root), ['notes.txt'], 'no temporary file is left behind');

    writeFileSync(join(root, 'target.md'), '# t\n');
    symlinkSync(join(root, 'target.md'), join(root, 'link.md'));
    const viaLink = await opened(join(root, 'link.md'));
    assert.equal(viaLink.realPath, join(root, 'target.md'));
    assert.ok((await saveFile(viaLink, ['# changed'])).ok);
    assert.ok(lstatSync(join(root, 'link.md')).isSymbolicLink(), 'the symlink is kept; its target is written');
    assert.equal(readFileSync(join(root, 'target.md'), 'utf8'), '# changed\n');
    assert.deepEqual(encodeLines({lineEnding: 'lf', bom: false, finalNewline: true}, ['']), Buffer.alloc(0), 'an emptied file is empty');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('save: a changed, replaced or deleted original is a conflict; Overwrite is explicit; a new file never replaces one that appeared', async () => {
  const root = scratch();
  try {
    const path = join(root, 'conf.txt');
    writeFileSync(path, 'mine\n');
    const file = await opened(path);
    writeFileSync(path, 'theirs, longer\n');
    const changed = await saveFile(file, ['edited']);
    assert.ok(!changed.ok && changed.conflict === 'changed');
    assert.equal(readFileSync(path, 'utf8'), 'theirs, longer\n', 'nothing was written');
    assert.ok((await saveFile(file, ['edited'], {force: true})).ok);
    assert.equal(readFileSync(path, 'utf8'), 'edited\n');

    const again = await opened(path);
    writeFileSync(join(root, 'other.txt'), 'other\n');
    renameSync(join(root, 'other.txt'), path);
    const replaced = await saveFile(again, ['x']);
    assert.ok(!replaced.ok && replaced.conflict === 'replaced');

    const gone = await opened(path);
    unlinkSync(path);
    const deleted = await saveFile(gone, ['x']);
    assert.ok(!deleted.ok && deleted.conflict === 'deleted');

    const fresh = await opened(join(root, 'fresh.txt'));
    writeFileSync(join(root, 'fresh.txt'), 'someone else\n');
    const exists = await saveFile(fresh, ['mine']);
    assert.ok(!exists.ok && exists.conflict === 'exists');
    assert.equal(readFileSync(join(root, 'fresh.txt'), 'utf8'), 'someone else\n');
    unlinkSync(join(root, 'fresh.txt'));
    const created = await saveFile(fresh, ['mine']);
    assert.ok(created.ok && created.file.identity);
    assert.equal(readFileSync(join(root, 'fresh.txt'), 'utf8'), 'mine\n');
    assert.deepEqual(readdirSync(root).filter(name => name.includes('.nmsh-')), [], 'no temporary files');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('save: a failure keeps the text and leaves nothing behind', {skip: process.getuid?.() === 0 && 'root ignores permissions'}, async () => {
  const root = scratch();
  try {
    mkdirSync(join(root, 'd'));
    const path = join(root, 'd', 'f.txt');
    writeFileSync(path, 'a\n');
    const file = await opened(path);
    chmodSync(join(root, 'd'), 0o555);
    const result = await saveFile(file, ['b']);
    assert.ok(!result.ok && !result.conflict);
    assert.match(result.reason, /permission denied/u);
    chmodSync(join(root, 'd'), 0o755);
    assert.equal(readFileSync(path, 'utf8'), 'a\n');
    assert.deepEqual(readdirSync(join(root, 'd')), ['f.txt']);
  } finally { chmodSync(join(root, 'd'), 0o755); rmSync(root, {recursive: true, force: true}); }
});

// ---- Panel --------------------------------------------------------------------------------------------------------

const keysFor = (bytes: string): Key[] => decodeKeys(bytes);
function press(state: EditorState, input: string | Key, columns = 80, height = 24) {
  let action;
  for (const key of typeof input === 'string' ? keysFor(input) : [input]) action = editorKey(state, key, columns, height) ?? action;
  return action;
}

test('panel: the editor keys work from real terminal bytes (Ctrl+S save, Ctrl+Z/Ctrl+Y, Ctrl+F, Ctrl+C/Ctrl+X)', async () => {
  const root = scratch();
  try {
    writeFileSync(join(root, 'a.txt'), 'hello\n');
    const state = createEditor(await opened(join(root, 'a.txt')));
    press(state, '\u001b[F');
    press(state, ' world');
    assert.deepEqual(state.buffer.lines, ['hello world']);
    assert.deepEqual(press(state, '\u0013'), {kind: 'save'});
    press(state, '\u001a');
    assert.deepEqual(state.buffer.lines, ['hello']);
    press(state, '\u0019');
    assert.deepEqual(state.buffer.lines, ['hello world']);
    press(state, '\u0006');
    press(state, 'wor');
    press(state, '\r');
    assert.equal(state.buffer.selectedText(), 'wor');
    assert.deepEqual(press(state, '\u0003'), {kind: 'copy', text: 'wor'});
    assert.deepEqual(press(state, '\u0018'), {kind: 'copy', text: 'wor'});
    assert.deepEqual(state.buffer.lines, ['hello ld']);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('panel: Esc with unsaved changes asks; Discard, Save and Keep editing do what they say; conflicts offer Overwrite or Reload', async () => {
  const root = scratch();
  try {
    writeFileSync(join(root, 'b.txt'), 'b\n');
    const file = await opened(join(root, 'b.txt'));
    const clean = createEditor(file);
    assert.deepEqual(press(clean, {kind: 'escape'}), {kind: 'close'}, 'nothing to lose: Esc closes');
    const state = createEditor(file);
    press(state, 'x');
    assert.equal(press(state, {kind: 'escape'}), undefined);
    assert.equal(state.dialog?.kind, 'unsaved');
    assert.match(stripAnsi(renderEditor(state, 80, 24).join('\n')), /unsaved changes[\s\S]*Save[\s\S]*Discard changes[\s\S]*Keep editing/u);
    assert.equal(press(state, {kind: 'escape'}), undefined, 'Esc in the question keeps editing');
    assert.equal(state.dialog, undefined);
    press(state, {kind: 'escape'});
    assert.deepEqual(press(state, 's'), {kind: 'save', thenClose: true});
    press(state, {kind: 'escape'});
    assert.deepEqual(press(state, {kind: 'right'}), undefined);
    assert.deepEqual(press(state, {kind: 'enter'}), {kind: 'close'}, 'Discard was focused');
    state.dialog = {kind: 'conflict', focus: 0, conflict: 'changed', reason: 'b.txt changed on disk since you opened it.'};
    assert.match(stripAnsi(renderEditor(state, 80, 24).join('\n')), /changed on disk[\s\S]*Keep editing[\s\S]*Overwrite[\s\S]*Reload, discard mine/u);
    assert.deepEqual(press(state, 'o'), {kind: 'save', force: true});
    state.dialog = {kind: 'conflict', focus: 0, conflict: 'changed'};
    assert.deepEqual(press(state, 'r'), {kind: 'reload'});
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('panel: hostile file content is drawn inert, the caret and selection are visible without color, and it fits narrow panels', async () => {
  const root = scratch();
  try {
    writeFileSync(join(root, 'h.txt'), 'evil \u001b]8;;https://x\u0007link\u001b[2J and ‮right\n\tindented 中文\n');
    const state = createEditor(await opened(join(root, 'h.txt')));
    press(state, '\u001b[1;2C');
    for (const [columns, height] of [[80, 24], [32, 10], [20, 6]] as const) {
      const rows = renderEditor(state, columns, height);
      assert.ok(rows.length <= height);
      for (const row of rows) {
        assert.doesNotMatch(row.replace(/\u001b\[[0-9;]*m/gu, ''), /[\u001b‮]/u);
        assert.ok(displayWidth(stripAnsi(row)) <= columns);
      }
    }
    const wide = renderEditor(state, 100, 24).join('\n');
    assert.match(stripAnsi(wide), /evil ␛\]8;;https:\/\/x·link␛\[2J and ·right/u);
    assert.match(wide, /\u001b\[7me\u001b\[0m/u, 'the selected first character is reverse video');
    assert.match(stripAnsi(wide), /Ln 1, Col 2 · 1 selected/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
