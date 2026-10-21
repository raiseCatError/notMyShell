import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import type {Key} from '../src/terminal/keys.js';
import {ArcadeSession, type ArcadeEnvironment} from '../src/arcade/ArcadeSession.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {ParticleSystem, Trail, type EffectsLevel} from '../src/arcade/effects.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {createRng} from '../src/arcade/rng.js';
import {ArcadeStore} from '../src/arcade/scores.js';
import type {GameContext, GameInstance} from '../src/arcade/types.js';
import {createDashGame, readRecord} from '../src/arcade/games/dash/game.js';
import {dashGame} from '../src/arcade/games/dash/index.js';
import {phaseTint, phaseTones, MIN_COLUMNS, MIN_ROWS} from '../src/arcade/games/dash/scene.js';
import {playerRows} from '../src/arcade/games/dash/sprites.js';
import {DashWorld, PHASE_PX} from '../src/arcade/games/dash/world.js';
import {HB_X, PW, type Piece} from '../src/arcade/games/dash/physics.js';
import {catPixels} from '../src/idle/catSprite.js';
import {displayWidth} from '../src/util/text.js';
import {createPilot} from './support/dashBot.js';

const SPACE: Key = {kind: 'text', value: ' '};
const palette = arcadePalette();

interface Options {
  seed?: number; columns?: number; rows?: number; color?: GameContext['color']; safe?: boolean; reduced?: boolean; effects?: EffectsLevel;
  record?: Record<string, unknown>; world?: (world: DashWorld) => void; particles?: ParticleSystem; trail?: Trail;
}

function make(options: Options = {}) {
  let record: Record<string, never> = (options.record ?? {}) as Record<string, never>;
  const seed = options.seed ?? 3;
  const context: GameContext = {
    size: {columns: options.columns ?? 80, rows: options.rows ?? 20}, seed, rng: createRng(seed),
    motion: {effects: options.effects ?? 'normal', reduced: options.reduced ?? false}, color: options.color ?? 'truecolor', safeGlyphs: options.safe ?? false,
    record: {get: () => structuredClone(record), set: next => { record = next as typeof record; return true; }, update: change => { const copy = structuredClone(record); change(copy); record = copy; return true; }},
    now: () => 0,
  };
  const world = new DashWorld(context.rng.fork('course'));
  options.world?.(world);
  const parts = {world, ...(options.particles ? {particles: options.particles} : {}), ...(options.trail ? {trail: options.trail} : {})};
  const game = createDashGame(context, parts);
  const canvas = new Canvas(context.size.columns, context.size.rows);
  const draw = (alpha = 1) => { game.render(canvas, alpha, palette); return canvas.plain(); };
  return {game, world, canvas, draw, context, record: () => record};
}

/** A road with nothing on it for a very long way. */
const emptyRoad = (world: DashWorld): void => {
  world.course.pieces.length = 0;
  (world.course as unknown as {ensure(x: number): void}).ensure = () => {};
};
let ids = 900;
const put = (world: DashWorld, kind: Piece['kind'], ahead: number, w: number, level = 0): void => {
  world.course.pieces.push({id: ++ids, kind, x: world.distance + HB_X + PW + ahead, w, level, unit: 1});
};
const spikeAhead = (ahead: number) => (world: DashWorld) => { emptyRoad(world); put(world, 'spike', ahead, 6); };
const run = (game: GameInstance, steps: number): void => { for (let i = 0; i < steps && game.status === 'playing'; i += 1) { game.animate(16.7); game.step(1000 / 60); } };
const text = (hint: ReturnType<GameInstance['hints']>) => hint.map(item => `${item.keys} ${item.action}`).join(' | ');

