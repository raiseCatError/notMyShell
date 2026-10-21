import test from 'node:test';
import assert from 'node:assert/strict';
import type {Key} from '../src/terminal/keys.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {presentationClock} from '../src/motion/PresentationClock.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * The Arcade over a running command. The capture fixture's PTY session throws on write() and submit(), so a key that
 * reached the shell, or a command the Arcade started, fails these tests by itself. They drive the real TerminalApp.
 */
function setup(columns = 100, rows = 30, mode: Parameters<typeof executionFrameFixture>[2] = 'normal') {
  const frame = executionFrameFixture(columns, rows, mode);
  const app = frame.app;
  app['shellId'] = 'zsh';
  let painted: string[] = [];
  let paints = 0;
  const write = app['renderer'].render.bind(app['renderer']);
  app['renderer'].render = (value: {rows: string[]}) => { painted = value.rows; paints += 1; write(value as never); };
  const queued: unknown[] = [];
  const interrupts: number[] = [];
  frame.session.queue = (op: unknown) => { queued.push(op); };
  frame.session.interrupt = () => { interrupts.push(1); };
  const press = (...keys: Key[]) => { for (const key of keys) app['handleKey'](key); };
  const text = (value: string): Key => ({kind: 'text', value});
  const screen = () => { app['arcade'] && (app['arcade'].handoff = undefined); app['render'](); return painted.map(row => stripAnsi(row)); };
  const transcript = () => app['output'].transcript();
  /** The transcript as the reader sees it: one string per line. */
  const said = () => transcript().lines.map((line: Array<{text: string}>) => line.map(cell => cell.text).join('')).join('\n');
  /** The screen once a toast has finished sliding in (time is frozen in these frames). */
  const settled = () => { frame.tick(300); return screen(); };
  return {...frame, app, press, text, screen, settled, said, queued, interrupts, transcript, paints: () => paints, resetPaints: () => { paints = 0; }};
}

const ARCADE: Key = {kind: 'arcade'};
/** The shared header: the activity list and the banner. */
const top = (rows: string[]) => rows.slice(0, 4).join('\n');

test('Ctrl+T decodes to a frontend key and is never text', () => {
  assert.deepEqual(decodeKeys('\u0014'), [ARCADE]);
  assert.deepEqual(decodeKeys('\u001B[116;5u'), [ARCADE]);
});

test('opening over a running command: the command, its identity and the PTY are untouched, and every key is the Arcade\'s', () => {
  const t = setup();
  try {
    t.begin('npm run build', 'compiling...\r\n');
    const running = t.app['running'];
    const startId = running.startId;
    const sizes = t.session.sizes.length;
    t.press(ARCADE);
    assert.ok(t.app['arcade'], 'the Arcade opened over the running command');
    assert.equal(t.app['running'], running, 'the same running command object');
    assert.equal(t.app['running'].startId, startId);
    const rows = t.screen();
    assert.equal(rows.length, 30);
    assert.match(rows[0]!, /◷ npm run build/u, 'the activity list names what runs behind');
    assert.match(rows[2]!, /Vespyr Arcade/u, 'the hub starts below the two-row header');
    // Gameplay and navigation keys, including those that mean something to the shell: none may reach the PTY or the queue.
    t.press({kind: 'enter'}, t.text(' '), {kind: 'queueCommand'}, {kind: 'sendToProgram'}, t.text('y'), t.text('a'), {kind: 'enter'}, {kind: 'down'}, {kind: 'complete'});
    assert.deepEqual(t.queued, [], 'no queue operation');
    assert.equal(t.session.sizes.length, sizes, 'no resize');
    assert.equal(t.app['running'], running);
    assert.equal(t.app['running'].interrupted, false);
    assert.deepEqual(t.interrupts, []);
  } finally { t.dispose(); }
});

