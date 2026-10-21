import {capSpeed, Substepper} from '../../engine/body.js';
import {bounce, circleSegment, type Vec} from '../../engine/collide.js';
import type {Rng} from '../../rng.js';

/**
 * Vespyr Pinball's table and physics, in table units (60 wide, 100 tall, y down). One ball, three kinds of contact:
 * static segments (walls, the top arch, the lane and guides, with slingshot kickers), pop bumpers (circles that throw the
 * ball out) and two flippers, which are capsules rotating about a pivot and hand the ball their surface speed at the
 * contact point. The simulation runs in 600 Hz substeps, so even at the 230 units/s speed cap the ball moves 0.4 units
 * per substep against a 2-unit radius: nothing tunnels, and a flipper's tip (about 250 units/s) cannot skip over the
 * ball either. A collision under 10 units/s is perfectly inelastic, so a ball comes to rest on a flipper or in the lane.
 *
 * NMSh reports key presses only, so a flipper key lifts its flipper for a moment that held-key repeats renew, and the
 * plunger takes two presses: the first starts a swinging power meter, the second launches at its current power.
 */
export const TABLE_W = 60;
export const TABLE_H = 100;
export const BALL_R = 2;
export const GRAVITY = 110;
export const SUB_MS = 1000 / 600;
export const BALL_MAX = 230;
export const BALLS = 3;
export const FLIPPER_LEN = 10;
export const FLIPPER_R = 1.4;
export const FLIPPER_SPEED = 21;
export const FLIP_HOLD_MS = 170;
export const LAUNCH_MIN = 148;
export const LAUNCH_MAX = 218;
export const CHARGE_MS = 1100;
export const DRAIN_Y = 106;
export const MAX_MULTIPLIER = 6;
export const NUDGE_LIMIT = 4;
export const LANE_X = 54.8;
export const LANE_REST_Y = 95.5;

export interface Segment { a: Vec; b: Vec; restitution: number; kick: number }
export interface Bumper { x: number; y: number; r: number; lit: number }
export interface Flipper { pivot: Vec; side: 'left' | 'right'; angle: number; target: number; holdMs: number; tip: Vec; prevTip: Vec }
export interface Sensor { x: number; y: number; r: number; lit: boolean }

const seg = (ax: number, ay: number, bx: number, by: number, restitution = 0.45, kick = 0): Segment => ({a: {x: ax, y: ay}, b: {x: bx, y: by}, restitution, kick});
const polyline = (points: ReadonlyArray<readonly [number, number]>, restitution = 0.45): Segment[] =>
  points.slice(1).map((point, index) => seg(points[index]![0], points[index]![1], point[0], point[1], restitution));

/** The static geometry of the table. */
export const SEGMENTS: readonly Segment[] = [
  // The top arch, from the left wall over to the plunger lane's wall.
  ...polyline([[2, 30], [2.5, 21], [6, 14], [13, 8.5], [21, 5], [30, 4], [39, 5], [47, 8.5], [54, 14], [57.5, 21], [58, 28]]),
  seg(2, 30, 2, 72), // left wall
  seg(2, 72, 13, 89, 0.3), // left guide to the flipper
  seg(51.5, 30, 51.5, 72), // lane wall
  seg(51.5, 72, 41, 89, 0.3), // right guide
  seg(58, 28, 58, 99), // outer right wall
  seg(51.5, 99, 58, 99, 0.2), // the lane floor
  seg(51.5, 30, 51.5, 99),
  // Slingshots above the flippers: kickers.
  seg(8, 62, 8, 74, 0.4, 70), seg(8, 74, 15.5, 82, 0.4, 70), seg(8, 62, 15.5, 82, 0.4, 70),
  seg(46, 62, 46, 74, 0.4, 70), seg(46, 74, 38.5, 82, 0.4, 70), seg(46, 62, 38.5, 82, 0.4, 70),
];

