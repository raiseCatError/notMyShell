import {TAU, wrapAngle} from '../../engine/collide.js';
import type {Rng} from '../../rng.js';

/**
 * Color Orbit's rules. A ball climbs a column: gravity pulls it down, each tap kicks it up. Obstacles stand in the
 * column, rotating rings of four colored arcs and sliding bars of four colored blocks, and the ball may only touch the
 * part that matches its own color. A prism between obstacles switches the ball to another color. Height is in world
 * units (one unit is one pixel row) and grows upward; the ball's x is the column's center.
 */
export const COLORS = 4;
export const GRAVITY = 300;
export const TAP = 128;
export const BALL_R = 1.6;
export const RING_R = 15;
export const RING_T = 3;
export const BAR_H = 3;
export const BAR_SEG = 12;
export const SPACING = 46;

export type Obstacle =
  | {kind: 'ring'; y: number; r: number; speed: number; phase: number}
  | {kind: 'bar'; y: number; speed: number; phase: number};
export interface Prism { y: number; taken: boolean; color: number }
export type OrbitEvent = {kind: 'pass'} | {kind: 'switch'; color: number; y: number} | {kind: 'hit'; y: number};

export class OrbitState {
  y = 0;
  vy = 0;
  color = 0;
  time = 0;
  score = 0;
  alive = true;
  started = false;
  obstacles: Obstacle[] = [];
  prisms: Prism[] = [];
  /** The lowest y the view may show: falling below it ends the run. */
  floor = -30;
  events: OrbitEvent[] = [];
  private nextY = 40;
  private passed = new Set<number>();

  constructor(private readonly rng: Rng) {
    this.color = rng.int(0, COLORS - 1);
    while (this.nextY < 400) this.spawn();
  }

  tap(): void {
    if (!this.alive) return;
    this.started = true;
    this.vy = TAP;
  }

  /** Obstacles get faster and denser as the climb goes on; every fourth is a double ring or a bar. */
  private spawn(): void {
    const index = this.obstacles.length;
    const level = Math.min(1, index / 30);
    const speed = (1 + level * 1.4) * (this.rng.chance(0.5) ? 1 : -1);
    const y = this.nextY + RING_R + 4;
    if (index > 2 && index % 4 === 3) this.obstacles.push({kind: 'bar', y, speed: speed * 26, phase: this.rng.range(0, BAR_SEG * COLORS)});
    else this.obstacles.push({kind: 'ring', y, r: RING_R + (index % 5 === 4 ? 5 : 0), speed, phase: this.rng.range(0, TAU)});
    // A prism above every obstacle switches to a color other than the current one.
    this.prisms.push({y: y + RING_R + 8, taken: false, color: -1});
    this.nextY = y + Math.max(32, SPACING - level * 10);
  }

  /** The color index of a ring's arc at screen angle `angle`. */
  static ringColor(obstacle: {speed: number; phase: number}, time: number, angle: number): number {
    const rotation = obstacle.phase + obstacle.speed * time;
    return Math.floor(wrapAngle(angle - rotation) / (TAU / COLORS)) % COLORS;
  }

  /** The color index of a bar's block over the column's center. */
  static barColor(obstacle: {speed: number; phase: number}, time: number): number {
    const offset = (((obstacle.phase + obstacle.speed * time) % (BAR_SEG * COLORS)) + BAR_SEG * COLORS) % (BAR_SEG * COLORS);
    return Math.floor(offset / BAR_SEG) % COLORS;
  }

  step(dtMs: number): void {
    if (!this.alive) return;
    const dt = dtMs / 1000;
    this.time += dt;
    if (!this.started) return;
    this.vy -= GRAVITY * dt;
    this.y += this.vy * dt;
    this.floor = Math.max(this.floor, this.y - 34);
    if (this.y < this.floor) { this.alive = false; this.events.push({kind: 'hit', y: this.y}); return; }
    while (this.nextY < this.y + 300) this.spawn();
    for (let index = 0; index < this.obstacles.length; index += 1) {
      const obstacle = this.obstacles[index]!;
      if (Math.abs(obstacle.y - this.y) > RING_R + 8) {
        if (this.y > obstacle.y + RING_R + 4 && !this.passed.has(index)) { this.passed.add(index); this.score += 1; this.events.push({kind: 'pass'}); }
        continue;
      }
      if (this.touches(obstacle)) { this.alive = false; this.events.push({kind: 'hit', y: this.y}); return; }
    }
    for (const prism of this.prisms) {
      if (prism.taken || Math.abs(prism.y - this.y) > 2.5) continue;
      prism.taken = true;
      let next = this.rng.int(0, COLORS - 2);
      if (next >= this.color) next += 1;
      this.color = next;
      prism.color = next;
      this.events.push({kind: 'switch', color: next, y: prism.y});
    }
  }

  /** Whether the ball is touching a part of `obstacle` of another color. */
  touches(obstacle: Obstacle): boolean {
    if (obstacle.kind === 'bar') {
      if (Math.abs(this.y - obstacle.y) > BAR_H / 2 + BALL_R) return false;
      return OrbitState.barColor(obstacle, this.time) !== this.color;
    }
    // The ball sits on the ring's vertical axis: it crosses the band at the bottom (below center) or the top.
    const dy = this.y - obstacle.y;
    const distance = Math.abs(dy);
    if (Math.abs(distance - obstacle.r) > RING_T / 2 + BALL_R) return false;
    const angle = dy > 0 ? -Math.PI / 2 : Math.PI / 2;
    return OrbitState.ringColor(obstacle, this.time, angle) !== this.color;
  }
}
