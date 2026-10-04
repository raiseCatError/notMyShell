import type {CursorSettings, NativePaletteId, PromptConfiguration} from '../prompt/configuration.js';
import {hexColor} from '../chroma/color.js';
import type {CatppuccinAccent} from '../appearance/themeFamilies.js';
import type {CustomTheme} from '../appearance/customTheme.js';
import {themeAccentColor} from '../appearance/themeColor.js';
import {UI_COLORS, type RgbColor} from '../ui/palette.js';

/**
 * Cursor colors resolved against the real theme system. The stored source
 * says WHERE a color comes from; this turns it into a color once, so every
 * consumer (Portable engine, preview, Ghostty shader, Kitty fragment) sees
 * the same value and nothing falls back to a hard-coded accent.
 *
 *   host    the terminal's own caret color (no color of its own)
 *   theme   Follow current theme: the prompt's theme accent
 *   chosen  Choose theme: a theme (and Catppuccin accent) picked for the cursor alone
 *   accent  NMSh's UI accent as it is drawn now (follows UI chrome)
 *   custom  a validated #RRGGBB
 */
export interface CursorColorContext {
  palette: NativePaletteId;
  accent: CatppuccinAccent;
  customTheme?: CustomTheme | undefined;
  /** NMSh's UI accent right now (UI_COLORS.accent when omitted). */
  chrome?: RgbColor;
}

export const contextFor = (config: Pick<PromptConfiguration, 'nmsh' | 'customTheme'>): CursorColorContext =>
  ({palette: config.nmsh.palette, accent: config.nmsh.accent, customTheme: config.customTheme});

/** The selected color, or undefined for Host (the terminal draws its own). */
export function resolveCursorColor(settings: CursorSettings, context: CursorColorContext): RgbColor | undefined {
  const {color} = settings;
  switch (color.source) {
    case 'host': return undefined;
    case 'accent': return {...(context.chrome ?? UI_COLORS.accent)};
    case 'theme': return themeAccentColor(context.palette, context.accent, context.customTheme);
    case 'chosen': return themeAccentColor(color.theme ?? 'lavender', color.themeAccent ?? 'mauve', context.customTheme);
    case 'custom': return color.custom ? hexRgb(color.custom) : undefined;
  }
}

const hexRgb = (hex: string): RgbColor => ({red: parseInt(hex.slice(1, 3), 16), green: parseInt(hex.slice(3, 5), 16), blue: parseInt(hex.slice(5, 7), 16)});

/** Settings whose color is concrete: theme-derived sources become `custom` with the resolved hex. Downstream code never resolves themes. */
export function resolveCursorSettings(settings: CursorSettings, context: CursorColorContext): CursorSettings {
  const resolved = resolveCursorColor(settings, context);
  if (settings.color.source === 'host' || settings.color.source === 'custom' || !resolved) return settings;
  return {...settings, color: {source: 'custom', custom: hexColor(resolved)}};
}

/** The color to show as the swatch for a settings value, and what it is called. */
export function describeCursorColor(settings: CursorSettings, context: CursorColorContext): {hex?: string; label: string} {
  const resolved = resolveCursorColor(settings, context);
  const labels = {host: 'Host (your terminal draws its own)', theme: 'Follow current theme', chosen: 'Chosen theme', accent: 'NMSh accent', custom: 'Custom'} as const;
  return {...(resolved ? {hex: hexColor(resolved)} : {}), label: labels[settings.color.source]};
}
