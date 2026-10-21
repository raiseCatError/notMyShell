import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas, PixelBuffer} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {FALL_MIN, JUMP, JUMP_HEIGHT, LeapState, PLATFORM_W, REACH, SPRING, WIDTH} from '../src/arcade/games/leap/logic.js';
import {leapGame} from '../src/arcade/games/leap/index.js';
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

test('reachability: across 300 seeds and 4000 units of climb, the next solid platform is always within a normal jump', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const state = new LeapState(createRng(seed));
    // Grow the course without playing: pretend the cat climbed.
    (state as never as {best: number}).best = 4000;
    for (let i = 0; i < 400; i += 1) (state as never as {generate(): void}).generate();
    const solid = state.platforms.filter(platform => platform.kind !== 'crumble').map(platform => platform.y).sort((a, b) => a - b);
    for (let index = 1; index < solid.length; index += 1) {
      assert.ok(solid[index]! - solid[index - 1]! <= JUMP_HEIGHT * REACH + 1e-9, `seed ${seed}: gap ${(solid[index]! - solid[index - 1]!).toFixed(1)}`);
    }
  }
});

test('bouncing: landing from above bounces at the jump speed, a spring higher, a crumbling platform breaks and gives none', () => {
  const state = new LeapState(createRng(1));
  state.started = true;
  for (const [kind, spring, expected] of [['solid', false, JUMP], ['solid', true, SPRING], ['crumble', false, undefined]] as const) {
    state.platforms = [{id: 1, x: 30, y: 50, kind, spring, broken: false, phase: 0, speed: 1, fall: 0}];
    state.x = 35; state.y = 52; state.vy = -40;
    for (let i = 0; i < 6; i += 1) state.step(STEP);
    if (expected === undefined) { assert.equal(state.platforms[0]?.broken ?? true, true); assert.ok(state.vy < 0, 'still falling'); }
    else assert.ok(state.vy > expected * 0.9, `${kind}${spring ? ' spring' : ''}`);
  }
});

test('steering: a press moves sideways and the field wraps; falling below the view ends the climb', () => {
  const state = new LeapState(createRng(2));
  state.press(-1);
  state.x = 1;
  for (let i = 0; i < 6; i += 1) state.step(STEP);
  assert.ok(state.x > WIDTH - 10, 'wrapped to the right edge');
  state.platforms = [];
  for (let t = 0; t < 10_000 && state.alive; t += STEP) state.step(STEP);
  assert.equal(state.alive, false);
  assert.ok(PLATFORM_W < WIDTH);
});

test('game: a bot that steers toward the nearest platform above climbs, deterministically, and the height is saved', () => {
  const play = () => {
    const record = memory();
    const game = leapGame.create(context(record)) as never as {key(k: unknown): unknown; step(d: number): void; animate(d: number): void; status: string; result: {score: number} | undefined; state: LeapState};
    game.key({kind: 'text', value: ' '});
    for (let t = 0; t < 180_000 && game.status !== 'over'; t += STEP) {
      const s = game.state;
      const next = s.platforms.filter(p => p.kind !== 'crumble' && p.y > s.y - 2).sort((a, b) => a.y - b.y)[0];
      if (next && s.vy < 0) { const target = s.platformX(next) + PLATFORM_W / 2; if (Math.abs(target - s.x) > 3) game.key({kind: target < s.x ? 'left' : 'right'}); }
      game.step(STEP); game.animate(STEP);
    }
    return {game, record};
  };
  const a = play(), b = play();
  assert.equal(a.game.result?.score, b.game.result?.score);
  if (a.game.status === 'over') assert.equal(a.record.raw().plays, 1);
});

test('render: every size draws inside its bounds, in color and without', () => {
  for (const [columns, rows] of [[20, 8], [50, 16], [100, 30], [200, 60]] as const) {
    for (const color of ['truecolor', 'none'] as const) {
      const game = leapGame.create(context(memory(), {size: {columns, rows}, color}));
      game.key({kind: 'text', value: ' '});
      for (let i = 0; i < 40; i += 1) game.step(STEP);
      const canvas = new Canvas(columns, rows);
      game.render(canvas, 0, arcadePalette());
      for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    }
  }
});

/** Record every sprite draw call of a render, to count visible cats without reading pixels. */
function catDraws(game: {render(c: Canvas, a: number, p: ReturnType<typeof arcadePalette>): void}, columns: number, rows: number): Array<{x: number; width: number}> {
  const calls: Array<{x: number; width: number}> = [];
  const original = PixelBuffer.prototype.sprite;
  PixelBuffer.prototype.sprite = function (sprite, x, y, flip) { calls.push({x, width: sprite.width}); return original.call(this, sprite, x, y, flip); };
  try { game.render(new Canvas(columns, rows), 0, arcadePalette()); } finally { PixelBuffer.prototype.sprite = original; }
  return calls;
}

type LeapGame = {key(k: unknown): unknown; step(d: number): void; render(c: Canvas, a: number, p: ReturnType<typeof arcadePalette>): void; state: LeapState};

