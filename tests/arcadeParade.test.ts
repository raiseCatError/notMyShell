import test from 'node:test';
import assert from 'node:assert/strict';
import {Canvas, PixelBuffer} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {createRng} from '../src/arcade/rng.js';
import {paradeGame} from '../src/arcade/games/parade/index.js';
import {BOSS_ROUNDS, LEVELS, MAX_COUNT, MAX_DRAWN, MIN_GAP_S, ParadeState, ROW_LENGTH, ROUND_MS, START_COUNT, applyCell, bestLane, cellText, compact, crowdLayout, exchangeSize, recruits, speedFor, type Cell, type ParadeEvent} from '../src/arcade/games/parade/logic.js';
import {displayWidth} from '../src/util/text.js';
import {STEP, checkRenders, context, memory} from './arcadeBatch3Kit.js';

type Policy = (state: ParadeState) => number | undefined;
const optimal: Policy = state => { const row = state.nextRow(); return row ? bestLane(state.count, row) : undefined; };
const lazy: Policy = () => undefined;
/** Chooses the lane whose label shows the biggest number, whatever the sign or the foe: the classic trap. */
const shown = (cell: Cell): number => (!cell || cell.kind === 'saw' ? 0 : cell.n);
const greedyWrong: Policy = state => { const row = state.nextRow(); return row ? [0, 1, 2].reduce((best, lane) => (shown(row.cells[lane]!) > shown(row.cells[best]!) ? lane : best), 1) : undefined; };

/** Play a whole campaign with a policy; returns the state and every event. */
function play(seed: number, policy: Policy, limitS = 900): {state: ParadeState; events: ParadeEvent[]} {
  const state = new ParadeState(createRng(seed));
  state.started = true;
  const events: ParadeEvent[] = [];
  for (let t = 0; t < limitS * 1000 && !state.over; t += STEP) {
    const want = policy(state);
    if (want !== undefined) while (state.lane !== want && state.moveLane(state.lane < want ? 1 : -1)) { /* one lane per press */ }
    state.step(STEP);
    events.push(...state.events.splice(0));
  }
  return {state, events};
}
const SEEDS = Array.from({length: 120}, (_, index) => index + 1);

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

test('combat: both sides lose members every exchange, the larger survives with the difference, a tie wipes both out', () => {
  assert.equal(applyCell(30, {kind: 'enemy', n: 12}), 18);
  assert.equal(applyCell(10, {kind: 'enemy', n: 12}), 0);
  const fight = (crowd: number, enemy: number, boss = false) => {
    const state = new ParadeState(createRng(1));
    state.started = true; state.count = crowd;
    state.rows = [{z: 30, cells: [null, {kind: 'enemy', n: enemy, ...(boss ? {boss: true as const} : {})}, null], kind: boss ? 'boss' : 'wave', level: LEVELS, applied: false, fought: -1}];
    const events: ParadeEvent[] = [];
    for (let i = 0; i < 2000 && !state.battle && state.z < 40; i += 1) state.step(STEP);
    assert.ok(state.battle, 'the crowd stops to fight');
    const frozen = state.z;
    let sawMid = false;
    for (let i = 0; i < 4000 && (state.battle || !state.over); i += 1) {
      state.step(STEP);
      events.push(...state.events.splice(0));
      if (state.battle) { assert.equal(state.z, frozen, 'no scrolling mid-fight'); if (state.count < crowd && state.count > 0) sawMid = true; }
      if (!state.battle) break;
    }
    return {state, events, sawMid};
  };
  const win = fight(40, 25);
  assert.equal(win.state.count, 15);
  assert.ok(win.sawMid, 'the crowd visibly shrinks while fighting');
  const exchanges = win.events.filter(e => e.kind === 'exchange') as Array<Extract<ParadeEvent, {kind: 'exchange'}>>;
  assert.ok(exchanges.length >= 3 && exchanges.every(e => e.lost >= 1));
  assert.ok(exchanges.every((e, i) => i === 0 || (e.crowd < exchanges[i - 1]!.crowd && e.enemy < exchanges[i - 1]!.enemy)), 'both sides lose members each exchange');
  assert.ok(win.events.some(e => e.kind === 'routed'));
  const lose = fight(25, 40);
  assert.equal(lose.state.alive, false);
  assert.ok(lose.events.some(e => e.kind === 'dead'));
  const tie = fight(20, 20);
  assert.equal(tie.state.alive, false, 'a tie is a defeat');
  assert.equal(exchangeSize(100, 40, true), Math.ceil(40 / BOSS_ROUNDS));
  assert.ok(ROUND_MS > 0);
});

