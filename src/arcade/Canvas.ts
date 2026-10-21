import {colorEscape, type Rgb} from '../chroma/escape.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {displayWidth} from '../util/text.js';
import type {TypeBlock} from '../ui/typography.js';

/**
 * The arcade's drawing surface: a grid of terminal cells, plus two sub-cell layers for sprites and scenery.
 *
 *  - Cells hold one glyph, a foreground, a background and a few attributes. Text, HUD and frames are drawn here.
 *  - A `PixelBuffer` is a grid with two pixels per cell vertically (half blocks ▀ ▄ █). It is how a cat, a mountain or a
 *    particle gets real resolution on any truecolor terminal, with no graphics protocol and no latency.
 *  - A `BrailleBuffer` is two by four dots per cell, for thin lines, trails and sparks.
 *
 * `rows()` encodes the canvas as styled strings for the panel. Encoding honours the terminal's color level (none,
 * 16, 256, truecolor) and Safe Glyphs: without color a pixel is a solid glyph, in Safe mode only ASCII is written.
 * Rows are cached and re-encoded only when a cell in them changed, so a mostly static frame costs almost nothing.
 */
export interface Style {
  fg?: Rgb | undefined;
  bg?: Rgb | undefined;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  reverse?: boolean;
}

const BOLD = 1;
const DIM = 2;
const ITALIC = 4;
const UNDERLINE = 8;
const REVERSE = 16;
const RESET = '\u001b[0m';

export interface EncodeOptions {
  color: ColorLevel;
  /** Safe Glyphs: ASCII only. */
  safe: boolean;
}

export const DEFAULT_ENCODING: EncodeOptions = {color: 'truecolor', safe: false};

/** A block of cells the shared typography service filled with text at a larger relative size (see ui/typography). */
export interface TextOverlay {
  /** Canvas-relative cell box the sized text occupies; its cells are blank in the canvas. */
  x: number;
  y: number;
  columns: number;
  rows: number;
  /** The escape that draws the block when the cursor is at its top-left cell. */
  sequence: string;
  /** Colors and weight to draw it with (the host turns them into an SGR prefix at the terminal's color level). */
  style?: Style;
}

export class Canvas {
  readonly width: number;
  readonly height: number;
  private chars: string[];
  private fg: Array<Rgb | undefined>;
  private bg: Array<Rgb | undefined>;
  private attrs: Uint16Array;
  private versions: Uint32Array;
  private cache: Array<{version: number; key: string; row: string} | undefined>;
  /** Sized-text blocks added this frame (the host places them after the rows are written). */
  readonly overlays: TextOverlay[] = [];

