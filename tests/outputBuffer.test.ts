import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {pageViewport, viewportStart} from '../src/output/viewport.js';

test('carriage returns update one line instead of appending progress frames', () => {
  const output = new OutputBuffer();
  output.beginCommand('progress', ['❯ progress']);
  output.write('10%\r20%\r100%\n');
  const completed = output.complete(0);
  assert.equal(completed?.output, '100%');
  assert.deepEqual(output.wrapped(80).map(row => row.plain), ['❯ progress', '100%']);
});

test('wraps long output to the viewport width', () => {
  const output = new OutputBuffer();
  output.beginCommand('print', ['❯ print']);
  output.write('abcdefgh');
  assert.deepEqual(output.wrapped(4).map(row => row.plain), ['❯ pr', 'int', 'abcd', 'efgh']);
});

test('viewport follows latest until paged upward', () => {
  assert.equal(viewportStart(100, 20, true, 0), 80);
  const up = pageViewport(100, 20, 80, -1);
  assert.deepEqual(up, {start: 62, follow: false});
  assert.equal(viewportStart(110, 20, false, up.start), 62);
  assert.deepEqual(pageViewport(100, 20, 79, 1), {start: 80, follow: true});
});

test('clear sequence (2J/3J) triggers onClear callback, 0J/1J do not', () => {
  let clears = 0;
  const output = new OutputBuffer(() => { clears++; });
  output.beginCommand('foo', ['foo']);
  output.write('hello');
  
  // 0J (erase down) should not clear
  output.write('\u001B[0J');
  assert.equal(clears, 0);

  // 1J (erase up) should not clear
  output.write('\u001B[1J');
  assert.equal(clears, 0);

  // 2J (erase screen) should clear
  output.write('\u001B[2J');
  assert.equal(clears, 1);

  // 3J (erase scrollback) should clear
  output.write('\u001B[3J');
  assert.equal(clears, 2);
});

