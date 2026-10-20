import {
  AIR_STEPS, HB_X, phasesAt, PW, REACT_STEPS, WINDOW_STEPS, newBody, stepBody, stepPx, surfaceAt, takeoff,
  type Body, type Piece,
} from './physics.js';

/**
 * The fairness proof, as a backward dynamic program over the fixed-step timeline of the real simulation.
 *
 * Because the cat scrolls at `speedAt(distance)` whatever the player does, the hitbox's position at step t is the same for
 * every player. A grounded state is therefore just a step index (the height is the surface under that position). From
 * grounded step t there are two moves: keep running (`next[t]`: the next grounded step, possibly after stepping off a ledge
 * and falling) or jump (`jump[t]`: the grounded step of the touchdown). Both are found by running `stepBody` itself.
 *
 * A grounded step is *robust* (`ok[t]`) when the player is not forced into one lucky frame:
 *  - there is a run of at least `WINDOW_STEPS` consecutive steps t..t+W-1 at which a jump lands somewhere robust, or
 *  - running on leads to a robust step.
 * and a touchdown is robust only after `REACT_STEPS` more steps of running (landing plus reaction: no action is assumed
 * sooner). Beyond the end of the examined stretch the ground is open and everything is robust.
 */
export interface Table {
  /** Cat distance at each step. */
  distance: number[];
  /** Index of the first step beyond the examined stretch. */
  end: number;
  next: Int32Array;
  jump: Int32Array;
  good: Uint8Array;
  ok: Uint8Array;
  run: Int32Array;
}

const DEAD = -1;
/** How far beyond the hitbox a single simulated move can read: the longest fall or jump, with room to spare. */
const REACH_PX = 150;

/** True when no piece is within reach of a hitbox whose left edge is `left`. */
function clear(pieces: readonly Piece[], left: number): boolean {
  for (const piece of pieces) {
    if (piece.x >= left + PW + REACH_PX) return true;
    if (piece.x + piece.w > left - 4) return false;
  }
  return true;
}

/** Cat distances for `count` steps starting at `from`, following the real speed curve. */
export function distances(from: number, count: number): number[] {
  const out = [from];
  for (let index = 1; index < count; index += 1) out.push(out[index - 1]! + stepPx(out[index - 1]!));
  return out;
}

function settle(table: Table, body: Body, from: number, pieces: readonly Piece[]): number {
  const last = table.distance.length - 1;
  for (let step = from + 1; step <= last; step += 1) {
    if (stepBody(body, table.distance[step]! + HB_X, pieces) !== 'alive') return DEAD;
    if (body.grounded) return step;
  }
  return table.end;
}

/**
 * Solve the stretch from cat distance `from` (the cat stands on open ground there) to `until`; `pieces` are sorted by x.
 * `tail` extra steps are simulated beyond `until` so a jump started near the end can land.
 */
export interface Reuse {
  /** A table solved from the same `from` for pieces that agree with these ones left of world x `x`. */
  table: Table;
  x: number;
}

/** No simulation from a step reads further than this many px beyond the hitbox (the longest fall or jump is under 80 steps). */
const LOOK_PX = REACH_PX;

