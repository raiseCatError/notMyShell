import {colorEscape, type Rgb} from '../chroma/escape.js';
import type {ColorLevel} from '../presentation/capabilities.js';

/**
 * A reusable frame buffer for idle visuals: one glyph and packed 0xRRGGBB
 * foreground/background per cell. It is reallocated only when the size
 * changes, so animation frames do not allocate per cell. Rows are serialized
 * with an SGR only where color changes; the renderer then rewrites only the
 * rows that differ from the previous frame.
 */
export const NO_COLOR_VALUE = -1;

export class CellGrid {
  width = 0;
  height = 0;
  glyphs: string[] = [];
  fg = new Int32Array(0);
  bg = new Int32Array(0);

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.min(1024, Math.floor(width)));
    const h = Math.max(1, Math.min(512, Math.floor(height)));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.glyphs = new Array<string>(w * h).fill(' ');
    this.fg = new Int32Array(w * h).fill(NO_COLOR_VALUE);
    this.bg = new Int32Array(w * h).fill(NO_COLOR_VALUE);
  }

  clear(background: number): void {
    this.glyphs.fill(' ');
    this.fg.fill(NO_COLOR_VALUE);
    this.bg.fill(background);
  }

  set(x: number, y: number, glyph: string, fg: number, bg?: number): void {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return;
    const index = cy * this.width + cx;
    this.glyphs[index] = glyph;
    this.fg[index] = fg;
    if (bg !== undefined) this.bg[index] = bg;
  }

  /** Brighter wins: used so overlapping particles never dim each other. */
  plot(x: number, y: number, glyph: string, fg: number): void {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return;
    const index = cy * this.width + cx;
    if (this.fg[index] !== NO_COLOR_VALUE && luminance(this.fg[index]!) > luminance(fg)) return;
    this.glyphs[index] = glyph;
    this.fg[index] = fg;
  }

  getBg(x: number, y: number): number {
    return this.bg[y * this.width + x] ?? NO_COLOR_VALUE;
  }

  toRows(level: ColorLevel): string[] {
    const rows: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let line = '';
      let lastFg = Number.NaN, lastBg = Number.NaN;
      for (let x = 0; x < this.width; x++) {
        const index = y * this.width + x;
        const fg = this.fg[index]!, bg = this.bg[index]!;
        if (level !== 'none') {
          if (bg !== lastBg) { line += bg === NO_COLOR_VALUE ? '\u001B[49m' : colorEscape(48, unpack(bg), level); lastBg = bg; }
          // A blank cell shows only its background: no foreground escape is needed.
          if (fg !== lastFg && this.glyphs[index] !== ' ') { line += fg === NO_COLOR_VALUE ? '\u001B[39m' : colorEscape(38, unpack(fg), level); lastFg = fg; }
        }
        line += this.glyphs[index]!;
      }
      rows.push(level === 'none' ? line : `${line}\u001B[0m`);
    }
    return rows;
  }
}

export function pack(color: Rgb): number {
  return ((Math.max(0, Math.min(255, Math.round(color.red))) << 16) | (Math.max(0, Math.min(255, Math.round(color.green))) << 8)
    | Math.max(0, Math.min(255, Math.round(color.blue)))) >>> 0 & 0xffffff;
}

export function unpack(value: number): Rgb {
  return {red: (value >> 16) & 0xff, green: (value >> 8) & 0xff, blue: value & 0xff};
}

export function luminance(value: number): number {
  return (0.2126 * ((value >> 16) & 0xff) + 0.7152 * ((value >> 8) & 0xff) + 0.0722 * (value & 0xff)) / 255;
}

/** Linear mix of packed colors, 0..1. */
export function mixPacked(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = ((a >> 16) & 0xff) + ((((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * k);
  const g = ((a >> 8) & 0xff) + ((((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * k);
  const bl = (a & 0xff) + (((b & 0xff) - (a & 0xff)) * k);
  return ((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)) & 0xffffff;
}
