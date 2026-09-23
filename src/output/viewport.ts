import type {StyledCell, StyledLine} from './AnsiOutputParser.js';

const RESET = '\u001B[0m';

export interface WrappedRow {
  ansi: string;
  plain: string;
  lineIndex?: number;
  isFoldHint?: boolean;
  commandIndex?: number;
}

export function wrapStyledLine(line: StyledLine, width: number): WrappedRow[] {
  if (width <= 0) return [];
  const rows: WrappedRow[] = [];
  let ansi = '';
  let plain = '';
  let column = 0;
  let activeStyle = '';

  const flush = () => {
    rows.push({ansi: `${ansi}${RESET}`, plain});
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
