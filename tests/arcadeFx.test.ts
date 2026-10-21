import test from 'node:test';
import assert from 'node:assert/strict';
import {Combo, CountUp, Sequence, Tween} from '../src/arcade/fx/sequence.js';
import {Reveal, Ripple, confetti, shatter} from '../src/arcade/fx/cells.js';
import {ParticleSystem} from '../src/arcade/effects.js';
import {createRng} from '../src/arcade/rng.js';
import type {MotionPreferences} from '../src/arcade/types.js';

const full: MotionPreferences = {reduced: false, effects: 'normal'};
const reduced: MotionPreferences = {reduced: true, effects: 'subtle'};
const off: MotionPreferences = {reduced: false, effects: 'off'};
const run = (thing: {update(dt: number): void}, ms: number, step = 1000 / 60) => { for (let t = 0; t < ms; t += step) thing.update(step); };

test('fx: a tween eases from 0 to 1, honours its delay and can be skipped', () => {
  const tween = new Tween(200, 100);
  run(tween, 80);
  assert.equal(tween.value, 0);
  run(tween, 120);
  assert.ok(tween.value > 0 && tween.value < 1);
  tween.skip();
  assert.equal(tween.value, 1);
  assert.equal(tween.done, true);
});

test('fx: a sequence walks its phases; Reduced Motion keeps only the still holds', () => {
  const phases = [{name: 'highlight', ms: 600}, {name: 'burst', ms: 400}, {name: 'badge', ms: 300}] as const;
  const sequence = new Sequence(phases, full);
  assert.equal(sequence.phase, 'highlight');
  run(sequence, 700);
  assert.equal(sequence.phase, 'burst');
  assert.equal(sequence.progress('highlight'), 1);
  sequence.skip();
  assert.equal(sequence.done, true);
  const calm = new Sequence(phases, reduced, ['highlight']);
  assert.equal(calm.total, 600, 'only the hold remains');
  assert.equal(new Sequence(phases, reduced).done, true);
});

test('fx: identical inputs replay identically at any frame rate', () => {
  const at = (step: number) => { const sequence = new Sequence([{name: 'a', ms: 333}, {name: 'b', ms: 333}], full); run(sequence, 500, step); return [sequence.phase, sequence.time]; };
  assert.deepEqual(at(1000 / 60), at(1000 / 60));
  assert.equal(at(1000 / 20)[0], at(1000 / 60)[0]);
});

test('fx: count-up shows whole numbers and ends exactly on the target; no counting without motion', () => {
  const count = new CountUp(1240, 0, 900, full);
  const seen: number[] = [];
  for (let t = 0; t < 1000; t += 50) { count.update(50); seen.push(count.value); }
  assert.ok(seen.every(Number.isInteger));
  assert.ok(seen.every((value, index) => index === 0 || value >= seen[index - 1]!), 'never counts backwards');
  assert.equal(count.value, 1240);
  assert.equal(new CountUp(77, 0, 900, reduced).value, 77);
  assert.equal(new CountUp(77, 0, 900, off).value, 77);
});

test('fx: combos rise through tiers, pulse on a tier-up and decay when idle', () => {
  const combo = new Combo(1000, [3, 6]);
  combo.hit(); combo.hit();
  assert.equal(combo.multiplier, 1);
  combo.hit();
  assert.equal(combo.tier, 1);
  assert.equal(combo.pulse, 1);
  combo.update(300);
  assert.ok(combo.pulse > 0 && combo.pulse < 1);
  combo.update(800);
  assert.equal(combo.count, 0, 'decayed');
  assert.equal(combo.best, 3);
});

test('fx: a reveal staggers its groups; Reduced Motion holds a steady glow instead', () => {
  const reveal = new Reveal([[0, 1, 2], [3, 4, 5]], full, {stagger: 200, within: 0, rise: 100, hold: 100, fall: 200});
  reveal.update(50);
  assert.ok(reveal.amount(0) > 0, 'first group rising');
  assert.equal(reveal.amount(3), 0, 'second group not yet');
  reveal.update(200);
  assert.ok(reveal.amount(3) > 0);
  assert.equal(reveal.amount(9), 0, 'cells outside it never glow');
  reveal.skip();
  assert.equal(reveal.amount(0), 0);
  const calm = new Reveal([[0], [1]], reduced);
  calm.update(16);
  assert.equal(calm.amount(0), calm.amount(1), 'everything at once, nothing moving');
  calm.update(10_000);
  assert.equal(calm.done, true);
});

test('fx: a ripple ring travels outward and is never started under Reduced Motion', () => {
  const ripple = new Ripple(5, 5, full, 10, 1.5, 8);
  ripple.update(300);
  assert.ok(ripple.amount(8, 5) > ripple.amount(5, 5), 'the ring has left the center');
  assert.equal(new Ripple(0, 0, reduced).done, true);
});

test('fx: shatter and confetti stay inside the bounded particle pool and respect the effects level', () => {
  const particles = new ParticleSystem(createRng(1), 64, 'normal');
  for (let index = 0; index < 20; index += 1) shatter(particles, {x: 0, y: 0, width: 12, height: 4}, [{red: 1, green: 2, blue: 3}]);
  assert.ok(particles.count <= 64);
  const quiet = new ParticleSystem(createRng(1), 64, 'off');
  shatter(quiet, {x: 0, y: 0, width: 12, height: 4}, [{red: 1, green: 2, blue: 3}]);
  confetti(quiet, 40, 20, [{red: 1, green: 2, blue: 3}], off);
  assert.equal(quiet.count, 0);
  const a = new ParticleSystem(createRng(7), 64, 'normal');
  const b = new ParticleSystem(createRng(7), 64, 'normal');
  confetti(a, 40, 20, [{red: 9, green: 9, blue: 9}], full);
  confetti(b, 40, 20, [{red: 9, green: 9, blue: 9}], full);
  assert.deepEqual(a.particles, b.particles, 'deterministic from the seed');
});
