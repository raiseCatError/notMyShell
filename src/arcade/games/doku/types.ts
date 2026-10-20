/** Shared shapes for Vespyr Doku. Types only: the generator and the solver both import this and nothing from each other. */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

/** A square puzzle: `regions[row * size + column]` is the region index (0..size-1) and `solution[row]` the cat's column. */
export interface Puzzle {
  size: number;
  regions: number[];
  solution: number[];
}

/** What a cell holds on the person's board. */
export const EMPTY = 0;
export const EXCLUDED = 1;
export const CAT = 2;
