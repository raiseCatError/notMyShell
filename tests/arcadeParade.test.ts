import test from 'node:test';
import assert from 'node:assert/strict';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {createRng} from '../src/arcade/rng.js';
import {paradeGame} from '../src/arcade/games/parade/index.js';
import {MAX_COUNT, MAX_DRAWN, MIN_GAP_S, ParadeState, START_COUNT, applyCell, compact, crowdLayout, timeAt, ROW_LENGTH} from '../src/arcade/games/parade/logic.js';
import {displayWidth} from '../src/util/text.js';
import {STEP, checkRenders, context, memory} from './arcadeBatch3Kit.js';

const follow = (state: ParadeState): void => {
  const row = state.nextRow();
  if (row) while (state.lane !== row.safe) state.moveLane(state.lane < row.safe ? 1 : -1);
};

test('arithmetic: each gate does what it says, never below zero, never above the cap', () => {
  assert.equal(applyCell(10, {kind: 'gate', op: '+', n: 5}), 15);
  assert.equal(applyCell(10, {kind: 'gate', op: '-', n: 4}), 6);
  assert.equal(applyCell(3, {kind: 'gate', op: '-', n: 9}), 0);
  assert.equal(applyCell(7, {kind: 'gate', op: '×', n: 3}), 21);
  assert.equal(applyCell(7, {kind: 'gate', op: '÷', n: 2}), 3);
  assert.equal(applyCell(1, {kind: 'gate', op: '÷', n: 2}), 0);
  assert.equal(applyCell(MAX_COUNT, {kind: 'gate', op: '×', n: 3}), MAX_COUNT);
  assert.equal(applyCell(20, {kind: 'saw'}), 14);
  assert.equal(applyCell(1, {kind: 'saw'}), 0);
  assert.equal(applyCell(9, null), 9);
  assert.equal(compact(999), '999');
  assert.equal(compact(12_345), '12.3k');
  assert.equal(compact(2_500_000), '2.5M');
});

test('bounded rendering: the crowd layout never has more than the cap, whatever the count', () => {
  for (const n of [0, 1, 5, 47, 48, 49, 1000, 999_999, 1e9, Number.MAX_SAFE_INTEGER]) {
    const layout = crowdLayout(n, MAX_DRAWN, 6);
    assert.ok(layout.length <= MAX_DRAWN);
    assert.equal(layout.length, Math.min(n, MAX_DRAWN));
    for (const p of layout) assert.ok(Math.abs(p.x) <= 3);
    assert.equal(new Set(layout.map(p => `${p.x},${p.y}`)).size, layout.length, 'no two sprites share a spot');
  }
});

test('fairness: over 150 seeds every row has a safe lane that never loses a kitten, drifts one lane and leaves time', () => {
  for (let seed = 1; seed <= 150; seed += 1) {
    const state = new ParadeState(createRng(seed));
    state.started = true;
    for (let k = 0; k < 6; k += 1) { state.time += 40; (state as never as {fill(): void}).fill(); }
    const rows = state.rows;
    assert.ok(rows.length > 40);
    rows.forEach((row, index) => {
      const cell = row.cells[row.safe] ?? null;
      assert.ok(applyCell(1000, cell) >= 1000, `seed ${seed}: safe cell ${JSON.stringify(cell)}`);
      assert.ok(applyCell(1, cell) >= 1);
      const previous = rows[index - 1];
      if (previous) {
        assert.ok(Math.abs(row.safe - previous.safe) <= 1);
        assert.ok(timeAt(row.z) - timeAt(previous.z + ROW_LENGTH) >= MIN_GAP_S - 1e-6, `seed ${seed}: rows too close`);
      }
    });
  }
});

test('fairness: following the safe lane for 200 s never loses a kitten, on 60 seeds; the other cells do hurt', () => {
  const kinds = new Set<string>();
  for (let seed = 1; seed <= 60; seed += 1) {
    const state = new ParadeState(createRng(seed));
    state.started = true;
    let low = state.count;
    for (let t = 0; t < 200_000 && state.alive; t += STEP) {
      follow(state);
      state.step(STEP);
      low = Math.min(low, state.count);
      for (const row of state.rows) for (const cell of row.cells) if (cell) kinds.add(cell.kind === 'saw' ? 'saw' : cell.op);
    }
    assert.ok(state.alive, `seed ${seed} died`);
    assert.ok(low >= START_COUNT, `seed ${seed}: count fell to ${low}`);
  }
  assert.deepEqual([...kinds].sort(), ['+', '-', 'saw', '×', '÷'].sort());
});

