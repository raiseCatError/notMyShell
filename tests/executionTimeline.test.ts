import test from 'node:test';
import assert from 'node:assert/strict';
import {QueueDispatcher, type QueueShell} from '../src/session/QueueDispatcher.js';
import {CommandQueue} from '../src/session/CommandQueue.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {queuePanelKey} from '../src/queue/QueuePanel.js';
import {queueOpFrom, queueStateFrom} from '../src/session/SessionProtocol.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';

function harness() {
  let at = 1000;
  const submitted: string[] = [];
  const shell: QueueShell = {isReady: true, adapter: {id: 'zsh'}, submit: text => submitted.push(text)};
  const dispatcher = new QueueDispatcher(shell, new CommandQueue(() => at), {now: () => at, monotonic: () => at});
  return {dispatcher, submitted, tick: (ms: number) => { at += ms; }};
}

test('timeline adopts a manual predecessor and promotes queued results using observed times', () => {
  const {dispatcher: d, submitted, tick} = harness();
  d.onExec('build'); tick(200); d.request({op: 'add', text: 'test'});
  assert.equal(d.state.timeline?.executions[0]?.source, 'manual');
  tick(800); d.onPrompt(0);
  assert.equal(d.state.timeline?.executions[0]?.durationMs, 1000);
  assert.deepEqual(submitted, ['test']);
  tick(20); d.onExec('test'); tick(40); d.onPrompt(2);
  assert.deepEqual(d.state.timeline?.counts, {succeeded: 1, failed: 1, interrupted: 0, skipped: 0, unobserved: 0});
  assert.equal(d.state.timeline?.executions[1]?.exitCode, 2);
  assert.equal(d.state.timeline?.status, 'finished');
  assert.equal(d.state.timeline?.elapsedMs, 1060);
});

test('independent foreground commands while paused never join or resume the chain or replace its pause', () => {
  const {dispatcher: d, submitted, tick} = harness();
  d.onExec('original'); d.request({op: 'add', text: 'queued'}); d.request({op: 'pause'});
  tick(10); d.onPrompt(0);
  const before = d.state.timeline;
  const cause = d.state.paused;
  tick(20); d.onExec('unrelated'); tick(30); d.onPrompt(7);
  assert.deepEqual(d.state.timeline?.executions, before?.executions, 'independent work adds no chain execution');
  assert.deepEqual(d.state.timeline?.counts, before?.counts, 'aggregate outcome counts are unchanged');
  assert.deepEqual(d.state.paused, cause);
  assert.deepEqual(submitted, []);
  d.request({op: 'resume', expectedRevision: d.state.revision});
  assert.deepEqual(submitted, ['queued']);
});

test('a queue created while already paused does not adopt an independent foreground command', () => {
  const {dispatcher: d} = harness();
  d.request({op: 'pause'}); d.onExec('independent'); d.request({op: 'add', text: 'waiting'}); d.onPrompt(3);
  assert.equal(d.state.timeline?.executions.length, 0);
  assert.equal(d.state.paused?.reason, 'user');
});

test('clear marks pending work skipped and does not terminate the active execution', () => {
  const {dispatcher: d, tick} = harness();
  d.onExec('running'); d.request({op: 'add', text: 'discarded'});
  d.request({op: 'clear', expectedRevision: d.state.revision});
  assert.equal(d.state.timeline?.counts.skipped, 1);
  assert.equal(d.state.timeline?.executions[0]?.status, 'running');
  tick(100); d.onPrompt(0);
  assert.equal(d.state.timeline?.status, 'cleared');
  assert.equal(d.state.timeline?.counts.succeeded, 1);
});

test('Continue is captured for a new chain; interrupts still hold and approvals still require exact review', () => {
  const {dispatcher: d, submitted} = harness();
  d.request({op: 'failure-policy', policy: 'continue'});
  d.onExec('first'); d.request({op: 'add', text: 'second'});
  d.request({op: 'failure-policy', policy: 'pause'});
  d.onPrompt(3); assert.deepEqual(submitted, ['second']);
  d.onExec('second'); d.request({op: 'add', text: 'third', condition: 'approve'});
  d.onInterrupt(); d.onPrompt(0);
  assert.equal(d.state.paused?.reason, 'interrupted');
  d.request({op: 'resume'}); assert.equal(submitted.length, 1);
  const id = d.state.entries[0]!.id;
  d.request({op: 'approve', id, expectedRevision: d.state.revision});
  assert.equal(submitted.length, 2);
});

test('owner refuses stale clear/resume/approval after an edit, including through transport', () => {
  const {dispatcher: d, submitted} = harness();
  d.request({op: 'pause'}); d.onPrompt(0); d.request({op: 'add', text: 'before'});
  const revision = d.state.revision!;
  d.request({op: 'edit', id: d.state.entries[0]!.id, text: 'after'});
  for (const op of ['clear', 'resume'] as const) {
    d.request(queueOpFrom(JSON.stringify({op, expectedRevision: revision}))!);
    assert.equal(d.state.entries[0]?.text, 'after');
    assert.equal(d.state.paused?.reason, 'user');
  }
  assert.deepEqual(submitted, []);
});

test('comment-only queued submission gets no invented execution exit or duration', () => {
  const {dispatcher: d} = harness();
  d.onPrompt(0); d.request({op: 'add', text: '# note'}); d.onPrompt(0);
  assert.equal(d.state.timeline?.counts.unobserved, 1);
  assert.equal(d.state.timeline?.executions.length, 0);
  assert.equal(d.state.timeline?.status, 'finished');
});

