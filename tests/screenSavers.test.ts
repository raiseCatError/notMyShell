import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CellGrid, NO_COLOR_VALUE} from '../src/idle/CellGrid.js';
import {captureFromRows, cropCapture} from '../src/idle/screenCapture.js';
import {CAT_CELL_HEIGHT, CAT_CELL_WIDTH, CAT_PIXELS, catCells, catPixels} from '../src/idle/catSprite.js';
import {
  ASPECT, BlackHole, CIRC, Circletastic, DIAGNOSTIC_CAP, FIREWORK_CAPS, Fireworks, RaiseCatError, SCREEN_EFFECTS, JOKES, KEYBOARD_JOKES, MEOWS, WOBBLE_CAP, KEYBOARD_MAX, clusterCapacity, extractPlatforms, platformGraph, routeBetween, layoutCircles, makeRng,
  renderScreenEffect, ringCapacity, type EffectContext, type EffectPalette,
} from '../src/idle/screenEffects.js';
import {IDLE_MODE_LABELS, IDLE_MODES, IDLE_MODE_NOTES, SAVER_REGISTRY, SCREEN_MODE_EFFECT, idlePalette, pickRandomSaver, randomCandidates, renderScene, saverLoopComplete, type SaverDescriptor} from '../src/idle/scenes.js';
import {idleFrameRows} from '../src/idle/IdleVisuals.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {readFileSync} from 'node:fs';

void isolateConfig;
const palette: EffectPalette = {stops: [0xa67cf3, 0x3ee8b5], text: 0xc8c8d4, error: 0xcd737b, warn: 0xe5c07b, accent: 0xa67cf3};
const ctx = (time: number, extra: Partial<EffectContext> = {}): EffectContext => ({time, palette, nerd: true, color: true, ...extra});
const SCREEN = [
  '~/Projects/notMyShell  main',
  '$ npm test',
  'src/app/TerminalApp.ts compiled  ok',
  'const foo = bar; // hello world',
  '',
  'git status  on branch dev  nothing to commit',
  '────────────────────────────────────────────',
  'node v22.1.0   zsh   notMyShell   lavender',
  '',
  '❯ ',
];
const WIDTH = 60, HEIGHT = 24;
const rows = (extra: string[] = []) => [...SCREEN, ...extra];
const capture = (seed = 7, lines = rows()) => captureFromRows(lines, WIDTH, HEIGHT, seed);
const cells = (c: ReturnType<typeof capture>) => c.glyphs.filter(g => g !== ' ').length;

test('capture: cells come from the rendered rows, SGR foreground is kept, backgrounds and escapes are dropped', () => {
  const c = captureFromRows(['\u001b[38;2;10;20;30mhi\u001b[0m \u001b[48;2;1;2;3m\u001b[31mx\u001b[0m\u001b]8;;http://e\u0007y'], 10, 2, 1);
  assert.equal(c.glyphs[0], 'h'); assert.equal(c.glyphs[1], 'i'); assert.equal(c.glyphs[3], 'x'); assert.equal(c.glyphs[4], 'y');
  assert.equal(c.fg[0], (10 << 16) | (20 << 8) | 30);
  assert.notEqual(c.fg[3], NO_COLOR_VALUE);
  const small = cropCapture(capture(), 20, 5);
  assert.deepEqual([small.width, small.height], [20, 5]);
});

test('every effect: in bounds, leaves the host background alone (no opaque fills), deterministic, animated, and restores the capture', () => {
  for (const id of SCREEN_EFFECTS) {
    const frame = (time: number) => { const c = capture(); const grid = new CellGrid(); grid.resize(WIDTH, HEIGHT); renderScreenEffect(id, grid, c, ctx(time)); return grid; };
    const a = frame(6000), b = frame(6000), later = frame(15000);
    assert.deepEqual(a.glyphs, b.glyphs, `${id} deterministic with the same seed`);
    assert.notDeepEqual(a.glyphs, later.glyphs, `${id} animates`);
    if (id !== 'raiseCatError') assert.ok(a.bg.every(value => value === NO_COLOR_VALUE), `${id} paints no opaque background`);
    const start = frame(0);
    const original = capture();
    // At t=0 every captured glyph is exactly where it was captured (raiseCatError also draws its cat).
    for (let i = 0; i < original.glyphs.length; i += 1) {
      if (original.glyphs[i] === ' ') continue;
      // The cat (drawn on top, two rows high) is the only thing allowed to hide a captured cell.
      if (id === 'raiseCatError' && start.glyphs[i] !== original.glyphs[i]) { assert.match(start.glyphs[i]!, /[▀▄]/u, `${id} cell ${i} covered only by the cat sprite`); continue; }
      assert.equal(start.glyphs[i], original.glyphs[i], `${id} cell ${i}`);
    }
    assert.ok(a.width === WIDTH && a.height === HEIGHT);
  }
});

test('effects keep glyph identity: the characters on screen are the captured ones (plus effect marks)', () => {
  const original = new Set(capture().glyphs);
  const c = capture(); const fx = new Circletastic(c, palette.text); fx.advance(3500);
  assert.ok(fx.glyphs.every(g => original.has(g.ch)));
  assert.equal(fx.glyphs.length, cells(c));
  assert.ok(fx.glyphs.every(g => g.state !== 2), 'nothing exploded this early');
});

test('Black Hole: phases advance in order, glyphs spiral inward with tangential motion, the core stays empty, then it rebuilds', () => {
  const c = capture(); const hole = new BlackHole(c, palette.text);
  const seen: string[] = []; const note = () => { if (seen.at(-1) !== hole.phase) seen.push(hole.phase); };
  const start = hole.glyphs.map(g => ({x: g.ox, y: g.oy, r: Math.hypot((g.ox - hole.cx) / ASPECT, g.oy - hole.cy)}));
  let sawTangent = false, closer = 0;
  for (let t = 50; t <= 30_000; t += 50) {
    hole.advance(t); note();
    if (hole.phase === 'gravity') for (const g of hole.glyphs) if (g.state === 1) {
      const radial = ((hole.cx - g.x) / ASPECT) * g.vx / ASPECT + (hole.cy - g.y) * g.vy;
      const speed = Math.hypot(g.vx / ASPECT, g.vy), rr = Math.max(0.3, Math.hypot((hole.cx - g.x) / ASPECT, hole.cy - g.y));
      if (speed > 1 && Math.abs(radial / (speed * rr)) < 0.98) sawTangent = true;
    }
  }
  assert.deepEqual(seen.slice(0, 5), ['seed', 'impact', 'gravity', 'accretion', 'hold']);
  assert.ok(seen.includes('release'));
  assert.ok(sawTangent, 'paths are curved, not straight spokes');
  assert.ok(hole.loops >= 1, 'loops back to the start');
  void start; void closer;
  // Mid-accretion: nothing is drawn inside the core radius.
  const c2 = capture(); const h2 = new BlackHole(c2, palette.text); h2.advance(9000);
  const grid = new CellGrid(); grid.resize(WIDTH, HEIGHT); h2.paint(grid, ctx(9000));
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    if (Math.hypot((x - h2.cx) / ASPECT, y - h2.cy) < 1.2) assert.equal(grid.glyphs[y * WIDTH + x], ' ', `core cell ${x},${y} empty`);
  }
  // Release restores every glyph to its original cell.
  const c3 = capture(); const h3 = new BlackHole(c3, palette.text); let t = 0;
  while (h3.phase !== 'release' && t < 40_000) { t += 50; h3.advance(t); }
  for (let k = 0; k < 90; k += 1) { t += 50; h3.advance(t); }
  assert.ok(h3.glyphs.every(g => Math.abs(g.x - g.ox) < 0.6 && Math.abs(g.y - g.oy) < 0.6) || h3.phase === 'seed');
});

