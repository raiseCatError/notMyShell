/**
 * Vespyr Flight physics and the fairness arithmetic. Pure numbers, no drawing, no randomness.
 *
 * Units: one world pixel is one canvas column wide and half a cell row tall; y grows downward. Time advances in fixed
 * steps of 1/60 s. Everything the generator promises (a gap is passable, the next gap is reachable) is computed here
 * from the same `motion` function the simulation uses, so the proof and the game cannot drift apart.
 */
export const STEPS_PER_SECOND = 60;
export const DT = 1 / STEPS_PER_SECOND;
export const STEP_MS = 1000 / STEPS_PER_SECOND;

/** Pixels per second squared, the upward speed a flap sets, and the terminal fall speed (pixels per second). */
export const GRAVITY = 330;
export const FLAP_V = 72;
export const TERMINAL_V = 108;
/** A flap needs a wingbeat to finish: presses during the next steps are ignored (a held key repeats). */
export const FLAP_COOLDOWN = 7;

/** The cat's hitbox, inside the 14 x 11 sprite (ear tips, tail, wings and whiskers do not hurt). */
export const CAT_W = 8;
export const CAT_H = 5;
/** An obstacle's width, caps included. */
export const OB_W = 8;
/** The gap edge keeps this far from the ceiling and the ground. */
export const EDGE = 2;

/** Speed (px/s) and the distance (px) over which difficulty ramps from its start to its cap. */
export const SPEED_START = 44;
export const SPEED_MAX = 76;
export const RAMP_PX = 7000;
/** 0..1, nondecreasing, capped: drives speed, gap height, spacing and how far gap centers may move. */
export const difficultyAt = (distance: number): number => Math.min(1, Math.max(0, distance) / RAMP_PX);
export const speedAt = (distance: number): number => SPEED_START + (SPEED_MAX - SPEED_START) * difficultyAt(distance);

/** One step of vertical motion: semi-implicit Euler with a terminal velocity. The only place gravity is applied. */
export function motion(y: number, vy: number): {y: number; vy: number} {
  const next = Math.min(vy + GRAVITY * DT, TERMINAL_V);
  return {y: y + next * DT, vy: next};
}

// ---- the proofs --------------------------------------------------------------------------------------------------

/** The highest a single flap climbs (px above where it was pressed), from the real step. */
export const FLAP_CLIMB = ((): number => {
  let y = 0; let vy = -FLAP_V; let top = 0;
  for (let step = 0; step < 200 && vy < 0; step += 1) { ({y, vy} = motion(y, vy)); top = Math.min(top, y); }
  return -top;
})();
/** The most a falling cat moves in one step (px). */
export const FALL_PER_STEP = TERMINAL_V * DT;

/**
 * The most height a player can gain in `steps`: flap at step 0 and again every `FLAP_COOLDOWN` steps. A flap sets the
 * velocity, so the start state does not matter and no strategy climbs faster.
 */
export function climbIn(steps: number): number {
  let y = 0; let vy = 0;
  for (let step = 0; step < steps; step += 1) {
    if (step % FLAP_COOLDOWN === 0) vy = -FLAP_V;
    ({y, vy} = motion(y, vy));
  }
  return -y;
}

/** The most height a player can lose in `steps`: no flap, starting from the worst case (a flap just before, rising). */
export function fallIn(steps: number): number {
  let y = 0; let vy = -FLAP_V;
  for (let step = 0; step < steps; step += 1) ({y, vy} = motion(y, vy));
  return y;
}

/** Steps a person is assumed to need to notice a new gap and act (0.2 s). The generator spends them before it counts any climb. */
export const REACT_STEPS = 12;
/** Only this share of the physical limit is ever asked for. */
export const SAFETY = 0.85;

/**
 * The smallest gap the player can always pass: the hitbox, plus room for one flap arc (the cat hovers by flapping when
 * it would touch the lower edge, and rises `FLAP_CLIMB` before it falls back), plus one terminal-speed step of
 * overshoot, plus a pixel of margin. Independent of speed: faster only shortens the time spent inside.
 */
export const GAP_MIN = CAT_H + Math.ceil(FLAP_CLIMB + FALL_PER_STEP) + 1;
export const minGap = (_speed: number): number => GAP_MIN;
/** The widest gap, at the start (clamped further by the room the world has). */
export const GAP_START = 28;

/** Steps between clearing one obstacle and touching the next, for a free distance in px at a speed. */
export const freeSteps = (free: number, speed: number): number => Math.floor(free / (speed * DT) + 1e-9);

/** The free distance (px) between clearing one obstacle and touching the next that gives the player at least `steps` steps. */
export const freeDistance = (steps: number, speed: number): number => steps * speed * DT;

/** The least free distance at a speed: enough time to react and make a short corrective move. */
export const MIN_FREE_STEPS = REACT_STEPS + 16;
export const minFree = (speed: number): number => freeDistance(MIN_FREE_STEPS, speed);
/** Left edge to left edge. */
export const minSpacing = (speed: number): number => OB_W + CAT_W + minFree(speed);

/**
 * The most a gap center may move between consecutive obstacles, in px, `direction` 'up' or 'down', when `free` px
 * separate them at `speed` and the gap just passed had `gapA` of height. The player may leave the first gap from its far
 * end, so half its free travel (`gapA - CAT_H`) is paid before any shift is counted; the second gap's own slack is not
 * counted at all. Both gaps' slack makes real play easier than this.
 */
export function shiftLimit(direction: 'up' | 'down', speed: number, free: number, gapA: number): number {
  const usable = Math.max(0, freeSteps(free, speed) - REACT_STEPS);
  const capacity = direction === 'up' ? climbIn(usable) : fallIn(usable);
  return Math.max(0, Math.floor(SAFETY * capacity - (gapA - CAT_H) / 2));
}

export interface GapSpec { x: number; gapTop: number; gapBottom: number }

export const centerOf = (gap: GapSpec): number => (gap.gapTop + gap.gapBottom) / 2;

/** True when a player who is anywhere inside `a`'s gap can reach `b`'s gap with the margins above. The speed is the faster of the two ends. */
export function pairReachable(a: GapSpec, b: GapSpec, speedAtB: number): boolean {
  const free = b.x - a.x - OB_W - CAT_W;
  if (free < minFree(speedAtB) - 1e-9) return false;
  if (b.gapBottom - b.gapTop < minGap(speedAtB)) return false;
  const shift = centerOf(b) - centerOf(a);
  const limit = shiftLimit(shift < 0 ? 'up' : 'down', speedAtB, free, a.gapBottom - a.gapTop);
  return Math.abs(shift) <= limit;
}
