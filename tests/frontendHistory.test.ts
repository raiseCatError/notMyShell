import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {stripAnsi} from '../src/util/text.js';

test('completed activity becomes history without contaminating copy payload', () => {
  const output = new OutputBuffer();
  output.beginCommand('printf hello', ['printf hello']);
  output.write('hello\n');
  const record = output.complete(0);
  output.addHistoryLine('✻ Completed · 1.0s · 23:48');
  assert.equal(record?.output, 'hello');
  assert.ok(output.wrapped(80).some(row => row.plain.includes('Completed')));
});

test('frontend copy command and result are permanent history but not shell records', () => {
  const output = new OutputBuffer();
  output.beginCommand('printf hello', ['printf hello']);
  output.write('hello\n');
  output.complete(0);
  output.addFrontendInteraction('/copy', 'Copied to clipboard · 5 characters · 1 line', '\u001B[38;2;116;181;154m');
  output.addFrontendInteraction('/copy 2', 'Copied response 2 to clipboard · 847 characters · 9 lines');
  const history = output.wrapped(120).map(row => stripAnsi(row.ansi)).join('\n');
  assert.match(history, /❯ \/copy\n  ⎿ Copied to clipboard/u);
  assert.match(history, /❯ \/copy 2\n  ⎿ Copied response 2/u);
  assert.equal(output.recent(1)?.output, 'hello');
});

test('UI overlays are not stored in history', () => {
  const output = new OutputBuffer();
  output.addHistoryLine('real history');
  const history = output.wrapped(80).map(row => row.plain).join('\n');
  assert.ok(!history.includes('Jump to bottom'));
  assert.ok(!history.includes('/help       Show NMSh commands'));
  assert.ok(!history.includes('Meowing…'));
});

