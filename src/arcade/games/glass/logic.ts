import type {Rng} from '../../rng.js';

/**
 * Glass Rush's rules, in a 2D side view (x is distance in metres, y is height above the ground). The cat glides along
 * at a speed that grows with time; panes of glass stand across the way. Unbroken glass that reaches the cat costs
 * SMASH_COST spheres. The cat throws spheres along a ballistic arc: speed SPHERE_SPEED plus the glider's own speed,
 * gravity GRAVITY, launch angle `aim` (degrees, changed in AIM_STEP steps). A sphere that crosses a pane within its
 * height breaks it; crystals give spheres back. With no spheres left and none flying, the run is over.
 *
 * Pane kinds: `glass` breaks in one hit; `resonant` rings and breaks every pane within CHAIN_RANGE metres (and those
 * that are resonant carry the chain on); `tough` needs two hits. Moving panes bob up and down (timing matters). A
 * `canopy` hangs above the cat's head: it never blocks, but breaking it can start a chain.
 *
 * Fairness: panes come in groups separated by at least GROUP_GAP_S seconds of gliding; inside a group the first pane in
 * the way is the one a sphere meets first and the rest ride a chain, so one aim always works; a crystal follows at
 * least every second group and pays CRYSTAL_GAIN spheres. The tests play a perfect shooter that predicts the arc with
 * `shotOutcome` and check that it never runs dry.
 */
export const GRAVITY = 12;
export const SPHERE_SPEED = 30;
export const SPHERE_R = 0.25;
export const LAUNCH_Y = 1.3;
export const BODY_TOP = 1.9;
export const AIM_MIN = -4;
export const AIM_MAX = 50;
export const AIM_STEP = 2;
export const COOLDOWN_S = 0.22;
export const START_SPHERES = 20;
export const SMASH_COST = 4;
export const CRYSTAL_GAIN = 4;
export const CRYSTAL_R = 0.7;
export const CHAIN_RANGE = 6;
export const GROUP_GAP_S = 2.0;
export const LOOKAHEAD = 70;
export const START_SPEED = 7;
export const MAX_SPEED = 12;
export const RAMP = 0.05;

export type PaneKind = 'glass' | 'resonant' | 'tough' | 'canopy';
export interface Pane { id: number; x: number; base: number; height: number; kind: PaneKind; hp: number; broken: boolean; bob: {amp: number; freq: number; phase: number} | undefined }
export interface Crystal { id: number; x: number; y: number; taken: boolean }
export interface Sphere { x: number; y: number; vx: number; vy: number; age: number }
export type Target = {kind: 'pane'; pane: Pane} | {kind: 'crystal'; crystal: Crystal};
export type GlassEvent =
  | {kind: 'throw'}
  | {kind: 'break'; pane: Pane; chain: number}
  | {kind: 'crack'; pane: Pane}
  | {kind: 'chain'; size: number; x: number}
  | {kind: 'crystal'; crystal: Crystal}
  | {kind: 'smash'; pane: Pane}
  | {kind: 'miss'; x: number; y: number}
  | {kind: 'dry'}
  | {kind: 'milestone'; meters: number};

export const speedAt = (time: number): number => Math.min(MAX_SPEED, START_SPEED + RAMP * time);
const RAMP_END = (MAX_SPEED - START_SPEED) / RAMP;
export const distanceAt = (time: number): number => (time <= RAMP_END
  ? START_SPEED * time + 0.5 * RAMP * time * time
  : START_SPEED * RAMP_END + 0.5 * RAMP * RAMP_END * RAMP_END + MAX_SPEED * (time - RAMP_END));
export const timeAt = (distance: number): number => {
  const ramped = distanceAt(RAMP_END);
  return distance <= ramped ? (-START_SPEED + Math.sqrt(START_SPEED * START_SPEED + 2 * RAMP * distance)) / RAMP : RAMP_END + (distance - ramped) / MAX_SPEED;
};

/** A pane's lower and upper edge at `time`. */
export function paneSpan(pane: Pane, time: number): {low: number; high: number} {
  const offset = pane.bob ? pane.bob.amp * Math.sin(pane.bob.phase + pane.bob.freq * time) : 0;
  return {low: pane.base + offset, high: pane.base + offset + pane.height};
}
/** Whether the pane is in the cat's way at `time`. */
export const blocks = (pane: Pane, time: number): boolean => { const span = paneSpan(pane, time); return pane.kind !== 'canopy' && span.low < BODY_TOP && span.high > 0; };