export function solve(pieces: readonly Piece[], from: number, until: number, reuse?: Reuse, tail = 90): Table {
  const distance = [from];
  while (distance[distance.length - 1]! < until) distance.push(distance[distance.length - 1]! + stepPx(distance[distance.length - 1]!));
  const end = distance.length - 1;
  for (let index = 0; index < tail; index += 1) distance.push(distance[distance.length - 1]! + stepPx(distance[distance.length - 1]!));
  const table: Table = {
    distance, end, next: new Int32Array(end + 1).fill(DEAD), jump: new Int32Array(end + 1).fill(DEAD),
    good: new Uint8Array(end + 1), ok: new Uint8Array(end + 1), run: new Int32Array(end + 2),
  };
  const body = newBody();
  for (let step = 0; step < end; step += 1) {
    if (reuse && step < reuse.table.end && distance[step]! + HB_X + PW + LOOK_PX < reuse.x) {
      table.next[step] = reuse.table.next[step]!;
      table.jump[step] = reuse.table.jump[step]!;
      continue;
    }
    const left = distance[step]! + HB_X;
    const top = surfaceAt(left, pieces);
    if (top === -Infinity) continue;
    if (top === 0 && clear(pieces, left)) {
      // Nothing within reach of the hitbox: running on goes on, and a jump lands a full flat jump later.
      table.next[step] = step + 1;
      table.jump[step] = step + AIR_STEPS;
      continue;
    }
    Object.assign(body, {y: top, vy: 0, grounded: true, landed: false, support: -1});
    table.next[step] = settle(table, body, step, pieces);
    Object.assign(body, {y: top, vy: 0, grounded: true, landed: false, support: -1});
    takeoff(body);
    table.jump[step] = settle(table, body, step, pieces);
  }
  table.ok[end] = 1;
  table.good[end] = 1;
  for (let step = end - 1; step >= 0; step -= 1) {
    const landing = table.jump[step]!;
    table.good[step] = landing !== DEAD && reacted(table, landing) ? 1 : 0;
    const onward = table.next[step]!;
    table.run[step] = table.good[step] ? 1 + (onward === step + 1 ? table.run[step + 1]! : 0) : 0;
    table.ok[step] = table.run[step]! >= WINDOW_STEPS || (onward !== DEAD && table.ok[Math.min(onward, end)]) ? 1 : 0;
  }
  return table;
}

/** After touching down at `landing` the player runs on for the reaction time, then must be at a robust step. */
function reacted(table: Table, landing: number): boolean {
  let step = landing;
  while (step < landing + REACT_STEPS) {
    if (step >= table.end) return true;
    step = table.next[step]!;
    if (step === DEAD) return false;
  }
  return step >= table.end || table.ok[step] === 1;
}

/** The takeoff window of the first thing in the way, from a standing start. */
export interface Window {
  /** Cat distances of the first and last takeoff, and the number of steps. */
  from: number; to: number; steps: number;
  /** Cat distance at which the player touches down after the last takeoff, and when the reaction time has passed. */
  lands: number; free: number;
}

export function firstWindow(table: Table): Window | undefined {
  let step = 0;
  while (step < table.end) {
    const onward = table.next[step]!;
    if (onward === DEAD) break;
    step = onward;
  }
  if (step >= table.end) return undefined;
  let last = step - 1;
  while (last >= 0 && !table.good[last]) last -= 1;
  if (last < 0) return undefined;
  let first = last;
  while (first > 0 && table.good[first - 1]) first -= 1;
  const landing = table.jump[last]!;
  let free = landing;
  while (free < landing + REACT_STEPS && free < table.end) { const onward = table.next[free]!; if (onward === DEAD) break; free = onward; }
  return {
    from: table.distance[first]!, to: table.distance[last]!, steps: last - first + 1,
    lands: table.distance[Math.min(landing, table.distance.length - 1)]!, free: table.distance[Math.min(free, table.distance.length - 1)]!,
  };
}

/** True when a player standing on open ground at `from` can get through `pieces` with a window of at least `WINDOW_STEPS` everywhere. */
export const isRobust = (pieces: readonly Piece[], from: number, until: number): boolean => solve(pieces, from, until).ok[0] === 1;

/** The tables of one stretch at every alignment of the cat's steps to the course. */
export type PhaseTables = Table[];

/**
 * Solve at every phase (the cat can arrive at `from` aligned any of those ways); `reuse` are the previous tables. Stops at
 * the first phase that is not robust and returns undefined: a candidate placement usually fails at the first.
 */
export function solvePhases(pieces: readonly Piece[], from: number, until: number, reuse?: {tables: PhaseTables; x: number}): PhaseTables | undefined {
  const tables: PhaseTables = [];
  for (const [index, phase] of phasesAt(from).entries()) {
    const table = solve(pieces, from + phase, until, reuse ? {table: reuse.tables[index]!, x: reuse.x} : undefined);
    if (table.ok[0] !== 1) return undefined;
    tables.push(table);
  }
  return tables;
}
