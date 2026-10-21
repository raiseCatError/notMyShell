import type {Rng} from '../../rng.js';

/**
 * Ice Paws rules: the cat slides in a direction until a rock or the edge stops it, and the fish bowl (goal) catches it
 * when it slides over. Levels are random rock fields checked by breadth-first search over the cat's resting cells, so
 * every level is solvable and its minimum move count is known.
 */
export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
const DELTA: Record<Dir, readonly [number, number]> = {up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]};

export const LEVELS = {
  easy: {label: 'Small pond', width: 8, height: 6, rocks: 0.2, min: 3},
  medium: {label: 'Lake', width: 10, height: 7, rocks: 0.22, min: 5},
  hard: {label: 'Glacier', width: 12, height: 8, rocks: 0.24, min: 7},
} as const;
export type Level = keyof typeof LEVELS;

export interface Field { width: number; height: number; rocks: Uint8Array; start: number; goal: number }

/** Where a slide from `from` ends, passing over cells; stops on the goal, before a rock, or at the edge. */
export function slideFrom(field: Field, from: number, dir: Dir): {to: number; path: number[]} {
  const [dx, dy] = DELTA[dir];
  let x = from % field.width, y = Math.floor(from / field.width);
  const path: number[] = [];
  for (;;) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= field.width || ny >= field.height || field.rocks[ny * field.width + nx]) break;
    x = nx; y = ny;
    path.push(y * field.width + x);
    if (y * field.width + x === field.goal) break;
  }
  return {to: y * field.width + x, path};
}

/** Shortest solution from `from`: the list of directions, or undefined when the goal cannot be reached. */
export function solveIce(field: Field, from: number = field.start): Dir[] | undefined {
  if (from === field.goal) return [];
  const came = new Map<number, {from: number; dir: Dir} | null>([[from, null]]);
  let frontier = [from];
  while (frontier.length) {
    const next: number[] = [];
    for (const cell of frontier) for (const dir of DIRS) {
      const {to} = slideFrom(field, cell, dir);
      if (to === cell || came.has(to)) continue;
      came.set(to, {from: cell, dir});
      if (to === field.goal) {
        const path: Dir[] = [];
        for (let at = to; ;) { const entry = came.get(at); if (!entry) break; path.push(entry.dir); at = entry.from; }
        return path.reverse();
      }
      next.push(to);
    }
    frontier = next;
  }
  return undefined;
}

export interface Puzzle extends Field { minMoves: number }

/** A verified level for the difficulty. The best of a bounded number of random tries, never an unsolvable one. */
export function generateIce(level: Level, rng: Rng): Puzzle {
  const spec = LEVELS[level];
  const size = spec.width * spec.height;
  let best: Puzzle | undefined;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const rocks = new Uint8Array(size);
    for (let cell = 0; cell < size; cell += 1) if (rng.chance(spec.rocks)) rocks[cell] = 1;
    const free = [...Array(size).keys()].filter(cell => !rocks[cell]);
    if (free.length < 4) continue;
    const start = rng.pick(free), goal = rng.pick(free);
    if (start === goal) continue;
    const field: Field = {width: spec.width, height: spec.height, rocks, start, goal};
    const moves = solveIce(field)?.length;
    if (moves === undefined || moves === 0) continue;
    if (!best || moves > best.minMoves) best = {...field, minMoves: moves};
    if (moves >= spec.min) break;
  }
  if (!best) throw new Error('no ice level found');
  return best;
}

export class IceBoard {
  cat: number;
  moves = 0;
  private past: Array<{cat: number; moves: number}> = [];

  constructor(readonly field: Puzzle) { this.cat = field.start; }

  get solved(): boolean { return this.cat === this.field.goal; }
  get par(): number { return this.field.minMoves; }
  get canUndo(): boolean { return this.past.length > 0; }

  /** Slide; returns the cells passed (empty when blocked or already won). */
  slide(dir: Dir): number[] {
    if (this.solved) return [];
    const {to, path} = slideFrom(this.field, this.cat, dir);
    if (to === this.cat) return [];
    this.past.push({cat: this.cat, moves: this.moves});
    this.cat = to;
    this.moves += 1;
    return path;
  }

  undo(): boolean {
    const before = this.past.pop();
    if (!before) return false;
    this.cat = before.cat;
    this.moves = before.moves;
    return true;
  }

  restart(): void { this.cat = this.field.start; this.moves = 0; this.past = []; }
  hint(): Dir | undefined { return solveIce(this.field, this.cat)?.[0]; }
}
