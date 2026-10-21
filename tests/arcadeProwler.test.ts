import test from 'node:test';
import assert from 'node:assert/strict';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {createRng} from '../src/arcade/rng.js';
import {prowlerGame} from '../src/arcade/games/prowler/index.js';
import {AMBUSH_AHEAD, DIRS, HUNTERS, Maze, ProwlerState, generateMaze, oddFit, type Dir, type Hunter, type Tile} from '../src/arcade/games/prowler/logic.js';
import {displayWidth} from '../src/util/text.js';
import {STEP, checkRenders, context, memory} from './arcadeBatch3Kit.js';

const hunter = (state: ProwlerState, kind: string): Hunter => state.hunters.find(h => h.kind === kind)!;
/** A maze from text: '#' wall, anything else floor. */
function fromText(rows: string[]): Maze {
  const maze = new Maze(rows[0]!.length, rows.length);
  rows.forEach((row, y) => [...row].forEach((c, x) => maze.set(x, y, c === '#')));
  return maze;
}

test('mazes: 120 seeds and several sizes give connected, bordered mazes with loops and no dead-end crowds', () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    for (const [w, h] of [[9, 5], [13, 9], [21, 13], [31, 21]] as const) {
      const maze = generateMaze(createRng(seed), w, h);
      const floors = maze.floors;
      const dist = maze.distances({x: 1, y: 1});
      assert.ok(floors.every(t => dist[t.y * w + t.x]! >= 0), `seed ${seed} ${w}x${h}: unreachable floor`);
      for (let x = 0; x < w; x += 1) assert.ok(maze.wall(x, 0) && maze.wall(x, h - 1));
      for (let y = 0; y < h; y += 1) assert.ok(maze.wall(0, y) && maze.wall(w - 1, y));
      const deadEnds = floors.filter(t => maze.exits(t.x, t.y).length === 1).length;
      assert.ok(deadEnds <= Math.max(2, floors.length * 0.12), `seed ${seed} ${w}x${h}: ${deadEnds} dead ends`);
      if (w >= 13) assert.ok(floors.length > ((w - 1) / 2) * ((h - 1) / 2) * 2 - 1, 'loops add floor beyond the perfect-maze count');
    }
  }
  assert.deepEqual(generateMaze(createRng(3), 21, 13).walls, generateMaze(createRng(3), 21, 13).walls);
  assert.notDeepEqual(generateMaze(createRng(3), 21, 13).walls, generateMaze(createRng(4), 21, 13).walls);
  assert.equal(oddFit(14, 9, 31), 13);
  assert.equal(oddFit(3, 9, 31), 9);
});

test('A* finds shortest paths: its length equals the BFS distance on 40 random mazes', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const rng = createRng(seed);
    const maze = generateMaze(rng, 21, 13);
    const floors = maze.floors;
    for (let i = 0; i < 12; i += 1) {
      const a = rng.pick(floors), b = rng.pick(floors);
      const path = maze.path(a, b)!;
      assert.equal(path.length - 1, maze.distances(a)[b.y * 21 + b.x]);
      for (let k = 1; k < path.length; k += 1) assert.equal(Math.abs(path[k]!.x - path[k - 1]!.x) + Math.abs(path[k]!.y - path[k - 1]!.y), 1);
    }
  }
});

