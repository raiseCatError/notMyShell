import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {cleanRecord} from '../src/arcade/scores.js';
import {DIFFICULTIES, PROFILES, clueCount, generatePuzzle, type Difficulty} from '../src/arcade/games/sudoku/generator.js';
import {countSolutions, findSingle, isSolved, parseGrid, randomSolved, solve, solveBySingles, conflicting, gridString} from '../src/arcade/games/sudoku/solver.js';
import {SudokuState} from '../src/arcade/games/sudoku/state.js';
import {emptyStats, formatTime, readCurrent, readRecord, recordWin, writeRecord} from '../src/arcade/games/sudoku/record.js';

const SOLVED = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';
const PUZZLE = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';

function fresh(difficulty: Difficulty = 'easy', seed = 11): SudokuState {
  const made = generatePuzzle(difficulty, createRng(seed));
  return new SudokuState(difficulty, made.puzzle, made.solution);
}

test('solver: counts solutions up to the limit, finds the known solution, rejects clashing givens', () => {
  assert.equal(countSolutions(parseGrid(PUZZLE), 2), 1);
  assert.equal(gridString(solve(parseGrid(PUZZLE))!), SOLVED);
  assert.equal(countSolutions(new Uint8Array(81), 2), 2, 'an empty grid has many');
  const clash = parseGrid(PUZZLE); clash[1] = 5;
  assert.equal(countSolutions(clash, 2), 0);
  assert.ok(isSolved(parseGrid(SOLVED)));
  const broken = parseGrid(SOLVED); broken[0] = 4;
  assert.ok(!isSolved(broken));
  assert.equal(conflicting(broken).filter(Boolean).length > 0, true);
});

test('solver: random grids are valid, deterministic per seed, and different across seeds', () => {
  const a = randomSolved(createRng(1));
  assert.ok(isSolved(a));
  assert.equal(gridString(a), gridString(randomSolved(createRng(1))));
  assert.notEqual(gridString(a), gridString(randomSolved(createRng(2))));
});

test('generator: 200 seeded puzzles per difficulty are unique, valid and behave by difficulty', () => {
  for (const difficulty of DIFFICULTIES) {
    const profile = PROFILES[difficulty];
    let clueSum = 0;
    let beyondSingles = 0;
    let nakedSolvable = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const made = generatePuzzle(difficulty, createRng(5000 + seed));
      assert.equal(countSolutions(made.puzzle, 2), 1, `${difficulty} #${seed} must have exactly one solution`);
      assert.ok(isSolved(made.solution), 'solution is a valid grid');
      made.puzzle.forEach((clue, cell) => assert.ok(clue === 0 || clue === made.solution[cell], 'clues match the solution'));
      assert.equal(gridString(solve(made.puzzle)!), gridString(made.solution), 'the independent solver agrees');
      const clues = clueCount(made.puzzle);
      assert.ok(clues >= profile.min - 2 && clues <= profile.max + 1, `${difficulty} clue count ${clues}`);
      clueSum += clues;
      if (!solveBySingles(made.puzzle, true).solved) beyondSingles += 1;
      if (solveBySingles(made.puzzle, false).solved) nakedSolvable += 1;
    }
    if (difficulty === 'easy') assert.equal(nakedSolvable, 200, 'easy falls to naked singles alone');
    else assert.equal(nakedSolvable, 0, `${difficulty} needs more than naked singles`);
    if (difficulty === 'expert') assert.ok(beyondSingles >= 190, 'expert needs more than singles');
    else assert.equal(beyondSingles, 0, `${difficulty} is solvable by singles`);
    assert.ok(clueSum / 200 <= profile.max, `${difficulty} average clues`);
  }
});

test('generator: the same seed gives the same puzzle; levels get sparser', () => {
  const a = generatePuzzle('hard', createRng(77));
  assert.equal(gridString(a.puzzle), gridString(generatePuzzle('hard', createRng(77)).puzzle));
  assert.notEqual(gridString(a.puzzle), gridString(generatePuzzle('hard', createRng(78)).puzzle));
  const avg = (d: Difficulty) => Array.from({length: 20}, (_, i) => clueCount(generatePuzzle(d, createRng(i)).puzzle)).reduce((s, n) => s + n, 0) / 20;
  assert.ok(avg('easy') > avg('medium') && avg('medium') > avg('hard') && avg('hard') > avg('expert'));
});

test('state: clues are immutable; digits, notes and erase only touch open cells', () => {
  const state = fresh();
  const clueCell = state.puzzle.findIndex(digit => digit !== 0);
  const open = state.puzzle.findIndex(digit => digit === 0);
  const before = gridString(state.puzzle);
  state.moveTo(clueCell);
  assert.equal(state.enter(5), false);
  assert.equal(state.erase(), false);
  state.notesMode = true;
  assert.equal(state.enter(5), false);
  assert.equal(state.undo(), false, 'nothing recorded for a refused edit');
  state.notesMode = false;
  state.moveTo(open);
  assert.equal(state.enter(7), true);
  assert.equal(state.grid[open], 7);
  assert.equal(state.enter(7), false, 'the same digit again changes nothing');
  assert.equal(state.erase(), true);
  assert.equal(state.grid[open], 0);
  assert.equal(gridString(state.puzzle), before);
});

