import type {CursorSettings} from '../prompt/configuration.js';
import {UI_COLORS, type RgbColor} from '../ui/palette.js';
import {COLOR_PRESET_STOPS} from '../chroma/colorPresets.js';
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
export const FIRE_COLORS = ['purple', 'blue', 'green', 'classic', 'theme', 'custom'] as const;
export type FireColor = typeof FIRE_COLORS[number];
export const FIRE_COLOR_LABELS: Record<FireColor, string> = {purple: 'Purple flame', blue: 'Blue flame', green: 'Green flame',
  classic: 'Classic flame', theme: 'Follow theme', custom: 'Custom'};
// Young/hot to old/cool, matching the engine and Ghostty shader's palette direction.
const FIRE_GRADIENTS = {purple: ['#e2c6ff', '#b785f5', '#7944bf', '#31104f'],
  blue: ['#b8f8ff', '#4fdcf5', '#286de0', '#102a66'], green: ['#d0ffd2', '#7ae69c', '#24a46b', '#103d30'],
  classic: DEFAULT_GRADIENTS.fire} as const;

/** The visible preset is derived from the existing particle model; there is no persisted preset flag. */
export function fireColorChoice(settings: CursorSettings): FireColor {
  if (settings.particles.source === 'theme') return 'theme';
  if (settings.particles.source === 'trail' && !settings.particles.colors.length) return 'classic';
  for (const name of ['purple', 'blue', 'green', 'classic'] as const) {
    if (settings.particles.source === 'gradient' && settings.particles.colors.join().toLowerCase() === FIRE_GRADIENTS[name].join()) return name;
  }
  return 'custom';
}

export function applyFireColor(settings: CursorSettings, choice: FireColor): CursorSettings {
  if (choice === 'custom') return settings.particles.source === 'custom' || settings.particles.source === 'gradient' ? settings
    : {...settings, particles: {source: 'gradient', colors: settings.particles.colors.length >= 2 ? [...settings.particles.colors] : [...FIRE_GRADIENTS.purple]}};
  if (choice === 'theme') return {...settings, particles: {...settings.particles, source: 'theme'}};
  return {...settings, particles: {source: 'gradient', colors: [...FIRE_GRADIENTS[choice]]}};
}

export function effectPalette(settings: CursorSettings, accent: RgbColor = UI_COLORS.accent): EffectPalette {
  const caret = settings.color.source === 'custom' && settings.color.custom ? hexToRgb(settings.color.custom)
    : settings.color.source === 'host' ? UI_COLORS.primary : accent;
  // Idle effects borrow the matching movement gradient when there is no movement effect (Flame and Embers read as fire, Sparks as sparks).
  const look: CursorSettings['effect'] = settings.effect !== 'none' ? settings.effect : settings.idleEffect === 'flame' || settings.idleEffect === 'embers' ? 'fire' : settings.idleEffect === 'sparks' ? 'sparks' : 'none';
  const effectGradient = DEFAULT_GRADIENTS[look].map(hexToRgb);
  const trail = settings.trail.source === 'custom' && settings.trail.colors[0] ? [hexToRgb(settings.trail.colors[0])]
    : settings.trail.source === 'gradient' && settings.trail.colors.length ? settings.trail.colors.map(hexToRgb)
    : effectGradient.length && settings.color.source === 'host' ? effectGradient.slice(0, 3) : [caret];
  const scaled = (base: RgbColor) => [1.15, 0.85, 0.5, 0.22].map(scale => ({red: Math.min(255, Math.round(base.red * scale)), green: Math.min(255, Math.round(base.green * scale)), blue: Math.min(255, Math.round(base.blue * scale))}));
  const themeGradient = scaled(caret);
  const particles = settings.particles.source === 'theme' ? themeGradient
    : settings.particles.source === 'custom' && settings.particles.colors[0] ? [hexToRgb(settings.particles.colors[0])]
    : settings.particles.source === 'gradient' && settings.particles.colors.length ? settings.particles.colors.map(hexToRgb)
    : effectGradient.length ? (settings.trail.source === 'cursor' ? effectGradient : trail) : trail;
  // The idle effect: undefined follows the movement effect (as before); otherwise its own colors.
  const source = settings.idleColors?.source ?? 'effect';
  const own = settings.idleColors?.colors ?? [];
  const idle = source === 'effect' ? undefined : source === 'theme' ? scaled(accent)
    : source === 'custom' ? (own.length ? own.map(hexToRgb) : undefined) : COLOR_PRESET_STOPS[source].map(hexToRgb);
  return {caret, trail, particles, ...(idle ? {idle} : {})};
}
