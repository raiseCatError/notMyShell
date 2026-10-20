import type {Rng} from '../../rng.js';
import {
  AERIAL_LIFT, AIR_STEPS, CAT_W, DT, DUCK_LEAD_STEPS, DUCK_REACT_STEPS, HB_X, REACT_STEPS, SAFE_STEPS, SLACK_STEPS,
  difficultyAt, jumpWindow, speedAt, windowSize,
} from './physics.js';

/**
 * The endless course: obstacles placed along the world from a seeded stream, each one only where a player who reacts in
 * `REACT_STEPS` can still get past it. Positions are world pixels; the cat's sprite left edge sits at `distance`.
 *
 * Fairness is not a heuristic: `slot()` computes, from the real jump profile, the earliest and latest moment an action can
 * start for an obstacle and the earliest moment the next action can begin (landing plus reaction), and the generator moves
 * each obstacle right until that schedule leaves `SAFE_STEPS` of slack. `verifySchedule()` re-derives the same schedule
 * from the final positions, so tests prove every consecutive pair rather than trusting the generator's bookkeeping.
 */
export type ObstacleKind = 'crates' | 'crate' | 'yarn' | 'stones' | 'cans' | 'bird' | 'plane';
export interface KindSpec { w: number; h: number; air: boolean }

export const KINDS: Readonly<Record<ObstacleKind, KindSpec>> = {
  crates: {w: 6, h: 6, air: false}, crate: {w: 6, h: 3, air: false}, yarn: {w: 5, h: 5, air: false},
  stones: {w: 8, h: 3, air: false}, cans: {w: 4, h: 5, air: false},
  bird: {w: 10, h: 4, air: true}, plane: {w: 8, h: 3, air: true},
};
export const GROUND_KINDS: readonly ObstacleKind[] = ['crates', 'crate', 'yarn', 'stones', 'cans'];
export const AIR_KINDS: readonly ObstacleKind[] = ['bird', 'plane'];

export interface Obstacle {
  id: number; kind: ObstacleKind;
  /** Left edge in world pixels. */
  x: number; w: number; h: number;
  /** Height of the underside above the ground (0 on the ground). */
  lift: number; air: boolean;
  /** Identical units side by side (a row of cans). */
  count: number;
}

export const clusterWidth = (kind: ObstacleKind, count: number): number => KINDS[kind].w * count + (count - 1);

/** The first obstacle's contact distance, the closest two may sit, and the extra margin the generator always adds. */
export const START_PX = 110;
export const MIN_GAP_PX = 14;
export const MARGIN_PX = 6;
/** Aerial obstacles never appear before this distance. */
export const AIR_FROM_PX = 600;
export const MAX_CLUSTER = 3;

export interface Slot {
  earliest: number; latest: number; start: number;
  /** Distance at which the player can next act, and the reaction (steps) it needs after that. */
  free: number; react: number;
  /** Steps of timing slack left when the player acts as early as the schedule allows. Negative: unreachable. */
  slack: number;
}

/**
 * Where an obstacle whose contact begins at cat distance `contact` falls in the schedule. `per` is pixels travelled per step. A ground obstacle asks for a jump (the whole airtime is then busy); an aerial one for a duck
 * held until it has passed, which a jump can leave at once after `DUCK_REACT_STEPS`.
 */
export function slot(o: {air: boolean; w: number; h: number}, contact: number, per: number, free: number, react: number): Slot | undefined {
  if (o.air) {
    const earliest = contact - DUCK_LEAD_STEPS * per;
    const start = Math.max(earliest, free + react * per);
    return {earliest, latest: contact, start, free: Math.max(free, contact + o.w + CAT_W), react: DUCK_REACT_STEPS, slack: (contact - start) / per};
  }
  const window = jumpWindow(o.w, o.h, per / DT);
  if (!window) return undefined;
  const earliest = contact + window.kmin * per;
  const latest = contact + window.kmax * per;
  const start = Math.max(earliest, free + react * per);
  // The next obstacle is judged against the LATEST start the player may take (SAFE_STEPS inside the window's end), not
  // the earliest: so every player who acts anywhere inside the window, not only the sharpest, can still meet the next one.
  return {earliest, latest, start, free: Math.max(start, latest - SAFE_STEPS * per) + AIR_STEPS * per, react: REACT_STEPS, slack: (latest - start) / per};
}

/** Contact distance for an obstacle at world x (the cat's hitbox right edge reaches its left edge). */
export const contactOf = (o: {x: number}): number => o.x - HB_X - CAT_W;

/**
 * The minimum safe gap (pixels between the first obstacle's right edge and the second's left edge) at `speed`: the closest
 * the second can sit when the player takes the first as early as possible and then still has `SAFE_STEPS` of slack.
 * Undefined when either obstacle cannot be cleared at that speed.
 */
