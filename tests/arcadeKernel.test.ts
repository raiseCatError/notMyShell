import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Canvas, BrailleBuffer, PixelBuffer, spriteFromRows} from '../src/arcade/Canvas.js';
import {FixedStep, FrameTimer} from '../src/arcade/loop.js';
import {createRng, hashSeed} from '../src/arcade/rng.js';
import {ParticleSystem, Popups, Shake, Trail} from '../src/arcade/effects.js';
import {ArcadeStore, ARCADE_FILE, MAX_FILE_BYTES} from '../src/arcade/scores.js';
import {arcadePalette, regionColors, skyAt} from '../src/arcade/palette.js';
import {findGame, ARCADE_GAMES, gameNames} from '../src/arcade/registry.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';

const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-'));

test('rng: the same seed gives the same sequence; forks do not disturb it', () => {
  const a = createRng('vespyr');
  const b = createRng('vespyr');
  assert.deepEqual(Array.from({length: 8}, () => a.next()), Array.from({length: 8}, () => b.next()));
  const c = createRng(7);
  const d = createRng(7);
  c.fork('particles').next();
  assert.equal(c.next(), d.next(), 'a fork never advances its parent');
  assert.notEqual(hashSeed('a'), hashSeed('b'));
  const r = createRng(1);
  for (let i = 0; i < 500; i += 1) { const n = r.int(3, 6); assert.ok(n >= 3 && n <= 6); }
  assert.equal(r.shuffle([1, 2, 3, 4, 5]).sort().join(''), '12345');
});

test('fixed step: equal steps whatever the frame rate, a stall is clamped, the remainder carries', () => {
  const run = (frame: number, total: number) => {
    const loop = new FixedStep(10, 100);
    let steps = 0;
    for (let t = 0; t < total; t += frame) loop.advance(frame, () => { steps += 1; });
    return steps;
  };
  assert.equal(run(10, 1000), 100);
  assert.equal(run(33, 990), 99);
  const loop = new FixedStep(10, 5);
  let steps = 0;
  const alpha = loop.advance(10_000, () => { steps += 1; });
  assert.equal(steps, 5, 'a long stall is not replayed as a burst');
  assert.ok(alpha >= 0 && alpha < 1);
  let now = 0;
  const timer = new FrameTimer(() => now);
  assert.equal(timer.delta(), 0);
  now = 40;
  assert.equal(timer.delta(), 40);
});

test('canvas: text clips, wide glyphs take two cells, rows are cached and re-encoded only when changed', () => {
  const canvas = new Canvas(10, 3);
  assert.equal(canvas.text(-2, 0, 'hello'), 5);
  assert.equal(canvas.plain()[0], 'llo       ');
  canvas.text(8, 1, '猫猫');
  assert.equal(canvas.plain()[1]!.length >= 9, true);
  assert.ok(canvas.plain().every(row => displayWidth(row) <= 10));
  const first = canvas.rows();
  const second = canvas.rows();
  assert.equal(first[2], second[2]);
  canvas.put(0, 2, 'x', {fg: {red: 1, green: 2, blue: 3}});
  assert.notEqual(canvas.rows()[2], first[2]);
  assert.equal(canvas.rows()[0], first[0], 'untouched rows come from the cache');
});

