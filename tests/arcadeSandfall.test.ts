import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {MAX_HEIGHT, MAX_WIDTH, SandState, dimensionsFor} from '../src/arcade/games/sandfall/logic.js';
import {sandfallGame} from '../src/arcade/games/sandfall/index.js';
import {displayWidth} from '../src/util/text.js';

const STEP = 1000 / 60;
function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
const fresh = (seed = 1, columns = 100, rows = 34) => new SandState(createRng(seed), dimensionsFor(columns, rows));
const settle = (state: SandState) => { let passes = 0; while (state.settlePass() > 0 && passes < 500) passes += 1; return passes; };

test('size: the well is bounded and fits every terminal size', () => {
  for (const [columns, rows] of [[20, 8], [28, 12], [40, 16], [60, 24], [100, 34], [300, 100]] as const) {
    const d = dimensionsFor(columns, rows);
    assert.ok(d.width <= Math.max(MAX_WIDTH, d.cell * 6) && d.height <= MAX_HEIGHT);
    assert.equal(d.width % d.cell, 0);
    if (columns >= 28) assert.ok(d.width <= columns - 2 && d.height <= 2 * (rows - 2));
  }
});

test('automaton: grains are conserved, nothing floats once at rest, and a heap does not lean to one side', () => {
  const state = fresh();
  const mid = state.width / 2;
  for (let y = 0; y < 30; y += 1) for (let x = mid - 3; x < mid + 3; x += 1) state.grid[y * state.width + x] = 1 + (x + y) % 2;
  const before = state.grains();
  assert.ok(state.floating() > 0);
  settle(state);
  assert.equal(state.grains(), before);
  assert.equal(state.floating(), 0);
  let left = 0, right = 0;
  for (let y = 0; y < state.height; y += 1) for (let x = 0; x < state.width; x += 1) if (state.at(x, y)) { if (x < mid) left += 1; else right += 1; }
  assert.ok(Math.abs(left - right) <= 0.08 * before, `left ${left} right ${right}`);
  assert.ok(right > 0 && left > 0);
  // The heap spread out, so it is wider than the column it fell from.
  const cols = new Set<number>();
  for (let x = 0; x < state.width; x += 1) if (state.at(x, state.height - 1)) cols.add(x);
  assert.ok(cols.size > 6);
});

test('automaton: a lone grain on a slope slides toward the open side', () => {
  const state = fresh();
  const base = (state.height - 1) * state.width;
  state.grid[base + 10] = 2; state.grid[base + 11] = 2; // a two-grain step
  state.grid[(state.height - 2) * state.width + 10] = 3; // on top of the left one, diagonal to open floor at 9
  settle(state);
  assert.equal(state.floating(), 0);
  assert.equal(state.grains(), 3);
  assert.equal(state.at(10, state.height - 2), 0, 'it slid off');
});

test('clears: one color wall to wall clears; a gap, a second color or a missing wall does not', () => {
  const rowOf = (state: SandState, y: number, color: number, skip = -1) => { for (let x = 0; x < state.width; x += 1) if (x !== skip) state.grid[y * state.width + x] = color; };
  const state = fresh();
  const y = state.height - 1;
  rowOf(state, y, 1);
  assert.equal(state.findClears().length, 1);
  assert.equal(state.findClears()[0]!.length, state.width);
  const gap = fresh();
  rowOf(gap, y, 1, 7);
  assert.equal(gap.findClears().length, 0);
  const mixed = fresh();
  rowOf(mixed, y, 1);
  mixed.grid[y * mixed.width + 20] = 2;
  assert.equal(mixed.findClears().length, 0);
  // A diagonal link between two rows still counts as connected.
  const diag = fresh();
  for (let x = 0; x < 24; x += 1) diag.grid[y * diag.width + x] = 3;
  for (let x = 24; x < diag.width; x += 1) diag.grid[(y - 1) * diag.width + x] = 3;
  assert.equal(diag.findClears().length, 1);
  const short = fresh();
  for (let x = 0; x < short.width - 1; x += 1) short.grid[y * short.width + x] = 4;
  assert.equal(short.findClears().length, 0);
});

