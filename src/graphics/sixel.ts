import {ImageError, type Raster, type Rgb8} from './raster.js';
import {assertRaster} from './scale.js';

/** The longest side a sixel image may have. Scale to the terminal's pixel size first; sixel is a bulky format. */
export const SIXEL_MAX_DIMENSION = 4096;
/** The most pixels a sixel image may have. */
export const SIXEL_MAX_PIXELS = SIXEL_MAX_DIMENSION * SIXEL_MAX_DIMENSION;
/** The longest stream produced; a pathological image (every pixel a different color run) is refused rather than built. */
export const SIXEL_MAX_BYTES = 32 * 1024 * 1024;
/** Pixels sampled to build the palette. */
const SAMPLE_PIXELS = 65_536;
const CACHE_SIZE = 1 << 14;

export interface SixelOptions {
  maxColors?: 16 | 64 | 128 | 256;
  dither?: 'none' | 'ordered' | 'floyd';
  /** Pixels with alpha < 128 stay undrawn (P2 = 1) instead of being flattened over `background`. */
  transparent?: boolean;
  /** What a non-`transparent` stream shows through alpha; black by default. */
  background?: Rgb8;
}

/** Bayer 4 x 4 thresholds, centered on zero, scaled to +-24 levels. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(value => Math.round(((value + 0.5) / 16 - 0.5) * 48));

/** The sixel palette stores percentages, so the color a terminal draws is the one rounded through 0-100. */
const percent = (value: number) => Math.round((value / 255) * 100);
const fromPercent = (value: number) => Math.round((value * 255) / 100);

interface Entry { color: number; count: number }

/** Median-cut over (color, count) entries: repeatedly split the box with the widest weighted spread at its weighted median. */
function medianCut(entries: Entry[], target: number): number[] {
  interface Box { items: Entry[]; weight: number; axis: number; spread: number }
  const measure = (items: Entry[]): Box => {
    let lo = [255, 255, 255];
    let hi = [0, 0, 0];
    let weight = 0;
    for (const {color, count} of items) {
      const channels = [color >> 16, (color >> 8) & 255, color & 255];
      for (let c = 0; c < 3; c += 1) {
        if (channels[c]! < lo[c]!) lo[c] = channels[c]!;
        if (channels[c]! > hi[c]!) hi[c] = channels[c]!;
      }
      weight += count;
    }
    let axis = 0;
    for (let c = 1; c < 3; c += 1) if (hi[c]! - lo[c]! > hi[axis]! - lo[axis]!) axis = c;
    return {items, weight, axis, spread: hi[axis]! - lo[axis]!};
  };
  const boxes = [measure(entries)];
  while (boxes.length < target) {
    let pick = -1;
    let pickScore = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i]!;
      if (box.items.length < 2) continue;
      const score = box.spread * Math.sqrt(box.weight);
      if (score > pickScore) { pickScore = score; pick = i; }
    }
    if (pick < 0) break;
    const box = boxes[pick]!;
    const shift = 16 - 8 * box.axis;
    // Ties on the axis fall back to the full color so the order, and so the palette, is deterministic.
    const items = box.items.slice().sort((a, b) => ((a.color >> shift) & 255) - ((b.color >> shift) & 255) || a.color - b.color);
    let seen = 0;
    let cut = 1;
    for (let i = 0; i < items.length - 1; i += 1) {
      seen += items[i]!.count;
      cut = i + 1;
      if (seen * 2 >= box.weight) break;
    }
    boxes.splice(pick, 1, measure(items.slice(0, cut)), measure(items.slice(cut)));
  }
  return boxes.map(box => {
    let r = 0; let g = 0; let b = 0;
    for (const {color, count} of box.items) { r += (color >> 16) * count; g += ((color >> 8) & 255) * count; b += (color & 255) * count; }
    return (fromPercent(percent(Math.round(r / box.weight))) << 16) | (fromPercent(percent(Math.round(g / box.weight))) << 8) | fromPercent(percent(Math.round(b / box.weight)));
  });
}

/**
 * A complete sixel stream (DCS ... ST) for `raster`. Colors come from a median cut over a bounded, evenly strided sample
 * of the opaque pixels (exact when the image has no more colors than the palette); palette entries are the values a
 * terminal draws after the 0-100 percent rounding. Deterministic: the same raster and options give the same bytes.
 */
