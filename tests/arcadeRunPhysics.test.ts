import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {
  AIR_FROM_PX, AIR_KINDS, clusterWidth, contactOf, Course, GROUND_KINDS, KINDS, MAX_CLUSTER, minSafeGap, slot, verifySchedule, type Obstacle,
} from '../src/arcade/games/run/course.js';
import {
  AERIAL_LIFT, AIR_STEPS, airStep, APEX, CAT_W, DT, DUCK_H, DUCK_STEPS, FAST_FALL, GRAVITY, HB_X, JUMP_BUFFER_STEPS, JUMP_PROFILE, JUMP_V,
  jumpWindow, RAMP_PX, SAFE_STEPS, SLACK_STEPS, SPEED_MAX, SPEED_START, speedAt, difficultyAt, STAND_H, windowSize,
} from '../src/arcade/games/run/physics.js';
import {overlaps, RunWorld, SCORE_PX} from '../src/arcade/games/run/world.js';
import {playBot} from './support/runBot.js';

const course = (seed: number) => new Course(createRng(seed).fork('course'));

test('jump arc: the profile follows the constants, peaks once, lands exactly and fast fall shortens it', () => {
  assert.equal(JUMP_PROFILE[0], 0);
  assert.equal(JUMP_PROFILE[AIR_STEPS], 0);
  assert.ok(Math.abs(APEX - (JUMP_V * JUMP_V) / (2 * GRAVITY)) < 1, `apex ${APEX} near v^2/2g`);
  assert.ok(Math.abs(AIR_STEPS * DT - (2 * JUMP_V) / GRAVITY) < 2 * DT, 'airtime near 2v/g');
  const peak = JUMP_PROFILE.indexOf(APEX);
  for (let j = 1; j <= peak; j += 1) assert.ok(JUMP_PROFILE[j]! > JUMP_PROFILE[j - 1]!);
  for (let j = peak + 1; j < AIR_STEPS; j += 1) assert.ok(JUMP_PROFILE[j]! < JUMP_PROFILE[j - 1]!);
  assert.ok(APEX > 12 && APEX < 20 && AIR_STEPS > 35 && AIR_STEPS < 50);
  // A fast fall pressed at takeoff is a short hop: lower and quicker by roughly the gravity factor.
  const state = {y: 0, vy: JUMP_V};
  let steps = 0; let high = 0;
  while (!airStep(state, true)) { steps += 1; high = Math.max(high, state.y); }
  assert.ok(steps + 1 < AIR_STEPS * 0.75, `hop ${steps + 1} steps vs ${AIR_STEPS}`);
  assert.ok(high < APEX * (0.5 + 1 / FAST_FALL / 2) + 0.1 && high < APEX);
});

test('physics: gravity, landing, jump buffer, duck and fast fall in the real world', () => {
  const world = new RunWorld(createRng(3).fork('course'));
  world.course.obstacles.length = 0;
  world.course.ensure(0);
  assert.equal(world.jump(), true);
  assert.equal(world.airborne, true);
  assert.equal(world.jump(), false, 'no double jump');
  let landedAfter = 0;
  for (let i = 0; i < 100 && !landedAfter; i += 1) landedAfter = world.step().landedAfter;
  assert.equal(landedAfter, AIR_STEPS);
  assert.equal(world.y, 0);
  assert.equal(world.airborne, false);
  // A press in the last few steps before touchdown jumps again on landing.
  world.jump();
  for (let i = 0; i < AIR_STEPS - JUMP_BUFFER_STEPS + 1; i += 1) world.step();
  world.jump();
  for (let i = 0; i < JUMP_BUFFER_STEPS + 1 && world.airborne; i += 1) world.step();
  assert.equal(world.airborne, true, 'buffered jump fires on touchdown');
  // Down on the ground ducks for DUCK_STEPS; a jump leaves the duck; Down in the air is a fast fall.
  const ground = new RunWorld(createRng(4).fork('course'));
  ground.duck();
  assert.equal(ground.ducking, true);
  assert.equal(ground.tall, DUCK_H);
  for (let i = 0; i < DUCK_STEPS; i += 1) ground.step();
  assert.equal(ground.ducking, false);
  assert.equal(ground.tall, STAND_H);
  ground.duck(); ground.jump();
  assert.equal(ground.ducking, false);
  ground.step(); ground.duck();
  let hop = 0;
  while (ground.airborne && hop < 100) { ground.step(); hop += 1; }
  assert.ok(hop < AIR_STEPS * 0.75, 'fast fall lands sooner');
});

