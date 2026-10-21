import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {JAR_H, JAR_W, MAX_BODIES, RADII, TIERS, YarnState, type Body} from '../src/arcade/games/yarn/logic.js';
import {yarnGame} from '../src/arcade/games/yarn/index.js';
import {displayWidth} from '../src/util/text.js';

const STEP = 1000 / 60;
function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
const body = (id: number, tier: number, x: number, y: number): Body => ({id, tier, x, y, vx: 0, vy: 0, age: 5000});

/** Drops balls across the jar, `n` times, leaving time between them. */
function play(seed: number, n: number): YarnState {
  const state = new YarnState(createRng(seed));
  for (let i = 0; i < n && !state.over; i += 1) { state.aimTo(5 + ((i * 17) % 50)); state.drop(); state.step(700); }
  return state;
}

test('physics: a pile settles with no meaningful overlap and no movement', () => {
  const state = play(7, 22);
  state.step(6000);
  assert.ok(!state.over);
  assert.ok(state.bodies.length > 3);
  assert.ok(state.maxOverlap() < 1, `overlap ${state.maxOverlap()}`);
  assert.ok(state.maxSpeed() < 0.5, 'at rest');
  for (const b of state.bodies) {
    const r = RADII[b.tier]!;
    assert.ok(b.x >= r - 0.5 && b.x <= JAR_W - r + 0.5 && b.y <= JAR_H - r + 0.5, 'inside the jar');
  }
});

test('fusion: equal touching balls fuse into the next size and score; unequal ones do not', () => {
  const state = new YarnState(createRng(1));
  state.bodies = [body(1, 2, 20, JAR_H - RADII[2]!), body(2, 2, 20 + RADII[2]! * 2, JAR_H - RADII[2]!), body(3, 1, 45, JAR_H - RADII[1]!)];
  state.step(100);
  assert.deepEqual(state.bodies.map(b => b.tier).sort(), [1, 3]);
  assert.ok(state.score > 0);
  const apart = new YarnState(createRng(1));
  apart.bodies = [body(1, 2, 20, JAR_H - RADII[2]!), body(2, 3, 20 + RADII[2]! + RADII[3]!, JAR_H - RADII[3]!)];
  apart.step(100);
  assert.equal(apart.bodies.length, 2);
});

test('fusion: two of the largest burst for a bonus and leave no ball', () => {
  const state = new YarnState(createRng(1));
  const r = RADII[TIERS - 1]!;
  state.bodies = [body(1, TIERS - 1, r, JAR_H - r), body(2, TIERS - 1, r * 3, JAR_H - r)];
  state.step(100);
  assert.equal(state.bodies.length, 0);
  assert.ok(state.events.some(e => e.kind === 'burst'));
  assert.ok(state.score >= 100);
});

test('rules: the drop waits for its cooldown, aim stays inside the jar and the held ball advances', () => {
  const state = new YarnState(createRng(2));
  const next = state.next;
  for (let i = 0; i < 40; i += 1) state.move(-1);
  assert.ok(state.aimX >= RADII[state.current]!);
  assert.ok(state.drop());
  assert.equal(state.current, next);
  assert.equal(state.drop(), false, 'cooling down');
  state.step(600);
  assert.ok(state.drop());
});

test('rules: a pile that stays over the line ends the game; so does a full jar', () => {
  const state = new YarnState(createRng(3));
  state.bodies = [body(1, 8, 30, 70), body(2, 7, 30, 46), body(3, 8, 30, 20)];
  state.step(900);
  assert.ok(!state.over, 'not yet: the grace time');
  assert.ok(state.bodies.length === 3 && state.bodies.some(b => b.y - RADII[b.tier]! < 17));
  state.step(4000);
  assert.ok(state.over);
  const full = new YarnState(createRng(3));
  full.bodies = Array.from({length: MAX_BODIES}, (_, i) => body(i + 1, 0, 3 + (i % 20) * 2.6, 78 - Math.floor(i / 20) * 5));
  assert.equal(full.drop(), false);
  assert.ok(full.over);
});

test('body cap: long play never exceeds the cap', () => {
  const state = play(11, 300);
  assert.ok(state.bodies.length <= MAX_BODIES);
});

