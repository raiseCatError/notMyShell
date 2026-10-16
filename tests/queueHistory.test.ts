import test from 'node:test';
import assert from 'node:assert/strict';
import {QueueDispatcher, type QueueShell} from '../src/session/QueueDispatcher.js';
import {CommandQueue} from '../src/session/CommandQueue.js';
import {queueOpFrom, queueStateFrom, queueStateMessage} from '../src/session/SessionProtocol.js';
import {ExecutionTimeline, TIMELINE_HISTORY_BYTES_LIMIT, TIMELINE_HISTORY_LIMIT, TIMELINE_RESULTS_LIMIT} from '../src/session/ExecutionTimeline.js';

/** One observed-chain fixture: no shell is started, every fact is the owner's own observation. */
function harness(policy: 'pause' | 'continue' = 'pause') {
  let at = 1000;
  const submitted: string[] = [];
  const shell: QueueShell = {isReady: true, adapter: {id: 'zsh'}, submit: text => submitted.push(text)};
  const dispatcher = new QueueDispatcher(shell, new CommandQueue(() => at), {now: () => at, monotonic: () => at});
  dispatcher.request({op: 'failure-policy', policy});
  return {dispatcher, submitted, tick: (ms: number) => { at += ms; }};
}

/** One command in a chain: queued, awaited, submitted by the owner, then completed with an observed exit. */
function step(d: QueueDispatcher, tick: (ms: number) => void, command: string, exitCode: number, durationMs = 100): void {
  d.request({op: 'add', text: command});
  tick(1);
  d.onExec(command);
  tick(durationMs);
  d.onPrompt(exitCode);
}

test('a settled chain is archived exactly once, in chronological order', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  step(d, tick, 'npm run build', 0);
  assert.equal(d.state.history?.length, 1, 'the settled chain is reviewable');
  assert.deepEqual(d.state.history?.map(record => record.id), [1]);
  const archived = d.state.history![0]!;
  assert.equal(archived.status, 'finished');
  assert.equal(archived.failurePolicy, 'pause');
  assert.equal(archived.elapsedMs, 100);
  assert.deepEqual(archived.counts, {succeeded: 1, failed: 0, interrupted: 0, skipped: 0, unobserved: 0});
  assert.equal(archived.results, 1, 'the detailed results retained for the chain');
  assert.equal(archived.resultsOmitted, 0);
  assert.equal(d.state.timeline?.status, 'finished', 'the transient view keeps the chain it showed');
  d.request({op: 'add', text: 'later'});
  assert.deepEqual(d.state.history?.map(record => record.id), [1], 'a later state change never archives the chain twice');
});

test('history keeps the recent ten chains, oldest first, and never archives the active one', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  for (let chain = 1; chain <= TIMELINE_HISTORY_LIMIT + 2; chain += 1) step(d, tick, `command-${chain}`, 0);
  const ids = d.state.history?.map(record => record.id) ?? [];
  assert.deepEqual(ids, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'the newest ten, oldest first');
  assert.equal(TIMELINE_HISTORY_LIMIT, 10);
  assert.equal(TIMELINE_HISTORY_BYTES_LIMIT, 2 * 1024 * 1024);
  const active = harness();
  active.dispatcher.onPrompt(0);
  active.dispatcher.request({op: 'add', text: 'still running'});
  active.dispatcher.onExec('still running');
  assert.equal(active.dispatcher.state.history, undefined, 'the running chain is never archived');
});

test('a chain cleared while a command ran finalizes as cleared and skips only what never ran', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  d.request({op: 'add', text: 'running'});
  d.onExec('running');
  d.request({op: 'add', text: 'discarded'});
  d.request({op: 'clear'});
  tick(200);
  d.onPrompt(0);
  const archived = d.state.history!.at(-1)!;
  assert.equal(archived.status, 'cleared');
  assert.equal(archived.counts.skipped, 1);
  assert.equal(archived.counts.succeeded, 1, 'the running command is not relabelled by the clear');
  d.request({op: 'history-detail', chainId: archived.id});
  assert.equal(d.state.historyDetail?.executions[0]?.status, 'succeeded');
});

test('a chain ended by the shell archives its interruption without inventing an exit code', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  d.request({op: 'add', text: 'long'});
  d.onExec('long');
  tick(120);
  d.onShellExit();
  const archived = d.state.history!.at(-1)!;
  assert.equal(archived.status, 'shell-ended');
  assert.equal(archived.counts.interrupted, 1);
  d.request({op: 'history-detail', chainId: archived.id});
  assert.deepEqual(d.state.historyDetail?.executions.map(entry => entry.exitCode), [undefined]);
  assert.equal(d.state.historyDetail?.executions[0]?.durationMs, 120, 'the observed interval stays');
});

