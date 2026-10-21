import {cellX, cellY, insideGrid, type GridShape} from '../../engine/grid.js';
import type {Rng} from '../../rng.js';

/**
 * Circuit's rules. Every tile has wires on some of its four sides (a bit mask). Rotating a tile turns its wires a
 * quarter clockwise. Current flows out of the source into a neighbour only when BOTH tiles have a wire on the shared
 * edge, so lighting is a real graph search over the current rotations; the board is solved when every lamp is lit.
 * Boards are made from a random spanning tree (always solvable) and then scrambled.
 */
export const N = 1, E = 2, S = 4, W = 8;
export const SIZES = [5, 6, 7, 8] as const;
const DIRS: ReadonlyArray<readonly [number, number, number, number]> = [[N, 0, -1, S], [E, 1, 0, W], [S, 0, 1, N], [W, -1, 0, E]];

export const rotateMask = (mask: number, quarterTurns = 1): number => {
  let out = mask;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i += 1) out = ((out << 1) | (out >> 3)) & 15;
  return out;
};
export const wireCount = (mask: number): number => (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);

export interface CircuitData extends GridShape { source: number; lamps: readonly number[]; solution: readonly number[]; start: readonly number[] }

/** A solvable, scrambled board of `size x size`. */
export function generateCircuit(size: number, rng: Rng): CircuitData {
  const shape: GridShape = {width: size, height: size};
  const total = size * size;
  const solution = new Array<number>(total).fill(0);
  const seen = new Uint8Array(total);
  const first = rng.int(0, total - 1);
  const stack = [first];
  seen[first] = 1;
  while (stack.length) {
    const cell = stack[stack.length - 1]!;
    const options = DIRS.filter(([, dx, dy]) => insideGrid(shape, cellX(shape, cell) + dx, cellY(shape, cell) + dy) && !seen[(cellY(shape, cell) + dy) * size + cellX(shape, cell) + dx]);
    if (!options.length) { stack.pop(); continue; }
    const [bit, dx, dy, back] = rng.pick(options);
    const next = (cellY(shape, cell) + dy) * size + cellX(shape, cell) + dx;
    solution[cell]! |= bit;
    solution[next]! |= back;
    seen[next] = 1;
    stack.push(next);
  }
  // The source is a tile with two or three wires when there is one (it is shown with a marker either way).
  const hubs = solution.map((mask, cell) => ({mask, cell})).filter(({mask}) => wireCount(mask) >= 2 && wireCount(mask) <= 3);
  const source = (hubs.length ? rng.pick(hubs) : {cell: first}).cell;
  const lamps = solution.map((mask, cell) => ({mask, cell})).filter(({mask, cell}) => wireCount(mask) === 1 && cell !== source).map(({cell}) => cell);
  let start = solution.slice();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    start = solution.map(mask => rotateMask(mask, rng.int(0, 3)));
    if (!lampsLit(shape, source, lamps, start)) break;
  }
  return {width: size, height: size, source, lamps, solution, start};
}

/** Which cells current reaches from `source` through the wires of `masks`. */
export function litCells(shape: GridShape, source: number, masks: readonly number[]): Uint8Array {
  const lit = new Uint8Array(shape.width * shape.height);
  lit[source] = 1;
  const queue = [source];
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head]!;
    const x = cellX(shape, cell), y = cellY(shape, cell);
    for (const [bit, dx, dy, back] of DIRS) {
      if (!(masks[cell]! & bit) || !insideGrid(shape, x + dx, y + dy)) continue;
      const next = (y + dy) * shape.width + x + dx;
      if (!lit[next] && (masks[next]! & back)) { lit[next] = 1; queue.push(next); }
    }
  }
  return lit;
}

export function lampsLit(shape: GridShape, source: number, lamps: readonly number[], masks: readonly number[]): boolean {
  const lit = litCells(shape, source, masks);
  return lamps.every(lamp => lit[lamp]);
}

/** Quarter turns clockwise to take `mask` to `target`, or -1 when it cannot be done. */
export function turnsTo(mask: number, target: number): number {
  for (let turns = 0; turns < 4; turns += 1) if (rotateMask(mask, turns) === target) return turns;
  return -1;
}

export class CircuitBoard {
  masks: number[];
  turns = 0;
  history: number[][] = [];
  /** Turns the scramble needs at the least, so a score can ignore the board's own difficulty. */
  readonly minimum: number;

  constructor(readonly data: CircuitData) {
    this.masks = data.start.slice();
    this.minimum = data.start.reduce((sum, mask, cell) => sum + turnsTo(mask, data.solution[cell]!), 0);
  }

  get shape(): GridShape { return this.data; }
  lit(): Uint8Array { return litCells(this.shape, this.data.source, this.masks); }
  get won(): boolean { return lampsLit(this.shape, this.data.source, this.data.lamps, this.masks); }
  isLamp(cell: number): boolean { return this.data.lamps.includes(cell); }

  rotate(cell: number, clockwise = true): boolean {
    if (cell < 0 || cell >= this.masks.length) return false;
    if (rotateMask(this.masks[cell]!) === this.masks[cell]) return false;
    this.history.push(this.masks.slice());
    if (this.history.length > 300) this.history.shift();
    this.masks[cell] = rotateMask(this.masks[cell]!, clockwise ? 1 : 3);
    this.turns += 1;
    return true;
  }

  undo(): boolean {
    const previous = this.history.pop();
    if (!previous) return false;
    this.masks = previous;
    return true;
  }

  /** The unsolved tile nearest the source along the tree, as a hint, or undefined when the tree is complete. */
  hintCell(): number | undefined {
    const {solution, source} = this.data;
    const order = [source];
    const seen = new Set<number>(order);
    for (let head = 0; head < order.length; head += 1) {
      const cell = order[head]!;
      const x = cellX(this.shape, cell), y = cellY(this.shape, cell);
      for (const [bit, dx, dy] of DIRS) {
        if (!(solution[cell]! & bit)) continue;
        const next = (y + dy) * this.shape.width + x + dx;
        if (!seen.has(next)) { seen.add(next); order.push(next); }
      }
    }
    return order.find(cell => this.masks[cell] !== solution[cell]);
  }

  /** Set a tile to its place in the generator's tree. */
  fix(cell: number): void {
    this.history.push(this.masks.slice());
    this.masks[cell] = this.data.solution[cell]!;
  }

  /** Distance from the source (tiles lit now), for the order of the win ripple. */
  distances(): Map<number, number> {
    const lit = this.lit();
    const dist = new Map<number, number>([[this.data.source, 0]]);
    const queue = [this.data.source];
    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head]!;
      const x = cellX(this.shape, cell), y = cellY(this.shape, cell);
      for (const [bit, dx, dy, back] of DIRS) {
        if (!(this.masks[cell]! & bit) || !insideGrid(this.shape, x + dx, y + dy)) continue;
        const next = (y + dy) * this.shape.width + x + dx;
        if (lit[next] && !dist.has(next) && (this.masks[next]! & back)) { dist.set(next, dist.get(cell)! + 1); queue.push(next); }
      }
    }
    return dist;
  }
}
