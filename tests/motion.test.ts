import assert from 'node:assert/strict';
import test from 'node:test';
import {MOTION_PROFILES, sampleMotion, wrappedPhase, type MotionProfile, type MotionState} from '../src/motion/motion.js';
import {shimmerIntensity} from '../src/status/shimmer.js';

const STILL = {reduced: false};

test('every profile stays within 0..1 for any time and cell', () => {
  for (const [state, profile] of Object.entries(MOTION_PROFILES) as Array<[MotionState, MotionProfile]>) {
    for (let time = -500; time < 5000; time += 37) {
      for (const cell of [0, 3, 11, 40]) {
        const value = sampleMotion(profile, time, cell, STILL);
        assert.ok(value >= 0 && value <= 1, `${state} t=${time} cell=${cell} -> ${value}`);
      }
    }
  }
});

test('breathing is symmetric and uniform across cells', () => {
  const waiting = MOTION_PROFILES.waiting;
  const half = waiting.cycleMs / 2;
  assert.equal(sampleMotion(waiting, 0, 0, STILL), 1);
  assert.ok(Math.abs(sampleMotion(waiting, half, 0, STILL)) < 1e-9);
  assert.ok(Math.abs(sampleMotion(waiting, 400, 0, STILL) - sampleMotion(waiting, waiting.cycleMs - 400, 0, STILL)) < 1e-9);
  assert.equal(sampleMotion(waiting, 700, 0, STILL), sampleMotion(waiting, 700, 25, STILL));
});

test('traveling shimmer moves its crest across cells over time', () => {
  const crest = (time: number) => {
    let best = 0;
    for (let cell = 0; cell < 12; cell += 1) if (sampleMotion(MOTION_PROFILES.processing, time, cell, STILL) > sampleMotion(MOTION_PROFILES.processing, time, best, STILL)) best = cell;
    return best;
  };
  assert.ok(crest(0) !== crest(600));
});

test('comet rises slowly and falls fast; tail rises fast and decays slowly', () => {
  const comet: MotionProfile = {shape: 'comet', spread: 'uniform', cycleMs: 1000, repeat: true};
  const peak = sampleMotion(comet, 800, 0, STILL);
  assert.equal(peak, 1);
  assert.ok(sampleMotion(comet, 400, 0, STILL) < peak && sampleMotion(comet, 900, 0, STILL) < peak);
  assert.ok(sampleMotion(comet, 900, 0, STILL) - sampleMotion(comet, 1000 - 1, 0, STILL) > 0.4, 'falls within the last 20%');
  const tail = MOTION_PROFILES.completion;
  assert.equal(Math.round(sampleMotion(tail, 0.15 * tail.cycleMs, 0, STILL) * 1000), 1000);
  assert.ok(sampleMotion(tail, 0.5 * tail.cycleMs, 0, STILL) > 0.5, 'long tail is still lit at half time');
});

test('one-shot profiles settle at rest and do not repeat', () => {
  for (const state of ['transition', 'completion', 'failure'] as const) {
    const profile = MOTION_PROFILES[state];
    assert.equal(sampleMotion(profile, 0, 0, STILL), 0);
    assert.equal(sampleMotion(profile, profile.cycleMs, 0, STILL), 0);
    assert.equal(sampleMotion(profile, profile.cycleMs * 3.3, 0, STILL), 0);
    assert.equal(sampleMotion(profile, -10, 0, STILL), 0);
  }
  const pulse = MOTION_PROFILES.failure;
  assert.ok(sampleMotion(pulse, pulse.cycleMs * 0.25, 0, STILL) > 0.95);
});

test('reduced motion holds every profile still and is deterministic', () => {
  for (const profile of Object.values(MOTION_PROFILES)) {
    const first = sampleMotion(profile, 0, 4, {reduced: true});
    for (const time of [1, 250, 999, 12345]) assert.equal(sampleMotion(profile, time, 4, {reduced: true}), first);
  }
  const saved = process.env.NMSH_REDUCED_MOTION;
  try {
    process.env.NMSH_REDUCED_MOTION = '1';
    assert.equal(shimmerIntensity(777, 3, 10, false), shimmerIntensity(12345, 3, 10, false));
  } finally {
    if (saved === undefined) delete process.env.NMSH_REDUCED_MOTION; else process.env.NMSH_REDUCED_MOTION = saved;
  }
});

test('phase wraps and the shimmer is periodic', () => {
  assert.equal(wrappedPhase(-250, 1000), 0.75);
  assert.equal(shimmerIntensity(300, 2, 10, false), shimmerIntensity(300 + MOTION_PROFILES.processing.cycleMs, 2, 10, false));
});
