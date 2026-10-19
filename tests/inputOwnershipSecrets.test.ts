import test from 'node:test';
import assert from 'node:assert/strict';
import type {QueueOp} from '../src/session/CommandQueue.js';
import type {InputRequest, LookResult} from '../src/session/inputState.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #426 security review for the v0.22 release: hidden replies (passwords) next to the timing NMSh cannot observe.
 *
 * After NMSh sends a hidden answer, a look can still see hidden input: the question just answered (its read has not
 * returned yet) or a second question asked with no prompt. NMSh cannot tell these apart, and a time window after the
 * answer is not a security boundary. So typing that began while a look saw hidden input is never run by itself:
 * a question NMSh then sees gets it as its reply, and a command that ends first leaves it held, hidden, at the prompt
 * until the person chooses (Tab shows it, Esc discards it). A reply typed and entered before a question with no prompt
 * existed is queued like any command (NMSh could not know); once the command asks for hidden input, such entries wait
 * for approval instead of running after it.
 *
 * Deterministic: looks are promises the test settles, the clock and timers are the test's. No shell runs.
 */

const SECRET = 'QSECRETQ';
const SLOW_MS = 800;
const TAB = '\t';
const settled = () => new Promise(done => setImmediate(done));
const HELD = /held, not run · Tab shows it · Esc discards it/u;

function fixture() {
  const frame = executionFrameFixture(110, 30);
  const written: string[] = [];
  const queueOps: QueueOp[] = [];
  const submitted: string[] = [];
  const dispatched: string[] = [];
  let interrupts = 0;
  Object.defineProperty(frame.session, 'write', {value: (data: string) => { written.push(data); }, configurable: true});
  Object.defineProperty(frame.session, 'interrupt', {value: () => { interrupts += 1; }, configurable: true});
  // The session's real queue: entries added here are what the session would run after the command.
  Object.defineProperty(frame.session, 'queue', {value: (op: QueueOp) => { queueOps.push(op); frame.owner.request(op); }, configurable: true});
  frame.owner.on('state', (_state, news) => { if (news.dispatched) dispatched.push(news.dispatched.text); });
  Object.defineProperty(frame.app, 'submit', {value: async () => { submitted.push(frame.app['editor'].text); frame.app['editor'].clear(); }, configurable: true});
  let looks = 0;
  let settle: (result: LookResult | undefined) => void = () => {};
  Object.defineProperty(frame.session, 'lookInput', {value: () => {
    looks += 1;
    return new Promise<LookResult | undefined>(resolve => { settle = resolve; });
  }, configurable: true});
  const type = (text: string) => { for (const char of text) frame.app['onInput'](char); };
  const text = () => frame.app['editor'].text as string;
  const adds = () => queueOps.filter(op => op.op === 'add').map(op => (op as {text: string}).text);
  const screen = () => frame.capture().frame.rows.map(line => stripAnsi(line)).join('\n');
  const transcript = () => (frame.app['output'].transcript().lines as Array<Array<{text?: string} | null>>)
    .map(line => line.map(cell => cell?.text ?? ' ').join('')).join('\n');
  const state = (request?: InputRequest) => frame.session.emit('inputState', {...(request ? {request} : {}), timing: {waitedMs: 0, waits: 0}});
  const hidden = () => state({since: Date.now(), confidence: 'confirmed', mode: 'hidden'});
  /** Never run as a command: not submitted, not dispatched from the queue, not written to the shell. */
  const neverRun = (secret: string, what: string) => {
    assert.equal(submitted.some(entry => entry.includes(secret)), false, `${what}: not run from the composer`);
    assert.equal(dispatched.some(entry => entry.includes(secret)), false, `${what}: not run from the queue`);
  };
  /** Nothing anywhere a person, a log or the shell could read holds the secret. */
  const nowhere = (secret: string, what: string) => {
    neverRun(secret, what);
    assert.equal(screen().includes(secret), false, `${what}: not on screen`);
    assert.equal(text().includes(secret), false, `${what}: not in the composer`);
    assert.equal(adds().some(entry => entry.includes(secret)), false, `${what}: not queued`);
    assert.equal(written.some(entry => entry.includes(secret)), false, `${what}: not written to the terminal`);
    assert.equal(transcript().includes(secret), false, `${what}: not in the transcript`);
  };
  /** Answer a hidden question NMSh reported, as the person types it. */
  const answerHidden = (reply: string) => {
    hidden();
    frame.tick(200);
    type(reply);
    frame.app['onInput']('\r');
    assert.equal(written.join('').endsWith(`${reply}\r`), true, 'the answer went to the hidden question');
  };
  return {...frame, written, submitted, dispatched, type, text, adds, screen, transcript, state, hidden, neverRun, nowhere, answerHidden,
    key: (data: string) => frame.app['onInput'](data), enter: () => frame.app['onInput']('\r'),
    interrupts: () => interrupts, looks: () => looks, answer: (result: LookResult | undefined) => settle(result)};
}

