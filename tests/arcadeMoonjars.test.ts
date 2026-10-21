import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {applyPour, generateJars, isWon, JarBoard, LEVELS, pourAmount, solveJars, topRun, type Level} from '../src/arcade/games/moonjars/logic.js';
import {moonjarsGame, readJars} from '../src/arcade/games/moonjars/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
type Handle = {key(k: unknown): string; animate(d: number): void; status: string; result: {record: boolean; score: number} | undefined; board: JarBoard; note: string; source: number; finale: {done: boolean; skip(): void} | undefined; dispose(): void};

test('rules: only the top run pours, onto empty or matching tops, limited by free space', () => {
  const jars = [[0, 1, 1], [1], [], [0, 0, 0, 0], [2, 1]];
  assert.equal(topRun(jars[0]!), 2);
  assert.equal(pourAmount(jars, 4, 0, 1), 2, 'both blue units fit onto the blue one');
  assert.equal(pourAmount(jars, 4, 0, 2), 2, 'into an empty jar');
  assert.equal(pourAmount(jars, 4, 0, 3), 0, 'a full jar takes nothing');
  assert.equal(pourAmount(jars, 4, 0, 4), 2, 'matching top (1)');
  assert.equal(pourAmount(jars, 4, 4, 0), 1, 'only the room that is there: a 1 onto [0,1,1] fits one');
  assert.equal(pourAmount(jars, 4, 2, 0), 0, 'an empty jar pours nothing');
  assert.equal(pourAmount(jars, 4, 1, 1), 0, 'a jar onto itself');
  assert.equal(pourAmount([[0, 1], [0, 0, 0, 1]], 4, 0, 1), 0, 'a full jar takes nothing even when the top matches');
  assert.deepEqual(applyPour([[1, 1, 1], [0, 1, 1]], 4, 0, 1), [[1, 1], [0, 1, 1, 1]]);
  assert.equal(applyPour([[0], [1]], 4, 0, 1), undefined);
});

test('win: every jar empty or full of one color', () => {
  assert.equal(isWon([[0, 0], [1, 1], []], 2), true);
  assert.equal(isWon([[0, 0], [1], [1]], 2), false, 'a color split over two jars is not done');
  assert.equal(isWon([[0, 1], [1, 0]], 2), false);
});

test('board: pour counts a move, illegal pours do not, undo and restart restore', () => {
  const puzzle = {jars: [[0, 1], [1, 0], []], cap: 2, colors: 2, solution: 3};
  const board = new JarBoard(puzzle);
  assert.equal(board.pour(0, 0), 0);
  assert.equal(board.pour(0, 1), 0);
  assert.equal(board.moves, 0);
  assert.equal(board.pour(1, 2), 1);
  assert.equal(board.moves, 1);
  assert.equal(board.undo(), true);
  assert.deepEqual(board.jars, puzzle.jars);
  assert.equal(board.undo(), false);
  board.pour(0, 2); board.restart();
  assert.deepEqual(board.jars, puzzle.jars);
  assert.equal(board.moves, 0);
  assert.deepEqual(puzzle.jars, [[0, 1], [1, 0], []], 'the puzzle itself is never mutated');
});

test('generation: deals over many seeds have exact color counts, no finished jars, a replayable solution, and are deterministic', () => {
  for (const level of Object.keys(LEVELS) as Level[]) for (let seed = 1; seed <= 60; seed += 1) {
    const spec = LEVELS[level];
    const puzzle = generateJars(level, createRng(seed));
    assert.equal(puzzle.jars.length, spec.colors + spec.empty);
    const tally = new Map<number, number>();
    for (const jar of puzzle.jars) { assert.ok(jar.length <= spec.cap); for (const unit of jar) tally.set(unit, (tally.get(unit) ?? 0) + 1); }
    assert.equal(tally.size, spec.colors);
    for (const total of tally.values()) assert.equal(total, spec.cap);
    assert.ok(!isWon(puzzle.jars, spec.cap));
    const solution = solveJars(puzzle.jars, spec.cap);
    assert.ok(solution, `${level} ${seed} solvable`);
    let jars: readonly (readonly number[])[] = puzzle.jars;
    for (const {from, to} of solution) { const next = applyPour(jars, spec.cap, from, to); assert.ok(next, 'every solution step is legal'); jars = next; }
    assert.ok(isWon(jars, spec.cap));
    assert.equal(solution.length, puzzle.solution);
    assert.deepEqual(puzzle, generateJars(level, createRng(seed)));
  }
});

test('solver: a deal that cannot be solved is reported, not looped on', () => {
  assert.equal(solveJars([[0, 1], [1, 0]], 2), undefined, 'no empty jar and no legal pour: stuck');
  assert.deepEqual(solveJars([[0, 0], []], 2), []);
});

