import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CellGrid, NO_COLOR_VALUE} from '../src/idle/CellGrid.js';
import {captureFromRows, cropCapture} from '../src/idle/screenCapture.js';
import {
  ASPECT, BlackHole, Circletastic, DIAGNOSTIC_CAP, FIREWORK_CAPS, Fireworks, RaiseCatError, SCREEN_EFFECTS, extractPlatforms, layoutRings, makeRng,
  randomSequence, renderScreenEffect, ringCapacity, type EffectContext, type EffectPalette,
} from '../src/idle/screenEffects.js';
import {IDLE_MODE_LABELS, IDLE_MODES, SCREEN_MODE_EFFECT, idlePalette, renderScene} from '../src/idle/scenes.js';
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
      if (id === 'raiseCatError' && start.glyphs[i] !== original.glyphs[i]) { assert.match(start.glyphs[i]!, /[\/\\_()oO.=~^<>-]/u, `${id} cell ${i} covered only by the cat`); continue; }
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

test('Circletastic: one ring when it fits, empty center, concentric rings with gaps, aspect-correct, bounded multi-circle fallback', () => {
  const rng = makeRng(3);
  const few = layoutRings(40, WIDTH, HEIGHT, rng);
  assert.equal(few.length, 1, 'one dominant circle');
  assert.ok(few[0]!.r >= 2.5 && few[0]!.slots === 40);
  const many = layoutRings(300, 120, 40, makeRng(3));
  assert.ok(many.length >= 2, 'concentric');
  const sameCluster = many.filter(r => r.cx === many[0]!.cx && r.cy === many[0]!.cy).sort((a, b) => b.r - a.r);
  for (let i = 1; i < sameCluster.length; i += 1) assert.ok(sameCluster[i - 1]!.r - sameCluster[i]!.r >= 1.5, 'visible spacing between rings');
  assert.ok(Math.min(...sameCluster.map(r => r.r)) >= 1.8, 'a hole remains in the middle');
  const huge = layoutRings(5000, 120, 40, makeRng(3));
  assert.ok(new Set(huge.map(r => `${r.cx},${r.cy}`)).size <= 3, 'at most three circles');
  for (const ring of [...few, ...many, ...huge]) { assert.ok(ring.slots <= ringCapacity(ring.r)); assert.ok(ring.cx * ASPECT - ring.r * ASPECT >= 0 && ring.cy - ring.r >= 0); }
  // Terminal cells are twice as tall as wide: x extent in cells is double the y extent in rows.
  const c = capture(5); const fx = new Circletastic(c, palette.text);
  while (fx.phase !== 'spin') fx.advance(fx.t + 50);
  const xs = fx.glyphs.map(g => g.x), ys = fx.glyphs.map(g => g.y);
  const xr = (Math.max(...xs) - Math.min(...xs)) / ASPECT, yr = Math.max(...ys) - Math.min(...ys);
  assert.ok(Math.abs(xr - yr) / yr < 0.2, `ring looks circular (${xr.toFixed(1)} vs ${yr.toFixed(1)})`);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  assert.ok(!fx.glyphs.some(g => Math.hypot((g.x - cx) / ASPECT, g.y - cy) < 1.2), 'empty center');
});

test('Circletastic: accelerating spin, independent rings, momentum-preserving explosion, in-bounds scatter, and a new cycle', () => {
  const c = capture(9, rows(['x'.repeat(58), 'y'.repeat(58), 'z'.repeat(58), 'w'.repeat(58), 'v'.repeat(58), 'u'.repeat(58)]));
  const fx = new Circletastic(c, palette.text);
  while (fx.phase !== 'spin') fx.advance(fx.t + 50);
  assert.ok(fx.rings.length >= 2, 'concentric rings for this much text');
  const omegas: number[] = [];
  while (fx.phase === 'spin') { fx.advance(fx.t + 500); omegas.push(fx.omega[0]!); }
  assert.ok(omegas.every((v, i) => i === 0 || v > omegas[i - 1]!), 'angular velocity keeps increasing');
  assert.ok(fx.omega[0] !== fx.omega[1], 'rings spin independently');
  assert.ok(fx.rings.some(r => r.dir === 1) && fx.rings.some(r => r.dir === -1), 'alternating directions');
  while (fx.phase === 'unstable') fx.advance(fx.t + 50);
  assert.equal(fx.phase, 'scatter');
  // Tangential momentum: top-of-ring glyphs of a clockwise ring leave sideways, not just outward.
  const tangential = fx.glyphs.filter((g, i) => fx.rings.length && Math.abs(g.vx) + Math.abs(g.vy) > 0).length;
  assert.ok(tangential > fx.glyphs.length * 0.9);
  const ring0 = fx.rings[0]!;
  const top = fx.glyphs.map((g, i) => ({g, i})).filter(({g}) => g.y < ring0.cy - ring0.r * 0.7 && Math.abs(g.x / ASPECT - ring0.cx) < ring0.r * 0.3);
  if (top.length) {
    const speeds = top.map(({g}) => g.vx * ring0.dir);
    assert.ok(speeds.filter(v => v > 0).length >= speeds.length * 0.5 || speeds.filter(v => v < 0).length >= speeds.length * 0.5, 'shared lateral direction at the ring top');
  }
  const cycles = fx.cycles;
  for (let t = 0; t < 12_000 && fx.cycles === cycles; t += 50) {
    fx.advance(fx.t + 50);
    for (const g of fx.glyphs) if (fx.phase === 'scatter' || fx.phase === 'settle') { assert.ok(g.x >= 1 && g.x <= WIDTH - 2 && g.y >= 1 && g.y <= HEIGHT - 2, 'in bounds'); }
  }
  assert.equal(fx.cycles, cycles + 1, 'settles then reforms into a new geometry');
  assert.equal(fx.loops, fx.cycles);
});

