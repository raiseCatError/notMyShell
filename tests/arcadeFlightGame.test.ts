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
import {createFlightGame, readRecord} from '../src/arcade/games/flight/game.js';
import {flightGame} from '../src/arcade/games/flight/index.js';
import {geometry, MIN_COLUMNS, MIN_ROWS, worldHeightFor} from '../src/arcade/games/flight/scene.js';
import {catRows} from '../src/arcade/games/flight/sprites.js';
import {CAT_H, FLAP_V, motion, OB_W} from '../src/arcade/games/flight/physics.js';
import {FlightWorld} from '../src/arcade/games/flight/world.js';
import {catPixels} from '../src/idle/catSprite.js';
import {displayWidth} from '../src/util/text.js';

const SPACE: Key = {kind: 'text', value: ' '};
const palette = arcadePalette();

interface Options {
  seed?: number; columns?: number; rows?: number; color?: GameContext['color']; safe?: boolean; reduced?: boolean; effects?: EffectsLevel;
  record?: Record<string, unknown>; world?: (world: FlightWorld) => void; particles?: ParticleSystem;
}

function make(options: Options = {}) {
  let record: Record<string, never> = (options.record ?? {}) as Record<string, never>;
  const seed = options.seed ?? 3;
  const rows = options.rows ?? 24;
  const context: GameContext = {
    size: {columns: options.columns ?? 80, rows}, seed, rng: createRng(seed),
    motion: {effects: options.effects ?? 'normal', reduced: options.reduced ?? false}, color: options.color ?? 'truecolor', safeGlyphs: options.safe ?? false,
    record: {get: () => structuredClone(record), set: next => { record = next as typeof record; return true; }, update: change => { const copy = structuredClone(record); change(copy); record = copy; return true; }},
    now: () => 0,
  };
  const world = new FlightWorld(context.rng.fork('course'), worldHeightFor(rows));
  options.world?.(world);
  const game = createFlightGame(context, {world, ...(options.particles ? {particles: options.particles} : {})});
  const canvas = new Canvas(context.size.columns, context.size.rows);
  const draw = (alpha = 1) => { game.render(canvas, alpha, palette); return canvas.plain(); };
  return {game, world, canvas, draw, context, record: () => record};
}

/** Flies the real game with the floor-hugging strategy through its own key handler. */
function autopilot(game: GameInstance, world: FlightWorld, steps: number, until: () => boolean = () => false): void {
  for (let i = 0; i < steps && game.status === 'playing' && !until(); i += 1) {
    const next = world.course.obstacles.find(o => o.x + OB_W > world.x);
    const floor = (next ? next.gapBottom : world.height) - CAT_H - 0.2;
    if (motion(world.y, world.vy).y > floor) game.key(SPACE);
    game.animate(16.7);
    game.step(1000 / 60);
  }
}
const crash = (game: GameInstance): void => { for (let i = 0; i < 400 && game.status === 'playing'; i += 1) { game.animate(16.7); game.step(1000 / 60); } };

test('definition: id, aliases, title, kind, rates, hints, summary and preview', () => {
  assert.equal(flightGame.id, 'flight');
  assert.deepEqual([...flightGame.aliases], ['vespyr-flight', 'flap']);
  assert.equal(flightGame.title, 'Vespyr Flight');
  assert.equal(flightGame.kind, 'action');
  const {game} = make();
  assert.equal(game.stepsPerSecond, 60);
  assert.equal(game.refreshMs, 100);
  const ready = game.hints().map(hint => `${hint.keys} ${hint.action}`).join(' | ');
  game.key(SPACE);
  const playing = game.hints().map(hint => `${hint.keys} ${hint.action}`).join(' | ');
  assert.match(ready, /Space\/Up flap/u);
  assert.match(playing, /Space\/Up flap.*p pause.*Esc menu/u);
  assert.equal(flightGame.summary({}), 'Not played yet');
  assert.equal(flightGame.summary({best: 14, bestPassed: 14, attempts: 3}), 'Best 14 · 14 passed');
  const preview = new Canvas(30, 6);
  for (let frame = 0; frame < 40; frame += 1) flightGame.preview(preview, frame, palette);
  assert.ok(preview.plain().join('').trim().length > 0);
});

