import type {Rgb} from '../../chroma/escape.js';
import type {Canvas} from '../Canvas.js';
import {hexOverlap} from './boardLayout.js';

/**
 * Painting one board tile inside its slot (a `cellW` x `cellH` rectangle that is physically square). From three rows up a
 * tile is inset one column each side and capped with half blocks top and bottom, so its visible part is square too and
 * neighbouring tiles are separated by a channel of the plate color (one column is as wide as half a row is tall).
 * Two-row slots have no row to carry a digit inside half-block edges, so they are filled whole and separated by thin
 * seams; one-row slots are filled whole.
 */
export interface TilePaint { fill: Rgb | undefined; plate: Rgb | undefined; edges: boolean; reverse?: boolean }
export interface TileBox {
  /** Inner (filled) columns, the row holding the digit, and the column of the digit. */
  ix: number; iw: number; digitRow: number; digitX: number;
}

export function paintTile(canvas: Canvas, x: number, y: number, cellW: number, cellH: number, paint: TilePaint): TileBox {
  const {fill, plate, edges} = paint;
  const inset = cellH >= 3 ? 1 : 0;
  const ix = x + inset, iw = cellW - 2 * inset;
  const body = {bg: fill, ...(paint.reverse ? {reverse: true} : {})};
  for (let dy = 0; dy < cellH; dy += 1) {
    const cap = edges && cellH >= 3 && (dy === 0 || dy === cellH - 1);
    if (cap) canvas.hline(ix, y + dy, iw, dy === 0 ? '▄' : '▀', {fg: fill, bg: plate});
    else canvas.fill(ix, y + dy, iw, 1, ' ', body);
  }
  if (edges && cellH === 2 && fill && plate) {
    canvas.hline(x, y, cellW, '▔', {fg: plate, bg: fill});
    canvas.vline(x, y + 1, 1, '▏', {fg: plate, bg: fill});
  }
  const digitRow = y + Math.floor(cellH / 2);
  return {ix, iw, digitRow, digitX: ix + Math.floor((iw - 1) / 2)};
}

/**
 * The rows of a pointy-top hexagon filling its slot's width, built to interlock: its first and last `hexOverlap` rows
 * narrow towards a point and the rows of the next hex row (shifted half a cell) nest into them, so the narrowing of a
 * row and of its mirror in the row below sum to half the cell width and the two never share a column. `l` and `r` are
 * offsets of the first and last filled column; narrowed rows end in a slanted glyph. Undefined below three rows, where
 * cells are drawn as staggered tiles instead.
 */
export interface HexRow { l: number; r: number; edge: 'top' | 'bottom' | undefined }
export function hexRows(cellW: number, cellH: number): HexRow[] | undefined {
  if (cellH < 3) return undefined;
  const overlap = hexOverlap(cellH);
  const rows: HexRow[] = [];
  for (let dy = 0; dy < cellH; dy += 1) {
    const fromEnd = cellH - 1 - dy;
    const k = Math.min(dy, fromEnd);
    const inset = k < overlap ? Math.min(Math.floor(cellW / 2) - 1, Math.round(cellW / 2 * (1 - (k + 1) / (overlap + 1)))) : 0;
    rows.push({l: inset, r: cellW - 1 - inset, edge: inset > 0 ? (dy < fromEnd ? 'top' : 'bottom') : undefined});
  }
  return rows;
}

/**
 * A hexagon as half-block pixels: `2 * cellH` pixel rows, each `cellW` columns at most (a column is as wide as a pixel row
 * is tall, so pixels are square). The first and last `overlap` pixel rows narrow towards the points, and the narrowing of
 * a row and of its mirror in the next hex row (shifted half a cell) sum to the cell width, so rows nest with no gap and no
 * shared pixel. Widths are even so the shape is centered on the cell. Undefined for one-row cells.
 */
