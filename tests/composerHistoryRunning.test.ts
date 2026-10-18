import test from 'node:test';
import assert from 'node:assert/strict';
import {slashSuggestions} from '../src/commands/slashCommands.js';
import {shellAdapter} from '../src/shell/adapters/registry.js';
import {historyId, type HistoryEntry} from '../src/shell/HistoryIndex.js';
import type {QueueOp} from '../src/session/CommandQueue.js';
import type {InputState} from '../src/session/inputState.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * Composer Up/Down history while commands run. A running command that reads nothing of its own (ordinary
 * execution, queued entries included) must not disable recall; only a program that actually owns input, an
 * explicit queued-entry edit, or another focused surface keeps the keys. Every key routes through the real
 * TerminalApp key handler; nothing is started.
 */

const UP = '\u001B[A';
const DOWN = '\u001B[B';
const CTRL_Q = '\u0011';

function fixture(commands: string[] = ['echo history-one', 'echo history-two']) {
  const frame = executionFrameFixture(80, 30);
  commands.forEach((command, index) => frame.app['historyService'].index.add(
    {id: historyId('nmsh', `test:${index}`), source: 'nmsh', command, at: 1000 + index} satisfies HistoryEntry));
  const written: string[] = [];
  const queueOps: QueueOp[] = [];
  const submissions: string[] = [];
  Object.defineProperty(frame.session, 'write', {value: (data: string) => { written.push(data); }, configurable: true});
  const originalQueue = frame.session.queue.bind(frame.session);
  Object.defineProperty(frame.session, 'queue', {value: (op: QueueOp) => { queueOps.push(op); originalQueue(op); }, configurable: true});
  Object.defineProperty(frame.session, 'submit', {value: (text: string) => { submissions.push(text); }, configurable: true});
  const text = () => frame.app['editor'].text as string;
  const adds = () => queueOps.filter(op => op.op === 'add').map(op => op.text);
  const queueTexts = () => (frame.app['queueState'].entries as Array<{text: string}>).map(entry => entry.text);
  const addEntry = (value: string) => {
    frame.owner.request({op: 'add', text: value});
    return (frame.app['queueState'].entries as Array<{id: number; text: string}>).find(entry => entry.text === value)!.id;
  };
  const inputState = (state: InputState) => { frame.app['inputState'] = state; };
  return {...frame, written, queueOps, submissions, text, adds, queueTexts, addEntry, inputState,
    dispose() { frame.dispose(); }};
}

test('composer history: an idle shell keeps ordinary recall (baseline for the running cases)', () => {
  const f = fixture();
  try {
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-two');
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-one');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), 'echo history-two');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), '', 'Down past the newest restores the empty draft');
  } finally { f.dispose(); }
});

test('composer history: Up/Down recall while an ordinary command runs; nothing runs or is queued by navigation', () => {
  const f = fixture();
  try {
    f.begin('sleep 12');
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-two', 'the newest eligible entry, recalled while the command runs');
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-one');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), 'echo history-two');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), '', 'Down past the newest restores the unsent draft');
    assert.deepEqual(f.written, [], 'navigation never writes to the running program');
    assert.deepEqual(f.adds(), [], 'a mere recall never enqueues');
    assert.deepEqual(f.submissions, [], 'a mere recall never submits');
  } finally { f.dispose(); }
});

test('composer history: a draft typed while a command runs is the exact draft restored past the newest entry', () => {
  const f = fixture();
  try {
    f.begin('sleep 12');
    f.app['onInput']('git st');
    assert.equal(f.text(), 'git st');
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-two', 'the draft is preserved, not replaced by navigation state');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), 'git st', 'the exact unsent draft returns');
  } finally { f.dispose(); }
});

test('composer history: several rapid Ups step successive entries while commands are queued and executing', () => {
  const f = fixture(['echo one', 'echo two', 'echo three']);
  try {
    f.begin('sleep 12');
    f.addEntry('echo queued-next');
    f.addEntry('echo queued-next-2');
    assert.deepEqual(f.queueTexts(), ['echo queued-next', 'echo queued-next-2'], 'pending entries are visible, not focused');
    for (const [presses, expected] of [[1, 'echo three'], [1, 'echo two'], [1, 'echo one'], [1, 'echo one']] as const) {
      for (let index = 0; index < presses; index += 1) f.app['onInput'](UP);
      assert.equal(f.text(), expected, `after ${presses} more Up presses`);
    }
    assert.deepEqual(f.queueTexts(), ['echo queued-next', 'echo queued-next-2'], 'the queue is never selected, modified or reordered by recall');
    assert.equal(f.app['queuePanel'], undefined, 'pending entries alone never open the queue panel');
    assert.equal(f.app['composerHistory'].active, true);
  } finally { f.dispose(); }
});

