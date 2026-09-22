import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandEditor} from '../src/input/CommandEditor.js';
import {layoutInput} from '../src/input/inputLayout.js';
import {KeyDecoder, decodeKeys} from '../src/terminal/keys.js';
import {calculateScreenLayout, MAX_VISIBLE_INPUT_ROWS} from '../src/app/layout.js';

test('single-line caret includes the prompt prefix and supports middle positions', () => {
  assert.deepEqual(layoutInput('hello', 5, 80).caretColumn, 7);
  assert.deepEqual(layoutInput('hello', 2, 80).caretColumn, 4);
  assert.equal(layoutInput('界x', 1, 80).caretColumn, 4);
});

test('distinguishes explicit newlines from visual wrapping and recomputes on resize', () => {
  const explicit = layoutInput('ab\ncd', 5, 20);
  assert.equal(explicit.allRows.length, 2);
  assert.deepEqual(explicit.allRows.map(row => row.text), ['ab', 'cd']);
  assert.equal(explicit.caretRow, 1);
  assert.equal(explicit.caretColumn, 4);

  const wide = layoutInput('abcdefgh', 8, 12);
  const narrow = layoutInput('abcdefgh', 8, 6);
  assert.equal(wide.allRows.length, 1);
  assert.ok(narrow.allRows.length > wide.allRows.length);
  assert.equal(narrow.caretRow, narrow.allRows.length - 1);
});

test('editor inserts and edits across newline boundaries', () => {
  const editor = new CommandEditor();
  editor.insert('first\nsecond');
  editor.lineHome();
  assert.equal(editor.cursorIndex, 6);
  editor.backspace();
  assert.equal(editor.text, 'firstsecond');
  editor.insert('\n');
  editor.moveLeft();
  editor.delete();
  assert.equal(editor.text, 'firstsecond');
  editor.moveUp(8);
  editor.moveDown(8);
});

test('Ctrl-J and reported Shift-Enter insert newlines while carriage return submits', () => {
  assert.deepEqual(decodeKeys('\n'), [{kind: 'newline'}]);
  assert.deepEqual(decodeKeys('\u001B[13;2u'), [{kind: 'newline'}]);
  assert.deepEqual(decodeKeys('\u001B[27;2;13~'), [{kind: 'newline'}]);
  assert.deepEqual(decodeKeys('\r'), [{kind: 'enter'}]);
});

test('bracketed multiline paste is one insertion and survives split input chunks', () => {
  assert.deepEqual(decodeKeys('\u001B[200~one\r\ntwo\u001B[201~'), [{kind: 'text', value: 'one\ntwo'}]);
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push('\u001B[200~one\n'), []);
  assert.deepEqual(decoder.push('two\u001B[201~'), [{kind: 'text', value: 'one\ntwo'}]);
  assert.deepEqual(decoder.push('x\u001B[200~a\nb\u001B[201~y'), [
    {kind: 'text', value: 'x'},
    {kind: 'text', value: 'a\nb'},
    {kind: 'text', value: 'y'},
  ]);
});

test('input grows upward, caps at eight rows, and preserves output space', () => {
  const normal = calculateScreenLayout(24, 3, 0);
  assert.equal(normal.inputHeight, 3);
  assert.equal(normal.outputHeight, 19);
  const capped = calculateScreenLayout(24, 100, 0);
  assert.equal(capped.inputHeight, MAX_VISIBLE_INPUT_ROWS);
  assert.ok(capped.outputHeight >= 2);
  const tiny = calculateScreenLayout(5, 100, 0);
  assert.equal(tiny.inputHeight, 3);
  assert.equal(tiny.outputHeight, 0);
});

test('decodes terminal paging aliases and Ctrl-End variants', () => {
  assert.deepEqual(decodeKeys('\u001B[5~'), [{kind: 'pageUp'}]);
  assert.deepEqual(decodeKeys('\u001B[6~'), [{kind: 'pageDown'}]);
  assert.deepEqual(decodeKeys('\u001B[1;5F'), [{kind: 'latest'}]);
  assert.deepEqual(decodeKeys('\u001B[5;5~'), [{kind: 'latest'}]);
  assert.deepEqual(decodeKeys('\u0007'), [{kind: 'latest'}]);
  assert.deepEqual(decodeKeys('\t'), [{kind: 'complete'}]);
});