test('a comment-only submission is archived as unobserved without an invented duration or exit', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  d.request({op: 'add', text: '# nothing to run'});
  tick(30);
  d.onPrompt(0);
  const archived = d.state.history!.at(-1)!;
  assert.equal(archived.counts.unobserved, 1);
  assert.equal(archived.results, 0);
  d.request({op: 'history-detail', chainId: archived.id});
  assert.deepEqual(d.state.historyDetail?.executions, []);
  assert.equal(archived.startedAt, undefined, 'no execution start was observed');
  assert.equal(archived.elapsedMs, 0);
});

test('a grouped submission stays one observable result and never gains sub-results', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  step(d, tick, 'one\ntwo\nthree', 0);
  const archived = d.state.history!.at(-1)!;
  assert.equal(archived.results, 1);
  d.request({op: 'history-detail', chainId: archived.id});
  assert.equal(d.state.historyDetail?.executions.length, 1);
  assert.equal(d.state.historyDetail?.executions[0]?.text, 'one\ntwo\nthree');
  assert.equal(archived.counts.succeeded, 1);
});

test('retained review metadata honours an injected byte bound while keeping the newest chains', () => {
  let at = 1000;
  const timeline = new ExecutionTimeline({now: () => at, monotonic: () => at}, {chains: 10, bytes: 900, results: TIMELINE_RESULTS_LIMIT});
  for (let chain = 1; chain <= 4; chain += 1) {
    timeline.open('pause');
    timeline.begin(`command-${chain}-${'x'.repeat(120)}`, at, at);
    at += 5;
    timeline.complete(0, false, at);
    timeline.settle();
  }
  const records = timeline.history;
  assert.ok(records.length >= 1 && records.length < 4, `the byte bound evicted older chains (${records.length})`);
  assert.equal(records.at(-1)?.id, 4, 'the newest chain always survives');
  assert.ok(JSON.stringify(records).length <= 900 + 200, 'the retained metadata stays near its bound');
});

test('per-chain detail is bounded with truthful rollups, and a settled chain never advances', () => {
  let at = 1000;
  const timeline = new ExecutionTimeline({now: () => at, monotonic: () => at}, {chains: 10, bytes: TIMELINE_HISTORY_BYTES_LIMIT, results: 4});
  timeline.open('continue');
  for (let step_ = 0; step_ < 6; step_ += 1) { timeline.begin(`step-${step_}`, at, at); at += 10; timeline.complete(step_ === 0 ? 1 : 0, false, at); }
  timeline.settle();
  const [record] = timeline.history;
  assert.equal(record!.results, 4, 'at most the configured detailed results are retained');
  assert.equal(record!.resultsOmitted, 2, 'what left the detail is counted, not hidden');
  assert.deepEqual(record!.counts, {succeeded: 5, failed: 1, interrupted: 0, skipped: 0, unobserved: 0});
  const detail = timeline.record(record!.id)!;
  assert.deepEqual(detail.executions.map(entry => entry.text), ['step-2', 'step-3', 'step-4', 'step-5']);
  const settled = record!.elapsedMs;
  at += 5000;
  assert.equal(timeline.history[0]!.elapsedMs, settled, 'a settled chain keeps its observed elapsed time');
  assert.equal(timeline.record(99), undefined, 'an unknown chain has no detail');
  assert.equal(TIMELINE_RESULTS_LIMIT, 500, 'the approved per-chain bound');
});

test('the owner includes one chain detail only when it is asked for', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  step(d, tick, 'first', 0);
  step(d, tick, 'second', 0);
  assert.equal(d.state.historyDetail, undefined, 'the compact projection is the default');
  const [older] = d.state.history!.map(record => record.id);
  d.request({op: 'history-detail', chainId: older});
  assert.equal(d.state.historyDetail?.id, older);
  assert.deepEqual(d.state.historyDetail?.executions.map(entry => entry.text), ['first']);
  d.request({op: 'history-detail'});
  assert.equal(d.state.historyDetail, undefined);
  d.request({op: 'history-detail', chainId: 99});
  assert.equal(d.state.historyDetail, undefined, 'an evicted or unknown chain simply has no detail');
});

