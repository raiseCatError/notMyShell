import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import type {Key} from '../src/terminal/keys.js';
import {ArcadeSession, type ArcadeEnvironment} from '../src/arcade/ArcadeSession.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {ParticleSystem, type EffectsLevel} from '../src/arcade/effects.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {createRng} from '../src/arcade/rng.js';
import {ArcadeStore} from '../src/arcade/scores.js';
import type {GameContext, GameInstance} from '../src/arcade/types.js';
import {createRunGame, readRecord} from '../src/arcade/games/run/game.js';
import {runGame} from '../src/arcade/games/run/index.js';
import {KINDS, type Obstacle} from '../src/arcade/games/run/course.js';
import {catRows} from '../src/arcade/games/run/sprites.js';
import {obstacleRows} from '../src/arcade/games/run/sprites.js';
import {AERIAL_LIFT, CAT_W, HB_X, SPRITE_W} from '../src/arcade/games/run/physics.js';
import {RunWorld} from '../src/arcade/games/run/world.js';
import {catPixels, CAT_PIXELS} from '../src/idle/catSprite.js';
import {displayWidth} from '../src/util/text.js';
import {playBot} from './support/runBot.js';

const SPACE: Key = {kind: 'text', value: ' '};
const palette = arcadePalette();

interface Options {
  seed?: number; columns?: number; rows?: number; color?: GameContext['color']; safe?: boolean; reduced?: boolean; effects?: EffectsLevel;
  record?: Record<string, unknown>; world?: (world: RunWorld) => void; particles?: ParticleSystem;
}

function make(options: Options = {}) {
  let record: Record<string, never> = (options.record ?? {}) as Record<string, never>;
  const seed = options.seed ?? 3;
  const context: GameContext = {
    size: {columns: options.columns ?? 80, rows: options.rows ?? 16}, seed, rng: createRng(seed),
    motion: {effects: options.effects ?? 'normal', reduced: options.reduced ?? false}, color: options.color ?? 'truecolor', safeGlyphs: options.safe ?? false,
    record: {get: () => structuredClone(record), set: next => { record = next as typeof record; return true; }, update: change => { const copy = structuredClone(record); change(copy); record = copy; return true; }},
    now: () => 0,
  };
  const world = new RunWorld(context.rng.fork('course'));
  options.world?.(world);
  const parts = {world, ...(options.particles ? {particles: options.particles} : {})};
  const game = createRunGame(context, parts);
  const canvas = new Canvas(context.size.columns, context.size.rows);
  const draw = (alpha = 1) => { game.render(canvas, alpha, palette); return canvas.plain(); };
  return {game, world, canvas, draw, context, record: () => record};
}

/** A road with nothing on it for a very long way. */
const emptyRoad = (world: RunWorld): void => {
  world.course.obstacles.length = 0;
  (world.course as unknown as {free: number}).free = 1e9;
};
/** One obstacle straight ahead, `ahead` pixels from the cat's hitbox. */
const placeAhead = (world: RunWorld, kind: Obstacle['kind'], ahead: number): void => {
  emptyRoad(world);
  const spec = KINDS[kind];
  world.course.obstacles.push({id: 500, kind, x: world.distance + HB_X + CAT_W + ahead, w: spec.w, h: spec.h, lift: spec.air ? AERIAL_LIFT : 0, air: spec.air, count: 1});
};
const run = (game: GameInstance, steps: number): void => { for (let i = 0; i < steps && game.status === 'playing'; i += 1) { game.animate(16.7); game.step(1000 / 60); } };

test('definition: id, aliases, title, kind, rates and hints', () => {
  assert.equal(runGame.id, 'run');
  assert.deepEqual([...runGame.aliases], ['vespyr-run', 'dino']);
  assert.equal(runGame.title, 'Vespyr Run');
  assert.equal(runGame.kind, 'action');
  const {game} = make();
  assert.equal(game.stepsPerSecond, 60);
  assert.equal(game.refreshMs, 100);
  const hints = game.hints().map(hint => `${hint.keys} ${hint.action}`).join(' | ');
  game.key(SPACE);
  const playing = game.hints().map(hint => `${hint.keys} ${hint.action}`).join(' | ');
  assert.match(hints, /Space\/Up run/u);
  assert.match(playing, /Space\/Up jump.*Down duck.*p pause.*Esc menu/u);
  assert.equal(runGame.summary({}), 'Not played yet');
  assert.equal(runGame.summary({best: 420, bestDistance: 210, runs: 3}), 'Best 420 · 210 m');
  const preview = new Canvas(30, 6);
  for (let frame = 0; frame < 40; frame += 1) runGame.preview(preview, frame, palette);
  assert.ok(preview.plain().join('').trim().length > 0);
});

