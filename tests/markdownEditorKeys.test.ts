import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEditor, editorKey, renderEditor} from '../src/viewer/EditorPanel.js';
import {openForEdit} from '../src/viewer/fileEdit.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

async function editorOn(name: string, content: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-mdkeys-')));
  const path = join(root, name); writeFileSync(path, content);
  const opened = await openForEdit(path, '/');
  if (!opened.ok) throw new Error(opened.reason);
  return {root, editor: createEditor(opened.file)};
}
const press = (editor: ReturnType<typeof createEditor>, bytes: string, columns = 80) => { for (const key of decodeKeys(bytes)) editorKey(editor, key, columns, 24); };
const screen = (editor: ReturnType<typeof createEditor>, columns = 80) => renderEditor(editor, columns, 24).map(row => stripAnsi(row)).join('\n');

test('Markdown file: Enter continues the list, Tab and Shift+Tab move the item, F1 opens the actions', async () => {
  const {root, editor} = await editorOn('n.md', '- one\n- two\n');
  try {
    editor.buffer.bufferHome(); editor.buffer.end();
    press(editor, 'x'); press(editor, '\r');
    assert.deepEqual(editor.buffer.lines.slice(0, 3), ['- onex', '- ', '- two']);
    press(editor, '\t');
    assert.equal(editor.buffer.lines[1], '  - ');
    press(editor, '\u001b[Z');
    assert.equal(editor.buffer.lines[1], '- ');
    press(editor, '\r');
    assert.equal(editor.buffer.lines[1], '', 'Enter on the empty item leaves the list');
    assert.match(screen(editor), /F1 Markdown/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('Markdown actions menu: letters run the action, Esc leaves it, the task toggles and undo reverts it', async () => {
  const {root, editor} = await editorOn('n.md', '- write\n');
  try {
    press(editor, '\u001bOP');
    assert.equal(editor.dialog?.kind, 'markdown');
    assert.match(screen(editor), /t task · n renumber/u);
    press(editor, '\u001b');
    assert.equal(editor.dialog, undefined);
    assert.equal(editor.buffer.dirty, false, 'closing the menu changes nothing');
    press(editor, '\u001bOP'); press(editor, 't');
    assert.equal(editor.dialog, undefined);
    assert.deepEqual(editor.buffer.lines, ['- [ ] write']);
    press(editor, '\u001a');
    assert.deepEqual(editor.buffer.lines, ['- write']);
    press(editor, '\u001bOP'); press(editor, 'n');
    assert.match(editor.note?.text ?? '', /numbered/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('the menu fits narrow terminals and every row stays within the width', async () => {
  const {root, editor} = await editorOn('n.md', '1. a\n');
  try {
    press(editor, '\u001bOP');
    for (const columns of [30, 50, 80, 120]) for (const row of renderEditor(editor, columns, 24)) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${row}`);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('other files keep the editor as it was: Enter is a plain newline, Tab inserts a tab, F1 does nothing, no Markdown hint', async () => {
  const {root, editor} = await editorOn('n.txt', '- one');
  try {
    editor.buffer.end();
    press(editor, '\r'); press(editor, '\t'); press(editor, '\u001bOP');
    assert.deepEqual(editor.buffer.lines, ['- one', '\t']);
    assert.equal(editor.dialog, undefined);
    assert.doesNotMatch(screen(editor), /F1 Markdown/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('CRLF files: helpers edit lines and the saved bytes keep CRLF', async () => {
  const {root, editor} = await editorOn('c.md', '- a\r\n- b\r\n');
  try {
    editor.buffer.end();
    editor.buffer.bufferEnd();
    editor.buffer.caret = {line: 0, column: 3};
    press(editor, '\r');
    assert.deepEqual(editor.buffer.lines.slice(0, 3), ['- a', '- ', '- b']);
    const {encodeLines} = await import('../src/viewer/fileEdit.js');
    assert.equal(encodeLines(editor.file, editor.buffer.lines).toString(), '- a\r\n- \r\n- b\r\n');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('tables: Tab walks the cells, Tab outside a table is a tab, F1 offers the table actions and the status names the cell', async () => {
  const {root, editor} = await editorOn('t.md', 'intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  try {
    editor.buffer.caret = {line: 0, column: 5};
    press(editor, '\t');
    assert.equal(editor.buffer.lines[0], 'intro\t', 'outside a table Tab is still a tab');
    editor.buffer.undo();
    editor.buffer.caret = {line: 2, column: 3};
    press(editor, '\t');
    assert.equal(editor.buffer.selectedText(), 'b');
    assert.match(screen(editor), /Table · header · column 2 of 2/u);
    press(editor, '\t');
    assert.deepEqual([editor.buffer.caret.line, editor.buffer.selectedText()], [4, '1']);
    press(editor, '\u001b[Z');
    assert.equal(editor.buffer.selectedText(), 'b');
    press(editor, '\u001bOP');
    assert.match(screen(editor), /r row\+ · d row− · o col\+/u);
    press(editor, 'r');
    assert.equal(editor.dialog, undefined);
    assert.equal(editor.buffer.lines.length, 6);
    press(editor, '\u001a');
    assert.equal(editor.buffer.lines.length, 5, 'one undo removes the row');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('the plain editor menu has no table actions outside a table', async () => {
  const {root, editor} = await editorOn('t.md', 'text\n');
  try {
    press(editor, '\u001bOP');
    assert.doesNotMatch(screen(editor), /row\+/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
