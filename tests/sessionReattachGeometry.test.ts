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
  start() { this.emit('replayed', {truncatedBytes: 0}); }
  submit() {} interrupt() {} endInput() {} kill() {} detach() {} queue() {}
  write(data: string) { this.writes.push(data); }
  resize(columns: number, rows: number) { this.resizes.push({columns, rows}); }
  ack(seq: number) { this.acknowledgements.push(seq); }
  async switchShell(shell: ShellId) { return {shell, pid: 123}; }
}

async function heldJournalApp(fullscreen: boolean) {
  const sandbox = new LiveSandbox();
  const keys = ['HOME', 'XDG_CONFIG_HOME', 'NMSH_RUNTIME_DIR', 'TMPDIR', 'TMP', 'TEMP'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = sandbox.env[key];
  const client = new ReattachedSession();
  const app = new TerminalApp({client, mode: 'service', sessionId: 'fullscreen-test',
    ...(fullscreen ? {attached: {sessionId: 'fullscreen-test', pid: 123, cwd: process.cwd(),
      fullscreen: 1, running: 'zsh fullscreen.zsh', ackedSeq: 0}} : {})});
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
  if (fullscreen) {
    app['continuedJournal'] = app['transcriptStore'].create({startCwd: process.cwd(), finalCwd: process.cwd(),
      transcript: app['output'].transcript(), journaled: true});
  }
  // Control the save boundary without writing a journal or exercising filesystem locks.
  app['transcriptStore'].withLock = async (_id, task) => task();
  const running = app.run();
  let runFinished = false;
  void running.then(() => { runFinished = true; }, () => { runFinished = true; });
  return {app, client, phases, saving, releaseSave, finished: () => runFinished,
    async cleanup() {
      releaseSave();
      await new Promise<void>(resolve => setImmediate(resolve));
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
