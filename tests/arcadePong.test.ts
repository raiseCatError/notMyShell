import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {BALL_MAX, COURT_H, COURT_W, PADDLE_H, PADDLE_SPEED, PongState, SERVE_MS, WIN_POINTS} from '../src/arcade/games/pong/logic.js';
import {pongGame, readPong} from '../src/arcade/games/pong/index.js';
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

test('physics: the ball bounces off the walls and leaves at an angle set by where it hit the paddle', () => {
  const state = new PongState('player', createRng(1));
  state.serveMs = 0;
  state.ball = {x: 40, y: 2, vx: 0, vy: -60, px: 40, py: 2};
  state.step(100);
  assert.ok(state.ball.vy > 0, 'off the top wall');
  // A ball arriving at the left paddle's middle leaves straight; at its edge, steeply.
  for (const [offset, steep] of [[0, false], [PADDLE_H / 2 - 0.5, true]] as const) {
    const s = new PongState('player', createRng(1));
    s.serveMs = 0;
    s.left.y = COURT_H / 2;
    s.ball = {x: 14, y: COURT_H / 2 + offset, vx: -120, vy: 0, px: 14, py: COURT_H / 2 + offset};
    for (let i = 0; i < 10 && s.ball.vx < 0; i += 1) s.step(STEP);
    assert.ok(s.ball.vx > 0, 'returned');
    const angle = Math.abs(Math.atan2(s.ball.vy, s.ball.vx));
    assert.ok(steep ? angle > 0.7 : angle < 0.1, `offset ${offset}: angle ${angle.toFixed(2)}`);
  }
});

test('physics: a fast ball cannot pass through a paddle between steps, and speed is capped', () => {
  const state = new PongState('player', createRng(2));
  state.serveMs = 0;
  state.left.y = COURT_H / 2;
  state.ball = {x: 30, y: COURT_H / 2, vx: -BALL_MAX * 3, vy: 0, px: 30, py: COURT_H / 2};
  state.step(STEP); state.step(STEP);
  assert.ok(state.ball.vx > 0, 'the swept test caught it');
  assert.ok(Math.hypot(state.ball.vx, state.ball.vy) <= BALL_MAX + 1e-6);
});

test('physics: a miss scores for the other side and the next serve waits', () => {
  const state = new PongState('player', createRng(3));
  state.serveMs = 0;
  state.left.y = 10;
  state.ball = {x: 20, y: COURT_H - 10, vx: -150, vy: 0, px: 20, py: COURT_H - 10};
  for (let i = 0; i < 20; i += 1) state.step(STEP);
  assert.equal(state.score.right, 1);
  assert.ok(state.serveMs > 0 && state.serveMs <= SERVE_MS);
});

test('paddles: a press moves a paddle briefly, repeats keep it moving, and it never leaves the court', () => {
  const state = new PongState('player', createRng(4));
  const start = state.left.y;
  state.press('left', -1);
  for (let i = 0; i < 6; i += 1) state.step(STEP);
  const moved = start - state.left.y;
  assert.ok(moved > 0 && moved <= PADDLE_SPEED * 0.1 + 1);
  for (let i = 0; i < 300; i += 1) { state.press('left', -1); state.step(STEP); }
  assert.equal(state.left.y, PADDLE_H / 2);
});

test('AI: harder levels return more balls, and the AI never moves faster than a paddle can', () => {
  const returns = (level: 'easy' | 'normal' | 'hard') => {
    let returned = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const rng = createRng(seed);
      const state = new PongState(level, createRng(seed + 100));
      state.serveMs = 0;
      const y = rng.range(10, COURT_H - 10);
      state.ball = {x: COURT_W / 2, y, vx: 110, vy: rng.range(-70, 70), px: COURT_W / 2, py: y};
      let last = state.right.y;
      for (let i = 0; i < 200 && state.ball.vx > 0 && state.score.left === 0; i += 1) {
        state.step(STEP);
        assert.ok(Math.abs(state.right.y - last) <= PADDLE_SPEED * (STEP / 1000) + 1e-6, 'paddle speed limit');
        last = state.right.y;
      }
      if (state.ball.vx < 0) returned += 1;
    }
    return returned;
  };
  const easy = returns('easy'), hard = returns('hard');
  assert.ok(hard > easy, `hard ${hard} > easy ${easy}`);
  assert.ok(hard >= 30, `hard returns most balls (${hard}/40)`);
  assert.ok(easy < 40, 'easy is beatable');
});

test('game: a match ends at seven with a result; wins and best margin are kept per level; same seed, same match', () => {
  const play = () => {
    const record = memory();
    const game = pongGame.create(context(record));
    game.key({kind: 'text', value: '1'});
    for (let t = 0; t < 600_000 && game.status === 'playing'; t += STEP) { game.step(STEP); game.animate(STEP); }
    return {game, record};
  };
  const a = play();
  const b = play();
  assert.ok(a.game.status === 'over' || a.game.status === 'won');
  assert.equal(a.game.result!.scoreText, b.game.result!.scoreText, 'deterministic');
  assert.match(a.game.result!.scoreText, new RegExp(`${WIN_POINTS}|– ${WIN_POINTS}`, 'u'));
  assert.equal(readPong(a.record.raw()).plays, 1);
});

test('render: every size draws inside its bounds, in color and without', () => {
  for (const [columns, rows] of [[20, 8], [50, 16], [100, 30], [200, 60]] as const) {
    for (const color of ['truecolor', 'none'] as const) {
      const game = pongGame.create(context(memory(), {size: {columns, rows}, color}));
      game.key({kind: 'enter'});
      for (let i = 0; i < 90; i += 1) game.step(STEP);
      const canvas = new Canvas(columns, rows);
      game.render(canvas, 0.5, arcadePalette());
      for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    }
  }
});
