import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {BOARD, EscapeBoard, generate, isGoal, LEVELS, occupancy, solve, type Car, type Level} from '../src/arcade/games/escape/logic.js';
import {escapeGame, readEscape} from '../src/arcade/games/escape/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
type Handle = {key(k: unknown): string; animate(d: number): void; status: string; result: {record: boolean; score: number} | undefined; board: EscapeBoard; selected: number; tip: string; finale: {done: boolean; skip(): void} | undefined; dispose(): void};

/** A small hand-made board: A at column 0 of row 2, a vertical car B blocking at column 3. */
const CARS: Car[] = [{len: 2, horizontal: true, lane: 2}, {len: 2, horizontal: false, lane: 3}];

test('rules: cars slide along their axis one cell at a time and cannot pass each other or the edge', () => {
  const board = new EscapeBoard(CARS, [0, 1], 6);
  assert.equal(board.step(0, 1), true);
  assert.equal(board.step(0, 1), false, 'B is in the way');
  assert.equal(board.step(1, 1), true);
  assert.equal(board.step(1, -1), true);
  assert.equal(board.step(1, -1), true);
  assert.equal(board.step(1, -1), false, 'top edge');
  assert.equal(board.moves, 4);
  assert.equal(board.step(0, -1), true);
  assert.equal(board.step(0, -1), false, 'left edge');
});

test('solver: shortest solutions are optimal and replay to the goal; hint is the first step; undo restores', () => {
  const path = solve(CARS, [0, 1])!;
  assert.equal(path.length, 5, 'B steps up once, then A crosses four cells');
  const layout = [0, 1];
  for (const {car, delta} of path) { layout[car]! += delta; }
  assert.ok(isGoal(CARS, layout));
  const board = new EscapeBoard(CARS, [0, 1], path.length);
  assert.deepEqual(board.hint(), path[0]);
  board.step(path[0]!.car, path[0]!.delta);
  assert.equal(board.hint() !== undefined, true);
  assert.equal(board.undo(), true);
  assert.equal(board.moves, 0);
  assert.equal(board.undo(), false);
  assert.deepEqual(solve(CARS, [4, 1]), [], 'already at the exit');
});

test('generation: boards over many seeds are valid, collision free, solvable, at their level minimum, and deterministic', () => {
  const floors: Record<Level, number> = {easy: 5, medium: 9, hard: 12};
  const seeds: Record<Level, number> = {easy: 30, medium: 3, hard: 1};
  for (const level of Object.keys(LEVELS) as Level[]) for (let seed = 1; seed <= seeds[level]; seed += 1) {
    const puzzle = generate(level, createRng(seed));
    const grid = occupancy(puzzle.cars, puzzle.start);
    assert.equal(grid.filter(cell => cell >= 0).length, puzzle.cars.reduce((sum, car) => sum + car.len, 0), 'no overlapping cars');
    for (const [index, car] of puzzle.cars.entries()) assert.ok(puzzle.start[index]! >= 0 && puzzle.start[index]! + car.len <= BOARD);
    assert.ok(puzzle.cars.slice(1).every(car => !(car.horizontal && car.lane === 2)), 'the exit row has no other horizontal car');
    const path = solve(puzzle.cars, puzzle.start)!;
    assert.ok(path, `${level} ${seed} is solvable`);
    assert.equal(path.length, puzzle.minMoves);
    assert.ok(puzzle.minMoves >= floors[level], `${level} ${seed}: ${puzzle.minMoves}`);
    assert.ok(!isGoal(puzzle.cars, puzzle.start));
    assert.deepEqual(puzzle, generate(level, createRng(seed)));
  }
});

