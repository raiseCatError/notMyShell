import {colorEscape, type Rgb} from '../chroma/escape.js';
import {fromOklch, mixOklch, toOklch} from '../chroma/color.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {displayWidth} from '../util/text.js';

/**
 * Light sweep: a narrow, soft band of light that travels across otherwise
 * stationary cells. Glyphs, widths and positions never change; only each
 * cell's own foreground color is lifted, and only while the band is over it.
 *
 * Per cell: base color → optional tint (Chroma gradient at the cell, or a
 * subtle accent) → luminance lift in OKLCH (hue kept) → blend from the exact
 * base by a Gaussian envelope → capability degradation. Outside the band the
 * envelope is exactly zero and the base color is returned unchanged.
 */

export const SWEEP_LEVELS = ['off', 'subtle', 'vivid'] as const;
export type SweepLevel = typeof SWEEP_LEVELS[number];
export const SWEEP_LEVEL_LABELS: Record<SweepLevel, string> = {off: 'Off', subtle: 'Subtle', vivid: 'Vivid / Chroma'};
export const SWEEP_SPEEDS = ['slow', 'normal', 'fast'] as const;
export type SweepSpeed = typeof SWEEP_SPEEDS[number];
export const SWEEP_SPEED_LABELS: Record<SweepSpeed, string> = {slow: 'Slow', normal: 'Normal', fast: 'Fast'};
export const SWEEP_COLORS = ['appearance', 'accent'] as const;
export type SweepColors = typeof SWEEP_COLORS[number];
export const SWEEP_COLOR_LABELS: Record<SweepColors, string> = {appearance: 'Follow appearance', accent: 'Theme accent'};

/** Cells per second the crest travels. */
const SPEED_CELLS: Record<SweepSpeed, number> = {slow: 9, normal: 14, fast: 22};
/** Soft band half-width (Gaussian sigma) in cells, and the cutoff where it is exactly zero. */
const SIGMA = 2.4;
const CUTOFF = 3.2 * SIGMA;
/** Quiet cells after the band leaves before it enters again. */
const QUIET_CELLS = 26;

export interface SweepCell {
  glyph: string;
  /** The cell's base foreground; undefined cells (spaces, uncolored) never change. */
  color?: Rgb;
  /** A semantic cell (success, warning, failure, info): Preserve keeps its hue. */
  semantic?: boolean;
}

export interface SweepStyle {
  level: SweepLevel;
  speed: SweepSpeed;
  /**
   * Tint at a position 0..1 along the text (the Chroma gradient, or the theme
   * accent); undefined means luminance only.
   */
  tint?: (position: number) => Rgb;
  /** Chroma participation: 'override' lets semantic cells take the tint too. */
  semantic: 'preserve' | 'override';
  /** Grayscale chrome: luminance only, never a colored fringe. */
  grayscale: boolean;
}

const LIFT: Record<Exclude<SweepLevel, 'off'>, number> = {subtle: 0.42, vivid: 0.66};
const TINT: Record<Exclude<SweepLevel, 'off'>, number> = {subtle: 0.18, vivid: 0.5};

/** Total cells one cycle travels: in from the left edge, across, out, then a quiet stretch. */
export function sweepTravel(width: number): number {
  return Math.max(1, width) + 2 * CUTOFF + QUIET_CELLS;
}

export function sweepCycleMs(width: number, speed: SweepSpeed): number {
  return sweepTravel(width) / SPEED_CELLS[speed] * 1000;
}

/** Crest position (in cells, may be off either edge) at `time`. */
export function sweepCrest(width: number, time: number, speed: SweepSpeed): number {
  const travel = sweepTravel(width);
  const cells = (Math.max(0, time) / 1000) * SPEED_CELLS[speed];
  return ((cells % travel) + travel) % travel - CUTOFF;
}

/** Smooth bell envelope 0..1 at a cell; exactly 0 beyond the cutoff. */
export function sweepEnvelope(column: number, crest: number): number {
  const distance = Math.abs(column - crest);
  if (distance >= CUTOFF) return 0;
  return Math.exp(-((distance / SIGMA) ** 2));
}

