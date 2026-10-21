import {capSpeed, pointVelocity, Substepper} from '../../engine/body.js';
import {hash, unit} from '../../scenery.js';

/**
 * Vespyr Rover's world and physics, in world units (about one terminal pixel at the default zoom), y down.
 *
 * The rover is one rigid body: position, angle, linear and angular velocity, with a moment of inertia, angular damping
 * and torque. Each of its two wheels hangs on a spring-and-damper suspension: where the wheel circle sinks into the
 * ground its spring pushes along the surface normal (a stiff bump stop past full travel), while drive, brake and rolling
 * resistance act along the surface tangent, limited by friction times the normal force. Grip, wheelies, nose-dives,
 * the nose-down pitch of a crest take-off and a rollover therefore all fall out of the same forces; so does a slope
 * too steep for the tires. The hull, roof and the driver's head also collide with the ground; head or roof on the
 * ground (or being stuck upside down) starts a short crash window that a rover which rights itself survives.
 *
 * Tilt keys are bounded torque pulses (a few chained presses at most): in the air they spin the body, on the ground they
 * shift weight and pitch against the springs. Flips are counted from the simulated angle, one per full net turn.
 * The terrain is built once from the seed (smooth cubic pieces with limited slope), so a run replays exactly. Physics
 * runs in fixed 240 Hz substeps whatever `step` is given, and a wheel that sinks past a hard limit is pushed back out.
 *
 * NMSh reports key presses only (no releases), so a drive or brake key latches for a short time that held-key repeats
 * keep renewing, like Purr Pong's paddle.
 */
export const GRAVITY = 80;
export const SUB_MS = 1000 / 240;
export const WHEEL_R = 2.4;
export const WHEEL_X = 5.5;
/** Body-local height of a wheel center with the suspension fully extended (it rides about one unit higher at rest). */
export const WHEEL_Y = 2.6;
export const MASS = 1;
export const INERTIA = 22;
export const SPRING = 40;
export const DAMPER = 7;
/** Suspension travel before the bump stop, and the extra sink at which a wheel is pushed back out. */
export const TRAVEL = 1.9;
export const BUMP = 500;
export const MAX_PEN = TRAVEL + 1.4;
export const FN_MAX = 900;
export const MU = 1;
export const DRIVE = 40;
export const BRAKE = 30;
export const ROLLING = 0.15;
export const SPEED_CAP = 70;
/** Speed at which the drive runs out (it fades gently before that, like an engine's torque curve). */
export const DRIVE_SPEED = 48;
export const MAX_OMEGA = 9;
export const AIR_DAMPING = 0.12;
export const GROUND_DAMPING = 1.4;
export const HEAD = {x: 0.6, y: -4.3, r: 1.3};
export const ROOF = {x: -3.2, y: -2.7, r: 1.1};
const HULL = [{x: -6.4, y: 1.9, r: 0.6}, {x: 6.6, y: 1.9, r: 0.6}, {x: 0, y: 1.9, r: 0.6}] as const;
export const FUEL_MAX = 100;
export const FUEL_PICKUP = 50;
export const THROTTLE_MS = 550;
export const BRAKE_MS = 400;
/** One tilt press is a torque pulse of this length; chained presses add up to the cap. */
export const TILT_MS = 130;
export const TILT_MAX_MS = 390;
export const TILT_AIR = 320;
export const TILT_GROUND = 520;
/** Head or roof on the ground, or stuck upside down, for this long ends the run; righting the rover heals it. */
export const CRASH_MS = 800;
/** A rover that has not moved for this long (with fuel left) is stranded and the run ends. */
export const STRANDED_MS = 9000;
export const START_X = 8;
/** Metres shown per world unit. */
export const METRES = 0.2;
/** No terrain slope exceeds this (the friction limit is MU). */
export const MAX_SLOPE = 0.75;
const TAU = Math.PI * 2;

export interface Pickup { x: number; y: number }
export type RoverEvent = {kind: 'pickup'; x: number; y: number} | {kind: 'crash'; x: number; y: number; reason: 'flip' | 'fuel' | 'stuck'} | {kind: 'land'; x: number; y: number; speed: number} | {kind: 'flip'; count: number};

/** What the rover drives on: a height (y, down) and its slope at x. */
export interface TerrainLike { height(x: number): number; slope(x: number): number }

interface Knot { x: number; y: number; s: number }

