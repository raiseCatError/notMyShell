import {graphemes} from '../input/inputLayout.js';
import {displayWidth} from '../util/text.js';
import type {RgbColor} from '../ui/palette.js';

/**
 * Presentation overlays on already-rendered ANSI rows, cell by cell: cursor
 * trails, particles, sweeps. An overlay never changes a row's width or its
 * text. On a text cell it may only tint the background (the glyph and its
 * foreground stay exactly as rendered, so text never flashes); on a blank
 * cell it may draw a glyph. Rows themselves are never stored with overlays.
 */
export interface CellPaint {
  /** Background tint for this cell (text keeps its own glyph and foreground). */
  background?: RgbColor;
  /** A glyph for a blank cell only; ignored on a cell that holds text. */
  glyph?: string;
  /** The glyph's color (blank cells only). */
  foreground?: RgbColor;
  /** Force-replace even a text cell (only the visual caret uses this). */
  caret?: boolean;
}

const ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu;
const rgb = (code: 38 | 48, color: RgbColor) => `\u001B[${code};2;${Math.round(color.red)};${Math.round(color.green)};${Math.round(color.blue)}m`;

/** Apply paints (column → paint) to one rendered row. Columns past the row's end are padded with plain spaces first. */
export function overlayRow(row: string, paints: ReadonlyMap<number, CellPaint>, columns?: number): string {
  if (!paints.size) return row;
  const last = Math.max(...paints.keys());
  let width = displayWidth(row);
  let source = row;
  if (last >= width && (columns === undefined || last < columns)) { source = `${row}\u001B[0m${' '.repeat(last + 1 - width)}`; width = last + 1; }
  let out = '';
  let column = 0;
  // The SGR state since the last reset, replayed after a painted cell so the rest of the row is unchanged.
  let style = '';
  let index = 0;
  ESCAPE.lastIndex = 0;
  while (index < source.length) {
    ESCAPE.lastIndex = index;
    const escape = ESCAPE.exec(source);
    if (escape && escape.index === index) {
      out += escape[0];
      if (/\u001B\[[\d;]*m/u.test(escape[0])) style = /^\u001B\[0?m$/u.test(escape[0]) ? '' : style + escape[0];
      index += escape[0].length;
      continue;
    }
    const next = escape ? escape.index : source.length;
    for (const glyph of graphemes(source.slice(index, next))) {
      const cells = Math.max(1, displayWidth(glyph));
      const paint = paints.get(column);
      if (paint) {
        const blank = glyph === ' ';
        const drawn = paint.caret ? (paint.glyph ?? glyph) : blank && paint.glyph ? paint.glyph : glyph;
        const fg = (paint.caret || blank) && paint.foreground ? rgb(38, paint.foreground) : '';
        const bg = paint.background ? rgb(48, paint.background) : '';
        out += `${bg}${fg}${drawn}\u001B[0m${style}`;
      } else out += glyph;
      column += cells;
    }
    index = next;
  }
  return out;
}

/** Apply paints keyed by row then column to a frame's rows (only the rows with paints are touched). */
export function overlayFrame(rows: string[], paints: ReadonlyMap<number, ReadonlyMap<number, CellPaint>>, columns?: number): string[] {
  if (!paints.size) return rows;
  return rows.map((row, index) => { const cells = paints.get(index); return cells ? overlayRow(row, cells, columns) : row; });
}
