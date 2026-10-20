import {createRng} from '../../src/arcade/rng.js';
import {CAT_H, motion} from '../../src/arcade/games/flight/physics.js';
import {OB_W} from '../../src/arcade/games/flight/physics.js';
import {FlightWorld, type HitKind} from '../../src/arcade/games/flight/world.js';

/**
 * A small player for Vespyr Flight that plays the real simulation with the real physics. Each step it looks at the
 * obstacle it is under or about to meet, takes the lower edge of its gap as a floor, and flaps when its predicted next
 * position (no flap) would cross that floor: the "hover on the lower edge" strategy a careful person uses. `late`
 * keeps the previous obstacle's floor for 12 extra steps (0.2 s) after clearing it: a slow reaction to the next gap.
 */
export type Mode = 'optimal' | 'late' | 'very-late' | 'idle' | 'spam';

export interface BotResult { survived: boolean; steps: number; score: number; flaps: number; hit: HitKind | undefined; world: FlightWorld }

/** `late` reacts as slowly as the generator allows for (REACT_STEPS); `very-late` is far beyond it, to show the margin is real. */
export const LATE_STEPS = 12;
export const VERY_LATE_STEPS = 40;

export function playBot(seed: number, maxSteps: number, mode: Mode, options: {height?: number; start?: number} = {}): BotResult {
  const height = options.height ?? 36;
  const world = new FlightWorld(createRng(seed).fork('course'), height, options.start ?? 0);
  let flaps = 0;
  for (let step = 0; step < maxSteps && world.alive; step += 1) {
    if (mode === 'spam') { if (world.flap()) flaps += 1; }
    else if (mode !== 'idle') {
      const late = mode === 'late' ? LATE_STEPS * world.speed / 60 : mode === 'very-late' ? VERY_LATE_STEPS * world.speed / 60 : 0;
      const next = world.course.obstacles.find(o => o.x + OB_W > world.x - late);
      const floor = (next ? next.gapBottom : height) - CAT_H - 0.2;
      if (motion(world.y, world.vy).y > floor && world.flap()) flaps += 1;
    }
    world.step();
  }
  return {survived: world.alive, steps: world.steps, score: world.score, flaps, hit: world.hitKind, world};
}