/** The angle wrapped to -PI..PI. */
export const wrapAngle = (angle: number): number => angle - TAU * Math.round(angle / TAU);

/**
 * Deterministic terrain: cubic Hermite pieces between knots chosen from the seed, so height and slope are continuous.
 * Features (rollers, valleys, climbs, plateaus, jump ramps with a drop behind the crest, bumps) get steeper and taller
 * with distance, and every piece is stretched until its slope stays within MAX_SLOPE.
 */
export class Terrain implements TerrainLike {
  private readonly knots: Knot[] = [{x: 30, y: 0, s: 0}];
  private feature = 0;
  constructor(readonly seed: number) {}

  private rnd(k: number): number { return unit(this.seed * 7919 + this.feature * 131 + k * 17 + 5); }

  private static piece(a: Knot, b: Knot, x: number): {y: number; s: number} {
    const length = b.x - a.x, t = (x - a.x) / length, t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * length * a.s + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * length * b.s;
    const d = ((6 * t2 - 6 * t) * a.y + (3 * t2 - 4 * t + 1) * length * a.s + (-6 * t2 + 6 * t) * b.y + (3 * t2 - 2 * t) * length * b.s) / length;
    return {y, s: d};
  }

  /** Add a knot `dx` along with height change `dy` and end slope `s`, stretching dx until the piece is gentle enough. */
  private push(dx: number, dy: number, s: number): void {
    const last = this.knots[this.knots.length - 1]!;
    let length = dx;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const next: Knot = {x: last.x + length, y: last.y + dy, s};
      let max = 0;
      for (let i = 0; i <= 32; i += 1) max = Math.max(max, Math.abs(Terrain.piece(last, next, last.x + (length * i) / 32).s));
      if (max <= MAX_SLOPE * 0.97) { this.knots.push(next); return; }
      length *= 1.12;
    }
    this.knots.push({x: last.x + length, y: last.y + dy, s: 0});
  }

  private addFeature(): void {
    const last = this.knots[this.knots.length - 1]!;
    const d = Math.min(1, (last.x - 30) / 6000);
    const u = [this.rnd(0), this.rnd(1), this.rnd(2), this.rnd(3)] as const;
    let kind = u[0];
    if (this.feature === 0) kind = 0.1;
    // Keep the course between roughly 130 units up and 40 down of the start.
    const low = last.y > 40, high = last.y < -130;
    const rise = (size: number) => (high ? Math.abs(size) : low ? -Math.abs(size) : (u[3] < 0.62 ? -1 : 1) * Math.abs(size));
    this.feature += 1;
    if (kind < 0.26) {
      const count = 2 + Math.floor(u[1] * 2);
      const amp = (1.6 + 2.8 * d) * (0.6 + 0.8 * u[2]);
      let sign = u[3] < 0.5 ? -1 : 1;
      for (let i = 0; i < count; i += 1) { this.push(24 + this.rnd(5 + i) * 22, sign * amp, 0); sign = -sign; }
    } else if (kind < 0.36) {
      this.push(26 + u[1] * 40, 0, 0);
    } else if (kind < 0.52) {
      const depth = 5 + (7 + 16 * d) * u[1];
      this.push(46 + u[2] * 40, depth, 0);
      this.push(8 + u[3] * 18, 0, 0);
      this.push(40 + this.rnd(6) * 40, -depth * (0.9 + 0.2 * this.rnd(7)), 0);
    } else if (kind < 0.7) {
      const dy = rise((8 + 22 * d) * (0.5 + u[1]));
      const target = 0.3 + 0.38 * d * (0.4 + 0.6 * u[2]);
      this.push((1.5 * Math.abs(dy)) / target, dy, 0);
      this.push(14 + u[3] * 18, 0, 0);
    } else if (kind < 0.8 && last.x > 600 && !low) {
      // A cliff: a long downhill run builds speed, a flat lip, then the ground falls away steeply for a big jump.
      const run = 18 + 22 * d * u[1];
      this.push(110 + u[2] * 60, run, 0);
      this.push(14, 0, 0.05);
      this.push(40 + u[3] * 20, 18 + 36 * (0.3 + 0.7 * d) * this.rnd(4), 0);
      this.push(20 + this.rnd(5) * 20, 0, 0);
    } else if (kind < 0.9 && !low) {
      // A jump: a downhill run-up for speed, a climb to a lip with a steep end slope, then the ground falls away.
      const run = 14 + 26 * u[1] * (0.4 + d);
      const up = run * (0.28 + 0.2 * u[2]);
      this.push(60 + u[3] * 40, run, 0);
      this.push(16 + this.rnd(4) * 6, -up, -(0.52 + 0.2 * this.rnd(5)));
      this.push(6, 0.4, 0.62);
      this.push(24 + this.rnd(6) * 12, up + 10 + (18 + 50 * d) * this.rnd(7) ** 1.3, 0);
      this.push(20 + this.rnd(8) * 26, 0, 0);
    } else {
      const count = 3 + Math.floor(u[1] * 3);
      const height = 0.8 + 1.4 * u[2];
      for (let i = 0; i < count; i += 1) { this.push(7 + this.rnd(5 + i) * 3, -height, 0); this.push(7 + this.rnd(9 + i) * 3, height, 0); }
      this.push(10, 0, 0);
    }
  }

  private locate(x: number): number {
    while (this.knots[this.knots.length - 1]!.x < x + 1) this.addFeature();
    let lo = 0, hi = this.knots.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.knots[mid]!.x <= x) lo = mid; else hi = mid; }
    return lo;
  }

  height(x: number): number {
    if (x <= 30) return 0;
    const i = this.locate(x);
    return Terrain.piece(this.knots[i]!, this.knots[i + 1]!, x).y;
  }
  slope(x: number): number {
    if (x <= 30) return 0;
    const i = this.locate(x);
    return Terrain.piece(this.knots[i]!, this.knots[i + 1]!, x).s;
  }
}

