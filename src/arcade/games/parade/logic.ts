import type {Rng} from '../../rng.js';

/**
 * Kitten Parade's rules. A crowd of kittens runs up a three-lane road and passes through one cell of each gate row:
 * `+n`, `-n`, `×n`, `÷n` change the count, a saw takes a quarter of the crowd (and one more). The count hits zero and
 * the parade is over. Lane changes are instant.
 *
 * Fairness: every row has a `safe` lane whose cell never lowers the count (`+n`, `×n` or empty), the safe lane moves at
 * most one lane between rows, and rows are at least MIN_GAP_S apart. Following the safe lanes can therefore never lose a
 * kitten, whatever the dice rolled elsewhere. The count is capped at MAX_COUNT; the drawing caps the sprites separately.
 */
export const LANES = 3;
export const START_COUNT = 3;
export const MAX_COUNT = 999_999;
export const MIN_GAP_S = 1.1;
export const ROW_LENGTH = 4;
export const LOOKAHEAD = 70;
export const START_SPEED = 9;
export const MAX_SPEED = 18;
export const RAMP = 0.1;
/** The most kitten sprites ever drawn, whatever the count. */
export const MAX_DRAWN = 48;

export type Op = '+' | '-' | '×' | '÷';
export type Gate = {kind: 'gate'; op: Op; n: number} | {kind: 'saw'};
export type Cell = Gate | null;
export interface Row { z: number; cells: [Cell, Cell, Cell]; safe: number; applied: boolean }
export type ParadeEvent =
  | {kind: 'lane'; lane: number}
  | {kind: 'gate'; lane: number; op: Op; before: number; after: number}
  | {kind: 'saw'; lane: number; before: number; after: number}
  | {kind: 'empty'; lane: number}
  | {kind: 'dead'}
  | {kind: 'milestone'; meters: number};

export const speedAt = (time: number): number => Math.min(MAX_SPEED, START_SPEED + RAMP * time);
const RAMP_END = (MAX_SPEED - START_SPEED) / RAMP;
export const distanceAt = (time: number): number => (time <= RAMP_END
  ? START_SPEED * time + 0.5 * RAMP * time * time
  : START_SPEED * RAMP_END + 0.5 * RAMP * RAMP_END * RAMP_END + MAX_SPEED * (time - RAMP_END));
export const timeAt = (distance: number): number => {
  const ramped = distanceAt(RAMP_END);
  return distance <= ramped ? (-START_SPEED + Math.sqrt(START_SPEED * START_SPEED + 2 * RAMP * distance)) / RAMP : RAMP_END + (distance - ramped) / MAX_SPEED;
};

/** The count after passing a cell. */
export function applyCell(count: number, cell: Cell): number {
  if (!cell) return count;
  if (cell.kind === 'saw') return Math.max(0, count - (Math.ceil(count / 4) + 1));
  switch (cell.op) {
    case '+': return Math.min(MAX_COUNT, count + cell.n);
    case '-': return Math.max(0, count - cell.n);
    case '×': return Math.min(MAX_COUNT, count * cell.n);
    case '÷': return Math.floor(count / cell.n);
  }
}

export const cellText = (cell: Cell): string => (!cell ? '' : cell.kind === 'saw' ? 'SAW' : `${cell.op}${cell.n}`);

/** The count as short text: 1,234 stays, 12,345 becomes 12.3k. */
export function compact(count: number): string {
  if (count < 10_000) return String(count);
  if (count < 1_000_000) return `${(Math.floor(count / 100) / 10).toFixed(1)}k`;
  return `${(Math.floor(count / 100_000) / 10).toFixed(1)}M`;
}

/**
 * Where to draw the sprites for a crowd of `count`: at most `cap` of them, packed into rows of at most `maxColumns`,
 * centered on x = 0 and growing downward from y = 0. Positions are in sprite units.
 */
export function crowdLayout(count: number, cap: number, maxColumns: number): Array<{x: number; y: number}> {
  const drawn = Math.max(0, Math.min(Math.floor(count), cap));
  const columns = Math.max(1, Math.min(maxColumns, Math.ceil(Math.sqrt(drawn * 1.6))));
  const out: Array<{x: number; y: number}> = [];
  for (let index = 0; index < drawn; index += 1) {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, drawn - row * columns);
    out.push({x: (index % columns) - (inRow - 1) / 2, y: row});
  }
  return out;
}

