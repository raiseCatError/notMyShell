import type {Rng} from '../../rng.js';
import {
  AIR_STEPS, GAP_MAX, GAP_MIN, HB_X, MIN_GAP_PX, PLATFORM_LEVELS, PW, REACT_STEPS, SPEED_MAX, SPIKE_W,
  difficultyAt, maxGapAt, stepPx, STEPS_PER_SECOND, WINDOW_STEPS, type Piece, type PieceKind,
} from './physics.js';
import {firstWindow, solve, solvePhases, type PhaseTables, type Window} from './solver.js';

/**
 * The endless course: patterns ("units") placed along the world from a seeded stream. Each unit is a template (a row of
 * spikes, a gap, a raised platform, a staircase of platforms, an island in a gap, a platform with spikes on it) and is
 * only placed where `solve()` (see solver.ts) proves, by running the real physics, that a player who has just touched
 * down and spent the reaction time can still get through with a takeoff window of at least `WINDOW_STEPS` everywhere.
 *
 * Positions are world pixels; the cat's hitbox left edge is at `distance + HB_X`.
 *
 * Every so often the course rests: a flat stretch long enough for any jump in progress to land and the reaction time to
 * pass. The proof restarts from there, so it only ever examines the units since the last rest (a short stretch), and
 * the induction is exact: each placement keeps the stretch from the rest point onward provable, and that is all the next
 * one needs.
 */
export type UnitKind = 'spikes' | 'gap' | 'block' | 'pole' | 'stairs' | 'island' | 'perch';

export interface Part { kind: PieceKind; dx: number; w: number; level: number }
export interface UnitSpec { kind: UnitKind; parts: Part[]; length: number }

export interface Unit {
  id: number; kind: UnitKind;
  /** World x of the unit's first and last pixel. */
  x: number; end: number;
  /** The takeoff window for its first jump, proven in isolation (cat distances), and the reaction deadline after it. */
  window: Window | undefined;
  /** Whether a rest (a long flat stretch) comes right before it. */
  afterRest: boolean;
}

/** Cat distance (in px) the first unit is placed at, ahead of the start. */
export const START_PX = 150;
/** The most steps of units between rests, and the distance a unit may be pushed right looking for a fit. */
export const MAX_SECTION = 5;
const SCAN_PX = 260;

const REACH_MAX = AIR_STEPS * SPEED_MAX / STEPS_PER_SECOND;
/** From the last piece to the point from which the proof restarts: any jump in progress has landed and the reaction time has passed. */
export const REST_FROM_PX = Math.ceil(REACH_MAX + REACT_STEPS * SPEED_MAX / STEPS_PER_SECOND + 8);
/** The least flat stretch between the last piece before a rest and the first piece after it. */
export const REST_PX = REST_FROM_PX + HB_X + PW + 40;

export const spikesSpec = (count: number, spacing: number): UnitSpec => ({
  kind: 'spikes', length: count * SPIKE_W + (count - 1) * spacing,
  parts: Array.from({length: count}, (_, index) => ({kind: 'spike' as const, dx: index * (SPIKE_W + spacing), w: SPIKE_W, level: 0})),
});
export const gapSpec = (width: number): UnitSpec => ({kind: 'gap', length: width, parts: [{kind: 'gap', dx: 0, w: width, level: 0}]});
export const blockSpec = (width: number, level: number, kind: 'block' | 'pole' = 'block'): UnitSpec => ({kind, length: width, parts: [{kind: 'block', dx: 0, w: width, level}]});
export const stairsSpec = (first: {w: number; level: number}, second: {w: number; level: number}): UnitSpec => ({
  kind: 'stairs', length: first.w + second.w,
  parts: [{kind: 'block', dx: 0, w: first.w, level: first.level}, {kind: 'block', dx: first.w, w: second.w, level: second.level}],
});
/** A platform standing alone in a gap: gap, island and gap are one stretch of missing ground with a block in it. */
export const islandSpec = (before: number, width: number, level: number, after: number): UnitSpec => ({
  kind: 'island', length: before + width + after,
  parts: [{kind: 'gap', dx: 0, w: before + width + after, level: 0}, {kind: 'block', dx: before, w: width, level}],
});
/** A platform with spikes at its far end: land on the near part, hop the spikes. */
export const perchSpec = (width: number, level: number, spikes: number): UnitSpec => ({
  kind: 'perch', length: width,
  parts: [{kind: 'block', dx: 0, w: width, level}, ...Array.from({length: spikes}, (_, index) => ({kind: 'spike' as const, dx: width - (spikes - index) * SPIKE_W, w: SPIKE_W, level}))],
});

