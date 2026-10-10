import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandQueue, QUEUE_LIMIT} from '../src/session/CommandQueue.js';
import {QueueDispatcher, type QueueEvent, type QueueShell} from '../src/session/QueueDispatcher.js';
import type {QueueState} from '../src/session/CommandQueue.js';

function shell(): QueueShell & {submitted: string[]} {
  return {submitted: [], isReady: true, submit(command: string) { this.submitted.push(command); }};
}

function harness() {
  const target = shell();
  const dispatcher = new QueueDispatcher(target);
  const events: Array<[QueueState, QueueEvent]> = [];
  dispatcher.on('state', (state, event) => events.push([state, event]));
  /** The shell runs what was submitted and finishes with `exitCode`. */
  const finish = (exitCode = 0) => { dispatcher.onExec(target.submitted.at(-1) ?? 'manual'); dispatcher.onPrompt(exitCode); };
  return {target, dispatcher, events, finish};
}

test('entries run one at a time, in order, each only after the previous command reached its prompt', () => {
  const {target, dispatcher, events, finish} = harness();
  dispatcher.onExec('shasum -a 256 big.iso');
  dispatcher.request({op: 'add', text: 'adb devices'});
  dispatcher.request({op: 'add', text: 'adb shell pm list packages'});
  assert.deepEqual(target.submitted, [], 'nothing runs while a command runs');
  dispatcher.onPrompt(0);
  assert.deepEqual(target.submitted, ['adb devices']);
  assert.equal(dispatcher.state.entries.length, 1);
  assert.equal(events.filter(([, event]) => event.dispatched).length, 1, 'announced once');
  dispatcher.request({op: 'add', text: 'echo third'});
  assert.deepEqual(target.submitted, ['adb devices'], 'a new entry waits for the running entry');
  finish();
  finish();
  assert.deepEqual(target.submitted, ['adb devices', 'adb shell pm list packages', 'echo third']);
  finish();
  assert.equal(dispatcher.state.entries.length, 0);
});

test('an idle shell runs a new entry at once; a prompt without a command (empty Enter) counts as idle, not as a finish', () => {
  const {target, dispatcher} = harness();
  dispatcher.onPrompt(0);
  dispatcher.request({op: 'add', text: 'ls'});
  assert.deepEqual(target.submitted, ['ls']);
  dispatcher.onPrompt(1);
  dispatcher.request({op: 'add', text: 'pwd'});
  assert.deepEqual(target.submitted, ['ls', 'pwd'], 'an empty Enter\'s status is not a failure');
});

test('a failure or an interrupt pauses the rest with the reason; nothing follows blindly; resume continues', () => {
  const {target, dispatcher, finish} = harness();
  dispatcher.onExec('make build');
  dispatcher.request({op: 'add', text: 'make deploy'});
  dispatcher.onPrompt(2);
  assert.deepEqual(target.submitted, []);
  assert.deepEqual(dispatcher.state.paused && {...dispatcher.state.paused, at: 0}, {reason: 'failed', at: 0, command: 'make build', exitCode: 2});
  dispatcher.request({op: 'resume'});
  assert.deepEqual(target.submitted, ['make deploy']);

  dispatcher.onExec('make deploy');
  dispatcher.request({op: 'add', text: 'notify done'});
  dispatcher.onInterrupt();
  dispatcher.onPrompt(0);
  assert.equal(dispatcher.state.paused?.reason, 'interrupted', 'Ctrl+C pauses even when the program exits 0');
  dispatcher.onExec('sleep 9');
  dispatcher.onPrompt(130);
  assert.deepEqual(target.submitted, ['make deploy'], 'still paused');
  void finish;
});

test('an entry is taken exactly once: repeated prompts, edits and removals never run it twice or out of order', () => {
  const {target, dispatcher} = harness();
  dispatcher.onExec('long');
  dispatcher.request({op: 'add', text: 'first'});
  dispatcher.request({op: 'add', text: 'second'});
  const [first, second] = dispatcher.state.entries;
  dispatcher.request({op: 'edit-begin', id: first!.id});
  dispatcher.onPrompt(0);
  assert.deepEqual(target.submitted, [], 'an entry being edited holds the queue at that point');
  dispatcher.request({op: 'edit', id: first!.id, text: 'first --edited'});
  assert.deepEqual(target.submitted, ['first --edited']);
  dispatcher.onPrompt(0);
  dispatcher.onPrompt(0);
  assert.deepEqual(target.submitted, ['first --edited', 'second'], 'a prompt without a command does not dispatch twice');
  dispatcher.request({op: 'remove', id: second!.id});
  assert.match(String(dispatcher.queue.apply({op: 'remove', id: second!.id})), /already ran or was removed/u);
});

