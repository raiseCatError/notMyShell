import {colorEscape} from '../../chroma/escape.js';
import {CellGrid, luminance, mixPacked, NO_COLOR_VALUE, pack, unpack} from '../../idle/CellGrid.js';
import {CAT_CELL_HEIGHT, compositeCat, type CatPose} from '../../idle/catSprite.js';
import {IDLE_SEED} from '../../idle/IdleVisuals.js';
import {renderScene} from '../../idle/scenes.js';
import {
  CROSSFADE_MS, crossfadeProgress, fadeMix, mixPalette, mixSpeed, MOOD_SPEED, pureMix, type MoodMix, type SkyMood,
} from '../../idle/auroraMoods.js';
import type {OnboardingBackdrop, PromptConfiguration} from '../../prompt/configuration.js';
import {colorLevel, type ColorLevel} from '../../presentation/capabilities.js';
import {getCurrentGlyphMode} from '../../ui/glyphs.js';
import {UI_COLORS} from '../../ui/palette.js';

/**
 * The starting-point sky band: the real Aurora engine drawn into one reused
 * grid, its mood following the highlighted choice, Vespyr composited pixel by
 * pixel on its bottom row, and the horizon returned separately for the first
 * ground row so it can never paint over the sky band or Vespyr.
 */

/** A scene time where the curtains are well formed; the engine is a pure function of time. */
export const AURORA_EPOCH = 30_500;
/** After this long without a key the sky holds still; the next key resumes it. */
export const SKY_HOLD_MS = 60_000;
export const TAIL_FLICK_MS = 360;
const BLINK_EVERY_MS = 6400;
/** Longer than the slowest cadence (320 ms), so a frame always lands on a blink. */
const BLINK_MS = 340;
const ANIMATED_MS = 40, AURORA_MS = 200, SUBTLE_MS = 320;

export interface SkyBandInput {
  width: number;
  height: number;
  now: number;
  /** When the selector opened: the scene's own zero and the blink phase. */
  started: number;
  /** The highlighted choice's mood, and the one before the last change. */
  mood: SkyMood;
  previousMood: SkyMood;
  changedAt: number;
  /** The blend on screen when the highlight last changed; defaults to the previous mood alone. */
  from?: MoodMix;
  /** Scene time elapsed (past the epoch) when the highlight last changed; defaults to the previous mood's speed since `started`. */
  timeAt?: number;
  /** The last key; after SKY_HOLD_MS without one the sky holds still. */
  activeAt?: number;
  backdrop: OnboardingBackdrop;
  /** Reduced Motion or Effects Off: one still frame and no clock. */
  reduced: boolean;
  /** The configuration whose theme lights the sky (the saved one; the selector draws in the saved theme). */
  config: PromptConfiguration;
  /** Vespyr on the horizon at this column. */
  cat?: {x: number; pose: CatPose};
  level?: ColorLevel;
  nerd?: boolean;
}

type SkyTiming = Pick<SkyBandInput, 'now' | 'started' | 'mood' | 'previousMood' | 'changedAt' | 'from' | 'timeAt' | 'activeAt' | 'reduced'>;

/** The moment the sky shows: frozen once it holds still. */
function skyNow(input: Pick<SkyBandInput, 'now' | 'activeAt'>): number {
  return input.activeAt === undefined ? input.now : Math.min(input.now, input.activeAt + SKY_HOLD_MS);
}

/** The blend of moods on screen; Reduced Motion switches at once. */
export function skyMix(input: SkyTiming): MoodMix {
  if (input.reduced) return pureMix(input.mood);
  return fadeMix(input.from ?? pureMix(input.previousMood), input.mood, skyNow(input) - input.changedAt);
}

/**
 * Scene time: the integral of the blended mood speed since the last change, so
 * slowing for Calm or speeding back up never jumps the curtains.
 */
export function skySceneTime(input: SkyTiming): number {
  if (input.reduced) return AURORA_EPOCH;
  const from = input.from ?? pureMix(input.previousMood);
  const fromSpeed = mixSpeed(from), toSpeed = MOOD_SPEED[input.mood];
  const changed = Math.max(input.changedAt, input.started);
  const timeAt = input.timeAt ?? Math.max(0, changed - input.started) * fromSpeed;
  const elapsed = Math.max(0, skyNow(input) - changed);
  // While fading, speed eases from `fromSpeed` to `toSpeed` as 1 - (1 - u)^3; its integral has a closed form.
  const settled = Math.min(1, elapsed / CROSSFADE_MS);
  const easing = input.changedAt >= input.started ? CROSSFADE_MS * (1 - (1 - settled) ** 4) / 4 : 0;
  return AURORA_EPOCH + timeAt + toSpeed * elapsed + (fromSpeed - toSpeed) * easing;
}

