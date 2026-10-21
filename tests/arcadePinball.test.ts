import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {BALL_MAX, BALL_R, BALLS, DRAIN_Y, LAUNCH_MAX, LAUNCH_MIN, LANE_X, PinballState, TABLE_W} from '../src/arcade/games/pinball/logic.js';
import {pinballGame} from '../src/arcade/games/pinball/index.js';
import {displayWidth} from '../src/util/text.js';

const STEP = 1000 / 60;
function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 5, rng: createRng(5), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
const launch = (state: PinballState, power: number) => { state.plunger(); state.charge = power; state.plunger(); };

test('plunger: two presses launch, power sets speed, and even the weakest launch clears the lane', () => {
  for (const power of [0, 0.5, 1]) {
    const s = new PinballState(createRng(1));
    assert.equal(s.phase, 'lane');
    s.plunger();
    assert.equal(s.phase, 'charging');
    s.charge = power; s.plunger();
    assert.equal(s.phase, 'play');
    assert.ok(Math.abs(s.ball.vy + (LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * power)) < 1e-9);
    let left = false;
    for (let i = 0; i < 90 && !left; i += 1) { s.step(STEP); left = s.ball.x < LANE_X - 6; }
    assert.ok(left, `power ${power} leaves the lane over the arch`);
  }
});

test('physics: the ball never leaves the table, never passes a wall, and never exceeds the speed cap, whatever its start', () => {
  const rng = createRng(11);
  for (let trial = 0; trial < 60; trial += 1) {
    const s = new PinballState(createRng(trial));
    s.phase = 'play';
    const angle = rng.range(0, Math.PI * 2);
    const speed = trial % 3 === 0 ? BALL_MAX : rng.range(20, BALL_MAX);
    s.ball = {x: rng.range(8, 48), y: rng.range(24, 80), vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, px: 0, py: 0};
    if (trial % 2) { s.flip('left'); s.flip('right'); }
    for (let i = 0; i < 60 * 8 && s.ballsLeft === BALLS; i += 1) {
      s.step(STEP);
      if (trial % 2 && i % 8 === 0) { s.flip('left'); s.flip('right'); }
      const {x, y, vx, vy} = s.ball;
      assert.ok(Math.hypot(vx, vy) <= BALL_MAX + 1e-6, 'speed cap');
      assert.ok(x > 0 && x < TABLE_W && y > 0, `inside the table (${x.toFixed(1)}, ${y.toFixed(1)}) trial ${trial}`);
    }
  }
});

test('physics: no tunnelling at max speed into a wall, a flipper or a bumper', () => {
  // Straight into the left wall.
  const wall = new PinballState(createRng(1));
  wall.phase = 'play';
  wall.ball = {x: 20, y: 50, vx: -BALL_MAX, vy: 0, px: 20, py: 50};
  for (let i = 0; i < 20; i += 1) { wall.step(STEP); assert.ok(wall.ball.x >= BALL_R - 0.01, 'wall'); }
  assert.ok(wall.ball.vx > 0 || wall.ball.x > 2);
  // Straight down onto a resting flipper from above, at max speed: it lands on it, not under it.
  const flipper = new PinballState(createRng(1));
  flipper.phase = 'play';
  flipper.ball = {x: 18, y: 70, vx: 0, vy: BALL_MAX, px: 18, py: 70};
  let minGap = Infinity;
  for (let i = 0; i < 40; i += 1) {
    flipper.step(STEP);
    const f = flipper.flippers[0];
    const t = Math.max(0, Math.min(1, (flipper.ball.x - f.pivot.x) / (f.tip.x - f.pivot.x)));
    minGap = Math.min(minGap, f.pivot.y + t * (f.tip.y - f.pivot.y) - flipper.ball.y);
  }
  assert.ok(minGap > 0, `ball stayed above the flipper (${minGap.toFixed(2)})`);
  // A bumper throws a fast ball back.
  const bumper = new PinballState(createRng(1));
  bumper.phase = 'play';
  bumper.ball = {x: 17, y: 20, vx: 0, vy: BALL_MAX, px: 17, py: 20};
  for (let i = 0; i < 20 && bumper.bumperHits === 0; i += 1) bumper.step(STEP);
  assert.ok(bumper.bumperHits >= 1 && bumper.ball.vy < 0, 'bounced off the bumper');
  assert.ok(bumper.score >= 100);
});

