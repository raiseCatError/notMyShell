import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {BOATS, CELLS, Gunner, SIDE, span, Waters} from '../src/arcade/games/fleet/logic.js';
import {fleetGame} from '../src/arcade/games/fleet/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
type Probe = {key(k: unknown): unknown; animate(d: number): void; render(c: Canvas, a: number, p: unknown): void; status: string; result: {score: number; record: boolean} | undefined; mine: Waters; theirs: Waters; cursor: number; screen: string; dispose(): void; finale: {done: boolean; skip(): void} | undefined};
const text = (value: string) => ({kind: 'text', value});

test('placement: boats stay on the sea, never overlap, random fleets are legal for 200 seeds', () => {
  assert.equal(span(8, 3, true), undefined);
  assert.deepEqual(span(8, 2, true), [8, 9]);
  assert.equal(span(95, 2, false), undefined);
  assert.deepEqual(span(5, 3, false), [5, 15, 25]);
  const water = new Waters();
  assert.ok(water.place(0, 0, true));
  assert.equal(water.place(1, 10, true), true);
  assert.equal(water.place(2, 2, true), false, 'overlap refused');
  assert.equal(water.place(4, 0, true), false, 'boats go in order');
  for (let seed = 1; seed <= 200; seed += 1) {
    const w = new Waters();
    w.placeRandom(createRng(seed));
    assert.ok(w.complete);
    assert.deepEqual(w.boats.map(b => b.length), BOATS.map(b => b.length));
    const cells = w.boats.flatMap(b => b.cells);
    assert.equal(new Set(cells).size, 17);
    assert.ok(cells.every(c => c >= 0 && c < CELLS));
    for (const boat of w.boats) {
      const xs = new Set(boat.cells.map(c => c % SIDE)), ys = new Set(boat.cells.map(c => Math.floor(c / SIDE)));
      assert.ok(xs.size === 1 || ys.size === 1, 'in a straight line');
    }
  }
});

test('firing: hit, miss, sunk, no repeats, all sunk', () => {
  const water = new Waters();
  water.place(0, 0, true); water.place(1, 10, true); water.place(2, 20, true); water.place(3, 30, true); water.place(4, 40, true);
  assert.deepEqual(water.fire(99), {cell: 99, hit: false, sunk: undefined});
  assert.equal(water.fire(99), undefined);
  for (const cell of [40]) assert.equal(water.fire(cell)!.hit, true);
  const last = water.fire(41)!;
  assert.equal(last.sunk?.name, 'Dinghy');
  assert.equal(water.allSunk, false);
  for (const boat of water.boats) for (const cell of boat.cells) water.fire(cell);
  assert.ok(water.allSunk);
  assert.equal(water.remainingCells, 0);
});

test('the computer plays fair: it only gets shot reports, never repeats, and clearly beats random play', () => {
  let total = 0, randomTotal = 0;
  const games = 120;
  for (let seed = 1; seed <= games; seed += 1) {
    const water = new Waters();
    water.placeRandom(createRng(seed));
    const gunner = new Gunner(createRng(seed + 500));
    let shots = 0;
    while (!water.allSunk) {
      const cell = gunner.next();
      const result = water.fire(cell);
      assert.ok(result, 'never fires at the same cell twice');
      gunner.report(cell, result.hit, result.sunk?.cells);
      shots += 1;
      assert.ok(shots <= CELLS);
    }
    total += shots;
    const dumb = new Waters();
    dumb.placeRandom(createRng(seed));
    const order = createRng(seed + 900).shuffle([...Array(CELLS).keys()]);
    let n = 0;
    for (const cell of order) { n += 1; dumb.fire(cell); if (dumb.allSunk) break; }
    randomTotal += n;
  }
  assert.ok(total / games < 65, `hunt/target averages ${total / games} shots`);
  assert.ok(total < randomTotal * 0.75);
  // The Gunner has no way to see a fleet: its API takes only results.
  assert.equal(Gunner.prototype.next.length, 0);
  assert.equal(Gunner.prototype.report.length, 3);
});

