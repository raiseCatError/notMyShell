import {parseHexColor} from '../chroma/color.js';
import type {Rgb} from '../chroma/escape.js';
import {PRESET_STOPS} from '../chroma/treatment.js';
import type {PromptConfiguration} from '../prompt/configuration.js';
import {mixPacked} from './CellGrid.js';
import {idleStops} from './IdleVisuals.js';
import {idlePalette, type IdlePalette} from './scenes.js';

/**
 * Moods for the starting-point sky. Every mood is a palette over the one
 * Aurora engine (`renderScene('aurora')`), never a second animation:
 *
 * - Aurora: an aurora's green rim and blue glow, with the theme's accent in
 *   the upper curtains, over the theme's own night.
 * - Calm: the same colors dimmed 90 % toward the night; stars faint.
 * - Spectrum: the Aurora preset's green, blue, violet and pink.
 * - Out: the curtains fade to night (then the sky is not drawn at all).
 */
export const SKY_MOODS = ['aurora', 'calm', 'spectrum', 'out'] as const;
export type SkyMood = typeof SKY_MOODS[number];

/** Scene speed per mood; Calm drifts slowly. Out has no curtains left to move. */
export const MOOD_SPEED: Readonly<Record<SkyMood, number>> = {aurora: 1, calm: 0.3, spectrum: 1, out: 1};

/** A change of highlight cross-fades the palette over this long while the scene keeps moving. */
export const CROSSFADE_MS = 700;

const RIM: Rgb = {red: 0x3e, green: 0xe8, blue: 0xb5};
const GLOW: Rgb = {red: 0x45, green: 0xb8, blue: 0xf0};
const BRAND: Rgb = {red: 166, green: 124, blue: 243};

const four = (stops: readonly number[]): number[] => Array.from({length: 4}, (_, index) => stops[index % stops.length]!);

/** The sky's light: green rim, blue glow, then the theme's own accent colors. Grayscale stays neutral. */
export function skyStops(config: PromptConfiguration): Rgb[] {
  const theme = idleStops(config, 'theme');
  if (config.nmsh.palette === 'grayscale') return theme;
  const accent = theme[0] ?? BRAND;
  return [RIM, GLOW, accent, theme[1] ?? accent];
}

/** Dims a palette's light toward its night; `star` is how far the stars fade. */
function dim(palette: IdlePalette, amount: number, star: number): IdlePalette {
  return {...palette, stops: four(palette.stops).map(stop => mixPacked(stop, palette.sky, amount)), star: mixPacked(palette.star, palette.sky, star)};
}

/** One mood's palette for a configuration's theme; Subtle dims every mood 55 %. */
export function moodPalette(mood: SkyMood, config: PromptConfiguration, backdrop: 'aurora' | 'subtle' = 'aurora'): IdlePalette {
  const night = idlePalette(idleStops(config, 'theme'));
  const lit = idlePalette(skyStops(config));
  const base: IdlePalette = {...lit, stops: four(lit.stops), sky: night.sky, skyTop: night.skyTop, star: night.star};
  let palette: IdlePalette;
  switch (mood) {
    case 'aurora': palette = base; break;
    case 'calm': palette = dim(base, 0.9, 0.12); break;
    case 'spectrum': {
      const spectrum = idlePalette(PRESET_STOPS.aurora.map(hex => parseHexColor(hex)!));
      palette = {...spectrum, stops: four(spectrum.stops), sky: base.sky, skyTop: base.skyTop};
      break;
    }
    case 'out': palette = {...base, stops: four(base.stops).map(() => base.sky), star: base.sky}; break;
  }
  return backdrop === 'subtle' ? dim(palette, 0.55, 0.3) : palette;
}

/** Linear blend of two palettes, 0 … 1. */
export function blendPalettes(a: IdlePalette, b: IdlePalette, t: number): IdlePalette {
  const k = Math.max(0, Math.min(1, t));
  const to = four(b.stops);
  return {stops: four(a.stops).map((stop, index) => mixPacked(stop, to[index]!, k)), sky: mixPacked(a.sky, b.sky, k),
    skyTop: mixPacked(a.skyTop, b.skyTop, k), star: mixPacked(a.star, b.star, k), warm: mixPacked(a.warm, b.warm, k)};
}

/**
 * What the sky shows: a weight per mood, summing to one. A cross-fade moves
 * the weights from the blend on screen toward the new mood, so a newer change
 * simply starts from wherever the last one had got to (no queue, no flash).
 */
export type MoodMix = Readonly<Record<SkyMood, number>>;

export function pureMix(mood: SkyMood): MoodMix {
  return {aurora: mood === 'aurora' ? 1 : 0, calm: mood === 'calm' ? 1 : 0, spectrum: mood === 'spectrum' ? 1 : 0, out: mood === 'out' ? 1 : 0};
}

/** Cross-fade progress, eased (fast start, gentle landing). */
export function crossfadeProgress(elapsed: number): number {
  if (!(elapsed > 0)) return 0;
  if (elapsed >= CROSSFADE_MS) return 1;
  return 1 - (1 - elapsed / CROSSFADE_MS) ** 3;
}

export function fadeMix(from: MoodMix, to: SkyMood, elapsed: number): MoodMix {
  const k = crossfadeProgress(elapsed);
  if (k >= 1) return pureMix(to);
  return {aurora: from.aurora * (1 - k) + (to === 'aurora' ? k : 0), calm: from.calm * (1 - k) + (to === 'calm' ? k : 0),
    spectrum: from.spectrum * (1 - k) + (to === 'spectrum' ? k : 0), out: from.out * (1 - k) + (to === 'out' ? k : 0)};
}

/** The scene speed of a blend. */
export function mixSpeed(mix: MoodMix): number {
  return SKY_MOODS.reduce((sum, mood) => sum + mix[mood] * MOOD_SPEED[mood], 0);
}

function weighted(colors: readonly number[], weights: readonly number[]): number {
  let red = 0, green = 0, blue = 0;
  colors.forEach((color, index) => {
    const weight = weights[index]!;
    red += ((color >> 16) & 0xff) * weight; green += ((color >> 8) & 0xff) * weight; blue += (color & 0xff) * weight;
  });
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return ((channel(red) << 16) | (channel(green) << 8) | channel(blue)) & 0xffffff;
}

/** The palette a blend of moods shows, channel by channel. */
export function mixPalette(mix: MoodMix, config: PromptConfiguration, backdrop: 'aurora' | 'subtle' = 'aurora'): IdlePalette {
  const moods = SKY_MOODS.filter(mood => mix[mood] > 0);
  if (moods.length === 0) return moodPalette('aurora', config, backdrop);
  if (moods.length === 1 && mix[moods[0]!] === 1) return moodPalette(moods[0]!, config, backdrop);
  const total = moods.reduce((sum, mood) => sum + mix[mood], 0);
  const weights = moods.map(mood => mix[mood] / total);
  const palettes = moods.map(mood => moodPalette(mood, config, backdrop));
  const field = (pick: (palette: IdlePalette) => number) => weighted(palettes.map(pick), weights);
  return {stops: [0, 1, 2, 3].map(index => field(palette => four(palette.stops)[index]!)), sky: field(palette => palette.sky),
    skyTop: field(palette => palette.skyTop), star: field(palette => palette.star), warm: field(palette => palette.warm)};
}
