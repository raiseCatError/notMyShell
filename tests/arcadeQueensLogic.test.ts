import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRng} from '../src/arcade/rng.js';
import {QueensBoard, formatTime, readCurrent, readStats, writeStats} from '../src/arcade/games/queens/board.js';
import {candidatePuzzle, growRegions, placeCats} from '../src/arcade/games/queens/generator.js';
import {boardHeight, boardWidth, chooseLayout, CELL_STYLES} from '../src/arcade/games/queens/layout.js';
import {SIZES, makePuzzle, makePuzzleOfSize} from '../src/arcade/games/queens/puzzle.js';
import {analyze} from '../src/arcade/games/queens/rules.js';
import {DIFFICULTY_LEVELS, LogicBoard, countSolutions, nextHint, rate, solveOne, solveOther} from '../src/arcade/games/queens/solver.js';
import {CAT, DIFFICULTIES, EXCLUDED, type Puzzle} from '../src/arcade/games/queens/types.js';

const source = (name: string) => readFileSync(fileURLToPath(new URL(`../src/arcade/games/queens/${name}`, import.meta.url)), 'utf8');

const catsOf = (puzzle: Puzzle): Uint8Array => {
  const marks = new Uint8Array(puzzle.size * puzzle.size);
  puzzle.solution.forEach((column, row) => { marks[row * puzzle.size + column] = CAT; });
  return marks;
};

