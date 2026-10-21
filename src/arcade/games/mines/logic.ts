import {ALL_EIGHT, cellX, cellY, neighbours} from '../../engine/grid.js';
import type {Rng} from '../../rng.js';

/**
 * Minefield's rules: the classic Minesweeper board, or a hexagonal one where every cell has six neighbours. Mines are placed on the first reveal, never on the revealed cell or
 * its neighbours, so the first move always opens ground. Revealing a cell with no neighbouring mines opens its whole
 * region (a breadth-first flood, which also gives the order the cascade animates in). Chording a number whose flags are
 * all placed reveals its other neighbours. Winning is revealing every cell that is not a mine.
 */
export type ClassicPreset = 'beginner' | 'intermediate' | 'expert';
export type HexPreset = 'hexSmall' | 'hexMedium' | 'hexLarge';
export type Preset = ClassicPreset | HexPreset;
export interface PresetSpec {width: number; height: number; mines: number; label: string; hex: boolean}
export const PRESETS: Readonly<Record<Preset, PresetSpec>> = {
  beginner: {width: 9, height: 9, mines: 10, label: 'Beginner', hex: false},
  intermediate: {width: 16, height: 16, mines: 40, label: 'Intermediate', hex: false},
  expert: {width: 30, height: 16, mines: 99, label: 'Expert', hex: false},
  hexSmall: {width: 9, height: 8, mines: 9, label: 'Hex Small', hex: true},
  hexMedium: {width: 14, height: 11, mines: 22, label: 'Hex Medium', hex: true},
  hexLarge: {width: 16, height: 14, mines: 36, label: 'Hex Large', hex: true},
};
export const CLASSIC_PRESETS: readonly ClassicPreset[] = ['beginner', 'intermediate', 'expert'];
export const HEX_PRESETS: readonly HexPreset[] = ['hexSmall', 'hexMedium', 'hexLarge'];

/**
 * Hex topology: offset rows, every odd row shifted half a cell to the right. A cell has six neighbours: left and right in
 * its row, and two in each of the rows above and below. Which two depends on the row's parity (an even row's upper
 * neighbours are at x-1 and x, an odd row's at x and x+1).
 */
export type HexDirection = 'w' | 'e' | 'nw' | 'ne' | 'sw' | 'se';
export const HEX_DIRECTIONS: readonly HexDirection[] = ['w', 'e', 'nw', 'ne', 'sw', 'se'];
const HEX_DELTA: Readonly<Record<'even' | 'odd', Readonly<Record<HexDirection, readonly [number, number]>>>> = {
  even: {w: [-1, 0], e: [1, 0], nw: [-1, -1], ne: [0, -1], sw: [-1, 1], se: [0, 1]},
  odd: {w: [-1, 0], e: [1, 0], nw: [0, -1], ne: [1, -1], sw: [0, 1], se: [1, 1]},
};

/** The cell one step from `cell` in a hex direction, or undefined past the edge. */
export function hexStep(width: number, height: number, cell: number, direction: HexDirection): number | undefined {
  const x = cell % width, y = Math.floor(cell / width);
  const [dx, dy] = HEX_DELTA[y % 2 ? 'odd' : 'even'][direction];
  const nx = x + dx, ny = y + dy;
  return nx >= 0 && ny >= 0 && nx < width && ny < height ? ny * width + nx : undefined;
}

/** The (up to six) neighbours of a cell on a width x height hex board, in direction order. */
export function hexNeighbours(width: number, height: number, cell: number): number[] {
  const out: number[] = [];
  for (const direction of HEX_DIRECTIONS) {
    const next = hexStep(width, height, cell, direction);
    if (next !== undefined) out.push(next);
  }
  return out;
}

export const HIDDEN = 0, OPEN = 1, FLAG = 2;

export class MineBoard {
  readonly size: number;
  mines = new Uint8Array(0);
  /** Neighbouring mine counts. */
  counts = new Uint8Array(0);
  state: Uint8Array;
  placed = false;
  lost = -1;
  /** The order cells were opened by the last reveal, with their flood distance: the cascade's timing. */
  lastOpened: Array<{cell: number; depth: number}> = [];

  constructor(readonly width: number, readonly height: number, readonly mineCount: number, private readonly rng: Rng, readonly hex = false) {
    this.size = width * height;
    this.state = new Uint8Array(this.size);
  }

  /** The cell's neighbours: eight on a square board, six on a hex board. */
  around(cell: number): number[] { return this.hex ? hexNeighbours(this.width, this.height, cell) : neighbours({width: this.width, height: this.height}, cell, ALL_EIGHT); }

  /** Place the mines away from `safe` and its neighbours, then count. */
  private place(safe: number): void {
    const banned = new Set([safe, ...this.around(safe)]);
    const free = [...Array(this.size).keys()].filter(cell => !banned.has(cell));
    this.mines = new Uint8Array(this.size);
    for (const cell of this.rng.shuffle(free).slice(0, Math.min(this.mineCount, free.length))) this.mines[cell] = 1;
    this.counts = new Uint8Array(this.size);
    for (let cell = 0; cell < this.size; cell += 1) this.counts[cell] = this.around(cell).reduce((sum, next) => sum + this.mines[next]!, 0);
    this.placed = true;
  }

  get flags(): number { return this.state.reduce((sum, value) => sum + (value === FLAG ? 1 : 0), 0); }
  get won(): boolean { return this.placed && this.lost < 0 && this.state.every((value, cell) => value === OPEN || this.mines[cell] === 1); }
  get over(): boolean { return this.lost >= 0 || this.won; }

  /** Reveal `cell`: a mine loses; a zero floods its region. Returns whether anything changed. */
  reveal(cell: number): boolean {
    if (this.over || this.state[cell] !== HIDDEN) return false;
    if (!this.placed) this.place(cell);
    this.lastOpened = [];
    if (this.mines[cell]) { this.state[cell] = OPEN; this.lost = cell; return true; }
    const queue: Array<{cell: number; depth: number}> = [{cell, depth: 0}];
    this.state[cell] = OPEN;
    for (let head = 0; head < queue.length; head += 1) {
      const {cell: current, depth} = queue[head]!;
      this.lastOpened.push({cell: current, depth});
      if (this.counts[current] !== 0) continue;
      for (const next of this.around(current)) {
        if (this.state[next] !== HIDDEN || this.mines[next]) continue;
        this.state[next] = OPEN;
        queue.push({cell: next, depth: depth + 1});
      }
    }
    return true;
  }

  flag(cell: number): boolean {
    if (this.over || this.state[cell] === OPEN) return false;
    this.state[cell] = this.state[cell] === FLAG ? HIDDEN : FLAG;
    return true;
  }

  /** On an open number with exactly that many flags around it, reveal every other hidden neighbour. */
  chord(cell: number): boolean {
    if (this.over || this.state[cell] !== OPEN || !this.counts[cell]) return false;
    const around = this.around(cell);
    if (around.filter(next => this.state[next] === FLAG).length !== this.counts[cell]) return false;
    let changed = false;
    const opened: Array<{cell: number; depth: number}> = [];
    for (const next of around) {
      if (this.state[next] !== HIDDEN) continue;
      changed = this.reveal(next) || changed;
      opened.push(...this.lastOpened.map(entry => ({cell: entry.cell, depth: entry.depth + 1})));
      if (this.lost >= 0) break;
    }
    this.lastOpened = opened;
    return changed;
  }

  x(cell: number): number { return cellX({width: this.width, height: this.height}, cell); }
  y(cell: number): number { return cellY({width: this.width, height: this.height}, cell); }
}