test('definition: id, aliases, title, kind, rates, hints, summary and preview', () => {
  assert.equal(dashGame.id, 'dash');
  assert.deepEqual([...dashGame.aliases], ['vespyr-dash']);
  assert.equal(dashGame.title, 'Vespyr Dash');
  assert.equal(dashGame.kind, 'action');
  const {game} = make();
  assert.equal(game.stepsPerSecond, 60);
  assert.equal(game.refreshMs, 100);
  game.key(SPACE);
  assert.match(text(game.hints()), /Space\/Up jump \| p pause \| Esc menu/u);
  assert.equal(dashGame.summary({}), 'Not played yet');
  assert.equal(dashGame.summary({best: 420, bestDistance: 210, attempts: 3}), 'Best 420 · 210 m');
  const preview = new Canvas(30, 6);
  for (let frame = 0; frame < 40; frame += 1) dashGame.preview(preview, frame, palette);
  assert.ok(preview.plain().join('').trim().length > 0);
});

test('state machine: ready until Space or Up; a press while grounded jumps, a mid-air press only buffers', () => {
  const {game, world} = make({world: emptyRoad});
  for (const key of [{kind: 'down'}, {kind: 'enter'}, {kind: 'escape'}, {kind: 'text', value: 'x'}] as Key[]) assert.equal(game.key(key), 'ignored');
  game.step(1000 / 60);
  assert.equal(world.steps, 0);
  assert.equal(game.key({kind: 'up'}), 'handled');
  assert.equal(game.status, 'playing');
  assert.equal(world.airborne, true, 'the first press also jumps');
  const vy = world.body.vy;
  game.key(SPACE);
  assert.equal(world.body.vy, vy, 'a press in the air changes nothing now');
  run(game, 80);
  assert.equal(game.key({kind: 'text', value: 'x'}), 'ignored');
});

test('scoring: score is distance plus cleared patterns, shown as a counter that lights at 100', () => {
  const {game, world, draw, canvas} = make({world: emptyRoad});
  game.key(SPACE);
  run(game, 60);
  assert.equal(world.score, Math.floor(world.distance / 5));
  assert.match(draw()[0]!, new RegExp(`\\b${String(world.score).padStart(5, '0')}\\b`, 'u'));
  assert.match(draw()[0]!, /HI \d{5}/u);
  assert.match(draw()[1]!, /\d+ m +\d\.\d\dx/u);
  const counterX = canvas.width - 6;
  const calm = canvas.cell(counterX, 0)!.fg;
  while (world.score < 100) run(game, 1);
  draw();
  assert.notDeepEqual(canvas.cell(counterX, 0)!.fg, calm);
  const cleared = make();
  cleared.world.cleared = 3;
  assert.equal(cleared.world.score, 30);
});

test('crash: a spike ends the run after a held beat with a result, details and a record; dying is frozen', () => {
  const {game, world, record} = make({world: spikeAhead(30)});
  game.key(SPACE);
  game.step(1000 / 60);
  // Land the jump early and hit the spike on foot.
  run(game, 200);
  assert.equal(world.alive, false);
  const before = world.steps;
  run(game, 100);
  assert.equal(game.status, 'over');
  assert.equal(world.steps, before);
  const result = game.result!;
  assert.equal(result.record, true);
  assert.deepEqual(result.details, [`Distance ${world.meters} m`, `Best ${world.score}`, 'Attempts 1']);
  assert.deepEqual(record(), {best: world.score, bestDistance: world.meters, attempts: 1});
  assert.equal(game.key(SPACE), 'ignored');
});

test('records: validated on read, best only grows, abandoned runs are not attempts', () => {
  assert.deepEqual(readRecord({best: 'lots', bestDistance: -4, attempts: Number.NaN}), {best: 0, bestDistance: 0, attempts: 0});
  assert.deepEqual(readRecord({best: 12.9, bestDistance: 1e30, attempts: 3}), {best: 12, bestDistance: 1e9, attempts: 3});
  assert.deepEqual(readRecord({best: null, bestDistance: {a: 1}, attempts: [1]} as never), {best: 0, bestDistance: 0, attempts: 0});
  const higher = make({record: {best: 99999, bestDistance: 5000, attempts: 4}, world: spikeAhead(20)});
  higher.game.key(SPACE);
  run(higher.game, 400);
  assert.equal(higher.game.status, 'over');
  assert.equal(higher.game.result!.record, false);
  assert.deepEqual(higher.record(), {best: 99999, bestDistance: 5000, attempts: 5});
  const junk = make({record: {best: 'x', attempts: -2, stray: 1} as never, world: spikeAhead(20)});
  junk.game.key(SPACE);
  run(junk.game, 400);
  assert.equal(junk.game.result!.details[2], 'Attempts 1');
  const abandoned = make({record: {best: 3, bestDistance: 1, attempts: 7}, world: emptyRoad});
  abandoned.game.key(SPACE);
  run(abandoned.game, 300);
  abandoned.game.persist(); abandoned.game.persist();
  assert.deepEqual(abandoned.record(), {best: abandoned.world.score, bestDistance: abandoned.world.meters, attempts: 7});
});

