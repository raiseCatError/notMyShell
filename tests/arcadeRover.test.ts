import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {AIR_DAMPING, CRASH_MS, GRAVITY, INERTIA, MAX_OMEGA, MAX_PEN, MAX_SLOPE, MU, RoverState, SPEED_CAP, STRANDED_MS, TILT_AIR, TILT_MS, Terrain, WHEEL_R, WHEEL_X, WHEEL_Y, wrapAngle, type TerrainLike} from '../src/arcade/games/rover/logic.js';
import {roverGame} from '../src/arcade/games/rover/index.js';
import {displayWidth} from '../src/util/text.js';

const STEP = 1000 / 60;
function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 9, rng: createRng(9), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
const flat: TerrainLike = {height: () => 0, slope: () => 0};
/** A constant incline: `grade` is height gained per unit x (y is down, so heights fall as x grows). */
const incline = (grade: number): TerrainLike => ({height: x => -grade * x, slope: () => -grade});
/** Flat to x = 200, then the ground falls away at a slope of 0.7. */
const lip: TerrainLike = {height: x => (x < 200 ? 0 : 0.7 * (x - 200)), slope: x => (x < 200 ? 0 : 0.7)};
const run = (s: RoverState, seconds: number, each?: (frame: number) => void) => { for (let i = 0; i < Math.round(seconds * 60) && !s.over; i += 1) { each?.(i); s.step(STEP); } };
/** A rover high above flat ground, so nothing touches for a long time. */
const high = (): RoverState => { const s = new RoverState(1, flat); s.y = -5000; s.py = s.y; return s; };

test('terrain: a pure function of x and the seed, flat at the start, smooth, continuous and within the slope bound', () => {
  const a = new Terrain(5), b = new Terrain(5), c = new Terrain(6);
  assert.equal(a.height(500), b.height(500));
  assert.notEqual(a.height(500), c.height(500));
  assert.equal(a.height(10), 0);
  assert.equal(a.height(30), 0);
  // The same values whatever order they are asked in.
  const late = new Terrain(5);
  const lateFirst = late.height(9000);
  assert.equal(lateFirst, a.height(9000));
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const t = new Terrain(seed);
    let max = 0;
    for (let x = 0; x < 10000; x += 0.25) {
      max = Math.max(max, Math.abs(t.slope(x)));
      assert.ok(Math.abs(t.height(x + 0.25) - t.height(x)) <= (MAX_SLOPE + 0.02) * 0.25, `jump at ${x} seed ${seed}`);
      assert.ok(Math.abs(t.slope(x + 0.25) - t.slope(x)) < 0.12, `kink at ${x} seed ${seed}`);
      assert.ok(Number.isFinite(t.height(x)));
    }
    assert.ok(max <= MAX_SLOPE + 1e-9 && max < MU, `max slope ${max} seed ${seed}`);
  }
});

test('terrain: varied profiles over 2000 m (valleys, rollers, plateaus, steep climbs, jump crests, bumps) that grow with distance', () => {
  const t = new Terrain(11);
  const length = 10000; // 2000 m at 0.2 m per unit
  let flatRuns = 0, run = 0, steep = 0, steepOn = false, crests = 0, valleys = 0, bumps = 0;
  const slopes: number[] = [];
  let lastExtreme = 0, lastDir = 0;
  const lows: number[] = [];
  for (let x = 40; x < length; x += 1) {
    const s = t.slope(x);
    slopes.push(s);
    if (Math.abs(s) < 0.03) run += 1; else { if (run >= 15) flatRuns += 1; run = 0; }
    if (Math.abs(s) > 0.45 && !steepOn) { steepOn = true; steep += 1; } else if (Math.abs(s) < 0.3) steepOn = false;
    if (s < -0.4 && t.slope(x + 10) > 0.35) crests += 1;
    const dir = Math.sign(s) || lastDir;
    if (dir !== lastDir && lastDir !== 0) {
      const h = t.height(x);
      if (dir > 0) { lows.push(h); if (Math.abs(h - lastExtreme) >= 8 && x - lows.length * 0 > 0) valleys += 1; }
      if (Math.abs(h - lastExtreme) < 2.5 && Math.abs(h - lastExtreme) > 0.4) bumps += 1;
      lastExtreme = h;
    }
    lastDir = dir;
  }
  assert.ok(flatRuns >= 8, `plateaus ${flatRuns}`);
  assert.ok(steep >= 15, `steep climbs ${steep}`);
  assert.ok(crests >= 3, `jump crests ${crests}`);
  assert.ok(valleys >= 10, `valleys ${valleys}`);
  assert.ok(bumps >= 10, `bumps ${bumps}`);
  const mean = (from: number, to: number) => slopes.slice(from, to).reduce((sum, v) => sum + Math.abs(v), 0) / (to - from);
  assert.ok(mean(5000, 9000) > mean(0, 2000) * 1.15, `later terrain is steeper: ${mean(0, 2000)} vs ${mean(5000, 9000)}`);
  // Curvature takes many distinct values (not one repeated sine).
  const curves = new Set<number>();
  for (let x = 100; x < length; x += 10) curves.add(Math.round((t.slope(x + 2) - t.slope(x - 2)) * 40));
  assert.ok(curves.size >= 12, `curvature classes ${curves.size}`);
});

