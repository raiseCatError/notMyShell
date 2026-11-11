import test from 'node:test';
import assert from 'node:assert/strict';
import type {QueueOp} from '../src/session/CommandQueue.js';
import type {InputState, LookResult} from '../src/session/inputState.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * The queue composer (#473): Ctrl+Q on an empty line while a command runs opens it for that command, and every line
 * entered in it is queued as typed, in order, with no approval step, as Ctrl+Q on a line does. It is an explicit
 * choice that never outlives its command, so plain Enter keeps #514's rule: an echoing terminal is no evidence, and a
 * line NMSh cannot place waits for the person. Hidden input closes it before anything typed is drawn.
 *
 * Deterministic: every key goes through the real TerminalApp key handler; looks answer as the test says.
 */

const SECRET = 'QSECRETQ';
const CTRL_Q = '\u0011';

function fixture() {
  const frame = executionFrameFixture(110, 30);
  const written: string[] = [];
  const queueOps: QueueOp[] = [];
  Object.defineProperty(frame.session, 'write', {value: (data: string) => { written.push(data); }, configurable: true});
  const originalQueue = frame.session.queue.bind(frame.session);
  Object.defineProperty(frame.session, 'queue', {value: (op: QueueOp) => { queueOps.push(op); originalQueue(op); }, configurable: true});
  const submitted: string[] = [];
  Object.defineProperty(frame.app, 'submit', {value: async () => { submitted.push(frame.app['editor'].text); frame.app['editor'].clear(); }, configurable: true});
  let looks = 0;
  const looksAnswer = (result: LookResult | undefined) =>
    Object.defineProperty(frame.session, 'lookInput', {value: async () => { looks += 1; return result; }, configurable: true});
  looksAnswer('visible');
  const type = (text: string) => { for (const char of text) frame.app['onInput'](char); };
  const enter = () => frame.app['onInput']('\r');
  const adds = () => queueOps.filter((op): op is Extract<QueueOp, {op: 'add'}> => op.op === 'add');
  const screen = () => frame.capture().frame.rows.map(line => stripAnsi(line)).join('\n');
  const transcript = () => (frame.app['output'].transcript().lines as Array<Array<{text?: string} | null>>)
    .map(line => line.map(cell => cell?.text ?? ' ').join('')).join('\n');
  const report = (request: NonNullable<InputState['request']>) =>
    frame.session.emit('inputState', {request, timing: {waitedMs: 0, waits: 0}});
  return {...frame, written, queueOps, submitted, looksAnswer, type, enter, adds, screen, transcript, report, looks: () => looks};
}

const settled = async () => { for (let i = 0; i < 4; i += 1) await new Promise(done => setImmediate(done)); };

const open = (f: ReturnType<typeof fixture>) => f.app['onInput'](CTRL_Q);

test('/queue mode no longer exists; other /queue words are unchanged', () => {
  assert.equal(parseSlashCommand('/queue mode')?.kind === 'queue', false);
  assert.deepEqual(parseSlashCommand('/queue pause'), {kind: 'queue', op: 'pause'});
});

test('plain Enter while sleep runs is never queued: an echoing terminal is no evidence, the line waits for a choice (#514)', async () => {
  const f = fixture();
  try {
    f.begin('sleep 30');
    assert.match(f.screen(), /Enter checks who reads it · Ctrl\+Q runs it after · Ctrl\+S sends to sleep · Ctrl\+Q alone queues several/u);
    f.type('echo one');
    await settled();
    f.enter();
    await settled();
    assert.deepEqual(f.adds(), [], 'nothing is queued or sent');
    assert.match(f.screen(), /Can.t tell whether sleep is reading your typing/u);
  } finally { f.dispose(); }
});

test('Ctrl+Q on an empty line opens the queue composer: each line is queued as typed, in order, with no approval; it stays open', async () => {
  const f = fixture();
  try {
    f.begin('sleep 30');
    open(f);
    assert.match(f.screen(), /Queueing · each Enter adds a command to run after sleep · Esc stops/u);
    const lines = ['echo "STEP 1 — Starting"', 'sleep 2', 'echo "STEP 2 — Halfway"', 'sleep 2', "echo 'STEP 3 — Finished!'"];
    for (const line of lines) { f.type(line); await settled(); f.enter(); await settled(); }
    assert.deepEqual(f.adds().map(op => op.text), lines, 'each line once, in the order entered');
    assert.equal(f.adds().some(op => op.condition !== undefined || op.typedWhile !== undefined), false, 'none waits for approval');
    assert.deepEqual(f.written, [], 'nothing reached sleep');
    assert.deepEqual(f.submitted, [], 'nothing ran early');
    assert.match(f.screen(), /Queueing · each Enter adds/u, 'still open for the next line');
  } finally { f.dispose(); }
});

test('adversarial: the composer never outlives its command; a reflex Enter during the next command is #514 again', async () => {
  const f = fixture();
  try {
    f.begin('sleep 30');
    open(f);
    f.type('echo queued'); await settled(); f.enter(); await settled();
    f.complete(0);
    assert.equal(f.app['queueCompose'], false, 'closed when its command ended');
    f.begin('python3 ask.py');
    f.type('yes'); await settled(); f.enter(); await settled();
    assert.deepEqual(f.adds().map(op => op.text), ['echo queued'], 'the reply typed for the next command is not queued');
    assert.match(f.screen(), /Can.t tell whether python3 is reading your typing/u);
    // At the prompt, Ctrl+Q on an empty line opens nothing.
    f.complete(0);
    open(f);
    assert.equal(f.app['queueCompose'], false);
  } finally { f.dispose(); }
});

