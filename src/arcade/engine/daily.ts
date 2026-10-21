import {hashSeed} from '../rng.js';

/**
 * Daily challenges, entirely offline: the day is the person's local calendar date, and the puzzle for it comes from a
 * seed derived from that date and the game's id. Restarting NMSh, reopening the game or going offline cannot change it;
 * only the date can. Two people on the same date get the same puzzle without anything being shared.
 */

/** `YYYY-MM-DD` for `time` in the local time zone. */
export function localDateKey(time: number | Date): string {
  const date = typeof time === 'number' ? new Date(time) : time;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The seed for `gameId`'s puzzle on `day` (a `YYYY-MM-DD` key). */
export function dailySeed(gameId: string, day: string): number {
  return hashSeed(`nmsh-daily:${gameId}:${day}`);
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`), for streaks and puzzle numbers; time zones and DST do not matter. */
export function daysBetween(from: string, to: string): number {
  const parse = (key: string) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y!, m! - 1, d!); };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** Whether `key` is a well-formed calendar date key. */
export function isDateKey(key: unknown): key is string {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}