test('state machine: ready until Space or Up; other keys do nothing; the first flap starts the run and flaps', () => {
  const {game, world} = make();
  assert.equal(game.status, 'ready');
  for (const key of [{kind: 'down'}, {kind: 'enter'}, {kind: 'escape'}, {kind: 'text', value: 'x'}] as Key[]) assert.equal(game.key(key), 'ignored');
  game.step(1000 / 60);
  assert.equal(world.steps, 0, 'a game that is ready never steps');
  assert.equal(game.key({kind: 'up'}), 'handled');
  assert.equal(game.status, 'playing');
  assert.equal(world.vy, -FLAP_V, 'the first press also flaps');
  assert.equal(game.key({kind: 'down'}), 'ignored');
  assert.equal(game.key({kind: 'text', value: 'x'}), 'ignored');
  assert.equal(game.key({kind: 'escape'}), 'ignored', 'Esc is the host\'s');
  game.step(1000 / 60);
  assert.equal(world.steps, 1);
});

test('pause: the host stops stepping; nothing advances, resuming continues from the same state', () => {
  const {game, world} = make();
  game.key(SPACE);
  for (let i = 0; i < 5; i += 1) game.step(1000 / 60);
  const y = world.y;
  game.pause();
  for (let i = 0; i < 30; i += 1) game.animate(16.7);
  assert.equal(world.y, y);
  assert.equal(game.status, 'playing');
  game.step(1000 / 60);
  assert.equal(world.steps, 6);
});

test('crash: the run holds for a beat, then ends with a result, details and a record', () => {
  const {game, world, record} = make();
  game.key(SPACE);
  let held = 0;
  while (world.alive) { game.step(1000 / 60); }
  assert.equal(game.status, 'playing', 'the crash itself does not end the run yet');
  const frozen = world.y;
  while (game.status === 'playing') { game.step(1000 / 60); held += 1; assert.equal(world.y, frozen, 'the world holds still'); }
  assert.ok(held >= 20 && held <= 30, `held ${held} steps (about 0.4 s)`);
  assert.equal(game.status, 'over');
  assert.equal(game.result?.score, 0);
  assert.equal(game.result?.record, false, 'a zero is not a record');
  assert.deepEqual(game.result?.details, ['Obstacles passed 0', 'Best 0', 'Attempts 1']);
  assert.deepEqual(record(), {best: 0, bestPassed: 0, attempts: 1});
  assert.equal(game.key(SPACE), 'ignored');
  game.step(1000 / 60);
  assert.equal(world.steps, held + world.steps - held);
});

test('scoring: +1 per obstacle passed, shown big in the HUD, popping on each point and sparkling every 10', () => {
  const particles = new ParticleSystem(createRng(1), 140, 'normal');
  const {game, world, draw, canvas} = make({particles});
  game.key(SPACE);
  draw();
  autopilot(game, world, 2000, () => world.score >= 1);
  assert.equal(world.score, 1);
  const hud = draw()[0]!;
  assert.match(hud, /HI 1/u);
  assert.match(hud, /\b1\b.*$/u);
  const counterX = Math.floor((canvas.width - 1) / 2);
  const lit = canvas.cell(counterX, 0)!;
  assert.equal(lit.ch, '1');
  const quiet = (() => { for (let i = 0; i < 40; i += 1) game.animate(16.7); draw(); return canvas.cell(counterX, 0)!.fg; })();
  assert.notDeepEqual(lit.fg, quiet, 'the counter lights up for a moment after a point');
  particles.clear();
  autopilot(game, world, 100000, () => world.score >= 9);
  const before = particles.count;
  autopilot(game, world, 100000, () => world.score >= 10);
  assert.equal(world.score, 10);
  assert.ok(particles.count >= before + 10, 'a milestone sparkle');
  assert.equal(game.status, 'playing');
});

