import {UI_COLORS, type RgbColor} from '../ui/palette.js';
import {mixRgb} from '../chroma/chroma.js';
import {parseHexColor, readableForeground} from '../chroma/color.js';
import {accentedVariant, themeVariant, type CatppuccinAccent} from './themeFamilies.js';
import type {CustomTheme} from './customTheme.js';
import type {NativePaletteId} from '../prompt/configuration.js';

/**
 * NMSh chrome colors (accent, rules, selection, status, text tiers) for the
 * active theme. NMSh's own themes keep the shipped lavender chrome, so
 * existing users see no change. Bundled families and custom themes recolor
 * NMSh-owned UI only; the terminal window, editor and host stay untouched.
 */
type UiKey = keyof typeof UI_COLORS;
const DEFAULTS: Record<UiKey, RgbColor> = Object.fromEntries(Object.entries(UI_COLORS).map(([key, value]) => [key, {...value}])) as Record<UiKey, RgbColor>;
const WHITE: RgbColor = {red: 255, green: 255, blue: 255};
const BLACK: RgbColor = {red: 0, green: 0, blue: 0};

export interface UiThemeInput {
  accent: string; separator: string; success: string; failure: string;
  primary?: string; secondary?: string; subtle?: string; selection?: string;
}

/** Chrome overrides for a theme input; text tiers only when the theme provides them. */
export function uiColorsFor(input: UiThemeInput | undefined): Partial<Record<UiKey, RgbColor>> | undefined {
  if (!input) return undefined;
  const hex = (value: string | undefined) => value ? parseHexColor(value) : undefined;
  const accent = hex(input.accent)!;
  const separator = hex(input.separator)!;
  const project = mixRgb(accent, BLACK, 0.45);
  const out: Partial<Record<UiKey, RgbColor>> = {
    accent, separator, success: hex(input.success)!, failure: hex(input.failure)!,
    workingBase: separator, workingPeak: mixRgb(accent, WHITE, 0.35),
    projectBackground: project, projectForeground: readableForeground(project),
  };
  const primary = hex(input.primary);
  if (primary) { out.primary = primary; out.command = primary; }
  const secondary = hex(input.secondary);
  if (secondary) out.secondary = secondary;
  const subtle = hex(input.subtle);
  if (subtle) out.subtle = subtle;
  const selection = hex(input.selection);
  if (selection) out.selection = selection;
  return out;
}

/** The chrome input for a configuration's theme; undefined keeps NMSh's own chrome. */
export function uiThemeInput(palette: NativePaletteId, accent: CatppuccinAccent, custom: CustomTheme | undefined): UiThemeInput | undefined {
  if (palette === 'custom') {
    if (!custom) return undefined;
    const ui = custom.ui;
    return {accent: ui.accent, separator: ui.separator, success: ui.success, failure: ui.failure,
      ...(custom.dark ? {primary: ui.primary, secondary: ui.secondary, subtle: ui.subtle, selection: ui.selection} : {})};
  }
  const variant = themeVariant(palette);
  return variant ? accentedVariant(variant, accent).ui : undefined;
}

/** Recolors UI_COLORS in place; undefined restores the shipped NMSh chrome. */
export function applyUiTheme(colors: Partial<Record<UiKey, RgbColor>> | undefined): void {
  for (const key of Object.keys(DEFAULTS) as UiKey[]) {
    Object.assign(UI_COLORS[key] as RgbColor, colors?.[key] ?? DEFAULTS[key]);
  }
}

/** The shipped NMSh chrome, for clones and tests. */
export function defaultUiColors(): Record<UiKey, RgbColor> {
  return structuredClone(DEFAULTS);
}
