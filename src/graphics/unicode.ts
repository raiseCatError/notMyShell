import {colorEscape} from '../chroma/escape.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {type Raster, type Rgb8} from './raster.js';
import {assertRaster, fitCells, flatten, scaleBox} from './scale.js';

/**
 * Character-art rendering: NMSh's fallback for terminals with no graphics protocol. Every returned row is plain text plus
 * SGR color sequences, exactly `columns` cells wide, and nothing else is ever emitted.
 */
export type CellMode = 'half' | 'quadrant' | 'braille' | 'ascii';

export interface CellOptions {
  /** The most columns and rows the art may occupy; the image keeps its aspect ratio inside them (8 x 16 px cells). */
  columns: number;
  rows: number;
  mode: CellMode;
  color: ColorLevel;
  /** Printable ASCII only in every mode (glyphs are the ascii ramp). Color escapes still follow `color`. */
  safe: boolean;
  /** Transparent pixels are composited over this; without it they stay unpainted so the terminal background shows. */
  background?: Rgb8;
}

export interface CellArt {
  rows: string[];
  /** The width of every row in display cells (the fitted width, never above `options.columns`). */
  columns: number;
  /** The number of rows (never above `options.rows`). */
  height: number;
}

/** The most cells per side; bounds allocation whatever a caller asks for. */
const MAX_CELLS = 1024;
/** Pixels per cell (across x down) for each mode. */
const SUBPIXELS: Record<CellMode, readonly [number, number]> = {half: [1, 2], quadrant: [2, 2], braille: [2, 4], ascii: [1, 2]};
const RAMP = ' .:-=+*#%@';
const SHADES = [' ', '░', '▒', '▓', '█'] as const;
/** Quadrant glyphs indexed by a mask of lit quarters: bit 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
const QUADRANTS = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█'] as const;
/** Braille dot bits for a pixel at (column, row) inside the 2 x 4 cell. */
const BRAILLE_BITS = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]] as const;
const OPAQUE = 128;
/** Below this luminance spread a colorless cell is a flat shade, not a shape. */
const FLAT_CONTRAST = 48;

const KEEP = -2;
const DEFAULT = -1;

interface Cell { glyph: string; fg: number; bg: number }

const pack = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
const luma = (r: number, g: number, b: number) => (299 * r + 587 * g + 114 * b) / 1000;

function clampCells(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_CELLS, Math.max(1, Math.floor(value))) : 1;
}

export function renderCells(raster: Raster, options: CellOptions): CellArt {
  assertRaster(raster);
  const mode: CellMode = options.safe ? 'ascii' : options.mode;
  const fit = fitCells(raster.width, raster.height, clampCells(options.columns), clampCells(options.rows), undefined, true);
  const [sx, sy] = SUBPIXELS[mode] ?? SUBPIXELS.half;
  let pixels = scaleBox(raster, fit.columns * sx, fit.rows * sy);
  if (options.background) pixels = flatten(pixels, options.background);
  const data = pixels.data;
  const stride = pixels.width * 4;
  const styled = options.color !== 'none';
  const cell: Cell = {glyph: ' ', fg: DEFAULT, bg: DEFAULT};
  const escapes = {38: new Map<number, string>(), 48: new Map<number, string>()};
  const escape = (layer: 38 | 48, packed: number): string => {
    if (options.color === 'truecolor') return `\u001B[${layer};2;${packed >> 16};${(packed >> 8) & 255};${packed & 255}m`;
    let cached = escapes[layer].get(packed);
    if (cached === undefined) {
      cached = colorEscape(layer, {red: packed >> 16, green: (packed >> 8) & 255, blue: packed & 255}, options.color);
      escapes[layer].set(packed, cached);
    }
    return cached;
  };
  const paint = styled ? colorCell : shapeCell;
  const rows: string[] = [];
  for (let row = 0; row < fit.rows; row += 1) {
    let line = '';
    let currentFg = '';
    let currentBg = '';
    for (let column = 0; column < fit.columns; column += 1) {
      paint(mode, data, row * sy * stride + column * sx * 4, stride, cell);
      if (styled) {
        const wantFg = cell.fg === KEEP ? currentFg : cell.fg === DEFAULT ? '' : escape(38, cell.fg);
        if (wantFg !== currentFg) { line += wantFg || '\u001B[39m'; currentFg = wantFg; }
        const wantBg = cell.bg === KEEP ? currentBg : cell.bg === DEFAULT ? '' : escape(48, cell.bg);
        if (wantBg !== currentBg) { line += wantBg || '\u001B[49m'; currentBg = wantBg; }
      }
      line += cell.glyph;
    }
    if (currentFg || currentBg) line += '\u001B[0m';
    rows.push(line);
  }
  return {rows, columns: fit.columns, height: fit.rows};
}

