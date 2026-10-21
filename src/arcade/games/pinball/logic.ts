import {capSpeed, Substepper} from '../../engine/body.js';
import {bounce, circleSegment, type Vec} from '../../engine/collide.js';
import type {Rng} from '../../rng.js';

/**
 * Vespyr Pinball's table and physics, in table units (60 wide, 100 tall, y down). One ball and these contacts: static
 * segments (walls, the top arch, the shooter lane, lane dividers, slingshots with kickers), a one-way gate that lets the
 * ball out of the shooter lane and never back in, pop bumpers, a bank of drop targets, stand-up targets, two flippers
 * (capsules rotating about a pivot that hand the ball their surface speed), a spinner the ball passes through and a ramp
 * that captures the ball at its mouth, carries it along a fixed path (no collisions) and releases it at the far side.
 *
 * The simulation runs in 600 Hz substeps, every timer included, so a game is identical however its frames are split.
 * At the 230 units/s speed cap the ball moves 0.4 units per substep against a 2-unit radius, and a flipper tip (210 units/s)
 * is no faster, so nothing tunnels. A collision under 10 units/s is perfectly inelastic so the ball settles rather than
 * jitters. A watchdog watches for a ball that has not left a small area for a few seconds, or has strayed into the shooter
 * lane: it kicks the ball and, failing that, returns it to the plunger without costing a ball.
 *
 * NMSh reports key presses only (no key release, no reliable repeat), so a flipper key starts a time-bounded stroke: up,
 * a short hold, back down, then a brief cooldown. The plunger takes two presses: the first starts a swinging power
 * meter, the second launches at its current power.
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
export const FLIP_HOLD_MS = 200;
export const FLIP_COOLDOWN_MS = 70;
export const LAUNCH_MIN = 148;
export const LAUNCH_MAX = 218;
export const CHARGE_MS = 1100;
export const DRAIN_Y = 106;
export const MAX_MULTIPLIER = 6;
export const NUDGE_LIMIT = 4;
export const LANE_X = 54.8;
export const LANE_REST_Y = 95.5;
/** The lane's inner wall and the height of the gate above it. */
export const LANE_WALL_X = 51.5;
export const LANE_TOP_Y = 30;
export const BALL_SAVE_MS = 12000;
export const STALL_MS = 3000;
export const STALL_RADIUS = 4;
/** A ball that has not touched a flipper for this long (bouncing in some loop) is given a sideways kick. */
export const LOOP_MS = 25000;
export const DROP_RESET_MS = 1400;
export const RAMP_SPEED = 130;

export interface Segment { a: Vec; b: Vec; restitution: number; kick: number; oneWay?: Vec }
export interface Bumper { x: number; y: number; r: number; lit: number }
export interface Sensor { x: number; y: number; r: number; lit: boolean }
export interface Flipper { pivot: Vec; side: 'left' | 'right'; angle: number; target: number; holdMs: number; cooldownMs: number; tip: Vec; prevTip: Vec }
export interface DropTarget { seg: Segment; up: boolean; hitMs: number }
export interface Standup { seg: Segment; hitMs: number }
export interface Spinner { x: number; y: number; half: number; angle: number; omega: number }

const seg = (ax: number, ay: number, bx: number, by: number, restitution = 0.45, kick = 0): Segment => ({a: {x: ax, y: ay}, b: {x: bx, y: by}, restitution, kick});
const polyline = (points: ReadonlyArray<readonly [number, number]>, restitution = 0.45): Segment[] =>
  points.slice(1).map((point, index) => seg(points[index]![0], points[index]![1], point[0], point[1], restitution));

/** The one-way gate at the top of the shooter lane: blocks only from the table side (up and to the left of it). */
export const GATE: Segment = (() => {
  const gate = seg(LANE_WALL_X, LANE_TOP_Y, 58, 24, 0.3);
  const dx = gate.b.x - gate.a.x, dy = gate.b.y - gate.a.y, length = Math.hypot(dx, dy);
  gate.oneWay = {x: dy / length, y: -dx / length};
  return gate;
})();

