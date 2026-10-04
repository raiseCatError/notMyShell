import {graphemes} from '../input/inputLayout.js';
import {displayWidth} from '../util/text.js';
import type {RgbColor} from '../ui/palette.js';
import {colorEscape} from '../chroma/escape.js';
import {mixRgb} from '../chroma/chroma.js';
import {readableForeground} from '../chroma/color.js';

/**
 * Presentation overlays on already-rendered ANSI rows, cell by cell: cursor
 * trails, particles, sweeps. An overlay never changes a row's width or its
 * text, and it never paints a background behind text: SGR has no per-cell
 * alpha, so any background would be an opaque box on a transparent or
 * frosted terminal. On a text cell an overlay shifts the glyph's own
 * foreground (`tint`) or adds weight (`dim`, `bold`, `underline`); on a blank
 * cell it may draw a glyph. Only the visual caret may fill a cell
 * (`background` with `caret`). Rows themselves are never stored with overlays.
 */
export interface CellPaint {
  /** The caret's own fill, honored only together with `caret`. Tints must not use it: it would hide a transparent terminal. */
  background?: RgbColor;
  /** Shift the cell's own foreground toward a color; the glyph never changes. A cell with no explicit foreground takes the color itself. */
  tint?: {color: RgbColor; amount: number};
  dim?: boolean;
  bold?: boolean;
  underline?: boolean;
  /** A glyph for a blank cell only; ignored on a cell that holds text. */
  glyph?: string;
  /** The glyph's color (blank cells only). */
  foreground?: RgbColor;
  /** Force-replace even a text cell (only the visual caret uses this). */
  caret?: boolean;
  /**
   * The visual caret drawn in a real terminal cursor's shape: Block fills the
   * cell, Bar and Underline draw a thin glyph on a blank cell (and mark a text
   * cell with weight or an underline instead of replacing its glyph). `color`
   * is the caret color.
   */
  caretShape?: 'block' | 'bar' | 'underline';
  color?: RgbColor;
}

const CARET_GLYPH = {bar: '▏', underline: '▁'} as const;

/** The SGR for a shaped caret over one cell (`blank`: a space, which a thin shape may draw into). */
function shapedCaret(paint: CellPaint, glyph: string, blank: boolean): string {
  const color = paint.color ?? paint.background ?? {red: 220, green: 220, blue: 220};
  const shape = paint.caretShape!;
  if (shape === 'block') return `${rgb(48, color)}${rgb(38, readableForeground(color))}${glyph}`;
  if (blank) return `${rgb(38, color)}${CARET_GLYPH[shape]}`;
  return `${rgb(38, color)}${shape === 'underline' ? '\u001B[4m' : '\u001B[1m'}${glyph}`;
}

const ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu;
const rounded = (color: RgbColor): RgbColor => ({red: Math.round(color.red), green: Math.round(color.green), blue: Math.round(color.blue)});
const rgb = (code: 38 | 48, color: RgbColor) => colorEscape(code, rounded(color));

const ANSI16_RGB: ReadonlyArray<readonly [number, number, number]> = [[0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
  [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]];

function indexedRgb(index: number): RgbColor {
  if (index < 16) { const [red, green, blue] = ANSI16_RGB[index]!; return {red, green, blue}; }
  if (index >= 232) { const gray = 8 + (index - 232) * 10; return {red: gray, green: gray, blue: gray}; }
  const cube = [0, 95, 135, 175, 215, 255];
  const n = index - 16;
  return {red: cube[Math.floor(n / 36)]!, green: cube[Math.floor(n / 6) % 6]!, blue: cube[n % 6]!};
}

/** The foreground in effect after replaying SGR sequences since the last reset; undefined when it is the terminal's default. */
export function currentForeground(style: string): RgbColor | undefined {
  let color: RgbColor | undefined;
  for (const match of style.matchAll(/\u001B\[([\d;]*)m/gu)) {
    const params = match[1]!.split(';').map(value => (value === '' ? 0 : Number(value)));
    for (let index = 0; index < params.length; index += 1) {
      const code = params[index]!;
      if (code === 0 || code === 39) color = undefined;
      else if (code === 38 && params[index + 1] === 2) { color = {red: params[index + 2] ?? 0, green: params[index + 3] ?? 0, blue: params[index + 4] ?? 0}; index += 4; }
      else if (code === 38 && params[index + 1] === 5) { color = indexedRgb(params[index + 2] ?? 0); index += 2; }
      else if (code >= 30 && code <= 37) color = indexedRgb(code - 30);
      else if (code >= 90 && code <= 97) color = indexedRgb(code - 90 + 8);
    }
  }
  return color;
}

/** A foreground-only treatment for a text cell: tint toward a color, plus weight. Never a background. */
function textTreatment(paint: CellPaint, style: string): string {
  let out = '';
  if (paint.bold) out += '\u001B[1m';
  if (paint.dim) out += '\u001B[2m';
  if (paint.underline) out += '\u001B[4m';
  if (paint.tint && paint.tint.amount > 0.02) {
    const base = currentForeground(style);
    // Without an explicit foreground there is nothing to blend with, so a visible tint takes the color; a faint one does nothing.
    const color = base ? mixRgb(base, paint.tint.color, Math.min(1, paint.tint.amount)) : paint.tint.amount >= 0.2 ? paint.tint.color : undefined;
    if (color) out += rgb(38, color);
  }
  return out;
}

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
      if (paint?.caret && paint.caretShape) {
        out += `${shapedCaret(paint, glyph, glyph === ' ')}\u001B[0m${style}`;
      } else if (paint) {
        const blank = glyph === ' ';
        const drawn = paint.caret ? (paint.glyph ?? glyph) : blank && paint.glyph ? paint.glyph : glyph;
        const drawsGlyph = (paint.caret || blank) && paint.foreground;
        const fg = drawsGlyph ? rgb(38, paint.foreground!) : '';
        // Only the caret may fill a cell: everything else keeps the host's own background.
        const bg = paint.caret && paint.background ? rgb(48, paint.background) : '';
        const text = !drawsGlyph && !blank ? textTreatment(paint, style) : drawsGlyph && paint.dim ? '\u001B[2m' : '';
        out += `${bg}${fg}${text}${drawn}\u001B[0m${style}`;
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