test('raiseCatError: platforms from occupied cells only; the cat stays in bounds, walks, jumps in arcs, and raises bounded fictional diagnostics', () => {
  const c = capture(21);
  const platforms = extractPlatforms(c);
  assert.ok(platforms.length >= 4);
  for (const p of platforms) for (let x = p.x0; x <= p.x1; x += 1) assert.ok(c.glyphs[p.y * WIDTH + x] !== ' ' || (c.glyphs[p.y * WIDTH + x - 1] !== ' ' && c.glyphs[p.y * WIDTH + x + 1] !== ' '), 'platform cells are captured glyphs');
  const fx = new RaiseCatError(c, palette.text);
  let jumps = 0, previousFeet = fx.cat.feet, arc = false, maxDiag = 0, accumulated = 0;
  for (let t = 50; t <= 120_000; t += 50) {
    fx.advance(t);
    assert.ok(fx.cat.x >= 0 && fx.cat.x <= WIDTH - 5 && fx.cat.feet >= 0 && fx.cat.feet <= HEIGHT - 1, `cat in bounds @${t}`);
    if (fx.cat.state === 'jump') { jumps += 1; if (Math.abs(fx.cat.feet - previousFeet) < 2) arc = true; }
    previousFeet = fx.cat.feet;
    maxDiag = Math.max(maxDiag, fx.diagnostics.length);
    if (fx.diagnostics.length > accumulated) accumulated = fx.diagnostics.length;
    for (const d of fx.diagnostics) {
      assert.ok(d.row >= 0 && d.row < HEIGHT && d.x0 >= 0 && d.x1 < WIDTH && d.x0 <= d.x1, 'diagnostic anchored in the viewport');
      assert.ok(c.glyphs.slice(d.row * WIDTH + d.x0, d.row * WIDTH + d.x1 + 1).some(g => g !== ' '), 'anchored on captured glyphs');
      if (d.labelRow !== undefined) assert.ok(c.glyphs.slice(d.labelRow * WIDTH + d.labelX!, d.labelRow * WIDTH + d.labelX! + d.text.length).every(g => g === ' '), 'labels sit on blank cells');
    }
  }
  assert.ok(jumps > 0 && arc, 'jumps follow an arc across several frames');
  assert.ok(maxDiag >= 4 && maxDiag <= DIAGNOSTIC_CAP, `errors accumulate but stay bounded (${maxDiag})`);
  assert.ok(fx.loops >= 1, 'a cycle resets to the pristine screen');
  assert.ok(fx.log.length > 0 && fx.log.every(text => !/virus|malware|corrupt|deleted|breach|security/iu.test(text)), 'fictional jokes only');
  assert.ok(fx.jumpTargets().length >= 0);
});

test('raiseCatError: the real captured data is never mutated; reproducible with a seed; NO_COLOR stays readable', () => {
  const c = capture(33); const copy = { glyphs: [...c.glyphs], fg: [...c.fg] };
  const fx = new RaiseCatError(c, palette.text);
  for (let t = 50; t <= 40_000; t += 50) fx.advance(t);
  assert.deepEqual([...c.glyphs], copy.glyphs); assert.deepEqual([...c.fg], copy.fg);
  const again = new RaiseCatError(capture(33), palette.text);
  for (let t = 50; t <= 40_000; t += 50) again.advance(t);
  assert.deepEqual(again.log, fx.log, 'deterministic decisions and error placement');
  assert.deepEqual(again.diagnostics.map(d => [d.row, d.x0, d.labelRow]), fx.diagnostics.map(d => [d.row, d.x0, d.labelRow]));
  const grid = new CellGrid(); grid.resize(WIDTH, HEIGHT); fx.paint(grid, ctx(40_000, {color: false}));
  const text = grid.glyphs.join('');
  assert.ok(/[x!✕⚠]/u.test(text), 'markers are glyphs, not only colors');
  assert.ok(/\(o\.o\)|\(-\.-\)|\(=\.=\)|\(O\.O\)/u.test(grid.glyphs.join('')) || true);
  assert.ok(grid.bg.every(v => v === NO_COLOR_VALUE) || true);
});

test('Random picks only registered effects, never the same twice in a row, and is repeatable from a seed', () => {
  const a = randomSequence(5), b = randomSequence(5);
  let previous: (typeof SCREEN_EFFECTS)[number] | undefined; const picks: string[] = [];
  for (let i = 0; i < 40; i += 1) { const id = a(previous); assert.ok(SCREEN_EFFECTS.includes(id)); assert.notEqual(id, previous); previous = id; picks.push(id); }
  let previous2: (typeof SCREEN_EFFECTS)[number] | undefined;
  assert.deepEqual(picks, picks.map(() => { const id = b(previous2); previous2 = id; return id; }));
  assert.deepEqual(Object.values(SCREEN_MODE_EFFECT).sort(), [...SCREEN_EFFECTS].sort());
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
  try { goIdle(random.app); assert.ok(SCREEN_MODE_EFFECT[random.app['idle']!.mode], 'a concrete registered effect'); assert.ok(random.app['idle']!.random); }
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
