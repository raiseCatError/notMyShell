import type {Rng} from '../../rng.js';

/**
 * Yarn Drop: the rules and the circle physics, with no drawing. The jar is JAR_W x JAR_H logical units; balls are
 * circles of nine sizes. Physics runs on a fixed 60 Hz tick (two substeps, six solver passes), accumulated in whole
 * microseconds, so any split of the same total time gives bit-identical results. Equal touching balls fuse into the
 * next size; two of the largest burst for a bonus. The body count is bounded: a full jar ends the game.
 */
export const JAR_W = 60;
export const JAR_H = 84;
/** The danger line: a settled ball poking above it for DANGER_MS ends the run. */
export const LINE_Y = 17;
export const SPAWN_Y = 7;
export const RADII = [2.4, 3.2, 4.1, 5.1, 6.3, 7.7, 9.3, 11.2, 13.4] as const;
export const TIERS = RADII.length;
/** Points for creating a ball of each size by fusion. */
export const FUSE_SCORE = [0, 2, 5, 9, 14, 20, 28, 38, 50] as const;
export const BURST_SCORE = 150;
export const MAX_BODIES = 140;
export const DROP_TIERS = 4;
export const DROP_COOLDOWN_MS = 480;
export const DANGER_MS = 2600;
const SETTLE_MS = 1100;
const GRAVITY = 260;
const SUBSTEPS = 2;
const PASSES = 6;
const TICK_US = 16_667;
const AIM_STEP = 3;

export interface Body {
  id: number;
  tier: number;
  x: number; y: number; vx: number; vy: number;
  /** Milliseconds since it was dropped or created by a fusion. */
  age: number;
}

export type YarnEvent =
  | {kind: 'fuse'; x: number; y: number; tier: number}
  | {kind: 'burst'; x: number; y: number}
  | {kind: 'drop'; x: number}
  | {kind: 'full'};

export class YarnState {
  bodies: Body[] = [];
  score = 0;
  fusions = 0;
  bestTier = 0;
  over = false;
  aimX = JAR_W / 2;
  current: number;
  next: number;
  cooldownMs = 0;
  dangerMs = 0;
  events: YarnEvent[] = [];
  private nextId = 1;
  private accumulator = 0;

  constructor(private readonly rng: Rng) {
    this.current = this.rng.int(0, DROP_TIERS - 1);
    this.next = this.rng.int(0, DROP_TIERS - 1);
  }

  get ready(): boolean { return !this.over && this.cooldownMs <= 0; }

  move(direction: -1 | 1): void { this.aimTo(this.aimX + direction * AIM_STEP); }
  aimTo(x: number): void {
    const r = RADII[this.current]!;
    this.aimX = Math.min(JAR_W - r - 0.5, Math.max(r + 0.5, x));
  }

  /** Release the held ball. Returns whether one was dropped. */
  drop(): boolean {
    if (!this.ready) return false;
    if (this.bodies.length >= MAX_BODIES) { this.over = true; this.events.push({kind: 'full'}); return false; }
    this.aimTo(this.aimX);
    this.bodies.push({id: this.nextId++, tier: this.current, x: this.aimX, y: SPAWN_Y, vx: 0, vy: 0, age: 0});
    this.events.push({kind: 'drop', x: this.aimX});
    this.current = this.next;
    this.next = this.rng.int(0, DROP_TIERS - 1);
    this.cooldownMs = DROP_COOLDOWN_MS;
    this.aimTo(this.aimX);
    return true;
  }

  /** Advance by `dtMs` of game time in whole fixed ticks; any split of the same total gives the same result. */
  step(dtMs: number): void {
    if (this.over) return;
    this.accumulator += Math.max(0, Math.round(dtMs * 1000));
    while (this.accumulator >= TICK_US && !this.over) {
      this.accumulator -= TICK_US;
      this.tick();
    }
  }

  private tick(): void {
    const ms = TICK_US / 1000;
    this.cooldownMs = Math.max(0, this.cooldownMs - ms);
    for (const body of this.bodies) body.age += ms;
    for (let sub = 0; sub < SUBSTEPS; sub += 1) this.substep(1 / (60 * SUBSTEPS));
    this.fuse();
    this.watchLine(ms);
  }