test('persistence: a finished run survives a restart of the store', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-dash-'));
  try {
    const first = new ArcadeStore({directory: dir});
    const context: GameContext = {size: {columns: 60, rows: 14}, seed: 2, rng: createRng(2), motion: {effects: 'normal', reduced: false}, color: 'none', safeGlyphs: false, record: first.record('dash'), now: () => 0};
    const world = new DashWorld(context.rng.fork('course')); spikeAhead(150)(world);
    const game = createDashGame(context, {world});
    game.key(SPACE);
    run(game, 3000);
    assert.equal(game.status, 'over');
    assert.ok(first.flush());
    const second = new ArcadeStore({directory: dir}).record('dash').get();
    assert.deepEqual(second, {best: world.score, bestDistance: world.meters, attempts: 1});
    assert.match(dashGame.summary(second), /^Best \d+ · \d+ m$/u);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('pause and restart through the session; a restart makes a fresh course, the same seed repeats it', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-dash-s-'));
  let now = 1000; let seed = 10;
  const env: ArcadeEnvironment = {store: new ArcadeStore({directory: dir}), now: () => now, motion: () => ({reduced: false, effects: 'normal'}), color: () => 'none', safeGlyphs: () => false, seed: () => seed};
  const session = new ArcadeSession(env, [dashGame], {columns: 80, rows: 22}, dashGame);
  try {
    const first = session.game!;
    assert.equal(session.key({kind: 'up'}), 'handled');
    session.frame(200);
    session.key({kind: 'text', value: 'p'});
    assert.equal(session.screen, 'paused');
    session.frame(1000);
    assert.match(session.render().rows.join('\n'), /Paused/u);
    session.key({kind: 'enter'});
    assert.equal(session.screen, 'playing');
    for (let i = 0; i < 80 && first.status === 'playing'; i += 1) session.frame(100);
    assert.equal(first.status, 'over');
    now += 1000; seed = 11;
    session.key({kind: 'enter'});
    assert.notEqual(session.game, first);
    assert.equal(session.game!.status, 'ready');
  } finally { session.dispose(); rmSync(dir, {recursive: true, force: true}); }
  const courseOf = (s: number) => make({seed: s}).world.course.pieces.slice(0, 8).map(p => `${p.kind}@${p.x}`).join(',');
  assert.equal(courseOf(21), courseOf(21));
  assert.notEqual(courseOf(21), courseOf(22));
  assert.equal(make({seed: 5, effects: 'off'}).world.hash(), make({seed: 5, effects: 'rich'}).world.hash());
});

test('pause: the game does not advance without steps and animate never moves the world', () => {
  const f = make({world: emptyRoad});
  f.game.key(SPACE);
  run(f.game, 20);
  const hash = f.world.hash();
  f.game.pause();
  for (let i = 0; i < 30; i += 1) f.game.animate(16.7);
  assert.equal(f.world.hash(), hash);
});

test('color phases: a new neon every PHASE_METERS, blended smoothly, all distinct and never the spike color', async () => {
  const {deltaE} = await import('../src/arcade/look.js');
  const {spikeSprite} = await import('../src/arcade/games/dash/sprites.js');
  const tones = phaseTones(palette);
  assert.equal(tones.length, 5);
  for (let a = 0; a < tones.length; a += 1) for (let b = a + 1; b < tones.length; b += 1) assert.ok(deltaE(tones[a]!, tones[b]!) >= 10, `phases ${a} and ${b}`);
  const spike = spikeSprite(palette).pixels.find(Boolean)!;
  for (const tone of tones) assert.ok(deltaE(tone, spike) >= 12, 'a spike never blends into a phase');
  assert.deepEqual(phaseTint(palette, 10), tones[0]);
  const before = phaseTint(palette, PHASE_PX - 1);
  const start = phaseTint(palette, PHASE_PX);
  const mid = phaseTint(palette, PHASE_PX + 70);
  const end = phaseTint(palette, PHASE_PX + 300);
  assert.deepEqual(before, tones[0]);
  assert.deepEqual(start, tones[0], 'the blend starts from the old tone');
  assert.notDeepEqual(mid, tones[0]); assert.notDeepEqual(mid, tones[1]);
  assert.deepEqual(end, tones[1]);
});

test('sprites: the player is cut from the approved cat pixels; poses keep ears and eyes', () => {
  const idle = catPixels('idle');
  for (const pose of ['ride', 'air', 'land', 'hit', 'blink'] as const) {
    const rows = playerRows(pose);
    for (const row of rows) assert.equal(row.length, 7, `${pose} ${row}`);
    assert.equal(rows[0], `.${idle[0]!.slice(1, 6)}.`.replace(/L/gu, 'L'));
  }
  assert.match(playerRows('ride')[2]!, /E/u);
  assert.doesNotMatch(playerRows('hit')[2]!, /E/u);
  assert.equal(playerRows('land').length, 5);
});

test('effects: trail and particles follow the effects level; reduced motion drops flash, shake and pulses', () => {
  const peak = (effects: EffectsLevel) => {
    const particles = new ParticleSystem(createRng(2), 120, effects);
    const trail = new Trail(effects === 'off' ? 0 : 14, effects);
    const f = make({effects, particles, trail, world: emptyRoad});
    f.draw();
    f.game.key(SPACE);
    let top = 0; let trailTop = 0;
    for (let i = 0; i < 160; i += 1) { f.game.animate(16.7); f.game.step(1000 / 60); top = Math.max(top, particles.count); trailTop = Math.max(trailTop, trail.size); }
    assert.ok(top <= 120);
    return {top, trailTop};
  };
  assert.ok(peak('normal').top > 3);
  assert.ok(peak('normal').trailTop > 5);
  assert.equal(peak('off').top, 0);
  assert.equal(peak('off').trailTop, 0);
  const crash = (reduced: boolean) => {
    const f = make({reduced, world: spikeAhead(70)});
    f.game.key(SPACE);
    let calm: unknown;
    for (let i = 0; i < 300 && f.world.alive; i += 1) { f.draw(); calm = f.canvas.cell(2, 4)?.bg; f.game.animate(16.7); f.game.step(1000 / 60); }
    f.draw();
    return {calm, after: f.canvas.cell(2, 4)?.bg};
  };
  const delta = (a: unknown, b: unknown) => { const x = a as {red: number; green: number; blue: number}; const y = b as typeof x; return Math.abs(x.red - y.red) + Math.abs(x.green - y.green) + Math.abs(x.blue - y.blue); };
  const normal = crash(false); const reduced = crash(true);
  assert.ok(delta(normal.calm, normal.after) > 10, 'the impact flashes');
  assert.ok(delta(reduced.calm, reduced.after) < 6);
  // Reduced motion: the sky does not pulse on the beat while running.
  const skyAt = (reducedMotion: boolean) => {
    const f = make({reduced: reducedMotion, world: emptyRoad});
    f.game.key(SPACE);
    const colors = new Set<string>();
    for (let i = 0; i < 120; i += 1) { run(f.game, 1); f.draw(); colors.add(JSON.stringify(f.canvas.cell(2, 6)?.bg)); }
    return colors.size;
  };
  assert.ok(skyAt(false) > skyAt(true), 'a beat pulse exists and reduced motion removes it');
  assert.equal(skyAt(true), 1);
});

test('NO_COLOR and Safe Glyphs: ground, platforms, spikes and the cat stay distinct', () => {
  const rows = 16;
  const setup = (world: DashWorld) => { emptyRoad(world); put(world, 'spike', 14, 6); put(world, 'block', 28, 12, 6); put(world, 'gap', 50, 14); };
  const f = make({color: 'none', rows, world: setup});
  const lines = f.draw();
  assert.match(lines[rows - 3]!, /▲{6}/u, 'spikes are triangles, not blocks');
  assert.ok(lines.slice(0, rows - 2).some(line => line.includes('/\\_/\\')), 'the ASCII cat');
  assert.ok(lines[rows - 2]!.includes('█'), 'solid ground line');
  assert.match(lines[rows - 2]!, /█ {6,}/u, 'a gap in it');
  assert.ok(lines.slice(0, rows - 3).some(line => /█{4}/u.test(line.slice(30, 60))), 'platform blocks');
  assert.doesNotMatch(lines.slice(0, rows - 2).join(''), /[░▒]/u);
  const safe = make({color: 'none', safe: true, rows, world: setup});
  safe.game.render(safe.canvas, 1, palette);
  const ascii = safe.canvas.plain({color: 'none', safe: true});
  for (const line of ascii) assert.match(line, /^[\x20-\x7e]*$/u, line);
  assert.match(ascii[rows - 3]!, /\^{6}/u);
  const colored = make({color: 'truecolor', safe: true, rows, world: emptyRoad});
  colored.game.render(colored.canvas, 1, palette);
  assert.equal(colored.canvas.plain({color: 'none', safe: true})[5]!.trim(), '', 'no backdrop in the sky');
});

test('resize: sizes from 20x8 to 200x60 draw without throwing, every plain row fits, and small sizes show a note', () => {
  for (const [color, safe] of [['truecolor', false], ['none', false], ['256', true]] as const) {
    for (const columns of [20, 33, 40, 80, 121, 200]) for (const rows of [8, 11, 12, 16, 30, 60]) {
      for (const status of ['ready', 'playing', 'over'] as const) {
        const f = make({columns, rows, color, safe, world: status === 'over' ? spikeAhead(12) : undefined});
        if (status !== 'ready') f.game.key(SPACE);
        run(f.game, status === 'over' ? 400 : 40);
        for (const alpha of [0, 0.5, 1]) {
          const lines = f.draw(alpha);
          assert.equal(lines.length, rows);
          for (const line of lines) assert.ok(displayWidth(line) <= columns, `${columns}x${rows}: "${line}"`);
        }
        if (columns < MIN_COLUMNS || rows < MIN_ROWS) assert.match(f.draw().join('\n'), /Needs at least 40x12|Needs at/u);
      }
    }
  }
  const f = make({world: emptyRoad});
  f.game.key(SPACE); run(f.game, 30);
  for (const [columns, rows] of [[50, 13], [140, 40], [20, 8], [64, 18]] as const) {
    f.game.resize({columns, rows});
    const canvas = new Canvas(columns, rows);
    f.game.render(canvas, 1, palette);
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    run(f.game, 10);
  }
  for (const [columns, rows] of [[19, 8], [20, 7], [10, 3], [1, 1]] as const) {
    const small = make({columns, rows});
    for (const line of small.draw()) assert.ok(displayWidth(line) <= columns);
    small.game.key(SPACE); run(small.game, 5);
  }
});

test('a pilot pressing keys on the real game plays long and a game that never acts ends with the card', () => {
  const f = make({seed: 8});
  const pilot = createPilot('mid', createRng(1));
  f.game.key(SPACE);
  for (let i = 0; i < 4000 && f.game.status === 'playing'; i += 1) { if (pilot(f.world)) f.game.key(SPACE); f.game.animate(16.7); f.game.step(1000 / 60); }
  assert.equal(f.game.status, 'playing');
  assert.ok(f.world.meters > 300);
  const idle = make({seed: 8});
  idle.game.key(SPACE);
  run(idle.game, 5000);
  assert.equal(idle.game.status, 'over');
  idle.game.dispose();
});
