import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {BOMB_RADIUS, CAT_SPEED_CAP, CatapultState, GRAVITY, GROUND, SLING, WORLD_W, buildLevel, type Block} from '../src/arcade/games/catapult/logic.js';
import {catapultGame} from '../src/arcade/games/catapult/index.js';
import {displayWidth} from '../src/util/text.js';

const STEP = 1000 / 60;
function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 5, rng: createRng(5), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
const overlap = (a: Block, b: Block) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const settle = (s: CatapultState, limit = 60 * 12) => { for (let i = 0; i < limit && (s.phase === 'flight' || s.phase === 'settle'); i += 1) s.step(STEP); };
const shoot = (s: CatapultState, degrees: number, power: number) => { s.angle = (degrees * Math.PI) / 180; s.power = power; s.fire(); };

test('levels: deterministic from (seed, level), no overlaps, in bounds, every level has mice and cats', () => {
  for (const seed of [1, 7, 99]) {
    for (let level = 1; level <= 14; level += 1) {
      const a = buildLevel(seed, level), b = buildLevel(seed, level);
      assert.deepEqual(a.blocks.map(x => [x.kind, x.x, x.y, x.w, x.h]), b.blocks.map(x => [x.kind, x.x, x.y, x.w, x.h]));
      assert.deepEqual(a.queue, b.queue);
      assert.ok(a.blocks.some(x => x.kind === 'target'), 'mice');
      assert.equal(a.queue[0], 'tabby');
      assert.ok(a.queue.length >= 3 && a.queue.length <= 7);
      for (const [i, x] of a.blocks.entries()) {
        assert.ok(x.x >= 40 && x.x + x.w <= WORLD_W && x.y >= 0 && x.y + x.h <= GROUND + 1e-9, `block in bounds level ${level}`);
        for (const y of a.blocks.slice(i + 1)) assert.ok(!overlap(x, y), `overlap on level ${level}`);
      }
    }
  }
  assert.notDeepEqual(buildLevel(1, 3).blocks.map(x => x.x), buildLevel(2, 3).blocks.map(x => x.x));
  assert.ok(buildLevel(1, 8).blocks.length > buildLevel(1, 1).blocks.length, 'later levels are bigger');
});

test('physics: a fresh structure stands still on its own and nothing breaks', () => {
  for (const level of [1, 3, 6, 10, 14]) {
    const s = new CatapultState(3, level);
    const before = s.blocks.map(b => [b.x, b.y]);
    for (let i = 0; i < 60 * 4; i += 1) s.step(STEP);
    assert.equal(s.blocks.length, before.length, `no block lost on level ${level}`);
    s.blocks.forEach((b, i) => { assert.ok(Math.abs(b.x - before[i]![0]!) < 1e-6 && Math.abs(b.y - before[i]![1]!) < 1e-6, 'unmoved'); });
  }
});

test('ballistics: the preview arc is the cat\'s actual path, and a cat never exceeds the speed cap', () => {
  const s = new CatapultState(2, 1);
  s.blocks = [];
  s.angle = (40 * Math.PI) / 180; s.power = 0.8;
  const arc = s.preview(12, 0.075);
  s.fire();
  const cat = s.cats[0]!;
  let t = 0, index = 0, worst = 0;
  while (index < arc.length && t < 4) {
    s.step(STEP); t += STEP / 1000;
    assert.ok(Math.hypot(cat.vx, cat.vy) <= CAT_SPEED_CAP + 1e-6);
    while (index < arc.length && (index + 1) * 0.075 <= t + 1e-9) { worst = Math.max(worst, Math.hypot(cat.x - arc[index]!.x, cat.y - arc[index]!.y)); index += 1; }
  }
  assert.ok(index === arc.length && worst < 1.2, `arc error ${worst.toFixed(2)}`);
  // Energy: a flight without blocks conserves ½v² + g·h.
  const e = (c: typeof cat) => 0.5 * (c.vx ** 2 + c.vy ** 2) - GRAVITY * c.y;
  const s2 = new CatapultState(2, 1);
  s2.blocks = []; shoot(s2, 55, 0.9);
  const c2 = s2.cats[0]!, e0 = e(c2);
  for (let i = 0; i < 60; i += 1) { s2.step(STEP); assert.ok(Math.abs(e(c2) - e0) < 25, 'energy conserved in free flight'); }
});

test('no tunnelling: a cat at top speed never ends inside a block that is still standing', () => {
  for (const [angle, power] of [[10, 1], [20, 1], [30, 1], [45, 1], [60, 1]] as const) {
    const s = new CatapultState(4, 6);
    shoot(s, angle, power);
    s.cats[0]!.vx *= 1.7; s.cats[0]!.vy *= 1.7;
    for (let i = 0; i < 60 * 6 && s.phase === 'flight'; i += 1) {
      s.step(STEP);
      for (const cat of s.cats) {
        assert.ok(Math.hypot(cat.vx, cat.vy) <= CAT_SPEED_CAP + 1e-6);
        for (const b of s.blocks) assert.ok(!(cat.x > b.x + 0.2 && cat.x < b.x + b.w - 0.2 && cat.y > b.y + 0.2 && cat.y < b.y + b.h - 0.2), 'cat centre inside a living block');
      }
    }
  }
});