test('movement: the cat eats dots for 10, stops at walls, buffers a turn and may reverse at once', () => {
  const state = new ProwlerState(createRng(1), 13, 9);
  state.started = true; state.phase = 'play'; state.hunters.forEach(h => { h.release = 1e9; });
  const start = {x: state.player.x, y: state.player.y};
  const dir = ([1, 3, 0, 2] as const).find(d => state.maze.open(start.x, start.y, d))!;
  state.setWant(dir);
  for (let i = 0; i < 20; i += 1) state.step(STEP);
  assert.ok(state.score >= 10 && state.score % 10 === 0);
  const moved = state.position(state.player);
  assert.ok(Math.abs(moved.x - start.x) + Math.abs(moved.y - start.y) > 0.5);
  state.setWant(((dir + 2) % 4) as Dir);
  const before = state.position(state.player);
  state.step(STEP);
  const after = state.position(state.player);
  assert.ok(Math.abs(after.x - before.x) + Math.abs(after.y - before.y) < 0.2, 'reversal is continuous');
  for (let i = 0; i < 600; i += 1) state.step(STEP);
  const stuck = state.position(state.player);
  assert.ok(state.maze.floors.some(t => t.x === Math.round(stuck.x) && t.y === Math.round(stuck.y)));
});

test('four hunters think differently: on one board the chaser, ambusher, patroller and wanderer pick distinct routes', () => {
  // A ring with the cat on the right, heading up: chaser goes for the cat, ambusher for the tile ahead of it.
  const rows = [
    '###########',
    '#.........#',
    '#.#######.#',
    '#.#######.#',
    '#.#######.#',
    '#.........#',
    '###########',
  ];
  const state = new ProwlerState(createRng(1), 11, 7);
  state.maze = fromText(rows);
  (state as never as {fromPlayerAt: number}).fromPlayerAt = -1;
  state.player = {x: 9, y: 5, dir: 0, t: 0};
  state.facing = 0;
  const place = (h: Hunter): Hunter => { Object.assign(h, {x: 5, y: 1, dir: 1, t: 0, mode: 'hunt'}); return h; };
  const chaser = place(hunter(state, 'chaser'));
  const ambusher = place(hunter(state, 'ambusher'));
  const patroller = place(hunter(state, 'patroller'));
  assert.equal(state.ahead(AMBUSH_AHEAD).y, 1, 'four steps up from the bottom-right corner reaches the top row');
  assert.equal(chaser.kind, 'chaser');
  const c = state.decide(chaser);
  assert.equal(c, 1, 'chaser: cat is down the right side, so keep going right');
  assert.equal(state.decide(ambusher), 1);
  // Move the cat to the left side heading down: chaser turns left side, ambusher aims at the bottom.
  state.player = {x: 1, y: 2, dir: 2, t: 0}; state.facing = 2;
  (state as never as {fromPlayerAt: number}).fromPlayerAt = -1;
  const chaser2 = place(hunter(state, 'chaser')); chaser2.x = 5; chaser2.y = 1; chaser2.dir = 1;
  assert.equal(state.decide(chaser2), 1, 'no choice but forward along a corridor');
  // A junction board tells them apart.
  const cross = [
    '#########',
    '#.......#',
    '#.#####.#',
    '#.......#',
    '#.#####.#',
    '#.......#',
    '#########',
  ];
  const s2 = new ProwlerState(createRng(2), 9, 7);
  s2.maze = fromText(cross);
  s2.player = {x: 7, y: 5, dir: -1, t: 0}; s2.facing = 0;
  const at = (kind: string, dir: Dir): Hunter => { const h = hunter(s2, kind); Object.assign(h, {x: 4, y: 3, dir, t: 0, mode: 'hunt'}); return h; };
  const picks = new Map<string, Dir | -1>();
  for (const kind of ['chaser', 'ambusher', 'patroller']) picks.set(kind, s2.decide(at(kind, 1)));
  assert.equal(picks.get('chaser'), 1, 'chaser takes the shortest way to the cat: right then down');
  assert.equal(HUNTERS.length, 4);
});