test('composer history: Enter after a recall while running uses the existing queue path; the recall itself enqueues nothing', () => {
  const f = fixture();
  try {
    f.begin('sleep 12');
    f.app['onInput'](UP);
    assert.deepEqual(f.adds(), []);
    f.app['onInput']('\r');
    assert.deepEqual(f.adds(), ['echo history-two'], 'only the explicit Enter submitted the recalled command, to the queue');
    assert.equal(f.text(), '', 'the composer is ready for the next command');
    assert.equal(f.app['composerHistory'].active, false, 'navigation ended with the enqueue');
  } finally { f.dispose(); }
});

test('composer history: a command finishing between Up and Enter keeps navigation and the draft intact', () => {
  const f = fixture();
  try {
    f.begin('sleep 12');
    f.app['onInput']('keep me');
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-two');
    f.complete(0);
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-one', 'recall continues after the command ends mid-navigation');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), 'echo history-two');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), 'keep me', 'the original draft was never lost');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), 'keep me', 'Down on the newest with the restored draft does nothing');
    f.app['onInput']('\r');
    assert.deepEqual(f.submissions, ['keep me'], 'Enter after completion is the ordinary submission path');
    assert.deepEqual(f.adds(), [], 'an idle command with an empty queue is not enqueued');
  } finally { f.dispose(); }
});

test('composer history: a program waiting for a line keeps input ownership; Up recalls nothing and Enter is its answer', () => {
  const f = fixture();
  try {
    f.begin('read name');
    f.inputState({request: {since: 0, confidence: 'likely', mode: 'line', prompt: 'Name: '}, timing: {waitedMs: 0, waits: 0}});
    f.app['onInput'](UP);
    assert.equal(f.text(), '', 'Up never substitutes an old command for a program answer');
    f.app['onInput']('alice');
    f.app['onInput']('\r');
    assert.deepEqual(f.written, ['alice\r'], 'Enter typed at the open question is the program’s answer');
    assert.deepEqual(f.adds(), [], 'an answer is never queued');
  } finally { f.dispose(); }
});

test('composer history: a direct (hidden or single-key) reader receives arrows; history is never substituted', () => {
  const f = fixture();
  try {
    f.begin('read -s');
    f.inputState({request: {since: 0, confidence: 'confirmed', mode: 'hidden'}, timing: {waitedMs: 0, waits: 0}});
    f.app['onInput'](UP);
    f.app['onInput'](DOWN);
    assert.deepEqual(f.written, ['\u001B[A', '\u001B[B'], 'the program receives the keys a terminal would send');
    assert.equal(f.text(), '');
    assert.equal(f.app['composerHistory'].active, false);
  } finally { f.dispose(); }
});

test('composer history: a passthrough program owns every key; raw bytes go through, recall is never involved', () => {
  const f = fixture();
  try {
    f.begin('vim note.txt');
    assert.equal(f.app['passthrough'], true, 'a full-screen program hands the terminal over at once');
    f.app['onInput'](UP);
    assert.deepEqual(f.written, ['\u001B[A'], 'the arrow is the program’s');
    assert.equal(f.text(), '');
    assert.equal(f.app['composerHistory'].active, false);
  } finally { f.dispose(); }
});

test('composer history: Ctrl+Q transfers composing to the queue, and recall works there; Esc returns to the program', () => {
  const f = fixture();
  try {
    f.begin('read -s');
    f.inputState({request: {since: 0, confidence: 'confirmed', mode: 'hidden'}, timing: {waitedMs: 0, waits: 0}});
    f.app['onInput'](CTRL_Q);
    assert.equal(f.app['queueCompose'], true);
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-two', 'queue composing keeps ordinary composer history');
    f.app['onInput']('\r');
    assert.deepEqual(f.adds(), ['echo history-two'], 'Enter adds the recalled command to the queue');
    assert.deepEqual(f.written, [], 'the program never sees composer keys');
    f.app['onInput'](CTRL_Q);
    f.app['handleKey']({kind: 'escape'} as never);
    assert.equal(f.app['queueCompose'], false);
    f.app['onInput'](UP);
    assert.deepEqual(f.written, ['\u001B[A'], 'after leaving, Up is the program’s again');
  } finally { f.dispose(); }
});

