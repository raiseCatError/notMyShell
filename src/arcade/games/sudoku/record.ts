import type {GameRecord, RecordValue} from '../../scores.js';
import {DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty} from './generator.js';
import type {Saved} from './state.js';
import {ALL, CELLS, countSolutions, isGridText, isSolved, parseGrid} from './solver.js';

/**
 * Classic Sudoku's saved record (schema v1), read defensively: the file may be empty, old or hand-edited, so every
 * field is checked and anything that fails is dropped, never trusted. A saved puzzle in progress (`current`) must be
 * a real puzzle: a valid solved grid, clues that match it, one solution, entries that leave the clues alone.
 */
export const RECORD_VERSION = 1;
const MAX_SECONDS = 99 * 3600;
const MAX_COUNT = 1_000_000;
const MAX_HINTS = 999;

export interface Stats {
  bestTimes: Partial<Record<Difficulty, number>>;
  completed: number;
  completedByDifficulty: Record<Difficulty, number>;
  streak: number;
  bestStreak: number;
}
export interface Stored extends Stats { current?: Saved }

const count = (value: unknown, max = MAX_COUNT): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : 0);
const plain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function emptyStats(): Stats {
  return {bestTimes: {}, completed: 0, completedByDifficulty: {easy: 0, medium: 0, hard: 0, expert: 0}, streak: 0, bestStreak: 0};
}

/** A saved puzzle in progress, or undefined when any part of it is wrong. */
export function readCurrent(value: unknown): Saved | undefined {
  if (!plain(value)) return undefined;
  const {difficulty, puzzle, solution, entries, notes, elapsedMs, hints} = value;
  if (typeof difficulty !== 'string' || !(DIFFICULTIES as readonly string[]).includes(difficulty)) return undefined;
  if (!isGridText(puzzle, true) || !isGridText(solution, false) || !isGridText(entries, true)) return undefined;
  if (!Array.isArray(notes) || notes.length !== CELLS || !notes.every(mask => typeof mask === 'number' && Number.isInteger(mask) && mask >= 0 && mask <= ALL)) return undefined;
  if (typeof elapsedMs !== 'number' || !Number.isInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > MAX_SECONDS * 1000) return undefined;
  if (typeof hints !== 'number' || !Number.isInteger(hints) || hints < 0 || hints > MAX_HINTS) return undefined;
  const solved = parseGrid(solution);
  if (!isSolved(solved)) return undefined;
  const merged = new Uint8Array(CELLS);
  for (let cell = 0; cell < CELLS; cell += 1) {
    const clue = Number(puzzle[cell]);
    const entry = Number(entries[cell]);
    if (clue && clue !== solved[cell]) return undefined;
    if (clue && (entry || notes[cell] !== 0)) return undefined;
    if (entry && notes[cell] !== 0) return undefined;
    merged[cell] = clue || entry;
  }
  if (merged.every(Boolean) && isSolved(merged)) return undefined;
  if (countSolutions(parseGrid(puzzle), 2) !== 1) return undefined;
  return {difficulty: difficulty as Difficulty, puzzle, solution, entries, notes: notes as number[], elapsedMs, hints};
}

export function readRecord(raw: Readonly<Record<string, unknown>>): Stored {
  const stats = emptyStats();
  const stored: Stored = stats;
  if (raw.version !== undefined && raw.version !== RECORD_VERSION) return stored;
  if (plain(raw.bestTimes)) {
    for (const level of DIFFICULTIES) {
      const seconds = raw.bestTimes[level];
      if (typeof seconds === 'number' && Number.isInteger(seconds) && seconds > 0 && seconds <= MAX_SECONDS) stats.bestTimes[level] = seconds;
    }
  }
  if (plain(raw.completedByDifficulty)) for (const level of DIFFICULTIES) stats.completedByDifficulty[level] = count(raw.completedByDifficulty[level]);
  stats.completed = Math.max(count(raw.completed), DIFFICULTIES.reduce((sum, level) => sum + stats.completedByDifficulty[level], 0));
  stats.streak = count(raw.streak);
  stats.bestStreak = Math.max(count(raw.bestStreak), stats.streak);
  const current = readCurrent(raw.current);
  if (current) stored.current = current;
  return stored;
}

/** The record as plain JSON for the store. */
export function writeRecord(stored: Stored): GameRecord {
  const record: GameRecord = {
    version: RECORD_VERSION,
    bestTimes: {...stored.bestTimes} as {[key: string]: RecordValue},
    completed: stored.completed,
    completedByDifficulty: {...stored.completedByDifficulty},
    streak: stored.streak,
    bestStreak: stored.bestStreak,
  };
  if (stored.current) record.current = {...stored.current, notes: [...stored.current.notes]};
  return record;
}

export function formatTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** The hub's one-line summary. */
export function summarize(raw: Readonly<Record<string, unknown>>): string {
  const stored = readRecord(raw);
  const times = DIFFICULTIES.filter(level => stored.bestTimes[level] !== undefined);
  if (stored.current) return `In progress: ${DIFFICULTY_LABEL[stored.current.difficulty]} ${formatTime(stored.current.elapsedMs / 1000)}`;
  if (!stored.completed) return 'Not played yet';
  const top = times[times.length - 1];
  const best = top ? ` · best ${DIFFICULTY_LABEL[top]} ${formatTime(stored.bestTimes[top]!)}` : '';
  return `${stored.completed} solved${best}`;
}

/** Statistics after a win. A time is a personal best only when no hints were used and it beats the old one. */
export function recordWin(stats: Stats, difficulty: Difficulty, seconds: number, hints: number): {stats: Stats; record: boolean} {
  const next: Stats = {...stats, bestTimes: {...stats.bestTimes}, completedByDifficulty: {...stats.completedByDifficulty}};
  const old = next.bestTimes[difficulty];
  const record = hints === 0 && (old === undefined || seconds < old);
  if (record) next.bestTimes[difficulty] = Math.max(1, Math.min(MAX_SECONDS, seconds));
  next.completed = Math.min(MAX_COUNT, next.completed + 1);
  next.completedByDifficulty[difficulty] = Math.min(MAX_COUNT, next.completedByDifficulty[difficulty] + 1);
  next.streak = Math.min(MAX_COUNT, next.streak + 1);
  next.bestStreak = Math.max(next.bestStreak, next.streak);
  return {stats: next, record};
}
