import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {GRAVITY, RoverState, SPEED_CAP, Terrain, WHEEL_R, WHEEL_X, WHEEL_Y, MAX_SINK} from '../src/arcade/games/rover/logic.js';
import {roverGame} from '../src/arcade/games/rover/index.js';
import {displayWidth} from '../src/util/text.js';

const STEP = 1000 / 60;
function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 9, rng: createRng(9), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});

test('terrain: a pure function of x and the seed, flat at the start, steeper later, gentle slopes', () => {
  const a = new Terrain(5), b = new Terrain(5), c = new Terrain(6);
  assert.equal(a.height(500), b.height(500));
  assert.notEqual(a.height(500), c.height(500));
  assert.equal(a.height(10), 0);
  let max = 0;
  for (let x = 0; x < 4000; x += 0.5) max = Math.max(max, Math.abs(a.slope(x)));
  assert.ok(max < 1.4, `max slope ${max}`);
});

test('wheel contact: the rover settles on flat ground with both wheels sunk by the same small amount', () => {
  const s = new RoverState(1);
  for (let i = 0; i < 180; i += 1) s.step(STEP);
  assert.ok(!s.over);
  assert.ok(s.sink[0] > 0.5 && s.sink[0] < 1.5 && Math.abs(s.sink[0] - s.sink[1]) < 0.05, `sink ${s.sink}`);
  assert.ok(Math.abs(s.angle) < 0.01 && s.speed < 0.2);
});

test('physics: dropped from a height at speed the wheels never tunnel into the ground and speed stays capped', () => {
  for (const [drop, speed] of [[30, 0], [60, 40], [120, 70]] as const) {
    const s = new RoverState(2);
    s.x = 200; s.px = 200; s.y = s.terrain.height(200) - drop; s.vy = speed;
    for (let i = 0; i < 360 && !s.over; i += 1) {
      s.step(STEP);
      assert.ok(s.speed <= SPEED_CAP + 1e-6, 'speed capped');
      for (const side of [-WHEEL_X, WHEEL_X]) {
        const wheel = s.local(side, WHEEL_Y);
        assert.ok(wheel.y <= s.terrain.height(wheel.x) + WHEEL_R * 0.2 + 1e-6 + WHEEL_R * (MAX_SINK - 1) + 1.5, 'wheel center stays out of the ground');
      }
    }
  }
});

test('physics: with no input the rover never gains energy', () => {
  const s = new RoverState(3);
  s.x = 300; s.y = s.terrain.height(300) - 14; s.vx = 20;
  const energy = () => 0.5 * s.speed ** 2 - GRAVITY * s.y;
  const start = energy();
  for (let i = 0; i < 600 && !s.over; i += 1) { s.step(STEP); assert.ok(energy() <= start + 40, `energy ${energy()} vs ${start}`); }
});

test('drive: the gas speeds up the rover, the brake slows it, tilt turns it in the air', () => {
  const s = new RoverState(1);
  for (let i = 0; i < 90; i += 1) { s.drive(1); s.step(STEP); }
  assert.ok(s.vx > 15, `speed ${s.vx}`);
  const fast = s.vx;
  for (let i = 0; i < 60; i += 1) { s.drive(-1); s.step(STEP); }
  assert.ok(s.vx < fast * 0.5, 'braked');
  const air = new RoverState(1);
  air.y = -40;
  air.tilt(-1);
  for (let i = 0; i < 30; i += 1) air.step(STEP);
  assert.ok(air.angle < -0.05 && !air.grounded, `nose up in the air: ${air.angle}`);
});

test('fuel: drains faster under gas, a can refills it, an empty tank that stalls ends the run', () => {
  const s = new RoverState(1);
  for (let i = 0; i < 60; i += 1) s.step(STEP);
  const idle = 100 - s.fuel;
  const g = new RoverState(1);
  for (let i = 0; i < 60; i += 1) { g.drive(1); g.step(STEP); }
  assert.ok(100 - g.fuel > idle * 2);
  const pick = new RoverState(1);
  pick.fuel = 10;
  const can = pick.pickups[0]!;
  pick.x = can.x; pick.px = can.x; pick.y = can.y; pick.vx = 0; pick.vy = 0;
  pick.step(STEP);
  assert.ok(pick.fuel > 40 && pick.collected === 1);
  const dry = new RoverState(1);
  dry.fuel = 0;
  for (let i = 0; i < 400 && !dry.over; i += 1) dry.step(STEP);
  assert.ok(dry.over && dry.reason === 'fuel');
});

