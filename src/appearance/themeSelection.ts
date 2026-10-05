import {NATIVE_PALETTE_IDS, type NativePaletteId, type PromptConfiguration} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES, themeContext} from '../prompt/prompt.js';
import {hexColor} from '../chroma/color.js';
import {accentedVariant, familyVariants, THEME_FAMILIES, themeVariant, type ThemeFamilyId} from './themeFamilies.js';
import {cloneTheme, PROMPT_THEME_ROLES, type CustomTheme, type PromptThemeRole, type UiThemeRole} from './customTheme.js';
import {defaultUiColors, uiThemeInput} from './uiTheme.js';
import {categoryOf, findTheme, libraryCounts} from './themeLibrary.js';

/**
 * Theme family / variant selection over the one stored palette id. NMSh's own
 * themes are the NMSh family; each bundled family has its variants; Custom is
 * the user's theme. Family and variant are derived, never stored separately.
 */
export function familyOf(palette: NativePaletteId): ThemeFamilyId {
  if (palette === 'custom') return 'custom';
  return themeVariant(palette)?.family ?? 'nmsh';
}

export interface VariantOption {id: NativePaletteId; label: string}

export function variantOptions(family: ThemeFamilyId): VariantOption[] {
  if (family === 'nmsh') return NATIVE_PALETTE_IDS.map(id => ({id, label: NATIVE_PROMPT_THEMES[id].label}));
  if (family === 'custom') return [{id: 'custom', label: 'Custom'}];
  return familyVariants(family).map(variant => ({id: variant.id as NativePaletteId, label: variant.variant}));
}

/** The variant a family opens on: the documented default for each family. */
const DEFAULT_VARIANT: Record<ThemeFamilyId, NativePaletteId> = {
  nmsh: 'lavender', catppuccin: 'catppuccinMocha', dracula: 'dracula', tokyonight: 'tokyonightNight', gruvbox: 'gruvboxDark',
  rosepine: 'rosePine', nord: 'nord', solarized: 'solarizedDark', onedark: 'oneDark', custom: 'custom',
};

const UI_DEFAULT_HEX = (): Record<UiThemeRole, string> => {
  const ui = defaultUiColors();
  return {accent: hexColor(ui.accent), primary: hexColor(ui.primary), secondary: hexColor(ui.secondary), subtle: hexColor(ui.subtle),
    separator: hexColor(ui.separator), selection: hexColor(ui.selection), success: hexColor(ui.success), warning: '#d99a3e',
    failure: hexColor(ui.failure), info: '#4fb3c4'};
};

/** A custom theme cloned from any theme's resolved colors (accent applied). */
export function cloneFromPalette(palette: NativePaletteId, accent = themeContext().accent, name?: string): CustomTheme {
  const defaults = UI_DEFAULT_HEX();
  if (palette === 'custom' && themeContext().custom) return structuredClone(themeContext().custom!);
  const theme = NATIVE_PROMPT_THEMES[palette] ?? NATIVE_PROMPT_THEMES.lavender;
  const prompt = Object.fromEntries(PROMPT_THEME_ROLES.map(role => [role, hexColor(theme.colors(role).background)])) as Record<PromptThemeRole, string>;
  const variant = themeVariant(palette);
  const ui = uiThemeInput(palette, accent, undefined) ?? {accent: defaults.accent, separator: defaults.separator, success: defaults.success, failure: defaults.failure};
  const label = variant ? accentedVariant(variant, accent).label : theme.label;
  return cloneTheme(name ?? `My ${label}`.slice(0, 48), label, prompt, ui, defaults, variant ? variant.dark : true);
}

/** The variant a theme family opens on (the same default Settings and Setup use). */
export function defaultVariant(family: ThemeFamilyId): NativePaletteId {
  return DEFAULT_VARIANT[family];
}

/** Choosing a family moves to its default variant; Custom clones the current theme when there is none yet. */
export function selectFamily(config: PromptConfiguration, family: ThemeFamilyId): PromptConfiguration {
  if (family === 'custom') {
    const customTheme = config.customTheme ?? cloneFromPalette(config.nmsh.palette, config.nmsh.accent);
    return {...config, customTheme, nmsh: {...config.nmsh, palette: 'custom'}};
  }
  return {...config, nmsh: {...config.nmsh, palette: DEFAULT_VARIANT[family]}};
}

export const FAMILY_IDS: readonly ThemeFamilyId[] = THEME_FAMILIES.map(family => family.id);
export const FAMILY_LABELS: readonly string[] = THEME_FAMILIES.map(family => family.label);

export function variantLabel(config: PromptConfiguration): string {
  return THEME_FAMILIES.find(family => family.id === familyOf(config.nmsh.palette))?.variantLabel ?? 'Variant';
}

// ---- Library-aware selection (Setup and Settings) -----------------------------

/** Built-in families, then Imported and Custom library themes as their own groups. */
export type SelectionFamily = Exclude<ThemeFamilyId, 'custom'> | 'imported' | 'custom';

export function currentSelectionFamily(config: PromptConfiguration): SelectionFamily {
  if (config.nmsh.palette !== 'custom') return familyOf(config.nmsh.palette) as SelectionFamily;
  const asset = findTheme(config.themes, config.nmsh.themeId);
  return asset ? categoryOf(asset) : 'custom';
}

/** Families offered: every built-in family, plus Imported/Custom when the library has such themes. */
export function selectionFamilies(config: PromptConfiguration): SelectionFamily[] {
  const builtins = FAMILY_IDS.filter((id): id is Exclude<ThemeFamilyId, 'custom'> => id !== 'custom');
  const {imported, custom} = libraryCounts(config.themes);
  return [...builtins, ...(imported ? ['imported' as const] : []), ...(custom ? ['custom' as const] : [])];
}

export function selectionFamilyLabel(family: SelectionFamily): string {
  if (family === 'imported') return 'Imported';
  if (family === 'custom') return 'Custom';
  return THEME_FAMILIES.find(item => item.id === family)?.label ?? family;
}

export interface SelectionVariant {label: string; apply: (config: PromptConfiguration) => PromptConfiguration; current: (config: PromptConfiguration) => boolean}

/** Variants within a family: palette variants for built-ins, library themes (by stable id) for Imported/Custom. */
export function selectionVariants(config: PromptConfiguration, family: SelectionFamily): SelectionVariant[] {
  if (family === 'imported' || family === 'custom') {
    return config.themes.filter(asset => categoryOf(asset) === family).map(asset => ({label: asset.theme.name,
      apply: c => ({...c, nmsh: {...c.nmsh, palette: 'custom', themeId: asset.id}, customTheme: structuredClone(asset.theme)}),
      current: c => c.nmsh.palette === 'custom' && c.nmsh.themeId === asset.id}));
  }
  return variantOptions(family).map(option => ({label: option.label,
    apply: c => ({...c, nmsh: {...c.nmsh, palette: option.id}}), current: c => c.nmsh.palette === option.id}));
}

/** Choosing a family moves to its default variant, or the first library theme of that category. */
export function selectSelectionFamily(config: PromptConfiguration, family: SelectionFamily): PromptConfiguration {
  if (currentSelectionFamily(config) === family) return config;
  if (family === 'imported' || family === 'custom') {
    const first = selectionVariants(config, family)[0];
    return first ? first.apply(config) : config;
  }
  return {...config, nmsh: {...config.nmsh, palette: DEFAULT_VARIANT[family]}};
}