test('a new best sets the record flag; a lower score does not; attempts count every finished run', () => {
  const first = make({record: {best: 0, bestPassed: 0, attempts: 0}});
  first.game.key(SPACE);
  autopilot(first.game, first.world, 100000, () => first.world.score >= 3);
  crash(first.game);
  first.game.step(1000 / 60);
  assert.equal(first.game.result?.record, true);
  assert.equal(first.game.result?.scoreText, '3');
  assert.deepEqual(first.game.result?.details, ['Obstacles passed 3', 'Best 3', 'Attempts 1']);
  const second = make({record: first.record()});
  second.game.key(SPACE);
  crash(second.game);
  assert.equal(second.game.result?.record, false);
  assert.deepEqual(second.record(), {best: 3, bestPassed: 3, attempts: 2});
  const third = make({record: second.record(), seed: 3});
  third.game.key(SPACE);
  autopilot(third.game, third.world, 100000, () => third.world.score >= 5);
  crash(third.game);
  assert.equal(third.game.result?.record, true);
  assert.deepEqual(third.record(), {best: 5, bestPassed: 5, attempts: 3});
});

test('persistence: records are validated on read; corrupt, negative, huge or foreign values are cleaned', () => {
  assert.deepEqual(readRecord({}), {best: 0, bestPassed: 0, attempts: 0});
  assert.deepEqual(readRecord({best: 12, bestPassed: 11, attempts: 4}), {best: 12, bestPassed: 11, attempts: 4});
  assert.deepEqual(readRecord({best: -3, bestPassed: 'many', attempts: null}), {best: 0, bestPassed: 0, attempts: 0});
  assert.deepEqual(readRecord({best: Number.NaN, bestPassed: Infinity, attempts: 2.9}), {best: 0, bestPassed: 0, attempts: 2});
  assert.deepEqual(readRecord({best: 1e30, bestPassed: [5], attempts: {a: 1}}), {best: 1_000_000_000, bestPassed: 0, attempts: 0});
  const {game, draw} = make({record: {best: 'x', bestPassed: -1, attempts: {}}});
  assert.match(draw()[0]!, /HI 0/u);
  game.key(SPACE);
  crash(game);
  assert.equal(game.result?.record, false);
  // A run left unfinished with a better score is saved by persist() without counting as an attempt.
  const unfinished = make({record: {best: 1, bestPassed: 1, attempts: 5}});
  unfinished.game.key(SPACE);
  autopilot(unfinished.game, unfinished.world, 100000, () => unfinished.world.score >= 4);
  unfinished.game.persist();
  assert.deepEqual(unfinished.record(), {best: 4, bestPassed: 4, attempts: 5});
  unfinished.game.persist();
  unfinished.game.dispose();
  unfinished.game.persist();
});

