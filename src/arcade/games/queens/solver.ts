import type {Difficulty} from './types.js';

/**
 * The independent solver. It shares nothing with the generator: it counts solutions by exhaustive search (to prove a
 * puzzle has exactly one) and it solves the way a person does, technique by technique, so a puzzle can be rated by the
 * hardest technique it needs and a hint can say which one applies next. Cells are `row * size + column`; a region
 * layout is `regions[cell]`.
 */

// ---- uniqueness ---------------------------------------------------------------------------------------------------

/** Number of valid placements, counting no further than `limit` (2 is enough to tell unique from not). */
export function countSolutions(size: number, regions: readonly number[], limit = 2): number {
  let found = 0;
  const columns: number[] = [];
  const search = (row: number, usedColumns: number, usedRegions: number): void => {
    if (found >= limit) return;
    if (row === size) { found += 1; return; }
    for (let column = 0; column < size; column += 1) {
      const region = regions[row * size + column]!;
      if ((usedColumns >> column) & 1 || (usedRegions >> region) & 1) continue;
      if (row > 0 && Math.abs(column - columns[row - 1]!) < 2) continue;
      columns[row] = column;
      search(row + 1, usedColumns | (1 << column), usedRegions | (1 << region));
      if (found >= limit) return;
    }
  };
  search(0, 0, 0);
  return found;
}

/** The first solution found (a column per row), or undefined. */
export function solveOne(size: number, regions: readonly number[]): number[] | undefined {
  const columns: number[] = [];
  const search = (row: number, usedColumns: number, usedRegions: number): boolean => {
    if (row === size) return true;
    for (let column = 0; column < size; column += 1) {
      const region = regions[row * size + column]!;
      if ((usedColumns >> column) & 1 || (usedRegions >> region) & 1) continue;
      if (row > 0 && Math.abs(column - columns[row - 1]!) < 2) continue;
      columns[row] = column;
      if (search(row + 1, usedColumns | (1 << column), usedRegions | (1 << region))) return true;
    }
    return false;
  };
  return search(0, 0, 0) ? columns : undefined;
}

/** A solution different from `known` (a column per row), or undefined when `known` is the only one. */
export function solveOther(size: number, regions: readonly number[], known: readonly number[]): number[] | undefined {
  const columns: number[] = [];
  const search = (row: number, usedColumns: number, usedRegions: number, differs: boolean): boolean => {
    if (row === size) return differs;
    for (let column = 0; column < size; column += 1) {
      const region = regions[row * size + column]!;
      if ((usedColumns >> column) & 1 || (usedRegions >> region) & 1) continue;
      if (row > 0 && Math.abs(column - columns[row - 1]!) < 2) continue;
      columns[row] = column;
      if (search(row + 1, usedColumns | (1 << column), usedRegions | (1 << region), differs || column !== known[row])) return true;
    }
    return false;
  };
  return search(0, 0, 0, false) ? [...columns] : undefined;
}

// ---- human techniques ---------------------------------------------------------------------------------------------

export type Technique = 'single' | 'confined' | 'blocked' | 'pair' | 'triple';
/** Hardness of each technique; a puzzle is rated by the highest level it needs. */
export const TECHNIQUE_LEVEL: Readonly<Record<Technique, number>> = {single: 1, confined: 2, blocked: 3, pair: 4, triple: 5};

/** The levels a requested difficulty accepts. */
export const DIFFICULTY_LEVELS: Readonly<Record<Difficulty, readonly [number, number]>> = {easy: [1, 2], medium: [2, 3], hard: [3, 4], expert: [4, 5]};

/** How far a rating is from a difficulty's band (0 when it fits). */
export function levelDistance(level: number, difficulty: Difficulty): number {
  const [low, high] = DIFFICULTY_LEVELS[difficulty];
  return level < low ? low - level : level > high ? level - high : 0;
}

export interface LogicStep {
  technique: Technique;
  level: number;
  /** A cat goes here (a cell), or nothing is placed and `eliminate` lists the cells that cannot hold one. */
  place?: number;
  eliminate: number[];
  /** The cells that justify the step, for highlighting. */
  involved: number[];
  /** One sentence naming the reasoning, in rows and columns counted from 1. */
  text: string;
}

type UnitKind = 'row' | 'column' | 'region';
const KINDS: readonly UnitKind[] = ['row', 'column', 'region'];

