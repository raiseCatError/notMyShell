import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {alleyGame} from '../src/arcade/games/alley/index.js';
import {AlleyState, JUMP_V, LANES, LOW_H, MIN_GAP_S, SLIDE_S, distanceAt, speedAt, timeAt} from '../src/arcade/games/alley/logic.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {displayWidth} from '../src/util/text.js';
import {STEP, checkRenders, context, memory} from './arcadeBatch3Kit.js';

type Bot = {lane: number};
/** A perfect player: moves to each row's safe lane once the last row is behind, jumps and slides at the right moment. */
function oracle(state: AlleyState): void {
  const row = state.nextRow();
  if (!row) return;
  const prevPassed = !state.rows.some(r => r !== row && r.z + r.len > state.z && r.z < row.z);
  if (prevPassed && state.z < row.z) while (state.lane !== row.safe) state.moveLane(state.lane < row.safe ? 1 : -1);
  const ahead = row.z - state.z;
  const cell = row.cells[row.safe];
  if (cell === 'low' && ahead < state.speed * 0.18 && ahead > 0) state.jump();
  if (cell === 'high' && ahead < state.speed * 0.15 && ahead > 0) state.slide();
}

test('speed ramps with time and distance is its exact integral', () => {
  assert.ok(speedAt(0) < speedAt(30) && speedAt(30) < speedAt(80));
  assert.equal(speedAt(1000), speedAt(500));
  for (const t of [0, 5, 40, 90, 200]) assert.ok(Math.abs(timeAt(distanceAt(t)) - t) < 1e-6);
});

test('fairness: over 120 seeds every row has a safe lane that is never a wall, shifts at most one lane and leaves time to act', () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const state = new AlleyState(createRng(seed));
    state.started = true;
    state.time = 300; // generate a long course, far into the ramp, then back to the start for the early rows
    (state as never as {fill(): void}).fill();
    const early = new AlleyState(createRng(seed));
    for (const course of [state, early]) {
      let rows = 0;
      for (let t = 0; t < 4; t += 1) {
        course.started = true;
        course.time += 60;
        (course as never as {fill(): void}).fill();
      }
      for (let index = 0; index < course.rows.length; index += 1) {
        const row = course.rows[index]!;
        assert.notEqual(row.cells[row.safe], 'wall', `seed ${seed}`);
        assert.ok(row.cells.some(cell => cell !== 'wall'));
        const previous = course.rows[index - 1];
        if (previous) {
          assert.ok(Math.abs(row.safe - previous.safe) <= 1, `seed ${seed}: safe lane jumps`);
          const gap = timeAt(row.z) - timeAt(previous.z + previous.len);
          assert.ok(gap >= MIN_GAP_S - 1e-9, `seed ${seed}: gap ${gap.toFixed(3)}s`);
        }
        rows += 1;
      }
      assert.ok(rows > 20);
    }
  }
});

test('fairness: a perfect player survives 150 s on every one of 80 seeds, and the rows really contain every obstacle kind', () => {
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 80; seed += 1) {
    const state = new AlleyState(createRng(seed));
    state.started = true;
    for (let t = 0; t < 150_000 && state.alive; t += STEP) {
      oracle(state);
      state.step(STEP);
      for (const row of state.rows) for (const cell of row.cells) if (cell) kinds.add(cell);
    }
    assert.ok(state.alive, `seed ${seed} crashed at ${state.meters} m: ${JSON.stringify(state.crashed)}`);
    assert.ok(state.meters > 3000);
  }
  assert.deepEqual([...kinds].sort(), ['high', 'low', 'wall']);
});

test('determinism: the same seed gives the same course', () => {
  const a = new AlleyState(createRng(9)), b = new AlleyState(createRng(9)), c = new AlleyState(createRng(10));
  assert.deepEqual(a.rows, b.rows);
  assert.notDeepEqual(a.rows, c.rows);
});

test('collision: a wall always kills, a crate only a cat that is low, a beam only a cat that is not sliding', () => {
  const trial = (cell: 'low' | 'high' | 'wall', act: (state: AlleyState) => void): boolean => {
    const state = new AlleyState(createRng(1));
    state.rows = [{z: 30, len: 2, cells: [null, cell, null], safe: 0}];
    state.pickups = [];
    state.started = true;
    state.lane = 1;
    state.time = timeAt(30 - 0.9 * speedAt(timeAt(30)));
    act(state);
    for (let i = 0; i < 90 && state.alive; i += 1) { if (state.z < 30 && state.z > 30 - 4) act(state); state.step(STEP); if (state.z > 40) break; }
    return state.alive;
  };
  assert.equal(trial('wall', s => s.jump()), false);
  assert.equal(trial('low', () => {}), false);
  assert.equal(trial('high', () => {}), false);
  assert.equal(trial('high', s => s.jump()), false, 'jumping does not clear a beam');
  const timed = (cell: 'low' | 'high', act: (s: AlleyState) => void): boolean => {
    const state = new AlleyState(createRng(1));
    state.rows = [{z: 30, len: cell === 'low' ? 1.6 : 1.2, cells: [null, cell, null], safe: 1}];
    state.pickups = []; state.started = true; state.lane = 1;
    state.time = timeAt(30 - state.speed * 0.2);
    state.time = timeAt(30 - speedAt(state.time) * 0.18);
    act(state);
    for (let i = 0; i < 120 && state.z < 40; i += 1) state.step(STEP);
    return state.alive;
  };
  assert.equal(timed('low', s => s.jump()), true);
  assert.equal(timed('high', s => s.slide()), true);
  // Another lane is simply free.
  const free = new AlleyState(createRng(1));
  free.rows = [{z: 30, len: 2, cells: [null, 'wall', null], safe: 0}]; free.pickups = []; free.started = true; free.lane = 0;
  free.time = timeAt(25);
  for (let i = 0; i < 120 && free.z < 40; i += 1) free.step(STEP);
  assert.equal(free.alive, true);
});

