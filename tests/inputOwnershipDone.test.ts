import test from 'node:test';
import assert from 'node:assert/strict';
import type {QueueOp} from '../src/session/CommandQueue.js';
import {InputWatch} from '../src/session/InputWatch.js';
import type {InputRequest, InputState, LookResult} from '../src/session/inputState.js';
import type {TerminalSample} from '../src/session/terminalProbe.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #426 (#433) with #436 (#437). Keys typed while NMSh cannot yet tell who reads them are held for a look; the shell's
 * `done` marker says the command finished while its prompt hooks still run, before the prompt itself arrives. Held
 * typing must then settle as typing for a command that ended: a possible password or a reply is discarded, never
 * shown, queued, sent or run; only plain type-ahead is kept for the next command. Evidence of hidden input is never
 * lost because the command finished during the look. Stale questions, interrupts, process exit and observations
 * that arrive late change none of this.
 *
 * Deterministic: looks are promises the test settles, samples are given by the test, timers are mocked. No shell runs.
 */

const SECRET = 'QSECRETQ';
const SLOW_MS = 800;
const hiddenModes = {canonical: true, echo: false, signals: true};
const lineModes = {canonical: true, echo: true, signals: true};
const settled = () => new Promise(done => setImmediate(done));
const turns = async () => { for (let index = 0; index < 4; index += 1) await Promise.resolve(); };

// ------------------------------------------------------------------ the session's watch

function watchWith(probe: () => Promise<TerminalSample>) {
  let probes = 0;
  const changes: InputState[] = [];
  const watch = new InputWatch({probe: () => { probes += 1; return probe(); }, tty: () => '/dev/ttys9'});
  watch.on('change', state => changes.push(state));
  return {watch, changes, probes: () => probes};
}

test('watch: once the shell says the command is done, a look answers idle and never probes', async () => {
  const {watch, changes, probes} = watchWith(async () => ({modes: lineModes, foreground: [{pid: 1, state: 'S+', cpuMs: 1, command: 'make'}]}));
  try {
    watch.onExec('make', 0);
    watch.onDone(10);
    assert.equal(await watch.lookNow(), 'idle', 'the shell owns typing again');
    assert.equal(probes(), 0, 'its prompt hooks are not sampled');
    assert.ok(changes.every(state => !state.request));
  } finally { watch.dispose(); }
});

test('watch: hidden input seen by a look that the command finished during is still reported hidden, never applied', async () => {
  let resolve!: (sample: TerminalSample) => void;
  const {watch, changes} = watchWith(() => new Promise<TerminalSample>(done => { resolve = done; }));
  try {
    watch.onExec('read -rs -t 1 pw', 0);
    const looking = watch.lookNow();
    await turns();
    // The read gave up and the shell's hooks began while the probe was under way; the probe had seen echo off.
    watch.onDone(50);
    resolve({modes: hiddenModes, foreground: [{pid: 1, state: 'S+', cpuMs: 1, command: 'zsh'}]});
    assert.equal(await looking, 'hidden', 'the evidence of a possible password is not dropped');
    assert.equal(watch.state.request, undefined, 'but no question is reported for a command that finished');
    assert.ok(changes.every(state => !state.request));
    assert.equal(await watch.lookNow(), 'idle', 'a later look says the command is over');
  } finally { watch.dispose(); }
});

test('watch: visible evidence from a look the command finished during answers idle; the next command is watched again', async () => {
  let resolve!: (sample: TerminalSample) => void;
  const {watch, changes, probes} = watchWith(() => new Promise<TerminalSample>(done => { resolve = done; }));
  try {
    watch.onExec('make', 0);
    const looking = watch.lookNow();
    await turns();
    watch.onDone(50);
    // A slow prompt hook: line settings, echo on, the shell holding its terminal (zsh and Bash show exactly this).
    resolve({modes: lineModes, foreground: [{pid: 1, state: 'Ss+', cpuMs: 1, command: 'zsh'}]});
    assert.equal(await looking, 'idle');
    assert.equal(watch.state.request, undefined, 'a hook is never a question');
    assert.ok(changes.every(state => !state.request));
    watch.onPrompt(60);
    watch.onExec('read -s x', 70);
    const next = watch.lookNow();
    await turns();
    resolve({modes: hiddenModes, foreground: [{pid: 2, state: 'S+', cpuMs: 1, command: 'zsh'}]});
    assert.equal(await next, 'hidden', 'the next command is looked at afresh');
    assert.equal(probes(), 2);
  } finally { watch.dispose(); }
});

// ------------------------------------------------------------------ the frontend's hold

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
  /** Nothing anywhere a person, a log or the shell could read holds the secret. */
  const nowhere = (secret: string, what: string) => {
    assert.equal(screen().includes(secret), false, `${what}: not on screen`);
    assert.equal(text().includes(secret), false, `${what}: not in the composer`);
    assert.equal(adds().some(entry => entry.includes(secret)), false, `${what}: not queued`);
    assert.equal(submitted.some(entry => entry.includes(secret)), false, `${what}: not run as a command`);
    assert.equal(written.some(entry => entry.includes(secret)), false, `${what}: not written to the terminal`);
    assert.equal(transcript().includes(secret), false, `${what}: not in the transcript`);
  };
  return {...frame, written, submitted, type, text, adds, screen, transcript, state, nowhere,
    enter: () => frame.app['onInput']('\r'), interrupts: () => interrupts, looks: () => looks,
    answer: (result: LookResult | undefined) => settle(result)};
}

