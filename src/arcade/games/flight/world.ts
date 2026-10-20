import type {Rng} from '../../rng.js';
import {Course, type Obstacle} from './course.js';
import {CAT_H, CAT_W, DT, FLAP_COOLDOWN, FLAP_V, motion, OB_W, speedAt} from './physics.js';

export type HitKind = 'pipe' | 'ceiling' | 'ground';

export interface StepOutcome {
  hit: HitKind | undefined;
  /** The obstacle passed this step, if any. */
  scored: Obstacle | undefined;
}

/** How far ahead of the cat the course is generated (world px), a constant so the course never depends on the canvas. */
const LOOKAHEAD = 420;
/** The cat's hitbox starts here in world x. */
export const START_X = 0;

/**
 * The simulation: a cat in a world `height` pixels tall, moving right at the difficulty's speed. `x` is the hitbox's left
 * edge; `y` its top. Touching an edge is clear; only a real overlap, or crossing the ceiling or the ground, is a hit.
 */
export class FlightWorld {
  readonly course: Course;
  x: number;
  y: number;
  vy = 0;
  prevX: number;
  prevY: number;
  steps = 0;
  score = 0;
  alive = true;
  hitKind: HitKind | undefined;
  cooldown = 0;
  /** Steps since the last accepted flap (visual wing cycle). */
  sinceFlap = 999;

  /** `start` moves the cat down the road (tests use it to meet the hardest speed and gap at once). */
  constructor(rng: Rng, readonly height: number, start = START_X) {
    this.x = start;
    this.prevX = start;
    this.course = new Course(rng, height, start);
    this.y = this.course.startY();
    this.prevY = this.y;
    this.course.ensure(start + LOOKAHEAD);
  }

  get speed(): number { return speedAt(this.x); }

  /** Flap: the upward speed is set (an impulse, not a move). False while the previous wingbeat is finishing. */
  flap(): boolean {
    if (!this.alive || this.cooldown > 0) return false;
    this.vy = -FLAP_V;
    this.cooldown = FLAP_COOLDOWN;
    this.sinceFlap = 0;
    return true;
  }

  step(): StepOutcome {
    if (!this.alive) return {hit: undefined, scored: undefined};
    this.prevX = this.x;
    this.prevY = this.y;
    if (this.cooldown > 0) this.cooldown -= 1;
    this.sinceFlap += 1;
    const moved = motion(this.y, this.vy);
    this.y = moved.y;
    this.vy = moved.vy;
    this.x += speedAt(this.x) * DT;
    this.steps += 1;
    this.course.ensure(this.x + LOOKAHEAD);
    this.course.trim(this.x - 40);

    const hit = this.collision();
    if (hit) { this.alive = false; this.hitKind = hit; return {hit, scored: undefined}; }
    let scored: Obstacle | undefined;
    for (const obstacle of this.course.obstacles) {
      if (!obstacle.scored && this.x >= obstacle.x + OB_W) { obstacle.scored = true; this.score += 1; scored = obstacle; }
    }
    return {hit: undefined, scored};
  }

  /** What the cat overlaps right now, if anything. */
  collision(): HitKind | undefined {
    return hitTest(this.x, this.y, this.height, this.course.obstacles);
  }
}

/** The collision rules alone, so the boundaries can be tested exactly. Touching is clear. */
export function hitTest(x: number, y: number, height: number, obstacles: readonly Obstacle[]): HitKind | undefined {
  if (y < 0) return 'ceiling';
  if (y + CAT_H > height) return 'ground';
  for (const obstacle of obstacles) {
    if (x + CAT_W <= obstacle.x || x >= obstacle.x + OB_W) continue;
    if (y < obstacle.gapTop || y + CAT_H > obstacle.gapBottom) return 'pipe';
  }
  return undefined;
}

/** A compact fingerprint of the simulation state, for determinism checks. */
export function stateHash(world: FlightWorld): string {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    const text = value.toFixed(6);
    for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  };
  mix(world.x); mix(world.y); mix(world.vy); mix(world.score); mix(world.steps); mix(world.cooldown); mix(world.alive ? 1 : 0);
  for (const o of world.course.obstacles) { mix(o.id); mix(o.x); mix(o.gapTop); mix(o.gapBottom); mix(o.scored ? 1 : 0); }
  return hash.toString(16);
}