test('clears: the mass is removed after a flash, scores, leaves the rest and lets the sand above fall', () => {
  const state = fresh();
  const y = state.height - 1;
  for (let x = 0; x < state.width; x += 1) state.grid[y * state.width + x] = 1;
  for (let x = 10; x < 14; x += 1) state.grid[(y - 1) * state.width + x] = 2;
  state.piece = undefined;
  state.phase = 'settle';
  const total = state.grains();
  let cleared = 0;
  for (let i = 0; i < 120 && state.clears === 0; i += 1) state.step(STEP);
  for (const event of state.events) if (event.kind === 'clear') cleared += event.grains.length;
  assert.equal(state.clears, 1);
  assert.equal(cleared, state.width);
  assert.equal(state.grains(), total - state.width);
  assert.ok(state.score >= state.width);
  for (let i = 0; i < 20; i += 1) state.step(STEP);
  assert.equal(state.floating(), 0);
  assert.equal(state.at(10, y), 2, 'the sand above dropped to the floor');
});

test('pieces: a landed piece becomes four cells of grains of its color; walls and rotation keep it inside', () => {
  const state = fresh(5);
  const piece = state.piece!;
  const color = piece.color;
  for (let i = 0; i < 40; i += 1) state.shift(-1);
  assert.equal(state.piece!.x, 0 - Math.min(...state.piece!.cells.map(c => c[0])) * state.cell + (state.piece!.x - (state.piece!.x)));
  for (let i = 0; i < 20; i += 1) { state.rotate(1); for (const [cx] of state.piece!.cells) assert.ok(state.piece!.x + cx * state.cell >= 0 && state.piece!.x + (cx + 1) * state.cell <= state.width); }
  state.hardDrop();
  assert.equal(state.grains(), 4 * state.cell * state.cell);
  for (const g of state.grid) assert.ok(g === 0 || g === color);
  assert.equal(state.phase, 'settle');
});

test('rules: the game ends when the next piece cannot be placed', () => {
  const state = fresh(2);
  for (let y = 0; y < state.height; y += 1) for (let x = 0; x < state.width; x += 1) state.grid[y * state.width + x] = 1 + (x >> 2) % 2;
  assert.equal(state.findClears().length, 0);
  state.piece = undefined;
  state.phase = 'settle';
  for (let i = 0; i < 60 && !state.over; i += 1) state.step(STEP);
  assert.ok(state.over);
  assert.ok(state.events.some(e => e.kind === 'over'));
});

/** Plays hard drops at pseudo-random columns and turns until the well tops out; checks the invariants all the way. */
function bot(seed: number, chunk: number): {state: SandState; log: string} {
  const state = fresh(seed, 60, 24);
  const aim = createRng(seed + 100);
  let landed = 0, cleared = 0, guard = 0;
  while (!state.over && guard < 20000) {
    guard += 1;
    if (state.phase === 'fall' && state.piece && state.piece.y === 0) {
      assert.equal(state.floating(), 0, 'at rest between pieces');
      for (let t = aim.int(0, 3); t > 0; t -= 1) state.rotate(1);
      const target = aim.int(0, state.width / state.cell - 1) * state.cell;
      for (let n = 0; n < 40 && state.piece.x !== target; n += 1) state.shift(state.piece.x < target ? 1 : -1);
      state.hardDrop();
      landed += 1;
    }
    state.step(chunk);
    for (const e of state.events.splice(0)) if (e.kind === 'clear') cleared += e.grains.length;
    assert.equal(state.grains(), (landed - (state.over && !state.piece ? 0 : 0)) * 4 * state.cell * state.cell - cleared, 'grains conserved except clears');
  }
  assert.ok(state.over, 'the bot eventually tops out');
  return {state, log: `${state.score}|${state.clears}|${state.pieces}|${Buffer.from(state.grid).toString('base64')}`};
}

test('invariants and determinism: conservation through a whole game, same seed same game, any time split', () => {
  const a = bot(3, STEP);
  const b = bot(3, STEP);
  assert.equal(a.log, b.log);
  const c = bot(3, 5);
  assert.equal(c.log, a.log, 'frame-split independent');
  assert.notEqual(bot(4, STEP).log, a.log);
});

