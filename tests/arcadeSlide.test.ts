import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {isSolvable, isSolved, shuffled, SlideBoard, solvedTiles} from '../src/arcade/games/slide/logic.js';
import {readSlide, slideGame} from '../src/arcade/games/slide/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
type Handle = {key(k: unknown): string; animate(d: number): void; status: string; result: {record: boolean; score: number} | undefined; board: SlideBoard; finale: {done: boolean; skip(): void} | undefined; dispose(): void};

test('parity: the solvability test agrees with exhaustive search on 3x3', () => {
  const reach = new Set<string>();
  const start = solvedTiles(3);
  const queue = [start];
  reach.add(start.join());
  while (queue.length) {
    const tiles = queue.pop()!;
    const blank = tiles.indexOf(0);
    for (const next of [blank - 3, blank + 3, blank % 3 ? blank - 1 : -1, blank % 3 < 2 ? blank + 1 : -1]) {
      if (next < 0 || next > 8) continue;
      const copy = [...tiles];
      [copy[blank], copy[next]] = [copy[next]!, copy[blank]!];
      if (!reach.has(copy.join())) { reach.add(copy.join()); queue.push(copy); }
    }
  }
  assert.equal(reach.size, 181440);
  const rng = createRng(11);
  for (let index = 0; index < 400; index += 1) {
    const tiles = rng.shuffle(solvedTiles(3));
    assert.equal(isSolvable(tiles, 3), reach.has(tiles.join()));
  }
});

test('shuffles are solvable, unsolved and deterministic for 3, 4 and 5 over many seeds', () => {
  for (const n of [3, 4, 5]) for (let seed = 1; seed <= 150; seed += 1) {
    const tiles = shuffled(n, createRng(seed));
    assert.ok(isSolvable(tiles, n), `${n}x${n} seed ${seed}`);
    assert.ok(!isSolved(tiles));
    assert.deepEqual([...tiles].sort((a, b) => a - b), solvedTiles(n).sort((a, b) => a - b));
    assert.deepEqual(tiles, shuffled(n, createRng(seed)));
  }
});

