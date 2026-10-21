import {daysBetween, isDateKey} from '../../engine/daily.js';
import {count} from '../../kit.js';
import {createRng} from '../../rng.js';
import {ANSWERS, GUESSES} from './words.js';

/**
 * Purrword's rules. Six tries to find a five-letter word. Each guess marks its letters: in the right place, in the word
 * but elsewhere, or not in it. Repeated letters count: a letter is marked present only as many times as the answer still
 * has it after the exact matches. The daily word comes from the local date alone (a fixed shuffle of the answers, one
 * per day from an epoch), so restarting, reopening or being offline cannot change it; practice words are random.
 */
export const LENGTH = 5;
export const TRIES = 6;
export const EPOCH = '2026-01-01';

export type Mark = 'correct' | 'present' | 'absent';

const split = (text: string): string[] => Array.from({length: text.length / LENGTH}, (_, index) => text.slice(index * LENGTH, index * LENGTH + LENGTH));
export const answers: readonly string[] = split(ANSWERS);
const guesses: readonly string[] = split(GUESSES);
const accepted = new Set(guesses);

export function isWord(word: string): boolean { return accepted.has(word); }

/** The marks for `guess` against `answer`. */
export function score(guess: string, answer: string): Mark[] {
  const marks: Mark[] = Array<Mark>(LENGTH).fill('absent');
  const left = new Map<string, number>();
  for (let index = 0; index < LENGTH; index += 1) {
    if (guess[index] === answer[index]) marks[index] = 'correct';
    else left.set(answer[index]!, (left.get(answer[index]!) ?? 0) + 1);
  }
  for (let index = 0; index < LENGTH; index += 1) {
    if (marks[index] === 'correct') continue;
    const remaining = left.get(guess[index]!) ?? 0;
    if (remaining > 0) { marks[index] = 'present'; left.set(guess[index]!, remaining - 1); }
  }
  return marks;
}

/** The answers in the fixed daily order: a seeded shuffle, so consecutive days are unrelated words. */
const order: readonly string[] = createRng('purrword-daily-order').shuffle(answers);

/** The daily number (1 on the epoch) and its word for a local date key. */
export function daily(day: string): {number: number; word: string} {
  const offset = Math.max(0, daysBetween(EPOCH, day));
  return {number: offset + 1, word: order[offset % order.length]!};
}

export interface Round { answer: string; guesses: string[]; daily: string | undefined }

export function solved(round: Round): boolean { return round.guesses.at(-1) === round.answer; }
export function finished(round: Round): boolean { return solved(round) || round.guesses.length >= TRIES; }

/** The best mark seen for each letter so far, for the keyboard. */
export function letterMarks(round: Round): Map<string, Mark> {
  const rank: Record<Mark, number> = {absent: 0, present: 1, correct: 2};
  const marks = new Map<string, Mark>();
  for (const guess of round.guesses) score(guess, round.answer).forEach((mark, index) => {
    const letter = guess[index]!;
    const before = marks.get(letter);
    if (!before || rank[mark] > rank[before]) marks.set(letter, mark);
  });
  return marks;
}

// ---- saved statistics ---------------------------------------------------------------------------------------------

export interface Stats {
  played: number; won: number; streak: number; bestStreak: number;
  /** Wins by number of guesses (index 0 = in one). */
  spread: number[];
  /** The last daily finished: its date and whether it was solved. */
  lastDaily: string | undefined; lastDailyWon: boolean;
  /** Today's daily in progress (so leaving and coming back resumes it). */
  current: {day: string; guesses: string[]} | undefined;
}

export function readStats(raw: Readonly<Record<string, unknown>>): Stats {
  const spread = Array.isArray(raw.spread) ? raw.spread.slice(0, TRIES).map(count) : [];
  while (spread.length < TRIES) spread.push(0);
  const current = raw.current as {day?: unknown; guesses?: unknown} | undefined;
  const validCurrent = current && isDateKey(current.day) && Array.isArray(current.guesses) && current.guesses.length < TRIES
    && current.guesses.every(word => typeof word === 'string' && isWord(word)) ? {day: current.day as string, guesses: current.guesses as string[]} : undefined;
  return {
    played: count(raw.played), won: count(raw.won), streak: count(raw.streak), bestStreak: count(raw.bestStreak), spread,
    lastDaily: isDateKey(raw.lastDaily) ? raw.lastDaily : undefined, lastDailyWon: raw.lastDailyWon === true, current: validCurrent,
  };
}

/** The stats after finishing `round`. Only dailies keep the streak; a missed day breaks it. */
export function afterRound(stats: Stats, round: Round): Stats {
  const won = solved(round);
  const next: Stats = {...stats, spread: [...stats.spread], played: stats.played + 1, won: stats.won + (won ? 1 : 0), current: undefined};
  if (won) next.spread[round.guesses.length - 1] = (next.spread[round.guesses.length - 1] ?? 0) + 1;
  if (round.daily) {
    const consecutive = stats.lastDaily !== undefined && stats.lastDailyWon && daysBetween(stats.lastDaily, round.daily) === 1;
    next.streak = won ? (consecutive ? stats.streak + 1 : 1) : 0;
    next.bestStreak = Math.max(stats.bestStreak, next.streak);
    next.lastDaily = round.daily;
    next.lastDailyWon = won;
  }
  return next;
}

export function writeStats(raw: Record<string, unknown>, stats: Stats): void {
  raw.played = stats.played; raw.won = stats.won; raw.streak = stats.streak; raw.bestStreak = stats.bestStreak; raw.spread = stats.spread;
  if (stats.lastDaily) { raw.lastDaily = stats.lastDaily; raw.lastDailyWon = stats.lastDailyWon; }
  if (stats.current) raw.current = {day: stats.current.day, guesses: stats.current.guesses}; else delete raw.current;
}