test('flippers: a press swings the flipper up and throws a ball sitting on it; a held flipper keeps the ball', () => {
  const s = new PinballState(createRng(1));
  s.phase = 'play';
  s.ball = {x: 17, y: 88.6, vx: 0, vy: 0, px: 17, py: 88.6};
  const rest = s.flippers[0].angle;
  let thrown = 0;
  for (let i = 0; i < 12; i += 1) { s.flip('left'); s.step(STEP); thrown = Math.min(thrown, s.ball.vy); }
  assert.ok(s.flippers[0].angle < rest - 0.5, 'the flipper rose');
  assert.ok(thrown < -30, `the flipper threw the ball (${thrown.toFixed(0)})`);
  // A ball held on a raised flipper does not drain.
  const held = new PinballState(createRng(1));
  held.phase = 'play';
  held.ball = {x: 15, y: 87, vx: 0, vy: 0, px: 15, py: 87};
  for (let i = 0; i < 120; i += 1) { held.flip('left'); held.step(STEP); }
  assert.equal(held.ballsLeft, BALLS);
  assert.ok(held.ball.y < 92 && Math.hypot(held.ball.vx, held.ball.vy) < 40, 'cradled');
});

test('scoring: bumpers score times the multiplier; three lanes raise it; drain costs a ball and the last ends the game', () => {
  const s = new PinballState(createRng(1));
  s.phase = 'play';
  for (const sensor of s.sensors) {
    s.ball = {x: sensor.x, y: sensor.y, vx: 0, vy: -1, px: 0, py: 0};
    s.step(STEP);
  }
  assert.equal(s.multiplier, 2);
  assert.ok(s.sensors.filter(x => x.lit).length <= 1, 'lanes reset after the bonus');
  const before = s.score;
  s.ball = {x: 17, y: 30, vx: 0, vy: 80, px: 0, py: 0};
  for (let i = 0; i < 30; i += 1) s.step(STEP);
  assert.ok(s.score - before >= 200, 'bumper hit counts double');
  const drains = new PinballState(createRng(1));
  for (let ball = BALLS; ball > 0; ball -= 1) {
    drains.phase = 'play';
    drains.ball = {x: 26, y: DRAIN_Y - 1, vx: 0, vy: 120, px: 0, py: 0};
    drains.step(STEP);
    assert.equal(drains.ballsLeft, ball - 1);
    if (ball > 1) { for (let i = 0; i < 80; i += 1) drains.step(STEP); assert.equal(drains.phase, 'lane'); assert.equal(drains.multiplier, 1, 'the multiplier is per ball'); }
  }
  assert.ok(drains.over);
});

test('nudge: kicks the ball, has a cooldown, and too many tilt the table so flippers go dead', () => {
  const s = new PinballState(createRng(2));
  s.phase = 'play';
  s.ball = {x: 26, y: 50, vx: 0, vy: 0, px: 0, py: 0};
  s.nudge();
  assert.ok(s.ball.vy < 0);
  const vy = s.ball.vy;
  s.nudge();
  assert.equal(s.ball.vy, vy, 'cooldown');
  for (let i = 0; i < 10; i += 1) { for (let k = 0; k < 40; k += 1) { s.ball = {x: 26, y: 40, vx: 0, vy: 0, px: 26, py: 40}; s.step(STEP); } s.nudge(); }
  assert.ok(s.tilted);
  s.flip('left');
  s.step(STEP);
  assert.equal(s.flippers[0].holdMs, 0);
});

