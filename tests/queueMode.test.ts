import test from 'node:test';
import assert from 'node:assert/strict';
import type {QueueOp} from '../src/session/CommandQueue.js';
import type {InputState, LookResult} from '../src/session/inputState.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * Queue Mode: an explicit, per-window choice that Enter queues while a command runs. A line entered then is the
 * person's next command, shown as typed and run after the current one without an approval step, as Ctrl+Q does.
 * Input ownership is unchanged: typing is still looked at before it is drawn, a program NMSh sees waiting for input
 * gets Enter, hidden input is never drawn or queued, and a look that cannot tell keeps the typing held.
 *
 * Deterministic: every key goes through the real TerminalApp key handler; looks answer as the test says.
 */

const SECRET = 'QSECRETQ';
const CTRL_Q = '\u0011';

function fixture(queueMode = false) {
  const frame = executionFrameFixture(110, 30);
  frame.app['promptConfiguration'].queue.queueMode = queueMode;
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

test('/queue mode parses on, off and toggle; other /queue words are unchanged', () => {
  assert.deepEqual(parseSlashCommand('/queue mode'), {kind: 'queueMode'});
  assert.deepEqual(parseSlashCommand('/queue mode on'), {kind: 'queueMode', value: true});
  assert.deepEqual(parseSlashCommand('/q mode off'), {kind: 'queueMode', value: false});
  assert.deepEqual(parseSlashCommand('/queue pause'), {kind: 'queue', op: 'pause'});
  assert.equal(parseSlashCommand('/queue mode maybe')?.kind, 'unknown');
});

test('off (the default): a line entered while sleep runs is never queued by Enter; it waits for an explicit choice (#514)', async () => {
  const f = fixture();
  try {
    f.begin('sleep 30');
    assert.match(f.screen(), /Enter checks who reads it · Ctrl\+Q runs it after/u);
    f.type('echo one');
    await settled();
    f.enter();
    await settled();
    assert.deepEqual(f.adds(), [], 'an echoing terminal is no evidence: nothing is queued or sent');
    assert.match(f.screen(), /Can.t tell whether sleep is reading your typing/u);
  } finally { f.dispose(); }
});

test('on: lines entered while sleep runs are queued as typed, in order, with no approval step; the composer says so', async () => {
  const f = fixture(true);
  try {
    f.begin('sleep 30');
    assert.match(f.screen(), /Queue Mode · Enter queues it to run next · Ctrl\+S sends to sleep/u);
    const lines = ['echo "STEP 1 — Starting"', 'sleep 2', 'echo "STEP 2 — Halfway"', 'sleep 2', 'echo "STEP 3 — Finished!"'];
    for (const line of lines) {
      f.type(line);
      await settled();
      f.enter();
      await settled();
    }
    assert.deepEqual(f.adds().map(op => op.text), lines, 'each line once, in the order entered');
    assert.equal(f.adds().some(op => op.condition !== undefined || op.typedWhile !== undefined), false, 'none waits for approval');
    assert.deepEqual(f.written, [], 'nothing reached sleep');
    assert.deepEqual(f.submitted, [], 'nothing ran early');
    assert.doesNotMatch(f.screen(), /typed while|Awaiting approval/u);
  } finally { f.dispose(); }
});

test('on: a program NMSh sees waiting for a line still gets Enter; nothing is queued', async () => {
  const f = fixture(true);
  try {
    f.begin('read -r reply');
    f.report({since: Date.now(), confidence: 'likely', mode: 'line'});
    f.type('hello');
    f.enter();
    await settled();
    assert.equal(f.written.join(''), 'hello\r', 'the answer went to the program');
    assert.deepEqual(f.adds(), []);
  } finally { f.dispose(); }
});

test('on: hidden input is never drawn, queued or run, whether it was reported or only seen by the look', async () => {
  for (const how of ['reported', 'looked'] as const) {
    const f = fixture(true);
    try {
      f.begin('sudo -k true');
      if (how === 'reported') f.report({since: Date.now(), confidence: 'confirmed', mode: 'hidden'});
      else f.looksAnswer('hidden');
      f.type(SECRET);
      await settled();
      if (how === 'looked') f.report({since: Date.now(), confidence: 'confirmed', mode: 'hidden'});
      await settled();
      f.enter();
      await settled();
      assert.equal(f.screen().includes(SECRET), false, `${how}: not on screen`);
      assert.equal(f.transcript().includes(SECRET), false, `${how}: not in the transcript`);
      assert.equal(f.adds().some(op => op.text.includes(SECRET)), false, `${how}: not queued`);
      assert.equal(f.submitted.some(text => text.includes(SECRET)), false, `${how}: not run`);
    } finally { f.dispose(); }
  }
});

test('on: a look that cannot tell keeps the typing held and hidden; Queue Mode never routes on no evidence', async t => {
  const f = fixture(true);
  try {
    t.mock.timers.enable({apis: ['setTimeout']});
    f.looksAnswer('unknown');
    f.begin('sleep 30');
    f.type(SECRET);
    await settled();
    f.enter();
    await settled();
    assert.match(f.screen(), /Can't tell whether sleep is reading your typing/u);
    assert.equal(f.screen().includes(SECRET), false);
    assert.deepEqual(f.adds(), [], 'nothing queued');
  } finally { f.dispose(); }
});

test('on: a line whose command ended while its keys were held is queued as typed, not held for approval', async () => {
  const f = fixture(true);
  try {
    let answer: (result: LookResult) => void = () => {};
    Object.defineProperty(f.session, 'lookInput', {value: () => new Promise<LookResult>(resolve => { answer = resolve; }), configurable: true});
    f.begin('ls');
    f.type('echo after');
    f.enter();
    f.complete(0);
    answer('idle');
    await settled();
    assert.deepEqual(f.adds().map(op => [op.text, op.condition, op.typedWhile]), [['echo after', undefined, undefined]]);
  } finally { f.dispose(); }
});

test('Ctrl+Q on an empty line toggles Queue Mode for this window only; /queue mode sets it; Settings are not written', async () => {
  const f = fixture();
  try {
    f.app['onInput'](CTRL_Q);
    assert.equal(f.app['queueModeOn'](), true);
    assert.match(f.transcript(), /Queue Mode on/u);
    assert.match(f.screen(), /Queue Mode · while a command runs, Enter queues/u, 'the empty composer says so at the prompt');
    assert.equal(f.app['promptConfiguration'].queue.queueMode, false, 'the default in Settings is unchanged');
    f.app['onInput'](CTRL_Q);
    assert.equal(f.app['queueModeOn'](), false);
    await f.app['runSlash']('/queue mode on', parseSlashCommand('/queue mode on')!);
    assert.equal(f.app['queueModeOn'](), true);
    await f.app['runSlash']('/queue mode on', parseSlashCommand('/queue mode on')!);
    assert.equal(f.app['queueModeOn'](), true, 'on stays on');
    await f.app['runSlash']('/queue mode off', parseSlashCommand('/queue mode off')!);
    assert.equal(f.app['queueModeOn'](), false);
    assert.deepEqual(f.adds(), [], 'toggling queues nothing');
  } finally { f.dispose(); }
});

test('Ctrl+Q with text still queues that line; Ctrl+Q while a program reads hidden input composes a queue entry, never a toggle', async () => {
  const f = fixture();
  try {
    f.begin('sleep 30');
    f.type('echo later');
    await settled();
    f.app['onInput'](CTRL_Q);
    await settled();
    assert.deepEqual(f.adds().map(op => [op.text, op.typedWhile]), [['echo later', undefined]]);
    assert.equal(f.app['queueModeOn'](), false, 'Ctrl+Q with a line queues it, it toggles nothing');
    f.complete(0);
    f.begin('sudo -k true');
    f.report({since: Date.now(), confidence: 'confirmed', mode: 'hidden'});
    f.app['onInput'](CTRL_Q);
    assert.equal(f.app['queueCompose'], true, 'composes a queue entry');
    assert.equal(f.app['queueModeOn'](), false);
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

test('on: at the prompt, a line never runs ahead of entries already waiting; a paused queue gives the prompt back', async () => {
  const held = {id: 1, text: 'echo held', addedAt: 1, condition: 'approve' as const, typedWhile: 'sleep'};
  const queued = {id: 2, text: 'sleep 2', addedAt: 2};
  for (const [state, expectRun, hint] of [
    [{entries: [held, queued]}, false, /Queue Mode · Enter adds it after 2 waiting/u],
    [{entries: [queued]}, false, /Queue Mode · Enter adds it after 1 waiting/u],
    [{entries: [queued], paused: {reason: 'failed' as const, at: 3, command: 'false', exitCode: 1}}, true, /queue paused, 1 waiting · Enter runs it now/u],
  ] as const) {
    const f = fixture(true);
    try {
      f.session.emit('queueState', state, {});
      await settled();
      assert.match(f.screen(), hint);
      f.type('echo "STEP 3"');
      f.enter();
      await settled();
      if (expectRun) {
        assert.deepEqual(f.submitted, ['echo "STEP 3"'], 'a paused queue: the line runs now');
        assert.deepEqual(f.adds(), []);
      } else {
        assert.deepEqual(f.submitted, [], 'nothing runs ahead of the waiting entries');
        assert.deepEqual(f.adds().map(op => [op.text, op.condition, op.typedWhile]), [['echo "STEP 3"', undefined, undefined]], 'added after them, as typed');
      }
    } finally { f.dispose(); }
  }
});

test('off: a held line at the head still never holds the prompt (#426); the line runs now', async () => {
  const f = fixture(false);
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
