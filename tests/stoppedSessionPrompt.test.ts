import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {SessionClient, SessionClientEvents} from '../src/session/SessionClient.js';
import {isolateConfig} from './support/isolatedConfig.js';

/** No PTY or semantic helper: only the real frontend's subscribed session boundary. */
class FixtureClient extends EventEmitter<SessionClientEvents> implements SessionClient {
  readonly features = new Set<never>();
  start(): void {}
  submit(): void {}
  write(): void {}
  interrupt(): void {}
  endInput(): void {}
  resize(): void {}
  kill(): void {}
  detach(): void {}
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
