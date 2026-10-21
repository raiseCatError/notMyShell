import {mixRgb} from '../chroma/chroma.js';
import type {Rgb} from '../chroma/escape.js';
import {clamp} from './easing.js';
import type {PixelBuffer} from './Canvas.js';

/**
 * Scenery for the arcade's worlds, drawn into a half-block `PixelBuffer`: multi-stop gradient skies, a sun or moon with a
 * soft glow, star fields, seeded ridges for mountains, hills and bushes, and city skylines with lit windows. Every piece
 * is a pure function of its arguments (positions come from hashes of indices, never from `Math.random`), so a frame is
 * reproducible, and a layer that scrolls takes the scroll offset as an argument rather than keeping state.
 *
 * Layers are cheap enough to draw every frame on the largest supported terminal; a game that wants more caches its sky
 * in a second buffer and starts each frame with `copyFrom`.
 */

export const hash = (value: number): number => {
  let h = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

/** 0..1 from a hash, for jitter. */
export const unit = (value: number): number => hash(value) / 4294967296;

const fromHex = (value: number): Rgb => ({red: (value >> 16) & 255, green: (value >> 8) & 255, blue: value & 255});
export const rgb = fromHex;

/** The color at `t` (0..1) along evenly spaced stops. */
export function along(stops: readonly Rgb[], t: number): Rgb {
  if (stops.length === 1) return stops[0]!;
  const scaled = clamp(t, 0, 1) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  return mixRgb(stops[index]!, stops[index + 1]!, scaled - index);
}

/** A vertical gradient over pixel rows [top, bottom). */
export function gradient(buffer: PixelBuffer, stops: readonly Rgb[], top = 0, bottom = buffer.height): void {
  const span = Math.max(1, bottom - top - 1);
  for (let y = top; y < bottom; y += 1) {
    const color = along(stops, (y - top) / span);
    for (let x = 0; x < buffer.width; x += 1) buffer.set(x, y, color);
  }
}

/** Stars over [0, bottom): a fixed field from `seed`, a few twinkling with `time` (ms; 0 holds them still). */
export function stars(buffer: PixelBuffer, seed: number, bottom: number, color: Rgb, sky: Rgb, options: {density?: number; time?: number; scroll?: number; strength?: number} = {}): void {
  const count = Math.floor((buffer.width * bottom) / (options.density ?? 90));
  const strength = options.strength ?? 1;
  if (strength <= 0.02) return;
  const twinkle = Math.floor((options.time ?? 0) / 420);
  const width = buffer.width + 64;
  for (let index = 0; index < count; index += 1) {
    const x = ((hash(seed + index * 2) % width) - (options.scroll ?? 0) % width + width) % width;
    const y = hash(seed + index * 2 + 1) % Math.max(1, bottom);
    const bright = hash(seed + index * 7) % 9 === 0;
    const dim = options.time && (index + twinkle) % 11 === 0 ? 0.35 : 1;
    buffer.set(x, y, mixRgb(sky, color, clamp((bright ? 1 : 0.55) * dim * strength, 0, 1)));
  }
}

/** A round sun or moon at (cx, cy) with radius r (in pixels; rows count half), and a soft glow ring of `glow` pixels. */
export function disc(buffer: PixelBuffer, cx: number, cy: number, r: number, color: Rgb, sky: Rgb, glow = 0, crescent = 0): void {
  const reach = r + glow;
  for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y += 1) {
    for (let x = Math.floor(cx - reach * 1); x <= Math.ceil(cx + reach * 1); x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= r) {
        // A crescent: the part of the disc not covered by a shifted copy.
        if (crescent > 0 && Math.hypot(x - cx - r * crescent, y - cy + r * 0.25) < r) { buffer.set(x, y, mixRgb(color, sky, 0.78)); continue; }
        buffer.set(x, y, color);
      } else if (distance <= reach && glow > 0) {
        const under = buffer.get(x, y) ?? sky;
        buffer.set(x, y, mixRgb(under, color, 0.22 * (1 - (distance - r) / glow)));
      }
    }
  }
}

export interface RidgeOptions {
  /** Pixel row of the ridge's foot (the silhouette fills from its top down to here). */
  base: number;
  /** Typical height and how much it varies. */
  height: number;
  amplitude: number;
  /** Horizontal scale: larger is broader. */
  scale: number;
  /** World offset in pixels (scroll × parallax factor). */
  scroll: number;
  seed: number;
  color: Rgb;
  /** A lighter top edge (a lit rim), drawn one pixel deep. */
  rim?: Rgb;
  /** Steps instead of slopes, for pixel-art blockiness. */
  step?: number;
}

/** A silhouette ridge (mountains, hills, dunes): a sum of seeded sines, stepped to stay crisp. */
export function ridge(buffer: PixelBuffer, options: RidgeOptions): void {
  const phase = [unit(options.seed) * 6.28, unit(options.seed + 1) * 6.28, unit(options.seed + 2) * 6.28];
  const step = Math.max(1, options.step ?? 1);
  for (let x = 0; x < buffer.width; x += 1) {
    const u = Math.floor((x + options.scroll) / step) * step;
    const wave = Math.sin(u / options.scale + phase[0]!) * 0.6 + Math.sin(u / (options.scale * 0.37) + phase[1]!) * 0.3 + Math.sin(u / (options.scale * 0.13) + phase[2]!) * 0.1;
    const top = Math.round(options.base - options.height - wave * options.amplitude);
    for (let y = Math.max(0, top); y < options.base; y += 1) buffer.set(x, y, options.color);
    if (options.rim && top >= 0 && top < options.base) buffer.set(x, top, options.rim);
  }
}

export interface SkylineOptions {
  base: number;
  scroll: number;
  seed: number;
  color: Rgb;
  window: Rgb;
  /** Building height range in pixels. */
  low: number;
  high: number;
  /** Share of windows lit, 0..1. */
  lit?: number;
}

/** A row of buildings with lit windows, repeating seamlessly as it scrolls. */
export function skyline(buffer: PixelBuffer, options: SkylineOptions): void {
  let x = -Math.floor(((options.scroll % 4096) + 4096) % 4096);
  let index = 0;
  // Walk buildings from the start of the repeating strip until the view is covered.
  while (x < buffer.width) {
    const width = 6 + (hash(options.seed + index * 3) % 9);
    const height = options.low + (hash(options.seed + index * 3 + 1) % Math.max(1, options.high - options.low));
    const gap = hash(options.seed + index * 3 + 2) % 3;
    if (x + width >= 0) {
      for (let dx = 0; dx < width; dx += 1) for (let dy = 0; dy < height; dy += 1) buffer.set(x + dx, options.base - 1 - dy, options.color);
      // Windows: 1×1 pixels on a 2-pixel grid, lit by hash.
      for (let wy = 2; wy < height - 1; wy += 2) for (let wx = 1; wx < width - 1; wx += 2) {
        if (unit(options.seed * 31 + index * 97 + wy * 13 + wx) < (options.lit ?? 0.3)) buffer.set(x + wx, options.base - 1 - wy, options.window);
      }
    }
    x += width + gap;
    index += 1;
    if (index > 4000) break;
  }
}