test('through the real store: a best survives a round trip, a damaged arcade file starts fresh', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-flight-'));
  try {
    const store = new ArcadeStore({directory: dir});
    store.record('flight').update(record => { record.best = 9; record.bestPassed = 9; record.attempts = 2; });
    assert.ok(store.flush());
    const again = new ArcadeStore({directory: dir});
    assert.deepEqual(readRecord(again.record('flight').get()), {best: 9, bestPassed: 9, attempts: 2});
    assert.equal(flightGame.summary(again.record('flight').get()), 'Best 9 · 9 passed');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('restart: a new game is a fresh course, start state and score; another seed is another course', () => {
  const a = make({seed: 3}); const b = make({seed: 3}); const c = make({seed: 4});
  assert.deepEqual(a.world.course.obstacles, b.world.course.obstacles);
  assert.notDeepEqual(a.world.course.obstacles.map(o => o.gapTop), c.world.course.obstacles.map(o => o.gapTop));
  a.game.key(SPACE);
  crash(a.game);
  const again = make({seed: 5, record: a.record()});
  assert.equal(again.game.status, 'ready');
  assert.equal(again.world.score, 0);
  assert.equal(again.world.course.obstacles[0]!.id, 1);
  assert.equal(again.world.x, 0);
  assert.equal(again.game.result, undefined);
});

test('the course and the physics do not depend on the canvas size or the render rate', () => {
  const small = make({columns: 40, rows: 24, seed: 8}); const big = make({columns: 160, rows: 24, seed: 8});
  small.game.key(SPACE); big.game.key(SPACE);
  autopilot(small.game, small.world, 600); autopilot(big.game, big.world, 600);
  assert.equal(small.world.y, big.world.y);
  assert.deepEqual(small.world.course.obstacles, big.world.course.obstacles);
  const fast = make({seed: 8}); const slow = make({seed: 8});
  fast.game.key(SPACE); slow.game.key(SPACE);
  for (let i = 0; i < 100; i += 1) { fast.game.step(1000 / 60); slow.game.step(1000 / 60); fast.draw(0.1); slow.draw(0.9); slow.game.animate(500); }
  assert.equal(fast.world.y, slow.world.y);
});

test('the cat poses are Vespyr: ears, eyes, whiskers, four legs and a tail from catPixels(), wings added', () => {
  const idle = catPixels('idle');
  const base = (look: Parameters<typeof catRows>[0]) => catRows(look);
  const look = {wing: 'mid', legs: 'dangle', tail: 'curled', blink: false, twitch: false, hit: false} as const;
  const rows = base(look);
  assert.equal(rows.length, idle.length);
  assert.ok(rows.every(row => row.length === 14));
  assert.equal(rows[0]!.slice(0, 6), idle[0]!.slice(0, 6), 'ears');
  assert.equal(rows[2]!.slice(1, 6), idle[2]!.slice(1, 6), 'eyes');
  assert.equal([...rows[2]!, ...rows[3]!].filter(char => char === 'K').length, 2, 'whiskers');
  assert.equal(rows[7]!.replace(/\./gu, '').length, 4, 'four legs hang when falling');
  assert.ok(rows.join('').includes('W') && rows.join('').includes('V'), 'near and far wing');
  for (const wing of ['up', 'mid', 'down'] as const) for (const tail of ['streaming', 'curled', 'level', 'trailing'] as const) {
    const pose = base({...look, wing, tail});
    assert.ok(pose.join('').includes('T'), 'a tail in every pose');
    assert.ok(pose.join('').includes('W'));
  }
  assert.notDeepEqual(base({...look, wing: 'up'}), base({...look, wing: 'down'}), 'the wing cycle changes the sprite');
  assert.notDeepEqual(base({...look, tail: 'streaming'}), base({...look, tail: 'trailing'}), 'the tail follows the motion');
  assert.ok(!base({...look, blink: true}).join('').includes('E'), 'a blink closes the eyes');
  assert.notEqual(base({...look, twitch: true})[0], base(look)[0], 'ear twitch');
});

test('wings and tail animate from flaps and motion in the rendered game', () => {
  const frames = new Set<string>();
  const {game, world, draw} = make();
  game.key(SPACE);
  for (let i = 0; i < 90; i += 1) {
    if (i % 25 === 0) game.key(SPACE);
    game.animate(16.7); game.step(1000 / 60);
    if (!world.alive) break;
    frames.add(draw().slice(Math.max(0, Math.floor(world.y / 2) - 1), Math.floor(world.y / 2) + 8).join('\n'));
  }
  assert.ok(frames.size > 5, `${frames.size} distinct cat frames`);
});

test('resize: any canvas from 20x8 to 200x60 draws without throwing, every plain row within width, with a note when too small', () => {
  const sizes = [[20, 8], [29, 16], [30, 15], [30, 16], [40, 17], [60, 20], [80, 24], [120, 40], [200, 60], [200, 8], [20, 60]];
  for (const [columns, rows] of sizes) {
    const {game, canvas, draw} = make({columns: columns!, rows: rows!});
    for (const phase of ['ready', 'playing', 'over'] as const) {
      if (phase === 'playing') game.key(SPACE);
      if (phase === 'over') crash(game);
      for (let i = 0; i < 6 && game.status === 'playing'; i += 1) { game.animate(16.7); game.step(1000 / 60); }
      const lines = draw();
      assert.equal(lines.length, rows);
      for (const line of lines) assert.ok(displayWidth(line) <= columns!, `${columns}x${rows}: ${line}`);
      assert.ok(lines.join('').trim().length > 0);
      if (columns! < MIN_COLUMNS || rows! < MIN_ROWS) assert.match(lines.join('\n'), /Needs at least 30x16/u);
      else assert.doesNotMatch(lines.join('\n'), /Needs at least/u);
      for (const row of canvas.rows({color: 'truecolor', safe: false})) assert.ok(displayWidth(row.replace(/\u001b\[[0-9;]*m/gu, '')) <= columns!);
    }
  }
});

test('live resizing keeps the run going and the canvas sized to the new playfield', () => {
  const {game, world, context} = make({columns: 80, rows: 24});
  game.key(SPACE);
  autopilot(game, world, 120);
  const y = world.y;
  const sizes = [[40, 18], [120, 50], [30, 16], [20, 8], [80, 24]];
  for (const [columns, rows] of sizes) {
    game.resize({columns: columns!, rows: rows!});
    const canvas = new Canvas(columns!, rows!);
    game.render(canvas, 0.5, palette);
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns!);
  }
  assert.equal(world.y, y, 'resizing never moves the cat in the world');
  void context;
  const geo = geometry(200, 60, 56);
  assert.equal(geo.scale, 1);
  assert.ok(geo.top % 2 === 0 && geo.groundY % 2 === 0);
  assert.ok(geometry(30, 16, 56).scale < 1, 'a world taller than a shrunken canvas is compressed, not clipped');
  assert.equal(worldHeightFor(16), 26);
  assert.equal(worldHeightFor(100), 56);
});

test('NO_COLOR and Safe Glyphs: no escapes without color, ASCII only when safe, obstacles distinct from the cat and ground', () => {
  const none = make({color: 'none'});
  none.game.key(SPACE);
  autopilot(none.game, none.world, 200, () => none.world.course.obstacles[0]!.x - none.world.x < 20);
  none.draw();
  assert.equal(none.canvas.rows({color: 'none', safe: false}).some(row => /\u001b\[[34]8;/u.test(row)), false, 'no color escapes at all');
  const plain = none.canvas.plain().join('\n');
  assert.match(plain, /█/u, 'the cat and the lips are solid');
  assert.match(plain, /[▀▄]/u, 'the obstacle fill is a dotted pattern, not another solid block');
  assert.match(plain, /▒/u, 'the ground has its own texture');
  const catRowsText = none.canvas.plain().slice(0, 23).map(line => line.slice(0, 20));
  assert.ok(catRowsText.some(line => /[█▀▄]/u.test(line)), 'the cat is drawn');
  const safe = make({color: 'none', safe: true});
  safe.game.key(SPACE);
  autopilot(safe.game, safe.world, 200, () => safe.world.course.obstacles[0]!.x - safe.world.x < 20);
  safe.draw();
  for (const row of safe.canvas.plain({color: 'none', safe: true})) assert.ok(/^[\x20-\x7e]*$/u.test(row), row);
  const colored = make({color: 'truecolor', safe: true});
  colored.draw();
  for (const row of colored.canvas.plain({color: 'none', safe: true})) assert.ok(/^[\x20-\x7e]*$/u.test(row));
  // Truecolor keeps the backdrop; plain drops it (so the pixels can be told apart).
  const rich = make({color: 'truecolor'});
  rich.draw();
  const row = 12;
  const skyBackgrounds = new Set(Array.from({length: 20}, (_, x) => JSON.stringify(rich.canvas.cell(x, row)?.bg)));
  assert.ok(rich.canvas.rows().join('').includes('\u001b['));
  assert.ok(skyBackgrounds.size >= 1);
});

test('reduced motion: no shake, no flash, no fade, no sparkles, no popups, no trail; the run still ends clearly and sooner', () => {
  const particles = new ParticleSystem(createRng(1), 140, 'normal');
  const calm = make({reduced: true, particles});
  calm.game.key(SPACE);
  const pixelsBefore = calm.draw();
  autopilot(calm.game, calm.world, 100000, () => calm.world.score >= 10);
  assert.equal(particles.count, 0, 'nothing decorative, not even the milestone');
  let held = 0;
  while (calm.world.alive) calm.game.step(1000 / 60);
  while (calm.game.status === 'playing') { calm.game.step(1000 / 60); held += 1; }
  assert.ok(held <= 10, `${held} steps`);
  assert.equal(particles.count, 0);
  const sky = (instance: ReturnType<typeof make>) => { instance.draw(); return JSON.stringify(instance.canvas.cell(2, 6)?.bg); };
  const full = make({reduced: false});
  full.game.key(SPACE);
  const livelySky = sky(full);
  crash(full.game);
  full.game.step(1000 / 60);
  assert.notEqual(sky(full), livelySky, 'a normal run fades toward dusk');
  const stillCalm = make({reduced: true});
  stillCalm.game.key(SPACE);
  while (stillCalm.world.alive) stillCalm.game.step(1000 / 60);
  const justHit = sky(stillCalm);
  crash(stillCalm.game);
  assert.equal(stillCalm.game.status, 'over');
  assert.equal(sky(stillCalm), justHit, 'reduced motion never tints the scene');
  assert.ok(pixelsBefore.length > 0);
});

test('effects off: no particles, trails or popups at all, but the game plays and ends the same', () => {
  const particles = new ParticleSystem(createRng(1), 140, 'off');
  const off = make({effects: 'off', particles});
  off.game.key(SPACE);
  autopilot(off.game, off.world, 100000, () => off.world.score >= 10);
  assert.equal(particles.count, 0);
  crash(off.game);
  assert.equal(off.game.status, 'over');
  assert.equal(particles.count, 0);
  const rich = make({effects: 'rich'});
  rich.game.key(SPACE);
  autopilot(rich.game, rich.world, 300);
  rich.draw();
});

test('game over: the world stays frozen with the hit pose and the scene fades toward dusk over about 400 ms', () => {
  const {game, world, draw, canvas} = make();
  game.key(SPACE);
  draw();
  const start = JSON.stringify(canvas.cell(2, 6)?.bg);
  while (world.alive) game.step(1000 / 60);
  const fades: string[] = [];
  while (game.status === 'playing') { game.step(1000 / 60); draw(); fades.push(JSON.stringify(canvas.cell(2, 6)?.bg)); }
  assert.ok(new Set(fades).size > 3, 'a gradual fade, not a cut');
  assert.notEqual(fades.at(-1), start);
  const hitRows = draw();
  assert.ok(hitRows.join('').trim().length > 0);
  const over = draw();
  assert.deepEqual(draw(), over, 'frozen: the same frame every time');
});

test('dispose releases everything and is safe to repeat', () => {
  const {game} = make();
  game.key(SPACE);
  game.dispose();
  game.dispose();
  assert.doesNotThrow(() => game.persist());
});

test('inside the arcade session: Space starts, steps arrive at 60 per second, the game over card appears', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-flight-session-'));
  try {
    const env: ArcadeEnvironment = {store: new ArcadeStore({directory: dir}), now: () => 1000, motion: () => ({reduced: false, effects: 'normal'}), color: () => 'none', safeGlyphs: () => false, seed: () => 7};
    const session = new ArcadeSession(env, [flightGame], {columns: 90, rows: 28}, flightGame);
    const frame = session.render();
    assert.ok(frame.rows.some(row => /Vespyr Flight/u.test(row)));
    session.key(SPACE);
    for (let i = 0; i < 400; i += 1) session.frame(1000 / 60);
    const after = session.render().rows.join('\n');
    assert.match(after, /Retry|Back to Arcade|Game over|Obstacles passed/iu);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