type Driven = {key(k: unknown): unknown; step(d: number): void; animate(d: number): void; status: string; result: {score: number; record: boolean} | undefined; dispose(): void; resize(s: {columns: number; rows: number}): void; render(c: Canvas, a: number, p: unknown): void};

test('game: keys play, the run ends with a saved record and keys are ignored afterward', () => {
  const record = memory();
  const game = sandfallGame.create(context(record)) as unknown as Driven;
  assert.equal(game.status, 'ready');
  assert.equal(game.key({kind: 'text', value: 'q'}), 'ignored');
  assert.equal(game.key({kind: 'left'}), 'handled');
  assert.equal(game.status, 'playing');
  for (const k of [{kind: 'right'}, {kind: 'up'}, {kind: 'down'}, {kind: 'text', value: 'z'}, {kind: 'text', value: 'x'}, {kind: 'text', value: 'a'}, {kind: 'text', value: 'd'}]) assert.equal(game.key(k), 'handled');
  for (let i = 0; i < 20000 && game.status !== 'over'; i += 1) {
    if (i % 30 === 0) { game.key({kind: i % 60 === 0 ? 'left' : 'right'}); game.key({kind: 'text', value: ' '}); }
    game.step(STEP); game.animate(STEP);
  }
  assert.equal(game.status, 'over');
  assert.ok(game.result && game.result.score > 0);
  assert.equal(game.result.record, true);
  assert.equal(record.raw().best, game.result.score);
  assert.equal(record.raw().plays, 1);
  assert.equal(game.key({kind: 'left'}), 'ignored');
  game.dispose();
});

test('game: a score under the saved best is not a record and keeps the best', () => {
  const record = memory({best: 999999, plays: 2});
  const game = sandfallGame.create(context(record)) as unknown as Driven;
  game.key({kind: 'text', value: ' '});
  for (let i = 0; i < 20000 && game.status !== 'over'; i += 1) { if (i % 30 === 0) { game.key({kind: i % 60 === 0 ? 'left' : 'right'}); game.key({kind: 'text', value: ' '}); } game.step(STEP); }
  assert.equal(game.result?.record, false);
  assert.equal(record.raw().best, 999999);
  assert.equal(record.raw().plays, 3);
});

test('render: every size draws inside its bounds with and without color, safe glyphs and reduced motion', () => {
  const variants: Array<Partial<GameContext>> = [
    {color: 'truecolor'}, {color: 'none', safeGlyphs: true}, {color: 'truecolor', motion: {reduced: true, effects: 'off'}}, {color: 'none'}, {color: 'truecolor', safeGlyphs: true},
  ];
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) {
    for (const variant of variants) {
      const game = sandfallGame.create(context(memory(), {size: {columns, rows}, ...variant})) as unknown as Driven;
      game.key({kind: 'text', value: ' '});
      for (let i = 0; i < 1500; i += 1) {
        if (i % 25 === 0) { game.key({kind: i % 50 === 0 ? 'left' : 'right'}); game.key({kind: 'text', value: ' '}); }
        game.step(STEP); game.animate(STEP);
        if (i % 100 === 0) {
          const canvas = new Canvas(columns, rows);
          game.render(canvas, 0.5, arcadePalette());
          for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns, `${columns}x${rows} ${JSON.stringify(variant)}`);
        }
      }
      const canvas = new Canvas(columns, rows);
      game.render(canvas, 0.5, arcadePalette());
      const lines = canvas.plain({color: 'none', safe: variant.safeGlyphs === true});
      for (const line of lines) assert.ok(displayWidth(line) <= columns);
      if (variant.color === 'none' && variant.safeGlyphs) assert.ok(lines.some(line => /[#%+:]{3}/u.test(line)), 'sand drawn with ASCII glyphs');
      game.resize({columns: 40, rows: 16});
      game.render(new Canvas(40, 16), 0, arcadePalette());
      game.dispose();
    }
  }
});

test('definition: id, category, summary and preview', () => {
  assert.equal(sandfallGame.id, 'sandfall');
  assert.equal(sandfallGame.category, 'falling');
  assert.equal(sandfallGame.summary({}), 'Not played yet');
  assert.match(sandfallGame.summary({best: 900, plays: 1, bestClears: 4}), /Best 900/u);
  sandfallGame.preview(new Canvas(40, 10), 9, arcadePalette());
});
