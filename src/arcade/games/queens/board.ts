import {analyze, type Analysis} from './rules.js';
import {makePuzzle, type MadePuzzle} from './puzzle.js';
import {countSolutions} from './solver.js';
import {CAT, DIFFICULTIES, EMPTY, EXCLUDED, type Difficulty, type Puzzle} from './types.js';
import type {GameRecord, RecordValue} from '../../scores.js';

/** One change to one cell, for undo. */
interface Edit { cell: number; from: number; to: number }

const MAX_HISTORY = 400;
export const MAX_ELAPSED_MS = 99 * 3_600_000;
const MARK_CHARS = '.xc';

/** A puzzle in progress: the marks, the history, the clock's total and the hints used. Pure state, no drawing. */
export class QueensBoard {
  readonly marks: Uint8Array;
  elapsedMs = 0;
  hints = 0;
  private undoStack: Edit[][] = [];
  private redoStack: Edit[][] = [];
  private cache: Analysis | undefined;

  constructor(readonly puzzle: MadePuzzle | SavedPuzzle, marks?: Uint8Array) {
    this.marks = marks ?? new Uint8Array(puzzle.size * puzzle.size);
  }

  get size(): number { return this.puzzle.size; }
  get difficulty(): Difficulty { return this.puzzle.difficulty; }
  get seed(): number { return this.puzzle.seed; }

