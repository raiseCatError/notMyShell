import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeKeys, KeyDecoder} from '../src/terminal/keys.js';
import {CommandEditor} from '../src/input/CommandEditor.js';

function dispatch(editor: CommandEditor, key: ReturnType<typeof decodeKeys>[number]): void {
  if (key.kind === 'text') editor.insert(key.value);
  else if (key.kind === 'left') editor.moveLeft();
  else if (key.kind === 'right') editor.moveRight();
  else if (key.kind === 'selectLeft') editor.selectLeft();
  else if (key.kind === 'selectRight') editor.selectRight();
  else if (key.kind === 'lineHome') editor.lineHome();
  else if (key.kind === 'lineEnd') editor.lineEnd();
  else if (key.kind === 'selectLineHome') editor.selectLineHome();
  else if (key.kind === 'selectLineEnd') editor.selectLineEnd();
  else if (key.kind === 'bufferHome') editor.moveBufferHome();
  else if (key.kind === 'bufferEnd') editor.moveBufferEnd();
  else if (key.kind === 'selectBufferHome') editor.selectBufferHome();
  else if (key.kind === 'selectBufferEnd') editor.selectBufferEnd();
  else if (key.kind === 'backspace') editor.backspace();
  else if (key.kind === 'newline') editor.insert('\n');
}

function pushRaw(decoder: KeyDecoder, editor: CommandEditor, raw: string): void {
  for (const key of decoder.push(raw)) dispatch(editor, key);
}

test('Cmd+Left/Right line movement', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'abc\ndef\nghi');
  
  // Set cursor in the middle of 'def'
  e['cursor'] = 5; // e is at index 5. a=0,b=1,c=2,\n=3,d=4,e=5

  // Cmd+Left (home) should go to the beginning of 'def'
  pushRaw(d, e, '\u001B[1;9D');
  assert.equal(e.cursorIndex, 4);

  // Cmd+Right (end) should go to the end of 'def'
  pushRaw(d, e, '\u001B[1;9C');
  assert.equal(e.cursorIndex, 7);
});

test('Cmd+Shift+Left/Right line selection', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'hello world');
  e['cursor'] = 6; // before 'world'

  // Cmd+Shift+Left
  pushRaw(d, e, '\u001B[1;10D');
  assert.equal(e.cursorIndex, 0);
  assert.deepEqual(e.selection, {start: 0, end: 6});

  // Type x to replace
  pushRaw(d, e, 'x');
  assert.equal(e.text, 'xworld');
});

test('Cmd+Shift+Right line selection', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'hello world');
  e['cursor'] = 5; // after 'hello'

  // Cmd+Shift+Right
  pushRaw(d, e, '\u001B[1;10C');
  assert.equal(e.cursorIndex, 11);
  assert.deepEqual(e.selection, {start: 5, end: 11});

  // Type y to replace
  pushRaw(d, e, 'y');
  assert.equal(e.text, 'helloy');
});

test('Decoder output has no literal leak for Cmd+Arrow', () => {
  const keys = decodeKeys('\u001B[1;9D');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kind, 'lineHome');

  const keys2 = decodeKeys('\u001B[1;10C');
  assert.equal(keys2.length, 1);
  assert.equal(keys2[0].kind, 'selectLineEnd');
});

test('Optional Cmd+Up/Down buffer navigation', () => {
  const d = new KeyDecoder();
  const e = new CommandEditor();
  pushRaw(d, e, 'abc\ndef');

  pushRaw(d, e, '\u001B[1;9A'); // Cmd+Up
  assert.equal(e.cursorIndex, 0);

  pushRaw(d, e, '\u001B[1;9B'); // Cmd+Down
  assert.equal(e.cursorIndex, 7);

  // Cmd+Shift+Up
  pushRaw(d, e, '\u001B[1;10A');
  assert.deepEqual(e.selection, {start: 0, end: 7});
});