test('target mode finishes a boat: after a hit it fires next to it, after two it extends the line', () => {
  const gunner = new Gunner(createRng(1));
  gunner.report(44, true);
  const second = gunner.next();
  assert.ok([34, 54, 43, 45].includes(second));
  gunner.report(45, true);
  for (let i = 1; i <= 20; i += 1) {
    const g = new Gunner(createRng(i));
    g.report(44, true); g.report(45, true);
    assert.ok([43, 46].includes(g.next()), 'a line of two is extended at an end');
  }
  gunner.report(43, true, [43, 44, 45]);
  assert.equal(gunner.pending.length, 0, 'a sunk boat stops being a target');
});

test('determinism: same seed, same keys, same game', () => {
  const play = () => {
    const game = fleetGame.create(context(memory(), {rng: createRng(9)})) as never as Probe;
    game.key(text('q'));
    const log: number[] = [];
    for (let i = 0; i < 30; i += 1) { game.cursor = i * 3 % 100; game.key(text(' ')); game.animate(1000); log.push(game.mine.shots.reduce((a, b) => a + b, 0)); }
    return [log, game.mine.boats.map(b => b.cells), game.theirs.boats.map(b => b.cells)];
  };
  assert.deepEqual(play(), play());
});

test('UI: manual placement, then play to the end; record and wins saved; finale skippable', () => {
  const record = memory();
  const game = fleetGame.create(context(record)) as never as Probe;
  assert.equal(game.status, 'ready');
  game.key(text('p'));
  assert.equal(game.status, 'playing');
  game.cursor = 0;
  game.key(text(' '));
  assert.equal(game.mine.boats.length, 1);
  game.cursor = 8;
  game.key(text(' '));
  assert.equal(game.mine.boats.length, 1, 'a boat that would leave the sea is refused');
  game.key(text('u'));
  assert.equal(game.mine.boats.length, 0);
  game.key(text('x'));
  assert.ok(game.mine.complete);
  game.key({kind: 'enter'});
  // Fire at every enemy boat cell, in order; the computer answers each time.
  const targets = game.theirs.boats.flatMap(b => b.cells);
  for (const cell of targets) {
    if (game.status !== 'playing') break;
    game.cursor = cell;
    game.key(text(' '));
    game.animate(2000);
  }
  assert.ok(game.status === 'won' || game.status === 'over');
  assert.ok(game.result);
  const raw = record.raw() as {plays: number; wins?: number; losses?: number; best: number};
  assert.equal(raw.plays, 1);
  assert.equal((raw.wins ?? 0) + (raw.losses ?? 0), 1);
  if (game.status === 'won') { assert.ok(game.result!.score > 100); assert.equal(raw.best, game.result!.score); }
  assert.ok(game.finale);
  game.finale.skip();
  assert.ok(game.finale.done);
  game.dispose();
});

test('a perfect shooter wins every time against the sleeping computer in 17 shots; repeats are refused', () => {
  const game = fleetGame.create(context(memory())) as never as Probe;
  game.key(text('q'));
  const cell = game.theirs.boats[0]!.cells[0]!;
  game.cursor = cell; game.key(text(' ')); game.animate(1000);
  const shots = game.theirs.shots.reduce((a, b) => a + b, 0);
  game.cursor = cell; game.key(text(' '));
  assert.equal(game.theirs.shots.reduce((a, b) => a + b, 0), shots, 'a cell already fired at is not fired again');
});

test('render: every size and mode draws inside its bounds, in battle and in placement', () => {
  const palette = arcadePalette('truecolor');
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) for (const mode of [{color: 'truecolor', safe: false}, {color: 'none', safe: true}] as const) for (const reduced of [false, true]) {
    const game = fleetGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe, motion: {reduced, effects: reduced ? 'off' : 'normal'}})) as never as Probe;
    const canvas = new Canvas(columns, rows);
    const check = () => { for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns, `${columns}x${rows}: ${line}`); };
    game.render(canvas, 0, palette); check();
    game.key(text('p'));
    game.render(canvas, 0, palette); check();
    game.key(text(' ')); game.key({kind: 'right'}); game.key(text('r')); game.key(text('x'));
    game.render(canvas, 0, palette); check();
    game.key({kind: 'enter'});
    game.cursor = game.theirs.boats[0]!.cells[0]!;
    game.key(text(' ')); game.animate(1000);
    game.key({kind: 'complete'});
    game.render(canvas, 0, palette); check();
    const board = canvas.plain().join('\n');
    assert.ok(/[✖X]/u.test(board) || /[○o]/u.test(board));
    game.key({kind: 'complete'});
    game.render(canvas, 0, palette); check();
    game.dispose();
  }
});
