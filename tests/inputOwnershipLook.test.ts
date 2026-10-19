import test from 'node:test';
import assert from 'node:assert/strict';
import type {QueueOp} from '../src/session/CommandQueue.js';
import type {InputState, LookResult} from '../src/session/inputState.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #426: while a command runs and NMSh has no evidence yet that it reads input, the keys that decide where typing goes
 * (the first key of a draft, an Enter that would queue) wait for an on-demand look. Until NMSh knows who reads them,
 * nothing typed is drawn, sent, queued or run: it may be a password. A look says what it saw (hidden, visible,
 * unknown, nothing running); when it cannot tell, or never answers, the typing stays held and hidden until the person
 * chooses (Ctrl+S sends it, Tab shows it, Esc discards it) or later evidence decides. A command that ends while the
 * typing is held past the slow mark never runs it; Ctrl+C discards held typing, as a terminal flushes its input.
 *
 * Deterministic: each look is a promise the test settles with what it "saw", and the deadlines run on mocked timers.
 * Every key goes through the real TerminalApp key handler; no shell is started.
 */

const READ = `read -r QA_REPLY; printf 'ANSWER=%s\\n' "$QA_REPLY"`;
const SECRET = 'QSECRETQ';
/** When a look still running says so in the composer. */
const SLOW_MS = 800;
/** The bound on keys waiting for a look that does not answer. */
const BOUND_MS = 5000;
const CTRL_S = '\u0013';
const TAB = '\t';

function fixture() {
  const frame = executionFrameFixture(100, 30);
  const written: string[] = [];
  const queueOps: QueueOp[] = [];
  const submitted: string[] = [];
  let interrupts = 0;
  Object.defineProperty(frame.session, 'write', {value: (data: string) => { written.push(data); }, configurable: true});
  Object.defineProperty(frame.session, 'interrupt', {value: () => { interrupts += 1; }, configurable: true});
  const originalQueue = frame.session.queue.bind(frame.session);
  Object.defineProperty(frame.session, 'queue', {value: (op: QueueOp) => { queueOps.push(op); originalQueue(op); }, configurable: true});
  Object.defineProperty(frame.app, 'submit', {value: async () => { submitted.push(frame.app['editor'].text); frame.app['editor'].clear(); }, configurable: true});
  let looks = 0;
  let settle: (result: LookResult | undefined) => void = () => {};
  /** Every look stays open until the test settles it with what it saw. */
  const slowLooks = () => Object.defineProperty(frame.session, 'lookInput', {value: () => {
    looks += 1;
    return new Promise<LookResult | undefined>(resolve => { settle = resolve; });
  }, configurable: true});
  /** Every look answers at once with what it saw, as it does on an idle machine. */
  const quickLooks = (...answer: [LookResult | undefined] | []) => {
    const result = answer.length ? answer[0] : 'visible';
    Object.defineProperty(frame.session, 'lookInput', {value: async () => { looks += 1; return result; }, configurable: true});
  };
  const type = (text: string) => { for (const char of text) frame.app['onInput'](char); };
  const enter = () => frame.app['onInput']('\r');
  const text = () => frame.app['editor'].text as string;
  const adds = () => queueOps.filter(op => op.op === 'add').map(op => (op as {text: string}).text);
  const screen = () => frame.capture().frame.rows.map(line => stripAnsi(line)).join('\n');
  const transcript = () => (frame.app['output'].transcript().lines as Array<Array<{text?: string} | null>>)
    .map(line => line.map(cell => cell?.text ?? ' ').join('')).join('\n');
  /** The session reports what the look found, before it says the look is done (as the protocol orders them). */
  const found = (request: NonNullable<InputState['request']>) => {
    frame.session.emit('inputState', {request, timing: {waitedMs: 0, waits: 0}});
    settle(request.mode === 'hidden' ? 'hidden' : 'visible');
  };
  /** Nothing anywhere a person or a log could read holds the secret. */
  const nowhere = (secret: string, what: string) => {
    assert.equal(screen().includes(secret), false, `${what}: not on screen`);
    assert.equal(text().includes(secret), false, `${what}: not in the composer`);
    assert.equal(adds().some(entry => entry.includes(secret)), false, `${what}: not queued`);
    assert.equal(submitted.some(entry => entry.includes(secret)), false, `${what}: not run as a command`);
    assert.equal(transcript().includes(secret), false, `${what}: not in the transcript`);
  };
  return {...frame, queueOps, written, submitted, slowLooks, quickLooks, type, enter, text, adds, screen, transcript, found, nowhere,
    interrupts: () => interrupts, looks: () => looks, settle: (result: LookResult | undefined) => settle(result)};
}