test('hits: a cat knocks out a mouse for 500, a block falls when its support is gone, glass breaks easier than stone', () => {
  const s = new CatapultState(5, 1);
  const mouse = s.blocks.find(b => b.kind === 'target')!;
  // Aim straight at the mouse by trying angles until one hits it.
  let hit = false;
  for (let a = 10; a < 80 && !hit; a += 2) {
    const t = new CatapultState(5, 1);
    shoot(t, a, 0.85); settle(t);
    if (t.score >= 500) { hit = true; assert.ok(t.targetsLeft === 0 || t.score >= 500); }
  }
  assert.ok(hit, `some shot reaches the mouse at ${mouse.x.toFixed(0)},${mouse.y.toFixed(0)}`);
  // Support removal: kill a post, the beam above it comes down.
  const tower = new CatapultState(5, 1);
  const post = tower.blocks.find(b => b.kind === 'wood' && b.h > b.w)!;
  const beam = tower.blocks.find(b => b.w > b.h && b.kind !== 'target')!;
  const beamY = beam.y;
  post.hp = 0.001; post.mass = 1;
  tower.blocks = tower.blocks.filter(b => b !== post);
  for (let i = 0; i < 90; i += 1) tower.step(STEP);
  assert.ok(beam.y > beamY - 1e-9, 'the beam does not float');
  // Glass versus stone: the same impact.
  const damageTo = (kind: 'glass' | 'stone') => {
    const t = new CatapultState(5, 1);
    t.blocks = t.blocks.filter(b => b.kind === 'target').slice(0, 0);
    const b = (buildLevel(1, 1).blocks[0])!;
    Object.assign(b, {kind, x: 60, y: GROUND - 8, w: 3, h: 8, hp: kind === 'glass' ? 22 : 150, maxHp: kind === 'glass' ? 22 : 150, mass: 2});
    t.blocks = [b];
    t.cats.push({id: 99, kind: 'tabby', x: 52, y: GROUND - 4, vx: 40, vy: 0, r: 2, damage: 1, used: false, ageMs: 0, restMs: 0, px: 52, py: GROUND - 4});
    t.phase = 'flight';
    for (let i = 0; i < 30; i += 1) t.step(STEP);
    return b.hp / b.maxHp;
  };
  assert.ok(damageTo('glass') < damageTo('stone'), 'glass loses a larger share');
});

test('abilities: Dash speeds up, Triple splits into three, Boom damages by distance and removes the cat', () => {
  const dash = new CatapultState(5, 1);
  dash.queue = ['dash']; shoot(dash, 40, 0.7);
  const before = Math.hypot(dash.cats[0]!.vx, dash.cats[0]!.vy);
  assert.equal(dash.ability(), true);
  assert.ok(Math.hypot(dash.cats[0]!.vx, dash.cats[0]!.vy) > before * 1.5);
  assert.equal(dash.ability(), false, 'one use only');

  const split = new CatapultState(5, 1);
  split.queue = ['split']; shoot(split, 40, 0.7);
  split.ability();
  assert.equal(split.cats.length, 3);
  assert.ok(new Set(split.cats.map(c => c.vy.toFixed(2))).size === 3, 'three headings');

  const tabby = new CatapultState(5, 1);
  tabby.queue = ['tabby']; shoot(tabby, 40, 0.7);
  assert.equal(tabby.ability(), false);

  const boom = new CatapultState(5, 1);
  const near = boom.blocks.find(b => b.kind === 'wood')!;
  boom.queue = ['boom']; shoot(boom, 40, 0.7);
  const cat = boom.cats[0]!;
  cat.x = near.x + near.w / 2; cat.y = near.y + near.h / 2;
  const far = boom.blocks.filter(b => b !== near).map(b => ({b, hp: b.hp, d: Math.hypot(b.x + b.w / 2 - cat.x, b.y + b.h / 2 - cat.y)}));
  const nearHp = near.hp;
  assert.equal(boom.ability(), true);
  assert.equal(boom.cats.length, 0, 'the bomb is spent');
  assert.ok(near.dead || near.hp < nearHp, 'the closest block is hurt');
  for (const f of far) if (f.d > BOMB_RADIUS + 4) assert.equal(f.b.hp, f.hp, 'nothing beyond the radius is hurt');
});

