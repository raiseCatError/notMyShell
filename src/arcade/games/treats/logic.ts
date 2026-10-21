import type {Rng} from '../../rng.js';

/**
 * Treat Match's rules. Swap two neighbouring treats; the swap only counts if it makes a line of three or more of one
 * kind (across or down). Matched treats vanish, the ones above fall, new ones drop in from the top, and any new lines
 * (a cascade) clear in turn, each step worth more than the last. A board always starts with no lines and at least one
 * legal swap, and is reshuffled (no moves spent) if play ever leaves it without one. Thirty moves per game.
 *
 * Special treats (kept as a mark beside the treat's kind):
 *  - A line of four across makes a column-striped treat, a line of four down a row-striped one. When a striped treat is
 *    cleared as part of any match, its whole column (or row) clears with it.
 *  - A line of five or more, or a T or L shape of two lines of three crossing, makes a bomb treat. When a bomb is cleared
 *    in a match every treat of its kind clears; swapping a bomb with a neighbour of another kind (always allowed) clears
 *    every treat of the neighbour's kind instead.
 * The special appears where the swap happened (or in the middle of the line, in a cascade) and stays when its line clears.
 */
export const WIDTH = 8;
export const HEIGHT = 8;
export const KINDS = 6;
export const MOVES = 30;

/** Marks on a treat. */
export const PLAIN = 0;
/** Clears its whole row when cleared. */
export const STRIPE_ROW = 1;
/** Clears its whole column when cleared. */
export const STRIPE_COL = 2;
/** Clears every treat of its kind when cleared. */
export const BOMB = 3;
export type Mark = 0 | 1 | 2 | 3;

export interface Fall { /** Where the treat ends up. */ to: number; /** The row it started from (negative: above the board, a new treat). */ fromRow: number }
export interface Step {
  cleared: number[]; gained: number; after: number[]; chain: number;
  /** Marks of the board after this step (parallel to `after`). */
  afterMarks: Mark[];
  /** Specials made by this step: they stay in place and are not removed with their line. */
  created: Array<{cell: number; mark: Mark}>;
  /** Specials that went off in this step (they were in a match). */
  triggered: Array<{cell: number; mark: Mark}>;
  /** Where every treat that moved came from, for animating the fall. */
  falls: Fall[];
}

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

interface Line { cells: number[]; horizontal: boolean }

/** Every maximal run of 3+ in `cells`, with its direction. */
export function lines(cells: readonly number[], width = WIDTH, height = HEIGHT): Line[] {
  const out: Line[] = [];
  const run = (start: number, stride: number, length: number, horizontal: boolean) => {
    let from = 0;
    for (let i = 1; i <= length; i += 1) {
      if (i < length && cells[start + i * stride] === cells[start + from * stride] && cells[start + from * stride]! >= 0) continue;
      if (i - from >= 3 && cells[start + from * stride]! >= 0) out.push({cells: Array.from({length: i - from}, (_, k) => start + (from + k) * stride), horizontal});
      from = i;
    }
  };
  for (let y = 0; y < height; y += 1) run(y * width, 1, width, true);
  for (let x = 0; x < width; x += 1) run(x, width, height, false);
  return out;
}

export const pointsFor = (cleared: number, chain: number): number => (cleared * 10 + Math.max(0, cleared - 3) * 10) * chain;

/** Star thresholds for a thirty-move game: one, two and three stars. */
export const STARS: readonly [number, number, number] = [2000, 3500, 5500];
export const starsFor = (score: number): number => STARS.filter(limit => score >= limit).length;

/** The specials a set of lines makes: a bomb for 5+ or a crossing pair, a stripe for exactly four. Positions prefer `prefer`. */
export function specialsFor(all: readonly Line[], prefer: readonly number[]): Array<{cell: number; mark: Mark}> {
  const made: Array<{cell: number; mark: Mark}> = [];
  const used = new Set<number>();
  const pick = (cells: readonly number[]): number => prefer.find(cell => cells.includes(cell) && !used.has(cell)) ?? cells.find(cell => !used.has(cell)) ?? cells[Math.floor(cells.length / 2)]!;
  const taken = new Set<Line>();
  // Crossing lines (T or L) first: the crossing cell becomes a bomb.
  for (const a of all) for (const b of all) {
    if (a === b || taken.has(a) || taken.has(b) || a.horizontal === b.horizontal) continue;
    const shared = a.cells.find(cell => b.cells.includes(cell));
    if (shared === undefined) continue;
    taken.add(a); taken.add(b);
    used.add(shared);
    made.push({cell: shared, mark: BOMB});
  }
  for (const line of all) {
    if (taken.has(line)) continue;
    if (line.cells.length >= 5) { const cell = pick(line.cells); used.add(cell); made.push({cell, mark: BOMB}); }
    else if (line.cells.length === 4) { const cell = pick(line.cells); used.add(cell); made.push({cell, mark: line.horizontal ? STRIPE_COL : STRIPE_ROW}); }
  }
  return made;
}

