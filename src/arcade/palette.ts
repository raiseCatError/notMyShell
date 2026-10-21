import {mixRgb, resolveColor, status, theme, BRAND_LAVENDER} from '../chroma/chroma.js';
import {contrastOn, fromOklch, toOklch} from '../chroma/color.js';
import type {Rgb} from '../chroma/escape.js';
import {CAT_BODY, CAT_EYE} from '../idle/catSprite.js';

/**
 * Every color the arcade draws comes from here, and everything here is derived from the active theme and Chroma roles
 * (accent, primary, secondary, subtle, separator, selection, success, failure, working), never a private arcade palette.
 * A theme change is picked up the next time `arcadePalette()` is called (once per frame), so a live change recolors a
 * running game. Without color (NO_COLOR) the canvas drops these values and the games rely on glyphs and patterns.
 */
export interface ArcadePalette {
  ink: Rgb; muted: Rgb; faint: Rgb; accent: Rgb; accentSoft: Rgb; line: Rgb; selection: Rgb;
  ok: Rgb; bad: Rgb; warn: Rgb;
  /** The scene's darkest and lightest tones, derived from the accent so every theme gets its own world. */
  deep: Rgb; dusk: Rgb; haze: Rgb;
  /** Vespyr: the NMSh cat's lavender, tinted toward the theme accent, with its shade, eye and belly. */
  cat: {body: Rgb; shade: Rgb; eye: Rgb; belly: Rgb; whisker: Rgb};
}

const fromHex = (value: number): Rgb => ({red: (value >> 16) & 255, green: (value >> 8) & 255, blue: value & 255});
const BLACK: Rgb = {red: 8, green: 7, blue: 14};
const WHITE: Rgb = {red: 250, green: 248, blue: 255};

export function arcadePalette(): ArcadePalette {
  const accent = resolveColor(theme('accent'));
  const ink = resolveColor(theme('primary'));
  const muted = resolveColor(theme('secondary'));
  const faint = resolveColor(theme('subtle'));
  const line = resolveColor(theme('separator'));
  const selection = resolveColor(theme('selection'));
  const deep = mixRgb(accent, BLACK, 0.86);
  const dusk = mixRgb(accent, BLACK, 0.62);
  const haze = mixRgb(accent, WHITE, 0.55);
  // Vespyr stays recognizably the NMSh cat: his lavender, leaning a little toward the theme's accent.
  const body = mixRgb(fromHex(CAT_BODY), accent, 0.25);
  return {
    ink, muted, faint, accent, accentSoft: mixRgb(accent, ink, 0.4), line, selection,
    ok: resolveColor(status('success')), bad: resolveColor(status('failure')), warn: {red: 224, green: 176, blue: 72},
    deep, dusk, haze,
    cat: {body, shade: mixRgb(body, BLACK, 0.3), eye: fromHex(CAT_EYE), belly: mixRgb(body, WHITE, 0.45), whisker: mixRgb(body, WHITE, 0.2)},
  };
}

/** The sky behind a scene at `phase` (0..1 around a full cycle): dawn, day, dusk, night, all tints of the theme. */
export function skyAt(palette: ArcadePalette, phase: number): {top: Rgb; bottom: Rgb; stars: number} {
  const wrapped = ((phase % 1) + 1) % 1;
  const day = (Math.cos(wrapped * Math.PI * 2) + 1) / 2; // 1 at noon, 0 at midnight
  return {
    top: mixRgb(palette.deep, palette.dusk, day * 0.8),
    bottom: mixRgb(palette.dusk, palette.haze, day * 0.7),
    stars: Math.max(0, 1 - day * 1.6),
  };
}

/**
 * `count` region colors for a colored-region puzzle: evenly spaced hues at one lightness and chroma, rotated from the
 * accent's own hue so the set belongs to the theme, then nudged so each keeps contrast against `background`.
 */
export function regionColors(count: number, background: Rgb, palette: ArcadePalette = arcadePalette()): Rgb[] {
  const base = toOklch(palette.accent);
  const colors: Rgb[] = [];
  for (let index = 0; index < count; index += 1) {
    const hue = (base.h + (360 / Math.max(1, count)) * index) % 360;
    const candidate = fromOklch({l: 0.74, c: 0.075, h: hue});
    colors.push(contrastOn(candidate, background, 1.6));
  }
  return colors;
}

export { BRAND_LAVENDER };