  private substep(h: number): void {
    const bodies = this.bodies;
    const touched = new Set<number>();
    for (const b of bodies) {
      b.vy += GRAVITY * h;
      b.vx *= 0.9995;
      b.x += b.vx * h;
      b.y += b.vy * h;
    }
    for (let pass = 0; pass < PASSES; pass += 1) {
      for (const b of bodies) this.walls(b, touched);
      for (let i = 0; i < bodies.length; i += 1) {
        const a = bodies[i]!;
        const ra = RADII[a.tier]!;
        for (let j = i + 1; j < bodies.length; j += 1) {
          const c = bodies[j]!;
          const reach = ra + RADII[c.tier]!;
          let dx = c.x - a.x;
          if (dx > reach || dx < -reach) continue;
          let dy = c.y - a.y;
          if (dy > reach || dy < -reach) continue;
          let d2 = dx * dx + dy * dy;
          if (d2 >= reach * reach) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-6) { dx = 0; dy = 1; d = 1e-6; } else { dx /= d; dy /= d; }
          const ma = ra * ra;
          const mc = RADII[c.tier]! * RADII[c.tier]!;
          const push = reach - d;
          a.x -= dx * push * (mc / (ma + mc)); a.y -= dy * push * (mc / (ma + mc));
          c.x += dx * push * (ma / (ma + mc)); c.y += dy * push * (ma / (ma + mc));
          const vn = (c.vx - a.vx) * dx + (c.vy - a.vy) * dy;
          if (vn < 0) {
            const e = -vn > 30 ? 0.12 : 0;
            const j2 = (-(1 + e) * vn) / (1 / ma + 1 / mc);
            a.vx -= (j2 * dx) / ma; a.vy -= (j2 * dy) / ma;
            c.vx += (j2 * dx) / mc; c.vy += (j2 * dy) / mc;
          }
          // Friction: take a share of the sliding speed so balls stop rolling off one another.
          const tx = -dy, ty = dx;
          const vt = (c.vx - a.vx) * tx + (c.vy - a.vy) * ty;
          const f = vt * 0.04;
          a.vx += (f * tx * mc) / (ma + mc); a.vy += (f * ty * mc) / (ma + mc);
          c.vx -= (f * tx * ma) / (ma + mc); c.vy -= (f * ty * ma) / (ma + mc);
          touched.add(a.id); touched.add(c.id);
        }
      }
    }
    // Resting contacts settle: a touching ball moving slower than gravity's pull per substep stays put.
    for (const b of bodies) if (touched.has(b.id) && b.vx * b.vx + b.vy * b.vy < 0.5) { b.vx = 0; b.vy = 0; }
  }

  private walls(b: Body, touched: Set<number>): void {
    const r = RADII[b.tier]!;
    if (b.x < r) { b.x = r; if (b.vx < 0) b.vx = 0; touched.add(b.id); }
    else if (b.x > JAR_W - r) { b.x = JAR_W - r; if (b.vx > 0) b.vx = 0; touched.add(b.id); }
    if (b.y > JAR_H - r) { b.y = JAR_H - r; if (b.vy > 0) b.vy = b.vy > 40 ? -b.vy * 0.1 : 0; b.vx *= 0.97; touched.add(b.id); }
  }

  /** Equal touching balls fuse, lowest ids first, each ball at most once per tick. */
  private fuse(): void {
    const bodies = this.bodies;
    const gone = new Set<number>();
    const made: Body[] = [];
    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i]!;
      if (gone.has(a.id)) continue;
      for (let j = i + 1; j < bodies.length; j += 1) {
        const c = bodies[j]!;
        if (gone.has(c.id) || c.tier !== a.tier) continue;
        const reach = RADII[a.tier]! * 2 + 0.5;
        if ((c.x - a.x) ** 2 + (c.y - a.y) ** 2 > reach * reach) continue;
        gone.add(a.id); gone.add(c.id);
        const x = (a.x + c.x) / 2, y = (a.y + c.y) / 2;
        if (a.tier === TIERS - 1) {
          this.score += BURST_SCORE;
          this.events.push({kind: 'burst', x, y});
        } else {
          const tier = a.tier + 1;
          this.score += FUSE_SCORE[tier]!;
          this.fusions += 1;
          this.bestTier = Math.max(this.bestTier, tier);
          made.push({id: this.nextId++, tier, x, y, vx: (a.vx + c.vx) / 2, vy: (a.vy + c.vy) / 2, age: 0});
          this.events.push({kind: 'fuse', x, y, tier});
        }
        break;
      }
    }
    if (gone.size) this.bodies = bodies.filter(b => !gone.has(b.id)).concat(made);
  }

  private watchLine(ms: number): void {
    const poking = this.bodies.some(b => b.age > SETTLE_MS && b.y - RADII[b.tier]! < LINE_Y);
    this.dangerMs = poking ? this.dangerMs + ms : Math.max(0, this.dangerMs - ms * 2);
    if (this.dangerMs >= DANGER_MS) this.over = true;
  }

  /** The deepest overlap between any two balls, or a ball and the jar (for tests). */
  maxOverlap(): number {
    let worst = 0;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i += 1) {
      const a = bodies[i]!;
      const r = RADII[a.tier]!;
      worst = Math.max(worst, r - a.x, a.x - (JAR_W - r), a.y - (JAR_H - r));
      for (let j = i + 1; j < bodies.length; j += 1) {
        const c = bodies[j]!;
        worst = Math.max(worst, r + RADII[c.tier]! - Math.hypot(c.x - a.x, c.y - a.y));
      }
    }
    return worst;
  }

  maxSpeed(): number { return this.bodies.reduce((m, b) => Math.max(m, Math.hypot(b.vx, b.vy)), 0); }
}