test('wheel contact: the rover settles on flat ground, wheels equally compressed, suspension working, no spinning', () => {
  const s = new RoverState(1);
  run(s, 3);
  assert.ok(!s.over);
  assert.ok(s.sink[0] > 0.5 && s.sink[0] < 1.6 && Math.abs(s.sink[0] - s.sink[1]) < 0.05, `sink ${s.sink}`);
  assert.ok(s.compression[0] > 0.5 && s.compression[0] < 1.6);
  assert.ok(Math.abs(s.angle) < 0.01 && s.speed < 0.2);
  // The drawn wheel rides above full extension by the compression, and its rim touches the ground.
  const wheel = s.wheelCenter(0);
  assert.ok(Math.abs(wheel.y + WHEEL_R - s.terrain.height(wheel.x)) < 1.0);
});

test('physics: dropped from a height at speed the wheels never tunnel into the ground and speed stays capped', () => {
  for (const [drop, speed] of [[30, 0], [60, 40], [120, 70]] as const) {
    const s = new RoverState(2);
    s.x = 200; s.px = 200; s.y = s.terrain.height(200) - drop; s.vy = speed;
    for (let i = 0; i < 360 && !s.over; i += 1) {
      s.step(STEP);
      assert.ok(s.speed <= SPEED_CAP + 1e-6, 'speed capped');
      for (const side of [0, 1] as const) {
        assert.ok(s.sink[side] <= MAX_PEN + 1e-6, `sink ${s.sink[side]}`);
        const wheel = s.wheelCenter(side);
        assert.ok(wheel.y < s.terrain.height(wheel.x) - 0.5, 'wheel center stays above the ground');
      }
    }
  }
});

test('physics: with no input the rover never gains energy', () => {
  const s = new RoverState(3);
  s.x = 300; s.y = s.terrain.height(300) - 14; s.vx = 20;
  const energy = () => 0.5 * s.speed ** 2 + 0.5 * INERTIA * s.omega ** 2 - GRAVITY * s.y;
  const start = energy();
  for (let i = 0; i < 600 && !s.over; i += 1) { s.step(STEP); assert.ok(energy() <= start + 40, `energy ${energy()} vs ${start}`); }
});

test('airborne: angular momentum is conserved without torque (apart from a little damping)', () => {
  const s = high();
  s.omega = 3;
  run(s, 0.5);
  const expected = 3 * Math.exp(-AIR_DAMPING * 0.5);
  assert.ok(Math.abs(s.omega - expected) < 0.05, `omega ${s.omega} vs ${expected}`);
  assert.ok(Math.abs(s.angle - 3 * 0.5) < 0.1, `angle ${s.angle}`);
  assert.ok(!s.grounded);
  // No spin stays no spin: gravity alone does not rotate a free body.
  const still = high();
  run(still, 1);
  assert.ok(Math.abs(still.omega) < 1e-9 && Math.abs(still.angle) < 1e-9);
});

