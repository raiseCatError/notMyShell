import {ALL_EIGHT, components} from '../../engine/grid.js';
import type {Rng} from '../../rng.js';

/**
 * Sandfall's rules, with no drawing. A tetromino-shaped piece (each of its four cells is `cell` x `cell` grains) falls
 * through a well of grains. When it lands it turns into sand of its color, and the sand settles by a cellular
 * automaton: a grain falls straight down when it can, otherwise slides diagonally down. The update order is fixed and
 * unbiased (rows bottom to top, the scan direction and the preferred diagonal alternate with the tick and the cell's
 * parity). When one color forms a connected mass (8-neighbour) touching both side walls, the whole mass clears. The game
 * ends when the next piece cannot be placed at the top. Time advances in whole microseconds at 60 ticks a second, so any
 * split of the same total gives the same result.
 */
export const COLORS = 4;
export const MAX_WIDTH = 48;
export const MAX_HEIGHT = 80;
export const SPAWN_ROWS = 2;
const TICK_US = 16_667;
const SETTLE_PASSES = 3;
const CLEAR_MS = 280;
export const SHAPES: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> = {
  I: [[0, 0], [1, 0], [2, 0], [3, 0]], O: [[0, 0], [1, 0], [0, 1], [1, 1]], T: [[0, 0], [1, 0], [2, 0], [1, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
export const SHAPE_NAMES = Object.keys(SHAPES);

export interface Piece { name: string; color: number; cells: Array<readonly [number, number]>; x: number; y: number }
export type Phase = 'fall' | 'settle' | 'clear';
export type SandEvent =
  | {kind: 'land'}
  | {kind: 'clear'; grains: number[]; colors: number[]; chain: number; points: number}
  | {kind: 'over'};

export interface Dimensions { width: number; height: number; cell: number }

/** The well for a terminal of `columns` x `rows`: grains are half-block pixels, so a row is two grains tall. */
export function dimensionsFor(columns: number, rows: number): Dimensions {
  const cell = columns >= 64 && rows >= 28 ? 4 : columns >= 40 && rows >= 16 ? 3 : 2;
  const width = Math.max(cell * 6, Math.floor(Math.min(columns - 2, MAX_WIDTH) / cell) * cell);
  const height = Math.max(cell * 8, Math.min(MAX_HEIGHT, 2 * (rows - 2)));
  return {width, height, cell};
}

const rotateCells = (cells: ReadonlyArray<readonly [number, number]>, turns: 1 | -1): Array<readonly [number, number]> => {
  const turned = cells.map(([x, y]) => (turns === 1 ? [-y, x] : [y, -x]) as readonly [number, number]);
  const minX = Math.min(...turned.map(c => c[0])), minY = Math.min(...turned.map(c => c[1]));
  return turned.map(([x, y]) => [x - minX, y - minY] as const);
};

export class SandState {
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  /** 0 empty, 1..COLORS a grain. */
  grid: Uint8Array;
  piece: Piece | undefined;
  next: {name: string; color: number};
  phase: Phase = 'fall';
  score = 0;
  clears = 0;
  chain = 0;
  pieces = 0;
  over = false;
  events: SandEvent[] = [];
  /** Grain indices marked for clearing while `phase` is `clear`. */
  marked = new Set<number>();
  clearLeftMs = 0;
  private passCount = 0;
  private accumulator = 0;
  private fall = 0;

  constructor(private readonly rng: Rng, size: Dimensions) {
    this.width = size.width; this.height = size.height; this.cell = size.cell;
    this.grid = new Uint8Array(this.width * this.height);
    this.next = this.draw();
    this.spawn();
  }

  get level(): number { return 1 + Math.floor(this.clears / 3); }
  /** Grains per second the piece falls. */
  get speed(): number { return Math.min(40, 14 + (this.level - 1) * 3); }
  grains(): number { let n = 0; for (const g of this.grid) if (g) n += 1; return n; }
  at(x: number, y: number): number { return this.grid[y * this.width + x]!; }

  private draw(): {name: string; color: number} {
    return {name: this.rng.pick(SHAPE_NAMES), color: this.rng.int(1, COLORS)};
  }

  private spawn(): void {
    const {name, color} = this.next;
    this.next = this.draw();
    const cells = SHAPES[name]!.map(c => c);
    const span = Math.max(...cells.map(c => c[0])) + 1;
    const piece: Piece = {name, color, cells, x: Math.floor((this.width / this.cell - span) / 2) * this.cell, y: 0};
    this.fall = 0;
    this.phase = 'fall';
    if (this.collides(piece.cells, piece.x, piece.y)) { this.piece = piece; this.over = true; this.events.push({kind: 'over'}); return; }
    this.piece = piece;
  }

  /** Whether the piece's cells at grain position (x, y) hit a wall, the floor or sand. */
  collides(cells: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean {
    const k = this.cell;
    for (const [cx, cy] of cells) {
      const x0 = x + cx * k, y0 = y + cy * k;
      if (x0 < 0 || x0 + k > this.width || y0 + k > this.height) return true;
      if (y0 < 0) continue;
      for (let dy = 0; dy < k; dy += 1) for (let dx = 0; dx < k; dx += 1) if (this.grid[(y0 + dy) * this.width + x0 + dx]) return true;
    }
    return false;
  }

  shift(direction: -1 | 1): boolean {
    const piece = this.piece;
    if (!piece || this.phase !== 'fall' || this.over) return false;
    if (this.collides(piece.cells, piece.x + direction * this.cell, piece.y)) return false;
    piece.x += direction * this.cell;
    return true;
  }

  rotate(turns: 1 | -1 = 1): boolean {
    const piece = this.piece;
    if (!piece || this.phase !== 'fall' || this.over) return false;
    const cells = rotateCells(piece.cells, turns);
    const k = this.cell;
    for (const dx of [0, -k, k, -2 * k, 2 * k]) {
      if (!this.collides(cells, piece.x + dx, piece.y)) { piece.cells = cells; piece.x += dx; return true; }
    }
    return false;
  }

  /** Move down up to `grains`; lands the piece when it cannot move. Returns the grains moved. */
  drop(grains: number): number {
    const piece = this.piece;
    if (!piece || this.phase !== 'fall' || this.over) return 0;
    let moved = 0;
    for (; moved < grains; moved += 1) {
      if (this.collides(piece.cells, piece.x, piece.y + 1)) { this.land(); return moved; }
      piece.y += 1;
    }
    return moved;
  }

  hardDrop(): void {
    const piece = this.piece;
    if (!piece || this.phase !== 'fall' || this.over) return;
    while (!this.collides(piece.cells, piece.x, piece.y + 1)) piece.y += 1;
    this.land();
  }

  private land(): void {
    const piece = this.piece!;
    const k = this.cell;
    for (const [cx, cy] of piece.cells) {
      for (let dy = 0; dy < k; dy += 1) {
        for (let dx = 0; dx < k; dx += 1) {
          const x = piece.x + cx * k + dx, y = piece.y + cy * k + dy;
          if (y >= 0 && y < this.height) this.grid[y * this.width + x] = piece.color;
        }
      }
    }
    this.piece = undefined;
    this.pieces += 1;
    this.score += 4;
    this.chain = 0;
    this.phase = 'settle';
    this.events.push({kind: 'land'});
  }

  step(dtMs: number): void {
    if (this.over) return;
    this.accumulator += Math.max(0, Math.round(dtMs * 1000));
    while (this.accumulator >= TICK_US && !this.over) {
      this.accumulator -= TICK_US;
      this.tick();
    }
  }

  private tick(): void {
    if (this.phase === 'fall') {
      this.fall += (this.speed * TICK_US) / 1_000_000;
      const whole = Math.floor(this.fall);
      this.fall -= whole;
      if (whole > 0) this.drop(whole);
    } else if (this.phase === 'settle') {
      let moved = 1;
      for (let pass = 0; pass < SETTLE_PASSES && moved > 0; pass += 1) moved = this.settlePass();
      // A pass that moved nothing means the pile is at rest.
      if (moved === 0) this.afterSettle();
    } else {
      this.clearLeftMs -= TICK_US / 1000;
      if (this.clearLeftMs <= 0) this.finishClear();
    }
  }

  /**
   * One pass of the automaton over the whole grid, bottom row first. Returns how many grains moved. The scan direction
   * alternates by row and tick, and when both diagonals are open the preferred one alternates by cell parity and tick,
   * so sand piles up evenly instead of leaning one way.
   */
  settlePass(): number {
    const {width, height, grid} = this;
    this.passCount += 1;
    let moved = 0;
    for (let y = height - 2; y >= 0; y -= 1) {
      const forward = ((y + this.passCount) & 1) === 0;
      for (let i = 0; i < width; i += 1) {
        const x = forward ? i : width - 1 - i;
        const here = y * width + x;
        const color = grid[here]!;
        if (!color) continue;
        const below = here + width;
        if (!grid[below]) { grid[below] = color; grid[here] = 0; moved += 1; continue; }
        const leftOpen = x > 0 && !grid[below - 1];
        const rightOpen = x < width - 1 && !grid[below + 1];
        if (!leftOpen && !rightOpen) continue;
        const toLeft = leftOpen && rightOpen ? ((x + y + this.passCount) & 1) === 0 : leftOpen;
        const target = toLeft ? below - 1 : below + 1;
        grid[target] = color; grid[here] = 0; moved += 1;
      }
    }
    return moved;
  }

  /** The masses that clear now: one color, 8-connected, touching both the left and the right wall. */
  findClears(): number[][] {
    const shape = {width: this.width, height: this.height};
    const groups = components(shape, index => (this.grid[index] ? this.grid[index] : undefined), ALL_EIGHT);
    return groups.filter(group => group.some(i => i % this.width === 0) && group.some(i => i % this.width === this.width - 1));
  }

  private afterSettle(): void {
    const masses = this.findClears();
    if (masses.length) {
      this.chain += 1;
      this.marked = new Set(masses.flat());
      this.phase = 'clear';
      this.clearLeftMs = CLEAR_MS;
      return;
    }
    this.spawn();
  }

  private finishClear(): void {
    const grains = [...this.marked].sort((a, b) => a - b);
    const colors = grains.map(index => this.grid[index]!);
    for (const index of grains) this.grid[index] = 0;
    const points = grains.length * this.chain;
    this.score += points;
    this.clears += 1;
    this.events.push({kind: 'clear', grains, colors, chain: this.chain, points});
    this.marked = new Set();
    this.phase = 'settle';
  }

  /** Grains that have empty space directly below them (for tests: none once the sand is at rest and not diagonal-stable). */
  floating(): number {
    let n = 0;
    for (let y = 0; y < this.height - 1; y += 1) for (let x = 0; x < this.width; x += 1) {
      if (!this.grid[y * this.width + x]) continue;
      const below = (y + 1) * this.width + x;
      if (!this.grid[below]) n += 1;
    }
    return n;
  }
}
