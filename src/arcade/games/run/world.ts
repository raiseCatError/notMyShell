import {hashSeed, type Rng} from '../../rng.js';
import {Course, type Obstacle} from './course.js';
import {airStep, CAT_W, DT, DUCK_H, DUCK_STEPS, HB_X, JUMP_BUFFER_STEPS, JUMP_V, speedAt, STAND_H} from './physics.js';

/** Distance (px) per score point and per meter. Score is distance: 2 points per meter. */
export const SCORE_PX = 5;
export const METER_PX = 10;
/** The course is always generated at least this far ahead of the cat. */
export const LOOKAHEAD_PX = 420;

export interface StepOutcome {
  /** Steps spent in the air if the cat touched down on this step, otherwise 0. */
  landedAfter: number;
  /** The obstacle the cat ran into on this step. */
  hit: Obstacle | undefined;
}

/** Cat hitbox against one obstacle. Touching edges is clear; only a real overlap is a hit. */
export function overlaps(left: number, feet: number, tall: number, o: Pick<Obstacle, 'x' | 'w' | 'h' | 'lift'>): boolean {
  return left + CAT_W > o.x && left < o.x + o.w && feet < o.lift + o.h && feet + tall > o.lift;
}

/**
 * The simulation: a cat running along an endless course. One `step()` is exactly 1/60 s and the only thing that moves
 * anything, so the same seed and the same inputs on the same steps give the same run at any frame rate.
 */
export class RunWorld {
  readonly course: Course;
  distance = 0;
  prevDistance = 0;
  y = 0;
  prevY = 0;
  vy = 0;
  airborne = false;
  fast = false;
  duckLeft = 0;
  alive = true;
  steps = 0;
  private buffer = 0;
  private airSteps = 0;

  constructor(rng: Rng) {
    this.course = new Course(rng);
    this.course.ensure(LOOKAHEAD_PX);
  }

  get speed(): number { return speedAt(this.distance); }
  get ducking(): boolean { return !this.airborne && this.duckLeft > 0; }
  get tall(): number { return this.ducking ? DUCK_H : STAND_H; }
  get score(): number { return Math.floor(this.distance / SCORE_PX); }
  get meters(): number { return Math.floor(this.distance / METER_PX); }

  /** Jump if on the ground; in the air, remember the press briefly so a jump lands exactly on touchdown. */
  jump(): boolean {
    if (!this.alive) return false;
    if (this.airborne) { this.buffer = JUMP_BUFFER_STEPS; return false; }
    this.takeoff();
    return true;
  }

  /** On the ground: duck for `DUCK_STEPS` (each press restarts it). In the air: fast fall, a short hop, then duck on landing. */
  duck(): void {
    if (!this.alive) return;
    if (this.airborne) this.fast = true;
    this.duckLeft = DUCK_STEPS;
  }

  private takeoff(): void {
    this.airborne = true;
    this.fast = false;
    this.vy = JUMP_V;
    this.duckLeft = 0;
    this.airSteps = 0;
  }

  step(): StepOutcome {
    const outcome: StepOutcome = {landedAfter: 0, hit: undefined};
    if (!this.alive) return outcome;
    this.steps += 1;
    this.prevDistance = this.distance;
    this.prevY = this.y;
    this.distance += speedAt(this.distance) * DT;
    if (this.duckLeft > 0) this.duckLeft -= 1;
    if (this.buffer > 0) this.buffer -= 1;
    if (this.airborne) {
      this.airSteps += 1;
      if (airStep(this, this.fast)) {
        this.airborne = false;
        this.fast = false;
        outcome.landedAfter = this.airSteps;
        if (this.buffer > 0) { this.buffer = 0; this.takeoff(); }
      }
    }
    this.course.ensure(this.distance + LOOKAHEAD_PX);
    this.course.prune(this.distance - 40);
    const left = this.distance + HB_X;
    const tall = this.tall;
    for (const o of this.course.obstacles) {
      if (o.x > left + CAT_W) break;
      if (overlaps(left, this.y, tall, o)) { outcome.hit = o; this.alive = false; break; }
    }
    return outcome;
  }

  /** A hash of everything that decides the future, for determinism tests. */
  hash(): number {
    const parts = [this.distance, this.y, this.vy, this.duckLeft, this.buffer, this.steps, this.course.obstacles.length, this.course.obstacles[0]?.x ?? 0, this.alive ? 1 : 0, this.fast ? 1 : 0];
    return hashSeed(parts.map(part => part.toFixed(6)).join('|'));
  }
}
