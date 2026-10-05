import type {NativePaletteId} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import {parseHexColor} from '../chroma/color.js';
import type {RgbColor} from '../ui/palette.js';
import {accentedVariant, themeVariant, type CatppuccinAccent} from './themeFamilies.js';
import type {CustomTheme} from './customTheme.js';

/**
 * The accent color of any theme, resolved from the one theme system: a
 * bundled family variant (with the Catppuccin accent applied), one of NMSh's
 * own themes (its project color), or the person's Custom theme. Pure: it never
 * reads the active theme, so a surface can follow a theme other than the
 * prompt's (the cursor's Choose theme) or the prompt's own (Follow theme).
 */
export function themeAccentColor(palette: NativePaletteId, accent: CatppuccinAccent, custom: CustomTheme | undefined): RgbColor {
  if (palette === 'custom') {
    const parsed = custom ? parseHexColor(custom.ui.accent) : undefined;
    if (parsed) return parsed;
    return {...NATIVE_PROMPT_THEMES.lavender.colors('project').background};
  }
  const variant = themeVariant(palette);
  if (variant) return parseHexColor(accentedVariant(variant, accent).ui.accent) ?? {...NATIVE_PROMPT_THEMES.lavender.colors('project').background};
  const theme = NATIVE_PROMPT_THEMES[palette] ?? NATIVE_PROMPT_THEMES.lavender;
  return {...theme.colors('project').background};
}