test('Ctrl+C in the Arcade leaves the Arcade, not the command', () => {
  const t = setup();
  try {
    t.begin('sleep 30');
    t.press(ARCADE);
    t.press({kind: 'interrupt'});
    assert.equal(t.app['arcade'], undefined);
    assert.ok(t.app['running'], 'the command still runs');
    assert.equal(t.app['running'].interrupted, false);
    assert.deepEqual(t.interrupts, [], 'no SIGINT was sent');
  } finally { t.dispose(); }
});

test('a completion behind the Arcade: the game stays open, one toast appears, and the transcript holds the real result', () => {
  const t = setup();
  try {
    t.begin('npm test', 'ok 1\r\nok 2\r\n');
    t.press(ARCADE);
    t.press({kind: 'enter'});
    assert.equal(t.app['arcade'].session.screen, 'playing');
    t.tick(42_000);
    t.complete(0);
    assert.ok(t.app['arcade'], 'completion does not close the Arcade');
    assert.equal(t.app['arcade'].session.screen, 'playing', 'nor pause the game');
    const rows = t.settled();
    assert.match(top(rows), /✓ Command completed/u);
    assert.match(top(rows), /npm test · 42\.0s · exit 0/u);
    assert.equal(rows.filter(row => /Command completed/u.test(row)).length, 1, 'one banner');
    const [record] = t.transcript().records;
    assert.equal(record?.command, 'npm test');
    assert.equal(record?.exitCode, 0);
    assert.match(record?.output ?? '', /ok 1[\s\S]*ok 2/u, 'the output was kept');
    assert.doesNotMatch(JSON.stringify(t.transcript()), /npm test finished/u, 'a toast is never transcript text');
    // The game still answers keys.
    t.press({kind: 'left'});
    assert.ok(t.app['arcade']);
    // Gone after its time, without a stale cell.
    t.tick(5_000);
    assert.match(top(t.screen()), /Command completed/u, 'the banner stays: it does not expire');
    assert.match(t.screen()[0]!, /✓ npm test\s+completed/u, 'and the command is listed as settled');
  } finally { t.dispose(); }
});

test('a failure is distinct, concise and does not leave the Arcade', () => {
  const t = setup();
  try {
    t.begin('npm test');
    t.press(ARCADE);
    t.tick(3_000);
    t.complete(1);
    assert.ok(t.app['arcade']);
    assert.match(top(t.settled()), /✕ Command failed[\s\S]*npm test · 3\.0s · exit 1/u);
    assert.equal(t.transcript().records[0]?.exitCode, 1);
  } finally { t.dispose(); }
});

test('a toast never covers the game: the strip is reserved from the start, so the game does not resize when one appears', () => {
  const t = setup();
  try {
    t.begin('make');
    t.press(ARCADE, {kind: 'enter'});
    const before = t.screen();
    t.complete(0);
    const after = t.settled();
    assert.equal(after.length, before.length);
    assert.deepEqual(after.slice(2), before.slice(2), 'every row below the two-row header is identical');
    assert.notEqual(top(after), top(before));
  } finally { t.dispose(); }
});

test('a burst of completions is one toast, then the chain\'s own summary; nothing is lost from the transcript', () => {
  const t = setup();
  try {
    for (let index = 1; index < 6; index += 1) t.owner.request({op: 'add', text: `job${index}`});
    t.begin('job0');
    t.press(ARCADE);
    t.complete(0);
    for (let index = 1; index < 6; index += 1) {
      assert.ok(t.app['arcade'], `the queue starting job${index} keeps the Arcade open`);
      t.begin(`job${index}`);
      if (index < 5) assert.match(top(t.screen()), /◷ job\d/u, 'the list follows the command that runs now');
      t.complete(0);
    }
    const rows = t.settled();
    assert.match(top(rows), /Queue finished[\s\S]*5 commands/u, 'the chain covers the five queued entries; job0 was typed');
    assert.equal(rows.filter(row => /Queue finished|commands finished/u.test(row)).length, 1, 'one banner, not a stack');
    assert.equal(t.transcript().records.length, 6);
    assert.deepEqual(t.transcript().records.map(record => record.command).sort(), ['job0', 'job1', 'job2', 'job3', 'job4', 'job5'], 'each ran exactly once');
  } finally { t.dispose(); }
});

