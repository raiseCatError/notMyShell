import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {
  BALL_MAX, BALL_R, BALL_SAVE_MS, BALLS, BUMPERS, DRAIN_Y, FLIP_COOLDOWN_MS, FLIP_HOLD_MS, GATE, LANE_REST_Y, LANE_WALL_X, LANE_X, LAUNCH_MAX, LAUNCH_MIN,
  PinballState, RAMP_MOUTH, RAMP_PATH, SEGMENTS, SPINNER, STALL_MS, STANDUPS, TABLE_W,
} from '../src/arcade/games/pinball/logic.js';
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


/** True when the point is inside the shooter lane: right of its wall and on the lane side of the gate. */
const inLane = (x: number, y: number) => x > LANE_WALL_X + 0.3 && y < 99 && (x - GATE.a.x) * GATE.oneWay!.x + (y - GATE.a.y) * GATE.oneWay!.y <= 0;
const rest = (x: number, y: number, vx = 0, vy = 0, seed = 1) => {
  const s = new PinballState(createRng(seed));
  s.phase = 'play'; s.saveMs = 0;
  s.ball = {x, y, vx, vy, px: x, py: y};
  return s;
};

test('shooter lane: a ball coming down the right arch used to roll into the lane and sit there with no plunger', () => {
  // The reported trap: the lane wall stopped short of the arch, so a ball falling along the right side dropped into the lane.
  for (const [x, vx] of [[50, 60], [52, 20], [54, -10], [47, 90]] as const) {
    const s = rest(x, 18, vx, 0);
    let entered = false;
    for (let i = 0; i < 60 * 30 && s.phase === 'play' && !s.over; i += 1) { s.step(STEP); if (inLane(s.ball.x, s.ball.y)) entered = true; }
    assert.equal(entered, false, `start x=${x}: the ball never entered the lane`);
    assert.ok(s.phase !== 'play' || s.ball.y < 100, 'and it was not parked on the lane floor');
  }
});

test('shooter lane: after leaving it the ball can never re-enter, at any launch power, and every launch clears the gate', () => {
  for (let seed = 1; seed <= 6; seed += 1) {
    for (const power of [0, 0.1, 0.35, 0.6, 0.85, 1]) {
      const s = new PinballState(createRng(seed));
      launch(s, power);
      let out = false;
      for (let i = 0; i < 60 * 40 && !s.over; i += 1) {
        s.step(STEP);
        if (s.phase !== 'play') break;
        if (!out && s.ball.y < GATE.b.y && !inLane(s.ball.x, s.ball.y)) out = true;
        if (out) assert.ok(!inLane(s.ball.x, s.ball.y), `seed ${seed} power ${power}: re-entered the lane at (${s.ball.x.toFixed(1)}, ${s.ball.y.toFixed(1)}) t=${i}`);
      }
      assert.ok(out, `seed ${seed} power ${power}: the ball left the lane`);
      assert.equal(s.recoveries, 0, 'no watchdog help was needed');
    }
  }
});

test('shooter lane: a ball that does get into the lane (it should not) is returned to the plunger at no cost', () => {
  const s = rest(LANE_X, 60, 0, 0);
  const balls = s.ballsLeft;
  for (let i = 0; i < 60 * 6 && s.phase === 'play'; i += 1) s.step(STEP);
  assert.equal(s.phase, 'lane', 'back at the plunger');
  assert.equal(s.ballsLeft, balls);
  assert.ok(s.recoveries >= 1);
  assert.ok(Math.abs(s.ball.x - LANE_X) < 1e-9 && Math.abs(s.ball.y - LANE_REST_Y) < 1e-9);
  launch(s, 0.5);
  assert.equal(s.phase, 'play');
});