test('a summary is saved exactly once by chain identity and never becomes shell output', () => {
  const {dispatcher: d, submitted, tick} = harness();
  d.onPrompt(0);
  step(d, tick, 'git status', 0);
  const chainId = d.state.timeline!.id;
  d.request({op: 'save-summary', chainId});
  const first = d.state.summaries;
  assert.equal(first?.length, 1);
  assert.equal(first![0]!.chainId, chainId);
  assert.equal(first![0]!.origin, 'automatic');
  assert.equal(first![0]!.id, `chain-${chainId}`, 'the identity is stable and chain-scoped');
  d.request({op: 'save-summary', chainId});
  assert.deepEqual(d.state.summaries, first, 'saving again stores nothing new');
  assert.deepEqual(d.state.entries, [], 'a summary never becomes a queued command');
  assert.equal(submitted.length, 1, 'nothing is submitted again');
  assert.deepEqual(queueStateFrom(JSON.stringify(d.state))?.summaries, first);
});

test('an unknown or still-running chain is refused instead of summarized', () => {
  const {dispatcher: d} = harness();
  d.onPrompt(0);
  d.request({op: 'save-summary', chainId: 7});
  assert.equal(d.state.summaries, undefined);
  d.request({op: 'add', text: 'active'});
  d.onExec('active');
  d.request({op: 'save-summary', chainId: d.state.timeline!.id});
  assert.equal(d.state.summaries, undefined, 'a running chain has no final facts to review');
});

test('automatic saving is off by default and saves each settled chain once when on', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  step(d, tick, 'one', 0);
  assert.equal(d.state.summaries, undefined, 'automatic saving defaults off');
  d.request({op: 'summaries-auto', enabled: true});
  assert.equal(d.state.summaries?.length, 1, 'the chain that just settled is saved when the setting arrives');
  assert.equal(d.state.summaries![0]!.origin, 'automatic');
  step(d, tick, 'two', 0);
  assert.equal(d.state.summaries?.length, 2);
  assert.deepEqual(d.state.summaries?.map(summary => summary.chainId), [1, 2]);
  d.request({op: 'summaries-auto', enabled: false});
  step(d, tick, 'three', 0);
  assert.equal(d.state.summaries?.length, 2, 'off leaves later chains unsaved');
  d.request({op: 'save-summary', chainId: 3});
  assert.equal(d.state.summaries?.length, 3, 'an explicit save still works with automatic saving off');
});

test('a reviewed save stores the reviewed text only when the owner can verify it is already safe', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  step(d, tick, 'git status', 0);
  const chainId = d.state.timeline!.id;
  d.request({op: 'save-summary', chainId: 99, reviewed: {text: ['git status']}});
  assert.equal(d.state.summaries, undefined, 'a refused chain stores nothing');
  d.request({op: 'save-summary', chainId, reviewed: {text: ['git status --short']}});
  assert.equal(d.state.summaries?.[0]?.origin, 'reviewed');
  assert.equal(d.state.summaries?.[0]?.entries[0]?.text, 'git status --short');
  assert.equal(d.state.summaries?.[0]?.entries[0]?.label, 'git', 'the safe label stays beside the reviewed text');
  d.request({op: 'save-summary', chainId});
  assert.equal(d.state.summaries!.length, 1, 'one artifact per chain');
  assert.equal(d.state.summaries![0]!.entries[0]!.text, 'git status --short', 'a repeat save never rewrites the stored artifact');
  assert.equal(d.state.summaries![0]!.origin, 'reviewed');
});

test('the owner refuses reviewed text that is not demonstrably clean', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  step(d, tick, 'git status', 0);
  const chainId = d.state.timeline!.id;
  for (const text of ['git status --token=ghp_abcdefghijklmnopqrstuv', 'password: hunter2', 'line\u0007break']) {
    d.request({op: 'save-summary', chainId, reviewed: {text: [text]}});
    assert.equal(d.state.summaries, undefined, `refused: ${JSON.stringify(text)}`);
  }
});

