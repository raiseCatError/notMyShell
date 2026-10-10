import {validOsc8Payload, type StyledCell, type StyledLine} from './AnsiOutputParser.js';

const RESET = '\u001B[0m';

export interface WrappedRow {
  ansi: string;
  plain: string;
  lineIndex?: number;
  isFoldHint?: boolean;
  isHistoricalHeader?: boolean;
  commandIndex?: number;
  activityId?: string;
  activityStartedAt?: number;
  isLiveActivity?: boolean;
  /** startId of the command block that owns this row; presentation metadata only. */
  blockStartId?: number;
  /** Leading alignment columns (Chat); surfaces and hit bounds start after them. */
  indent?: number;
  /** The synthetic "filter active" row; presentation only, never transcript data. */
  isFilterHint?: boolean;
}

export interface StickyHeader {
  /** Stable startId of the owning command block. */
  startId: number;
  /** Index of the block's first rendered row (its real header), which a click jumps to. */
  targetIndex: number;
}

/**
 * The block whose real command row has scrolled above the viewport while it
 * still owns the top visible row. Derived only from row ownership, never text.
 */
export function stickyHeaderFor(rows: WrappedRow[], viewStart: number): StickyHeader | undefined {
  const startId = rows[viewStart]?.blockStartId;
  if (startId === undefined) return undefined;
  let targetIndex = viewStart;
  let commandRowAbove = false;
  for (let index = viewStart; index >= 0 && rows[index]?.blockStartId === startId; index -= 1) {
    targetIndex = index;
    const row = rows[index]!;
    if (index < viewStart && row.lineIndex === startId && !row.isHistoricalHeader) commandRowAbove = true;
  }
  return commandRowAbove ? {startId, targetIndex} : undefined;
}

export function wrapStyledLine(line: StyledLine, width: number, hyperlinks = false): WrappedRow[] {
  if (width <= 0) return [];
  const rows: WrappedRow[] = [];
  let ansi = '';
  let plain = '';
  let column = 0;
  let activeStyle = '';
  let activeLink: string | undefined;

  const flush = () => {
    rows.push({ansi: `${ansi}${activeLink ? '\u001B]8;;\u001B\\' : ''}${RESET}`, plain});
    activeLink = undefined;
    ansi = '';
    plain = '';
    column = 0;
    activeStyle = '';
  };

  for (let index = 0; index < line.length; index += 1) {
    const cell = line[index];
    if (cell === null) continue;
    const actual: StyledCell = cell ?? {text: ' ', width: 1, style: ''};
    if (column > 0 && column + actual.width > width) flush();
    const link = hyperlinks && actual.hyperlink && validOsc8Payload(actual.hyperlink) ? actual.hyperlink : undefined;
    if (link !== activeLink) {
      if (activeLink) ansi += '\u001B]8;;\u001B\\';
      if (link) ansi += `\u001B]${link}\u001B\\`;
      activeLink = link;
    }
    if (actual.style !== activeStyle) {
      ansi += `${RESET}${actual.style}`;
      activeStyle = actual.style;
    }
    ansi += actual.text;
    plain += actual.text;
    column += actual.width;
    if (column >= width) flush();
  }
  if (column > 0 || rows.length === 0) flush();
  return rows;
}

const isBlank = (cell: StyledCell | null | undefined) => cell === undefined || (cell !== null && cell.text === ' ');

/**
 * Word wrapping for NMSh's own lines (notices, confirmations, lifecycle rows): breaks fall after a space, and
 * continuation rows hang under the text after a leading glyph (`  ⎿ Copied … · 5` / `    lines`). A word wider than
 * the row still breaks by character. Shell output never comes here: it wraps by column, as a terminal does.
 *
 * Content is exact: every cell lands on exactly one row, and each continuation row's `indent` covers only the
 * padding NMSh added, so selection, which joins one line's rows and drops that indent, reads the line as stored.
 * A space that falls at a break and does not fit is drawn as the last column of the next row's padding.
 */