test('flip: landing on the roof ends the run', () => {
  const s = new RoverState(1);
  s.y = -12; s.angle = Math.PI; s.pangle = Math.PI;
  for (let i = 0; i < 200 && !s.over; i += 1) s.step(STEP);
  assert.ok(s.over && s.reason === 'flip');
});

test('determinism: same seed and inputs give the same run, at any frame split', () => {
  const run = (split: number) => {
    const s = new RoverState(7);
    for (let i = 0; i < 60 * 12 && !s.over; i += 1) {
      if (i % 20 === 0) s.drive(1);
      if (i % 90 === 40) s.tilt(-1);
      for (let k = 0; k < split; k += 1) s.step(STEP / split);
    }
    return s;
  };
  const a = run(1), b = run(1), c = run(2), d = run(4);
  assert.equal(a.x, b.x);
  for (const other of [c, d]) {
    assert.ok(Math.abs(a.x - other.x) < 0.01 && Math.abs(a.y - other.y) < 0.01, `split drift ${a.x} ${other.x}`);
    assert.equal(a.distance, other.distance);
  }
  assert.notEqual(new RoverState(8).terrain.height(400), new RoverState(7).terrain.height(400));
});

test('game: keys start and steer, a finished run is saved once with a record, dispose cleans up', () => {
  const record = memory();
  const game = roverGame.create(context(record));
  assert.equal(game.status, 'ready');
  assert.equal(game.key({kind: 'text', value: 'x'}), 'ignored');
  assert.equal(game.key({kind: 'right'}), 'handled');
  assert.equal(game.status, 'playing');
  for (const key of [{kind: 'left'}, {kind: 'up'}, {kind: 'down'}, {kind: 'text', value: 'd'}, {kind: 'text', value: 'a'}] as const) assert.equal(game.key(key), 'handled');
  for (let i = 0; i < 60 * 120 && game.status === 'playing'; i += 1) { game.key({kind: 'right'}); game.step(STEP); game.animate(STEP); }
  assert.equal(game.status, 'over');
  assert.ok(game.result && game.result.record && game.result.score > 0);
  assert.equal(record.raw().plays, 1);
  assert.equal(record.raw().best, game.result.score);
  assert.equal(game.key({kind: 'right'}), 'ignored');
  // A second, worse run keeps the best and is not a record.
  const best = record.raw().best as number;
  const second = roverGame.create(context(record, {seed: 9}));
  second.key({kind: 'left'});
  for (let i = 0; i < 60 * 30 && second.status === 'playing'; i += 1) second.step(STEP);
  for (let i = 0; i < 5; i += 1) second.key({kind: 'right'});
  for (let i = 0; i < 60 * 120 && second.status === 'playing'; i += 1) { second.key({kind: 'right'}); second.step(STEP); }
  assert.equal(second.result?.record, false);
  assert.equal(record.raw().best, Math.max(best, second.result!.score));
  game.dispose();
  second.dispose();
});

test('render: every size draws inside its bounds in color, without color, with safe glyphs and with reduced motion', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) {
    for (const mode of ['truecolor', 'none', 'reduced'] as const) {
      const game = roverGame.create(context(memory(), {
        size: {columns, rows}, seed: 3, rng: createRng(3),
        color: mode === 'none' ? 'none' : 'truecolor', safeGlyphs: mode === 'none',
        motion: mode === 'reduced' ? {reduced: true, effects: 'off'} : {reduced: false, effects: 'normal'},
      }));
      for (const phase of ['ready', 'playing', 'over'] as const) {
        if (phase === 'playing') for (let i = 0; i < 100; i += 1) { game.key({kind: 'right'}); game.step(STEP); game.animate(STEP); }
        if (phase === 'over') for (let i = 0; i < 60 * 90 && game.status === 'playing'; i += 1) { game.key({kind: 'right'}); game.step(STEP); game.animate(STEP); }
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0.5, arcadePalette());
        const lines = canvas.plain();
        assert.equal(lines.length, rows);
        for (const line of lines) assert.ok(displayWidth(line) <= columns, `${mode} ${columns}x${rows} ${phase}: ${line}`);
        if (phase === 'ready') assert.ok(lines.join('\n').includes('Rover'));
        if (mode === 'none' && phase === 'playing') assert.match(lines.join('\n'), /Fuel/);
      }
      game.dispose();
    }
  }
  const preview = new Canvas(30, 6);
  roverGame.preview(preview, 3, arcadePalette());
});