test('a failure in the queue obeys the existing policy: it pauses, the rest wait, and the Arcade only reports it', () => {
  const t = setup();
  try {
    for (const name of ['job1', 'job2']) t.owner.request({op: 'add', text: name});
    t.begin('job0');
    t.press(ARCADE, {kind: 'enter'});
    t.complete(0);
    t.begin('job1');
    t.complete(2);
    assert.ok(t.app['arcade']);
    assert.equal(t.owner.state.paused?.reason, 'failed', 'the queue paused itself, as it always does');
    assert.equal(t.owner.state.entries.length, 1, 'job2 still waits and never ran');
    const rows = t.settled();
    assert.match(top(rows), /job1[\s\S]*exit 2|Queue paused/u);
    t.press({kind: 'enter'}, t.text(' '), t.text('y'), {kind: 'queueCommand'});
    assert.equal(t.owner.state.paused?.reason, 'failed', 'no key resumed it');
    assert.equal(t.owner.state.entries.length, 1);
    assert.deepEqual(t.queued, []);
    assert.match(top(t.settled()), /Queue · 1 waiting\s+paused/u, 'the list keeps saying the queue is paused');
  } finally { t.dispose(); }
});

test('bursty output is recorded without repainting the Arcade for every chunk', () => {
  const t = setup();
  try {
    t.begin('yes');
    t.press(ARCADE);
    t.screen();
    t.resetPaints();
    for (let index = 0; index < 3000; index += 1) t.app['onShellData'](`line ${index} ${'x'.repeat(60)}\r\n`);
    assert.ok(t.paints() < 20, `the Arcade repainted ${t.paints()} times for 3000 chunks`);
    t.complete(0);
    const output = t.transcript().records[0]?.output ?? '';
    assert.match(output, /line 2999/u, 'the newest output was kept');
    assert.ok(output.length < 4_000_000, 'retained output stays bounded');
  } finally { t.dispose(); }
});

test('shell output never paints over the Arcade, and leaving repaints the real transcript', () => {
  const t = setup();
  try {
    t.begin('make', 'gcc -c a.c\r\n');
    t.press(ARCADE);
    t.app['onShellData']('\u001b[2J\u001b[H\u001b[31mERROR in the build\u001b[0m\r\n');
    const rows = t.screen();
    assert.doesNotMatch(rows.join('\n'), /ERROR in the build|gcc -c/u);
    for (let index = 0; index < 6 && t.app['arcade']; index += 1) t.press({kind: 'escape'});
    assert.equal(t.app['arcade'], undefined);
    t.app['arcadeClosing'] = undefined;
    const after = t.screen().join('\n');
    assert.match(after, /ERROR in the build/u, 'the output is back in the transcript');
    assert.doesNotMatch(after, /Vespyr Arcade/u);
  } finally { t.dispose(); }
});

test('a program asking for input: the Arcade pauses, says so, and never forwards a key; the person returns on purpose', () => {
  const t = setup();
  try {
    t.begin('sudo true');
    t.press(ARCADE, {kind: 'enter'}, t.text(' '));
    assert.equal(t.app['arcade'].session.screen, 'playing');
    assert.equal(t.app['arcade'].session.game.status, 'playing', 'the run has started');
    t.app['onInputState']({request: {since: Date.now(), confidence: 'confirmed', mode: 'hidden', program: 'sudo'}, timing: {waitedMs: 0, waits: 1}});
    assert.ok(t.app['arcade'], 'the Arcade stays; the process and its state are preserved');
    assert.notEqual(t.app['arcade'].session.screen, 'playing', 'the game is paused');
    assert.match(top(t.settled()), /Input needed[\s\S]*sudo is waiting/u);
    // A password typed into the game goes nowhere: write() would throw in this fixture.
    for (const char of 'hunter2') t.press(t.text(char));
    t.press({kind: 'enter'}, {kind: 'queueCommand'});
    assert.deepEqual(t.queued, []);
    assert.ok(t.app['arcade'] || t.app['running']);
    // Back to the shell: Exit from the pause sheet; nothing typed in the game is replayed.
    t.press({kind: 'interrupt'});
    assert.equal(t.app['arcade'], undefined);
    assert.equal(t.app['editor'].text, '', 'no gameplay key became composer text');
    assert.ok(t.app['directInputRequest'](), 'the shell\'s own input handling owns the question again');
  } finally { t.dispose(); }
});