export class ParadeState {
  time = 0;
  lane = 1;
  count = START_COUNT;
  peak = START_COUNT;
  alive = true;
  started = false;
  rows: Row[] = [];
  events: ParadeEvent[] = [];
  gates = 0;
  private lastSafe = 1;
  private frontier = 14;
  private estimate = START_COUNT;
  private milestone = 0;

  constructor(private readonly rng: Rng) { this.fill(); }

  get z(): number { return distanceAt(this.time); }
  get speed(): number { return speedAt(this.time); }
  get meters(): number { return Math.floor(this.z); }
  get score(): number { return this.meters + this.peak * 2; }

  private fill(): void { while (this.frontier < this.z + LOOKAHEAD) this.generate(); }

  private generate(): void {
    const rng = this.rng;
    const hard = Math.min(1, timeAt(this.frontier) / 90);
    const est = this.estimate;
    const shift = this.rows.length === 0 ? 0 : rng.pick([-1, 0, 0, 1]);
    const safe = Math.max(0, Math.min(LANES - 1, this.lastSafe + shift));
    const add = (): Cell => ({kind: 'gate', op: '+', n: Math.max(2, Math.round(est * rng.range(0.1, 0.5))) + rng.int(1, 4)});
    const times = (): Cell => ({kind: 'gate', op: '×', n: est > 60 || rng.chance(0.6) ? 2 : 3});
    const cells: [Cell, Cell, Cell] = [null, null, null];
    const roll0 = rng.next();
    cells[safe] = this.rows.length === 0 ? add() : roll0 < 0.62 ? add() : roll0 < 0.82 ? times() : null;
    for (let lane = 0; lane < LANES; lane += 1) {
      if (lane === safe) continue;
      const roll = rng.next() + (this.rows.length === 0 ? -1 : 0);
      cells[lane] = roll < 0.28 + 0.1 * hard ? {kind: 'gate', op: '-', n: Math.max(2, Math.round(est * rng.range(0.25, 0.7)))}
        : roll < 0.46 + 0.1 * hard ? {kind: 'gate', op: '÷', n: est > 40 && rng.chance(0.3) ? 3 : 2}
          : roll < 0.62 + 0.15 * hard ? {kind: 'saw'}
            : roll < 0.86 ? (rng.chance(0.7) ? add() : times()) : null;
    }
    this.estimate = Math.min(2000, applyCell(est, cells[safe]!) || est);
    const gap = Math.max(MIN_GAP_S, (1.55 - 0.3 * hard) + (shift !== 0 ? 0.1 : 0) + rng.range(0, 0.3));
    const start = this.rows.length === 0 ? this.frontier : distanceAt(timeAt(this.frontier) + gap);
    this.rows.push({z: start, cells, safe, applied: false});
    this.frontier = start + ROW_LENGTH;
    this.lastSafe = safe;
  }

  nextRow(): Row | undefined { return this.rows.find(row => !row.applied); }

  moveLane(direction: -1 | 1): boolean {
    if (!this.alive) return false;
    this.started = true;
    const lane = this.lane + direction;
    if (lane < 0 || lane >= LANES) return false;
    this.lane = lane;
    this.events.push({kind: 'lane', lane});
    return true;
  }

  step(dtMs: number): void {
    if (!this.alive || !this.started) return;
    this.time += dtMs / 1000;
    const now = this.z;
    for (const row of this.rows) {
      if (row.applied || row.z > now) continue;
      row.applied = true;
      const cell = row.cells[this.lane] ?? null;
      const before = this.count;
      this.count = applyCell(before, cell);
      this.peak = Math.max(this.peak, this.count);
      this.gates += 1;
      if (!cell) this.events.push({kind: 'empty', lane: this.lane});
      else if (cell.kind === 'saw') this.events.push({kind: 'saw', lane: this.lane, before, after: this.count});
      else this.events.push({kind: 'gate', lane: this.lane, op: cell.op, before, after: this.count});
      if (this.count <= 0) { this.alive = false; this.events.push({kind: 'dead'}); return; }
    }
    this.fill();
    while (this.rows.length > 2 && this.rows[1]!.z < now - 20) this.rows.shift();
    const mark = Math.floor(now / 500);
    if (mark > this.milestone) { this.milestone = mark; this.events.push({kind: 'milestone', meters: mark * 500}); }
  }
}
