/**
 * Board geometry: the largest board that fits the canvas, with the HUD beside it when there is room and above it
 * otherwise. Pure numbers, no drawing, so the tests can sweep canvas sizes.
 *
 * The board is three levels of surface: a dark channel (the well) around and between the 3×3 boxes, each box a plate,
 * and each cell a tile on its plate. Tiles in a box are kept apart by a one-column gap across and, when cells are two
 * or three rows tall, by half-block edges down (a tile three rows tall is drawn ▄ / digit / ▀, so its visible part is
 * centered on the digit and neighbouring tiles are separated by a whole row of plate). Boxes are separated by the
 * channel, so a box boundary is always stronger than a cell boundary.
 */
export interface CellSize {
  /** Tile width and height in cells. */
  cw: number;
  ch: number;
  /** Columns of plate between tiles in a box. */
  gap: number;
  /** Columns of plate between a box's edge and its tiles. */
  pad: number;
  /** Whether the channel also runs around the outside of the board (not on the smallest board). */
  edge?: boolean;
}

/** Largest first. */
const SIZES: readonly CellSize[] = [
  {cw: 9, ch: 3, gap: 1, pad: 1},
  {cw: 7, ch: 3, gap: 1, pad: 1},
  {cw: 9, ch: 2, gap: 1, pad: 1},
  {cw: 7, ch: 2, gap: 1, pad: 1},
  {cw: 5, ch: 3, gap: 1, pad: 1},
  {cw: 5, ch: 2, gap: 1, pad: 1},
  {cw: 5, ch: 1, gap: 1, pad: 1},
  {cw: 3, ch: 1, gap: 0, pad: 1},
  {cw: 2, ch: 1, gap: 0, pad: 0, edge: false},
];

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

function axis(size: number, gap: number, pad: number, edge: boolean): {offsets: number[]; plates: Span[]; total: number} {
  const offsets: number[] = [];
  const plates: Span[] = [];
  let at = edge ? CHANNEL : 0;
  for (let box = 0; box < 3; box += 1) {
    if (box > 0) at += CHANNEL;
    const start = at;
    at += pad;
    for (let cell = 0; cell < 3; cell += 1) {
      if (cell > 0) at += gap;
      offsets.push(at);
      at += size;
    }
    at += pad;
    plates.push({at: start, size: at - start});
  }
  return {offsets, plates, total: at + (edge ? CHANNEL : 0)};
}

/** Vertical gaps come from the tiles' half-block edges, so the vertical axis has no gap or pad rows of its own. */
const vertical = (size: CellSize) => axis(size.ch, 0, 0, size.edge !== false);
const horizontal = (size: CellSize) => axis(size.cw, size.gap, size.pad, size.edge !== false);

export function boardSize(size: CellSize): {width: number; height: number} {
  return {width: horizontal(size).total, height: vertical(size).total};
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
    if (top && (size.ch < top.ch || size.cw < top.cw * 0.7)) return top;
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
      top = make('top', left, y + 2, left, y, Math.max(boardW, Math.min(columns - left, 38)), message ? y + 2 + boardH : undefined);
    }
  }
  return top;
}