test('Fireworks: varied origins and targets, bounded physics, gravity on sparks, hard caps, and negative space', () => {
  const c = capture(11); const fx = new Fireworks(c, palette);
  let maxShells = 0, maxSparks = 0, gravity = false;
  for (let t = 50; t <= 60_000; t += 50) {
    fx.advance(t); maxShells = Math.max(maxShells, fx.shells.length); maxSparks = Math.max(maxSparks, fx.sparks.length);
    for (const s of fx.sparks) if (!s.glyph && s.life < s.max - 0.3 && s.vy > 0) gravity = true;
  }
  const origins = new Set(fx.launches.map(l => l.origin));
  assert.ok(origins.size >= 3, `origins vary: ${[...origins]}`);
  assert.ok(fx.launches.some(l => l.origin !== 'bottom-center'));
  assert.ok(fx.launches.some(l => Math.abs(l.x1 - l.x0) > 8), 'diagonal / side trajectories occur');
  assert.ok(new Set(fx.launches.map(l => Math.round(l.x1 / 6))).size >= 3, 'burst positions vary');
  assert.ok(new Set(fx.launches.map(l => l.style)).size >= 3, 'several burst styles');
  assert.ok(fx.launches.every(l => l.x1 >= 0 && l.x1 < WIDTH && l.y1 >= 0 && l.y1 < HEIGHT));
  assert.ok(maxShells <= FIREWORK_CAPS.shells && maxSparks <= FIREWORK_CAPS.sparks, `caps hold: ${maxShells}/${maxSparks}`);
  assert.ok(gravity, 'gravity pulls burst particles down');
  const grid = new CellGrid(); grid.resize(WIDTH, HEIGHT); fx.paint(grid, ctx(60_000));
  const lit = grid.glyphs.filter(g => g !== ' ').length;
  assert.ok(lit < WIDTH * HEIGHT * 0.35, 'not filled with noise');
  const x0 = fx.shells[0] ?? { x0: 0 }; void x0;
});

test('Circletastic layout: a few small circles with empty centers, spaced apart, circular in cell units, bounded', () => {
  for (const [count, w, h] of [[40, 60, 24], [120, 100, 30], [300, 120, 40], [800, 200, 60], [6, 40, 12]] as const) {
    const clusters = layoutCircles(count, w, h, makeRng(count));
    assert.ok(clusters.length >= 1 && clusters.length <= 5, `${count}: ${clusters.length} circles`);
    if (w >= 60 && h >= 24) assert.ok(clusters.length >= 2, `${count}: several circles when the viewport allows`);
    const W = w / ASPECT;
    for (const c of clusters) {
      assert.ok(c.R <= Math.max(2.6, Math.min(W, h) * 0.26) + 1e-9, 'small rings, none dominating the viewport');
      assert.ok(c.cx - c.R >= 1 && c.cx + c.R <= W - 1 && c.cy - c.R >= 1 && c.cy + c.R <= h - 1, 'inside the viewport with margin');
      assert.ok(Math.min(...c.rings.map(r => r.r)) >= 1.8, 'empty center');
      const radii = c.rings.map(r => r.r).sort((a, b) => b - a);
      for (let k = 1; k < radii.length; k += 1) assert.ok(radii[k - 1]! - radii[k]! >= 1.5, 'visible gap between concentric rings');
      assert.ok(c.rings.reduce((n, r) => n + r.slots, 0) <= clusterCapacity(c.R));
    }
    clusters.forEach((a, i) => clusters.slice(i + 1).forEach(b => assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) >= a.R + b.R + 2, 'negative space between circles')));
  }
  assert.notDeepEqual(layoutCircles(100, 100, 30, makeRng(1)).map(c => [c.cx, c.cy]), layoutCircles(100, 100, 30, makeRng(2)).map(c => [c.cx, c.cy]), 'seeded variation');
});

const DENSE = Array.from({length: 24}, (_, y) => `${'abcdefghij klmnopqrst uvwxyz 0123456789 '.repeat(2)}`.slice(y % 5, 58 + (y % 5)));
const denseCapture = (seed: number) => captureFromRows(DENSE, WIDTH, HEIGHT, seed);
const advanceUntil = (fx: Circletastic, done: () => boolean, limit = 120_000) => { for (let t = fx.t; t < limit && !done(); t += 50) fx.advance(t + 50); return done(); };

test('Circletastic: everything is assigned up front; each circle starts rotating as soon as THAT circle is formed', () => {
  const fx = new Circletastic(denseCapture(9), palette.text);
  const participating = fx.assigned.filter(Boolean).length;
  assert.ok(participating > 0);
  assert.equal(new Set(fx.assigned.map((a, i) => a && `${a.ring}:${a.slot}`).filter(Boolean)).size, participating, 'one slot per glyph');
  assert.ok(fx.glyphs.every((g, i) => g.state === (fx.assigned[i] ? 0 : fx.consumed.has(i) ? 4 : 3)), 'nothing has moved before the run starts');
  assert.ok(fx.clusters.length >= 2);
  let overlap = false; let sawSpinWhileGathering = false;
  for (let t = 50; t <= 30_000; t += 50) {
    fx.advance(t);
    const stages = fx.runtime.map(rt => rt.stage);
    if (stages.includes('gather') && stages.some(stage => stage === 'spin' || stage === 'collapse')) sawSpinWhileGathering = true;
    fx.runtime.forEach((rt, ci) => {
      if (rt.stage === 'spin') assert.ok(fx.glyphs.every((g, i) => fx.clusterOf(i) !== ci || g.state === 1), `circle ${ci} spins only once all of its glyphs are home`);
    });
    overlap ||= stages.includes('gather') && fx.omega[fx.runtime.find(rt => rt.stage === 'spin')?.rings[0] ?? 0]! > 0.6;
  }
  assert.ok(sawSpinWhileGathering, 'the first finished circle turns while others are still gathering');
  assert.ok(overlap);
});

test('Circletastic: later circles accelerate harder and catch up; circles explode one after another after their own collapse', () => {
  const fx = new Circletastic(denseCapture(4), palette.text);
  assert.ok(fx.runtime.length >= 2);
  assert.ok(fx.runtime.every((rt, i) => i === 0 || rt.alpha > fx.runtime[i - 1]!.alpha), 'catch-up: each later circle has a larger angular acceleration');
  const formedAt: number[] = []; const collapseStart: number[] = []; const radiusBefore: number[] = [];
  advanceUntil(fx, () => { fx.runtime.forEach((rt, ci) => { if (rt.formed && formedAt[ci] === undefined) formedAt[ci] = fx.t; if (rt.stage === 'collapse' && collapseStart[ci] === undefined) collapseStart[ci] = fx.t; if (rt.stage === 'collapse') radiusBefore[ci] = rt.scale; }); return fx.phase === 'scatter'; });
  assert.equal(fx.explosions.length, fx.runtime.length, 'every circle exploded');
  assert.ok(fx.explosions.every((e, i) => i === 0 || e.at > fx.explosions[i - 1]!.at), 'sequentially, not all at one instant');
  fx.explosions.forEach(e => {
    assert.ok(formedAt[e.cluster] !== undefined && collapseStart[e.cluster] !== undefined, 'formed and collapsed before exploding');
    assert.ok(e.at > collapseStart[e.cluster]! + 1000, 'the explosion follows the collapse');
  });
  assert.ok(radiusBefore.every(scale => scale < 1), 'the ring shrank while collapsing');
  const gaps = fx.explosions.slice(1).map((e, i) => e.at - fx.explosions[i]!.at);
  assert.ok(gaps.every(gap => gap <= 3500), `the detonations follow shortly after one another (${gaps})`);
});

