import test from 'node:test';
import assert from 'node:assert/strict';
import type {QueueOp} from '../src/session/CommandQueue.js';
import type {InputState} from '../src/session/inputState.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #426: while a command runs and NMSh has no evidence yet that it reads input, the keys that decide where typing goes
 * (the first key of a draft, an Enter that would queue) wait for an on-demand look. On a loaded machine that look can
 * take longer than 800 ms. The keys then stay held until it answers (at most 5 s): they may be a hidden reply, and the
 * Enter decides whether the line answers the command or is queued. The composer says the typing is kept.
 *
 * Deterministic: the look is a promise the test settles, and the deadlines run on mocked timers. Every key goes
 * through the real TerminalApp key handler; no shell is started.
 */

const READ = `read -r QA_REPLY; printf 'ANSWER=%s\\n' "$QA_REPLY"`;
const SECRET = 'QSECRETQ';
/** When a look still running says so in the composer. */
const SLOW_MS = 800;
/** The bound on keys waiting for a look that does not answer. */
const BOUND_MS = 5000;

function fixture() {
  const frame = executionFrameFixture(80, 30);
  const written: string[] = [];
  const queueOps: QueueOp[] = [];
  Object.defineProperty(frame.session, 'write', {value: (data: string) => { written.push(data); }, configurable: true});
  const originalQueue = frame.session.queue.bind(frame.session);
  Object.defineProperty(frame.session, 'queue', {value: (op: QueueOp) => { queueOps.push(op); originalQueue(op); }, configurable: true});
  let looks = 0;
  let settle: (looked: boolean) => void = () => {};
  /** Every look stays open until the test settles it. */
  const slowLooks = () => Object.defineProperty(frame.session, 'lookInput', {value: () => {
    looks += 1;
    return new Promise<boolean>(resolve => { settle = resolve; });
  }, configurable: true});
  /** Every look answers at once, as it does on an idle machine. */
  const quickLooks = () => Object.defineProperty(frame.session, 'lookInput', {value: async () => { looks += 1; return true; }, configurable: true});
  const type = (text: string) => { for (const char of text) frame.app['onInput'](char); };
  const enter = () => frame.app['onInput']('\r');
  const text = () => frame.app['editor'].text as string;
  const adds = () => queueOps.filter(op => op.op === 'add').map(op => (op as {text: string}).text);
  const screen = () => frame.capture().frame.rows.map(line => stripAnsi(line)).join('\n');
  /** The session reports what the look found, before it says the look is done (as the protocol orders them). */
  const found = (request: NonNullable<InputState['request']>) => {
    frame.session.emit('inputState', {request, timing: {waitedMs: 0, waits: 0}});
    settle(true);
  };
  return {...frame, written, slowLooks, quickLooks, type, enter, text, adds, screen, found, looks: () => looks, settle: () => settle(true)};
}

const settled = () => new Promise(done => setImmediate(done));
const KEPT = /Checking whether \S+ is waiting for input · your typing is kept/u;

test('#426: a reply to a prompt-less read is not queued when the look outlasts 800 ms', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin(READ);
    f.type('hello');
    f.enter();
    t.mock.timers.tick(SLOW_MS + 100);
    assert.deepEqual(f.adds(), [], 'the Enter waits for the look: it is not queued');
    assert.deepEqual(f.written, [], 'nothing reached the program yet');
    assert.equal(f.text(), '', 'nothing is drawn as a draft before NMSh knows who reads it');
    assert.match(f.screen(), KEPT, 'the composer says the typing is kept');
    // The look finds the shell's own read, holding its terminal and idle.
    f.found({since: 0, confidence: 'likely', mode: 'line'});
    await settled();
    assert.deepEqual(f.written, ['hello\r'], 'the answer reaches the read, once');
    assert.deepEqual(f.adds(), [], 'nothing was queued');
    assert.equal(f.text(), '');
    assert.doesNotMatch(f.screen(), KEPT, 'the note goes with the hold');
  } finally { f.dispose(); }
});

test('#426: a hidden reply typed before NMSh could look is never drawn, queued or run', async t => {
  for (const [command, output] of [['read -s REPLY', ''], ['sudo -k true', 'Password:']] as const) {
    const f = fixture();
    try {
      t.mock.timers.reset();
      t.mock.timers.enable({apis: ['setTimeout']});
      f.slowLooks();
      f.begin(command, output);
      f.type(SECRET);
      f.enter();
      for (const at of [SLOW_MS - 1, 1, 1000, 2000]) {
        t.mock.timers.tick(at);
        assert.equal(f.screen().includes(SECRET), false, `${command}: the reply is not on screen ${at} ms on`);
      }
      assert.deepEqual(f.adds(), [], `${command}: a password never becomes a queued shell command`);
      assert.equal(f.text(), '');
      f.found({since: 0, confidence: 'confirmed', mode: 'hidden'});
      await settled();
      assert.equal(f.written.join(''), `${SECRET}\r`, `${command}: the hidden line and its Enter go to the program, in order`);
      assert.deepEqual(f.adds(), []);
      assert.equal(f.screen().includes(SECRET), false, `${command}: never drawn`);
    } finally { f.dispose(); }
  }
});