export const BUMPERS: readonly Pick<Bumper, 'x' | 'y' | 'r'>[] = [{x: 17, y: 38, r: 4.5}, {x: 35, y: 38, r: 4.5}, {x: 26, y: 52, r: 4.5}];
export const SENSORS: readonly Pick<Sensor, 'x' | 'y' | 'r'>[] = [{x: 17, y: 20, r: 3}, {x: 27, y: 18, r: 3}, {x: 37, y: 20, r: 3}];
const REST = 0.5;
const ACTIVE = -0.45;

export type PinballEvent =
  | {kind: 'bumper'; x: number; y: number; points: number}
  | {kind: 'sling'; x: number; y: number; points: number}
  | {kind: 'flipper'; x: number; y: number; speed: number}
  | {kind: 'wall'; x: number; y: number; speed: number}
  | {kind: 'lane'; x: number; y: number; points: number}
  | {kind: 'multiplier'; value: number}
  | {kind: 'launch'; power: number}
  | {kind: 'drain'; left: number}
  | {kind: 'tilt'};

function flipperTip(f: {pivot: Vec; side: 'left' | 'right'}, angle: number): Vec {
  const dir = f.side === 'left' ? 1 : -1;
  return {x: f.pivot.x + dir * FLIPPER_LEN * Math.cos(angle), y: f.pivot.y + FLIPPER_LEN * Math.sin(angle)};
}

export class PinballState {
  ball = {x: LANE_X, y: LANE_REST_Y, vx: 0, vy: 0, px: LANE_X, py: LANE_REST_Y};
  score = 0;
  ballsLeft = BALLS;
  multiplier = 1;
  over = false;
  events: PinballEvent[] = [];
  readonly bumpers: Bumper[] = BUMPERS.map(b => ({...b, lit: 0}));
  readonly sensors: Sensor[] = SENSORS.map(s => ({...s, lit: false}));
  readonly flippers: [Flipper, Flipper];
  /** 'lane': waiting for the plunger; 'charging': the power meter swings; 'play'; 'drained': a pause before the next ball. */
  phase: 'lane' | 'charging' | 'play' | 'drained' = 'lane';
  charge = 0;
  chargeMs = 0;
  waitMs = 0;
  tilted = false;
  nudges = 0;
  nudgeCooldown = 0;
  bestMultiplier = 1;
  bumperHits = 0;
  private idleMs = 0;
  private readonly sub = new Substepper(SUB_MS);

  constructor(private readonly rng: Rng) {
    const make = (side: 'left' | 'right', x: number): Flipper => {
      const pivot = {x, y: 90};
      const tip = flipperTip({pivot, side}, REST);
      return {pivot, side, angle: REST, target: REST, holdMs: 0, tip, prevTip: tip};
    };
    this.flippers = [make('left', 13.5), make('right', 40.5)];
  }

  /** Raise a flipper (renewed by repeats). */
  flip(side: 'left' | 'right'): void {
    if (this.over || this.tilted) return;
    this.flippers[side === 'left' ? 0 : 1].holdMs = FLIP_HOLD_MS;
  }

  /** First press: start the power meter. Second press: launch at the meter's power. */
  plunger(): void {
    if (this.over) return;
    if (this.phase === 'lane') { this.phase = 'charging'; this.chargeMs = 0; this.charge = 0; }
    else if (this.phase === 'charging') {
      const power = this.charge;
      this.ball.vy = -(LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * power);
      this.ball.vx = 0;
      this.phase = 'play';
      this.idleMs = 0;
      this.events.push({kind: 'launch', power});
    }
  }

  /** Bump the table: a small kick to the ball, limited; too many tilt the table for the rest of this ball. */
  nudge(): void {
    if (this.over || this.phase !== 'play' || this.nudgeCooldown > 0 || this.tilted) return;
    this.nudgeCooldown = 500;
    this.nudges += 1;
    this.ball.vy -= 14;
    this.ball.vx += this.rng.range(-7, 7);
    if (this.nudges > NUDGE_LIMIT) { this.tilted = true; this.events.push({kind: 'tilt'}); }
  }