test('airborne: one tilt press is a bounded torque pulse, quick presses chain up to a cap, direction decides the spin', () => {
  const one = high();
  one.tilt(-1);
  run(one, 0.6);
  const pulse = (TILT_AIR / INERTIA) * (TILT_MS / 1000);
  assert.ok(one.omega < -pulse * 0.85 && one.omega > -pulse * 1.05, `one press ${one.omega} vs ${-pulse}`);
  assert.ok(one.angle < -0.2);
  const chain = high();
  for (let i = 0; i < 3; i += 1) chain.tilt(1);
  run(chain, 0.7);
  assert.ok(chain.omega > pulse * 2.5 && chain.omega < pulse * 3.1, `chained ${chain.omega}`);
  const spam = high();
  for (let i = 0; i < 20; i += 1) spam.tilt(1);
  run(spam, 0.7);
  assert.ok(spam.omega < pulse * 3.1 && spam.omega <= MAX_OMEGA, `bounded ${spam.omega}`);
  // Opposite presses restart the pulse rather than adding to it.
  const flip = high();
  for (let i = 0; i < 3; i += 1) flip.tilt(1);
  flip.tilt(-1);
  run(flip, 0.7);
  assert.ok(flip.omega < 0 && flip.omega > -pulse * 1.1);
});

test('takeoff: leaving a crest under power pitches the rover from the contact torques, then it coasts at constant spin', () => {
  // Fall off the lip under power: airborne with a spin that came from gravity and the wheels, not from any key.
  let airFrames = 0;
  const probe = new RoverState(1, lip);
  probe.x = 160; probe.px = 160; probe.y = -4; probe.vx = 42;
  let omegaAtStart = 0, angleAtStart = 0;
  for (let i = 0; i < 90 && !probe.over; i += 1) {
    probe.drive(1);
    probe.step(STEP);
    if (!probe.grounded && probe.x > 200) {
      airFrames += 1;
      if (airFrames === 4) { omegaAtStart = probe.omega; angleAtStart = probe.angle; }
      if (airFrames === 14) {
        assert.ok(Math.abs(probe.omega - omegaAtStart) < Math.abs(omegaAtStart) * 0.12 + 0.05, `spin changed in the air: ${omegaAtStart} -> ${probe.omega}`);
        assert.ok(Math.abs(probe.angle - angleAtStart) > 0.02, 'it keeps rotating');
      }
    }
  }
  assert.ok(airFrames > 14, `air frames ${airFrames}`);
});

test('upside down: head or roof on the ground starts the crash window; the run ends after it, not before', () => {
  const s = new RoverState(1, flat);
  s.angle = Math.PI; s.pangle = Math.PI; s.y = -5.6;
  run(s, (CRASH_MS - 300) / 1000);
  assert.ok(!s.over, 'still inside the window');
  assert.ok(s.upsideDown && s.danger > 0.2, `danger ${s.danger}`);
  run(s, 1.5);
  assert.ok(s.over && s.reason === 'flip');
  assert.ok(s.elapsedMs > CRASH_MS * 0.5 && s.elapsedMs < 2500, `crashed at ${s.elapsedMs} ms`);
  const events = s.events.filter(event => event.kind === 'crash');
  assert.equal(events.length, 1);
});

test('upside down: a rover that rights itself within the window survives and the window heals', () => {
  const s = new RoverState(1, flat);
  s.angle = Math.PI; s.pangle = Math.PI; s.y = -5.6;
  run(s, 0.4);
  assert.ok(!s.over && s.danger > 0.3);
  // Righted (the way a roll-back would leave it): upright again and rolling on.
  s.angle = 0; s.pangle = 0; s.omega = 0; s.y = -6; s.vy = 0; s.vx = 0;
  run(s, 2);
  assert.ok(!s.over, 'recovered');
  assert.equal(s.danger, 0);
  assert.ok(!s.upsideDown);
});

