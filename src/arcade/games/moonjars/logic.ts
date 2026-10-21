import type {Rng} from '../../rng.js';

/**
 * Moonjars rules: jars hold up to `cap` units of liquid, listed bottom to top. A pour moves the contiguous run of equal
 * color on top of one jar onto another jar that is empty or has the same color on top, as much as fits. The puzzle is
 * won when every jar is empty or full of a single color. Generation deals random jars and keeps a deal only when a
 * search finds a solution, so every level is verified solvable; the search also provides hints.
 */
export const LEVELS = {
  easy: {label: 'Three sips', colors: 4, cap: 4, empty: 2},
  medium: {label: 'Full moon', colors: 6, cap: 4, empty: 2},
  hard: {label: 'Eclipse', colors: 7, cap: 5, empty: 2},
} as const;
export type Level = keyof typeof LEVELS;

export type Jars = readonly (readonly number[])[];
export interface Pour { from: number; to: number }

export const LETTERS = 'ABCDEFGHIJ';

export function topRun(jar: readonly number[]): number {
  if (!jar.length) return 0;
  let run = 1;
  while (run < jar.length && jar[jar.length - 1 - run] === jar[jar.length - 1]) run += 1;
  return run;
}

/** How many units a pour would move (0 when illegal). */
export function pourAmount(jars: Jars, cap: number, from: number, to: number): number {
  if (from === to) return 0;
  const source = jars[from], target = jars[to];
  if (!source || !target || !source.length || target.length >= cap) return 0;
  if (target.length && target[target.length - 1] !== source[source.length - 1]) return 0;
  return Math.min(topRun(source), cap - target.length);
}

export function applyPour(jars: Jars, cap: number, from: number, to: number): number[][] | undefined {
  const amount = pourAmount(jars, cap, from, to);
  if (!amount) return undefined;
  const next = jars.map(jar => [...jar]);
  const color = next[from]![next[from]!.length - 1]!;
  next[from]!.length -= amount;
  for (let index = 0; index < amount; index += 1) next[to]!.push(color);
  return next;
}

export const jarDone = (jar: readonly number[], cap: number): boolean => jar.length === 0 || (jar.length === cap && jar.every(unit => unit === jar[0]));
export const isWon = (jars: Jars, cap: number): boolean => jars.every(jar => jarDone(jar, cap));

const canonical = (jars: Jars): string => jars.map(jar => jar.join('.')).sort().join('|');
/** Fewer color changes is closer to done. */
const estimate = (jars: Jars): number => jars.reduce((sum, jar) => sum + (jar.length ? 1 : 0) + jar.reduce((changes, unit, index) => changes + (index > 0 && unit !== jar[index - 1] ? 1 : 0), 0), 0);

/**
 * A solution found by best-first search (not always the shortest), or undefined if none was found within `limit` boards.
 * Pours that cannot help are skipped: out of a finished jar, and a single-color jar into an empty one.
 */
export function solveJars(start: Jars, cap: number, limit = 40_000): Pour[] | undefined {
  if (isWon(start, cap)) return [];
  type Node = {jars: Jars; parent: number; pour: Pour | undefined; rank: number};
  const nodes: Node[] = [{jars: start, parent: -1, pour: undefined, rank: estimate(start)}];
  const seen = new Set<string>([canonical(start)]);
  const heap: number[] = [0];
  const less = (a: number, b: number): boolean => nodes[a]!.rank < nodes[b]!.rank;
  const push = (index: number): void => {
    heap.push(index);
    for (let at = heap.length - 1; at > 0;) { const up = (at - 1) >> 1; if (!less(heap[at]!, heap[up]!)) break; [heap[at], heap[up]] = [heap[up]!, heap[at]!]; at = up; }
  };
  const pop = (): number => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let at = 0; ;) {
        const l = at * 2 + 1, r = l + 1;
        let small = at;
        if (l < heap.length && less(heap[l]!, heap[small]!)) small = l;
        if (r < heap.length && less(heap[r]!, heap[small]!)) small = r;
        if (small === at) break;
        [heap[at], heap[small]] = [heap[small]!, heap[at]!];
        at = small;
      }
    }
    return top;
  };
  while (heap.length && nodes.length < limit) {
    const index = pop();
    const {jars} = nodes[index]!;
    for (let from = 0; from < jars.length; from += 1) {
      if (jarDone(jars[from]!, cap)) continue;
      for (let to = 0; to < jars.length; to += 1) {
        if (!pourAmount(jars, cap, from, to)) continue;
        if (!jars[to]!.length && topRun(jars[from]!) === jars[from]!.length) continue;
        const next = applyPour(jars, cap, from, to)!;
        const key = canonical(next);
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.push({jars: next, parent: index, pour: {from, to}, rank: estimate(next)});
        if (isWon(next, cap)) {
          const path: Pour[] = [];
          for (let at = nodes.length - 1; at > 0; at = nodes[at]!.parent) path.push(nodes[at]!.pour!);
          return path.reverse();
        }
        push(nodes.length - 1);
      }
    }
  }
  return undefined;
}

export interface Puzzle { jars: number[][]; cap: number; colors: number; solution: number }

/** A verified deal: every color has exactly `cap` units, spread over mixed jars, plus empty jars to work in. */
export function generateJars(level: Level, rng: Rng): Puzzle {
  const spec = LEVELS[level];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const units = rng.shuffle(Array.from({length: spec.colors * spec.cap}, (_, index) => Math.floor(index / spec.cap)));
    const jars: number[][] = Array.from({length: spec.colors}, (_, jar) => units.slice(jar * spec.cap, (jar + 1) * spec.cap));
    for (let extra = 0; extra < spec.empty; extra += 1) jars.push([]);
    if (jars.some(jar => jar.length && jarDone(jar, spec.cap))) continue;
    const solution = solveJars(jars, spec.cap);
    if (solution) return {jars, cap: spec.cap, colors: spec.colors, solution: solution.length};
  }
  throw new Error('no moonjar deal found');
}

export class JarBoard {
  jars: number[][];
  moves = 0;
  private past: Array<{jars: number[][]; moves: number}> = [];

  constructor(readonly puzzle: Puzzle) { this.jars = puzzle.jars.map(jar => [...jar]); }

  get cap(): number { return this.puzzle.cap; }
  get solved(): boolean { return isWon(this.jars, this.cap); }
  get canUndo(): boolean { return this.past.length > 0; }

  pour(from: number, to: number): number {
    if (this.solved) return 0;
    const next = applyPour(this.jars, this.cap, from, to);
    if (!next) return 0;
    const amount = pourAmount(this.jars, this.cap, from, to);
    this.past.push({jars: this.jars, moves: this.moves});
    this.jars = next;
    this.moves += 1;
    return amount;
  }

  undo(): boolean {
    const before = this.past.pop();
    if (!before) return false;
    this.jars = before.jars;
    this.moves = before.moves;
    return true;
  }

  restart(): void { this.jars = this.puzzle.jars.map(jar => [...jar]); this.moves = 0; this.past = []; }
  hint(): Pour | undefined { return solveJars(this.jars, this.cap)?.[0]; }
}
