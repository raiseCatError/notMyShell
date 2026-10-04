import type {CursorSettings} from '../prompt/configuration.js';
import {UI_COLORS, type RgbColor} from '../ui/palette.js';
import type {EffectPalette} from './CursorEngine.js';

/**
 * Colors for cursor effects. Each effect has a default gradient that reads
 * as itself (fire hot→cool, sparks bright→cool), but none is fixed: the trail
 * and particles follow the caret color, a custom color, or a custom gradient,
 * so purple fire or green sparks are one setting away.
 */
export const hexToRgb = (hex: string): RgbColor => ({red: parseInt(hex.slice(1, 3), 16), green: parseInt(hex.slice(3, 5), 16), blue: parseInt(hex.slice(5, 7), 16)});

const DEFAULT_GRADIENTS: Record<CursorSettings['effect'], string[]> = {
  none: [], fire: ['#ffe08a', '#ff9a3c', '#e8452c', '#5a1a14'], sparks: ['#ffffff', '#9ae6ff', '#4a8cff'],
  lightning: ['#f2f7ff', '#8fb8ff', '#5a5cff'], railgun: ['#e8fbff', '#55d6ff', '#2b6cff'], ripple: [], wireframe: [],
};

/**
 * Palette for a settings value. Theme-derived color sources are resolved
 * beforehand (see colors.ts), so a `custom` color here is already the real
 * selected theme color; a source that was never resolved falls back to NMSh's
 * accent, and Host stands in with the primary text color (the terminal draws
 * its own caret, so Portable effects only borrow a neutral tone).
 */
export function effectPalette(settings: CursorSettings, accent: RgbColor = UI_COLORS.accent): EffectPalette {
  const caret = settings.color.source === 'custom' && settings.color.custom ? hexToRgb(settings.color.custom)
    : settings.color.source === 'host' ? UI_COLORS.primary : accent;
  const effectGradient = DEFAULT_GRADIENTS[settings.effect].map(hexToRgb);
  const trail = settings.trail.source === 'custom' && settings.trail.colors[0] ? [hexToRgb(settings.trail.colors[0])]
    : settings.trail.source === 'gradient' && settings.trail.colors.length ? settings.trail.colors.map(hexToRgb)
    : effectGradient.length && settings.color.source === 'host' ? effectGradient.slice(0, 3) : [caret];
  const particles = settings.particles.source === 'custom' && settings.particles.colors[0] ? [hexToRgb(settings.particles.colors[0])]
    : settings.particles.source === 'gradient' && settings.particles.colors.length ? settings.particles.colors.map(hexToRgb)
    : effectGradient.length ? (settings.trail.source === 'cursor' ? effectGradient : trail) : trail;
  return {caret, trail, particles};
}
