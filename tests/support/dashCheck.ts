import {HB_X, newBody, stepBody, stepPx, takeoff, type Body, type Piece} from '../../src/arcade/games/dash/physics.js';

/**
 * An independent passability check: a forward search over every sequence of presses (jump or not, at every step) with the
 * real `stepBody` and the real speed curve. Unlike the generator's backward proof it knows nothing about windows or
 * reaction time; it only answers whether any player at all gets from `from` to `until` alive.
 */
export function passable(pieces: readonly Piece[], from: number, until: number): {ok: boolean; furthest: number; peak: number} {
  let states = new Map<string, Body>([['start', newBody()]]);
  let distance = from;
  let peak = 1;
  while (distance < until && states.size > 0) {
    distance += stepPx(distance);
    const next = new Map<string, Body>();
    for (const body of states.values()) {
      for (const jump of body.grounded ? [false, true] : [false]) {
        const copy = {...body};
        if (jump) takeoff(copy);
        if (stepBody(copy, distance + HB_X, pieces) !== 'alive') continue;
        next.set(`${copy.y.toFixed(5)}|${copy.vy.toFixed(5)}|${copy.grounded ? 1 : 0}`, copy);
      }
    }
    peak = Math.max(peak, next.size);
    states = next;
  }
  return {ok: states.size > 0, furthest: distance, peak};
}
