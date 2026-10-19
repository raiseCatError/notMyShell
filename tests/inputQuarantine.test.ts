import test from 'node:test';
import assert from 'node:assert/strict';
import type {QueueOp} from '../src/session/CommandQueue.js';
import type {InputRequest, LookResult} from '../src/session/inputState.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #426, final v0.22 hardening: input ownership, not the vocabulary of what was typed.
 *
 * A line entered with a plain Enter while a command runs, and NMSh has no evidence that the command asks, may be the
 * reply to a read NMSh never saw (a timed read that gave up between looks, any program's read on macOS). Whether the
 * text looks like a command says nothing about that: `yes`, `sudo`, `ls`, a one-time code and an assignment are all
 * valid replies. Such a line is quarantined: a queue entry the owner never runs without the person's approval, shown
 * as "typed while <program> ran" rather than by its text. Ctrl+Q is the explicit way to queue a command to run after.
 *
 * Deterministic: looks are promises the test settles; clock and timers are the test's. No shell runs.
 */

const SECRET = 'QZSECRETZQ';
const REPLIES = ['yes', 'sudo', 'ls', '123456', 'X=1', 'hello world', SECRET];
const settled = () => new Promise(done => setImmediate(done));

function fixture(features?: string[]) {
  const frame = executionFrameFixture(110, 30);
  if (features) Object.defineProperty(frame.session, 'features', {value: new Set(features), configurable: true});
  const written: string[] = [];
  const queueOps: QueueOp[] = [];
  const submitted: string[] = [];
  const dispatched: string[] = [];
  Object.defineProperty(frame.session, 'write', {value: (data: string) => { written.push(data); }, configurable: true});
  Object.defineProperty(frame.session, 'interrupt', {value: () => {}, configurable: true});
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
  const screen = () => frame.capture().frame.rows.map(line => stripAnsi(line)).join('\n');
  const transcript = () => (frame.app['output'].transcript().lines as Array<Array<{text?: string} | null>>)
    .map(line => line.map(cell => cell?.text ?? ' ').join('')).join('\n');
  const state = (request?: InputRequest) => frame.session.emit('inputState', {...(request ? {request} : {}), timing: {waitedMs: 0, waits: 0}});
  const recalled = () => (frame.app['sessionSubmissions'] as Array<{text: string}>).map(item => item.text);
  const entry = (line: string) => frame.owner.state.entries.find(item => item.text === line);
  /** A line typed with the look answering, then a plain Enter (the look answers again). */
  const typeLine = async (line: string, result: LookResult | undefined = 'visible') => {
    type(line);
    settle(result); await settled();
    frame.app['onInput']('\r');
    settle(result); await settled();
  };
  return {...frame, written, submitted, dispatched, queueOps, type, text, screen, transcript, state, recalled, entry, typeLine,
    key: (data: string) => frame.app['onInput'](data), enter: () => frame.app['onInput']('\r'),
    looks: () => looks, answer: (result: LookResult | undefined) => settle(result)};
}

for (const reply of REPLIES) {
  test(`quarantine: "${reply}" entered while a command runs, before a read NMSh never saw: never runs, even when the command succeeds`, async t => {
    const f = fixture();
    try {
      t.mock.timers.enable({apis: ['setTimeout']});
      f.begin('sleep 1; read -t 1 QA_REPLY || true');
      await f.typeLine(reply);
      const held = f.entry(reply);
      assert.equal(held?.condition, 'approve', 'it waits for approval, whatever it looks like');
      assert.equal(held?.typedWhile, 'sleep', 'the owner knows it was typed while sleep ran');
      assert.equal(f.written.some(data => data.includes(reply)), false, 'not written to the terminal');
      assert.equal(f.recalled().includes(reply), false, 'not offered by Up as a command typed this session');
      assert.match(f.transcript(), /never runs by itself/u, 'a note says why');
      // No question was ever reported: the read gave up unseen, and the command succeeded.
      f.tick(1500);
      f.complete(0); await settled();
      assert.deepEqual(f.dispatched, [], 'never run after the command');
      assert.deepEqual(f.submitted, [], 'never submitted from the composer');
    } finally { f.dispose(); }
  });
}

test('quarantine: the held line is shown by where it came from, never by its text, in the queue row, the list and the note', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('sleep 1; read -t 1 QA_REPLY || true');
    await f.typeLine(SECRET);
    assert.equal(f.screen().includes(SECRET), false, 'while the command runs');
    assert.equal(f.transcript().includes(SECRET), false, 'the note never repeats the text');
    f.complete(0); await settled();
    assert.equal(f.screen().includes(SECRET), false, 'at the prompt');
    assert.match(f.screen(), /typed while sleep ran/u, 'it says where it came from');
  } finally { f.dispose(); }
});

