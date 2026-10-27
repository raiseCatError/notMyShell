import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionService} from '../src/session/SessionService.js';

// Exercise production geometry scheduling without a foreground process scheduler.
// Native repaint/input behavior remains covered by sessionLifecycle.test.ts.
function fixture(columns = 100, rows = 30) {
  const service = new SessionService({runtimeDir: '/unused'});
  const sizes: {columns: number; rows: number}[] = [];
  const controller = () => {};
  const session = {
    record: {id: 'geometry'}, size: {columns, rows}, resizes: 0, controller,
    shell: {resize(c: number, r: number) { sizes.push({columns: c, rows: r}); }},
  } as unknown as Parameters<SessionService['redraw']>[0];
  service['sessions'].set(session.record.id, session);
  return {service, session, sizes};
}

test('changed attachment geometry goes directly to its final size without a neighboring repaint', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture();
  f.service['redraw'](f.session, 110, 35);
  assert.deepEqual(f.sizes, [{columns: 110, rows: 35}]);
  assert.deepEqual(f.session.size, {columns: 110, rows: 35});
  t.mock.timers.tick(100);
  assert.equal(f.sizes.length, 1);
});

test('same-size fullscreen repaint restores geometry and records the actual size', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture();
  f.service['redraw'](f.session, 100, 30);
  assert.deepEqual(f.session.size, {columns: 100, rows: 29});
  t.mock.timers.tick(40);
  assert.deepEqual(f.sizes, [{columns: 100, rows: 29}, {columns: 100, rows: 30}]);
  assert.deepEqual(f.session.size, {columns: 100, rows: 30});
});

test('a repaint restoration never runs for a replacement or detached controller', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  for (const next of [undefined, () => {}]) {
    const f = fixture();
    f.service['redraw'](f.session, 100, 30);
    f.session.controller = next;
    t.mock.timers.tick(100);
    assert.equal(f.sizes.length, 1);
  }
});

test('a newer window resize supersedes a pending repaint restoration', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture();
  f.service['redraw'](f.session, 100, 30);
  f.session.resizes++;
  f.service['resize'](f.session, 120, 40);
  t.mock.timers.tick(100);
  assert.deepEqual(f.sizes, [{columns: 100, rows: 29}, {columns: 120, rows: 40}]);
  assert.deepEqual(f.session.size, {columns: 120, rows: 40});
});

test('a failed PTY resize does not change the tracked geometry', () => {
  const f = fixture();
  f.session.shell.resize = () => { throw new Error('fixture failure'); };
  f.service['resize'](f.session, 110, 35);
  assert.deepEqual(f.session.size, {columns: 100, rows: 30});
});