test('done before the prompt: a reply the look saw as hidden is discarded, never drawn, queued, sent or run', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -rs -t 1 pw');
    f.type(SECRET);
    f.enter();
    f.nowhere(SECRET, 'held');
    // The look saw echo off, but the read had already given up: no question ever arrives; then the shell says done.
    f.answer('hidden');
    await settled();
    assert.equal(f.looks(), 2, 'hidden with no question: one more look');
    f.nowhere(SECRET, 'looking again');
    f.answer('idle');
    await settled();
    f.nowhere(SECRET, 'after done');
    assert.match(f.transcript(), /discarded, not run/u, 'a note says what happened, without the text');
    f.complete(1);
    await settled();
    f.nowhere(SECRET, 'after the prompt');
    assert.deepEqual(f.adds(), []);
    assert.deepEqual(f.submitted, []);
  } finally { f.dispose(); }
});

test('done before the prompt: typing held past the slow mark is discarded, never run', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('./deploy.sh');
    f.type('yes');
    f.enter();
    t.mock.timers.tick(SLOW_MS + 100);
    f.answer('idle');
    await settled();
    assert.equal(f.text(), '', 'not left in the composer');
    assert.deepEqual(f.adds(), [], 'not queued');
    f.complete(0);
    await settled();
    assert.deepEqual(f.submitted, [], 'never run: NMSh never learned whether it was a reply');
    assert.deepEqual(f.written, []);
    assert.match(f.transcript(), /discarded, not run/u);
  } finally { f.dispose(); }
});

test('done before the prompt: plain type-ahead the look answered quickly is kept for the next command, once', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('make');
    f.type('echo next');
    f.answer('idle');
    await settled();
    assert.equal(f.text(), 'echo next', 'the next command\'s draft, visible');
    assert.deepEqual(f.written, [], 'nothing went to the program that finished');
    f.complete(0);
    await settled();
    assert.equal(f.text(), 'echo next', 'it survives the prompt');
    f.enter();
    assert.deepEqual(f.submitted, ['echo next'], 'and runs once, on the person\'s Enter');
    assert.deepEqual(f.adds(), []);
    assert.deepEqual(f.written, []);
  } finally { f.dispose(); }
});

test('type-ahead after answering a hidden question is kept when the command ends, though a look still sees that question', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -s x');
    f.state({since: Date.now(), confidence: 'confirmed', mode: 'hidden'});
    f.tick(200);
    f.type(SECRET);
    f.enter();
    assert.equal(f.written.join(''), `${SECRET}\r`, 'the answer went to the hidden read');
    f.tick(20);
    // The next command, typed at once: the read has its answer but has not returned yet.
    f.type('echo NEXT');
    f.enter();
    // A look still sees the question just answered (echo off), then the shell says the command is done.
    f.answer('hidden');
    await settled();
    f.answer('idle');
    await settled();
    f.complete(0);
    await settled();
    assert.deepEqual(f.adds(), ['echo NEXT'], 'the type-ahead runs next, once; it is not discarded');
    f.nowhere(SECRET, 'the answer itself');
  } finally { f.dispose(); }
});

test('interrupt: Ctrl+C discards held typing; done, a late answer and a stale question after it change nothing', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -rs pw');
    const asked = Date.now();
    f.tick(200);
    f.type(SECRET);
    f.enter();
    f.app['onInput']('\u0003');
    f.tick(20);
    assert.equal(f.interrupts(), 1);
    f.nowhere(SECRET, 'after Ctrl+C');
    // The interrupted read's late evidence: the look answers, and the question it ended is reported after the stop.
    f.answer('hidden');
    f.state({since: asked, confidence: 'confirmed', mode: 'hidden'});
    await settled();
    f.nowhere(SECRET, 'after the late reports');
    // What is typed after Ctrl+C is type-ahead for the prompt: never held, never routed to the read that ended.
    f.type('echo Y');
    f.state();
    f.complete(130);
    await settled();
    assert.equal(f.text(), 'echo Y');
    f.enter();
    assert.deepEqual(f.submitted, ['echo Y']);
    assert.deepEqual(f.written, []);
    f.nowhere(SECRET, 'at the end');
  } finally { f.dispose(); }
});

test('process exit with the look unanswered, then late evidence: nothing reaches the next prompt or the next command', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('sudo -k true', 'Password:');
    f.type(SECRET);
    f.enter();
    t.mock.timers.tick(SLOW_MS + 100);
    f.complete(1);
    await settled();
    f.nowhere(SECRET, 'after exit');
    assert.match(f.transcript(), /discarded, not run/u);
    // The old look answers after the command is gone, then a new command starts: neither sees the old typing.
    f.answer('hidden');
    await settled();
    f.begin('cat');
    f.state({since: Date.now(), confidence: 'likely', mode: 'line'});
    await settled();
    f.nowhere(SECRET, 'after the late answer and the next command');
    assert.deepEqual(f.written, []);
  } finally { f.dispose(); }
});
