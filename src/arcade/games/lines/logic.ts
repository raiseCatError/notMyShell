import {cellX, cellY, neighbours, ORTHOGONAL, type GridShape} from '../../engine/grid.js';
import type {Rng} from '../../rng.js';

/**
 * Yarn Lines' rules (Flow-style). Every color has two ends; join each pair with a path of orthogonal steps so that no
 * two paths cross or share a cell and every cell of the board is covered. Boards are generated from a random
 * Hamiltonian path (the "backbite" walk) cut into one segment per color, so each is solvable by construction, and a
 * depth-first solver with pruning is included to verify that independently.
 */
export const SIZES = [5, 6, 7, 8] as const;

export interface LinesPuzzle extends GridShape { colors: number; ends: ReadonlyArray<readonly [number, number]> }
export interface LinesBoardData { puzzle: LinesPuzzle; solution: number[][] }

/** A random Hamiltonian path over a `size x size` grid, as cell indices. */
function hamiltonian(size: number, rng: Rng): number[] {
  const shape: GridShape = {width: size, height: size};
  let path: number[] = [];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) path.push(y * size + (y % 2 === 0 ? x : size - 1 - x));
  for (let round = 0; round < size * size * 20; round += 1) {
    const atHead = rng.chance(0.5);
    const end = atHead ? path[0]! : path[path.length - 1]!;
    const next = atHead ? path[1]! : path[path.length - 2]!;
    const options = neighbours(shape, end, ORTHOGONAL).filter(cell => cell !== next);
    const pick = rng.pick(options);
    const at = path.indexOf(pick);
    if (atHead) path = [...path.slice(0, at).reverse(), ...path.slice(at)];
    else path = [...path.slice(0, at + 1), ...path.slice(at + 1).reverse()];
  }
  return path;
}

/** A solvable board of `size x size` with `size` colors (5 to 8). */
export function generateLines(size: number, rng: Rng): LinesBoardData {
  const colors = size;
  const path = hamiltonian(size, rng);
  const total = size * size;
  const minimum = 3;
  const lengths = Array<number>(colors).fill(minimum);
  for (let extra = total - minimum * colors; extra > 0; extra -= 1) lengths[rng.int(0, colors - 1)]! += 1;
  const solution: number[][] = [];
  let at = 0;
  for (const length of lengths) { solution.push(path.slice(at, at + length)); at += length; }
  const ends = solution.map(segment => [segment[0]!, segment[segment.length - 1]!] as const);
  return {puzzle: {width: size, height: size, colors, ends}, solution};
}

export interface LinesSnapshot { paths: number[][]; active: number | undefined }

export class LinesBoard {
  readonly size: number;
  /** One path per color, starting at whichever end the person began from. */
  paths: number[][];
  active: number | undefined;
  private owner: Int8Array;
  private readonly endColor: Int8Array;
  history: LinesSnapshot[] = [];

  constructor(readonly data: LinesBoardData) {
    const {puzzle} = data;
    this.size = puzzle.width * puzzle.height;
    this.endColor = new Int8Array(this.size).fill(-1);
    puzzle.ends.forEach(([a, b], color) => { this.endColor[a] = color; this.endColor[b] = color; });
    this.paths = puzzle.ends.map(() => []);
    this.owner = new Int8Array(this.size).fill(-1);
  }

  get shape(): GridShape { return this.data.puzzle; }
  ownerOf(cell: number): number { return this.owner[cell]!; }
  endOf(cell: number): number { return this.endColor[cell]!; }
  headOf(color: number): number | undefined { return this.paths[color]!.at(-1); }

  complete(color: number): boolean {
    const path = this.paths[color]!;
    if (path.length < 2) return false;
    const [a, b] = this.data.puzzle.ends[color]!;
    const first = path[0]!, last = path[path.length - 1]!;
    return (first === a && last === b) || (first === b && last === a);
  }

  get filled(): number { return this.owner.reduce((sum, value) => sum + (value >= 0 ? 1 : 0), 0); }
  get connected(): number { return this.paths.reduce((sum, _, color) => sum + (this.complete(color) ? 1 : 0), 0); }
  get won(): boolean { return this.connected === this.data.puzzle.colors && this.filled === this.size; }

  snapshot(): LinesSnapshot { return {paths: this.paths.map(path => path.slice()), active: this.active}; }
  restore(snap: LinesSnapshot): void {
    this.paths = snap.paths.map(path => path.slice());
    this.active = snap.active;
    this.rebuild();
  }

  private rebuild(): void {
    this.owner.fill(-1);
    this.paths.forEach((path, color) => { for (const cell of path) this.owner[cell] = color; });
  }

  private truncate(color: number, length: number): void {
    const path = this.paths[color]!;
    for (let index = length; index < path.length; index += 1) this.owner[path[index]!] = -1;
    path.length = length;
  }

  /** Start drawing at an end (a fresh path) or at a cell of an existing path (keeps the path up to that cell). */
  begin(cell: number): boolean {
    const end = this.endColor[cell]!;
    if (end >= 0) {
      this.truncate(end, 0);
      this.paths[end] = [cell];
      this.owner[cell] = end;
      this.active = end;
      return true;
    }
    const color = this.owner[cell]!;
    if (color < 0) return false;
    const at = this.paths[color]!.indexOf(cell);
    this.truncate(color, at + 1);
    this.active = color;
    return true;
  }

  stop(): void { this.active = undefined; }

