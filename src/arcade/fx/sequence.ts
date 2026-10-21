import {clamp, easeOutCubic} from '../easing.js';
import type {MotionPreferences} from '../types.js';

/**
 * Time-based building blocks for the arcade's celebrations and transitions. Everything advances only through
 * `update(dtMs)` (a game's `animate`), never by reading a clock, so a fake clock in a test replays it exactly; every
 * piece can be skipped to its end state, and under Reduced Motion each one is built already finished (or as a short,
 * still hold) so nothing moves that the person asked not to see moving.
 */

/** 0 → 1 over `duration` ms after `delay`, eased. */
export class Tween {
  private elapsed = 0;
  constructor(readonly duration: number, readonly delay = 0, private readonly ease: (t: number) => number = easeOutCubic) {}
  update(dtMs: number): void { this.elapsed = Math.min(this.delay + this.duration, this.elapsed + Math.max(0, dtMs)); }
  get raw(): number { return this.duration <= 0 ? (this.elapsed >= this.delay ? 1 : 0) : clamp((this.elapsed - this.delay) / this.duration, 0, 1); }
  get value(): number { return this.ease(this.raw); }
  get done(): boolean { return this.elapsed >= this.delay + this.duration; }
  skip(): void { this.elapsed = this.delay + this.duration; }
  restart(): void { this.elapsed = 0; }
}

export interface Phase<Name extends string = string> { name: Name; ms: number }

/**
 * Named phases played in order (`highlight`, `burst`, `badge`…). `phase` is the current one, `local` its progress.
 * Reduced Motion collapses every phase except those marked `hold`, which stay as calm, still pauses.
 */
export class Sequence<Name extends string = string> {
  private elapsed = 0;
  private readonly phases: Array<Phase<Name>>;
  readonly total: number;

  constructor(phases: ReadonlyArray<Phase<Name>>, motion?: MotionPreferences, hold: readonly Name[] = []) {
    this.phases = phases.map(phase => ({name: phase.name, ms: motion?.reduced && !hold.includes(phase.name) ? 0 : Math.max(0, phase.ms)}));
    this.total = this.phases.reduce((sum, phase) => sum + phase.ms, 0);
  }

  update(dtMs: number): void { this.elapsed = Math.min(this.total, this.elapsed + Math.max(0, dtMs)); }
  skip(): void { this.elapsed = this.total; }
  get done(): boolean { return this.elapsed >= this.total; }
  get time(): number { return this.elapsed; }

  /** The current phase (the last one once done). */
  get phase(): Name {
    let start = 0;
    for (const phase of this.phases) { if (this.elapsed < start + phase.ms) return phase.name; start += phase.ms; }
    return this.phases[this.phases.length - 1]!.name;
  }

  /** Progress through `name`: 0 before it, 1 after it. */
  progress(name: Name): number {
    let start = 0;
    for (const phase of this.phases) {
      if (phase.name === name) return phase.ms <= 0 ? (this.elapsed >= start ? 1 : 0) : clamp((this.elapsed - start) / phase.ms, 0, 1);
      start += phase.ms;
    }
    return 0;
  }

  /** Progress through the current phase. */
  get local(): number { return this.progress(this.phase); }
}

/** A score counting up to its exact value: eased, integer at every frame, ends exactly on `target`. */
export class CountUp {
  private readonly tween: Tween;
  constructor(readonly target: number, readonly from = 0, duration = 900, motion?: MotionPreferences) {
    this.tween = new Tween(motion?.reduced || motion?.effects === 'off' ? 0 : duration, 0);
    if (motion?.reduced || motion?.effects === 'off') this.tween.skip();
  }
  update(dtMs: number): void { this.tween.update(dtMs); }
  skip(): void { this.tween.skip(); }
  get done(): boolean { return this.tween.done; }
  get value(): number { return this.done ? this.target : Math.round(this.from + (this.target - this.from) * this.tween.value); }
}

/** A streak counter with tiers (×2 at 5, ×3 at 10…) that decays when nothing feeds it for `window` ms. */
export class Combo {
  count = 0;
  best = 0;
  private idle = 0;
  /** Time since the last tier was reached, for a short tier-up pulse. */
  private sinceTier = Number.POSITIVE_INFINITY;
  constructor(private readonly window = 0, private readonly tiers: readonly number[] = [5, 10, 20, 40]) {}

  hit(): void {
    const before = this.tier;
    this.count += 1;
    this.best = Math.max(this.best, this.count);
    this.idle = 0;
    if (this.tier > before) this.sinceTier = 0;
  }
  break(): void { this.count = 0; this.idle = 0; }
  update(dtMs: number): void {
    this.sinceTier += dtMs;
    if (this.window > 0 && this.count > 0) { this.idle += dtMs; if (this.idle >= this.window) this.break(); }
  }
  /** 0 below the first tier, then 1, 2… */
  get tier(): number { return this.tiers.filter(threshold => this.count >= threshold).length; }
  get multiplier(): number { return 1 + this.tier; }
  /** 1 right after a tier-up, falling to 0 over 600 ms. */
  get pulse(): number { return this.sinceTier >= 600 ? 0 : 1 - this.sinceTier / 600; }
}
