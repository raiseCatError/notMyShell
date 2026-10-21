import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {MergeBoard, UNDOS} from '../src/arcade/games/merge/logic.js';
import {mergeGame} from '../src/arcade/games/merge/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 30}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
/** A board with exactly these values (row-major, 0 empty). */
function board(values: number[], seed = 1): MergeBoard {
  const b = new MergeBoard(createRng(seed));
  b.tiles = values.flatMap((value, cell) => (value ? [{id: cell + 100, value, cell, from: cell, merged: false, fresh: false}] : []));
  return b;
}
const row = (b: MergeBoard, y: number) => [0, 1, 2, 3].map(x => b.at(x, y)?.value ?? 0);

test('merging: each tile merges once per move, nearest the wall first', () => {
  for (const [line, expected] of [[[2, 2, 2, 2], [4, 4]], [[2, 2, 4, 0], [4, 4]], [[4, 2, 2, 0], [4, 4]], [[2, 0, 2, 2], [4, 2]], [[8, 8, 8, 0], [16, 8]]] as const) {
    const b = board([...line, ...Array(12).fill(0)]);
    b.move('left');
    assert.deepEqual(row(b, 0).slice(0, expected.length), [...expected], `${line} → ${expected}`);
  }
  const b = board([2, 2, 2, 2, ...Array(12).fill(0)]);
  b.move('right');
  assert.deepEqual(row(b, 0).slice(2), [4, 4]);
});

test('moves: a move that changes nothing spawns nothing; a real move spawns one tile and scores the merges', () => {
  const stuck = board([2, 4, 8, 16, ...Array(12).fill(0)]);
  assert.equal(stuck.move('left'), false);
  assert.equal(stuck.tiles.length, 4);
  const b = board([2, 2, 0, 0, ...Array(12).fill(0)]);
  assert.equal(b.move('left'), true);
  assert.equal(b.score, 4);
  assert.equal(b.tiles.length, 2, 'the merged tile and one new tile');
});

test('game over: no empty cell and no equal neighbours means no move', () => {
  const full = board([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]);
  assert.equal(full.canMove, false);
  const open = board([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 4]);
  assert.equal(open.canMove, true);
});

test('undo: restores the board and score, limited to three per game', () => {
  const b = new MergeBoard(createRng(5));
  const snapshots: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    snapshots.push(JSON.stringify(b.tiles.map(t => [t.cell, t.value]).sort()));
    for (const d of ['left', 'up', 'right', 'down'] as const) if (b.move(d)) break;
  }
  for (let index = 0; index < UNDOS; index += 1) assert.equal(b.undo(), true);
  assert.equal(b.undo(), false, 'no fourth undo');
  assert.equal(JSON.stringify(b.tiles.map(t => [t.cell, t.value]).sort()), snapshots[3]);
});

test('game: seeded play is deterministic, ends with a saved result, and every size draws in bounds', () => {
  const play = () => {
    const record = memory();
    const game = mergeGame.create(context(record));
    const order = [{kind: 'down'}, {kind: 'left'}, {kind: 'down'}, {kind: 'right'}] as const;
    for (let index = 0; index < 5000 && game.status !== 'over' && game.status !== 'won'; index += 1) { game.key(order[index % 4] as never); game.animate(200); }
    return {game, record};
  };
  const a = play(), b = play();
  assert.equal(a.game.result!.score, b.game.result!.score);
  assert.equal(a.record.raw().plays, 1);
  for (const [columns, rows] of [[20, 8], [40, 14], [100, 30], [200, 60]] as const) for (const color of ['truecolor', 'none'] as const) {
    const game = mergeGame.create(context(memory(), {size: {columns, rows}, color}));
    game.key({kind: 'left'});
    const canvas = new Canvas(columns, rows);
    game.render(canvas, 0, arcadePalette());
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
  }
});

test('the score popup is never placed on the title row, even when the board is as tall as the window allows', () => {
  const game = mergeGame.create(context(memory(), {size: {columns: 40, rows: 10}})) as never as {board: {tiles: Array<{id: number; value: number; cell: number; from: number; merged: boolean; fresh: boolean}>}; key(k: unknown): unknown; animate(d: number): void; render(c: Canvas, a: number, p: unknown): void; layout(): {well: {y: number}} | undefined};
  assert.equal(game.layout()!.well.y, 1, 'a board that fills the rows below the title row');
  game.board.tiles = [{id: 90, value: 2, cell: 0, from: 0, merged: false, fresh: false}, {id: 91, value: 2, cell: 1, from: 1, merged: false, fresh: false}];
  game.key({kind: 'left'});
  for (let step = 0; step < 10; step += 1) {
    game.animate(40);
    const canvas = new Canvas(40, 10);
    game.render(canvas, 0, arcadePalette());
    assert.doesNotMatch(canvas.plain()[0]!, /\+4/u, `step ${step}`);
  }
});
