import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DURATIONS, Transitions, transitionPaint, travelCells, progress} from '../src/motion/transitions.js';
import {DEFAULT_MOTION, MIGRATED_MOTION, normalizeMotion, type MotionSettings} from '../src/prompt/configuration.js';
import {MOTION_ROWS} from '../src/motion/motionRows.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

const gate = {reducedMotion: false, effectsOff: false, color: true};
const make = (motion: Partial<MotionSettings> = {}, g = gate) => new Transitions(() => ({...DEFAULT_MOTION, ...motion}), () => g);
const color = {red: 200, green: 100, blue: 255};

test('cursor travel: multi-cell jumps start one soft, bounded trail; one-cell moves and Off do not', () => {
  const t = make();
  t.travel(0, 1, 0, 0); t.travel(5, 7, 0, 0);
  assert.equal(t.busy, false, 'adjacent or tiny moves are not animated');
  t.travel(0, 12, 0, 1000);
  const [live] = t.live(1000);
  assert.equal(live?.kind, 'travel');
  assert.ok(live!.duration >= 100 && live!.duration <= DURATIONS.travelMax, `a quick motion (${live!.duration}ms)`);
  t.travel(12, 40, 0, 1050);
  assert.equal(t.live(1050).length, 1, 'a newer jump retargets instead of queueing');
  assert.deepEqual([(t.live(1050)[0] as {from: number}).from, (t.live(1050)[0] as {to: number}).to], [12, 40]);
  const short = make(); short.travel(0, 4, 0, 0); const long = make(); long.travel(0, 60, 0, 0);
  assert.ok(long.live(0)[0]!.duration > short.live(0)[0]!.duration && long.live(0)[0]!.duration <= DURATIONS.travelMax, 'longer jumps last a little longer, capped');
  assert.deepEqual(t.live(1050 + 1000), [], 'no stale trail after completion');
  assert.equal(t.busy, false);
  const off = make({cursorTravel: 'off'}); off.travel(0, 20, 0, 0); assert.equal(off.busy, false, 'toggle Off disables it');
  for (const reduced of [{...gate, reducedMotion: true}, {...gate, effectsOff: true}, {...gate, color: false}]) {
    const quiet = make({}, reduced); quiet.travel(0, 20, 0, 0); assert.equal(quiet.busy, false, JSON.stringify(reduced));
  }
});

test('trail paint: leaves the destination to the real caret, is strongest nearby, fades, and is deterministic', () => {
  const cells = travelCells(2, 14, 0.1, color, 0.5);
  assert.ok(!cells.has(14), 'the destination cell is not painted');
  assert.ok(cells.has(13) && cells.has(2) === (cells.get(2) !== undefined));
  const amount = (column: number) => (cells.get(column) as {tint: {amount: number}} | undefined)?.tint.amount ?? 0;
  assert.ok(amount(13) > amount(8) && amount(8) > amount(4), 'fades with distance from the destination');
  assert.ok(amount(13) < 0.5, 'gentle');
  assert.equal(travelCells(2, 14, 1, color, 0.5).size, 0, 'nothing remains at the end');
  assert.ok([...travelCells(14, 2, 0.2, color, 0.5).keys()].every(column => column >= 2 && column < 14 + 1), 'backward jumps stay between the two positions');
  assert.deepEqual([...travelCells(2, 14, 0.3, color, 0.5)], [...travelCells(2, 14, 0.3, color, 0.5)]);
  assert.ok([...transitionPaint.travel(2, 14, 0.2, {rendering: 'rich', intensity: 1}).values()].every(paint => 'fill' in paint), 'Rich uses fills');
  assert.ok(progress({kind: 'travel', from: 0, to: 9, row: 0, start: 0, duration: 200, look: {rendering: 'clean', intensity: 1}}, 100) === 0.5);
});

test('the autofill feedback stays independent of cursor travel', () => {
  const t = make();
  t.materialize(4, 8, 'git status', 0);
  t.travel(0, 30, 0, 10);
  assert.deepEqual(t.live(10).map(item => item.kind).sort(), ['materialize', 'travel']);
  assert.ok(DURATIONS.travelBase > DURATIONS.materializeSubtle, 'slower than the fill confirmation');
  t.cancel('travel');
  assert.equal(t.live(10).length, 1);
});

test('settings: On by default for fresh installs, off for migrated configs, malformed falls back, and the toggle is a Motion row', () => {
  assert.equal(DEFAULT_MOTION.cursorTravel, 'on');
  assert.equal(MIGRATED_MOTION.cursorTravel, 'off');
  assert.equal(normalizeMotion(undefined).cursorTravel, 'off');
  assert.equal(normalizeMotion({cursorTravel: 'on'}).cursorTravel, 'on');
  for (const bad of ['maybe', 1, null, true]) assert.equal(normalizeMotion({cursorTravel: bad}).cursorTravel, 'off');
  assert.ok(MOTION_ROWS.some(row => row.key === 'cursorTravel' && row.values.join() === 'off,on'));
});

test('app: a multi-cell caret jump moves the logical caret at once, starts the trail, and mutates nothing', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['configuration'] = {...app['configuration'], motion: {...app['configuration'].motion, cursorTravel: 'on'}};
    app['editor'].insert('git commit -m message');
    const writes: string[] = [];
    app['session'].write = (data: string) => { writes.push(data); };
    const transcript = JSON.stringify(app['output'].transcript());
    const before = app['editor'].displayCursorIndex;
    app['onInput']('\u001b[H');                         // Home: a multi-cell jump
    assert.ok(app['editor'].displayCursorIndex < before, 'the logical caret moved immediately');
    assert.equal(app['editor'].text, 'git commit -m message', 'the buffer is untouched');
    assert.ok(app['transitions'].live(Date.now()).some(item => item.kind === 'travel'), 'a trail started');
    app['onInput']('\u001b[C');                         // Right: one cell, retains the old trail only if no new one starts
    assert.ok(app['transitions'].live(Date.now()).filter(item => item.kind === 'travel').length <= 1);
    assert.deepEqual(writes, [], 'nothing reached the shell');
    assert.equal(JSON.stringify(app['output'].transcript()), transcript);
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});
