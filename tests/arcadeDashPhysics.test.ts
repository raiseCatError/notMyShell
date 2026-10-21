import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIR_STEPS, APEX, MIN_GAP_PX, GAP_MAX, GAP_MIN, GRAVITY, HB_X, JUMP_V, JUMP_PROFILE, PH, PLATFORM_LEVELS, PW, REACT_STEPS, SPEEDS, SPEED_MAX, SPIKE_H, SPIKE_HIT_H,
  SPIKE_HIT_W, SPIKE_W, WINDOW_STEPS, difficultyAt, jumpStats, maxGapAt, newBody, speedAt, stepBody, stepPx, takeoff, type Body, type Piece,
} from '../src/arcade/games/dash/physics.js';
import {Course, REST_PX, gapSpec, buildPieces, islandSpec, spikesSpec} from '../src/arcade/games/dash/course.js';
import {solve, solvePhases} from '../src/arcade/games/dash/solver.js';
import {DashWorld, METER_PX, SCORE_PX} from '../src/arcade/games/dash/world.js';
import {createRng} from '../src/arcade/rng.js';
import {passable} from './support/dashCheck.js';
import {playBot, replayableCourse} from './support/dashBot.js';

let ids = 0;
const piece = (kind: Piece['kind'], x: number, w: number, level = 0): Piece => ({id: ++ids, kind, x, w, level, unit: 1});
/** Run a body over `pieces` at the given speed from hitbox-left `start`; `presses` are step numbers at which to jump. */
function drive(pieces: Piece[], speed: number, start: number, steps: number, presses: number[] = []) {
  const body = newBody();
  let left = start;
  let landedY = -1;
  for (let step = 0; step < steps; step += 1) {
    if (presses.includes(step) && body.grounded) takeoff(body);
    left += speed / 60;
    const fate = stepBody(body, left, pieces);
    if (body.landed) landedY = Math.max(landedY, body.y);
    if (fate !== 'alive') return {fate, body, step, left, landedY};
  }
  return {fate: 'alive', body, step: steps, left, landedY};
}

test('jump arc: apex, airtime and reach at every speed come from the real profile', () => {
  assert.ok(Math.abs(APEX - (JUMP_V ** 2) / (2 * GRAVITY)) < 1);
  assert.ok(Math.abs(AIR_STEPS - (2 * JUMP_V / GRAVITY) * 60) <= 1.5);
  assert.equal(JUMP_PROFILE[0], 0);
  assert.equal(JUMP_PROFILE.at(-1), 0);
  assert.ok(APEX >= Math.max(...PLATFORM_LEVELS) + 1.5, 'the apex clears the highest platform with room');
  for (const speed of SPEEDS) {
    const stats = jumpStats(speed);
    assert.equal(stats.airSteps, AIR_STEPS);
    assert.equal(stats.reach, AIR_STEPS * speed / 60);
    const run = drive([], speed, 0, 200, [0]);
    assert.equal(run.fate, 'alive');
    assert.equal(run.body.grounded, true);
    // Touchdown happens exactly AIR_STEPS steps after takeoff, i.e. `reach` px later.
    const body = newBody(); takeoff(body);
    let left = 0; let n = 0;
    do { left += speed / 60; n += 1; stepBody(body, left, []); } while (!body.grounded);
    assert.equal(n, AIR_STEPS);
    assert.ok(Math.abs(left - stats.reach) < 1e-9);
  }
});

test('speed phases ramp monotonically to a cap, in quarter pixel steps', () => {
  let last = 0;
  for (let distance = 0; distance < 20000; distance += 7) {
    const speed = speedAt(distance);
    assert.ok(speed >= last);
    assert.ok(speed <= SPEED_MAX);
    assert.equal(stepPx(distance) * 4, Math.round(stepPx(distance) * 4));
    last = speed;
  }
  assert.equal(speedAt(0), SPEEDS[0]); assert.equal(speedAt(1e9), SPEED_MAX);
  assert.ok(difficultyAt(0) === 0 && difficultyAt(1e9) === 1);
});

