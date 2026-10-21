import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {generateIce, IceBoard, LEVELS, slideFrom, solveIce, type Dir, type Field, type Level} from '../src/arcade/games/ice/logic.js';
import {iceGame, readIce} from '../src/arcade/games/ice/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
type Handle = {key(k: unknown): string; animate(d: number): void; status: string; result: {record: boolean; score: number} | undefined; board: IceBoard; tip: Dir | undefined; finale: {done: boolean; skip(): void} | undefined; refreshMs: number; dispose(): void};

/** 5 x 3 field, a rock at (2,1); cat at (0,1), goal at (4,0). */
function tiny(): Field {
  const rocks = new Uint8Array(15);
  rocks[1 * 5 + 2] = 1;
  return {width: 5, height: 3, rocks, start: 5, goal: 4};
}

test('rules: slides stop before rocks and at the edge, the goal catches, blocked slides do nothing', () => {
  const field = tiny();
  assert.equal(slideFrom(field, 5, 'right').to, 6, 'the rock stops the cat');
  assert.equal(slideFrom(field, 5, 'left').to, 5);
  assert.equal(slideFrom(field, 5, 'up').to, 0);
  assert.equal(slideFrom(field, 0, 'right').to, 4, 'the bowl is at the edge anyway');
  assert.deepEqual(slideFrom(field, 0, 'right').path, [1, 2, 3, 4]);
  const open: Field = {...field, goal: 2, start: 0};
  assert.equal(slideFrom(open, 0, 'right').to, 2, 'the goal stops a slide that would have passed it');
});

test('solver: tiny field has a known minimum (up, right) and the board follows it, with undo and restart', () => {
  const field = tiny();
  assert.deepEqual(solveIce(field), ['up', 'right']);
  const board = new IceBoard({...field, minMoves: 2});
  assert.equal(board.hint(), 'up');
  assert.deepEqual(board.slide('left'), []);
  assert.equal(board.moves, 0);
  assert.equal(board.slide('up').length, 1);
  assert.equal(board.undo(), true);
  assert.equal(board.moves, 0);
  board.slide('up'); board.slide('right');
  assert.ok(board.solved);
  assert.equal(board.moves, 2);
  assert.deepEqual(board.slide('down'), [], 'nothing moves after the win');
  board.restart();
  assert.equal(board.moves, 0);
  assert.equal(board.cat, field.start);
  assert.equal(solveIce({...field, goal: 14, rocks: new Uint8Array(15).fill(1).fill(0, 0, 6)}), undefined, 'a walled-off goal is unreachable');
});

test('generation: every level over many seeds is verified solvable with the stated minimum, reaches its target, and is deterministic', () => {
  for (const level of Object.keys(LEVELS) as Level[]) for (let seed = 1; seed <= 120; seed += 1) {
    const puzzle = generateIce(level, createRng(seed));
    assert.ok(!puzzle.rocks[puzzle.start] && !puzzle.rocks[puzzle.goal]);
    assert.notEqual(puzzle.start, puzzle.goal);
    const path = solveIce(puzzle);
    assert.ok(path, `${level} ${seed} solvable`);
    assert.equal(path.length, puzzle.minMoves);
    assert.ok(puzzle.minMoves >= LEVELS[level].min - 1, `${level} ${seed}: ${puzzle.minMoves}`);
    // Replaying the path really arrives.
    const board = new IceBoard(puzzle);
    for (const dir of path) board.slide(dir);
    assert.ok(board.solved);
    assert.deepEqual(puzzle, generateIce(level, createRng(seed)));
  }
});

function solveWithKeys(game: Handle): void {
  let guard = 0;
  while (game.board.solved === false && guard++ < 100) game.key({kind: game.board.hint()!});
}

test('playing: keys slide with an animation, hint names a direction, the win records best and plays the finale', () => {
  const record = memory();
  const game = iceGame.create(context(record)) as never as Handle;
  assert.equal(game.status, 'ready');
  game.key({kind: 'text', value: '1'});
  assert.equal(game.status, 'playing');
  game.key({kind: 'text', value: '?'});
  assert.ok(['up', 'down', 'left', 'right'].includes(game.tip!));
  solveWithKeys(game);
  assert.equal(game.status, 'playing', 'the last slide is still animating');
  assert.ok(game.refreshMs > 0);
  game.animate(2000);
  assert.equal(game.status, 'won');
  assert.ok(game.finale);
  game.animate(4000);
  game.finale!.skip();
  assert.equal(game.result!.record, true);
  assert.equal(game.result!.score, game.board.par);
  assert.equal(readIce(record.raw()).best.easy, game.board.par);
  assert.equal(readIce(record.raw()).perfect, 1);
  game.dispose();
});

test('reduced motion: no animation, the win is immediate; a worse run keeps the best', () => {
  const record = memory({bestEasy: 1, plays: 1, wins: 1});
  const game = iceGame.create(context(record, {motion: {reduced: true, effects: 'off'}})) as never as Handle;
  game.key({kind: 'text', value: '1'});
  assert.equal(game.key({kind: 'text', value: 'r'}), 'handled');
  game.key({kind: 'text', value: 'u'});
  solveWithKeys(game);
  assert.equal(game.status, 'won');
  assert.equal(game.result!.record, game.board.moves < 1);
  assert.equal(readIce(record.raw()).best.easy, 1);
  assert.equal(readIce(record.raw()).plays, 2);
});

test('render: every size draws inside its bounds, in color, without color and with reduced motion', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) {
    for (const mode of [{color: 'truecolor' as const, safe: false, reduced: false}, {color: 'none' as const, safe: true, reduced: false}, {color: 'truecolor' as const, safe: false, reduced: true}]) {
      for (const choice of ['0', '1', '3']) {
        const game = iceGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe, motion: {reduced: mode.reduced, effects: mode.reduced ? 'off' : 'normal'}})) as never as Handle;
        if (choice !== '0') game.key({kind: 'text', value: choice});
        game.key({kind: 'text', value: '?'});
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0, arcadePalette());
        const lines = canvas.plain({color: mode.color, safe: mode.safe});
        for (const line of lines) assert.ok(displayWidth(line) <= columns, `${columns}x${rows} ${choice}`);
        if (choice !== '0') { const text = lines.join('\n'); assert.ok(/\^\.?\^/.test(text), 'the cat is drawn'); assert.ok(text.includes('(') , 'the bowl is drawn'); }
        if (mode.safe) for (const row of canvas.rows({color: 'none', safe: true})) assert.match(row, /^[\x20-\x7e\u001b[0-9;m]*$/u);
        game.dispose();
      }
    }
  }
});

test('win render is bounded with and without reduced motion', () => {
  for (const reduced of [false, true]) {
    const game = iceGame.create(context(memory(), {size: {columns: 40, rows: 16}, motion: {reduced, effects: reduced ? 'off' : 'normal'}})) as never as Handle;
    game.key({kind: 'text', value: '1'});
    solveWithKeys(game);
    for (let index = 0; index < 8; index += 1) { game.animate(150); const canvas = new Canvas(40, 16); game.render(canvas, 0, arcadePalette()); for (const line of canvas.plain()) assert.ok(displayWidth(line) <= 40); }
    assert.equal(game.status, 'won');
    game.dispose();
  }
});
