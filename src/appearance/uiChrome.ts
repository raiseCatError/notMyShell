import {fromOklch, hexColor, toOklch} from '../chroma/color.js';
import type {Rgb} from '../chroma/escape.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import type {NativePaletteId} from '../prompt/configuration.js';
import {UI_THEME_ROLES, validHex, type CustomTheme, type UiThemeRole} from './customTheme.js';
import type {CatppuccinAccent} from './themeFamilies.js';
import {defaultUiColors, uiThemeInput, type UiThemeInput} from './uiTheme.js';

/**
 * UI chrome: the colors of NMSh-owned frames, rules, tabs, selection, focus
 * accents and markers. One setting decides where they come from:
 *
 * - Follow theme (default): the active theme's chrome. Lavender Native keeps
 *   the shipped chrome exactly; other NMSh themes derive chrome from their
 *   own module colors; bundled families and custom themes use their UI roles.
 * - Custom: a preset (Native Lavender, Grayscale) or the user's own colors.
 *
 * Chroma never paints UI chrome; only the Native prompt and explicitly
 * Chroma-aware surfaces use it.
 */
export const CHROME_SOURCES = ['theme', 'custom'] as const;
export type ChromeSource = typeof CHROME_SOURCES[number];
export const CHROME_PRESETS = ['lavender', 'grayscale', 'custom'] as const;
export type ChromePreset = typeof CHROME_PRESETS[number];
export const CHROME_PRESET_LABELS: Record<ChromePreset, string> = {lavender: 'Native Lavender', grayscale: 'Grayscale', custom: 'Custom colors'};

export interface UiChromeSettings {
  source: ChromeSource;
  preset: ChromePreset;
  /** Used with preset `custom`; kept when another preset is chosen. */
  colors?: Record<UiThemeRole, string>;
}

export const DEFAULT_UI_CHROME: UiChromeSettings = {source: 'theme', preset: 'lavender'};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeUiChrome(value: unknown): UiChromeSettings {
  const v = isRecord(value) ? value : {};
  const colorsValue = isRecord(v.colors) ? v.colors : undefined;
  const colors = colorsValue && UI_THEME_ROLES.every(role => validHex(colorsValue[role]))
    ? Object.fromEntries(UI_THEME_ROLES.map(role => [role, (colorsValue[role] as string).toLowerCase()])) as Record<UiThemeRole, string> : undefined;
  const preset = CHROME_PRESETS.includes(v.preset as ChromePreset) ? v.preset as ChromePreset : 'lavender';
  return {source: CHROME_SOURCES.includes(v.source as ChromeSource) ? v.source as ChromeSource : 'theme',
    preset: preset === 'custom' && !colors ? 'lavender' : preset, ...(colors ? {colors} : {})};
}

/** Neutral chrome: gray accents and rules; status colors keep their meaning. */
const GRAYSCALE: UiThemeInput = {accent: '#c9cacf', separator: '#76787e', selection: '#45474c', success: '#74b59a', failure: '#cd737b'};

/** Shipped chrome themes: NMSh's own lavender themes keep the original chrome exactly. */
const SHIPPED_CHROME: ReadonlySet<NativePaletteId> = new Set(['lavender', 'brand']);

const tone = (color: Rgb, l: number, minChroma: number, maxChroma = 0.2) => {
  const lch = toOklch(color);
  return hexColor(fromOklch({l, c: Math.max(minChroma, Math.min(maxChroma, lch.c)), h: lch.h}));
};

/**
 * Chrome for an NMSh Native theme from its own module colors: the project
 * color becomes the accent, rules and selection take that hue in quieter
 * tones, and status keeps the theme's success and failure.
 */
export function nativeThemeChrome(palette: NativePaletteId): UiThemeInput | undefined {
  if (SHIPPED_CHROME.has(palette)) return undefined;
  const theme = NATIVE_PROMPT_THEMES[palette];
  if (!theme) return undefined;
  const accent = theme.colors('project').background;
  const neutral = toOklch(accent).c < 0.03;
  return {
    accent: tone(accent, 0.76, neutral ? 0 : 0.09),
    separator: tone(accent, 0.55, neutral ? 0 : 0.05, 0.08),
    selection: tone(accent, 0.34, neutral ? 0 : 0.05, 0.09),
    success: tone(theme.colors('success').background, 0.72, 0.06),
    failure: tone(theme.colors('failure').background, 0.66, 0.08),
  };
}

export function chromeFromColors(colors: Record<UiThemeRole, string>): UiThemeInput {
  return {accent: colors.accent, separator: colors.separator, success: colors.success, failure: colors.failure,
    primary: colors.primary, secondary: colors.secondary, subtle: colors.subtle, selection: colors.selection};
}

/** The chrome to apply for a configuration; undefined means the shipped NMSh chrome. */
export function resolveChrome(chrome: UiChromeSettings, palette: NativePaletteId, accent: CatppuccinAccent, custom: CustomTheme | undefined): UiThemeInput | undefined {
  if (chrome.source === 'custom') {
    if (chrome.preset === 'grayscale') return GRAYSCALE;
    if (chrome.preset === 'custom' && chrome.colors) return chromeFromColors(chrome.colors);
    return undefined;
  }
  return uiThemeInput(palette, accent, custom) ?? nativeThemeChrome(palette);
}

/** Editable starting colors for Custom chrome: whatever chrome is in effect now. */
export function chromeColorsFrom(input: UiThemeInput | undefined): Record<UiThemeRole, string> {
  const ui = defaultUiColors();
  const base: Record<UiThemeRole, string> = {accent: hexColor(ui.accent), primary: hexColor(ui.primary), secondary: hexColor(ui.secondary),
    subtle: hexColor(ui.subtle), separator: hexColor(ui.separator), selection: hexColor(ui.selection), success: hexColor(ui.success),
    warning: '#d99a3e', failure: hexColor(ui.failure), info: '#4fb3c4'};
  if (!input) return base;
  return {...base, accent: input.accent, separator: input.separator, success: input.success, failure: input.failure,
    ...(input.primary ? {primary: input.primary} : {}), ...(input.secondary ? {secondary: input.secondary} : {}),
    ...(input.subtle ? {subtle: input.subtle} : {}), ...(input.selection ? {selection: input.selection} : {})};
}
