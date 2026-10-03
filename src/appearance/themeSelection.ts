import {NATIVE_PALETTE_IDS, type NativePaletteId, type PromptConfiguration} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES, themeContext} from '../prompt/prompt.js';
import {hexColor} from '../chroma/color.js';
import {accentedVariant, familyVariants, THEME_FAMILIES, themeVariant, type ThemeFamilyId} from './themeFamilies.js';
import {cloneTheme, PROMPT_THEME_ROLES, type CustomTheme, type PromptThemeRole, type UiThemeRole} from './customTheme.js';
import {defaultUiColors, uiThemeInput} from './uiTheme.js';

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