const settled = () => new Promise(done => setImmediate(done));
const KEPT = /Checking whether \S+ is waiting for input · your typing is kept/u;
const HELD = /Can't tell whether \S+ is reading your typing/u;

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
        f.nowhere(SECRET, `${command}, ${at} ms on`);
      }
      f.found({since: 0, confidence: 'confirmed', mode: 'hidden'});
      await settled();
      assert.equal(f.written.join(''), `${SECRET}\r`, `${command}: the hidden line and its Enter go to the program, in order`);
      f.nowhere(SECRET, `${command}, after`);
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

test('#426 timeout: a look that never answers leaves the typing held and hidden, never routed; Ctrl+S sends it', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin('read -s REPLY');
    f.type(SECRET);
    f.enter();
    t.mock.timers.tick(BOUND_MS + 1000);
    f.nowhere(SECRET, 'after the bound');
    assert.deepEqual(f.written, [], 'nothing was sent without evidence or a choice');
    assert.match(f.screen(), HELD, 'the activity rows say NMSh cannot tell');
    assert.match(f.screen(), /Ctrl\+S sends it to read · Tab shows it · Esc discards it/u, 'and how to choose');
    // More typing is held too, hidden, in order.
    f.type('X');
    f.nowhere(`${SECRET}X`, 'typing more');
    f.app['onInput'](CTRL_S);
    assert.equal(f.written.join(''), `${SECRET}\rX`, 'Ctrl+S sends exactly what was typed, in order, to the program');
    f.nowhere(SECRET, 'after sending');
    assert.doesNotMatch(f.screen(), HELD);
  } finally { f.dispose(); }
});

test('#426 timeout: a look that could not see the terminal (a failed probe) holds the typing the same way', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.quickLooks('unknown');
    f.begin('sudo -k true', 'Password:');
    f.type(SECRET);
    f.enter();
    await settled();
    f.nowhere(SECRET, 'after an unknown look');
    assert.deepEqual(f.written, []);
    assert.match(f.screen(), HELD);
    // Esc discards: nothing is sent, shown or queued, and typing is ordinary again.
    // (A lone ESC byte waits in the key decoder for a possible sequence; the key itself is what Esc delivers.)
    f.app['handleKey']({kind: 'escape'});
    f.nowhere(SECRET, 'after Esc');
    assert.deepEqual(f.written, []);
    assert.doesNotMatch(f.screen(), HELD);
  } finally { f.dispose(); }
});

test('#426: one failed look gets one more; if that one sees the terminal echoing, type-ahead flows as usual', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin('npm test');
    f.type('echo next');
    f.settle('unknown');
    await settled();
    assert.equal(f.looks(), 2, 'a second look was asked for');
    assert.doesNotMatch(f.screen(), HELD, 'not yet held: still looking');
    f.settle('visible');
    await settled();
    assert.equal(f.text(), 'echo next');
    assert.doesNotMatch(f.screen(), HELD);
    // Both looks blind: held, and no third look.
    const g = fixture();
    try {
      g.slowLooks();
      g.begin('sudo -k true', 'Password:');
      g.type(SECRET);
      g.settle('unknown');
      await settled();
      g.settle('unknown');
      await settled();
      assert.equal(g.looks(), 2);
      assert.match(g.screen(), HELD);
      g.nowhere(SECRET, 'two blind looks');
    } finally { g.dispose(); }
  } finally { f.dispose(); }
});

test('#426 timeout: Tab shows held typing in the composer for review; only the person\'s own Enter routes it', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin('sleep 30');
    f.type('echo next');
    f.enter();
    t.mock.timers.tick(BOUND_MS);
    assert.match(f.screen(), HELD);
    assert.equal(f.text(), '');
    f.app['onInput'](TAB);
    assert.equal(f.text(), 'echo next', 'shown as a draft; the trailing Enter is not replayed');
    assert.deepEqual(f.adds(), [], 'showing never queues');
    assert.deepEqual(f.written, []);
    assert.doesNotMatch(f.screen(), HELD);
  } finally { f.dispose(); }
});

test('#426 timeout: evidence that arrives while typing is held decides it (a hidden read gets it, never drawn)', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin('read -s REPLY');
    f.type(SECRET);
    f.enter();
    t.mock.timers.tick(BOUND_MS);
    assert.match(f.screen(), HELD);
    // The watch's own schedule sees the hidden read later.
    f.session.emit('inputState', {request: {since: 0, confidence: 'confirmed', mode: 'hidden'}, timing: {waitedMs: 0, waits: 0}});
    await settled();
    assert.equal(f.written.join(''), `${SECRET}\r`);
    f.nowhere(SECRET, 'after the evidence');
  } finally { f.dispose(); }
});