test('raw arguments, output and unrecognized names never reach an automatic artifact', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  d.request({op: 'add', text: 'curl -H "Authorization: Bearer sk-live-abcdefghijklmnopqrst" https://example.test'});
  tick(1);
  d.onExec('curl -H "Authorization: Bearer sk-live-abcdefghijklmnopqrst" https://example.test');
  // Queued while the chain runs, so both commands are one observed chain.
  d.request({op: 'add', text: 'my-private-not-in-any-catalog --token=abc'});
  tick(100);
  d.onPrompt(0);
  tick(1);
  d.onExec('my-private-not-in-any-catalog --token=abc');
  tick(100);
  d.onPrompt(1);
  d.request({op: 'save-summary', chainId: d.state.timeline!.id});
  const summary = d.state.summaries![0]!;
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /sk-live-abcdefghijklmnopqrst|Authorization|my-private-not-in-any-catalog|--token|https:\/\//u);
  assert.deepEqual(summary.entries.map(entry => entry.label), ['curl', 'command 2']);
  assert.deepEqual(summary.entries.map(entry => entry.outcome), ['succeeded', 'failed']);
  assert.deepEqual(summary.entries.map(entry => entry.exitCode), [0, 1]);
  assert.deepEqual(summary.counts, {succeeded: 1, failed: 1, interrupted: 0, skipped: 0, unobserved: 0});
  assert.equal(summary.entries[0]?.durationMs, 100, 'observed durations are kept');
});

test('transported history and summaries fail closed when malformed', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  step(d, tick, 'git status', 0);
  d.request({op: 'save-summary', chainId: d.state.timeline!.id});
  const state = d.state;
  assert.deepEqual(queueStateFrom(JSON.stringify(state)), state);
  assert.equal(queueStateFrom(JSON.stringify({...state, history: [{id: 1}]})), undefined);
  assert.equal(queueStateFrom(JSON.stringify({...state, history: [...state.history!, {...state.history![0]!, resultsOmitted: -1}]})), undefined);
  assert.equal(queueStateFrom(JSON.stringify({...state, history: [...state.history!, {...state.history![0]!, id: state.history![0]!.id}]})), undefined, 'duplicate chain identities are refused');
  assert.equal(queueStateFrom(JSON.stringify({...state, summaries: [{id: 'x'}]})), undefined);
  assert.equal(queueStateFrom(JSON.stringify({...state, summaries: [{...state.summaries![0]!, entries: [{outcome: 'succeeded', label: 'git', exitCode: 'no'}]} ]})), undefined);
  assert.equal(queueStateFrom(JSON.stringify({...state, summaries: [{...state.summaries![0]!, entries: [{outcome: 'exploded', label: 'git'}]}]})), undefined);
  assert.equal(queueStateFrom(JSON.stringify({...state, historyDetail: {...state.timeline, executions: [{id: 1}]}})), undefined);
  assert.equal(queueOpFrom('{"op":"save-summary","chainId":-1}'), undefined);
  assert.equal(queueOpFrom('{"op":"summaries-auto","enabled":"yes"}'), undefined);
  assert.deepEqual(queueOpFrom('{"op":"history-detail"}'), {op: 'history-detail'});
  assert.deepEqual(queueOpFrom('{"op":"save-summary","chainId":2,"reviewed":{"text":["git status"]}}'), {op: 'save-summary', chainId: 2, reviewed: {text: ['git status']}});
  assert.equal(queueOpFrom('{"op":"save-summary","chainId":2,"reviewed":{"text":["ok",5]}}'), undefined);
});

test('a frontend that negotiated neither feature receives no new fields', () => {
  const {dispatcher: d, tick} = harness();
  d.onPrompt(0);
  step(d, tick, 'git status', 0);
  d.request({op: 'save-summary', chainId: d.state.timeline!.id});
  const state = d.state;
  const timelineOnly = JSON.parse(queueStateMessage(state, {}, {timeline: true, history: false}).state) as Record<string, unknown>;
  assert.deepEqual(Object.keys(timelineOnly).sort(), ['entries', 'revision', 'timeline']);
  const legacy = JSON.parse(queueStateMessage(state, {}, {timeline: false, history: false}).state) as Record<string, unknown>;
  assert.deepEqual(legacy, {entries: state.entries});
  assert.deepEqual(JSON.parse(queueStateMessage(state, {}).state), state, 'a current frontend receives the whole state');
});

test('history and summaries never restore pending work or dispatch anything', () => {
  const {dispatcher: d, submitted, tick} = harness();
  d.onPrompt(0);
  step(d, tick, 'one', 0);
  d.request({op: 'save-summary', chainId: d.state.timeline!.id});
  const before = submitted.length;
  d.request({op: 'history-detail', chainId: d.state.timeline!.id});
  d.request({op: 'save-summary', chainId: d.state.timeline!.id});
  d.request({op: 'summaries-auto', enabled: true});
  assert.equal(submitted.length, before);
  assert.deepEqual(d.state.entries, []);
});
