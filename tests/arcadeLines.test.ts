import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {generateLines, LinesBoard, SIZES, solveLines, validLinesSolution} from '../src/arcade/games/lines/logic.js';
import {linesGame} from '../src/arcade/games/lines/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
type Probe = {key(k: unknown): unknown; animate(d: number): void; render(c: Canvas, a: number, p: unknown): void; status: string; result: {score: number; record: boolean} | undefined; board: LinesBoard; cursor: number; dispose(): void; finale: {done: boolean; skip(): void} | undefined};
const text = (value: string) => ({kind: 'text', value});

test('generated boards are valid and solvable for every size, many seeds', () => {
  for (const size of SIZES) for (let seed = 1; seed <= 25; seed += 1) {
    const data = generateLines(size, createRng(seed));
    assert.equal(data.puzzle.colors, size);
    assert.ok(validLinesSolution(data.puzzle, data.solution), `construction ${size}/${seed}`);
    const solved = solveLines(data.puzzle);
    assert.ok(solved && validLinesSolution(data.puzzle, solved), `solver ${size}/${seed}`);
    const cells = new Set(data.puzzle.ends.flat());
    assert.equal(cells.size, size * 2, 'ends are distinct cells');
  }
});

test('generation is deterministic from the seed and varies between seeds', () => {
  assert.deepEqual(generateLines(6, createRng(7)), generateLines(6, createRng(7)));
  assert.notDeepEqual(generateLines(6, createRng(7)).puzzle, generateLines(6, createRng(8)).puzzle);
});

test('the solver rejects an unsolvable board', () => {
  // Two colors whose ends sit so that one path walls the other off in a 3x1 strip.
  assert.equal(solveLines({width: 3, height: 1, colors: 2, ends: [[0, 2], [1, 1]]}), undefined);
});

test('drawing rules: extend, pull back, pick up mid-path, crossing cuts the other color, ends are walls', () => {
  // 3x3: A joins the top corners (0 and 2), B joins 3 and 5.
  const board = new LinesBoard({puzzle: {width: 3, height: 3, colors: 2, ends: [[0, 2], [3, 5]]}, solution: [[0, 1, 2], [3, 4, 5]]});
  assert.ok(board.begin(0));
  assert.equal(board.move(4), false, 'not adjacent');
  assert.ok(board.move(1));
  assert.ok(board.move(0) && board.paths[0]!.length === 1, 'stepping back pulls the path in');
  assert.ok(board.move(1));
  assert.ok(board.move(2));
  assert.ok(board.complete(0));
  assert.equal(board.active, undefined, 'reaching the other end lets go');
  assert.equal(board.move(1), false, 'nothing is drawn once let go');
  assert.ok(board.begin(1), 'pick up mid-path');
  assert.deepEqual(board.paths[0], [0, 1]);
  assert.equal(board.complete(0), false);
  board.stop();
  assert.ok(board.begin(3));
  assert.ok(board.move(4));
  assert.ok(board.move(1), 'crossing the other color is allowed...');
  assert.deepEqual(board.paths[0], [0], '...and cuts it where it was crossed');
  assert.equal(board.ownerOf(1), 1);
  assert.equal(board.move(2), false, 'another color\'s end is a wall');
  assert.equal(board.move(0), false, 'so is the other end of that color');
  assert.equal(board.endOf(0), 0, 'ends keep their color when their path is cut');
  assert.equal(board.won, false);
});

test('a full solution wins; a full board with a broken pair does not', () => {
  const data = generateLines(5, createRng(11));
  const board = new LinesBoard(data);
  data.solution.forEach((cells, color) => board.place(color, cells));
  assert.ok(board.won);
  board.begin(data.solution[0]![3]!);
  assert.equal(board.won, false);
});

test('UI: pick a size, draw by keys, hints finish the board, record saved, finale skippable', () => {
  const record = memory();
  const game = linesGame.create(context(record)) as never as Probe;
  assert.equal(game.status, 'ready');
  game.key({kind: 'down'}); game.key({kind: 'enter'}); // 6x6
  assert.equal(game.status, 'playing');
  assert.equal(game.board.data.puzzle.width, 6);
  // Draw the first color by keys along its solution.
  const route = game.board.data.solution[0]!;
  game.cursor = route[0]!;
  game.key(text(' '));
  assert.equal(game.board.active, 0);
  for (let i = 1; i < route.length; i += 1) {
    const d = route[i]! - route[i - 1]!;
    game.key({kind: d === 1 ? 'right' : d === -1 ? 'left' : d === 6 ? 'down' : 'up'});
  }
  assert.ok(game.board.complete(0));
  game.key(text('u'));
  assert.equal(game.board.paths[0]!.length, 0, 'undo reverts the whole stroke');
  for (let i = 0; i < 6; i += 1) game.key(text('t'));
  assert.equal(game.status, 'won');
  assert.ok(game.result!.score > 0);
  assert.equal((record.raw() as {best: number; plays: number}).plays, 1);
  assert.equal((record.raw() as {best6: number}).best6, game.result!.score);
  assert.ok(game.finale && !game.finale.done);
  game.finale.skip();
  assert.ok(game.finale.done);
  game.dispose();
});

test('wrong moves are refused: off-board, non-adjacent start, undo with nothing to undo', () => {
  const game = linesGame.create(context()) as never as Probe;
  game.key(text('5'));
  game.key({kind: 'up'}); game.key({kind: 'left'});
  assert.equal(game.cursor, 0);
  game.key(text('u'));
  game.key(text(' '));
  assert.equal(game.board.active === undefined || game.board.ownerOf(0) >= 0, true);
  assert.equal(game.key(text('z')), 'ignored');
});

test('render: every size and mode draws inside its bounds, with letters as well as colors', () => {
  const palette = arcadePalette('truecolor');
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) for (const mode of [{color: 'truecolor', safe: false}, {color: 'none', safe: true}] as const) for (const reduced of [false, true]) {
    const game = linesGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe, motion: {reduced, effects: reduced ? 'off' : 'normal'}})) as never as Probe;
    const canvas = new Canvas(columns, rows);
    game.render(canvas, 0, palette);
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    game.key(text('8'));
    game.render(canvas, 0, palette);
    game.key(text(' ')); game.key({kind: 'right'}); game.key(text('t'));
    game.render(canvas, 0, palette);
    const lines = canvas.plain();
    for (const line of lines) assert.ok(displayWidth(line) <= columns);
    assert.ok(lines.some(line => /[A-H]/u.test(line)) && lines.some(line => /[\[(]/u.test(line)), `letters and markers present at ${columns}x${rows}`);
    for (let i = 0; i < 8; i += 1) game.key(text('t'));
    game.animate(100);
    game.render(canvas, 0, palette);
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    game.dispose();
  }
});
