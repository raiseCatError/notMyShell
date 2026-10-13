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

async function heldJournalApp(fullscreen: boolean, {replayOnStart = true, reattach = fullscreen} = {}) {
  const sandbox = new LiveSandbox();
  const keys = ['HOME', 'XDG_CONFIG_HOME', 'NMSH_RUNTIME_DIR', 'TMPDIR', 'TMP', 'TEMP'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = sandbox.env[key];
  const client = new ReattachedSession(replayOnStart);
  const app = new TerminalApp({client, mode: 'service', sessionId: 'fullscreen-test',
    ...(reattach ? {attached: {sessionId: 'fullscreen-test', pid: 123, cwd: process.cwd(),
      fullscreen: fullscreen ? 1 : 0, running: fullscreen ? 'zsh fullscreen.zsh' : 'sleep 999', ackedSeq: 0}} : {})});
  // Observe run's handoff; construction used the non-TTY test host's default dimensions.
  client.resizes.length = 0;
  const phases: string[] = [];
  app['dimensions'] = () => ({columns: 90, rows: 33});
  app['render'] = () => {};
  app['renderer'].enter = () => { phases.push('enter'); };
  app['renderer'].suspendForPassthrough = () => { phases.push('handoff'); };
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
  return {app, client, phases, saving, releaseSave, running, finished: () => runFinished,
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
