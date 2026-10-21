import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {CELL_ASPECT, cellOrigin, physicalRatio, type BoardLayout} from '../src/arcade/engine/boardLayout.js';
import {hexRows} from '../src/arcade/engine/tilePaint.js';
import {HEX_DIRECTIONS, HEX_PRESETS, CLASSIC_PRESETS, FLAG, HIDDEN, MineBoard, OPEN, PRESETS, hexNeighbours, hexStep} from '../src/arcade/games/mines/logic.js';
import {minesGame, readMines} from '../src/arcade/games/mines/index.js';
import {mergeGame} from '../src/arcade/games/merge/index.js';
import {sudokuGame} from '../src/arcade/games/sudoku/index.js';
import {cellAtPoint, layoutFor} from '../src/arcade/games/sudoku/layout.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (options: Partial<GameContext> = {}, record = memory()): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
const SIZES = [[200, 60], [120, 40], [100, 34], [80, 24], [60, 24], [40, 16], [30, 14], [28, 12]] as const;
type Internals = {layout(): (BoardLayout & {side?: boolean; well?: {x: number; y: number; w: number; h: number}}) | undefined; cursor: number; board: MineBoard; resize(size: {columns: number; rows: number}): void};

// ---- Sudoku -----------------------------------------------------------------------------------------------------

test('sudoku: cells are physically square, the board is inside the canvas and the cell grid is centered with its HUD', () => {
  for (const [columns, rows] of SIZES) {
    const layout = layoutFor(columns, rows);
    if (!layout) { assert.ok(columns < 20 || rows < 13 || (columns === 28 && rows === 12), `${columns}x${rows}`); continue; }
    assert.equal(physicalRatio(layout.cw, layout.ch), 1, `${columns}x${rows}`);
    assert.equal(layout.cw, layout.ch * CELL_ASPECT);
    assert.ok(layout.x >= 0 && layout.y >= 0 && layout.x + layout.boardW <= columns && layout.y + layout.boardH <= rows);
    if (layout.hud === 'top') assert.ok(Math.abs(layout.x - (columns - layout.boardW - layout.x)) <= 1, 'centered across');
    assert.ok(layout.boardH <= rows - (layout.hud === 'top' ? 2 : 0));
  }
});

test('sudoku: the largest square cell that fits is chosen (one size up would not fit)', () => {
  assert.ok(layoutFor(100, 34)!.ch >= 3);
  assert.ok(layoutFor(200, 60)!.ch >= 5);
  assert.equal(layoutFor(80, 24)!.ch, 2);
});

test('sudoku: a click anywhere in a cell slot maps back to that cell, channels and the outside map to none', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [200, 60]] as const) {
    const layout = layoutFor(columns, rows)!;
    for (let cell = 0; cell < 81; cell += 1) {
      const x = layout.x + layout.xs[cell % 9]!, y = layout.y + layout.ys[Math.floor(cell / 9)]!;
      for (const [dx, dy] of [[0, 0], [layout.cw - 1, layout.ch - 1], [Math.floor(layout.cw / 2), Math.floor(layout.ch / 2)]] as const) assert.equal(cellAtPoint(layout, x + dx, y + dy), cell);
    }
    assert.equal(cellAtPoint(layout, layout.x - 1, layout.y), undefined);
    assert.equal(cellAtPoint(layout, layout.x + layout.xs[3]! - 1, layout.y + layout.ys[0]!), undefined, 'the channel between boxes');
  }
});

test('sudoku: a mouse click moves the cursor to the clicked cell', () => {
  const game = sudokuGame.create(context({size: {columns: 100, rows: 34}})) as unknown as {key(k: unknown): unknown; state: {cursor: number}};
  game.key({kind: 'enter'});
  const layout = layoutFor(100, 34)!;
  const cell = 7 * 9 + 5;
  game.key({kind: 'mouseClick', x: layout.x + layout.xs[5]! + 1 + 1, y: layout.y + layout.ys[7]! + 1 + 1});
  assert.equal(game.state.cursor, cell);
});