test('state machine: ready until Space or Up; other keys do nothing; the first press starts and jumps', () => {
  const {game, world} = make({world: emptyRoad});
  assert.equal(game.status, 'ready');
  for (const key of [{kind: 'down'}, {kind: 'enter'}, {kind: 'escape'}, {kind: 'text', value: 'x'}] as Key[]) assert.equal(game.key(key), 'ignored');
  game.step(1000 / 60);
  assert.equal(world.steps, 0, 'a game that is ready never steps');
  assert.equal(game.key({kind: 'up'}), 'handled');
  assert.equal(game.status, 'playing');
  assert.equal(world.airborne, true, 'the first press also jumps');
  assert.equal(game.key({kind: 'down'}), 'handled');
  assert.equal(game.key({kind: 'text', value: 'x'}), 'ignored');
  assert.equal(game.key({kind: 'escape'}), 'ignored', 'Esc is the host\'s: it pauses a run and leaves a game that has not started');
});

test('scoring: score is distance, shown as a leading-zero counter, and a milestone celebrates', () => {
  const {game, world, draw, canvas} = make({world: emptyRoad});
  game.key(SPACE);
  run(game, 60);
  const score = world.score;
  assert.equal(score, Math.floor(world.distance / 5));
  const hud = draw()[0]!;
  assert.match(hud, new RegExp(`\\b${String(score).padStart(5, '0')}\\b`, 'u'), hud);
  assert.match(hud, /HI \d{5}/u);
  const counterX = canvas.width - 6;
  const calm = canvas.cell(counterX, 0)!.fg;
  while (world.score < 100) run(game, 1);
  draw();
  assert.notDeepEqual(canvas.cell(counterX, 0)!.fg, calm, 'the counter lights up when passing 100');
  run(game, 700);
  draw();
  assert.deepEqual(canvas.cell(counterX, 0)!.fg, calm, 'and settles again');
  assert.equal(game.status, 'playing');
});

test('crash: the run holds for a beat, then ends with a result, details and a record', () => {
  const {game, world, record} = make({world: w => placeAhead(w, 'crates', 30)});
  game.key(SPACE);
  game.key({kind: 'down'});
  for (let i = 0; i < 200 && world.alive; i += 1) { game.step(1000 / 60); if (!world.airborne) world.duck(); }
  assert.equal(world.alive, false);
  assert.equal(game.status, 'playing', 'the impact is shown before the card');
  const before = world.steps;
  run(game, 100);
  assert.equal(game.status, 'over');
  assert.equal(world.steps, before, 'the world is frozen after the crash');
  const result = game.result!;
  assert.equal(result.score, world.score);
  assert.equal(result.scoreText, String(world.score).padStart(5, '0'));
  assert.equal(result.record, true, 'first scoring run is a new best');
  assert.deepEqual(result.details, [`Distance ${world.meters} m`, `Best ${world.score}`, 'Runs 1']);
  assert.deepEqual(record(), {best: world.score, bestDistance: world.meters, runs: 1});
  assert.equal(game.key(SPACE), 'ignored');
});

test('records: best only grows, record flag only for a real new best, damaged records are cleaned, abandoned runs are not counted', () => {
  assert.deepEqual(readRecord({best: 'lots', bestDistance: -4, runs: Number.NaN}), {best: 0, bestDistance: 0, runs: 0});
  assert.deepEqual(readRecord({best: 12.9, bestDistance: 1e30, runs: 3}), {best: 12, bestDistance: 1e9, runs: 3});
  assert.deepEqual(readRecord({best: null, bestDistance: {a: 1}, runs: [1]} as never), {best: 0, bestDistance: 0, runs: 0});
  const higher = make({record: {best: 99999, bestDistance: 5000, runs: 4}, world: w => placeAhead(w, 'crates', 20)});
  higher.game.key(SPACE);
  run(higher.game, 400);
  assert.equal(higher.game.status, 'over');
  assert.equal(higher.game.result!.record, false);
  assert.deepEqual(higher.record(), {best: 99999, bestDistance: 5000, runs: 5});
  const junk = make({record: {best: 'x', runs: -2, bestDistance: 'y', stray: 1} as never, world: w => placeAhead(w, 'crates', 20)});
  junk.game.key(SPACE);
  run(junk.game, 400);
  assert.equal(junk.game.status, 'over');
  assert.equal(junk.game.result!.details[2], 'Runs 1');
  // Leaving mid run keeps a better score but does not count a run, and never counts twice.
  const abandoned = make({record: {best: 3, bestDistance: 1, runs: 7}, world: emptyRoad});
  abandoned.game.key(SPACE);
  run(abandoned.game, 300);
  abandoned.game.persist(); abandoned.game.persist();
  assert.deepEqual(abandoned.record(), {best: abandoned.world.score, bestDistance: abandoned.world.meters, runs: 7});
  abandoned.game.dispose();
});