test('upside down: a roll that carries the head over the ground but keeps turning is not a crash', () => {
  const s = new RoverState(1, flat);
  s.angle = 2.3; s.pangle = 2.3; s.omega = 4.5; s.y = -4; s.vx = 5;
  run(s, 3);
  assert.ok(!s.over || s.reason !== 'flip' || s.elapsedMs > 800, `ended at ${s.elapsedMs}`);
});

test('traction: slopes within the friction limit can be climbed, slopes beyond it cannot', () => {
  const climb = (grade: number) => {
    const s = new RoverState(1, incline(grade));
    const angle = -Math.atan(grade);
    s.x = 200; s.px = 200; s.angle = angle; s.pangle = angle;
    s.y = -grade * 200 - (WHEEL_Y + WHEEL_R - 1) / Math.cos(angle) + 0.1;
    run(s, 10, () => s.drive(1));
    return s;
  };
  // From a standstill on the slope the gas wins against gravity (after any slide back while the wheels bite)...
  for (const grade of [0.3, 0.5, 0.7]) {
    const s = climb(grade);
    assert.ok(!s.over && s.vx > 3, `grade ${grade}: speed uphill ${s.vx}`);
  }
  // ...but beyond the friction limit the tires cannot push the rover up however long the gas is held.
  for (const grade of [1.3, 1.6]) {
    const s = climb(grade);
    assert.ok(s.x < 200 && s.vx < 3, `grade ${grade} should be beyond the grip: x ${s.x} speed ${s.vx}`);
  }
  assert.ok(MAX_SLOPE < MU, 'every slope in the terrain is inside the friction limit');
});

test('traction: the brake slows the rover on the flat but cannot hold it against gravity beyond the grip', () => {
  const s = new RoverState(1, flat);
  run(s, 3, () => s.drive(1));
  const fast = s.vx;
  run(s, 1, () => s.drive(-1));
  assert.ok(s.vx < fast * 0.5, `braked ${fast} -> ${s.vx}`);
  const steep = new RoverState(1, incline(1.6));
  const angle = -Math.atan(1.6);
  steep.x = 200; steep.px = 200; steep.angle = angle; steep.pangle = angle; steep.y = -1.6 * 200 - 5;
  run(steep, 1.5);
  const start = steep.x;
  run(steep, 2, () => steep.drive(-1));
  assert.ok(start - steep.x > 3 || steep.over, `slides down despite braking: ${start} -> ${steep.x}`);
});

test('flips: each full net turn of the simulated angle counts once, in either direction; partial turns do not', () => {
  for (const [omega, turns] of [[5, 1], [-5, 1], [9, 2], [3, 0]] as const) {
    const s = high();
    s.omega = omega;
    // Free spin (a hair of damping): the flips are counted from the simulated angle itself.
    run(s, turns === 0 ? 1.5 : (Math.PI * 2 * turns + 0.3) / (Math.abs(omega) * 0.92));
    assert.equal(s.flips, turns, `omega ${omega}: angle ${s.angle}`);
    assert.equal(s.score, s.flips * 25 + s.distance);
  }
  const s = high();
  s.omega = 4;
  run(s, 3);
  assert.ok(s.flips >= 1 && Math.abs(s.angle) > Math.PI * 2);
  assert.ok(s.events.some(event => event.kind === 'flip'));
});

test('flips: quick tilt presses in the air build enough spin for a flip within a second and a half of airtime', () => {
  const s = high();
  run(s, 1.5, () => s.tilt(-1));
  assert.ok(s.flips >= 1 && s.angle < -Math.PI * 2, `flips ${s.flips} angle ${s.angle}`);
  assert.ok(s.score >= 25);
});

/**
 * A human driver on the real jumps: gas renewed every 100 ms, and in the air (after a 150 ms reaction) one nose-down tap every
 * 1000/hz ms until a flip is counted, then taps that stop the spin and level the rover. Returns the run once the flip lands.
 */
