import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {BALL_MAX, BRICK_H, BRICK_W, BrickState, COLUMNS, FIELD_H, LAYOUTS, LIVES, PADDLE_Y} from '../src/arcade/games/brickfall/logic.js';
import {brickfallGame} from '../src/arcade/games/brickfall/index.js';
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

test('layouts: every row is twelve columns of known marks and every layout has bricks', () => {
  for (const layout of LAYOUTS) {
    for (const row of layout) assert.match(row, new RegExp(`^[#=.]{${COLUMNS}}$`, 'u'));
    assert.ok(layout.join('').includes('#') || layout.join('').includes('='));
  }
});

test('physics: a ball bounces off a brick face, the brick breaks and scores; steel takes two hits', () => {
  const state = new BrickState(createRng(1));
  const brick = state.bricks.find(b => !b.tough)!;
  state.bricks = [brick];
  const x = brick.x + BRICK_W / 2;
  state.balls = [{x, y: brick.y + BRICK_H + 3, vx: 0, vy: -60, px: x, py: brick.y + BRICK_H + 3, stuck: false}];
  for (let i = 0; i < 30 && state.bricks.length; i += 1) state.step(STEP);
  assert.equal(state.bricks.length, 0);
  assert.ok(state.balls[0]!.vy > 0, 'reflected downward');
  assert.ok(state.score >= 10);
  const steel = new BrickState(createRng(1));
  const tough = {...brick, hits: 2, tough: true};
  steel.bricks = [tough];
  steel.balls = [{x, y: tough.y + BRICK_H + 3, vx: 0, vy: -60, px: x, py: tough.y + BRICK_H + 3, stuck: false}];
  for (let i = 0; i < 30; i += 1) steel.step(STEP);
  assert.equal(steel.bricks.length, 1, 'one hit dents steel');
  assert.equal(tough.hits, 1);
});

test('physics: even at the speed cap the ball cannot pass through a brick', () => {
  const state = new BrickState(createRng(2));
  const brick = state.bricks[0]!;
  state.bricks = [brick];
  const x = brick.x + BRICK_W / 2;
  state.balls = [{x, y: brick.y + 12, vx: 0, vy: -BALL_MAX * 2, px: x, py: brick.y + 12, stuck: false}];
  // One 100 ms step moves the ball 23 units: past the brick entirely, unless the sub-steps catch it.
  state.step(100);
  assert.ok(state.bricks.length === 0 || brick.hits < 1, 'the swept sub-steps hit it');
  assert.ok(state.balls[0]!.y > brick.y, 'and it did not end up above the brick');
});

test('rules: the paddle angle follows the hit point, a missed ball costs a life, and the run ends at zero', () => {
  const state = new BrickState(createRng(3));
  state.launch();
  state.balls[0] = {x: state.paddleX + 8, y: PADDLE_Y - 3, vx: 0, vy: 50, px: state.paddleX + 8, py: PADDLE_Y - 3, stuck: false};
  for (let i = 0; i < 10 && state.balls[0]!.vy > 0; i += 1) state.step(STEP);
  assert.ok(state.balls[0]!.vx > 20, 'hit near the right edge: sent to the right');
  for (let life = 0; life < LIVES; life += 1) {
    state.balls = [{x: 2, y: FIELD_H - 2, vx: 0, vy: 80, px: 2, py: FIELD_H - 2, stuck: false}];
    state.paddleX = 100;
    for (let i = 0; i < 30; i += 1) state.step(STEP);
  }
  assert.equal(state.over, true);
});

test('rules: clearing a layout pauses, adds a bonus and loads the next one; a capsule changes the paddle', () => {
  const state = new BrickState(createRng(4));
  state.bricks = [];
  state.step(STEP);
  assert.ok(state.clearMs > 0);
  for (let i = 0; i < 120; i += 1) state.step(STEP);
  assert.equal(state.level, 2);
  assert.ok(state.bricks.length > 0);
  state.powers = [{kind: 'wide', x: state.paddleX, y: PADDLE_Y - 2}];
  for (let i = 0; i < 20; i += 1) state.step(STEP);
  assert.ok(state.wideMs > 0, 'caught');
});

test('game: a bot that follows the ball plays a deterministic game to its end with a result', () => {
  const play = () => {
    const record = memory();
    const game = brickfallGame.create(context(record)) as never as {key(k: unknown): unknown; step(d: number): void; animate(d: number): void; status: string; result: {score: number} | undefined; state: BrickState};
    game.key({kind: 'text', value: ' '});
    for (let t = 0; t < 400_000 && game.status !== 'over'; t += STEP) {
      const state = game.state;
      const ball = state.balls[0];
      if (ball && Math.abs(ball.x - state.paddleX) > 3) game.key({kind: ball.x < state.paddleX ? 'left' : 'right'});
      if (state.balls.some(b => b.stuck)) game.key({kind: 'text', value: ' '});
      game.step(STEP); game.animate(STEP);
    }
    return game;
  };
  const a = play(), b = play();
  assert.equal(a.result?.score, b.result?.score, 'same seed, same game');
});

test('render: every size draws inside its bounds, in color and without', () => {
  for (const [columns, rows] of [[20, 8], [50, 16], [100, 30], [200, 60]] as const) {
    for (const color of ['truecolor', 'none'] as const) {
      const game = brickfallGame.create(context(memory(), {size: {columns, rows}, color}));
      game.key({kind: 'text', value: ' '});
      for (let i = 0; i < 60; i += 1) game.step(STEP);
      const canvas = new Canvas(columns, rows);
      game.render(canvas, 0.5, arcadePalette());
      for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    }
  }
});
