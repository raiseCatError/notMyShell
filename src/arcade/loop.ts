/**
 * Fixed-timestep simulation with independently scheduled rendering. The renderer calls `advance` with the real elapsed
 * time; the simulation runs in whole, equal steps, so physics is identical at 20 or 60 frames per second and a test with a
 * fake clock replays a run exactly. A long stall (a suspended laptop, a debugger) is clamped, never replayed as a burst.
 */
export const DEFAULT_STEP_MS = 1000 / 60;

export class FixedStep {
  private accumulator = 0;
  constructor(readonly stepMs: number = DEFAULT_STEP_MS, private readonly maxSteps = 6) {}

  /**
   * Run `step` for each whole step contained in `elapsedMs` (at most `maxSteps`); the remainder carries over.
   * Returns the interpolation amount in [0, 1) for drawing between the last two states.
   */
  advance(elapsedMs: number, step: (dtMs: number) => void): number {
    this.accumulator += Math.max(0, Math.min(elapsedMs, this.stepMs * this.maxSteps));
    let steps = 0;
    // A hair of tolerance so 100 ms is exactly six 60 Hz steps despite floating point.
    while (this.accumulator + 1e-6 >= this.stepMs && steps < this.maxSteps) {
      step(this.stepMs);
      this.accumulator = Math.max(0, this.accumulator - this.stepMs);
      steps += 1;
    }
    // A backlog beyond the cap is dropped rather than carried: time passed while the process was not running.
    if (steps >= this.maxSteps) this.accumulator = Math.min(this.accumulator, this.stepMs);
    return this.accumulator / this.stepMs;
  }

  reset(): void { this.accumulator = 0; }
}

/** Real elapsed time between frames from a monotonic clock, with the first frame measuring zero. */
export class FrameTimer {
  private last: number | undefined;
  constructor(private readonly now: () => number = () => performance.now()) {}
  /** Milliseconds since the previous call (0 the first time, and after `reset`). */
  delta(): number {
    const current = this.now();
    const elapsed = this.last === undefined ? 0 : Math.max(0, current - this.last);
    this.last = current;
    return elapsed;
  }
  reset(): void { this.last = undefined; }
}