  constructor(width: number, height: number) {
    this.width = Math.max(0, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    const size = this.width * this.height;
    this.chars = new Array<string>(size).fill(' ');
    this.fg = new Array<Rgb | undefined>(size).fill(undefined);
    this.bg = new Array<Rgb | undefined>(size).fill(undefined);
    this.attrs = new Uint16Array(size);
    this.versions = new Uint32Array(this.height).fill(1);
    this.cache = new Array(this.height).fill(undefined);
  }

  private touch(y: number): void { this.versions[y] = (this.versions[y]! + 1) >>> 0; }
  inside(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.width && y < this.height; }

  /** Blank every cell (to `bg` when given) and forget this frame's overlays. */
  clear(bg?: Rgb): void {
    this.overlays.length = 0;
    for (let y = 0; y < this.height; y += 1) {
      let changed = false;
      for (let x = 0; x < this.width; x += 1) {
        const index = y * this.width + x;
        if (this.chars[index] !== ' ' || this.fg[index] !== undefined || this.bg[index] !== bg || this.attrs[index] !== 0) {
          this.chars[index] = ' '; this.fg[index] = undefined; this.bg[index] = bg; this.attrs[index] = 0; changed = true;
        }
      }
      if (changed) this.touch(y);
    }
  }

  private pack(style: Style): number {
    return (style.bold ? BOLD : 0) | (style.dim ? DIM : 0) | (style.italic ? ITALIC : 0) | (style.underline ? UNDERLINE : 0) | (style.reverse ? REVERSE : 0);
  }

  /** One cell. An empty `ch` marks the right half of a double-width glyph written to its left. */
  put(x: number, y: number, ch: string, style: Style = {}): void {
    if (!this.inside(x, y)) return;
    const index = y * this.width + x;
    const bg = style.bg ?? this.bg[index];
    const attrs = this.pack(style);
    if (this.chars[index] === ch && this.fg[index] === style.fg && this.bg[index] === bg && this.attrs[index] === attrs) return;
    this.chars[index] = ch; this.fg[index] = style.fg; this.bg[index] = bg; this.attrs[index] = attrs;
    this.touch(y);
  }

  /** Keep a cell's glyph and attributes and change only its colors (highlights over a drawn cell). */
  tint(x: number, y: number, style: Pick<Style, 'fg' | 'bg'>): void {
    if (!this.inside(x, y)) return;
    const index = y * this.width + x;
    const fg = style.fg ?? this.fg[index];
    const bg = style.bg ?? this.bg[index];
    if (this.fg[index] === fg && this.bg[index] === bg) return;
    this.fg[index] = fg; this.bg[index] = bg;
    this.touch(y);
  }

  /** The cell at x, y, or undefined outside. */
  cell(x: number, y: number): {ch: string; fg: Rgb | undefined; bg: Rgb | undefined} | undefined {
    if (!this.inside(x, y)) return undefined;
    const index = y * this.width + x;
    return {ch: this.chars[index]!, fg: this.fg[index], bg: this.bg[index]};
  }

  /** Text from x, clipped to the canvas; returns the cells written. Zero-width characters ride on the previous cell. */
  text(x: number, y: number, value: string, style: Style = {}): number {
    if (y < 0 || y >= this.height) return 0;
    let column = x;
    for (const glyph of new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(value)) {
      const cells = Math.max(0, displayWidth(glyph.segment));
      if (cells === 0) continue;
      if (column >= this.width) break;
      if (column >= 0) {
        if (cells === 2 && column + 1 >= this.width) break;
        this.put(column, y, glyph.segment, style);
        if (cells === 2) this.put(column + 1, y, '', style);
      }
      column += cells;
    }
    return column - x;
  }

  /** Text centered on a row of `width` cells starting at x (the whole canvas by default). */
  center(y: number, value: string, style: Style = {}, x = 0, width = this.width): void {
    const cells = displayWidth(value);
    this.text(x + Math.max(0, Math.floor((width - cells) / 2)), y, value, style);
  }

  fill(x: number, y: number, width: number, height: number, ch = ' ', style: Style = {}): void {
    for (let row = y; row < y + height; row += 1) for (let column = x; column < x + width; column += 1) this.put(column, row, ch, style);
  }

  hline(x: number, y: number, length: number, ch: string, style: Style = {}): void { for (let index = 0; index < length; index += 1) this.put(x + index, y, ch, style); }
  vline(x: number, y: number, length: number, ch: string, style: Style = {}): void { for (let index = 0; index < length; index += 1) this.put(x, y + index, ch, style); }

  /** Draw a pixel layer (two pixels per cell vertically) with its top-left cell at x, y. Transparent pixels keep the cell. */
  blit(buffer: PixelBuffer, x = 0, y = 0): void {
    const rows = Math.ceil(buffer.height / 2);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < buffer.width; column += 1) {
        const top = buffer.get(column, row * 2);
        const bottom = buffer.get(column, row * 2 + 1);
        if (!top && !bottom) continue;
        const cx = x + column;
        const cy = y + row;
        if (!this.inside(cx, cy)) continue;
        const base = this.bg[cy * this.width + cx];
        if (top && bottom) {
          this.cellPixels(cx, cy, top, bottom);
        } else if (top) {
          this.cellPixels(cx, cy, top, undefined, base);
        } else {
          this.cellPixels(cx, cy, undefined, bottom, base);
        }
      }
    }
  }

  /** A cell showing two stacked pixels: top (▀) over bottom, with `base` where one half is empty. */
  private cellPixels(x: number, y: number, top: Rgb | undefined, bottom: Rgb | undefined, base?: Rgb): void {
    const index = y * this.width + x;
    // The glyph carries which halves are lit even when colors cannot be shown; see encode().
    if (top && bottom) {
      this.chars[index] = '▀'; this.fg[index] = top; this.bg[index] = bottom; this.attrs[index] = PIXEL_BOTH;
    } else if (top) {
      this.chars[index] = '▀'; this.fg[index] = top; this.bg[index] = base; this.attrs[index] = PIXEL_TOP;
    } else {
      this.chars[index] = '▄'; this.fg[index] = bottom; this.bg[index] = base; this.attrs[index] = PIXEL_BOTTOM;
    }
    this.touch(y);
  }

  /** Draw a Braille layer (2 x 4 dots per cell) with one color per lit cell. */
  blitBraille(buffer: BrailleBuffer, x = 0, y = 0): void {
    for (let row = 0; row < buffer.rows; row += 1) {
      for (let column = 0; column < buffer.columns; column += 1) {
        const dots = buffer.dots(column, row);
        if (!dots) continue;
        const cx = x + column;
        const cy = y + row;
        if (!this.inside(cx, cy)) continue;
        const index = cy * this.width + cx;
        this.chars[index] = String.fromCodePoint(0x2800 + dots);
        this.fg[index] = buffer.color(column, row);
        this.attrs[index] = BRAILLE;
        this.touch(cy);
      }
    }
  }

  /**
   * A typography block at x, y: scaled when the block carries a sized form (drawn by the host over blank cells),
   * otherwise its plain rows in `style`. Never draws a sized block that does not fit inside the canvas.
   */
  typeBlock(block: TypeBlock, x: number, y: number, style: Style = {}): void {
    if (block.sized && x >= 0 && y >= 0 && x + block.sized.columns <= this.width && y + block.sized.rows <= this.height) {
      this.overlay({x, y, columns: block.sized.columns, rows: block.sized.rows, sequence: block.sized.sequence, style});
      return;
    }
    block.plain.forEach((row, index) => this.text(x, y + index, row, style));
  }

  /** Add a sized-text block: its cells are blanked and the host draws `sequence` at its top-left cell. */
  overlay(block: TextOverlay): void {
    this.fill(block.x, block.y, block.columns, block.rows, ' ');
    this.overlays.push(block);
  }

  /** One encoded string per row, each at most `width` cells and reset at the end. */
  rows(options: EncodeOptions = DEFAULT_ENCODING): string[] {
    const key = `${options.color}:${options.safe ? 's' : 'r'}`;
    const out: string[] = [];
    for (let y = 0; y < this.height; y += 1) {
      const cached = this.cache[y];
      if (cached && cached.version === this.versions[y] && cached.key === key) { out.push(cached.row); continue; }
      const row = this.encodeRow(y, options);
      this.cache[y] = {version: this.versions[y]!, key, row};
      out.push(row);
    }
    return out;
  }

  /** Rows as plain text (no escapes), for tests and screenshots. */
  plain(options: EncodeOptions = {color: 'none', safe: false}): string[] {
    return this.rows(options).map(row => row.replace(/\u001b\[[0-9;]*m/gu, ''));
  }

  /** The SGR prefix for a style at an encoding (for sized-text blocks the host draws itself), and the reset that ends it. */
  static styleEscape(style: Style, options: EncodeOptions): string {
    let out = '';
    if (style.bold) out += '\u001b[1m';
    if (style.dim) out += '\u001b[2m';
    if (style.italic) out += '\u001b[3m';
    if (style.underline) out += '\u001b[4m';
    if (options.color !== 'none') {
      if (style.fg) out += colorEscape(38, style.fg, options.color);
      if (style.bg) out += colorEscape(48, style.bg, options.color);
    }
    return out;
  }

  private encodeRow(y: number, options: EncodeOptions): string {
    let out = '';
    let current = '';
    const none = options.color === 'none';
    for (let x = 0; x < this.width; x += 1) {
      const index = y * this.width + x;
      let ch = this.chars[index]!;
      if (ch === '' ) continue;
      const attr = this.attrs[index]!;
      let fg = this.fg[index];
      let bg = this.bg[index];
      let flags = attr & (BOLD | DIM | ITALIC | UNDERLINE | REVERSE);
      if (attr & (PIXEL_TOP | PIXEL_BOTTOM | PIXEL_BOTH | BRAILLE)) {
        ({ch, fg, bg} = this.degrade(attr, ch, fg, bg, options));
        if (none) flags &= ~REVERSE;
      } else if (options.safe && /[^\x20-\x7e]/u.test(ch)) ch = safeGlyph(ch);
      let style = '';
      if (flags & BOLD) style += '\u001b[1m';
      if (flags & DIM) style += '\u001b[2m';
      if (flags & ITALIC) style += '\u001b[3m';
      if (flags & UNDERLINE) style += '\u001b[4m';
      if (flags & REVERSE) style += '\u001b[7m';
      if (!none) {
        if (fg) style += colorEscape(38, fg, options.color);
        if (bg) style += colorEscape(48, bg, options.color);
      }
      if (style !== current) { out += current ? RESET : ''; out += style; current = style; }
      out += ch;
    }
    return current ? out + RESET : out;
  }

  /** Pixel and Braille cells where color or Unicode is missing: a lit half is a solid glyph, in Safe mode ASCII. */
  private degrade(attr: number, ch: string, fg: Rgb | undefined, bg: Rgb | undefined, options: EncodeOptions): {ch: string; fg: Rgb | undefined; bg: Rgb | undefined} {
    if (attr & BRAILLE) {
      if (options.safe) return {ch: '.', fg, bg};
      return {ch, fg, bg};
    }
    const none = options.color === 'none';
    if (options.safe) {
      const safe = attr & PIXEL_BOTH ? '#' : attr & PIXEL_TOP ? '"' : ',';
      return {ch: safe, fg, bg};
    }
    if (none) return {ch: attr & PIXEL_BOTH ? '█' : ch, fg: undefined, bg: undefined};
    return {ch, fg, bg};
  }
}

