import {fromOklch, hexColor, parseHexColor, toOklch} from '../chroma/color.js';
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
 * - Follow theme (default): the active theme's chrome. Lavender Native has its
 *   own tinted chrome (LAVENDER_CHROME); Brand / Semantic keeps the shipped
 *   chrome exactly; other NMSh themes derive chrome from their
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
  /**
   * Theme text: the active theme supplies NMSh-owned text tiers (primary,
   * secondary, muted). Off keeps NMSh's neutral text. Separators, selection
   * and semantic status colors keep their own roles either way.
   */
  themeText?: boolean;
}

export const DEFAULT_UI_CHROME: UiChromeSettings = {source: 'theme', preset: 'lavender', themeText: true};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeUiChrome(value: unknown): UiChromeSettings {
  const v = isRecord(value) ? value : {};
  const colorsValue = isRecord(v.colors) ? v.colors : undefined;
  const colors = colorsValue && UI_THEME_ROLES.every(role => validHex(colorsValue[role]))
    ? Object.fromEntries(UI_THEME_ROLES.map(role => [role, (colorsValue[role] as string).toLowerCase()])) as Record<UiThemeRole, string> : undefined;
  const preset = CHROME_PRESETS.includes(v.preset as ChromePreset) ? v.preset as ChromePreset : 'lavender';
  return {source: CHROME_SOURCES.includes(v.source as ChromeSource) ? v.source as ChromeSource : 'theme',
    preset: preset === 'custom' && !colors ? 'lavender' : preset, ...(colors ? {colors} : {}), themeText: v.themeText !== false};
}

/** Neutral chrome: gray accents and rules; status colors keep their meaning. */
const GRAYSCALE: UiThemeInput = {accent: '#c9cacf', separator: '#76787e', selection: '#45474c', success: '#74b59a', failure: '#cd737b'};

/** Brand / Semantic keeps the original shipped chrome exactly. */
const SHIPPED_CHROME: ReadonlySet<NativePaletteId> = new Set(['brand']);

/**
 * Lavender Native's own chrome: lavender-tinted near-white text tiers and a
 * dark plum selection surface instead of neutral white and slate, an accent
 * closer to the #A67CF3 brand, and unchanged success/failure semantics.
 * Every text tier is at least 4.5:1 on dark lavender surfaces (#2C233A);
 * primary on the selection is 11.5:1.
 */
export const LAVENDER_CHROME: UiThemeInput = {
  primary: '#f1ebff', secondary: '#d8ccf2', subtle: '#a99bc6',
  accent: '#b597f5', separator: '#8b84b2', selection: '#352a47',
  success: '#74b59a', failure: '#cd737b',
};

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
  if (palette === 'lavender') return LAVENDER_CHROME;
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

/**
 * Text tiers for a theme that has no dark-terminal text roles of its own
 * (light variants, NMSh Native themes): readable light tones of the theme's
 * accent hue, in a clear primary → secondary → muted hierarchy.
 */
export function derivedThemeText(accentHex: string): Pick<UiThemeInput, 'primary' | 'secondary' | 'subtle'> {
  const lch = toOklch(parseHexColor(accentHex) ?? {red: 197, green: 185, blue: 232});
  const neutral = lch.c < 0.03;
  const at = (l: number, c: number) => hexColor(fromOklch({l, c: neutral ? 0 : c, h: lch.h}));
  return {primary: at(0.93, 0.022), secondary: at(0.8, 0.04), subtle: at(0.64, 0.045)};
}

/** The chrome to apply for a configuration; undefined means the shipped NMSh chrome. */
export function resolveChrome(chrome: UiChromeSettings, palette: NativePaletteId, accent: CatppuccinAccent, custom: CustomTheme | undefined): UiThemeInput | undefined {
  if (chrome.source === 'custom') {
    if (chrome.preset === 'grayscale') return GRAYSCALE;
    if (chrome.preset === 'custom' && chrome.colors) return chromeFromColors(chrome.colors);
    return LAVENDER_CHROME;
  }
  const input = uiThemeInput(palette, accent, custom) ?? nativeThemeChrome(palette);
  if (!input) return undefined;
  if (chrome.themeText === false) {
    // Theme text Off: NMSh's neutral text tiers; the theme still colors chrome roles.
    const {primary: _primary, secondary: _secondary, subtle: _subtle, ...roles} = input;
    return roles;
  }
  return input.primary ? input : {...input, ...derivedThemeText(input.accent)};
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
