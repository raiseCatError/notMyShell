import {applyCurve, mixRgb, sampleGradient, solid, theme, type ColorRef, type Curve} from './chroma.js';
import {colorEscape, type Rgb} from './escape.js';
import {fromOklch, mixOklch, parseHexColor, toOklch} from './color.js';
import {colorLevel, type ColorLevel} from '../presentation/capabilities.js';
import {isReducedMotion} from '../presentation/environment.js';
import {wrappedPhase} from '../motion/motion.js';
import {graphemes} from '../input/inputLayout.js';
import {displayWidth} from '../util/text.js';

/** `theme` is "Current Theme": stops derived from the active Native prompt theme. */
export const TREATMENT_PRESETS = ['off', 'lavender', 'aurora', 'theme', 'rainbow', 'nebula', 'blackhole', 'warm', 'cool', 'monochrome', 'custom'] as const;
export const TREATMENT_PRESET_LABELS: Record<typeof TREATMENT_PRESETS[number], string> = {
  off: 'Off', lavender: 'Lavender', aurora: 'Aurora', theme: 'Current Theme', rainbow: 'Rainbow', nebula: 'Nebula',
  blackhole: 'Black Hole', warm: 'Warm', cool: 'Cool', monochrome: 'Monochrome', custom: 'Custom',
};
export const TREATMENT_GEOMETRIES = ['linear', 'center-out', 'outside-in'] as const;
export const TREATMENT_GEOMETRY_LABELS: Record<typeof TREATMENT_GEOMETRIES[number], string> = {
  linear: 'Left → Right', 'center-out': 'Center → Outward', 'outside-in': 'Outside → Center',
};
export const TREATMENT_MOTIONS = ['static', 'breathe', 'comet', 'pulse', 'travel'] as const;
export const TREATMENT_MOTION_LABELS: Record<typeof TREATMENT_MOTIONS[number], string> = {
  static: 'Static', travel: 'Travel', breathe: 'Breathe', comet: 'Comet', pulse: 'Pulse',
};
export const TREATMENT_SPEEDS = ['very-slow', 'slow', 'normal', 'fast'] as const;
export const TREATMENT_SPEED_LABELS: Record<typeof TREATMENT_SPEEDS[number], string> = {
  'very-slow': 'Very Slow', slow: 'Slow', normal: 'Normal', fast: 'Fast',
};
export const TREATMENT_CURVES: readonly Curve[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];
export const TREATMENT_CURVE_LABELS: Record<Curve, string> = {linear: 'Linear', 'ease-in': 'Ease In', 'ease-out': 'Ease Out', 'ease-in-out': 'Ease In-Out'};
export const TREATMENT_DIRECTIONS = ['forward', 'reverse'] as const;
/** Identity: project, path and toolchains. Prompt: every module except protected status/Git-state meaning. */
export const TREATMENT_SCOPES = ['identity', 'prompt'] as const;
export const TREATMENT_SCOPE_LABELS: Record<typeof TREATMENT_SCOPES[number], string> = {identity: 'Identity modules', prompt: 'Whole prompt'};
/** Palette influence is stored as intensity, so pre-v2 values (0.65 default) keep their exact look. */
export const TREATMENT_INFLUENCES = [
  {id: 'theme-aware', label: 'Theme-aware', intensity: 0.35},
  {id: 'mixed', label: 'Mixed', intensity: 0.65},
  {id: 'full', label: 'Full Chroma', intensity: 0.9},
] as const;
export type TreatmentInfluence = typeof TREATMENT_INFLUENCES[number]['id'];

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
  /** Animation cycle length; Normal is the pre-v2 timing. */
  speed?: typeof TREATMENT_SPEEDS[number];
  /** Easing of the animation phase. */
  curve?: Curve;
  /** Travel and Comet only: which way the color moves. */
  direction?: typeof TREATMENT_DIRECTIONS[number];
  scope?: typeof TREATMENT_SCOPES[number];
  /** Explicit per-module colors are authoritative unless this is on. */
  customColors?: boolean;
  /** Restrained automatic effects on real milestones (install, update, onboarding). */
  autoEffects?: boolean;
  /**
   * Semantic module colors (success, failure, Git state): Preserve keeps their
   * meaning colors; Override lets Chroma recolor them too (text, symbols and
   * contrast correction still carry the meaning).
   */
  semantic?: typeof SEMANTIC_MODES[number];
  /** Where Chroma paints besides the Native prompt: `rules` adds composer and history rules. */
  rules?: boolean;
  /** The event-driven light sweep (selection, value change, submit, confirmation, live working text). */
  shimmer?: 'on' | 'off';
}