const PIXEL_TOP = 32;
const PIXEL_BOTTOM = 64;
const PIXEL_BOTH = 128;
const BRAILLE = 256;

/** Replace common Unicode glyphs with an ASCII stand-in for Safe Glyphs. */
export function safeGlyph(ch: string): string {
  const map: Record<string, string> = {'─': '-', '│': '|', '┌': '+', '┐': '+', '└': '+', '┘': '+', '├': '+', '┤': '+', '┬': '+', '┴': '+', '┼': '+', '═': '=', '║': '|', '╔': '+', '╗': '+', '╚': '+', '╝': '+',
    '█': '#', '▓': '#', '▒': ':', '░': '.', '▀': '"', '▄': ',', '●': 'o', '○': 'o', '·': '.', '•': '*', '★': '*', '✦': '*', '✧': '*', '♥': '<3', '▲': '^', '▼': 'v', '◀': '<', '▶': '>', '→': '>', '←': '<', '↑': '^', '↓': 'v', '…': '.', '✔': '+', '✘': 'x', '×': 'x', '▪': '#', '■': '#', '□': 'o', '◆': '*', '◇': 'o',
    '▌': '|', '▐': '|', '▔': '-', '▁': '_', '✓': '+', '‹': '<', '›': '>', '⏎': '>', '◷': 'o', '♦': '*', '⎵': '_', '⌫': '<', '╭': '+', '╮': '+', '╰': '+', '╯': '+'};
  return (map[ch] ?? '?').slice(0, 1);
}

