/**
 * Board geometry for character-cell terminals. A terminal cell is about twice as tall as it is wide, so a board cell
 * that looks square is `cellH` rows by `cellH * aspect` columns. `squareLayout` picks the largest such cell that fits
 * the free area (with a gap between cells and an optional frame), centers the board, and `cellAt` maps a terminal
 * position back to a board cell for the mouse. Hex boards use the same cell size: `hexCenter` places pointy-top hexes
 * in offset rows, each odd row shifted half a cell right.
 */
export const CELL_ASPECT = 2;

export interface BoardArea { columns: number; rows: number; top?: number; bottom?: number; left?: number; right?: number }
export interface BoardLayout {
  /** Terminal columns and rows of one cell (cellW is cellH * aspect). */
  cellW: number; cellH: number; gap: number;
  /** Top-left of the first cell and the whole board's size in terminal cells (frame excluded). */
  x: number; y: number; width: number; height: number;
  /** Cells across and down. */
  across: number; down: number;
  /** Columns / rows each cell takes including its gap (the step between cell origins). */
  stepX: number; stepY: number;
}

export interface LayoutOptions {
  aspect?: number; gap?: number; frame?: number; maxCellH?: number; minCellH?: number; hex?: boolean; interlock?: boolean;
  /** Hex rows of two-row cells nest by half a row (a half-block pixel row), so odd rows start mid-row. Needs half-block drawing. */
  halfRows?: boolean;
}

/** The largest square-looking cell that fits, or undefined when even the smallest does not. */
export function squareLayout(area: BoardArea, across: number, down: number, options: LayoutOptions = {}): BoardLayout | undefined {
  const aspect = options.aspect ?? CELL_ASPECT;
  const gap = options.gap ?? 0;
  const frame = options.frame ?? 0;
  const freeW = area.columns - (area.left ?? 0) - (area.right ?? 0) - 2 * frame;
  const freeH = area.rows - (area.top ?? 0) - (area.bottom ?? 0) - 2 * frame;
  const hexShift = options.hex ? 0.5 : 0;
  for (let cellH = options.maxCellH ?? 8; cellH >= (options.minCellH ?? 1); cellH -= 1) {
    const cellW = cellH * aspect;
    // Gaps scale with the cell: one terminal column per `aspect` rows of gap keeps the gap square too.
    const gapX = gap * aspect, gapY = gap;
    // Interlocking hex rows nest into each other: each row starts `hexOverlap` rows before the previous one ends.
    const overlap = options.hex && options.interlock ? hexOverlap(cellH, options.halfRows) : 0;
    const stepX = cellW + gapX, stepY = cellH + gapY - overlap;
    const width = Math.ceil((across + hexShift) * stepX - gapX);
    const height = Math.ceil((down - 1) * stepY + cellH);
    if (width <= freeW && height <= freeH) {
      return {
        cellW, cellH, gap, across, down, stepX, stepY, width, height,
        x: (area.left ?? 0) + frame + Math.floor((freeW - width) / 2),
        y: (area.top ?? 0) + frame + Math.floor((freeH - height) / 2),
      };
    }
  }
  return undefined;
}

/**
 * Rows by which neighbouring hex rows overlap when they interlock: none for cells under three rows (drawn as staggered
 * tiles), except two-row cells that may nest by half a row (`halfRows`, one half-block pixel row).
 */
export const hexOverlap = (cellH: number, halfRows = false): number => (cellH >= 3 ? Math.max(1, Math.round(cellH / 4)) : cellH === 2 && halfRows ? 0.5 : 0);

/**
 * The hex cell under a terminal position: with interlocking rows (stepY under cellH) the one whose center is nearest in
 * physical distance (a column and a half-block pixel row are the same size), otherwise the cell whose slot holds it.
 * Undefined outside the board.
 */
export function hexCellAt(layout: BoardLayout, px: number, py: number): {cx: number; cy: number} | undefined {
  if (layout.stepY >= layout.cellH) return cellAt(layout, px, py, true);
  const pixels = 2 * layout.cellH, stepPx = 2 * layout.stepY;
  // The clicked terminal cell, as the middle of its two pixel rows.
  const X = px + 0.5 - layout.x, Y = 2 * (py - layout.y) + 1;
  let best: {cx: number; cy: number} | undefined;
  let bestDistance = Infinity;
  const approx = Math.floor(Y / stepPx);
  for (let cy = approx - 1; cy <= approx + 1; cy += 1) {
    const top = cy * stepPx;
    if (cy < 0 || cy >= layout.down || Y < top || Y >= top + pixels) continue;
    const shift = cy % 2 ? Math.floor(layout.stepX / 2) : 0;
    const cx = Math.floor((X - shift) / layout.stepX);
    if (cx < 0 || cx >= layout.across || X - shift - cx * layout.stepX >= layout.cellW) continue;
    const dx = X - (shift + cx * layout.stepX + layout.cellW / 2), dy = Y - (top + pixels / 2);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) { bestDistance = distance; best = {cx, cy}; }
  }
  return best;
}

/** Terminal position of a cell's top-left corner. Odd rows shift half a cell right on hex boards. */
export function cellOrigin(layout: BoardLayout, cx: number, cy: number, hex = false): {x: number; y: number} {
  return {x: layout.x + cx * layout.stepX + (hex && cy % 2 ? Math.floor(layout.stepX / 2) : 0), y: layout.y + Math.floor(cy * layout.stepY)};
}

/** Whether a hex row starts on the lower half of its terminal row (rows that nest by half a row): 1 when it does, else 0. */
export const hexHalf = (layout: BoardLayout, cy: number): 0 | 1 => (Math.round(2 * cy * layout.stepY) % 2 ? 1 : 0);

/** The board cell under a terminal position, or undefined (outside the board or in a gap). */
export function cellAt(layout: BoardLayout, px: number, py: number, hex = false): {cx: number; cy: number} | undefined {
  const cy = Math.floor((py - layout.y) / layout.stepY);
  if (cy < 0 || cy >= layout.down) return undefined;
  const shift = hex && cy % 2 ? Math.floor(layout.stepX / 2) : 0;
  const cx = Math.floor((px - layout.x - shift) / layout.stepX);
  if (cx < 0 || cx >= layout.across) return undefined;
  const inX = px - layout.x - shift - cx * layout.stepX, inY = py - layout.y - cy * layout.stepY;
  return inX < layout.cellW && inY < layout.cellH ? {cx, cy} : undefined;
}

/** How square a cell looks: physical width over height, given the terminal cell aspect (1 is square). */
export const physicalRatio = (cellW: number, cellH: number, aspect = CELL_ASPECT): number => cellW / (cellH * aspect);