test('reorder, clear, pause and limits', () => {
  const queue = new CommandQueue(() => 5);
  for (const text of ['a', 'b', 'c']) queue.apply({op: 'add', text});
  const [a, , c] = queue.state.entries;
  queue.apply({op: 'move', id: c!.id, to: 0});
  assert.deepEqual(queue.state.entries.map(entry => entry.text), ['c', 'a', 'b']);
  queue.apply({op: 'move', id: a!.id, to: 99});
  assert.deepEqual(queue.state.entries.map(entry => entry.text), ['c', 'b', 'a']);
  queue.apply({op: 'pause'});
  assert.equal(queue.take(), undefined);
  queue.apply({op: 'clear'});
  assert.deepEqual(queue.state, {entries: []});
  assert.match(String(queue.apply({op: 'add', text: '   '})), /Nothing to queue/u);
  for (let index = 0; index < QUEUE_LIMIT; index += 1) queue.apply({op: 'add', text: `cmd ${index}`});
  assert.match(String(queue.apply({op: 'add', text: 'one more'})), /at most/u);
});

test('multi-line entries are submitted whole, exactly as prepared', () => {
  const {target, dispatcher} = harness();
  dispatcher.onPrompt(0);
  const script = "for f in a b; do\n  echo \"$f\"\ndone\ncat <<'EOF'\nliteral $HOME\nEOF";
  dispatcher.request({op: 'add', text: script});
  assert.deepEqual(target.submitted, [`{ ${script}\n}`], 'one block, exactly as the composer submits it');
});

test('a shell switch pauses the queue for the new shell; a shell exit drops and reports what is left', () => {
  const {target, dispatcher, events} = harness();
  dispatcher.onExec('long');
  dispatcher.request({op: 'add', text: 'echo for zsh'});
  const next = shell();
  dispatcher.onShellSwitched(next);
  dispatcher.onPrompt(0);
  assert.deepEqual([...target.submitted, ...next.submitted], []);
  assert.equal(dispatcher.state.paused?.reason, 'shell-switched');
  dispatcher.onShellExit();
  assert.deepEqual(events.at(-1)![1].dropped?.map(entry => entry.text), ['echo for zsh']);
  assert.deepEqual(dispatcher.state, {entries: []});
});

test('nothing is dispatched before the shell is ready', () => {
  const target = {...shell(), isReady: false};
  const dispatcher = new QueueDispatcher(target);
  dispatcher.request({op: 'add', text: 'echo early'});
  dispatcher.onPrompt(0);
  assert.deepEqual(target.submitted, []);
});

test('the exec after a dispatch is that entry, by its own text; nothing else is ever attributed to the queue', () => {
  const {target, dispatcher} = harness();
  assert.equal(dispatcher.onExec('sleep 3'), undefined, 'a typed command is not from the queue');
  dispatcher.request({op: 'add', text: 'for i in 1 2; do\n  echo "$i"\ndone'});
  dispatcher.onPrompt(0);
  assert.equal(target.submitted.length, 1);
  assert.deepEqual(dispatcher.onExec(target.submitted[0]!)?.text, 'for i in 1 2; do\n  echo "$i"\ndone', 'the entry, not the wrapped block');
  dispatcher.onPrompt(0);
  assert.equal(dispatcher.onExec('ls'), undefined, 'claimed once');
  // A submission that started no command (a comment) is not owed to whatever runs next.
  dispatcher.request({op: 'add', text: '# just a note'});
  dispatcher.onPrompt(0);
  dispatcher.onPrompt(0);
  assert.equal(dispatcher.onExec('ls'), undefined);
});

test('queue text is drawn, never interpreted: control sequences in entries and pause reasons are neutralized', async () => {
  const {queuePreview, pauseReason, queueRow} = await import('../src/status/queueStatus.js');
  const {renderQueuePanel} = await import('../src/queue/QueuePanel.js');
  const hostile = 'echo hi\u001b]52;c;cm0gLXJmIH4=\u0007\u001b[2J\u009b31m';
  for (const text of [queuePreview(hostile), pauseReason({reason: 'failed', at: 1, command: hostile, exitCode: 2}),
    queueRow({entries: [{id: 1, text: hostile, addedAt: 1}]}, 120) ?? '',
    renderQueuePanel({selected: 0}, {entries: [{id: 1, text: `${hostile}\nsecond ${hostile}`, addedAt: 1}]}, hostile, 120, 30).join('\n')]) {
    assert.doesNotMatch(text.replace(/\u001b\[[\d;]*m/gu, ''), /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u, JSON.stringify(text));
  }
  assert.match(queuePreview(hostile), /␛\]52/u, 'visible, not executed');
});
