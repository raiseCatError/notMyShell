/**
 * Small rigid-body helpers for the arcade's physics games (Rover, Pinball, Catapult Cats): a fixed-substep accumulator
 * so a game's physics is identical however its steps are split, and speed limiting. Plain numbers, no clock, no
 * randomness.
 */
import type {Vec} from './collide.js';

/**
 * Splits any `step(dtMs)` into whole substeps of `subMs`, carrying the remainder, so one 100 ms step and six 16.7 ms
 * steps run the same number of identical substeps.
 */
export class Substepper {
  private carry = 0;
  constructor(readonly subMs: number, private readonly maxSubsteps = 64) {}
  run(dtMs: number, substep: (dtSeconds: number) => void): void {
    this.carry += Math.max(0, dtMs);
    let count = 0;
    // A hair of tolerance so 1000 ms is exactly the same count however it was sliced.
    while (this.carry + 1e-6 >= this.subMs && count < this.maxSubsteps) {
      substep(this.subMs / 1000);
      this.carry = Math.max(0, this.carry - this.subMs);
      count += 1;
    }
    if (count >= this.maxSubsteps) this.carry = 0;
  }
  reset(): void { this.carry = 0; }
}

/** Limit a velocity's length to `max`, in place, and return it. */
export function capSpeed<T extends {vx: number; vy: number}>(body: T, max: number): T {
  const speed = Math.hypot(body.vx, body.vy);
  if (speed > max) { const k = max / speed; body.vx *= k; body.vy *= k; }
  return body;
}

/** Velocity of the point at offset (rx, ry) from a body's center, given its linear velocity and angular velocity (y down). */
export function pointVelocity(vx: number, vy: number, omega: number, rx: number, ry: number): Vec {
  return {x: vx - omega * ry, y: vy + omega * rx};
}