test('platforms: landing on top is safe, the side is a wall, a corner within a pixel is forgiven', () => {
  const block = (level: number) => [piece('block', 100, 30, level)];
  // Running into a 4 px block from the ground is a wall.
  assert.equal(drive(block(4), 90, 0, 200).fate, 'wall');
  // Jumping in time lands on top and keeps running along it.
  let landedOn = false;
  for (let press = 0; press < 60; press += 1) {
    const run = drive(block(8), 90, 60, 80, [press]);
    if (run.landedY === 8) landedOn = true;
  }
  assert.ok(landedOn, 'some takeoff lands on a level 8 platform');
  // A wall taller than the apex cannot be climbed.
  for (let press = 0; press < 60; press += 1) assert.notEqual(drive(block(13), 90, 60, 80, [press]).landedY, 13);
  // Corner forgiveness: feet 1 px below the top lands, 1.5 px does not.
  const near: Body = {y: 3, vy: 0, grounded: true, landed: false, support: -1};
  assert.equal(stepBody(near, 100 - PW + 1, block(4)), 'alive');
  assert.equal(near.y, 4);
  const far: Body = {y: 2.5, vy: 0, grounded: true, landed: false, support: -1};
  assert.equal(stepBody(far, 100 - PW + 1, block(4)), 'wall');
});

test('spikes: the hitbox is smaller than the drawing (fair, slightly forgiving) and exact at its edges', () => {
  assert.ok(SPIKE_HIT_W < SPIKE_W && SPIKE_HIT_H < SPIKE_H);
  const spike = [piece('spike', 100, SPIKE_W)];
  const at = (left: number, y: number) => { const body: Body = {y, vy: 0, grounded: y === 0, landed: false, support: -1}; return stepBody(body, left, spike); };
  assert.equal(at(100 - PW + 0.5, 6), 'alive', 'above the tip');
  assert.equal(at(100 - PW + 0.5, 0), 'alive', 'touching only the drawn outer pixel');
  assert.equal(at(100 + 1 - PW + 0.5, 0), 'spike', 'overlapping the core');
  assert.equal(at(100 + 1 + SPIKE_HIT_W - 0.5, 0), 'spike');
  assert.equal(at(100 + 1 + SPIKE_HIT_W + 0.1, 0), 'alive');
  assert.equal(at(101, SPIKE_HIT_H + 0.2), 'alive', 'feet above the core clear it');
  assert.equal(at(101, SPIKE_HIT_H - 0.3), 'spike');
});

test('gaps: falling, crossing, and a gap narrower than the cat is no gap', () => {
  const gap = (w: number) => [piece('gap', 100, w)];
  const fall = drive(gap(20), 90, 60, 200);
  assert.ok(fall.fate === 'fall' || fall.fate === 'wall');
  assert.equal(drive(gap(4), 90, 60, 200).fate, 'alive');
  let crossed = false;
  for (let press = 0; press < 60; press += 1) if (drive(gap(20), 90, 60, 200, [press]).fate === 'alive') crossed = true;
  assert.ok(crossed);
  const tooWide = maxGapAt(90) + 20;
  for (let press = 0; press < 80; press += 1) assert.notEqual(drive(gap(tooWide), 90, 60, 200, [press]).fate, 'alive');
});

test('gap maths: widest gap has the declared window at every speed, GAP_MAX leaves margin at the cap', () => {
  assert.ok(GAP_MAX <= maxGapAt(SPEED_MAX) - 4);
  for (const speed of SPEEDS) {
    const from = SPEEDS.indexOf(speed) * 1800;
    const widest = maxGapAt(speed);
    const measure = (width: number) => {
      const pieces = [piece('gap', from + 300, width)];
      const tables = solvePhases(pieces, from + 100, from + 300 + width + 200);
      return tables !== undefined;
    };
    assert.ok(measure(widest), `${speed}: gap ${widest} is robust`);
    assert.ok(!measure(widest + 6), `${speed}: gap ${widest + 6} is not`);
    assert.ok(measure(Math.min(GAP_MAX, widest)));
    assert.ok(GAP_MIN > PW);
  }
});

test('patterns: every template is proven at every phase of every speed, with a window of at least WINDOW_STEPS', () => {
  const specs = [spikesSpec(1, 0), spikesSpec(2, 4), gapSpec(14), islandSpec(14, 40, 4, 14)];
  for (const speed of SPEEDS) {
    const from = SPEEDS.indexOf(speed) * 1800;
    for (const spec of specs) {
      const pieces = buildPieces(spec, from + 400, 1, () => ++ids);
      const tables = solvePhases(pieces, from + 100, from + 400 + spec.length + 200);
      if (!tables) continue;
      for (const table of tables) assert.equal(table.ok[0], 1);
    }
  }
  // A platform hop needs the apex to clear the platform and the landing spot to exist.
  const island = buildPieces(islandSpec(14, 40, 6, 14), 1000, 1, () => ++ids);
  assert.ok(solve(island, 900, 1300).ok[0] === 1);
  const tooHigh = buildPieces(islandSpec(14, 40, 12, 14), 1000, 1, () => ++ids);
  assert.ok(solve(tooHigh, 900, 1300).ok[0] === 0);
});