export function encodeSixel(raster: Raster, options: SixelOptions = {}): string {
  assertRaster(raster);
  const {width, height} = raster;
  if (width > SIXEL_MAX_DIMENSION || height > SIXEL_MAX_DIMENSION || width * height > SIXEL_MAX_PIXELS) {
    throw new ImageError('too-large', `The image is too large for sixel (${width} × ${height}; at most ${SIXEL_MAX_DIMENSION} pixels a side).`);
  }
  const maxColors = Math.max(2, Math.min(256, Math.floor(options.maxColors ?? 256) || 256));
  const dither = options.dither ?? 'none';
  const transparent = options.transparent === true;
  const bg = options.background ?? {red: 0, green: 0, blue: 0};
  const input = raster.data;
  const count = width * height;

  // Straight-alpha color of pixel i composited over the background (only used when not transparent or alpha >= 128).
  const rgb = (i: number, out: Int32Array | number[]) => {
    const at = i * 4;
    const a = input[at + 3]!;
    if (a === 255) { out[0] = input[at]!; out[1] = input[at + 1]!; out[2] = input[at + 2]!; return; }
    out[0] = Math.round((input[at]! * a + bg.red * (255 - a)) / 255);
    out[1] = Math.round((input[at + 1]! * a + bg.green * (255 - a)) / 255);
    out[2] = Math.round((input[at + 2]! * a + bg.blue * (255 - a)) / 255);
  };
  const isClear = (i: number) => transparent && input[i * 4 + 3]! < 128;

  // Palette from a strided sample.
  const histogram = new Map<number, number>();
  const step = Math.max(1, Math.ceil(count / SAMPLE_PIXELS));
  const px = new Int32Array(3);
  for (let i = 0; i < count; i += step) {
    if (isClear(i)) continue;
    rgb(i, px);
    const key = (px[0]! << 16) | (px[1]! << 8) | px[2]!;
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const entries = [...histogram].map(([color, n]) => ({color, count: n})).sort((a, b) => a.color - b.color);
  let palette: number[];
  if (entries.length === 0) palette = [];
  else if (entries.length <= maxColors) palette = [...new Set(entries.map(({color}) => (fromPercent(percent(color >> 16)) << 16) | (fromPercent(percent((color >> 8) & 255)) << 8) | fromPercent(percent(color & 255))))].sort((a, b) => a - b);
  else palette = [...new Set(medianCut(entries, maxColors))].sort((a, b) => a - b);

  const pr = Int32Array.from(palette, color => color >> 16);
  const pg = Int32Array.from(palette, color => (color >> 8) & 255);
  const pb = Int32Array.from(palette, color => color & 255);
  // A small direct-mapped cache keeps the nearest-color search off the hot path; collisions only cost a recomputation.
  const cacheKey = new Int32Array(CACHE_SIZE).fill(-1);
  const cacheValue = new Int16Array(CACHE_SIZE);
  const nearest = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b;
    const slot = Math.imul(key, 0x9e3779b1) >>> 18;
    if (cacheKey[slot] === key) return cacheValue[slot]!;
    let best = 0;
    let bestDistance = Infinity;
    for (let p = 0; p < pr.length; p += 1) {
      const distance = (pr[p]! - r) ** 2 + (pg[p]! - g) ** 2 + (pb[p]! - b) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = p; if (distance === 0) break; }
    }
    cacheKey[slot] = key;
    cacheValue[slot] = best;
    return best;
  };

  // Palette index per pixel (-1 where nothing is drawn).
  const indices = new Int16Array(count).fill(-1);
  if (palette.length > 0) {
    const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
    const floyd = dither === 'floyd';
    let errNow = new Float32Array(floyd ? (width + 2) * 3 : 0);
    let errNext = new Float32Array(floyd ? (width + 2) * 3 : 0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (isClear(i)) continue;
        rgb(i, px);
        let r = px[0]!; let g = px[1]!; let b = px[2]!;
        if (dither === 'ordered') {
          const t = BAYER[(y & 3) * 4 + (x & 3)]!;
          r = clamp(r + t); g = clamp(g + t); b = clamp(b + t);
        } else if (floyd) {
          const e = (x + 1) * 3;
          r = clamp(Math.round(r + errNow[e]!)); g = clamp(Math.round(g + errNow[e + 1]!)); b = clamp(Math.round(b + errNow[e + 2]!));
        }
        const index = nearest(r, g, b);
        indices[i] = index;
        if (floyd) {
          const e = (x + 1) * 3;
          const dr = r - pr[index]!; const dg = g - pg[index]!; const db = b - pb[index]!;
          // 7/16 right, 3/16 below-left, 5/16 below, 1/16 below-right.
          errNow[e + 3] = errNow[e + 3]! + (dr * 7) / 16; errNow[e + 4] = errNow[e + 4]! + (dg * 7) / 16; errNow[e + 5] = errNow[e + 5]! + (db * 7) / 16;
          errNext[e - 3] = errNext[e - 3]! + (dr * 3) / 16; errNext[e - 2] = errNext[e - 2]! + (dg * 3) / 16; errNext[e - 1] = errNext[e - 1]! + (db * 3) / 16;
          errNext[e] = errNext[e]! + (dr * 5) / 16; errNext[e + 1] = errNext[e + 1]! + (dg * 5) / 16; errNext[e + 2] = errNext[e + 2]! + (db * 5) / 16;
          errNext[e + 3] = errNext[e + 3]! + dr / 16; errNext[e + 4] = errNext[e + 4]! + dg / 16; errNext[e + 5] = errNext[e + 5]! + db / 16;
        }
      }
      if (floyd) { const swap = errNow; errNow = errNext; errNext = swap; errNext.fill(0); }
    }
  }

  // Only the colors actually used are defined, numbered in palette order.
  const used = new Int16Array(palette.length).fill(-1);
  for (let i = 0; i < count; i += 1) if (indices[i]! >= 0) used[indices[i]!] = 0;
  const definitions: string[] = [];
  let numbered = 0;
  for (let p = 0; p < palette.length; p += 1) {
    if (used[p] !== 0) continue;
    used[p] = numbered;
    definitions.push(`#${numbered};2;${percent(pr[p]!)};${percent(pg[p]!)};${percent(pb[p]!)}`);
    numbered += 1;
  }

  const parts: string[] = [`\u001BP0;${transparent ? 1 : 0};0q"1;1;${width};${height}`, definitions.join('')];
  let length = parts[0]!.length + parts[1]!.length + 2;
  const masks = new Uint8Array(Math.max(1, numbered) * width);
  const present = new Uint8Array(Math.max(1, numbered));
  const bands = Math.ceil(height / 6);
  for (let band = 0; band < bands; band += 1) {
    const order: number[] = [];
    const top = band * 6;
    const rows = Math.min(6, height - top);
    for (let dy = 0; dy < rows; dy += 1) {
      const rowBase = (top + dy) * width;
      for (let x = 0; x < width; x += 1) {
        const index = indices[rowBase + x]!;
        if (index < 0) continue;
        const color = used[index]!;
        if (!present[color]) { present[color] = 1; order.push(color); }
        masks[color * width + x] = masks[color * width + x]! | (1 << dy);
      }
    }
    order.sort((a, b) => a - b);
    const pieces: string[] = [];
    for (let k = 0; k < order.length; k += 1) {
      const color = order[k]!;
      const base = color * width;
      let last = width - 1;
      while (last >= 0 && masks[base + last] === 0) last -= 1;
      let text = `#${color}`;
      let x = 0;
      while (x <= last) {
        const value = masks[base + x]!;
        let run = 1;
        while (x + run <= last && masks[base + x + run] === value) run += 1;
        const char = String.fromCharCode(63 + value);
        text += run > 3 ? `!${run}${char}` : char.repeat(run);
        x += run;
      }
      masks.fill(0, base, base + width);
      present[color] = 0;
      pieces.push(text, k < order.length - 1 ? '$' : '');
    }
    if (band < bands - 1) pieces.push('-');
    const piece = pieces.join('');
    length += piece.length;
    if (length > SIXEL_MAX_BYTES) throw new ImageError('too-large', 'The image is too detailed to send as sixel.');
    parts.push(piece);
  }
  parts.push('\u001B\\');
  return parts.join('');
}
