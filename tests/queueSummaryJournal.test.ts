import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {SUMMARY_LIMIT, type QueueSummary} from '../src/session/QueueSummary.js';
import {TranscriptStore, TRANSCRIPT_SCHEMA_VERSION} from '../src/sessions/TranscriptStore.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {stripAnsi} from '../src/util/text.js';
import type {QueueOp} from '../src/session/CommandQueue.js';

/** One deterministic typed artifact: the facts the owner stores, never output and never input. */
function sample(chainId: number, overrides: Partial<QueueSummary> = {}): QueueSummary {
  return {version: 1, id: `chain-${chainId}`, chainId, savedAt: 1_700_000_000_000 + chainId, origin: 'automatic', status: 'finished',
    failurePolicy: 'pause', createdAt: 1_700_000_000_000, startedAt: 1_700_000_000_000, endedAt: 1_700_000_001_000, elapsedMs: 1000,
    counts: {succeeded: 1, failed: 0, interrupted: 0, skipped: 0, unobserved: 0},
    entries: [{outcome: 'succeeded', label: 'npm', durationMs: 1000, exitCode: 0}], entriesOmitted: 0, ...overrides};
}

test('a presentation carries its saved summaries through its transcript and restores them', () => {
  const buffer = new OutputBuffer();
  assert.equal(buffer.transcript().queueSummaries, undefined, 'nothing saved: nothing journaled');
  const saved = [sample(1), sample(2, {origin: 'reviewed', status: 'cleared',
    counts: {succeeded: 0, failed: 0, interrupted: 0, skipped: 2, unobserved: 0}, entries: []})];
  buffer.setQueueSummaries(saved);
  assert.deepEqual(buffer.queueSummaries, saved, 'the presentation holds typed artifacts, in save order');
  const restored = new OutputBuffer();
  restored.restoreTranscript(buffer.transcript());
  assert.deepEqual(restored.queueSummaries, saved, 'restore keeps every artifact exactly as stored');
  const cleared = new OutputBuffer();
  cleared.setQueueSummaries(saved);
  cleared.clearPresentation();
  assert.deepEqual(cleared.queueSummaries, [], 'a fresh presentation starts with none');
  assert.equal(cleared.transcript().queueSummaries, undefined);
});

test('the presentation keeps only the newest artifacts, and malformed input fails closed', () => {
  const buffer = new OutputBuffer();
  buffer.setQueueSummaries(Array.from({length: SUMMARY_LIMIT + 3}, (_, index) => sample(index + 1)));
  assert.equal(buffer.queueSummaries.length, SUMMARY_LIMIT, 'the list is bounded like the owner’s');
  assert.equal(buffer.queueSummaries[0]?.id, 'chain-4', 'the oldest are the ones that go');

  const restored = new OutputBuffer();
  restored.restoreTranscript({...buffer.transcript(),
    queueSummaries: [{...sample(9), version: 9} as unknown as QueueSummary,
      {...sample(10), entries: [{outcome: 'yolo', label: 'npm'} as unknown as QueueSummary['entries'][number]]}]});
  assert.deepEqual(restored.queueSummaries, [], 'a journal entry that does not validate is dropped, never guessed');
});

