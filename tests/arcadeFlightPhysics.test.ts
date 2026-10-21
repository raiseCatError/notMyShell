import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Course, gapAt} from '../src/arcade/games/flight/course.js';
import {
  CAT_H, CAT_W, centerOf, climbIn, DT, difficultyAt, EDGE, fallIn, FALL_PER_STEP, FLAP_CLIMB, FLAP_COOLDOWN, FLAP_V, GAP_MIN, GRAVITY, minFree, minGap,
  minSpacing, motion, OB_W, pairReachable, RAMP_PX, REACT_STEPS, shiftLimit, SPEED_MAX, SPEED_START, speedAt, TERMINAL_V,
} from '../src/arcade/games/flight/physics.js';
import {FlightWorld, hitTest, stateHash} from '../src/arcade/games/flight/world.js';
import type {Obstacle} from '../src/arcade/games/flight/course.js';
import {LATE_STEPS, playBot} from './support/flightBot.js';

const emptyWorld = (height = 400): FlightWorld => {
  const world = new FlightWorld(createRng(1).fork('course'), height);
  world.course.obstacles.length = 0;
  (world.course as unknown as {lastX: number}).lastX = 1e9;
  world.y = height / 2; world.prevY = world.y;
  return world;
};
const pipe = (x: number, gapTop: number, gapBottom: number): Obstacle => ({id: 1, style: 'books', x, gapTop, gapBottom, scored: false});

test('flap sets an upward speed, it does not move the cat; gravity then pulls it back down', () => {
  const world = emptyWorld();
  const y = world.y;
  assert.equal(world.flap(), true);
  assert.equal(world.y, y, 'the flap itself changes the speed, not the position');
  assert.equal(world.vy, -FLAP_V);
  world.step();
  assert.ok(Math.abs(world.vy - (-FLAP_V + GRAVITY * DT)) < 1e-12);
  assert.ok(Math.abs(world.y - (y + world.vy * DT)) < 1e-12);
  let top = world.y;
  while (world.vy < 0) { world.step(); top = Math.min(top, world.y); }
  assert.ok(Math.abs((y - top) - FLAP_CLIMB) < 1e-9, 'the measured climb is the FLAP_CLIMB the fairness proofs use');
  assert.ok(FLAP_CLIMB > 6 && FLAP_CLIMB < 9);
  for (let i = 0; i < 40; i += 1) world.step();
  assert.ok(world.y > top, 'and it falls again');
});

test('gravity accelerates smoothly (equal increments) up to a terminal speed that is never exceeded', () => {
  let state = {y: 0, vy: 0};
  const speeds: number[] = [];
  for (let i = 0; i < 300; i += 1) { state = motion(state.y, state.vy); speeds.push(state.vy); }
  assert.ok(Math.abs(speeds[0]! - GRAVITY * DT) < 1e-12);
  assert.ok(Math.abs(speeds[9]! - 10 * GRAVITY * DT) < 1e-9, 'speed grows linearly while under the cap');
  assert.ok(speeds.every(speed => speed <= TERMINAL_V));
  assert.equal(speeds.at(-1), TERMINAL_V);
  assert.ok(speeds.every((speed, index) => index === 0 || speed >= speeds[index - 1]!), 'monotonic: no jolts');
  const reached = speeds.findIndex(speed => speed === TERMINAL_V);
  assert.ok(reached > 10 && reached < 100);
  assert.ok(Math.abs(FALL_PER_STEP - TERMINAL_V * DT) < 1e-12);
});

test('flaps inside a wingbeat are ignored; spamming the key cannot climb faster than the proof assumes', () => {
  const world = emptyWorld();
  assert.equal(world.flap(), true);
  for (let i = 0; i < FLAP_COOLDOWN - 1; i += 1) { world.step(); assert.equal(world.flap(), false); }
  world.step();
  assert.equal(world.flap(), true, 'accepted again once the wingbeat is over');
  const spammer = emptyWorld();
  const start = spammer.y;
  for (let i = 0; i < 90; i += 1) { spammer.flap(); spammer.step(); }
  assert.ok(start - spammer.y <= climbIn(90) + 1e-9, 'the most any presses can climb is climbIn()');
  assert.ok(Math.abs(climbIn(90) - (start - spammer.y)) < 1e-9, 'and pressing at every chance reaches exactly that');
});