test('quarantine: approving is explicit and needs no display; Tab shows the text, Enter runs it once', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('sleep 1');
    await f.typeLine('echo NEXT-QZ');
    f.complete(0); await settled();
    assert.deepEqual(f.dispatched, []);
    // Enter at the empty composer arms the review; nothing runs from one key.
    f.enter();
    assert.deepEqual(f.dispatched, []);
    assert.equal(f.screen().includes('echo NEXT-QZ'), false, 'the review does not show it by itself');
    f.key('\t');
    assert.match(f.screen(), /echo NEXT-QZ/u, 'Tab shows it');
    f.tick(1000);
    f.enter();
    await settled();
    assert.deepEqual(f.dispatched, ['echo NEXT-QZ'], 'approved, it runs once');
  } finally { f.dispose(); }
});

test('Ctrl+Q is the explicit run-after: a command queued with it while one runs runs after it succeeds, with no approval', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('sleep 1');
    f.type('echo AFTER');
    f.answer('visible'); await settled();
    f.key('\u0011');
    assert.equal(f.entry('echo AFTER')?.condition, undefined);
    assert.equal(f.entry('echo AFTER')?.typedWhile, undefined);
    f.complete(0); await settled();
    assert.deepEqual(f.dispatched, ['echo AFTER']);
  } finally { f.dispose(); }
});

test('the composer says where Enter sends a line while a command runs: held for approval, Ctrl+Q runs it after', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('make');
    assert.match(f.screen(), /Enter holds it for approval · Ctrl\+Q runs it after · Ctrl\+S sends to make/u);
  } finally { f.dispose(); }
});

test('a reply while a question is shown still goes to the program, not the queue', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -r QA_REPLY');
    f.state({since: Date.now(), confidence: 'likely', mode: 'line'});
    f.type('yes');
    f.enter();
    assert.equal(f.written.join(''), 'yes\r');
    assert.deepEqual(f.owner.state.entries, []);
  } finally { f.dispose(); }
});

test('typing held for a look while the command ended: its Enter was pressed while the command ran, so it is held, not run', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('sleep 1; read -t 1 QA_REPLY || true');
    f.type('yes');
    f.enter();
    // The command ends while the look is still out; the look then says nothing runs.
    f.complete(0); await settled();
    f.answer('idle'); await settled();
    assert.deepEqual(f.submitted, [], 'not submitted at the prompt');
    assert.deepEqual(f.dispatched, []);
    assert.equal(f.entry('yes')?.condition, 'approve', 'held for approval');
  } finally { f.dispose(); }
});

test('right after Ctrl+C: a command typed for the prompt is held until the prompt is back, then runs once, in order', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -r reply');
    f.key('\u0003');
    f.tick(50);
    f.type('ls -la');
    f.enter();
    assert.equal(f.written.some(data => data.includes('ls -la')), false, 'not written while the stopped command still owns the terminal');
    assert.deepEqual(f.submitted, []);
    f.complete(130); await settled();
    assert.deepEqual(f.submitted, ['ls -la'], 'runs at the verified prompt');
    assert.deepEqual(f.dispatched, []);
  } finally { f.dispose(); }
});

test('right after Ctrl+C, the program keeps running and asks: the line is its reply, never a command', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('trap "" INT; read -r reply');
    f.key('\u0003');
    f.tick(50);
    f.type('yes');
    f.enter();
    f.tick(400);
    // A question asked after the stop: the program is still there and reads.
    f.state({since: Date.now(), confidence: 'likely', mode: 'line'});
    await settled();
    assert.equal(f.written.join(''), 'yes\r', 'it reaches the program that asked');
    f.complete(0); await settled();
    assert.deepEqual(f.submitted, []);
    assert.deepEqual(f.dispatched, []);
  } finally { f.dispose(); }
});

test('right after Ctrl+C, the program survives and nothing NMSh can see asks: when the stop window ends the line goes to it, as a terminal would', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('trap "" INT; sleep 5; read -t 1 r');
    f.key('\u0003');
    f.tick(50);
    f.type('123456');
    f.enter();
    assert.equal(f.written.some(data => data.includes('123456')), false, 'not during the window');
    f.tick(2500);
    t.mock.timers.tick(2500);
    await settled();
    // The program survived: it gets the line (on macOS NMSh cannot see a read after Ctrl+C echoed ^C onto its line).
    // If it never reads it, the shell takes it back when the command ends and the owner holds it (unreadInputLive).
    assert.equal(f.written.join(''), '123456\r');
    assert.deepEqual(f.owner.state.entries, []);
    f.complete(0); await settled();
    assert.deepEqual(f.submitted, []);
    assert.deepEqual(f.dispatched, []);
  } finally { f.dispose(); }
});

test('right after Ctrl+C, a question was seen and then the command ended: the line is held, not run', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('trap "exit 0" INT; read -r reply');
    f.key('\u0003');
    f.tick(50);
    f.state({since: Date.now(), confidence: 'likely', mode: 'line'});
    f.state();
    f.type('yes');
    f.enter();
    f.complete(0); await settled();
    assert.deepEqual(f.submitted, []);
    assert.equal(f.entry('yes')?.condition, 'approve');
  } finally { f.dispose(); }
});