test('a stored transcript round-trips its summaries; malformed artifacts are refused by name', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-queue-summary-'));
  try {
    const store = new TranscriptStore(directory);
    const buffer = new OutputBuffer();
    buffer.setQueueSummaries([sample(1), sample(2)]);
    const archived = await store.archive({startCwd: directory, finalCwd: directory, transcript: buffer.transcript()});
    const loaded = await store.load(archived.id);
    assert.deepEqual(loaded.transcript.queueSummaries, [sample(1), sample(2)], 'the archive carries exactly the typed artifacts');

    // Every refusal reuses the same valid envelope: one field changes, nothing else.
    const envelope = JSON.parse(await readFile(join(directory, `${archived.id}.json`), 'utf8')) as Record<string, unknown>;
    const attempt = (transcript: unknown): Promise<unknown> => {
      const name = `attempt-${Math.random().toString(36).slice(2, 8)}`;
      return writeFile(join(directory, `${name}.json`), JSON.stringify({...envelope, id: name, schemaVersion: TRANSCRIPT_SCHEMA_VERSION, transcript}))
        .then(() => store.load(name));
    };
    const base = buffer.transcript();
    await assert.rejects(attempt({...base, queueSummaries: [{...sample(1), version: 2}]}), /invalid transcript archive/u);
    await assert.rejects(attempt({...base, queueSummaries: {not: 'a list'}}), /invalid transcript archive/u);
    await assert.rejects(attempt({...base, queueSummaries: [sample(1), sample(1)]}), /invalid transcript archive/u);
    await assert.rejects(attempt({...base, queueSummaries: Array.from({length: SUMMARY_LIMIT + 1}, (_, index) => sample(index + 1))}),
      /invalid transcript archive/u);
    await assert.rejects(attempt({...base, queueSummaries: [{...sample(1), counts: {succeeded: -1}}]}), /invalid transcript archive/u);
    await assert.rejects(attempt({...base, queueSummaries: [{...sample(1), entries: [{outcome: 'failed', label: 'npm', exitCode: 1.5}]}]}),
      /invalid transcript archive/u);
    // A label that looks like a secret fails the archive: the journal never carries one, even if it was tampered with.
    await assert.rejects(attempt({...base, queueSummaries: [{...sample(1), entries: [{outcome: 'succeeded', label: 'token=abc123'}]}]}),
      /invalid transcript archive/u);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('restoring an archived presentation shows its own summaries and never restores work', async () => {
  const config = await mkdtemp(join(tmpdir(), 'nmsh-queue-restore-'));
  const previousConfig = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = config;
  const app = new TerminalApp();
  try {
    Object.defineProperty(app['renderer'], 'render', {value: () => {}});
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 30}), configurable: true});
    app['startupPending'] = false;
    const dispatcher = app['session']['dispatcher'];
    const submitted: string[] = [];
    dispatcher['shell'] = {isReady: true, adapter: {id: 'zsh'}, submit(command: string) { submitted.push(command); }};
    const chain = (steps: Array<{text: string; code: number}>): void => {
      dispatcher.request({op: 'resume'});
      dispatcher.onExec(steps[0]!.text);
      for (const [index, step] of steps.slice(1).entries()) {
        dispatcher.request({op: 'add', text: step.text});
        dispatcher.onPrompt(steps[index]!.code);
        dispatcher.onExec(step.text);
      }
      dispatcher.onPrompt(steps.at(-1)!.code);
    };

    chain([{text: 'npm run build', code: 0}, {text: 'npm run lint', code: 0}]);
    dispatcher.request({op: 'save-summary', chainId: 1});
    app['queueTransientUntil'] = 0;
    assert.equal(app['summaryChrome']()?.summary.id, 'chain-1');
    const archived = await app['transcriptStore'].archive({startCwd: process.cwd(), finalCwd: process.cwd(),
      transcript: app['output'].transcript()});

    submitted.length = 0;
    await app['restoreTranscriptById'](archived.id);
    assert.deepEqual(submitted, [], 'restoring a transcript never submits anything');
    assert.deepEqual(app['queueState'].entries, [], 'restoring a transcript never restores pending commands');
    assert.deepEqual(app['output'].transcript().queueSummaries?.map(summary => summary.id), ['chain-1'],
      'the restored presentation keeps its own artifacts, exactly once');
    assert.equal(app['summaryChrome']()?.summary.id, 'chain-1');

    // The live session keeps working while the archive is on screen, and its next save never leaks into the archive.
    chain([{text: 'git status', code: 0}, {text: 'git diff', code: 0}]);
    dispatcher.request({op: 'save-summary', chainId: 2});
    app['queueTransientUntil'] = 0;
    assert.deepEqual(app['queueState'].summaries?.map(summary => summary.id), ['chain-1', 'chain-2'],
      'the owner keeps its own artifacts');
    assert.deepEqual(app['output'].transcript().queueSummaries?.map(summary => summary.id), ['chain-1'],
      'a restored archive never adopts another session’s artifacts');
    assert.equal(app['summaryChrome']()?.summary.id, 'chain-1', 'the archive shows what it carried');
  } finally {
    app['stop'](0);
    app['session'].kill();
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousConfig;
    await rm(config, {recursive: true, force: true});
  }
});