/** Consecutive questions with no prompt: the second gives up (a timed read) before NMSh could report it. */
async function secondReplyHeldAtPrompt(f: ReturnType<typeof fixture>, reply: string) {
  f.begin('read -s a; read -s -t 1 b');
  f.answerHidden('first');
  f.tick(20);
  // Typed at once for the second question, which has no prompt; NMSh has not reported it.
  f.type(reply);
  f.enter();
  f.nowhere(reply, 'held');
  // The look sees echo off: the answered question or the new one, NMSh cannot tell.
  f.answer('hidden');
  await settled();
  assert.equal(f.looks(), 2, 'hidden input with no question reported: one more look');
  // The second read gives up; the shell says the command is done.
  f.tick(500);
  f.answer('idle');
  await settled();
  f.complete(1);
  await settled();
}

test('consecutive hidden questions with no prompt: a reply the second one never took is not run, shown or queued; it waits at the prompt', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    await secondReplyHeldAtPrompt(f, SECRET);
    f.nowhere(SECRET, 'at the prompt');
    assert.match(f.screen(), HELD, 'the composer says typing is held and how to choose');
    // Held is not lost to time: no timer settles it.
    t.mock.timers.tick(60_000);
    await settled();
    f.nowhere(SECRET, 'a minute later');
    assert.match(f.screen(), HELD);
    // (A lone ESC byte waits in the key decoder for a possible sequence; the key itself is what Esc delivers.)
    f.app['handleKey']({kind: 'escape'});
    f.nowhere(SECRET, 'after Esc');
    assert.doesNotMatch(f.screen(), HELD);
    assert.match(f.transcript(), /discarded, not sent or run/u, 'a note says what happened, without the text');
  } finally { f.dispose(); }
});

test('typing held at the prompt is the person\'s to show: Tab puts it in the composer, never run until their own Enter', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    await secondReplyHeldAtPrompt(f, 'echo NEXT');
    f.neverRun('echo NEXT', 'held');
    assert.equal(f.text(), '', 'not drawn');
    f.key(TAB);
    assert.equal(f.text(), 'echo NEXT', 'shown for review, without its Enter');
    f.neverRun('echo NEXT', 'shown');
    f.enter();
    assert.deepEqual(f.submitted, ['echo NEXT'], 'an ordinary command is never lost; it runs once, on the person\'s Enter');
  } finally { f.dispose(); }
});

test('typing held at the prompt: more keys stay held, Ctrl+C discards it all, and nothing reaches the shell or the debug key log', async t => {
  const f = fixture();
  const logged: string[] = [];
  const saved = process.env.NMSH_DEBUG_KEYS;
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    Object.defineProperty(f.app, 'logEditorKeyInput', {value: (data: string) => { logged.push(data); }, configurable: true});
    process.env.NMSH_DEBUG_KEYS = '1';
    await secondReplyHeldAtPrompt(f, SECRET);
    f.type('MORE');
    f.enter();
    f.nowhere(SECRET, 'more keys');
    f.nowhere('MORE', 'more keys');
    assert.match(f.screen(), HELD);
    f.key('\u0003');
    f.nowhere(SECRET, 'after Ctrl+C');
    f.nowhere('MORE', 'after Ctrl+C');
    assert.doesNotMatch(f.screen(), HELD);
    assert.equal(logged.join('').includes(SECRET) || logged.join('').includes('MORE'), false, 'held keys are never logged');
  } finally {
    if (saved === undefined) delete process.env.NMSH_DEBUG_KEYS; else process.env.NMSH_DEBUG_KEYS = saved;
    f.dispose();
  }
});

test('typing held at the prompt never reaches the next command (one started from the queue), and late looks change nothing', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    await secondReplyHeldAtPrompt(f, SECRET);
    f.begin('make');
    f.answer('visible');
    f.state({since: Date.now(), confidence: 'likely', mode: 'line'});
    await settled();
    f.nowhere(SECRET, 'while the next command runs and asks');
    f.complete(0);
    await settled();
    f.nowhere(SECRET, 'after it');
    assert.match(f.screen(), HELD, 'still the person\'s to choose');
  } finally { f.dispose(); }
});