function tappingDriver(seed: number, hz: number, tap: boolean, maxSeconds = 60) {
  const s = new RoverState(seed);
  let airMs = 0, lastTap = -1e9, flippedAt = -1;
  for (let frame = 0; frame < 60 * maxSeconds && !s.over; frame += 1) {
    const ms = frame * STEP;
    if (frame % 6 === 0) s.drive(1);
    airMs = s.grounded ? 0 : airMs + STEP;
    if (tap && airMs >= 150 && ms - lastTap >= 1000 / hz) {
      lastTap = ms;
      const a = wrapAngle(s.angle);
      if (s.flips === 0) s.tilt(1); else if (s.omega > 1 || a > 0.3) s.tilt(-1); else if (a < -0.3) s.tilt(1);
    }
    s.step(STEP);
    if (s.flips >= 1 && flippedAt < 0) flippedAt = frame;
    if (flippedAt >= 0 && frame - flippedAt > 60 * 4) break;
  }
  return {s, flipped: flippedAt >= 0};
}

test('flips: a driver tapping 6 to 8 times a second in the air flips off the real jumps and lives; with no taps the same runs never flip', () => {
  for (const hz of [6, 7, 8]) {
    let flipped = 0, alive = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const run = tappingDriver(seed, hz, true);
      if (run.flipped) { flipped += 1; if (!run.s.over) alive += 1; }
    }
    assert.ok(flipped >= 10, `${hz} taps/s: only ${flipped} of 20 seeds flipped`);
    assert.ok(alive >= flipped - 1, `${hz} taps/s: ${flipped} flipped but only ${alive} survived the landing`);
  }
  // The same seeds with the gas alone: the flips are the driver's doing, not the terrain's.
  for (let seed = 1; seed <= 20; seed += 1) assert.equal(tappingDriver(seed, 7, false, 25).s.flips, 0, `seed ${seed} flipped without any tilt`);
});

test('drive: the gas speeds up the rover, the brake slows it, tilt turns it in the air', () => {
  const s = new RoverState(1);
  for (let i = 0; i < 90; i += 1) { s.drive(1); s.step(STEP); }
  assert.ok(s.vx > 15, `speed ${s.vx}`);
  const fast = s.vx;
  for (let i = 0; i < 60; i += 1) { s.drive(-1); s.step(STEP); }
  assert.ok(s.vx < fast * 0.5, 'braked');
  const air = new RoverState(1);
  air.y = -40;
  air.tilt(-1);
  for (let i = 0; i < 30; i += 1) air.step(STEP);
  assert.ok(air.angle < -0.05 && !air.grounded, `nose up in the air: ${air.angle}`);
});

test('ground tilt: pressing tilt on the ground pitches the rover against its springs and it settles back', () => {
  const s = new RoverState(1, flat);
  run(s, 2);
  let peak = 0;
  s.tilt(-1);
  run(s, 0.5, () => { peak = Math.min(peak, s.angle); });
  assert.ok(peak < -0.04, `pitched ${peak}`);
  run(s, 3);
  assert.ok(Math.abs(s.angle) < 0.03, 'settled');
});

test('fuel: drains faster under gas, a can refills it, an empty tank that stalls ends the run', () => {
  const s = new RoverState(1);
  for (let i = 0; i < 60; i += 1) s.step(STEP);
  const idle = 100 - s.fuel;
  const g = new RoverState(1);
  for (let i = 0; i < 60; i += 1) { g.drive(1); g.step(STEP); }
  assert.ok(100 - g.fuel > idle * 2);
  const pick = new RoverState(1);
  pick.fuel = 10;
  const can = pick.pickups[0]!;
  pick.x = can.x; pick.px = can.x; pick.y = can.y; pick.vx = 0; pick.vy = 0;
  pick.step(STEP);
  assert.ok(pick.fuel > 40 && pick.collected === 1);
  const dry = new RoverState(1);
  dry.fuel = 0;
  for (let i = 0; i < 400 && !dry.over; i += 1) dry.step(STEP);
  assert.ok(dry.over && dry.reason === 'fuel');
});

test('stranded: a rover that stops and is left alone ends the run instead of idling forever', () => {
  const s = new RoverState(4);
  run(s, STRANDED_MS / 1000 + 4);
  assert.ok(s.over && s.reason === 'stuck', `${s.reason} at ${s.elapsedMs}`);
  assert.ok(s.elapsedMs >= STRANDED_MS);
});