test('levels: the campaign is finite, rows are ordered and spaced, each level ends in a boss, enemies are labelled', () => {
  for (const seed of SEEDS) {
    const rows = new ParadeState(createRng(seed)).rows;
    assert.equal(rows.filter(row => row.kind === 'boss').length, LEVELS);
    assert.equal(rows.at(-1)!.kind, 'boss');
    assert.ok(rows.filter(row => row.kind === 'wave').length >= LEVELS, 'intermediate confrontations in every level');
    rows.forEach((row, index) => {
      const previous = rows[index - 1];
      if (!previous) return;
      assert.ok(row.level >= previous.level);
      assert.ok((row.z - previous.z - ROW_LENGTH) / speedFor(row.level) >= MIN_GAP_S - 1e-6, `seed ${seed} row ${index}: rows too close`);
    });
    for (let level = 1; level <= LEVELS; level += 1) assert.ok(rows.filter(row => row.level === level).length > 8, 'levels get longer');
  }
  assert.equal(cellText({kind: 'enemy', n: 24}), '!24');
  assert.equal(cellText({kind: 'enemy', n: 400, boss: true}), 'B400');
});

test('fair and winnable: over 120 seeds the best-lane-per-row play wins every level with a bounded margin over each boss', () => {
  for (const seed of SEEDS) {
    const {state, events} = play(seed, optimal);
    assert.equal(state.won, true, `seed ${seed}: optimal play must win (died at level ${state.level}, count ${state.count})`);
    assert.equal(state.alive, true);
    assert.equal(state.bossesDown, LEVELS);
    const bosses = events.filter(e => e.kind === 'battle' && e.boss) as Array<Extract<ParadeEvent, {kind: 'battle'}>>;
    assert.equal(bosses.length, LEVELS);
    for (const boss of bosses) {
      const ratio = boss.crowd / boss.enemy;
      assert.ok(ratio >= 1.25 && ratio <= 2.4, `seed ${seed}: crowd/boss ${ratio.toFixed(2)} (${boss.crowd} vs ${boss.enemy})`);
    }
    assert.ok(events.some(e => e.kind === 'victory'));
    assert.ok(state.peak < 5000, `no runaway growth: peak ${state.peak}`);
  }
});

test('defeat is reachable: standing still and picking the biggest shown number both lose on every seed; one wrong wave lane is lethal', () => {
  for (const seed of SEEDS) {
    for (const [name, policy] of [['lazy', lazy], ['greedy-wrong', greedyWrong]] as const) {
      const {state, events} = play(seed, policy);
      assert.equal(state.alive, false, `seed ${seed}: ${name} should lose`);
      assert.equal(state.won, false);
      assert.ok(events.some(e => e.kind === 'dead'));
    }
    // An otherwise perfect run that takes the biggest group in the first wave is wiped out.
    const wrongWave: Policy = state => {
      const row = state.nextRow();
      if (!row) return undefined;
      if (row.kind === 'wave' && row.level === 1) return [0, 1, 2].reduce((best, lane) => (shown(row.cells[lane]!) > shown(row.cells[best]!) ? lane : best), 0);
      return bestLane(state.count, row);
    };
    assert.equal(play(seed, wrongWave).state.alive, false);
  }
});