export class RoverState {
  x = START_X; y = -(WHEEL_R + WHEEL_Y - 1) + 0.05; angle = 0;
  vx = 0; vy = 0; omega = 0;
  px = START_X; py = this.y; pangle = 0;
  fuel = FUEL_MAX;
  flips = 0;
  over = false;
  reason: 'flip' | 'fuel' | 'stuck' | undefined;
  events: RoverEvent[] = [];
  pickups: Pickup[] = [];
  collected = 0;
  elapsedMs = 0;
  /** Milliseconds of the crash window used so far (head or roof down, or stuck upside down). */
  crashMs = 0;
  /** Wheel spin angle, for drawing. */
  spin = 0;
  readonly terrain: TerrainLike;
  /** Per wheel (rear, front): how deep the wheel circle is in the ground (0 when airborne). */
  readonly sink: [number, number] = [0, 0];
  /** Per wheel: how far the suspension is compressed (its center rides this far above full extension). */
  readonly compression: [number, number] = [0, 0];
  private throttleMs = 0;
  private brakeMs = 0;
  private tiltMs = 0;
  private tiltDir: -1 | 1 = 1;
  private airborne = false;
  private hullDown = false;
  private flipBase = 0;
  private settledMs = 0;
  private stallMs = 0;
  private strandedMs = 0;
  private nextPickup = 0;
  private nextCanX = 80;
  private readonly sub = new Substepper(SUB_MS);
  /** Highest x reached, so distance never goes back. */
  furthest = START_X;

  constructor(readonly seed: number, terrain?: TerrainLike) {
    this.terrain = terrain ?? new Terrain(seed);
    this.spawnPickups();
  }

  get distance(): number { return Math.max(0, Math.floor((this.furthest - START_X) * METRES)); }
  get score(): number { return this.distance + this.flips * 25; }
  get speed(): number { return Math.hypot(this.vx, this.vy); }
  get driving(): boolean { return this.throttleMs > 0 && this.fuel > 0; }
  get braking(): boolean { return this.brakeMs > 0; }
  get grounded(): boolean { return this.sink[0] > 0 || this.sink[1] > 0; }
  /** The body is more than about 115 degrees from upright. */
  get upsideDown(): boolean { return Math.abs(wrapAngle(this.angle)) > 2; }
  /** How much of the crash window is used, 0..1. */
  get danger(): number { return Math.min(1, this.crashMs / CRASH_MS); }
  get tilting(): boolean { return this.tiltMs > 0; }

  /** Drive forward (dir 1) or brake and reverse (dir -1), renewed by repeats. */
  drive(dir: 1 | -1): void {
    if (this.over) return;
    if (dir === 1) { this.throttleMs = THROTTLE_MS; this.brakeMs = 0; } else { this.brakeMs = BRAKE_MS; this.throttleMs = 0; }
  }
  /** One torque pulse: nose up (-1, counter-clockwise) or down (1). Quick presses in one direction chain, up to a cap. */
  tilt(dir: -1 | 1): void {
    if (this.over) return;
    this.tiltMs = dir === this.tiltDir && this.tiltMs > 0 ? Math.min(TILT_MAX_MS, this.tiltMs + TILT_MS) : TILT_MS;
    this.tiltDir = dir;
  }

