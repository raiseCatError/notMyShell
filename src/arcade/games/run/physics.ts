/**
 * Vespyr Run physics and the fairness arithmetic. Pure numbers, no drawing, no randomness.
 *
 * Units: one world pixel is one canvas column wide and half a cell row tall. Time advances in fixed steps of 1/60 s.
 * Everything the generator promises (a gap is crossable, an obstacle is clearable) is computed here from the same
 * `airStep` the simulation uses, so the proof and the game cannot drift apart.
 */
export const STEPS_PER_SECOND = 60;
export const DT = 1 / STEPS_PER_SECOND;
export const STEP_MS = 1000 / STEPS_PER_SECOND;

/** Pixels per second squared and pixels per second at takeoff. */
export const GRAVITY = 272;
export const JUMP_V = 96;
/** Pressing Down in the air multiplies gravity for the rest of that jump: a short hop. */
export const FAST_FALL = 2.2;

/** The cat sprite is 14 x 8 pixels; the hitbox is inside it (the tail, ear tips and whiskers do not hurt). */
export const SPRITE_W = 14;
export const SPRITE_H = 8;
export const HB_X = 3;
export const CAT_W = 7;
export const STAND_H = 7;
export const DUCK_H = 4;
/** A ducking press lasts this many steps and a new press restarts it (a held key repeats). */
export const DUCK_STEPS = 40;
/** An Up pressed this close before landing is remembered and jumps on touchdown. */
export const JUMP_BUFFER_STEPS = 6;

/** Speed (px/s) and the distance (px) over which difficulty ramps from its start to its cap. */
export const SPEED_START = 48;
export const SPEED_MAX = 96;
export const RAMP_PX = 9000;

export const speedAt = (distance: number): number => SPEED_START + (SPEED_MAX - SPEED_START) * difficultyAt(distance);
/** 0..1, nondecreasing, capped: drives speed, density, cluster size and the aerial share. */
export const difficultyAt = (distance: number): number => Math.min(1, Math.max(0, distance) / RAMP_PX);

/** One step of vertical motion in the air; returns true on touchdown. Semi-implicit Euler, shared with the proofs. */
export function airStep(state: {y: number; vy: number}, fast: boolean): boolean {
  state.vy -= GRAVITY * (fast ? FAST_FALL : 1) * DT;
  state.y += state.vy * DT;
  if (state.y <= 0) { state.y = 0; state.vy = 0; return true; }
  return false;
}

/** Height after j steps of an ordinary (not fast-fall) jump; index 0 is takeoff, the last entry is the landing (0). */
export const JUMP_PROFILE: readonly number[] = (() => {
  const state = {y: 0, vy: JUMP_V};
  const heights = [0];
  for (let guard = 0; guard < 600; guard += 1) { const landed = airStep(state, false); heights.push(state.y); if (landed) break; }
  return heights;
})();
export const AIR_STEPS = JUMP_PROFILE.length - 1;
export const APEX = Math.max(...JUMP_PROFILE);

/** Steps the player needs between landing and the next action, a deliberately generous human reaction. */
export const REACT_STEPS = 12;
/** Out of a duck the next jump can start sooner: the decision was already made. */
export const DUCK_REACT_STEPS = 6;
/** A window must leave this many steps of timing slack beyond the exact optimum to count as fair. */
export const SAFE_STEPS = 8;
/** Narrowest takeoff window (steps) the generator accepts for an obstacle at a given speed (~0.2 s). */
export const SLACK_STEPS = 12;
/** A jump must clear an obstacle's top by this many pixels. */
export const CLEAR_PX = 1;
/** A duck can start this many steps before an aerial obstacle's contact and still hold through it. */
export const DUCK_LEAD_STEPS = 24;
/** Aerial obstacles hang with their underside this high: above the ducking cat, below the standing one. */
export const AERIAL_LIFT = 6;

export interface JumpWindow {
  /** Earliest and latest takeoff step relative to the first step of contact (negative: before it). */
  kmin: number;
  kmax: number;
}

/**
 * The takeoff steps from which an ordinary jump clears a ground obstacle `width` wide and `height` tall at `speed`:
 * the cat's feet stay at least `height + CLEAR_PX` above the ground for every step it overlaps the obstacle. Discretization
 * is covered by checking one extra step either side. Undefined when no jump clears it.
 */
export function jumpWindow(width: number, height: number, speed: number): JumpWindow | undefined {
  const contact = (width + CAT_W) / (speed * DT);
  const last = Math.ceil(contact) + 1;
  const need = height + CLEAR_PX;
  let kmin: number | undefined;
  let kmax: number | undefined;
  for (let k = last - AIR_STEPS - 2; k <= 2; k += 1) {
    let clear = true;
    for (let n = 0; n <= last && clear; n += 1) {
      const j = n - k;
      if ((j >= 0 && j <= AIR_STEPS ? JUMP_PROFILE[j]! : 0) < need) clear = false;
    }
    if (clear) { kmin ??= k; kmax = k; }
  }
  return kmin === undefined || kmax === undefined ? undefined : {kmin, kmax};
}

/** Takeoff steps of slack the window offers (kmax - kmin + 1), 0 when none. */
export const windowSize = (window: JumpWindow | undefined): number => (window ? window.kmax - window.kmin + 1 : 0);