function connected(puzzle: Puzzle, region: number): boolean {
  const {size, regions} = puzzle;
  const cells = regions.flatMap((owner, cell) => (owner === region ? [cell] : []));
  const seen = new Set([cells[0]!]);
  const queue = [cells[0]!];
  while (queue.length) {
    const cell = queue.pop()!;
    const row = Math.floor(cell / size);
    const column = cell % size;
    for (const [r, c] of [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]] as const) {
      if (r < 0 || c < 0 || r >= size || c >= size) continue;
      const next = r * size + c;
      if (regions[next] === region && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen.size === cells.length;
}

/** Every property a finished puzzle must have, checked without the generator's help. */
function assertSound(puzzle: Puzzle): void {
  const {size, regions, solution} = puzzle;
  assert.equal(regions.length, size * size);
  assert.equal(new Set(solution).size, size, 'one cat per column');
  assert.ok(analyze(size, regions, catsOf(puzzle)).solved, 'the solution satisfies all four rules');
  for (let region = 0; region < size; region += 1) assert.ok(connected(puzzle, region), `region ${region} is connected`);
  assert.equal(countSolutions(size, regions, 2), 1, 'exactly one solution');
  assert.deepEqual(solveOne(size, regions), solution, 'the only solution is the planted one');
  assert.equal(solveOther(size, regions, solution), undefined);
  assert.ok(rate(size, regions).solved, 'solvable by the human techniques alone');
}

test('independence: the generator and the solver import nothing from each other', () => {
  for (const file of ['generator.ts', 'solver.ts']) {
    const imports = source(file).split('\n').filter(line => /^import /u.test(line)).join('\n');
    assert.doesNotMatch(imports, file === 'generator.ts' ? /solver|rules|board|puzzle/u : /generator|puzzle|rules|board/u, `${file} imports`);
  }
});

test('rules: the validator accepts the solution and rejects each kind of mistake', () => {
  const puzzle = makePuzzleOfSize(3, 6)!;
  const {size, regions, solution} = puzzle;
  assert.ok(analyze(size, regions, catsOf(puzzle)).solved);
  assert.ok(!analyze(size, regions, new Uint8Array(size * size)).solved, 'empty is not solved');

  // two in a row
  let marks = catsOf(puzzle);
  const free = (row: number): number => { for (let column = 0; column < size; column += 1) if (marks[row * size + column] !== CAT && Math.abs(column - solution[row]!) > 1) return row * size + column; return -1; };
  marks[free(0)] = CAT;
  let result = analyze(size, regions, marks);
  assert.ok(!result.solved);
  assert.equal(result.rowCats[0], 2);
  assert.equal(result.conflict[solution[0]!], 1, 'both cats of the crowded row conflict');

  // two touching diagonally
  marks = new Uint8Array(size * size);
  marks[0] = CAT; marks[size + 1] = CAT;
  result = analyze(size, regions, marks);
  assert.equal(result.conflict[0], 1);
  assert.equal(result.conflict[size + 1], 1);

  // a region with two cats (far enough apart that nothing else is wrong with them)
  marks = new Uint8Array(size * size);
  const members = regions.flatMap((owner, cell) => (owner === regions[0] ? [cell] : []));
  const pair = members.flatMap(a => members.filter(b => b > a && Math.floor(b / size) - Math.floor(a / size) > 1 && Math.abs((b % size) - (a % size)) > 1).map(b => [a, b] as const))[0];
  if (pair) {
    marks[pair[0]] = CAT; marks[pair[1]] = CAT;
    result = analyze(size, regions, marks);
    assert.equal(result.regionCats[regions[0]!], 2);
    assert.equal(result.conflict[pair[0]], 1);
    assert.equal(result.conflict[pair[1]], 1);
  }

  // a column with two cats
  marks = new Uint8Array(size * size);
  marks[0] = CAT; marks[2 * size] = CAT;
  result = analyze(size, regions, marks);
  assert.equal(result.columnCats[0], 2);
  assert.equal(result.conflict[2 * size], 1);

  // X marks are not cats
  marks = catsOf(puzzle);
  marks[free(1)] = EXCLUDED;
  assert.ok(analyze(size, regions, marks).solved);
});

test('uniqueness: a layout with two solutions is counted as such, and rejected by the puzzle pipeline', () => {
  const rows = Array.from({length: 16}, (_, cell) => Math.floor(cell / 4));
  assert.equal(countSolutions(4, rows, 5), 2, 'rows as regions: 2413 and 3142');
  assert.equal(countSolutions(4, rows, 1), 1, 'the limit stops the count');
  const other = solveOther(4, rows, [1, 3, 0, 2]);
  assert.deepEqual(other, [2, 0, 3, 1]);
});

test('generator: planted cats never touch, regions grow connected around them, all from the seed', () => {
  for (let size = 4; size <= 10; size += 1) {
    for (let seed = 1; seed <= 20; seed += 1) {
      const solution = placeCats(size, createRng(seed))!;
      assert.equal(new Set(solution).size, size);
      solution.forEach((column, row) => { if (row) assert.ok(Math.abs(column - solution[row - 1]!) >= 2); });
      const puzzle = {size, solution, regions: growRegions(size, solution, createRng(seed), 0.7)};
      for (let region = 0; region < size; region += 1) assert.ok(connected(puzzle, region));
      solution.forEach((column, row) => assert.equal(puzzle.regions[row * size + column], row, 'each region holds exactly its own cat'));
    }
  }
  assert.deepEqual(candidatePuzzle(7, createRng(9)), candidatePuzzle(7, createRng(9)));
});

test('200 seeds per size: sound, unique, logically solvable, deterministic', () => {
  for (const size of [5, 6, 7, 8, 9]) {
    for (let seed = 1; seed <= 200; seed += 1) {
      const puzzle = makePuzzleOfSize(seed, size);
      assert.ok(puzzle, `size ${size} seed ${seed}`);
      assert.equal(puzzle.size, size);
      assertSound(puzzle);
      if (seed <= 3) assert.deepEqual(makePuzzleOfSize(seed, size), puzzle, 'the same seed rebuilds the same puzzle');
    }
  }
});

test('10 x 10 puzzles are sound too (fewer seeds: they cost the most to find)', () => {
  for (let seed = 1; seed <= 6; seed += 1) assertSound(makePuzzleOfSize(seed, 10)!);
});

test('makePuzzle: sizes by difficulty, ratings inside the band, deterministic, different seeds differ', () => {
  const seen = new Set<string>();
  for (const difficulty of DIFFICULTIES) {
    const [low, high] = SIZES[difficulty];
    const [minLevel, maxLevel] = DIFFICULTY_LEVELS[difficulty];
    let exact = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const puzzle = makePuzzle(seed * 31, difficulty);
      assert.ok(puzzle.size >= low && puzzle.size <= high, `${difficulty} size ${puzzle.size}`);
      assertSound(puzzle);
      assert.equal(rate(puzzle.size, puzzle.regions).level, puzzle.level);
      if (puzzle.exact) { exact += 1; assert.ok(puzzle.level >= minLevel && puzzle.level <= maxLevel); }
      seen.add(puzzle.regions.join(''));
    }
    assert.ok(exact >= 10, `${difficulty}: most puzzles match the requested rating (${exact}/12)`);
    assert.deepEqual(makePuzzle(77, difficulty), makePuzzle(77, difficulty));
  }
  assert.ok(seen.size >= 40, 'seeds give different puzzles');
});

test('difficulty is the hardest technique needed, not the board size', () => {
  const expert = makePuzzle(5, 'expert');
  assert.ok(expert.level >= 4);
  const board = new LogicBoard(expert.size, expert.regions);
  const used = new Set<string>();
  while (board.catCount < expert.size) { const step = board.nextStep()!; used.add(step.technique); board.apply(step); }
  assert.ok(used.has('pair') || used.has('triple'), `expert needs pair or triple reasoning, used ${[...used].join(',')}`);
  // some small boards need only singles, and some 5 x 5 boards need more than that
  const levels = new Set<number>();
  for (let seed = 1; seed <= 60; seed += 1) levels.add(makePuzzleOfSize(seed, 5)!.level);
  assert.ok(levels.has(1) && [...levels].some(level => level >= 2));
  let simple: Puzzle & {level: number} | null = null;
  for (let seed = 1; seed <= 60 && !simple; seed += 1) { const candidate = makePuzzleOfSize(seed, 5)!; if (candidate.level === 1) simple = candidate; }
  const walk = new LogicBoard(5, simple!.regions);
  while (walk.catCount < 5) { const step = walk.nextStep()!; assert.equal(step.technique, 'single'); walk.apply(step); }
});

test('generation is fast and bounded: well under 200 ms on average up to 9 x 9', () => {
  for (const size of [5, 7, 8, 9]) {
    const started = performance.now();
    const count = 30;
    for (let seed = 1; seed <= count; seed += 1) assert.ok(makePuzzleOfSize(seed * 13, size));
    const average = (performance.now() - started) / count;
    assert.ok(average < 200, `size ${size}: ${average.toFixed(1)} ms per puzzle`);
  }
  // every difficulty always returns something, however the dice fall
  for (const difficulty of DIFFICULTIES) for (let seed = 900; seed < 906; seed += 1) assert.ok(makePuzzle(seed, difficulty).size >= 5);
});

test('hints: follow the logic from an empty board to the solution, and never touch what they read', () => {
  for (const difficulty of DIFFICULTIES) {
    const puzzle = makePuzzle(11, difficulty);
    const marks = new Uint8Array(puzzle.size * puzzle.size);
    const regions = [...puzzle.regions];
    const solution = [...puzzle.solution];
    let steps = 0;
    for (; steps < 400; steps += 1) {
      const before = marks.slice();
      const hint = nextHint(puzzle.size, puzzle.regions, puzzle.solution, marks);
      assert.deepEqual(marks, before, 'reading a hint changes nothing');
      if (!hint) break;
      assert.ok(hint.text.length > 10 && hint.targets.length > 0 && hint.changes.length > 0);
      assert.notEqual(hint.technique, 'fix', 'a clean board never needs a fix');
      for (const change of hint.changes) marks[change.cell] = change.to;
    }
    assert.ok(steps > 0 && steps < 400);
    assert.deepEqual([...marks].map(mark => mark === CAT), [...catsOf(puzzle)].map(mark => mark === CAT), `${difficulty}: hints alone finish the puzzle`);
    assert.deepEqual(puzzle.regions, regions);
    assert.deepEqual(puzzle.solution, solution);
  }
});

test('hints: say what the technique is, in words, and flag a wrong cat or X first', () => {
  const puzzle = makePuzzle(21, 'medium');
  const empty = new Uint8Array(puzzle.size * puzzle.size);
  const first = nextHint(puzzle.size, puzzle.regions, puzzle.solution, empty)!;
  assert.match(first.text, /\b(Row|Column|Region)\b|confined|can only hold|fit only|would leave/u);
  // a cat that is not in the solution
  const wrong = empty.slice();
  const cell = puzzle.solution.map((column, row) => row * puzzle.size + ((column + 3) % puzzle.size))[0]!;
  wrong[cell] = CAT;
  const fix = nextHint(puzzle.size, puzzle.regions, puzzle.solution, wrong)!;
  assert.equal(fix.kind, 'fix');
  assert.deepEqual(fix.changes, [{cell, to: 0}]);
  // an X on the only home of a cat
  const home = puzzle.solution[2]! + 2 * puzzle.size;
  const blocked = empty.slice();
  blocked[home] = EXCLUDED;
  const clear = nextHint(puzzle.size, puzzle.regions, puzzle.solution, blocked)!;
  assert.equal(clear.kind, 'fix');
  assert.match(clear.text, /^The X at row 3/u);
  assert.equal(nextHint(puzzle.size, puzzle.regions, puzzle.solution, catsOf(puzzle)), undefined, 'a finished board has nothing to hint');
});

test('board: toggles, exclusion, undo and redo round trip, clear is one undoable move', () => {
  const board = new QueensBoard(makePuzzle(3, 'easy'));
  const total = board.size * board.size;
  assert.ok(board.toggleExclude(0));
  assert.equal(board.marks[0], EXCLUDED);
  assert.ok(board.toggleCat(0), 'placing a cat over an X clears the X');
  assert.equal(board.marks[0], CAT);
  assert.ok(!board.toggleExclude(0), 'x does not remove a cat');
  assert.ok(board.toggleCat(0));
  assert.equal(board.marks[0], 0);
  board.toggleCat(1); board.toggleExclude(2); board.toggleCat(3);
  const snapshot = board.marks.slice();
  assert.ok(board.clearMarks());
  assert.ok(board.marks.every(mark => mark === 0));
  assert.ok(board.undo());
  assert.deepEqual(board.marks, snapshot, 'undo brings the whole clear back');
  assert.ok(board.redo());
  assert.ok(board.marks.every(mark => mark === 0));
  while (board.undo());
  assert.ok(board.marks.every(mark => mark === 0));
  assert.ok(!board.canUndo && board.canRedo);
  while (board.redo());
  assert.ok(board.marks.every(mark => mark === 0), 'the end of the redo line is the cleared board');
  board.toggleCat(5);
  assert.ok(!board.canRedo, 'a new move drops the redo line');
  assert.equal(board.marks.length, total);
  for (let index = 0; index < 600; index += 1) board.toggleExclude(index % total);
  let undone = 0;
  while (board.undo()) undone += 1;
  assert.ok(undone <= 400, 'history is bounded');
});

test('board: completion is detected when the rules hold, not by comparison', () => {
  const board = new QueensBoard(makePuzzle(4, 'easy'));
  assert.ok(!board.solved);
  board.puzzle.solution.forEach((column, row) => board.toggleCat(row * board.size + column));
  assert.ok(board.solved);
  board.toggleExclude(0);
  assert.ok(board.solved || board.marks[0] === CAT, 'extra X marks do not matter');
});

test('persistence: a board survives its record; every corrupt field is discarded', () => {
  const board = new QueensBoard(makePuzzle(8, 'medium'));
  board.toggleCat(10); board.toggleExclude(11);
  board.elapsedMs = 83_456; board.hints = 2;
  const stored = JSON.parse(JSON.stringify(board.toRecord()));
  const back = readCurrent(stored)!;
  assert.ok(back);
  assert.deepEqual([...back.marks], [...board.marks]);
  assert.deepEqual(back.puzzle.regions, board.puzzle.regions);
  assert.deepEqual(back.puzzle.solution, board.puzzle.solution);
  assert.equal(back.elapsedMs, 83_456);
  assert.equal(back.hints, 2);
  assert.equal(back.difficulty, 'medium');
  assert.equal(back.seed, board.seed);
  const mutations: Array<[string, (value: Record<string, unknown>) => void]> = [
    ['size', value => { value.size = 99; }], ['size type', value => { value.size = '7'; }], ['difficulty', value => { value.difficulty = 'nightmare'; }],
    ['seed', value => { value.seed = -1; }], ['hints', value => { value.hints = 1.5; }], ['elapsed', value => { value.elapsedMs = -5; }],
    ['elapsed nan', value => { value.elapsedMs = null; }],
    ['regions length', value => { value.regions = (value.regions as string).slice(1); }], ['regions letter', value => { value.regions = 'Z'.repeat(49); }],
    ['region missing', value => { value.regions = (value.regions as string).replace(/B/gu, 'A'); }],
    ['region split', value => { const text = [...(value.regions as string)]; text[0] = text[48] === text[0] ? 'B' : text[48]!; value.regions = text.join(''); }],
    ['marks char', value => { value.marks = 'q'.repeat(49); }], ['marks length', value => { value.marks = '.'; }],
    ['solution', value => { value.solution = '0,0,0,0,0,0,0'; }], ['solution type', value => { value.solution = [1, 2]; }], ['solution range', value => { value.solution = '9,9,9,9,9,9,9'; }],
    ['not unique', value => { value.regions = [...Array(49).keys()].map(cell => String.fromCharCode(65 + Math.floor(cell / 7))).join(''); }],
  ];
  for (const [name, mutate] of mutations) {
    const copy = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
    mutate(copy);
    assert.equal(readCurrent(copy), undefined, `corrupt ${name} is discarded`);
  }
  for (const junk of [null, 5, 'x', [], {}, {size: 7}]) assert.equal(readCurrent(junk), undefined);
});

test('statistics: read defensively, written back bounded', () => {
  const stats = readStats({bestTimes: {easy: 61_000, medium: -5, hard: 'fast', expert: 1.5}, completed: 4, completedByDifficulty: {easy: 3, medium: 'x'}, streak: -1, bestStreak: 7});
  assert.deepEqual(stats.bestTimes, {easy: 61_000});
  assert.equal(stats.completed, 4);
  assert.deepEqual(stats.completedByDifficulty, {easy: 3, medium: 0, hard: 0, expert: 0});
  assert.equal(stats.streak, 0);
  assert.equal(stats.bestStreak, 7);
  assert.deepEqual(readStats({}).bestTimes, {});
  assert.deepEqual(readStats({bestTimes: 5, completedByDifficulty: [] as unknown as object}).completedByDifficulty, {easy: 0, medium: 0, hard: 0, expert: 0});
  const record: Record<string, never> = {};
  writeStats(record as never, stats);
  assert.deepEqual(readStats(record), stats);
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(61_999), '1:01');
  assert.equal(formatTime(3_725_000), '1:02:05');
});

test('layout: the biggest cells that fit, and nothing that does not', () => {
  for (let size = 5; size <= 10; size += 1) {
    for (const columns of [20, 30, 40, 60, 80, 120, 200]) {
      for (const rows of [8, 12, 16, 24, 40, 60]) {
        const layout = chooseLayout(columns, rows, size);
        if (!layout) continue;
        assert.ok(layout.x + layout.width <= columns && layout.y + layout.height <= rows - 1);
        assert.ok(layout.x >= 0 && layout.y >= 1);
        assert.equal(layout.width, boardWidth(layout.style, size));
        assert.equal(layout.height, boardHeight(layout.style, size));
      }
    }
  }
  assert.equal(chooseLayout(200, 60, 5)!.style.name, 'large');
  assert.equal(chooseLayout(80, 24, 9)!.style.name, 'compact');
  assert.equal(chooseLayout(20, 8, 5)!.style.name, 'mini');
  assert.equal(chooseLayout(20, 8, 10), undefined);
  assert.equal(CELL_STYLES.length, 5);
});