test('timeline transport roundtrips bounded facts and refuses malformed metadata', () => {
  const {dispatcher: d} = harness();
  d.onExec('first'); d.request({op: 'add', text: 'second'}); d.onPrompt(1);
  assert.deepEqual(queueStateFrom(JSON.stringify(d.state)), d.state);
  assert.equal(queueStateFrom(JSON.stringify({...d.state, timeline: {...d.state.timeline, counts: {succeeded: -1}}})), undefined);
  assert.equal(queueOpFrom('{"op":"resume","expectedRevision":-1}'), undefined);
});

test('queue aliases use the canonical parser, including all supported subcommands', () => {
  for (const suffix of ['', ' pause', ' resume', ' clear']) assert.deepEqual(parseSlashCommand('/q' + suffix), parseSlashCommand('/queue' + suffix));
  for (const [alias, canonical] of [['/qp','/queue pause'], ['/pause','/queue pause'], ['/qr','/queue resume'], ['/qc','/queue clear']]) assert.deepEqual(parseSlashCommand(alias!), parseSlashCommand(canonical!));
});

test('failure policy configuration defaults to Pause and rejects unknown settings', () => {
  assert.equal(normalizePromptConfiguration({}).queueFailurePolicy, 'pause');
  assert.equal(normalizePromptConfiguration({queueFailurePolicy: 'continue'}).queueFailurePolicy, 'continue');
  assert.equal(normalizePromptConfiguration({queueFailurePolicy: 'unsafe'}).queueFailurePolicy, 'pause');
});

test('shell exit interrupts an observed run without inventing exit 130', () => {
  const {dispatcher: d} = harness();
  d.onExec('active'); d.request({op: 'add', text: 'pending'}); d.onShellExit();
  assert.equal(d.state.timeline?.status, 'shell-ended');
  assert.equal(d.state.timeline?.executions[0]?.status, 'interrupted');
  assert.equal(d.state.timeline?.executions[0]?.exitCode, undefined);
});

test('an independent foreground start invalidates a transported idle resume review', () => {
  const {dispatcher: d} = harness();
  d.request({op: 'pause'}); d.onPrompt(0); d.request({op: 'add', text: 'queued'});
  const revision = d.state.revision!;
  d.onExec('independent');
  d.request({op: 'resume', expectedRevision: revision});
  assert.equal(d.state.paused?.reason, 'user');
});

test('a dispatched command remains identified as starting until an authoritative exec arrives', () => {
  const {dispatcher: d} = harness();
  d.onPrompt(0); d.request({op: 'add', text: 'starting'});
  assert.equal(d.state.dispatching?.text, 'starting');
  assert.equal(d.state.timeline?.executions.length, 0, 'no invented execution start');
  assert.deepEqual(queueStateFrom(JSON.stringify(d.state)), d.state);
  d.onExec('starting');
  assert.equal(d.state.dispatching, undefined);
  assert.equal(d.state.timeline?.executions[0]?.text, 'starting');
});

test('manager approval cannot authorize an entry edited after its displayed review', () => {
  const {dispatcher: d, submitted} = harness();
  d.onPrompt(0); d.request({op: 'add', text: 'reviewed', condition: 'approve'});
  const action = queuePanelKey({selected: 0}, {kind: 'text', value: 'a'}, d.state, true, true);
  assert.equal(action?.kind, 'change');
  d.request({op: 'edit', id: d.state.entries[0]!.id, text: 'never reviewed'});
  if (action?.kind === 'change') d.request(queueOpFrom(JSON.stringify(action.change))!);
  assert.deepEqual(submitted, [], 'stale approval never submits changed text');
});


test('owner elapsed time ignores epoch clock corrections including while paused', () => {
  let epoch = 1000, mono = 100;
  const d = new QueueDispatcher({isReady: true, adapter: {id: 'zsh'}, submit() {}}, new CommandQueue(() => epoch), {now: () => epoch, monotonic: () => mono});
  d.onExec('build'); d.request({op: 'add', text: 'test'}); d.request({op: 'pause'});
  epoch += 3600000;
  assert.equal(d.state.timeline?.elapsedMs, 0);
  mono += 250;
  assert.equal(d.state.timeline?.elapsedMs, 250, 'paused wall duration uses monotonic time');
});


test('shell exit closes starting submission as unobserved and skips only never-submitted entries', () => {
  const {dispatcher: d} = harness();
  d.onPrompt(0); d.request({op: 'add', text: 'submitted'}); d.request({op: 'add', text: 'never submitted'});
  let dropped: readonly import('../src/session/CommandQueue.js').QueueEntry[] = [];
  d.on('state', (_state, event) => { if (event.dropped) dropped = event.dropped; });
  d.onShellExit();
  assert.equal(d.state.dispatching, undefined);
  assert.equal(d.state.timeline?.status, 'shell-ended');
  assert.equal(d.state.timeline?.counts.unobserved, 1);
  assert.equal(d.state.timeline?.counts.skipped, 1);
  assert.deepEqual(dropped.map(entry => entry.text), ['never submitted']);
  assert.deepEqual(d.state.timeline?.executions, [], 'no invented execution, duration or exit code');
  d.onShellExit();
  assert.equal(d.state.timeline?.counts.unobserved, 1, 'terminal events cannot count twice');
  assert.equal(d.state.timeline?.counts.skipped, 1);
});