test('playing: select, move, hint, undo, restart; solving records the best and plays the finale', () => {
  const record = memory();
  const game = escapeGame.create(context(record)) as never as Handle;
  assert.equal(game.status, 'ready');
  game.key({kind: 'text', value: '1'});
  assert.equal(game.status, 'playing');
  assert.equal(game.selected, 0);
  game.key({kind: 'text', value: ' '});
  assert.equal(game.selected, 1);
  game.key({kind: 'text', value: '?'});
  assert.match(game.tip, /^Hint: move [A-Z] (up|down|left|right)$/);
  const step = game.board.hint()!;
  assert.equal(game.selected, step.car);
  const horizontal = game.board.cars[step.car]!.horizontal;
  game.key({kind: horizontal ? (step.delta < 0 ? 'left' : 'right') : (step.delta < 0 ? 'up' : 'down')});
  assert.equal(game.board.moves, 1);
  assert.equal(game.key({kind: 'text', value: 'u'}), 'handled');
  assert.equal(game.board.moves, 0);
  game.key({kind: 'text', value: 'r'});
  // Follow the optimal path through the keys.
  let guard = 0;
  while (game.status === 'playing' && guard++ < 200) {
    const next = game.board.hint()!;
    game.key({kind: 'text', value: '?'});
    const h = game.board.cars[next.car]!.horizontal;
    game.key({kind: h ? (next.delta < 0 ? 'left' : 'right') : (next.delta < 0 ? 'up' : 'down')});
  }
  assert.equal(game.status, 'won');
  assert.ok(game.finale);
  game.animate(4000);
  game.finale!.skip();
  assert.equal(game.result!.record, true);
  assert.equal(game.result!.score, game.board.par);
  assert.equal(readEscape(record.raw()).best.easy, game.board.par);
  assert.equal(readEscape(record.raw()).wins, 1);
  game.dispose();
});

test('a worse run keeps the best; wrong-axis arrows are ignored', () => {
  const record = memory({bestEasy: 1, plays: 1, wins: 1});
  const game = escapeGame.create(context(record)) as never as Handle;
  game.key({kind: 'text', value: '1'});
  assert.equal(game.key({kind: 'up'}), 'ignored', 'A is horizontal');
  let guard = 0;
  while (game.status === 'playing' && guard++ < 200) {
    const next = game.board.hint()!;
    game.key({kind: 'text', value: '?'});
    const h = game.board.cars[next.car]!.horizontal;
    game.key({kind: h ? (next.delta < 0 ? 'left' : 'right') : (next.delta < 0 ? 'up' : 'down')});
  }
  assert.equal(game.result!.record, false);
  assert.equal(readEscape(record.raw()).best.easy, 1);
  assert.equal(readEscape(record.raw()).plays, 2);
});

test('render: every size draws inside its bounds, in color, without color and with reduced motion, and every car shows its letter', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) {
    for (const mode of [{color: 'truecolor' as const, safe: false, reduced: false}, {color: 'none' as const, safe: true, reduced: false}, {color: 'truecolor' as const, safe: false, reduced: true}]) {
      for (const choice of columns === 100 ? ['0', '1', '2'] : ['0', '1']) {
        const game = escapeGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe, motion: {reduced: mode.reduced, effects: mode.reduced ? 'off' : 'normal'}})) as never as Handle;
        if (choice !== '0') game.key({kind: 'text', value: choice});
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0, arcadePalette());
        const lines = canvas.plain({color: mode.color, safe: mode.safe});
        for (const line of lines) assert.ok(displayWidth(line) <= columns, `${columns}x${rows} ${choice}`);
        if (choice !== '0') {
          const text = lines.join('\n');
          for (let car = 0; car < game.board.cars.length; car += 1) assert.ok(text.includes(car === 0 ? 'A' : 'BCDEFGHIJKLMNOPQRSTUVWXYZ'[car - 1]!), `car ${car} labelled`);
        }
        if (mode.safe) for (const row of canvas.rows({color: 'none', safe: true})) assert.match(row, /^[\x20-\x7e\u001b[0-9;m]*$/u);
        game.dispose();
      }
    }
  }
});

test('win render is bounded with and without reduced motion', () => {
  for (const reduced of [false, true]) {
    const game = escapeGame.create(context(memory(), {size: {columns: 40, rows: 16}, motion: {reduced, effects: reduced ? 'off' : 'normal'}})) as never as Handle;
    game.key({kind: 'text', value: '1'});
    let guard = 0;
    while (game.status === 'playing' && guard++ < 200) {
      const next = game.board.hint()!;
      game.key({kind: 'text', value: '?'});
      const h = game.board.cars[next.car]!.horizontal;
      game.key({kind: h ? (next.delta < 0 ? 'left' : 'right') : (next.delta < 0 ? 'up' : 'down')});
    }
    for (let index = 0; index < 5; index += 1) { game.animate(150); const canvas = new Canvas(40, 16); game.render(canvas, 0, arcadePalette()); for (const line of canvas.plain()) assert.ok(displayWidth(line) <= 40); }
    game.dispose();
  }
});
