import type {Rng} from '../../rng.js';

/**
 * Sudoku rules and an independent solver. A grid is 81 digits (0 = empty), row by row. Nothing here draws or reads
 * the clock: the generator, the game state, the persistence checks and the tests all share these functions, and the
 * tests use the solver to prove the generator's puzzles have exactly one solution.
 */
export type Grid = Uint8Array;

export const CELLS = 81;
export const ALL = 0x1ff;
export const row = (cell: number): number => Math.floor(cell / 9);
export const column = (cell: number): number => cell % 9;
export const box = (cell: number): number => Math.floor(row(cell) / 3) * 3 + Math.floor(column(cell) / 3);

/** The 9 cells of each unit: rows 0..8, columns 9..17, boxes 18..26. */
export const UNITS: readonly (readonly number[])[] = (() => {
  const units: number[][] = [];
  for (let r = 0; r < 9; r += 1) units.push(Array.from({length: 9}, (_, c) => r * 9 + c));
  for (let c = 0; c < 9; c += 1) units.push(Array.from({length: 9}, (_, r) => r * 9 + c));
  for (let b = 0; b < 9; b += 1) units.push(Array.from({length: 9}, (_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3)));
  return units;
})();

export const unitsOf = (cell: number): readonly [number, number, number] => [row(cell), 9 + column(cell), 18 + box(cell)];

export const PEERS: readonly (readonly number[])[] = Array.from({length: CELLS}, (_, cell) => {
  const peers = new Set<number>();
  for (const unit of unitsOf(cell)) for (const other of UNITS[unit]!) if (other !== cell) peers.add(other);
  return [...peers];
});

export const bit = (digit: number): number => 1 << (digit - 1);
export const popcount = (mask: number): number => { let count = 0; for (let m = mask; m; m &= m - 1) count += 1; return count; };
const lowestDigit = (mask: number): number => 32 - Math.clz32(mask & -mask);

export function parseGrid(text: string): Grid {
  const grid = new Uint8Array(CELLS);
  for (let index = 0; index < CELLS; index += 1) grid[index] = Number(text[index] ?? 0);
  return grid;
}
export const gridString = (grid: Grid): string => Array.from(grid, digit => String(digit)).join('');
export const isGridText = (text: unknown, allowEmpty: boolean): text is string => typeof text === 'string' && (allowEmpty ? /^[0-9]{81}$/u : /^[1-9]{81}$/u).test(text);

/** Digits not yet used by a cell's peers (the cell's own digit is ignored). */
export function candidates(grid: Grid, cell: number): number {
  let used = 0;
  for (const peer of PEERS[cell]!) { const digit = grid[peer]!; if (digit) used |= bit(digit); }
  return ALL & ~used;
}

/** Cells that share a digit with a peer. */
export function conflicting(grid: Grid): boolean[] {
  const bad = new Array<boolean>(CELLS).fill(false);
  for (const unit of UNITS) {
    const seen = new Array<number>(10).fill(-1);
    for (const cell of unit) {
      const digit = grid[cell]!;
      if (!digit) continue;
      if (seen[digit]! >= 0) { bad[cell] = true; bad[seen[digit]!] = true; } else seen[digit] = cell;
    }
  }
  return bad;
}

/** Every cell filled and every row, column and box holds each digit once. */
export function isSolved(grid: Grid): boolean {
  for (const unit of UNITS) {
    let seen = 0;
    for (const cell of unit) { const digit = grid[cell]!; if (digit < 1 || digit > 9) return false; seen |= bit(digit); }
    if (seen !== ALL) return false;
  }
  return true;
}

/** A unit is complete when it holds 1..9 once each (used for the soft completion highlight). */
export const unitComplete = (grid: Grid, unit: number): boolean => {
  let seen = 0;
  for (const cell of UNITS[unit]!) { const digit = grid[cell]!; if (!digit) return false; seen |= bit(digit); }
  return seen === ALL;
};

/**
 * Backtracking with candidate bitmasks and the fewest-candidates cell first. Counts solutions up to `limit` (2 is
 * enough to prove uniqueness). `onSolution` receives the first solution found. A grid whose givens already clash has
 * none.
 */
