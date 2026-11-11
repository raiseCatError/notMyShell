import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandQueue} from '../src/session/CommandQueue.js';
import {QueueDispatcher} from '../src/session/QueueDispatcher.js';

/**
 * #514 race, owner side: an Enter pressed before NMSh could see that the command reads (an echoing terminal is no
 * evidence) can reach the queue as a command, with no approval in Queue Mode. Once the command is reported asking for
 * input, everything queued while it ran waits for approval. The owner decides it beside the prompt, so a reader that
 * ends right after it was seen can never let the next dispatch run its reply.
 */

function fixture() {
  let now = 0;
  const submitted: string[] = [];
  const queue = new CommandQueue(() => now);
  const dispatcher = new QueueDispatcher({isReady: true, adapter: {id: 'zsh'}, submit: (text: string) => { submitted.push(text); }} as never, queue,
    {now: () => now, monotonic: () => now});
  return {queue, dispatcher, submitted, at: (ms: number) => { now = ms; }};
}

test('a line queued before the reader was seen never runs after it, even when the prompt follows at once', () => {
  const {queue, dispatcher, submitted, at} = fixture();
  at(50); dispatcher.request({op: 'add', text: 'echo EARLY'});
  at(100); dispatcher.onExec('read -r reply; printf %s "$reply"');
  at(150); dispatcher.request({op: 'add', text: 'hello'});
  at(200); assert.equal(dispatcher.onInputRequest({since: 100, mode: 'line'}, 'read'), 1);
  // Ctrl+Q while the question is shown is a command for after it: left as queued.
  at(250); dispatcher.request({op: 'add', text: 'echo QUEUED-WHILE-SHOWN'});
  assert.equal(dispatcher.onInputRequest({since: 100, mode: 'line'}, 'read'), 0, 'each request is checked once');
  // The reader gives up right after it was seen (a timed read): the prompt arrives before any frontend could act.
  at(260); dispatcher.onPrompt(0);
  assert.deepEqual(submitted, ['echo EARLY'], 'an entry queued before the command is no reply and runs');
  at(270); dispatcher.onExec('echo EARLY');
  at(280); dispatcher.onPrompt(0);
  assert.deepEqual(submitted, ['echo EARLY'], 'the possible reply waits; nothing behind it overtakes it');
  assert.deepEqual(queue.state.entries.map(entry => [entry.text, entry.condition]), [['hello', 'approve'], ['echo QUEUED-WHILE-SHOWN', undefined]]);
  assert.equal(queue.state.entries[0]!.typedWhile, undefined, 'a visible line stays shown as typed');
});

test('hidden input also hides what was queued; approved entries and the time before submission are respected', () => {
  const {queue, dispatcher, submitted, at} = fixture();
  dispatcher.onPrompt(0);
  at(90); dispatcher.onSubmission();
  // Typed between Enter and the shell's exec marker: still this command's.
  at(95); dispatcher.request({op: 'add', text: 'hunter2'});
  at(100); dispatcher.onExec('sudo true');
  at(120); dispatcher.request({op: 'add', text: 'make', condition: 'approve'});
  dispatcher.request({op: 'approve', id: queue.state.entries[1]!.id});
  at(200); assert.equal(dispatcher.onInputRequest({since: 150, mode: 'hidden'}, 'sudo'), 1);
  const [secret, approved] = queue.state.entries;
  assert.equal(secret!.condition, 'approve');
  assert.equal(secret!.typedWhile, 'sudo', 'shown only as where it came from');
  assert.equal(approved!.approved, true, 'an approval the person gave stays');
  at(300); dispatcher.onPrompt(0);
  assert.deepEqual(submitted, []);
  // A new command starts fresh: its own request checks only what was queued since it was submitted.
  assert.equal(dispatcher.onInputRequest({since: 150, mode: 'line'}, 'sudo'), 0, 'nothing runs: no request applies at the prompt');
});