test('movement: lanes clamp, jump arcs and lands, slide times out, slide in the air drops fast', () => {
  const state = new AlleyState(createRng(2));
  state.rows = []; state.pickups = [];
  state.started = true;
  assert.equal(state.moveLane(-1), true);
  assert.equal(state.moveLane(-1), false);
  assert.equal(state.lane, 0);
  state.jump();
  let peak = 0, steps = 0;
  while (!state.grounded && steps < 200) { state.step(STEP); peak = Math.max(peak, state.y); steps += 1; }
  assert.ok(peak > LOW_H && peak < 2, `peak ${peak}`);
  assert.ok(steps * STEP / 1000 > 0.5 && steps * STEP / 1000 < 0.7);
  state.slide();
  assert.equal(state.sliding, true);
  for (let i = 0; i < Math.ceil(SLIDE_S * 60) + 2; i += 1) state.step(STEP);
  assert.equal(state.sliding, false);
  state.jump(); state.step(STEP); state.step(STEP); state.slide();
  let air = 0;
  while (!state.grounded && air < 100) { state.step(STEP); air += 1; }
  assert.ok(air < 20, 'fast fall');
  assert.equal(state.sliding, true, 'slides on landing');
  assert.ok(JUMP_V > 0 && LANES === 3);
});

test('coins: collected in their lane for 10 points each', () => {
  const state = new AlleyState(createRng(3));
  state.rows = []; state.started = true; state.lane = 2;
  state.pickups = [{z: 20, lane: 2, taken: false}, {z: 22, lane: 0, taken: false}];
  state.time = timeAt(18);
  for (let i = 0; i < 60; i += 1) state.step(STEP);
  assert.equal(state.coins, 1);
  assert.ok(state.score >= state.meters + 10);
});

test('game: keys, ready/playing/over, pause and restart safety, determinism and record saving', () => {
  const play = (seed: number) => {
    const record = memory();
    const game = alleyGame.create(context(record, {rng: createRng(seed), seed})) as never as {key(k: unknown): string; step(d: number): void; animate(d: number): void; status: string; result: {score: number; record: boolean; details: string[]} | undefined; state: AlleyState; pause(): void; dispose(): void};
    assert.equal(game.status, 'ready');
    assert.equal(game.key({kind: 'text', value: 'x'}), 'ignored');
    assert.equal(game.key({kind: 'text', value: ' '}), 'handled');
    assert.equal(game.status, 'playing');
    for (let t = 0; t < 120_000 && game.status !== 'over'; t += STEP) {
      if (t === 3000) { const snapshot = JSON.stringify([game.state.time, game.state.lane]); game.pause(); assert.equal(JSON.stringify([game.state.time, game.state.lane]), snapshot); }
      // Dodge by always taking the lane the nearest row leaves free, but never jump or slide: it crashes on a crate or beam soon.
      const row = game.state.nextRow();
      if (row && row.z - game.state.z < 30 && game.state.lane !== row.safe) game.key({kind: game.state.lane < row.safe ? 'right' : 'left'});
      game.step(STEP); game.animate(STEP);
    }
    return {game, record};
  };
  const a = play(7), b = play(7);
  assert.equal(a.game.status, 'over');
  assert.equal(a.game.result?.score, b.game.result?.score);
  assert.deepEqual(a.game.result?.details, b.game.result?.details);
  assert.equal(a.record.raw().plays, 1);
  assert.equal(a.record.raw().best, a.game.result?.score);
  assert.equal(a.game.result?.record, true);
  assert.equal(a.game.key({kind: 'left'}), 'ignored');
  a.game.dispose();
});

test('new record: beating a saved best mid-run celebrates once; a lower score is no record', () => {
  const record = memory({best: 5, plays: 1});
  const game = alleyGame.create(context(record)) as never as {key(k: unknown): string; step(d: number): void; state: AlleyState; particles: {count: number}; popups: {count: number}; result: {record: boolean} | undefined; status: string};
  game.key({kind: 'text', value: ' '});
  for (let i = 0; i < 90; i += 1) game.step(STEP);
  assert.ok(game.state.score > 5);
  assert.ok(game.popups.count >= 1 && game.particles.count > 0, 'celebration shown');
  const low = memory({best: 1_000_000, plays: 3});
  const g2 = alleyGame.create(context(low)) as never as {key(k: unknown): string; step(d: number): void; state: AlleyState; result: {record: boolean} | undefined; status: string};
  g2.key({kind: 'text', value: ' '});
  g2.state.rows = [{z: 15, len: 2, cells: ['wall', 'wall', 'wall'], safe: 1}];
  for (let i = 0; i < 600 && g2.status !== 'over'; i += 1) g2.step(STEP);
  assert.equal(g2.status, 'over');
  assert.equal(g2.result?.record, false);
  assert.equal(low.raw().best, 1_000_000);
});

test('render: every size, color level, Safe Glyphs and Reduced Motion draws inside its bounds, ready and mid-run', () => {
  checkRenders(alleyGame, game => {
    game.key({kind: 'text', value: ' '});
    for (let i = 0; i < 200; i += 1) { if (i % 40 === 5) game.key({kind: 'up'}); if (i % 40 === 25) game.key({kind: 'down'}); game.step(STEP); game.animate(STEP); }
  });
  const preview = new Canvas(40, 12);
  alleyGame.preview(preview, 3, arcadePalette());
  for (const line of preview.plain()) assert.ok(displayWidth(line) <= 40);
});