/** Pixel offsets (from the cell's first byte) of the cell's sub-pixels, row-major, `sx` per row. */
function offsets(mode: CellMode, stride: number): number[] {
  const [sx, sy] = SUBPIXELS[mode];
  const result: number[] = [];
  for (let y = 0; y < sy; y += 1) for (let x = 0; x < sx; x += 1) result.push(y * stride + x * 4);
  return result;
}
const OFFSET_CACHE = new Map<string, number[]>();
function cellOffsets(mode: CellMode, stride: number): number[] {
  const key = `${mode}:${stride}`;
  let cached = OFFSET_CACHE.get(key);
  if (!cached) {
    if (OFFSET_CACHE.size > 64) OFFSET_CACHE.clear();
    cached = offsets(mode, stride);
    OFFSET_CACHE.set(key, cached);
  }
  return cached;
}

const rampGlyph = (lum: number) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round((lum / 255) * (RAMP.length - 1))))]!;
const shadeGlyph = (lum: number) => SHADES[Math.max(0, Math.min(4, Math.round((lum / 255) * 4)))]!;

// Scratch space for one cell (at most 8 sub-pixels); the renderer is synchronous so sharing it is safe.
const R = new Int32Array(8);
const G = new Int32Array(8);
const B = new Int32Array(8);
const L = new Float64Array(8);

/** Color rendering of one cell starting at byte `base`. */
function colorCell(mode: CellMode, data: Uint8ClampedArray, base: number, stride: number, cell: Cell): void {
  const offs = cellOffsets(mode, stride);
  const n = offs.length;
  let opaqueMask = 0;
  for (let i = 0; i < n; i += 1) {
    const at = base + offs[i]!;
    R[i] = data[at]!;
    G[i] = data[at + 1]!;
    B[i] = data[at + 2]!;
    L[i] = luma(R[i]!, G[i]!, B[i]!);
    if (data[at + 3]! >= OPAQUE) opaqueMask |= 1 << i;
  }
  const full = (1 << n) - 1;
  if (opaqueMask === 0) { cell.glyph = ' '; cell.fg = KEEP; cell.bg = DEFAULT; return; }
  cell.bg = DEFAULT;
  switch (mode) {
    case 'ascii': {
      let r = 0; let g = 0; let b = 0; let lum = 0; let count = 0;
      for (let i = 0; i < n; i += 1) if (opaqueMask & (1 << i)) { r += R[i]!; g += G[i]!; b += B[i]!; lum += L[i]!; count += 1; }
      cell.glyph = rampGlyph(lum / count);
      // The glyph carries the lightness; the color keeps the hue at full brightness so a dark pixel is not doubly dark.
      const top = Math.max(r, g, b);
      const scale = top > 0 ? 255 / top : 0;
      cell.fg = cell.glyph === ' ' ? KEEP : pack(Math.round(r * scale), Math.round(g * scale), Math.round(b * scale));
      return;
    }
    case 'half': {
      if (opaqueMask === full) {
        if (R[0] === R[1] && G[0] === G[1] && B[0] === B[1]) { cell.glyph = '█'; cell.fg = pack(R[0]!, G[0]!, B[0]!); cell.bg = KEEP; return; }
        cell.glyph = '▀'; cell.fg = pack(R[0]!, G[0]!, B[0]!); cell.bg = pack(R[1]!, G[1]!, B[1]!);
        return;
      }
      const top = (opaqueMask & 1) !== 0;
      const at = top ? 0 : 1;
      cell.glyph = top ? '▀' : '▄'; cell.fg = pack(R[at]!, G[at]!, B[at]!);
      return;
    }
    case 'quadrant': {
      if (opaqueMask !== full) { setShape(QUADRANTS[opaqueMask]!, opaqueMask, cell); return; }
      quadrantFit(cell);
      return;
    }
    case 'braille': {
      let mask = opaqueMask;
      let unlit = 0;
      if (opaqueMask === full) {
        let mean = 0;
        for (let i = 0; i < 8; i += 1) mean += L[i]!;
        mean /= 8;
        mask = 0;
        for (let i = 0; i < 8; i += 1) if (L[i]! >= mean) mask |= 1 << i;
        unlit = full & ~mask;
      }
      cell.glyph = brailleGlyph(mask);
      cell.fg = meanColor(mask);
      // Unlit dots show the cell background: their mean color, or (all lit) the same color so the gaps do not show.
      if (opaqueMask === full) cell.bg = unlit ? meanColor(unlit) : cell.fg;
      return;
    }
  }
}

/** A cell whose lit sub-pixels (`mask`) all take the mean color, on the terminal background. */
function setShape(glyph: string, mask: number, cell: Cell): void {
  cell.glyph = mask === 0 ? ' ' : glyph;
  cell.fg = mask === 0 ? KEEP : meanColor(mask);
  cell.bg = DEFAULT;
}

