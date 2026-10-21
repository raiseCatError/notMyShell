import type {Rng} from '../../rng.js';

/**
 * Vespyr Leap's rules. Vespyr bounces by himself: landing on a platform from above sends him up at `JUMP` (a spring at
 * `SPRING`). Arrow keys steer him; the field wraps left to right. Platforms are solid, moving (sliding side to side) or
 * crumbling (they break under him and give no bounce). The generator guarantees that from any solid platform the next
 * solid one is within reach: no more than `REACH` of the jump height above it. Height is in world units, growing upward.
 */
export const WIDTH = 80;
export const GRAVITY = 260;
export const JUMP = 172;
export const SPRING = 290;
export const SPEED = 72;
export const PRESS_MS = 170;
export const PLATFORM_W = 14;
export const CAT_W = 7;
/** Highest a normal bounce rises: v² / 2g. */
export const JUMP_HEIGHT = (JUMP * JUMP) / (2 * GRAVITY);
/** The largest vertical gap between solid platforms, as a share of the jump height. */
export const REACH = 0.78;

export type PlatformKind = 'solid' | 'moving' | 'crumble';
export interface Platform { id: number; x: number; y: number; kind: PlatformKind; spring: boolean; broken: boolean; phase: number; speed: number; fall: number }
export type LeapEvent = {kind: 'bounce'; x: number; y: number; spring: boolean} | {kind: 'crumble'; x: number; y: number} | {kind: 'milestone'; height: number} | {kind: 'fall'};

export class LeapState {
  x = WIDTH / 2;
  y = 4;
  vx = 0;
  vy = JUMP;
  private pressMs = 0;
  private pressDir: -1 | 0 | 1 = 0;
  best = 0;
  alive = true;
  started = false;
  platforms: Platform[] = [];
  events: LeapEvent[] = [];
  bounces = 0;
  private nextId = 1;
  private top = 0;
  /** The highest solid platform so far: the generator's anchor for reachability. */
  private solidTop = 0;
  private milestone = 0;
  time = 0;
  /** How far below the best height the view reaches: falling past it ends the climb. The game sets it from the screen. */
  fallLimit = 95;

  constructor(private readonly rng: Rng) {
    this.platforms.push(this.make(WIDTH / 2 - PLATFORM_W / 2, 0, 'solid', false));
    while (this.top < 260) this.generate();
  }

  get height(): number { return Math.floor(this.best); }
  get score(): number { return Math.floor(this.best / 10); }

  private make(x: number, y: number, kind: PlatformKind, spring: boolean): Platform {
    return {id: this.nextId++, x, y, kind, spring, broken: false, phase: this.rng.range(0, Math.PI * 2), speed: this.rng.range(0.6, 1.3), fall: 0};
  }

  /** One more row of platforms above the current top. Harder with height: bigger gaps, more moving and crumbling ones. */
  private generate(): void {
    const level = Math.min(1, this.top / 3000);
    const gap = this.rng.range(10, 14 + level * (JUMP_HEIGHT * REACH - 14));
    const y = this.solidTop + Math.min(gap, JUMP_HEIGHT * REACH);
    // The first few platforms stay near the middle, so the climb starts gently.
    const early = this.platforms.length < 5;
    const x = early ? WIDTH / 2 - PLATFORM_W / 2 + this.rng.range(-10, 10) : this.rng.range(0, WIDTH - PLATFORM_W);
    const roll = this.rng.next();
    const kind: PlatformKind = roll < 0.12 + level * 0.25 ? 'moving' : 'solid';
    this.platforms.push(this.make(x, y, kind, kind === 'solid' && this.rng.chance(0.07)));
    this.solidTop = y;
    // Crumbling platforms between solid ones: tempting, never needed.
    if (this.rng.chance(0.2 + level * 0.3)) this.platforms.push(this.make(this.rng.range(0, WIDTH - PLATFORM_W), y - this.rng.range(4, Math.max(5, gap - 3)), 'crumble', false));
    this.top = y;
  }

  press(dir: -1 | 1): void { this.started = true; this.pressDir = dir; this.pressMs = PRESS_MS; }

  /** Where a moving platform's left edge is now. */
  platformX(platform: Platform): number {
    if (platform.kind !== 'moving') return platform.x;
    const span = WIDTH - PLATFORM_W;
    return (Math.sin(platform.phase + this.time * platform.speed) * 0.5 + 0.5) * span;
  }

  step(dtMs: number): void {
    if (!this.alive) return;
    const dt = dtMs / 1000;
    this.time += dt;
    if (!this.started) { this.y = 4 + Math.abs(Math.sin(this.time * 3)) * 6; return; }
    if (this.pressMs > 0) { this.pressMs -= dtMs; this.vx = this.pressDir * SPEED; } else this.vx *= 0.82;
    this.x = ((this.x + this.vx * dt) % WIDTH + WIDTH) % WIDTH;
    const before = this.y;
    this.vy -= GRAVITY * dt;
    this.y += this.vy * dt;
    if (this.vy < 0) this.land(before);
    for (const platform of this.platforms) if (platform.broken) { platform.fall += dt * 60; }
    this.best = Math.max(this.best, this.y);
    while (this.top < this.best + 260) this.generate();
    this.platforms = this.platforms.filter(platform => platform.y > this.best - 120);
    const step = Math.floor(this.best / 1000);
    if (step > this.milestone) { this.milestone = step; this.events.push({kind: 'milestone', height: step * 1000}); }
    if (this.y < this.best - this.fallLimit) { this.alive = false; this.events.push({kind: 'fall'}); }
  }

  /** Falling feet crossed a platform's top this step, with the cat over it (wrapping): bounce, or break a crumbling one. */
  private land(before: number): void {
    for (const platform of this.platforms) {
      if (platform.broken || before < platform.y || this.y > platform.y) continue;
      const left = this.platformX(platform);
      const dx = ((this.x - left) % WIDTH + WIDTH) % WIDTH;
      if (dx > PLATFORM_W + CAT_W / 2 && dx < WIDTH - CAT_W / 2) continue;
      if (platform.kind === 'crumble') { platform.broken = true; this.events.push({kind: 'crumble', x: left + PLATFORM_W / 2, y: platform.y}); continue; }
      this.y = platform.y;
      this.vy = platform.spring ? SPRING : JUMP;
      this.bounces += 1;
      this.events.push({kind: 'bounce', x: this.x, y: platform.y, spring: platform.spring});
      return;
    }
  }
}
