import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandQueue} from '../src/session/CommandQueue.js';
import {QueueDispatcher, unreadLines} from '../src/session/QueueDispatcher.js';
import {queueOpFrom, queueStateFrom, queueStateMessage} from '../src/session/SessionProtocol.js';
import {ShellProtocolDecoder} from '../src/shell/ShellProtocol.js';

/**
 * #426 hardening, owner side: a line typed while a program ran (`typedWhile`) is the person's to approve. The owner
 * enforces it, whatever a frontend sends: such an entry always waits for approval, its condition cannot be cleared to
 * run by itself, and only the person's edit (which shows it) makes it an ordinary entry.
 */

test('owner: an entry typed while a program ran always waits for approval, even if added without a condition', () => {
  const queue = new CommandQueue(() => 1);
  assert.equal(queue.apply({op: 'add', text: 'yes', typedWhile: 'sleep'}), undefined);
  assert.deepEqual(queue.state.entries[0], {id: 1, text: 'yes', addedAt: 1, condition: 'approve', typedWhile: 'sleep'});
  assert.equal(queue.take(), undefined, 'never taken unapproved');
  assert.match(queue.apply({op: 'condition', id: 1}) ?? '', /approv/u, 'its approval cannot be removed so it runs by itself');
  assert.match(queue.apply({op: 'condition', id: 1, condition: 'always'}) ?? '', /approv/u);
  assert.equal(queue.take(), undefined);
  assert.equal(queue.apply({op: 'approve', id: 1}), undefined);
  assert.equal(queue.take()?.text, 'yes', 'runs once approved');
});

test('owner: editing a held line is the person showing and changing it: it stays an approval, no longer sealed', () => {
  const queue = new CommandQueue(() => 1);
  queue.apply({op: 'add', text: 'secret', typedWhile: 'sudo'});
  queue.apply({op: 'edit', id: 1, text: 'echo fixed'});
  assert.deepEqual(queue.state.entries[0], {id: 1, text: 'echo fixed', addedAt: 1, condition: 'approve'});
});

test('wire: typedWhile is bounded, control-free and round-trips; an older frontend just ignores it', () => {
  assert.deepEqual(queueOpFrom(JSON.stringify({op: 'add', text: 'x', typedWhile: 'make'})), {op: 'add', text: 'x', typedWhile: 'make'});
  assert.equal(queueOpFrom(JSON.stringify({op: 'add', text: 'x', typedWhile: 'a\u001b[2Jb'})), undefined, 'control characters refused');
  assert.equal(queueOpFrom(JSON.stringify({op: 'add', text: 'x', typedWhile: 7})), undefined);
  const long = queueOpFrom(JSON.stringify({op: 'add', text: 'x', typedWhile: 'p'.repeat(500)}));
  assert.equal(long?.op === 'add' ? long.typedWhile?.length : 0, 64, 'bounded');
  const queue = new CommandQueue(() => 5);
  queue.apply({op: 'add', text: 'yes', typedWhile: 'sleep'});
  const message = queueStateMessage({...queue.state, revision: 1}, {});
  assert.deepEqual(queueStateFrom(message.state)?.entries[0], {id: 1, text: 'yes', addedAt: 5, condition: 'approve', typedWhile: 'sleep'});
});

test('unread typing a command never read becomes held lines: edits applied, terminal sequences dropped, never run', () => {
  assert.deepEqual(unreadLines('a\rb\u007fc\r\u001b[Ad\u0015e\nf\u0017g h\u0008\u0008i\r\u001b]11;rgb:0/0/0\u0007\u001b[?62;22cpartial'),
    ['a', 'c', 'e', 'gi', 'partial']);
  assert.deepEqual(unreadLines('\r\n  \r'), [], 'nothing typed, nothing held');
  assert.equal(unreadLines(Array.from({length: 40}, (_, i) => `l${i}`).join('\r')).length, 10, 'bounded');
  const queue = new CommandQueue(() => 1);
  const dispatcher = new QueueDispatcher({isReady: true, adapter: {id: 'zsh'}, submit: () => { throw new Error('never submitted'); }}, queue);
  dispatcher.onExec('read -t 1 code; sleep 2');
  assert.equal(dispatcher.holdUnread('123456\recho hi\r', 'read'), 2);
  dispatcher.onPrompt(0);
  assert.deepEqual(queue.state.entries.map(entry => [entry.text, entry.condition, entry.typedWhile]), [['123456', 'approve', 'read'], ['echo hi', 'approve', 'read']]);
});

test('shell protocol: an unread marker carries the bytes as hex, decoded exactly; malformed ones are output', () => {
  const decoder = new ShellProtocolDecoder('tok');
  const hex = Buffer.from('pwé\r', 'utf8').toString('hex');
  assert.deepEqual(decoder.push(`\u001b]777;nmsh;tok;unread;${hex}\u0007`), [{kind: 'unread', text: 'pwé\r'}]);
  assert.deepEqual(decoder.push('\u001b]777;nmsh;tok;unread;zz\u0007'), [], 'not hex: dropped, never guessed');
});