test('sudoku: render matrix stays inside every size in color, without color, in safe glyphs and with reduced motion', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 14]] as const) {
    for (const mode of [{color: 'truecolor' as const, safeGlyphs: false, reduced: false}, {color: 'none' as const, safeGlyphs: true, reduced: false}, {color: 'truecolor' as const, safeGlyphs: false, reduced: true}]) {
      const game = sudokuGame.create(context({size: {columns, rows}, color: mode.color, safeGlyphs: mode.safeGlyphs, motion: {reduced: mode.reduced, effects: mode.reduced ? 'subtle' : 'normal'}}));
      game.key({kind: 'enter'});
      game.key({kind: 'right'});
      const canvas = new Canvas(columns, rows);
      game.render(canvas, 0, arcadePalette());
      for (const line of canvas.plain({color: mode.color, safe: mode.safeGlyphs})) assert.ok(displayWidth(line) <= columns);
    }
  }
});

// ---- Merge ------------------------------------------------------------------------------------------------------

test('merge: tiles are physically square where there is room, inside the canvas, centered, with the well around them', () => {
  for (const [columns, rows] of SIZES) {
    const game = mergeGame.create(context({size: {columns, rows}})) as unknown as Internals;
    const layout = game.layout();
    if (!layout) { assert.ok(columns < 16 || rows < 6); continue; }
    if (layout.cellH > 1) {
      assert.equal(physicalRatio(layout.cellW, layout.cellH), 1, `${columns}x${rows}`);
      assert.ok(layout.cellH >= 2);
    }
    assert.ok(layout.x >= 0 && layout.x + layout.width <= columns && layout.y >= 1 && layout.y + layout.height <= rows);
    assert.ok(Math.abs(layout.x - (columns - layout.width - layout.x)) <= 1, `${columns}x${rows} centered`);
    if (layout.well) assert.ok(layout.well.x >= 0 && layout.well.x + layout.well.w <= columns && layout.well.y >= 1 && layout.well.y + layout.well.h <= rows);
  }
  const big = (mergeGame.create(context({size: {columns: 100, rows: 34}})) as unknown as Internals).layout()!;
  assert.ok(big.cellH >= 4, 'a roomy window gets big tiles');
  assert.equal((mergeGame.create(context({size: {columns: 100, rows: 34}})) as unknown as Internals).layout()!.cellW, big.cellH * 2);
});

test('merge: render matrix, with a slide in flight, stays inside every size and mode', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12], [20, 8]] as const) {
    for (const mode of [{color: 'truecolor' as const, safeGlyphs: false, reduced: false}, {color: 'none' as const, safeGlyphs: true, reduced: false}, {color: 'none' as const, safeGlyphs: false, reduced: true}]) {
      const game = mergeGame.create(context({size: {columns, rows}, color: mode.color, safeGlyphs: mode.safeGlyphs, motion: {reduced: mode.reduced, effects: mode.reduced ? 'subtle' : 'normal'}}));
      for (const key of ['left', 'down', 'right'] as const) {
        game.key({kind: key});
        const canvas = new Canvas(columns, rows);
        game.animate(30);
        game.render(canvas, 0, arcadePalette());
        for (const line of canvas.plain({color: mode.color, safe: mode.safeGlyphs})) assert.ok(displayWidth(line) <= columns);
      }
    }
  }
});

test('merge: every tile value stays readable in its slot', () => {
  const game = mergeGame.create(context({size: {columns: 100, rows: 34}, color: 'none'})) as unknown as Internals & {board: {tiles: Array<{id: number; value: number; cell: number; from: number; merged: boolean; fresh: boolean}>}; render(c: Canvas, a: number, p: ReturnType<typeof arcadePalette>): void; key(k: unknown): unknown};
  game.board.tiles = [{id: 1, value: 2048, cell: 0, from: 0, merged: false, fresh: false}, {id: 2, value: 16384, cell: 5, from: 5, merged: false, fresh: false}];
  const canvas = new Canvas(100, 34);
  game.render(canvas, 0, arcadePalette());
  const text = canvas.plain().join('\n');
  assert.match(text, /2048/u);
  assert.match(text, /16384/u);
});