test('canvas: pixel layers draw half blocks; without color a lit half is a solid glyph; Safe Glyphs are ASCII only', () => {
  const red = {red: 255, green: 0, blue: 0};
  const blue = {red: 0, green: 0, blue: 255};
  const buffer = new PixelBuffer(3, 4);
  buffer.set(0, 0, red); buffer.set(0, 1, blue); buffer.set(1, 0, red); buffer.set(2, 3, blue);
  const canvas = new Canvas(3, 2);
  canvas.blit(buffer);
  assert.deepEqual(canvas.plain({color: 'none', safe: false}), ['█▀ ', '  ▄']);
  assert.deepEqual(canvas.plain({color: 'none', safe: true}), ['#" ', '  ,']);
  assert.match(canvas.rows({color: 'truecolor', safe: false})[0]!, /\u001b\[38;2;255;0;0m\u001b\[48;2;0;0;255m▀/u);
  assert.doesNotMatch(canvas.rows({color: 'none', safe: false}).join(''), /\u001b\[3[0-9];|\u001b\[4[0-9];/u);
  const sprite = spriteFromRows(['ab', 'a.'], {a: red, b: blue});
  const b2 = new PixelBuffer(4, 2);
  b2.sprite(sprite, 1, 0, true);
  assert.deepEqual([b2.get(1, 0), b2.get(2, 0)], [blue, red], 'flipped horizontally');
});

test('canvas: Braille dots land in the right cell and bit, and are ASCII in Safe mode', () => {
  const braille = new BrailleBuffer(2, 1);
  braille.set(0, 0); braille.set(3, 3);
  const canvas = new Canvas(2, 1);
  canvas.blitBraille(braille);
  assert.equal(canvas.plain()[0], '⠁⢀');
  assert.equal(canvas.plain({color: 'none', safe: true})[0], '..');
});

test('effects: bounded pools, deterministic, switched off and scaled by the level', () => {
  const make = (level: 'off' | 'subtle' | 'normal' | 'rich') => {
    const system = new ParticleSystem(createRng(3), 20, level);
    system.burst({x: 5, y: 5, count: 10, speed: 10, colors: [{red: 1, green: 1, blue: 1}]});
    return system;
  };
  assert.equal(make('off').count, 0);
  assert.equal(make('subtle').count, 5);
  assert.equal(make('normal').count, 10);
  const system = make('rich');
  for (let i = 0; i < 5; i += 1) system.burst({x: 1, y: 1, count: 20, speed: 5, colors: [{red: 1, green: 1, blue: 1}]});
  assert.ok(system.count <= 20, 'never above its capacity');
  for (let i = 0; i < 100; i += 1) system.update(50);
  assert.equal(system.count, 0, 'particles expire');
  const a = make('normal'); const b = make('normal');
  a.update(100); b.update(100);
  assert.deepEqual(a.particles.map(p => [p.x, p.y]), b.particles.map(p => [p.x, p.y]));
  const trail = new Trail(3);
  for (let i = 0; i < 10; i += 1) trail.push(i, 0);
  assert.equal(trail.size, 3);
  const popups = new Popups(2);
  for (let i = 0; i < 5; i += 1) popups.add('+1', 3, 3, {red: 1, green: 1, blue: 1});
  assert.equal(popups.count, 2);
  const shake = new Shake();
  shake.trigger(false);
  assert.deepEqual(shake.offset, {x: 0, y: 0}, 'reduced motion never shakes');
  shake.trigger(true);
  const o = shake.offset;
  assert.ok(Math.abs(o.x) <= 1 && Math.abs(o.y) <= 1);
});

test('palette: derived from the theme; sky cycles; region colors are distinct', () => {
  const palette = arcadePalette();
  assert.ok(palette.cat.body.red > 0);
  const noon = skyAt(palette, 0);
  const midnight = skyAt(palette, 0.5);
  assert.ok(noon.stars === 0 && midnight.stars > 0);
  const regions = regionColors(8, palette.deep, palette);
  assert.equal(new Set(regions.map(c => `${c.red},${c.green},${c.blue}`)).size, 8);
});

test('score store: round trip, atomic write, bounded and validated records', () => {
  const dir = tmp();
  try {
    const store = new ArcadeStore({directory: dir});
    const run = store.record('run');
    assert.deepEqual(run.get(), {});
    assert.equal(run.set({best: 120, runs: 3}), true);
    assert.equal(run.update(record => { record.runs = 4; }), true);
    assert.equal(store.flush(), true);
    assert.deepEqual(readdirSync(dir), [ARCADE_FILE], 'no temp file is left behind');
    assert.equal(statSync(join(dir, ARCADE_FILE)).mode & 0o077, 0, 'owner-only');
    const again = new ArcadeStore({directory: dir});
    assert.deepEqual(again.record('run').get(), {best: 120, runs: 4});
    assert.equal(run.set({bad: Number.NaN}), false, 'non-finite numbers are refused');
    assert.equal(run.set({['__proto__']: 1} as never), false);
    assert.equal(run.set({text: 'x'.repeat(9000)}), false, 'oversized strings are refused');
    assert.deepEqual(run.get(), {best: 120, runs: 4}, 'a refused write changes nothing');
    assert.throws(() => store.record('Bad Id'), RangeError);
    const big = store.record('big');
    assert.equal(big.set({list: Array.from({length: 4096}, (_, i) => 'x'.repeat(130) + i)}), false, 'the file stays under its cap');
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('score store: a damaged file is set aside and the arcade starts fresh; a newer version is read-only', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, ARCADE_FILE), '{not json');
    const store = new ArcadeStore({directory: dir, now: () => 42});
    assert.deepEqual(store.record('run').get(), {});
    assert.match(store.recovered ?? '', /unreadable/u);
    assert.ok(existsSync(join(dir, `${ARCADE_FILE}.corrupt-42`)));
    assert.equal(store.record('run').set({best: 1}), true);
    store.flush();
    assert.equal(JSON.parse(readFileSync(join(dir, ARCADE_FILE), 'utf8')).games.run.best, 1);

    writeFileSync(join(dir, ARCADE_FILE), JSON.stringify({version: 99, games: {run: {best: 5}}}));
    const future = new ArcadeStore({directory: dir});
    future.load();
    assert.equal(future.writable, false);
    assert.equal(future.record('run').set({best: 9}), false);
    future.flush();
    assert.equal(JSON.parse(readFileSync(join(dir, ARCADE_FILE), 'utf8')).version, 99, 'a newer file is never overwritten');

    writeFileSync(join(dir, ARCADE_FILE), JSON.stringify({version: 1, games: {run: {best: 5, evil: {['__proto__']: 1}}, 'Bad Id': {x: 1}, sudoku: {best: {easy: 61}}}}));
    const partly = new ArcadeStore({directory: dir});
    assert.deepEqual(partly.record('run').get(), {}, 'a record with a forbidden key is dropped, not trusted');
    assert.deepEqual(partly.record('sudoku').get(), {best: {easy: 61}});
    writeFileSync(join(dir, ARCADE_FILE), 'x'.repeat(MAX_FILE_BYTES + 10));
    const huge = new ArcadeStore({directory: dir});
    huge.load();
    assert.match(huge.recovered ?? '', /larger/u);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('registry and commands: every game is categorized with a unique id and aliases; one parser for /games, /game and /arcade', () => {
  const names = gameNames();
  for (const id of ['run', 'flight', 'dash', 'leap', 'snake', 'pong', 'brickfall', 'tower', 'bullseye', 'orbit', 'sudoku', 'queens']) assert.ok(names.includes(id), id);
  const every = ARCADE_GAMES.flatMap(game => [game.id, ...game.aliases]);
  assert.equal(new Set(every).size, every.length, 'no id or alias is shared by two games');
  for (const game of ARCADE_GAMES) {
    assert.ok(game.category, `${game.id} has a category`);
    assert.equal(findGame(game.id), game);
    for (const alias of game.aliases) assert.equal(findGame(alias), game, alias);
  }
  for (const [name, id] of [['run', 'run'], ['Vespyr Run', 'run'], ['dino', 'run'], ['flight', 'flight'], ['vespyr-dash', 'dash'], ['classic-sudoku', 'sudoku'], ['doku', 'queens'], ['Vespyr-Doku', 'queens'], ['vespyr queens', 'queens'], ['tail chase', 'snake'], ['breakout', 'brickfall']]) {
    assert.equal(findGame(name)?.id, id, name);
  }
  assert.equal(findGame('tetris'), undefined);
  assert.equal(findGame(''), undefined);
  for (const command of ['/games', '/game', '/arcade']) assert.deepEqual(parseSlashCommand(command), {kind: 'arcade'}, command);
  for (const command of ['/game run', '/games run', '/arcade run']) assert.deepEqual(parseSlashCommand(command), {kind: 'arcade', game: 'run'}, command);
  assert.deepEqual(parseSlashCommand('/arcade vespyr-doku'), {kind: 'arcade', game: 'vespyr-doku'});
  const ids = ARCADE_GAMES.map(game => game.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ARCADE_GAMES.every(game => /^[a-z][a-z0-9-]*$/u.test(game.id)));
  assert.equal(stripAnsi('x'), 'x');
});