test('the fairness quantities come from the real step', () => {
  // climbIn: flap as early as allowed. fallIn: no flap, starting just after one.
  const world = emptyWorld();
  const y = world.y;
  for (let i = 0; i < 50; i += 1) { world.flap(); world.step(); }
  assert.ok(Math.abs(climbIn(50) - (y - world.y)) < 1e-9);
  const falling = emptyWorld();
  falling.flap();
  const fy = falling.y;
  for (let i = 0; i < 50; i += 1) falling.step();
  assert.ok(Math.abs(fallIn(50) - (falling.y - fy)) < 1e-9);
  for (let n = 1; n < 120; n += 1) { assert.ok(climbIn(n) >= climbIn(n - 1)) ; if (n > 30) assert.ok(fallIn(n) >= fallIn(n - 1)); }
  assert.ok(GAP_MIN >= CAT_H + FLAP_CLIMB + FALL_PER_STEP + 1, 'the smallest gap has room for one flap arc, a step of overshoot and a pixel');
  for (const speed of [SPEED_START, 60, SPEED_MAX]) assert.equal(minGap(speed), GAP_MIN);
});

test('shift limits: more time allows more, a wide start gap allows less, and minimum spacing is a real distance', () => {
  for (const speed of [SPEED_START, 60, SPEED_MAX]) {
    let last = -1;
    for (let steps = 20; steps <= 140; steps += 10) {
      const free = steps * speed * DT;
      const up = shiftLimit('up', speed, free, GAP_MIN);
      assert.ok(up >= last, 'monotonic in the time available');
      last = up;
      assert.ok(shiftLimit('up', speed, free, 28) <= up);
      assert.ok(shiftLimit('down', speed, free, GAP_MIN) >= 0);
    }
    assert.equal(shiftLimit('up', speed, 0, GAP_MIN), 0);
    assert.ok(Math.abs(minFree(speed) - (REACT_STEPS + 16) * speed * DT) < 1e-9);
    assert.equal(minSpacing(speed), OB_W + CAT_W + minFree(speed));
  }
  // The pair test itself, on a hand-made pair at exactly the limit and one pixel beyond.
  const speed = SPEED_MAX;
  const free = 60 * speed * DT;
  const a = {x: 0, gapTop: 10, gapBottom: 10 + GAP_MIN};
  const limit = shiftLimit('up', speed, free, GAP_MIN);
  const at = (shift: number) => ({x: OB_W + CAT_W + free, gapTop: 10 + 0 - shift + 0, gapBottom: 10 - shift + GAP_MIN});
  assert.equal(pairReachable(a, at(limit), speed), true);
  assert.equal(pairReachable(a, at(limit + 1), speed), false);
  assert.equal(pairReachable(a, {...at(0), x: OB_W + CAT_W + minFree(speed) - 1}, speed), false, 'too close');
  assert.equal(pairReachable(a, {...at(0), gapBottom: at(0).gapBottom - 1}, speed), false, 'gap below the minimum');
});

test('difficulty ramps monotonically and is capped: speed, gap height and the shift variation', () => {
  let previousSpeed = 0; let previousGap = Infinity; let previousDifficulty = -1;
  for (let distance = -100; distance <= RAMP_PX * 3; distance += 50) {
    const speed = speedAt(distance); const gap = gapAt(distance, 36); const difficulty = difficultyAt(distance);
    assert.ok(speed >= previousSpeed && gap <= previousGap && difficulty >= previousDifficulty);
    assert.ok(speed >= SPEED_START && speed <= SPEED_MAX && gap >= GAP_MIN);
    [previousSpeed, previousGap, previousDifficulty] = [speed, gap, difficulty];
  }
  assert.equal(speedAt(0), SPEED_START);
  assert.equal(speedAt(RAMP_PX), SPEED_MAX);
  assert.equal(speedAt(RAMP_PX * 50), SPEED_MAX, 'capped');
  assert.equal(gapAt(RAMP_PX * 50, 36), GAP_MIN);
  assert.ok(gapAt(0, 36) > GAP_MIN + 4);
  // Gap center movement grows with difficulty (mean absolute shift early vs at the cap, over many seeds).
  const meanShift = (start: number): number => {
    let total = 0; let count = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const course = new Course(createRng(seed), 100, start); course.ensure(start + 4000);
      const list = course.obstacles;
      for (let i = 1; i < list.length; i += 1) { total += Math.abs(centerOf(list[i]!) - centerOf(list[i - 1]!)); count += 1; }
    }
    return total / count;
  };
  assert.ok(meanShift(RAMP_PX * 2) > meanShift(0) * 1.3, `${meanShift(RAMP_PX * 2)} vs ${meanShift(0)}`);
  // Spacing in time shrinks as difficulty rises.
  const meanFreeTime = (start: number): number => {
    let total = 0; let count = 0;
    const course = new Course(createRng(4), 48, start); course.ensure(start + 6000);
    for (let i = 1; i < course.obstacles.length; i += 1) { const a = course.obstacles[i - 1]!; const b = course.obstacles[i]!; total += (b.x - a.x - OB_W - CAT_W) / speedAt(b.x); count += 1; }
    return total / count;
  };
  assert.ok(meanFreeTime(RAMP_PX * 2) < meanFreeTime(0));
});

