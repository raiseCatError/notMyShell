import {NO_COLOR_VALUE, pack} from './CellGrid.js';
import {stripAnsi} from '../util/text.js';
import {displayWidth} from '../util/text.js';

/**
 * One captured visual frame: what the user is looking at when a screen saver
 * starts, as cells (glyph + packed foreground). Presentation input only: it is
 * parsed from the rows the renderer last wrote and never feeds back into the
 * transcript, PTY, history or journals. Backgrounds are deliberately dropped,
 * so effects sit on the host's own (possibly transparent) background.
 */
export interface ScreenCapture {
  width: number;
  height: number;
  glyphs: string[];
  fg: Int32Array;
  /** Authored background per cell (badges, selection, panels); NO_COLOR_VALUE where the host background shows through. */
  bg: Int32Array;
  /** Per-effect state, created lazily by the effect and discarded with the capture. */
  instances: Record<string, unknown>;
  seed: number;
}

const BASIC = [0x000000, 0xcd3131, 0x0dbc79, 0xe5e510, 0x2472c8, 0xbc3fbc, 0x11a8cd, 0xe5e5e5,
  0x666666, 0xf14c4c, 0x23d18b, 0xf5f543, 0x3b8eea, 0xd670d6, 0x29b8db, 0xffffff];

function xterm256(n: number): number {
  if (n < 16) return BASIC[n]!;
  if (n >= 232) { const v = 8 + (n - 232) * 10; return pack({red: v, green: v, blue: v}); }
  const k = n - 16; const level = (i: number) => (i === 0 ? 0 : 55 + i * 40);
  return pack({red: level(Math.floor(k / 36)), green: level(Math.floor(k / 6) % 6), blue: level(k % 6)});
}

/** Parse SGR foreground colors from rendered rows; every other escape is dropped. */
export function captureFromRows(rows: readonly string[], width: number, height: number, seed: number): ScreenCapture {
  const glyphs = new Array<string>(width * height).fill(' ');
  const fg = new Int32Array(width * height).fill(NO_COLOR_VALUE);
  const bg = new Int32Array(width * height).fill(NO_COLOR_VALUE);
  for (let y = 0; y < Math.min(height, rows.length); y += 1) {
    let color = NO_COLOR_VALUE, back = NO_COLOR_VALUE, inverse = false;
    let x = 0;
    const line = rows[y]!.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu, '');
    for (let i = 0; i < line.length && x < width;) {
      if (line[i] === '\u001b' && line[i + 1] === '[') {
        const end = line.slice(i + 2).search(/[@-~]/u);
        if (end < 0) break;
        const final = line[i + 2 + end]!;
        if (final === 'm') {
          const p = line.slice(i + 2, i + 2 + end).split(';').map(part => Number(part) || 0);
          for (let k = 0; k < p.length; k += 1) {
            const code = p[k]!;
            if (code === 0) { color = NO_COLOR_VALUE; back = NO_COLOR_VALUE; inverse = false; }
            else if (code === 39) color = NO_COLOR_VALUE;
            else if (code === 49) back = NO_COLOR_VALUE;
            else if (code === 7) inverse = true;
            else if (code === 27) inverse = false;
            else if (code >= 40 && code <= 47) back = BASIC[code - 40]!;
            else if (code >= 100 && code <= 107) back = BASIC[code - 100 + 8]!;
            else if (code === 48 && p[k + 1] === 2) { back = pack({red: p[k + 2] ?? 0, green: p[k + 3] ?? 0, blue: p[k + 4] ?? 0}); k += 4; }
            else if (code === 48 && p[k + 1] === 5) { back = xterm256(p[k + 2] ?? 0); k += 2; }
            else if (code >= 30 && code <= 37) color = BASIC[code - 30]!;
            else if (code >= 90 && code <= 97) color = BASIC[code - 90 + 8]!;
            else if (code === 38 && p[k + 1] === 2) { color = pack({red: p[k + 2] ?? 0, green: p[k + 3] ?? 0, blue: p[k + 4] ?? 0}); k += 4; }
            else if (code === 38 && p[k + 1] === 5) { color = xterm256(p[k + 2] ?? 0); k += 2; }
          }
        }
        i += end + 3;
        continue;
      }
      const point = String.fromCodePoint(line.codePointAt(i)!);
      i += point.length;
      if (/[\u0000-\u001f\u007f]/u.test(point)) continue;
      const cells = Math.max(1, displayWidth(point));
      const index = y * width + x;
      // Reverse video swaps the pair; an unset side keeps the host's default (-1).
      const cellFg = inverse ? back : color, cellBg = inverse ? color : back;
      if (point !== ' ') { glyphs[index] = point; fg[index] = cellFg; }
      bg[index] = cellBg;
      if (cells === 2 && x + 1 < width) bg[index + 1] = cellBg;
      // A wide glyph owns its second cell; leave it blank so nothing else is drawn through it.
      x += cells;
    }
  }
  return {width, height, glyphs, fg, bg, instances: {}, seed};
}

/** A smaller view for the gallery preview: the bottom-left of the screen, where the prompt and latest output are. */
export function cropCapture(capture: ScreenCapture, width: number, height: number): ScreenCapture {
  const w = Math.min(width, capture.width), h = Math.min(height, capture.height);
  const glyphs = new Array<string>(w * h).fill(' ');
  const fg = new Int32Array(w * h).fill(NO_COLOR_VALUE);
  const bg = new Int32Array(w * h).fill(NO_COLOR_VALUE);
  const top = capture.height - h;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    glyphs[y * w + x] = capture.glyphs[(top + y) * capture.width + x]!;
    fg[y * w + x] = capture.fg[(top + y) * capture.width + x]!;
    bg[y * w + x] = capture.bg[(top + y) * capture.width + x]!;
  }
  return {width: w, height: h, glyphs, fg, bg, instances: {}, seed: capture.seed};
}

export const plainText = (rows: readonly string[]) => rows.map(stripAnsi);
