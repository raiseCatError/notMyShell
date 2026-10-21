import type {Rng} from '../../rng.js';

/**
 * Box Escape rules: a 6 x 6 board, cars that slide along their own axis, and the target car (index 0) on row 2 that
 * must reach the right edge. Moves are single-cell steps; the minimum is found by breadth-first search, so every board
 * is known solvable and shows its par. The search also yields hints.
 */
export const BOARD = 6;
export const EXIT_ROW = 2;

export interface Car { len: number; horizontal: boolean; /** Fixed coordinate: the row of a horizontal car, the column of a vertical one. */ lane: number }
/** The position of every car along its axis, one entry per car. */
export type Layout = readonly number[];

export interface Puzzle { cars: readonly Car[]; start: Layout; minMoves: number }

export const LEVELS = {
  easy: {label: 'Easy', cars: [6, 8], min: 6},
  medium: {label: 'Medium', cars: [8, 11], min: 12},
  hard: {label: 'Hard', cars: [9, 11], min: 16},
} as const;
export type Level = keyof typeof LEVELS;

export function occupancy(cars: readonly Car[], layout: Layout): Int8Array {
  const grid = new Int8Array(BOARD * BOARD).fill(-1);
  cars.forEach((car, index) => {
    for (let step = 0; step < car.len; step += 1) {
      const x = car.horizontal ? layout[index]! + step : car.lane, y = car.horizontal ? car.lane : layout[index]! + step;
      grid[y * BOARD + x] = index;
    }
  });
  return grid;
}

export const isGoal = (cars: readonly Car[], layout: Layout): boolean => layout[0]! + cars[0]!.len === BOARD;

/** Whether `car` can step by `delta` (-1 or +1) along its axis. */
export function canStep(cars: readonly Car[], layout: Layout, grid: Int8Array, car: number, delta: -1 | 1): boolean {
  const c = cars[car]!;
  const at = layout[car]! + (delta < 0 ? -1 : c.len);
  if (at < 0 || at >= BOARD) return false;
  return grid[c.horizontal ? c.lane * BOARD + at : at * BOARD + c.lane] === -1;
}

export interface Step { car: number; delta: -1 | 1 }

/** The shortest solution from `layout` (empty when already solved), or undefined if unsolvable or over the search cap. */
export function solve(cars: readonly Car[], layout: Layout, cap = 120_000): Step[] | undefined {
  const key = (l: Layout): number => l.reduce((sum, at) => sum * BOARD + at, 0);
  const seen = new Map<number, {from: number; step: Step} | null>([[key(layout), null]]);
  let frontier: Layout[] = [layout];
  if (isGoal(cars, layout)) return [];
  while (frontier.length && seen.size < cap) {
    const next: Layout[] = [];
    for (const current of frontier) {
      const grid = occupancy(cars, current), from = key(current);
      for (let car = 0; car < cars.length; car += 1) for (const delta of [-1, 1] as const) {
        if (!canStep(cars, current, grid, car, delta)) continue;
        const moved = current.slice();
        moved[car] = moved[car]! + delta;
        const id = key(moved);
        if (seen.has(id)) continue;
        seen.set(id, {from, step: {car, delta}});
        if (isGoal(cars, moved)) {
          const path: Step[] = [];
          for (let at: number | undefined = id; at !== undefined;) { const entry = seen.get(at); if (!entry) break; path.push(entry.step); at = entry.from; }
          return path.reverse();
        }
        next.push(moved);
      }
    }
    frontier = next;
  }
  return undefined;
}

function randomBoard(rng: Rng, count: number): {cars: Car[]; layout: number[]} {
  const cars: Car[] = [{len: 2, horizontal: true, lane: EXIT_ROW}];
  const layout = [rng.int(0, 2)];
  const used = new Set<number>();
  for (let step = 0; step < 2; step += 1) used.add(EXIT_ROW * BOARD + layout[0]! + step);
  for (let attempts = 0; cars.length < count && attempts < 200; attempts += 1) {
    const horizontal = rng.chance(0.5), len = rng.chance(0.3) ? 3 : 2;
    const lane = rng.int(0, BOARD - 1);
    if (horizontal && lane === EXIT_ROW) continue;
    const at = rng.int(0, BOARD - len);
    const cells = Array.from({length: len}, (_, step) => (horizontal ? lane * BOARD + at + step : (at + step) * BOARD + lane));
    if (cells.some(cell => used.has(cell))) continue;
    cells.forEach(cell => used.add(cell));
    cars.push({len, horizontal, lane});
    layout.push(at);
  }
  return {cars, layout};
}

/**
 * Generate a board for `level`: random placement, then hill-climbing (relocate one car, keep the change if the minimum
 * grows) until it reaches the level's minimum. Deterministic for a seed; always returns a verified-solvable board.
 */
export function generate(level: Level, rng: Rng): Puzzle {
  const spec = LEVELS[level];
  let best: Puzzle | undefined;
  for (let restart = 0; restart < 8; restart += 1) {
    const {cars, layout} = randomBoard(rng, rng.int(spec.cars[0], spec.cars[1]));
    let current = solve(cars, layout, 40_000)?.length;
    if (current === undefined) continue;
    let start = layout;
    for (let round = 0; round < 80 && current < spec.min; round += 1) {
      const car = rng.int(0, cars.length - 1), c = cars[car]!;
      const at = rng.int(0, BOARD - c.len);
      if (at === start[car]) continue;
      const trial = start.slice();
      trial[car] = at;
      const grid = new Int8Array(BOARD * BOARD).fill(-1);
      let clash = false;
      cars.forEach((other, index) => {
        for (let step = 0; step < other.len; step += 1) {
          const cell = (other.horizontal ? other.lane : trial[index]! + step) * BOARD + (other.horizontal ? trial[index]! + step : other.lane);
          if (grid[cell] !== -1) clash = true;
          grid[cell] = index;
        }
      });
      if (clash || isGoal(cars, trial)) continue;
      const moves = solve(cars, trial, 40_000)?.length;
      if (moves !== undefined && moves >= current) { start = trial; current = moves; }
    }
    if (!best || current > best.minMoves) best = {cars, start, minMoves: current};
    if (current >= spec.min) break;
  }
  return best!;
}

export class EscapeBoard {
  layout: number[];
  moves = 0;
  private past: Array<{layout: number[]; moves: number}> = [];

  constructor(readonly cars: readonly Car[], start: Layout, readonly par: number) { this.layout = [...start]; }

  get grid(): Int8Array { return occupancy(this.cars, this.layout); }
  get solved(): boolean { return isGoal(this.cars, this.layout); }
  get canUndo(): boolean { return this.past.length > 0; }

  step(car: number, delta: -1 | 1): boolean {
    if (this.solved || car < 0 || car >= this.cars.length || !canStep(this.cars, this.layout, this.grid, car, delta)) return false;
    this.past.push({layout: [...this.layout], moves: this.moves});
    this.layout[car] = this.layout[car]! + delta;
    this.moves += 1;
    return true;
  }

  undo(): boolean {
    const before = this.past.pop();
    if (!before) return false;
    this.layout = before.layout;
    this.moves = before.moves;
    return true;
  }

  restart(start: Layout): void { this.layout = [...start]; this.moves = 0; this.past = []; }

  /** The next step on a shortest path from where the board is now. */
  hint(): Step | undefined { return solve(this.cars, this.layout)?.[0]; }
}

export const carLabel = (index: number): string => (index === 0 ? 'A' : 'BCDEFGHIJKLMNOPQRSTUVWXYZ'[index - 1] ?? '?');