/**
 * A pixel grid, `width` pixels by `height` pixels, with two pixels per terminal cell vertically. Drawing is clipped.
 * Sprites are authored as small string grids (see `spriteFromRows`).
 */
export class PixelBuffer {
  private readonly data: Array<Rgb | undefined>;
  constructor(readonly width: number, readonly height: number) {
    this.data = new Array<Rgb | undefined>(Math.max(0, width * height)).fill(undefined);
  }
  get(x: number, y: number): Rgb | undefined {
    return x < 0 || y < 0 || x >= this.width || y >= this.height ? undefined : this.data[y * this.width + x];
  }
  set(x: number, y: number, color: Rgb | undefined): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    this.data[py * this.width + px] = color;
  }
  clear(): void { this.data.fill(undefined); }
  /** Make this buffer a copy of `source` (same size): how a cached backdrop starts each frame. */
  copyFrom(source: PixelBuffer): void {
    if (source.width !== this.width || source.height !== this.height) throw new RangeError('buffer sizes differ');
    for (let index = 0; index < this.data.length; index += 1) this.data[index] = source.data[index];
  }
  rect(x: number, y: number, width: number, height: number, color: Rgb): void {
    for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) this.set(x + column, y + row, color);
  }
  /** A filled ellipse inside the box (x, y, width, height). */
  ellipse(x: number, y: number, width: number, height: number, color: Rgb): void {
    const rx = width / 2;
    const ry = height / 2;
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const dx = (column + 0.5 - rx) / rx;
        const dy = (row + 0.5 - ry) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x + column, y + row, color);
      }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, color: Rgb): void {
    let x = Math.round(x0), y = Math.round(y0);
    const ex = Math.round(x1), ey = Math.round(y1);
    const dx = Math.abs(ex - x), dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1;
    let error = dx + dy;
    for (let guard = 0; guard < 10_000; guard += 1) {
      this.set(x, y, color);
      if (x === ex && y === ey) break;
      const doubled = 2 * error;
      if (doubled >= dy) { error += dy; x += sx; }
      if (doubled <= dx) { error += dx; y += sy; }
    }
  }
  /** Draw a sprite with its top-left pixel at x, y; mirrored horizontally when `flip`. */
  sprite(sprite: Sprite, x: number, y: number, flip = false): void {
    for (let row = 0; row < sprite.height; row += 1) {
      for (let column = 0; column < sprite.width; column += 1) {
        const color = sprite.pixels[row * sprite.width + (flip ? sprite.width - 1 - column : column)];
        if (color) this.set(x + column, y + row, color);
      }
    }
  }
}

