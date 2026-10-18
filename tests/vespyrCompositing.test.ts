import test from 'node:test';
import assert from 'node:assert/strict';
import {CellGrid, mixPacked, NO_COLOR_VALUE} from '../src/idle/CellGrid.js';
import {idlePalette, renderScene} from '../src/idle/scenes.js';
import {IDLE_SEED} from '../src/idle/IdleVisuals.js';
import {CAT_BODY, CAT_CELL_WIDTH, CAT_EYE, CAT_WHISKER, catCells, compositeCat, type CatPose} from '../src/idle/catSprite.js';

/**
 * Vespyr is composited into a sky grid pixel by pixel: each cell is two
 * vertical pixels, a sprite pixel replaces only its half, and nothing the
 * sprite does not cover changes. No rectangle, halo or blended block.
 */
const PALETTE = idlePalette([{red: 62, green: 232, blue: 181}, {red: 69, green: 184, blue: 240}, {red: 166, green: 124, blue: 243}]);

function aurora(width: number, height: number, time: number, grid = new CellGrid()): CellGrid {
  grid.resize(width, height);
  renderScene('aurora', grid, {time, seed: IDLE_SEED, palette: PALETTE, level: 'truecolor', nerd: true});
  return grid;
}

/** Every cell a half block with its own distinct upper and lower color, so any change to a half is visible. */
function striped(width: number, height: number): CellGrid {
  const grid = new CellGrid();
  grid.resize(width, height);
  for (let index = 0; index < width * height; index++) {
    grid.glyphs[index] = '▀';
    grid.fg[index] = 0x100000 + index * 3;
    grid.bg[index] = 0x400000 + index * 5;
  }
  return grid;
}

const copy = (grid: CellGrid) => ({glyphs: [...grid.glyphs], fg: [...grid.fg], bg: [...grid.bg]});

/** Covered pixels of a pose at (x, y), as cell index → which halves the sprite paints. */
function coverage(grid: CellGrid, x: number, y: number, pose: CatPose, facingRight: boolean): Map<number, {upper?: number; lower?: number}> {
  const map = new Map<number, {upper?: number; lower?: number}>();
  for (const cell of catCells(pose, facingRight)) {
    const index = (y + cell.dy) * grid.width + x + cell.dx;
    map.set(index, cell.glyph === '▀' ? {upper: cell.fg, ...(cell.bg !== undefined ? {lower: cell.bg} : {})} : {lower: cell.fg});
  }
  return map;
}

const whiskerColumns = (x: number, facingRight: boolean) => [0, 6].map(source => x + (facingRight ? CAT_WIDTH_LAST - source : source));
const CAT_WIDTH_LAST = CAT_CELL_WIDTH - 1;

test('halves decode every cell encoding the sky uses', () => {
  const grid = new CellGrid();
  grid.resize(4, 1);
  grid.set(0, 0, '▀', 0x111111, 0x222222);
  grid.set(1, 0, '▄', 0x333333, 0x444444);
  grid.set(2, 0, ' ', NO_COLOR_VALUE, 0x555555);
  grid.set(3, 0, '·', 0xeeeeee, 0x666666);
  assert.deepEqual(grid.halves(0, 0), [0x111111, 0x222222]);
  assert.deepEqual(grid.halves(1, 0), [0x444444, 0x333333]);
  assert.deepEqual(grid.halves(2, 0), [0x555555, 0x555555]);
  assert.deepEqual(grid.halves(3, 0), [0x666666, 0x666666], 'a star keeps its cell background for both halves');
  assert.deepEqual(grid.halves(9, 9), [NO_COLOR_VALUE, NO_COLOR_VALUE], 'outside the grid is transparent');
});

test('cells outside the silhouette keep their exact glyph, fg and bg over an aurora frame', () => {
  for (const facingRight of [true, false]) for (const pose of ['idle', 'blink', 'tail'] as const) {
    const grid = aurora(48, 9, 30_500);
    const before = copy(grid);
    const x = 5, y = 5;
    compositeCat(grid, x, y, pose, facingRight);
    const covered = coverage(grid, x, y, pose, facingRight);
    const whiskers = new Set(whiskerColumns(x, facingRight).map(column => (y + 1) * grid.width + column));
    for (let index = 0; index < grid.width * grid.height; index++) {
      if (covered.has(index) || whiskers.has(index)) continue;
      assert.equal(grid.glyphs[index], before.glyphs[index], `glyph ${index} ${pose} ${facingRight}`);
      assert.equal(grid.fg[index], before.fg[index], `fg ${index}`);
      assert.equal(grid.bg[index], before.bg[index], `bg ${index}`);
    }
    // Every sprite pixel is exactly the sprite's own color.
    for (const [index, paint] of covered) {
      const [upper, lower] = grid.halves(index % grid.width, Math.floor(index / grid.width));
      if (paint.upper !== undefined) assert.equal(upper, paint.upper);
      if (paint.lower !== undefined) assert.equal(lower, paint.lower);
    }
  }
});