test('composer history: editing a queued entry never lets a recall overwrite the entry draft', () => {
  const f = fixture();
  try {
    f.begin('sleep 12');
    const id = f.addEntry('printf a\nprintf b');
    f.app['editor'].replaceText('the draft before editing');
    f.app['beginQueueEdit'](id);
    assert.equal(f.text(), 'printf a\nprintf b', 'the entry is the draft being edited');
    for (let index = 0; index < 4; index += 1) f.app['onInput'](UP);
    assert.equal(f.text(), 'printf a\nprintf b', 'Up moves within the edit or does nothing; it never replaces the entry');
    assert.deepEqual(f.adds(), []);
    f.app['handleKey']({kind: 'escape'} as never);
    assert.equal(f.app['queueEdit'], undefined);
    assert.equal(f.text(), 'the draft before editing', 'Esc cancels the edit and restores the earlier composer draft');
    assert.deepEqual(f.queueTexts(), ['printf a\nprintf b'], 'the entry keeps its original text');
  } finally { f.dispose(); }
});

test('composer history: /queue panel Up/Down select entries, and closing it restores the composer untouched', () => {
  const f = fixture();
  try {
    f.begin('sleep 12');
    f.addEntry('echo queued-next');
    f.addEntry('echo queued-next-2');
    f.app['onInput']('git st');
    f.app['queuePanel'] = {selected: 0};
    f.app['onInput'](UP);
    assert.equal(f.app['queuePanel'].selected, 1, 'Up selects queue entries while the panel is focused');
    f.app['onInput'](DOWN);
    assert.equal(f.app['queuePanel'].selected, 0);
    assert.equal(f.text(), 'git st', 'panel navigation never touches the composer draft');
    assert.equal(f.app['composerHistory'].active, false, 'panel navigation is not history navigation');
    f.app['handleKey']({kind: 'escape'} as never);
    assert.equal(f.app['queuePanel'], undefined);
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-two', 'the composer keeps recall after the panel closes');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), 'git st', 'the draft survived the whole detour exactly');
  } finally { f.dispose(); }
});

test('composer history: slash suggestions still yield Up; a recalled command opens no completion menu', () => {
  const f = fixture();
  try {
    f.begin('sleep 12');
    f.app['onInput']('/screensaver');
    assert.ok(slashSuggestions('/screensaver').length > 1, 'slash suggestions stand behind the text');
    assert.deepEqual(f.app['composerSuggestions'](), [], 'while a command runs the composer shows no menu');
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-two', 'Up over slash text recalls history');
    assert.equal(f.app['selectedSuggestion'], 0);
    f.app['onInput'](DOWN);
    assert.equal(f.text(), '/screensaver', 'Down past the newest restores the slash draft');
    assert.equal(f.app['shellSuggestions'].length, 0, 'a recalled command never grows a completion menu');
  } finally { f.dispose(); }
});

test('composer history: multiline drafts move by line first; a recalled multiline command is one step (#389) and restores the draft', () => {
  const f = fixture(['echo older', 'printf a\nprintf b']);
  try {
    f.begin('sleep 12');
    f.app['onInput']('first');
    f.app['onInput']('\n');
    f.app['onInput']('second');
    assert.equal(f.text(), 'first\nsecond');
    f.app['onInput'](UP);
    assert.equal(f.text(), 'first\nsecond', 'Up inside the multiline draft moves the caret first');
    f.app['onInput'](UP);
    assert.equal(f.text(), 'printf a\nprintf b', 'the multiline entry is recalled as one command');
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo older', 'one Up reaches the older entry');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), 'printf a\nprintf b', 'Down steps newer, entry by entry');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), 'first\nsecond', 'Down past the newest restores the multiline draft');
  } finally { f.dispose(); }
});