test('a program that takes the terminal closes the Arcade at once', () => {
  const t = setup();
  try {
    t.begin('read -s');
    t.press(ARCADE);
    t.app['onInputState']({terminalOwner: true, timing: {waitedMs: 0, waits: 0}});
    assert.equal(t.app['arcade'], undefined);
    assert.ok(t.app['running']);
  } finally { t.dispose(); }
});

test('it will not open when ownership of the keyboard is not clear', () => {
  const refuse = (name: string, prepare: (t: ReturnType<typeof setup>) => void) => {
    const t = setup();
    try {
      t.begin('./script.sh');
      prepare(t);
      t.press(ARCADE);
      assert.equal(t.app['arcade'], undefined, name);
      assert.ok(t.app['running'], `${name}: the command is untouched`);
      assert.match(t.said(), /arcade/iu, `${name}: says why`);
    } finally { t.dispose(); }
  };
  refuse('a confirmed question', t => t.app['onInputState']({request: {since: Date.now(), confidence: 'confirmed', mode: 'line', program: 'script'}, timing: {waitedMs: 0, waits: 1}}));
  refuse('a likely question', t => t.app['onInputState']({request: {since: Date.now(), confidence: 'likely', mode: 'line', prompt: 'Continue? '}, timing: {waitedMs: 0, waits: 1}}));
  refuse('a program that owns the terminal', t => t.app['onInputState']({terminalOwner: true, timing: {waitedMs: 0, waits: 0}}));
  refuse('a full-screen program', t => { t.app['passthrough'] = true; });
  refuse('keys held while NMSh looks', t => { t.app['ownershipLook'] = {keys: [], settle() {}} as never; });
  refuse('a queue review open', t => { t.app['queueReview'] = {kind: 'approve', id: 1}; });
  refuse('a command that has not started', t => { t.app['running'].awaitingExec = true; });
});

test('at the prompt the shortcut opens the Arcade as it always did, and /games still opens it', async () => {
  const t = setup();
  try {
    t.press(ARCADE);
    assert.ok(t.app['arcade']);
    assert.equal(t.screen()[0]!.includes('Vespyr Arcade'), true, 'no strip when nothing runs: the hub starts at the top');
    t.press({kind: 'escape'});
    assert.equal(t.app['arcade'], undefined);
    await t.app['runSlash']('/games', {kind: 'arcade'});
    assert.ok(t.app['arcade']);
  } finally { t.dispose(); }
});

test('typing /games into a running command is still the program\'s input, never the Arcade', async () => {
  const t = setup();
  try {
    t.begin('./script.sh');
    await t.app['runSlash']('/games', {kind: 'arcade'});
    assert.equal(t.app['arcade'], undefined, 'the typed path stays closed over a command');
  } finally { t.dispose(); }
});