test('plunger: two presses launch, power sets speed, the meter swings', () => {
  for (const power of [0, 0.5, 1]) {
    const s = new PinballState(createRng(1));
    assert.equal(s.phase, 'lane');
    s.plunger();
    assert.equal(s.phase, 'charging');
    s.charge = power; s.plunger();
    assert.equal(s.phase, 'play');
    assert.ok(Math.abs(s.ball.vy + (LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * power)) < 1e-9);
  }
  const meter = new PinballState(createRng(1));
  meter.plunger();
  const seen: number[] = [];
  for (let i = 0; i < 70; i += 1) { meter.step(STEP); seen.push(meter.charge); }
  assert.ok(Math.min(...seen) < 0.1 && Math.max(...seen) > 0.9, 'the meter swings the full range');
  const ignored = new PinballState(createRng(1));
  launch(ignored, 0.5);
  const vy = ignored.ball.vy;
  ignored.plunger();
  assert.equal(ignored.ball.vy, vy, 'the plunger does nothing during play');
});

test('dead zones: dropped anywhere on the table with no flipper input, the ball always reaches the drain without help', () => {
  const stuck: string[] = [];
  for (let gx = 0; gx < 24; gx += 1) {
    for (let gy = 0; gy < 17; gy += 1) {
      const x = 4.123 + gx * 1.931 + (gy % 3) * 0.37, y = 7.31 + gy * 4.777 + (gx % 4) * 0.21;
      if (x > LANE_WALL_X - BALL_R || y > 88) continue;
      if (SEGMENTS.some(seg => Math.abs((x - seg.a.x) * (seg.b.y - seg.a.y) - (y - seg.a.y) * (seg.b.x - seg.a.x)) / Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) < BALL_R + 0.2 && seg !== GATE && x > Math.min(seg.a.x, seg.b.x) - 2 && x < Math.max(seg.a.x, seg.b.x) + 2 && y > Math.min(seg.a.y, seg.b.y) - 2 && y < Math.max(seg.a.y, seg.b.y) + 2)) continue;
      if (BUMPERS.some(b => Math.hypot(b.x - x, b.y - y) < b.r + BALL_R + 0.3)) continue;
      const s = rest(x, y, 0, 0, gx * 31 + gy);
      let t = 0;
      while (s.phase === 'play' && t < 60 * 60) { s.step(STEP); t += 1; }
      if (s.phase === 'play' || s.recoveries > 0) stuck.push(`(${x.toFixed(1)}, ${y.toFixed(1)}) ${s.phase} recoveries ${s.recoveries} at (${s.ball.x.toFixed(1)}, ${s.ball.y.toFixed(1)})`);
    }
  }
  assert.deepEqual(stuck, []);
});

test('dead zones: a ball that stalls anywhere is kicked, and relaunched at no cost if kicking does not free it', () => {
  const s = rest(30, 45);
  const kicks: string[] = [];
  for (let i = 0; i < 60 * 12 && s.phase === 'play'; i += 1) {
    // Pin the ball in place, as a geometry trap would.
    s.ball.x = 30; s.ball.y = 45; s.ball.vx = 0; s.ball.vy = 0;
    s.step(STEP);
    for (const e of s.events.splice(0)) if (e.kind === 'recover') kicks.push(e.how);
  }
  assert.deepEqual(kicks.slice(0, 3), ['kick', 'kick', 'relaunch']);
  assert.equal(s.phase, 'lane');
  assert.equal(s.ballsLeft, BALLS, 'recovery costs no ball');
  assert.ok(STALL_MS <= 3500);
});