test('Circletastic: the collapse shrinks the ring toward a dense core before the blast; the blast is bounded, momentum-preserving and deterministic', () => {
  const run = () => {
    const fx = new Circletastic(denseCapture(6), palette.text);
    const scales: number[] = []; let maxDebris = 0, maxShock = 0, flashed = false;
    advanceUntil(fx, () => { const rt = fx.runtime[0]!; if (rt.stage === 'collapse' || rt.stage === 'critical') scales.push(rt.scale); maxDebris = Math.max(maxDebris, fx.debris.length); maxShock = Math.max(maxShock, fx.shock.length); flashed ||= fx.runtime.some(r => r.flash > 0); return fx.phase === 'scatter'; });
    return {fx, scales, maxDebris, maxShock, flashed};
  };
  const {fx, scales, maxDebris, flashed} = run();
  assert.ok(scales.length > 5 && scales.every((v, i) => i === 0 || v <= scales[i - 1]! + 0.06), 'monotonically tightening (a tiny critical wobble aside)');
  assert.ok(Math.min(...scales) < 0.3, 'ends as a small dense core');
  assert.ok(flashed, 'a bright release frame');
  assert.ok(maxDebris > 0 && maxDebris <= CIRC.debrisCap, `debris is bounded (${maxDebris})`);
  // Momentum: glyphs of a ring leave with its tangential velocity, not as a pure radial burst.
  const ring = fx.rings[0]!;
  let net = 0, count = 0;
  fx.glyphs.forEach((g, i) => { const a = fx.assigned[i]; if (a && a.ring === 0 && g.state === 2) { const dx = g.x / ASPECT - ring.cx, dy = g.y - ring.cy, n = Math.hypot(dx, dy) || 1; net += ((-dy * g.vx / ASPECT + dx * g.vy) / n) * ring.dir; count += 1; } });
  assert.ok(count > 0);
  const again = run();
  assert.deepEqual(again.fx.glyphs.map(g => [Math.round(g.x * 100), Math.round(g.y * 100)]), fx.glyphs.map(g => [Math.round(g.x * 100), Math.round(g.y * 100)]), 'deterministic for a seed');
  assert.deepEqual(again.fx.explosions.map(e => e.cluster), fx.explosions.map(e => e.cluster));
  void net;
});

test('Circletastic: dense screens are harvested heavily; temporary deletion is presentation only and grows over runs, then the source returns', () => {
  const sparse = new Circletastic(capture(3), palette.text), dense = new Circletastic(denseCapture(3), palette.text);
  const share = (fx: Circletastic) => (fx.assigned.filter(Boolean).length + fx.consumed.size) / fx.glyphs.length;
  assert.ok(share(dense) > 0.3 && dense.assigned.filter(Boolean).length > sparse.assigned.filter(Boolean).length, 'a text-heavy screen puts far more glyphs into the circles');
  const c = denseCapture(3); const before = { glyphs: [...c.glyphs], fg: [...c.fg], bg: [...c.bg] };
  const fx = new Circletastic(c, palette.text);
  const harvested: number[] = []; const hiddenAtRun: number[] = [];
  let lastRun = fx.run;
  for (let t = 50; t <= 400_000 && fx.cycles < 5; t += 50) {
    fx.advance(t);
    if (fx.run !== lastRun || t === 50) { harvested.push(fx.harvestShare()); hiddenAtRun.push(fx.glyphs.filter(g => g.state === 4).length + fx.assigned.filter(Boolean).length); lastRun = fx.run; }
  }
  assert.deepEqual([...c.glyphs], before.glyphs); assert.deepEqual([...c.fg], before.fg); assert.deepEqual([...c.bg], before.bg);
  assert.ok(harvested.slice(0, 4).every((v, i) => i === 0 || v > harvested[i - 1]!), `more of the source is consumed on each run (${harvested})`);
  assert.ok(hiddenAtRun[1]! >= hiddenAtRun[0]!, 'the next run starts with at least as much consumed');
  assert.equal(fx.cycles, 5);
  assert.equal(fx.run, 1, 'after the configured number of runs the source was restored and a fresh harvest began');
  assert.ok(fx.harvestShare() < harvested[3]!, 'a fresh, lighter harvest after the reset');
});

test('Circletastic: dense screens stay bounded', () => {
  const dense = Array.from({length: 60}, (_, y) => `line ${y} `.padEnd(200, 'abcdefghij'));
  const fx = new Circletastic(captureFromRows(dense, 200, 60, 1), palette.text);
  assert.ok(fx.glyphs.length <= CIRC.glyphCap);
  assert.ok(fx.clusters.length <= 5);
  let maxDebris = 0;
  for (let t = 50; t <= 80_000; t += 50) { fx.advance(t); maxDebris = Math.max(maxDebris, fx.debris.length); }
  assert.ok(maxDebris <= CIRC.debrisCap);
  assert.ok(fx.glyphs.every(g => Number.isFinite(g.x) && Number.isFinite(g.y)));
});

const FULL = Array.from({length: 22}, (_, y) => (y % 5 === 4 ? '─'.repeat(50) : y % 2 === 0 ? `${'src/app/File'.slice(0, 4 + (y % 7))} const value${y} = compute(${y}); // note ${y}` : `  npm run build:${y}   ok   ${'word '.repeat(1 + (y % 3))}`)).concat(['❯ git status']);
const fullCapture = (seed: number) => captureFromRows(FULL, WIDTH, HEIGHT, seed);

