import type {Rng} from '../../rng.js';

/**
 * Alley Sprint's rules. Three lanes; the cat runs forward by itself and the speed ramps with time. Lane changes are
 * instant. Obstacles come in rows (one cell per lane):
 *  - `low`  a crate: jump over it (the cat must be higher than LOW_H while crossing),
 *  - `high` an overhead beam: slide under it (jumping does not help),
 *  - `wall` solid: only another lane helps.
 * Every row has a `safe` lane whose cell is empty, a crate or a beam, never a wall. The safe lane moves by at most
 * one lane between rows and rows are spaced by at least MIN_GAP_S seconds of running (more when the action changes),
 * so a row is always passable from the previous one. `distanceAt(time)` is closed-form so the generator knows how
 * fast the cat will be when it reaches a row.
 */
export const LANES = 3;
export const GRAVITY = 32;
export const JUMP_V = 9.6;
/** Highest crate: the cat is clear of it while higher than this (metres). */
export const LOW_H = 0.7;
export const SLIDE_S = 0.52;
export const START_SPEED = 15;
export const MAX_SPEED = 34;
export const RAMP = 0.22;
/** Seconds of running between the end of a row and the start of the next, at the very least. */
export const MIN_GAP_S = 1.12;
export const LENGTH = {low: 1.6, high: 1.2, wall: 2.0} as const;
export const LOOKAHEAD = 140;

export type Cell = 'low' | 'high' | 'wall' | null;
export interface Row { z: number; len: number; cells: [Cell, Cell, Cell]; safe: number }
export interface Coin { z: number; lane: number; taken: boolean }
export type AlleyEvent =
  | {kind: 'jump'} | {kind: 'land'} | {kind: 'slide'} | {kind: 'lane'; lane: number}
  | {kind: 'coin'; lane: number; z: number} | {kind: 'crash'; lane: number; what: Exclude<Cell, null>}
  | {kind: 'milestone'; meters: number};

const RAMP_END = (MAX_SPEED - START_SPEED) / RAMP;
export const speedAt = (time: number): number => Math.min(MAX_SPEED, START_SPEED + RAMP * time);
export const distanceAt = (time: number): number => (time <= RAMP_END
  ? START_SPEED * time + 0.5 * RAMP * time * time
  : START_SPEED * RAMP_END + 0.5 * RAMP * RAMP_END * RAMP_END + MAX_SPEED * (time - RAMP_END));
export const timeAt = (distance: number): number => {
  const ramped = distanceAt(RAMP_END);
  return distance <= ramped ? (-START_SPEED + Math.sqrt(START_SPEED * START_SPEED + 2 * RAMP * distance)) / RAMP : RAMP_END + (distance - ramped) / MAX_SPEED;
};

export class AlleyState {
  time = 0;
  lane = 1;
  /** Height above the ground in metres and vertical speed. */
  y = 0;
  vy = 0;
  slideLeft = 0;
  slideQueued = false;
  alive = true;
  started = false;
  coins = 0;
  rows: Row[] = [];
  pickups: Coin[] = [];
  events: AlleyEvent[] = [];
  crashed: {lane: number; what: Exclude<Cell, null>} | undefined;
  private lastSafe = 1;
  private lastAction: 'jump' | 'slide' | 'none' = 'none';
  private frontier = 12;
  private milestone = 0;

  constructor(private readonly rng: Rng) { this.fill(); }

  get z(): number { return distanceAt(this.time); }
  get speed(): number { return speedAt(this.time); }
  get sliding(): boolean { return this.slideLeft > 0; }
  get grounded(): boolean { return this.y <= 0; }
  get meters(): number { return Math.floor(this.z); }
  get score(): number { return this.meters + this.coins * 10; }

  private fill(): void { while (this.frontier < this.z + LOOKAHEAD) this.generate(); }

