import type {Key} from '../terminal/keys.js';
import {displayWidth, truncateText} from '../util/text.js';
import type {Canvas} from './Canvas.js';
import type {ArcadeLook} from './look.js';
import type {GameRecordHandle} from './scores.js';

/**
 * Small pieces every new arcade game shares, so thirty games do not each re-invent them: the record of a score game
 * (read defensively, written once per finished run), direction keys (arrows, WASD and hjkl), and the game's own top row
 * and ready text drawn in the Arcade's look.
 */

/** A non-negative whole number from untrusted saved data, or 0. */
export const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 1_000_000_000) : 0);

export interface ScoreRecord { best: number; plays: number }

export function readScore(raw: Readonly<Record<string, unknown>>): ScoreRecord {
  return {best: count(raw.best), plays: count(raw.plays)};
}

/**
 * Save a finished run: the best score, one more play, and each `extra` field kept at its maximum. Returns whether the
 * score beat the best from before the run (a first run with a positive score counts).
 */
export function saveScore(handle: GameRecordHandle, score: number, extra: Readonly<Record<string, number>> = {}): {record: boolean; best: number; plays: number} {
  const before = readScore(handle.get());
  const best = Math.max(before.best, score);
  const plays = before.plays + 1;
  handle.update(record => {
    record.best = best;
    record.plays = plays;
    for (const [key, value] of Object.entries(extra)) record[key] = Math.max(count(record[key]), count(value));
  });
  return {record: score > 0 && score > before.best, best, plays};
}

/** The summary line the hub shows for a score game. */
export function scoreSummary(raw: Readonly<Record<string, unknown>>, unit = ''): string {
  const saved = readScore(raw);
  return saved.plays > 0 ? `Best ${saved.best.toLocaleString('en-US')}${unit}` : 'Not played yet';
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/** The direction a key means: arrows, WASD or hjkl. */
export function direction(key: Key): Direction | undefined {
  if (key.kind === 'up' || key.kind === 'down' || key.kind === 'left' || key.kind === 'right') return key.kind;
  if (key.kind !== 'text') return undefined;
  const value = key.value.toLowerCase();
  return ({w: 'up', k: 'up', s: 'down', j: 'down', a: 'left', h: 'left', d: 'right', l: 'right'} as const)[value as 'w'];
}

export const isSpace = (key: Key): boolean => key.kind === 'text' && key.value === ' ';
export const isConfirm = (key: Key): boolean => key.kind === 'enter' || isSpace(key);

/** The game's own top row: a title on the left, live figures on the right. */
export function topRow(canvas: Canvas, look: ArcadeLook, left: string, right: string, bg = look.surface.base): void {
  canvas.fill(0, 0, canvas.width, 1, ' ', {bg});
  canvas.text(1, 0, truncateText(left, Math.max(1, canvas.width - 2)), {fg: look.text.strong, bg, bold: true});
  const room = canvas.width - displayWidth(left) - 4;
  if (room > 4) {
    const text = truncateText(right, room);
    canvas.text(canvas.width - 1 - displayWidth(text), 0, text, {fg: look.text.normal, bg});
  }
}

/** The ready screen's centered title and prompt lines over the playfield. */
export function readyText(canvas: Canvas, look: ArcadeLook, title: string, lines: readonly string[], y = Math.floor(canvas.height / 3)): void {
  canvas.center(y, title, {fg: look.text.strong, bold: true});
  lines.forEach((line, index) => canvas.center(y + 1 + index, truncateText(line, canvas.width - 2), {fg: index === 0 ? look.accent : look.text.normal, bold: index === 0}));
}