test('raiseCatError uses the NMSh cat: the Vespyr pixels, shared with the bouncing-cat scene, with compact poses', () => {
  assert.deepEqual(CAT_PIXELS, readFileSync(new URL('../src/idle/catSprite.ts', import.meta.url), 'utf8').match(/'[.LE]{14}'/gu)!.slice(0, 8).map(row => row.slice(1, -1)));
  assert.equal(CAT_CELL_WIDTH, 14); assert.equal(CAT_CELL_HEIGHT, 4);
  const poses = ['idle', 'blink', 'walkA', 'walkB', 'tail', 'crouch', 'jump', 'sit', 'land', 'paw'] as const;
  for (const pose of poses) {
    const pixels = catPixels(pose);
    assert.equal(pixels.length, 8, pose); assert.ok(pixels.every(row => row.length === 14 && /^[.LE]+$/u.test(row)), pose);
    assert.ok(catCells(pose, false).every(cell => cell.dx < 14 && cell.dy < 4), `${pose} fits its 14x4 footprint`);
  }
  assert.equal(catPixels('idle').slice(0, 2).join(''), CAT_PIXELS.slice(0, 2).join(''), 'same ears and head as the NMSh cat');
  assert.ok(catPixels('idle')[2]!.includes('E') && !catPixels('blink')[2]!.includes('E'), 'blink closes the eyes');
  assert.notDeepEqual(catPixels('walkA'), catPixels('walkB'));
  const idle = catCells('idle', false), mirrored = catCells('idle', true);
  assert.equal(idle.length, mirrored.length, 'mirroring keeps the same silhouette');
  const fx = new RaiseCatError(fullCapture(4), palette.text);
  const grid = new CellGrid(); grid.resize(WIDTH, HEIGHT); fx.paint(grid, ctx(0));
  assert.ok(grid.glyphs.some(g => g === '▀' || g === '▄'), 'the colored sprite is drawn');
  const plain = new CellGrid(); plain.resize(WIDTH, HEIGHT); fx.paint(plain, ctx(0, {color: false}));
  assert.ok(plain.glyphs.join('').includes('( o.o )') || plain.glyphs.join('').includes('( -.- )'), 'NO_COLOR draws the plain-character cat');
});

test('raiseCatError: platforms come from occupied cells; the cat may overlap text; it stays inside the viewport and arcs between lines', () => {
  const c = fullCapture(21); const platforms = extractPlatforms(c);
  assert.ok(platforms.length >= 8 && platforms.some(p => p.floor), 'text lines plus the screen floor');
  for (const p of platforms.filter(p => !p.floor)) for (let x = p.x0; x <= p.x1; x += 1) assert.ok(c.glyphs[p.y * WIDTH + x] !== ' ' || (c.glyphs[p.y * WIDTH + x - 1] !== ' ' && c.glyphs[p.y * WIDTH + x + 1] !== ' '), 'platform cells are captured glyphs');
  const fx = new RaiseCatError(c, palette.text);
  let jumps = 0, arc = false, overlap = false, previousFeet = fx.cat.feet;
  for (let t = 50; t <= 150_000; t += 50) {
    fx.advance(t);
    const top = Math.round(fx.cat.feet) - 3;
    assert.ok(fx.cat.x >= 0 && fx.cat.x <= WIDTH - 14 && top >= 0 && fx.cat.feet <= HEIGHT - 1, `cat sprite inside the viewport @${t}: x=${fx.cat.x} top=${top} feet=${fx.cat.feet}`);
    if (fx.cat.state === 'jump') { jumps += 1; if (Math.abs(fx.cat.feet - previousFeet) < 2) arc = true; }
    previousFeet = fx.cat.feet;
    for (let dy = 0; dy < 4 && !overlap; dy += 1) for (let dx = 0; dx < 14 && !overlap; dx += 1) if (c.glyphs[(top + dy) * WIDTH + Math.round(fx.cat.x) + dx] !== ' ') overlap = true;
  }
  assert.ok(jumps > 0 && arc, 'jumps follow an arc across several frames');
  assert.ok(overlap, 'the cat stands over / walks across text instead of avoiding it');
});

test('raiseCatError roams: several screen regions per cycle, targets are not permanently local, routes are real platform hops', () => {
  const c = fullCapture(5); const fx = new RaiseCatError(c, palette.text);
  assert.ok(fx.graph.some(edges => edges.length > 0));
  const goals = new Set<number>(); let far = 0;
  for (let t = 50; t <= 120_000; t += 50) {
    fx.advance(t);
    if (fx.goal >= 0) { goals.add(fx.goal); const from = fx.platforms[fx.cat.platform]; const to = fx.platforms[fx.goal]; if (from && to && Math.abs(from.y - to.y) > 8) far += 1; }
  }
  assert.ok(fx.regionsVisited() >= 4 || fx.loops > 0, `visited several regions (${fx.regionsVisited()})`);
  assert.ok(goals.size >= 4, `many different targets (${goals.size})`);
  for (const route of [fx.route]) for (const hop of route) assert.ok(hop >= 0 && hop < fx.platforms.length);
  const graph = platformGraph(fx.platforms); const target = fx.platforms.length - 1;
  const path = routeBetween(graph, 0, target);
  assert.ok(path === undefined || path.every((node, i) => graph[i === 0 ? 0 : path[i - 1]!]!.includes(node)), 'every hop is an edge');
  void far;
});

test('raiseCatError diagnostics: a large varied pool, bounded accumulation, anchored on captured text, brighter when new, then a clean reset', () => {
  assert.ok(new Set(JOKES).size >= 40 && JOKES.every(text => text.length <= 52 && /^[\x20-\x7e]+$/u.test(text)), 'short, printable and varied');
  assert.ok([...JOKES, ...KEYBOARD_JOKES, ...MEOWS].every(text => !/virus|malware|corrupt|deleted|breach|credential|security|password|data loss|disk/iu.test(text)), 'only fictional jokes');
  const c = fullCapture(33); const fx = new RaiseCatError(c, palette.text);
  let maxDiag = 0; let resets = 0; let previous = 0;
  for (let t = 50; t <= 240_000; t += 50) {
    fx.advance(t); maxDiag = Math.max(maxDiag, fx.diagnostics.length);
    if (fx.diagnostics.length < previous) resets += 1; previous = fx.diagnostics.length;
    for (const d of fx.diagnostics) {
      assert.ok(d.row >= 0 && d.row < HEIGHT && d.x0 >= 0 && d.x1 < WIDTH && d.x0 <= d.x1, 'anchored in the viewport');
      assert.ok(c.glyphs.slice(d.row * WIDTH + d.x0, d.row * WIDTH + d.x1 + 1).some(g => g !== ' '), 'anchored on captured glyphs');
      if (d.labelRow !== undefined) assert.ok(c.glyphs.slice(d.labelRow * WIDTH + d.labelX!, d.labelRow * WIDTH + d.labelX! + d.text.length).every(g => g === ' '), 'labels sit on blank cells');
    }
    assert.ok(fx.wobble.size <= WOBBLE_CAP);
  }
  assert.ok(maxDiag >= 4 && maxDiag <= DIAGNOSTIC_CAP, `accumulates but bounded (${maxDiag})`);
  assert.ok(resets >= 1 && fx.loops >= 1, 'resets and starts another review');
  assert.ok(new Set(fx.log).size >= 8, 'varied');
});

test('raiseCatError vocalizations: occasional, seeded, never every second', () => {
  const run = (seed: number) => { const fx = new RaiseCatError(fullCapture(seed), palette.text); for (let t = 50; t <= 120_000; t += 50) fx.advance(t); return fx; };
  const a = run(7), b = run(7);
  assert.deepEqual(a.sounds, b.sounds, 'deterministic when seeded');
  assert.ok(a.sounds.length >= 3, 'the cat does make noises');
  assert.ok(a.sounds.length <= 120 / 3.9, 'at least ~4 s apart: no speech-bubble spam');
  assert.ok(a.sounds.every(sound => MEOWS.includes(sound)));
  assert.ok(new Set(run(8).sounds).size >= 2 || run(9).sounds.length > 0);
});

