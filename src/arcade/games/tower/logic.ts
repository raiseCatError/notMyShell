/**
 * Cat Tower's rules, in fixed units (a 60-unit-wide field): a tower of slabs and one slab sliding back and forth above
 * it. Dropping it keeps only the part that overlaps the slab below; the overhang breaks off and falls. A drop within
 * `PERFECT` of the slab below is perfect: nothing is trimmed, and three perfects in a row grow the slab back a little.
 * Missing the tower entirely ends the run. The slide speeds up with height and alternates sides.
 */
export const FIELD = 60;
export const START_W = 24;
export const PERFECT = 0.9;
export const GROW = 2;
export const SPEED_START = 26;
export const SPEED_STEP = 1.1;
export const SPEED_MAX = 64;

export interface Slab { x: number; w: number }
export interface Chip { x: number; w: number; floor: number; y: number; vy: number }
export type TowerEvent = {kind: 'drop'; floor: number; perfect: boolean; trimmed: number; x: number; w: number} | {kind: 'miss'};

export class TowerState {
  slabs: Slab[] = [{x: (FIELD - START_W) / 2, w: START_W}];
  moving: Slab = {x: 0, w: START_W};
  private dir: 1 | -1 = 1;
  /** Broken-off pieces falling away (purely visual, but stepped with the game so replays match). */
  chips: Chip[] = [];
  streak = 0;
  perfects = 0;
  alive = true;
  events: TowerEvent[] = [];

  constructor() { this.spawn(); }

  get floors(): number { return this.slabs.length - 1; }
  get speed(): number { return Math.min(SPEED_MAX, SPEED_START + this.floors * SPEED_STEP); }
  get top(): Slab { return this.slabs[this.slabs.length - 1]!; }

  private spawn(): void {
    const width = this.top.w;
    this.dir = this.floors % 2 === 0 ? 1 : -1;
    this.moving = {x: this.dir > 0 ? -width * 0.6 : FIELD - width * 0.4, w: width};
  }

  step(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const chip of this.chips) { chip.vy += 90 * dt; chip.y += chip.vy * dt; }
    this.chips = this.chips.filter(chip => chip.y < 200);
    if (!this.alive) return;
    // Slide between just past either edge of the field, bouncing back.
    const low = -this.moving.w * 0.6;
    const high = FIELD - this.moving.w * 0.4;
    this.moving.x += this.dir * this.speed * dt;
    if (this.moving.x > high) { this.moving.x = high; this.dir = -1; }
    if (this.moving.x < low) { this.moving.x = low; this.dir = 1; }
  }

  drop(): void {
    if (!this.alive) return;
    const below = this.top;
    const slab = this.moving;
    const floor = this.slabs.length;
    const offset = slab.x - below.x;
    if (Math.abs(offset) <= PERFECT) {
      this.streak += 1;
      this.perfects += 1;
      const width = this.streak >= 3 ? Math.min(START_W, below.w + GROW) : below.w;
      const x = Math.max(0, Math.min(FIELD - width, below.x - (width - below.w) / 2));
      this.slabs.push({x, w: width});
      this.events.push({kind: 'drop', floor, perfect: true, trimmed: 0, x, w: width});
      this.spawn();
      return;
    }
    this.streak = 0;
    const left = Math.max(slab.x, below.x);
    const right = Math.min(slab.x + slab.w, below.x + below.w);
    if (right <= left) {
      this.alive = false;
      this.chips.push({x: slab.x, w: slab.w, floor, y: 0, vy: 0});
      this.events.push({kind: 'miss'});
      return;
    }
    const kept = {x: left, w: right - left};
    // The overhang, on whichever side it hung over, breaks off and falls.
    if (slab.x < left) this.chips.push({x: slab.x, w: left - slab.x, floor, y: 0, vy: 0});
    if (slab.x + slab.w > right) this.chips.push({x: right, w: slab.x + slab.w - right, floor, y: 0, vy: 0});
    this.slabs.push(kept);
    this.events.push({kind: 'drop', floor, perfect: false, trimmed: slab.w - kept.w, x: kept.x, w: kept.w});
    this.spawn();
  }
}
