import test from 'node:test';
import assert from 'node:assert/strict';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {createRng} from '../src/arcade/rng.js';
import {glassGame} from '../src/arcade/games/glass/index.js';
import {AIM_MAX, AIM_MIN, CHAIN_RANGE, COOLDOWN_S, CRYSTAL_GAIN, GROUP_GAP_S, GlassState, SMASH_COST, START_SPHERES, blocks, distanceAt, speedAt, timeAt, type Pane} from '../src/arcade/games/glass/logic.js';
import {displayWidth} from '../src/util/text.js';
import {STEP, checkRenders, context, memory} from './arcadeBatch3Kit.js';

const pane = (id: number, x: number, over: Partial<Pane> = {}): Pane => ({id, x, base: 0, height: 4, kind: 'glass', hp: 1, broken: false, bob: undefined, ...over});
type Outcome = ReturnType<GlassState['shotOutcome']>;
const apply = (state: GlassState, target: unknown): void => (state as never as {apply(t: unknown): void}).apply(target);

/** A perfect shooter: aims at the first blocker or crystal ahead using the arc prediction, and throws when a hit is certain. */
const pending = new WeakMap<GlassState, Map<number, number>>();
function shooter(state: GlassState): void {
  if (state.cooldown > 0 || state.spheres <= 0 || Math.round(state.time * 60) % 6 !== 0) return;
  const sent = pending.get(state) ?? new Map<number, number>();
  pending.set(state, sent);
  const things = [
    ...state.panes.filter(p => !p.broken && p.kind !== 'canopy' && p.x > state.x).map(p => ({id: p.id, need: p.hp, x: p.x, match: (t: Outcome) => t?.kind === 'pane' && t.pane === p})),
    ...state.crystals.filter(c => !c.taken && c.x > state.x).map(c => ({id: c.id, need: 1, x: c.x, match: (t: Outcome) => t?.kind === 'crystal' && t.crystal === c})),
  ].sort((a, b) => a.x - b.x).slice(0, 3);
  for (const thing of things) {
    if (thing.x - state.x > 55) break;
    if ((sent.get(thing.id) ?? 0) >= thing.need) continue;
    for (let angle = AIM_MIN; angle <= AIM_MAX; angle += 2) {
      if (!thing.match(state.shotOutcome(angle))) continue;
      state.setAim(angle);
      state.fire();
      sent.set(thing.id, (sent.get(thing.id) ?? 0) + 1);
      return;
    }
  }
}

test('ballistics: a sphere rises and falls along its arc, throws cost a sphere and wait for the cooldown, aim is clamped', () => {
  const state = new GlassState(createRng(1));
  state.panes = []; state.crystals = []; state.started = true;
  state.setAim(30);
  state.fire();
  const vy0 = state.flying[0]!.vy;
  let peak = 0, last = 0;
  for (let i = 0; i < 150; i += 1) { state.step(STEP); if (state.flying[0]) { peak = Math.max(peak, state.flying[0].y); last = state.flying[0].y; } }
  assert.ok(vy0 > 0);
  assert.ok(peak > 2, 'rises');
  assert.ok(last < peak, 'and falls again');
  assert.equal(state.spheres, START_SPHERES - 1);
  state.fire();
  assert.equal(state.fire(), false, 'cooldown');
  assert.ok(COOLDOWN_S > 0.1);
  state.setAim(-100); assert.equal(state.aim, AIM_MIN);
  state.setAim(100); assert.equal(state.aim, AIM_MAX);
});

test('collision: a sphere breaks the pane it crosses within its height and flies over a short one', () => {
  const run = (target: Pane, aim: number) => {
    const state = new GlassState(createRng(2));
    state.panes = [target]; state.crystals = []; state.started = true;
    state.setAim(aim);
    state.fire();
    for (let i = 0; i < 120; i += 1) state.step(STEP);
    return state;
  };
  assert.equal(run(pane(1, 20), 4).shattered, 1);
  assert.equal(run(pane(1, 20, {height: 1.0}), 40).shattered, 0);
});