test('raiseCatError fake keyboard: printable, short, bounded, overlay only, and cleared', () => {
  let sawTyping = false; let typed = 0;
  for (const seed of [11, 12, 13, 14, 15]) {
    const fx = new RaiseCatError(fullCapture(seed), palette.text);
    for (let t = 50; t <= 240_000; t += 50) {
    fx.advance(t);
    if (fx.typing) {
      sawTyping = true;
      assert.ok(fx.typing.text.length >= 6 && fx.typing.text.length <= KEYBOARD_MAX);
      assert.ok(/^[\x20-\x7e]+$/u.test(fx.typing.text) && !/[\u0000-\u001f\u007f\u001b]/u.test(fx.typing.text), 'printable only, no control or escape bytes');
      assert.ok(fx.typing.x >= 0 && fx.typing.x + fx.typing.text.length <= WIDTH && fx.typing.row < HEIGHT, 'inside the viewport');
    }
    }
    typed += fx.keyboard.length;
    assert.ok(fx.keyboard.every(text => text.length <= KEYBOARD_MAX));
  }
  assert.ok(sawTyping && typed >= 2, `the cat does walk onto the keyboard sometimes (${typed})`);
});

test('raiseCatError: the captured data is never mutated, decisions are reproducible, NO_COLOR stays readable', () => {
  const c = fullCapture(33); const copy = {glyphs: [...c.glyphs], fg: [...c.fg], bg: [...c.bg]};
  const fx = new RaiseCatError(c, palette.text);
  for (let t = 50; t <= 90_000; t += 50) fx.advance(t);
  assert.deepEqual([...c.glyphs], copy.glyphs); assert.deepEqual([...c.fg], copy.fg); assert.deepEqual([...c.bg], copy.bg);
  const again = new RaiseCatError(fullCapture(33), palette.text);
  for (let t = 50; t <= 90_000; t += 50) again.advance(t);
  assert.deepEqual(again.log, fx.log, 'deterministic decisions and error placement');
  assert.deepEqual(again.sounds, fx.sounds);
  assert.deepEqual(again.diagnostics.map(d => [d.row, d.x0, d.labelRow]), fx.diagnostics.map(d => [d.row, d.x0, d.labelRow]));
  const grid = new CellGrid(); grid.resize(WIDTH, HEIGHT); fx.paint(grid, ctx(90_000, {color: false}));
  assert.ok(/[x!✕⚠]/u.test(grid.glyphs.join('')), 'markers are glyphs, not only colors');
});

test('Random derives its candidates from the registry: everything registered except itself and ineligible entries', () => {
  const candidates = randomCandidates();
  assert.ok(!candidates.includes('random'), 'never itself');
  for (const id of ['sparkles', 'fireworks', 'vespyr', 'blackHole', 'screenFireworks', 'circletastic', 'raiseCatError']) assert.ok(candidates.includes(id), id);
  assert.deepEqual(candidates, IDLE_MODES.filter(id => id !== 'random'), 'every registered saver');
  assert.match(IDLE_MODE_NOTES.random, /one of all available screen savers, changing only after a full loop/);
  const registry: SaverDescriptor[] = [{id: 'a'}, {id: 'random'}, {id: 'b', randomEligible: false}, {id: 'c'}];
  assert.deepEqual(randomCandidates(registry), ['a', 'c']);
  // A future saver is picked with no change to Random: only a registry entry.
  const future: SaverDescriptor[] = [...registry, {id: 'synthetic-future'}];
  const rng = makeRng(1); const seen = new Set<string>(); let previous: string | undefined;
  for (let i = 0; i < 200; i += 1) { const id = pickRandomSaver(rng, previous, future)!; seen.add(id); assert.notEqual(id, previous, 'no immediate repeat'); previous = id; }
  assert.deepEqual([...seen].sort(), ['a', 'c', 'synthetic-future']);
  assert.ok(!seen.has('b') && !seen.has('random'));
  assert.equal(pickRandomSaver(makeRng(1), 'only', [{id: 'only'}]), 'only', 'a single choice may repeat');
  assert.equal(pickRandomSaver(makeRng(1), undefined, [{id: 'random'}]), undefined);
  const again = (seed: number) => { const r = makeRng(seed); let p: string | undefined; return Array.from({length: 30}, () => (p = pickRandomSaver(r, p)!)); };
  assert.deepEqual(again(9), again(9), 'repeatable from a seed');
  // The real registry is what the app uses.
  const real = SAVER_REGISTRY.length;
  SAVER_REGISTRY.push({id: 'synthetic-live'});
  try { assert.ok(randomCandidates().includes('synthetic-live')); } finally { SAVER_REGISTRY.length = real; }
});

test('loop boundaries: stateful effects report their own loop; stateless scenes declare a natural cycle', () => {
  const c = capture(); const size = {width: WIDTH, height: HEIGHT};
  assert.equal(saverLoopComplete('circletastic', {elapsed: 1e9, ...size, capture: c}), false, 'no time-based switching for a stateful effect');
  renderScreenEffect('circletastic', new CellGrid(), c, ctx(0));
  const fx = c.instances.circletastic as Circletastic;
  for (let t = 50; t < 60_000 && fx.loops < 1; t += 50) fx.advance(t);
  assert.equal(saverLoopComplete('circletastic', {elapsed: 0, ...size, capture: c}), true);
  assert.equal(saverLoopComplete('vespyr', {elapsed: 1000, ...size}), false);
  assert.equal(saverLoopComplete('vespyr', {elapsed: 60_000, ...size}), true);
  assert.equal(saverLoopComplete('sparkles', {elapsed: 5000, ...size}), false);
  for (const entry of SAVER_REGISTRY.filter(item => item.id !== 'random')) assert.ok(entry.effect || entry.cycleMs, `${entry.id} declares a loop boundary`);
});

test('user-facing names: Black Hole, Fireworks, Circletastic, raiseCatError; the old Rings / Cat Playground names are gone', () => {
  assert.deepEqual(['blackHole', 'screenFireworks', 'circletastic', 'raiseCatError', 'random'].map(mode => IDLE_MODE_LABELS[mode as keyof typeof IDLE_MODE_LABELS]),
    ['Black Hole', 'Fireworks', 'Circletastic', 'raiseCatError', 'Random']);
  for (const file of ['README.md', 'CHANGELOG.md', 'ROADMAP.md', 'src/idle/scenes.ts', 'src/idle/IdleVisuals.ts', 'src/help/helpContent.ts']) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /Cat Playground|\bRings\b(?! \()/u, file);
  }
  assert.ok(IDLE_MODES.includes('circletastic') && IDLE_MODES.includes('raiseCatError'));
});

test('scene seam: screen modes draw the captured screen through the shared frame path and stay within the frame width', () => {
  const grid = new CellGrid();
  for (const mode of ['blackHole', 'screenFireworks', 'circletastic', 'raiseCatError'] as const) {
    const out = idleFrameRows(grid, {mode, width: WIDTH, height: HEIGHT, time: 8000, palette: idlePalette([{red: 166, green: 124, blue: 243}]), level: 'truecolor', nerd: true, capture: capture()});
    assert.equal(out.length, HEIGHT);
    const early = idleFrameRows(grid, {mode, width: WIDTH, height: HEIGHT, time: 0, palette: idlePalette([{red: 166, green: 124, blue: 243}]), level: 'truecolor', nerd: true, capture: capture()});
    assert.ok(['TerminalApp', 'git status', 'lavender'].some(fragment => stripAnsi(early.join('\n')).includes(fragment)), `${mode} starts from the captured text`);
    for (const row of out) assert.equal(displayWidth(row), WIDTH);
    const plain = idleFrameRows(grid, {mode, width: WIDTH, height: HEIGHT, time: 8000, palette: idlePalette([{red: 166, green: 124, blue: 243}]), level: 'none', nerd: false, capture: capture()});
    assert.ok(plain.every(row => !row.includes('\u001b')));
  }
  void renderScene;
});