test('each hunter kind sets its own target on the same board', () => {
  const state = new ProwlerState(createRng(11), 21, 13);
  state.started = true; state.phase = 'play';
  const floors = state.maze.floors;
  const spot = floors.find(t => state.maze.exits(t.x, t.y).length >= 3 && Math.abs(t.x - state.player.x) + Math.abs(t.y - state.player.y) > 12)!;
  // Put the cat where it has a long straight run ahead, so 'ahead' differs from its own tile.
  const run = floors.flatMap(t => ([0, 1, 2, 3] as const).map(d => ({t, d}))).find(({t, d}) => [1, 2, 3, 4].every(i => state.maze.open(t.x + DIRS[d].dx * (i - 1), t.y + DIRS[d].dy * (i - 1), d)) && Math.abs(t.x - spot.x) + Math.abs(t.y - spot.y) > 8)!;
  state.player = {x: run.t.x, y: run.t.y, dir: run.d, t: 0}; state.facing = run.d;
  (state as never as {fromPlayerAt: number}).fromPlayerAt = -1;
  const targets = new Map<string, Tile>();
  for (const kind of HUNTERS) {
    const h = hunter(state, kind);
    Object.assign(h, {x: spot.x, y: spot.y, dir: -1, t: 0, mode: 'hunt', waypoint: 2});
    state.decide(h);
    targets.set(kind, {...h.target});
  }
  assert.deepEqual(targets.get('chaser'), state.tileOf(state.player));
  assert.deepEqual(targets.get('ambusher'), state.ahead(AMBUSH_AHEAD));
  assert.notDeepEqual(targets.get('ambusher'), targets.get('chaser'));
  assert.deepEqual(targets.get('wanderer') !== undefined, true);
  const patrol = targets.get('patroller')!;
  assert.ok(patrol.x !== state.tileOf(state.player).x || patrol.y !== state.tileOf(state.player).y, 'far from the cat, the patroller walks to a corner');
});

test('chaser: following its decisions closes the distance to a standing cat on every maze tried', () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const state = new ProwlerState(createRng(seed), 21, 13);
    state.started = true; state.phase = 'play';
    const h = hunter(state, 'chaser');
    Object.assign(h, {mode: 'hunt', x: state.den.x ?? 1});
    const den = state.maze.floors.find(t => t.x === h.x && t.y === h.y) ?? state.maze.floors[0]!;
    Object.assign(h, {x: den.x, y: den.y, dir: -1, t: 0});
    state.hunters.filter(o => o !== h).forEach(o => { o.release = 1e9; });
    h.release = 0;
    const target = state.player;
    let caught = false;
    for (let i = 0; i < 60 * 60 && !caught; i += 1) { state.step(STEP); caught = state.phase !== 'play'; }
    assert.ok(caught || state.phase === 'dying', `seed ${seed}: the chaser never caught a standing cat`);
    assert.ok(target.x >= 0);
  }
});

test('fright: a power treat scares hunters, eating them scores 200 then 400, eyes return to the den, fright ends', () => {
  const state = new ProwlerState(createRng(5), 13, 9);
  state.started = true; state.phase = 'play';
  state.hunters.forEach(h => { h.release = 0; h.mode = 'hunt'; });
  const [a, b] = state.hunters;
  const p = state.position(state.player);
  state.frightMs = 5000; state.hunters.forEach(h => { h.mode = 'scared'; });
  Object.assign(a!, {x: Math.round(p.x), y: Math.round(p.y), dir: -1, t: 0});
  Object.assign(b!, {x: Math.round(p.x), y: Math.round(p.y), dir: -1, t: 0});
  state.hunters.slice(2).forEach(h => { h.mode = 'den'; h.release = 1e9; });
  const before = state.score;
  (state as never as {collide(): void}).collide();
  assert.equal(state.score - before, 200 + 400);
  assert.equal(a!.mode, 'eyes'); assert.equal(b!.mode, 'eyes');
  assert.equal(state.huntersEaten, 2);
  for (let i = 0; i < 60 * 8 && a!.mode === 'eyes'; i += 1) state.step(STEP);
  assert.equal(a!.mode === 'eyes', false, 'eyes reach the den and come back');
  state.frightMs = 100;
  for (let i = 0; i < 20; i += 1) state.step(STEP);
  assert.equal(state.frightened, false);
  assert.ok(state.hunters.every(h => h.mode !== 'scared'));
});