const regionName = (region: number): string => String.fromCharCode(65 + region);
const cellName = (size: number, cell: number): string => `row ${Math.floor(cell / size) + 1}, column ${(cell % size) + 1}`;
const unitName = (kind: UnitKind, index: number): string => (kind === 'region' ? `Region ${regionName(index)}` : `${kind === 'row' ? 'Row' : 'Column'} ${index + 1}`);
const lineName = (kind: 'row' | 'column', index: number): string => `${kind} ${index + 1}`;
const joinList = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const bits = (mask: number): number[] => { const out: number[] = []; for (let index = 0; mask >> index; index += 1) if ((mask >> index) & 1) out.push(index); return out; };
const popcount = (mask: number): number => { let count = 0; for (let value = mask; value; value &= value - 1) count += 1; return count; };

/** Candidates, cats and which units already have their cat. */
export class LogicBoard {
  readonly total: number;
  readonly candidate: Uint8Array;
  readonly cat: Uint8Array;
  private readonly satisfied = {row: new Uint8Array(0), column: new Uint8Array(0), region: new Uint8Array(0)};
  private readonly units: Record<UnitKind, number[][]>;
  catCount = 0;

  constructor(readonly size: number, readonly regions: readonly number[]) {
    this.total = size * size;
    this.candidate = new Uint8Array(this.total).fill(1);
    this.cat = new Uint8Array(this.total);
    this.satisfied = {row: new Uint8Array(size), column: new Uint8Array(size), region: new Uint8Array(size)};
    this.units = {row: [], column: [], region: []};
    for (let index = 0; index < size; index += 1) { this.units.row.push([]); this.units.column.push([]); this.units.region.push([]); }
    for (let cell = 0; cell < this.total; cell += 1) {
      this.units.row[Math.floor(cell / size)]!.push(cell);
      this.units.column[cell % size]!.push(cell);
      this.units.region[regions[cell]!]!.push(cell);
    }
  }

  rowOf(cell: number): number { return Math.floor(cell / this.size); }
  columnOf(cell: number): number { return cell % this.size; }
  unitOf(kind: UnitKind, cell: number): number { return kind === 'row' ? this.rowOf(cell) : kind === 'column' ? this.columnOf(cell) : this.regions[cell]!; }
  isSatisfied(kind: UnitKind, index: number): boolean { return this.satisfied[kind][index] === 1; }
  open(kind: UnitKind, index: number): number[] { return this.units[kind][index]!.filter(cell => this.candidate[cell] === 1); }

  /** Two different cells that cannot both hold cats. */
  clash(a: number, b: number): boolean {
    return a !== b && (this.rowOf(a) === this.rowOf(b) || this.columnOf(a) === this.columnOf(b) || this.regions[a] === this.regions[b]
      || (Math.abs(this.rowOf(a) - this.rowOf(b)) <= 1 && Math.abs(this.columnOf(a) - this.columnOf(b)) <= 1));
  }

  place(cell: number): void {
    if (this.cat[cell]) return;
    this.cat[cell] = 1;
    this.catCount += 1;
    for (let other = 0; other < this.total; other += 1) if (this.clash(cell, other)) this.candidate[other] = 0;
    this.satisfied.row[this.rowOf(cell)] = 1;
    this.satisfied.column[this.columnOf(cell)] = 1;
    this.satisfied.region[this.regions[cell]!] = 1;
  }

  remove(cells: readonly number[]): void { for (const cell of cells) if (!this.cat[cell]) this.candidate[cell] = 0; }

  /** The easiest technique that makes progress now, or undefined when none of them does. */
  nextStep(): LogicStep | undefined {
    return this.singles() ?? this.confined() ?? this.blocked() ?? this.tuples(2) ?? this.tuples(3);
  }

  private singles(): LogicStep | undefined {
    for (const kind of KINDS) {
      for (let index = 0; index < this.size; index += 1) {
        if (this.satisfied[kind][index]) continue;
        const open = this.open(kind, index);
        if (open.length !== 1 || this.cat[open[0]!]) continue;
        const cell = open[0]!;
        const what = kind === 'region' ? `${unitName(kind, index)} has only one open cell` : `${unitName(kind, index)} has only one open cell`;
        return {technique: 'single', level: 1, place: cell, eliminate: [], involved: [cell], text: `${what} (${cellName(this.size, cell)}): place a cat there.`};
      }
    }
    return undefined;
  }