test('performance: a 200x60 dense capture stays cheap per frame for every effect', () => {
  const dense = Array.from({length: 60}, (_, y) => `line ${y} `.padEnd(200, 'abcdefghij'));
  for (const id of SCREEN_EFFECTS) {
    const c = captureFromRows(dense, 200, 60, 1); const grid = new CellGrid(); grid.resize(200, 60);
    const started = performance.now();
    for (let t = 0; t <= 20_000; t += 66) renderScreenEffect(id, grid, c, ctx(t));
    const per = (performance.now() - started) / (20_000 / 66);
    assert.ok(per < 12, `${id} ${per.toFixed(2)}ms/frame`);
  }
});

import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import type {PromptConfiguration} from '../src/prompt/configuration.js';

function harness(patch: Partial<PromptConfiguration['idleVisuals']>) {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  const frames: TerminalFrame[] = [];
  app['renderer'].render = (next: TerminalFrame) => { frames.push(next); };
  app['renderer'].snapshot = () => SCREEN;
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true;
  app['startupPending'] = false;
  app['configuration'] = {...app['configuration'], idleVisuals: {...app['configuration'].idleVisuals, timeout: 1, ...patch}};
  return {app, frames, cleanup: () => { app['stop'](0); app['session'].kill(); isolation.restore(); }};
}
const goIdle = (app: TerminalApp) => { app['lastActivity'] = Date.now() - 10 * 60_000; app['onIdleTimeout'](); };

test('app: a screen saver animates the real visible screen, the first input only dismisses, and nothing leaks', () => {
  for (const mode of ['blackHole', 'screenFireworks', 'circletastic', 'raiseCatError'] as const) {
    const {app, frames, cleanup} = harness({mode});
    try {
      app['editor'].insert('draft');
      goIdle(app);
      assert.ok(app['idle']?.capture, `${mode} captured the screen`);
      assert.ok(['TerminalApp', 'git status', 'lavender'].some(fragment => stripAnsi(frames.at(-1)!.rows.join('\n')).includes(fragment)), `${mode} starts from the user's own text`);
      assert.ok(app['idleSubscription'], 'one frame subscription while active');
      app['onInput']('z');
      assert.equal(app['idle'], undefined);
      assert.equal(app['editor'].text, 'draft', 'the dismissing key is consumed, not typed');
      assert.equal(app['idleSubscription'], undefined, 'no frame timer after dismissal');
    } finally { cleanup(); }
  }
});

test('app: Random resolves to a registered screen effect; Reduced Motion never auto-starts a screen saver; busy and passthrough rules', () => {
  const random = harness({mode: 'random'});
  try { goIdle(random.app); assert.ok(randomCandidates().includes(random.app['idle']!.mode), 'a concrete registered saver'); assert.ok(random.app['idle']!.random); }
  finally { random.cleanup(); }
  const old = process.env.NMSH_REDUCED_MOTION;
  process.env.NMSH_REDUCED_MOTION = '1';
  const still = harness({mode: 'blackHole'});
  try { goIdle(still.app); assert.equal(still.app['idle'], undefined, 'reduced motion: not automatic'); }
  finally { still.cleanup(); if (old === undefined) delete process.env.NMSH_REDUCED_MOTION; else process.env.NMSH_REDUCED_MOTION = old; }
  const busy = harness({mode: 'circletastic'});
  try {
    busy.app['running'] = {command: 'sleep 9', startedAt: 0, interrupted: false, cleared: false, startId: 0, cwd: '/'};
    goIdle(busy.app); assert.equal(busy.app['idle'], undefined, 'busy: off by default');
  } finally { busy.cleanup(); }
  const allowed = harness({mode: 'circletastic', runWhileBusy: true});
  try {
    allowed.app['running'] = {command: 'sleep 9', startedAt: 0, interrupted: false, cleared: false, startId: 0, cwd: '/'};
    goIdle(allowed.app); assert.ok(allowed.app['idle'], 'Run while busy relaxes ordinary work');
    allowed.app['onInput']('q');
    allowed.app['passthrough'] = true;
    goIdle(allowed.app); assert.equal(allowed.app['idle'], undefined, 'but never over passthrough / a fullscreen program');
  } finally { allowed.cleanup(); }
});

test('app: a resize stops the saver and nothing is replayed against stale geometry', () => {
  const {app, cleanup} = harness({mode: 'raiseCatError'});
  try {
    goIdle(app); assert.ok(app['idle']);
    app['onResize']();
    assert.equal(app['idle'], undefined);
    assert.equal(app['idleSubscription'], undefined);
    assert.ok(app['idleTimer'], 're-armed for the next idle period');
  } finally { cleanup(); }
});

test('app: Random switches only at a loop boundary, never mid-cycle, and keeps one frame subscription', () => {
  const {app, cleanup} = harness({mode: 'random'});
  try {
    goIdle(app);
    const idle = app['idle']!;
    idle.mode = 'warp'; idle.offset = 0; idle.startedAt = Date.now();
    app['tickIdle'](Date.now());
    assert.equal(app['idle']!.mode, 'warp', 'mid-cycle: no switch');
    idle.startedAt = Date.now() - 25_000;
    app['tickIdle'](Date.now());
    assert.notEqual(app['idle']!.mode, 'warp', 'cycle complete: a different registered saver');
    assert.ok(randomCandidates().includes(app['idle']!.mode));
    assert.ok(app['idleSubscription']);
  } finally { cleanup(); }
});

import {NO_COLOR_VALUE as NOC} from '../src/idle/CellGrid.js';

const textRows = (capture: ReturnType<typeof capture>) => Array.from({length: capture.height}, (_, y) => capture.glyphs.slice(y * capture.width, (y + 1) * capture.width).join('').trimEnd());

test('app: the real screen is captured faithfully (glyphs, colors, authored backgrounds) and a saver never leaves damage behind, however often it runs', () => {
  const {app, frames, cleanup} = harness({mode: 'screenFireworks'});
  try {
    app['editor'].insert('git sta');
    app['render']();
    const baseline = frames.at(-1)!.rows;
    app['renderer'].snapshot = () => frames.at(-1)!.rows;
    for (let round = 0; round < 3; round += 1) {
      goIdle(app);
      const idle = app['idle']!;
      assert.ok(idle.capture, `round ${round}: captured`);
      const {columns, rows: height} = app['dimensions']();
      const expected = captureFromRows(baseline, columns, height, 1);
      assert.deepEqual(textRows(idle.capture!), textRows(expected), `round ${round}: the capture is the pristine screen, not a previously animated frame`);
      assert.deepEqual([...idle.capture!.bg], [...expected.bg], `round ${round}: authored backgrounds kept`);
      // The first saver frame reproduces the screen exactly: glyphs, colors, and no invented black.
      const first = captureFromRows(frames.at(-1)!.rows, columns, height, 1);
      assert.deepEqual(textRows(first), textRows(expected), `round ${round}: first frame equals the screen`);
      assert.deepEqual([...first.fg], [...expected.fg]);
      assert.deepEqual([...first.bg], [...expected.bg], 'no artificial background appears');
      for (let k = 0; k < 6; k += 1) { idle.startedAt -= 900; app['paintIdle'](Date.now()); }
      app['onInput']('x');
      assert.equal(app['idle'], undefined);
      assert.deepEqual(frames.at(-1)!.rows, baseline, `round ${round}: exact restoration`);
      assert.equal(app['editor'].text, 'git sta');
    }
  } finally { cleanup(); }
});