// ---- Minefield: square --------------------------------------------------------------------------------------------

const start = (key: string, size = {columns: 100, rows: 34}, options: Partial<GameContext> = {}, record = memory()) => {
  const game = minesGame.create(context({size, ...options}, record)) as unknown as Internals & {key(k: unknown): unknown; render(c: Canvas, a: number, p: ReturnType<typeof arcadePalette>): void; animate(d: number): void; status: string};
  game.key({kind: 'text', value: key});
  return game;
};

test('minefield: squares are physically square at every size, inside the canvas and centered, for all six presets', () => {
  for (const [columns, rows] of SIZES) for (const [index, preset] of [...CLASSIC_PRESETS, ...HEX_PRESETS].entries()) {
    const game = start(String(index + 1), {columns, rows});
    const layout = game.layout();
    const spec = PRESETS[preset];
    if (!layout) continue;
    assert.equal(physicalRatio(layout.cellW, layout.cellH), 1, `${preset} ${columns}x${rows}`);
    assert.ok(layout.x >= 0 && layout.x + layout.width <= columns - (layout.side ? 26 : 0) && layout.y >= 1 && layout.y + layout.height <= rows);
    assert.equal(layout.across, spec.width);
    assert.equal(layout.down, spec.height);
    const room = columns - (layout.side ? 26 : 0);
    assert.ok(Math.abs(layout.x - (room - layout.width - layout.x)) <= 1, `${preset} ${columns}x${rows} centered`);
  }
  assert.ok(start('1', {columns: 100, rows: 34}).layout()!.cellH >= 3, 'a roomy window gets big cells');
  assert.ok(start('2', {columns: 100, rows: 34}).layout()!.cellH >= 2, 'the intermediate field no longer sits small in the middle');
});

test('minefield: a click maps through the same layout to the cell under it, round trip for every cell', () => {
  for (const key of ['1', '4']) for (const [columns, rows] of [[100, 34], [60, 24]] as const) {
    const size = start(key, {columns, rows}).board.size;
    for (let cell = 0; cell < size; cell += 1) {
      const game = start(key, {columns, rows});
      const layout = game.layout()!;
      const {x, y} = cellOrigin(layout, cell % game.board.width, Math.floor(cell / game.board.width), game.board.hex);
      game.key({kind: 'mouseClick', x: x + Math.floor(layout.cellW / 2) + 1, y: y + Math.floor(layout.cellH / 2) + 1});
      assert.equal(game.cursor, cell, `${key} ${columns}x${rows} cell ${cell}`);
    }
  }
});

test('minefield: render matrix inside every size, in color, without color (hidden squares stay visible) and in safe glyphs, classic and hex', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) {
    for (const key of ['1', '2', '4', '6']) {
      for (const mode of [{color: 'truecolor' as const, safeGlyphs: false, reduced: false}, {color: 'none' as const, safeGlyphs: true, reduced: false}, {color: 'none' as const, safeGlyphs: false, reduced: true}]) {
        const game = start(key, {columns, rows}, {color: mode.color, safeGlyphs: mode.safeGlyphs, motion: {reduced: mode.reduced, effects: mode.reduced ? 'subtle' : 'normal'}});
        game.key({kind: 'text', value: ' '});
        game.key({kind: 'text', value: 'f'});
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0, arcadePalette());
        const lines = canvas.plain({color: mode.color, safe: mode.safeGlyphs});
        for (const line of lines) assert.ok(displayWidth(line) <= columns, `${key} ${columns}x${rows}`);
        if (mode.safeGlyphs) for (const row of canvas.rows({color: 'none', safe: true})) assert.match(row, /^[\x20-\x7e\u001b[0-9;m]*$/u);
        if (mode.color === 'none' && game.layout()) assert.match(lines.join('\n'), /[.·]/u, 'hidden squares are marked without color');
      }
    }
  }
});