test('state: notes toggle, are cleared by a digit, and are struck from peers when it is placed', () => {
  const state = fresh();
  const open = state.puzzle.findIndex(digit => digit === 0);
  const peer = [...Array(81).keys()].find(cell => cell !== open && !state.isClue(cell) && (Math.floor(cell / 9) === Math.floor(open / 9)))!;
  state.moveTo(peer); state.notesMode = true; state.enter(4); state.enter(6);
  assert.equal(state.notes[peer], (1 << 3) | (1 << 5));
  state.enter(4);
  assert.equal(state.notes[peer], 1 << 5, 'a second press removes the mark');
  state.enter(4);
  state.moveTo(open); state.enter(4); state.enter(2);
  assert.equal(state.notes[open], (1 << 3) | (1 << 1));
  state.notesMode = false;
  state.enter(4);
  assert.equal(state.notes[open], 0, 'placing clears the cell notes');
  assert.equal(state.notes[peer] & (1 << 3), 0, 'and strikes the digit from peers');
  assert.ok(state.notes[peer] & (1 << 5), 'other marks stay');
  state.notesMode = true;
  assert.equal(state.enter(2), false, 'no notes in a filled cell');
  state.undo();
  assert.equal(state.notes[peer] & (1 << 3), 1 << 3, 'undo restores the peer notes too');
});

test('state: undo and redo round trip exactly, and a new edit drops the redo branch', () => {
  const state = fresh();
  const snapshot = () => JSON.stringify({e: [...state.entries], n: [...state.notes], c: state.cursor});
  const start = snapshot();
  const cells = [...Array(81).keys()].filter(cell => !state.isClue(cell)).slice(0, 6);
  for (const [index, cell] of cells.entries()) { state.moveTo(cell); state.notesMode = index % 2 === 1; state.enter(index + 1); }
  state.notesMode = false;
  const end = snapshot();
  while (state.undo());
  assert.equal(snapshot().replace(/"c":\d+/u, ''), start.replace(/"c":\d+/u, ''));
  while (state.redo());
  assert.equal(snapshot(), end);
  state.undo();
  state.moveTo(cells[0]!); state.enter(9);
  assert.equal(state.canRedo, false);
});

test('state: conflicts are found in rows, columns and boxes', () => {
  const state = new SudokuState('easy', parseGrid(PUZZLE), parseGrid(SOLVED));
  const open = state.puzzle.indexOf(0);
  const rowClue = state.puzzle[Math.floor(open / 9) * 9 + [...state.puzzle.slice(Math.floor(open / 9) * 9, Math.floor(open / 9) * 9 + 9)].findIndex(d => d !== 0)]!;
  state.moveTo(open);
  state.enter(rowClue);
  const bad = state.conflicts();
  assert.ok(bad[open], 'the duplicate is flagged');
  assert.ok(bad.filter(Boolean).length >= 2, 'and so is the digit it clashes with');
  state.erase();
  assert.ok(!state.conflicts().some(Boolean));
});

test('state: hints fill the right digit, never change clues or the solution, are counted and undoable', () => {
  const state = fresh('hard', 3);
  const puzzle = gridString(state.puzzle);
  const solution = gridString(state.solution);
  const cell = state.puzzle.indexOf(0);
  state.moveTo(cell);
  state.enter(state.solution[cell] === 9 ? 1 : 9);
  const wrong = state.grid[cell];
  const first = state.hint()!;
  assert.equal(first.cell, cell, 'a wrong or empty cursor cell is the first target');
  assert.equal(state.grid[cell], state.solution[cell]);
  assert.match(first.message, /R\d+C\d+ is \d/u);
  assert.equal(state.hints, 1);
  state.undo();
  assert.equal(state.grid[cell], wrong, 'undo returns the previous entry');
  state.redo();
  let guard = 0;
  while (!state.solved && guard++ < 90) assert.ok(state.hint());
  assert.ok(state.solved);
  assert.equal(state.hint(), undefined, 'nothing left to hint');
  assert.equal(gridString(state.puzzle), puzzle);
  assert.equal(gridString(state.solution), solution);
  assert.ok(state.consistent());
  assert.equal(state.hints, guard + 1, "one hint per fill, plus the first");
});

test('state: a hint explains a single in plain words', () => {
  const made = generatePuzzle('easy', createRng(4));
  const state = new SudokuState('easy', made.puzzle, made.solution);
  const single = findSingle(state.puzzle)!;
  state.moveTo(single.cell);
  assert.match(state.hint()!.message, /only|solution has/u);
});

