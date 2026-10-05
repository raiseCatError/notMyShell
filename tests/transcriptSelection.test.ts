import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {beginSelection, extendSelection, isRowSelected, selectedText} from '../src/output/TranscriptSelection.js';
import {regionOf} from '../src/app/screenPlan.js';
import type {WrappedRow} from '../src/output/viewport.js';

const sgr = (button: number, x: number, y: number, press = true) => `\u001b[<${button};${x};${y}${press ? 'M' : 'm'}`;

test('decoder: plain drag and release are selection events; Shift stays native; Shift+wheel still scrolls', () => {
  assert.deepEqual(decodeKeys(sgr(32, 3, 4)), [{kind: 'mouseDrag', x: 3, y: 4}]);
  assert.deepEqual(decodeKeys(sgr(0, 3, 4, false)), [{kind: 'mouseRelease', x: 3, y: 4}]);
  assert.deepEqual(decodeKeys(sgr(0, 3, 4)), [{kind: 'mouseClick', x: 3, y: 4}]);
  assert.deepEqual(decodeKeys(sgr(35, 3, 4)), [{kind: 'mouseMove', x: 3, y: 4}], 'hover unchanged');
  assert.deepEqual(decodeKeys(sgr(36, 3, 4)), [], 'Shift+drag is the terminal\'s own selection');
  assert.deepEqual(decodeKeys(sgr(68, 3, 4)), [{kind: 'wheelUp'}], 'a host that reports Shift+wheel still scrolls the transcript');
});

test('selected text is transcript content: wrapped rows of one line join, lines break, padding and filter hints drop', () => {
  const rows: WrappedRow[] = [
    {ansi: '', plain: 'first part ', lineIndex: 1}, {ansi: '', plain: 'second part   ', lineIndex: 1},
    {ansi: '', plain: '[filter active]', isFilterHint: true}, {ansi: '', plain: 'next line', lineIndex: 2},
  ];
  const selection = beginSelection(0, 5);
  assert.equal(selectedText(rows, selection), '', 'a click selects nothing');
  extendSelection(selection, 3);
  assert.equal(selectedText(rows, selection), 'first part second part\nnext line');
  assert.ok(isRowSelected(selection, 2) && !isRowSelected(selection, 4));
  const reversed = beginSelection(3, 5);
  extendSelection(reversed, 1);
  assert.equal(selectedText(rows, reversed), 'second part\nnext line', 'dragging upward selects the same content');
});

test('app: drag selects, the wheel scrolls while dragging and the selection grows past the visible rows', () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 20})});
  try {
    app['startupPending'] = false;
    app['output'].setOutputFolding('never');
    app['output'].beginCommand('seq', ['seq']);
    app['output'].write(Array.from({length: 80}, (_, index) => `line-${index}`).join('\n') + '\n');
    app['output'].complete(0);
    const plan = app['planFrame'](100, 20);
    const transcript = regionOf(plan, 'transcript')!;
    const bottomY = transcript.top + transcript.height; // terminal rows are 1-based
    app['handleKey']({kind: 'mouseClick', x: 2, y: bottomY});
    const anchor = app['selection']!.anchor;
    app['handleKey']({kind: 'mouseDrag', x: 2, y: transcript.top + 1});
    const visibleHead = app['selection']!.head;
    assert.ok(visibleHead < anchor);
    for (let step = 0; step < 4; step += 1) app['handleKey']({kind: 'wheelUp'});
    assert.ok(app['selection']!.head < visibleHead - 6, 'the head follows the scrolled transcript');
    assert.equal(app['selection']!.anchor, anchor, 'the anchor stays on its transcript row');
    app['handleKey']({kind: 'mouseRelease', x: 2, y: transcript.top + 1});
    assert.equal(app['selection']!.dragging, false);
    const text = selectedText(app['output'].wrapped(100), app['selection']!);
    assert.ok(text.split('\n').length > transcript.height, 'more lines than fit on screen');
    app['handleKey']({kind: 'text', value: 'x'});
    assert.equal(app['selection'], undefined, 'the next key clears a finished selection');
  } finally { app['stop'](0); app['session'].kill(); }
});

test('app: a plain click still acts as before and leaves no selection', () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 20})});
  try {
    app['startupPending'] = false;
    app['output'].addHistoryLine('hello');
    const transcript = regionOf(app['planFrame'](100, 20), 'transcript')!;
    app['handleKey']({kind: 'mouseClick', x: 2, y: transcript.top + 1});
    app['handleKey']({kind: 'mouseRelease', x: 2, y: transcript.top + 1});
    assert.equal(app['selection'], undefined);
  } finally { app['stop'](0); app['session'].kill(); }
});
