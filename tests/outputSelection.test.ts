import test from 'node:test';
import assert from 'node:assert/strict';
import {createOutputSelection, moveOutputSelection, validateOutputSelection, captureOutputAnchor, restoreOutputAnchor, revealOutputSelection} from '../src/output/OutputSelection.js';
import {HistoryViewport, type WrappedRow} from '../src/output/viewport.js';

const scope = {session: 's1', generation: 1};
const records = [{startId: 30}, {startId: 20}, {startId: 10}];
const rows: WrappedRow[] = Array.from({length: 30}, (_, i) => ({ansi: String(i), plain: String(i), lineIndex: i, blockStartId: Math.floor(i / 10) * 10}));

test('selection starts newest, Up walks older and Down newer without wrapping or adding later output', () => {
  const state = createOutputSelection('copy', scope, records, {draft: 'draft', cursor: 2})!;
  assert.equal(state.focusedId, 30);
  moveOutputSelection(state, 'up'); assert.equal(state.focusedId, 20);
  moveOutputSelection(state, 'up'); moveOutputSelection(state, 'up'); assert.equal(state.focusedId, 10);
  moveOutputSelection(state, 'down'); assert.equal(state.focusedId, 20);
  assert.equal(validateOutputSelection(state, scope, [{startId: 40}, ...records]), true);
  assert.deepEqual(state.candidateIds, [30, 20, 10]);
  assert.deepEqual(state.returnTo, {draft: 'draft', cursor: 2});
});

test('focused disappearance and reused IDs in another generation/session cancel rather than retarget', () => {
  assert.equal(createOutputSelection('actions', scope, [], {}), undefined);
  const state = createOutputSelection('actions', scope, records, {})!;
  assert.equal(validateOutputSelection(state, scope, records.slice(1)), false);
  assert.equal(state.focusedId, 30);
  assert.equal(validateOutputSelection(state, {...scope, generation: 2}, records), false);
  assert.equal(validateOutputSelection(state, {...scope, session: 's2'}, records), false);
  assert.equal(validateOutputSelection(state, scope, [records[0]!, records[2]!]), true);
  moveOutputSelection(state, 'up'); assert.equal(state.focusedId, 10);
});

test('minimal reveal keeps visible representation folded and restores stable reflowed anchor and FOLLOW', () => {
  const viewport = new HistoryViewport();
  viewport.resolve(30, 5); viewport.scrollLines(30, 5, -13);
  assert.equal(viewport.start, 12);
  const anchor = captureOutputAnchor(rows, viewport, 5);
  revealOutputSelection(rows, viewport, 5, 10); assert.equal(viewport.start, 12, 'already visible block needs no scroll');
  revealOutputSelection(rows, viewport, 5, 0); assert.equal(viewport.start, 0);
  const reflowed = rows.flatMap(row => [row, {...row}]);
  restoreOutputAnchor(reflowed, viewport, 5, anchor); assert.equal(viewport.start, 24);
  restoreOutputAnchor(rows.slice(0, 4), viewport, 5, anchor); assert.equal(viewport.start, 0, 'vanished anchor clamps safely');
  viewport.latest(); const follow = captureOutputAnchor(rows, viewport, 5);
  revealOutputSelection(rows, viewport, 5, 0);
  restoreOutputAnchor(rows, viewport, 3, follow); assert.equal(viewport.resolve(30, 3), 27); assert.equal(viewport.mode, 'follow');
});

test('detached synthetic gaps and folded hints restore their own representation, never another row sharing lineIndex', () => {
  const history: WrappedRow[] = [
    {ansi: '', plain: '', lineIndex: -1},
    {ansi: 'a', plain: 'a', lineIndex: 10, blockStartId: 10},
    {ansi: 'head', plain: 'head', lineIndex: 11, blockStartId: 10},
    {ansi: 'fold', plain: 'fold', lineIndex: 11, blockStartId: 10, isFoldHint: true},
    {ansi: '', plain: '', lineIndex: -1},
    {ansi: 'b', plain: 'b', lineIndex: 20, blockStartId: 20},
    {ansi: 'tail', plain: 'tail', lineIndex: 21, blockStartId: 20},
    {ansi: 'tail', plain: 'tail', lineIndex: 22, blockStartId: 20},
  ];
  for (const start of [3, 4]) {
    const viewport = new HistoryViewport(); viewport.resolve(history.length, 2); viewport.scrollLines(history.length, 2, start - 6);
    const anchor = captureOutputAnchor(history, viewport, 2);
    viewport.latest(); restoreOutputAnchor(history, viewport, 2, anchor);
    assert.equal(viewport.start, start);
    const reflow = [history[0]!, history[1]!, history[2]!, {...history[2]!}, ...history.slice(3)];
    restoreOutputAnchor(reflow, viewport, 2, anchor); assert.equal(viewport.start, start + 1);
  }
});