test('key decoder preserves paging sequences split across input chunks', () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push('\u001B['), []);
  assert.deepEqual(decoder.push('5~'), [{kind: 'pageUp'}]);
  assert.deepEqual(decoder.push('\u001B[1;'), []);
  assert.deepEqual(decoder.push('5F'), [{kind: 'latest'}]);
});

test('select all and backspace clears the editor', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.selectAll();
  editor.backspace();
  assert.equal(editor.text, '');
});

test('select all and delete clears the editor', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.selectAll();
  editor.delete();
  assert.equal(editor.text, '');
});

test('select all and character replaces the editor', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.selectAll();
  editor.insert('x');
  assert.equal(editor.text, 'x');
});

test('select all and paste replaces the editor', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.selectAll();
  editor.insert('hello');
  assert.equal(editor.text, 'hello');
});

test('multiline selection replacement', () => {
  const editor = new CommandEditor();
  editor.insert('abc\ndef');
  editor.selectAll();
  editor.insert('x');
  assert.equal(editor.text, 'x');
});

test('character selection expands and contracts correctly', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.moveLeft();
  editor.moveLeft(); // cursor at 4
  assert.equal(editor.cursorIndex, 4);
  editor.selectLeft();
  assert.deepEqual(editor.selection, {start: 3, end: 4});
  editor.selectLeft();
  assert.deepEqual(editor.selection, {start: 2, end: 4});
  editor.selectRight();
  assert.deepEqual(editor.selection, {start: 3, end: 4});
  editor.selectRight();
  assert.equal(editor.selection, undefined);
  assert.equal(editor.cursorIndex, 4);
});

test('reverse selection crossing anchor behaves correctly', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.moveLeft();
  editor.moveLeft(); // cursor at 4
  editor.selectLeft(); // cursor 3, anchor 4
  editor.selectRight(); // cursor 4, anchor 4 (empty)
  editor.selectRight(); // cursor 5, anchor 4
  assert.deepEqual(editor.selection, {start: 4, end: 5});
});

test('word selection extends boundaries', () => {
  const editor = new CommandEditor();
  editor.insert('foo bar baz');
  editor.wordLeft(); // cursor before baz (8)
  editor.selectWordLeft(); // cursor before bar (4), anchor 8
  assert.deepEqual(editor.selection, {start: 4, end: 8});
  editor.selectWordRight(); // cursor before baz (8), anchor 8
  assert.equal(editor.selection, undefined);
  editor.selectWordRight(); // cursor end (11), anchor 8
  assert.deepEqual(editor.selection, {start: 8, end: 11});
});

test('plain arrow collapses selection', () => {
  const editor = new CommandEditor();
  editor.insert('abcdef');
  editor.lineHome();
  editor.selectRight();
  editor.selectRight(); // select 'ab' (0..2)
  editor.moveLeft();
  assert.equal(editor.selection, undefined);
  assert.equal(editor.cursorIndex, 0);

  editor.selectRight();
  editor.selectRight(); // select 'ab'
  editor.moveRight();
  assert.equal(editor.selection, undefined);
  assert.equal(editor.cursorIndex, 2);
});

test('Ctrl+A CSI-u mapping', () => {
  assert.deepEqual(decodeKeys('\u001B[97;5u'), [{kind: 'lineHome'}]);
  assert.deepEqual(decodeKeys('\u0001'), [{kind: 'lineHome'}]);
  assert.deepEqual(decodeKeys('\u001B[101;5u'), [{kind: 'lineEnd'}]);
});

test('multiline selection', () => {
  const editor = new CommandEditor();
  editor.insert('abc\ndef');
  editor.lineHome(); // start of second line (index 4)
  editor.selectLeft(); // select '\n' (3..4)
  assert.deepEqual(editor.selection, {start: 3, end: 4});
  editor.selectLeft(); // select 'c\n' (2..4)
  assert.deepEqual(editor.selection, {start: 2, end: 4});
  editor.insert('x');
  assert.equal(editor.text, 'abxdef');
});
