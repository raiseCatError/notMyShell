import {createRng, type Rng} from '../../src/arcade/rng.js';
import {DashWorld} from '../../src/arcade/games/dash/world.js';
import {Course, type CourseLike, type CourseOptions} from '../../src/arcade/games/dash/course.js';
import {solve, type Table} from '../../src/arcade/games/dash/solver.js';

/**
 * A small player for Vespyr Dash that plays the real simulation with the real physics. Looking at the pieces ahead it
 * works out (with the solver, which runs `stepBody` itself) the takeoff steps from which a jump lands somewhere robust,
 * takes the window just before running on would be fatal, and presses at a chosen point inside it: `timing` picks the
 * earliest, middle or latest step of the window, or a random one. It does not know where the generator put anything.
 */
export type Timing = 'early' | 'mid' | 'late' | 'random';

export interface BotResult { survived: boolean; steps: number; distance: number; jumps: number; fate: string }

/** Cat-distance px of course the bot examines at a time: past the next rest, where the course is flat and everything ahead is independent. */
const LOOK_PX = 1100;
const REFRESH_PX = 560;

/** A pilot: call `shouldJump(world)` once per step before `world.step()`; it answers whether to press now. */
export function createPilot(timing: Timing, noise: Rng, trace?: string[]): (world: DashWorld) => boolean {
  let target: number | undefined;
  let nextLook = 0;
  let step = 0;
  // A table stays valid for every later step on the same course (the cat's position is a function of the step), so it is
  // reused until the cat gets within `REFRESH_PX` of the end of what it covers.
  let table: Table | undefined;
  let tableStep = 0;
  return world => {
    const now = step;
    step += 1;
    if (!world.body.grounded) return false;
    if (target === undefined && now >= nextLook) {
      if (!table || table.distance[table.end]! - world.distance < REFRESH_PX) {
        world.course.ensure(world.distance + LOOK_PX + 100);
        table = solve(world.course.pieces, world.distance, world.distance + LOOK_PX);
        tableStep = now;
      }
      // The steps the cat can actually be standing on if it just keeps running, up to the first fatal one.
      const standing: number[] = [];
      let index = now - tableStep;
      while (index < table.end && table.next[index] !== -1) { standing.push(index); index = table.next[index]!; }
      if (index >= table.end) nextLook = now + 25;
      else {
        let last = standing.length - 1;
        while (last >= 0 && !table.good[standing[last]!]) last -= 1;
        if (last < 0) trace?.push(`noplan@${now} d=${world.distance.toFixed(1)}`);
        else {
          let first = last;
          while (first > 0 && table.good[standing[first - 1]!] && standing[first - 1] === standing[first]! - 1) first -= 1;
          const span = last - first;
          const pick = timing === 'early' ? first : timing === 'late' ? last : timing === 'mid' ? first + Math.floor(span / 2) : first + Math.floor(noise.next() * (span + 1));
          target = now + standing[pick]! - (now - tableStep);
          trace?.push(`plan@${now} d=${world.distance.toFixed(1)} run=${standing[first]! - (now - tableStep)}..${standing[last]! - (now - tableStep)} pick=${standing[pick]! - (now - tableStep)}`);
        }
      }
    }
    if (target !== undefined && now >= target) { target = undefined; nextLook = now + 1; return true; }
    return false;
  };
}

/** A course generated once up to world x `until`, handed out as independent copies so several players can run the same road. */
export function replayableCourse(seed: number, from: number, until: number): () => CourseLike {
  const course = new Course(createRng(seed).fork('course'), {from});
  course.ensure(until);
  const pieces = [...course.pieces];
  const units = [...course.units];
  return () => {
    const mine = [...pieces];
    const mineUnits = [...units];
    return {
      pieces: mine, units: mineUnits, ensure() {},
      prune(x: number) {
        let drop = 0;
        while (drop < mine.length && mine[drop]!.x + mine[drop]!.w < x) drop += 1;
        if (drop) mine.splice(0, drop);
        while (mineUnits.length > 8 && mineUnits[0]!.end < x) mineUnits.shift();
      },
    };
  };
}

export function playBot(seed: number, maxSteps: number, timing: Timing | 'idle' | 'spam', options: {from?: number; noise?: Rng; trace?: string[]; course?: () => CourseLike} = {}): BotResult {
  const courseOptions: CourseOptions & {course?: CourseLike} = options.from === undefined ? {} : {from: options.from};
  if (options.course) courseOptions.course = options.course();
  const world = new DashWorld(createRng(seed).fork('course'), courseOptions);
  const pilot = timing === 'idle' || timing === 'spam' ? undefined : createPilot(timing, options.noise ?? createRng(seed ^ 0x5eed), options.trace);
  let jumps = 0;
  let steps = 0;
  for (; steps < maxSteps && world.alive; steps += 1) {
    if (timing === 'spam') { if (!world.airborne) { world.jump(); jumps += 1; } }
    else if (pilot?.(world)) { world.jump(); jumps += 1; }
    world.step();
  }
  return {survived: world.alive, steps, distance: world.distance, jumps, fate: world.fate};
}
