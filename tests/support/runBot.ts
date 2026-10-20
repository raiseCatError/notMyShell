import {createRng, type Rng} from '../../src/arcade/rng.js';
import {CAT_W, DT, HB_X, jumpWindow, SAFE_STEPS} from '../../src/arcade/games/run/physics.js';
import {RunWorld} from '../../src/arcade/games/run/world.js';

/**
 * A small player for Vespyr Run that plays the real simulation with the real physics. It looks at the next obstacle,
 * computes the takeoff window the same way a careful person would (from the jump profile), and presses at a chosen point
 * inside it. `timing` picks early, middle, late or a random point so a test shows the whole window is usable.
 */
export type Timing = 'early' | 'mid' | 'late' | 'random';

export interface BotResult { survived: boolean; steps: number; distance: number; jumps: number; ducks: number }

export function playBot(seed: number, maxSteps: number, timing: Timing | 'idle' | 'spam', noise: Rng = createRng(seed ^ 0x5eed)): BotResult {
  const world = new RunWorld(createRng(seed).fork('course'));
  let jumps = 0;
  let ducks = 0;
  let steps = 0;
  // A takeoff offset chosen once per obstacle id, so the player commits like a person would.
  const choice = new Map<number, number>();
  for (; steps < maxSteps && world.alive; steps += 1) {
    if (timing === 'spam') { if (!world.airborne) { world.jump(); jumps += 1; } }
    else if (timing !== 'idle') {
      const per = world.speed * DT;
      const hitboxLeft = world.distance + HB_X;
      const next = world.course.obstacles.find(o => o.x + o.w > hitboxLeft);
      if (next) {
        const contactIn = (next.x - (hitboxLeft + CAT_W)) / per;
        if (next.air) {
          if (contactIn <= 10 && !world.airborne) { world.duck(); ducks += 1; }
        } else if (!world.airborne) {
          const window = jumpWindow(next.w, next.h, world.speed);
          if (window) {
            if (!choice.has(next.id)) {
              const span = window.kmax - window.kmin;
              const pick = timing === 'early' ? window.kmin + 2 : timing === 'late' ? window.kmax - SAFE_STEPS : timing === 'mid' ? window.kmin + span / 2 : window.kmin + 2 + noise.next() * Math.max(0, span - SAFE_STEPS - 2);
              choice.set(next.id, pick);
            }
            if (-contactIn >= choice.get(next.id)!) { world.jump(); jumps += 1; }
          }
        }
      }
    }
    world.step();
  }
  return {survived: world.alive, steps, distance: world.distance, jumps, ducks};
}