test('determinism: same seed and inputs give the same run, at any frame split', () => {
  const play = (split: number) => {
    const s = new RoverState(7);
    for (let i = 0; i < 60 * 12 && !s.over; i += 1) {
      if (i % 20 === 0) s.drive(1);
      if (i % 90 === 40) s.tilt(-1);
      for (let k = 0; k < split; k += 1) s.step(STEP / split);
    }
    return s;
  };
  const a = play(1), b = play(1), c = play(2), d = play(4);
  assert.equal(a.x, b.x);
  assert.equal(a.angle, b.angle);
  for (const other of [c, d]) {
    assert.ok(Math.abs(a.x - other.x) < 0.01 && Math.abs(a.y - other.y) < 0.01 && Math.abs(a.angle - other.angle) < 0.01, `split drift ${a.x} ${other.x}`);
    assert.equal(a.distance, other.distance);
  }
  assert.notEqual(new RoverState(8).terrain.height(400), new RoverState(7).terrain.height(400));
});

test('long runs over many seeds with scripted drivers stay finite and bounded, and always end or keep moving', () => {
  const drivers: Record<string, (s: RoverState, frame: number) => void> = {
    gas: s => s.drive(1),
    leveler: s => { s.drive(1); if (!s.grounded) { const a = wrapAngle(s.angle); if (a > 0.2 && s.omega > -1) s.tilt(-1); else if (a < -0.2 && s.omega < 1) s.tilt(1); } },
    flipper: s => { s.drive(1); if (!s.grounded) s.tilt(-1); },
    erratic: (s, frame) => { if (frame % 40 < 25) s.drive(1); else if (frame % 40 < 30) s.drive(-1); if (frame % 7 === 0) s.tilt(frame % 14 === 0 ? 1 : -1); },
    idle: () => {},
  };
  for (const [name, driver] of Object.entries(drivers)) {
    for (let seed = 1; seed <= 10; seed += 1) {
      const s = new RoverState(seed);
      let stillMs = 0, frame = 0;
      for (; frame < 60 * 100 && !s.over; frame += 1) {
        driver(s, frame);
        s.step(STEP);
        if (frame % 30 === 0) {
          for (const value of [s.x, s.y, s.angle, s.vx, s.vy, s.omega, s.fuel]) assert.ok(Number.isFinite(value), `${name} ${seed}: NaN at ${frame}`);
          assert.ok(s.speed <= SPEED_CAP + 1e-6 && Math.abs(s.omega) <= MAX_OMEGA + 1e-6, `${name} ${seed}: speed ${s.speed} omega ${s.omega}`);
          assert.ok(s.y < s.terrain.height(s.x) + 3, `${name} ${seed}: under the ground`);
        }
        stillMs = s.speed < 0.6 && Math.abs(s.omega) < 0.3 ? stillMs + STEP : 0;
        assert.ok(stillMs < STRANDED_MS + 1000, `${name} ${seed}: stuck without ending at ${frame}`);
      }
    }
  }
});

test('game: keys start and steer, a finished run is saved once with a record, dispose cleans up', () => {
  const record = memory();
  const game = roverGame.create(context(record));
  assert.equal(game.status, 'ready');
  assert.equal(game.key({kind: 'text', value: 'x'}), 'ignored');
  assert.equal(game.key({kind: 'right'}), 'handled');
  assert.equal(game.status, 'playing');
  for (const key of [{kind: 'left'}, {kind: 'up'}, {kind: 'down'}, {kind: 'text', value: 'd'}, {kind: 'text', value: 'a'}] as const) assert.equal(game.key(key), 'handled');
  // Drive for a while, then let go: the rover coasts to a stop and is stranded, which ends and saves the run.
  for (let i = 0; i < 60 * 10; i += 1) { game.key({kind: 'right'}); game.step(STEP); game.animate(STEP); }
  for (let i = 0; i < 60 * 120 && game.status === 'playing'; i += 1) { game.step(STEP); game.animate(STEP); }
  assert.equal(game.status, 'over');
  assert.ok(game.result && game.result.record && game.result.score > 0);
  assert.equal(record.raw().plays, 1);
  assert.equal(record.raw().best, game.result.score);
  assert.equal(game.key({kind: 'right'}), 'ignored');
  // A second, worse run keeps the best and is not a record.
  const best = record.raw().best as number;
  const second = roverGame.create(context(record, {seed: 9}));
  second.key({kind: 'left'});
  for (let i = 0; i < 60 * 120 && second.status === 'playing'; i += 1) second.step(STEP);
  assert.equal(second.result?.record, false);
  assert.equal(record.raw().best, Math.max(best, second.result!.score));
  game.dispose();
  second.dispose();
});

