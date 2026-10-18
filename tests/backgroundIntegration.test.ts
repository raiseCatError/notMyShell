import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {DEFAULT_PREFERENCES, rememberFamily} from '../src/backgroundTasks/preferences.js';
import type {TaskOp} from '../src/backgroundTasks/protocol.js';
import type {TaskRecord} from '../src/backgroundTasks/supervisor.js';
import type {Key} from '../src/terminal/keys.js';

interface Harness {app: TerminalApp; ops: TaskOp[]; submitted: string[]}

/** A frontend whose shell is never asked to run anything: submissions and task requests are recorded instead. */
function harness(): Harness {
  const app = new TerminalApp();
  const ops: TaskOp[] = [];
  const submitted: string[] = [];
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'terminalDimensions', {value: () => ({columns: 120, rows: 30})});
  app['startupPending'] = false;
  app['session'].submit = (command: string) => { submitted.push(command); };
  app['session'].task = (op: TaskOp) => { ops.push(op); };
  return {app, ops, submitted};
}
const done = ({app}: Harness) => { app['running'] = undefined; app['stop'](0); app['session'].kill(); };
const key = (h: Harness, value: Key) => h.app['handleKey'](value);
const type = (h: Harness, text: string) => { h.app['editor'].replaceText(text); };
const enter = (h: Harness) => h.app['routeComposer']('enter');
const flush = () => new Promise(resolve => setImmediate(resolve));
/** submit() first awaits the (asynchronous) install check: wait for the outcome, bounded. */
async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${what} not reached`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const task = (id: string, extra: Partial<TaskRecord> = {}): TaskRecord => ({id, command: 'adb logcat', family: 'adb logcat', cwd: '/', shell: '/bin/zsh', startedAt: Date.now(), state: 'running', ...extra});

test('by default a recognized long-running command runs in the foreground exactly as before; nothing is offered', async () => {
  const h = harness();
  try {
    assert.equal(h.app['background'].preferences.suggestions, 'off');
    type(h, 'tail -f /var/log/system.log');
    enter(h);
    await until(() => h.submitted.length > 0, 'foreground submission');
    assert.deepEqual(h.ops, []);
    assert.equal(h.app['background'].suggestion, undefined);
    assert.ok(h.submitted.some(command => command.includes('tail -f /var/log/system.log')), 'the shell received it');
  } finally { done(h); }
});

test('an Always family runs in the background from the composer, with the shell\'s directory and PATH; nothing reaches the shell', async () => {
  const h = harness();
  try {
    h.app['background'].preferences = rememberFamily(DEFAULT_PREFERENCES(), 'tail -f', 'always');
    type(h, 'tail -f app.log');
    enter(h);
    await until(() => h.ops.length > 0, 'background start');
    assert.equal(h.ops.length, 1);
    const op = h.ops[0]!;
    assert.equal(op.op, 'start');
    assert.ok(op.op === 'start' && op.command === 'tail -f app.log' && op.family === 'tail -f' && op.cwd === h.app['canonicalShellCwd']() && op.path === h.app['shellPath']());
    assert.deepEqual(h.submitted, []);
    assert.equal(h.app['running'], undefined, 'no foreground command was started');
    assert.equal(h.app['editor'].text, '');
  } finally { done(h); }
});

test('never for queued commands, a running program\'s input or startup: only the direct composer submission', async () => {
  const h = harness();
  try {
    h.app['background'].preferences = rememberFamily(DEFAULT_PREFERENCES(), 'tail -f', 'always');
    // A foreground command owns input: Enter goes to it (or the queue), never to a background task.
    h.app['running'] = {command: 'cat', startedAt: Date.now(), interrupted: false, cleared: false, startId: 1, cwd: '/'};
    type(h, 'tail -f app.log');
    enter(h);
    await flush();
    assert.deepEqual(h.ops, []);
    h.app['running'] = undefined;
    h.app['editor'].clear();
    // Startup: nothing is decided before the shell is ready.
    h.app['startupPending'] = true;
    await h.app['submit'](false, true, true);
    assert.deepEqual(h.ops, []);
    h.app['startupPending'] = false;
    // Any other caller of submit (history rerun, install retry, presets) is not the composer path.
    type(h, 'tail -f app.log');
    await h.app['submit'](false, true, false);
    assert.deepEqual(h.ops, []);
    assert.ok(h.submitted.some(command => command.includes('tail -f app.log')));
  } finally { done(h); }
});

test('with suggestions on: b backgrounds once, Enter runs here unchanged, a and n are remembered, Esc returns the draft, other keys keep typing', async () => {
  const h = harness();
  try {
    h.app['background'].preferences = {...DEFAULT_PREFERENCES(), suggestions: 'ask'};
    const offer = async () => { type(h, 'adb logcat'); enter(h); await until(() => Boolean(h.app['background'].suggestion), 'offered'); };
    await offer();
    assert.equal(h.app['workspaceOwner'](), 'PANEL', 'while offered, the composer is not taking typing as a command');
    key(h, {kind: 'text', value: 'b'});
    assert.equal(h.ops.at(-1)?.op, 'start');
    await offer();
    key(h, {kind: 'enter'});
    await until(() => h.submitted.some(command => command.includes('adb logcat')), 'Enter twice is the old behavior');
    assert.ok(h.app['running'], 'it runs in the foreground; a background offer waits for the next idle prompt');
    h.app['running'] = undefined;
    await offer();
    key(h, {kind: 'escape'});
    assert.equal(h.app['editor'].text, 'adb logcat');
    h.app['editor'].clear();
    await offer();
    key(h, {kind: 'text', value: ' -d'});
    assert.equal(h.app['editor'].text, 'adb logcat -d', 'nothing typed is lost');
    h.app['editor'].clear();
    await offer();
    key(h, {kind: 'text', value: 'n'});
    assert.equal(h.app['background'].preferences.families['adb logcat'], 'never');
  } finally { done(h); }
});

test('Up from an idle composer: the agent shelf first, then the task bar, then history; never with a draft or a running command', async () => {
  const h = harness();
  try {
    h.app['onBackgroundTasks']([task('t1')]);
    type(h, 'draft');
    key(h, {kind: 'up'});
    assert.equal(h.app['background'].bar.focused, false, 'a draft keeps Up');
    h.app['editor'].clear();
    h.app['running'] = {command: 'sleep 5', startedAt: Date.now(), interrupted: false, cleared: false, startId: 1, cwd: '/'};
    key(h, {kind: 'up'});
    assert.equal(h.app['background'].bar.focused, false, 'a running command owns input');
    h.app['running'] = undefined;
    Object.defineProperty(h.app, 'shelfShown', {value: () => true, configurable: true});
    key(h, {kind: 'up'});
    assert.equal(h.app['shelf'].focused, true, 'a shown agent shelf comes first');
    assert.equal(h.app['background'].bar.focused, false);
    h.app['shelf'].focused = false;
    Object.defineProperty(h.app, 'shelfShown', {value: () => false, configurable: true});
    key(h, {kind: 'up'});
    assert.equal(h.app['background'].bar.focused, true);
    assert.equal(h.app['workspaceOwner'](), 'PANEL');
    // In the bar: x interrupts the selected task; Esc returns.
    key(h, {kind: 'text', value: 'x'});
    assert.deepEqual(h.ops.at(-1), {op: 'stop', id: 't1', level: 'interrupt'});
    key(h, {kind: 'escape'});
    assert.equal(h.app['background'].bar.focused, false);
    key(h, {kind: 'selectUp'});
    assert.equal(h.app['background'].bar.focused, true, 'Shift+Up always enters the bar from an empty composer');
  } finally { done(h); }
});

test('announcements are NMSh lines, never task output; a reattached window adopts the list silently', async () => {
  const h = harness();
  try {
    const lines: string[] = [];
    Object.defineProperty(h.app['output'], 'addFrontendInteraction', {value: (_command: string, text: string) => { lines.push(text); }});
    // A window that just attached: the first list it receives is what already ran.
    h.app['backgroundSeen'] = undefined;
    h.app['onBackgroundTasks']([task('t1')]);
    assert.deepEqual(lines, [], 'the list found on attach was announced where it started');
    h.app['onBackgroundTasks']([task('t1'), task('t2', {command: 'tail -f x', family: 'tail -f'})]);
    assert.match(lines.at(-1)!, /^Background t2 started: tail -f/u);
    h.app['session'].emit('taskOutput', 't2', {lines: [{seq: 1, text: 'SECRET-TASK-LINE'}], partial: '', dropped: 0, received: 17});
    assert.ok(!lines.some(line => line.includes('SECRET-TASK-LINE')), 'task output is not written to the transcript');
    assert.equal(h.app['background'].output('t2').lines()[0]?.text, 'SECRET-TASK-LINE');
    h.app['onBackgroundTasks']([task('t1'), task('t2', {command: 'tail -f x', family: 'tail -f', state: 'failed', exitCode: 1, endedAt: Date.now()})]);
    assert.match(lines.at(-1)!, /^Background t2 · tail -f · failed/u, 'a failure is announced by default');
  } finally { done(h); }
});

test('/background: run keeps the text exactly, kill is immediate, a running task is not removed, t3 opens its output', async () => {
  const h = harness();
  try {
    const said: string[] = [];
    Object.defineProperty(h.app['output'], 'addFrontendInteraction', {value: (_command: string, text: string) => { said.push(text); }});
    const run = (text: string) => h.app['runSlash'](text, parseSlashCommand(text)!);
    await run("/background run   printf '%s\\n' \"a  b\"");
    assert.deepEqual(h.ops.at(-1), {op: 'start', command: "printf '%s\\n' \"a  b\"", cwd: h.app['canonicalShellCwd'](), path: h.app['shellPath']()});
    await run('/bg run vim notes.txt');
    assert.match(said.at(-1)!, /not run in the background/u, 'programs that need the terminal are refused');
    h.app['onBackgroundTasks']([task('t3')]);
    await run('/background kill t3');
    assert.deepEqual(h.ops.at(-1), {op: 'stop', id: 't3', level: 'kill'});
    const before = h.ops.length;
    await run('/background remove t3');
    assert.equal(h.ops.length, before);
    assert.match(said.at(-1)!, /Not removed: stop it first/u);
    await run('/background t3');
    assert.equal(h.app['background'].panel?.kind, 'view');
    key(h, {kind: 'escape'});
    assert.equal(h.app['background'].panel, undefined);
    await run('/background');
    assert.equal(h.app['background'].panel?.kind, 'manager');
    key(h, {kind: 'escape'});
    // An older session service offers no background tasks: say so, start nothing.
    Object.defineProperty(h.app['session'], 'features', {value: new Set(['queue']), configurable: true});
    await run('/background run sleep 1');
    assert.match(said.at(-1)!, /need a session service from this NMSh release/u);
  } finally { done(h); }
});