export class GlassState {
  time = 0;
  spheres = START_SPHERES;
  aim = 8;
  alive = true;
  started = false;
  dry = false;
  panes: Pane[] = [];
  crystals: Crystal[] = [];
  flying: Sphere[] = [];
  events: GlassEvent[] = [];
  cooldown = 0;
  shattered = 0;
  bestChain = 0;
  bonus = 0;
  thrown = 0;
  private frontier = 26;
  private groups = 0;
  private sinceCrystal = 0;
  private nextId = 1;
  private milestone = 0;

  constructor(private readonly rng: Rng) { this.fill(); }

  get x(): number { return distanceAt(this.time); }
  get speed(): number { return speedAt(this.time); }
  get meters(): number { return Math.floor(this.x); }
  get score(): number { return this.meters + this.shattered * 5 + this.bonus; }

  private fill(): void { while (this.frontier < this.x + LOOKAHEAD) this.generate(); }

  private pane(x: number, base: number, height: number, kind: PaneKind, bob?: Pane['bob']): Pane {
    const pane: Pane = {id: this.nextId++, x, base, height, kind, hp: kind === 'tough' ? 2 : 1, broken: false, bob};
    this.panes.push(pane);
    return pane;
  }

  /** One group of panes (and maybe a crystal after it) starting at the frontier plus the gap. */
  private generate(): void {
    const rng = this.rng;
    const hard = Math.min(1, timeAt(this.frontier) / 100);
    const x = distanceAt(timeAt(this.frontier) + Math.max(GROUP_GAP_S, 2.3 - 0.4 * hard + rng.range(0, 0.5)));
    const gap = x - this.frontier;
    const roll = rng.next();
    let end = x;
    if (this.groups < 2 || roll < 0.3 - 0.1 * hard) {
      this.pane(x, 0, rng.range(2.6, 5.5), 'glass');
    } else if (roll < 0.5) {
      this.pane(x, 0, rng.range(2.6, 5), 'tough');
    } else if (roll < 0.72) {
      // A resonant pane first: breaking it rings the ones behind.
      this.pane(x, 0, rng.range(2.6, 4.5), 'resonant');
      const more = rng.int(1, 3);
      for (let index = 1; index <= more; index += 1) {
        end += rng.range(1.5, CHAIN_RANGE * 0.8);
        // Every pane but the last carries the chain on, so one sphere breaks the whole group.
        this.pane(end, 0, rng.range(2.6, 5), index < more || rng.chance(0.5) ? 'resonant' : 'glass');
      }
    } else if (roll < 0.9) {
      this.pane(x, rng.range(-1, 0.2), 2.4, 'glass', {amp: rng.range(0.7, 1.2), freq: rng.range(1.6, 2.6), phase: rng.range(0, Math.PI * 2)});
    } else {
      // A canopy over a low pane: the canopy is optional.
      this.pane(x, 0, rng.range(2.6, 3.2), 'resonant');
      end = x + rng.range(2, 4);
      this.pane(end, 2.4, rng.range(2, 3), 'canopy');
    }
    this.groups += 1;
    this.sinceCrystal += 1;
    this.frontier = end;
    if (this.sinceCrystal >= 2 || rng.chance(0.2)) {
      this.sinceCrystal = 0;
      this.crystals.push({id: this.nextId++, x: end + rng.range(0.4, 0.5) * Math.max(8, gap), y: rng.range(1.2, 4.2), taken: false});
      this.frontier = this.crystals[this.crystals.length - 1]!.x;
    }
  }

  nextTarget(): Pane | undefined { return this.panes.find(p => !p.broken && p.kind !== 'canopy' && p.x > this.x); }

  setAim(degrees: number): void { this.aim = Math.max(AIM_MIN, Math.min(AIM_MAX, degrees)); }
  tilt(direction: -1 | 1): void { this.started = true; this.setAim(this.aim + direction * AIM_STEP); }

  /** Throw a sphere at the current aim. */
  fire(): boolean {
    if (!this.alive) return false;
    this.started = true;
    if (this.cooldown > 0 || this.spheres <= 0) return false;
    this.flying.push(this.launch(this.aim));
    this.spheres -= 1;
    this.thrown += 1;
    this.cooldown = COOLDOWN_S;
    this.events.push({kind: 'throw'});
    return true;
  }

  private launch(degrees: number): Sphere {
    const angle = (degrees * Math.PI) / 180;
    return {x: this.x, y: LAUNCH_Y, vx: Math.cos(angle) * SPHERE_SPEED + this.speed, vy: Math.sin(angle) * SPHERE_SPEED, age: 0};
  }