function solveWithKeys(game: Handle): void {
  let guard = 0;
  while (!game.board.solved && guard++ < 200) {
    game.key({kind: 'text', value: '?'});
    game.key({kind: 'enter'});
    game.key({kind: 'enter'});
  }
}

test('playing: pick and pour by number or Space, hint, undo; the win records the best and plays the finale', () => {
  const record = memory();
  const game = moonjarsGame.create(context(record)) as never as Handle;
  assert.equal(game.status, 'ready');
  game.key({kind: 'text', value: '1'});
  assert.equal(game.status, 'playing');
  const emptyJar = game.board.jars.length;
  game.key({kind: 'text', value: String(emptyJar)});
  assert.equal(game.note, 'That jar is empty');
  game.key({kind: 'text', value: '1'});
  assert.equal(game.source, 0);
  game.key({kind: 'text', value: '1'});
  assert.equal(game.source, -1, 'the same jar cancels');
  game.key({kind: 'text', value: '?'});
  assert.match(game.note, /^Hint: pour \d into \d$/);
  assert.ok(game.source >= 0);
  game.key({kind: 'enter'});
  assert.equal(game.board.moves, 1);
  assert.equal(game.key({kind: 'text', value: 'u'}), 'handled');
  assert.equal(game.board.moves, 0);
  // Cannot pour on a different color.
  const jars = game.board.jars;
  const different = jars.findIndex((jar, index) => index > 0 && jar.length && jar[jar.length - 1] !== jars[0]![jars[0]!.length - 1] && jar.length === 4);
  if (different > 0) { game.key({kind: 'text', value: '1'}); game.key({kind: 'text', value: String(different + 1)}); assert.equal(game.note, 'Cannot pour there'); }
  solveWithKeys(game);
  assert.equal(game.status, 'won');
  assert.ok(game.finale);
  game.animate(4000);
  game.finale!.skip();
  assert.equal(game.result!.record, true);
  assert.equal(readJars(record.raw()).best.easy, game.board.moves);
  assert.equal(readJars(record.raw()).wins, 1);
  game.dispose();
});

test('a worse run keeps the best', () => {
  const record = memory({bestEasy: 1, plays: 1, wins: 1});
  const game = moonjarsGame.create(context(record, {motion: {reduced: true, effects: 'off'}})) as never as Handle;
  game.key({kind: 'text', value: '1'});
  solveWithKeys(game);
  assert.equal(game.result!.record, false);
  assert.equal(readJars(record.raw()).best.easy, 1);
  assert.equal(readJars(record.raw()).plays, 2);
});

test('render: every size draws inside its bounds, in color, without color and with reduced motion; every unit shows its letter', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) {
    for (const mode of [{color: 'truecolor' as const, safe: false, reduced: false}, {color: 'none' as const, safe: true, reduced: false}, {color: 'truecolor' as const, safe: false, reduced: true}]) {
      for (const choice of ['0', '1', '2', '3']) {
        const game = moonjarsGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe, motion: {reduced: mode.reduced, effects: mode.reduced ? 'off' : 'normal'}})) as never as Handle;
        if (choice !== '0') { game.key({kind: 'text', value: choice}); game.key({kind: 'text', value: '?'}); }
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0, arcadePalette());
        const lines = canvas.plain({color: mode.color, safe: mode.safe});
        for (const line of lines) assert.ok(displayWidth(line) <= columns, `${columns}x${rows} ${choice}`);
        if (choice !== '0') {
          const text = lines.slice(1, -1).join('\n');
          const colors = LEVELS[(['easy', 'medium', 'hard'] as const)[Number(choice) - 1]!].colors;
          for (let color = 0; color < colors; color += 1) assert.ok(text.includes('ABCDEFGHIJ'[color]!), `${columns}x${rows} color ${color} has a letter`);
        }
        if (mode.safe) for (const row of canvas.rows({color: 'none', safe: true})) assert.match(row, /^[\x20-\x7e\u001b[0-9;m]*$/u);
        game.dispose();
      }
    }
  }
});

test('win render is bounded with and without reduced motion', () => {
  for (const reduced of [false, true]) {
    const game = moonjarsGame.create(context(memory(), {size: {columns: 40, rows: 16}, motion: {reduced, effects: reduced ? 'off' : 'normal'}})) as never as Handle;
    game.key({kind: 'text', value: '2'});
    solveWithKeys(game);
    for (let index = 0; index < 6; index += 1) { game.animate(150); const canvas = new Canvas(40, 16); game.render(canvas, 0, arcadePalette()); for (const line of canvas.plain()) assert.ok(displayWidth(line) <= 40); }
    assert.equal(game.status, 'won');
    game.dispose();
  }
});
