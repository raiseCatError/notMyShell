import type {Rng} from '../../rng.js';
import {CELLS, countSolutions, randomSolved, solveBySingles, type Grid} from './solver.js';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
export const DIFFICULTY_LABEL: Readonly<Record<Difficulty, string>> = {easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert'};

/**
 * What each difficulty asks of the generator: a clue range and the weakest technique that must be enough.
 *  - singles: how the puzzle must be solvable by deduction alone (naked = cells with one candidate only,
 *    hidden = also digits with one place in a unit, none = any unique puzzle).
 *  - needsHidden / beyondSingles: it must not fall to the weaker technique, so each level really is harder.
 */
interface Profile { min: number; max: number; singles: 'naked' | 'hidden' | 'none'; needsHidden: boolean; beyondSingles: boolean }
export const PROFILES: Readonly<Record<Difficulty, Profile>> = {
  easy: {min: 38, max: 44, singles: 'naked', needsHidden: false, beyondSingles: false},
  medium: {min: 32, max: 36, singles: 'hidden', needsHidden: true, beyondSingles: false},
  hard: {min: 27, max: 31, singles: 'hidden', needsHidden: true, beyondSingles: false},
  expert: {min: 22, max: 27, singles: 'none', needsHidden: true, beyondSingles: true},
};

export interface Puzzle { puzzle: Grid; solution: Grid; difficulty: Difficulty }

const ATTEMPTS = 40;

function acceptable(grid: Grid, profile: Profile): boolean {
  if (profile.singles === 'naked') return solveBySingles(grid, false).solved;
  if (profile.singles === 'hidden') return solveBySingles(grid, true).solved;
  return countSolutions(grid, 2) === 1;
}

function meets(grid: Grid, profile: Profile): boolean {
  if (profile.beyondSingles && solveBySingles(grid, true).solved) return false;
  if (profile.needsHidden && !profile.beyondSingles && solveBySingles(grid, false).solved) return false;
  return true;
}

/**
 * A fresh puzzle with exactly one solution. A random solved grid loses clues two at a time (a cell and its 180 degree
 * partner, so the pattern looks tidy) while the puzzle stays solvable the way the difficulty demands; it stops at a
 * random clue count inside the difficulty's range. Everything comes from `rng`, so a seed always gives the same puzzle.
 * If forty attempts miss the profile, the closest one is returned; it is still unique and valid.
 */
export function generatePuzzle(difficulty: Difficulty, rng: Rng): Puzzle {
  const profile = PROFILES[difficulty];
  let best: {puzzle: Grid; solution: Grid; gap: number} | undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const solution = randomSolved(rng);
    const puzzle = Uint8Array.from(solution);
    const target = rng.int(profile.min, profile.max);
    const orbits = rng.shuffle(Array.from({length: 41}, (_, index) => index));
    let clues = CELLS;
    for (const first of orbits) {
      if (clues <= target && meets(puzzle, profile)) break;
      const second = CELLS - 1 - first;
      const keepA = puzzle[first]!;
      const keepB = puzzle[second]!;
      puzzle[first] = 0; puzzle[second] = 0;
      const removed = first === second ? 1 : 2;
      if (clues - removed >= profile.min - 2 && acceptable(puzzle, profile)) clues -= removed;
      else { puzzle[first] = keepA; puzzle[second] = keepB; }
    }
    const gap = (clues > profile.max ? clues - profile.max : 0) + (meets(puzzle, profile) ? 0 : 5);
    if (!best || gap < best.gap) best = {puzzle: Uint8Array.from(puzzle), solution, gap};
    if (gap === 0) break;
  }
  return {puzzle: best!.puzzle, solution: best!.solution, difficulty};
}

/** The number of clues in a grid. */
export const clueCount = (grid: Grid): number => grid.reduce((count, digit) => count + (digit ? 1 : 0), 0);