export interface Sprite {
  width: number;
  height: number;
  pixels: Array<Rgb | undefined>;
}

/**
 * The sprite with a one-pixel `color` outline around its silhouette (four-neighbour), one pixel larger on every side: how
 * Vespyr stays readable over a sky close to his own lavender.
 */
export function outlineSprite(sprite: Sprite, color: Rgb): Sprite {
  const width = sprite.width + 2;
  const height = sprite.height + 2;
  const at = (x: number, y: number): Rgb | undefined => (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height ? undefined : sprite.pixels[y * sprite.width + x]);
  const pixels: Array<Rgb | undefined> = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const own = at(x - 1, y - 1);
    if (own) { pixels.push(own); continue; }
    pixels.push(at(x - 2, y - 1) || at(x, y - 1) || at(x - 1, y - 2) || at(x - 1, y) ? color : undefined);
  }
  return {width, height, pixels};
}

/** Author a sprite as rows of characters; `palette` maps a character to a color, any other character is transparent. */
export function spriteFromRows(rows: readonly string[], palette: Readonly<Record<string, Rgb>>): Sprite {
  const width = Math.max(0, ...rows.map(row => row.length));
  const pixels: Array<Rgb | undefined> = [];
  for (const row of rows) for (let column = 0; column < width; column += 1) pixels.push(palette[row[column] ?? ' ']);
  return {width, height: rows.length, pixels};
}

/** A Braille dot grid: 2 x 4 dots per cell, one color per cell (the last dot drawn into it wins). */
export class BrailleBuffer {
  private readonly bits: Uint8Array;
  private readonly colors: Array<Rgb | undefined>;
  constructor(readonly columns: number, readonly rows: number) {
    this.bits = new Uint8Array(Math.max(0, columns * rows));
    this.colors = new Array<Rgb | undefined>(Math.max(0, columns * rows)).fill(undefined);
  }
  get dotWidth(): number { return this.columns * 2; }
  get dotHeight(): number { return this.rows * 4; }
  /** Set a dot at dot coordinates (x of 0..2*columns, y of 0..4*rows). */
  set(x: number, y: number, color?: Rgb): void {
    const dx = Math.round(x);
    const dy = Math.round(y);
    if (dx < 0 || dy < 0 || dx >= this.dotWidth || dy >= this.dotHeight) return;
    const cell = Math.floor(dy / 4) * this.columns + Math.floor(dx / 2);
    this.bits[cell]! |= DOT_BITS[(dy % 4) * 2 + (dx % 2)]!;
    if (color) this.colors[cell] = color;
  }
  line(x0: number, y0: number, x1: number, y1: number, color?: Rgb): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let step = 0; step <= steps; step += 1) this.set(x0 + ((x1 - x0) * step) / steps, y0 + ((y1 - y0) * step) / steps, color);
  }
  dots(column: number, row: number): number { return this.bits[row * this.columns + column] ?? 0; }
  color(column: number, row: number): Rgb | undefined { return this.colors[row * this.columns + column]; }
  clear(): void { this.bits.fill(0); this.colors.fill(undefined); }
}

/** Braille dot (column, row) to bit, in the Unicode block's order. */
const DOT_BITS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80] as const;