export function countSolutions(input: Grid, limit = 2, onSolution?: (solution: Grid) => void): number {
  const grid = Uint8Array.from(input);
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);
  for (let cell = 0; cell < CELLS; cell += 1) {
    const digit = grid[cell]!;
    if (!digit) continue;
    const b = bit(digit);
    if ((rows[row(cell)]! | cols[column(cell)]! | boxes[box(cell)]!) & b) return 0;
    rows[row(cell)]! |= b; cols[column(cell)]! |= b; boxes[box(cell)]! |= b;
  }
  let found = 0;
  const search = (): void => {
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (grid[cell]) continue;
      const mask = ALL & ~(rows[row(cell)]! | cols[column(cell)]! | boxes[box(cell)]!);
      const count = popcount(mask);
      if (count < bestCount) { best = cell; bestMask = mask; bestCount = count; if (count <= 1) break; }
    }
    if (best < 0) { found += 1; if (found === 1) onSolution?.(Uint8Array.from(grid)); return; }
    for (let mask = bestMask; mask && found < limit; mask &= mask - 1) {
      const b = mask & -mask;
      grid[best] = lowestDigit(b);
      rows[row(best)]! |= b; cols[column(best)]! |= b; boxes[box(best)]! |= b;
      search();
      rows[row(best)]! &= ~b; cols[column(best)]! &= ~b; boxes[box(best)]! &= ~b;
      grid[best] = 0;
    }
  };
  search();
  return found;
}

export function solve(input: Grid): Grid | undefined {
  let solution: Grid | undefined;
  countSolutions(input, 1, found => { solution = found; });
  return solution;
}

/** A complete random grid: the same Rng stream always gives the same grid. */
export function randomSolved(rng: Rng): Grid {
  const grid = new Uint8Array(CELLS);
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);
  const fill = (cell: number): boolean => {
    if (cell === CELLS) return true;
    const mask = ALL & ~(rows[row(cell)]! | cols[column(cell)]! | boxes[box(cell)]!);
    const digits: number[] = [];
    for (let digit = 1; digit <= 9; digit += 1) if (mask & bit(digit)) digits.push(digit);
    for (const digit of rng.shuffle(digits)) {
      const b = bit(digit);
      grid[cell] = digit; rows[row(cell)]! |= b; cols[column(cell)]! |= b; boxes[box(cell)]! |= b;
      if (fill(cell + 1)) return true;
      rows[row(cell)]! &= ~b; cols[column(cell)]! &= ~b; boxes[box(cell)]! &= ~b; grid[cell] = 0;
    }
    return false;
  };
  fill(0);
  return grid;
}

export interface Single {
  cell: number;
  digit: number;
  /** naked: the only digit the cell can hold; hidden: the only cell in a unit that can hold the digit. */
  kind: 'naked' | 'hidden';
  /** For a hidden single, the unit (0..26) that forces it. */
  unit?: number;
}

/** The first naked (or, with `hidden`, hidden) single of a grid, scanning cells in order; naked ones come first. */
export function findSingle(grid: Grid, hidden = true): Single | undefined {
  for (let cell = 0; cell < CELLS; cell += 1) {
    if (grid[cell]) continue;
    const mask = candidates(grid, cell);
    if (popcount(mask) === 1) return {cell, digit: lowestDigit(mask), kind: 'naked'};
  }
  if (!hidden) return undefined;
  for (let unit = 0; unit < 27; unit += 1) {
    for (let digit = 1; digit <= 9; digit += 1) {
      let place = -1;
      let count = 0;
      let present = false;
      for (const cell of UNITS[unit]!) {
        if (grid[cell] === digit) { present = true; break; }
        if (!grid[cell] && candidates(grid, cell) & bit(digit)) { place = cell; count += 1; }
      }
      if (!present && count === 1) return {cell: place, digit, kind: 'hidden', unit};
    }
  }
  return undefined;
}

export interface SingleSolve { solved: boolean; steps: number; hiddenSteps: number }

/** Solve with singles only (the "human" techniques the generator grades by). A solved result implies a unique solution. */
export function solveBySingles(input: Grid, hidden: boolean): SingleSolve {
  const grid = Uint8Array.from(input);
  let steps = 0;
  let hiddenSteps = 0;
  for (;;) {
    const single = findSingle(grid, hidden);
    if (!single) break;
    grid[single.cell] = single.digit;
    steps += 1;
    if (single.kind === 'hidden') hiddenSteps += 1;
  }
  return {solved: !grid.includes(0), steps, hiddenSteps};
}
