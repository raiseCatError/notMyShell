import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandQueue, type QueueState} from '../src/session/CommandQueue.js';
import {QueueDispatcher, type QueueShell} from '../src/session/QueueDispatcher.js';
import {queueOpFrom, queueStateFrom} from '../src/session/SessionProtocol.js';
import {conditionNote, nextCondition, queuePanelKey, renderQueuePanel} from '../src/queue/QueuePanel.js';
import {queueRow} from '../src/status/queueStatus.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

function harness() {
  const target: QueueShell & {submitted: string[]} = {submitted: [], isReady: true, submit(command: string) { this.submitted.push(command); }};
  const dispatcher = new QueueDispatcher(target);
  const finish = (exitCode = 0) => { dispatcher.onExec(target.submitted.at(-1) ?? 'manual'); dispatcher.onPrompt(exitCode); };
  return {target, dispatcher, finish};
}
const ids = (state: QueueState) => state.entries.map(entry => entry.id);

test('the default is unchanged: a failure pauses before the next entry, which waits for resume', () => {
  const {target, dispatcher, finish} = harness();
  dispatcher.onExec('make');
  dispatcher.request({op: 'add', text: 'echo after'});
  dispatcher.onPrompt(2);
  assert.deepEqual(target.submitted, []);
  assert.equal(dispatcher.state.paused?.reason, 'failed');
  dispatcher.request({op: 'resume'});
  assert.deepEqual(target.submitted, ['echo after']);
  finish();
});

test('"always" runs after a failure, but never after an interrupt', () => {
  const failed = harness();
  failed.dispatcher.onExec('make');
  failed.dispatcher.request({op: 'add', text: 'echo cleanup', condition: 'always'});
  failed.dispatcher.onPrompt(2);
  assert.deepEqual(failed.target.submitted, ['echo cleanup']);
  assert.equal(failed.dispatcher.state.paused, undefined);

  const stopped = harness();
  stopped.dispatcher.onExec('sleep 99');
  stopped.dispatcher.request({op: 'add', text: 'echo cleanup', condition: 'always'});
  stopped.dispatcher.onInterrupt();
  stopped.dispatcher.onPrompt(130);
  assert.deepEqual(stopped.target.submitted, [], 'Ctrl+C stops the queue whatever follows');
  assert.equal(stopped.dispatcher.state.paused?.reason, 'interrupted');

  // An "always" entry further down does not skip the ones before it.
  const behind = harness();
  behind.dispatcher.onExec('make');
  behind.dispatcher.request({op: 'add', text: 'echo plain'});
  behind.dispatcher.request({op: 'add', text: 'echo cleanup', condition: 'always'});
  behind.dispatcher.onPrompt(2);
  assert.deepEqual(behind.target.submitted, []);
  assert.equal(behind.dispatcher.state.paused?.reason, 'failed');
});

test('an entry that asks first never runs until that exact entry is approved, and is approved once', () => {
  const {target, dispatcher, finish} = harness();
  dispatcher.onPrompt(0);
  dispatcher.request({op: 'add', text: 'echo one'});
  finish();
  dispatcher.request({op: 'add', text: 'echo risky', condition: 'approve'});
  dispatcher.request({op: 'add', text: 'echo last'});
  assert.deepEqual(target.submitted, ['echo one'], 'waits at the entry that asks first, and nothing behind it jumps ahead');
  const [asking] = dispatcher.state.entries;
  assert.equal(dispatcher.queue.awaitingApproval?.id, asking!.id);
  // Not the wrong entry, not an entry without the condition.
  dispatcher.request({op: 'approve', id: dispatcher.state.entries[1]!.id});
  assert.deepEqual(target.submitted, ['echo one']);
  dispatcher.request({op: 'approve', id: asking!.id});
  assert.deepEqual(target.submitted, ['echo one', 'echo risky']);
  finish();
  assert.deepEqual(target.submitted, ['echo one', 'echo risky', 'echo last'], 'approval does not carry over to the next entry');
});