export function wrapStyledWords(line: StyledLine, width: number, hyperlinks = false): WrappedRow[] {
  if (width <= 0) return [];
  const cellWidth = (cell: StyledCell | null | undefined) => cell === null ? 0 : (cell?.width ?? 1);
  const total = line.reduce((sum, cell) => sum + cellWidth(cell), 0);
  if (total <= width) return wrapStyledLine(line, width, hyperlinks);
  // Hang under the text: leading blanks, then one glyph and its space when the line starts with one.
  let lead = 0;
  while (lead < line.length && isBlank(line[lead])) lead += 1;
  const glyph = line[lead];
  if (glyph && glyph.text !== ' ' && glyph.width === 1 && isBlank(line[lead + 1])) lead += 2;
  const hang = lead <= width / 2 ? lead : 0;

  const segments: Array<{cells: StyledLine; leadingSpace: boolean}> = [];
  let start = 0;
  let leadingSpace = false;
  while (start < line.length) {
    const available = segments.length === 0 ? width : width - hang;
    let column = 0;
    let breakAfter = -1;
    let index = start;
    for (; index < line.length; index += 1) {
      const cell = line[index];
      if (column + cellWidth(cell) > available) break;
      column += cellWidth(cell);
      if (isBlank(cell)) breakAfter = index;
    }
    if (index >= line.length) { segments.push({cells: line.slice(start), leadingSpace}); break; }
    if (isBlank(line[index]) && hang > 0) {
      // The break falls on a space that does not fit: it becomes the last column of the next row's padding.
      segments.push({cells: line.slice(start, index), leadingSpace});
      start = index + 1;
      leadingSpace = true;
      continue;
    }
    const end = breakAfter >= start ? breakAfter + 1 : Math.max(index, start + 1);
    segments.push({cells: line.slice(start, end), leadingSpace});
    start = end;
    leadingSpace = false;
  }
  return segments.flatMap((segment, position) => {
    if (position === 0) return wrapStyledLine(segment.cells, width, hyperlinks);
    const padding = ' '.repeat(hang);
    // A carried space is content: it is the last padding column, outside the indent selection drops.
    const indent = segment.leadingSpace ? hang - 1 : hang;
    return wrapStyledLine(segment.cells, width - hang, hyperlinks)
      .map(row => ({...row, ansi: `${padding}${row.ansi}`, plain: `${padding}${row.plain}`, ...(indent > 0 ? {indent} : {})}));
  });
}

export function wrapLines(lines: StyledLine[], width: number): WrappedRow[] {
  return lines.flatMap(line => wrapStyledLine(line, width));
}

export type HistoryMode = 'follow' | 'detached';

export class HistoryViewport {
  private currentStart = 0;
  private currentMode: HistoryMode = 'follow';

  get start(): number { return this.currentStart; }
  get mode(): HistoryMode { return this.currentMode; }
  get detached(): boolean { return this.currentMode === 'detached'; }

  resolve(totalRows: number, height: number): number {
    const maximum = Math.max(0, totalRows - Math.max(0, height));
    this.currentStart = this.currentMode === 'follow'
      ? maximum
      : Math.max(0, Math.min(this.currentStart, maximum));
    if (this.currentStart >= maximum) this.currentMode = 'follow';
    return this.currentStart;
  }

  page(totalRows: number, height: number, direction: -1 | 1): void {
    const distance = Math.max(1, height - 2);
    this.scrollLines(totalRows, height, direction * distance);
  }

  scrollLines(totalRows: number, height: number, amount: number): void {
    const maximum = Math.max(0, totalRows - Math.max(0, height));
    if (amount < 0 && this.currentMode === 'follow') this.currentStart = maximum;
    this.currentStart = Math.max(0, Math.min(maximum, this.currentStart + amount));
    this.currentMode = this.currentStart >= maximum ? 'follow' : 'detached';
  }

  latest(): void {
    this.currentMode = 'follow';
  }
}

export function viewportStart(totalRows: number, height: number, follow: boolean, currentStart: number): number {
  const maximum = Math.max(0, totalRows - height);
  return follow ? maximum : Math.max(0, Math.min(currentStart, maximum));
}

export function pageViewport(
  totalRows: number,
  height: number,
  currentStart: number,
  direction: -1 | 1,
): {start: number; follow: boolean} {
  const maximum = Math.max(0, totalRows - height);
  const distance = Math.max(1, height - 2);
  const start = Math.max(0, Math.min(maximum, currentStart + direction * distance));
  return {start, follow: start >= maximum};
}
