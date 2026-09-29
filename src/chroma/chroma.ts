import {UI_COLORS} from '../ui/palette.js';
import {colorEscape, type Rgb} from './escape.js';

/**
 * Chroma decides which color a cell gets; UI code decides where cells exist.
 * Three categories stay distinct on purpose:
 * - status: success/failure/working meaning ("did it work?")
 * - theme: presentation colors (text tiers, accent, selection)
 * - identity: a thing's own brand color (e.g. a language). It is never a status.
 * Only NMSh-owned output goes through here; PTY output and /copy never do.
 */
export type StatusRole = 'success' | 'failure' | 'working';
export type ThemeRole = 'primary' | 'secondary' | 'subtle' | 'accent' | 'separator' | 'selection';

export type ColorRef =
  | {kind: 'solid'; rgb: Rgb}
  | {kind: 'status'; role: StatusRole}
  | {kind: 'theme'; role: ThemeRole}
  | {kind: 'identity'; rgb: Rgb};

export const solid = (rgb: Rgb): ColorRef => ({kind: 'solid', rgb});
export const status = (role: StatusRole): ColorRef => ({kind: 'status', role});
export const theme = (role: ThemeRole): ColorRef => ({kind: 'theme', role});
/** A thing's identity color. Carries no success/warning/failure meaning. */
export const identity = (rgb: Rgb): ColorRef => ({kind: 'identity', rgb});

/** The NMSh brand lavender; the default direction, not a hard-coded assumption of the system. */
export const BRAND_LAVENDER: Rgb = {red: 0xA6, green: 0x7C, blue: 0xF3};

const STATUS_COLORS: Record<StatusRole, Rgb> = {success: UI_COLORS.success, failure: UI_COLORS.failure, working: UI_COLORS.workingBase};
const THEME_COLORS: Record<ThemeRole, Rgb> = {
  primary: UI_COLORS.primary, secondary: UI_COLORS.secondary, subtle: UI_COLORS.subtle,
  accent: UI_COLORS.accent, separator: UI_COLORS.separator, selection: UI_COLORS.selection,
};

export function resolveColor(color: ColorRef): Rgb {
  switch (color.kind) {
    case 'solid':
    case 'identity': return color.rgb;
    case 'status': return STATUS_COLORS[color.role];
    case 'theme': return THEME_COLORS[color.role];
  }
}

/** Only status colors mean something about success or failure. */
export function statusMeaning(color: ColorRef): StatusRole | undefined {
  return color.kind === 'status' ? color.role : undefined;
}

// ---- Curves -----------------------------------------------------------------

export type Curve = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

/** Maps 0..1 to 0..1 with the chosen easing; input is clamped. */
export function applyCurve(curve: Curve, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  switch (curve) {
    case 'linear': return t;
    case 'ease-in': return t * t;
    case 'ease-out': return 1 - (1 - t) * (1 - t);
    case 'ease-in-out': return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  }
}

// ---- Gradients --------------------------------------------------------------

export function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return {
    red: Math.round(from.red + (to.red - from.red) * t),
    green: Math.round(from.green + (to.green - from.green) * t),
    blue: Math.round(from.blue + (to.blue - from.blue) * t),
  };
}

export interface GradientStop {
  /** Position 0..1. */
  at: number;
  color: ColorRef;
}
export interface Gradient {
  stops: readonly GradientStop[];
  /** Applied to the position before sampling, e.g. to bias toward one end. */
  curve?: Curve;
}

/** A two-stop gradient from `from` to `to`. */
export function linearGradient(from: ColorRef, to: ColorRef, curve?: Curve): Gradient {
  return {stops: [{at: 0, color: from}, {at: 1, color: to}], curve};
}

/** Color at position 0..1. Stops may be given in any order; positions outside the stops clamp to the ends. */
export function sampleGradient(gradient: Gradient, position: number): Rgb {
  const stops = [...gradient.stops].sort((a, b) => a.at - b.at);
  if (stops.length === 0) throw new Error('A gradient needs at least one stop');
  const t = applyCurve(gradient.curve ?? 'linear', position);
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (t <= first.at) return resolveColor(first.color);
  if (t >= last.at) return resolveColor(last.color);
  for (let index = 1; index < stops.length; index += 1) {
    const upper = stops[index]!;
    if (t <= upper.at) {
      const lower = stops[index - 1]!;
      const span = upper.at - lower.at;
      return mixRgb(resolveColor(lower.color), resolveColor(upper.color), span === 0 ? 1 : (t - lower.at) / span);
    }
  }
  return resolveColor(last.color);
}

/** One color per cell across `count` cells, first cell at 0 and last at 1. */
export function gradientCells(gradient: Gradient, count: number): Rgb[] {
  return Array.from({length: count}, (_, index) => sampleGradient(gradient, count <= 1 ? 0 : index / (count - 1)));
}

/** Perceptual-ish brightness 0..1 (Rec. 709 weights), for choosing readable text on a fill. */
export function luminance(color: Rgb): number {
  return (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255;
}

// ---- Painting ---------------------------------------------------------------

export const foregroundOf = (color: ColorRef): string => colorEscape(38, resolveColor(color));
export const backgroundOf = (color: ColorRef): string => colorEscape(48, resolveColor(color));

/**
 * Text with one foreground color per glyph. Under no-color the result is the
 * plain text, so meaning must never depend on the gradient.
 */
export function gradientText(glyphs: readonly string[], gradient: Gradient): string {
  const colors = gradientCells(gradient, glyphs.length);
  return glyphs.map((glyph, index) => `${colorEscape(38, colors[index]!)}${glyph}`).join('');
}
