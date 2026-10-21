import type {Rng} from '../../rng.js';
import type {Puzzle} from './types.js';

/**
 * Puzzle generator: a valid cat placement first, then connected regions grown around it. It knows nothing about
 * uniqueness or difficulty; `puzzle.ts` asks the independent solver about both and asks this module again when the
 * answer is no. Everything is a pure function of the `Rng`, so a seed always rebuilds the same candidates.
 */

/** One cat per row and column, no two touching (adjacent rows differ by at least two columns). Random, by backtracking. */
export function placeCats(size: number, rng: Rng): number[] | undefined {
  const columns: number[] = [];
  const used = new Array<boolean>(size).fill(false);
  let budget = 20_000;
  const fill = (row: number): boolean => {
    if (row === size) return true;
    if (budget-- <= 0) return false;
    for (const column of rng.shuffle(Array.from({length: size}, (_, index) => index))) {
      if (used[column] || (row > 0 && Math.abs(column - columns[row - 1]!) < 2)) continue;
      used[column] = true; columns[row] = column;
      if (fill(row + 1)) return true;
      used[column] = false;
    }
    return false;
  };
  return fill(0) ? columns : undefined;
}

/**
 * Grow `size` connected regions, each starting on one cat. The smaller of two random regions grows first (more or less
 * balanced shapes, `balance` 0..1 says how often), into a random free cell beside it, so every region stays connected.
 */
export function growRegions(size: number, solution: readonly number[], rng: Rng, balance: number): number[] {
  const total = size * size;
  const owner = new Array<number>(total).fill(-1);
  const cells: number[][] = [];
  for (let row = 0; row < size; row += 1) {
    const cell = row * size + solution[row]!;
    owner[cell] = row;
    cells.push([cell]);
  }
  const freeBeside = (region: number): number[] => {
    const free: number[] = [];
    for (const cell of cells[region]!) {
      const row = Math.floor(cell / size);
      const column = cell % size;
      if (row > 0 && owner[cell - size] === -1) free.push(cell - size);
      if (row < size - 1 && owner[cell + size] === -1) free.push(cell + size);
      if (column > 0 && owner[cell - 1] === -1) free.push(cell - 1);
      if (column < size - 1 && owner[cell + 1] === -1) free.push(cell + 1);
    }
    return free;
  };
  for (let assigned = size; assigned < total;) {
    const open = cells.map((_, region) => region).filter(region => freeBeside(region).length > 0);
    let region = rng.pick(open);
    if (rng.chance(balance)) {
      const other = rng.pick(open);
      if (cells[other]!.length < cells[region]!.length) region = other;
    }
    const cell = rng.pick(freeBeside(region));
    owner[cell] = region;
    cells[region]!.push(cell);
    assigned += 1;
  }
  return owner;
}

/** One candidate puzzle: not yet checked for a single solution. */
export function candidatePuzzle(size: number, rng: Rng): Puzzle {
  let solution = placeCats(size, rng);
  for (let attempt = 0; !solution && attempt < 50; attempt += 1) solution = placeCats(size, rng);
  if (!solution) throw new RangeError(`no cat placement for a ${size} x ${size} board`);
  return {size, solution, regions: growRegions(size, solution, rng, rng.range(0.4, 1))};
}

/**
 * Make a candidate more likely to be unique. `another` returns a solution other than the planted one (or undefined when
 * there is none); one cell of it moves into a neighboring region, which spoils that solution (a second cat in the
 * region, or none) while the planted cats and every region's connectedness stay intact. Repeats a bounded number of times.
 */
export function repairRegions(puzzle: Puzzle, rng: Rng, another: (regions: readonly number[]) => number[] | undefined, rounds = 60): boolean {
  const {size, solution, regions} = puzzle;
  const planted = new Set(solution.map((column, row) => row * size + column));
  const around = (cell: number): number[] => {
    const row = Math.floor(cell / size);
    const column = cell % size;
    const out: number[] = [];
    if (row > 0) out.push(cell - size);
    if (row < size - 1) out.push(cell + size);
    if (column > 0) out.push(cell - 1);
    if (column < size - 1) out.push(cell + 1);
    return out;
  };
  const connectedWithout = (region: number, removed: number): boolean => {
    const cells: number[] = [];
    regions.forEach((owner, cell) => { if (owner === region && cell !== removed) cells.push(cell); });
    if (cells.length === 0) return false;
    const seen = new Set<number>([cells[0]!]);
    const queue = [cells[0]!];
    while (queue.length) for (const next of around(queue.pop()!)) if (next !== removed && regions[next] === region && !seen.has(next)) { seen.add(next); queue.push(next); }
    return seen.size === cells.length;
  };
  for (let round = 0; round < rounds; round += 1) {
    const alt = another(regions);
    if (!alt) return true;
    const catRegions = new Map<number, number>();
    alt.forEach((column, row) => catRegions.set(regions[row * size + column]!, row * size + column));
    const moves: Array<{cell: number; to: number; score: number}> = [];
    alt.forEach((column, row) => {
      const cell = row * size + column;
      if (planted.has(cell)) return;
      for (const next of around(cell)) {
        const to = regions[next]!;
        if (to !== regions[cell]) moves.push({cell, to, score: (catRegions.has(to) ? 2 : 0) + rng.next()});
      }
    });
    moves.sort((a, b) => b.score - a.score);
    const move = moves.find(candidate => connectedWithout(regions[candidate.cell]!, candidate.cell));
    if (!move) return false;
    regions[move.cell] = move.to;
  }
  return false;
}