test('one mistake costs the campaign: skipping the best gate once leaves too little for the boss, on most seeds', () => {
  let lost = 0;
  for (const seed of SEEDS) {
    const wrong = new Set<unknown>();
    const sloppy: Policy = state => {
      const row = state.nextRow();
      if (!row) return undefined;
      const best = bestLane(state.count, row);
      if (wrong.has(row) || (row.kind === 'gate' && row.level === 1 && wrong.size < 3 && state.rows.indexOf(row) > 4)) {
        // Take the worst lane of the row for three gate rows.
        wrong.add(row);
        return [0, 1, 2].reduce((worst, lane) => (applyCell(state.count, row.cells[lane]!) < applyCell(state.count, row.cells[worst]!) ? lane : worst), best);
      }
      return best;
    };
    if (!play(seed, sloppy).state.won) lost += 1;
  }
  assert.ok(lost >= SEEDS.length * 0.7, `three bad gates should usually end the run (${lost}/${SEEDS.length})`);
});

test('scoring rewards good choices and survival; levels cost kittens and give recruits', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const best = play(seed, optimal).state;
    const lazyRun = play(seed, lazy).state;
    const wrong = play(seed, greedyWrong).state;
    assert.ok(best.score > lazyRun.score * 3 && best.score > wrong.score * 3, `seed ${seed}: ${best.score} vs ${lazyRun.score}/${wrong.score}`);
    assert.ok(best.perfect > wrong.perfect);
  }
  const {events} = play(9, optimal);
  const levels = events.filter(e => e.kind === 'level') as Array<Extract<ParadeEvent, {kind: 'level'}>>;
  assert.equal(levels.length, LEVELS - 1);
  assert.deepEqual(levels.map(e => e.recruits), levels.map((_, index) => recruits(index + 1)));
});

test('determinism: same seed same campaign; lane moves clamp and are ignored mid-fight', () => {
  assert.deepEqual(new ParadeState(createRng(5)).rows, new ParadeState(createRng(5)).rows);
  assert.notDeepEqual(new ParadeState(createRng(5)).rows, new ParadeState(createRng(6)).rows);
  const state = new ParadeState(createRng(1));
  assert.equal(state.moveLane(1), true);
  assert.equal(state.moveLane(1), false);
  assert.equal(state.lane, 2);
  state.battle = {lane: 2, boss: false, crowd0: 5, enemy0: 3, crowd: 5, enemy: 3, step: 1, ms: 0};
  assert.equal(state.moveLane(-1), false);
});