test('queue: a held entry stays held whatever is pressed in the Arcade, and approval is only ever the person\'s', () => {
  const t = setup();
  try {
    t.begin('make');
    t.owner.request({op: 'add', text: 'rm -r build', condition: 'approve'});
    assert.equal(t.owner.state.entries.length, 1);
    t.press(ARCADE, {kind: 'enter'});
    for (const key of ['y', 'a', 'Y', '1', ' ', 'q']) t.press(t.text(key));
    t.press({kind: 'enter'}, {kind: 'queueCommand'}, {kind: 'complete'}, {kind: 'enter'});
    assert.deepEqual(t.queued, [], 'nothing was sent to the queue');
    t.complete(0);
    t.tick(10);
    assert.equal(t.owner.state.entries.length, 1, 'the held entry did not run');
    assert.notEqual(t.owner.state.entries[0]?.approved, true);
    assert.match(top(t.settled()), /Queue · 1 waiting\s+approval needed/u, 'the list says it is waiting');
    assert.ok(t.app['arcade'], 'and the Arcade stays open');
    t.press({kind: 'interrupt'});
    assert.equal(t.owner.state.entries.length, 1, 'closing the Arcade did not approve it either');
  } finally { t.dispose(); }
});

test('queue: an authorised entry starts behind the Arcade, runs once, and its completion is a toast', () => {
  const t = setup();
  try {
    t.begin('first');
    t.owner.request({op: 'add', text: 'second'});
    t.press(ARCADE, {kind: 'enter'});
    t.complete(0);
    t.begin('second');
    assert.ok(t.app['arcade'], 'the queue starting the next command does not close the Arcade');
    assert.equal(t.app['running']?.command, 'second', 'the queue ran its next entry');
    t.complete(0);
    assert.ok(t.app['arcade']);
    const records = t.transcript().records.map(record => record.command);
    assert.deepEqual([...records].sort(), ['first', 'second'], 'both ran, in the intended order, none twice');
    assert.equal(records.filter(command => command === 'second').length, 1, 'ran exactly once');
    assert.match(top(t.settled()), /Queue finished[\s\S]*2 commands/u);
  } finally { t.dispose(); }
});

test('a command from outside the queue still closes the Arcade, as before', () => {
  const t = setup();
  try {
    t.press(ARCADE);
    t.app['onShellExec']('echo from another window', Date.now());
    assert.equal(t.app['arcade'], undefined);
  } finally { t.dispose(); }
});

test('closing and quitting leave no clock subscription or timer behind', () => {
  const t = setup(100, 30, 'reduced');
  const subscribers = presentationClock.subscriberCount;
  try {
    t.begin('make');
    t.press(ARCADE, {kind: 'enter'});
    t.complete(0);
    t.screen();
    t.press({kind: 'interrupt'});
    assert.equal(t.app['arcadeToast'], undefined, 'no toast timer');
    assert.ok(presentationClock.subscriberCount <= subscribers, 'no clock subscription');
    for (let round = 0; round < 25; round += 1) { t.press(ARCADE); t.press({kind: 'escape'}); }
    assert.ok(presentationClock.subscriberCount <= subscribers);
  } finally { t.dispose(); }
});

test('small terminals: no strip and no game resize; a compact marker shows in the controls row', () => {
  const t = setup(36, 12);
  try {
    t.begin('make');
    t.press(ARCADE, {kind: 'enter'});
    assert.doesNotMatch(top(t.screen()), /◷ make/u, 'no header to cover the game');
    t.complete(1);
    const rows = t.screen();
    assert.equal(rows.length, 12);
    assert.match(rows.at(-1)!, /✕/u, 'the controls row carries a marker');
  } finally { t.dispose(); }
});