  /** One more row ahead of the last, by the fairness rules above. */
  private generate(): void {
    const rng = this.rng;
    const hard = Math.min(1, timeAt(this.frontier) / 90);
    const shift = this.rows.length < 2 ? 0 : rng.pick([-1, 0, 0, 1]);
    const safe = Math.max(0, Math.min(LANES - 1, this.lastSafe + shift));
    const safeCell: Cell = rng.chance(0.25 + 0.4 * hard) ? (rng.chance(0.5) ? 'low' : 'high') : null;
    const cells: [Cell, Cell, Cell] = [null, null, null];
    for (let lane = 0; lane < LANES; lane += 1) {
      if (lane === safe) { cells[lane] = safeCell; continue; }
      const roll = rng.next();
      cells[lane] = roll < 0.3 + 0.35 * hard ? 'wall' : roll < 0.6 + 0.2 * hard ? rng.pick(['low', 'high'] as const) : null;
    }
    // An early row is gentle: nothing in the way for the first few seconds.
    if (this.rows.length === 0) cells.fill(null);
    const action: 'jump' | 'slide' | 'none' = cells[safe] === 'low' ? 'jump' : cells[safe] === 'high' ? 'slide' : 'none';
    const len = Math.max(...cells.map(cell => (cell ? LENGTH[cell] : 0)), 1);
    const time = (1.75 - 0.55 * hard) + (action !== 'none' && this.lastAction !== 'none' && action !== this.lastAction ? 0.25 : 0) + (shift !== 0 ? 0.1 : 0) + rng.range(0, 0.3);
    const gapTime = Math.max(MIN_GAP_S, time);
    const start = this.rows.length === 0 ? this.frontier : distanceAt(timeAt(this.frontier) + gapTime);
    // Coins in the safe lane of this row, laid out between the last row and this one.
    if (this.rows.length > 0) {
      const from = this.frontier + 1;
      const room = start - from - 2;
      if (room > 3 && rng.chance(0.7)) for (let index = 0; index < Math.min(5, Math.floor(room / 2.2)); index += 1) this.pickups.push({z: from + 1 + index * 2.2, lane: safe, taken: false});
    }
    this.rows.push({z: start, len, cells, safe});
    this.frontier = start + len;
    this.lastSafe = safe;
    this.lastAction = action;
  }

  /** The next row the cat has not passed yet. */
  nextRow(): Row | undefined { const z = this.z; return this.rows.find(row => row.z + row.len > z); }

  moveLane(direction: -1 | 1): boolean {
    if (!this.alive) return false;
    this.started = true;
    const lane = this.lane + direction;
    if (lane < 0 || lane >= LANES) return false;
    this.lane = lane;
    this.events.push({kind: 'lane', lane});
    return true;
  }

  jump(): void {
    if (!this.alive) return;
    this.started = true;
    if (!this.grounded) return;
    this.slideLeft = 0;
    this.slideQueued = false;
    this.vy = JUMP_V;
    this.y = 1e-6;
    this.events.push({kind: 'jump'});
  }

  slide(): void {
    if (!this.alive) return;
    this.started = true;
    if (!this.grounded) { this.vy = Math.min(this.vy, -18); this.slideQueued = true; return; }
    this.slideLeft = SLIDE_S;
    this.events.push({kind: 'slide'});
  }

  step(dtMs: number): void {
    if (!this.alive || !this.started) return;
    const dt = dtMs / 1000;
    const before = this.z;
    this.time += dt;
    const now = this.z;
    if (!this.grounded || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0; this.vy = 0;
        this.events.push({kind: 'land'});
        if (this.slideQueued) { this.slideQueued = false; this.slideLeft = SLIDE_S; this.events.push({kind: 'slide'}); }
      }
    }
    if (this.slideLeft > 0) this.slideLeft = Math.max(0, this.slideLeft - dt);
    this.collide(before, now);
    this.fill();
    // Forget what is well behind.
    while (this.rows.length > 2 && this.rows[1]!.z < now - 20) this.rows.shift();
    while (this.pickups.length > 0 && this.pickups[0]!.z < now - 20) this.pickups.shift();
    const mark = Math.floor(now / 500);
    if (mark > this.milestone) { this.milestone = mark; this.events.push({kind: 'milestone', meters: mark * 500}); }
  }

  /** The cat's z moved from `before` to `now` this step: anything it crossed in its lane counts. */
  private collide(before: number, now: number): void {
    for (const coin of this.pickups) {
      if (coin.taken || coin.lane !== this.lane || coin.z < before - 0.5 || coin.z > now + 0.5 || this.y > 1.4) continue;
      coin.taken = true; this.coins += 1;
      this.events.push({kind: 'coin', lane: coin.lane, z: coin.z});
    }
    for (const row of this.rows) {
      if (row.z > now || row.z + row.len < before) continue;
      const cell = row.cells[this.lane];
      if (!cell) continue;
      const hit = cell === 'wall' || (cell === 'low' && this.y < LOW_H) || (cell === 'high' && !this.sliding);
      if (hit) {
        this.alive = false;
        this.crashed = {lane: this.lane, what: cell};
        this.events.push({kind: 'crash', lane: this.lane, what: cell});
        return;
      }
    }
  }
}