test('wrap: one cat at every frame of a full wrap, left and right, at several viewport widths; x stays continuous', () => {
  for (const columns of [28, 40, 60, 100, 160]) {
    for (const dir of ['left', 'right'] as const) {
      const rows = 34;
      const game = leapGame.create(context(memory(), {size: {columns, rows}})) as never as LeapGame;
      game.key({kind: 'text', value: ' '});
      const state = game.state;
      state.platforms = [];
      state.fallLimit = 1e9;
      state.y = 40;
      state.x = dir === 'left' ? 12 : WIDTH - 12;
      let previous = state.x;
      let wrapped = false;
      for (let frame = 0; frame < 900 && !wrapped; frame += 1) {
        game.key({kind: dir});
        state.vy = 0;
        game.step(STEP);
        const period = WIDTH + 2 * state.catHalf;
        const jump = state.x - previous;
        if (Math.abs(jump) > period / 2) { wrapped = true; assert.ok(Math.abs(Math.abs(jump) - period) < 3, `${columns} ${dir}: continuous modulo the ring, jump ${jump}`); }
        previous = state.x;
        const calls = catDraws(game, columns, rows);
        assert.ok(calls.length <= 1, `${columns} ${dir} frame ${frame}: ${calls.length} cat draws`);
      }
      assert.ok(wrapped, `${columns} ${dir}: wrapped`);
    }
  }
});

test('wrap: the cat is wholly beyond the edge before it re-enters from the other, and bounces on a platform there', () => {
  const state = new LeapState(createRng(3));
  state.started = true;
  state.catHalf = 8;
  assert.equal(state.wrap(WIDTH + 7.9), WIDTH + 7.9, 'still partly in view: not wrapped yet');
  assert.ok(state.wrap(WIDTH + 8.5) + state.catHalf <= 0.7, 're-enters from beyond the opposite edge');
  state.platforms = [{id: 1, x: 0, y: 50, kind: 'solid', spring: false, broken: false, phase: 0, speed: 1, fall: 0}];
  state.x = 2; state.y = 52; state.vy = -40;
  for (let i = 0; i < 6; i += 1) state.step(STEP);
  assert.ok(state.vy > JUMP * 0.9, 'bounced on the platform at the left edge');
});

test('fall limit: on a short view the cat may still fall to the highest platform under its apex (as deep as a full gap allows)', () => {
  const plat = (id: number, x: number, y: number) => ({id, x, y, kind: 'solid' as const, spring: false, broken: false, phase: 0, speed: 1, fall: 0});
  for (const rows of [12, 16, 24, 34, 50]) {
    const game = leapGame.create(context(memory(), {size: {columns: Math.round(rows * 2.9), rows}})) as never as LeapGame;
    game.key({kind: 'text', value: ' '});
    const state = game.state;
    // Worst case the generator allows: the apex (4 + a jump) lies just under the next platform, so the one it can land on is
    // as far below the apex as a full gap leaves it.
    const apex = state.y + JUMP_HEIGHT;
    const target = plat(2, 33, apex - JUMP_HEIGHT * REACH + 0.5);
    state.platforms = [plat(1, 33, 0), target, plat(3, 0, target.y + JUMP_HEIGHT * REACH)];
    state.x = target.x + 7;
    let landed = false;
    for (let frame = 0; frame < 60 * 6 && state.alive && !landed; frame += 1) { game.step(STEP); landed = state.bounces > 0; }
    assert.ok(state.alive && landed, `${rows} rows: the climb ended before the cat reached a platform ${(apex - target.y).toFixed(1)} under its apex (fall limit ${state.fallLimit.toFixed(1)})`);
  }
  assert.ok(FALL_MIN >= JUMP_HEIGHT * REACH);
});

test('fall limit: a cat carried below the view is marked by an arrow at the bottom edge, in every mode', () => {
  for (const mode of ['color', 'text'] as const) {
    const game = leapGame.create(context(memory(), {size: {columns: 60, rows: 12}, ...(mode === 'text' ? {color: 'none' as const, safeGlyphs: true} : {})})) as never as LeapGame;
    game.key({kind: 'text', value: ' '});
    const state = game.state;
    state.platforms = [];
    game.step(STEP);
    state.best = state.y = 60; state.vy = 0; state.x = 30;
    game.step(STEP);
    state.y = 60 - 30; // 30 under the best height on a 24 pixel view: wholly below the bottom edge
    const canvas = new Canvas(60, 12);
    game.render(canvas, 0, arcadePalette());
    const lines = canvas.plain({color: 'none', safe: true});
    assert.ok(lines[10]!.includes('v'), `${mode}: "${lines[10]}"`);
    state.y = 60; // back at the apex: no arrow
    const clear = new Canvas(60, 12);
    game.render(clear, 0, arcadePalette());
    assert.ok(!clear.plain({color: 'none', safe: true})[10]!.includes('v'));
  }
});