export class TreatBoard {
  cells: number[] = [];
  /** Specials, parallel to `cells`. */
  marks: Mark[] = [];
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
    this.marks = this.cells.map(() => PLAIN);
  }

  /** Whether swapping `a` and `b` (neighbours) would clear something. */
  swapWorks(a: number, b: number): boolean {
    if (!this.adjacent(a, b)) return false;
    if (this.cells[a] === this.cells[b]) return this.marks[a] === BOMB && this.marks[b] === BOMB;
    if (this.marks[a] === BOMB || this.marks[b] === BOMB) return true;
    const copy = this.cells.slice();
    [copy[a], copy[b]] = [copy[b]!, copy[a]!];
    return matched(copy, this.width, this.height).size > 0;
  }

  adjacent(a: number, b: number): boolean {
    const ax = a % this.width, ay = Math.floor(a / this.width), bx = b % this.width, by = Math.floor(b / this.width);
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  }

  /** A swap that works, or undefined. Prefers a swap that makes a special. */
  hint(): [number, number] | undefined {
    let first: [number, number] | undefined;
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      for (const other of [cell % this.width < this.width - 1 ? cell + 1 : -1, cell < this.cells.length - this.width ? cell + this.width : -1]) {
        if (other < 0 || !this.swapWorks(cell, other)) continue;
        first ??= [cell, other];
        if (this.makesSpecial(cell, other)) return [cell, other];
      }
    }
    return first;
  }
  hasMove(): boolean {
    for (let cell = 0; cell < this.cells.length; cell += 1) {
      if (cell % this.width < this.width - 1 && this.swapWorks(cell, cell + 1)) return true;
      if (cell < this.cells.length - this.width && this.swapWorks(cell, cell + this.width)) return true;
    }
    return false;
  }

  private makesSpecial(a: number, b: number): boolean {
    if (this.marks[a] === BOMB || this.marks[b] === BOMB) return false;
    const copy = this.cells.slice();
    [copy[a], copy[b]] = [copy[b]!, copy[a]!];
    return specialsFor(lines(copy, this.width, this.height), [a, b]).length > 0;
  }

  /** Make the swap and play out every cascade; undefined (and no change) when the swap is not legal. */
  swap(a: number, b: number): Step[] | undefined {
    if (this.movesLeft <= 0 || !this.swapWorks(a, b)) return undefined;
    [this.cells[a], this.cells[b]] = [this.cells[b]!, this.cells[a]!];
    [this.marks[a], this.marks[b]] = [this.marks[b]!, this.marks[a]!];
    this.movesLeft -= 1;
    const steps: Step[] = [];
    // A bomb swapped with another kind clears every treat of that kind (and itself): the first step.
    let forced: Set<number> | undefined;
    const bombCell: number | undefined = this.marks[a] === BOMB ? a : this.marks[b] === BOMB ? b : undefined;
    if (bombCell !== undefined) {
      const other = bombCell === a ? b : a;
      forced = new Set([bombCell]);
      for (let cell = 0; cell < this.cells.length; cell += 1) if (this.cells[cell] === this.cells[other]) forced.add(cell);
    }
    for (let chain = 1; ; chain += 1) {
      const all = lines(this.cells, this.width, this.height);
      const hit = new Set<number>();
      for (const line of all) for (const cell of line.cells) hit.add(cell);
      if (forced) { for (const cell of forced) hit.add(cell); }
      if (!hit.size) break;
      const created = forced ? [] : specialsFor(all, chain === 1 ? [a, b] : []);
      const keep = new Set(created.map(item => item.cell));
      // Specials in the clear set go off, and what they clear may set off more.
      const triggered: Array<{cell: number; mark: Mark}> = [];
      const fired = new Set<number>();
      if (bombCell !== undefined && forced) { fired.add(bombCell); triggered.push({cell: bombCell, mark: BOMB}); }
      for (let again = true; again;) {
        again = false;
        for (const cell of [...hit]) {
          const mark = this.marks[cell]!;
          if (mark === PLAIN || fired.has(cell) || keep.has(cell)) continue;
          fired.add(cell);
          triggered.push({cell, mark});
          again = true;
          if (mark === STRIPE_ROW) for (let x = 0; x < this.width; x += 1) hit.add(Math.floor(cell / this.width) * this.width + x);
          else if (mark === STRIPE_COL) for (let y = 0; y < this.height; y += 1) hit.add(y * this.width + (cell % this.width));
          else if (mark === BOMB) for (let other = 0; other < this.cells.length; other += 1) if (this.cells[other] === this.cells[cell]) hit.add(other);
        }
      }
      const gained = pointsFor(hit.size, chain);
      this.score += gained;
      this.bestChain = Math.max(this.bestChain, chain);
      for (const cell of hit) if (!keep.has(cell)) { this.cells[cell] = -1; this.marks[cell] = PLAIN; }
      for (const item of created) this.marks[item.cell] = item.mark;
      const falls = this.settle();
      steps.push({cleared: [...hit].sort((x, y) => x - y), gained, after: this.cells.slice(), afterMarks: this.marks.slice(), chain, created, triggered, falls});
      forced = undefined;
    }
    if (!this.hasMove()) { this.shuffles += 1; this.fresh(); }
    return steps;
  }

  /** Gravity: survivors fall within their column, then new treats fill the top. Reports where each treat came from. */
  private settle(): Fall[] {
    const falls: Fall[] = [];
    for (let x = 0; x < this.width; x += 1) {
      const column: Array<{kind: number; mark: Mark; row: number}> = [];
      for (let y = this.height - 1; y >= 0; y -= 1) { const kind = this.cells[y * this.width + x]!; if (kind >= 0) column.push({kind, mark: this.marks[y * this.width + x]!, row: y}); }
      let fresh = 0;
      while (column.length < this.height) { fresh += 1; column.push({kind: this.rng.int(0, KINDS - 1), mark: PLAIN, row: -fresh}); }
      for (let y = this.height - 1, i = 0; y >= 0; y -= 1, i += 1) {
        const item = column[i]!;
        this.cells[y * this.width + x] = item.kind;
        this.marks[y * this.width + x] = item.mark;
        if (item.row !== y) falls.push({to: y * this.width + x, fromRow: item.row});
      }
    }
    return falls;
  }

  get over(): boolean { return this.movesLeft <= 0; }
}
