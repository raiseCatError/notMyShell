import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {SessionClient, SessionClientEvents} from '../src/session/SessionClient.js';
import {LiveSandbox} from './helpers/liveFrontend.js';
import {HOST_QUERY} from '../src/host/probe.js';
import type {ShellId} from '../src/shell/adapters/ShellAdapter.js';

class ReattachedSession extends EventEmitter<SessionClientEvents> implements SessionClient {
  readonly features = new Set<never>();
  readonly resizes: {columns: number; rows: number}[] = [];
  readonly writes: string[] = [];
  readonly acknowledgements: number[] = [];
  detaches = 0;
  constructor(private readonly replayOnStart = true) { super(); }
  start() { if (this.replayOnStart) this.emit('replayed', {truncatedBytes: 0}); }
  submit() {} interrupt() {} endInput() {} kill() {} detach() { this.detaches += 1; } queue() {}
  write(data: string) { this.writes.push(data); }
  resize(columns: number, rows: number) { this.resizes.push({columns, rows}); }
  ack(seq: number) { this.acknowledgements.push(seq); }
  async switchShell(shell: ShellId) { return {shell, pid: 123}; }
}

// Compare listener identity without treating the editor's decoded-string handler as a raw Buffer handler.
const hasFrontendInput = (app: TerminalApp) => process.stdin.listeners('data').some(listener => Object.is(listener, app['onInput']));

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
  const exitBefore = new Set(process.listeners('exit'));
  const running = app.run();
  const ownedExit = process.listeners('exit').filter(listener => !exitBefore.has(listener));
  let runFinished = false;
  void running.then(() => { runFinished = true; }, () => { runFinished = true; });
  return {app, client, phases, restoredModes, saving, releaseSave, running, finished: () => runFinished,
    async cleanup() {
      releaseSave();
      await new Promise<void>(resolve => setImmediate(resolve));
      // A failing startup can install input after stop; reclaim only this fixture's resources.
      if (app['stopped'] && hasFrontendInput(app)) app['stopped'] = false;
      app['stop'](0);
      client.kill();
      try { await running; } finally {
        for (const listener of ownedExit) process.off('exit', listener);
        for (const key of keys) {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        }
        await sandbox.dispose();
      }
    },
  };
}

test('stopped frontends release their exit cleanup across repeated session switches and preserve other owners', async () => {
  const otherOwner = () => {};
  process.once('exit', otherOwner);
  const baseline = process.listeners('exit');
  try {
    for (let session = 0; session < 3; session += 1) {
      const fixture = await heldJournalApp(false);
      try {
        await fixture.saving;
        assert.ok(process.listeners('exit').length > baseline.length,
          'an active frontend owns its terminal exit cleanup');
        fixture.app['stop'](0);
        assert.deepEqual(process.listeners('exit'), baseline,
          'stop must release the old frontend before the next one opens, including while journaling waits');
        assert.equal(fixture.finished(), false, 'exit cleanup ownership does not remove the durable save barrier');
      } finally {
        await fixture.cleanup();
      }
    }
  } finally {
    process.off('exit', otherOwner);
  }
});

test('fullscreen reattachment hands off and resizes before its first journal save completes', async () => {
  const fixture = await heldJournalApp(true);
  const {app, client, phases} = fixture;
  try {
    await fixture.saving;
    assert.deepEqual([...phases], ['enter', 'handoff'], 'clear and visible handoff precede the program repaint');
    assert.deepEqual(client.resizes, [{columns: 90, rows: 33}], 'journal IO cannot retain the attach nudge size');
    assert.ok(hasFrontendInput(app), 'raw input is installed before visible handoff');
    app['onInput']('FOREGROUND-ONLY');
    assert.deepEqual(client.writes, ['FOREGROUND-ONLY']);
    assert.deepEqual(client.acknowledgements, [], 'held save is not acknowledged as durable');
    app['stop'](0);
    assert.equal(hasFrontendInput(app), false, 'stop releases input immediately');
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
    assert.equal(hasFrontendInput(app), false);
    client.emit('replayed', {truncatedBytes: 0});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], ['enter', 'handoff'], 'late terminal ownership cannot remain behind journal IO');
    assert.deepEqual(client.resizes, [{columns: 90, rows: 33}]);
    assert.ok(hasFrontendInput(app));
    app['onInput']('FOREGROUND-LATE-REPLAY');
    assert.deepEqual(client.writes, ['FOREGROUND-LATE-REPLAY']);
    assert.deepEqual(client.acknowledgements, [], 'unfinished persistence is not acknowledged');
    app['stop'](0);
    assert.equal(hasFrontendInput(app), false);
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
    assert.equal(hasFrontendInput(app), false);
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
    assert.equal(hasFrontendInput(app), false);
    assert.deepEqual(client.acknowledgements, []);
    fixture.releaseSave();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], ['enter']);
    assert.ok(hasFrontendInput(app));
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
    assert.equal(hasFrontendInput(app), false);
    client.emit('prompt', {cwd: app['shellCwd'], exitCode: 0}, {seq: 2, at: 2345});
    client.emit('replayed', {truncatedBytes: 0});
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], [], 'completed replay retains the ordinary journal barrier');
    assert.equal(hasFrontendInput(app), false);
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
    assert.equal(hasFrontendInput(app), false);
    assert.deepEqual(client.acknowledgements, []);
    fixture.releaseSave();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], ['enter']);
    assert.ok(hasFrontendInput(app));
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
    assert.ok(hasFrontendInput(app), 'the current foreground owner cannot remain behind persistence');
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
    assert.ok(hasFrontendInput(app));
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
    assert.equal(hasFrontendInput(app), false);
    assert.deepEqual(client.acknowledgements, []);
    fixture.releaseSave();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual([...phases], ['enter']);
    assert.ok(hasFrontendInput(app));
    assert.ok(client.acknowledgements.length > 0);
  } finally { await fixture.cleanup(); }
});