test('collision boundaries: touching is clear, the smallest overlap is a hit (pipes, ceiling, ground)', () => {
  const height = 40;
  const obstacles = [pipe(100, 10, 10 + 16)];
  const x = 100 + 1; // overlapping horizontally
  assert.equal(hitTest(x, 10, height, obstacles), undefined, 'hitbox top exactly on the gap top');
  assert.equal(hitTest(x, 10 - 0.001, height, obstacles), 'pipe');
  assert.equal(hitTest(x, 26 - CAT_H, height, obstacles), undefined, 'hitbox bottom exactly on the gap bottom');
  assert.equal(hitTest(x, 26 - CAT_H + 0.001, height, obstacles), 'pipe');
  assert.equal(hitTest(100 - CAT_W, 0.5, height, obstacles), undefined, 'right edge exactly at the pipe: just touching');
  assert.equal(hitTest(100 - CAT_W + 0.001, 0.5, height, obstacles), 'pipe', 'a sliver of overlap');
  assert.equal(hitTest(100 + OB_W, 0.5, height, obstacles), undefined, 'left edge exactly at the far side: just clear');
  assert.equal(hitTest(100 + OB_W - 0.001, 0.5, height, obstacles), 'pipe');
  assert.equal(hitTest(x, 0, height, [pipe(100, 0, 20)]), undefined, 'ceiling exactly touched is clear');
  assert.equal(hitTest(0, 0, height, []), undefined);
  assert.equal(hitTest(0, -0.001, height, []), 'ceiling');
  assert.equal(hitTest(0, height - CAT_H, height, []), undefined, 'standing on the ground exactly');
  assert.equal(hitTest(0, height - CAT_H + 0.001, height, []), 'ground');
});

test('a hit ends the run in the world: it freezes and says what was hit', () => {
  const world = emptyWorld(60);
  world.y = 60 - CAT_H - 0.5; world.prevY = world.y;
  const outcome = world.step();
  assert.equal(outcome.hit, undefined);
  while (world.alive) world.step();
  assert.equal(world.hitKind, 'ground');
  const hash = stateHash(world);
  world.step(); world.flap();
  assert.equal(stateHash(world), hash, 'a finished world does not change');
  const ceiling = emptyWorld(60);
  ceiling.y = 1; ceiling.prevY = 1;
  for (let i = 0; i < 100 && ceiling.alive; i += 1) { ceiling.flap(); ceiling.step(); }
  assert.equal(ceiling.hitKind, 'ceiling');
});

test('scoring: +1 once per obstacle, when the cat has fully passed it, and never for one it hit', () => {
  const world = emptyWorld(100);
  world.course.obstacles.push(pipe(world.x + 30, 20, 80));
  world.y = 40; world.prevY = 40;
  let scoredAt = -1;
  for (let i = 0; i < 400 && world.alive; i += 1) {
    if (world.y + world.vy * DT > 70) world.flap();
    const before = world.score;
    world.step();
    if (world.score > before && scoredAt < 0) scoredAt = i;
    if (scoredAt < 0) assert.equal(world.score, 0);
  }
  assert.equal(world.score, 1, 'exactly one point, however long the cat flies on');
  assert.ok(world.course.obstacles[0]!.scored);
  const crash = emptyWorld(100);
  crash.course.obstacles.push(pipe(crash.x + 20, 60, 90));
  crash.y = 10; crash.prevY = 10;
  while (crash.alive) crash.step();
  assert.equal(crash.score, 0);
  assert.equal(crash.hitKind, 'pipe');
  // Over a long run each obstacle counts once: the score equals the number of obstacles behind the cat.
  const run = playBot(2, 12000, 'optimal');
  const passed = run.world.course.obstacles.filter(o => o.scored).length;
  assert.ok(run.world.score >= passed, 'trimmed obstacles were counted too');
  const behind = run.world.course.obstacles.filter(o => o.x + OB_W <= run.world.x);
  assert.ok(behind.every(o => o.scored) && behind.length === passed, 'every obstacle behind the cat is scored, none ahead is');
  const newest = Math.max(...run.world.course.obstacles.map(o => o.id));
  assert.equal(run.world.score, newest - (run.world.course.obstacles.length - passed), 'one point per id, no gaps or repeats');
  const ids = new Set(run.world.course.obstacles.map(o => o.id));
  assert.equal(ids.size, run.world.course.obstacles.length, 'ids are unique');
});

