import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {SessionClient, SessionClientEvents} from '../src/session/SessionClient.js';
import {LiveSandbox} from './helpers/liveFrontend.js';
import type {ShellId} from '../src/shell/adapters/ShellAdapter.js';

class ReattachedSession extends EventEmitter<SessionClientEvents> implements SessionClient {
  readonly features = new Set<never>();
  readonly resizes: {columns: number; rows: number}[] = [];
  readonly writes: string[] = [];
  readonly acknowledgements: number[] = [];
  constructor(private readonly replayOnStart = true) { super(); }
  start() { if (this.replayOnStart) this.emit('replayed', {truncatedBytes: 0}); }
  submit() {} interrupt() {} endInput() {} kill() {} detach() {} queue() {}
  write(data: string) { this.writes.push(data); }
  resize(columns: number, rows: number) { this.resizes.push({columns, rows}); }
  ack(seq: number) { this.acknowledgements.push(seq); }
  async switchShell(shell: ShellId) { return {shell, pid: 123}; }
}

async function heldJournalApp(fullscreen: boolean, {replayOnStart = true, reattach = fullscreen, modes = '', restoredCommand = ''} = {}) {
  const sandbox = new LiveSandbox();
  const keys = ['HOME', 'XDG_CONFIG_HOME', 'NMSH_RUNTIME_DIR', 'TMPDIR', 'TMP', 'TEMP'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = sandbox.env[key];
  const client = new ReattachedSession(replayOnStart);
  const app = new TerminalApp({client, mode: 'service', sessionId: 'fullscreen-test',
    ...(reattach ? {attached: {sessionId: 'fullscreen-test', pid: 123, cwd: process.cwd(),
      fullscreen: fullscreen ? 1 : 0, modes, running: fullscreen ? 'zsh fullscreen.zsh' : 'sleep 999', ackedSeq: 0}} : {})});
  // Model the journal's restored active command before its unacknowledged exec replay.
  if (restoredCommand) app['onShellExec'](restoredCommand);
  // Observe run's handoff; construction used the non-TTY test host's default dimensions.
  client.resizes.length = 0;
  const phases: string[] = [];
  const restoredModes: string[] = [];
  app['dimensions'] = () => ({columns: 90, rows: 33});
  app['render'] = () => {};
  app['refreshContext'] = async () => {};
  app['renderer'].enter = () => { phases.push('enter'); };
  app['renderer'].suspendForPassthrough = (restore = '') => { phases.push('handoff'); restoredModes.push(restore); };
  app['renderer'].leave = () => {};
  let releaseSave!: () => void;
  const held = new Promise<void>(resolve => { releaseSave = resolve; });
  let saveStarted!: () => void;
  const saving = new Promise<void>(resolve => { saveStarted = resolve; });
  app['transcriptStore'].save = async () => { saveStarted(); await held; };
  if (reattach) {
    app['continuedJournal'] = app['transcriptStore'].create({startCwd: process.cwd(), finalCwd: process.cwd(),
      transcript: app['output'].transcript(), journaled: true});
  }
  // Control the save boundary without writing a journal or exercising filesystem locks.
  app['transcriptStore'].withLock = async (_id, task) => task();
  const running = app.run();
  let runFinished = false;
  void running.then(() => { runFinished = true; }, () => { runFinished = true; });
  return {app, client, phases, restoredModes, saving, releaseSave, running, finished: () => runFinished,
    async cleanup() {
      releaseSave();
      await new Promise<void>(resolve => setImmediate(resolve));
      // A failing startup can install input after stop; reclaim only this fixture's resources.
      if (app['stopped'] && process.stdin.listeners('data').includes(app['onInput'])) app['stopped'] = false;
      app['stop'](0);
      client.kill();
      try { await running; } finally {
        for (const key of keys) {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        }
        await sandbox.dispose();
      }
    },
  };
}

test('fullscreen reattachment hands off and resizes before its first journal save completes', async () => {
  const fixture = await heldJournalApp(true);
  const {app, client, phases} = fixture;
  try {
    await fixture.saving;
    assert.deepEqual([...phases], ['enter', 'handoff'], 'clear and visible handoff precede the program repaint');
    assert.deepEqual(client.resizes, [{columns: 90, rows: 33}], 'journal IO cannot retain the attach nudge size');
    assert.ok(process.stdin.listeners('data').includes(app['onInput']), 'raw input is installed before visible handoff');
    app['onInput']('FOREGROUND-ONLY');
    assert.deepEqual(client.writes, ['FOREGROUND-ONLY']);
    assert.deepEqual(client.acknowledgements, [], 'held save is not acknowledged as durable');
    app['stop'](0);
    assert.equal(process.stdin.listeners('data').includes(app['onInput']), false, 'stop releases input immediately');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(fixture.finished(), false, 'shutdown still waits for the held durable checkpoint');
  } finally { await fixture.cleanup(); }
  assert.ok(client.acknowledgements.length > 0, 'durable save still acknowledges stream state');
});

test('late fullscreen replay releases startup without awaiting its held journal save', async () => {
  const fixture = await heldJournalApp(true, {replayOnStart: false});
  const {app, client, phases} = fixture;
  try {
    await fixture.saving;
    assert.deepEqual([...phases], [], 'startup has reached the held save before replay settles');
    assert.equal(process.stdin.listeners('data').includes(app['onInput']), false);
    client.emit('replayed', {truncatedBytes: 0});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], ['enter', 'handoff'], 'late terminal ownership cannot remain behind journal IO');
    assert.deepEqual(client.resizes, [{columns: 90, rows: 33}]);
    assert.ok(process.stdin.listeners('data').includes(app['onInput']));
    app['onInput']('FOREGROUND-LATE-REPLAY');
    assert.deepEqual(client.writes, ['FOREGROUND-LATE-REPLAY']);
    assert.deepEqual(client.acknowledgements, [], 'unfinished persistence is not acknowledged');
    app['stop'](0);
    assert.equal(process.stdin.listeners('data').includes(app['onInput']), false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(fixture.finished(), false, 'shutdown still awaits the outstanding save');
  } finally { await fixture.cleanup(); }
  assert.ok(client.acknowledgements.length > 0);
});

