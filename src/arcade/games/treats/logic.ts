import type {Rng} from '../../rng.js';

/**
 * Treat Match's rules. Swap two neighbouring treats; the swap only counts if it makes a line of three or more of one
 * kind (across or down). Matched treats vanish, the ones above fall, new ones drop in from the top, and any new lines
 * (a cascade) clear in turn, each step worth more than the last. A board always starts with no lines and at least one
 * legal swap, and is reshuffled (no moves spent) if play ever leaves it without one. Thirty moves per game.
 */
export const WIDTH = 8;
export const HEIGHT = 8;
export const KINDS = 6;
export const MOVES = 30;

export interface Step { cleared: number[]; gained: number; after: number[]; chain: number }

/** Every cell that is part of a line of 3+ in `cells`. */
export function matched(cells: readonly number[], width = WIDTH, height = HEIGHT): Set<number> {
  const hit = new Set<number>();
  const run = (start: number, stride: number, length: number) => {
    let from = 0;
    for (let i = 1; i <= length; i += 1) {
      if (i < length && cells[start + i * stride] === cells[start + from * stride] && cells[start + from * stride]! >= 0) continue;
      if (i - from >= 3 && cells[start + from * stride]! >= 0) for (let k = from; k < i; k += 1) hit.add(start + k * stride);
      from = i;
    }
  };
  for (let y = 0; y < height; y += 1) run(y * width, 1, width);
  for (let x = 0; x < width; x += 1) run(x, width, height);
  return hit;
}

export const pointsFor = (cleared: number, chain: number): number => (cleared * 10 + Math.max(0, cleared - 3) * 10) * chain;

export class TreatBoard {
  cells: number[] = [];
  score = 0;
  movesLeft = MOVES;
  bestChain = 0;
  shuffles = 0;

  constructor(private readonly rng: Rng, readonly width = WIDTH, readonly height = HEIGHT) { this.fresh(); }

  private fresh(): void {
    do {
      this.cells = Array.from({length: this.width * this.height}, () => this.rng.int(0, KINDS - 1));
      // Break any starting line by re-rolling its cells until none remain.
      for (let guard = 0; guard < 200; guard += 1) {
        const hit = matched(this.cells, this.width, this.height);
        if (!hit.size) break;
        for (const cell of hit) this.cells[cell] = this.rng.int(0, KINDS - 1);
      }
    } while (matched(this.cells, this.width, this.height).size || !this.hasMove());
  }

  /** Whether swapping `a` and `b` (neighbours) would clear something. */
  swapWorks(a: number, b: number): boolean {
    if (!this.adjacent(a, b) || this.cells[a] === this.cells[b]) return false;
    const copy = this.cells.slice();
    [copy[a], copy[b]] = [copy[b]!, copy[a]!];
    return matched(copy, this.width, this.height).size > 0;
  }

  adjacent(a: number, b: number): boolean {
    const ax = a % this.width, ay = Math.floor(a / this.width), bx = b % this.width, by = Math.floor(b / this.width);
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  }

  /** A swap that works, or undefined. */
  hint(): [number, number] | undefined {
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      if (cell % this.width < this.width - 1 && this.swapWorks(cell, cell + 1)) return [cell, cell + 1];
      if (cell < this.cells.length - this.width && this.swapWorks(cell, cell + this.width)) return [cell, cell + this.width];
    }
    return undefined;
  }
  hasMove(): boolean { return this.hint() !== undefined; }

  /** Make the swap and play out every cascade; undefined (and no change) when the swap is not legal. */
  swap(a: number, b: number): Step[] | undefined {
    if (this.movesLeft <= 0 || !this.swapWorks(a, b)) return undefined;
    [this.cells[a], this.cells[b]] = [this.cells[b]!, this.cells[a]!];
    this.movesLeft -= 1;
    const steps: Step[] = [];
    for (let chain = 1; ; chain += 1) {
      const hit = matched(this.cells, this.width, this.height);
      if (!hit.size) break;
      const gained = pointsFor(hit.size, chain);
      this.score += gained;
      this.bestChain = Math.max(this.bestChain, chain);
      for (const cell of hit) this.cells[cell] = -1;
      this.settle();
      steps.push({cleared: [...hit].sort((x, y) => x - y), gained, after: this.cells.slice(), chain});
    }
    if (!this.hasMove()) { this.shuffles += 1; this.fresh(); }
    return steps;
  }

  /** Gravity: survivors fall within their column, then new treats fill the top. */
  private settle(): void {
    for (let x = 0; x < this.width; x += 1) {
      const column: number[] = [];
      for (let y = this.height - 1; y >= 0; y -= 1) { const kind = this.cells[y * this.width + x]!; if (kind >= 0) column.push(kind); }
      while (column.length < this.height) column.push(this.rng.int(0, KINDS - 1));
      for (let y = this.height - 1, i = 0; y >= 0; y -= 1, i += 1) this.cells[y * this.width + x] = column[i]!;
    }
  }

  get over(): boolean { return this.movesLeft <= 0; }
}
