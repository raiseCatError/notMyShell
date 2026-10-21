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

/** Paint a hexagon in a slot. Returns the box of its full-width middle for the digit. */
export function paintHex(canvas: Canvas, x: number, y: number, cellW: number, cellH: number, paint: TilePaint): TileBox {
  const rows = hexRows(cellW, cellH)!;
  const {fill, plate} = paint;
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