  step(dtMs: number): void {
    if (this.over) return;
    this.ball.px = this.ball.x; this.ball.py = this.ball.y;
    this.nudgeCooldown = Math.max(0, this.nudgeCooldown - dtMs);
    for (const bumper of this.bumpers) bumper.lit = Math.max(0, bumper.lit - dtMs);
    if (this.phase === 'charging') {
      this.chargeMs += dtMs;
      const t = (this.chargeMs % CHARGE_MS) / CHARGE_MS;
      this.charge = t < 0.5 ? t * 2 : 2 - t * 2;
    }
    if (this.phase === 'drained') {
      this.waitMs -= dtMs;
      if (this.waitMs <= 0) this.nextBall();
      return;
    }
    this.sub.run(dtMs, dt => this.substep(dt));
    for (const flipper of this.flippers) flipper.holdMs = Math.max(0, flipper.holdMs - dtMs);
    if (this.phase === 'play') {
      // A ball resting somewhere it should not: give it a nudge so no run can stall.
      if (Math.hypot(this.ball.vx, this.ball.vy) < 4 && this.ball.y < 82) this.idleMs += dtMs; else this.idleMs = 0;
      if (this.idleMs > 3000) { this.ball.vx += this.rng.range(-25, 25); this.ball.vy -= 30; this.idleMs = 0; }
    }
  }

  private nextBall(): void {
    this.ball = {x: LANE_X, y: LANE_REST_Y, vx: 0, vy: 0, px: LANE_X, py: LANE_REST_Y};
    this.phase = 'lane';
    this.multiplier = 1;
    this.tilted = false;
    this.nudges = 0;
    for (const sensor of this.sensors) sensor.lit = false;
  }

  private substep(dt: number): void {
    // Flippers first: they move toward their target at a fixed angular speed.
    for (const flipper of this.flippers) {
      flipper.target = flipper.holdMs > 0 && !this.tilted ? ACTIVE : REST;
      flipper.prevTip = flipper.tip;
      const move = FLIPPER_SPEED * dt;
      flipper.angle += Math.max(-move, Math.min(move, flipper.target - flipper.angle));
      flipper.tip = flipperTip(flipper, flipper.angle);
    }
    if (this.phase === 'drained' || this.over) return;
    const ball = this.ball;
    if (this.phase === 'lane' || this.phase === 'charging') {
      // Held at the bottom of the lane, but still on the floor's physics if something moves it.
      ball.vx = 0; ball.vy = 0; ball.x = LANE_X; ball.y = LANE_REST_Y;
      return;
    }
    ball.vy += GRAVITY * dt;
    capSpeed(ball, BALL_MAX);
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    for (let pass = 0; pass < 2; pass += 1) {
      for (const segment of SEGMENTS) this.hitSegment(segment);
      for (const bumper of this.bumpers) this.hitBumper(bumper);
      for (const flipper of this.flippers) this.hitFlipper(flipper, dt);
    }
    capSpeed(ball, BALL_MAX);
    for (const sensor of this.sensors) {
      if (!sensor.lit && Math.hypot(ball.x - sensor.x, ball.y - sensor.y) < sensor.r + BALL_R * 0.5) this.lightSensor(sensor);
    }
    if (ball.y > DRAIN_Y) this.drain();
  }

  private points(value: number): number { return value * this.multiplier; }

