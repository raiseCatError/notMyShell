import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {angleGap, TAU, wrapAngle} from '../src/arcade/engine/collide.js';
import {BullseyeState, FLIGHT_MS, IMPACT, MIN_GAP, stageDarts, stagePattern} from '../src/arcade/games/bullseye/logic.js';
import {bullseyeGame} from '../src/arcade/games/bullseye/index.js';
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
const land = (state: BullseyeState) => { state.throw(); for (let t = 0; t <= FLIGHT_MS + STEP && state.flying >= 0; t += STEP) state.step(STEP); };

test('angles: a dart lands where the bottom of the rim is when it arrives, accounting for the spin during flight', () => {
  const state = new BullseyeState(createRng(1));
  state.darts = [];
  state.fish = [];
  const before = state.rotation;
  land(state);
  const landed = state.darts.at(-1)!;
  assert.ok(angleGap(wrapAngle(landed + state.rotation), IMPACT) < 1e-9, 'at the bottom in screen space at the moment it stuck');
  assert.notEqual(state.rotation, before, 'the target turned while the dart flew');
});

test('collision: a dart within the minimum gap of another glances off; just outside it sticks', () => {
  for (const [offset, sticks] of [[MIN_GAP * 0.9, false], [MIN_GAP * 1.1, true]] as const) {
    const state = new BullseyeState(createRng(2));
    state.fish = [];
    // Predict where the next dart will land and put a dart just beside it.
    const probe = new BullseyeState(createRng(2));
    probe.darts = []; probe.fish = [];
    land(probe);
    const target = probe.darts.at(-1)!;
    state.darts = [wrapAngle(target + offset)];
    land(state);
    assert.equal(state.alive, sticks, `offset ${offset.toFixed(2)}`);
  }
});

test('stages: throwing every dart clears the stage and the next starts faster with more darts; patterns are seeded', () => {
  const state = new BullseyeState(createRng(3));
  state.darts = []; state.fish = [];
  // Space the throws so every dart lands far from the others.
  let guard = 0;
  while (state.stage === 1 && guard++ < 500) {
    if (state.flying < 0 && state.clearMs <= 0) {
      const next = wrapAngle(IMPACT - state.rotation - state.speed * (FLIGHT_MS / 1000));
      if (state.darts.every(other => angleGap(other, next) > MIN_GAP * 1.5)) state.throw();
    }
    state.step(STEP);
  }
  assert.ok(state.alive);
  assert.equal(state.stage, 2);
  assert.ok(stageDarts(9) > stageDarts(1));
  assert.deepEqual(stagePattern(4, createRng(9)), stagePattern(4, createRng(9)));
  const early = Math.max(...stagePattern(1, createRng(9)).map(s => Math.abs(s.speed)));
  const late = Math.max(...stagePattern(12, createRng(9)).map(s => Math.abs(s.speed)));
  assert.ok(late > early);
});

test('fairness: darts placed in the rim before a stage always leave room for every dart the stage gives', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const state = new BullseyeState(createRng(seed));
    for (let stage = 2; stage <= 12; stage += 1) {
      state.stage = stage;
      (state as never as {begin(): void}).begin();
      // Free arc: total angle not within MIN_GAP of a preset dart.
      let free = 0;
      for (let k = 0; k < 720; k += 1) { const a = (k / 720) * TAU; if (state.darts.every(d => angleGap(d, a) >= MIN_GAP)) free += TAU / 720; }
      assert.ok(free >= stageDarts(stage) * MIN_GAP, `seed ${seed} stage ${stage}: ${free.toFixed(2)} rad free`);
      for (let a = 0; a < state.darts.length; a += 1) for (let b = a + 1; b < state.darts.length; b += 1) assert.ok(angleGap(state.darts[a]!, state.darts[b]!) > MIN_GAP * 2);
    }
  }
});

test('game: throwing in a fixed rhythm is deterministic, ends with a result, and the best is saved', () => {
  const play = () => {
    const record = memory();
    const game = bullseyeGame.create(context(record));
    for (let t = 0; t < 120_000 && game.status !== 'over'; t += STEP) {
      if (Math.floor(t / 450) !== Math.floor((t + STEP) / 450)) game.key({kind: 'text', value: ' '});
      game.step(STEP); game.animate(STEP);
    }
    return {game, record};
  };
  const a = play(), b = play();
  assert.equal(a.game.status, 'over');
  assert.equal(a.game.result!.score, b.game.result!.score);
  assert.equal(a.record.raw().plays, 1);
});

test('render: every size draws inside its bounds, in color and without', () => {
  for (const [columns, rows] of [[20, 8], [50, 16], [100, 30], [200, 60]] as const) {
    for (const color of ['truecolor', 'none'] as const) {
      const game = bullseyeGame.create(context(memory(), {size: {columns, rows}, color}));
      game.key({kind: 'text', value: ' '});
      for (let i = 0; i < 30; i += 1) game.step(STEP);
      const canvas = new Canvas(columns, rows);
      game.render(canvas, 0, arcadePalette());
      for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    }
  }
});