test('collision boundaries: touching is clear, a real overlap is a hit; ducking passes under, standing does not', () => {
  const ground = {x: 100, w: 6, h: 6, lift: 0};
  assert.equal(overlaps(100 - CAT_W, 0, STAND_H, ground), false, 'just touching from the left');
  assert.equal(overlaps(100 - CAT_W + 0.01, 0, STAND_H, ground), true, 'a hair inside');
  assert.equal(overlaps(106, 0, STAND_H, ground), false, 'just past the right edge');
  assert.equal(overlaps(105.99, 0, STAND_H, ground), true);
  assert.equal(overlaps(100, 6, STAND_H, ground), false, 'feet exactly at the top: clear');
  assert.equal(overlaps(100, 5.99, STAND_H, ground), true);
  const bird = {x: 100, w: 10, h: 4, lift: AERIAL_LIFT};
  assert.equal(overlaps(100, 0, STAND_H, bird), true, 'standing hits the bird');
  assert.equal(overlaps(100, 0, DUCK_H, bird), false, 'ducking passes under');
  assert.equal(overlaps(100, 0, AERIAL_LIFT, bird), false, 'head exactly at the underside: clear');
  assert.equal(overlaps(100, 4, DUCK_H, bird), true, 'a jump into the bird');
  // The same through the world: standing under a bird dies, ducking lives.
  for (const duck of [false, true]) {
    const world = new RunWorld(createRng(9).fork('course'));
    const hitbox = world.distance + HB_X + CAT_W;
    world.course.obstacles.unshift({id: 999, kind: 'bird', x: hitbox + 12, w: 10, h: 4, lift: AERIAL_LIFT, air: true, count: 1});
    for (let i = 0; i < 60 && world.alive; i += 1) { if (duck) world.duck(); world.step(); }
    assert.equal(world.alive, duck);
  }
});

test('speed and difficulty ramp monotonically and are capped', () => {
  let last = 0; let lastDiff = 0;
  for (let d = 0; d <= RAMP_PX * 3; d += 25) {
    const v = speedAt(d); const diff = difficultyAt(d);
    assert.ok(v >= last && v <= SPEED_MAX && v >= SPEED_START);
    assert.ok(diff >= lastDiff && diff <= 1);
    last = v; lastDiff = diff;
  }
  assert.equal(speedAt(RAMP_PX), SPEED_MAX);
  assert.equal(speedAt(RAMP_PX * 50), SPEED_MAX, 'the cap holds forever');
  // Over a long course the clusters grow and the aerial share rises with distance and never appears early.
  const buckets = [{n: 0, air: 0, width: 0}, {n: 0, air: 0, width: 0}, {n: 0, air: 0, width: 0}, {n: 0, air: 0, width: 0}];
  for (let seed = 1; seed <= 80; seed += 1) {
    const c = course(seed); c.ensure(RAMP_PX + 6000);
    for (const o of c.obstacles) {
      const d = contactOf(o);
      const bucket = buckets[d < AIR_FROM_PX ? 0 : d < RAMP_PX / 3 ? 1 : d < RAMP_PX ? 2 : 3]!;
      bucket.n += 1; if (o.air) bucket.air += 1; else bucket.width += o.count;
      if (d < AIR_FROM_PX) assert.equal(o.air, false, 'no aerial obstacle in the opening stretch');
    }
  }
  const share = buckets.map(b => b.air / b.n);
  const cluster = buckets.map(b => b.width / (b.n - b.air));
  assert.equal(share[0], 0);
  assert.ok(share[1]! > 0.05 && share[2]! > share[1]! && share[3]! > share[2]!, `aerial share ${share.map(s => s.toFixed(2))}`);
  assert.ok(cluster[2]! > cluster[0]! && cluster[3]! > cluster[2]!, `cluster size ${cluster.map(s => s.toFixed(2))}`);
});

test('every obstacle the generator can emit is clearable at every speed it can meet', () => {
  for (const kind of GROUND_KINDS) {
    for (let speed = SPEED_START; speed <= SPEED_MAX; speed += 0.5) {
      // A single unit always has a comfortable window: the generator never needs a gap-only excuse.
      assert.ok(windowSize(jumpWindow(KINDS[kind].w, KINDS[kind].h, speed)) >= SLACK_STEPS, `${kind} at ${speed}`);
    }
  }
  assert.ok(MAX_CLUSTER >= 3);
  for (let seed = 1; seed <= 30; seed += 1) {
    const c = course(seed); c.ensure(RAMP_PX * 1.5);
    for (const o of c.obstacles) {
      assert.ok(o.w === (o.air ? KINDS[o.kind].w : clusterWidth(o.kind, o.count)));
      assert.equal(o.air, AIR_KINDS.includes(o.kind));
      if (o.air) continue;
      const here = contactOf(o);
      for (const speed of [speedAt(here), speedAt(here + 400)]) {
        assert.ok(windowSize(jumpWindow(o.w, o.h, speed)) >= SLACK_STEPS, `${o.kind}x${o.count} (${o.w}x${o.h}) at ${speed.toFixed(1)}`);
      }
    }
  }
  // The largest thing the generator ever emits stays within what the apex can clear with room to spare.
  const tallest = Math.max(...GROUND_KINDS.map(kind => KINDS[kind].h));
  assert.ok(tallest + 1 + 4 < APEX, 'every ground obstacle is far below the jump apex');
});