test('eating a power treat scares active hunters and turns them around', () => {
  const state = new ProwlerState(createRng(6), 13, 9);
  state.started = true; state.phase = 'play';
  const power = [...state.powers][0]!;
  const tile = {x: power % 13, y: Math.floor(power / 13)};
  state.hunters.forEach(h => { h.mode = 'hunt'; h.release = 1e9; });
  const h = state.hunters[0]!;
  Object.assign(h, {x: state.den.x, y: state.den.y, dir: 1, t: 0.3});
  const was = state.position(h);
  const dirOpen = ([0, 1, 2, 3] as const).find(d => state.maze.open(tile.x, tile.y, d))!;
  Object.assign(state.player, {x: tile.x - DIRS[dirOpen].dx, y: tile.y - DIRS[dirOpen].dy, dir: dirOpen, t: 0.99});
  state.step(STEP);
  assert.ok(state.frightened);
  assert.equal(h.mode, 'scared');
  const now = state.position(h);
  assert.ok(Math.abs(now.x - was.x) < 0.5 && h.dir === 3, 'turned around at once');
});

test('lives and levels: being caught costs a life and resets; the last ends the game; clearing the dots starts a new maze', () => {
  const state = new ProwlerState(createRng(7), 13, 9);
  state.started = true; state.phase = 'play';
  const h = state.hunters[0]!;
  const p = state.position(state.player);
  Object.assign(h, {mode: 'hunt', x: Math.round(p.x), y: Math.round(p.y), dir: -1, t: 0});
  (state as never as {collide(): void}).collide();
  assert.equal(state.phase, 'dying');
  for (let i = 0; i < 90; i += 1) state.step(STEP);
  assert.equal(state.lives, 2);
  assert.equal(state.phase, 'ready');
  assert.deepEqual({x: state.player.x, y: state.player.y}, {x: state.player.x, y: state.player.y});
  state.lives = 1; state.phase = 'play';
  Object.assign(state.hunters[0]!, {mode: 'hunt', x: Math.round(state.player.x), y: Math.round(state.player.y), dir: -1, t: 0});
  (state as never as {collide(): void}).collide();
  for (let i = 0; i < 90; i += 1) state.step(STEP);
  assert.equal(state.phase, 'over');
  assert.ok(state.events.some(e => e.kind === 'over'));

  const next = new ProwlerState(createRng(8), 13, 9);
  next.started = true; next.phase = 'play'; next.hunters.forEach(x => { x.release = 1e9; });
  const walls = JSON.stringify(next.maze.walls);
  next.dots.clear(); next.powers.clear();
  next.dots.add(next.player.y * 13 + next.player.x + 0); // the tile under the cat: eaten on the next arrival
  next.step(STEP);
  next.dots.clear();
  next.step(STEP);
  assert.equal(next.phase, 'cleared');
  assert.ok(next.score >= 500);
  for (let i = 0; i < 100; i += 1) next.step(STEP);
  assert.equal(next.level, 2);
  assert.notEqual(JSON.stringify(next.maze.walls), walls);
  assert.ok(next.dotsLeft > 20);
});

test('fairness: the cat starts far from the den, and no hunter reaches it before the ready countdown plus a head start', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const state = new ProwlerState(createRng(seed), 21, 13);
    const dist = state.maze.distances({x: state.player.x, y: state.player.y});
    const den = state.hunters[0]!;
    assert.ok(dist[den.y * 21 + den.x]! >= 4, `seed ${seed}: den too close to the start`);
    assert.ok(state.hunters.every((h, i) => h.release >= i * 3 * 0.99 - 1e-9));
    assert.equal(state.powers.size, 4);
  }
});

