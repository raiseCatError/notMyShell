import {hashSeed, type Rng} from '../../rng.js';
import {Course, type CourseLike, type CourseOptions} from './course.js';
import {HB_X, JUMP_BUFFER_STEPS, newBody, speedAt, stepBody, stepPx, takeoff, type Body, type Fate} from './physics.js';

/** Distance (px) per score point and per meter; every unit cleared is worth `CLEAR_POINTS` more. */
export const SCORE_PX = 5;
export const METER_PX = 10;
export const CLEAR_POINTS = 10;
/** A new color phase every this many meters. */
export const PHASE_METERS = 80;
export const PHASE_PX = PHASE_METERS * METER_PX;
/** One beat of the visual metronome every this many px of distance. */
export const BEAT_PX = 48;
/** The course is always generated at least this far ahead of the cat. */
export const LOOKAHEAD_PX = 480;

export interface StepOutcome {
  /** The cat took off this step (a press, or a buffered press on touchdown). */
  tookOff: boolean;
  /** The cat touched down this step, after this many steps in the air; the piece it stands on (-1: the ground). */
  landedAfter: number;
  support: number;
  /** What ended the run on this step, if anything. */
  fate: Fate;
}

/**
 * The simulation: a cat scrolling along an endless course. One `step()` is exactly 1/60 s and the only thing that moves
 * anything, so the same seed and the same presses on the same steps give the same run at any frame rate.
 */
export class DashWorld {
  readonly course: CourseLike;
  readonly body: Body = newBody();
  distance: number;
  prevDistance: number;
  prevY = 0;
  alive = true;
  fate: Fate = 'alive';
  steps = 0;
  cleared = 0;
  private buffer = 0;
  private airSteps = 0;

  /** `options.course` substitutes a prepared course (tests replay one course against several players). */
  constructor(rng: Rng, options: CourseOptions & {course?: CourseLike} = {}) {
    this.distance = options.from ?? 0;
    this.prevDistance = this.distance;
    this.course = options.course ?? new Course(rng, options);
    this.course.ensure(this.distance + LOOKAHEAD_PX);
  }

  get speed(): number { return speedAt(this.distance); }
  get y(): number { return this.body.y; }
  get airborne(): boolean { return !this.body.grounded; }
  get score(): number { return Math.floor(this.distance / SCORE_PX) + this.cleared * CLEAR_POINTS; }
  get meters(): number { return Math.floor(this.distance / METER_PX); }
  get phase(): number { return Math.floor(this.distance / PHASE_PX); }
  /** 0..1 within the current beat. */
  get beat(): number { return (this.distance / BEAT_PX) % 1; }

  /** Jump if standing; in the air, remember the press briefly so a jump happens exactly on touchdown. */
  jump(): boolean {
    if (!this.alive) return false;
    if (this.airborne) { this.buffer = JUMP_BUFFER_STEPS; return false; }
    this.launch();
    return true;
  }

  private launch(): void {
    takeoff(this.body);
    this.airSteps = 0;
  }

  step(): StepOutcome {
    const outcome: StepOutcome = {tookOff: false, landedAfter: 0, support: -1, fate: 'alive'};
    if (!this.alive) return outcome;
    this.steps += 1;
    this.prevDistance = this.distance;
    this.prevY = this.body.y;
    if (this.buffer > 0) this.buffer -= 1;
    this.distance += stepPx(this.distance);
    if (this.airborne) this.airSteps += 1;
    const fate = stepBody(this.body, this.distance + HB_X, this.course.pieces);
    if (this.body.landed) {
      outcome.landedAfter = this.airSteps;
      outcome.support = this.body.support;
      if (this.buffer > 0) { this.buffer = 0; this.launch(); outcome.tookOff = true; }
    }
    this.course.ensure(this.distance + LOOKAHEAD_PX);
    this.course.prune(this.distance - 40);
    for (const unit of this.course.units) {
      if (unit.end >= this.distance + HB_X) break;
      if (unit.id > this.cleared) this.cleared = unit.id;
    }
    if (fate !== 'alive') { this.alive = false; this.fate = fate; outcome.fate = fate; }
    return outcome;
  }

  /** A hash of everything that decides the future, for determinism tests. */
  hash(): number {
    const { body } = this;
    const parts = [this.distance, body.y, body.vy, body.grounded ? 1 : 0, this.buffer, this.steps, this.cleared, this.course.pieces.length, this.course.pieces[0]?.x ?? 0, this.alive ? 1 : 0];
    return hashSeed(parts.map(part => part.toFixed(6)).join('|'));
  }
}
