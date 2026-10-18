import test from 'node:test';
import assert from 'node:assert/strict';
import {executionFrameFixture} from './support/executionTimelineFrames.js';
import {serializeCopyPayload} from '../src/output/OutputBuffer.js';
import type {QueueSummary} from '../src/session/QueueSummary.js';

const summary: QueueSummary = {version: 1, id: 'chain-1', chainId: 1, savedAt: 1700000001000, origin: 'automatic', status: 'finished', failurePolicy: 'pause',
  createdAt: 1700000000000, startedAt: 1700000000000, endedAt: 1700000001000, elapsedMs: 1000,
  counts: {succeeded: 1, failed: 0, interrupted: 0, skipped: 0, unobserved: 0}, entries: [{outcome: 'succeeded', label: 'npm', durationMs: 1000, exitCode: 0}], entriesOmitted: 0};

function folded(f: ReturnType<typeof executionFrameFixture>) {
  const output = f.app['output'];
  output.beginCommand('seq 1 400', ['seq 1 400']);
  const exact = 'a\tb 日本語\n' + Array.from({length: 400}, (_, i) => `${i + 1}\n`).join('');
  output.write(exact);
  const record = output.complete(0, {queued: true, foldQueued: true})!;
  output.setQueueSummaries([summary]);
  return {record, exact};
}

test('2B/2C folded queued output retains exact copy, numbering and typed summaries through selector restoration and journal roundtrip', async () => {
  const f = executionFrameFixture(32, 18);
  try {
    const {record, exact} = folded(f);
    const before = f.app['output'].transcript();
    await f.app['copySlash']('/cp', '');
    assert.deepEqual(f.app['outputNavigation']?.candidateIds, [record.startId]);
    assert.equal(record.expanded, false);
    const rows = f.app['output'].wrapped(32);
    assert.ok(rows.some(row => row.isFoldHint && row.blockStartId === record.startId));
    assert.equal(rows.some(row => row.plain.includes('Queue Summary')), false, 'typed summaries never become command-owned transcript rows');
    f.capture(); f.app['handleKey']({kind: 'escape'});
    assert.deepEqual(f.app['output'].transcript(), before);
    assert.equal(serializeCopyPayload(record), exact);
    f.app['output'].restoreTranscript(before);
    assert.deepEqual(f.app['output'].queueSummaries, [summary]);
    assert.equal(f.app['output'].recentShell(1)!.queued, true);
    assert.equal(f.app['output'].recentShell(1)!.expanded, false);
    assert.equal(serializeCopyPayload(f.app['output'].recentShell(1)!), exact);
    await f.app['runSlash']('/actions 1', {kind: 'actions', index: 1});
    assert.ok(f.app['paletteState']);
    f.app['handleKey']({kind: 'escape'});
  } finally { f.dispose(); }
});

test('2B summary save review and pending detail fetch retain input priority over Copy and Actions', async () => {
  const f = executionFrameFixture();
  try {
    folded(f);
    f.app['summaryReview'] = {chainId: 1, revision: 1, texts: [null], summary};
    await f.app['copySlash']('/copy', '');
    assert.equal(f.app['outputNavigation'], undefined);
    await f.app['runSlash']('/actions', {kind: 'actions'});
    assert.equal(f.app['outputNavigation'], undefined);
    f.app['summaryReview'] = undefined;
    f.app['pendingSummarySave'] = 1;
    await f.app['copySlash']('/copy', ''); assert.equal(f.app['outputNavigation'], undefined);
  } finally { f.dispose(); }
});

test('2C paste choice review cannot be bypassed by selector setup, and focus never dispatches work', async () => {
  const f = executionFrameFixture();
  try {
    folded(f);
    const {createBatchReview} = await import('../src/input/BatchReview.js');
    const review = createBatchReview('echo one\necho two', 'fish', 10)!;
    f.app['batchReview'] = review;
    await f.app['copySlash']('/copy', ''); assert.equal(f.app['outputNavigation'], undefined);
    await f.app['runSlash']('/actions', {kind: 'actions'}); assert.equal(f.app['outputNavigation'], undefined);
    for (const kind of ['left', 'right', 'complete', 'focusPrevious'] as const) f.app['handleKey']({kind});
    assert.equal(f.app['batchReview'], review);
    assert.deepEqual(f.owner.state.entries, []);
    assert.equal(f.app['running'], undefined);
  } finally { f.dispose(); }
});

test('pointer Actions during selection uses the displayed block, never restored entry coordinates', async () => {
  const f = executionFrameFixture(80, 30);
  try {
    f.begin('old command', 'old output\n'); f.complete();
    const old = f.app['output'].recentShell(1)!;
    f.begin('new command', 'new output\n'.repeat(80)); f.complete();
    await f.app['runSlash']('/actions', {kind: 'actions'});
    f.app['handleKey']({kind: 'up'});
    const rows = f.app['output'].wrapped(80);
    const plan = f.app['planFrame'](80, 30);
    const start = f.app['historyViewport'].resolve(rows.length, plan.viewportRows);
    const index = rows.findIndex(row => row.lineIndex === old.startId);
    const y = plan.transcript.top + index - start + 1;
    f.app['handleKey']({kind: 'mouseMove', x: 78, y});
    f.app['handleKey']({kind: 'mouseClick', x: 78, y});
    assert.ok(f.app['paletteState']);
    assert.ok(f.app['paletteState']!.items.every(item => item.action.kind === 'block' && item.action.startId === old.startId));
  } finally { f.dispose(); }
});
