/**
 * Grid helpers for the board games: indices, neighbours, flood fill, BFS distances and connected components. Cells are
 * addressed by index (`y * width + x`); `passable` decides which cells a search may enter. All searches are iterative
 * with explicit queues, bounded by the grid size, and visit neighbours in a fixed order, so results are deterministic.
 */
export const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const DIAGONAL: ReadonlyArray<readonly [number, number]> = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
export const ALL_EIGHT: ReadonlyArray<readonly [number, number]> = [...ORTHOGONAL, ...DIAGONAL];

export interface GridShape { width: number; height: number }

export const cellIndex = (shape: GridShape, x: number, y: number): number => y * shape.width + x;
export const cellX = (shape: GridShape, index: number): number => index % shape.width;
export const cellY = (shape: GridShape, index: number): number => Math.floor(index / shape.width);
export const insideGrid = (shape: GridShape, x: number, y: number): boolean => x >= 0 && y >= 0 && x < shape.width && y < shape.height;

/** Neighbour indices of `index` in `directions` order, skipping cells outside the grid. */
export function neighbours(shape: GridShape, index: number, directions = ORTHOGONAL): number[] {
  const x = cellX(shape, index), y = cellY(shape, index);
  const out: number[] = [];
  for (const [dx, dy] of directions) if (insideGrid(shape, x + dx, y + dy)) out.push(cellIndex(shape, x + dx, y + dy));
  return out;
}

/** Every cell reachable from `start` through passable cells (including `start` when passable), in BFS order. */
export function floodFill(shape: GridShape, start: number, passable: (index: number) => boolean, directions = ORTHOGONAL): number[] {
  if (!passable(start)) return [];
  const seen = new Uint8Array(shape.width * shape.height);
  const order = [start];
  seen[start] = 1;
  for (let head = 0; head < order.length; head += 1) {
    for (const next of neighbours(shape, order[head]!, directions)) {
      if (!seen[next] && passable(next)) { seen[next] = 1; order.push(next); }
    }
  }
  return order;
}

/** BFS distance from `start` to every cell (-1 where unreachable). */
export function distances(shape: GridShape, start: number, passable: (index: number) => boolean, directions = ORTHOGONAL): Int32Array {
  const dist = new Int32Array(shape.width * shape.height).fill(-1);
  if (!passable(start)) return dist;
  const queue = [start];
  dist[start] = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    for (const next of neighbours(shape, current, directions)) {
      if (dist[next] === -1 && passable(next)) { dist[next] = dist[current]! + 1; queue.push(next); }
    }
  }
  return dist;
}

/** The first step from `from` toward `to` along a shortest path, or undefined when `to` is unreachable or equal. */
export function firstStep(shape: GridShape, from: number, to: number, passable: (index: number) => boolean, directions = ORTHOGONAL): number | undefined {
  if (from === to) return undefined;
  const dist = distances(shape, to, passable, directions);
  let best: number | undefined;
  for (const next of neighbours(shape, from, directions)) {
    if (dist[next]! >= 0 && (best === undefined || dist[next]! < dist[best]!)) best = next;
  }
  return best;
}

/** Connected components of cells with equal `key` (cells whose key is undefined belong to none). */
export function components(shape: GridShape, key: (index: number) => number | undefined, directions = ORTHOGONAL): number[][] {
  const seen = new Uint8Array(shape.width * shape.height);
  const groups: number[][] = [];
  for (let index = 0; index < shape.width * shape.height; index += 1) {
    const value = key(index);
    if (seen[index] || value === undefined) continue;
    const group = floodFill(shape, index, cell => key(cell) === value, directions);
    for (const cell of group) seen[cell] = 1;
    groups.push(group);
  }
  return groups;
}
