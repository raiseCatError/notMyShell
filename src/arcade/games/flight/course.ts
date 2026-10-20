import type {Rng} from '../../rng.js';
import {clamp, lerp} from '../../easing.js';
import {
  CAT_H, CAT_W, difficultyAt, EDGE, freeDistance, GAP_MIN, GAP_START, minFree, OB_W, pairReachable, shiftLimit, speedAt,
  type GapSpec,
} from './physics.js';

/** Three obstacle designs: stacked books, glass chimneys and crates. Purely visual: all share one width and one hitbox rule. */
export const STYLES = ['books', 'glass', 'crates'] as const;
export type ObstacleStyle = (typeof STYLES)[number];

export interface Obstacle extends GapSpec {
  id: number;
  style: ObstacleStyle;
  /** Set once the cat has fully passed it (and counted for exactly one point). */
  scored: boolean;
}

/** Free flight before the first obstacle, in steps: time to start flapping. */
const FIRST_FREE_STEPS = 100;
/** Free steps between obstacles at the start and at the cap of difficulty. */
const FREE_STEPS_START = 120;
const FREE_STEPS_END = 58;
/** How far (px) a gap center may move from the previous one before the fairness limit applies: it grows with difficulty. */
const SHIFT_START = 5;
const SHIFT_END = 40;

/** The gap height at a distance: wide at first, narrowing to `GAP_MIN` (never below it), and never more than the world allows. */
export function gapAt(distance: number, height: number): number {
  const widest = Math.max(GAP_MIN, Math.min(GAP_START, height - 2 * EDGE - 8));
  return Math.round(lerp(widest, GAP_MIN, difficultyAt(distance)));
}

/**
 * The course: obstacles generated ahead of the cat from a seeded stream with a fixed number of draws per obstacle, so
 * what the fairness check adjusts never changes what comes after. Every consecutive pair satisfies `pairReachable`
 * (checked here, and again by the tests over thousands of obstacles), and the whole course depends on the seed and the
 * world height only, never on the canvas.
 */
export class Course {
  readonly obstacles: Obstacle[] = [];
  private nextId = 1;
  private lastX: number;
  private last: GapSpec | undefined;

  /** `origin` is where the cat's hitbox starts; the first obstacle's gap is centered on the cat's start. */
  constructor(private readonly rng: Rng, readonly height: number, origin: number) {
    this.lastX = origin;
    this.last = undefined;
  }

  /** The hitbox-top the cat starts with: centered in the first gap. */
  startY(): number { return Math.round(this.height / 2 - CAT_H / 2); }

  /** Make sure obstacles exist up to world x `limit`. */
  ensure(limit: number): void {
    while (this.lastX < limit) this.generate();
  }

  /** Forget obstacles far behind the cat. */
  trim(behind: number): void {
    while (this.obstacles.length > 2 && this.obstacles[0]!.x + OB_W < behind) this.obstacles.shift();
  }

  private generate(): void {
    const rng = this.rng;
    // Four draws per obstacle, always, in this order.
    const spacingDraw = rng.next();
    const shiftDraw = rng.range(-1, 1);
    const gapDraw = rng.next();
    const style = STYLES[Math.floor(rng.next() * STYLES.length)]!;

    const previous = this.last;
    const first = previous === undefined;
    const difficulty = difficultyAt(this.lastX);
    const steps = first ? FIRST_FREE_STEPS : lerp(FREE_STEPS_START, FREE_STEPS_END, difficulty) + spacingDraw * 10;
    // The new obstacle's left edge. The first one is measured from the cat's own start, the others from the previous obstacle.
    const behind = this.lastX + (first ? CAT_W : OB_W + CAT_W);
    const estimate = speedAt(behind + 60);
    // Never closer than the least free distance at the speed the cat will have there (the draw can only widen it).
    let x = behind + freeDistance(steps, estimate);
    while (x - behind < minFree(speedAt(x))) x += 0.5;

    // A pixel of variety, never below the minimum and never above what the start allows.
    const gap = Math.max(GAP_MIN, gapAt(x, this.height) + (gapDraw < 0.5 ? 0 : 1) * (difficulty < 1 ? 1 : 0));
    const low = EDGE;
    const high = this.height - EDGE - gap;
    let top: number;
    if (!previous) {
      top = clamp(Math.round(this.height / 2 - gap / 2), low, high);
    } else {
      const speed = speedAt(x);
      const free = x - previous.x - OB_W - CAT_W;
      const gapA = previous.gapBottom - previous.gapTop;
      const direction = shiftDraw < 0 ? 'up' : 'down';
      const allowed = Math.max(0, shiftLimit(direction, speed, free, gapA) - 1);
      const shift = shiftDraw * Math.min(allowed, lerp(SHIFT_START, SHIFT_END, difficulty));
      top = clamp(Math.round((previous.gapTop + previous.gapBottom) / 2 + shift - gap / 2), low, high);
      // Rounding and clamping can only move a gap toward the previous one by less than a pixel; verify, and step back if not.
      const candidate = (t: number): GapSpec => ({x, gapTop: t, gapBottom: t + gap});
      for (let guard = 0; guard < 64 && !pairReachable(previous, candidate(top), speed); guard += 1) {
        const center = (previous.gapTop + previous.gapBottom) / 2;
        top += top + gap / 2 > center ? -1 : 1;
        top = clamp(top, low, high);
      }
    }
    const obstacle: Obstacle = {id: this.nextId, style, x, gapTop: top, gapBottom: top + gap, scored: false};
    this.nextId += 1;
    this.obstacles.push(obstacle);
    this.last = obstacle;
    this.lastX = x;
  }
}