test('editing an approved entry, or changing its condition, withdraws the approval', () => {
  const queue = new CommandQueue();
  queue.apply({op: 'add', text: 'rm -r build', condition: 'approve'});
  const id = queue.state.entries[0]!.id;
  assert.equal(queue.apply({op: 'approve', id}), undefined);
  assert.equal(queue.take()?.text, 'rm -r build');

  queue.apply({op: 'add', text: 'rm -r build', condition: 'approve'});
  const second = queue.state.entries[0]!.id;
  queue.apply({op: 'approve', id: second});
  queue.apply({op: 'edit', id: second, text: 'rm -rf /'});
  assert.equal(queue.take(), undefined, 'the approval was for the text that was approved');
  queue.apply({op: 'approve', id: second});
  queue.apply({op: 'edit', id: second, text: 'rm -rf /'});
  assert.equal(queue.state.entries[0]!.approved, true, 'saving the same text changes nothing');
  queue.apply({op: 'condition', id: second});
  queue.apply({op: 'condition', id: second, condition: 'approve'});
  assert.equal(queue.take(), undefined, 'a condition change starts again');
  assert.match(queue.apply({op: 'approve', id: 999}) ?? '', /already ran/u);
  queue.apply({op: 'condition', id: second});
  assert.match(queue.apply({op: 'approve', id: second}) ?? '', /does not ask/u);
});

test('the protocol carries conditions and approval, and drops what it cannot understand', () => {
  assert.deepEqual(queueOpFrom('{"op":"add","text":"ls","condition":"approve"}'), {op: 'add', text: 'ls', condition: 'approve'});
  assert.deepEqual(queueOpFrom('{"op":"add","text":"ls"}'), {op: 'add', text: 'ls'});
  assert.equal(queueOpFrom('{"op":"add","text":"ls","condition":"yolo"}'), undefined);
  assert.deepEqual(queueOpFrom('{"op":"condition","id":3,"condition":"always"}'), {op: 'condition', id: 3, condition: 'always'});
  assert.deepEqual(queueOpFrom('{"op":"condition","id":3}'), {op: 'condition', id: 3});
  assert.equal(queueOpFrom('{"op":"condition","id":3,"condition":7}'), undefined);
  assert.deepEqual(queueOpFrom('{"op":"approve","id":3}'), {op: 'approve', id: 3});
  assert.equal(queueOpFrom('{"op":"approve"}'), undefined);
  const state = queueStateFrom(JSON.stringify({entries: [{id: 1, text: 'a', addedAt: 1, condition: 'approve', approved: true}, {id: 2, text: 'b', addedAt: 2, condition: 'always', approved: true}, {id: 3, text: 'c', addedAt: 3, condition: 'bogus', approved: true}]}))!;
  assert.deepEqual(state.entries.map(entry => [entry.condition, entry.approved]), [['approve', true], ['always', undefined], [undefined, undefined]]);
});

test('the panel offers "when it runs" and "approve" only where the service supports them', () => {
  const state: QueueState = {entries: [{id: 1, text: 'one', addedAt: 1}, {id: 2, text: 'two', addedAt: 2, condition: 'approve'}]};
  const panel = {selected: 0};
  assert.equal(queuePanelKey(panel, {kind: 'text', value: 'w'}, state, false), undefined, 'an older service is never sent a condition');
  assert.deepEqual(queuePanelKey(panel, {kind: 'text', value: 'w'}, state, true), {kind: 'change', change: {op: 'condition', id: 1, condition: 'always'}});
  assert.equal(nextCondition('always'), 'approve');
  assert.equal(nextCondition('approve'), undefined);
  assert.equal(queuePanelKey(panel, {kind: 'text', value: 'a'}, state, true), undefined, 'only an entry that asks first can be approved');
  panel.selected = 1;
  assert.deepEqual(queuePanelKey(panel, {kind: 'text', value: 'a'}, state, true), {kind: 'change', change: {op: 'approve', id: 2}});
  assert.equal(conditionNote(state.entries[1]!), 'asks first');
  for (const columns of [30, 60, 100]) {
    const rows = renderQueuePanel(panel, state, undefined, columns, 24, true);
    for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
  }
  assert.match(stripAnsi(renderQueuePanel(panel, state, undefined, 100, 24, true).join('\n')), /asks first/u);
});

test('the status line says the queue waits for the person', () => {
  const state: QueueState = {entries: [{id: 2, text: 'rm -r build', addedAt: 2, condition: 'approve'}]};
  assert.match(stripAnsi(queueRow(state, 100)!), /next needs your approval: rm -r build · \/queue/u);
  for (const columns of [20, 40, 60]) assert.ok(displayWidth(stripAnsi(queueRow(state, columns)!)) <= columns);
  assert.doesNotMatch(stripAnsi(queueRow({entries: [{...state.entries[0]!, approved: true}]}, 100)!), /approval/u);
  assert.deepEqual(ids(state), [2]);
});
