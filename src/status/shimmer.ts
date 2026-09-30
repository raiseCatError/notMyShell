import {graphemes} from '../input/inputLayout.js';
import {mixRgb} from '../chroma/chroma.js';
import {MOTION_PROFILES, sampleMotion, wrappedPhase} from '../motion/motion.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';

/** Time for the wave to travel one wavelength; independent of text length. */
export const SHIMMER_CYCLE_MS = MOTION_PROFILES.processing.cycleMs;
/** Recent output quickens the wave slightly instead of pulsing the whole line. */
export const ACTIVE_SHIMMER_CYCLE_MS = MOTION_PROFILES.streaming.cycleMs;
/** Glyphs per wavelength: neighbours differ by 1/12 of a cycle. */
export const SHIMMER_WAVELENGTH = MOTION_PROFILES.processing.wavelength!;
/** Luminance stays inside this band so the effect reads as a soft sheen. */
const SHIMMER_FLOOR = 0.12;
const SHIMMER_CEILING = 0.9;

export {wrappedPhase};

/**
 * Per-glyph luminance (0 base … 1 peak) of a smooth wave travelling left to
 * right: the `processing` profile, or `streaming` while output is arriving.
 * The crest advances wavelength/cycle glyphs per millisecond, so a 100 ms
 * frame moves it well under one glyph whatever the text length.
 */
export function shimmerIntensity(elapsedMs: number, glyphIndex: number, _textLength: number, isActive: boolean): number {
  const wave = sampleMotion(MOTION_PROFILES[isActive ? 'streaming' : 'processing'], elapsedMs, glyphIndex);
  return SHIMMER_FLOOR + (SHIMMER_CEILING - SHIMMER_FLOOR) * wave;
}

export const interpolateRgb = mixRgb;

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