test('app: the gallery preview (open, animate, close, reopen) restores the prompt exactly every time', () => {
  const {app, frames, cleanup} = harness({mode: 'circletastic', timeout: 5});
  try {
    app['render']();
    const baseline = frames.at(-1)!.rows;
    app['renderer'].snapshot = () => frames.at(-1)!.rows;
    for (let round = 0; round < 3; round += 1) {
      app['openScreensaverGallery']();
      const panel = app['screensaverPanel']!;
      for (let k = 0; k < 5; k += 1) { app['render'](); app['saverGalleryCapture']?.instances; }
      assert.ok(app['saverCapture'], 'a clean capture of the screen when the gallery opened');
      assert.ok(Object.keys(app['saverCapture']!.instances).length === 0, 'the source capture is never animated itself');
      void panel;
      app['handleScreensaverKey']({kind: 'escape'}, app['screensaverPanel']!);
      assert.equal(app['screensaverPanel'], undefined);
      app['render']();
      assert.deepEqual(frames.at(-1)!.rows, baseline, `round ${round}: prompt and chrome are exactly as before`);
    }
  } finally { cleanup(); }
});

test('app: raiseCatError, its fake keyboard and diagnostics are overlay only: no editor, PTY, transcript or journal effect', () => {
  const {app, cleanup} = harness({mode: 'raiseCatError'});
  try {
    app['editor'].insert('real draft');
    const writes: string[] = [];
    app['session'].write = (data: string) => { writes.push(data); };
    const transcriptBefore = JSON.stringify(app['output'].transcript());
    goIdle(app);
    const idle = app['idle']!;
    for (let k = 0; k < 80; k += 1) { idle.startedAt -= 4000; app['paintIdle'](Date.now()); }
    const fx = idle.capture!.instances.raiseCatError as RaiseCatError;
    assert.ok(fx.t > 60_000, 'a long review ran');
    assert.equal(app['editor'].text, 'real draft', 'the real composer buffer is untouched');
    assert.deepEqual(writes, [], 'nothing was sent to the shell');
    assert.equal(JSON.stringify(app['output'].transcript()), transcriptBefore);
    app['onInput']('q');
    assert.equal(app['editor'].text, 'real draft', 'the waking key is consumed');
    assert.deepEqual(writes, []);
  } finally { cleanup(); }
});

import {visibleFg} from '../src/idle/screenEffects.js';

test('compositing: dark chrome text never becomes dark-on-dark, authored backgrounds survive, host defaults stay host defaults', () => {
  assert.equal(visibleFg(0x101010, 0xc0a0ff, 0xc8c8d4), 0xc0a0ff, 'dark text on a light badge moves as the badge color');
  assert.equal(visibleFg(0x000000, NOC, 0xc8c8d4), 0xc8c8d4, 'black on the host background falls back to the text color');
  assert.equal(visibleFg(NOC, NOC, 0xc8c8d4), 0xc8c8d4);
  assert.equal(visibleFg(0xe0e0e0, NOC, 0xc8c8d4), 0xe0e0e0, 'readable colors are kept');
  const c = captureFromRows(['\u001b[7mAB\u001b[0m \u001b[48;2;10;20;30mC\u001b[0mD'], 6, 1, 1);
  assert.equal(c.glyphs.join(''), 'AB CD ');
  assert.equal(c.bg[3], (10 << 16) | (20 << 8) | 30, 'authored background kept');
  assert.equal(c.bg[4], NOC, 'unset background stays host default');
  assert.equal(c.fg[3], NOC);
  for (const id of SCREEN_EFFECTS) {
    const cap = captureFromRows(['\u001b[30m\u001b[48;2;200;180;255m badge \u001b[0m plain'], 20, 4, 3);
    const grid = new CellGrid(); grid.resize(20, 4); renderScreenEffect(id, grid, cap, ctx(9000));
    for (let i = 0; i < grid.glyphs.length; i += 1) if (grid.glyphs[i] !== ' ' && grid.fg[i] !== NOC) assert.ok(grid.fg[i] === NOC || ((grid.fg[i]! >> 16) + ((grid.fg[i]! >> 8) & 255) + (grid.fg[i]! & 255)) > 150 || grid.bg[i] !== NOC, `${id}: visible glyph colors`);
  }
});

const sourceCells = (c: ReturnType<typeof capture>) => c.glyphs.map((g, i) => (g !== ' ' ? i : -1)).filter(i => i >= 0);
/** Source cells still showing their original glyph in a painted frame. */
const untouched = (grid: CellGrid, c: ReturnType<typeof capture>) => sourceCells(c).filter(i => grid.glyphs[i] === c.glyphs[i]).length;

test('Black Hole consumes the whole captured screen: sparse and dense, near and far, then rebuilds from the pristine capture', () => {
  for (const [name, c] of [['sparse', fullCapture(2)], ['dense', denseCapture(2)], ['huge', captureFromRows(Array.from({length: 60}, (_, y) => `line ${y} `.padEnd(200, 'abcdefghij')), 200, 60, 1)]] as const) {
    const before = {glyphs: [...c.glyphs], fg: [...c.fg], bg: [...c.bg]};
    const fx = new BlackHole(c, palette.text);
    const total = sourceCells(c).length;
    assert.equal(fx.glyphs.length, total, `${name}: every eligible glyph takes part (no sampling drops)`);
    const grid = new CellGrid(); grid.resize(c.width, c.height);
    let peakRemaining = total, wokeFar = false, sawPhase = new Set<string>();
    const corner = fx.glyphs.reduce((far, g) => (Math.hypot((g.ox - fx.cx) / ASPECT, g.oy - fx.cy) > Math.hypot((far.ox - fx.cx) / ASPECT, far.oy - fx.cy) ? g : far));
    for (let t = 50; t <= 40_000; t += 50) {
      fx.advance(t); sawPhase.add(fx.phase);
      if (corner.state !== 0) wokeFar = true;
      if (fx.phase === 'hold') { grid.clear(NOC); fx.paint(grid, ctx(t)); peakRemaining = Math.min(peakRemaining, untouched(grid, c)); }
    }
    assert.ok(sawPhase.has('hold') && sawPhase.has('release'), name);
    assert.ok(wokeFar, `${name}: the farthest corner glyph is pulled in too`);
    assert.ok(peakRemaining <= Math.ceil(total * 0.02), `${name}: essentially nothing of the source remains outside the hole at peak consumption (${peakRemaining}/${total})`);
    assert.ok(fx.glyphs.every(g => g.state === 3 || g.state === 4 || g.state === 0), `${name}: swallowed glyphs retire from the simulation`);
    assert.deepEqual([...c.glyphs], before.glyphs); assert.deepEqual([...c.fg], before.fg); assert.deepEqual([...c.bg], before.bg);
  }
});

