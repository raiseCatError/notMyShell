import test from 'node:test';
import assert from 'node:assert/strict';
import {angleGap, bounce, boxesOverlap, circleBox, circleSegment, circlesOverlap, inArc, wrapAngle, TAU} from '../src/arcade/engine/collide.js';
import {components, distances, firstStep, floodFill, neighbours, ALL_EIGHT} from '../src/arcade/engine/grid.js';
import {History} from '../src/arcade/engine/history.js';
import {dailySeed, daysBetween, isDateKey, localDateKey} from '../src/arcade/engine/daily.js';

test('collide: boxes and circles overlap only when they truly do', () => {
  assert.equal(boxesOverlap({x: 0, y: 0, width: 2, height: 2}, {x: 2, y: 0, width: 2, height: 2}), false, 'touching edges do not overlap');
  assert.equal(boxesOverlap({x: 0, y: 0, width: 2, height: 2}, {x: 1.9, y: 1.9, width: 2, height: 2}), true);
  assert.equal(circlesOverlap({x: 0, y: 0, r: 1}, {x: 2, y: 0, r: 1}), false);
  assert.equal(circlesOverlap({x: 0, y: 0, r: 1}, {x: 1.9, y: 0, r: 1}), true);
});

test('collide: circle against a segment and a box gives the outward normal and depth', () => {
  const hit = circleSegment({x: 5, y: 0.5, r: 1}, {x: 0, y: 0}, {x: 10, y: 0})!;
  assert.ok(Math.abs(hit.ny - 1) < 1e-9 && Math.abs(hit.depth - 0.5) < 1e-9);
  assert.equal(circleSegment({x: 5, y: 2, r: 1}, {x: 0, y: 0}, {x: 10, y: 0}), undefined);
  const side = circleBox({x: -0.5, y: 1, r: 1}, {x: 0, y: 0, width: 4, height: 2})!;
  assert.ok(side.nx === -1 && Math.abs(side.depth - 0.5) < 1e-9);
  const inside = circleBox({x: 0.2, y: 1, r: 0.5}, {x: 0, y: 0, width: 4, height: 2})!;
  assert.equal(inside.nx, -1, 'leaves through the nearest face');
});

test('collide: bounce reflects the normal speed with restitution and leaves separating motion alone', () => {
  assert.deepEqual(bounce({x: 3, y: -4}, 0, 1, 1), {x: 3, y: 4});
  const damped = bounce({x: 0, y: -10}, 0, 1, 0.5);
  assert.equal(damped.y, 5);
  assert.deepEqual(bounce({x: 1, y: 2}, 0, 1), {x: 1, y: 2});
});

test('collide: angles wrap and arcs include the right side of their boundary', () => {
  assert.ok(Math.abs(wrapAngle(-Math.PI / 2) - 1.5 * Math.PI) < 1e-12);
  assert.ok(Math.abs(angleGap(0.1, TAU - 0.1) - 0.2) < 1e-12);
  assert.equal(inArc(0.05, TAU - 0.1, 0.2), true, 'an arc across zero');
  assert.equal(inArc(0.2, TAU - 0.1, 0.2), false);
});

test('grid: neighbours, flood fill, distances and first steps are exact and deterministic', () => {
  const shape = {width: 5, height: 4};
  assert.deepEqual(neighbours(shape, 0), [1, 5]);
  assert.equal(neighbours(shape, 6, ALL_EIGHT).length, 8);
  const walls = new Set([2, 7, 12]);
  const open = (cell: number) => !walls.has(cell);
  const left = floodFill(shape, 0, open);
  assert.ok(left.includes(4), 'reachable around the wall');
  const dist = distances(shape, 0, open);
  assert.equal(dist[4], 10, 'around the wall: three down, four across, three up');
  assert.equal(firstStep(shape, 0, 4, open), 1, 'ties go to the first direction in order (up, right, down, left)');
  assert.equal(firstStep(shape, 15, 4, open), 16, 'the only shortest way');
  const groups = components(shape, cell => (walls.has(cell) ? 1 : undefined));
  assert.deepEqual(groups, [[2, 7, 12]]);
});

test('history: undo, redo, a new move drops redo, bounded depth', () => {
  const history = new History<number>(3);
  let state = 0;
  for (const next of [1, 2, 3, 4]) { history.push(state); state = next; }
  assert.equal(history.depth, 3);
  state = history.undo(state)!;
  assert.equal(state, 3);
  state = history.redo(state)!;
  assert.equal(state, 4);
  state = history.undo(state)!;
  history.push(state); state = 9;
  assert.equal(history.canRedo, false);
});

test('daily: the local date picks the puzzle; restarting cannot change it; streak arithmetic ignores time zones', () => {
  const morning = new Date(2026, 9, 21, 0, 5).getTime();
  const night = new Date(2026, 9, 21, 23, 55).getTime();
  assert.equal(localDateKey(morning), '2026-10-21');
  assert.equal(localDateKey(morning), localDateKey(night));
  assert.equal(dailySeed('purrword', '2026-10-21'), dailySeed('purrword', '2026-10-21'));
  assert.notEqual(dailySeed('purrword', '2026-10-21'), dailySeed('purrword', '2026-10-22'));
  assert.notEqual(dailySeed('purrword', '2026-10-21'), dailySeed('sudoku', '2026-10-21'));
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2, 'across a DST change');
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(isDateKey('2026-02-30'), false);
  assert.equal(isDateKey('2026-02-28'), true);
});
