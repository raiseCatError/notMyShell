import {createRng, hashSeed, type Rng} from '../../rng.js';
import {candidatePuzzle, repairRegions} from './generator.js';
import {DIFFICULTY_LEVELS, countSolutions, levelDistance, rate, solveOther} from './solver.js';
import type {Difficulty, Puzzle} from './types.js';

/** Board sizes by difficulty; the seed picks within a range. */
export const SIZES: Readonly<Record<Difficulty, readonly [number, number]>> = {easy: [5, 6], medium: [7, 7], hard: [8, 8], expert: [9, 10]};

/** Expert is mostly 9 x 9: a 10 x 10 board costs several times more to generate, so it is the occasional treat. */
function pickSize(difficulty: Difficulty, rng: Rng): number {
  const [low, high] = SIZES[difficulty];
  return difficulty === 'expert' ? (rng.chance(0.2) ? high : low) : rng.int(low, high);
}

const ATTEMPTS_PER_SEED = 400;
const SEEDS = 6;

export interface MadePuzzle extends Puzzle {
  difficulty: Difficulty;
  seed: number;
  /** Hardest technique level the logical solver needed. */
  level: number;
  /** The level fell inside the requested difficulty's band. */
  exact: boolean;
}

/**
 * The puzzle for a seed and difficulty: always the same one. Candidates come from the generator; each is kept only if
 * the independent solver finds exactly one solution and the human techniques solve it. The first whose hardest
 * technique lands in the difficulty's band wins; attempts are bounded (then the next derived seed tries), and when none
 * fits the closest rating is returned.
 */
export function makePuzzle(seed: number, difficulty: Difficulty): MadePuzzle {
  let best: MadePuzzle | undefined;
  let bestDistance = Infinity;
  for (let round = 0; round < SEEDS; round += 1) {
    const rng = createRng(round === 0 ? seed : hashSeed(`${seed}:${round}`));
    const size = pickSize(difficulty, rng);
    for (let attempt = 0; attempt < ATTEMPTS_PER_SEED; attempt += 1) {
      const candidate = candidatePuzzle(size, rng);
      repairRegions(candidate, rng, regions => solveOther(size, regions, candidate.solution));
      if (countSolutions(size, candidate.regions, 2) !== 1) continue;
      const rating = rate(size, candidate.regions);
      if (!rating.solved) continue;
      const distance = levelDistance(rating.level, difficulty);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {...candidate, difficulty, seed, level: rating.level, exact: distance === 0};
        if (distance === 0) return best;
      }
    }
    if (best && bestDistance <= 1 && round >= 1) break;
  }
  if (best) return best;
  throw new RangeError(`no solvable ${difficulty} puzzle for seed ${seed}`);
}

/**
 * A unique, logically solvable puzzle of exactly `size`, whatever its rating (the fixture for tests of every size).
 * Bounded like `makePuzzle`, and null when none turned up.
 */
export function makePuzzleOfSize(seed: number, size: number): (Puzzle & {level: number}) | null {
  const rng = createRng(seed);
  for (let attempt = 0; attempt < ATTEMPTS_PER_SEED * 2; attempt += 1) {
    const candidate = candidatePuzzle(size, rng);
    repairRegions(candidate, rng, regions => solveOther(size, regions, candidate.solution));
    if (countSolutions(size, candidate.regions, 2) !== 1) continue;
    const rating = rate(size, candidate.regions);
    if (rating.solved) return {...candidate, level: rating.level};
  }
  return null;
}

export { DIFFICULTY_LEVELS };
