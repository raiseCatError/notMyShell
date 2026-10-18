import test from 'node:test';
import assert from 'node:assert/strict';
import {Transitions, progress, transitionPaint} from '../src/motion/transitions.js';
import {renderExecutionTimeline} from '../src/status/executionTimeline.js';
import {AnsiOutputParser} from '../src/output/AnsiOutputParser.js';
import {currentForeground, overlayRow} from '../src/presentation/cellOverlay.js';
import {contrastRatio} from '../src/chroma/color.js';
import {DEFAULT_MOTION, type MotionSettings} from '../src/prompt/configuration.js';
import {queuePresentationChanges, staleQueueSnapshot} from '../src/status/queueTransitions.js';
import type {QueueState} from '../src/session/CommandQueue.js';

const gate = {reducedMotion: false, effectsOff: false, color: true};
const baseline: QueueState = {revision: 2, entries: [{id: 9, text: 'next', addedAt: 1000}], timeline: {
  id: 1, createdAt: 1000, startedAt: 1000, observedAt: 2000, elapsedMs: 1000, failurePolicy: 'pause', status: 'active',
  executions: [{id: 7, source: 'queue', entryId: 8, text: 'current', status: 'running', startedAt: 1000}],
  counts: {succeeded: 0, failed: 0, interrupted: 0, skipped: 0, unobserved: 0},
}};

test('queue presentation maps only observed result changes to immutable execution targets', () => {
  for (const [status, tone] of [['succeeded', 'success'], ['failed', 'failure'], ['interrupted', 'warning']] as const) {
    const next = structuredClone(baseline);
    next.revision = 3; next.timeline!.executions[0]!.status = status;
    const changes = queuePresentationChanges(baseline, next);
    assert.deepEqual(changes, [{target: 'queue:1:execution:7', tone, phase: 'completion'}]);
    assert.deepEqual(queuePresentationChanges(next, next), [], 'redraw/reopen/repeated snapshot does not replay');
    assert.deepEqual(queuePresentationChanges({entries: []}, next), [], 'reattached results are not new events');
  }
});

test('promotion, add, pause, resume and aggregate completion have distinct observed targets', () => {
  const next = structuredClone(baseline);
  next.timeline!.executions.push({id: 8, source: 'queue', entryId: 9, text: 'next', status: 'running', startedAt: 2000});
  assert.deepEqual(queuePresentationChanges(baseline, next), [{target: 'queue:1:execution:8', tone: 'accent', phase: 'launch'}]);
  next.entries = [...next.entries, {id: 10, text: 'added', addedAt: 2000}];
  assert.ok(queuePresentationChanges(baseline, next).some(change => change.target === 'queue:1:pending:10'));
  const paused = {...baseline, paused: {reason: 'user' as const, at: 2000}};
  assert.ok(queuePresentationChanges(baseline, paused).some(change => change.target === 'queue:1:heading' && change.tone === 'warning'));
  assert.ok(queuePresentationChanges(paused, baseline).some(change => change.target === 'queue:1:heading' && change.tone === 'accent'));
  const finished = structuredClone(baseline);
  finished.entries = []; finished.timeline!.status = 'finished'; finished.timeline!.counts.failed = 1;
  assert.ok(queuePresentationChanges(baseline, finished).some(change => change.target === 'queue:1:summary' && change.tone === 'failure'));
});

test('stale snapshots and independent work cannot replay or replace paused-chain feedback', () => {
  assert.equal(staleQueueSnapshot(baseline, {...baseline, revision: 1}), true);
  assert.deepEqual(queuePresentationChanges(baseline, {...baseline, revision: 1}), []);
  const settled = structuredClone(baseline); settled.timeline!.executions[0]!.status = 'succeeded';
  assert.equal(staleQueueSnapshot(settled, baseline), true, 'completed execution cannot become running again');
  const paused = {...settled, paused: {reason: 'user' as const, at: 2000}};
  assert.deepEqual(queuePresentationChanges(paused, {...paused, revision: 8}), [], 'unrelated foreground revision changes no chain facts');
});

test('identity-targeted highlights share tuned finite transitions, coalesce and release hidden rows', () => {
  const motion: MotionSettings = {...DEFAULT_MOTION, completionEffect: 'seal', commandLaunch: 'sweep'};
  const transitions = new Transitions(() => motion, () => gate);
  transitions.highlight('queue:1:execution:7', 'success', 100, 'completion');
  transitions.highlight('queue:1:execution:7', 'failure', 110, 'completion');
  transitions.highlight('queue:1:execution:8', 'accent', 110, 'launch');
  transitions.retainRows(new Set(['queue:1:execution:7']));
  const active = transitions.live(120);
  assert.equal(active.length, 1, 'no backlog or hidden-row work');
  assert.equal(active[0]!.kind, 'row');
  if (active[0]!.kind !== 'row') throw new Error('row transition missing');
  assert.equal(active[0]!.tone, 'failure');
  const early = transitionPaint.row('success', 80, 0.3, 'sweep', active[0]!.look);
  const late = transitionPaint.row('success', 80, 0.7, 'sweep', active[0]!.look);
  const center = (values: Map<number, unknown>) => [...values.keys()].reduce((sum, column) => sum + column, 0) / values.size;
  assert.ok(center(late) > center(early), 'existing sweep travels left to right');
  assert.equal(progress(active[0]!, 10000), 1);
  assert.deepEqual(transitions.live(10000), []);
  assert.equal(transitions.busy, false);
});

test('disabled motion gates settle row feedback without a clock or delayed logical state', () => {
  for (const current of [{...gate, reducedMotion: true}, {...gate, effectsOff: true}, {...gate, color: false}]) {
    const transitions = new Transitions(() => DEFAULT_MOTION, () => current);
    transitions.highlight('queue:1:execution:7', 'success', 100, 'completion');
    assert.equal(transitions.busy, false);
  }
});


test('semantic row sweeps preserve text contrast at animated peaks in Clean and Rich', () => {
  const state = structuredClone(baseline);
  state.timeline!.executions[0] = {...state.timeline!.executions[0]!, status: 'failed', exitCode: 17, durationMs: 1400};
  const row = renderExecutionTimeline(state, 80, 7).find(row => row.includes('exit 17'))!;
  for (const rendering of ['clean', 'rich'] as const) for (const t of [0.1, 0.3, 0.5, 0.7, 0.8, 0.9]) {
    const painted = overlayRow(row, transitionPaint.row('failure', 80, t, 'sweep', {rendering, intensity: 1.4}), 80);
    const parser = new AnsiOutputParser(); parser.write(painted);
    for (const cell of parser.allLines()[0] ?? []) if (cell?.text.trim()) {
      const fill = [...cell.style.matchAll(/\u001b\[48;2;(\d+);(\d+);(\d+)m/gu)].at(-1)!;
      const bg = {red: +fill[1]!, green: +fill[2]!, blue: +fill[3]!};
      assert.ok(contrastRatio(currentForeground(cell.style)!, bg) >= 4.5, `${rendering} ${t} ${cell.text}`);
    }
  }
});
