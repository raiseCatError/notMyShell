import {graphemes} from '../input/inputLayout.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';

export const SHIMMER_CYCLE_MS = 1800;
export const BREATH_CYCLE_MS = 2000;

export function wrappedPhase(elapsedMs: number, cycleMs: number): number {
  if (cycleMs <= 0) return 0;
  return ((elapsedMs % cycleMs) + cycleMs) % cycleMs / cycleMs;
}

export function shimmerIntensity(elapsedMs: number, glyphIndex: number, textLength: number, isActive: boolean): number {
  if (isActive) {
    const localPhase = wrappedPhase(elapsedMs, BREATH_CYCLE_MS);
    return (1 - Math.cos(localPhase * Math.PI * 2)) / 2;
  } else {
    const phase = wrappedPhase(elapsedMs, SHIMMER_CYCLE_MS);
    // Right to left narrow crest.
    // The crest moves from textLength + 3 down to -3.
    const crestPosition = (1 - phase) * (textLength + 6) - 3;
    const distance = Math.abs(glyphIndex - crestPosition);
    // Narrow bright crest ~3 characters wide means distance up to 1.5
    return Math.max(0, 1 - distance / 1.5);
  }
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
  const chars = graphemes(text);
  const len = chars.length;
  return chars.map((glyph, index) => {
    const color = interpolateRgb(
      UI_COLORS.workingBase,
      UI_COLORS.workingPeak,
      shimmerIntensity(elapsedMs, index, len, isActive),
    );
    return `${foreground(color)}${glyph}`;
  }).join('');
}
