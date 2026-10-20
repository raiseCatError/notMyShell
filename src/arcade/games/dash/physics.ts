/**
 * Vespyr Dash physics and the fairness arithmetic. Pure numbers, no drawing, no randomness.
 *
 * Units: one world pixel is one canvas column wide and half a cell row tall. Time advances in fixed steps of 1/60 s and
 * the cat scrolls right at `speedAt(distance)` whatever the player does, so where the cat is horizontally at step n is a
 * function of the course alone. Everything the generator promises (a gap is crossable, a platform is reachable, a spike
 * row is clearable) is computed by running the same `stepBody` the game runs, so the proof and the game cannot drift apart.
 */
export const STEPS_PER_SECOND = 60;
export const DT = 1 / STEPS_PER_SECOND;
export const STEP_MS = 1000 / STEPS_PER_SECOND;

/** Pixels per second squared and pixels per second at takeoff. */
export const GRAVITY = 360;
export const JUMP_V = 88;

/** The player's sprite is 7 x 6; the hitbox is the 5 x 5 body inside it (ear tips and the board's glow do not hurt). */
export const SPRITE_W = 7;
export const SPRITE_H = 6;
export const HB_X = 1;
export const PW = 5;
export const PH = 5;

/** A spike is drawn 6 x 4 and hurts in its 4 x 3 core: the tip pixel and the outer pixels are forgiving. */
export const SPIKE_W = 6;
export const SPIKE_H = 4;
export const SPIKE_HIT_X = 1;
export const SPIKE_HIT_W = 4;
export const SPIKE_HIT_H = 3;

/** Landing on a ledge that is at most this far above the feet counts as landing (a corner is forgiven, a wall is not). */
export const SNAP_PX = 1;
/** Falling this far below the ground is the end. */
export const FALL_DEPTH = 14;
/** A press this close before touchdown is remembered and jumps on landing. */
export const JUMP_BUFFER_STEPS = 6;

/**
 * Speed rises in four levels (px/s), one per `LEVEL_PX` of distance, and stays at the last. The steps are multiples of a
 * quarter pixel per tick, so the cat's position is always a multiple of 0.25 px: with pieces on whole pixels there are
 * a handful of alignments ("phases") between the cat's steps and the course, and the proof below can check every one
 * rather than sample some.
 */
export const SPEEDS: readonly number[] = [60, 75, 90, 105];
export const LEVEL_PX = 1800;
export const SPEED_START = SPEEDS[0]!;
export const SPEED_MAX = SPEEDS[SPEEDS.length - 1]!;
export const RAMP_PX = LEVEL_PX * (SPEEDS.length - 1);
export const speedLevel = (distance: number): number => Math.min(SPEEDS.length - 1, Math.max(0, Math.floor(distance / LEVEL_PX)));
export const speedAt = (distance: number): number => SPEEDS[speedLevel(distance)]!;
/** Pixels the cat advances in one step when it is at `distance`: exact in binary floating point. */
export const stepPx = (distance: number): number => speedAt(distance) / STEPS_PER_SECOND;
/** 0..1, nondecreasing and capped: drives the mix of patterns and how much spare room they get. */
export const difficultyAt = (distance: number): number => Math.min(1, Math.max(0, distance) / RAMP_PX);
/**
 * The alignments of the cat's steps to whole-pixel pieces when it stands at `distance` (a whole pixel): the offsets of its
 * next step grid, every quarter pixel up to one step. A stretch of course is proven for all of them (4 to 7).
 */
export function phasesAt(distance: number): number[] {
  return Array.from({length: Math.round(stepPx(distance) * 4)}, (_, index) => index * 0.25);
}

export type PieceKind = 'gap' | 'block' | 'spike';

/**
 * One thing on the course, in world pixels. `level` is a block's top above the ground, or the height a spike stands at
 * (0 on the ground, a block's top when it sits on one). A gap is a stretch where the ground is missing; the ground itself
 * is implicit, everywhere outside the gaps, so it can never disagree with them. A block may stand inside a gap (an island).
 * `unit` is the pattern it belongs to.
 */
export interface Piece { id: number; kind: PieceKind; x: number; w: number; level: number; unit: number }

export interface Body {
  /** Height of the feet above the ground. */
  y: number;
  vy: number;
  grounded: boolean;
  /** Set by `stepBody` on the step the feet touched a surface from the air. */
  landed: boolean;
  /** The block landed on this step or last stood on (-1 for the ground). */
  support: number;
}

export type Fate = 'alive' | 'spike' | 'wall' | 'fall';

export const newBody = (): Body => ({y: 0, vy: 0, grounded: true, landed: false, support: -1});

/** True when any part of [left, right) is ground, that is not inside a gap. Pieces are sorted by `x`. */
function overGround(left: number, right: number, pieces: readonly Piece[]): boolean {
  let from = left;
  for (const piece of pieces) {
    if (piece.x >= right) break;
    if (piece.kind !== 'gap') continue;
    const end = piece.x + piece.w;
    if (end <= from) continue;
    if (piece.x > from) return true;
    from = end;
    if (from >= right) return false;
  }
  return from < right;
}

const SCRATCH = {landTop: -Infinity, landId: -1, held: -Infinity, heldId: -1};

/** One surface under the hitbox: a landing, something to stand on, or (false) a wall. */
function touch(scratch: typeof SCRATCH, top: number, id: number, y: number, vy: number, before: number): boolean {
  if (top > y) {
    if (vy > 0 || (top - y > SNAP_PX && before < top)) return false;
    if (top > scratch.landTop) { scratch.landTop = top; scratch.landId = id; }
  } else if (top > scratch.held) { scratch.held = top; scratch.heldId = id; }
  return true;
}