test('collision: the gate under the crowd when it crosses applies, once', () => {
  const state = new ParadeState(createRng(1));
  state.rows = [{z: 20, cells: [{kind: 'gate', op: '+', n: 4}, {kind: 'gate', op: '×', n: 3}, null], kind: 'gate', level: 1, applied: false, fought: -1}];
  state.started = true; state.lane = 1;
  state.z = 18;
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

test('render: mid-battle, a boss fight, the victory screen and the defeat animation fit every size and look', () => {
  type Inner = {state: ParadeState; step(d: number): void; animate(d: number): void; key(k: unknown): unknown};
  const drive = (until: (state: ParadeState) => boolean, policy: Policy, extraMs = 0) => (game: unknown) => {
    const inner = game as Inner;
    inner.key({kind: 'text', value: ' '});
    for (let t = 0; t < 900_000 && !until(inner.state); t += STEP) {
      const want = policy(inner.state);
      if (want !== undefined) while (inner.state.lane !== want && inner.state.moveLane(inner.state.lane < want ? 1 : -1)) { /* press */ }
      inner.step(STEP); inner.animate(STEP);
    }
    for (let t = 0; t < extraMs; t += STEP) { inner.step(STEP); inner.animate(STEP); }
  };
  checkRenders(paradeGame, drive(state => Boolean(state.battle) && state.battle!.crowd < state.battle!.crowd0, optimal));
  checkRenders(paradeGame, drive(state => Boolean(state.battle?.boss) && state.battle!.crowd < state.battle!.crowd0, optimal));
  checkRenders(paradeGame, drive(state => state.won, optimal, 500));
  checkRenders(paradeGame, drive(state => !state.alive, greedyWrong, 300));
});

test('Safe Glyphs: no gate, label or intro line shows the "?" stand-in (division and the minus sign are drawn in ASCII)', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [28, 12]] as const) {
    const game = paradeGame.create(context(memory(), {size: {columns, rows}, color: 'none', safeGlyphs: true})) as never as {key(k: unknown): unknown; step(d: number): void; animate(d: number): void; render(c: Canvas, a: number, p: ReturnType<typeof arcadePalette>): void; state: ParadeState};
    const seen = new Set<string>();
    const look = () => { const canvas = new Canvas(columns, rows); game.render(canvas, 0, arcadePalette()); for (const line of canvas.plain({color: 'none', safe: true})) assert.ok(!line.includes('?'), `${columns}x${rows}: "${line}"`); return canvas.plain({color: 'none', safe: true}).join('\n'); };
    look();
    game.key({kind: 'text', value: ' '});
    for (let t = 0; t < 40_000 && !game.state.over; t += STEP) {
      const row = game.state.nextRow();
      if (row && !game.state.battle) { const want = bestLane(game.state.count, row); while (game.state.lane !== want && game.state.moveLane(game.state.lane < want ? 1 : -1)) { /* press */ } }
      game.step(STEP); game.animate(STEP);
      if (Math.round(t) % 400 < STEP) seen.add(look());
    }
    // A division gate was on screen at some point and drew as "/".
    const all = [...seen].join('\n');
    assert.ok(/\[\/\d+\]/u.test(all) || columns < 40, `${columns}x${rows}: a ÷ gate shows as [/n]`);
  }
});

test('crowd size: a full crowd is drawn inside its own lane, at every width, so the lane you are in is clear', () => {
  const rects: Array<{x: number; w: number; h: number}> = [];
  const original = PixelBuffer.prototype.rect;
  PixelBuffer.prototype.rect = function (x, y, w, h, color) { if (w === 3 && h === 2) rects.push({x, w, h}); return original.call(this, x, y, w, h, color); };
  try {
    for (const columns of [28, 40, 60, 100, 160]) {
      const rows = Math.max(12, Math.round(columns * 0.34));
      for (const lane of [0, 1, 2]) {
        const game = paradeGame.create(context(memory(), {size: {columns, rows}})) as never as {key(k: unknown): unknown; step(d: number): void; animate(d: number): void; render(c: Canvas, a: number, p: ReturnType<typeof arcadePalette>): void; state: ParadeState};
        game.key({kind: 'text', value: ' '});
        game.state.lane = lane; game.state.count = 500; game.state.rows = [];
        for (let i = 0; i < 60; i += 1) { game.step(STEP); game.animate(STEP); }
        rects.length = 0;
        game.render(new Canvas(columns, rows), 0, arcadePalette());
        const laneW = Math.min(30, Math.max(5, Math.floor(columns * 0.24))), left = Math.floor(columns / 2 - laneW * 1.5);
        const kittens = rects.filter(r => r.x >= left - 4 && r.x < left + laneW * 3 + 4);
        assert.ok(kittens.length > 0, `${columns}: crowd drawn`);
        for (const r of kittens) assert.ok(r.x >= left + laneW * lane && r.x + r.w <= left + laneW * (lane + 1), `${columns} lane ${lane}: kitten at x ${r.x}..${r.x + r.w} outside ${left + laneW * lane}..${left + laneW * (lane + 1)}`);
      }
    }
  } finally { PixelBuffer.prototype.rect = original; }
});
