import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {selectedText} from '../src/output/TranscriptSelection.js';
import {displayWidth} from '../src/util/text.js';

const CONFIRMATION = 'Copied to clipboard · 113 characters · 5 lines';
const LIFECYCLE = '✔ Completed · 1m 25s · 18s waiting for input (2 prompts) · 15:42';

const all = (rows: readonly unknown[]) => ({anchor: 0, head: rows.length - 1, dragging: false, moved: true, pointerY: 0});

test('NMSh confirmations wrap at words with a hanging indent, never mid-word', () => {
  const output = new OutputBuffer();
  output.addFrontendInteraction('/copy', CONFIRMATION);
  const rows = output.wrapped(46).map(row => row.plain);
  assert.deepEqual(rows, ['❯ /copy', '  ⎿ Copied to clipboard · 113 characters · 5 ', '    lines']);
  assert.deepEqual(output.wrapped(30).map(row => row.plain), ['❯ /copy', '  ⎿ Copied to clipboard · 113 ', '    characters · 5 lines']);
});

test('word-wrapped NMSh lines stay exact for selection and fit the width at every size', () => {
  for (let width = 6; width <= 70; width += 1) {
    const output = new OutputBuffer();
    output.addFrontendInteraction('/copy', CONFIRMATION);
    output.addHistoryLine(LIFECYCLE);
    output.addHistoryLine('  ⎿ 漢字の通知 · wide characters 漢字 stay whole');
    const rows = output.wrapped(width);
    for (const row of rows) assert.ok(displayWidth(row.plain) <= width, `width ${width}: "${row.plain}"`);
    assert.equal(selectedText(rows, all(rows)),
      ['❯ /copy', `  ⎿ ${CONFIRMATION}`, '', LIFECYCLE, '', '  ⎿ 漢字の通知 · wide characters 漢字 stay whole'].join('\n'), `width ${width}`);
  }
});

test('shell output keeps terminal column wrapping', () => {
  const output = new OutputBuffer();
  output.beginCommand('echo', ['❯ echo']);
  output.write(`  ⎿ ${CONFIRMATION}\r\n`);
  output.complete(0);
  const rows = output.wrapped(28).map(row => row.plain);
  assert.deepEqual(rows.slice(1), ['  ⎿ Copied to clipboard · 11', '3 characters · 5 lines']);
});
