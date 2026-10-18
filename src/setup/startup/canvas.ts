import {AnsiOutputParser} from '../../output/AnsiOutputParser.js';
import {graphemes} from '../../input/inputLayout.js';
import {currentBackground} from '../../presentation/cellOverlay.js';
import {displayWidth} from '../../util/text.js';

export const RESET = '\u001B[0m';
export const BOLD = '\u001B[1m';
export const FAINT = '\u001B[2m';
export const ITALIC = '\u001B[3m';
export const INVERSE = '\u001B[7m';

interface Cell {ch: string; style: string; bg: string; cont: boolean}

/**
 * A fixed-size cell buffer the selector composes its ground in: text, fills
 * and rows from NMSh's own renderers placed by cell, then serialized with an
 * SGR only where the style changes. Wide glyphs take two cells; nothing is
 * ever written outside the buffer, so rows always fit their width.
 */
export class StartupCanvas {
  private readonly cells: Cell[][];
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    this.cells = Array.from({length: this.height}, () => Array.from({length: this.width}, () => ({ch: ' ', style: '', bg: '', cont: false})));
  }

  private put(x: number, y: number, ch: string, style: string, background: string | undefined, wide: boolean): void {
    if (y < 0 || y >= this.height || x < 0 || x >= this.width) return;
    const cell = this.cells[y]![x]!;
    // Overwriting half of a wide glyph clears its other half.
    if (cell.cont && x > 0) { const lead = this.cells[y]![x - 1]!; lead.ch = ' '; }
    const after = this.cells[y]![x + 1];
    if (after?.cont && !wide) { after.ch = ' '; after.cont = false; }
    cell.ch = ch; cell.style = style; cell.cont = false;
    if (background !== undefined) cell.bg = background;
    if (wide && x + 1 < this.width) {
      const next = this.cells[y]![x + 1]!;
      next.ch = ''; next.style = style; next.cont = true;
      if (background !== undefined) next.bg = background;
    }
  }

  /** Text in one style, clipped at `maxX`; keeps each cell's fill unless `background` is given. Returns the column after it. */
  text(x: number, y: number, value: string, style = '', background?: string, maxX = this.width): number {
    let column = Math.floor(x);
    const limit = Math.min(this.width, maxX);
    for (const glyph of graphemes(value)) {
      const width = Math.max(1, displayWidth(glyph));
      if (column + width > limit) break;
      this.put(column, y, glyph, style, background, width === 2);
      column += width;
    }
    return column;
  }

  spans(x: number, y: number, spans: ReadonlyArray<readonly [string, string]>, background?: string, maxX?: number): number {
    let column = x;
    for (const [style, value] of spans) column = this.text(column, y, value, style, background, maxX);
    return column;
  }

  /** A row from NMSh's own renderers (the real composer, prompts): its own backgrounds win, otherwise the fill stays. */
  ansi(x: number, y: number, row: string, maxWidth = this.width - x): number {
    const parser = new AnsiOutputParser();
    parser.write(row);
    const line = parser.allLines()[0] ?? [];
    let column = x;
    for (const cell of line) {
      if (cell === null) continue;
      const width = cell ? Math.max(1, cell.width) : 1;
      if (column - x + width > maxWidth) break;
      const style = cell?.style ?? '';
      this.put(column, y, cell?.text || ' ', style, currentBackground(style) ? '' : undefined, width === 2);
      column += width;
    }
    return column;
  }

  fill(x: number, y: number, width: number, height: number, background: string): void {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + height); row++) {
      for (let column = Math.max(0, x); column < Math.min(this.width, x + width); column++) {
        const cell = this.cells[row]![column]!;
        cell.ch = ' '; cell.style = ''; cell.cont = false; cell.bg = background;
      }
    }
  }

  /** Faint text over a region: what a sheet covers recedes. Fills are kept, so nothing tears. */
  dim(x: number, y: number, width: number, height: number): void {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + height); row++) {
      for (let column = Math.max(0, x); column < Math.min(this.width, x + width); column++) {
        const cell = this.cells[row]![column]!;
        if (cell.ch.trim() && !cell.style.includes(FAINT)) cell.style = `${cell.style}${FAINT}`;
      }
    }
  }

  rows(): string[] {
    return this.cells.map(row => {
      let out = '';
      let current = '';
      for (const cell of row) {
        if (cell.cont) continue;
        const style = `${cell.style}${cell.bg}`;
        if (style !== current) { out += `${RESET}${style}`; current = style; }
        out += cell.ch;
      }
      return current ? `${out}${RESET}` : out;
    });
  }
}