test('a lazy player in the middle lane loses, and the count hitting zero ends the run', () => {
  let ended = 0;
  for (let seed = 1; seed <= 20; seed += 1) {
    const state = new ParadeState(createRng(seed));
    state.started = true;
    for (let t = 0; t < 300_000 && state.alive; t += STEP) state.step(STEP);
    if (!state.alive) { ended += 1; assert.equal(state.count, 0); assert.ok(state.events.some(e => e.kind === 'dead')); }
  }
  assert.ok(ended > 0, 'staying put is not a winning strategy');
});

test('determinism: same seed same rows; lane moves clamp', () => {
  assert.deepEqual(new ParadeState(createRng(5)).rows, new ParadeState(createRng(5)).rows);
  assert.notDeepEqual(new ParadeState(createRng(5)).rows, new ParadeState(createRng(6)).rows);
  const state = new ParadeState(createRng(1));
  assert.equal(state.moveLane(1), true);
  assert.equal(state.moveLane(1), false);
  assert.equal(state.lane, 2);
});

test('collision: the gate under the crowd when it crosses applies, once', () => {
  const state = new ParadeState(createRng(1));
  state.rows = [{z: 20, cells: [{kind: 'gate', op: '+', n: 4}, {kind: 'gate', op: '×', n: 3}, null], safe: 0, applied: false}];
  state.started = true; state.lane = 1;
  state.time = timeAt(18);
  for (let i = 0; i < 120 && state.z < 30; i += 1) state.step(STEP);
  assert.equal(state.count, START_COUNT * 3);
  assert.equal(state.gates, 1);
});

test('game: keys, status, pause and restart safety, determinism, record saving, celebration', () => {
  const run = (seed: number, record = memory()) => {
    const game = paradeGame.create(context(record, {rng: createRng(seed), seed})) as never as {key(k: unknown): string; step(d: number): void; animate(d: number): void; pause(): void; status: string; result: {score: number; record: boolean; details: string[]} | undefined; state: ParadeState; popups: {count: number}; particles: {count: number}; dispose(): void};
    assert.equal(game.status, 'ready');
    assert.equal(game.key({kind: 'text', value: 'q'}), 'ignored');
    game.key({kind: 'text', value: ' '});
    assert.equal(game.status, 'playing');
    for (let t = 0; t < 400_000 && game.status !== 'over'; t += STEP) {
      if (t === 2000) { const before = JSON.stringify([game.state.time, game.state.count]); game.pause(); assert.equal(JSON.stringify([game.state.time, game.state.count]), before); }
      game.step(STEP); game.animate(STEP);
    }
    return {game, record};
  };
  const a = run(3), b = run(3);
  assert.equal(a.game.status, 'over');
  assert.deepEqual(a.game.result, b.game.result);
  assert.equal(a.record.raw().plays, 1);
  assert.equal(a.record.raw().best, a.game.result?.score);
  assert.equal(a.game.result?.record, true);
  assert.equal(a.game.key({kind: 'left'}), 'ignored');
  const beaten = run(3, memory({best: 1_000_000, plays: 9}));
  assert.equal(beaten.game.result?.record, false);
  assert.equal(beaten.record.raw().best, 1_000_000);
  assert.equal(beaten.record.raw().plays, 10);
  a.game.dispose();
  const mid = paradeGame.create(context(memory({best: 3, plays: 1}))) as never as typeof a.game;
  mid.key({kind: 'text', value: ' '});
  for (let i = 0; i < 90; i += 1) mid.step(STEP);
  assert.ok(mid.popups.count >= 1 && mid.particles.count > 0, 'a new best shows a celebration');
});

test('render: every size, color level, Safe Glyphs and Reduced Motion draws inside its bounds, with a huge crowd too', () => {
  checkRenders(paradeGame, game => {
    game.key({kind: 'text', value: ' '});
    for (let i = 0; i < 300; i += 1) { if (i % 90 === 10) game.key({kind: 'right'}); if (i % 90 === 50) game.key({kind: 'left'}); game.step(STEP); game.animate(STEP); }
    (game as never as {state: ParadeState}).state.count = 987_654;
  });
  const preview = new Canvas(40, 12);
  paradeGame.preview(preview, 5, arcadePalette());
  for (const line of preview.plain()) assert.ok(displayWidth(line) <= 40);
});
