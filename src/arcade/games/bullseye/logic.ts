import {angleGap, TAU, wrapAngle} from '../../engine/collide.js';
import type {Rng} from '../../rng.js';

/**
 * Vespyr Bullseye's rules. A round target spins above; darts are thrown from below and stick into its rim at the bottom
 * point, then turn with it. A dart that arrives within `MIN_GAP` (an angle) of a dart already in the rim glances off and
 * the run is over. Each stage gives a fixed number of darts; using them all clears it. The target's spin follows a
 * pattern of timed segments (steady, faster, reversing, stopping) drawn from the stage's seed, so a stage replays exactly.
 *
 * Angles are in the target's own frame: a dart at angle `a` is at screen angle `a + rotation`. Screen angle π/2 is the
 * bottom of the target (y grows downward), where darts arrive.
 */
export const MIN_GAP = 0.2;
/** Flight time of a thrown dart, in ms: the target keeps turning while it flies. */
export const FLIGHT_MS = 130;
export const IMPACT = Math.PI / 2;
export const FISH_GAP = 0.16;

export interface Segment { ms: number; speed: number }
export interface Fish { angle: number; taken: boolean }
export type BullseyeEvent = {kind: 'stick'; angle: number} | {kind: 'fish'; angle: number} | {kind: 'glance'; angle: number} | {kind: 'clear'; stage: number};

export function stageDarts(stage: number): number { return Math.min(11, 5 + Math.floor(stage / 2)); }
export const isBoss = (stage: number): boolean => stage % 5 === 0;

/** The spin pattern of a stage: faster and with more reversals as stages go on; bosses stop and lurch. */
export function stagePattern(stage: number, rng: Rng): Segment[] {
  const base = Math.min(4.2, 1.5 + stage * 0.18);
  const segments: Segment[] = [];
  for (let index = 0; index < 8; index += 1) {
    const reverse = stage >= 3 && rng.chance(Math.min(0.6, 0.15 + stage * 0.04));
    const burst = stage >= 2 && rng.chance(0.35);
    const pause = isBoss(stage) && rng.chance(0.3);
    const speed = pause ? 0.2 : base * (burst ? 1.6 : rng.range(0.7, 1.1));
    segments.push({ms: rng.int(700, 1800), speed: (reverse ? -1 : 1) * speed});
  }
  return segments;
}

export class BullseyeState {
  stage = 1;
  rotation = 0;
  /** Angles of darts in the rim, in the target's frame. */
  darts: number[] = [];
  fish: Fish[] = [];
  left = stageDarts(1);
  score = 0;
  alive = true;
  /** A dart in flight: ms until it arrives. */
  flying = -1;
  /** Time into the stage's pattern. */
  private clock = 0;
  private pattern: Segment[] = [];
  clearMs = 0;
  thrown = 0;
  events: BullseyeEvent[] = [];

  constructor(private readonly rng: Rng) { this.begin(); }

  /** Set up the current stage: its pattern, darts already in the rim (from stage 2) and fish on the rim. */
  private begin(): void {
    const stageRng = this.rng.fork(`stage-${this.stage}`);
    this.pattern = stagePattern(this.stage, stageRng);
    this.clock = 0;
    this.darts = [];
    this.fish = [];
    this.left = stageDarts(this.stage);
    const preset = this.stage === 1 ? 0 : Math.min(5, Math.floor(this.stage / 2) + (isBoss(this.stage) ? 2 : 0));
    for (let attempt = 0; attempt < 200 && this.darts.length < preset; attempt += 1) {
      const angle = stageRng.range(0, TAU);
      if (this.darts.every(other => angleGap(other, angle) > MIN_GAP * 2.2)) this.darts.push(angle);
    }
    const fishCount = stageRng.int(1, 2);
    for (let attempt = 0; attempt < 200 && this.fish.length < fishCount; attempt += 1) {
      const angle = stageRng.range(0, TAU);
      if (this.darts.every(other => angleGap(other, angle) > MIN_GAP * 1.5) && this.fish.every(other => angleGap(other.angle, angle) > 1)) this.fish.push({angle, taken: false});
    }
  }

  /** The spin speed now (radians per second). */
  get speed(): number {
    const total = this.pattern.reduce((sum, segment) => sum + segment.ms, 0);
    let at = this.clock % total;
    for (const segment of this.pattern) { if (at < segment.ms) return segment.speed; at -= segment.ms; }
    return this.pattern[0]!.speed;
  }

  throw(): void {
    if (!this.alive || this.flying >= 0 || this.left <= 0 || this.clearMs > 0) return;
    this.left -= 1;
    this.thrown += 1;
    this.flying = FLIGHT_MS;
  }

  step(dtMs: number): void {
    if (!this.alive) return;
    if (this.clearMs > 0) {
      this.clearMs -= dtMs;
      if (this.clearMs <= 0) { this.stage += 1; this.begin(); }
      return;
    }
    this.clock += dtMs;
    this.rotation = wrapAngle(this.rotation + this.speed * (dtMs / 1000));
    if (this.flying >= 0) {
      this.flying -= dtMs;
      if (this.flying < 0) this.arrive();
    }
  }

  /** The dart reaches the rim at the bottom: in the target's frame that is IMPACT minus the rotation. */
  private arrive(): void {
    const angle = wrapAngle(IMPACT - this.rotation);
    if (this.darts.some(other => angleGap(other, angle) < MIN_GAP)) {
      this.alive = false;
      this.events.push({kind: 'glance', angle});
      return;
    }
    this.darts.push(angle);
    this.score += 1;
    this.events.push({kind: 'stick', angle});
    for (const fish of this.fish) {
      if (!fish.taken && angleGap(fish.angle, angle) < FISH_GAP) { fish.taken = true; this.score += 5; this.events.push({kind: 'fish', angle}); }
    }
    if (this.left === 0) {
      this.score += isBoss(this.stage) ? 25 : 10;
      this.events.push({kind: 'clear', stage: this.stage});
      this.clearMs = 1100;
    }
  }
}
