import {mixRgb} from '../chroma/chroma.js';
import {contrastRatio, fromOklch, toOklab, toOklch} from '../chroma/color.js';
import type {Rgb} from '../chroma/escape.js';
import {arcadePalette, type ArcadePalette} from './palette.js';

/**
 * The Vespyr Arcade look: the surfaces, text tones and gameplay hues every hub screen and game draws with. The Arcade
 * paints its whole viewport, so it owns its background: a graphite-and-deep-purple night tinted by the theme's accent,
 * lavender ink, and a small set of clearly different secondary hues for gameplay meaning.
 *
 * The tiers are built in OKLCH with fixed lightness steps, so neighbouring surfaces (a board, its selected cell, the
 * cells that share its row) can never collapse into near-identical purples; `tests/arcadeLook.test.ts` asserts the
 * steps and the text contrast on every surface. Colors only add meaning: every game also uses glyphs or patterns, and
 * without color (NO_COLOR) the canvas drops these values.
 */
export interface ArcadeSurfaces {
  /** The viewport background. */
  base: Rgb;
  /** Wells: a board's background, the inside of a jar or tube. */
  sunken: Rgb;
  /** Cards, sheets, the selected list band's neighbours. */
  raised: Rgb;
  /** A second raised step: alternating boxes, a related row/column highlight. */
  raised2: Rgb;
  /** The selected item's band or cell. */
  selected: Rgb;
  /** Hairlines and boundaries on base. */
  line: Rgb;
  /** Strong boundaries (Sudoku boxes, region edges). */
  edge: Rgb;
}

export interface ArcadeText {
  strong: Rgb;
  normal: Rgb;
  dim: Rgb;
  /** Text drawn on an accent fill. */
  onAccent: Rgb;
}

export const HUE_NAMES = ['peach', 'mint', 'sky', 'butter', 'rose', 'teal', 'lilac', 'coral'] as const;
export type HueName = typeof HUE_NAMES[number];

export interface ArcadeLook {
  palette: ArcadePalette;
  surface: ArcadeSurfaces;
  text: ArcadeText;
  /** Vespyr lavender, leaning toward the theme accent. */
  accent: Rgb;
  /** A brighter accent for focus rings and the active target. */
  focus: Rgb;
  ok: Rgb; bad: Rgb; warn: Rgb; gold: Rgb;
  /** Distinct gameplay hues, all readable on `surface.sunken`. */
  hue: Readonly<Record<HueName, Rgb>>;
}

/** Vespyr's lavender (`#b9a2ff`-family): the Arcade's anchor whatever the theme. */
const LAVENDER: Rgb = {red: 0xb9, green: 0xa2, blue: 0xff};
/** Graphite: the neutral the night is built from. */
const GRAPHITE: Rgb = {red: 0x17, green: 0x15, blue: 0x1f};

/** Lightness of each surface tier (OKLCH L). Adjacent tiers differ by at least 0.05. */
export const SURFACE_LIGHTNESS = {sunken: 0.15, base: 0.2, raised: 0.26, raised2: 0.31, selected: 0.42} as const;

function tone(hue: number, chroma: number, lightness: number): Rgb { return fromOklch({l: lightness, c: chroma, h: hue}); }

/** The hue for a gameplay color: spaced around the wheel, one lightness and chroma, then made readable on `surface`. */
function gameplayHue(hue: number, surface: Rgb, chroma = 0.11, start = 0.78): Rgb {
  let lightness = start;
  let color = tone(hue, chroma, lightness);
  while (contrastRatio(color, surface) < 4.5 && lightness < 0.95) { lightness += 0.02; color = tone(hue, chroma, lightness); }
  return color;
}

/** Hue angle, chroma and lightness per gameplay hue: neighbours on the wheel differ in lightness or chroma too. */
const HUES: Readonly<Record<HueName, readonly [number, number, number]>> = {
  rose: [355, 0.12, 0.76], coral: [35, 0.15, 0.7], peach: [65, 0.09, 0.86], butter: [100, 0.12, 0.9],
  mint: [155, 0.12, 0.84], teal: [195, 0.1, 0.74], sky: [240, 0.11, 0.8], lilac: [300, 0.11, 0.78],
};

let cached: {key: string; look: ArcadeLook} | undefined;

/** The look for `palette` (by default the active theme's). Computed once per theme accent, then reused every frame. */
export function arcadeLook(palette: ArcadePalette = arcadePalette()): ArcadeLook {
  const key = `${palette.accent.red},${palette.accent.green},${palette.accent.blue}`;
  if (cached?.key === key) return {...cached.look, palette};
  const look = buildLook(palette);
  cached = {key, look};
  return look;
}

function buildLook(palette: ArcadePalette): ArcadeLook {
  // The Arcade's own violet: lavender pulled a quarter of the way to the theme accent, so every theme keeps the Vespyr feel.
  const accent = mixRgb(LAVENDER, palette.accent, 0.25);
  const hue = toOklch(mixRgb(accent, GRAPHITE, 0.5)).h;
  const chroma = 0.035;
  const surface: ArcadeSurfaces = {
    sunken: tone(hue, chroma, SURFACE_LIGHTNESS.sunken),
    base: tone(hue, chroma, SURFACE_LIGHTNESS.base),
    raised: tone(hue, chroma, SURFACE_LIGHTNESS.raised),
    raised2: tone(hue, chroma * 1.2, SURFACE_LIGHTNESS.raised2),
    selected: tone(toOklch(accent).h, 0.09, SURFACE_LIGHTNESS.selected),
    line: tone(hue, chroma, 0.34),
    edge: tone(toOklch(accent).h, 0.07, 0.58),
  };
  const text: ArcadeText = {
    strong: tone(toOklch(accent).h, 0.03, 0.96),
    normal: tone(toOklch(accent).h, 0.04, 0.84),
    dim: tone(hue, 0.035, 0.66),
    onAccent: tone(hue, 0.04, 0.16),
  };
  const hues = Object.fromEntries(HUE_NAMES.map(name => { const [angle, c, l] = HUES[name]; return [name, gameplayHue(angle, surface.sunken, c, l)]; })) as Record<HueName, Rgb>;
  return {
    palette, surface, text, accent,
    focus: tone(toOklch(accent).h, 0.12, 0.86),
    ok: gameplayHue(150, surface.sunken), bad: gameplayHue(18, surface.sunken), warn: gameplayHue(75, surface.sunken),
    gold: tone(88, 0.13, 0.85),
    hue: hues,
  };
}

/** Perceptual distance (Oklab, ×100) between two colors: below about 10, people confuse them in small cells. */
export function deltaE(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = toOklab(a);
  const [l2, a2, b2] = toOklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100;
}

/**
 * `count` colors for regions, tubes or pieces: the named hues first, then extra hues spaced between them at a second
 * lightness, each readable on `background`. Neighbouring entries are always clearly different.
 */
export function distinctColors(count: number, look: ArcadeLook, background: Rgb = look.surface.sunken): Rgb[] {
  const order: HueName[] = ['rose', 'mint', 'sky', 'butter', 'lilac', 'peach', 'teal', 'coral'];
  const colors = order.map(name => look.hue[name]);
  for (let index = 0; colors.length < count; index += 1) {
    const angle = (index * 137.508 + 215) % 360;
    const candidate = tone(angle, 0.14, 0.66);
    colors.push(contrastRatio(candidate, background) >= 3 ? candidate : tone(angle, 0.12, 0.8));
  }
  return colors.slice(0, count);
}
