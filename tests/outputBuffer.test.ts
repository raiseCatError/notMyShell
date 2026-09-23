import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
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

test('transcript snapshot restores command details, fold state, and plain-text copy data', () => {
  const output = new OutputBuffer();
  output.beginCommand('printf hello', ['❯ printf hello']);
  output.write('\u001B[31mhello\u001B[0m\n');
  output.complete(0);
  output.setCompletionLifecycle('Completed · 0s');
  output.addHistoryLine('Completed · 0s');
  output.toggleExpanded(0);

  const snapshot = output.transcript();
  const restored = new OutputBuffer();
  restored.restoreTranscript(snapshot);
  assert.equal(restored.recent(1)?.command, 'printf hello');
  assert.equal(restored.recent(1)?.output, 'hello');
  assert.equal(restored.recent(1)?.expanded, false);
  assert.equal(restored.recent(1)?.lifecycleText, 'Completed · 0s');
  assert.equal(serializeCopyPayload(restored.recent(1)!), 'hello\nCompleted · 0s');
  assert.ok(restored.wrapped(80).some(row => row.isFoldHint));
});

test('historical context stays frozen per command, uses muted dividers, and survives transcript restore', () => {
  const output = new OutputBuffer();
  output.beginCommand('pwd', ['❯ pwd'], undefined, {cwd: '/Users/test/project', branch: 'dev'});
  output.write('/Users/test/project\n');
  output.complete(0);
  output.setCompletionLifecycle('Completed · 7 ms');
  output.addHistoryLine('Completed · 7 ms');
  output.beginCommand('cd /tmp', ['❯ cd /tmp'], undefined, {cwd: '/tmp'});
  output.complete(0);

  const rows = output.wrapped(80);
  const headers = rows.filter(row => row.isHistoricalHeader);
  assert.equal(headers.length, 2);
  assert.ok(rows.findIndex(row => row === headers[1]) > rows.findIndex(row => row.plain === ''));
  assert.match(headers[0]?.plain ?? '', /\/Users\/test\/project   dev/u);
  assert.match(headers[1]?.plain ?? '', /^\/tmp /u);
  assert.match(headers[0]?.ansi ?? '', /38;2;139;141;157m/u);
  assert.doesNotMatch(headers[0]?.ansi ?? '', /38;2;(?:52;105;98|72;152;100|194;98;99)m/u);
  assert.equal(serializeCopyPayload(output.recent(2)!), '/Users/test/project\nCompleted · 7 ms');
  assert.equal(output.recent(2)?.historicalContext?.branch, 'dev');

  const restored = new OutputBuffer();
  restored.restoreTranscript(output.transcript());
  const restoredHeaders = restored.wrapped(80).filter(row => row.isHistoricalHeader);
  assert.deepEqual(restoredHeaders.map(row => row.plain.split(' ─')[0]), headers.map(row => row.plain.split(' ─')[0]));
  assert.ok(restored.wrapped(12).filter(row => row.isHistoricalHeader).every(row => row.plain.length <= 12));
});

test('historical header stays visible for folded output and older transcript records remain compatible', () => {
  const output = new OutputBuffer();
  output.beginCommand('many', ['❯ many'], undefined, {cwd: '/tmp/folded', branch: 'work'});
  output.write(`${Array.from({length: 12}, (_, index) => `line ${index}`).join('\n')}\n`);
  output.complete(0);
  output.toggleExpanded(0);

  const rows = output.wrapped(80);
  assert.equal(rows.filter(row => row.isHistoricalHeader).length, 1);
  assert.ok(rows.findIndex(row => row.isHistoricalHeader) < rows.findIndex(row => row.isFoldHint));

  const olderTranscript = output.transcript();
  olderTranscript.records = olderTranscript.records.map(({historicalContext: _context, ...record}) => record);
  const restored = new OutputBuffer();
  restored.restoreTranscript(olderTranscript);
  assert.equal(restored.wrapped(80).filter(row => row.isHistoricalHeader).length, 0);
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
