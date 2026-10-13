import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {SessionClient, SessionClientEvents} from '../src/session/SessionClient.js';
import {isolateConfig} from './support/isolatedConfig.js';

/** No PTY or semantic helper: only the real frontend's subscribed session boundary. */
class FixtureClient extends EventEmitter<SessionClientEvents> implements SessionClient {
  readonly features = new Set<never>();
  constructor(private readonly exitOnStart?: number) { super(); }
  start(): void { if (this.exitOnStart !== undefined) this.emit('exit', {exitCode: this.exitOnStart}); }
  submit(): void {}
  write(): void {}
  interrupt(): void {}
  endInput(): void {}
  resize(): void {}
  kill(): void {}
  detach(): void {}
  queue(): void {}
  ack(): void {}
  async switchShell(): Promise<never> { throw new Error('not used'); }
}

for (const mode of ['in-process', 'service'] as const) {
  test(`stopped ${mode} frontend ignores a late prompt without restarting work or changing cwd`, () => {
    const isolation = isolateConfig();
    const client = new FixtureClient();
    const app = new TerminalApp({client, mode, shell: 'fish'});
    let collections = 0;
    let projections = 0;
    try {
      app['render'] = () => {};
      app['refreshContext'] = async () => { collections += 1; };
      app['hostSemantics'].prompt = () => { projections += 1; };
      const stamp = (seq: number) => mode === 'service' ? {seq, at: 1234} : {at: 1234};
      client.emit('prompt', {cwd: '/fixture/active', exitCode: 0}, stamp(1));
      assert.equal(collections, 1, 'an active prompt still requests context');
      assert.equal(projections, 1, 'an active prompt still reaches host semantics');
      assert.equal(app['shellCwd'], '/fixture/active');
      assert.equal(app['context'].cwd, '/fixture/active');

      app['stop'](0);
      client.kill();
      const before = {cwd: app['shellCwd'], context: app['context'], seq: app['streamSeq']};
      client.emit('prompt', {cwd: '/fixture/late', exitCode: 7}, stamp(2));
      assert.equal(collections, 1, 'shutdown must not start another collector');
      assert.equal(projections, 1, 'shutdown must not project another prompt');
      assert.equal(app['shellCwd'], before.cwd);
      assert.equal(app['context'], before.context);
      assert.equal(app['context'].cwd, '/fixture/active');
      assert.equal(app['streamSeq'], before.seq, 'a discarded prompt is not acknowledged');
    } finally {
      app['stop'](0);
      client.kill();
      isolation.restore();
    }
  });
}

for (const boundary of ['exit-before-run', 'late-passthrough-after-stop'] as const) {
  test(`stopped startup cannot re-enable raw input at ${boundary}`, async () => {
    const isolation = isolateConfig();
    const input = process.stdin;
    const tty = Object.getOwnPropertyDescriptor(input, 'isTTY');
    const raw = Object.getOwnPropertyDescriptor(input, 'setRawMode');
    const modes: boolean[] = [];
    Object.defineProperty(input, 'isTTY', {configurable: true, value: true});
    Object.defineProperty(input, 'setRawMode', {configurable: true, value: (mode: boolean) => { modes.push(mode); return input; }});
    const client = new FixtureClient(boundary === 'exit-before-run' ? 17 : undefined);
    let app: TerminalApp | undefined;
    try {
      app = new TerminalApp({client, mode: 'service', shell: 'fish', sessionId: 'stopped-startup',
        ...(boundary === 'late-passthrough-after-stop' ? {attached: {
          sessionId: 'stopped-startup', pid: 123, cwd: '/fixture', fullscreen: 1, running: 'zsh fullscreen.zsh', ackedSeq: 0,
        }} : {})});
      if (boundary === 'late-passthrough-after-stop') {
        client.emit('replayed', {truncatedBytes: 0});
        app['stop'](17);
      }
      assert.equal(app['stopped'], true);
      modes.length = 0; // Observe only attempted input ownership after shutdown.
      let saves = 0;
      app['transcriptStore'].save = async () => { saves += 1; };
      if (boundary === 'late-passthrough-after-stop') client.emit('data', '', {});
      assert.equal(await app.run(), 17, 'the original session exit remains authoritative');
      assert.deepEqual(modes, [], 'shutdown cannot be followed by a new raw-mode transition');
      assert.equal(saves, 0, 'an already stopped launch starts no journal');
      assert.equal(input.listeners('data').includes(app['onInput']), false);
    } finally {
      app?.['stop'](17);
      client.kill();
      if (tty) Object.defineProperty(input, 'isTTY', tty); else Reflect.deleteProperty(input, 'isTTY');
      if (raw) Object.defineProperty(input, 'setRawMode', raw); else Reflect.deleteProperty(input, 'setRawMode');
      isolation.restore();
    }
  });
}
