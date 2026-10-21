import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {CircuitBoard, E, generateCircuit, litCells, lampsLit, N, rotateMask, S, SIZES, turnsTo, W, wireCount} from '../src/arcade/games/circuit/logic.js';
import {circuitGame} from '../src/arcade/games/circuit/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
type Probe = {key(k: unknown): unknown; animate(d: number): void; render(c: Canvas, a: number, p: unknown): void; status: string; result: {score: number; record: boolean} | undefined; board: CircuitBoard; cursor: number; dispose(): void; finale: {done: boolean; skip(): void} | undefined};
const text = (value: string) => ({kind: 'text', value});

test('rotation turns wires a quarter clockwise and four turns return', () => {
  assert.equal(rotateMask(N), E); assert.equal(rotateMask(E), S); assert.equal(rotateMask(S), W); assert.equal(rotateMask(W), N);
  assert.equal(rotateMask(N | E), E | S);
  for (let mask = 0; mask < 16; mask += 1) { assert.equal(rotateMask(mask, 4), mask); assert.equal(wireCount(rotateMask(mask)), wireCount(mask)); }
  assert.equal(turnsTo(N | S, E | W), 1);
  assert.equal(turnsTo(N, N | E), -1);
});

test('current needs wires on both sides of an edge (real connectivity)', () => {
  const shape = {width: 3, height: 1};
  assert.deepEqual([...litCells(shape, 0, [E, W | E, W])], [1, 1, 1]);
  assert.deepEqual([...litCells(shape, 0, [E, W, W])], [1, 1, 0], 'a wire that points at a dead side does not conduct');
  assert.deepEqual([...litCells(shape, 0, [E, N | S, W])], [1, 0, 0], 'a turned tile blocks the line');
  assert.deepEqual([...litCells(shape, 0, [0, W | E, W])], [1, 0, 0], 'the source with no wire lights nothing');
  assert.equal(lampsLit(shape, 0, [2], [E, W | E, W]), true);
});

test('generated boards: connected tree, solvable, scrambled, lamps are leaves; many seeds', () => {
  for (const size of SIZES) for (let seed = 1; seed <= 40; seed += 1) {
    const data = generateCircuit(size, createRng(seed));
    const shape = {width: size, height: size};
    const full = litCells(shape, data.source, data.solution);
    assert.ok(full.every(value => value === 1), 'the solution lights every tile');
    assert.ok(data.lamps.length >= 1);
    assert.ok(data.lamps.every(lamp => wireCount(data.solution[lamp]!) === 1 && lamp !== data.source));
    assert.ok(lampsLit(shape, data.source, data.lamps, data.solution));
    assert.equal(lampsLit(shape, data.source, data.lamps, data.start), false, 'the scramble is not already solved');
    assert.ok(data.start.every((mask, cell) => turnsTo(mask, data.solution[cell]!) >= 0), 'start is a rotation of the solution');
    // Wires are consistent: an edge wire exists on both tiles.
    for (let cell = 0; cell < size * size; cell += 1) {
      const x = cell % size;
      if (data.solution[cell]! & E) assert.ok(x < size - 1 && data.solution[cell + 1]! & W);
      if (data.solution[cell]! & S) assert.ok(cell + size < size * size && data.solution[cell + size]! & N);
    }
  }
});

test('generation is deterministic', () => {
  assert.deepEqual(generateCircuit(6, createRng(5)), generateCircuit(6, createRng(5)));
  assert.notDeepEqual(generateCircuit(6, createRng(5)), generateCircuit(6, createRng(6)));
});

test('board: rotating by the shortest turns to the solution wins; undo restores; symmetric tiles do not count', () => {
  const data = generateCircuit(5, createRng(21));
  const board = new CircuitBoard(data);
  assert.equal(board.won, false);
  const before = board.masks.slice();
  const cell = board.masks.findIndex(mask => rotateMask(mask) !== mask);
  assert.ok(board.rotate(cell));
  assert.equal(board.undo(), true);
  assert.deepEqual(board.masks, before);
  assert.equal(board.undo(), false);
  const cross = new CircuitBoard({...data, start: data.start.map(() => 15)});
  assert.equal(cross.rotate(0), false);
  let turns = 0;
  for (let c = 0; c < board.masks.length; c += 1) for (let k = turnsTo(board.masks[c]!, data.solution[c]!); k > 0; k -= 1) { board.rotate(c); turns += 1; }
  assert.ok(board.won);
  assert.equal(turns, board.minimum);
});

test('UI: turning, hints, win, record, finale; Space on a symmetric tile is refused', () => {
  const record = memory();
  const game = circuitGame.create(context(record)) as never as Probe;
  assert.equal(game.status, 'ready');
  game.key(text('5'));
  assert.equal(game.status, 'playing');
  assert.equal(game.cursor, game.board.data.source);
  const before = game.board.masks[game.cursor]!;
  game.key(text(' '));
  assert.equal(game.board.masks[game.cursor], rotateMask(before));
  game.key(text('e'));
  assert.equal(game.board.masks[game.cursor], before);
  game.key({kind: 'right'});
  assert.equal(game.cursor, game.board.data.source + 1 < 25 && game.board.data.source % 5 < 4 ? game.board.data.source + 1 : game.cursor);
  for (let i = 0; i < 40 && game.status !== 'won'; i += 1) game.key(text('t'));
  assert.equal(game.status, 'won');
  assert.ok(game.result!.score >= 10);
  assert.equal((record.raw() as {plays: number}).plays, 1);
  assert.ok(game.finale && !game.finale.done);
  game.finale.skip();
  assert.ok(game.finale.done);
  game.dispose();
});

test('render: all sizes and modes stay inside bounds; lit vs unlit differ without color', () => {
  const palette = arcadePalette('truecolor');
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) for (const mode of [{color: 'truecolor', safe: false}, {color: 'none', safe: true}] as const) for (const reduced of [false, true]) {
    const game = circuitGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe, motion: {reduced, effects: reduced ? 'off' : 'normal'}})) as never as Probe;
    const canvas = new Canvas(columns, rows);
    game.render(canvas, 0, palette);
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    game.key(text('8'));
    game.render(canvas, 0, palette);
    const boardOnly = (c: Canvas) => c.plain().filter(line => !/lamp|source|Circuit/iu.test(line)).join('\n');
    const unsolved = boardOnly(canvas);
    assert.ok(/[o○]/u.test(unsolved), 'an unlit lamp marker is drawn');
    assert.ok(/[S◆]/u.test(unsolved), 'a source marker is drawn');
    game.key(text(' ')); game.key({kind: 'down'});
    for (let i = 0; i < 80 && game.status !== 'won'; i += 1) game.key(text('t'));
    game.render(canvas, 0, palette);
    const solved = boardOnly(canvas);
    assert.ok(!/[o○]/u.test(solved), 'no dark lamp is left');
    assert.ok(/[*◉]/u.test(solved), 'lit lamps are marked');
    assert.notEqual(solved, unsolved);
    game.animate(100);
    game.render(canvas, 0, palette);
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    game.dispose();
  }
});
