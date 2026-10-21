import test from 'node:test';
import assert from 'node:assert/strict';
import {CELL_ASPECT, cellAt, cellOrigin, physicalRatio, squareLayout} from '../src/arcade/engine/boardLayout.js';

test('cells are physically square at every size that fits, and the board stays inside the area and centered', () => {
  for (const [columns, rows] of [[120, 40], [80, 24], [60, 20], [40, 16], [28, 12]] as const) for (const n of [4, 8, 9]) for (const gap of [0, 1]) {
    const layout = squareLayout({columns, rows, top: 1, bottom: 2}, n, n, {gap, maxCellH: 20});
    if (!layout) continue;
    assert.equal(physicalRatio(layout.cellW, layout.cellH), 1);
    assert.equal(layout.cellW, layout.cellH * CELL_ASPECT);
    assert.ok(layout.x >= 0 && layout.x + layout.width <= columns);
    assert.ok(layout.y >= 1 && layout.y + layout.height <= rows - 2);
    assert.ok(Math.abs(layout.x - (columns - layout.width - layout.x)) <= 1, 'centered across');
    const bigger = squareLayout({columns, rows, top: 1, bottom: 2}, n, n, {gap, maxCellH: layout.cellH + 1});
    assert.ok(!bigger || bigger.cellH === layout.cellH, 'the largest cell that fits is chosen');
  }
});

test('the board uses the space: wide terminals get larger cells than narrow ones', () => {
  const big = squareLayout({columns: 120, rows: 40}, 4, 4, {maxCellH: 12})!;
  const small = squareLayout({columns: 30, rows: 14}, 4, 4)!;
  assert.ok(big.cellH > small.cellH);
});

test('too small a terminal yields no layout', () => {
  assert.equal(squareLayout({columns: 10, rows: 5}, 9, 9), undefined);
});

test('cellAt inverts cellOrigin for every cell, square and hex, and rejects gaps and the outside', () => {
  for (const hex of [false, true]) {
    const layout = squareLayout({columns: 100, rows: 34}, 8, 7, {gap: 1, hex})!;
    for (let cy = 0; cy < 7; cy += 1) for (let cx = 0; cx < 8; cx += 1) {
      const {x, y} = cellOrigin(layout, cx, cy, hex);
      for (const [dx, dy] of [[0, 0], [layout.cellW - 1, layout.cellH - 1]] as const) assert.deepEqual(cellAt(layout, x + dx, y + dy, hex), {cx, cy});
      assert.equal(cellAt(layout, x + layout.cellW, y, hex), undefined, 'the gap belongs to no cell');
    }
    assert.equal(cellAt(layout, layout.x - 1, layout.y, hex), undefined);
    assert.equal(cellAt(layout, layout.x, layout.y + layout.height + 3, hex), undefined);
    assert.ok(layout.x + layout.width <= 100);
  }
});

// ---- hexagons as half-block pixels --------------------------------------------------------------------------------

import {Canvas} from '../src/arcade/Canvas.js';
import {hexCellAt, hexHalf} from '../src/arcade/engine/boardLayout.js';
import {hexDigitRow, hexPixelWidths, paintHex} from '../src/arcade/engine/tilePaint.js';

const rgbOf = (n: number) => ({red: n, green: 40, blue: 90});
/** The color of one half-block pixel of a canvas (a pixel row is half a terminal row). */
function pixel(canvas: Canvas, column: number, pixelRow: number) {
  const cell = canvas.cell(column, pixelRow >> 1)!;
  const bg = cell.bg!;
  return cell.ch === '▀' ? ((pixelRow & 1) ? bg : cell.fg!) : cell.ch === '▄' ? ((pixelRow & 1) ? cell.fg! : bg) : bg;
}

test('hexagon pixel rows: even widths, mirrored, and two nested rows never share a pixel nor leave a gap, at every cell size', () => {
  for (const h of [2, 3, 4, 5, 6, 8]) {
    const w = h * 2;
    const widths = hexPixelWidths(w, h)!;
    assert.equal(widths.length, h * 2);
    widths.forEach((width, row) => { assert.equal(width % 2, 0, `h${h} row ${row}`); assert.equal(width, widths[widths.length - 1 - row]); assert.ok(width >= 2 && width <= w); });
    assert.equal(widths[Math.floor(h)], w, 'full width in the middle');
    // The overlap between this hex row and the next: this row's bottom pixels pair with the next row's top pixels.
    const overlap = h === 2 ? 1 : 2 * Math.max(1, Math.round(h / 4));
    for (let k = 0; k < overlap; k += 1) assert.equal(widths[widths.length - overlap + k]! + widths[k]!, w, `h${h}: nested rows leave no gap and share nothing`);
  }
  assert.equal(hexPixelWidths(2, 1), undefined);
});

