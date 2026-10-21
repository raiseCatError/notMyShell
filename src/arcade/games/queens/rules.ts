import {CAT} from './types.js';

/**
 * The rules, checked on a board in progress. `marks[cell]` is 0 empty, 1 excluded, 2 cat; `regions[cell]` the region.
 * Rows, columns and regions each want exactly one cat and no two cats may touch, diagonals included.
 */
export interface Analysis {
  cats: number;
  /** 1 on every cat that breaks a rule: it shares a row, column or region with another cat or touches one. */
  conflict: Uint8Array;
  /** Per row, column and region: how many cats it holds. */
  rowCats: number[];
  columnCats: number[];
  regionCats: number[];
  /** Per row, column and region: exactly one cat and that cat breaks no rule (it glows). */
  rowDone: boolean[];
  columnDone: boolean[];
  regionDone: boolean[];
  /** Every rule holds: a cat in each row, column and region, none touching. */
  solved: boolean;
}

export function analyze(size: number, regions: ArrayLike<number>, marks: ArrayLike<number>): Analysis {
  const total = size * size;
  const conflict = new Uint8Array(total);
  const rowCats = new Array<number>(size).fill(0);
  const columnCats = new Array<number>(size).fill(0);
  const regionCats = new Array<number>(size).fill(0);
  const cats: number[] = [];
  for (let cell = 0; cell < total; cell += 1) {
    if (marks[cell] !== CAT) continue;
    cats.push(cell);
    rowCats[Math.floor(cell / size)]! += 1;
    columnCats[cell % size]! += 1;
    regionCats[regions[cell]!]! += 1;
  }
  for (const cell of cats) {
    const row = Math.floor(cell / size);
    const column = cell % size;
    if (rowCats[row]! > 1 || columnCats[column]! > 1 || regionCats[regions[cell]!]! > 1) conflict[cell] = 1;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const r = row + dy;
        const c = column + dx;
        if (r >= 0 && c >= 0 && r < size && c < size && marks[r * size + c] === CAT) conflict[cell] = 1;
      }
    }
  }
  const unitDone = (counts: number[], unitOf: (cell: number) => number): boolean[] => counts.map((count, index) => count === 1 && cats.every(cell => unitOf(cell) !== index || !conflict[cell]));
  const rowDone = unitDone(rowCats, cell => Math.floor(cell / size));
  const columnDone = unitDone(columnCats, cell => cell % size);
  const regionDone = unitDone(regionCats, cell => regions[cell]!);
  const solved = cats.length === size && cats.every(cell => !conflict[cell]) && rowDone.every(Boolean) && columnDone.every(Boolean) && regionDone.every(Boolean);
  return {cats: cats.length, conflict, rowCats, columnCats, regionCats, rowDone, columnDone, regionDone, solved};
}

/** Region ids as letters: 0 is A. */
export const regionLetter = (region: number): string => String.fromCharCode(65 + region);
