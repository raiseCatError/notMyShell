import {CATPPUCCIN_ACCENTS, CATPPUCCIN_ACCENT_LABELS, accentedVariant, themeVariant, type CatppuccinAccent} from './themeFamilies.js';
import {cloneTheme, PROMPT_THEME_ROLES, type CustomTheme, type PromptThemeRole, type UiThemeRole} from './customTheme.js';
import {categoryOf, findTheme, type ThemeAsset} from './themeLibrary.js';
import {defaultUiColors} from './uiTheme.js';
import {hexColor} from '../chroma/color.js';
import {NATIVE_PALETTE_IDS, THEME_PALETTE_IDS, type NativePaletteId} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';

/**
 * A stable reference to any selectable NMSh theme. Built-ins are referenced by
 * palette id (plus the Catppuccin accent, which changes their colors); library
 * themes by asset id, never by display name:
 *
 *   builtin:gruvboxDark   builtin:catppuccinMocha@peach   asset:t-1a2b3c4d5e6f
 */
export type ThemeRef = string;
export type ParsedThemeRef = {kind: 'builtin'; palette: Exclude<NativePaletteId, 'custom'>; accent?: CatppuccinAccent} | {kind: 'asset'; id: string};

const BUILTIN_IDS = new Set<string>(THEME_PALETTE_IDS.filter(id => id !== 'custom'));

export function parseThemeRef(ref: unknown): ParsedThemeRef | undefined {
  if (typeof ref !== 'string' || ref.length > 80) return undefined;
  const asset = /^asset:([a-z0-9][a-z0-9-]{2,39})$/u.exec(ref);
  if (asset) return {kind: 'asset', id: asset[1]!};
  const builtin = /^builtin:([A-Za-z0-9]+)(?:@([a-z]+))?$/u.exec(ref);
  if (!builtin || !BUILTIN_IDS.has(builtin[1]!)) return undefined;
  const accent = builtin[2];
  if (accent !== undefined && !CATPPUCCIN_ACCENTS.includes(accent as CatppuccinAccent)) return undefined;
  return {kind: 'builtin', palette: builtin[1] as Exclude<NativePaletteId, 'custom'>, ...(accent ? {accent: accent as CatppuccinAccent} : {})};
}

export function builtinRef(palette: Exclude<NativePaletteId, 'custom'>, accent?: CatppuccinAccent): ThemeRef {
  // Only accented families carry the accent, and Mauve is their default.
  return themeVariant(palette)?.accents && accent && accent !== 'mauve' ? `builtin:${palette}@${accent}` : `builtin:${palette}`;
}

export const assetRef = (id: string): ThemeRef => `asset:${id}`;

/** What a library-aware configuration exposes to theme resolution. */
export interface ThemeSource {
  nmsh: {palette: NativePaletteId; accent: CatppuccinAccent; themeId?: string};
  themes: readonly ThemeAsset[];
}

/** The active NMSh theme as a stable reference (what Follow NMSh follows). */
export function activeThemeRef(config: ThemeSource): ThemeRef | undefined {
  if (config.nmsh.palette === 'custom') return config.nmsh.themeId && findTheme(config.themes, config.nmsh.themeId) ? assetRef(config.nmsh.themeId) : undefined;
  return builtinRef(config.nmsh.palette, config.nmsh.accent);
}

const UI_DEFAULTS = (): Record<UiThemeRole, string> => {
  const ui = defaultUiColors();
  return {accent: hexColor(ui.accent), primary: hexColor(ui.primary), secondary: hexColor(ui.secondary), subtle: hexColor(ui.subtle),
    separator: hexColor(ui.separator), selection: hexColor(ui.selection), success: hexColor(ui.success), warning: '#d99a3e',
    failure: hexColor(ui.failure), info: '#4fb3c4'};
};

/**
 * A built-in palette as Native theme data, with the accent applied explicitly
 * (never the live global theme context), so resolution is pure.
 */
export function builtinTheme(palette: Exclude<NativePaletteId, 'custom'>, accent: CatppuccinAccent = 'mauve'): CustomTheme {
  const defaults = UI_DEFAULTS();
  const variant = themeVariant(palette);
  if (variant) {
    const accented = accentedVariant(variant, accent);
    return cloneTheme(accented.label, accented.label, {...accented.roles}, accented.ui, defaults, variant.dark);
  }
  const native = NATIVE_PROMPT_THEMES[palette] ?? NATIVE_PROMPT_THEMES.lavender;
  const prompt = Object.fromEntries(PROMPT_THEME_ROLES.map(role => [role, hexColor(native.colors(role).background)])) as Record<PromptThemeRole, string>;
  return cloneTheme(native.label, native.label, prompt, {accent: defaults.accent, separator: defaults.separator, success: defaults.success, failure: defaults.failure}, defaults, true);
}

export type ThemeResolution = {ok: true; theme: CustomTheme; category: 'builtin' | 'imported' | 'custom'} | {ok: false; reason: 'invalid' | 'missing'};

/** Resolves a reference to theme data. A missing asset is reported, never replaced by another theme. */
export function themeForRef(ref: ThemeRef | undefined, source: Pick<ThemeSource, 'themes'>): ThemeResolution {
  const parsed = parseThemeRef(ref);
  if (!parsed) return {ok: false, reason: 'invalid'};
  if (parsed.kind === 'builtin') return {ok: true, theme: builtinTheme(parsed.palette, parsed.accent), category: 'builtin'};
  const asset = findTheme(source.themes, parsed.id);
  return asset ? {ok: true, theme: structuredClone(asset.theme), category: categoryOf(asset)} : {ok: false, reason: 'missing'};
}

export function themeRefLabel(ref: ThemeRef | undefined, source: Pick<ThemeSource, 'themes'>): string {
  const parsed = parseThemeRef(ref);
  if (!parsed) return '—';
  if (parsed.kind === 'asset') return findTheme(source.themes, parsed.id)?.theme.name ?? 'Missing theme';
  const label = (NATIVE_PROMPT_THEMES[parsed.palette] ?? NATIVE_PROMPT_THEMES.lavender).label;
  return parsed.accent ? `${label} · ${CATPPUCCIN_ACCENT_LABELS[parsed.accent]}` : label;
}

export interface SelectableTheme {ref: ThemeRef; label: string; category: 'builtin' | 'imported' | 'custom'}

/** Every theme a picker can offer: built-ins (default accents), then imported, then custom. */
export function selectableThemes(source: Pick<ThemeSource, 'themes'>): SelectableTheme[] {
  const builtins = THEME_PALETTE_IDS.filter((id): id is Exclude<NativePaletteId, 'custom'> => id !== 'custom')
    .map(palette => ({ref: builtinRef(palette), label: NATIVE_PROMPT_THEMES[palette].label, category: 'builtin' as const}));
  const library = (category: 'imported' | 'custom') => source.themes.filter(asset => categoryOf(asset) === category)
    .map(asset => ({ref: assetRef(asset.id), label: asset.theme.name, category}));
  return [...builtins, ...library('imported'), ...library('custom')];
}

/** NMSh's own (non-family) palettes, for grouping in pickers. */
export const isNativePalette = (palette: NativePaletteId): boolean => NATIVE_PALETTE_IDS.includes(palette);
