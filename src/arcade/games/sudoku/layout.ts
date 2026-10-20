/**
 * Board geometry: the largest set of cells that fits the canvas, with the HUD beside the board when there is room and
 * above it otherwise. Pure numbers, no drawing, so the tests can sweep canvas sizes.
 */
export interface CellSize { cw: number; ch: number; thinV: boolean; thinH: boolean; border: boolean }

/** Largest first. Box lines are always drawn; thin lines between cells only where they fit. */
const SIZES: readonly CellSize[] = [
  {cw: 7, ch: 3, thinV: true, thinH: true, border: true},
  {cw: 7, ch: 3, thinV: true, thinH: false, border: true},
  {cw: 5, ch: 3, thinV: true, thinH: true, border: true},
  {cw: 5, ch: 3, thinV: true, thinH: false, border: true},
  {cw: 5, ch: 1, thinV: true, thinH: true, border: true},
  {cw: 5, ch: 1, thinV: true, thinH: false, border: true},
  {cw: 3, ch: 1, thinV: true, thinH: true, border: true},
  {cw: 3, ch: 1, thinV: true, thinH: false, border: true},
  {cw: 3, ch: 1, thinV: false, thinH: false, border: true},
  {cw: 2, ch: 1, thinV: false, thinH: false, border: true},
  {cw: 2, ch: 1, thinV: false, thinH: false, border: false},
];

export const MIN_COLUMNS = 20;
export const MIN_ROWS = 13;
export const SIDE_MIN = 22;
export const SIDE_MAX = 30;
export const SIDE_GAP = 3;

export interface Line { at: number; heavy: boolean }

export interface Layout extends CellSize {
  boardW: number;
  boardH: number;
  /** Offsets of each cell column / row from the board's top-left. */
  xs: number[];
  ys: number[];
  vlines: Line[];
  hlines: Line[];
  hud: 'side' | 'top';
  /** Board origin on the canvas. */
  x: number;
  y: number;
  /** Top HUD: the first row and how many rows it has; side HUD: its left edge and width. */
  hudX: number;
  hudY: number;
  hudW: number;
  /** A spare row under the board for the status message (top HUD only). */
  messageRow: number | undefined;
}

function axis(cells: number, size: number, thin: boolean, border: boolean): {offsets: number[]; lines: Line[]; total: number} {
  const offsets: number[] = [];
  const lines: Line[] = [];
  let at = 0;
  if (border) { lines.push({at, heavy: true}); at += 1; }
  for (let index = 0; index < cells; index += 1) {
    if (index > 0 && (index % 3 === 0 || thin)) { lines.push({at, heavy: index % 3 === 0}); at += 1; }
    offsets.push(at);
    at += size;
  }
  if (border) { lines.push({at, heavy: true}); at += 1; }
  return {offsets, lines, total: at};
}

export function boardSize(size: CellSize): {width: number; height: number} {
  return {width: axis(9, size.cw, size.thinV, size.border).total, height: axis(9, size.ch, size.thinH, size.border).total};
}

/** The best layout for a canvas, or undefined when even the smallest board plus its HUD does not fit. */
export function layoutFor(columns: number, rows: number): Layout | undefined {
  for (const size of SIZES) {
    const horizontal = axis(9, size.cw, size.thinV, size.border);
    const vertical = axis(9, size.ch, size.thinH, size.border);
    const boardW = horizontal.total;
    const boardH = vertical.total;
    const make = (hud: 'side' | 'top', x: number, y: number, hudX: number, hudY: number, hudW: number, messageRow?: number): Layout => ({
      ...size, boardW, boardH, xs: horizontal.offsets, ys: vertical.offsets, vlines: horizontal.lines, hlines: vertical.lines, hud, x, y, hudX, hudY, hudW, messageRow,
    });
    const sideW = Math.min(SIDE_MAX, columns - boardW - SIDE_GAP - 1);
    if (sideW >= SIDE_MIN && rows >= boardH) {
      const group = boardW + SIDE_GAP + sideW;
      const left = Math.floor((columns - group) / 2);
      const top = Math.floor((rows - boardH) / 2);
      return make('side', left, top, left + boardW + SIDE_GAP, top, sideW);
    }
    if (columns >= boardW && rows >= boardH + 2) {
      const message = rows >= boardH + 3;
      const used = boardH + 2 + (message ? 1 : 0);
      const top = Math.floor((rows - used) / 2);
      const left = Math.floor((columns - boardW) / 2);
      return make('top', left, top + 2, left, top, Math.max(boardW, Math.min(columns - left, 38)), message ? top + 2 + boardH : undefined);
    }
  }
  return undefined;
}