test('reachability proof: every consecutive pair in thousands of obstacles keeps the required slack, at every speed', () => {
  let total = 0; let airs = 0; let clusters = 0; let tightest = Infinity;
  for (let seed = 1; seed <= 120; seed += 1) {
    const c = course(seed);
    c.ensure(RAMP_PX * 2.5);
    const verdict = verifySchedule(c.obstacles);
    assert.ok(verdict.ok, `seed ${seed} failed at obstacle ${verdict.failedAt}`);
    assert.ok(verdict.worstSlack >= SAFE_STEPS);
    tightest = Math.min(tightest, verdict.worstSlack);
    total += c.obstacles.length;
    airs += c.obstacles.filter(o => o.air).length;
    clusters += c.obstacles.filter(o => o.count > 1).length;
    // Gaps are real: the next obstacle never overlaps the last and never starts inside the cat-width dead zone.
    c.obstacles.forEach((o, index) => { if (index) assert.ok(o.x >= c.obstacles[index - 1]!.x + c.obstacles[index - 1]!.w + 14 - 1e-9); });
  }
  assert.ok(total > 3000 && airs > 300 && clusters > 300, `${total} obstacles, ${airs} aerial, ${clusters} clusters`);
  assert.ok(tightest >= SAFE_STEPS);
});

test('minimum safe gap: computed per speed and pair, and every generated gap is at least that', () => {
  for (let speed = SPEED_START; speed <= SPEED_MAX; speed += 4) {
    let widest = 0;
    for (const a of [...GROUND_KINDS, ...AIR_KINDS]) for (const b of [...GROUND_KINDS, ...AIR_KINDS]) {
      const gap = minSafeGap(KINDS[a], KINDS[b], speed);
      assert.ok(gap !== undefined && gap >= 0, `${a}->${b} at ${speed}`);
      widest = Math.max(widest, gap!);
    }
    // The worst pair needs well under a screen even at the cap, so a normal terminal can always show the next move.
    assert.ok(widest < 100, `worst gap ${widest} at ${speed}`);
  }
  assert.ok(minSafeGap(KINDS.crates, KINDS.crates, SPEED_MAX)! > minSafeGap(KINDS.crates, KINDS.crates, SPEED_START)!, 'faster means a longer gap');
  for (let seed = 1; seed <= 60; seed += 1) {
    const c = course(seed); c.ensure(RAMP_PX * 1.2);
    c.obstacles.forEach((b, index) => {
      if (!index) return;
      const a = c.obstacles[index - 1]!;
      const gap = b.x - (a.x + a.w);
      const need = minSafeGap(a, b, speedAt(contactOf(b) + 60));
      assert.ok(need !== undefined && gap + 1.5 >= need, `seed ${seed} #${index}: gap ${gap.toFixed(1)} < ${need}`);
    });
  }
  // A gap even slightly under the minimum is genuinely unreachable for the best player.
  const a = KINDS.crates; const b = KINDS.crates; const speed = SPEED_MAX;
  const need = minSafeGap(a, b, speed)!;
  const first = slot(a, 0, speed * DT, -Infinity, 0)!;
  const tooClose = slot(b, a.w + need - 6, speed * DT, first.free, first.react)!;
  assert.ok(tooClose.slack < SAFE_STEPS);
});

function check(timing: 'early' | 'mid' | 'late' | 'random', seeds: number[], steps: number) {
  for (const seed of seeds) {
    const result = playBot(seed, steps, timing);
    assert.ok(result.survived, `${timing} bot died on seed ${seed} at step ${result.steps}, distance ${result.distance.toFixed(0)}`);
    assert.ok(result.jumps > 100 && result.ducks > 20);
    assert.ok(result.distance > RAMP_PX * 1.5, 'the run reached and held the speed cap');
  }
}

test('simulated optimal player survives 20000 steps on several seeds (early, middle and late takeoff)', () => {
  check('mid', [1, 2, 3, 4, 5, 6, 7, 8], 20000);
  check('early', [11, 12, 13], 20000);
  check('late', [21, 22, 23], 20000);
});

test('a player jumping at a random point in the window also survives; a bot that never acts or only spams jump dies', () => {
  check('random', [31, 32, 33, 34], 20000);
  for (const seed of [1, 2, 3, 4, 5]) {
    const idle = playBot(seed, 20000, 'idle');
    assert.equal(idle.survived, false);
    assert.ok(idle.steps < 1500, `idle bot lasted ${idle.steps}`);
    const spam = playBot(seed, 20000, 'spam');
    assert.equal(spam.survived, false, 'jumping constantly does not clear birds and wrong timing hits crates');
  }
});

test('determinism: same seed and inputs give the same hash at every step; a different seed differs; score is distance', () => {
  const run = (seed: number) => {
    const world = new RunWorld(createRng(seed).fork('course'));
    const hashes: number[] = [];
    for (let i = 0; i < 600; i += 1) {
      if (i % 37 === 5) world.jump();
      if (i % 53 === 9) world.duck();
      world.step(); hashes.push(world.hash());
    }
    return {hashes, world};
  };
  const a = run(5); const b = run(5); const c = run(6);
  assert.deepEqual(a.hashes, b.hashes);
  assert.notDeepEqual(a.hashes, c.hashes);
  assert.equal(a.world.score, Math.floor(a.world.distance / SCORE_PX));
  assert.ok(a.world.score > 0);
});
