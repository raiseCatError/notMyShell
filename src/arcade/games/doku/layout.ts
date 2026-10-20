/**
 * Where the board goes on a canvas. Cells come in five sizes, biggest that fits first. The first two have a full
 * lattice (region borders drawn between cells in box-drawing glyphs, a gutter row and column per cell), the next two
 * only vertical gutters (a border below a cell is an underline), the last has none and relies on letters alone.
 */
export interface CellStyle {
  name: 'large' | 'medium' | 'compact' | 'tight' | 'mini';
  /** Cell content size. */
  cw: number;
  ch: number;
  /** Gutter columns and rows between cells (and around the board) for region borders. */
  gx: number;
  gy: number;
}

export const CELL_STYLES: readonly CellStyle[] = [
  {name: 'large', cw: 7, ch: 3, gx: 1, gy: 1},
  {name: 'medium', cw: 6, ch: 2, gx: 1, gy: 1},
  {name: 'compact', cw: 4, ch: 1, gx: 1, gy: 0},
  {name: 'tight', cw: 3, ch: 1, gx: 1, gy: 0},
  {name: 'mini', cw: 2, ch: 1, gx: 0, gy: 0},
];

export interface BoardLayout {
  style: CellStyle;
  size: number;
  /** Board origin (the top-left gutter or cell) and extent in cells. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Row numbers on the left and a done mark on the right fit. */
  labels: boolean;
  /** Rows used above the board: the HUD line, a spacer when there is room, and the column labels. */
  top: number;
  /** Rows reserved below for the message. */
  bottom: number;
  /** Column labels row (or -1). */
  headerY: number;
}

export const boardWidth = (style: CellStyle, size: number): number => size * style.cw + (style.gx ? size + 1 : 0);
export const boardHeight = (style: CellStyle, size: number): number => size * style.ch + (style.gy ? size + 1 : 0);

/** Smallest canvas the board can be drawn on: the mini cells, no labels, a HUD row and a message row. */
export function minimumCanvas(size: number): {columns: number; rows: number} {
  const mini = CELL_STYLES[CELL_STYLES.length - 1]!;
  return {columns: boardWidth(mini, size), rows: boardHeight(mini, size) + 2};
}

/** The layout for a board on a canvas, or undefined when it does not fit. */
export function chooseLayout(columns: number, rows: number, size: number): BoardLayout | undefined {
  const labelWidth = size >= 10 ? 3 : 2;
  for (const labels of [true, false]) {
    for (const style of CELL_STYLES) {
      const width = boardWidth(style, size);
      const height = boardHeight(style, size);
      const sideRoom = labels ? labelWidth + 1 + 2 : 0;
      if (width + sideRoom > columns) continue;
      // A HUD row and a message row always; the column labels, a spacer and a second message row when there is room.
      const headerNeeded = labels ? 1 : 0;
      if (height + 2 + headerNeeded > rows) continue;
      let spare = rows - (height + 2 + headerNeeded);
      const spacer = spare >= 1 ? 1 : 0;
      spare -= spacer;
      const extraMessage = spare >= 1 ? 1 : 0;
      spare -= extraMessage;
      const top = 1 + spacer + headerNeeded;
      const bottom = 1 + extraMessage;
      const x = Math.max(labels ? labelWidth + 1 : 0, Math.floor((columns - width) / 2));
      const y = top + Math.floor(spare / 2);
      return {style, size, x, y, width, height, labels, top, bottom, headerY: labels ? y - 1 : -1};
    }
  }
  return undefined;
}
