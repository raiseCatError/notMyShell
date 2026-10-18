import {CellGrid, mixPacked, pack, unpack} from '../../idle/CellGrid.js';
import type {MoodMix, SkyMood} from '../../idle/auroraMoods.js';
import {sweepAnsiRow, type SweepStyle} from '../../motion/lightSweep.js';
import {FIRST_RUN_HEADLINE_LINE} from '../../output/FirstRunWelcome.js';
import type {OnboardingBackdrop, PromptConfiguration} from '../../prompt/configuration.js';
import {colorLevel} from '../../presentation/capabilities.js';
import {overlayRow, type CellPaint} from '../../presentation/cellOverlay.js';
import {displayWidth, stripAnsi} from '../../util/text.js';
import {getCurrentGlyphMode} from '../../ui/glyphs.js';
import {UI_COLORS} from '../../ui/palette.js';
import type {Region} from '../../app/screenPlan.js';
import {easeOut, renderSkyBand, skyCatPose} from './sky.js';

/**
 * The ending: after Apply has saved and applied the configuration, the
 * selector folds away into the real transcript and composer. One
 * presentation-only transition painted over the real frame; every row it does
 * not draw is the real frame's own row, so nothing is cleared and nothing is
 * left behind.
 *
 *   0–180 ms  the selector's ground recedes (faint over the real frame, then gone)
 *   0–520 ms  the sky folds upward on the real engine; the horizon rides its bottom edge,
 *             Vespyr on it, up and out of view
 *   520–760   the horizon, now one luminous rule at the top, fades out (behind the real
 *             row: it fills only what the row's own text leaves blank, to the right of it)
 *   240–880   the real composer rises from below the bottom edge into its own place
 *   480 →     a genuine first run's welcome arrives one line every 60 ms (all of it
 *             within 600 ms), a light sweep crosses its headline and Vespyr blinks
 */
export const ENDING_MS = 880;
const GROUND_MS = 180, FOLD_MS = 520, RULE_END_MS = 760, RISE_START_MS = 240;
export const WELCOME_START_MS = 480, WELCOME_STEP_MS = 60;
const SWEEP_MS = 900;

export interface StartupEnding {
  start: number;
  /** The size the ending was planned for; a resize finishes it. */
  columns: number;
  rows: number;
  /** The selector's sky band at Apply, and how it was moving. */
  skyHeight: number;
  sky: {started: number; mood: SkyMood; previousMood: SkyMood; changedAt: number; from: MoodMix; timeAt: number; activeAt: number};
  backdrop: OnboardingBackdrop;
  /** The configuration whose theme lit the sky (the saved one at Apply). */
  config: PromptConfiguration;
  /** The selector's ground rows at Apply, from the horizon row down. */
  ground: string[];
  /** Where Vespyr stood on the horizon, if the selector showed it. */
  catX?: number;
  /** Rows below its own place the composer starts; by default from just below the bottom edge. */
  composerFrom?: number;
  /** A genuine first run with Recommended: the welcome arrives line by line. */
  welcome: boolean;
  /** The welcome's last line number (Vespyr's block is line 0; a wrapped paragraph is one line). */
  welcomeLines: number;
  /** The light sweep across the welcome's headline. */
  sweep?: SweepStyle;
}

export interface EndingPaint {rows: string[]; caretVisible: boolean; done: boolean}

/** The whole ending, including a first-run welcome that keeps arriving after the composer lands. */
export function endingDuration(ending: Pick<StartupEnding, 'welcome' | 'welcomeLines'>): number {
  if (!ending.welcome) return ENDING_MS;
  const arrived = WELCOME_START_MS + WELCOME_STEP_MS * ending.welcomeLines;
  const swept = WELCOME_START_MS + WELCOME_STEP_MS * FIRST_RUN_HEADLINE_LINE + SWEEP_MS;
  return Math.max(ENDING_MS, arrived, swept);
}

const COMPOSER_KINDS: ReadonlySet<Region['kind']> = new Set(['composerBorder', 'prompt', 'input', 'separator', 'contextRail', 'railGap', 'railEdge', 'awake']);

const faint = (row: string) => row ? `\u001B[2m${row.replace(/\u001B\[0?m/gu, '\u001B[0m\u001B[2m')}\u001B[0m` : row;

/**
 * One frame of the ending over the real frame's rows. `welcomeRows` maps frame
 * rows to their first-run welcome line (0 is Vespyr's block).
 */
