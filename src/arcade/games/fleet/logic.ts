import type {Rng} from '../../rng.js';

/**
 * Cat Fleet's rules: Battleship on a 10 x 10 sea. Five boats (5, 4, 3, 3, 2 long) sit in straight lines without
 * overlapping; each side fires one shot per turn and learns hit, miss or "sunk" (the sunk boat's length and cells).
 * The computer fires with hunt/target play and a checkerboard parity: it only ever sees the results of its own shots
 * through `Gunner.report`, never the player's fleet, so it plays fair.
 */
export const SIDE = 10;
export const CELLS = SIDE * SIDE;
export const BOATS = [
  {name: 'Galleon', length: 5}, {name: 'Frigate', length: 4}, {name: 'Brig', length: 3}, {name: 'Sloop', length: 3}, {name: 'Dinghy', length: 2},
] as const;

export interface Boat { name: string; length: number; cells: number[] }
export type Shot = 0 | 1 | 2; // none, miss, hit
export interface ShotResult { cell: number; hit: boolean; sunk: Boat | undefined }

/** The cells a boat of `length` covers from `cell` going right or down, or undefined when it leaves the sea. */
export function span(cell: number, length: number, horizontal: boolean): number[] | undefined {
  const x = cell % SIDE, y = Math.floor(cell / SIDE);
  if (horizontal ? x + length > SIDE : y + length > SIDE) return undefined;
  return Array.from({length}, (_, index) => (horizontal ? cell + index : cell + index * SIDE));
}

export class Waters {
  boats: Boat[] = [];
  readonly shots = new Uint8Array(CELLS);

  /** Whether the boat fits at `cell` without leaving the sea or touching a placed boat's cell. */
  canPlace(length: number, cell: number, horizontal: boolean): boolean {
    const cells = span(cell, length, horizontal);
    return !!cells && cells.every(c => !this.boatAt(c));
  }

  boatAt(cell: number): Boat | undefined { return this.boats.find(boat => boat.cells.includes(cell)); }

  place(index: number, cell: number, horizontal: boolean): boolean {
    const spec = BOATS[index];
    if (!spec || index !== this.boats.length || !this.canPlace(spec.length, cell, horizontal)) return false;
    this.boats.push({name: spec.name, length: spec.length, cells: span(cell, spec.length, horizontal)!});
    return true;
  }

  removeLast(): boolean { return this.boats.pop() !== undefined; }

  /** Fill in the rest of the fleet at random (starting over if the boats already placed leave no room). */
  placeRandom(rng: Rng): void {
    for (let round = 0; round < 20 && !this.complete; round += 1) {
      for (let tries = 0; tries < 500 && this.boats.length < BOATS.length; tries += 1) this.place(this.boats.length, rng.int(0, CELLS - 1), rng.chance(0.5));
      if (!this.complete) this.boats = [];
    }
  }

  get complete(): boolean { return this.boats.length === BOATS.length; }
  isSunk(boat: Boat): boolean { return boat.cells.every(cell => this.shots[cell] === 2); }
  get sunk(): Boat[] { return this.boats.filter(boat => this.isSunk(boat)); }
  get allSunk(): boolean { return this.complete && this.boats.every(boat => this.isSunk(boat)); }
  get remainingCells(): number { return this.boats.reduce((sum, boat) => sum + boat.cells.filter(cell => this.shots[cell] !== 2).length, 0); }

  /** Fire at `cell`; undefined when it was already shot or is off the sea. */
  fire(cell: number): ShotResult | undefined {
    if (cell < 0 || cell >= CELLS || this.shots[cell] !== 0) return undefined;
    const boat = this.boatAt(cell);
    this.shots[cell] = boat ? 2 : 1;
    return {cell, hit: !!boat, sunk: boat && this.isSunk(boat) ? boat : undefined};
  }
}

/**
 * The computer's shooting. Hunt: a checkerboard of untried cells (every boat is at least two long, so it must cross
 * one). Target: after a hit, finish it: extend a line of two or more hits both ways, otherwise try the four
 * neighbours. It knows only the results `report` gives it.
 */