test('the generator only emits reachable pairs: thousands of obstacles, many seeds, every speed and height', () => {
  let pairs = 0; let widest = 0;
  for (const height of [26, 28, 36, 48, 56, 100]) {
    for (const start of [0, 800, 1750, 3500, 5200, RAMP_PX, RAMP_PX * 3]) {
      for (let seed = 1; seed <= 14; seed += 1) {
        const course = new Course(createRng(seed * 7919), height, start);
        course.ensure(start + 5000);
        const list = course.obstacles;
        for (let i = 0; i < list.length; i += 1) {
          const b = list[i]!;
          assert.ok(b.gapBottom - b.gapTop >= GAP_MIN, 'never below the minimum gap');
          assert.ok(Number.isInteger(b.gapTop) && Number.isInteger(b.gapBottom));
          assert.ok(b.gapTop >= EDGE && b.gapBottom <= height - EDGE, `inside the world: ${b.gapTop}..${b.gapBottom} of ${height}`);
          if (i === 0) continue;
          const a = list[i - 1]!;
          assert.ok(b.x - a.x >= minSpacing(speedAt(b.x)) - 1e-9, 'minimum spacing');
          assert.ok(pairReachable(a, b, speedAt(b.x)), `pair ${i} unreachable at seed ${seed}, start ${start}, height ${height}`);
          pairs += 1; widest = Math.max(widest, Math.abs(centerOf(b) - centerOf(a)));
        }
      }
    }
  }
  assert.ok(pairs > 5000, `${pairs} pairs`);
  assert.ok(widest >= 8, 'and the course does move around');
});

test('a simulated player survives 20000 steps at the hardest speed and gap, on several seeds and world heights', () => {
  for (const height of [28, 36, 56, 100]) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const run = playBot(seed, 20000, 'optimal', {height, start: RAMP_PX * 3});
      assert.equal(run.survived, true, `seed ${seed}, height ${height}: hit ${String(run.hit)} after ${run.steps} steps with score ${run.score}`);
      assert.ok(run.flaps > 200 && run.score > 150, 'and it really flew');
      assert.equal(speedAt(run.world.x), SPEED_MAX);
    }
  }
  for (const seed of [11, 12, 13]) assert.equal(playBot(seed, 20000, 'optimal').survived, true, 'from the very start too');
});

test('a late reaction (as slow as the generator allows) also survives; a hopelessly late one does not always', () => {
  assert.equal(LATE_STEPS, REACT_STEPS);
  for (const height of [28, 36, 56]) for (const seed of [1, 2, 3, 4, 5]) {
    const run = playBot(seed, 20000, 'late', {height, start: RAMP_PX * 3});
    assert.equal(run.survived, true, `late bot, seed ${seed}, height ${height}: ${String(run.hit)} at ${run.steps}`);
    assert.equal(playBot(seed, 8000, 'late', {height}).survived, true);
  }
  const lost = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(seed => !playBot(seed, 20000, 'very-late', {height: 36, start: RAMP_PX * 3}).survived);
  assert.ok(lost.length > 0, 'the margin is real: a 0.67 s reaction does fail somewhere');
});

test('players who do nothing, or only mash the key, die', () => {
  for (const seed of [1, 2, 3]) {
    const idle = playBot(seed, 5000, 'idle');
    assert.equal(idle.survived, false); assert.equal(idle.hit, 'ground'); assert.ok(idle.steps < 60); assert.equal(idle.score, 0);
    const spam = playBot(seed, 5000, 'spam');
    assert.equal(spam.survived, false); assert.equal(spam.hit, 'ceiling');
  }
});

test('determinism: the same seed and inputs give the same state hash at every step; another seed does not', () => {
  const hashes = (seed: number): string[] => {
    const world = new FlightWorld(createRng(seed).fork('course'), 36);
    const out: string[] = [];
    for (let i = 0; i < 1500 && world.alive; i += 1) { if (i % 17 === 0 || world.y > 28) world.flap(); world.step(); if (i % 50 === 0) out.push(stateHash(world)); }
    return out;
  };
  assert.deepEqual(hashes(9), hashes(9));
  assert.notDeepEqual(hashes(9), hashes(10));
  const a = new Course(createRng(5), 36, 0); const b = new Course(createRng(5), 36, 0);
  a.ensure(3000); b.ensure(6000);
  assert.deepEqual(a.obstacles, b.obstacles.slice(0, a.obstacles.length), 'how far ahead the course is made never changes it');
  const tall = new Course(createRng(5), 36, 0); tall.ensure(3000);
  assert.deepEqual(a.obstacles, tall.obstacles);
});