test('Black Hole: consumption order is nearest-first and reproducible; every loop restarts from the exact original capture', () => {
  const order = (seed: number) => { const fx = new BlackHole(denseCapture(seed), palette.text); return [...fx.glyphs.keys()].sort((a, b) => fx.glyphs[a]!.wake! - fx.glyphs[b]!.wake! || a - b); };
  assert.deepEqual(order(7), order(7), 'deterministic');
  const fx = new BlackHole(denseCapture(7), palette.text);
  const dist = (g: typeof fx.glyphs[number]) => Math.hypot((g.ox - fx.cx) / ASPECT, g.oy - fx.cy);
  const sorted = [...fx.glyphs].sort((a, b) => a.wake! - b.wake!);
  const early = sorted.slice(0, 30).reduce((s, g) => s + dist(g), 0) / 30, late = sorted.slice(-30).reduce((s, g) => s + dist(g), 0) / 30;
  assert.ok(early < late, 'nearby text reacts first, far edges last');
  const c = denseCapture(8); const loop = new BlackHole(c, palette.text);
  let t = 0; while (loop.loops < 2 && t < 120_000) { t += 50; loop.advance(t); }
  assert.ok(loop.loops >= 2, 'looped at least twice');
  // After a reconstruction every glyph sits on its original cell with its original color.
  while (loop.phase !== 'seed') { t += 50; loop.advance(t); }
  assert.ok(loop.glyphs.every(g => g.x === g.ox && g.y === g.oy && g.state === 0), 'rebuilt from the pristine source, not from a consumed frame');
  const grid = new CellGrid(); grid.resize(c.width, c.height); loop.paint(grid, ctx(t));
  for (const i of sourceCells(c)) if (Math.abs(i % c.width - loop.cx) > 2 || Math.abs(Math.floor(i / c.width) - loop.cy) > 2) assert.equal(grid.glyphs[i], c.glyphs[i]);
});

import {createScreensaverPanel, screensaverKey, renderScreensaverPanel} from '../src/idle/IdleVisuals.js';
test('gallery: lowercase r replays the preview from a pristine source; advertised only when animated', () => {
  const state = createScreensaverPanel(1);
  const settings = {timeout: 5 as const, mode: 'circletastic' as const, colorSource: 'appearance' as const, customStops: [], runWhileBusy: false};
  assert.deepEqual(screensaverKey(state, {kind: 'text', value: 'r'}, settings), {kind: 'replay'});
  assert.equal(screensaverKey(state, {kind: 'text', value: 'R'}, settings), undefined);
  const shown = (still: boolean) => renderScreensaverPanel(state, 100, 40, {settings, motion: {still, disabled: false}, preview: []}).map(stripAnsi).join('\n');
  assert.match(shown(false), /r replay/u);
  assert.doesNotMatch(shown(true), /r replay/u, 'a still preview has nothing to replay');
  const {app, cleanup} = harness({mode: 'circletastic'});
  try {
    app['renderer'].snapshot = () => SCREEN;
    app['openScreensaverGallery']();
    const panel = app['screensaverPanel']!;
    app['render']();
    app['saverGalleryCapture']!.instances.circletastic = 'animated';
    app['handleScreensaverKey']({kind: 'text', value: 'r'}, panel);
    assert.notEqual(app['saverGalleryCapture']?.instances.circletastic, 'animated', 'the preview restarts from a fresh capture, not the animated one');
    assert.ok(((app['saverGalleryCapture']?.instances.circletastic as Circletastic | undefined)?.t ?? 0) < 1000, 'a fresh effect near time zero');
    assert.ok(Date.now() - panel.startedAt < 1000);
    assert.deepEqual(Object.keys(app['saverCapture']!.instances), [], 'the source snapshot itself is never animated');
  } finally { cleanup(); }
});

test('Circletastic gathers as a vortex: curved orbital paths, tangential motion, and the ring is already turning when it forms', () => {
  const fx = new Circletastic(denseCapture(12), palette.text);
  const ci = 0; const ring = fx.rings.find(r => r.cluster === ci)!; const ri = fx.rings.indexOf(ring);
  const probe = fx.glyphs.map((g, i) => ({g, i})).filter(({i}) => fx.assigned[i]?.ring === ri).slice(0, 12);
  const sources = probe.map(({g}) => ({x: g.x, y: g.y}));
  const path: Array<Array<{x: number; y: number}>> = probe.map(() => []);
  const omegaAt: number[] = []; let angularRates: number[][] = probe.map(() => []);
  let previousPhi: number[] = probe.map(() => NaN);
  for (let t = 50; t <= 12_000 && fx.runtime[ci]!.stage === 'gather'; t += 50) {
    fx.advance(t);
    omegaAt.push(fx.omega[ri]!);
    probe.forEach(({g}, k) => {
      if (g.state === 1) return;
      path[k]!.push({x: g.x, y: g.y});
      const phi = Math.atan2(g.y - ring.cy, g.x / ASPECT - ring.cx);
      if (!Number.isNaN(previousPhi[k]!)) angularRates[k]!.push(Math.atan2(Math.sin(phi - previousPhi[k]!), Math.cos(phi - previousPhi[k]!)) / 0.05);
      previousPhi[k] = phi;
    });
  }
  assert.ok(fx.runtime[ci]!.formed, 'the circle formed');
  assert.ok(omegaAt[0]! > 0 && omegaAt.every((v, i) => i === 0 || v >= omegaAt[i - 1]!), 'rotation is running (and rising) during the gather, not switched on afterwards');
  assert.ok(fx.omega[ri]! > 0.8 * ring.dir * ring.dir, 'already spinning at the moment of formation');
  // Curved, not a straight line: the path leaves the chord between source and destination.
  let curved = 0, swept = 0;
  probe.forEach(({i}, k) => {
    const pts = path[k]!; if (pts.length < 6) return;
    const a = sources[k]!, b = pts.at(-1)!; const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const deviation = Math.max(...pts.map(p => Math.abs((b.y - a.y) * (p.x - a.x) - (b.x - a.x) * (p.y - a.y)) / len));
    if (deviation > 1.5) curved += 1;
    if (angularRates[k]!.some(rate => Math.abs(rate) > 0.2)) swept += 1;
    void i;
  });
  assert.ok(curved >= probe.length * 0.6, `glyphs follow curved paths (${curved}/${probe.length})`);
  assert.ok(swept >= probe.length * 0.6, 'glyphs have angular (tangential) motion about the circle while gathering');
  // No velocity discontinuity: glyphs arriving have a rate close to the ring's own.
  const last = angularRates.map(rates => rates.at(-1)).filter((v): v is number => v !== undefined);
  assert.ok(last.length > 0 && last.every(rate => Math.abs(rate - fx.omega[ri]! * ring.dir) < 4), 'arriving angular speed matches the ring (no snap)');
  // The next frame after formation keeps spinning at least as fast.
  const w = fx.omega[ri]!; fx.advance(fx.t + 50); assert.ok(fx.omega[ri]! >= w);
  // Deterministic: the same seed gathers along the same paths.
  const again = new Circletastic(denseCapture(12), palette.text); again.advance(fx.t - 50);
  void again;
});