test('a second hidden question NMSh sees while the reply is held gets it, never drawn', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -s a; read -s b');
    f.answerHidden('first');
    f.tick(20);
    f.type(SECRET);
    f.enter();
    f.answer('hidden');
    await settled();
    f.tick(300);
    f.hidden();
    await settled();
    // Keys reach a hidden question one by one, as a terminal sends them.
    assert.equal(f.written.join(''), `first\r${SECRET}\r`, 'the second question gets its reply, once, in order');
    f.complete(0);
    await settled();
    f.neverRun(SECRET, 'after');
    assert.equal(f.screen().includes(SECRET) || f.text().includes(SECRET) || f.adds().some(entry => entry.includes(SECRET)), false);
    assert.doesNotMatch(f.screen(), HELD);
  } finally { f.dispose(); }
});

test('an ordinary command typed after a hidden answer, once the terminal echoes again, is type-ahead: never held, never discarded', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('sudo -k make install', 'Password:');
    f.answerHidden('pw');
    f.state();
    f.tick(300);
    f.type('make test');
    f.answer('visible');
    await settled();
    assert.equal(f.text(), 'make test', 'drawn as the next command');
    f.enter();
    f.answer('visible');
    await settled();
    assert.deepEqual(f.adds(), ['make test'], 'queued for after the command');
    f.complete(0);
    await settled();
    assert.deepEqual(f.dispatched, ['make test'], 'and runs after it, once');
    assert.doesNotMatch(f.screen(), HELD);
  } finally { f.dispose(); }
});

test('a reply typed before a later hidden question with no prompt is queued (NMSh could not know), then waits for approval, never running by itself', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -s a; sleep 2; read -s b');
    f.answerHidden('first');
    // The read returned; the command works with the terminal echoing; nothing asks.
    f.state();
    f.tick(1500);
    f.type(SECRET);
    f.answer('visible');
    await settled();
    f.enter();
    f.answer('visible');
    await settled();
    assert.deepEqual(f.adds(), [SECRET], 'queued like any command typed while one runs (documented limit)');
    // The second question, with no prompt: from now on that entry may be its reply.
    f.tick(500);
    f.hidden();
    await settled();
    const entry = f.owner.state.entries.find(item => item.text === SECRET);
    assert.equal(entry?.condition, 'approve', 'it waits for approval');
    assert.match(f.transcript(), /hidden input/u, 'a note says why, without the text');
    assert.equal(f.transcript().includes(SECRET), false);
    // The person answers the question again; the command succeeds: the entry still does not run.
    f.type('second');
    f.enter();
    f.complete(0);
    await settled();
    f.neverRun(SECRET, 'after the command succeeded');
  } finally { f.dispose(); }
});

test('entries queued before the command started are the person\'s plan: a hidden question leaves them as they were', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    // Both queued while an earlier command ran; the first then runs and asks for a password.
    f.begin('make build');
    f.app['session'].queue({op: 'add', text: 'sudo -k make install'});
    f.app['session'].queue({op: 'add', text: 'make test'});
    f.tick(100);
    f.complete(0);
    await settled();
    assert.deepEqual(f.dispatched, ['sudo -k make install']);
    f.tick(10);
    f.begin('sudo -k make install', 'Password:');
    f.tick(100);
    f.hidden();
    await settled();
    assert.equal(f.owner.state.entries.find(item => item.text === 'make test')?.condition, undefined);
  } finally { f.dispose(); }
});

test('a command queued with Ctrl+Q while the hidden question is shown is the person\'s: re-reports of that question leave it', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('sudo -k make install', 'Password:');
    f.tick(100);
    const asked = {since: Date.now(), confidence: 'likely', mode: 'hidden'} as const;
    f.state(asked);
    await settled();
    // Ctrl+Q: the composer takes the next command for the queue; the program never sees those keys.
    f.key('\u0011');
    f.type('make test');
    f.enter();
    assert.deepEqual(f.adds(), ['make test']);
    // The same question, reported again (the watch's confidence changes as it samples).
    f.tick(500);
    f.state({...asked, confidence: 'confirmed'});
    await settled();
    assert.equal(f.owner.state.entries.find(item => item.text === 'make test')?.condition, undefined, 'not made to wait for approval');
    assert.doesNotMatch(f.transcript(), /asked for hidden input/u);
  } finally { f.dispose(); }
});

test('a look slower than the slow mark after a hidden answer, then the command ends: the typing is discarded, never shown or run', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -s a; read -s -t 1 b');
    f.answerHidden('first');
    f.tick(20);
    f.type(SECRET);
    f.enter();
    t.mock.timers.tick(SLOW_MS + 100);
    f.answer('idle');
    await settled();
    f.complete(1);
    await settled();
    f.nowhere(SECRET, 'after the slow look');
    assert.match(f.transcript(), /discarded, not run/u);
  } finally { f.dispose(); }
});
