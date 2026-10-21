import {CELL_ASPECT} from '../../engine/boardLayout.js';

/**
 * Board geometry: the largest board of physically square cells that fits the canvas, with the HUD beside it when there
 * is room and above it otherwise. Pure numbers, no drawing, so the tests can sweep canvas sizes.
 *
 * A terminal cell is about twice as tall as wide, so a cell is `ch` rows by `cw = 2 * ch` columns (CELL_ASPECT). The board
 * is three levels of surface: a dark channel (the well) around and between the 3x3 boxes, each box a plate of 3x3 cell
 * slots, and each cell a tile inset in its slot (see engine/tilePaint.ts: one column each side, half blocks top and
 * bottom, so the visible tile is square and tiles in a box are kept apart by plate). The channel is two columns by one
 * row (square again), or four by two on big boards, so a box boundary is always stronger than a cell boundary.
 */
export interface CellSize {
  /** Slot width and height in cells (cw is ch * 2). */
  cw: number;
  ch: number;
  /** Always 0: tiles are kept apart by their own inset, not by extra slot columns. */
  gap: number;
  pad: number;
  /** Channel width in columns and height in rows between boxes (and around the board when `edge`). */
  chanX: number;
  chanY: number;
  /** Whether the channel also runs around the outside of the board (not on the smallest board). */
  edge?: boolean;
}

const square = (ch: number, edge = true): CellSize => {
  const chanY = ch >= 5 ? 2 : 1;
  return {cw: ch * CELL_ASPECT, ch, gap: 0, pad: 0, chanX: ch === 1 ? 1 : chanY * CELL_ASPECT, chanY, edge};
};

/** Largest first. */
const SIZES: readonly CellSize[] = [square(6), square(5), square(4), square(3), square(2), square(1), square(1, false)];

export const MIN_COLUMNS = 20;
export const MIN_ROWS = 13;
export const SIDE_MIN = 22;
export const SIDE_MAX = 30;
export const SIDE_GAP = 3;
/** The channel between boxes and around the board. */
const CHANNEL = 1;

export interface Span { at: number; size: number }

export interface Layout extends CellSize {
  boardW: number;
  boardH: number;
  /** Offsets of each cell column / row from the board's top-left. */
  xs: number[];
  ys: number[];
  /** Each box's plate, as offsets from the board's top-left. */
  plateX: Span[];
  plateY: Span[];
  hud: 'side' | 'top';
  /** Board origin on the canvas. */
  x: number;
  y: number;
  /** Top HUD: the first row; side HUD: its left edge and width. */
  hudX: number;
  hudY: number;
  hudW: number;
  /** A spare row under the board for the status message (top HUD only). */
  messageRow: number | undefined;
}

function axis(size: number, chan: number, edge: boolean): {offsets: number[]; plates: Span[]; total: number} {
  const offsets: number[] = [];
  const plates: Span[] = [];
  let at = edge ? chan : 0;
  for (let box = 0; box < 3; box += 1) {
    if (box > 0) at += chan;
    const start = at;
    for (let cell = 0; cell < 3; cell += 1) { offsets.push(at); at += size; }
    plates.push({at: start, size: at - start});
  }
  return {offsets, plates, total: at + (edge ? chan : 0)};
}

const vertical = (size: CellSize) => axis(size.ch, size.chanY, size.edge !== false);
const horizontal = (size: CellSize) => axis(size.cw, size.chanX, size.edge !== false);

export function boardSize(size: CellSize): {width: number; height: number} {
  return {width: horizontal(size).total, height: vertical(size).total};
}

/** The cell whose slot holds a canvas position (a click), or undefined in a channel or outside the board. */
export function cellAtPoint(layout: Layout, column: number, row: number): number | undefined {
  const cx = layout.xs.findIndex(offset => column - layout.x >= offset && column - layout.x < offset + layout.cw);
  const cy = layout.ys.findIndex(offset => row - layout.y >= offset && row - layout.y < offset + layout.ch);
  return cx < 0 || cy < 0 ? undefined : cy * 9 + cx;
}

/**
 * The best layout for a canvas, or undefined when even the smallest board plus its HUD does not fit. The HUD goes beside
 * the board whenever a board of the same tile height fits that way (slightly narrower tiles beat a cramped top HUD).
 */
export function layoutFor(columns: number, rows: number): Layout | undefined {
  let top: Layout | undefined;
  for (const size of SIZES) {
    const across = horizontal(size);
    const down = vertical(size);
    const boardW = across.total;
    const boardH = down.total;
    const make = (hud: 'side' | 'top', x: number, y: number, hudX: number, hudY: number, hudW: number, messageRow?: number): Layout => ({
      ...size, boardW, boardH, xs: across.offsets, ys: down.offsets, plateX: across.plates, plateY: down.plates, hud, x, y, hudX, hudY, hudW, messageRow,
    });
    if (top && size.ch < top.ch) return top;
    const sideW = Math.min(SIDE_MAX, columns - boardW - SIDE_GAP - 1);
    if (sideW >= SIDE_MIN && rows >= boardH) {
      const group = boardW + SIDE_GAP + sideW;
      const left = Math.floor((columns - group) / 2);
      const y = Math.floor((rows - boardH) / 2);
      return make('side', left, y, left + boardW + SIDE_GAP, y, sideW);
    }
    if (!top && columns >= boardW && rows >= boardH + 2) {
      const message = rows >= boardH + 3;
      const used = boardH + 2 + (message ? 1 : 0);
      const y = Math.floor((rows - used) / 2);
      const left = Math.floor((columns - boardW) / 2);
      const hudW = Math.max(boardW, Math.min(columns, 38));
      top = make('top', left, y + 2, Math.max(0, Math.min(left, columns - hudW)), y, hudW, message ? y + 2 + boardH : undefined);
    }
  }
  return top;
}
