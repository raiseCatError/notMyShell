import {capSpeed, pointVelocity, Substepper} from '../../engine/body.js';
import {hash, unit} from '../../scenery.js';

/**
 * Vespyr Rover's world and physics, in world units (about one terminal pixel at the default zoom), y down.
 *
 * The rover is one rigid body (position, angle, velocities) on two tire springs. Each wheel is a circle: where it sinks
 * into the terrain its spring pushes along the surface normal, with damping, and the drive, brake and rolling
 * resistance act along the surface tangent, limited by friction times the normal force, so grip, wheelies and a nose-dive
 * all fall out of the same forces. The terrain is a pure function of x and the seed (sums of sines whose height grows with
 * distance), so a run replays exactly. Physics runs in fixed 240 Hz substeps whatever `step` is given, and a wheel that
 * sinks past a hard limit is pushed back out, so no speed tunnels through the ground.
 *
 * NMSh reports key presses only (no releases), so a drive or brake key latches for a short time that held-key repeats
 * keep renewing, like Purr Pong's paddle.
 */
export const GRAVITY = 80;
export const SUB_MS = 1000 / 240;
export const WHEEL_R = 2.4;
export const WHEEL_X = 5.5;
export const WHEEL_Y = 1.6;
export const MASS = 1;
export const INERTIA = 22;
export const SPRING = 40;
export const DAMPER = 6;
export const FN_MAX = 900;
export const MU = 1.5;
export const DRIVE = 22;
export const BRAKE = 24;
export const ROLLING = 0.15;
export const SPEED_CAP = 70;
export const DRIVE_SPEED = 38;
/** The deepest a wheel may sink, as a share of its radius, before it is pushed back out. */
export const MAX_SINK = 1.2;
export const HEAD = {x: 0.6, y: -4.3, r: 1.3};
export const ROOF = {x: -3.2, y: -2.7, r: 1.1};
export const FUEL_MAX = 100;
export const FUEL_PICKUP = 50;
export const THROTTLE_MS = 550;
export const BRAKE_MS = 400;
export const TILT_MS = 130;
export const TILT_TORQUE = 120;
export const START_X = 8;
/** Metres shown per world unit. */
export const METRES = 0.2;

export interface Pickup { x: number; y: number }
export type RoverEvent = {kind: 'pickup'; x: number; y: number} | {kind: 'crash'; x: number; y: number; reason: 'flip' | 'fuel'} | {kind: 'land'; x: number; y: number; speed: number} | {kind: 'flip'; count: number};

export class Terrain {
  private readonly phase: readonly [number, number, number];
  constructor(readonly seed: number) {
    this.phase = [unit(seed) * 6.28, unit(seed + 7) * 6.28, unit(seed + 13) * 6.28];
  }
  /** Ground height (y) at x. Flat and gentle near the start, steeper and bumpier with distance. */
  height(x: number): number {
    if (x < 30) return 0;
    const ramp = Math.min(1, (x - 30) / 90);
    const amp = (2.5 + Math.min(11.5, Math.max(0, x - 60) / 70)) * ramp * ramp * (3 - 2 * ramp);
    const [a, b, c] = this.phase;
    return -amp * (0.55 * (Math.sin(x / 26 + a) - Math.sin(a)) + 0.3 * (Math.sin(x / 11 + b) - Math.sin(b)) + 0.15 * (Math.sin(x / 5 + c) - Math.sin(c))) * 1;
  }
  slope(x: number): number { return (this.height(x + 0.25) - this.height(x - 0.25)) / 0.5; }
}

export class RoverState {
  x = START_X; y = -(WHEEL_R + WHEEL_Y) + 0.9; angle = 0;
  vx = 0; vy = 0; omega = 0;
  px = START_X; py = this.y; pangle = 0;
  fuel = FUEL_MAX;
  flips = 0;
  over = false;
  reason: 'flip' | 'fuel' | undefined;
  events: RoverEvent[] = [];
  pickups: Pickup[] = [];
  collected = 0;
  elapsedMs = 0;
  readonly terrain: Terrain;
  /** Per wheel (rear, front): sunk into the ground by this much (0 when airborne). */
  readonly sink: [number, number] = [0, 0];
  private throttleMs = 0;
  private brakeMs = 0;
  private tiltMs = 0;
  private tiltDir: -1 | 1 = 1;
  private airAngle = 0;
  private airborne = false;
  private stallMs = 0;
  private nextPickup = 0;
  private readonly sub = new Substepper(SUB_MS);
  /** Highest x reached, so distance never goes back. */
  furthest = START_X;