  /** Advance a sphere one small step at world time `time`; the first thing it meets, if any, is returned. */
  private advance(sphere: Sphere, dt: number, time: number): Target | 'ground' | undefined {
    const fromX = sphere.x;
    sphere.vy -= GRAVITY * dt;
    sphere.x += sphere.vx * dt;
    sphere.y += sphere.vy * dt;
    sphere.age += dt;
    let best: {target: Target; x: number} | undefined;
    for (const pane of this.panes) {
      if (pane.broken || pane.x <= fromX || pane.x > sphere.x) continue;
      const along = (pane.x - fromX) / Math.max(1e-9, sphere.x - fromX);
      const y = sphere.y - sphere.vy * dt * (1 - along);
      const span = paneSpan(pane, time);
      if (y >= span.low - SPHERE_R && y <= span.high + SPHERE_R && (!best || pane.x < best.x)) best = {target: {kind: 'pane', pane}, x: pane.x};
    }
    for (const crystal of this.crystals) {
      if (crystal.taken) continue;
      if (Math.hypot(crystal.x - sphere.x, crystal.y - sphere.y) <= CRYSTAL_R + SPHERE_R && (!best || crystal.x < best.x)) best = {target: {kind: 'crystal', crystal}, x: crystal.x};
    }
    if (best) return best.target;
    return sphere.y <= 0 ? 'ground' : undefined;
  }

  /** What a sphere thrown right now at `degrees` meets first, predicted without changing anything. */
  shotOutcome(degrees: number): Target | undefined {
    const sphere = this.launch(degrees);
    // The same sub-step the live sphere uses, so the prediction and the throw agree.
    const dt = 1 / 240;
    // Nothing beyond the farthest pane or crystal can be hit.
    const limit = Math.max(...this.panes.filter(p => !p.broken).map(p => p.x), ...this.crystals.filter(c => !c.taken).map(c => c.x), this.x);
    for (let t = 0; t < 4; t += dt) {
      if (sphere.x > limit) return undefined;
      const hit = this.advance(sphere, dt, this.time + t + dt);
      if (hit === 'ground') return undefined;
      if (hit) return hit;
      if (sphere.x > this.x + 80) return undefined;
    }
    return undefined;
  }

  step(dtMs: number): void {
    if (!this.alive || !this.started) return;
    const dt = dtMs / 1000;
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    // Spheres fly in four sub-steps so a fast one cannot skip over glass.
    const sub = dt / 4;
    for (let s = 0; s < 4; s += 1) {
      for (let index = this.flying.length - 1; index >= 0; index -= 1) {
        const sphere = this.flying[index]!;
        const hit = this.advance(sphere, sub, this.time - dt + sub * (s + 1));
        if (!hit && sphere.x < this.x + 90) continue;
        this.flying.splice(index, 1);
        if (hit && hit !== 'ground') this.apply(hit);
        else this.events.push({kind: 'miss', x: sphere.x, y: Math.max(0, sphere.y)});
      }
    }
    const x = this.x;
    for (const pane of this.panes) {
      if (pane.broken || pane.x > x) continue;
      pane.broken = true;
      if (blocks(pane, this.time)) {
        this.spheres = Math.max(0, this.spheres - SMASH_COST);
        this.events.push({kind: 'smash', pane});
      }
    }
    if (this.spheres <= 0 && this.flying.length === 0 && !this.dry) { this.dry = true; this.alive = false; this.events.push({kind: 'dry'}); }
    this.fill();
    this.panes = this.panes.filter(p => p.x > x - 25);
    this.crystals = this.crystals.filter(c => c.x > x - 25 && !c.taken);
    const mark = Math.floor(x / 500);
    if (mark > this.milestone) { this.milestone = mark; this.events.push({kind: 'milestone', meters: mark * 500}); }
  }

  private apply(target: Target): void {
    if (target.kind === 'crystal') {
      target.crystal.taken = true;
      this.spheres += CRYSTAL_GAIN;
      this.events.push({kind: 'crystal', crystal: target.crystal});
      return;
    }
    const pane = target.pane;
    pane.hp -= 1;
    if (pane.hp > 0) { this.events.push({kind: 'crack', pane}); return; }
    // The hit pane breaks; resonant glass rings the panes near it, and those that are resonant carry it on.
    const queue: Pane[] = [pane];
    const broken: Pane[] = [];
    pane.broken = true;
    while (queue.length > 0) {
      const current = queue.shift()!;
      broken.push(current);
      if (current.kind !== 'resonant') continue;
      for (const other of this.panes) {
        if (other.broken || Math.abs(other.x - current.x) > CHAIN_RANGE) continue;
        other.broken = true;
        queue.push(other);
      }
    }
    this.shattered += broken.length;
    if (broken.length > 1) {
      this.bonus += 10 * (broken.length - 1) * (broken.length - 1);
      this.bestChain = Math.max(this.bestChain, broken.length);
      this.events.push({kind: 'chain', size: broken.length, x: pane.x});
    }
    broken.forEach((p, index) => this.events.push({kind: 'break', pane: p, chain: index}));
  }
}