export function minSafeGap(a: {air: boolean; w: number; h: number}, b: {air: boolean; w: number; h: number}, speed: number): number | undefined {
  const per = speed * DT;
  const first = slot(a, 0, per, -Infinity, 0);
  if (!first || first.slack < SAFE_STEPS) return undefined;
  for (let gap = 0; gap < 2000; gap += 0.25) {
    const second = slot(b, a.w + gap, per, first.free, first.react);
    if (!second) return undefined;
    if (second.slack >= SAFE_STEPS) return gap;
  }
  return undefined;
}

export interface Verdict { ok: boolean; worstSlack: number; failedAt: number }

/** Replay a generated course against the schedule at the speeds the cat has when it arrives. */
export function verifySchedule(obstacles: readonly Obstacle[]): Verdict {
  let free = 0;
  let react = 0;
  let worst = Infinity;
  for (const [index, o] of obstacles.entries()) {
    const contact = contactOf(o);
    let next: Slot | undefined;
    let slack = Infinity;
    for (const ahead of [0, 60]) {
      const probe = slot(o, contact, speedAt(contact + ahead) * DT, free, react);
      if (!probe) return {ok: false, worstSlack: -Infinity, failedAt: index};
      slack = Math.min(slack, probe.slack);
      next = probe;
    }
    worst = Math.min(worst, slack);
    if (slack < SAFE_STEPS) return {ok: false, worstSlack: worst, failedAt: index};
    free = next!.free;
    react = next!.react;
  }
  return {ok: true, worstSlack: worst, failedAt: -1};
}

export class Course {
  readonly obstacles: Obstacle[] = [];
  private free = 0;
  private react = 0;
  private cursor = 0;
  private lastRight = -Infinity;
  private nextId = 1;
  /** World x up to which the course has been generated. */
  frontier = 0;

  constructor(private readonly rng: Rng) {}

  ensure(untilX: number): void { while (this.frontier < untilX) this.emit(); }
  /** Forget obstacles wholly behind `x`. */
  prune(x: number): void { while (this.obstacles.length && this.obstacles[0]!.x + this.obstacles[0]!.w < x) this.obstacles.shift(); }

  private emit(): void {
    const rng = this.rng;
    const base = Math.max(this.free, this.cursor);
    const diff = difficultyAt(base);
    // A fixed number of draws per obstacle, whatever gets reduced below, so the stream never depends on feasibility.
    const [airRoll, kindRoll, twoRoll, threeRoll, gapRoll] = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];
    const air = base > AIR_FROM_PX && airRoll < 0.12 + 0.26 * diff;
    const kind = (air ? AIR_KINDS : GROUND_KINDS)[Math.floor(kindRoll * (air ? AIR_KINDS : GROUND_KINDS).length)]!;
    const spec = KINDS[kind];
    // Feasibility is judged at both ends of the speeds this obstacle could meet (wide ones are hardest when slow).
    const speeds = [speedAt(base), speedAt(base + 400)];
    let count = air ? 1 : 1 + (twoRoll < 0.15 + 0.45 * diff ? 1 : 0) + (threeRoll < diff * 0.3 ? 1 : 0);
    while (count > 1 && speeds.some(speed => windowSize(jumpWindow(clusterWidth(kind, count), spec.h, speed)) < SLACK_STEPS)) count -= 1;
    const w = air ? spec.w : clusterWidth(kind, count);
    const lower = Math.max(START_PX, this.lastRight + MIN_GAP_PX - HB_X - CAT_W);
    // Closed-form first guess for the minimum safe contact, refined by the exact check below.
    const guess = speedAt(base + 60) * DT;
    const kmax = air ? 0 : jumpWindow(w, spec.h, guess / DT)?.kmax ?? 0;
    let contact = Math.max(lower, this.free + (this.react + SAFE_STEPS - kmax) * guess - 4) + MARGIN_PX;
    const spread = 150 - 110 * diff;
    contact += gapRoll * spread;
    const shape = {air, w, h: spec.h};
    // Move right until the schedule leaves the required slack: the minimum safe gap, found, not guessed.
    for (let guard = 0; guard < 4000; guard += 1) {
      const probe = slot(shape, contact, speedAt(contact + 60) * DT, this.free, this.react);
      const near = slot(shape, contact, speedAt(contact) * DT, this.free, this.react);
      if (probe && near && Math.min(probe.slack, near.slack) >= SAFE_STEPS && contact >= lower) break;
      contact += 1;
    }
    const final = slot(shape, contact, speedAt(contact + 60) * DT, this.free, this.react)!;
    const x = contact + HB_X + CAT_W;
    this.obstacles.push({id: this.nextId, kind, x, w, h: spec.h, lift: air ? AERIAL_LIFT : 0, air, count});
    this.nextId += 1;
    this.free = final.free;
    this.react = final.react;
    this.cursor = contact;
    this.lastRight = x + w;
    this.frontier = x + w;
  }
}