  constructor(readonly seed: number) {
    this.terrain = new Terrain(seed);
    this.spawnPickups();
  }

  get distance(): number { return Math.max(0, Math.floor((this.furthest - START_X) * METRES)); }
  get score(): number { return this.distance + this.flips * 25; }
  get speed(): number { return Math.hypot(this.vx, this.vy); }
  get driving(): boolean { return this.throttleMs > 0 && this.fuel > 0; }
  get braking(): boolean { return this.brakeMs > 0; }
  get grounded(): boolean { return this.sink[0] > 0 || this.sink[1] > 0; }

  /** Drive forward (dir 1) or brake and reverse (dir -1), renewed by repeats. */
  drive(dir: 1 | -1): void {
    if (this.over) return;
    if (dir === 1) { this.throttleMs = THROTTLE_MS; this.brakeMs = 0; } else { this.brakeMs = BRAKE_MS; this.throttleMs = 0; }
  }
  /** Tilt the nose up (-1, counter-clockwise) or down (1). */
  tilt(dir: -1 | 1): void { if (!this.over) { this.tiltMs = TILT_MS; this.tiltDir = dir; } }

  /** World position of a body-local point. */
  local(lx: number, ly: number, angle = this.angle, x = this.x, y = this.y): {x: number; y: number} {
    const c = Math.cos(angle), s = Math.sin(angle);
    return {x: x + lx * c - ly * s, y: y + lx * s + ly * c};
  }

  private spawnPickups(): void {
    while (this.nextPickup < 4 || (this.pickups.length === 0 || this.pickups[this.pickups.length - 1]!.x < this.x + 260)) {
      const i = this.nextPickup;
      const x = 80 + i * 130 + Math.min(i * 7, 150) * i * 0.4 + (hash(this.seed * 31 + i) % 30);
      this.pickups.push({x, y: this.terrain.height(x) - 7});
      this.nextPickup += 1;
      if (this.nextPickup > 4000) break;
    }
  }

  step(dtMs: number): void {
    if (this.over) return;
    this.px = this.x; this.py = this.y; this.pangle = this.angle;
    this.sub.run(dtMs, dt => this.substep(dt));
    this.elapsedMs += dtMs;
    this.spawnPickups();
  }