/**
 * Advance the body one fixed step with the hitbox's left edge at `left` (the cat has already scrolled). Contact rules:
 * a surface under the feet holds them; a surface whose top is above the feet is a wall (death) unless it is within
 * `SNAP_PX` or the feet were above it a step ago (then it is a landing); spikes hurt only in their core; below the ground
 * line the cat falls until `FALL_DEPTH`. Touching edges is clear; only a real overlap counts. `pieces` is sorted by `x`.
 */
export function stepBody(body: Body, left: number, pieces: readonly Piece[]): Fate {
  const right = left + PW;
  const before = body.y;
  let y = body.y;
  let vy = body.vy;
  body.landed = false;
  if (!body.grounded) { vy -= GRAVITY * DT; y += vy * DT; }
  const scratch = SCRATCH;
  scratch.landTop = -Infinity; scratch.landId = -1; scratch.held = -Infinity; scratch.heldId = -1;
  if (overGround(left, right, pieces) && !touch(scratch, 0, -1, y, vy, before)) return 'wall';
  for (const piece of pieces) {
    if (piece.x >= right) break;
    if (piece.x + piece.w <= left || piece.kind !== 'block') continue;
    if (!touch(scratch, piece.level, piece.id, y, vy, before)) return 'wall';
  }
  const landTop = scratch.landTop;
  const landId = scratch.landId;
  const held = scratch.held;
  const heldId = scratch.heldId;
  if (landTop > -Infinity) {
    body.landed = !body.grounded;
    body.grounded = true; body.y = landTop; body.vy = 0; body.support = landId;
  } else if (body.grounded) {
    if (held === y) body.support = heldId;
    else { body.grounded = false; body.vy = 0; }
  } else {
    body.y = y; body.vy = vy;
  }
  if (body.y < -FALL_DEPTH) return 'fall';
  for (const piece of pieces) {
    if (piece.x >= right) break;
    if (piece.kind !== 'spike') continue;
    const hitLeft = piece.x + SPIKE_HIT_X;
    if (left < hitLeft + SPIKE_HIT_W && right > hitLeft && body.y < piece.level + SPIKE_HIT_H && body.y + PH > piece.level) return 'spike';
  }
  return 'alive';
}

/** The highest surface under a hitbox whose left edge is `left` (a standing body's height), or -Infinity over a gap. */
export function surfaceAt(left: number, pieces: readonly Piece[]): number {
  const right = left + PW;
  let top = overGround(left, right, pieces) ? 0 : -Infinity;
  for (const piece of pieces) {
    if (piece.x >= right) break;
    if (piece.kind === 'block' && piece.x + piece.w > left && piece.level > top) top = piece.level;
  }
  return top;
}

/** Start a jump from a standing body. */
export function takeoff(body: Body): void { body.grounded = false; body.vy = JUMP_V; }

/** Height after j steps of a jump over open ground; index 0 is takeoff, the last entry is the landing (0). */
export const JUMP_PROFILE: readonly number[] = (() => {
  const body = newBody();
  takeoff(body);
  const heights = [0];
  for (let guard = 0; guard < 600; guard += 1) {
    stepBody(body, 0, []);
    heights.push(body.y);
    if (body.grounded) break;
  }
  return heights;
})();
export const AIR_STEPS = JUMP_PROFILE.length - 1;
export const APEX = Math.max(...JUMP_PROFILE);

export interface JumpStats {
  /** Pixels the cat travels per step at this speed. */
  perStep: number;
  airSteps: number;
  airSeconds: number;
  apex: number;
  /** Horizontal distance of one jump over open ground (takeoff to touchdown), in px. */
  reach: number;
}

/** Exact jump numbers at `speed` (px/s): airtime, apex and horizontal distance, from the real profile. */
export function jumpStats(speed: number): JumpStats {
  const perStep = speed / STEPS_PER_SECOND;
  return {perStep, airSteps: AIR_STEPS, airSeconds: AIR_STEPS * DT, apex: APEX, reach: AIR_STEPS * perStep};
}

/** A takeoff window must be at least this many steps wide (0.2 s) for a pattern to count as fair. */
export const WINDOW_STEPS = 12;
/** Steps the player needs after touching down before the next action: a deliberately generous human reaction. */
export const REACT_STEPS = 12;
/** No two things sit closer than this many px (a visual floor; the schedule demands far more). */
export const MIN_GAP_PX = 6;

/**
 * The widest gap with a takeoff window of `WINDOW_STEPS + 1` steps at `speed`. The cat can leave the near edge as long
 * as any of it is over ground and lands safely once any of it is over the far ground, so the window is
 * `reach + PW - gap` px wide: `AIR_STEPS + (PW - gap) / perStep` steps.
 */
export function maxGapAt(speed: number): number {
  const {perStep} = jumpStats(speed);
  return Math.floor(PW + (AIR_STEPS - WINDOW_STEPS - 1) * perStep);
}
/** Gaps are never wider than this at any speed (the limit at the speed cap, less a margin of 4 px). */
export const GAP_MAX = maxGapAt(SPEED_MAX) - 4;
export const GAP_MIN = 12;
/** Platform tops the generator uses; the apex must clear them by at least a pixel and a half. */
export const PLATFORM_LEVELS: readonly number[] = [4, 6, 8];
