import {mixRgb, resolveColor, sampleGradient, solid, theme, BRAND_LAVENDER, type ColorRef} from './chroma.js';
import {colorEscape, type Rgb} from './escape.js';
import {colorLevel, type ColorLevel} from '../presentation/capabilities.js';
import {isReducedMotion} from '../presentation/environment.js';
import {sampleMotion} from '../motion/motion.js';
import {graphemes} from '../input/inputLayout.js';
import {displayWidth} from '../util/text.js';

export const TREATMENT_PRESETS = ['off', 'lavender', 'aurora', 'theme', 'custom'] as const;
export const TREATMENT_GEOMETRIES = ['linear', 'center-out', 'outside-in'] as const;
export const TREATMENT_MOTIONS = ['static', 'travel', 'breathe'] as const;
export type TreatmentRole = 'native-identity' | 'divider' | 'panel-frame' | 'effect' | 'status' | 'focus' | 'raw' | 'provider';
const ELIGIBLE = new Set<TreatmentRole>(['native-identity', 'divider', 'panel-frame', 'effect']);

export interface TreatmentSettings {
  preset: typeof TREATMENT_PRESETS[number];
  geometry: typeof TREATMENT_GEOMETRIES[number];
  motion: typeof TREATMENT_MOTIONS[number];
  intensity: number;
  customStops: string[];
  reducedMotion: boolean;
  effectsOff: boolean;
}
export const DEFAULT_TREATMENT_SETTINGS: TreatmentSettings = {
  preset: 'off', geometry: 'linear', motion: 'static', intensity: 0.65,
  customStops: [], reducedMotion: false, effectsOff: false,
};

/** Additive, declarative configuration: no code or transient state. */
export function normalizeTreatmentSettings(value: unknown): TreatmentSettings {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const customStops = Array.isArray(v.customStops) && v.customStops.length >= 2 && v.customStops.length <= 8
    && v.customStops.every(stop => typeof stop === 'string' && /^#[0-9a-f]{6}$/iu.test(stop)) ? [...v.customStops] as string[] : [];
  const preset = TREATMENT_PRESETS.includes(v.preset as TreatmentSettings['preset']) ? v.preset as TreatmentSettings['preset'] : 'off';
  return {
    preset: preset === 'custom' && !customStops.length ? 'off' : preset,
    geometry: TREATMENT_GEOMETRIES.includes(v.geometry as TreatmentSettings['geometry']) ? v.geometry as TreatmentSettings['geometry'] : 'linear',
    motion: TREATMENT_MOTIONS.includes(v.motion as TreatmentSettings['motion']) ? v.motion as TreatmentSettings['motion'] : 'static',
    intensity: typeof v.intensity === 'number' && Number.isFinite(v.intensity) ? Math.max(0, Math.min(1, v.intensity)) : 0.65,
    customStops, reducedMotion: v.reducedMotion === true, effectsOff: v.effectsOff === true,
  };
}

export interface Treatment {
  stops: readonly ColorRef[];
  geometry: TreatmentSettings['geometry'];
  motion: TreatmentSettings['motion'];
  intensity: number;
}
export interface TreatmentContext {
  role: TreatmentRole;
  base: Rgb;
  reducedMotion?: boolean;
  effectsOff?: boolean;
  level?: ColorLevel;
}
export function treatmentFor(settings: TreatmentSettings): Treatment | undefined {
  const hex = (value: string): ColorRef => solid({red: parseInt(value.slice(1, 3), 16), green: parseInt(value.slice(3, 5), 16), blue: parseInt(value.slice(5, 7), 16)});
  const palettes: Record<Exclude<TreatmentSettings['preset'], 'off'>, readonly ColorRef[]> = {
    lavender: [solid(BRAND_LAVENDER), hex('#C5A4FA'), hex('#9979D9')],
    aurora: [hex('#B597F4'), hex('#DA9FC8'), hex('#91B5A4')],
    theme: [theme('accent'), theme('primary'), theme('secondary')], custom: settings.customStops.map(hex),
  };
  return settings.preset === 'off' ? undefined : {...settings, stops: palettes[settings.preset]};
}

/** Pure cell sampling. Columns are display columns, time is supplied by the owner. */
export function sampleTreatment(treatment: Treatment, context: TreatmentContext & {column: number; width: number}, time: number): Rgb {
  if (!ELIGIBLE.has(context.role) || treatment.stops.length === 0) return context.base;
  let position = context.width <= 1 ? 0 : Math.max(0, Math.min(1, context.column / (context.width - 1)));
  if (treatment.geometry === 'center-out') position = Math.abs(2 * position - 1);
  if (treatment.geometry === 'outside-in') position = 1 - Math.abs(2 * position - 1);
  const motion = context.reducedMotion || context.effectsOff ? 'static' : treatment.motion;
  if (motion === 'travel') position = (position + ((time % 6000) + 6000) % 6000 / 6000) % 1;
  const intensity = treatment.intensity * (motion === 'breathe'
    ? 0.65 + 0.35 * sampleMotion({shape: 'sine', spread: 'uniform', cycleMs: 4000, repeat: true}, time, 0, {reduced: false}) : 1);
  const stops = treatment.stops.map((color, index) => ({color, at: treatment.stops.length <= 1 ? 0 : index / (treatment.stops.length - 1)}));
  return mixRgb(context.base, sampleGradient({stops}, position), Math.max(0, Math.min(1, intensity)));
}

/** Takes owned plain content only; never strip/repaint provider or PTY ANSI. */
export function treatmentText(text: string, treatment: Treatment, context: TreatmentContext, time: number): string {
  const level = context.level ?? colorLevel();
  if (level === 'none' || !ELIGIBLE.has(context.role)) return text;
  const width = displayWidth(text);
  let column = 0;
  return graphemes(text).map(glyph => {
    const color = sampleTreatment(treatment, {...context, column, width}, time);
    column += displayWidth(glyph);
    return `${colorEscape(38, color, level)}${glyph}`;
  }).join('') + '\u001B[39m';
}

export function paintTreatment(text: string, settings: TreatmentSettings, role: TreatmentRole, base: Rgb, time = 0): string {
  const treatment = treatmentFor(settings);
  return treatment ? treatmentText(text, treatment, {role, base, reducedMotion: settings.reducedMotion || isReducedMotion(), effectsOff: settings.effectsOff}, time)
    : `${colorEscape(38, base)}${text}`;
}
