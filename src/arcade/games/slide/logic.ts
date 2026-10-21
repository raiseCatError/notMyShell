import type {Rng} from '../../rng.js';

/**
 * Tile Slide rules: an n x n board of tiles 1..n²-1 and one blank (0). A move slides the tiles of one row or column
 * toward the blank. Shuffles are random permutations repaired to the solvable parity class, never random walks, so a
 * board is always solvable and never starts solved.
 */
export const SIZES = [3, 4, 5] as const;
export type SlideDirection = 'up' | 'down' | 'left' | 'right';

export const solvedTiles = (n: number): number[] => Array.from({length: n * n}, (_, index) => (index + 1) % (n * n));

/** Whether `tiles` can reach the solved board (blank last). Inversion parity, with the blank's row for even widths. */
export function isSolvable(tiles: readonly number[], n: number): boolean {
  const flat = tiles.filter(tile => tile !== 0);
  let inversions = 0;
  for (let a = 0; a < flat.length; a += 1) for (let b = a + 1; b < flat.length; b += 1) if (flat[a]! > flat[b]!) inversions += 1;
  if (n % 2 === 1) return inversions % 2 === 0;
  const blankRowFromBottom = n - Math.floor(tiles.indexOf(0) / n);
  return (inversions + blankRowFromBottom) % 2 === 1;
}

export const isSolved = (tiles: readonly number[]): boolean => tiles.every((tile, index) => tile === (index + 1) % tiles.length);

export function shuffled(n: number, rng: Rng): number[] {
  for (;;) {
    const tiles = rng.shuffle(solvedTiles(n));
    if (!isSolvable(tiles, n)) {
      // Swapping any two tiles flips the parity.
      const [a, b] = tiles.map((tile, index) => (tile === 0 ? -1 : index)).filter(index => index >= 0);
      [tiles[a!], tiles[b!]] = [tiles[b!]!, tiles[a!]!];
    }
    if (!isSolved(tiles)) return tiles;
  }
}

export class SlideBoard {
  tiles: number[];
  moves = 0;
  private past: Array<{tiles: number[]; moves: number}> = [];

  constructor(readonly n: number, tiles?: readonly number[], rng?: Rng) {
    this.tiles = tiles ? [...tiles] : shuffled(n, rng!);
    if (tiles && tiles.length !== n * n) throw new Error('wrong tile count');
  }

  get blank(): number { return this.tiles.indexOf(0); }
  get solved(): boolean { return isSolved(this.tiles); }
  get canUndo(): boolean { return this.past.length > 0; }

  /** Tiles in correct place (the blank excluded). */
  get home(): number { return this.tiles.reduce((sum, tile, index) => sum + (tile !== 0 && tile === index + 1 ? 1 : 0), 0); }

  /** Slide the tile on the far side of the blank toward it: `left` moves the tile right of the blank leftward. */
  slide(direction: SlideDirection): boolean {
    const blank = this.blank, x = blank % this.n, y = Math.floor(blank / this.n);
    const dx = direction === 'left' ? 1 : direction === 'right' ? -1 : 0;
    const dy = direction === 'up' ? 1 : direction === 'down' ? -1 : 0;
    const sx = x + dx, sy = y + dy;
    if (sx < 0 || sy < 0 || sx >= this.n || sy >= this.n) return false;
    return this.commit(sy * this.n + sx);
  }

  /** Click or choose a tile: it, and every tile between it and the blank on the same line, slide one step. */
  pick(cell: number): boolean {
    const blank = this.blank;
    if (cell < 0 || cell >= this.tiles.length || cell === blank) return false;
    const n = this.n;
    const sameRow = Math.floor(cell / n) === Math.floor(blank / n), sameColumn = cell % n === blank % n;
    if (!sameRow && !sameColumn) return false;
    const step = sameRow ? (cell > blank ? 1 : -1) : (cell > blank ? n : -n);
    this.past.push({tiles: [...this.tiles], moves: this.moves});
    for (let at = blank; at !== cell; at += step) this.tiles[at] = this.tiles[at + step]!;
    this.tiles[cell] = 0;
    this.moves += 1;
    return true;
  }

  private commit(cell: number): boolean { return this.pick(cell); }

  undo(): boolean {
    const before = this.past.pop();
    if (!before) return false;
    this.tiles = before.tiles;
    this.moves = before.moves;
    return true;
  }
}

/** A 16 x 16 pixel cat face; `.` is the background. Tiles show slices of it in picture mode. */
export const PICTURE: readonly string[] = [
  '................',
  '..oo........oo..',
  '.oppo......oppo.',
  '.opppoooooopppo.',
  '.oppffffffffppo.',
  '..offffffffffo..',
  '.offeeffffeeffo.',
  '.offegffffgeffo.',
  '.offeeffffeeffo.',
  '.offffffnnffffo.',
  '.offfffnnnnfffo.',
  '.offfmfnnnnfmfo.',
  '..offmmmmmmmfo..',
  '...offffffffo...',
  '....oooooooo....',
  '................',
];
export const PICTURE_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  '.': [38, 44, 70], o: [90, 70, 120], p: [240, 150, 180], f: [200, 170, 255], e: [250, 250, 230], g: [40, 30, 60], n: [255, 130, 150], m: [150, 110, 220],
};