test('#426: keys typed after a held Enter stay behind it, in order', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin(READ);
    f.type('hello');
    f.enter();
    f.type('ls');
    t.mock.timers.tick(SLOW_MS + 100);
    f.found({since: 0, confidence: 'likely', mode: 'line'});
    await settled();
    assert.deepEqual(f.written, ['hello\r']);
    assert.equal(f.text(), 'ls', 'what followed the Enter is the next draft');
    assert.deepEqual(f.adds(), []);
  } finally { f.dispose(); }
});

test('#426: keys waiting for a look that never answers are routed after the bound, on what is known', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin('sleep 30');
    f.type('echo next');
    f.enter();
    t.mock.timers.tick(BOUND_MS - 1);
    assert.deepEqual(f.adds(), [], 'still waiting, within the bound');
    assert.match(f.screen(), KEPT);
    t.mock.timers.tick(1);
    assert.deepEqual(f.adds(), ['echo next'], 'with no evidence, Enter queues, as it always did');
    assert.deepEqual(f.written, []);
    assert.doesNotMatch(f.screen(), KEPT);
  } finally { f.dispose(); }
});

test('#426: type-ahead is not delayed beyond the look: it appears as soon as the look answers', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    // A quick look (the usual case): no note ever shows, and the text is there as soon as the look answers.
    f.slowLooks();
    f.begin('sleep 30');
    f.type('echo n');
    t.mock.timers.tick(SLOW_MS - 1);
    assert.doesNotMatch(f.screen(), KEPT, 'a look that answers within 800 ms shows no note');
    f.settle();
    await settled();
    assert.equal(f.text(), 'echo n');
    assert.doesNotMatch(f.screen(), KEPT);

    // An idle machine: looks answer at once with no evidence of a read. No timer has to run for typing to appear or
    // for Enter to queue.
    const g = fixture();
    try {
      g.quickLooks();
      g.begin('sleep 30');
      g.type('echo next');
      await settled();
      assert.equal(g.text(), 'echo next');
      g.enter();
      await settled();
      assert.deepEqual(g.adds(), ['echo next'], 'queued as soon as the look answered');
      assert.equal(g.looks(), 2, 'one look for the draft, one for the Enter');
      assert.deepEqual(g.written, []);
    } finally { g.dispose(); }
  } finally { f.dispose(); }
});

test('#426: an answer to a question the program printed goes as soon as the look answers, never queued', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin('./install.sh', 'Continue? [y/N] ');
    f.type('y');
    f.enter();
    t.mock.timers.tick(SLOW_MS + 100);
    assert.deepEqual(f.written, [], 'held while NMSh cannot tell whether the answer is hidden');
    assert.deepEqual(f.adds(), []);
    // The look finds an ordinary line read: the answer goes, shown as typed.
    f.found({since: 0, confidence: 'likely', mode: 'line'});
    await settled();
    assert.deepEqual(f.written, ['y\r']);
    assert.deepEqual(f.adds(), []);
  } finally { f.dispose(); }
});

test('#426: the command ending while keys are held: the line runs as the next command, once', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin('sleep 1');
    f.type('echo after');
    f.enter();
    t.mock.timers.tick(SLOW_MS + 100);
    assert.deepEqual(f.adds(), []);
    const submitted: string[] = [];
    Object.defineProperty(f.app, 'submit', {value: async () => { submitted.push(f.text()); }, configurable: true});
    f.complete(0);
    f.settle();
    await settled();
    assert.deepEqual(f.adds(), [], 'the command is over: nothing is queued');
    assert.deepEqual(submitted, ['echo after'], 'the line runs as the next command, as Enter at the prompt does');
    assert.deepEqual(f.written, []);
  } finally { f.dispose(); }
});

test('#426: Ctrl+C while keys are held routes them on what is known, then interrupts', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    let interrupts = 0;
    Object.defineProperty(f.session, 'interrupt', {value: () => { interrupts += 1; }, configurable: true});
    f.begin('sleep 30');
    f.type('echo n');
    t.mock.timers.tick(SLOW_MS + 100);
    f.app['onInput']('\u0003');
    assert.equal(interrupts, 1, 'Ctrl+C is never held');
    assert.doesNotMatch(f.screen(), KEPT);
    assert.deepEqual(f.written, [], 'the held text never reached the program');
  } finally { f.dispose(); }
});
