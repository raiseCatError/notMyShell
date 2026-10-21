import type {Rng} from '../../rng.js';
import {PHRASES, type Mode} from './words.js';

/**
 * Driftkeys' rules. Phrases appear one to a row, drift sideways, and fade out if they are not finished in time. Only the
 * oldest phrase on the field is active: keys are checked against its next character, a right key moves the highlight on,
 * a wrong one counts against accuracy and does nothing else, and the last right key completes the phrase on the spot.
 * The simulation runs in fixed steps of `STEP_MS` whatever the frame rate, and every random choice comes from the seed.
 * The state keeps only how many characters of the active phrase are matched: it never stores what was typed.
 */
export const STEP_MS = 20;
export const MAX_LEVEL = 12;
export const LIVES = 3;
export const FADE_IN_MS = 350;
export const FADE_OUT = 0.3;

export interface Target { id: number; text: string; typed: number; x: number; lane: number; vx: number; age: number; life: number }
export type Press = 'correct' | 'wrong' | 'done' | 'idle';
export interface Completed { x: number; lane: number; points: number }

export const levelOf = (completed: number): number => Math.min(MAX_LEVEL, 1 + Math.floor(completed / 5));

export class DriftState {
  targets: Target[] = [];
  score = 0;
  correct = 0;
  wrong = 0;
  completed = 0;
  missed = 0;
  lives = LIVES;
  elapsed = 0;
  over = false;
  events: Completed[] = [];
  private nextId = 1;
  private spawnIn = 500;
  private pending = 0;
  private lanes: number[] = [];

  constructor(readonly mode: Mode, private readonly rng: Rng, public width: number, public height: number, private readonly drift = 1) { this.layout(); }

  get level(): number { return levelOf(this.completed); }
  get accuracy(): number { const total = this.correct + this.wrong; return total ? Math.floor((this.correct * 100) / total) : 100; }
  get active(): Target | undefined { return this.targets[0]; }

  /** Rows phrases may sit on: from row 2 down to three rows above the bottom, every second row on tall fields. */
  private layout(): void {
    const first = 2, last = Math.max(first, this.height - 3);
    const step = last - first >= 12 ? 2 : 1;
    this.lanes = [];
    for (let row = first; row <= last; row += step) this.lanes.push(row);
  }

  /** Columns a phrase may start in: leaves room for its pointer on the left and its fade mark on the right. */
  bounds(text: string): {min: number; max: number} { return {min: 3, max: Math.max(3, this.width - 3 - text.length)}; }

  resize(width: number, height: number): void {
    this.width = width; this.height = height;
    this.layout();
    this.targets = this.targets.filter(target => target.text.length + 6 <= width);
    for (const target of this.targets) {
      const {min, max} = this.bounds(target.text);
      target.x = Math.min(max, Math.max(min, target.x));
      target.lane = this.lanes.reduce((best, lane) => (Math.abs(lane - target.lane) < Math.abs(best - target.lane) ? lane : best), this.lanes[0]!);
    }
  }

  private capacity(): number { return Math.min(this.lanes.length, 2 + Math.floor(this.level / 3)); }
  private interval(): number { return Math.max(900, 2700 - 150 * this.level); }

  private pick(): string | undefined {
    const tiers = PHRASES[this.mode];
    const reach = this.level < 3 ? 1 : this.level < 6 ? 2 : 3;
    const pool: string[] = [];
    for (let tier = 0; tier < reach; tier += 1) {
      const weight = tier === reach - 1 ? 3 : 1;
      for (const phrase of tiers[tier]!) if (phrase.length + 6 <= this.width && !this.targets.some(target => target.text === phrase)) for (let i = 0; i < weight; i += 1) pool.push(phrase);
    }
    return pool.length ? this.rng.pick(pool) : undefined;
  }

  private spawn(): boolean {
    if (this.targets.length >= this.capacity()) return false;
    const free = this.lanes.filter(lane => !this.targets.some(target => target.lane === lane));
    const text = this.pick();
    if (!free.length || text === undefined) return false;
    const {min, max} = this.bounds(text);
    const speed = (1.1 + 0.4 * this.level) * this.drift;
    const scale = Math.max(0.5, 1 - 0.045 * this.level);
    this.targets.push({
      id: this.nextId += 1, text, typed: 0, lane: this.rng.pick(free), x: min + this.rng.next() * (max - min),
      vx: (this.rng.chance(0.5) ? 1 : -1) * speed * (0.7 + this.rng.next() * 0.6), age: 0, life: (3200 + text.length * 560) * scale,
    });
    return true;
  }

  /** Advance by `dtMs` of game time, in whole fixed steps (the remainder carries to the next call). */
  advance(dtMs: number): void {
    this.pending += Math.max(0, dtMs);
    while (this.pending >= STEP_MS - 1e-6 && !this.over) { this.pending -= STEP_MS; this.tick(); }
  }

  private tick(): void {
    this.elapsed += STEP_MS;
    for (const target of this.targets) {
      target.age += STEP_MS;
      const {min, max} = this.bounds(target.text);
      target.x += (target.vx * STEP_MS) / 1000;
      if (target.x < min) { target.x = min; target.vx = Math.abs(target.vx); } else if (target.x > max) { target.x = max; target.vx = -Math.abs(target.vx); }
    }
    for (const target of this.targets.filter(item => item.age >= item.life)) {
      this.targets = this.targets.filter(item => item !== target);
      this.missed += 1;
      this.lives -= 1;
      if (this.lives <= 0) { this.over = true; return; }
    }
    this.spawnIn -= STEP_MS;
    if (this.spawnIn <= 0) this.spawnIn = this.spawn() ? this.interval() : 200;
    if (!this.targets.length && this.spawnIn > 300) this.spawnIn = 300;
  }

  /** Visibility of a phrase now, 0..1: fades in when it appears and out as its time runs low. */
  alpha(target: Target): number {
    const inn = Math.min(1, target.age / FADE_IN_MS);
    const left = (target.life - target.age) / target.life;
    return Math.max(0, Math.min(inn, left < FADE_OUT ? left / FADE_OUT : 1));
  }

  /** One typed character against the active phrase. */
  press(char: string): Press {
    const target = this.active;
    if (!target || this.over || char.length === 0) return 'idle';
    const expected = target.text[target.typed]!;
    const same = char === expected || (/^[a-z]$/iu.test(expected) && char.toLowerCase() === expected.toLowerCase());
    if (!same) { this.wrong += 1; return 'wrong'; }
    this.correct += 1;
    target.typed += 1;
    if (target.typed < target.text.length) return 'correct';
    const points = target.text.length * 10 + this.level * 5;
    this.targets = this.targets.filter(item => item !== target);
    this.completed += 1;
    this.score += points;
    this.events.push({x: target.x + target.text.length / 2, lane: target.lane, points});
    return 'done';
  }
}