export function hexPixelWidths(cellW: number, cellH: number): number[] | undefined {
  if (cellH < 2) return undefined;
  const pixels = cellH * 2;
  const overlap = cellH === 2 ? 1 : 2 * hexOverlap(cellH);
  const top: number[] = [];
  for (let k = 0; k < overlap; k += 1) {
    const mirror = overlap - 1 - k;
    // The first half of the slope is rounded to an even width, the second is whatever completes the pair.
    top.push(k <= mirror ? Math.max(2, Math.min(cellW - 2, 2 * Math.round(cellW * (k + 1) / (overlap + 1) / 2))) : -1);
  }
  for (let k = 0; k < overlap; k += 1) if (top[k]! < 0) top[k] = cellW - top[overlap - 1 - k]!;
  const widths: number[] = [];
  for (let row = 0; row < pixels; row += 1) {
    const edge = Math.min(row, pixels - 1 - row);
    widths.push(edge < overlap ? top[edge]! : cellW);
  }
  return widths;
}

/** Where a hexagon's digit goes: the terminal row (from the cell's top row) whose two pixel rows both belong to it, nearest the middle. */
export function hexDigitRow(cellH: number, half: 0 | 1): number {
  const pixels = cellH * 2;
  let best = Math.ceil(half / 2), bestOff = Infinity;
  for (let row = Math.ceil(half / 2); 2 * row + 1 <= half + pixels - 1; row += 1) {
    const off = Math.abs(2 * row + 1 - (half + pixels) / 2);
    if (off < bestOff) { bestOff = off; best = row; }
  }
  return best;
}

/** One half-block pixel of the canvas: the cell keeps its other half, whatever it showed. */
function setHalf(canvas: Canvas, column: number, pixelRow: number, fill: Rgb, plate: Rgb): void {
  const row = pixelRow >> 1;
  const cell = canvas.cell(column, row);
  if (!cell) return;
  const base = cell.bg ?? plate;
  let upper = base, lower = base;
  if (cell.ch === '▀') { upper = cell.fg ?? base; lower = base; } else if (cell.ch === '▄') { upper = base; lower = cell.fg ?? base; }
  if (pixelRow & 1) lower = fill; else upper = fill;
  const same = upper.red === lower.red && upper.green === lower.green && upper.blue === lower.blue;
  if (same) canvas.put(column, row, ' ', {bg: upper}); else canvas.put(column, row, '▀', {fg: upper, bg: lower});
}

/**
 * Paint a hexagon in a slot. With colors and half blocks (`edges`) it is drawn pixel by pixel into whatever the canvas
 * holds, so neighbouring hexagons nest; `half` is 1 when the slot starts on the lower pixel row of its terminal row
 * (two-row hexagons nesting by half a row). Without them it is row-filled, narrowed at the points. Returns the middle for the digit.
 */
export function paintHex(canvas: Canvas, x: number, y: number, cellW: number, cellH: number, paint: TilePaint, half: 0 | 1 = 0): TileBox {
  const {fill, plate} = paint;
  const widths = hexPixelWidths(cellW, cellH);
  if (paint.edges && fill && plate && widths) {
    widths.forEach((width, row) => {
      const left = x + Math.floor((cellW - width) / 2);
      for (let column = left; column < left + width; column += 1) setHalf(canvas, column, 2 * y + half + row, fill, plate);
    });
    return {ix: x, iw: cellW, digitRow: y + hexDigitRow(cellH, half), digitX: x + Math.floor((cellW - 1) / 2)};
  }
  const rows = hexRows(cellW, cellH);
  if (!rows) return paintTile(canvas, x, y, cellW, cellH, paint);
  rows.forEach((row, dy) => {
    const width = row.r - row.l + 1;
    canvas.fill(x + row.l, y + dy, width, 1, ' ', {bg: fill, ...(paint.reverse ? {reverse: true} : {})});
    if (!row.edge || !paint.edges) return;
    const [left, right] = row.edge === 'top' ? ['▟', '▙'] : ['▜', '▛'];
    canvas.put(x + row.l, y + dy, left, {fg: fill, bg: plate});
    canvas.put(x + row.r, y + dy, right, {fg: fill, bg: plate});
  });
  const digitRow = y + Math.floor(cellH / 2);
  return {ix: x, iw: cellW, digitRow, digitX: x + Math.floor((cellW - 1) / 2)};
}