  private confined(): LogicStep | undefined {
    const size = this.size;
    for (let region = 0; region < size; region += 1) {
      if (this.satisfied.region[region]) continue;
      const open = this.open('region', region);
      for (const line of ['row', 'column'] as const) {
        if (!open.length || !open.every(cell => this.unitOf(line, cell) === this.unitOf(line, open[0]!))) continue;
        const index = this.unitOf(line, open[0]!);
        const eliminate = this.open(line, index).filter(cell => this.regions[cell] !== region);
        if (eliminate.length) return {technique: 'confined', level: 2, eliminate, involved: open, text: `${unitName('region', region)} is confined to ${lineName(line, index)}, so exclude ${lineName(line, index)} elsewhere.`};
      }
    }
    for (const line of ['row', 'column'] as const) {
      for (let index = 0; index < size; index += 1) {
        if (this.satisfied[line][index]) continue;
        const open = this.open(line, index);
        if (!open.length || !open.every(cell => this.regions[cell] === this.regions[open[0]!])) continue;
        const region = this.regions[open[0]!]!;
        const eliminate = this.open('region', region).filter(cell => this.unitOf(line, cell) !== index);
        if (eliminate.length) return {technique: 'confined', level: 2, eliminate, involved: open, text: `${unitName(line, index)} can only hold a cat of region ${regionName(region)}, so exclude the rest of region ${regionName(region)}.`};
      }
    }
    return undefined;
  }

  /** A cell where a cat would leave some other row, column or region with no open cell at all. */
  private blocked(): LogicStep | undefined {
    for (let cell = 0; cell < this.total; cell += 1) {
      if (!this.candidate[cell] || this.cat[cell]) continue;
      for (const kind of KINDS) {
        for (let index = 0; index < this.size; index += 1) {
          if (this.satisfied[kind][index] || this.unitOf(kind, cell) === index) continue;
          const open = this.open(kind, index);
          if (open.length && open.every(other => this.clash(cell, other))) {
            return {technique: 'blocked', level: 3, eliminate: [cell], involved: [cell, ...open],
              text: `A cat at ${cellName(this.size, cell)} would leave ${unitName(kind, index)} with no open cell, so exclude it.`};
          }
        }
      }
    }
    return undefined;
  }

  /** `count` units confined to exactly `count` crossing units (regions in lines, lines in regions). */
  private tuples(count: number): LogicStep | undefined {
    const size = this.size;
    const technique: Technique = count === 2 ? 'pair' : 'triple';
    const level = TECHNIQUE_LEVEL[technique];
    const word = count === 2 ? 'two' : 'three';
    const choose = (pool: number[], visit: (picked: number[]) => LogicStep | undefined, picked: number[] = [], from = 0): LogicStep | undefined => {
      if (picked.length === count) return visit(picked);
      for (let position = from; position < pool.length; position += 1) {
        const step = choose(pool, visit, [...picked, pool[position]!], position + 1);
        if (step) return step;
      }
      return undefined;
    };
    for (const line of ['row', 'column'] as const) {
      const lineMask = (cells: number[]): number => cells.reduce((mask, cell) => mask | (1 << this.unitOf(line, cell)), 0);
      const regionMask = (cells: number[]): number => cells.reduce((mask, cell) => mask | (1 << this.regions[cell]!), 0);
      const regionPool = Array.from({length: size}, (_, region) => region).filter(region => !this.satisfied.region[region]);
      // regions that together fit in as many lines: those lines belong to them
      const found = choose(regionPool, regions => {
        const union = regions.reduce((mask, region) => mask | lineMask(this.open('region', region)), 0);
        if (popcount(union) !== count) return undefined;
        const lines = bits(union);
        const eliminate = lines.flatMap(index => this.open(line, index)).filter(cell => !regions.includes(this.regions[cell]!));
        if (!eliminate.length) return undefined;
        return {technique, level, eliminate, involved: regions.flatMap(region => this.open('region', region)),
          text: `Regions ${joinList(regions.map(regionName))} fit only in ${line}s ${joinList(lines.map(index => String(index + 1)))}, so exclude those ${line}s elsewhere (${word} regions in ${word} ${line}s).`};
      });
      if (found) return found;
      const linePool = Array.from({length: size}, (_, index) => index).filter(index => !this.satisfied[line][index]);
      // lines that together fit in as many regions: those regions belong to the lines
      const other = choose(linePool, lines => {
        const union = lines.reduce((mask, index) => mask | regionMask(this.open(line, index)), 0);
        if (popcount(union) !== count) return undefined;
        const regions = bits(union);
        const eliminate = regions.flatMap(region => this.open('region', region)).filter(cell => !lines.includes(this.unitOf(line, cell)));
        if (!eliminate.length) return undefined;
        return {technique, level, eliminate, involved: lines.flatMap(index => this.open(line, index)),
          text: `${line === 'row' ? 'Rows' : 'Columns'} ${joinList(lines.map(index => String(index + 1)))} can only hold cats of regions ${joinList(regions.map(regionName))}, so exclude those regions elsewhere (${word} ${line}s in ${word} regions).`};
      });
      if (other) return other;
    }
    return undefined;
  }