test('determinism: same seed and inputs give the same game, at any frame split', () => {
  const run = (split: number) => {
    const s = new PinballState(createRng(21));
    launch(s, 0.7);
    for (let i = 0; i < 60 * 15 && !s.over; i += 1) {
      if (i % 25 === 0) s.flip('left');
      if (i % 37 === 0) s.flip('right');
      for (let k = 0; k < split; k += 1) s.step(STEP / split);
    }
    return s;
  };
  const a = run(1), b = run(1), c = run(2);
  assert.equal(a.score, b.score);
  assert.equal(a.ball.x, b.ball.x);
  assert.ok(Math.abs(a.ball.x - c.ball.x) < 0.5 && Math.abs(a.ball.y - c.ball.y) < 0.5 || a.ballsLeft !== BALLS || c.ballsLeft !== BALLS, 'splits agree');
});

test('game: keys, a full game saves its record once, dispose cleans up', () => {
  const record = memory();
  const game = pinballGame.create(context(record));
  assert.equal(game.status, 'ready');
  assert.equal(game.key({kind: 'text', value: 'q'}), 'ignored');
  assert.equal(game.key({kind: 'left'}), 'handled');
  assert.equal(game.status, 'playing');
  for (const key of [{kind: 'right'}, {kind: 'up'}, {kind: 'down'}, {kind: 'text', value: 'z'}, {kind: 'text', value: '/'}, {kind: 'enter'}] as const) assert.equal(game.key(key), 'handled');
  const play = (g: typeof game) => {
    g.key({kind: 'left'});
    for (let i = 0; i < 60 * 60 * 5 && g.status === 'playing'; i += 1) {
      if (i % 90 === 0) { g.key({kind: 'text', value: ' '}); g.key({kind: 'text', value: ' '}); }
      if (i % 150 === 7) g.key({kind: 'left'});
      if (i % 150 === 70) g.key({kind: 'right'});
      g.step(STEP); g.animate(STEP);
    }
  };
  const fresh = pinballGame.create(context(record));
  play(fresh);
  assert.equal(fresh.status, 'over');
  assert.ok(fresh.result && fresh.result.score > 0 && fresh.result.record);
  assert.equal(record.raw().plays, 1);
  assert.equal(record.raw().best, fresh.result.score);
  const again = pinballGame.create(context(record));
  play(again);
  assert.equal(again.result?.record, false, 'the same game is not a new record');
  assert.equal(record.raw().plays, 2);
  game.dispose(); fresh.dispose(); again.dispose();
});

test('render: every size draws inside its bounds in color, without color, with safe glyphs and with reduced motion', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) {
    for (const mode of ['truecolor', 'none', 'reduced'] as const) {
      const game = pinballGame.create(context(memory(), {
        size: {columns, rows},
        color: mode === 'none' ? 'none' : 'truecolor', safeGlyphs: mode === 'none',
        motion: mode === 'reduced' ? {reduced: true, effects: 'off'} : {reduced: false, effects: 'normal'},
      }));
      for (const phase of ['ready', 'charging', 'over'] as const) {
        if (phase === 'charging') { game.key({kind: 'text', value: ' '}); for (let i = 0; i < 20; i += 1) { game.step(STEP); game.animate(STEP); } }
        if (phase === 'over') for (let i = 0; i < 60 * 600 && game.status === 'playing'; i += 1) { if (i % 80 === 0) { game.key({kind: 'text', value: ' '}); game.key({kind: 'text', value: ' '}); } game.step(STEP); game.animate(STEP); }
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0.5, arcadePalette());
        const lines = canvas.plain();
        assert.equal(lines.length, rows);
        for (const line of lines) assert.ok(displayWidth(line) <= columns, `${mode} ${columns}x${rows} ${phase}: ${line}`);
        const text = lines.join('\n');
        if (phase === 'over') assert.match(text, /GAME OVER/);
        if (mode === 'none' && phase === 'charging') assert.match(text, /Power/);
      }
      game.dispose();
    }
  }
  pinballGame.preview(new Canvas(30, 6), 5, arcadePalette());
});