  private substep(dt: number): void {
    if (this.over) return;
    const fuelLeft = this.fuel > 0;
    const throttle = this.throttleMs > 0 && fuelLeft ? 1 : 0;
    const brake = this.brakeMs > 0 ? 1 : 0;
    this.throttleMs = Math.max(0, this.throttleMs - dt * 1000);
    this.brakeMs = Math.max(0, this.brakeMs - dt * 1000);
    this.fuel = Math.max(0, this.fuel - (throttle ? 5 : 1) * dt);

    let fx = 0, fy = MASS * GRAVITY, torque = 0;
    if (this.tiltMs > 0) { torque += this.tiltDir * TILT_TORQUE; this.tiltMs = Math.max(0, this.tiltMs - dt * 1000); }
    let contacts = 0;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    for (let wheel = 0; wheel < 2; wheel += 1) {
      const lx = wheel === 0 ? -WHEEL_X : WHEEL_X;
      const rx = lx * c - WHEEL_Y * s, ry = lx * s + WHEEL_Y * c;
      const wx = this.x + rx, wy = this.y + ry;
      const slope = this.terrain.slope(wx);
      const norm = Math.sqrt(1 + slope * slope);
      const nx = slope / norm, ny = -1 / norm, tx = 1 / norm, ty = slope / norm;
      const ground = this.terrain.height(wx);
      const dist = (ground - wy) / norm;
      let pen = WHEEL_R - dist;
      if (pen <= 0) { this.sink[wheel] = 0; continue; }
      if (pen > WHEEL_R * MAX_SINK) {
        // Hard stop: lift the body out along the normal and drop the velocity going into the ground.
        const lift = pen - WHEEL_R * MAX_SINK;
        this.x += nx * lift; this.y += ny * lift;
        const into = this.vx * nx + this.vy * ny;
        if (into < 0) { this.vx -= into * nx; this.vy -= into * ny; }
        pen = WHEEL_R * MAX_SINK;
      }
      this.sink[wheel] = pen;
      contacts += 1;
      const pv = pointVelocity(this.vx, this.vy, this.omega, rx, ry);
      const vn = pv.x * nx + pv.y * ny;
      const vt = pv.x * tx + pv.y * ty;
      const normal = Math.min(FN_MAX, Math.max(0, SPRING * pen - DAMPER * vn));
      let tangent = -ROLLING * vt;
      if (throttle) tangent += DRIVE * Math.max(0, 1 - vt / DRIVE_SPEED);
      if (brake) tangent += vt > 1.5 ? -BRAKE : -DRIVE * 0.5 * Math.max(0, 1 + vt / 14);
      const limit = MU * normal;
      tangent = Math.max(-limit, Math.min(limit, tangent));
      const wfx = normal * nx + tangent * tx, wfy = normal * ny + tangent * ty;
      fx += wfx; fy += wfy;
      torque += rx * wfy - ry * wfx;
    }
    this.vx += (fx / MASS) * dt;
    this.vy += (fy / MASS) * dt;
    this.omega += (torque / INERTIA) * dt;
    const drag = 1 - 0.08 * dt;
    this.vx *= drag; this.vy *= drag;
    this.omega *= 1 - (contacts > 0 ? 1.2 : 0.5) * dt;
    capSpeed(this, SPEED_CAP);
    this.omega = Math.max(-9, Math.min(9, this.omega));
    this.x += this.vx * dt; this.y += this.vy * dt; this.angle += this.omega * dt;
    if (this.x < -6) { this.x = -6; this.vx = Math.max(0, this.vx); }
    this.furthest = Math.max(this.furthest, this.x);

    // Flips: whole turns in the air count when the wheels touch again.
    if (contacts === 0) {
      if (!this.airborne) { this.airborne = true; this.airAngle = 0; }
      this.airAngle += this.omega * dt;
    } else if (this.airborne) {
      this.airborne = false;
      const turns = Math.floor(Math.abs(this.airAngle) / (Math.PI * 2) + 0.15);
      if (turns > 0) { this.flips += turns; this.events.push({kind: 'flip', count: turns}); }
      const landing = Math.abs(this.vy);
      if (landing > 12) this.events.push({kind: 'land', x: this.x, y: this.y, speed: landing});
    }

    // Pickups.
    for (let index = this.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.pickups[index]!;
      if (Math.hypot(pickup.x - this.x, pickup.y - this.y) < 6.5) {
        this.pickups.splice(index, 1);
        this.fuel = Math.min(FUEL_MAX, this.fuel + FUEL_PICKUP);
        this.collected += 1;
        this.events.push({kind: 'pickup', x: pickup.x, y: pickup.y});
      } else if (pickup.x < this.x - 80) this.pickups.splice(index, 1);
    }

    // Crash: the driver's head or the roof touches the ground.
    for (const part of [HEAD, ROOF]) {
      const point = this.local(part.x, part.y);
      if (point.y + part.r > this.terrain.height(point.x)) { this.finish('flip'); return; }
    }
    // Stalled with an empty tank.
    if (this.fuel <= 0 && Math.hypot(this.vx, this.vy) < 1.2) {
      this.stallMs += dt * 1000;
      if (this.stallMs > 1500) this.finish('fuel');
    } else this.stallMs = 0;
  }

  private finish(reason: 'flip' | 'fuel'): void {
    this.over = true;
    this.reason = reason;
    this.events.push({kind: 'crash', x: this.x, y: this.y, reason});
  }
}