test('tough glass takes two hits; resonant glass rings every pane in range and carries on; plain glass does not carry', () => {
  const state = new GlassState(createRng(3));
  state.crystals = []; state.started = true;
  state.panes = [pane(1, 20, {kind: 'tough', hp: 2})];
  apply(state, {kind: 'pane', pane: state.panes[0]});
  assert.equal(state.panes[0]!.broken, false);
  assert.ok(state.events.some(e => e.kind === 'crack'));
  apply(state, {kind: 'pane', pane: state.panes[0]});
  assert.equal(state.panes[0]!.broken, true);

  state.events = []; state.shattered = 0; state.bonus = 0;
  state.panes = [pane(1, 20, {kind: 'resonant'}), pane(2, 20 + CHAIN_RANGE - 1, {kind: 'resonant'}), pane(3, 20 + 2 * CHAIN_RANGE - 2, {kind: 'glass'}), pane(4, 20 + 3 * CHAIN_RANGE, {kind: 'glass'})];
  apply(state, {kind: 'pane', pane: state.panes[0]});
  assert.deepEqual(state.panes.map(p => p.broken), [true, true, true, false]);
  assert.equal(state.shattered, 3);
  assert.equal(state.bestChain, 3);
  assert.equal(state.bonus, 40);
  assert.ok(state.events.some(e => e.kind === 'chain' && e.size === 3));

  state.panes = [pane(1, 20, {kind: 'glass'}), pane(2, 23, {kind: 'glass'})];
  apply(state, {kind: 'pane', pane: state.panes[0]});
  assert.deepEqual(state.panes.map(p => p.broken), [true, false]);
});

test('spheres: glass that reaches the cat costs spheres, crystals refill, none left and nothing flying ends the run', () => {
  const state = new GlassState(createRng(4));
  state.crystals = []; state.started = true;
  state.panes = [pane(1, state.x + 3)];
  state.time = timeAt(state.x + 3) - 0.05;
  for (let i = 0; i < 10; i += 1) state.step(STEP);
  assert.equal(state.spheres, START_SPHERES - SMASH_COST);
  state.crystals = [{id: 99, x: state.x + 15, y: 2, taken: false}];
  state.panes = [];
  let got = false;
  for (let a = AIM_MIN; a <= AIM_MAX && !got; a += 1) { if (state.shotOutcome(a)?.kind === 'crystal') { state.setAim(a); got = true; } }
  assert.ok(got, 'a crystal in range can be hit');
  const before = state.spheres;
  state.fire();
  for (let i = 0; i < 120; i += 1) state.step(STEP);
  assert.equal(state.spheres, before - 1 + CRYSTAL_GAIN);
  const dry = new GlassState(createRng(5));
  dry.started = true; dry.spheres = 1; dry.panes = []; dry.crystals = [];
  dry.fire();
  assert.equal(dry.alive, true, 'a sphere in flight keeps the run going');
  for (let i = 0; i < 300 && dry.alive; i += 1) dry.step(STEP);
  assert.equal(dry.alive, false);
  assert.ok(dry.events.some(e => e.kind === 'dry'));
  assert.equal(dry.fire(), false);
});

test('a canopy never blocks; a bobbing pane always blocks', () => {
  assert.equal(blocks(pane(1, 10, {kind: 'canopy', base: 2.4, height: 2}), 0), false);
  const bob = pane(2, 10, {base: -1, height: 2.4, bob: {amp: 1.2, freq: 2, phase: 0}});
  for (let t = 0; t < 10; t += 0.05) assert.equal(blocks(bob, t), true);
});

test('fairness: groups are spaced, ringing chains cover the whole group, and every kind appears, over 100 seeds', () => {
  const kinds = new Set<string>();
  let bobbing = 0;
  for (let seed = 1; seed <= 100; seed += 1) {
    const state = new GlassState(createRng(seed));
    state.started = true;
    for (let k = 0; k < 8; k += 1) { state.time += 40; (state as never as {fill(): void}).fill(); }
    const panes = [...state.panes].sort((a, b) => a.x - b.x);
    assert.ok(panes.length > 30);
    const blockers = panes.filter(p => p.kind !== 'canopy');
    blockers.forEach((p, i) => {
      kinds.add(p.kind); if (p.bob) bobbing += 1;
      const prev = blockers[i - 1];
      if (!prev) return;
      if (p.x - prev.x <= CHAIN_RANGE) assert.equal(prev.kind, 'resonant', `seed ${seed}: a close pane must follow a ringing one`);
      else assert.ok(timeAt(p.x) - timeAt(prev.x) >= GROUP_GAP_S - 1e-6, `seed ${seed}: groups ${(p.x - prev.x).toFixed(1)} m apart`);
    });
    state.crystals.forEach(c => { assert.ok(c.y >= 1.2 && c.y <= 4.2); });
    assert.ok(state.crystals.length >= panes.length / 10);
  }
  assert.deepEqual([...kinds].sort(), ['glass', 'resonant', 'tough']);
  assert.ok(bobbing > 10);
});