// ---- Minefield: hex ----------------------------------------------------------------------------------------------

test('hex topology: neighbours are symmetric, unique, in bounds, six inside and fewer on the edges, for every preset size', () => {
  for (const preset of HEX_PRESETS) {
    const {width, height} = PRESETS[preset];
    let total = 0;
    for (let cell = 0; cell < width * height; cell += 1) {
      const around = hexNeighbours(width, height, cell);
      total += around.length;
      assert.equal(new Set(around).size, around.length, 'no duplicates');
      assert.ok(!around.includes(cell));
      for (const next of around) {
        assert.ok(next >= 0 && next < width * height);
        assert.ok(hexNeighbours(width, height, next).includes(cell), `${cell} <-> ${next}`);
      }
      const x = cell % width, y = Math.floor(cell / width);
      const interior = x > 0 && x < width - 1 && y > 0 && y < height - 1;
      if (interior) assert.equal(around.length, 6);
      else assert.ok(around.length < 6 || (y > 0 && y < height - 1));
      assert.ok(around.length >= 2 && around.length <= 6);
    }
    // Sum of degrees counts each adjacency twice: rows give 2*(w-1)*h, the zigzag between rows (2w-1) per row pair.
    assert.equal(total, 2 * ((width - 1) * height + (height - 1) * (2 * width - 1)));
  }
});

test('hex topology: corners and edges follow the row parity', () => {
  const w = 5, h = 4;
  const at = (x: number, y: number) => y * w + x;
  const sorted = (cell: number) => hexNeighbours(w, h, cell).sort((a, b) => a - b);
  assert.deepEqual(sorted(at(0, 0)), [at(1, 0), at(0, 1)].sort((a, b) => a - b), 'top-left (even row): right and down-right only');
  assert.deepEqual(sorted(at(4, 0)), [at(3, 0), at(3, 1), at(4, 1)].sort((a, b) => a - b), 'top-right (even row)');
  assert.deepEqual(sorted(at(0, 3)), [at(1, 3), at(0, 2), at(1, 2)].sort((a, b) => a - b), 'bottom-left (odd row)');
  assert.deepEqual(sorted(at(4, 3)), [at(3, 3), at(4, 2)].sort((a, b) => a - b), 'bottom-right (odd row)');
  assert.deepEqual(sorted(at(2, 1)), [at(1, 1), at(3, 1), at(2, 0), at(3, 0), at(2, 2), at(3, 2)].sort((a, b) => a - b), 'odd row leans right');
  assert.deepEqual(sorted(at(2, 2)), [at(1, 2), at(3, 2), at(1, 1), at(2, 1), at(1, 3), at(2, 3)].sort((a, b) => a - b), 'even row leans left');
  for (const direction of HEX_DIRECTIONS) assert.equal(hexStep(w, h, at(0, 0), direction) === undefined, ['w', 'nw', 'ne', 'sw'].includes(direction));
});

test('hex mines: counts equal the neighbouring mines, mine totals are exact, over many seeds', () => {
  for (const preset of HEX_PRESETS) for (let seed = 1; seed <= 40; seed += 1) {
    const {width, height, mines} = PRESETS[preset];
    const board = new MineBoard(width, height, mines, createRng(seed), true);
    board.reveal((seed * 31) % board.size);
    assert.equal(board.mines.reduce((sum, mine) => sum + mine, 0), mines);
    for (let cell = 0; cell < board.size; cell += 1) {
      const counted = hexNeighbours(width, height, cell).reduce((sum, next) => sum + board.mines[next]!, 0);
      assert.equal(board.counts[cell], counted);
      assert.ok(board.counts[cell]! <= 6);
    }
  }
});