test('an older session service that cannot say what a look saw: typing while a command runs stays held, not drawn', async t => {
  const f = fixture(['shell-switch', 'shell-backends', 'notices', 'input-state', 'queue', 'queue-conditions', 'background-tasks', 'input-look', 'queue-timeline', 'queue-history']);
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('sudo -k true');
    f.type(SECRET);
    f.answer(undefined); await settled();
    f.answer(undefined); await settled();
    assert.equal(f.text(), '', 'not in the composer');
    assert.equal(f.screen().includes(SECRET), false, 'not drawn');
    assert.match(f.screen(), /held, not shown/u);
    // Ctrl+S is the person's explicit choice to send it.
    f.key('\u0013');
    assert.equal(f.written.join(''), SECRET);
  } finally { f.dispose(); }
});

test('typing the command never read, held by the owner at its end, is announced without its text and waits for approval', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -t 1 code; sleep 2');
    // The owner drained a line the program never read and holds it (see shellSession tests); the frontend only sees the entry.
    f.owner.holdUnread(`${SECRET}\r`, 'read');
    f.complete(0); await settled();
    assert.equal(f.owner.state.entries[0]?.condition, 'approve');
    assert.equal(f.screen().includes(SECRET), false);
    assert.match(f.transcript(), /did not read/u);
    assert.equal(f.transcript().includes(SECRET), false);
    assert.deepEqual(f.dispatched, []);
  } finally { f.dispose(); }
});

test('a held line at the head of the queue never holds the prompt: a command submitted there runs now', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('sleep 1');
    await f.typeLine('yes');
    f.complete(0); await settled();
    f.type('echo NOW');
    f.enter();
    assert.deepEqual(f.submitted, ['echo NOW'], 'submitted at the prompt, not queued behind the held line');
    assert.equal(f.owner.state.entries.length, 1, 'the held line still waits');
  } finally { f.dispose(); }
});

test('a line started after the shell said the command is done (its prompt hooks still run) is type-ahead: it runs once at the prompt', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('true');
    // The command is over (the shell's done marker); a slow prompt hook holds the prompt back.
    f.session.emit('inputState', {done: true, timing: {waitedMs: 0, waits: 0}});
    f.type('echo after');
    f.answer('idle'); await settled();
    f.enter();
    f.answer('idle'); await settled();
    // Longer than the Ctrl+C window: a slow hook is not a stop, and nothing settles by time.
    f.tick(3000); t.mock.timers.tick(3000); await settled();
    assert.deepEqual(f.owner.state.entries, [], 'not held for approval');
    assert.equal(f.written.some(data => data.includes('echo after')), false, 'never written before the prompt');
    f.complete(0); await settled();
    assert.deepEqual(f.submitted, ['echo after'], 'runs once, at the verified prompt');
  } finally { f.dispose(); }
});

test('a line started while the command still ran, entered after it said done: held for approval, never run at the prompt', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -t 1 code; sleep 2');
    f.type('123456');
    f.answer('visible'); await settled();
    // Done arrives after the line was begun: a reply to the read that just gave up, perhaps.
    f.session.emit('inputState', {done: true, timing: {waitedMs: 0, waits: 0}});
    f.enter();
    f.answer('idle'); await settled();
    f.complete(0); await settled();
    assert.deepEqual(f.submitted, []);
    assert.equal(f.entry('123456')?.condition, 'approve');
  } finally { f.dispose(); }
});

test('right after Ctrl+C, the program kept reading the question it asked before the stop: when the window ends the line is its answer', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin("trap '' INT; read -r -p 'Still here? ' a");
    const asked = Date.now();
    f.state({since: asked, confidence: 'likely', mode: 'line'});
    f.tick(500);
    f.key('\u0003');
    f.tick(20);
    f.type('yes');
    f.enter();
    // The session reports the same question again (sampled around the stop), after the Enter: held back during the
    // window, whatever order the two timers have.
    f.tick(20);
    f.state({since: asked, confidence: 'likely', mode: 'line'});
    assert.deepEqual(f.written, [], 'nothing written during the stop window');
    f.tick(2500); t.mock.timers.tick(2500); await settled();
    assert.equal(f.written.join(''), 'yes\r', 'the program kept reading: the line is its answer');
    assert.deepEqual(f.owner.state.entries, []);
  } finally { f.dispose(); }
});

test('a stale report of the hidden question just answered never sends the next command\'s keys to the program', async t => {
  const f = fixture();
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.begin('read -s pw; echo done');
    const since = Date.now();
    f.state({since, confidence: 'confirmed', mode: 'hidden'});
    f.tick(200);
    f.type('pw');
    f.enter();
    assert.equal(f.written.join(''), 'pw\r', 'the answer went to the program');
    // The session sampled the question before it saw the Enter; that report arrives now.
    f.state({since, confidence: 'confirmed', mode: 'hidden'});
    f.type('echo NEXT');
    assert.equal(f.written.join(''), 'pw\r', 'not one key of the next command went to the program as a hidden reply');
    // A new question (asked after the answer) still gets typing directly.
    f.tick(300);
    f.state({since: Date.now(), confidence: 'confirmed', mode: 'hidden'});
  } finally { f.dispose(); }
});