  /** World position of a body-local point. */
  local(lx: number, ly: number, angle = this.angle, x = this.x, y = this.y): {x: number; y: number} {
    const c = Math.cos(angle), s = Math.sin(angle);
    return {x: x + lx * c - ly * s, y: y + lx * s + ly * c};
  }
  /** World position of a wheel's center as drawn (0 rear, 1 front): full extension minus the suspension's compression. */
  wheelCenter(wheel: 0 | 1, angle = this.angle, x = this.x, y = this.y): {x: number; y: number} {
    return this.local(wheel === 0 ? -WHEEL_X : WHEEL_X, WHEEL_Y - this.compression[wheel], angle, x, y);
  }

  private spawnPickups(): void {
    while (this.nextPickup < 4 || (this.pickups.length === 0 || this.pickups[this.pickups.length - 1]!.x < this.x + 260)) {
      const i = this.nextPickup;
      const x = this.nextCanX + (hash(this.seed * 31 + i) % 30);
      this.nextCanX += 120 + Math.min(i * 5, 220);
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

  private normalAt(x: number): {nx: number; ny: number; tx: number; ty: number; norm: number} {
    const slope = this.terrain.slope(x);
    const norm = Math.sqrt(1 + slope * slope);
    return {nx: slope / norm, ny: -1 / norm, tx: 1 / norm, ty: slope / norm, norm};
  }

  private substep(dt: number): void {
    if (this.over) return;
    const throttle = this.throttleMs > 0 && this.fuel > 0 ? 1 : 0;
    const brake = this.brakeMs > 0 ? 1 : 0;
    this.throttleMs = Math.max(0, this.throttleMs - dt * 1000);
    this.brakeMs = Math.max(0, this.brakeMs - dt * 1000);
    this.fuel = Math.max(0, this.fuel - (throttle ? 6 : 1) * dt);

    let fx = 0, fy = MASS * GRAVITY, torque = 0;
    if (this.tiltMs > 0) {
      torque += this.tiltDir * (this.grounded ? TILT_GROUND : TILT_AIR);
      this.tiltMs = Math.max(0, this.tiltMs - dt * 1000);
    }
    let contacts = 0, spinTarget = 0;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    for (let wheel = 0; wheel < 2; wheel += 1) {
      const lx = wheel === 0 ? -WHEEL_X : WHEEL_X;
      const rx = lx * c - WHEEL_Y * s, ry = lx * s + WHEEL_Y * c;
      const wx = this.x + rx, wy = this.y + ry;
      const {nx, ny, tx, ty, norm} = this.normalAt(wx);
      let pen = WHEEL_R - (this.terrain.height(wx) - wy) / norm;
      if (pen <= 0) { this.sink[wheel] = 0; this.compression[wheel] = 0; continue; }
      if (pen > MAX_PEN) {
        // Hard stop: lift the body out along the normal and drop the velocity going into the ground.
        const lift = pen - MAX_PEN;
        this.x += nx * lift; this.y += ny * lift;
        const into = this.vx * nx + this.vy * ny;
        if (into < 0) { this.vx -= into * nx; this.vy -= into * ny; }
        pen = MAX_PEN;
      }
      const compression = Math.min(pen, TRAVEL);
      this.sink[wheel] = pen;
      this.compression[wheel] = compression;
      contacts += 1;
      const pv = pointVelocity(this.vx, this.vy, this.omega, rx, ry);
      const vn = pv.x * nx + pv.y * ny;
      const vt = pv.x * tx + pv.y * ty;
      spinTarget += vt / WHEEL_R / 2;
      const normal = Math.min(FN_MAX, Math.max(0, SPRING * compression + BUMP * (pen - compression) - DAMPER * vn));
      let tangent = -ROLLING * vt;
      if (throttle) tangent += DRIVE * Math.max(0, 1 - (Math.max(0, vt) / DRIVE_SPEED) ** 3);
      if (brake) tangent += vt > 1.5 ? -BRAKE : -DRIVE * 0.5 * Math.max(0, 1 + vt / 14);
      const limit = MU * normal;
      tangent = Math.max(-limit, Math.min(limit, tangent));
      const wfx = normal * nx + tangent * tx, wfy = normal * ny + tangent * ty;
      fx += wfx; fy += wfy;
      torque += rx * wfy - ry * wfx;
    }
    // Hull, roof and head: stiff, grippy bumpers with no drive.
    let hull = false, vital = false;
    for (const part of [...HULL, ROOF, HEAD]) {
      const rx = part.x * c - part.y * s, ry = part.x * s + part.y * c;
      const wx = this.x + rx, wy = this.y + ry;
      const {nx, ny, tx, ty, norm} = this.normalAt(wx);
      const pen = part.r - (this.terrain.height(wx) - wy) / norm;
      if (pen <= 0) continue;
      hull = true;
      if (part === ROOF || part === HEAD) vital ||= pen > 0.05;
      const pv = pointVelocity(this.vx, this.vy, this.omega, rx, ry);
      const vn = pv.x * nx + pv.y * ny;
      const vt = pv.x * tx + pv.y * ty;
      const normal = Math.min(FN_MAX, Math.max(0, 260 * Math.min(pen, 2.5) - 10 * vn));
      const tangent = Math.max(-0.7 * normal, Math.min(0.7 * normal, -3 * vt));
      const wfx = normal * nx + tangent * tx, wfy = normal * ny + tangent * ty;
      fx += wfx; fy += wfy;
      torque += rx * wfy - ry * wfx;
      if (pen > 2.5) { const lift = pen - 2.5; this.x += nx * lift; this.y += ny * lift; }
    }
    this.hullDown = hull;
    this.vx += (fx / MASS) * dt;
    this.vy += (fy / MASS) * dt;
    this.omega += (torque / INERTIA) * dt;
    const drag = 1 - 0.08 * dt;
    this.vx *= drag; this.vy *= drag;
    this.omega *= 1 - (contacts > 0 || hull ? GROUND_DAMPING : AIR_DAMPING) * dt;
    capSpeed(this, SPEED_CAP);
    this.omega = Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, this.omega));
    this.x += this.vx * dt; this.y += this.vy * dt; this.angle += this.omega * dt;
    if (this.x < -6) { this.x = -6; this.vx = Math.max(0, this.vx); }
    this.furthest = Math.max(this.furthest, this.x);
    this.spin += (contacts > 0 ? spinTarget / contacts : throttle ? 14 : 3) * dt;

    // Take-off and landing.
    if (contacts === 0 && !hull) {
      this.airborne = true;
    } else if (this.airborne) {
      this.airborne = false;
      const landing = Math.abs(this.vy);
      if (landing > 12) this.events.push({kind: 'land', x: this.x, y: this.y, speed: landing});
    }
    // Flips: each full net turn of the simulated angle counts once; a settled rover forgets a partial turn.
    const turned = this.angle - this.flipBase;
    if (Math.abs(turned) >= TAU - 0.5) {
      const sign = Math.sign(turned);
      this.flipBase += sign * TAU;
      this.flips += 1;
      this.events.push({kind: 'flip', count: 1});
    }
    this.settledMs = contacts === 2 ? this.settledMs + dt * 1000 : 0;
    if (this.settledMs > 400 && Math.abs(this.angle - this.flipBase) < 1.5) this.flipBase = this.angle;

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

    // Crash window: head or roof on the ground, or stuck upside down on something. Righting the rover heals it.
    if (vital || (this.upsideDown && (contacts > 0 || hull))) this.crashMs += dt * 1000;
    else this.crashMs = Math.max(0, this.crashMs - dt * 2000);
    if (this.crashMs >= CRASH_MS) { this.finish('flip'); return; }
    // Out of fuel and stalled, or stranded without moving.
    if (this.fuel <= 0 && this.speed < 1.2) {
      this.stallMs += dt * 1000;
      if (this.stallMs > 1500) { this.finish('fuel'); return; }
    } else this.stallMs = 0;
    this.strandedMs = this.speed < 0.6 && Math.abs(this.omega) < 0.3 ? this.strandedMs + dt * 1000 : 0;
    if (this.strandedMs > STRANDED_MS) this.finish('stuck');
  }

  private finish(reason: 'flip' | 'fuel' | 'stuck'): void {
    this.over = true;
    this.reason = reason;
    this.events.push({kind: 'crash', x: this.x, y: this.y, reason});
  }
}