  private hitSegment(segment: Segment): void {
    const ball = this.ball;
    const hit = circleSegment({x: ball.x, y: ball.y, r: BALL_R}, segment.a, segment.b);
    if (!hit) return;
    ball.x += hit.nx * hit.depth; ball.y += hit.ny * hit.depth;
    const impact = -(ball.vx * hit.nx + ball.vy * hit.ny);
    if (impact <= 0) return;
    const e = impact < 10 ? 0 : segment.restitution;
    const next = bounce({x: ball.vx, y: ball.vy}, hit.nx, hit.ny, e);
    ball.vx = next.x; ball.vy = next.y;
    if (segment.kick > 0 && impact > 12) {
      const along = ball.vx * hit.nx + ball.vy * hit.ny;
      if (along < segment.kick) {
        // The kick leans upward so a ball never ping-pongs between the two slingshots at one height.
        const kx = hit.nx, ky = hit.ny - 0.9, length = Math.hypot(kx, ky) || 1;
        const boost = segment.kick - along;
        ball.vx += (kx / length) * boost; ball.vy += (ky / length) * boost;
      }
      const points = this.points(10);
      this.score += points;
      this.events.push({kind: 'sling', x: ball.x, y: ball.y, points});
    } else if (impact > 25) this.events.push({kind: 'wall', x: ball.x, y: ball.y, speed: impact});
  }

  private hitBumper(bumper: Bumper): void {
    const ball = this.ball;
    const dx = ball.x - bumper.x, dy = ball.y - bumper.y;
    const distance = Math.hypot(dx, dy);
    const reach = bumper.r + BALL_R;
    if (distance >= reach) return;
    const nx = distance === 0 ? 0 : dx / distance, ny = distance === 0 ? -1 : dy / distance;
    ball.x = bumper.x + nx * reach; ball.y = bumper.y + ny * reach;
    const along = ball.vx * nx + ball.vy * ny;
    if (along >= 0) return;
    const next = bounce({x: ball.vx, y: ball.vy}, nx, ny, 1);
    ball.vx = next.x; ball.vy = next.y;
    const out = ball.vx * nx + ball.vy * ny;
    if (out < 75) { ball.vx += nx * (75 - out); ball.vy += ny * (75 - out); }
    bumper.lit = 220;
    this.bumperHits += 1;
    const points = this.points(100);
    this.score += points;
    this.events.push({kind: 'bumper', x: bumper.x, y: bumper.y, points});
  }

  private hitFlipper(flipper: Flipper, dt: number): void {
    const ball = this.ball;
    const hit = circleSegment({x: ball.x, y: ball.y, r: BALL_R + FLIPPER_R}, flipper.pivot, flipper.tip);
    if (!hit) return;
    ball.x += hit.nx * hit.depth; ball.y += hit.ny * hit.depth;
    // The contact point moves with the flipper: t of the way along it, at t of the tip's displacement.
    const svx = (hit.t * (flipper.tip.x - flipper.prevTip.x)) / dt;
    const svy = (hit.t * (flipper.tip.y - flipper.prevTip.y)) / dt;
    const rvx = ball.vx - svx, rvy = ball.vy - svy;
    const impact = -(rvx * hit.nx + rvy * hit.ny);
    if (impact <= 0) return;
    const next = bounce({x: rvx, y: rvy}, hit.nx, hit.ny, impact < 12 ? 0 : 0.35);
    ball.vx = svx + next.x; ball.vy = svy + next.y;
    if (impact > 20) this.events.push({kind: 'flipper', x: ball.x, y: ball.y, speed: impact});
  }

  private lightSensor(sensor: Sensor): void {
    sensor.lit = true;
    const points = this.points(100);
    this.score += points;
    this.events.push({kind: 'lane', x: sensor.x, y: sensor.y, points});
    if (this.sensors.every(s => s.lit)) {
      this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + 1);
      this.bestMultiplier = Math.max(this.bestMultiplier, this.multiplier);
      this.score += 500;
      this.events.push({kind: 'multiplier', value: this.multiplier});
      for (const s of this.sensors) s.lit = false;
    }
  }

  private drain(): void {
    this.ballsLeft -= 1;
    this.events.push({kind: 'drain', left: this.ballsLeft});
    if (this.ballsLeft <= 0) { this.over = true; return; }
    this.phase = 'drained';
    this.waitMs = 900;
    this.ball.vx = 0; this.ball.vy = 0;
  }
}
