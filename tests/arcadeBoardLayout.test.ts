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