test('fairness: a perfect shooter plays 120 s on each of 30 seeds without running dry or being hit', () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const state = new GlassState(createRng(seed));
    state.started = true;
    let smashes = 0;
    for (let t = 0; t < 120_000 && state.alive; t += STEP) {
      shooter(state);
      state.step(STEP);
      smashes += state.events.filter(e => e.kind === 'smash').length;
      state.events.length = 0;
    }
    assert.equal(smashes, 0, `seed ${seed}: ${smashes} smashes`);
    assert.ok(state.alive, `seed ${seed}: ran dry at ${state.meters} m`);
    assert.ok(state.shattered > 20 && state.thrown > 20);
  }
});

test('determinism: same seed same course, speed ramps, distance integrates', () => {
  assert.deepEqual(new GlassState(createRng(8)).panes, new GlassState(createRng(8)).panes);
  assert.notDeepEqual(new GlassState(createRng(8)).panes, new GlassState(createRng(9)).panes);
  assert.ok(speedAt(60) > speedAt(0));
  assert.ok(Math.abs(timeAt(distanceAt(33)) - 33) < 1e-6);
});

test('game: keys, aim, pause and restart safety, record saving and celebration', () => {
  type G = {key(k: unknown): string; step(d: number): void; animate(d: number): void; pause(): void; status: string; result: {score: number; record: boolean; details: string[]} | undefined; state: GlassState; popups: {count: number}; dispose(): void};
  const run = (seed: number, record = memory()) => {
    const game = glassGame.create(context(record, {rng: createRng(seed), seed})) as never as G;
    assert.equal(game.status, 'ready');
    assert.equal(game.key({kind: 'text', value: 'q'}), 'ignored');
    game.key({kind: 'text', value: ' '});
    assert.equal(game.status, 'playing');
    assert.equal(game.state.spheres, START_SPHERES, 'the first Space starts, it does not throw');
    const aim = game.state.aim;
    game.key({kind: 'up'}); game.key({kind: 'text', value: 'w'});
    assert.ok(game.state.aim > aim);
    game.key({kind: 'down'});
    for (let t = 0; t < 300_000 && game.status !== 'over'; t += STEP) {
      if (t === 2000) { const before = JSON.stringify([game.state.time, game.state.spheres]); game.pause(); assert.equal(JSON.stringify([game.state.time, game.state.spheres]), before); }
      game.step(STEP); game.animate(STEP);
    }
    return {game, record};
  };
  const a = run(3), b = run(3);
  assert.equal(a.game.status, 'over');
  assert.deepEqual(a.game.result, b.game.result);
  assert.equal(a.record.raw().plays, 1);
  assert.equal(a.record.raw().best, a.game.result?.score);
  assert.equal(a.game.result?.record, true);
  assert.equal(a.game.key({kind: 'up'}), 'ignored');
  const beaten = run(3, memory({best: 1_000_000, plays: 1}));
  assert.equal(beaten.game.result?.record, false);
  assert.equal(beaten.record.raw().best, 1_000_000);
  const mid = glassGame.create(context(memory({best: 3, plays: 1}))) as never as G;
  mid.key({kind: 'text', value: ' '});
  for (let i = 0; i < 90; i += 1) mid.step(STEP);
  assert.ok(mid.popups.count >= 1);
  const thrower = glassGame.create(context(memory())) as never as G;
  thrower.key({kind: 'text', value: ' '}); thrower.key({kind: 'text', value: ' '});
  assert.equal(thrower.state.spheres, START_SPHERES - 1);
  for (let i = 0; i < 20; i += 1) thrower.step(STEP);
  thrower.key({kind: 'text', value: 'f'});
  assert.equal(thrower.state.spheres, START_SPHERES - 2);
});

test('render: every size, color level, Safe Glyphs and Reduced Motion draws inside its bounds, mid-throw', () => {
  checkRenders(glassGame, game => {
    game.key({kind: 'text', value: ' '});
    for (let i = 0; i < 400; i += 1) { if (i % 15 === 0) game.key({kind: 'text', value: ' '}); if (i % 50 === 0) game.key({kind: 'up'}); game.step(STEP); game.animate(STEP); }
  });
  const preview = new Canvas(40, 12);
  glassGame.preview(preview, 9, arcadePalette());
  for (const line of preview.plain()) assert.ok(displayWidth(line) <= 40);
});