/**
 * One template picked from four rolls in [0, 1); `diff` (0..1) widens the choice and the parameters, `per` (px per step at
 * the cat's speed) sizes things that must leave room for several takeoff windows: a platform you land on and then leave
 * again must be long enough for the landing spread, the reaction time and the next window.
 */
export function pickSpec(kindRoll: number, a: number, b: number, c: number, diff: number, per: number): UnitSpec {
  const table: Array<[UnitKind, number]> = [
    ['spikes', 3], ['gap', 2.2], ['block', 2], ['pole', 0.8],
    ['stairs', diff > 0.08 ? 1.5 : 0], ['island', diff > 0.14 ? 1.5 : 0], ['perch', diff > 0.22 ? 1.4 : 0],
  ];
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = kindRoll * total;
  let kind: UnitKind = 'spikes';
  for (const [name, weight] of table) { if (roll < weight) { kind = name; break; } roll -= weight; }
  const level = (roll01: number): number => PLATFORM_LEVELS[Math.min(PLATFORM_LEVELS.length - 1, Math.floor(roll01 * PLATFORM_LEVELS.length))]!;
  const room = Math.ceil(per * (3 * WINDOW_STEPS + 4)) + 4;
  const gapTop = Math.max(GAP_MIN, Math.min(GAP_MAX, maxGapAt(per * STEPS_PER_SECOND) - 3));
  switch (kind) {
    case 'spikes': return spikesSpec(Math.min(3, 1 + Math.floor(a * (1.5 + 1.8 * diff))), b < 0.55 ? 0 : 4 * (1 + Math.floor(c * 2)));
    case 'gap': return gapSpec(GAP_MIN + Math.floor(a * (gapTop - GAP_MIN) * (0.5 + 0.5 * diff) + 0.5));
    case 'block': return blockSpec(10 + Math.floor(a * 24), level(b));
    case 'pole': return blockSpec(4 + 2 * Math.floor(a * 2), PLATFORM_LEVELS[1 + Math.floor(b * 2)]!, 'pole');
    case 'stairs': {
      const lower = level(a * 0.66);
      const upper = PLATFORM_LEVELS.filter(value => value > lower)[Math.floor(b * 0.99)] ?? PLATFORM_LEVELS[PLATFORM_LEVELS.length - 1]!;
      return stairsSpec({w: room + Math.floor(c * 8), level: lower}, {w: 16 + Math.floor(a * 14), level: upper});
    }
    case 'island': return islandSpec(GAP_MIN + Math.floor(a * 6), room + Math.floor(b * 8), [2, 4, 6][Math.floor(c * 3)]!, GAP_MIN + Math.floor(c * 6));
    default: {
      const spikes = 1 + (c < 0.35 + 0.3 * diff ? 1 : 0);
      return perchSpec(room + spikes * SPIKE_W + Math.floor(a * 6), level(b * 0.66), spikes);
    }
  }
}

/** Pieces of a unit placed with its first pixel at world x (ids filled in by the caller). */
export function buildPieces(spec: UnitSpec, x: number, unit: number, nextId: () => number): Piece[] {
  return spec.parts.map(part => ({id: nextId(), kind: part.kind, x: x + part.dx, w: part.w, level: part.level, unit}))
    .sort((left, right) => left.x - right.x || left.id - right.id);
}

/** What the world needs of a course: pieces and units in order, growth ahead of the cat, forgetting behind it. */
export interface CourseLike {
  readonly pieces: Piece[];
  readonly units: readonly Unit[];
  ensure(untilX: number): void;
  prune(x: number): void;
}

export interface CourseOptions {
  /** The cat's starting distance (tests start far along to examine fast speeds). */
  from?: number;
}

export class Course implements CourseLike {
  /** Pieces ahead of and around the cat, sorted by x. */
  readonly pieces: Piece[] = [];
  readonly units: Unit[] = [];
  private section: Piece[] = [];
  private sectionStart: number;
  private sinceRest = 0;
  private restAfter = 4;
  private lastEnd: number;
  private nextId = 1;
  private nextUnit = 1;
  private lastFree = 0;
  /** The proof table of the current section as committed, reused for every candidate placement. */
  private base: PhaseTables | undefined;
  /** World x up to which the course has been generated. */
  frontier: number;
  /** Placements the last `emit` had to try, for tests and tuning. */
  trials = 0;