  analysis(): Analysis {
    this.cache ??= analyze(this.size, this.puzzle.regions, this.marks);
    return this.cache;
  }
  get solved(): boolean { return this.analysis().solved; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Set cells together as one undoable move. Placing a cat clears that cell's X. Returns whether anything changed. */
  apply(changes: ReadonlyArray<{cell: number; to: number}>): boolean {
    const edits: Edit[] = [];
    for (const {cell, to} of changes) {
      const from = this.marks[cell]!;
      if (from !== to && cell >= 0 && cell < this.marks.length) edits.push({cell, from, to});
    }
    if (!edits.length) return false;
    for (const edit of edits) this.marks[edit.cell] = edit.to;
    this.undoStack.push(edits);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.cache = undefined;
    return true;
  }

  /** Space or Enter: empty or X becomes a cat, a cat becomes empty. */
  toggleCat(cell: number): boolean { return this.apply([{cell, to: this.marks[cell] === CAT ? EMPTY : CAT}]); }
  /** `x`: empty becomes X, X becomes empty. A cat is left alone. */
  toggleExclude(cell: number): boolean {
    const mark = this.marks[cell];
    return mark === CAT ? false : this.apply([{cell, to: mark === EXCLUDED ? EMPTY : EXCLUDED}]);
  }
  /** `c`: clear every mark, as one move that undo brings back. */
  clearMarks(): boolean {
    const changes: Array<{cell: number; to: number}> = [];
    this.marks.forEach((mark, cell) => { if (mark !== EMPTY) changes.push({cell, to: EMPTY}); });
    return this.apply(changes);
  }

  undo(): boolean {
    const edits = this.undoStack.pop();
    if (!edits) return false;
    for (const edit of [...edits].reverse()) this.marks[edit.cell] = edit.from;
    this.redoStack.push(edits);
    this.cache = undefined;
    return true;
  }

  redo(): boolean {
    const edits = this.redoStack.pop();
    if (!edits) return false;
    for (const edit of edits) this.marks[edit.cell] = edit.to;
    this.undoStack.push(edits);
    this.cache = undefined;
    return true;
  }

  /** Restart the same puzzle: no marks, no history, the clock and hints back to zero. */
  restart(): void {
    this.marks.fill(EMPTY);
    this.undoStack = [];
    this.redoStack = [];
    this.elapsedMs = 0;
    this.hints = 0;
    this.cache = undefined;
  }

  /** The record's `current` entry. */
  toRecord(): RecordValue {
    return {
      difficulty: this.difficulty, seed: this.seed, size: this.size,
      regions: this.puzzle.regions.map(region => String.fromCharCode(65 + region)).join(''),
      solution: this.puzzle.solution.join(','),
      marks: Array.from(this.marks, mark => MARK_CHARS[mark] ?? '.').join(''),
      elapsedMs: Math.round(this.elapsedMs), hints: this.hints,
    };
  }
}

export interface SavedPuzzle extends Puzzle { difficulty: Difficulty; seed: number }

export function newBoard(seed: number, difficulty: Difficulty): QueensBoard { return new QueensBoard(makePuzzle(seed, difficulty)); }

// ---- reading a saved game ------------------------------------------------------------------------------------------

const isInt = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

function connected(size: number, regions: readonly number[], region: number): boolean {
  const cells = regions.flatMap((owner, cell) => (owner === region ? [cell] : []));
  const seen = new Set<number>([cells[0]!]);
  const queue = [cells[0]!];
  while (queue.length) {
    const cell = queue.pop()!;
    const row = Math.floor(cell / size);
    const column = cell % size;
    const near = [row > 0 ? cell - size : -1, row < size - 1 ? cell + size : -1, column > 0 ? cell - 1 : -1, column < size - 1 ? cell + 1 : -1];
    for (const next of near) if (next >= 0 && regions[next] === region && !seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return seen.size === cells.length;
}

/**
 * A saved `current`, or undefined when any part of it is wrong: sizes, letters, a region missing or split, a solution
 * that is not a valid placement, a layout without exactly one solution, marks that are not `.xc`, a negative clock.
 * A bad saved game is dropped whole, never repaired.
 */
export function readCurrent(value: unknown): QueensBoard | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const size = item.size;
  if (!isInt(size, 4, 12)) return undefined;
  if (typeof item.difficulty !== 'string' || !(DIFFICULTIES as readonly string[]).includes(item.difficulty)) return undefined;
  if (!isInt(item.seed, 0, 0xffffffff) || !isInt(item.hints, 0, 100_000)) return undefined;
  if (typeof item.elapsedMs !== 'number' || !Number.isFinite(item.elapsedMs) || item.elapsedMs < 0 || item.elapsedMs > MAX_ELAPSED_MS) return undefined;
  const total = size * size;
  if (typeof item.regions !== 'string' || item.regions.length !== total || typeof item.marks !== 'string' || item.marks.length !== total) return undefined;
  const regions: number[] = [];
  for (const letter of item.regions) {
    const region = letter.charCodeAt(0) - 65;
    if (region < 0 || region >= size) return undefined;
    regions.push(region);
  }
  for (let region = 0; region < size; region += 1) if (!regions.includes(region) || !connected(size, regions, region)) return undefined;
  const marks = new Uint8Array(total);
  for (let cell = 0; cell < total; cell += 1) {
    const mark = MARK_CHARS.indexOf(item.marks[cell]!);
    if (mark < 0) return undefined;
    marks[cell] = mark;
  }
  if (typeof item.solution !== 'string') return undefined;
  const parts = item.solution.split(',');
  const solution = parts.map(part => (/^\d{1,2}$/u.test(part) ? Number(part) : -1));
  if (solution.length !== size || solution.some(column => column < 0 || column >= size)) return undefined;
  const cats = new Uint8Array(total);
  solution.forEach((column, row) => { cats[row * size + column] = CAT; });
  if (!analyze(size, regions, cats).solved || countSolutions(size, regions, 2) !== 1) return undefined;
  const board = new QueensBoard({size, regions, solution, difficulty: item.difficulty as Difficulty, seed: item.seed}, marks);
  board.elapsedMs = item.elapsedMs;
  board.hints = item.hints as number;
  return board;
}

// ---- statistics ----------------------------------------------------------------------------------------------------

export interface Stats {
  bestTimes: Partial<Record<Difficulty, number>>;
  completed: number;
  completedByDifficulty: Record<Difficulty, number>;
  streak: number;
  bestStreak: number;
}

export function readStats(record: Readonly<Record<string, unknown>>): Stats {
  const count = (value: unknown): number => (isInt(value, 0, 1_000_000_000) ? value : 0);
  const stats: Stats = {bestTimes: {}, completed: count(record.completed), completedByDifficulty: {easy: 0, medium: 0, hard: 0, expert: 0}, streak: count(record.streak), bestStreak: count(record.bestStreak)};
  const times = typeof record.bestTimes === 'object' && record.bestTimes !== null ? record.bestTimes as Record<string, unknown> : {};
  const by = typeof record.completedByDifficulty === 'object' && record.completedByDifficulty !== null ? record.completedByDifficulty as Record<string, unknown> : {};
  for (const difficulty of DIFFICULTIES) {
    stats.completedByDifficulty[difficulty] = count(by[difficulty]);
    const time = times[difficulty];
    if (isInt(time, 1, MAX_ELAPSED_MS)) stats.bestTimes[difficulty] = time;
  }
  return stats;
}

export function writeStats(record: GameRecord, stats: Stats): void {
  record.bestTimes = {...stats.bestTimes} as Record<string, number>;
  record.completed = stats.completed;
  record.completedByDifficulty = {...stats.completedByDifficulty};
  record.streak = stats.streak;
  record.bestStreak = stats.bestStreak;
}

/** `m:ss`, or `h:mm:ss` past an hour. */
export function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