test('shutdown during journal startup cannot expose input when late replay or persistence completes', async () => {
  const fixture = await heldJournalApp(true, {replayOnStart: false});
  const {app, client, phases} = fixture;
  try {
    await fixture.saving;
    app['stop'](0);
    client.emit('replayed', {truncatedBytes: 0});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], [], 'late replay cannot restart a stopped frontend');
    assert.deepEqual(client.acknowledgements, [], 'the held journal remains undurable');
    fixture.releaseSave();
    await fixture.running;
    assert.deepEqual([...phases], [], 'persistence completion cannot restart frontend input or rendering');
    assert.deepEqual(client.resizes, []);
    assert.equal(process.stdin.listeners('data').includes(app['onInput']), false);
    assert.ok(client.acknowledgements.length > 0, 'shutdown still completes its durable checkpoint');
  } finally { await fixture.cleanup(); }
});

test('ordinary reattachment replay retains the journal barrier before exposing input', async () => {
  const fixture = await heldJournalApp(false, {replayOnStart: false, reattach: true});
  const {app, client, phases} = fixture;
  try {
    await fixture.saving;
    client.emit('replayed', {truncatedBytes: 0});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], [], 'ordinary replay does not authorize an early terminal handoff');
    assert.deepEqual(client.resizes, []);
    assert.equal(process.stdin.listeners('data').includes(app['onInput']), false);
    assert.deepEqual(client.acknowledgements, []);
    fixture.releaseSave();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], ['enter']);
    assert.ok(process.stdin.listeners('data').includes(app['onInput']));
    assert.ok(client.acknowledgements.length > 0);
  } finally { await fixture.cleanup(); }
});

test('replayed exec cannot grant historical fullscreen ownership before replay settles', async () => {
  const fixture = await heldJournalApp(false, {reattach: true, replayOnStart: false, restoredCommand: 'vim notes.txt'});
  const {app, client, phases} = fixture;
  try {
    await fixture.saving;
    client.emit('exec', 'vim notes.txt', {seq: 1, at: 1234});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], [], 'an unfinished replay cannot grant its historical program current input');
    assert.deepEqual(client.resizes, []);
    assert.equal(process.stdin.listeners('data').includes(app['onInput']), false);
    client.emit('prompt', {cwd: app['shellCwd'], exitCode: 0}, {seq: 2, at: 2345});
    client.emit('replayed', {truncatedBytes: 0});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], [], 'completed replay retains the ordinary journal barrier');
    assert.equal(process.stdin.listeners('data').includes(app['onInput']), false);
    assert.deepEqual(client.acknowledgements, []);
    fixture.releaseSave();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], ['enter']);
  } finally { await fixture.cleanup(); }
});

