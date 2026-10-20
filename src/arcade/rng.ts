/**
 * Deterministic seeded randomness for the arcade: the same seed gives the same course, puzzle and particles, so tests
 * replay exactly and a generator can be checked offline. Never `Math.random`.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [min, max] (both inclusive). */
  int(min: number, max: number): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  /** An independent stream derived from this one, so a consumer cannot disturb the course's sequence. */
  fork(label?: string): Rng;
  /** The 32-bit state, for saving a position in the sequence. */
  readonly state: number;
}

/** FNV-1a: any string seed to a 32-bit one. */
export function hashSeed(seed: string | number): number {
  const text = String(seed);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: small, fast and good enough for games. */
export function createRng(seed: string | number): Rng {
  let state = (typeof seed === 'number' ? seed >>> 0 : hashSeed(seed)) || 0x9e3779b9;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    chance: probability => next() < probability,
    pick: items => items[Math.floor(next() * items.length)]!,
    shuffle: items => {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const other = Math.floor(next() * (index + 1));
        [copy[index], copy[other]] = [copy[other]!, copy[index]!];
      }
      return copy;
    },
    fork: label => createRng((state ^ hashSeed(label ?? 'fork')) >>> 0),
    get state() { return state; },
  };
  return rng;
}

/** A fresh seed for a new run. The only place the arcade reads the clock for randomness, and tests inject their own. */
export function freshSeed(now: number = Date.now()): number {
  return hashSeed(`${now}:${process.pid}`);
}
