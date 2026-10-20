import type {Rgb} from '../chroma/escape.js';
import {mixRgb} from '../chroma/chroma.js';
import type {Canvas, PixelBuffer} from './Canvas.js';
import {clamp, easeOutCubic} from './easing.js';
import type {Rng} from './rng.js';

/**
 * The arcade's shared effects layer: particles, trails, score popups, flashes and a tightly limited screen shake. Every
 * effect is deterministic (a seeded `Rng`, a caller-supplied step), bounded (fixed pools, no allocation per frame) and
 * scaled by `EffectsLevel`, which comes from the person's motion settings: `off` draws nothing decorative, `subtle`
 * halves the counts, and reduced motion removes shake and flashes while keeping what the game needs to be readable.
 */
export type EffectsLevel = 'off' | 'subtle' | 'normal' | 'rich';

export const EFFECT_SCALE: Readonly<Record<EffectsLevel, number>> = {off: 0, subtle: 0.5, normal: 1, rich: 1.5};

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  /** Milliseconds left and at birth. */
  life: number; maxLife: number;
  color: Rgb;
  /** Pull on the velocity per second (positive is down). */
  gravity: number;
  drag: number;
}

export interface BurstOptions {
  x: number; y: number; count: number;
  /** Pixels per second. */
  speed: number;
  /** Direction in radians (0 = right, -π/2 = up) and the half-width of the cone; π spreads all around. */
  angle?: number; spread?: number;
  life?: number; gravity?: number; drag?: number;
  colors: readonly Rgb[];
}

export class ParticleSystem {
  private readonly pool: Particle[] = [];
  constructor(private readonly rng: Rng, private readonly capacity = 160, private level: EffectsLevel = 'normal') {}

  setLevel(level: EffectsLevel): void { this.level = level; if (level === 'off') this.pool.length = 0; }
  get count(): number { return this.pool.length; }
  get particles(): readonly Particle[] { return this.pool; }

  burst(options: BurstOptions): void {
    const count = Math.round(options.count * EFFECT_SCALE[this.level]);
    const angle = options.angle ?? -Math.PI / 2;
    const spread = options.spread ?? Math.PI;
    for (let index = 0; index < count; index += 1) {
      if (this.pool.length >= this.capacity) this.pool.shift();
      const direction = angle + this.rng.range(-spread, spread);
      const speed = options.speed * this.rng.range(0.4, 1);
      const life = (options.life ?? 500) * this.rng.range(0.6, 1);
      this.pool.push({
        x: options.x, y: options.y, vx: Math.cos(direction) * speed, vy: Math.sin(direction) * speed, life, maxLife: life,
        color: this.rng.pick(options.colors), gravity: options.gravity ?? 0, drag: options.drag ?? 0,
      });
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (let index = this.pool.length - 1; index >= 0; index -= 1) {
      const particle = this.pool[index]!;
      particle.life -= dtMs;
      if (particle.life <= 0) { this.pool.splice(index, 1); continue; }
      particle.vy += particle.gravity * dt;
      if (particle.drag) { const keep = Math.max(0, 1 - particle.drag * dt); particle.vx *= keep; particle.vy *= keep; }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
  }

  /** Draw into a pixel buffer; a particle fades toward `fadeTo` (the scene behind it) as it ages. */
  draw(buffer: PixelBuffer, fadeTo?: Rgb, offsetX = 0, offsetY = 0): void {
    for (const particle of this.pool) {
      const age = 1 - particle.life / particle.maxLife;
      buffer.set(particle.x + offsetX, particle.y + offsetY, fadeTo ? mixRgb(particle.color, fadeTo, easeOutCubic(age) * 0.85) : particle.color);
    }
  }

  clear(): void { this.pool.length = 0; }
}

/** A fixed-length ring of recent positions, drawn newest to oldest with a fading color: a glowing trail. */
export class Trail {
  private readonly points: Array<{x: number; y: number}> = [];
  constructor(private readonly length = 8, private level: EffectsLevel = 'normal') {}
  setLevel(level: EffectsLevel): void { this.level = level; if (level === 'off') this.points.length = 0; }
  push(x: number, y: number): void {
    if (this.level === 'off') return;
    this.points.unshift({x, y});
    if (this.points.length > this.length) this.points.pop();
  }
  /** Scroll every point (a world moving left under the player). */
  shift(dx: number, dy = 0): void { for (const point of this.points) { point.x += dx; point.y += dy; } }
  draw(buffer: PixelBuffer, head: Rgb, tail: Rgb): void {
    this.points.forEach((point, index) => buffer.set(point.x, point.y, mixRgb(head, tail, this.points.length <= 1 ? 0 : index / (this.points.length - 1))));
  }
  clear(): void { this.points.length = 0; }
  get size(): number { return this.points.length; }
}

export interface Popup { text: string; x: number; y: number; age: number; life: number; color: Rgb }

/** Floating score text: rises a cell or two and fades; drawn into the cell canvas so it stays crisp. */
export class Popups {
  private items: Popup[] = [];
  constructor(private readonly limit = 6, private level: EffectsLevel = 'normal') {}
  setLevel(level: EffectsLevel): void { this.level = level; if (level === 'off') this.items = []; }
  add(text: string, x: number, y: number, color: Rgb, life = 700): void {
    if (this.level === 'off') return;
    this.items.push({text, x, y, age: 0, life, color});
    if (this.items.length > this.limit) this.items.shift();
  }
  update(dtMs: number): void {
    this.items = this.items.filter(item => (item.age += dtMs) < item.life);
  }
  draw(canvas: Canvas, fadeTo?: Rgb): void {
    for (const item of this.items) {
      const t = item.age / item.life;
      const rise = Math.round(easeOutCubic(t) * 2);
      canvas.text(Math.round(item.x - item.text.length / 2), Math.round(item.y) - rise, item.text, {fg: fadeTo ? mixRgb(item.color, fadeTo, clamp((t - 0.5) * 2, 0, 1) * 0.8) : item.color, bold: true});
    }
  }
  clear(): void { this.items = []; }
  get count(): number { return this.items.length; }
}

/** A short impact flash: 1 at once, easing to 0. Reduced motion never flashes. */
export class Flash {
  private left = 0;
  constructor(private readonly duration = 160) {}
  trigger(allowed: boolean): void { this.left = allowed ? this.duration : 0; }
  update(dtMs: number): void { this.left = Math.max(0, this.left - dtMs); }
  /** 0..1 */
  get amount(): number { return this.left / this.duration; }
}

/**
 * Screen shake limited to one cell in either direction, for a few frames, and only when motion is allowed. The offsets
 * come from a fixed pattern, not the clock, so a replay shakes identically.
 */
export class Shake {
  private left = 0;
  private frame = 0;
  constructor(private readonly duration = 220) {}
  trigger(allowed: boolean): void { this.left = allowed ? this.duration : 0; this.frame = 0; }
  update(dtMs: number): void { if (this.left > 0) { this.left = Math.max(0, this.left - dtMs); this.frame += 1; } }
  get offset(): {x: number; y: number} {
    if (this.left <= 0) return {x: 0, y: 0};
    const pattern = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    const [x, y] = pattern[this.frame % pattern.length]!;
    return this.left > this.duration / 2 ? {x, y} : {x: x > 0 ? 1 : 0, y: 0};
  }
}

/** Interpolated sprite frames: the frame for an elapsed time in a loop of `frames` at `fps`. */
export function frameAt(elapsedMs: number, frames: number, fps: number): number {
  return Math.floor((elapsedMs / 1000) * fps) % Math.max(1, frames);
}
