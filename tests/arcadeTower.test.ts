import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {FIELD, GROW, PERFECT, START_W, TowerState} from '../src/arcade/games/tower/logic.js';
import {towerGame} from '../src/arcade/games/tower/index.js';
import {displayWidth} from '../src/util/text.js';

const STEP = 1000 / 60;
function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 30}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});

test('rules: a misaligned drop keeps only the overlap and the overhang breaks off on its own side', () => {
  const tower = new TowerState();
  const below = tower.top;
  tower.moving = {x: below.x + 5, w: below.w};
  tower.drop();
  assert.equal(tower.floors, 1);
  assert.equal(tower.top.x, below.x + 5);
  assert.equal(tower.top.w, below.w - 5);
  assert.equal(tower.chips.length, 1);
  assert.equal(tower.chips[0]!.x, below.x + below.w, 'the piece past the right edge falls');
  assert.equal(tower.chips[0]!.w, 5);
});

test('rules: a perfect drop trims nothing; three in a row grow the slab, never past the start width', () => {
  const tower = new TowerState();
  tower.moving = {x: tower.top.x + 6, w: tower.top.w};
  tower.drop();
  const narrow = tower.top.w;
  for (let index = 0; index < 3; index += 1) { tower.moving = {x: tower.top.x + PERFECT * 0.5, w: tower.top.w}; tower.drop(); }
  assert.equal(tower.streak, 3);
  assert.equal(tower.top.w, Math.min(START_W, narrow + GROW));
  for (let index = 0; index < 20; index += 1) { tower.moving = {x: tower.top.x, w: tower.top.w}; tower.drop(); }
  assert.ok(tower.top.w <= START_W);
  assert.ok(tower.top.x >= 0 && tower.top.x + tower.top.w <= FIELD);
});

test('rules: missing the tower ends the run; the slide speeds up and bounces inside its range', () => {
  const tower = new TowerState();
  tower.moving = {x: tower.top.x + tower.top.w + 1, w: tower.top.w};
  tower.drop();
  assert.equal(tower.alive, false);
  const slide = new TowerState();
  const speeds = [slide.speed];
  for (let floor = 0; floor < 10; floor += 1) { slide.moving = {x: slide.top.x, w: slide.top.w}; slide.drop(); speeds.push(slide.speed); }
  assert.ok(speeds.at(-1)! > speeds[0]!);
  for (let t = 0; t < 20_000; t += STEP) {
    slide.step(STEP);
    assert.ok(slide.moving.x >= -slide.moving.w * 0.6 - 1e-9 && slide.moving.x <= FIELD - slide.moving.w * 0.4 + 1e-9);
  }
});

test('game: dropping at a fixed rhythm is deterministic and ends with a floor count and saved best', () => {
  const play = () => {
    const record = memory();
    const game = towerGame.create(context(record));
    game.key({kind: 'text', value: ' '});
    for (let t = 0; t < 200_000 && game.status !== 'over'; t += STEP) {
      if (Math.floor(t / 700) !== Math.floor((t + STEP) / 700)) game.key({kind: 'text', value: ' '});
      game.step(STEP); game.animate(STEP);
    }
    return {game, record};
  };
  const a = play(), b = play();
  assert.equal(a.game.status, 'over');
  assert.equal(a.game.result!.score, b.game.result!.score);
  assert.equal(a.record.raw().plays, 1);
});

test('render: every size draws inside its bounds, in color and without', () => {
  for (const [columns, rows] of [[20, 8], [50, 16], [100, 30], [200, 60]] as const) {
    for (const color of ['truecolor', 'none'] as const) {
      const game = towerGame.create(context(memory(), {size: {columns, rows}, color}));
      game.key({kind: 'text', value: ' '});
      for (let i = 0; i < 10; i += 1) { game.step(STEP * 6); game.key({kind: 'text', value: ' '}); game.animate(STEP * 6); }
      const canvas = new Canvas(columns, rows);
      game.render(canvas, 0, arcadePalette());
      for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    }
  }
});