  constructor(private readonly rng: Rng, options: CourseOptions = {}) {
    const from = options.from ?? 0;
    this.sectionStart = from;
    this.lastEnd = from - HB_X;
    this.frontier = from;
    this.lastFree = from;
  }

  ensure(untilX: number): void { while (this.frontier < untilX) this.emit(); }
  /** Forget pieces wholly behind `x`. */
  prune(x: number): void {
    let drop = 0;
    while (drop < this.pieces.length && this.pieces[drop]!.x + this.pieces[drop]!.w < x) drop += 1;
    if (drop > 0) this.pieces.splice(0, drop);
    while (this.units.length > 8 && this.units[0]!.end < x) this.units.shift();
  }

  private emit(): void {
    const rng = this.rng;
    // A fixed number of draws per unit, whatever the proof then rejects, so the stream never depends on feasibility.
    const spreadRoll = rng.next();
    const restRoll = rng.next();
    const rolls = Array.from({length: 3}, () => [rng.next(), rng.next(), rng.next(), rng.next()] as const);
    const diff = difficultyAt(this.lastEnd);
    const first = this.units.length === 0;
    let rest = !first && this.sinceRest >= this.restAfter;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (rest) {
        this.sectionStart = this.lastEnd + REST_FROM_PX - HB_X;
        this.section = [];
        this.sinceRest = 0;
        this.restAfter = 3 + Math.floor(restRoll * (MAX_SECTION - 2));
        this.lastFree = this.sectionStart;
        this.base = undefined;
      }
      const specs = attempt === 0 ? rolls.map(([k, a, b, c]) => pickSpec(k, a, b, c, diff, stepPx(this.lastEnd + REST_PX))) : [spikesSpec(1, 0)];
      for (const spec of specs) {
        const base = first ? this.sectionStart + START_PX : rest ? this.lastEnd + REST_PX : this.lastEnd + MIN_GAP_PX;
        const placed = this.place(spec, base, spreadRoll, diff);
        if (placed !== undefined) { this.commit(spec, placed, rest); return; }
      }
      rest = true;
    }
    throw new Error('Vespyr Dash could not place a unit');
  }

  /** The least x at or after `base` (nudged right by the unit's share of spare room) where the unit is provable. */
  private place(spec: UnitSpec, base: number, spreadRoll: number, diff: number): number | undefined {
    const start = Math.ceil(Math.max(base, this.lastFree + HB_X + PW - 24));
    let found: number | undefined;
    for (let x = start; x <= start + SCAN_PX && found === undefined; x += 5) if (this.fits(spec, x)) found = x;
    if (found === undefined) return undefined;
    for (let x = Math.max(start, found - 4); x < found; x += 1) if (this.fits(spec, x)) { found = x; break; }
    const roomy = Math.round(found + spreadRoll * (140 * (1 - diff) + 8));
    return this.fits(spec, roomy) ? roomy : found;
  }

  private proof(pieces: Piece[], x: number, spec: UnitSpec): PhaseTables | undefined {
    return solvePhases(pieces, this.sectionStart, x + spec.length + REACH_MAX + 30, this.base ? {tables: this.base, x} : undefined);
  }

  private fits(spec: UnitSpec, x: number): boolean {
    this.trials += 1;
    const pieces = [...this.section, ...buildPieces(spec, x, 0, () => 0)];
    return this.proof(pieces, x, spec) !== undefined;
  }

  private commit(spec: UnitSpec, x: number, afterRest: boolean): void {
    const unit = this.nextUnit;
    this.nextUnit += 1;
    const pieces = buildPieces(spec, x, unit, () => this.nextId++);
    // The window the unit offers a player standing ready on open ground before it: found in isolation.
    const alone = solve(buildPieces(spec, x, unit, () => 0), x - 100, x + spec.length + REACH_MAX + 30);
    const window = firstWindow(alone);
    this.units.push({id: unit, kind: spec.kind, x, end: x + spec.length, window, afterRest});
    this.pieces.push(...pieces);
    this.section.push(...pieces);
    this.base = this.proof(this.section, x, spec);
    this.sinceRest += 1;
    this.lastEnd = x + spec.length;
    this.frontier = this.lastEnd;
    this.lastFree = window?.free ?? this.lastEnd;
  }
}
