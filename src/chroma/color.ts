import type {Rgb} from './escape.js';

/**
 * Small perceptual color toolkit (OKLab / OKLCH) for prompt themes, vibrance
 * and Chroma. Pure functions, no dependencies; sRGB in, sRGB out, clamped.
 */

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function gamma(channel: number): number {
  const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

export type Oklab = [lightness: number, a: number, b: number];
export interface Oklch {l: number; c: number; h: number}

export function toOklab(color: Rgb): Oklab {
  const r = linearize(color.red), g = linearize(color.green), b = linearize(color.blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function rawFromOklab(l: number, a: number, b: number): [number, number, number] {
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc];
}

export function fromOklab(l: number, a: number, b: number): Rgb {
  const [red, green, blue] = rawFromOklab(l, a, b);
  return {red: gamma(red), green: gamma(green), blue: gamma(blue)};
}

export function toOklch(color: Rgb): Oklch {
  const [l, a, b] = toOklab(color);
  const c = Math.hypot(a, b);
  return {l, c, h: c < 1e-6 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360};
}

/**
 * OKLCH to sRGB. Out-of-gamut colors keep lightness and hue and lose chroma
 * until they fit, so saturation boosts never shift hue or clip to white.
 */
export function fromOklch({l, c, h}: Oklch): Rgb {
  const lightness = Math.max(0, Math.min(1, l));
  const radians = h * Math.PI / 180;
  let chroma = Math.max(0, c);
  for (let step = 0; step < 24; step += 1) {
    const raw = rawFromOklab(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians));
    if (raw.every(channel => channel >= -0.0005 && channel <= 1.0005)) break;
    chroma *= 0.88;
  }
  return fromOklab(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians));
}

/** Perceptual interpolation; hue follows the shorter way round. */
export function mixOklch(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  if (t === 0) return from;
  if (t === 1) return to;
  const a = toOklch(from), b = toOklch(to);
  // Near-gray ends borrow the other end's hue so the path does not swing through unrelated hues.
  const ha = a.c < 0.02 ? b.h : a.h;
  const hb = b.c < 0.02 ? a.h : b.h;
  let delta = hb - ha;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return fromOklch({l: a.l + (b.l - a.l) * t, c: a.c + (b.c - a.c) * t, h: (ha + delta * t + 360) % 360});
}

/** WCAG relative luminance. */
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * linearize(color.red) + 0.7152 * linearize(color.green) + 0.0722 * linearize(color.blue);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Pure extremes: for any background one of them reaches 4.5:1.
const DARK_TEXT: Rgb = {red: 0, green: 0, blue: 0};
const LIGHT_TEXT: Rgb = {red: 255, green: 255, blue: 255};

/**
 * Text for a filled surface: keep `preferred` when it already reads (>= 4.5:1),
 * else a tinted near-white or near-black, whichever contrasts more.
 */
export function readableForeground(background: Rgb, preferred?: Rgb, minimum = 4.5): Rgb {
  if (preferred && contrastRatio(preferred, background) >= minimum) return preferred;
  const hue = toOklch(background).h;
  const light = fromOklch({l: 0.97, c: 0.015, h: hue});
  const dark = fromOklch({l: 0.2, c: 0.03, h: hue});
  const best = contrastRatio(light, background) >= contrastRatio(dark, background) ? light : dark;
  return contrastRatio(best, background) >= minimum ? best
    : contrastRatio(LIGHT_TEXT, background) >= contrastRatio(DARK_TEXT, background) ? LIGHT_TEXT : DARK_TEXT;
}

/**
 * `color` made readable on `background` while keeping its hue: lightness moves
 * away from the background until the contrast holds (chroma eases slightly),
 * so a selected row keeps its distinctions instead of turning uniformly white.
 */
export function contrastOn(color: Rgb, background: Rgb, minimum = 4.5): Rgb {
  if (contrastRatio(color, background) >= minimum) return color;
  const lch = toOklch(color);
  const lighten = toOklch(background).l < 0.6;
  for (let step = 1; step <= 24; step += 1) {
    const amount = step / 24;
    const candidate = fromOklch({l: lighten ? lch.l + (0.985 - lch.l) * amount : lch.l * (1 - 0.85 * amount), c: lch.c * (1 - 0.4 * amount), h: lch.h});
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return readableForeground(background, undefined, minimum);
}

/** Soft / Standard / Vibrant: how strongly theme-derived colors separate. Standard is identity. */
export type Vibrance = 'soft' | 'standard' | 'vibrant';
export const VIBRANCE_LEVELS: readonly Vibrance[] = ['soft', 'standard', 'vibrant'];
export const VIBRANCE_LABELS: Record<Vibrance, string> = {soft: 'Soft', standard: 'Standard', vibrant: 'Vibrant'};

export function normalizeVibrance(value: unknown): Vibrance {
  return VIBRANCE_LEVELS.includes(value as Vibrance) ? value as Vibrance : 'standard';
}

/**
 * A segment background under a vibrance level. Hue is always kept. Soft
 * quiets chroma and pulls lightness toward the middle; Vibrant raises chroma
 * and spreads lightness so adjacent modules separate clearly. Near-neutral
 * colors (grayscale themes) only spread in lightness.
 */
export function applyVibrance(color: Rgb, vibrance: Vibrance): Rgb {
  if (vibrance === 'standard') return color;
  const lch = toOklch(color);
  const neutral = lch.c < 0.025;
  if (vibrance === 'soft') {
    return fromOklch({l: 0.62 + (lch.l - 0.62) * 0.7, c: neutral ? lch.c : lch.c * 0.62, h: lch.h});
  }
  // Colors already at the gamut edge (neon) have nothing left to give.
  if (lch.c >= 0.22) return color;
  // Spread lightness away from the middle, never compressing an already extreme color.
  const l = Math.max(Math.min(lch.l, 0.3), Math.min(Math.max(lch.l, 0.86), 0.6 + (lch.l - 0.6) * 1.3));
  return fromOklch({l, c: neutral ? lch.c : Math.max(lch.c, Math.min(0.32, lch.c * 1.45 + 0.03)), h: lch.h});
}

export function hexColor(color: Rgb): string {
  return `#${[color.red, color.green, color.blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function parseHexColor(value: string): Rgb | undefined {
  if (!/^#[0-9a-f]{6}$/iu.test(value)) return undefined;
  return {red: parseInt(value.slice(1, 3), 16), green: parseInt(value.slice(3, 5), 16), blue: parseInt(value.slice(5, 7), 16)};
}