test('withdrawn fullscreen replay retains ordinary startup durability before exposing input', async () => {
  const fixture = await heldJournalApp(true, {replayOnStart: false});
  const {app, client, phases} = fixture;
  try {
    await fixture.saving;
    client.emit('replayed', {truncatedBytes: 0});
    // Both frames can be delivered in one socket batch, before startup's continuation.
    client.emit('prompt', {cwd: app['shellCwd'], exitCode: 0}, {seq: 1, at: 1234});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], [], 'withdrawn ownership cannot bypass ordinary journal durability');
    assert.equal(process.stdin.listeners('data').includes(app['onInput']), false);
    assert.deepEqual(client.acknowledgements, []);
    fixture.releaseSave();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], ['enter']);
    assert.ok(process.stdin.listeners('data').includes(app['onInput']));
  } finally { await fixture.cleanup(); }
});

test('renewed foreground ownership wakes startup without restoring the completed owner modes', async () => {
  const oldModes = '\u001b[?1000h';
  const fixture = await heldJournalApp(true, {replayOnStart: false, modes: oldModes});
  const {app, client, phases, restoredModes} = fixture;
  try {
    await fixture.saving;
    client.emit('replayed', {truncatedBytes: 0});
    client.emit('prompt', {cwd: app['shellCwd'], exitCode: 0}, {seq: 1, at: 1234});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], [], 'completed ownership leaves ordinary startup waiting for durability');
    // A prepared next command can start in the persistent session while that save is still held.
    client.emit('exec', 'vim notes.txt', {seq: 2, at: 2345});
    const currentModes = '\u001b[?1002h';
    client.emit('data', currentModes, {seq: 3, at: 2346});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(process.stdin.listeners('data').includes(app['onInput']), 'the current foreground owner cannot remain behind persistence');
    assert.deepEqual([...phases], ['enter', 'handoff'], 'renderer entry must precede the only handoff and repaint resize');
    assert.deepEqual(client.resizes, [{columns: 90, rows: 33}]);
    assert.equal(restoredModes.includes(oldModes), false, 'completed program modes cannot be installed for the new owner');
    assert.ok(restoredModes.at(-1)?.includes(currentModes), 'the current owner modes survive renderer entry');
    assert.deepEqual(client.acknowledgements, []);
    app['onInput']('CURRENT-FOREGROUND');
    assert.deepEqual(client.writes, ['CURRENT-FOREGROUND']);
  } finally { await fixture.cleanup(); }
});

test('mode-detected foreground ownership defers its only repaint resize until renderer entry', async () => {
  const fixture = await heldJournalApp(true, {replayOnStart: false});
  const {app, client, phases, restoredModes} = fixture;
  try {
    await fixture.saving;
    client.emit('replayed', {truncatedBytes: 0});
    client.emit('prompt', {cwd: app['shellCwd'], exitCode: 0}, {seq: 1, at: 1234});
    await new Promise<void>(resolve => setImmediate(resolve));
    client.emit('exec', 'custom-tui', {seq: 2, at: 2345});
    const currentModes = '\u001b[?1002h';
    client.emit('data', '\u001b[?1049h' + currentModes, {seq: 3, at: 2346});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], ['enter', 'handoff']);
    assert.deepEqual(client.resizes, [{columns: 90, rows: 33}]);
    assert.ok(restoredModes.at(-1)?.includes(currentModes));
    assert.ok(process.stdin.listeners('data').includes(app['onInput']));
    assert.deepEqual(client.acknowledgements, []);
    app['onInput']('MODE-OWNER');
    assert.deepEqual(client.writes, ['MODE-OWNER']);
  } finally { await fixture.cleanup(); }
});

test('ordinary startup waits for its durable journal identity before exposing frontend input', async () => {
  const fixture = await heldJournalApp(false);
  const {app, client, phases} = fixture;
  try {
    await fixture.saving;
    assert.deepEqual([...phases], [], 'ordinary startup retains its initial durable checkpoint barrier');
    assert.deepEqual(client.resizes, []);
    assert.equal(process.stdin.listeners('data').includes(app['onInput']), false);
    assert.deepEqual(client.acknowledgements, []);
    fixture.releaseSave();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], ['enter']);
    assert.ok(process.stdin.listeners('data').includes(app['onInput']));
    assert.ok(client.acknowledgements.length > 0);
  } finally { await fixture.cleanup(); }
});
