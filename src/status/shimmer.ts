import {graphemes} from '../input/inputLayout.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';

/** Time for the wave to travel one wavelength; independent of text length. */
export const SHIMMER_CYCLE_MS = 1800;
/** Recent output quickens the wave slightly instead of pulsing the whole line. */
export const ACTIVE_SHIMMER_CYCLE_MS = 1200;
/** Glyphs per wavelength: neighbours differ by 1/12 of a cycle. */
export const SHIMMER_WAVELENGTH = 12;
/** Luminance stays inside this band so the effect reads as a soft sheen. */
const SHIMMER_FLOOR = 0.12;
const SHIMMER_CEILING = 0.9;

export function wrappedPhase(elapsedMs: number, cycleMs: number): number {
  if (cycleMs <= 0) return 0;
  return ((elapsedMs % cycleMs) + cycleMs) % cycleMs / cycleMs;
}

/**
 * Per-glyph luminance (0 base … 1 peak) of a smooth wave travelling left to
 * right. Each glyph is phase-shifted from its neighbour by 1/wavelength, and
 * the crest advances wavelength/cycle glyphs per millisecond, so a 100 ms
 * frame moves it well under one glyph whatever the text length.
 */
export function shimmerIntensity(elapsedMs: number, glyphIndex: number, _textLength: number, isActive: boolean): number {
  const phase = wrappedPhase(elapsedMs, isActive ? ACTIVE_SHIMMER_CYCLE_MS : SHIMMER_CYCLE_MS);
  const wave = (1 + Math.cos(2 * Math.PI * (glyphIndex / SHIMMER_WAVELENGTH - phase))) / 2;
  return SHIMMER_FLOOR + (SHIMMER_CEILING - SHIMMER_FLOOR) * wave;
}

export function interpolateRgb(from: RgbColor, to: RgbColor, amount: number): RgbColor {
  const clamped = Math.max(0, Math.min(1, amount));
  return {
    red: Math.round(from.red + (to.red - from.red) * clamped),
    green: Math.round(from.green + (to.green - from.green) * clamped),
    blue: Math.round(from.blue + (to.blue - from.blue) * clamped),
  };
}

export function shimmerText(text: string, elapsedMs: number, isActive: boolean): string {
  return shimmerTextWithColors(text, elapsedMs, isActive, UI_COLORS.workingBase, UI_COLORS.workingPeak);
}

export function shimmerTextWithColors(text: string, elapsedMs: number, isActive: boolean, base: RgbColor, peak: RgbColor): string {
  const chars = graphemes(text);
  const len = chars.length;
  return chars.map((glyph, index) => {
    const color = interpolateRgb(
      base,
      peak,
      shimmerIntensity(elapsedMs, index, len, isActive),
    );
    return `${foreground(color)}${glyph}`;
  }).join('');
}