export const SEMANTIC_MODES = ['preserve', 'override'] as const;
export const SEMANTIC_MODE_LABELS: Record<typeof SEMANTIC_MODES[number], string> = {preserve: 'Preserve', override: 'Override'};

/** Full Chroma is the default influence; saved influences load unchanged. */
export const DEFAULT_INTENSITY = 0.9;

export const DEFAULT_TREATMENT_SETTINGS: TreatmentSettings = {
  preset: 'off', geometry: 'linear', motion: 'static', intensity: DEFAULT_INTENSITY, semantic: 'override', rules: false,
  shimmer: 'on',
  customStops: [], reducedMotion: false, effectsOff: false,
  speed: 'normal', curve: 'linear', direction: 'forward', scope: 'identity', customColors: false, autoEffects: true,
};

export const MIN_CUSTOM_STOPS = 2;
export const MAX_CUSTOM_STOPS = 8;

const pick = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => values.includes(value as T) ? value as T : fallback;

export function validCustomStops(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= MIN_CUSTOM_STOPS && value.length <= MAX_CUSTOM_STOPS
    && value.every(stop => typeof stop === 'string' && /^#[0-9a-f]{6}$/iu.test(stop));
}

/** Additive, declarative configuration: no code or transient state. */
export function normalizeTreatmentSettings(value: unknown): TreatmentSettings {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const customStops = validCustomStops(v.customStops) ? v.customStops.map(stop => stop.toLowerCase()) : [];
  const preset = pick(TREATMENT_PRESETS, v.preset, 'off');
  const intensity = typeof v.intensity === 'number' && Number.isFinite(v.intensity) ? Math.max(0, Math.min(1, v.intensity)) : DEFAULT_INTENSITY;
  // An explicit semantic choice is kept; otherwise Full Chroma overrides and gentler influences preserve.
  const semantic = pick(SEMANTIC_MODES, v.semantic, treatmentInfluence({intensity}) === 'full' ? 'override' : 'preserve');
  return {
    semantic, rules: v.rules === true,
    shimmer: v.shimmer === 'off' ? 'off' : 'on',
    preset: preset === 'custom' && !customStops.length ? 'off' : preset,
    geometry: pick(TREATMENT_GEOMETRIES, v.geometry, 'linear'),
    motion: pick(TREATMENT_MOTIONS, v.motion, 'static'),
    intensity,
    customStops, reducedMotion: v.reducedMotion === true, effectsOff: v.effectsOff === true,
    speed: pick(TREATMENT_SPEEDS, v.speed, 'normal'),
    curve: pick(TREATMENT_CURVES, v.curve, 'linear'),
    direction: pick(TREATMENT_DIRECTIONS, v.direction, 'forward'),
    scope: pick(TREATMENT_SCOPES, v.scope, 'identity'),
    customColors: v.customColors === true,
    autoEffects: v.autoEffects !== false,
  };
}

/** The influence step nearest the stored intensity. */
export function treatmentInfluence(settings: Pick<TreatmentSettings, 'intensity'>): TreatmentInfluence {
  return TREATMENT_INFLUENCES.reduce((best, entry) =>
    Math.abs(entry.intensity - settings.intensity) < Math.abs(best.intensity - settings.intensity) ? entry : best).id;
}

/** Whether the selected motion uses Direction (only moving crests have one). */
export function motionHasDirection(motion: TreatmentSettings['motion']): boolean {
  return motion === 'travel' || motion === 'comet';
}

export interface Treatment {
  stops: readonly ColorRef[];
  geometry: TreatmentSettings['geometry'];
  motion: TreatmentSettings['motion'];
  intensity: number;
  speed?: TreatmentSettings['speed'];
  curve?: Curve;
  direction?: TreatmentSettings['direction'];
  /**
   * Current Theme on prompt cells: every cell keeps its own hue and the
   * sweep varies lightness and chroma, so the theme stays recognizable.
   */
  own?: boolean;
}
export interface TreatmentContext {
  role: TreatmentRole;
  base: Rgb;
  reducedMotion?: boolean;
  effectsOff?: boolean;
  level?: ColorLevel;
}

const hex = (value: string): ColorRef => solid(parseHexColor(value) ?? {red: 0, green: 0, blue: 0});

/**
 * Each preset is its own palette family, designed to be told apart at a
 * glance: Lavender stays within violet; Aurora sweeps green → cyan → violet;
 * Black Hole runs from a deep violet core to a hot accretion rim.
 */
export const PRESET_STOPS: Readonly<Record<Exclude<TreatmentSettings['preset'], 'off' | 'theme' | 'custom'>, readonly string[]>> = {
  lavender: ['#a67cf3', '#c5a4fa', '#9979d9'],
  aurora: ['#3ee8b5', '#45b8f0', '#8f6cf5', '#e46cc8'],
  rainbow: ['#ff5f6d', '#ffa647', '#f2e35b', '#5be584', '#4fb8f7', '#9575f0'],
  nebula: ['#7b2fbf', '#c2389e', '#5a4ff0', '#3fc2f0'],
  blackhole: ['#3d1f6e', '#7a2a8c', '#e0566b', '#ffb36b'],
  warm: ['#e8573c', '#f29e4c', '#f1c453', '#d9486b'],
  cool: ['#2ec4b6', '#3a86ff', '#5e60ce', '#48bfe3'],
  monochrome: ['#6a6e78', '#d4d7dd', '#f4f5f7', '#9a9ea8'],
};

/**
 * Current Theme stops for surfaces without prompt context (dividers, panel
 * frames). The app keeps them in step with the active Native theme.
 */
let activeThemeStops: readonly Rgb[] | undefined;
export function setActiveThemeStops(stops: readonly Rgb[] | undefined): void {
  activeThemeStops = stops && stops.length ? [...stops] : undefined;
}

/** `themeStops` overrides the active theme stops (a preview of another theme, a prompt's own colors). */
export function treatmentFor(settings: TreatmentSettings, themeStops?: readonly Rgb[]): Treatment | undefined {
  if (settings.preset === 'off') return undefined;
  const themed = themeStops?.length ? themeStops : activeThemeStops;
  const stops: readonly ColorRef[] = settings.preset === 'custom' ? settings.customStops.map(hex)
    : settings.preset === 'theme' ? (themed?.length ? themed.map(solid) : [theme('accent'), theme('primary'), theme('secondary')])
      : PRESET_STOPS[settings.preset].map(hex);
  if (!stops.length) return undefined;
  return {stops, geometry: settings.geometry, motion: settings.motion, intensity: settings.intensity,
    speed: settings.speed, curve: settings.curve, direction: settings.direction};
}

/** Cycle lengths at Normal speed; travel and breathe are the pre-v2 timings. */
const MOTION_CYCLE_MS: Record<Exclude<TreatmentSettings['motion'], 'static'>, number> = {travel: 6000, breathe: 4000, comet: 5000, pulse: 3200};
const SPEED_FACTOR: Record<NonNullable<TreatmentSettings['speed']>, number> = {'very-slow': 2, slow: 1.5, normal: 1, fast: 0.5};

export function motionCycleMs(motion: TreatmentSettings['motion'], speed: TreatmentSettings['speed'] = 'normal'): number {
  return motion === 'static' ? 0 : MOTION_CYCLE_MS[motion] * SPEED_FACTOR[speed];
}

/** Gradient position and intensity factor at one cell and time; pure. */
function animate(treatment: Treatment, position: number, time: number, still: boolean): {position: number; factor: number} {
  const motion = still ? 'static' : treatment.motion;
  if (motion === 'static') return {position, factor: 1};
  const phase = applyCurve(treatment.curve ?? 'linear', wrappedPhase(time, motionCycleMs(motion, treatment.speed)));
  const signed = treatment.direction === 'reverse' ? -phase : phase;
  switch (motion) {
    case 'travel': {
      // The gradient flows as a seamless loop (out and back, so the last stop never snaps to the first),
      // with a gentle brightness crest riding along so the movement reads even across few cells.
      const flowing = ((position + signed) % 1 + 1) % 1;
      const loop = 1 - Math.abs(2 * flowing - 1);
      return {position: loop, factor: 0.85 + 0.15 * (1 + Math.cos(2 * Math.PI * flowing)) / 2};
    }
    case 'breathe': return {position, factor: 0.65 + 0.35 * (1 + Math.cos(2 * Math.PI * phase)) / 2};
    case 'comet': {
      // A bright crest sweeps across; cells away from it settle to a quieter base.
      const crest = (signed % 1 + 1) % 1;
      const distance = Math.min(Math.abs(position - crest), 1 - Math.abs(position - crest));
      return {position, factor: 0.5 + 0.5 * Math.max(0, 1 - distance / 0.22)};
    }
    case 'pulse': {
      const wave = phase < 0.25 ? applyCurve('ease-out', phase / 0.25) : 1 - applyCurve('ease-in-out', (phase - 0.25) / 0.75);
      return {position, factor: 0.6 + 0.4 * wave};
    }
  }
}

function geometryPosition(geometry: Treatment['geometry'], position: number): number {
  if (geometry === 'center-out') return Math.abs(2 * position - 1);
  if (geometry === 'outside-in') return 1 - Math.abs(2 * position - 1);
  return position;
}

function stopsGradient(treatment: Treatment) {
  return {stops: treatment.stops.map((color, index) => ({color, at: treatment.stops.length <= 1 ? 0 : index / (treatment.stops.length - 1)}))};
}

/** Pure cell sampling. Columns are display columns, time is supplied by the owner. */
export function sampleTreatment(treatment: Treatment, context: TreatmentContext & {column: number; width: number}, time: number): Rgb {
  if (!ELIGIBLE.has(context.role) || treatment.stops.length === 0) return context.base;
  const raw = context.width <= 1 ? 0 : Math.max(0, Math.min(1, context.column / (context.width - 1)));
  const animated = animate(treatment, geometryPosition(treatment.geometry, raw), time, Boolean(context.reducedMotion || context.effectsOff));
  return mixRgb(context.base, sampleGradient(stopsGradient(treatment), animated.position),
    Math.max(0, Math.min(1, treatment.intensity * animated.factor)));
}

/**
 * The treated color of a prompt cell at `position` (0..1 along the prompt).
 * Perceptual blend of the cell's own color toward the gradient, so theme
 * hue identity survives at Theme-aware and Mixed influence.
 */
export function samplePromptTreatment(treatment: Treatment, base: Rgb, position: number, time: number, still: boolean): Rgb {
  if (!treatment.stops.length) return base;
  const animated = animate(treatment, geometryPosition(treatment.geometry, Math.max(0, Math.min(1, position))), time, still);
  if (treatment.own) {
    // A lightness/chroma wave over the cell's own color: never another hue, never toward white.
    const lch = toOklch(base);
    const wave = Math.cos(2 * Math.PI * animated.position);
    const target = fromOklch({l: Math.max(0.25, Math.min(0.78, lch.l + 0.13 * wave)), c: lch.c < 0.02 ? lch.c : lch.c * (1.15 + 0.25 * wave) + 0.02, h: lch.h});
    return mixOklch(base, target, Math.max(0, Math.min(1, treatment.intensity * animated.factor)));
  }
  const target = sampleGradient(stopsGradient(treatment), animated.position);
  return mixOklch(base, target, Math.max(0, Math.min(1, treatment.intensity * animated.factor)));
}

/**
 * Text on an unknown, usually dark, terminal background: keep hue, hold a
 * lightness floor so treated text never sinks into the background.
 */
export function readableTextTone(color: Rgb): Rgb {
  const lch = toOklch(color);
  return lch.l >= 0.68 ? color : fromOklch({...lch, l: 0.68});
}

/** Whether a treatment animates (and so needs presentation frames). */
export function treatmentAnimated(settings: TreatmentSettings): boolean {
  return settings.preset !== 'off' && settings.motion !== 'static' && !settings.reducedMotion && !settings.effectsOff && !isReducedMotion();
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

/** Preview swatch: the preset's own gradient across `width` cells. */
export function treatmentSwatch(settings: TreatmentSettings, width: number, themeStops?: readonly Rgb[], glyph = '█'): string {
  const treatment = treatmentFor({...settings, intensity: 1, motion: 'static'}, themeStops);
  if (!treatment) return '';
  return Array.from({length: Math.max(1, width)}, (_, index) =>
    `${colorEscape(38, sampleGradient(stopsGradient(treatment), width <= 1 ? 0 : index / (width - 1)))}${glyph}`).join('') + '\u001B[39m';
}