test('Esc closes the composer and drops its unfinished line; Ctrl+Q on the empty composer closes it too', async () => {
  const f = fixture();
  try {
    f.begin('sleep 30');
    open(f);
    f.type('echo half'); await settled();
    f.app['handleKey']({kind: 'escape'});
    assert.equal(f.app['queueCompose'], false);
    assert.equal(f.app['editor'].text, '');
    open(f);
    assert.equal(f.app['queueCompose'], true);
    open(f);
    assert.equal(f.app['queueCompose'], false, 'a second Ctrl+Q on the empty composer closes it');
    assert.deepEqual(f.adds(), []);
  } finally { f.dispose(); }
});

test('adversarial: a password prompt NMSh has not reported yet: the first key is looked at, the composer closes, nothing is drawn or queued', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.looksAnswer('hidden');
    f.begin('sudo -k true');
    open(f);
    f.type(SECRET); await settled();
    f.enter(); await settled();
    assert.equal(f.app['queueCompose'], false, 'hidden input closed the composer');
    assert.equal(f.screen().includes(SECRET), false, 'not on screen');
    assert.equal(f.transcript().includes(SECRET), false, 'not in the transcript');
    assert.equal(f.adds().some(op => op.text.includes(SECRET)), false, 'not queued');
    assert.equal(f.submitted.some(text => text.includes(SECRET)), false, 'not run');
  } finally { f.dispose(); }
});

test('adversarial: a hidden question reported while the composer is open and empty closes it; the keys go to the program, unseen', async () => {
  const f = fixture();
  try {
    f.begin('sudo -k true');
    open(f);
    f.report({since: Date.now(), confidence: 'confirmed', mode: 'hidden'});
    assert.equal(f.app['queueCompose'], false);
    f.type(SECRET); f.enter(); await settled();
    assert.equal(f.written.join(''), `${SECRET}\r`, 'the password reached the program');
    assert.equal(f.screen().includes(SECRET), false);
    assert.deepEqual(f.adds(), []);
  } finally { f.dispose(); }
});

test('adversarial: a question that appears while a line is half-typed in the composer: that line stays a queued command, then the program gets the keys', async () => {
  const f = fixture();
  try {
    f.begin('sleep 2; read -r reply');
    open(f);
    f.type('echo be'); await settled();
    f.report({since: Date.now(), confidence: 'likely', mode: 'line'});
    f.type('gun'); f.enter(); await settled();
    assert.deepEqual(f.adds().map(op => [op.text, op.condition]), [['echo begun', undefined]], 'begun as a queued command, queued as one');
    assert.equal(f.app['queueCompose'], false, 'then the composer closes');
    f.type('hello'); f.enter(); await settled();
    assert.equal(f.written.join(''), 'hello\r', 'the answer goes to the program');
    assert.equal(f.adds().length, 1);
  } finally { f.dispose(); }
});

test('a look that cannot tell keeps typing held and hidden, composer or not; nothing routes on no evidence', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.looksAnswer('unknown');
    f.begin('sleep 30');
    open(f);
    f.type(SECRET); await settled();
    t.mock.timers.tick(5000); await settled();
    assert.equal(f.screen().includes(SECRET), false);
    assert.deepEqual(f.adds(), [], 'nothing queued');
  } finally { f.dispose(); }
});

test('Ctrl+Q with text queues that line once; Ctrl+Q while a program reads hidden input composes one entry, then closes', async () => {
  const f = fixture();
  try {
    f.begin('sleep 30');
    f.type('echo later'); await settled();
    f.app['onInput'](CTRL_Q); await settled();
    assert.deepEqual(f.adds().map(op => [op.text, op.typedWhile]), [['echo later', undefined]]);
    assert.equal(f.app['queueCompose'], false, 'Ctrl+Q with a line queues it and opens nothing');
    f.complete(0);
    f.begin('sudo -k true');
    f.report({since: Date.now(), confidence: 'confirmed', mode: 'hidden'});
    f.app['onInput'](CTRL_Q);
    assert.equal(f.app['queueCompose'], true, 'composes a queue entry');
    f.type('echo after-sudo'); f.enter(); await settled();
    assert.equal(f.app['queueCompose'], false, 'one entry, then typing returns to the program');
  } finally { f.dispose(); }
});

test('a line of several commands is named "the command", never its first word, which may have finished long ago', async () => {
  for (const command of ['echo "STEP 1"; sleep 2; echo "STEP 2"', "printf 'ONE\\n'\nsleep 1", 'make && make test']) {
    const f = fixture();
    try {
      f.begin(command);
      f.type('echo next');
      await settled();
      f.enter();
      await settled();
      assert.deepEqual(f.adds(), [], command);
      assert.match(f.screen(), /Can.t tell whether the command is reading your typing/u, command);
      assert.doesNotMatch(f.screen(), /whether (echo|printf|make) is reading/u, command);
    } finally { f.dispose(); }
  }
});

test('a held line at the head still never holds the prompt (#426); the line runs now', async () => {
  const f = fixture();
  try {
    f.session.emit('queueState', {entries: [{id: 1, text: 'echo held', addedAt: 1, condition: 'approve', typedWhile: 'sleep'}]}, {});
    await settled();
    f.type('echo now');
    f.enter();
    await settled();
    assert.deepEqual(f.submitted, ['echo now']);
    assert.deepEqual(f.adds(), []);
  } finally { f.dispose(); }
});