test('drain: each lost ball counts down, the next waits in the lane, the last ends the game; a ball save returns the ball free', () => {
  const s = new PinballState(createRng(1));
  for (let ball = BALLS; ball > 0; ball -= 1) {
    s.phase = 'play'; s.saveMs = 0;
    s.ball = {x: 26, y: DRAIN_Y - 1, vx: 0, vy: 120, px: 0, py: 0};
    s.step(STEP);
    assert.equal(s.ballsLeft, ball - 1);
    if (ball > 1) { assert.equal(s.phase, 'drained'); for (let i = 0; i < 80; i += 1) s.step(STEP); assert.equal(s.phase, 'lane'); assert.equal(s.multiplier, 1, 'the multiplier is per ball'); }
  }
  assert.ok(s.over);
  const saver = new PinballState(createRng(1));
  launch(saver, 0.6);
  assert.ok(saver.saveMs > BALL_SAVE_MS - 50);
  saver.multiplier = 3;
  saver.ball = {x: 26, y: DRAIN_Y - 1, vx: 0, vy: 120, px: 0, py: 0};
  saver.step(STEP);
  assert.equal(saver.ballsLeft, BALLS, 'saved');
  for (let i = 0; i < 80; i += 1) saver.step(STEP);
  assert.equal(saver.phase, 'lane');
  assert.equal(saver.multiplier, 3, 'a saved ball keeps its multiplier');
  launch(saver, 0.6);
  assert.equal(saver.saveMs, 0, 'only one save per ball');
  saver.ball = {x: 26, y: DRAIN_Y - 1, vx: 0, vy: 120, px: 0, py: 0};
  saver.step(STEP);
  assert.equal(saver.ballsLeft, BALLS - 1);
  const late = new PinballState(createRng(1));
  launch(late, 0.6);
  for (let i = 0; i < 60 * 13; i += 1) { late.ball = {x: 12 + (i % 25), y: 40, vx: 0, vy: 0, px: 0, py: 0}; late.step(STEP); }
  assert.equal(late.saveMs, 0, 'the save window closes');
});

test('flippers: a press is a bounded stroke (up, held about 200 ms, down), key repeat cannot hold it, and quick taps re-trigger', () => {
  const s = new PinballState(createRng(1));
  s.phase = 'play'; s.ball = {x: 26, y: 20, vx: 0, vy: -200, px: 26, py: 20};
  const restAngle = s.flippers[0].angle;
  assert.equal(s.flip('left'), true);
  let up = 0, topAt = -1, backAt = -1;
  for (let i = 0; i < 60; i += 1) {
    s.ball = {x: 26, y: 20, vx: 0, vy: 0, px: 26, py: 20};
    if (backAt < 0) s.flip('left'); // a held key: repeats are ignored mid-stroke
    s.step(STEP);
    const lifted = s.flippers[0].angle < restAngle - 0.8;
    if (lifted && backAt < 0) { up += 1; if (topAt < 0) topAt = i; }
    if (topAt >= 0 && backAt < 0 && s.flippers[0].angle >= restAngle - 0.05) backAt = i;
  }
  const upMs = up * STEP;
  assert.ok(upMs >= 120 && upMs <= 300, `the flipper stays up a bounded time (${upMs.toFixed(0)} ms)`);
  assert.ok(backAt > topAt, 'it came back down despite repeats');
  assert.equal(FLIP_HOLD_MS >= 150 && FLIP_HOLD_MS <= 250, true);
  // The other flipper is independent, and a new stroke is allowed after the cooldown.
  const t = new PinballState(createRng(1));
  t.phase = 'play'; t.ball = {x: 26, y: 20, vx: 0, vy: 0, px: 26, py: 20};
  assert.ok(t.flip('left')); assert.ok(t.flip('right'));
  assert.equal(t.flip('left'), false, 'mid-stroke');
  for (let i = 0; i < Math.ceil((FLIP_HOLD_MS + FLIP_COOLDOWN_MS + 20) / STEP); i += 1) { t.ball.y = 20; t.ball.vy = 0; t.step(STEP); }
  assert.ok(t.flip('left'), 're-triggers after the stroke');
});

test('flippers: a swinging flipper throws a ball resting on it fast and upward; a dead (tilted) flipper does not', () => {
  for (const side of ['left', 'right'] as const) {
    const s = rest(side === 'left' ? 17 : 37, 88.6);
    let thrown = 0;
    s.flip(side);
    for (let i = 0; i < 20; i += 1) { s.step(STEP); thrown = Math.min(thrown, s.ball.vy); }
    assert.ok(thrown < -100, `${side} flipper threw the ball (${thrown.toFixed(0)} units/s up)`);
    assert.ok(Math.hypot(s.ball.vx, s.ball.vy) <= BALL_MAX + 1e-6);
  }
  const dead = rest(17, 88.6);
  dead.tilted = true;
  assert.equal(dead.flip('left'), false);
});

