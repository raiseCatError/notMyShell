import {TAU, wrapAngle} from '../../engine/collide.js';
import type {Rng} from '../../rng.js';

/**
 * Color Orbit's rules. A ball climbs a column: gravity pulls it down, each tap kicks it up. Obstacles stand in the
 * column, rotating rings of four colored arcs and sliding bars of four colored blocks, and the ball may only touch the
 * part that matches its own color. A prism between obstacles switches the ball to another color. Height is in world
 * units (one unit is one pixel row) and grows upward; the ball's x is the column's center.
 */
export const COLORS = 4;
/**
 * Movement tuning (units are pixel rows), the classic Color Switch hop: a tap SETS the ball's upward speed to JUMP
 * (it never stacks), and gravity pulls it back at a steady GRAVITY. One hop therefore rises JUMP^2 / (2 GRAVITY) = 8 units
 * (a ring is 30 units across, so a hop is about a quarter of one) and lasts about a second in the air.
 *  - Tapping slower than once a second lets the ball bob and sink inside a ring; one tap about every 0.7 s climbs gently
 *    (about 9 units/s), so a ring can be entered, waited in and left on purpose.
 *  - Tapping every 0.25 s climbs about 26 units/s; a held key (terminals send repeats, never releases) is limited by
 *    TAP_GAP so it cannot stack either, and simply climbs at the same fast pace.
 *  - A ring's top arc is 3 units thick; at hop speed the ball crosses the whole band in about 0.2 s, and every window
 *    shows each colour for longer than that, so the matching colour can always be waited for.
 *  - Not tapping drops the ball about 34 units below its best height in roughly a second, which ends the run.
 * Integration is exact for constant gravity, so results do not depend on the step size.
 */
export const GRAVITY = 70;
export const JUMP = 33.5;
export const TAP_GAP = 0.1;
export const BALL_R = 1.6;
export const RING_R = 15;
export const RING_T = 3;
export const BAR_H = 3;
export const BAR_SEG = 12;
export const SPACING = 46;
/** How far from a prism's height the ball still picks it up. */
export const PRISM_REACH = 2.5;

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
  private sinceTap = 1;
  private nextY = 40;
  private passed = new Set<number>();

  constructor(private readonly rng: Rng) {
    this.color = rng.int(0, COLORS - 1);
    while (this.nextY < 400) this.spawn();
  }

  tap(): void {
    if (!this.alive) return;
    this.started = true;
    if (this.sinceTap < TAP_GAP) return;
    this.sinceTap = 0;
    this.vy = JUMP;
  }

  /** Obstacles get faster and denser as the climb goes on; every fourth is a double ring or a bar. */
  private spawn(): void {
    const index = this.obstacles.length;
    const level = Math.min(1, index / 40);
    // Rings turn from 0.9 to 1.8 rad/s (a quarter turn lasts 1.7 s down to 0.87 s, a half turn, the wait between entering and leaving, 3.5 s down to 1.7 s); bars slide 5 to 12 units/s
    // (a block lasts 2.4 s down to 1 s). Every ring shows all four colours at its top and bottom in turn, so it
    // can always be passed by waiting, and each window outlasts the ~0.3 s it takes to cross the band.
    const sign = this.rng.chance(0.5) ? 1 : -1;
    const speed = (0.9 + level * 0.9) * sign;
    const barSpeed = (5 + level * 7) * sign;
    const bar = index > 3 && index % 4 === 0;
    const r = bar ? BAR_H / 2 : RING_R + (index % 5 === 4 ? 5 : 0);
    // The prism stands clear of the obstacle above it, and the next obstacle stands clear of the prism, so the ball
    // can never be forced to change color while it is inside a band (a bigger ring once put its top arc on the prism).
    const reach = (half: number) => half + (bar ? 0 : RING_T / 2) + BALL_R;
    const previous = this.prisms[this.prisms.length - 1];
    const y = Math.max(this.nextY + RING_R + 4, previous ? previous.y + PRISM_REACH + 1.5 + reach(r) : 0);
    if (bar) this.obstacles.push({kind: 'bar', y, speed: barSpeed, phase: this.rng.range(0, BAR_SEG * COLORS)});
    else this.obstacles.push({kind: 'ring', y, r, speed, phase: this.rng.range(0, TAU)});
    // A prism above every obstacle switches to a color other than the current one.
    this.prisms.push({y: y + reach(r) + PRISM_REACH + 1.5, taken: false, color: -1});
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
    this.sinceTap += dt;
    this.y += this.vy * dt - (GRAVITY * dt * dt) / 2;
    this.vy -= GRAVITY * dt;
    this.floor = Math.max(this.floor, this.y - 38);
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
      if (prism.taken || Math.abs(prism.y - this.y) > PRISM_REACH) continue;
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