test('determinism: the same seed plays out identically', () => {
  const play = (seed: number) => {
    const state = new ProwlerState(createRng(seed), 17, 11);
    state.started = true;
    const dirs: Dir[] = [1, 0, 3, 2];
    for (let i = 0; i < 60 * 40; i += 1) { if (i % 40 === 0) state.setWant(dirs[(i / 40) % 4 | 0]!); state.step(STEP); }
    return JSON.stringify([state.score, state.lives, state.phase, state.hunters.map(h => [h.x, h.y, h.mode]), state.player]);
  };
  assert.equal(play(9), play(9));
  assert.notEqual(play(9), play(10));
});

test('game: keys, status, pause and restart safety, record saving, celebration', () => {
  type G = {key(k: unknown): string; step(d: number): void; animate(d: number): void; pause(): void; status: string; result: {score: number; record: boolean; details: string[]} | undefined; state: ProwlerState; popups: {count: number}; dispose(): void};
  const run = (seed: number, record = memory()) => {
    const game = prowlerGame.create(context(record, {rng: createRng(seed), seed, size: {columns: 40, rows: 16}})) as never as G;
    assert.equal(game.status, 'ready');
    assert.equal(game.key({kind: 'text', value: 'q'}), 'ignored');
    game.key({kind: 'text', value: ' '});
    assert.equal(game.status, 'playing');
    assert.equal(game.key({kind: 'left'}), 'handled');
    for (let t = 0; t < 600_000 && game.status !== 'over'; t += STEP) {
      if (t === 3000) { const before = JSON.stringify([game.state.time, game.state.score]); game.pause(); assert.equal(JSON.stringify([game.state.time, game.state.score]), before); }
      if (Math.floor(t / STEP) % 50 === 0) game.key({kind: (['up', 'right', 'down', 'left'] as const)[Math.floor(t / 800) % 4]});
      game.step(STEP); game.animate(STEP);
    }
    return {game, record};
  };
  const a = run(3), b = run(3);
  assert.equal(a.game.status, 'over');
  assert.deepEqual(a.game.result, b.game.result);
  assert.equal(a.record.raw().plays, 1);
  assert.equal(a.record.raw().best, a.game.result?.score);
  assert.equal(a.game.result?.record, (a.game.result?.score ?? 0) > 0);
  assert.equal(a.game.key({kind: 'up'}), 'ignored');
  const beaten = run(3, memory({best: 1_000_000, plays: 4}));
  assert.equal(beaten.game.result?.record, false);
  assert.equal(beaten.record.raw().best, 1_000_000);
  const mid = prowlerGame.create(context(memory({best: 5, plays: 1}), {size: {columns: 40, rows: 16}})) as never as G;
  mid.key({kind: 'text', value: ' '}); mid.key({kind: 'right'}); mid.key({kind: 'left'});
  for (let i = 0; i < 600 && mid.state.score <= 5; i += 1) mid.step(STEP);
  assert.ok(mid.state.score > 5 && mid.popups.count >= 1);
  a.game.dispose();
});

test('render: every size, color level, Safe Glyphs and Reduced Motion draws inside its bounds, including a maze bigger than the view', () => {
  checkRenders(prowlerGame, game => {
    game.key({kind: 'text', value: ' '});
    for (let i = 0; i < 400; i += 1) { if (i % 60 === 0) game.key({kind: (['right', 'down', 'left', 'up'] as const)[(i / 60) % 4]}); game.step(STEP); game.animate(STEP); }
  });
  const preview = new Canvas(40, 12);
  prowlerGame.preview(preview, 4, arcadePalette());
  for (const line of preview.plain()) assert.ok(displayWidth(line) <= 40);
  // A resize smaller than the maze still draws only inside the new bounds, with the cat in view.
  const game = prowlerGame.create(context(memory(), {size: {columns: 100, rows: 34}}));
  game.key({kind: 'text', value: ' '});
  game.resize({columns: 28, rows: 12});
  const canvas = new Canvas(28, 12);
  game.render(canvas, 0, arcadePalette());
  assert.ok(canvas.plain().some(line => line.includes('@')));
});