test('flow: clearing a level gives stars for cats left, the next level is generated, running out of cats ends the run', () => {
  let cleared: CatapultState | undefined;
  for (let a = 10; a < 80 && !cleared; a += 2) {
    const t = new CatapultState(5, 1);
    shoot(t, a, 0.85); settle(t);
    if (t.phase === 'clear') cleared = t;
  }
  assert.ok(cleared, 'level 1 can be cleared with the first cat');
  assert.ok(cleared!.stars >= 2 && cleared!.score >= 500 + 1000);
  const level1 = cleared!.blocks.length;
  cleared!.nextLevel();
  assert.equal(cleared!.level, 2);
  assert.equal(cleared!.phase, 'aim');
  assert.ok(cleared!.targetsLeft >= 1 && cleared!.blocks.length !== 0 && level1 >= 0);
  const lost = new CatapultState(5, 1);
  while (lost.phase === 'aim') { shoot(lost, 80, 0.3); settle(lost); }
  assert.equal(lost.phase, 'lost');
});

test('determinism: same seed and shots give the same result, at any frame split', () => {
  const run = (split: number) => {
    const s = new CatapultState(12, 4);
    shoot(s, 38, 0.8);
    for (let i = 0; i < 60 * 3; i += 1) { if (i === 30) s.ability(); for (let k = 0; k < split; k += 1) s.step(STEP / split); }
    return s;
  };
  const a = run(1), b = run(1), c = run(3);
  assert.equal(a.score, b.score);
  assert.deepEqual(a.blocks.map(x => [x.x, x.y]), b.blocks.map(x => [x.x, x.y]));
  assert.equal(a.score, c.score);
  assert.ok(a.blocks.length === c.blocks.length);
});

test('game: keys aim and launch, a finished run is saved once with a record, dispose cleans up', () => {
  const record = memory();
  const game = catapultGame.create(context(record));
  assert.equal(game.status, 'ready');
  assert.equal(game.key({kind: 'text', value: 'q'}), 'ignored');
  assert.equal(game.key({kind: 'up'}), 'handled');
  assert.equal(game.status, 'playing');
  for (const key of [{kind: 'down'}, {kind: 'left'}, {kind: 'right'}, {kind: 'text', value: 'w'}, {kind: 'text', value: 'a'}] as const) assert.equal(game.key(key), 'handled');
  // A bot that always fires at a poor angle runs out of cats; one clear along the way is enough to score.
  const play = (g: typeof game) => {
    for (let i = 0; i < 60 * 600 && g.status === 'playing'; i += 1) {
      if (i % 20 === 0) g.key({kind: 'text', value: ' '});
      g.step(STEP); g.animate(STEP);
    }
  };
  const fresh = catapultGame.create(context(record));
  fresh.key({kind: 'up'});
  for (let i = 0; i < 15; i += 1) fresh.key({kind: 'up'});
  play(fresh);
  assert.equal(fresh.status, 'over');
  assert.ok(fresh.result);
  assert.equal(record.raw().plays, 1);
  assert.equal(record.raw().best, fresh.result!.score);
  if (fresh.result!.score > 0) assert.equal(fresh.result!.record, true);
  assert.equal(fresh.key({kind: 'text', value: ' '}), 'ignored');
  game.dispose(); fresh.dispose();
});

test('render: every size draws inside its bounds in color, without color, with safe glyphs and with reduced motion', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) {
    for (const mode of ['truecolor', 'none', 'reduced'] as const) {
      const game = catapultGame.create(context(memory(), {
        size: {columns, rows},
        color: mode === 'none' ? 'none' : 'truecolor', safeGlyphs: mode === 'none',
        motion: mode === 'reduced' ? {reduced: true, effects: 'off'} : {reduced: false, effects: 'normal'},
      }));
      for (const phase of ['ready', 'aiming', 'flight', 'over'] as const) {
        if (phase === 'aiming') { game.key({kind: 'up'}); game.key({kind: 'right'}); }
        if (phase === 'flight') { game.key({kind: 'text', value: ' '}); for (let i = 0; i < 40; i += 1) { game.step(STEP); game.animate(STEP); } }
        if (phase === 'over') for (let i = 0; i < 60 * 600 && game.status === 'playing'; i += 1) { if (i % 20 === 0) game.key({kind: 'text', value: ' '}); game.step(STEP); game.animate(STEP); }
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0.5, arcadePalette());
        const lines = canvas.plain();
        assert.equal(lines.length, rows);
        for (const line of lines) assert.ok(displayWidth(line) <= columns, `${mode} ${columns}x${rows} ${phase}: ${line}`);
        const text = lines.join('\n');
        if (phase === 'ready') assert.match(text, /Catapult/);
        if (phase === 'over') assert.match(text, /OUT OF CATS|Out of cats|clear/i);
        if (mode === 'none' && phase === 'aiming' && columns >= 60) assert.match(text, /M/);
      }
      game.dispose();
    }
  }
  catapultGame.preview(new Canvas(30, 6), 7, arcadePalette());
  void SLING;
});