export class Gunner {
  private readonly tried = new Uint8Array(CELLS);
  private open: number[] = [];
  private readonly parity: number;
  private remaining: number[] = BOATS.map(boat => boat.length);

  constructor(private readonly rng: Rng) { this.parity = rng.int(0, 1); }

  /** Hits that belong to boats not yet sunk. */
  get pending(): readonly number[] { return this.open; }

  next(): number {
    const target = this.targetCells();
    if (target.length) return this.rng.pick(target);
    const free = [...Array(CELLS).keys()].filter(cell => !this.tried[cell]);
    const smallest = Math.min(...this.remaining);
    const step = smallest >= 2 ? 2 : 1;
    const parity = free.filter(cell => ((cell % SIDE) + Math.floor(cell / SIDE)) % step === this.parity % step);
    const alive = parity.filter(cell => this.fits(cell));
    return this.rng.pick(alive.length ? alive : parity.length ? parity : free);
  }

  /** Whether some remaining boat could still cover the cell given what was learnt (cells shot and missed are barriers). */
  private fits(cell: number): boolean {
    const x = cell % SIDE, y = Math.floor(cell / SIDE);
    const run = (dx: number, dy: number): number => {
      let n = 0;
      while (true) {
        const nx = x + dx * (n + 1), ny = y + dy * (n + 1);
        if (nx < 0 || ny < 0 || nx >= SIDE || ny >= SIDE || this.tried[ny * SIDE + nx]) break;
        n += 1;
      }
      return n;
    };
    const horizontal = 1 + run(1, 0) + run(-1, 0), vertical = 1 + run(0, 1) + run(0, -1);
    return Math.max(horizontal, vertical) >= Math.min(...this.remaining);
  }

  private targetCells(): number[] {
    if (!this.open.length) return [];
    const free = (cell: number): boolean => cell >= 0 && cell < CELLS && !this.tried[cell];
    const set = new Set(this.open);
    const lines: number[] = [];
    for (const cell of this.open) {
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const x = cell % SIDE, y = Math.floor(cell / SIDE);
        const nextX = x + dx, nextY = y + dy;
        if (nextX >= SIDE || nextY >= SIDE || !set.has(nextY * SIDE + nextX)) continue;
        // `cell` and its neighbour are a pair; extend the whole contiguous run in that direction.
        let start = cell;
        while (true) { const px = (start % SIDE) - dx, py = Math.floor(start / SIDE) - dy; if (px < 0 || py < 0 || !set.has(py * SIDE + px)) break; start = py * SIDE + px; }
        let end = start;
        while (true) { const nx = (end % SIDE) + dx, ny = Math.floor(end / SIDE) + dy; if (nx >= SIDE || ny >= SIDE || !set.has(ny * SIDE + nx)) break; end = ny * SIDE + nx; }
        const before = (start % SIDE) - dx >= 0 && Math.floor(start / SIDE) - dy >= 0 ? start - dx - dy * SIDE : -1;
        const after = (end % SIDE) + dx < SIDE && Math.floor(end / SIDE) + dy < SIDE ? end + dx + dy * SIDE : -1;
        if (before >= 0 && free(before)) lines.push(before);
        if (after >= 0 && free(after)) lines.push(after);
      }
    }
    if (lines.length) return lines;
    const around: number[] = [];
    for (const cell of this.open) {
      const x = cell % SIDE, y = Math.floor(cell / SIDE);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < SIDE && ny < SIDE && free(ny * SIDE + nx)) around.push(ny * SIDE + nx);
      }
    }
    return around;
  }

  /** Learn the outcome of the shot at `cell`. A sunk boat gives its cells so they stop being targets. */
  report(cell: number, hit: boolean, sunk?: readonly number[]): void {
    this.tried[cell] = 1;
    if (!hit) return;
    this.open.push(cell);
    if (sunk) {
      this.open = this.open.filter(c => !sunk.includes(c));
      const index = this.remaining.indexOf(sunk.length);
      if (index >= 0) this.remaining.splice(index, 1);
      if (!this.remaining.length) this.remaining = [2];
    }
  }
}