test('hex mines: the first click and its six neighbours are mine-free and open a region, over 300 seeds', () => {
  for (const preset of HEX_PRESETS) for (let seed = 1; seed <= 300; seed += 1) {
    const {width, height, mines} = PRESETS[preset];
    const board = new MineBoard(width, height, mines, createRng(seed), true);
    const first = (seed * 37) % board.size;
    board.reveal(first);
    assert.equal(board.lost, -1);
    assert.equal(board.mines[first], 0);
    for (const next of hexNeighbours(width, height, first)) assert.equal(board.mines[next], 0, 'the six neighbours are safe');
    assert.equal(board.counts[first], 0);
    assert.ok(hexNeighbours(width, height, first).every(next => board.state[next] === OPEN), 'and open');
  }
});

test('hex mines: the flood opens exactly the zero region and its numbered rim through hex adjacency', () => {
  const {width, height, mines} = PRESETS.hexMedium;
  const board = new MineBoard(width, height, mines, createRng(11), true);
  board.reveal(0);
  const open = new Set<number>();
  const stack = [0];
  while (stack.length) {
    const cell = stack.pop()!;
    if (open.has(cell) || board.mines[cell]) continue;
    open.add(cell);
    if (board.counts[cell] === 0) stack.push(...hexNeighbours(width, height, cell));
  }
  for (let cell = 0; cell < board.size; cell += 1) assert.equal(board.state[cell] === OPEN, open.has(cell), `cell ${cell}`);
  const depths = board.lastOpened.map(entry => entry.depth);
  assert.deepEqual(depths, [...depths].sort((a, b) => a - b), 'the cascade goes outward');
});

test('hex mines: flags, chording through six neighbours, and win detection', () => {
  const {width, height, mines} = PRESETS.hexSmall;
  const board = new MineBoard(width, height, mines, createRng(5), true);
  board.reveal(4 * width + 4);
  assert.equal(board.flag(0), true);
  assert.equal(board.state[0], FLAG);
  assert.equal(board.flag(0), true);
  assert.equal(board.state[0], HIDDEN);
  const number = [...Array(board.size).keys()].find(cell => board.state[cell] === OPEN && board.counts[cell]! > 0 && hexNeighbours(width, height, cell).some(next => board.state[next] === HIDDEN && !board.mines[next]))!;
  assert.equal(board.chord(number), false);
  for (const next of hexNeighbours(width, height, number)) if (board.mines[next]) board.flag(next);
  assert.equal(board.chord(number), true);
  for (const next of hexNeighbours(width, height, number)) assert.ok(board.state[next] === OPEN || board.state[next] === FLAG);
  assert.equal(board.won, false);
  for (let cell = 0; cell < board.size; cell += 1) if (!board.mines[cell]) board.reveal(cell);
  assert.equal(board.won, true);
  assert.equal(board.lost, -1);
});

test('hex mines: revealing a mine loses', () => {
  const board = new MineBoard(9, 8, 9, createRng(2), true);
  board.reveal(0);
  const mine = [...Array(board.size).keys()].find(cell => board.mines[cell])!;
  board.reveal(mine);
  assert.equal(board.lost, mine);
});