/** The swept color of one cell at intensity `envelope` (0 returns the base object itself). */
export function sweepColor(base: Rgb, envelope: number, position: number, style: SweepStyle, semantic = false): Rgb {
  if (style.level === 'off' || envelope <= 0) return base;
  let target = base;
  if (!style.grayscale && style.tint) {
    // Chroma or accent tint: full participation, or a faint compatible touch for preserved semantic cells.
    const amount = TINT[style.level] * (semantic && style.semantic === 'preserve' ? 0.15 : 1);
    target = mixOklch(base, style.tint(position), amount);
  }
  const lch = toOklch(target);
  const baseChroma = toOklch(base).c;
  const boost = style.grayscale ? 0 : style.level === 'vivid' ? 0.03 : 0.015;
  // Light, not white: lift toward a ceiling below white and keep at least the cell's own colorfulness.
  const lifted = fromOklch({l: lch.l + LIFT[style.level] * (0.9 - lch.l),
    c: style.grayscale ? lch.c : Math.min(0.32, Math.max(lch.c, baseChroma) + boost), h: lch.h});
  return mixOklch(base, lifted, Math.min(1, envelope));
}

/**
 * Paints cells with the sweep at `time`. `still` (Reduced Motion) and
 * `level: 'off'` paint the base colors; NO_COLOR returns the plain glyphs.
 */
export function sweepCells(cells: readonly SweepCell[], time: number, style: SweepStyle, colorLevel: ColorLevel, still = false): string {
  if (colorLevel === 'none') return cells.map(cell => cell.glyph).join('');
  const width = cells.reduce((sum, cell) => sum + displayWidth(cell.glyph), 0);
  const crest = still || style.level === 'off' ? Number.NEGATIVE_INFINITY : sweepCrest(width, time, style.speed);
  let column = 0;
  let out = '';
  for (const cell of cells) {
    const center = column + (displayWidth(cell.glyph) - 1) / 2;
    if (cell.color) {
      const color = sweepColor(cell.color, sweepEnvelope(center, crest), width <= 1 ? 0 : center / (width - 1), style, cell.semantic);
      out += `${colorEscape(38, color, colorLevel)}${cell.glyph}`;
    } else out += `\u001B[39m${cell.glyph}`;
    column += displayWidth(cell.glyph);
  }
  return `${out}\u001B[39m`;
}

/** Whether a sweep at these settings needs presentation frames at all. */
export function sweepAnimates(level: SweepLevel, still: boolean, colorLevel: ColorLevel): boolean {
  return level !== 'off' && !still && colorLevel !== 'none';
}

// ---- One-shot sweeps (event-driven) ---------------------------------------------

/**
 * A one-shot sweep crosses the text once: it enters just before the first
 * cell and fully leaves past the last within `durationMs`, then everything is
 * exactly the base color again. Selection, value changes, submit and
 * confirmations each start one; a new one replaces the old (no queue).
 */
export function sweepDurationMs(width: number): number {
  return Math.round(Math.max(600, Math.min(1200, 520 + 11 * Math.max(1, width))));
}

/** Crest position for a one-shot sweep at `elapsed` ms; past the end it is beyond the cutoff. */
export function oneShotCrest(width: number, elapsed: number, durationMs = sweepDurationMs(width)): number {
  const start = -CUTOFF, end = Math.max(1, width) - 1 + CUTOFF;
  if (elapsed <= 0) return start - 1;
  if (elapsed >= durationMs) return end + 1;
  // Gentle ease so the band glides in and out rather than starting abruptly.
  const t = elapsed / durationMs;
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return start + (end - start) * (0.15 * t + 0.85 * eased);
}

/** Paint cells at one point of a one-shot sweep (no motion when `still`). */
export function sweepOnce(cells: readonly SweepCell[], elapsed: number, style: SweepStyle, colorLevel: ColorLevel, still = false, durationMs?: number): string {
  const width = cells.reduce((sum, cell) => sum + displayWidth(cell.glyph), 0);
  return paintAtCrest(cells, still || style.level === 'off' ? Number.NEGATIVE_INFINITY : oneShotCrest(width, elapsed, durationMs ?? sweepDurationMs(width)), style, colorLevel);
}