test('physics: the ball never leaves the table, never passes a wall, and never exceeds the speed cap, whatever its start', () => {
  const rng = createRng(11);
  for (let trial = 0; trial < 60; trial += 1) {
    const s = new PinballState(createRng(trial));
    s.phase = 'play';
    const angle = rng.range(0, Math.PI * 2);
    const speed = trial % 3 === 0 ? BALL_MAX : rng.range(20, BALL_MAX);
    s.ball = {x: rng.range(8, 48), y: rng.range(24, 80), vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, px: 0, py: 0};
    for (let i = 0; i < 60 * 8 && s.ballsLeft === BALLS && s.phase === 'play'; i += 1) {
      s.step(STEP);
      if (trial % 2 && i % 12 === 0) { s.flip('left'); s.flip('right'); }
      const {x, y, vx, vy} = s.ball;
      assert.ok(Math.hypot(vx, vy) <= BALL_MAX + 1e-6, 'speed cap');
      assert.ok(x > 0 && x < TABLE_W && y > 0, `inside the table (${x.toFixed(1)}, ${y.toFixed(1)}) trial ${trial}`);
    }
  }
});

test('tunnelling: at max speed no ball passes any wall segment, from either side, at any angle', () => {
  const skip = new Set([GATE]);
  let checked = 0;
  for (const segment of SEGMENTS) {
    if (skip.has(segment)) continue;
    const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y, length = Math.hypot(dx, dy);
    const nx = -dy / length, ny = dx / length;
    for (const side of [1, -1]) {
      for (const [t, lean] of [[0.5, 0], [0.3, 0.5], [0.7, -0.5], [0.5, 1.1]] as const) {
        const mx = segment.a.x + dx * t, my = segment.a.y + dy * t;
        const s = rest(mx + nx * side * 6, my + ny * side * 6);
        const dirx = -nx * side + (dx / length) * lean, diry = -ny * side + (dy / length) * lean, norm = Math.hypot(dirx, diry);
        s.ball.vx = (dirx / norm) * BALL_MAX; s.ball.vy = (diry / norm) * BALL_MAX;
        const signed = () => ((s.ball.x - segment.a.x) * nx + (s.ball.y - segment.a.y) * ny) * side;
        for (let i = 0; i < 30 && s.phase === 'play'; i += 1) {
          s.step(STEP / 4);
          const along = ((s.ball.x - segment.a.x) * dx + (s.ball.y - segment.a.y) * dy) / (length * length);
          if (along > 0.02 && along < 0.98) assert.ok(signed() > 0.5, `segment (${segment.a.x},${segment.a.y})-(${segment.b.x},${segment.b.y}) side ${side} t ${t}: crossed (${signed().toFixed(2)})`);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked > 150);
});

test('tunnelling: a fast ball cannot pass a flipper at rest or mid-swing, nor a bumper, a drop target or a stand-up target', () => {
  for (const side of ['left', 'right'] as const) {
    for (const swing of [false, true]) {
      for (let k = 0; k < 14; k += 1) {
        const f = new PinballState(createRng(k));
        const x = (side === 'left' ? 14 : 40) + (side === 'left' ? 1 : -1) * (1 + k * 0.6);
        f.phase = 'play'; f.saveMs = 0;
        f.ball = {x, y: 72 + k, vx: (k % 5 - 2) * 20, vy: BALL_MAX, px: x, py: 72 + k};
        if (swing && k % 2 === 0) f.flip(side);
        if (swing && k % 2 === 1) { f.flip(side); for (let i = 0; i < 3; i += 1) f.step(STEP); }
        const flipper = f.flippers[side === 'left' ? 0 : 1];
        let under = false;
        for (let i = 0; i < 30 && f.phase === 'play'; i += 1) {
          f.step(STEP / 4);
          const tx = (f.ball.x - flipper.pivot.x) / (flipper.tip.x - flipper.pivot.x);
          if (tx > 0.05 && tx < 0.95) {
            const lineY = flipper.pivot.y + tx * (flipper.tip.y - flipper.pivot.y);
            if (f.ball.y > lineY + 0.3 && f.ball.y < lineY + 6) under = true;
          }
        }
        assert.equal(under, false, `${side} swing=${swing} k=${k}: the ball got under the flipper`);
      }
    }
  }
  for (const bumper of BUMPERS) {
    for (const angle of [-1.2, -0.6, 0, 0.6, 1.2, 2.4]) {
      const s = rest(bumper.x + Math.sin(angle) * 9, bumper.y - Math.cos(angle) * 9);
      s.ball.vx = -Math.sin(angle) * BALL_MAX; s.ball.vy = Math.cos(angle) * BALL_MAX;
      let closest = Infinity;
      for (let i = 0; i < 24; i += 1) { s.step(STEP / 4); closest = Math.min(closest, Math.hypot(s.ball.x - bumper.x, s.ball.y - bumper.y)); }
      assert.ok(closest >= bumper.r + BALL_R - 0.6, `bumper (${bumper.x}, ${bumper.y}) angle ${angle}: ball reached ${closest.toFixed(2)}`);
    }
  }
  const drop = rest(14, 36.5, -BALL_MAX, 0);
  for (let i = 0; i < 30; i += 1) drop.step(STEP / 4);
  assert.ok(drop.drops[0]!.up === false, 'a fast ball drops the target rather than passing through it');
  const stand = rest(40, 41.5, BALL_MAX, 0);
  for (let i = 0; i < 20; i += 1) stand.step(STEP / 4);
  assert.ok(stand.standups.some(t => t.hitMs > 0) || stand.score >= 250, 'a stand-up target registers a fast hit');
  assert.ok(stand.ball.x < LANE_WALL_X, 'and the ball stays out of the lane');
});

test('scoring: bumpers score times the multiplier; three lanes raise it; the multiplier is capped', () => {
  const s = new PinballState(createRng(1));
  s.phase = 'play';
  for (const sensor of s.sensors) {
    s.ball = {x: sensor.x, y: sensor.y, vx: 0, vy: -1, px: 0, py: 0};
    s.step(STEP);
  }
  assert.equal(s.multiplier, 2);
  assert.ok(s.sensors.filter(x => x.lit).length <= 1, 'lanes reset after the bonus');
  const before = s.score;
  s.ball = {x: 22, y: 30, vx: 0, vy: 80, px: 0, py: 0};
  for (let i = 0; i < 30; i += 1) s.step(STEP);
  assert.ok(s.score - before >= 200, 'bumper hit counts double');
  s.multiplier = 6;
  for (const sensor of s.sensors) { s.ball = {x: sensor.x, y: sensor.y, vx: 0, vy: -1, px: 0, py: 0}; s.step(STEP); }
  assert.equal(s.multiplier, 6);
});

test('drop targets: each hit scores and drops; clearing the bank pays a bonus, raises the multiplier and re-raises the bank', () => {
  const s = rest(14, 36.5, -150, 0);
  s.multiplier = 1;
  const start = s.score;
  const order = [[14, 36.5], [14, 42.5], [14, 48.5]] as const;
  s.ball = {x: order[0][0], y: order[0][1], vx: -150, vy: 0, px: 0, py: 0};
  for (let i = 0; i < 6; i += 1) s.step(STEP);
  assert.equal(s.drops.filter(t => !t.up).length, 1);
  assert.equal(s.score - start, 200);
  for (const [x, y] of order.slice(1)) {
    s.ball = {x, y, vx: -150, vy: 0, px: 0, py: 0};
    for (let i = 0; i < 6; i += 1) s.step(STEP);
  }
  assert.equal(s.banks, 1);
  assert.ok(s.score - start >= 600 + 1500, 'bank bonus');
  assert.ok(s.multiplier >= 2, 'bank raises the multiplier');
  assert.ok(s.drops.every(t => !t.up), 'the bank stays down for a moment');
  s.ball = {x: 30, y: 70, vx: 0, vy: 0, px: 0, py: 0};
  for (let i = 0; i < 60 * 2; i += 1) { s.ball.x = 30; s.ball.y = 70; s.ball.vx = 0; s.ball.vy = 0; s.step(STEP); }
  assert.ok(s.drops.every(t => t.up), 'the bank resets');
  // A dropped target no longer blocks.
  const t = rest(14, 36.5, -150, 0);
  t.drops[0]!.up = false;
  let minX = 99;
  for (let i = 0; i < 20; i += 1) { t.step(STEP); minX = Math.min(minX, t.ball.x); }
  assert.ok(minX < 6, 'the ball passed through where the target was');
});

test('stand-up targets score and flash', () => {
  const s = rest(44, 43, 60, -20);
  s.multiplier = 2;
  let points = 0;
  for (let i = 0; i < 40; i += 1) { s.step(STEP); for (const e of s.events.splice(0)) if (e.kind === 'target') points += e.points; }
  assert.equal(points % 500, 0);
  assert.ok(points >= 500);
  assert.equal(STANDUPS.length, 2);
});

test('spinner: a ball passing through turns it either way, each half turn scores, and it winds down', () => {
  for (const dir of [1, -1]) {
    const s = rest(SPINNER.x, SPINNER.y - dir * 4, 0, 90 * dir);
    s.multiplier = 2;
    const before = s.score;
    let sign = 0;
    for (let i = 0; i < 12; i += 1) { s.step(STEP); if (s.spinner.omega !== 0) sign = Math.sign(s.spinner.omega); }
    assert.equal(sign, dir, 'turns in the direction of travel');
    assert.ok(Math.abs(s.spinner.omega) > 5);
    for (let i = 0; i < 60 * 8; i += 1) { s.ball.x = 30; s.ball.y = 70; s.ball.vx = 0; s.ball.vy = 0; s.step(STEP); }
    assert.equal(s.spinner.omega, 0, 'wound down');
    assert.ok(s.spins >= 2 && (s.score - before) % 100 === 0 && s.score > before, `spinner scored ${s.score - before}`);
  }
  const wide = rest(SPINNER.x + SPINNER.half + 4, SPINNER.y - 4, 0, 90);
  for (let i = 0; i < 12; i += 1) wide.step(STEP);
  assert.equal(wide.spinner.omega, 0, 'beside the spinner does nothing');
});

test('ramp: a rising ball at the mouth is carried along the path, scores, and is released at the far side; a falling ball is not', () => {
  const s = rest(RAMP_MOUTH.x, RAMP_MOUTH.y + 6, 0, -150);
  const before = s.score;
  let rode = 0, ridingY: number[] = [];
  for (let i = 0; i < 60 * 5 && s.phase === 'play'; i += 1) {
    s.step(STEP);
    if (s.rampAt !== undefined) { rode += 1; ridingY.push(s.ball.y); }
    if (s.rampAt === undefined && rode > 0) break;
  }
  assert.ok(rode > 20, 'rode the ramp');
  assert.ok(Math.min(...ridingY) < 12, 'the ramp goes over the top');
  assert.equal(s.ramps, 1);
  assert.ok(s.score - before >= 750);
  const last = RAMP_PATH[RAMP_PATH.length - 1]!;
  assert.ok(Math.hypot(s.ball.x - last.x, s.ball.y - last.y) < 4, 'released at the far end');
  assert.ok(s.ball.vy > 0, 'and falls back onto the table');
  const down = rest(RAMP_MOUTH.x, RAMP_MOUTH.y - 3, 0, 60);
  for (let i = 0; i < 6; i += 1) down.step(STEP);
  assert.equal(down.ramps, 0, 'a falling ball ignores the mouth');
  // Three ramps in one ball raise the multiplier; nudging during a ride does nothing.
  const t = rest(RAMP_MOUTH.x, RAMP_MOUTH.y + 4, 0, -150);
  for (let k = 0; k < 3; k += 1) {
    t.ball = {x: RAMP_MOUTH.x, y: RAMP_MOUTH.y + 4, vx: 0, vy: -150, px: 0, py: 0};
    for (let i = 0; i < 60 * 4 && t.ramps === k; i += 1) t.step(STEP);
    t.nudge();
    for (let i = 0; i < 60 * 3 && t.rampAt !== undefined; i += 1) t.step(STEP);
  }
  assert.equal(t.ramps, 3);
  assert.equal(t.multiplier, 2);
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
  assert.equal(s.flip('left'), false);
});

/** A scripted player: plunges, and taps a flipper when the ball is in its reach and coming down. */
function bot(s: PinballState, frame: number): void {
  if (s.phase === 'lane') { if (frame % 30 === 0) s.plunger(); return; }
  if (s.phase === 'charging') { if (s.charge > 0.6) s.plunger(); return; }
  if (s.phase !== 'play') return;
  const {x, y, vy} = s.ball;
  if (y > 76 && y < 92 && vy > -20) {
    if (x < 27 && x > 8) s.flip('left');
    if (x >= 27 && x < 46) s.flip('right');
  }
  if (frame % 211 === 0) s.nudge();
}

test('endurance: ten simulated minutes per seed with a flipper bot - never stuck, speed bounded, always drains or plays on', () => {
  let drains = 0, ramps = 0, spins = 0, banks = 0, saves = 0;
  for (let seed = 1; seed <= 3; seed += 1) {
    let s = new PinballState(createRng(seed * 101));
    let anchor = {x: 0, y: 0}, still = 0, worst = 0;
    for (let frame = 0; frame < 60 * 600; frame += 1) {
      if (s.over) { drains += BALLS; ramps += s.ramps; spins += s.spins; banks += s.banks; s = new PinballState(createRng(seed * 7 + frame)); }
      bot(s, frame);
      s.step(STEP);
      for (const e of s.events.splice(0)) if (e.kind === 'save') saves += 1;
      const {x, y, vx, vy} = s.ball;
      assert.ok(Math.hypot(vx, vy) <= BALL_MAX + 1e-6, 'speed bounded');
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && x > 0 && x < TABLE_W && y > 0, `ball on the table (${x}, ${y})`);
      if (s.phase === 'play' && s.rampAt === undefined) {
        if (Math.hypot(x - anchor.x, y - anchor.y) > 5) { anchor = {x, y}; still = 0; } else still += STEP;
        worst = Math.max(worst, still);
      } else { still = 0; anchor = {x, y}; }
    }
    ramps += s.ramps; spins += s.spins; banks += s.banks;
    assert.ok(worst <= STALL_MS + 800, `seed ${seed}: ball stayed within 5 units for ${(worst / 1000).toFixed(1)} s`);
  }
  assert.ok(drains >= 0 && saves >= 0);
  assert.ok(spins > 0, 'the bot reached the spinner');
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
  const a = run(1), b = run(1), c = run(2), d = run(5);
  assert.equal(a.score, b.score);
  assert.equal(a.ball.x, b.ball.x);
  for (const other of [c, d]) {
    assert.equal(other.score, a.score);
    assert.equal(other.ballsLeft, a.ballsLeft);
    assert.ok(Math.abs(other.ball.x - a.ball.x) < 1e-6 && Math.abs(other.ball.y - a.ball.y) < 1e-6, 'splits agree');
  }
});

test('game: keys, a full game saves its record once, dispose cleans up', () => {
  const record = memory();
  const game = pinballGame.create(context(record));
  assert.equal(game.status, 'ready');
  assert.match(pinballGame.controls.map(c => c.action).join(' '), /tap/);
  assert.equal(game.key({kind: 'text', value: 'q'}), 'ignored');
  assert.equal(game.key({kind: 'left'}), 'handled');
  assert.equal(game.status, 'playing');
  for (const key of [{kind: 'right'}, {kind: 'up'}, {kind: 'down'}, {kind: 'text', value: 'z'}, {kind: 'text', value: 'a'}, {kind: 'text', value: 'x'}, {kind: 'text', value: 'l'}, {kind: 'text', value: '/'}, {kind: 'enter'}] as const) assert.equal(game.key(key), 'handled');
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
        if (phase === 'ready' && columns >= 60) assert.match(text, /tap/i, 'the flip limitation is stated');
        if (phase === 'over') assert.match(text, /GAME OVER/);
        if (mode === 'none' && phase === 'charging') assert.match(text, /Power/);
      }
      game.dispose();
    }
  }
  pinballGame.preview(new Canvas(30, 6), 5, arcadePalette());
});