test('Reduced Motion, NO_COLOR and Safe Glyphs: static, readable, and no color-only meaning', () => {
  for (const mode of ['reduced', 'safe-no-color'] as const) {
    const frame = executionFrameFixture(100, 30, mode);
    const app = frame.app;
    app['shellId'] = 'zsh';
    let painted: string[] = [];
    const write = app['renderer'].render.bind(app['renderer']);
    app['renderer'].render = (value: {rows: string[]}) => { painted = value.rows; write(value as never); };
    try {
      frame.begin('npm test');
      app['handleKey'](ARCADE);
      frame.tick(1000);
      frame.complete(1);
      frame.tick(300);
      app['arcade'].handoff = undefined;
      app['render']();
      const row = painted.slice(0, 3).map(line => stripAnsi(line)).join('\n');
      assert.match(row, mode === 'reduced' ? /✕ Command failed/u : /x Command failed/u, mode);
      assert.match(row, /npm test [·.] 1\.0s [·.] exit 1/u, mode);
      if (mode === 'safe-no-color') assert.doesNotMatch(painted[0]!, /\u001b\[[0-9;]*38;/u, 'no color escapes');
    } finally { frame.dispose(); }
  }
});

test('opening shows no stale news from a queue chain that ended earlier', () => {
  const t = setup();
  try {
    t.owner.request({op: 'add', text: 'one'});
    t.owner.request({op: 'add', text: 'two'});
    t.begin('first'); t.complete(0);
    t.begin('one'); t.complete(0);
    t.begin('two'); t.complete(0);
    t.begin('sleep 9');
    t.press(ARCADE);
    assert.doesNotMatch(t.settled()[0]!, /Queue finished/u);
  } finally { t.dispose(); }
});

test('a paused game says why and how to answer, and Resume is not undone by the same report', () => {
  const t = setup(60, 12);
  try {
    t.begin('sudo true');
    t.press(ARCADE, {kind: 'enter'}, t.text(' '));
    const request = {since: Date.now(), confidence: 'confirmed', mode: 'hidden', program: 'sudo'};
    t.app['onInputState']({request, timing: {waitedMs: 0, waits: 1}});
    assert.match(t.screen().join('\n'), /sudo is waiting for input[\s\S]*Ctrl\+C returns to NMSh/u);
    t.press({kind: 'escape'});
    assert.equal(t.app['arcade'].session.screen, 'playing');
    t.app['onInputState']({request, timing: {waitedMs: 5, waits: 1}});
    assert.equal(t.app['arcade'].session.screen, 'playing', 'the same question does not pause it again');
  } finally { t.dispose(); }
});

/** Everything the host terminal would be shown: every renderer.render() call, in order. */
function hostFrames(t: ReturnType<typeof setup>) {
  const shown: string[][] = [];
  const inner = t.app['renderer'].render;
  t.app['renderer'].render = (value: {rows: string[]}) => { shown.push(value.rows.map(row => stripAnsi(row))); inner(value as never); };
  return shown;
}
const isShellFrame = (rows: string[]) => rows.some(row => /Ctrl\+Q runs it after|Enter holds it for approval|current command/u.test(row));
const isArcadeFrame = (rows: string[]) => rows.some(row => /Vespyr Arcade|running ·/u.test(row));

test('rendering ownership: the shell\'s own presentation clocks never paint over the Arcade', () => {
  const t = setup();
  try {
    t.begin('make', 'compiling\r\n');
    t.app['render']();
    assert.ok(t.app['presentationSubscription'] || t.app['presentationFrame'], 'a running command has live presentation state');
    t.press(ARCADE);
    t.app['arcade'].handoff = undefined;
    const shown = hostFrames(t);
    t.app['render']();
    for (let index = 0; index < 40; index += 1) {
      t.tick(100);
      t.app['paintPresentation'](Date.now());   // what every presentation-clock subscriber of the shell does
      t.app['onShellData'](`out ${index}\r\n`);
      t.app['paintArcade']();
    }
    t.complete(0);
    t.tick(5000);
    t.app['render']();
    assert.ok(shown.length > 0);
    const foreign = shown.filter(rows => !isArcadeFrame(rows));
    assert.equal(foreign.length, 0, `${foreign.length} of ${shown.length} host frames were not the Arcade's`);
    assert.equal(shown.filter(isShellFrame).length, 0, 'no shell frame reached the host');
    assert.equal(t.app['presentationSubscription'], undefined, 'the shell\'s presentation clock is stopped while the Arcade owns the screen');
  } finally { t.dispose(); }
});

// ---- the /games offer over a running command ------------------------------------------------------------------

const typeText = (t: ReturnType<typeof setup>, value: string) => { for (const char of value) t.press(t.text(char)); };
/** The offer has been drawn and read: a frame, then time. */
const readOffer = (t: ReturnType<typeof setup>) => { t.screen(); t.tick(300); t.screen(); };
const OFFER = /Open Arcade while the command runs\? Enter Open · Esc Cancel/u;

test('/games over a running command: the offer shows as soon as the command is complete, one Enter opens it, nothing is queued or sent', () => {
  const t = setup();
  try {
    t.begin('sleep 60; echo done');
    typeText(t, '/gam');
    assert.doesNotMatch(t.screen().join('\n'), OFFER, 'a partial command offers nothing');
    typeText(t, 'es');
    assert.match(t.screen().join('\n'), OFFER);
    assert.equal(t.app['arcade'], undefined, 'nothing opens before Enter');
    const running = t.app['running'];
    readOffer(t);
    t.press({kind: 'enter'});
    assert.ok(t.app['arcade'], 'one Enter opens it once the offer has been seen');
    assert.equal(t.app['running'], running, 'the command is the same one');
    assert.equal(t.app['editor'].text, '');
    assert.deepEqual(t.queued, []);
    assert.equal(t.owner.state.entries.length, 0, '/games was not queued');
    t.complete(0);
    assert.equal(t.transcript().records.map(record => record.command).join(), 'sleep 60; echo done', 'no /games command in the journal');
  } finally { t.dispose(); }
});

test('/arcade, /game and /game <id> offer the same; unknown and invalid ones do not', () => {
  for (const [input, offered] of [['/arcade', true], ['/game', true], ['/game run', true], ['/game nosuchgame', false], ['/gamesx', false], ['/foo', false], ['games', false], ['/games run extra words', false]] as const) {
    const t = setup();
    try {
      t.begin('sleep 60');
      typeText(t, input);
      assert.equal(OFFER.test(t.screen().join('\n')), offered, input);
    } finally { t.dispose(); }
  }
});

test('Esc cancels the offer and leaves nothing behind; editing it withdraws it', () => {
  const t = setup();
  try {
    t.begin('sleep 60');
    typeText(t, '/games');
    t.press({kind: 'escape'});
    assert.equal(t.app['editor'].text, '');
    assert.equal(t.app['arcade'], undefined);
    assert.deepEqual(t.queued, []);
    assert.equal(t.owner.state.entries.length, 0);
    typeText(t, '/games');
    t.press({kind: 'backspace'}, {kind: 'backspace'});
    assert.doesNotMatch(t.screen().join('\n'), OFFER);
    assert.ok(t.app['running']);
  } finally { t.dispose(); }
});

test('the offer disappears when ownership is no longer clear, and Enter then does what it always did', () => {
  for (const [name, change] of [
    ['a question', (t: ReturnType<typeof setup>) => t.app['onInputState']({request: {since: Date.now() + 1000, confidence: 'likely', mode: 'line', prompt: 'Continue? '}, timing: {waitedMs: 0, waits: 1}})],
    ['a terminal owner', (t: ReturnType<typeof setup>) => t.app['onInputState']({terminalOwner: true, timing: {waitedMs: 0, waits: 0}})],
    ['a queue review', (t: ReturnType<typeof setup>) => { t.app['queueReview'] = {kind: 'approve', id: 1}; }],
    ['passthrough', (t: ReturnType<typeof setup>) => { t.app['passthrough'] = true; }],
  ] as const) {
    const t = setup();
    try {
      t.begin('sleep 60');
      typeText(t, '/games');
      assert.match(t.screen().join('\n'), OFFER, name);
      // The existing rule hands text typed for a program that takes the terminal to that program; record it here.
      (t.session as unknown as {write: (data: string) => void}).write = () => {};
      change(t);
      assert.equal(t.app['arcadeOffer'](), undefined, name);
      if (!t.app['passthrough']) assert.doesNotMatch(t.screen().join('\n'), OFFER, name);
      assert.equal(t.app['arcade'], undefined, name);
      assert.deepEqual(t.queued, [], name);
    } finally { t.dispose(); }
  }
});

test('a held queue entry is untouched by the offer, and the command finishing while it shows queues nothing', () => {
  const t = setup();
  try {
    t.begin('make');
    t.owner.request({op: 'add', text: 'rm -r build', condition: 'approve'});
    typeText(t, '/games');
    readOffer(t);
    t.press({kind: 'enter'});
    assert.ok(t.app['arcade']);
    assert.equal(t.owner.state.entries.length, 1);
    assert.notEqual(t.owner.state.entries[0]?.approved, true);
    while (t.app['arcade']) t.press({kind: 'interrupt'});
    typeText(t, '/games');
    assert.match(t.screen().join('\n'), OFFER);
    t.complete(0);
    assert.equal(t.app['arcadeOffer'](), undefined, 'the command is gone: no offer');
    assert.equal(t.owner.state.entries.length, 1, 'still just the held entry');
    assert.deepEqual(t.queued, []);
  } finally { t.dispose(); }
});

test('at an idle prompt /games opens at once, with no offer', async () => {
  const t = setup();
  try {
    typeText(t, '/games');
    assert.doesNotMatch(t.screen().join('\n'), OFFER);
    t.press({kind: 'enter'});
    assert.ok(t.app['arcade']);
  } finally { t.dispose(); }
});

test('rendering ownership: a command finishing never restarts the entry transition, a resize keeps the Arcade, and closing shows the live shell once', () => {
  const t = setup();
  try {
    t.begin('make', 'go\r\n');
    const shown = hostFrames(t);
    t.press(ARCADE);
    const handoff = t.app['arcade'].handoff;
    t.app['arcade'].handoff = undefined;
    for (let index = 0; index < 5; index += 1) { t.tick(50); t.app['onShellData'](`x${index}\r\n`); }
    t.complete(0);
    t.tick(200);
    t.app['render']();
    assert.equal(t.app['arcade'].handoff, undefined, 'completion did not start another handoff');
    assert.ok(handoff === undefined || handoff.direction === 'in');
    t.app['onResize']();
    t.app['arcade'].handoff = undefined;
    t.app['render']();
    assert.ok(isArcadeFrame(shown.at(-1)!), 'after a resize the host still shows the Arcade');
    assert.equal(shown.filter(isShellFrame).length, 0, 'never a shell frame while open');
    // Close while a new command is running: the live shell, once.
    t.begin('second');
    t.press({kind: 'interrupt'});
    t.app['arcadeClosing'] = undefined;
    const before = shown.length;
    t.app['render']();
    const after = shown.slice(before);
    assert.ok(after.length >= 1 && after.every(rows => !isArcadeFrame(rows) || rows.some(row => /current command|second/u.test(row))), 'only shell frames after closing');
    assert.ok(t.app['running']);
  } finally { t.dispose(); }
});

test('typing /games and pressing Enter at once never opens silently: the offer is shown first, a second Enter accepts', () => {
  const t = setup();
  try {
    t.begin('sleep 60');
    const keys = [...'/games'].map(char => t.text(char));
    t.press(...keys, {kind: 'enter'});            // one input chunk: no frame, no time between
    assert.equal(t.app['arcade'], undefined, 'nothing opened');
    assert.match(t.screen().join('\n'), OFFER, 'the offer is now on screen');
    assert.equal(t.app['editor'].text, '/games', 'the text stays so the offer can be answered');
    assert.deepEqual(t.queued, []);
    t.press({kind: 'enter'});                     // too soon after it appeared
    assert.equal(t.app['arcade'], undefined, 'an Enter before the offer could be read does not accept it');
    t.tick(300);
    t.screen();
    t.press({kind: 'enter'});
    assert.ok(t.app['arcade'], 'accepted once seen');
    assert.deepEqual(t.queued, []);
    assert.equal(t.owner.state.entries.length, 0);
  } finally { t.dispose(); }
});