/** Vespyr's pose: a tail flick when the highlight changes, an occasional slow blink. */
export function skyCatPose(input: {now: number; started: number; changedAt: number; reduced: boolean; activeAt?: number}): CatPose {
  if (input.reduced) return 'idle';
  const now = skyNow(input);
  const since = now - input.changedAt;
  if (since >= 0 && since < TAIL_FLICK_MS) return 'tail';
  const phase = ((now - input.started) % BLINK_EVERY_MS + BLINK_EVERY_MS) % BLINK_EVERY_MS;
  return phase >= BLINK_EVERY_MS - BLINK_MS ? 'blink' : 'idle';
}

/** Whether a sky can be drawn at all: never with Off, NO_COLOR or 16 colors. */
export function skyAvailable(backdrop: OnboardingBackdrop, level: ColorLevel = colorLevel()): boolean {
  return backdrop !== 'off' && level !== 'none' && level !== 'ansi16';
}

/**
 * The frame interval the sky needs right now: 40 ms while a cross-fade or tail
 * flick runs, 200 ms (Aurora) or 320 ms (Subtle) at rest, 0 when nothing moves
 * (Reduced Motion, Off, NO_COLOR, 16 colors, or 60 s without a key).
 */
export function skyFrameMs(input: Pick<SkyBandInput, 'now' | 'changedAt' | 'activeAt' | 'backdrop' | 'reduced' | 'level'>): number {
  const level = input.level ?? colorLevel();
  if (input.reduced || level === 'none') return 0;
  if (input.activeAt !== undefined && input.now - input.activeAt >= SKY_HOLD_MS) return 0;
  const since = input.now - input.changedAt;
  if (since >= 0 && since < CROSSFADE_MS) return ANIMATED_MS;
  if (!skyAvailable(input.backdrop, level)) return 0;
  return input.backdrop === 'subtle' ? SUBTLE_MS : AURORA_MS;
}

/** One frame of the sky band, and the horizon row that sits right below it. */
export function renderSkyBand(grid: CellGrid, input: SkyBandInput): {rows: string[]; horizon: string} {
  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(0, Math.floor(input.height));
  if (height === 0) return {rows: [], horizon: ''};
  const level = input.level ?? colorLevel();
  const nerd = input.nerd ?? getCurrentGlyphMode() === 'nerd';
  grid.resize(width, height);
  const mix = skyMix(input);
  const lit = skyAvailable(input.backdrop, level) && mix.out < 1;
  if (lit) {
    const palette = mixPalette(mix, input.config, input.backdrop === 'subtle' ? 'subtle' : 'aurora');
    renderScene('aurora', grid, {time: skySceneTime(input), seed: IDLE_SEED, palette, level, nerd});
  } else grid.clear(NO_COLOR_VALUE);
  // The horizon reads the sky before Vespyr stands on it, so the cat never tints the line.
  const horizon = horizonRow(grid, lit, mix, level, nerd);
  if (input.cat && level !== 'none') compositeCat(grid, input.cat.x, height - CAT_CELL_HEIGHT, input.cat.pose, true);
  return {rows: grid.toRows(level), horizon};
}

/**
 * `▔` across the full width (an ASCII rule with Safe glyphs; a plain rule with NO_COLOR or 16 colors),
 * brightest under the brightest light above it. With no sky it is a
 * separator hairline; as the sky goes out the line fades to exactly that.
 */
function horizonRow(grid: CellGrid, lit: boolean, mix: MoodMix, level: ColorLevel, nerd: boolean): string {
  const width = grid.width;
  // NO_COLOR and 16-color hosts draw no sky; the horizon is a plain rule.
  if (level === 'none' || level === 'ansi16') return (nerd ? '─' : '-').repeat(width);
  const glyph = nerd ? '▔' : '-';
  const separator = pack(UI_COLORS.separator);
  if (!lit) return `${colorEscape(38, UI_COLORS.separator, level)}${glyph.repeat(width)}\u001B[0m`;
  const glow = mixPacked(pack(UI_COLORS.accent), 0xffffff, 0.3);
  const bottom = grid.height - 1;
  let row = '';
  let last = Number.NaN;
  for (let x = 0; x < width; x++) {
    let peak = 0;
    for (let y = Math.max(0, grid.height - 5); y < grid.height; y++) {
      for (const half of grid.halves(x, y)) if (half !== NO_COLOR_VALUE) peak = Math.max(peak, luminance(half));
    }
    const [, below] = grid.halves(x, bottom);
    const sky = below === NO_COLOR_VALUE ? separator : below;
    const light = mixPacked(mixPacked(sky, glow, 0.55), 0xffffff, Math.min(0.45, peak * 0.9));
    const color = mixPacked(light, separator, mix.out) & 0xfcfcfc;
    if (color !== last) { row += colorEscape(38, unpack(color), level); last = color; }
    row += glyph;
  }
  return `${row}\u001B[0m`;
}

/** Ease used for sky progress elsewhere in the selector (the ending's fold). */
export const easeOut = (t: number): number => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;

export {CROSSFADE_MS, crossfadeProgress};
