import type {Direction} from '../../kit.js';
import type {Rng} from '../../rng.js';

/**
 * Merge 2048's rules. Tiles slide as far as they can in the chosen direction; two equal tiles that meet merge into one of
 * twice the value, and a tile made by a merge cannot merge again in the same move (so 2 2 2 2 becomes 4 4, not 8). The
 * tiles nearest the wall merge first. A move that changes nothing does not count and spawns nothing; otherwise a 2
 * (or, one time in ten, a 4) appears on a random empty cell. The game ends when no move can change the board.
 */
export const SIZE = 4;
export const GOAL = 2048;
export const UNDOS = 3;

export interface Tile { id: number; value: number; cell: number; from: number; merged: boolean; fresh: boolean }

export class MergeBoard {
  tiles: Tile[] = [];
  score = 0;
  moves = 0;
  undosLeft = UNDOS;
  reached = false;
  private nextId = 1;
  private history: Array<{tiles: Tile[]; score: number; reached: boolean}> = [];

  constructor(private readonly rng: Rng, readonly size = SIZE) { this.spawn(); this.spawn(); for (const tile of this.tiles) tile.fresh = true; }

  at(x: number, y: number): Tile | undefined { const cell = y * this.size + x; return this.tiles.find(tile => tile.cell === cell); }
  get best(): number { return Math.max(0, ...this.tiles.map(tile => tile.value)); }

  private spawn(): void {
    const taken = new Set(this.tiles.map(tile => tile.cell));
    const free = [...Array(this.size * this.size).keys()].filter(cell => !taken.has(cell));
    if (!free.length) return;
    const cell = this.rng.pick(free);
    this.tiles.push({id: this.nextId++, value: this.rng.chance(0.1) ? 4 : 2, cell, from: cell, merged: false, fresh: true});
  }

  /** Slide every line toward `direction`. Returns whether anything moved. */
  move(direction: Direction): boolean {
    const before = {tiles: this.tiles.map(tile => ({...tile})), score: this.score, reached: this.reached};
    const n = this.size;
    // Each line, listed from the wall the tiles slide toward.
    const lines: number[][] = [];
    for (let i = 0; i < n; i += 1) {
      const line: number[] = [];
      for (let j = 0; j < n; j += 1) {
        if (direction === 'left') line.push(i * n + j);
        else if (direction === 'right') line.push(i * n + (n - 1 - j));
        else if (direction === 'up') line.push(j * n + i);
        else line.push((n - 1 - j) * n + i);
      }
      lines.push(line);
    }
    const next: Tile[] = [];
    let moved = false;
    for (const line of lines) {
      const tiles = line.map(cell => this.tiles.find(tile => tile.cell === cell)).filter((tile): tile is Tile => Boolean(tile));
      let slot = 0;
      for (let index = 0; index < tiles.length; index += 1) {
        const tile = tiles[index]!;
        const partner = tiles[index + 1];
        if (partner && partner.value === tile.value) {
          const cell = line[slot]!;
          const value = tile.value * 2;
          next.push({id: this.nextId++, value, cell, from: cell, merged: true, fresh: false});
          // The two merging tiles slide into the cell first (kept for the animation as ghosts below).
          next.push({...tile, cell, from: tile.cell, merged: false, fresh: false, value: -tile.value});
          next.push({...partner, cell, from: partner.cell, merged: false, fresh: false, value: -partner.value});
          this.score += value;
          if (value >= GOAL) this.reached = true;
          moved = true;
          index += 1;
        } else {
          const cell = line[slot]!;
          if (cell !== tile.cell) moved = true;
          next.push({...tile, from: tile.cell, cell, merged: false, fresh: false});
        }
        slot += 1;
      }
    }
    if (!moved) return false;
    this.history.push(before);
    if (this.history.length > UNDOS) this.history.shift();
    this.tiles = next;
    this.moves += 1;
    this.settle();
    this.spawn();
    return true;
  }

  /** Ghost tiles (negative values) exist for one move's animation; the board itself is the positive ones. */
  private settle(): void { this.ghosts = this.tiles.filter(tile => tile.value < 0).map(tile => ({...tile, value: -tile.value})); this.tiles = this.tiles.filter(tile => tile.value > 0); }
  ghosts: Tile[] = [];

  undo(): boolean {
    const previous = this.history.pop();
    if (!previous || this.undosLeft <= 0) return false;
    this.undosLeft -= 1;
    this.tiles = previous.tiles.map(tile => ({...tile, from: tile.cell, merged: false, fresh: false}));
    this.score = previous.score;
    this.reached = previous.reached;
    this.ghosts = [];
    return true;
  }

  /** Whether any move would change the board: an empty cell, or two equal neighbours. */
  get canMove(): boolean {
    if (this.tiles.length < this.size * this.size) return true;
    for (let y = 0; y < this.size; y += 1) for (let x = 0; x < this.size; x += 1) {
      const value = this.at(x, y)!.value;
      if (x + 1 < this.size && this.at(x + 1, y)!.value === value) return true;
      if (y + 1 < this.size && this.at(x, y + 1)!.value === value) return true;
    }
    return false;
  }
}