test('hex navigation: left/right, the four diagonals and a zigzagging up/down stay on the board and are consistent', () => {
  const game = start('4', {columns: 100, rows: 34}) as unknown as Internals & {key(k: unknown): unknown};
  const {width, height} = game.board;
  const centre = game.cursor;
  const row = (cell: number) => Math.floor(cell / width);
  const press = (value: string) => game.key({kind: 'text', value});
  press('e'); assert.equal(game.cursor, hexStep(width, height, centre, 'ne'));
  press('z'); assert.equal(game.cursor, centre, 'ne then sw returns');
  press('q'); assert.equal(game.cursor, hexStep(width, height, centre, 'nw'));
  press('c'); assert.equal(game.cursor, centre, 'nw then se returns');
  game.key({kind: 'right'}); assert.equal(game.cursor, centre + 1);
  game.key({kind: 'left'}); assert.equal(game.cursor, centre);
  const column = (cell: number) => (cell % width) + (row(cell) % 2 ? 0.5 : 0);
  for (let step = 0; step < 4; step += 1) game.key({kind: 'up'});
  assert.equal(row(game.cursor), row(centre) - 4);
  assert.ok(Math.abs(column(game.cursor) - column(centre)) <= 0.5, 'a run of ups keeps its visual column');
  for (let step = 0; step < 20; step += 1) game.key({kind: 'up'});
  assert.equal(row(game.cursor), 0, 'stops at the top edge');
  for (let step = 0; step < 40; step += 1) press('d');
  assert.equal(game.cursor % width, width - 1, 'stops at the right edge');
});

test('hex mode is chosen from the menu, titled Hex, and its bests are kept apart from the classic ones', () => {
  const record = memory({plays: 3, wins: 1, bestBeginner: 61_000});
  const game = start('4', {columns: 100, rows: 34}, {}, record) as unknown as Internals & {key(k: unknown): unknown; render(c: Canvas, a: number, p: ReturnType<typeof arcadePalette>): void; animate(d: number): void; status: string; finale: {skip(): void} | undefined};
  game.key({kind: 'text', value: ' '});
  game.animate(2000); game.animate(2000);
  const canvas = new Canvas(100, 34);
  game.render(canvas, 0, arcadePalette());
  assert.match(canvas.plain()[0]!, /Minefield · Hex Small/u);
  const {board} = game;
  assert.equal(board.hex, true);
  for (let cell = 0; cell < board.size; cell += 1) if (!board.mines[cell] && board.state[cell] === HIDDEN) { game.cursor = cell; game.key({kind: 'enter'}); }
  assert.equal(game.status, 'won');
  game.finale?.skip();
  const saved = readMines(record.raw());
  assert.ok(saved.best.hexSmall >= 4000);
  assert.equal(saved.best.beginner, 61_000, 'the classic best is untouched');
  assert.equal(record.raw().bestHexSmall, saved.best.hexSmall);
  assert.equal(saved.wins, 2);
  assert.equal(readMines({plays: 1, wins: 1, bestExpert: 9000}).best.expert, 9000, 'saved data from before hex still reads');
  const menu = minesGame.create(context({size: {columns: 60, rows: 24}}, record));
  const canvas2 = new Canvas(60, 24);
  menu.render(canvas2, 0, arcadePalette());
  assert.match(canvas2.plain().join('\n'), /Hex Small/u);
});

test('hex cells are drawn as hexagons from three rows up: narrow at the points, full in the middle, mirrored', () => {
  for (const h of [3, 4, 5, 6, 8]) {
    const rows = hexRows(h * 2, h)!;
    assert.equal(rows.length, h);
    assert.equal(rows[0]!.l > 0, true);
    assert.equal(rows[Math.floor(h / 2)]!.l, 0);
    rows.forEach((row, index) => { const mirror = rows[h - 1 - index]!; assert.equal(row.l, mirror.l); assert.equal(row.r, mirror.r); assert.ok(row.r - row.l >= 1); });
  }
  assert.equal(hexRows(4, 2), undefined);
});

test('hex hit testing: staggered rows shift half a cell, round trip over the whole board at several sizes', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16]] as const) {
    const game = start('6', {columns, rows});
    const layout = game.layout();
    if (!layout) continue;
    assert.equal(physicalRatio(layout.cellW, layout.cellH), 1);
    const even = cellOrigin(layout, 0, 0, true), odd = cellOrigin(layout, 0, 1, true);
    assert.equal(odd.x - even.x, Math.floor(layout.stepX / 2));
  }
});