/** The static geometry of the table. */
export const SEGMENTS: readonly Segment[] = [
  // The top arch, from the left wall over to the shooter lane's outer wall.
  ...polyline([[2, 30], [2.5, 21], [6, 14], [13, 8.5], [21, 5], [30, 4], [39, 5], [47, 8.5], [54, 14], [57.5, 19], [58, 24]]),
  seg(2, 30, 2, 72), // left wall
  seg(2, 72, 13, 89, 0.3), // left guide to the flipper
  seg(LANE_WALL_X, LANE_TOP_Y, LANE_WALL_X, 72), // the lane's inner wall...
  seg(LANE_WALL_X, 72, 41, 89, 0.3), // ...which is also the right guide
  seg(LANE_WALL_X, 72, LANE_WALL_X, 99), // and runs on down to the lane floor
  seg(58, 24, 58, 99), // outer right wall
  seg(LANE_WALL_X, 99, 58, 99, 0.2), // the lane floor
  GATE,
  // Aprons under the flippers keep a ball that slips through the middle from wandering out sideways before it drains.
  seg(13, 89, 13, 104, 0.2), seg(41, 89, 41, 104, 0.2),
  // Slingshots above the flippers: kickers.
  seg(10, 60, 10, 72, 0.4, 70), seg(10, 72, 17, 80, 0.4, 70), seg(10, 60, 17, 80, 0.4, 70),
  seg(44, 60, 44, 72, 0.4, 70), seg(44, 72, 37, 80, 0.4, 70), seg(44, 60, 37, 80, 0.4, 70),
  // Dividers between the three top rollover lanes.
  seg(22, 15, 22, 23), seg(32, 14.5, 32, 22.5),
];

export const BUMPERS: readonly Pick<Bumper, 'x' | 'y' | 'r'>[] = [{x: 22, y: 38, r: 4.5}, {x: 36, y: 38, r: 4.5}, {x: 29, y: 50, r: 4.5}];
export const SENSORS: readonly Pick<Sensor, 'x' | 'y' | 'r'>[] = [{x: 17, y: 20, r: 3}, {x: 27, y: 18, r: 3}, {x: 37, y: 20, r: 3}];
/** Three drop targets along the left wall, with room behind them for a ball. */
export const DROP_BANK: readonly Segment[] = [seg(7, 34, 7, 39, 0.5), seg(7, 40, 7, 45, 0.5), seg(7, 46, 7, 51, 0.5)];
/** Two stand-up targets that slope away from the lane wall. */
export const STANDUPS: readonly Segment[] = [seg(LANE_WALL_X, 40, 47.5, 45.5, 0.55), seg(LANE_WALL_X, 50, 47.5, 55.5, 0.55)];
export const SPINNER: Pick<Spinner, 'x' | 'y' | 'half'> = {x: 29, y: 27, half: 5};
/** The ramp: its mouth (the ball must be rising) and the path the ball is carried along. */
export const RAMP_MOUTH = {x: 46, y: 34, r: 4};
export const RAMP_PATH: readonly Vec[] = [{x: 46, y: 34}, {x: 48, y: 25}, {x: 43, y: 14}, {x: 29, y: 10}, {x: 15, y: 12}, {x: 9, y: 19}, {x: 11, y: 31}];
const RAMP_LENGTHS = RAMP_PATH.slice(1).map((p, i) => Math.hypot(p.x - RAMP_PATH[i]!.x, p.y - RAMP_PATH[i]!.y));
export const RAMP_TOTAL = RAMP_LENGTHS.reduce((sum, n) => sum + n, 0);
const REST = 0.45;
const ACTIVE = -0.45;

export function rampPoint(distance: number): Vec {
  let left = Math.max(0, Math.min(RAMP_TOTAL, distance));
  for (let i = 0; i < RAMP_LENGTHS.length; i += 1) {
    const length = RAMP_LENGTHS[i]!;
    if (left <= length || i === RAMP_LENGTHS.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, left / length), a = RAMP_PATH[i]!, b = RAMP_PATH[i + 1]!;
      return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t};
    }
    left -= length;
  }
  return RAMP_PATH[RAMP_PATH.length - 1]!;
}

