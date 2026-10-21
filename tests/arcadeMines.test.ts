import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {ALL_EIGHT, neighbours} from '../src/arcade/engine/grid.js';
import {FLAG, HIDDEN, MineBoard, OPEN, PRESETS} from '../src/arcade/games/mines/logic.js';
import {minesGame, readMines} from '../src/arcade/games/mines/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 120, rows: 30}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});

test('first click: never a mine, never next to one, on every preset over 300 seeds', () => {
  for (const preset of Object.values(PRESETS)) for (let seed = 1; seed <= 300; seed += 1) {
    const board = new MineBoard(preset.width, preset.height, preset.mines, createRng(seed));
    const first = (seed * 37) % board.size;
    board.reveal(first);
    assert.equal(board.lost, -1);
    assert.equal(board.counts[first], 0, 'the first square opens a region');
    assert.equal(board.mines.reduce((sum, mine) => sum + mine, 0), preset.mines);
  }
});

test('counts are the number of neighbouring mines; a zero floods its region and its numbered rim', () => {
  const board = new MineBoard(16, 16, 40, createRng(7));
  board.reveal(0);
  const shape = {width: 16, height: 16};
  for (let cell = 0; cell < board.size; cell += 1) {
    assert.equal(board.counts[cell], neighbours(shape, cell, ALL_EIGHT).reduce((sum, next) => sum + board.mines[next]!, 0));
    if (board.state[cell] === OPEN && board.counts[cell] === 0) {
      for (const next of neighbours(shape, cell, ALL_EIGHT)) assert.equal(board.state[next], OPEN, 'every neighbour of an open zero is open');
    }
  }
  const depths = board.lastOpened.map(entry => entry.depth);
  assert.deepEqual(depths, [...depths].sort((a, b) => a - b), 'the cascade order goes outward');
});

test('flags toggle on hidden squares only; chording opens the rest when the flags match, and can lose', () => {
  const board = new MineBoard(9, 9, 10, createRng(3));
  board.reveal(40);
  const shape = {width: 9, height: 9};
  const number = [...Array(board.size).keys()].find(cell => board.state[cell] === OPEN && board.counts[cell]! > 0 && neighbours(shape, cell, ALL_EIGHT).some(next => board.state[next] === HIDDEN && !board.mines[next]))!;
  assert.equal(board.chord(number), false, 'no flags yet: nothing happens');
  for (const next of neighbours(shape, number, ALL_EIGHT)) if (board.mines[next]) board.flag(next);
  assert.equal(board.flag(number), false, 'an open square cannot be flagged');
  assert.equal(board.chord(number), true);
  for (const next of neighbours(shape, number, ALL_EIGHT)) assert.ok(board.state[next] === OPEN || board.state[next] === FLAG);
  const wrong = new MineBoard(9, 9, 10, createRng(3));
  wrong.reveal(40);
  const around = neighbours(shape, number, ALL_EIGHT);
  const safe = around.filter(next => wrong.state[next] === HIDDEN && !wrong.mines[next]);
  for (const next of safe.slice(0, wrong.counts[number])) wrong.flag(next);
  if (around.filter(next => wrong.state[next] === FLAG).length === wrong.counts[number]) { wrong.chord(number); assert.ok(wrong.lost >= 0, 'wrong flags lose on a chord'); }
});

test('winning: opening every safe square wins and records the best time per preset', () => {
  const record = memory();
  const game = minesGame.create(context(record)) as never as {key(k: unknown): unknown; animate(d: number): void; status: string; result: {record: boolean} | undefined; board: MineBoard; cursor: number; finale: {done: boolean; skip(): void} | undefined};
  game.key({kind: 'text', value: '1'});
  game.key({kind: 'text', value: ' '});
  game.animate(2000); game.animate(2000);
  const board = game.board;
  for (let cell = 0; cell < board.size; cell += 1) if (!board.mines[cell] && board.state[cell] === HIDDEN) { game.cursor = cell; game.key({kind: 'enter'}); }
  assert.equal(game.status, 'won');
  assert.ok(game.finale, 'the flags bloom before the results');
  game.finale!.skip();
  assert.equal(readMines(record.raw()).wins, 1);
  assert.ok(readMines(record.raw()).best.beginner >= 4000);
  assert.equal(game.result!.record, true);
});

test('render: every size draws inside its bounds, in color, without color and in Safe Glyphs', () => {
  for (const [columns, rows] of [[20, 8], [40, 14], [100, 30], [200, 60]] as const) {
    for (const mode of [{color: 'truecolor' as const, safe: false}, {color: 'none' as const, safe: true}]) {
      for (const preset of ['1', '3']) {
        const game = minesGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe}));
        game.key({kind: 'text', value: preset});
        game.key({kind: 'text', value: ' '});
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0, arcadePalette());
        for (const line of canvas.plain({color: 'none', safe: mode.safe})) assert.ok(displayWidth(line) <= columns);
        if (mode.safe) for (const row of canvas.rows({color: 'none', safe: true})) assert.match(row, /^[\x20-\x7e\u001b[0-9;m]*$/u);
      }
    }
  }
});