  apply(step: LogicStep): void {
    if (step.place !== undefined) this.place(step.place);
    else this.remove(step.eliminate);
  }
}

export interface Rating {
  /** Solved by the techniques alone, without trying a cell and backing out. */
  solved: boolean;
  /** The hardest technique level needed (0 when nothing applied). */
  level: number;
  steps: number;
}

/** Solve like a person, easiest technique first, and report the hardest one that was needed. */
export function rate(size: number, regions: readonly number[]): Rating {
  const board = new LogicBoard(size, regions);
  let level = 0;
  let steps = 0;
  while (board.catCount < size) {
    const step = board.nextStep();
    if (!step) return {solved: false, level, steps};
    board.apply(step);
    level = Math.max(level, step.level);
    steps += 1;
  }
  return {solved: true, level, steps};
}

// ---- hints --------------------------------------------------------------------------------------------------------

export interface Hint {
  kind: 'place' | 'exclude' | 'fix';
  technique: Technique | 'fix';
  text: string;
  /** Cells that explain the hint. */
  involved: number[];
  /** Cells the hint would change: where a cat goes, where X marks go, or the mark to clear. */
  targets: number[];
  /** What applying it does to the board: marks to set (`2` cat, `1` excluded, `0` clear). */
  changes: Array<{cell: number; to: number}>;
}

/**
 * The next logical step for a board in progress (`marks`: 0 empty, 1 excluded, 2 cat) of a puzzle whose answer is
 * `solution`. A wrong cat or X mark is pointed out first; after that the easiest technique that adds something the
 * board does not show yet. It reads the board and never changes anything.
 */
export function nextHint(size: number, regions: readonly number[], solution: readonly number[], marks: ArrayLike<number>): Hint | undefined {
  const board = new LogicBoard(size, regions);
  const answer = (cell: number): boolean => solution[Math.floor(cell / size)] === cell % size;
  const cats: number[] = [];
  for (let cell = 0; cell < size * size; cell += 1) if (marks[cell] === 2) cats.push(cell);
  const wrong = cats.find(cell => !answer(cell));
  if (wrong !== undefined) {
    const partner = cats.find(cell => cell !== wrong && board.clash(cell, wrong));
    const text = partner === undefined
      ? `The cat at ${cellName(size, wrong)} is not part of the solution (a dead end): lift it.`
      : `The cats at ${cellName(size, wrong)} and ${cellName(size, partner)} clash: lift the first.`;
    return {kind: 'fix', technique: 'fix', text, involved: partner === undefined ? [wrong] : [wrong, partner], targets: [wrong], changes: [{cell: wrong, to: 0}]};
  }
  for (let cell = 0; cell < size * size; cell += 1) {
    if (marks[cell] === 1 && answer(cell)) {
      return {kind: 'fix', technique: 'fix', text: `The X at ${cellName(size, cell)} hides a cat's only home: clear it.`, involved: [cell], targets: [cell], changes: [{cell, to: 0}]};
    }
  }
  for (const cell of cats) board.place(cell);
  for (let cell = 0; cell < size * size; cell += 1) if (marks[cell] === 1) board.remove([cell]);
  if (board.catCount >= size) return undefined;
  const step = board.nextStep();
  if (step?.place !== undefined) return {kind: 'place', technique: step.technique, text: step.text, involved: step.involved, targets: [step.place], changes: [{cell: step.place, to: 2}]};
  if (step) return {kind: 'exclude', technique: step.technique, text: step.text, involved: step.involved, targets: step.eliminate, changes: step.eliminate.map(cell => ({cell, to: 1}))};
  // The techniques ran out on a board the person narrowed oddly: fall back to the answer for the first empty row.
  const row = Array.from({length: size}, (_, index) => index).find(index => !cats.some(cell => Math.floor(cell / size) === index))!;
  const cell = row * size + solution[row]!;
  return {kind: 'place', technique: 'single', text: `Row ${row + 1} belongs to a cat at column ${solution[row]! + 1}: place it there.`, involved: [cell], targets: [cell], changes: [{cell, to: 2}]};
}