test('persistence: a finished run survives a restart of the store', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-run-'));
  try {
    const first = new ArcadeStore({directory: dir});
    const handle = first.record('run');
    const context: GameContext = {size: {columns: 60, rows: 14}, seed: 2, rng: createRng(2), motion: {effects: 'normal', reduced: false}, color: 'none', safeGlyphs: false, record: handle, now: () => 0};
    const world = new RunWorld(context.rng.fork('course')); placeAhead(world, 'crates', 150);
    const game = createRunGame(context, {world});
    game.key(SPACE);
    run(game, 3000);
    assert.equal(game.status, 'over');
    assert.ok(first.flush());
    const second = new ArcadeStore({directory: dir}).record('run').get();
    assert.deepEqual(second, {best: world.score, bestDistance: world.meters, runs: 1});
    assert.match(runGame.summary(second), /^Best \d+ · \d+ m$/u);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('pause and restart through the session: nothing steps while paused, status is the game\'s own, Retry builds a new run from a new seed', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-run-s-'));
  let now = 1000;
  let seed = 10;
  const env: ArcadeEnvironment = {store: new ArcadeStore({directory: dir}), now: () => now, motion: () => ({reduced: false, effects: 'normal'}), color: () => 'none', safeGlyphs: () => false, seed: () => seed};
  const session = new ArcadeSession(env, [runGame], {columns: 80, rows: 22}, runGame);
  try {
    const screen = () => session.render().rows.join('\n');
    const first = session.game!;
    assert.equal(first.status, 'ready');
    assert.equal(session.key({kind: 'up'}), 'handled');
    assert.equal(first.status, 'playing');
    session.frame(200);
    const moved = screen();
    session.key({kind: 'text', value: 'p'});
    assert.equal(session.screen, 'paused');
    assert.equal(first.status, 'playing', 'the host does not change the game\'s status');
    session.frame(1000);
    assert.match(screen(), /Paused/u);
    session.key({kind: 'enter'});
    assert.equal(session.screen, 'playing');
    assert.notEqual(moved, '');
    // Die without acting, then Retry.
    for (let i = 0; i < 60 && first.status === 'playing'; i += 1) session.frame(100);
    assert.equal(first.status, 'over');
    assert.equal(session.screen, 'over');
    now += 1000; seed = 11;
    session.key({kind: 'enter'});
    assert.notEqual(session.game, first, 'Retry is a fresh game');
    assert.equal(session.game!.status, 'ready');
    assert.equal(session.key(SPACE), 'handled');
    assert.equal(session.game!.status, 'playing');
  } finally { session.dispose(); rmSync(dir, {recursive: true, force: true}); }
});

test('restart creates a fresh course: the same seed repeats it, a new seed does not', () => {
  const courseOf = (seed: number) => { const { world } = make({seed}); return world.course.obstacles.slice(0, 8).map(o => `${o.kind}${o.count}@${o.x.toFixed(2)}`).join(','); };
  assert.equal(courseOf(21), courseOf(21));
  assert.notEqual(courseOf(21), courseOf(22));
  // Unseen effects never disturb the course: a different effects level draws different particles but the same road.
  const a = make({seed: 5, effects: 'off'}); const b = make({seed: 5, effects: 'rich'});
  assert.equal(a.world.hash(), b.world.hash());
});

test('sprites: every cat pose is the approved silhouette; every frame is 14 wide; obstacle art matches its physics box', () => {
  const base = catPixels('idle');
  assert.deepEqual(base, [...CAT_PIXELS]);
  for (const shape of ['run', 'air', 'fall', 'land', 'hit', 'idle', 'blink'] as const) {
    for (let frame = 0; frame < 6; frame += 1) for (let tail = 0; tail < 4; tail += 1) for (const twitch of [false, true]) {
      const rows = catRows({shape, frame, tail, twitch});
      assert.equal(rows.length, 8, shape);
      for (const row of rows) assert.equal(row.length, SPRITE_W, `${shape} ${row}`);
      // The head and body (rows 1..6 left of the tail) are always the cat's own pixels.
      for (const index of [4, 5, 6]) if (shape === 'run') assert.equal(rows[index]!.slice(0, 12), base[index]!.slice(0, 12));
    }
  }
  for (const frame of [0, 1]) for (const row of catRows({shape: 'duck', frame, tail: 0, twitch: false})) assert.equal(row.length, SPRITE_W);
  assert.equal(catRows({shape: 'duck', frame: 0, tail: 0, twitch: false}).length, 5);
  for (const [kind, spec] of Object.entries(KINDS)) {
    for (const flap of [false, true]) {
      const rows = obstacleRows(kind as keyof typeof KINDS, flap);
      assert.equal(rows.length, spec.h, `${kind} height`);
      for (const row of rows) assert.equal(row.length, spec.w, `${kind} width`);
    }
  }
});

test('resize: any size from 20x8 up draws without throwing and every row fits; smaller shows a note', () => {
  for (const [color, safe] of [['truecolor', false], ['none', false], ['256', true]] as const) {
    for (const columns of [20, 21, 33, 60, 80, 121, 200]) for (const rows of [8, 9, 12, 16, 24, 40, 50]) {
      for (const status of ['ready', 'playing', 'over'] as const) {
        const f = make({columns, rows, color, safe, world: status === 'over' ? w => placeAhead(w, 'crates', 12) : emptyRoad});
        if (status !== 'ready') f.game.key(SPACE);
        run(f.game, status === 'over' ? 400 : 40);
        for (const alpha of [0, 0.5, 1]) {
          const lines = f.draw(alpha);
          assert.equal(lines.length, rows);
          for (const line of lines) assert.ok(displayWidth(line) <= columns, `${columns}x${rows} ${status}: "${line}"`);
        }
      }
    }
  }
  // A live resize keeps the run going at the new size.
  const f = make({world: emptyRoad});
  f.game.key(SPACE); run(f.game, 30);
  for (const [columns, rows] of [[30, 9], [140, 40], [20, 8], [64, 18]] as const) {
    f.game.resize({columns, rows});
    const canvas = new Canvas(columns, rows);
    f.game.render(canvas, 1, palette);
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
    run(f.game, 10);
  }
  for (const [columns, rows] of [[19, 8], [20, 7], [10, 3], [1, 1]] as const) {
    const small = make({columns, rows});
    const lines = small.draw();
    assert.ok(lines.join('').trim().length > 0, 'a note is shown');
    for (const line of lines) assert.ok(displayWidth(line) <= columns);
    small.game.key(SPACE); run(small.game, 5);
  }
});

test('NO_COLOR and Safe Glyphs: ground, obstacles and the cat stay distinct without any color', () => {
  const rows = 16;
  const f = make({color: 'none', rows, world: w => { emptyRoad(w); }});
  f.world.course.obstacles.push({id: 2, kind: 'bird', x: 35, w: 10, h: 4, lift: AERIAL_LIFT, air: true, count: 1}, {id: 1, kind: 'crates', x: 60, w: 6, h: 6, lift: 0, air: false, count: 1});
  const lines = f.draw();
  const ground = lines[rows - 2]!;
  assert.equal(ground, '█'.repeat(80), 'a solid ground line across the whole width');
  assert.match(lines[rows - 1]!, /[:·]/u, 'with texture beneath');
  const body = lines.slice(0, rows - 2).join('\n');
  assert.doesNotMatch(body, /[░▒▓]/u);
  const columnOf = (pattern: RegExp) => lines.slice(0, rows - 2).some(line => pattern.test(line));
  assert.ok(columnOf(/█▄▄▄█/u), 'the cat\'s ears and head');
  assert.ok(lines[rows - 3]!.includes('██▄▄██'), 'the crate stands on the ground');
  assert.ok(lines.slice(0, rows - 3).some(line => /[▀▄█]/u.test(line.slice(46, 57))), 'the bird hangs above the ground');
  // Safe Glyphs: the same scene in ASCII only.
  const safe = make({color: 'none', safe: true, rows, world: emptyRoad});
  safe.world.course.obstacles.push({id: 1, kind: 'crates', x: 60, w: 6, h: 6, lift: 0, air: false, count: 1});
  safe.game.render(safe.canvas, 1, palette);
  const ascii = safe.canvas.plain({color: 'none', safe: true});
  for (const line of ascii) assert.match(line, /^[\x20-\x7e]*$/u, line);
  assert.equal(ascii[rows - 2], '#'.repeat(80));
  assert.ok(ascii.slice(0, rows - 2).join('\n').includes('#'), 'obstacle and cat survive as solid glyphs');
  // With color but Safe Glyphs, the busy backdrop is dropped so the glyph render stays readable too.
  const colored = make({color: 'truecolor', safe: true, rows, world: emptyRoad});
  colored.game.render(colored.canvas, 1, palette);
  assert.equal(colored.canvas.plain({color: 'none', safe: true})[7]!.trim(), '', 'no hills or clouds in the sky rows');
});

test('reduced motion: no flash, no shake, no burst, a shorter hold; effects off draws no particles', () => {
  const crash = (reduced: boolean, effects: EffectsLevel, particles?: ParticleSystem) => {
    const f = make({reduced, effects, world: w => placeAhead(w, 'crates', 16), ...(particles ? {particles} : {})});
    f.game.key(SPACE);
    f.game.key({kind: 'down'});
    let calm: unknown;
    for (let i = 0; i < 400 && f.world.alive; i += 1) { f.draw(); calm = f.canvas.cell(2, 2)?.bg; f.game.animate(16.7); f.game.step(1000 / 60); if (!f.world.airborne) f.world.duck(); }
    assert.equal(f.world.alive, false);
    f.draw();
    return {f, calm, after: f.canvas.cell(2, 2)?.bg};
  };
  const normal = crash(false, 'normal');
  assert.notDeepEqual(normal.after, normal.calm, 'the impact flashes the sky');
  const reduced = crash(true, 'normal');
  const delta = (a: unknown, b: unknown) => { const x = a as {red: number; green: number; blue: number}; const y = b as typeof x; return Math.abs(x.red - y.red) + Math.abs(x.green - y.green) + Math.abs(x.blue - y.blue); };
  assert.ok(delta(reduced.after, reduced.calm) < 6, 'reduced motion never flashes');
  // Two frames of the held pose are identical when reduced (no shake, no particles), and move when not.
  const frames = (f: ReturnType<typeof make>) => { const a = f.draw(); f.game.animate(40); const b = f.draw(); f.game.animate(40); const c = f.draw(); return [a.join('\n'), b.join('\n'), c.join('\n')]; };
  const stillFrames = frames(reduced.f);
  assert.equal(stillFrames[0], stillFrames[1]); assert.equal(stillFrames[1], stillFrames[2]);
  const moving = frames(normal.f);
  assert.ok(moving[0] !== moving[1] || moving[1] !== moving[2], 'the burst and shake animate when allowed');
  // Particle pools: a normal crash fills the pool, 'off' and reduced motion never do.
  const pool = (reducedMotion: boolean, level: EffectsLevel) => { const system = new ParticleSystem(createRng(1), 140, level); crash(reducedMotion, level, system); return system.count; };
  assert.ok(pool(false, 'normal') > 15);
  assert.equal(pool(false, 'off'), 0);
  assert.ok(pool(true, 'normal') < pool(false, 'normal'), 'no impact burst when motion is reduced');
});

test('running dust and the landing puff exist with effects on and not with effects off', () => {
  const dusty = (effects: EffectsLevel) => {
    const system = new ParticleSystem(createRng(2), 140, effects);
    const f = make({effects, particles: system, world: emptyRoad});
    f.draw();
    f.game.key(SPACE);
    let peak = 0;
    for (let i = 0; i < 160; i += 1) { f.game.animate(16.7); f.game.step(1000 / 60); peak = Math.max(peak, system.count); }
    return peak;
  };
  assert.ok(dusty('normal') > 3);
  assert.ok(dusty('rich') >= dusty('subtle'));
  assert.equal(dusty('off'), 0);
});

test('a bot playing the real game through keys survives a long run and the card appears for one that never acts', () => {
  const idle = make({seed: 8});
  idle.game.key(SPACE);
  run(idle.game, 5000);
  assert.equal(idle.game.status, 'over');
  assert.ok(playBot(8, 3000, 'mid').survived);
  idle.game.dispose();
});