function paintAtCrest(cells: readonly SweepCell[], crest: number, style: SweepStyle, colorLevel: ColorLevel): string {
  if (colorLevel === 'none') return cells.map(cell => cell.glyph).join('');
  const width = cells.reduce((sum, cell) => sum + displayWidth(cell.glyph), 0);
  let column = 0;
  let out = '';
  for (const cell of cells) {
    const center = column + (displayWidth(cell.glyph) - 1) / 2;
    if (cell.color) out += `${colorEscape(38, sweepColor(cell.color, sweepEnvelope(center, crest), width <= 1 ? 0 : center / (width - 1), style, cell.semantic), colorLevel)}${cell.glyph}`;
    else out += `\u001B[39m${cell.glyph}`;
    column += displayWidth(cell.glyph);
  }
  return `${out}\u001B[39m`;
}

// ---- Sweeping an already-rendered NMSh row ---------------------------------------

const SGR = /^\u001B\[([0-9;]*)m/u;
const OTHER_ESCAPE = /^\u001B(?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~])/u;

function xterm256Rgb(index: number): Rgb | undefined {
  if (index < 16) return undefined;
  if (index >= 232) { const level = 8 + (index - 232) * 10; return {red: level, green: level, blue: level}; }
  const levels = [0, 95, 135, 175, 215, 255];
  const cube = index - 16;
  return {red: levels[Math.floor(cube / 36)]!, green: levels[Math.floor(cube / 6) % 6]!, blue: levels[cube % 6]!};
}

/** Foreground after applying an SGR parameter list; undefined is the terminal default. */
function applySgr(params: number[], current: Rgb | undefined): Rgb | undefined {
  let fg = current;
  for (let index = 0; index < params.length; index++) {
    const value = params[index]!;
    if (value === 0 || value === 39) fg = undefined;
    else if (value === 38 && params[index + 1] === 2) { fg = {red: params[index + 2] ?? 0, green: params[index + 3] ?? 0, blue: params[index + 4] ?? 0}; index += 4; }
    else if (value === 38 && params[index + 1] === 5) { fg = xterm256Rgb(params[index + 2] ?? 0); index += 2; }
    else if (value === 48) index += params[index + 1] === 2 ? 4 : 2;
  }
  return fg;
}

/**
 * The one-shot sweep over a row NMSh already rendered (a selected Settings or
 * Setup Cat row, a palette item, the prompt row). Every escape and glyph is
 * kept; cells under the band get a new foreground followed by their original
 * one, so backgrounds, bold and spacing are untouched. Cells with the
 * terminal-default foreground are left as they are. `from`..`to` limit the
 * swept columns (e.g. label and value, not the whole width).
 */
export function sweepAnsiRow(row: string, elapsed: number, style: SweepStyle, colorLevel: ColorLevel, range?: {from: number; to: number},
  durationMs?: number): string {
  if (colorLevel === 'none' || colorLevel === 'ansi16' || style.level === 'off') return row;
  const from = range?.from ?? 0;
  const to = range?.to ?? displayWidth(row);
  const width = Math.max(1, to - from);
  const crest = oneShotCrest(width, elapsed, durationMs ?? sweepDurationMs(width));
  if (crest < -CUTOFF || crest > width - 1 + CUTOFF) return row;
  let out = '';
  let fg: Rgb | undefined;
  let fgEscape = '';
  let column = 0;
  let index = 0;
  while (index < row.length) {
    if (row[index] === '\u001B') {
      const sgr = SGR.exec(row.slice(index));
      if (sgr) {
        fg = applySgr(sgr[1] ? sgr[1].split(';').map(Number) : [0], fg);
        if (fg === undefined) fgEscape = '\u001B[39m';
        else if (/(^|;)38;/u.test(sgr[1] ?? '')) fgEscape = colorEscape(38, fg, colorLevel);
        out += sgr[0]; index += sgr[0].length; continue;
      }
      const other = OTHER_ESCAPE.exec(row.slice(index));
      if (other) { out += other[0]; index += other[0].length; continue; }
    }
    const codePoint = row.codePointAt(index)!;
    const glyph = String.fromCodePoint(codePoint);
    index += glyph.length;
    const cellWidth = displayWidth(glyph);
    const local = column - from + (cellWidth - 1) / 2;
    const envelope = column >= from && column < to ? sweepEnvelope(local, crest) : 0;
    if (fg && envelope > 0 && glyph.trim()) {
      out += `${colorEscape(38, sweepColor(fg, envelope, local / Math.max(1, width - 1), style), colorLevel)}${glyph}${fgEscape || colorEscape(38, fg, colorLevel)}`;
    } else out += glyph;
    column += cellWidth;
  }
  return out;
}