test('hexagons tile: painting a whole board, every hexagon keeps all its own pixels (nothing overwritten) and nothing leaves the board, with half-row nesting too', () => {
  for (const [columns, rows, across, down] of [[100, 34, 9, 8], [80, 24, 16, 14], [60, 24, 14, 11], [40, 16, 9, 8]] as const) {
    const layout = squareLayout({columns, rows, top: 1}, across, down, {hex: true, interlock: true, halfRows: true, maxCellH: 6})!;
    assert.ok(layout.cellH >= 2);
    const canvas = new Canvas(columns, rows);
    const base = {red: 1, green: 1, blue: 1};
    canvas.clear(base);
    const widths = hexPixelWidths(layout.cellW, layout.cellH)!;
    const owned = widths.reduce((sum, width) => sum + width, 0);
    const counts = new Map<number, number>();
    for (let cy = 0; cy < down; cy += 1) for (let cx = 0; cx < across; cx += 1) {
      const {x, y} = cellOrigin(layout, cx, cy, true);
      paintHex(canvas, x, y, layout.cellW, layout.cellH, {fill: rgbOf(cy * across + cx + 10), plate: base, edges: true}, hexHalf(layout, cy));
    }
    for (let row = 0; row < rows * 2; row += 1) for (let column = 0; column < columns; column += 1) {
      const color = pixel(canvas, column, row);
      if (color.red === 1) continue;
      assert.ok(column >= layout.x && column < layout.x + layout.width && row >= layout.y * 2 && row < (layout.y + layout.height) * 2, `${columns}x${rows}: pixel outside the board`);
      counts.set(color.red, (counts.get(color.red) ?? 0) + 1);
    }
    assert.equal(counts.size, across * down);
    for (const [id, count] of counts) assert.equal(count, owned, `${columns}x${rows}: hexagon ${id - 10} lost pixels to a neighbour`);
  }
});

test('hexagon hit testing: the digit cell of every hexagon maps back to it and each hexagon is reached from its pixels, at whole and half-row nesting', () => {
  for (const [columns, rows, across, down, halfRows] of [[100, 34, 16, 14, true], [80, 24, 16, 14, true], [60, 24, 14, 11, true], [100, 34, 9, 8, false]] as const) {
    const layout = squareLayout({columns, rows, top: 1}, across, down, {hex: true, interlock: true, halfRows, maxCellH: 6})!;
    for (let cy = 0; cy < down; cy += 1) for (let cx = 0; cx < across; cx += 1) {
      const {x, y} = cellOrigin(layout, cx, cy, true);
      const half = hexHalf(layout, cy);
      const row = y + hexDigitRow(layout.cellH, half), column = x + Math.floor((layout.cellW - 1) / 2);
      assert.deepEqual(hexCellAt(layout, column, row), {cx, cy}, `${columns}x${rows} cell ${cx},${cy}`);
    }
    // Every terminal cell the hexagons can cover maps to a real cell, and a cell outside the board to none.
    assert.equal(hexCellAt(layout, layout.x - 1, layout.y + 1), undefined);
    assert.equal(hexCellAt(layout, layout.x + 1, layout.y + layout.height), undefined);
    for (let row = layout.y; row < layout.y + layout.height; row += 1) for (let column = layout.x; column < layout.x + layout.width; column += 1) {
      const at = hexCellAt(layout, column, row);
      if (at) assert.ok(at.cx >= 0 && at.cx < across && at.cy >= 0 && at.cy < down);
    }
  }
});

test('two-row hexagons nest by half a row: odd rows start on a lower pixel row, the board is shorter than staggered tiles, and cells stay square', () => {
  const tight = squareLayout({columns: 80, rows: 24, top: 1}, 16, 14, {hex: true, interlock: true, halfRows: true, maxCellH: 6})!;
  assert.equal(tight.cellH, 2);
  assert.equal(tight.stepY, 1.5);
  assert.equal(physicalRatio(tight.cellW, tight.cellH), 1);
  assert.deepEqual([0, 1, 2, 3].map(cy => hexHalf(tight, cy)), [0, 1, 0, 1]);
  assert.deepEqual([0, 1, 2, 3].map(cy => cellOrigin(tight, 0, cy, true).y - tight.y), [0, 1, 3, 4]);
  const tiles = squareLayout({columns: 80, rows: 24, top: 1}, 16, 14, {hex: true, interlock: false, maxCellH: 6})!;
  assert.ok(tiles.cellH < 2 || tiles.height > tight.height, 'without half rows the same board needs more room');
  assert.ok(tight.height <= 23);
});