export function paintStartupEnding(rows: readonly string[], plan: {regions: readonly Region[]}, columns: number, now: number, ending: StartupEnding,
  sky: CellGrid, welcomeRows: ReadonlyMap<number, number> = new Map()): EndingPaint {
  const t = Math.max(0, now - ending.start);
  const out = [...rows];
  const height = out.length;
  // The welcome arrives line by line; a line that has not arrived is a blank row.
  if (ending.welcome) {
    const arrived = t < WELCOME_START_MS ? -1 : Math.floor((t - WELCOME_START_MS) / WELCOME_STEP_MS);
    for (const [row, line] of welcomeRows) {
      if (row < 0 || row >= height) continue;
      if (line > arrived) out[row] = '';
      // One light sweep crosses the headline once it has arrived.
      else if (line === FIRST_RUN_HEADLINE_LINE && ending.sweep) {
        out[row] = sweepAnsiRow(out[row]!, t - (WELCOME_START_MS + FIRST_RUN_HEADLINE_LINE * WELCOME_STEP_MS), ending.sweep, colorLevel(), undefined, SWEEP_MS);
      }
    }
  }
  // The real composer rises from below the bottom edge into its own place; rows it leaves are blank.
  const risen = new Set<number>();
  const composer = plan.regions.filter(region => COMPOSER_KINDS.has(region.kind) && region.height > 0);
  if (composer.length && t < ENDING_MS) {
    const top = Math.min(...composer.map(region => region.top));
    const bottom = Math.max(...composer.map(region => region.top + region.height - 1));
    const progress = t < RISE_START_MS ? 0 : easeOut((t - RISE_START_MS) / (ENDING_MS - RISE_START_MS));
    const offset = Math.round((ending.composerFrom ?? height - top) * (1 - progress));
    if (offset > 0) {
      const block = rows.slice(top, bottom + 1);
      for (let row = top; row < height; row++) {
        const source = row - offset - top;
        if (source >= 0 && source < block.length) { out[row] = block[source]!; risen.add(row); }
        else if (row <= bottom) out[row] = '';
      }
    }
  }
  // The ground recedes: faint over the real frame (the composer's empty landing place included), then gone.
  if (t < GROUND_MS) {
    ending.ground.forEach((row, index) => {
      const target = ending.skyHeight + index;
      if (index > 0 && target < height && row && !risen.has(target)) out[target] = faint(row);
    });
  }
  // The sky folds upward on the real engine, the horizon riding its bottom edge; then one luminous rule fades out.
  if (t < FOLD_MS && ending.skyHeight > 0) {
    const fold = Math.round(ending.skyHeight * (1 - easeOut(t / FOLD_MS)));
    if (fold > 0) {
      // Vespyr keeps standing on the horizon as it rises; the top edge clips it.
      const cat = ending.catX === undefined ? undefined : {x: ending.catX, pose: skyCatPose({...ending.sky, now, reduced: false})};
      const band = renderSkyBand(sky, {...ending.sky, now, width: columns, height: fold, backdrop: ending.backdrop, reduced: false, config: ending.config, ...(cat ? {cat} : {})});
      band.rows.forEach((row, index) => { if (index < height) out[index] = row; });
      if (fold < height) out[fold] = band.horizon;
    } else if (height) out[0] = ruleBehind(out[0]!, columns, 0);
  } else if (t < RULE_END_MS && ending.skyHeight > 0 && height) out[0] = ruleBehind(out[0]!, columns, (t - FOLD_MS) / (RULE_END_MS - FOLD_MS));
  const done = t >= endingDuration(ending);
  return {rows: done ? [...rows] : out, caretVisible: t >= ENDING_MS, done};
}

const BACKGROUND_SGR = /\u001B\[(?:[\d;]*;)?(?:4[0-7]|10[0-7]|48;[25];[\d;]+)m/u;

/**
 * The horizon as one rule at the top, fading from the theme's glow to its separator as `fade` goes 0 → 1. It sits
 * behind the real row: it fills only the cells after the row's own text (one cell apart), and never a row that
 * paints its own background.
 */
function ruleBehind(row: string, columns: number, fade: number): string {
  if (BACKGROUND_SGR.test(row)) return row;
  const text = displayWidth(stripAnsi(row).trimEnd());
  const from = text ? text + 1 : 0;
  if (from >= columns) return row;
  const glyph = getCurrentGlyphMode() === 'nerd' ? '▔' : '-';
  const glow = mixPacked(pack(UI_COLORS.accent), 0xffffff, 0.45);
  const level = colorLevel();
  const color = level === 'ansi16' ? UI_COLORS.separator : unpack(mixPacked(glow, pack(UI_COLORS.separator), Math.max(0, Math.min(1, fade))));
  const paint: CellPaint = {glyph, foreground: color};
  const paints = new Map<number, CellPaint>();
  for (let column = from; column < columns; column++) paints.set(column, paint);
  return overlayRow(row, paints, columns);
}