  /** Extend (or pull back) the path being drawn onto an adjacent cell. Returns whether anything changed. */
  move(cell: number): boolean {
    const color = this.active;
    if (color === undefined) return false;
    const path = this.paths[color]!;
    const head = path[path.length - 1]!;
    if (!neighbours(this.shape, head).includes(cell)) return false;
    if (path.length >= 2 && path[path.length - 2] === cell) { this.truncate(color, path.length - 1); return true; }
    const own = path.indexOf(cell);
    if (own >= 0) { this.truncate(color, own + 1); return true; }
    const end = this.endColor[cell]!;
    if (end >= 0 && end !== color) return false;
    const other = this.owner[cell]!;
    if (other >= 0 && other !== color) this.truncate(other, this.paths[other]!.indexOf(cell));
    path.push(cell);
    this.owner[cell] = color;
    if (end === color) this.active = undefined;
    return true;
  }

  /** Put a color's path where the generator laid it (a hint), cutting whatever crosses it. */
  place(color: number, cells: readonly number[]): void {
    for (const cell of cells) {
      const other = this.owner[cell]!;
      if (other >= 0 && other !== color) this.truncate(other, this.paths[other]!.indexOf(cell));
    }
    this.truncate(color, 0);
    this.paths[color] = cells.slice();
    for (const cell of cells) this.owner[cell] = color;
    if (this.active === color) this.active = undefined;
  }

  clear(): void { this.paths = this.paths.map(() => []); this.owner.fill(-1); this.active = undefined; }
}

/**
 * Depth-first solver with pruning: always extends the color with the fewest options, rejects boards where an empty cell
 * cannot be passed through or an unfinished color cannot reach its other end. `budget` bounds the nodes visited; the
 * result is the paths (one per color, in order from the first end), or undefined when unsolvable or over budget.
 */
export function solveLines(puzzle: LinesPuzzle, budget = 400_000): number[][] | undefined {
  const {width, height, colors, ends} = puzzle;
  const shape: GridShape = {width, height};
  const size = width * height;
  const owner = new Int8Array(size).fill(-1);
  const isTarget = new Int8Array(size).fill(-1);
  const paths: number[][] = ends.map(([a, b], color) => { owner[a] = color; owner[b] = color; isTarget[b] = color; return [a]; });
  const done = new Array<boolean>(colors).fill(false);
  const nbr: number[][] = Array.from({length: size}, (_, cell) => neighbours(shape, cell));
  let nodes = 0;

  const options = (color: number): number[] => {
    const head = paths[color]![paths[color]!.length - 1]!;
    return nbr[head]!.filter(cell => owner[cell] === -1 || (isTarget[cell] === color && cell === ends[color]![1]));
  };

  const viable = (): boolean => {
    for (let cell = 0; cell < size; cell += 1) {
      if (owner[cell] !== -1) continue;
      let open = 0;
      for (const next of nbr[cell]!) {
        if (owner[next] === -1) open += 1;
        else {
          const color = owner[next]!;
          if (!done[color] && (next === paths[color]![paths[color]!.length - 1] || next === ends[color]![1])) open += 1;
        }
      }
      if (open < 2) return false;
    }
    for (let color = 0; color < colors; color += 1) {
      if (done[color]) continue;
      const head = paths[color]![paths[color]!.length - 1]!, goal = ends[color]![1];
      const seen = new Uint8Array(size);
      const queue = [head];
      seen[head] = 1;
      let reached = false;
      for (let at = 0; at < queue.length && !reached; at += 1) {
        for (const next of nbr[queue[at]!]!) {
          if (seen[next]) continue;
          if (next === goal) { reached = true; break; }
          if (owner[next] === -1) { seen[next] = 1; queue.push(next); }
        }
      }
      if (!reached) return false;
    }
    return true;
  };

  const search = (): boolean => {
    if (nodes > budget) return false;
    nodes += 1;
    let pick = -1, choices: number[] = [];
    for (let color = 0; color < colors; color += 1) {
      if (done[color]) continue;
      const list = options(color);
      if (pick < 0 || list.length < choices.length) { pick = color; choices = list; }
      if (list.length === 0) return false;
    }
    if (pick < 0) return owner.every(value => value >= 0);
    for (const next of choices) {
      const finishing = isTarget[next] === pick && next === ends[pick]![1];
      paths[pick]!.push(next);
      if (finishing) done[pick] = true; else owner[next] = pick;
      if (viable() && search()) return true;
      if (finishing) done[pick] = false; else owner[next] = -1;
      paths[pick]!.pop();
      if (nodes > budget) return false;
    }
    return false;
  };

  return search() ? paths.map(path => path.slice()) : undefined;
}

/** Whether `paths` is a valid, complete solution of `puzzle`: joined ends, adjacent steps, no shared cells, full cover. */
export function validLinesSolution(puzzle: LinesPuzzle, paths: readonly (readonly number[])[]): boolean {
  const shape: GridShape = {width: puzzle.width, height: puzzle.height};
  const seen = new Set<number>();
  if (paths.length !== puzzle.colors) return false;
  for (let color = 0; color < puzzle.colors; color += 1) {
    const path = paths[color]!;
    const [a, b] = puzzle.ends[color]!;
    const ok = (path[0] === a && path.at(-1) === b) || (path[0] === b && path.at(-1) === a);
    if (!ok) return false;
    for (let index = 0; index < path.length; index += 1) {
      const cell = path[index]!;
      if (seen.has(cell)) return false;
      seen.add(cell);
      if (index > 0 && !neighbours(shape, path[index - 1]!).includes(cell)) return false;
    }
  }
  return seen.size === puzzle.width * puzzle.height;
}

export const cellOf = (shape: GridShape, x: number, y: number): number => y * shape.width + x;
export { cellX, cellY };