test('even-width parity: a swap of two tiles makes a solved 4x4 unsolvable, and any legal move keeps solvability', () => {
  const swapped = solvedTiles(4);
  [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
  assert.equal(isSolvable(swapped, 4), false);
  const board = new SlideBoard(4, undefined, createRng(2));
  const rng = createRng(9);
  for (let index = 0; index < 200; index += 1) { board.slide(rng.pick(['up', 'down', 'left', 'right'] as const)); assert.ok(isSolvable(board.tiles, 4)); }
});

test('moves: arrows slide the far tile into the gap, edges refuse, picks slide a line, undo restores', () => {
  const board = new SlideBoard(3, [1, 2, 3, 4, 5, 6, 7, 0, 8]);
  assert.equal(board.slide('up'), false, 'no tile below the gap');
  assert.equal(board.moves, 0);
  assert.equal(board.slide('down'), true, 'the tile above the gap slides down');
  assert.deepEqual(board.tiles, [1, 2, 3, 4, 0, 6, 7, 5, 8]);
  assert.equal(board.pick(0), false, 'a corner is not in line with the gap');
  const line = new SlideBoard(3, [1, 2, 3, 4, 5, 6, 0, 7, 8]);
  assert.equal(line.pick(8), true, 'two tiles slide at once');
  assert.deepEqual(line.tiles, [1, 2, 3, 4, 5, 6, 7, 8, 0]);
  assert.equal(line.moves, 1);
  assert.ok(line.solved);
  assert.equal(line.undo(), true);
  assert.deepEqual(line.tiles, [1, 2, 3, 4, 5, 6, 0, 7, 8]);
  assert.equal(line.moves, 0);
  assert.equal(line.undo(), false);
});

test('playing: a menu pick starts a board, a solved board wins, records the best and plays the finale', () => {
  const record = memory();
  const game = slideGame.create(context(record)) as never as Handle;
  assert.equal(game.status, 'ready');
  game.key({kind: 'text', value: '1'});
  assert.equal(game.status, 'playing');
  // Put the board one move from solved and finish it with the keys.
  game.board.tiles = [1, 2, 3, 4, 5, 6, 7, 0, 8];
  assert.equal(game.key({kind: 'up'}), 'ignored');
  assert.equal(game.key({kind: 'left'}), 'handled');
  assert.equal(game.status, 'won');
  assert.ok(game.finale);
  game.animate(5000);
  game.finale!.skip();
  assert.equal(game.result!.record, true);
  assert.equal(readSlide(record.raw()).best[3], 1);
  assert.equal(readSlide(record.raw()).wins, 1);
  game.dispose();
});

test('a worse run does not replace the best; an unsolved board saves nothing', () => {
  const record = memory({best3: 2, plays: 1, wins: 1});
  const game = slideGame.create(context(record)) as never as Handle;
  game.key({kind: 'text', value: '1'});
  game.board.tiles = [1, 2, 3, 4, 5, 6, 0, 7, 8];
  game.key({kind: 'left'}); // legal but not solving: gap row has tiles right of it
  assert.equal(readSlide(record.raw()).plays, 1);
  game.board.tiles = [1, 2, 3, 4, 5, 6, 7, 0, 8];
  game.board.moves = 5;
  game.key({kind: 'left'});
  assert.equal(game.result!.record, false);
  assert.equal(readSlide(record.raw()).best[3], 2);
  assert.equal(readSlide(record.raw()).plays, 2);
});

test('keys: u undoes, r reshuffles, g toggles the picture only with color, mouse clicks pick a tile', () => {
  const game = slideGame.create(context()) as never as Handle & {picture: boolean};
  game.key({kind: 'text', value: '2'});
  assert.equal(game.board.n, 4);
  game.board.tiles = [...solvedTiles(4)];
  [game.board.tiles[14], game.board.tiles[15]] = [0, 15];
  game.board.tiles[14] = 0; game.board.tiles[15] = 15;
  assert.equal(game.key({kind: 'text', value: 'u'}), 'ignored');
  game.key({kind: 'right'});
  assert.equal(game.board.moves, 1);
  assert.equal(game.key({kind: 'text', value: 'u'}), 'handled');
  assert.equal(game.board.moves, 0);
  game.key({kind: 'text', value: 'g'});
  assert.equal(game.picture, true);
  const plain = slideGame.create(context(memory(), {color: 'none', safeGlyphs: true})) as never as Handle & {picture: boolean};
  plain.key({kind: 'text', value: '1'});
  plain.key({kind: 'text', value: 'g'});
  assert.equal(plain.picture, false);
  game.key({kind: 'text', value: 'r'});
  assert.equal(game.board.moves, 0);
  assert.equal(game.status, 'playing');
});

test('render: every size draws inside its bounds for every board, in color, without color, and with reduced motion', () => {
  const sizes = [[100, 34], [60, 24], [40, 16], [28, 12]] as const;
  for (const [columns, rows] of sizes) {
    for (const mode of [{color: 'truecolor' as const, safe: false, reduced: false}, {color: 'none' as const, safe: true, reduced: false}, {color: 'truecolor' as const, safe: false, reduced: true}]) {
      for (const choice of ['0', '1', '2', '3']) {
        const game = slideGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe, motion: {reduced: mode.reduced, effects: mode.reduced ? 'off' : 'normal'}})) as never as Handle;
        if (choice !== '0') game.key({kind: 'text', value: choice});
        if (choice === '3') game.key({kind: 'text', value: 'g'});
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0, arcadePalette());
        const lines = canvas.plain({color: mode.color, safe: mode.safe});
        for (const line of lines) assert.ok(displayWidth(line) <= columns, `${columns}x${rows} ${choice}`);
        if (choice !== '0') assert.ok(lines.some(line => /\d/.test(line)), 'tile numbers are drawn');
        if (mode.safe) for (const row of canvas.rows({color: 'none', safe: true})) assert.match(row, /^[\x20-\x7e\u001b[0-9;m]*$/u);
        game.dispose();
      }
    }
  }
});

test('win render shows a celebration and is bounded; reduced motion keeps a steady glow', () => {
  for (const reduced of [false, true]) {
    const game = slideGame.create(context(memory(), {size: {columns: 40, rows: 16}, motion: {reduced, effects: reduced ? 'off' : 'normal'}})) as never as Handle;
    game.key({kind: 'text', value: '1'});
    game.board.tiles = [1, 2, 3, 4, 5, 6, 7, 0, 8];
    game.key({kind: 'left'});
    for (let index = 0; index < 5; index += 1) { game.animate(120); const canvas = new Canvas(40, 16); game.render(canvas, 0, arcadePalette()); for (const line of canvas.plain()) assert.ok(displayWidth(line) <= 40); }
    assert.ok(game.finale);
  }
});