for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
  test(`catchable startup ${signal} stops during a held journal save without restoring input`, async () => {
    const fixture = await heldJournalApp(false, {replayOnStart: false, reattach: true});
    const {app, client, phases} = fixture;
    try {
      await fixture.saving;
      process.emit(signal);
      assert.equal(app['stopped'], true, 'the startup signal must reach normal shutdown');
      assert.equal(client.detaches, 1, 'the service-backed shell is detached');
      assert.deepEqual(phases, []);
      assert.equal(hasFrontendInput(app), false);
      assert.deepEqual(client.acknowledgements, [], 'held persistence remains undurable');
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(fixture.finished(), false, 'normal shutdown still awaits journal durability');
      fixture.releaseSave();
      assert.equal(await fixture.running, 0);
      assert.deepEqual(phases, [], 'save completion cannot re-enter a stopped frontend');
      assert.equal(hasFrontendInput(app), false);
      assert.ok(client.acknowledgements.length > 0);
    } finally { await fixture.cleanup(); }
  });

  test(`catchable startup ${signal} during the host probe cannot create a later journal`, async () => {
    const sandbox = new LiveSandbox();
    const keys = ['HOME', 'XDG_CONFIG_HOME', 'NMSH_RUNTIME_DIR', 'TMPDIR', 'TMP', 'TEMP'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    for (const key of keys) process.env[key] = sandbox.env[key];
    const client = new ReattachedSession(false);
    const app = new TerminalApp({client, mode: 'service', sessionId: 'probe-signal-test'});
    app['render'] = () => {};
    app['refreshContext'] = async () => {};
    app['renderer'].enter = () => { throw new Error('stopped probe cannot enter the renderer'); };
    app['renderer'].leave = () => {};
    let created = 0;
    const create = app['transcriptStore'].create.bind(app['transcriptStore']);
    app['transcriptStore'].create = (...args) => { created += 1; return create(...args); };
    const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const rawMode = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');
    const rawState = Object.getOwnPropertyDescriptor(process.stdin, 'isRaw');
    const exitBefore = new Set(process.listeners('exit'));
    let ownedExit = process.listeners('exit').slice(0, 0);
    const write = process.stdout.write;
    const rawChanges: boolean[] = [];
    let observed = false;
    let running: Promise<number> | undefined;
    try {
      Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value: true});
      Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: true});
      Object.defineProperty(process.stdin, 'isRaw', {configurable: true, writable: true, value: false});
      Object.defineProperty(process.stdin, 'setRawMode', {configurable: true, value: (raw: boolean) => {
        rawChanges.push(raw); process.stdin.isRaw = raw; return process.stdin;
      }});
      process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
        if (typeof chunk === 'string' && chunk.includes(HOST_QUERY)) {
          observed = true;
          process.emit(signal); // Exact probe boundary, with its unchanged bounded timer.
          return true;
        }
        return Reflect.apply(write, process.stdout, [chunk, ...args]);
      }) as typeof process.stdout.write;
      running = app.run();
      ownedExit = process.listeners('exit').filter(listener => !exitBefore.has(listener));
      assert.equal(observed, true, 'the real host probe issued its query');
      assert.equal(app['stopped'], true, 'the probe signal must reach normal shutdown');
      assert.equal(client.detaches, 1);
      assert.equal(await running, 0);
      assert.equal(created, 0, 'probe completion must not begin a journal after shutdown');
      assert.equal(hasFrontendInput(app), false);
      assert.equal(rawChanges.at(-1), false, 'normal shutdown restores the host raw mode');
    } finally {
      process.stdout.write = write;
      app['stop'](0);
      client.kill();
      try { if (running) await running; } finally {
        for (const listener of ownedExit) process.off('exit', listener);
        for (const [target, key, descriptor] of [
          [process.stdin, 'isTTY', stdinTTY], [process.stdout, 'isTTY', stdoutTTY],
          [process.stdin, 'setRawMode', rawMode], [process.stdin, 'isRaw', rawState],
        ] as const) {
          if (descriptor) Object.defineProperty(target, key, descriptor);
          else Reflect.deleteProperty(target, key);
        }
        for (const key of keys) {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        }
        await sandbox.dispose();
      }
    }
  });
}