test('generator: thousands of pieces across seeds and speeds are placed as the proof requires', () => {
  let pieces = 0;
  let units = 0;
  const kinds = new Set<string>();
  for (const from of [0, 1800, 3600, 5400, 9000]) {
    for (let seed = 1; seed <= 4; seed += 1) {
      const course = new Course(createRng(seed * 31 + from).fork('course'), {from});
      course.ensure(from + 4500);
      units += course.units.length; pieces += course.pieces.length;
      let lastEnd = -Infinity;
      for (const unit of course.units) {
        kinds.add(unit.kind);
        assert.ok(Number.isInteger(unit.x), 'pieces sit on whole pixels');
        assert.ok(unit.x - lastEnd >= MIN_GAP_PX, `units never closer than ${MIN_GAP_PX}`);
        lastEnd = unit.end;
      }
      for (const p of course.pieces) {
        if (p.kind === 'gap') assert.ok(p.w >= GAP_MIN && p.w <= GAP_MAX + 2 * 40 + 40);
        if (p.kind === 'block') assert.ok(p.level === 0 || p.level <= APEX - 1.5);
      }
      for (let index = 1; index < course.pieces.length; index += 1) assert.ok(course.pieces[index - 1]!.x <= course.pieces[index]!.x);
      // Whole course: robust at every phase (window >= WINDOW_STEPS everywhere), and passable by an independent search.
      const first = course.units[0]!;
      assert.ok(first.x >= from + 100);
      const tables = solvePhases(course.pieces, from, course.units.at(-1)!.end + 250);
      assert.ok(tables !== undefined, `seed ${seed} from ${from} is robust`);
      assert.ok(passable(course.pieces, from, course.units.at(-1)!.end + 100).ok);
    }
  }
  assert.ok(pieces > 1000, `${pieces} pieces`);
  assert.ok(units > 400);
  assert.deepEqual([...kinds].sort(), ['block', 'gap', 'island', 'perch', 'pole', 'spikes', 'stairs']);
  assert.ok(REST_PX > 0 && REACT_STEPS > 0 && WINDOW_STEPS > 0 && HB_X === 1);
});

test('rests: the course goes flat for a long stretch every few units, so the proof restarts there', () => {
  const course = new Course(createRng(5).fork('course'), {from: 0});
  course.ensure(6000);
  const rests = course.units.filter(unit => unit.afterRest);
  assert.ok(rests.length >= 5);
  for (const unit of rests) {
    const before = course.units[course.units.indexOf(unit) - 1]!;
    assert.ok(unit.x - before.end >= REST_PX);
  }
});

test('simulated players on the real world: windows early, middle, late and random survive 20000 steps at the cap; idling and spamming die', () => {
  for (const [seed, from] of [[1, 5400], [2, 5400], [3, 0]] as const) {
    const course = replayableCourse(seed, from, from + 20000 * 1.8 + 1500);
    for (const timing of ['early', 'mid', 'late', 'random'] as const) {
      const result = playBot(seed, 20000, timing, {from, course});
      assert.equal(result.survived, true, `${seed}/${from}/${timing}: ${JSON.stringify(result)}`);
      assert.ok(result.jumps > 100);
    }
    assert.equal(playBot(seed, 20000, 'idle', {from, course}).survived, false);
    assert.equal(playBot(seed, 20000, 'spam', {from, course}).survived, false);
  }
});

test('world: scoring, determinism, jump buffer and the beat', () => {
  const make = (seed: number) => new DashWorld(createRng(seed).fork('course'));
  const a = make(9); const b = make(9);
  for (let step = 0; step < 600; step += 1) { if (step % 37 === 0) { a.jump(); b.jump(); } a.step(); b.step(); assert.equal(a.hash(), b.hash()); }
  assert.notEqual(make(10).hash(), make(11).hash());
  const world = make(3);
  world.course.pieces.length = 0;
  (world.course as unknown as {ensure(x: number): void}).ensure = () => {};
  for (let i = 0; i < 100; i += 1) world.step();
  assert.equal(world.score, Math.floor(world.distance / SCORE_PX));
  assert.equal(world.meters, Math.floor(world.distance / METER_PX));
  // A press in the air is remembered and jumps on touchdown; a press too early is forgotten.
  const hop = make(3); hop.course.pieces.length = 0; (hop.course as unknown as {ensure(x: number): void}).ensure = () => {};
  hop.jump();
  for (let i = 0; i < AIR_STEPS - 3; i += 1) hop.step();
  assert.equal(hop.jump(), false);
  for (let i = 0; i < 8; i += 1) hop.step();
  assert.equal(hop.airborne, true, 'buffered press jumped again on landing');
  assert.ok(hop.beat >= 0 && hop.beat < 1);
});