test('a half-covered cell keeps the uncovered half\'s exact color', () => {
  const grid = striped(30, 8);
  const before = striped(30, 8);
  const x = 3, y = 2;
  compositeCat(grid, x, y, 'idle', true);
  let checked = 0;
  for (const [index, paint] of coverage(grid, x, y, 'idle', true)) {
    const column = index % grid.width, row = Math.floor(index / grid.width);
    const [upper, lower] = grid.halves(column, row);
    const [beforeUpper, beforeLower] = before.halves(column, row);
    if (paint.upper === undefined) { assert.equal(upper, beforeUpper, `upper half of ${column},${row} untouched`); checked++; }
    if (paint.lower === undefined) { assert.equal(lower, beforeLower, `lower half of ${column},${row} untouched`); checked++; }
  }
  assert.ok(checked >= 8, 'the sprite has half-covered cells (ears, tail, legs)');
});

test('over no background, empty halves stay transparent and emit no background escape', () => {
  const grid = new CellGrid();
  grid.resize(24, 6);
  grid.clear(NO_COLOR_VALUE);
  compositeCat(grid, 3, 1, 'idle', true);
  for (let index = 0; index < grid.width * grid.height; index++) {
    const [upper, lower] = grid.halves(index % grid.width, Math.floor(index / grid.width));
    if (upper === NO_COLOR_VALUE || lower === NO_COLOR_VALUE) assert.equal(grid.bg[index], NO_COLOR_VALUE, `cell ${index} has a transparent half and no background`);
  }
  const rows = grid.toRows('truecolor');
  const allowed = new Set([CAT_BODY, CAT_EYE].map(value => `${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}`));
  for (const row of rows) {
    for (const match of row.matchAll(/\u001b\[48;2;(\d+;\d+;\d+)m/gu)) assert.ok(allowed.has(match[1]!), `only Vespyr's own two-color cells carry a background, not ${match[1]}`);
  }
  // The rows around the sprite carry no background at all.
  assert.doesNotMatch(rows[0]!, /\u001b\[48;/u);
  assert.doesNotMatch(rows[5]!, /\u001b\[48;/u);
});

test('whisker background is the mean of the pixels it covers, transparent over no sky', () => {
  const grid = striped(30, 8);
  const before = striped(30, 8);
  const x = 4, y = 2;
  compositeCat(grid, x, y, 'idle', true);
  for (const column of whiskerColumns(x, true)) {
    const index = (y + 1) * grid.width + column;
    const [upper, lower] = before.halves(column, y + 1);
    assert.equal(grid.glyphs[index], '=');
    assert.equal(grid.fg[index], CAT_WHISKER);
    assert.equal(grid.bg[index], mixPacked(upper, lower, 0.5));
  }
  const empty = new CellGrid();
  empty.resize(30, 8);
  empty.clear(NO_COLOR_VALUE);
  compositeCat(empty, x, y, 'idle', true);
  for (const column of whiskerColumns(x, true)) {
    const index = (y + 1) * empty.width + column;
    assert.equal(empty.glyphs[index], '=');
    assert.equal(empty.bg[index], NO_COLOR_VALUE);
  }
});

test('compositing over successive aurora frames leaves no ghost of the previous frame', () => {
  const reused = new CellGrid();
  aurora(48, 9, 30_500, reused);
  compositeCat(reused, 6, 5, 'tail', true);
  aurora(48, 9, 30_740, reused);
  compositeCat(reused, 6, 5, 'idle', true);
  const fresh = aurora(48, 9, 30_740);
  compositeCat(fresh, 6, 5, 'idle', true);
  assert.deepEqual(copy(reused), copy(fresh));
  // Without a sky the caller clears; the tail flick's pixels do not linger either.
  const still = new CellGrid();
  still.resize(30, 6);
  still.clear(NO_COLOR_VALUE);
  compositeCat(still, 2, 1, 'tail', true);
  still.clear(NO_COLOR_VALUE);
  compositeCat(still, 2, 1, 'idle', true);
  const plain = new CellGrid();
  plain.resize(30, 6);
  plain.clear(NO_COLOR_VALUE);
  compositeCat(plain, 2, 1, 'idle', true);
  assert.deepEqual(copy(still), copy(plain));
});

test('sprite pixels outside the grid are clipped, never wrapped onto another row', () => {
  const grid = striped(10, 3);
  const before = copy(grid);
  compositeCat(grid, 6, 1, 'idle', true);
  // Columns 0..5 of every row and row 0 (above the sprite) are untouched.
  let changed = 0;
  for (let row = 0; row < 3; row++) for (let column = 0; column < 10; column++) {
    const index = row * 10 + column;
    if (row === 0 || column < 6) {
      assert.equal(grid.fg[index], before.fg[index], `${column},${row}`);
      assert.equal(grid.bg[index], before.bg[index], `${column},${row}`);
    } else if (grid.fg[index] !== before.fg[index] || grid.bg[index] !== before.bg[index]) changed++;
  }
  assert.ok(changed > 0, 'the visible part of the sprite is drawn');
});