test('state: restart returns to the clues with history, hints and clock cleared', () => {
  const state = fresh();
  const puzzle = gridString(state.puzzle);
  state.hint(); state.elapsedMs = 5000;
  state.restart();
  assert.equal(gridString(state.puzzle), puzzle);
  assert.ok(state.entries.every(digit => digit === 0) && state.notes.every(mask => mask === 0));
  assert.equal(state.hints, 0); assert.equal(state.elapsedMs, 0); assert.equal(state.canUndo, false);
});

test('record: a saved puzzle round trips through the bounded store format', () => {
  const state = fresh('medium', 9);
  state.moveTo(state.puzzle.indexOf(0)); state.enter(3); state.notesMode = true; state.moveTo(state.puzzle.lastIndexOf(0)); state.enter(2);
  state.hints = 2; state.elapsedMs = 61_000;
  const stored = {...emptyStats(), current: state.toSaved()};
  const written = writeRecord(stored);
  assert.ok(cleanRecord(written), 'the store accepts it');
  const back = readRecord(JSON.parse(JSON.stringify(written)));
  assert.deepEqual(back.current, state.toSaved());
  const again = SudokuState.fromSaved(back.current!);
  assert.equal(gridString(again.grid), gridString(state.grid));
  assert.deepEqual([...again.notes], [...state.notes]);
  assert.equal(again.hints, 2);
  assert.equal(again.elapsedMs, 61_000);
});

test('record: corrupt or hostile records are discarded, never trusted', () => {
  const good = fresh('easy', 2).toSaved();
  assert.ok(readCurrent(good));
  const bad: Array<[string, unknown]> = [
    ['short puzzle', {...good, puzzle: good.puzzle.slice(1)}],
    ['letters', {...good, entries: `x${good.entries.slice(1)}`}],
    ['solution with zero', {...good, solution: `0${good.solution.slice(1)}`}],
    ['solution not a valid grid', {...good, solution: '1'.repeat(81)}],
    ['clue disagrees with solution', {...good, puzzle: good.puzzle.replace(/[1-9]/u, d => String((Number(d) % 9) + 1))}],
    ['entry on a clue', {...good, entries: `${(Number(good.puzzle[good.puzzle.search(/[1-9]/u)]) % 9) + 1}`.padStart(good.puzzle.search(/[1-9]/u) + 1, '0').padEnd(81, '0')}],
    ['bad notes length', {...good, notes: good.notes.slice(1)}],
    ['note out of range', {...good, notes: good.notes.map((mask, i) => (i === 0 ? 512 : mask))}],
    ['negative time', {...good, elapsedMs: -1}],
    ['fractional hints', {...good, hints: 1.5}],
    ['unknown difficulty', {...good, difficulty: 'nightmare'}],
    ['not an object', 'hello'],
    ['non unique puzzle', {...good, puzzle: '0'.repeat(81), entries: '0'.repeat(81)}],
  ];
  for (const [name, value] of bad) assert.equal(readCurrent(value), undefined, name);
  const complete = {...good, entries: good.solution.split('').map((d, i) => (good.puzzle[i] === '0' ? d : '0')).join('')};
  assert.equal(readCurrent(complete), undefined, 'a finished grid is never a saved game');
  const stats = readRecord({version: 1, bestTimes: {easy: -3, medium: 'x', hard: 120, expert: 1e12}, completed: 'many', streak: 2.5, bestStreak: 4, completedByDifficulty: {easy: 3}, current: {junk: true}});
  assert.deepEqual(stats.bestTimes, {hard: 120});
  assert.equal(stats.current, undefined);
  assert.equal(stats.streak, 0);
  assert.equal(stats.completed, 3, 'completed is at least the per-difficulty sum');
  assert.deepEqual(readRecord({version: 9, completed: 5}).completed, 0, 'an unknown version is ignored');
  assert.deepEqual(readRecord({}), {...emptyStats()});
});

test('record: wins update bests and streaks; hinted wins are never records', () => {
  let outcome = recordWin(emptyStats(), 'easy', 187, 0);
  assert.equal(outcome.record, true);
  assert.equal(outcome.stats.bestTimes.easy, 187);
  assert.equal(formatTime(187), '3:07');
  assert.equal(formatTime(3725), '1:02:05');
  outcome = recordWin(outcome.stats, 'easy', 200, 0);
  assert.equal(outcome.record, false);
  assert.equal(outcome.stats.bestTimes.easy, 187);
  outcome = recordWin(outcome.stats, 'easy', 90, 1);
  assert.equal(outcome.record, false, 'a hinted win cannot be a record');
  assert.equal(outcome.stats.completed, 3);
  assert.equal(outcome.stats.completedByDifficulty.easy, 3);
  assert.equal(outcome.stats.streak, 3);
  assert.equal(outcome.stats.bestStreak, 3);
});