test('determinism: the same seed gives the same jar, whatever way time is split', () => {
  const run = (chunk: number) => {
    const state = new YarnState(createRng(9));
    for (let i = 0; i < 14; i += 1) {
      state.aimTo(8 + ((i * 13) % 44)); state.drop();
      for (let t = 0; t < 700; t += chunk) state.step(Math.min(chunk, 700 - t));
    }
    return JSON.stringify([state.score, state.bodies.map(b => [b.id, b.tier, Math.round(b.x * 1e6), Math.round(b.y * 1e6)])]);
  };
  assert.equal(run(700), run(STEP));
  assert.equal(run(STEP), run(7));
  assert.notEqual(run(7), (() => { const s = play(10, 14); return JSON.stringify(s.bodies.length); })());
});

type Driven = {key(k: unknown): unknown; step(d: number): void; animate(d: number): void; status: string; result: {score: number; record: boolean; details: string[]} | undefined; hints(): unknown[]; dispose(): void};

test('game: keys aim and drop, the run ends with a saved record and a celebration', () => {
  const record = memory();
  const game = yarnGame.create(context(record)) as unknown as Driven;
  assert.equal(game.status, 'ready');
  assert.equal(game.key({kind: 'up'}), 'ignored');
  assert.equal(game.key({kind: 'left'}), 'handled');
  assert.equal(game.status, 'playing');
  for (let i = 0; i < 4000 && game.status !== 'over'; i += 1) {
    if (i % 40 === 0) game.key({kind: 'text', value: ' '});
    game.step(STEP); game.animate(STEP);
  }
  assert.equal(game.status, 'over');
  assert.ok(game.result && game.result.score > 0);
  assert.equal(game.result.record, true, 'first score is a record');
  assert.equal(record.raw().best, game.result.score);
  assert.equal(record.raw().plays, 1);
  assert.equal(game.key({kind: 'left'}), 'ignored');
  game.dispose();
});

test('game: a lower score than the saved best is not a record', () => {
  const record = memory({best: 999999, plays: 3});
  const game = yarnGame.create(context(record)) as unknown as Driven;
  game.key({kind: 'text', value: ' '});
  for (let i = 0; i < 4000 && game.status !== 'over'; i += 1) { if (i % 40 === 0) game.key({kind: 'text', value: ' '}); game.step(STEP); }
  assert.equal(game.result?.record, false);
  assert.equal(record.raw().best, 999999);
  assert.equal(record.raw().plays, 4);
});

test('render: every size draws inside its bounds with and without color, safe glyphs and reduced motion', () => {
  const variants: Array<Partial<GameContext>> = [
    {color: 'truecolor'}, {color: 'none', safeGlyphs: true}, {color: 'truecolor', motion: {reduced: true, effects: 'off'}}, {color: 'none'},
  ];
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) {
    for (const variant of variants) {
      const game = yarnGame.create(context(memory(), {size: {columns, rows}, ...variant})) as unknown as Driven;
      game.key({kind: 'text', value: ' '});
      for (let i = 0; i < 900; i += 1) {
        if (i % 45 === 0) { game.key({kind: i % 90 === 0 ? 'left' : 'right'}); game.key({kind: 'text', value: ' '}); }
        game.step(STEP); game.animate(STEP);
        if (i % 150 === 0) {
          const canvas = new Canvas(columns, rows);
          (game as unknown as {render(c: Canvas, a: number, p: unknown): void}).render(canvas, 0.5, arcadePalette());
          for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns, `${columns}x${rows}`);
        }
      }
      const canvas = new Canvas(columns, rows);
      (game as unknown as {render(c: Canvas, a: number, p: unknown): void}).render(canvas, 0.5, arcadePalette());
      const lines = canvas.plain({color: 'none', safe: variant.safeGlyphs === true});
      for (const line of lines) assert.ok(displayWidth(line) <= columns);
      if (variant.color === 'none' && columns >= 60) assert.ok(lines.some(line => /[.:+ox%#@&]{2}/u.test(line.trim())), 'balls drawn with glyphs');
      game.resize({columns: 40, rows: 16});
      game.dispose();
    }
  }
});

test('definition: id, category and summary', () => {
  assert.equal(yarnGame.id, 'yarn');
  assert.equal(yarnGame.category, 'falling');
  assert.equal(yarnGame.summary({}), 'Not played yet');
  assert.match(yarnGame.summary({best: 1200, plays: 2, bestTier: 5}), /Best 1,200/u);
  const canvas = new Canvas(40, 10);
  yarnGame.preview(canvas, 7, arcadePalette());
});
