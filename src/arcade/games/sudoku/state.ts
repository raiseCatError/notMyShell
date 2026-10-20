import type {Difficulty} from './generator.js';
import {ALL, CELLS, PEERS, UNITS, bit, candidates, column, conflicting, findSingle, isSolved, popcount, row, unitsOf, type Grid} from './solver.js';

/** One undoable step: every cell it touched, before and after. A hint and a digit that clears peer notes are one step. */
export interface Change { cell: number; value0: number; notes0: number; value1: number; notes1: number }
export interface Action { changes: Change[]; cursor0: number; cursor1: number }

const HISTORY_LIMIT = 500;
const UNIT_NAMES = ['row', 'column', 'box'] as const;

export interface HintResult { cell: number; digit: number; message: string }

/** Everything `persist()` writes for an unfinished puzzle (see record.ts for the validated form). */
export interface Saved { difficulty: Difficulty; puzzle: string; solution: string; entries: string; notes: number[]; elapsedMs: number; hints: number }

/**
 * The rules and the person's progress, without any drawing or clock. `puzzle` (the clues) and `solution` are copies
 * made at construction and are never written again: entries, notes, hints and undo only ever touch `entries`/`notes`.
 */
export class SudokuState {
  readonly puzzle: Grid;
  readonly solution: Grid;
  /** The person's digits only (0 on clues and empty cells). */
  readonly entries: Grid = new Uint8Array(CELLS);
  /** Pencil marks as 9-bit masks (bit 0 = digit 1). */
  readonly notes: Uint16Array = new Uint16Array(CELLS);
  /** Clues and entries together, kept in step with `entries`. */
  readonly grid: Grid;
  cursor = 40;
  notesMode = false;
  hints = 0;
  elapsedMs = 0;
  private undoStack: Action[] = [];
  private redoStack: Action[] = [];

  constructor(readonly difficulty: Difficulty, puzzle: Grid, solution: Grid) {
    this.puzzle = Uint8Array.from(puzzle);
    this.solution = Uint8Array.from(solution);
    this.grid = Uint8Array.from(puzzle);
  }

  static fromSaved(saved: Saved): SudokuState {
    const state = new SudokuState(saved.difficulty, Uint8Array.from(saved.puzzle, Number), Uint8Array.from(saved.solution, Number));
    for (let cell = 0; cell < CELLS; cell += 1) {
      const digit = Number(saved.entries[cell]);
      state.entries[cell] = digit;
      state.grid[cell] = state.puzzle[cell] || digit;
      state.notes[cell] = digit ? 0 : saved.notes[cell]! & ALL;
    }
    state.hints = saved.hints;
    state.elapsedMs = saved.elapsedMs;
    state.cursor = Math.max(0, state.grid.indexOf(0));
    return state;
  }

  toSaved(): Saved {
    return {
      difficulty: this.difficulty, puzzle: this.puzzle.join(''), solution: this.solution.join(''), entries: this.entries.join(''),
      notes: Array.from(this.notes), elapsedMs: Math.floor(this.elapsedMs), hints: this.hints,
    };
  }