export type PinballEvent =
  | {kind: 'bumper'; x: number; y: number; points: number}
  | {kind: 'sling'; x: number; y: number; points: number}
  | {kind: 'flipper'; x: number; y: number; speed: number}
  | {kind: 'wall'; x: number; y: number; speed: number}
  | {kind: 'lane'; x: number; y: number; points: number}
  | {kind: 'drop'; x: number; y: number; points: number}
  | {kind: 'bank'; points: number}
  | {kind: 'target'; x: number; y: number; points: number}
  | {kind: 'spinner'; x: number; y: number; points: number}
  | {kind: 'ramp'; x: number; y: number; points: number}
  | {kind: 'multiplier'; value: number}
  | {kind: 'launch'; power: number}
  | {kind: 'save'}
  | {kind: 'recover'; how: 'kick' | 'relaunch'}
  | {kind: 'drain'; left: number; x: number}
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
  readonly drops: DropTarget[] = DROP_BANK.map(s => ({seg: s, up: true, hitMs: 0}));
  readonly standups: Standup[] = STANDUPS.map(s => ({seg: s, hitMs: 0}));
  readonly spinner: Spinner = {...SPINNER, angle: 0, omega: 0};
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
  banks = 0;
  ramps = 0;
  spins = 0;
  /** Ball-save time left, and whether the last drain was saved. */
  saveMs = 0;
  saved = false;
  /** Distance carried along the ramp, or undefined when the ball is not on it. */
  rampAt: number | undefined;
  /** How many times the watchdog stepped in. */
  recoveries = 0;
  /** Kicks given to a ball that bounced for LOOP_MS without a flipper touching it. */
  loopKicks = 0;
  private airMs = 0;
  /** Time the ball has spent within a small area, and how many kicks in a row have not shifted it. */
  stallMs = 0;
  private stallKicks = 0;
  private movingMs = 0;
  private anchor: Vec = {x: LANE_X, y: LANE_REST_Y};
  private laneMs = 0;
  private spinAcc = 0;
  private dropResetMs = 0;
  private rampsThisBall = 0;
  private readonly sub = new Substepper(SUB_MS, 200);

  constructor(private readonly rng: Rng) {
    const make = (side: 'left' | 'right', x: number): Flipper => {
      const pivot = {x, y: 90};
      const tip = flipperTip({pivot, side}, REST);
      return {pivot, side, angle: REST, target: REST, holdMs: 0, cooldownMs: 0, tip, prevTip: tip};
    };
    this.flippers = [make('left', 13.5), make('right', 40.5)];
  }

  /** Start a flipper stroke. A stroke in progress (or its short cooldown) ignores the press, so a flipper is never held. */
  flip(side: 'left' | 'right'): boolean {
    if (this.over || this.tilted) return false;
    const flipper = this.flippers[side === 'left' ? 0 : 1];
    if (flipper.holdMs > 0 || flipper.cooldownMs > 0) return false;
    flipper.holdMs = FLIP_HOLD_MS;
    return true;
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
      this.resetWatch();
      this.laneMs = 0;
      if (this.saveMs <= 0 && !this.saved) this.saveMs = BALL_SAVE_MS;
      this.saved = false;
      this.events.push({kind: 'launch', power});
    }
  }

  /** Bump the table: a small kick to the ball, limited; too many tilt the table for the rest of this ball. */
  nudge(): void {
    if (this.over || this.phase !== 'play' || this.rampAt !== undefined || this.nudgeCooldown > 0 || this.tilted) return;
    this.nudgeCooldown = 500;
    this.nudges += 1;
    this.ball.vy -= 14;
    this.ball.vx += this.rng.range(-7, 7);
    if (this.nudges > NUDGE_LIMIT) { this.tilted = true; this.events.push({kind: 'tilt'}); }
  }

  step(dtMs: number): void {
    if (this.over) return;
    this.ball.px = this.ball.x; this.ball.py = this.ball.y;
    this.sub.run(dtMs, dt => this.substep(dt));
  }

  private resetWatch(): void { this.airMs = 0; this.stallMs = 0; this.stallKicks = 0; this.movingMs = 0; this.anchor = {x: this.ball.x, y: this.ball.y}; }

  private nextBall(): void {
    this.ball = {x: LANE_X, y: LANE_REST_Y, vx: 0, vy: 0, px: LANE_X, py: LANE_REST_Y};
    this.phase = 'lane';
    this.rampAt = undefined;
    this.tilted = false;
    this.nudges = 0;
    this.rampsThisBall = 0;
    this.laneMs = 0;
    this.resetWatch();
    if (!this.saved) {
      this.multiplier = 1;
      this.saveMs = 0;
      for (const sensor of this.sensors) sensor.lit = false;
    }
  }

  private substep(dt: number): void {
    if (this.over) return;
    const dtMs = dt * 1000;
    this.nudgeCooldown = Math.max(0, this.nudgeCooldown - dtMs);
    for (const bumper of this.bumpers) bumper.lit = Math.max(0, bumper.lit - dtMs);
    for (const target of this.drops) target.hitMs = Math.max(0, target.hitMs - dtMs);
    for (const target of this.standups) target.hitMs = Math.max(0, target.hitMs - dtMs);
    if (this.dropResetMs > 0) {
      this.dropResetMs -= dtMs;
      if (this.dropResetMs <= 0) for (const target of this.drops) { target.up = true; target.hitMs = 250; }
    }
    this.spinner.angle += this.spinner.omega * dt;
    this.spinAcc += Math.abs(this.spinner.omega) * dt;
    if (this.spinAcc >= Math.PI) {
      this.spinAcc -= Math.PI;
      this.spins += 1;
      this.events.push({kind: 'spinner', x: this.spinner.x, y: this.spinner.y, points: this.award(50)});
    }
    this.spinner.omega *= Math.exp(-1.1 * dt);
    if (Math.abs(this.spinner.omega) < 0.3) this.spinner.omega = 0;
    if (this.phase === 'charging') {
      this.chargeMs += dtMs;
      const t = (this.chargeMs % CHARGE_MS) / CHARGE_MS;
      this.charge = t < 0.5 ? t * 2 : 2 - t * 2;
    }
    // Flippers move toward their target at a fixed angular speed; a finished stroke starts its cooldown.
    for (const flipper of this.flippers) {
      if (flipper.holdMs > 0) { flipper.holdMs = Math.max(0, flipper.holdMs - dtMs); if (flipper.holdMs === 0) flipper.cooldownMs = FLIP_COOLDOWN_MS; }
      else flipper.cooldownMs = Math.max(0, flipper.cooldownMs - dtMs);
      flipper.target = flipper.holdMs > 0 && !this.tilted ? ACTIVE : REST;
      flipper.prevTip = flipper.tip;
      const move = FLIPPER_SPEED * dt;
      flipper.angle += Math.max(-move, Math.min(move, flipper.target - flipper.angle));
      flipper.tip = flipperTip(flipper, flipper.angle);
    }
    if (this.phase === 'drained') {
      this.waitMs -= dtMs;
      if (this.waitMs <= 0) this.nextBall();
      return;
    }
    const ball = this.ball;
    if (this.phase === 'lane' || this.phase === 'charging') {
      ball.vx = 0; ball.vy = 0; ball.x = LANE_X; ball.y = LANE_REST_Y;
      return;
    }
    this.saveMs = Math.max(0, this.saveMs - dtMs);
    if (this.rampAt !== undefined) { this.ride(dt); return; }
    const oy = ball.y;
    ball.vy += GRAVITY * dt;
    capSpeed(ball, BALL_MAX);
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    for (let pass = 0; pass < 2; pass += 1) {
      for (const segment of SEGMENTS) this.contact(segment);
      for (const target of this.drops) if (target.up) this.hitDrop(target);
      this.standups.forEach(target => this.hitStandup(target));
      for (const bumper of this.bumpers) this.hitBumper(bumper);
      for (const flipper of this.flippers) this.hitFlipper(flipper, dt);
    }
    capSpeed(ball, BALL_MAX);
    for (const sensor of this.sensors) {
      if (!sensor.lit && Math.hypot(ball.x - sensor.x, ball.y - sensor.y) < sensor.r + BALL_R * 0.5) this.lightSensor(sensor);
    }
    this.spin(oy);
    if (ball.vy < -45 && Math.hypot(ball.x - RAMP_MOUTH.x, ball.y - RAMP_MOUTH.y) < RAMP_MOUTH.r) this.enterRamp();
    if (ball.y > DRAIN_Y) { this.drain(); return; }
    this.watch(dtMs);
  }

  private points(value: number): number { return value * this.multiplier; }

  private award(value: number): number { const points = this.points(value); this.score += points; return points; }

  private raiseMultiplier(): void {
    this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + 1);
    this.bestMultiplier = Math.max(this.bestMultiplier, this.multiplier);
    this.events.push({kind: 'multiplier', value: this.multiplier});
  }

  /** Collide with one segment (honouring a one-way gate); returns the impact speed, 0 when there was none. */
  private contact(segment: Segment): number {
    const ball = this.ball;
    if (segment.oneWay && (ball.x - segment.a.x) * segment.oneWay.x + (ball.y - segment.a.y) * segment.oneWay.y <= 0) return 0;
    const hit = circleSegment({x: ball.x, y: ball.y, r: BALL_R}, segment.a, segment.b);
    if (!hit) return 0;
    ball.x += hit.nx * hit.depth; ball.y += hit.ny * hit.depth;
    const impact = -(ball.vx * hit.nx + ball.vy * hit.ny);
    if (impact <= 0) return 0;
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
      this.events.push({kind: 'sling', x: ball.x, y: ball.y, points: this.award(10)});
    } else if (impact > 25) this.events.push({kind: 'wall', x: ball.x, y: ball.y, speed: impact});
    return impact;
  }

  private hitDrop(target: DropTarget): void {
    if (this.contact(target.seg) < 6) return;
    target.up = false;
    target.hitMs = 350;
    const mid = {x: (target.seg.a.x + target.seg.b.x) / 2, y: (target.seg.a.y + target.seg.b.y) / 2};
    this.events.push({kind: 'drop', x: mid.x, y: mid.y, points: this.award(200)});
    if (this.drops.every(t => !t.up)) {
      this.banks += 1;
      const bonus = this.award(1500);
      this.events.push({kind: 'bank', points: bonus});
      this.raiseMultiplier();
      this.dropResetMs = DROP_RESET_MS;
    }
  }

  private hitStandup(target: Standup): void {
    if (this.contact(target.seg) < 6) return;
    target.hitMs = 300;
    this.events.push({kind: 'target', x: (target.seg.a.x + target.seg.b.x) / 2, y: (target.seg.a.y + target.seg.b.y) / 2, points: this.award(250)});
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
    bumper.lit = 260;
    this.bumperHits += 1;
    this.events.push({kind: 'bumper', x: bumper.x, y: bumper.y, points: this.award(100)});
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
    this.airMs = 0;
    if (impact > 20) this.events.push({kind: 'flipper', x: ball.x, y: ball.y, speed: impact});
  }

  private lightSensor(sensor: Sensor): void {
    sensor.lit = true;
    this.events.push({kind: 'lane', x: sensor.x, y: sensor.y, points: this.award(100)});
    if (this.sensors.every(s => s.lit)) {
      this.score += 500;
      this.raiseMultiplier();
      for (const s of this.sensors) s.lit = false;
    }
  }

  /** The ball crossing the spinner's line between its ends turns it, in the direction of travel. */
  private spin(oy: number): void {
    const ball = this.ball, s = this.spinner;
    if ((oy - s.y) * (ball.y - s.y) > 0 || oy === ball.y) return;
    if (Math.abs(ball.x - s.x) > s.half) return;
    const kick = Math.sign(ball.y - oy) * Math.min(45, Math.abs(ball.vy) * 0.35 + 6);
    s.omega = Math.max(-45, Math.min(45, s.omega + kick));
    ball.vy *= 0.985;
  }

  private enterRamp(): void {
    this.rampAt = 0;
    this.ramps += 1;
    this.rampsThisBall += 1;
    this.ball.x = RAMP_PATH[0]!.x; this.ball.y = RAMP_PATH[0]!.y;
    this.events.push({kind: 'ramp', x: this.ball.x, y: this.ball.y, points: this.award(750)});
    if (this.rampsThisBall % 3 === 0) this.raiseMultiplier();
  }

  /** Carry the ball along the ramp; at the end let it go with the last leg's direction. */
  private ride(dt: number): void {
    const ball = this.ball;
    this.rampAt = (this.rampAt ?? 0) + RAMP_SPEED * dt;
    if (this.rampAt >= RAMP_TOTAL) {
      const last = RAMP_PATH[RAMP_PATH.length - 1]!, before = RAMP_PATH[RAMP_PATH.length - 2]!;
      const length = Math.hypot(last.x - before.x, last.y - before.y) || 1;
      ball.x = last.x; ball.y = last.y;
      ball.vx = ((last.x - before.x) / length) * 60; ball.vy = ((last.y - before.y) / length) * 60;
      this.rampAt = undefined;
      this.resetWatch();
      return;
    }
    const at = rampPoint(this.rampAt), ahead = rampPoint(this.rampAt + 1);
    ball.x = at.x; ball.y = at.y;
    ball.vx = (ahead.x - at.x) * RAMP_SPEED; ball.vy = (ahead.y - at.y) * RAMP_SPEED;
  }

  /** A ball that has not left a small area for STALL_MS, or sits in the shooter lane after launch, is helped. */
  private watch(dtMs: number): void {
    const ball = this.ball;
    this.airMs += dtMs;
    if (this.airMs > LOOP_MS) {
      this.airMs = 0;
      this.loopKicks += 1;
      ball.vx += (this.rng.next() < 0.5 ? -1 : 1) * this.rng.range(25, 45);
      this.events.push({kind: 'recover', how: 'kick'});
    }
    const inLane = ball.x > LANE_WALL_X && ball.y > LANE_TOP_Y - 2;
    this.laneMs = inLane ? this.laneMs + dtMs : 0;
    if (inLane && (this.laneMs > 4000 || (this.laneMs > 900 && Math.hypot(ball.vx, ball.vy) < 6))) { this.relaunch(); return; }
    if (Math.hypot(ball.x - this.anchor.x, ball.y - this.anchor.y) > STALL_RADIUS) {
      this.anchor = {x: ball.x, y: ball.y};
      this.stallMs = 0;
      this.movingMs += dtMs;
      if (this.movingMs > 1500) this.stallKicks = 0;
      return;
    }
    this.movingMs = 0;
    this.stallMs += dtMs;
    if (this.stallMs < STALL_MS) return;
    this.stallMs = 0;
    this.recoveries += 1;
    this.stallKicks += 1;
    if (this.stallKicks >= 3) { this.relaunch(); return; }
    this.ball.vx += this.rng.range(-40, 40);
    this.ball.vy -= 70;
    this.events.push({kind: 'recover', how: 'kick'});
  }

  /** Put the ball back at the plunger, free: used when it is somewhere it cannot get out of. */
  private relaunch(): void {
    this.recoveries += 1;
    this.saved = true;
    this.events.push({kind: 'recover', how: 'relaunch'});
    this.nextBall();
  }

  private drain(): void {
    const x = this.ball.x;
    if (this.saveMs > 0) {
      // Ball save: the ball comes back to the plunger at no cost.
      this.saveMs = 0;
      this.saved = true;
      this.events.push({kind: 'save'});
      this.events.push({kind: 'drain', left: this.ballsLeft, x});
    } else {
      this.saved = false;
      this.ballsLeft -= 1;
      this.events.push({kind: 'drain', left: this.ballsLeft, x});
      if (this.ballsLeft <= 0) { this.over = true; return; }
    }
    this.phase = 'drained';
    this.waitMs = 900;
    this.ball.vx = 0; this.ball.vy = 0;
  }
}