test('composer history: an ownership look holds keys, then routes them by what it found; a reader wins, otherwise recall', async () => {
  const f = fixture();
  try {
    let resolveLook!: (value: boolean) => void;
    Object.defineProperty(f.session, 'lookInput', {value: () => new Promise<boolean>(resolve => { resolveLook = resolve; }), configurable: true});
    f.begin('sometool');
    f.app['onInput']('x');
    f.app['onInput'](UP);
    assert.equal(f.text(), '', 'held keys are not routed until the look answers');
    resolveLook(false);
    await new Promise(done => setImmediate(done));
    assert.equal(f.text(), 'echo history-two', 'the held keys replay; the empty program made history eligible');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), 'x', 'the held text was the draft the replayed Up preserved');
    assert.deepEqual(f.written, []);

    // The look finds a hidden-line reader: the same held keys are the program’s, in order.
    const g = fixture();
    let resolveReader!: (value: boolean) => void;
    Object.defineProperty(g.session, 'lookInput', {value: () => new Promise<boolean>(resolve => { resolveReader = resolve; }), configurable: true});
    g.begin('read -s');
    g.app['onInput']('x');
    g.app['onInput'](UP);
    g.session.emit('inputState', {request: {since: 0, confidence: 'confirmed', mode: 'hidden'}, timing: {waitedMs: 0, waits: 0}});
    resolveReader(true);
    await new Promise(done => setImmediate(done));
    assert.deepEqual(g.written, ['x', '\u001B[A'], 'evidence of a reader routes the held keys to it');
    assert.equal(g.text(), '');
    g.dispose();
  } finally { f.dispose(); }
});

test('composer history: a stopped-then-resumed shell keeps recall safe (nothing typed after Ctrl+C is substituted)', () => {
  const f = fixture();
  try {
    f.begin('sleep 30');
    f.app['handleKey']({kind: 'interrupt'} as never);
    assert.equal(f.app['running']?.interrupted, true, 'Ctrl+C interrupted the running command');
    assert.equal(f.text(), '', 'the draft is cleared for the prompt the stop brings back');
    f.complete(130);
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-two', 'recall works normally again at the restored prompt');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), '', 'Down restores the empty draft');
  } finally { f.dispose(); }
});

const bashShellReady = (() => {
  try { return process.platform !== 'win32' && shellAdapter('bash').unavailableReason(process.env) === undefined; } catch { return false; }
})();

test('composer history: switching the session shell ends navigation, so an old shell’s snapshot never leaks into the new one',
  {skip: bashShellReady ? false : 'Bash 4.4+ is not installed'}, async () => {
    const f = fixture();
    try {
      Object.defineProperty(f.session, 'switchShell', {value: async () => {}, configurable: true});
      f.app['onInput'](UP);
      assert.equal(f.text(), 'echo history-two');
      assert.equal(f.app['composerHistory'].active, true);
      await f.app['switchShell']('bash', '/shell bash');
      assert.equal(f.app['shellId'], 'bash');
      assert.equal(f.app['composerHistory'].active, false, 'navigation state is the old shell’s; it never crosses the switch');
      assert.equal(f.text(), 'echo history-two', 'the recalled text stays as an ordinary draft');
      f.app['onInput'](UP);
      assert.equal(f.text(), 'echo history-one', 'a fresh navigation starts for the new shell');
    } finally { f.dispose(); }
  });

test('composer history: a failed queued chain pausing the queue never disables recall or disturbs the queue', () => {
  const f = fixture();
  try {
    f.owner.request({op: 'failure-policy', policy: 'pause'});
    f.begin('sleep 12');
    f.addEntry('echo queued-next');
    f.complete(3);
    assert.equal(f.app['queueState'].paused?.reason, 'failed', 'the failure paused the queue with its reason');
    const entries = f.queueTexts();
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-two', 'recall works with the queue paused by a failure');
    f.app['onInput'](DOWN);
    assert.equal(f.text(), '');
    assert.deepEqual(f.adds(), []);
    assert.deepEqual(f.queueTexts(), entries, 'navigation left the paused queue exactly as it was');
    f.owner.request({op: 'resume'});
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-two', 'navigation starts afresh after the resume');
    f.app['onInput'](UP);
    assert.equal(f.text(), 'echo history-one');
  } finally { f.dispose(); }
});