  isClue(cell: number): boolean { return this.puzzle[cell] !== 0; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get started(): boolean { return this.undoStack.length > 0 || this.elapsedMs > 0; }
  get solved(): boolean { return isSolved(this.grid); }
  conflicts(): boolean[] { return conflicting(this.grid); }

  /** How many of each digit are on the board (clues and entries), index 1..9. */
  counts(): number[] {
    const counts = new Array<number>(10).fill(0);
    for (const digit of this.grid) counts[digit] = counts[digit]! + 1;
    return counts;
  }

  moveTo(cell: number): void { this.cursor = Math.max(0, Math.min(CELLS - 1, cell)); }
  move(dRow: number, dColumn: number): void {
    this.cursor = Math.max(0, Math.min(8, row(this.cursor) + dRow)) * 9 + Math.max(0, Math.min(8, column(this.cursor) + dColumn));
  }

  // ---- edits --------------------------------------------------------------------------------------------------

  /** Number key: a digit in the cursor cell, or a pencil mark in notes mode. Returns whether anything changed. */
  enter(digit: number): boolean {
    const cell = this.cursor;
    if (digit < 1 || digit > 9 || this.isClue(cell)) return false;
    if (this.notesMode) {
      if (this.grid[cell]) return false;
      return this.apply([{cell, value0: 0, notes0: this.notes[cell]!, value1: 0, notes1: this.notes[cell]! ^ bit(digit)}]);
    }
    if (this.grid[cell] === digit) return false;
    return this.apply(this.placement(cell, digit));
  }

  /** Erase the cursor cell's digit, or its notes when it has no digit. Clues are never erased. */
  erase(): boolean {
    const cell = this.cursor;
    if (this.isClue(cell)) return false;
    if (this.entries[cell]) return this.apply([{cell, value0: this.entries[cell]!, notes0: 0, value1: 0, notes1: 0}]);
    if (this.notes[cell]) return this.apply([{cell, value0: 0, notes0: this.notes[cell]!, value1: 0, notes1: 0}]);
    return false;
  }

  /** The change list for placing `digit`: the cell itself, and the same digit struck from its peers' notes. */
  private placement(cell: number, digit: number): Change[] {
    const changes: Change[] = [{cell, value0: this.entries[cell]!, notes0: this.notes[cell]!, value1: digit, notes1: 0}];
    for (const peer of PEERS[cell]!) {
      if (this.notes[peer]! & bit(digit)) changes.push({cell: peer, value0: this.entries[peer]!, notes0: this.notes[peer]!, value1: this.entries[peer]!, notes1: this.notes[peer]! & ~bit(digit)});
    }
    return changes;
  }

  private apply(changes: Change[], cursor1 = this.cursor): boolean {
    const action: Action = {changes, cursor0: this.cursor, cursor1};
    this.run(action, true);
    this.undoStack.push(action);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  private run(action: Action, forward: boolean): void {
    for (const change of forward ? action.changes : [...action.changes].reverse()) {
      const value = forward ? change.value1 : change.value0;
      this.entries[change.cell] = value;
      this.grid[change.cell] = this.puzzle[change.cell] || value;
      this.notes[change.cell] = forward ? change.notes1 : change.notes0;
    }
    this.cursor = forward ? action.cursor1 : action.cursor0;
  }

  undo(): boolean {
    const action = this.undoStack.pop();
    if (!action) return false;
    this.run(action, false);
    this.redoStack.push(action);
    return true;
  }

  redo(): boolean {
    const action = this.redoStack.pop();
    if (!action) return false;
    this.run(action, true);
    this.undoStack.push(action);
    return true;
  }

  /** Back to the clues: entries, notes, hints and the clock, with history cleared. */
  restart(): void {
    this.entries.fill(0);
    this.notes.fill(0);
    this.grid.set(this.puzzle);
    this.undoStack = [];
    this.redoStack = [];
    this.hints = 0;
    this.elapsedMs = 0;
    this.cursor = Math.max(0, this.puzzle.indexOf(0));
    this.notesMode = false;
  }

  // ---- hints --------------------------------------------------------------------------------------------------

  /** The digits the person has right so far, as a grid: clues plus entries that match the solution. */
  private known(): Grid {
    const known = Uint8Array.from(this.puzzle);
    for (let cell = 0; cell < CELLS; cell += 1) if (this.entries[cell] === this.solution[cell]) known[cell] = this.entries[cell]!;
    return known;
  }

  private open(cell: number): boolean { return !this.isClue(cell) && this.grid[cell] !== this.solution[cell]; }

  /**
   * A hint: fills one cell with its correct digit and says why. It uses the cursor cell when that cell is wrong or
   * empty; otherwise it moves to the next cell a naked or hidden single settles, falling back to the first open cell.
   * It is one undo step, counts once, and writes only `entries`/`notes` (never the clues or the stored solution).
   */
  hint(): HintResult | undefined {
    const known = this.known();
    let cell = this.open(this.cursor) ? this.cursor : -1;
    if (cell < 0) {
      const single = findSingle(known, true);
      if (single && this.open(single.cell)) cell = single.cell;
    }
    if (cell < 0) for (let index = 0; index < CELLS && cell < 0; index += 1) if (this.open(index) && this.entries[index] !== this.solution[index]) cell = index;
    if (cell < 0) return undefined;
    const digit = this.solution[cell]!;
    const changes = this.placement(cell, digit);
    this.apply(changes, cell);
    this.hints += 1;
    return {cell, digit, message: `R${row(cell) + 1}C${column(cell) + 1} is ${digit}: ${this.explain(known, cell, digit)}`};
  }

  private explain(known: Grid, cell: number, digit: number): string {
    if (popcount(candidates(known, cell)) === 1) return `only ${digit} fits this cell`;
    const units = unitsOf(cell);
    for (let index = 0; index < 3; index += 1) {
      const spots = UNITS[units[index]!]!.filter(other => !known[other] && candidates(known, other) & bit(digit));
      if (spots.length === 1 && !UNITS[units[index]!]!.some(other => known[other] === digit)) return `the only ${digit} left in its ${UNIT_NAMES[index]}`;
    }
    return `the solution has ${digit} here`;
  }

  /** Whether the grid still matches the solution everywhere it is filled (used by tests; the game never shows it). */
  consistent(): boolean { return this.grid.every((digit, cell) => !digit || digit === this.solution[cell]); }
}