test('#426: a look that saw the terminal echoing routes type-ahead at once; no held state', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.quickLooks('visible');
    f.begin('sleep 30');
    f.type('echo next');
    await settled();
    assert.equal(f.text(), 'echo next');
    f.enter();
    await settled();
    assert.deepEqual(f.adds(), ['echo next'], 'queued as soon as the look answered');
    assert.equal(f.looks(), 2, 'one look for the draft, one for the Enter');
    assert.doesNotMatch(f.screen(), HELD);
    assert.deepEqual(f.written, []);
  } finally { f.dispose(); }
});

test('#426: an older service (a look with no result) fails closed: its typing stays held, never routed on no evidence', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    (f.session.features as Set<string>).delete('input-look-result');
    f.quickLooks(undefined);
    f.begin('sleep 30');
    f.type('echo next');
    await settled();
    assert.equal(f.text(), '', 'not drawn: the older service cannot say whether sleep reads it');
    assert.match(f.screen(), HELD);
    // The same silent answer from a service that does say what it saw (the socket closed mid-look) is not evidence.
    const g = fixture();
    try {
      g.quickLooks(undefined);
      g.begin('sudo -k true', 'Password:');
      g.type(SECRET);
      await settled();
      g.nowhere(SECRET, 'a silent answer from a current service');
      assert.match(g.screen(), HELD);
    } finally { g.dispose(); }
  } finally { f.dispose(); }
});

test('#426: type-ahead is not delayed beyond the look: it appears as soon as the look answers', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin('sleep 30');
    f.type('echo n');
    t.mock.timers.tick(SLOW_MS - 1);
    assert.doesNotMatch(f.screen(), KEPT, 'a look that answers within 800 ms shows no note');
    f.settle('visible');
    await settled();
    assert.equal(f.text(), 'echo n');
    assert.doesNotMatch(f.screen(), KEPT);
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
    f.found({since: 0, confidence: 'likely', mode: 'line'});
    await settled();
    assert.deepEqual(f.written, ['y\r']);
    assert.deepEqual(f.adds(), []);
  } finally { f.dispose(); }
});

test('#426: a command that ends quickly while keys are held: the line was entered while it ran, so it is held for approval, not run', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.slowLooks();
    f.begin('ls');
    f.type('echo after');
    f.enter();
    f.complete(0);
    f.settle('idle');
    await settled();
    assert.deepEqual(f.adds(), ['echo after'], 'held in the queue');
    assert.deepEqual(f.queueOps.find(op => op.op === 'add'), {op: 'add', text: 'echo after', condition: 'approve', typedWhile: 'ls'},
      'its Enter was pressed while ls ran: it waits for approval');
    assert.deepEqual(f.submitted, [], 'never submitted at the prompt by itself');
    assert.deepEqual(f.written, []);
  } finally { f.dispose(); }
});

test('#426: a command that ends while typing is held past 800 ms never runs it; a note says it was discarded', async t => {
  for (const reason of ['the look answers late', 'the look never answers']) {
    const f = fixture();
    try {
      t.mock.timers.reset();
      t.mock.timers.enable({apis: ['setTimeout']});
      f.slowLooks();
      // A timed read: it gives up before NMSh could tell it was reading, and the shell is back at its prompt.
      f.begin('read -s -t 2 REPLY');
      f.type(SECRET);
      f.enter();
      t.mock.timers.tick(SLOW_MS + 200);
      f.complete(1);
      if (reason === 'the look answers late') f.settle('idle');
      else t.mock.timers.tick(BOUND_MS);
      await settled();
      f.nowhere(SECRET, reason);
      assert.deepEqual(f.written, [], `${reason}: nothing reached anything`);
      assert.match(f.transcript(), /discarded, not run/u, `${reason}: a note says what happened`);
    } finally { f.dispose(); }
  }
});

test('#426: Ctrl+C discards held typing, as a terminal flushes its input on interrupt, then interrupts', async t => {
  for (const when of ['while the look runs', 'after the bound']) {
    const f = fixture();
    try {
      t.mock.timers.reset();
      t.mock.timers.enable({apis: ['setTimeout']});
      f.slowLooks();
      f.begin('read -s REPLY');
      f.type(SECRET);
      f.enter();
      t.mock.timers.tick(when === 'while the look runs' ? 100 : BOUND_MS);
      f.app['onInput']('\u0003');
      assert.equal(f.interrupts(), 1, `${when}: Ctrl+C is never held`);
      f.nowhere(SECRET, when);
      assert.deepEqual(f.written, [], `${when}: the held typing never reached the program`);
      assert.equal(f.app['queueState'].entries.length, 0, `${when}: nothing waits in the queue to be resumed`);
      assert.doesNotMatch(f.screen(), HELD);
      // The look answering afterwards changes nothing.
      f.settle('hidden');
      await settled();
      assert.deepEqual(f.written, []);
    } finally { f.dispose(); }
  }
});