function meanColor(mask: number): number {
  let r = 0; let g = 0; let b = 0; let count = 0;
  for (let i = 0; i < 8; i += 1) if (mask & (1 << i)) { r += R[i]!; g += G[i]!; b += B[i]!; count += 1; }
  return count === 0 ? 0 : pack(Math.round(r / count), Math.round(g / count), Math.round(b / count));
}

function brailleGlyph(mask: number): string {
  let bits = 0;
  for (let i = 0; i < 8; i += 1) if (mask & (1 << i)) bits |= BRAILLE_BITS[i & 1]![i >> 1]!;
  return String.fromCharCode(0x2800 + bits);
}

/**
 * Best two-color fit of a fully opaque 2 x 2 cell: of the seven ways to split the four pixels in two groups, the one with
 * least squared error (equivalently the largest sum of |sum|^2 / n over the groups). The brighter group takes the
 * foreground (a tie goes to the group holding the top-left pixel), so a pattern drawn white on black is its own glyph.
 */
function quadrantFit(cell: Cell): void {
  if (R[0] === R[1] && R[1] === R[2] && R[2] === R[3] && G[0] === G[1] && G[1] === G[2] && G[2] === G[3] && B[0] === B[1] && B[1] === B[2] && B[2] === B[3]) {
    cell.glyph = '█'; cell.fg = pack(R[0]!, G[0]!, B[0]!); cell.bg = KEEP;
    return;
  }
  let best = 1;
  let bestScore = -1;
  for (let m = 1; m < 8; m += 1) {
    let ar = 0; let ag = 0; let ab = 0; let an = 0; let br = 0; let bg = 0; let bb = 0; let bn = 0;
    for (let i = 0; i < 4; i += 1) {
      if (m & (1 << i)) { ar += R[i]!; ag += G[i]!; ab += B[i]!; an += 1; } else { br += R[i]!; bg += G[i]!; bb += B[i]!; bn += 1; }
    }
    const score = (ar * ar + ag * ag + ab * ab) / an + (br * br + bg * bg + bb * bb) / bn;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  const other = 15 & ~best;
  const lumA = luma(...channels(best));
  const lumB = luma(...channels(other));
  const lit = lumB > lumA ? other : best;
  cell.glyph = QUADRANTS[lit]!;
  cell.fg = meanColor(lit);
  cell.bg = meanColor(15 & ~lit);
}

function channels(mask: number): [number, number, number] {
  let r = 0; let g = 0; let b = 0; let count = 0;
  for (let i = 0; i < 4; i += 1) if (mask & (1 << i)) { r += R[i]!; g += G[i]!; b += B[i]!; count += 1; }
  return [r / count, g / count, b / count];
}

/** Colorless rendering: luminance and shape only, so a lit cell is a block, a shade or a ramp character. */
function shapeCell(mode: CellMode, data: Uint8ClampedArray, base: number, stride: number, cell: Cell): void {
  const offs = cellOffsets(mode, stride);
  const n = offs.length;
  let mean = 0;
  let lo = 255;
  let hi = 0;
  let opaque = 0;
  for (let i = 0; i < n; i += 1) {
    const at = base + offs[i]!;
    const lit = data[at + 3]! >= OPAQUE;
    L[i] = lit ? luma(data[at]!, data[at + 1]!, data[at + 2]!) : 0;
    if (lit) opaque += 1;
    mean += L[i]!;
    if (L[i]! < lo) lo = L[i]!;
    if (L[i]! > hi) hi = L[i]!;
  }
  mean /= n;
  cell.fg = DEFAULT;
  cell.bg = DEFAULT;
  if (opaque === 0) { cell.glyph = ' '; return; }
  if (mode === 'ascii') {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += L[i]!;
    // Transparent sub-pixels do not darken the ramp: average the painted ones only.
    cell.glyph = rampGlyph(sum / opaque);
    return;
  }
  const flat = hi - lo < FLAT_CONTRAST;
  if (mode === 'braille') {
    let mask = 0;
    if (flat) mask = mean >= 128 ? 0xff : 0;
    else for (let i = 0; i < 8; i += 1) if (L[i]! >= mean) mask |= 1 << i;
    cell.glyph = mask === 0 ? ' ' : brailleGlyph(mask);
    return;
  }
  if (flat) { cell.glyph = shadeGlyph(mean); return; }
  let mask = 0;
  for (let i = 0; i < n; i += 1) if (L[i]! >= mean) mask |= 1 << i;
  cell.glyph = mode === 'half' ? (mask === 1 ? '▀' : '▄') : QUADRANTS[mask]!;
}
