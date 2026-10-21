import type {Rgb} from '../../chroma/escape.js';
import {clamp, easeOutCubic} from '../easing.js';
import {EFFECT_SCALE, type ParticleSystem} from '../effects.js';
import type {MotionPreferences} from '../types.js';

/**
 * Grid celebrations: a staggered reveal over groups of cells (a solved Sudoku row, then its box; every Queens cat in
 * turn; Purrword tiles flipping), and a ripple ring spreading from a cell. Both report a 0..1 glow per cell that the
 * game turns into a color; neither draws anything itself, so the board stays the game's to render.
 *
 * Reduced Motion: the reveal shows every cell at a steady, partial glow for its hold time and nothing moves; a ripple is
 * not started at all. With effects off only the steady state remains.
 */
export class Reveal {
  private elapsed = 0;
  private readonly start = new Map<number, number>();
  readonly total: number;
  private readonly still: boolean;

  /**
   * `groups` are played in order, `stagger` ms apart (cells inside a group `within` ms apart); each cell rises over
   * `rise` ms, holds and settles over `fall` ms.
   */
  constructor(groups: ReadonlyArray<readonly number[]>, motion: MotionPreferences, private readonly options: {stagger?: number; within?: number; rise?: number; fall?: number; hold?: number} = {}) {
    const stagger = options.stagger ?? 140;
    const within = options.within ?? 18;
    this.still = motion.reduced || motion.effects === 'off';
    let last = 0;
    groups.forEach((group, groupIndex) => group.forEach((cell, cellIndex) => {
      const at = this.still ? 0 : groupIndex * stagger + cellIndex * within;
      if (!this.start.has(cell)) this.start.set(cell, at);
      last = Math.max(last, at);
    }));
    this.total = this.still ? (options.hold ?? 700) : last + (options.rise ?? 160) + (options.hold ?? 220) + (options.fall ?? 420);
  }

  update(dtMs: number): void { this.elapsed = Math.min(this.total, this.elapsed + Math.max(0, dtMs)); }
  skip(): void { this.elapsed = this.total; }
  get done(): boolean { return this.elapsed >= this.total; }
  /** Whether `cell` takes part. */
  has(cell: number): boolean { return this.start.has(cell); }

  /** Glow for `cell` now, 0..1 (0 for cells outside the reveal). */
  amount(cell: number): number {
    const at = this.start.get(cell);
    if (at === undefined) return 0;
    if (this.still) return this.done ? 0 : 0.6;
    const t = this.elapsed - at;
    const rise = this.options.rise ?? 160;
    const hold = this.options.hold ?? 220;
    const fall = this.options.fall ?? 420;
    if (t <= 0) return 0;
    if (t < rise) return easeOutCubic(t / rise);
    if (t < rise + hold) return 1;
    return clamp(1 - (t - rise - hold) / fall, 0, 1);
  }
}

/** A ring spreading from (x, y) at `speed` cells per second; `amount(x, y)` is 1 on the ring, fading to 0 within `width`. */
export class Ripple {
  private elapsed = 0;
  readonly active: boolean;
  constructor(readonly x: number, readonly y: number, motion: MotionPreferences, private readonly speed = 18, private readonly width = 1.6, private readonly reach = 12) {
    this.active = !motion.reduced && motion.effects !== 'off';
  }
  update(dtMs: number): void { if (this.active) this.elapsed += dtMs; }
  get radius(): number { return (this.elapsed / 1000) * this.speed; }
  get done(): boolean { return !this.active || this.radius > this.reach + this.width; }
  amount(x: number, y: number): number {
    if (this.done) return 0;
    // Terminal cells are about twice as tall as wide: count a row as two columns.
    const distance = Math.hypot(x - this.x, (y - this.y) * 2);
    const fade = 1 - clamp(this.radius / (this.reach + this.width), 0, 1);
    return clamp(1 - Math.abs(distance - this.radius) / this.width, 0, 1) * fade;
  }
}

/**
 * Pixel fragments flying out of a rectangle (a brick, a pane, a block), in pixel coordinates of a `PixelBuffer`: one
 * fragment per few pixels of area, scaled by the effects level, pushed away from `from` (the impact point) and pulled
 * down by gravity. Fragments are ordinary particles in the game's shared, bounded `ParticleSystem`.
 */
export function shatter(particles: ParticleSystem, rect: {x: number; y: number; width: number; height: number}, colors: readonly Rgb[],
  options: {from?: {x: number; y: number}; speed?: number; gravity?: number; density?: number; life?: number} = {}): void {
  const area = Math.max(1, rect.width * rect.height);
  const count = Math.min(24, Math.max(3, Math.round(area / (options.density ?? 3))));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const away = options.from ? Math.atan2(cy - options.from.y, cx - options.from.x) : -Math.PI / 2;
  for (let index = 0; index < count; index += 1) {
    const px = rect.x + ((index * 7) % Math.max(1, rect.width));
    const py = rect.y + ((index * 3) % Math.max(1, rect.height));
    particles.burst({x: px, y: py, count: 1, speed: options.speed ?? 34, angle: away, spread: 1.1, life: options.life ?? 520, gravity: options.gravity ?? 70, drag: 0.6, colors});
  }
}

/** Confetti for a win: a few soft bursts across the top of an area, in the game's palette. Nothing under Effects Off. */
export function confetti(particles: ParticleSystem, width: number, height: number, colors: readonly Rgb[], motion: MotionPreferences): void {
  if (motion.reduced || EFFECT_SCALE[motion.effects] === 0) return;
  for (let index = 0; index < 5; index += 1) {
    particles.burst({x: (width * (index + 0.5)) / 5, y: height * 0.25, count: 10, speed: 40, angle: -Math.PI / 2, spread: 1.3, life: 1100, gravity: 45, drag: 0.4, colors});
  }
}