test('render: every size draws inside its bounds in color, without color, with safe glyphs and with reduced motion', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) {
    for (const mode of ['truecolor', 'none', 'reduced'] as const) {
      const game = roverGame.create(context(memory(), {
        size: {columns, rows}, seed: 3, rng: createRng(3),
        color: mode === 'none' ? 'none' : 'truecolor', safeGlyphs: mode === 'none',
        motion: mode === 'reduced' ? {reduced: true, effects: 'off'} : {reduced: false, effects: 'normal'},
      }));
      const check = (label: string) => {
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0.5, arcadePalette());
        const lines = canvas.plain();
        assert.equal(lines.length, rows);
        for (const line of lines) assert.ok(displayWidth(line) <= columns, `${mode} ${columns}x${rows} ${label}: ${line}`);
        return lines;
      };
      assert.ok(check('ready').join('\n').includes('Rover'));
      for (let i = 0; i < 100; i += 1) { game.key({kind: 'right'}); if (i % 9 === 0) game.key({kind: 'up'}); game.step(STEP); game.animate(STEP); }
      const playing = check('playing');
      if (mode === 'none') assert.match(playing.join('\n'), /Fuel/);
      for (let i = 0; i < 60 * 150 && game.status === 'playing'; i += 1) { if (i < 60 * 40) game.key({kind: 'right'}); game.step(STEP); game.animate(STEP); check('driving');  if (i > 60 * 40 && i % 600 === 0) check('coasting'); }
      assert.equal(game.status, 'over');
      check('over');
      game.dispose();
    }
  }
  // A crash window banner draws inside bounds too.
  for (const [columns, rows] of [[28, 12], [100, 34]] as const) {
    const game = roverGame.create(context(memory(), {size: {columns, rows}}));
    game.key({kind: 'right'});
    for (let i = 0; i < 20; i += 1) game.step(STEP);
    const canvas = new Canvas(columns, rows);
    game.render(canvas, 0, arcadePalette());
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
  }
  const preview = new Canvas(30, 6);
  roverGame.preview(preview, 3, arcadePalette());
});

test('render: a narrow screen never shows a clipped "Fuel" in the title row, and the crash-window banner keeps its meter', () => {
  const game = roverGame.create(context(memory(), {size: {columns: 28, rows: 12}}));
  game.key({kind: 'right'});
  const state = (game as unknown as {state: RoverState}).state;
  for (let i = 0; i < 20; i += 1) game.step(STEP);
  const canvas = new Canvas(28, 12);
  game.render(canvas, 0, arcadePalette());
  assert.ok(!canvas.plain()[0]!.includes('…') && !/Fuel/.test(canvas.plain()[0]!), canvas.plain()[0]);
  // Upside down on the ground: the banner shows the danger meter even when "Roll back" does not fit.
  state.angle = Math.PI; state.omega = 0; state.vx = 0;
  for (let i = 0; i < 30 && state.danger < 0.2; i += 1) game.step(STEP);
  assert.ok(state.danger > 0, 'the crash window started');
  game.render(canvas, 0, arcadePalette());
  assert.ok(canvas.plain().some(line => /DOWN! [#-]{5}/.test(line)), canvas.plain().join('\n'));
  const wide = new Canvas(100, 34);
  const big = roverGame.create(context(memory()));
  big.key({kind: 'right'});
  for (let i = 0; i < 20; i += 1) big.step(STEP);
  big.render(wide, 0, arcadePalette());
  assert.match(wide.plain()[0]!, /Fuel \d+%/);
});
