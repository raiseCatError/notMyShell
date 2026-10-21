import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {GOLDEN_EVERY, MIN_INTERVAL, SnakeState, START_INTERVAL} from '../src/arcade/games/snake/logic.js';
import {boardFor, snakeGame} from '../src/arcade/games/snake/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}

const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 30}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});

test('rules: the snake moves one cell per interval, at any frame rate', () => {
  const coarse = new SnakeState(20, 12, 'classic', createRng(1));
  const fine = new SnakeState(20, 12, 'classic', createRng(1));
  for (let t = 0; t < 900; t += 100) coarse.advance(100);
  for (let t = 0; t < 900; t += 1000 / 60) fine.advance(1000 / 60);
  assert.deepEqual(coarse.body, fine.body, 'the same moves whatever the frame rate');
  assert.equal(coarse.x(coarse.body[0]!), 5 + Math.floor(900 / START_INTERVAL));
});

test('rules: no reversal into the neck; two quick turns make a corner; a third is dropped', () => {
  const snake = new SnakeState(20, 12, 'classic', createRng(1));
  const head = snake.body[0]!;
  snake.turn('left');
  snake.move();
  assert.equal(snake.body[0], head + 1, 'still heading right');
  snake.turn('up'); snake.turn('left'); snake.turn('down');
  snake.move(); snake.move();
  assert.equal(snake.heading, 'left');
  assert.equal(snake.y(snake.body[0]!), snake.y(head) - 1, 'went up one, then left');
});

test('rules: eating grows the tail, scores, speeds up and respawns the treat on a free cell; a golden treat comes and times out', () => {
  const snake = new SnakeState(20, 12, 'classic', createRng(2));
  for (let index = 0; index < GOLDEN_EVERY; index += 1) {
    snake.treat = snake.body[0]! + 1;
    const length = snake.length;
    snake.move();
    assert.equal(snake.length, length + 1);
    assert.ok(snake.treat >= 0 && !snake.body.includes(snake.treat), 'the new treat is on a free cell');
  }
  assert.equal(snake.score, GOLDEN_EVERY * 10);
  assert.ok(snake.interval < START_INTERVAL && snake.interval >= MIN_INTERVAL);
  assert.ok(snake.golden >= 0, 'a golden treat after five');
  snake.advance(7000 - snake.interval);
  assert.ok(snake.golden < 0 || !snake.alive, 'it times out');
});

test('rules: walls kill in Classic and wrap in Wrap-around; biting yourself ends the run; the tail cell is free to enter', () => {
  const wall = new SnakeState(8, 8, 'classic', createRng(3));
  for (let index = 0; index < 10 && wall.alive; index += 1) { wall.treat = -1; wall.move(); }
  assert.equal(wall.alive, false);
  const wrap = new SnakeState(8, 8, 'wrap', createRng(3));
  for (let index = 0; index < 10; index += 1) { wrap.treat = -1; wrap.move(); }
  assert.equal(wrap.alive, true);
  const loop = new SnakeState(12, 12, 'classic', createRng(5));
  loop.body = [loop.at(5, 5), loop.at(4, 5), loop.at(4, 6), loop.at(5, 6)];
  loop.heading = 'down';
  loop.treat = -1;
  loop.move();
  assert.equal(loop.alive, true, 'the head may follow the tail into its cell');
  const bite = new SnakeState(12, 12, 'classic', createRng(5));
  bite.body = [bite.at(5, 5), bite.at(4, 5), bite.at(4, 6), bite.at(5, 6), bite.at(6, 6)];
  bite.heading = 'down';
  bite.treat = -1;
  bite.move();
  assert.equal(bite.alive, false);
});

test('rules: garden rocks never sit in front of the start, and treats never land on rocks', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const garden = new SnakeState(24, 14, 'garden', createRng(seed));
    const head = garden.body[0]!;
    for (let step = 1; step <= 3; step += 1) assert.ok(!garden.rocks.has(head + step), `seed ${seed}: clear path`);
    assert.ok(!garden.rocks.has(garden.treat));
  }
});

test('game: the menu picks a mode, the run ends on a crash with a result, and the record keeps per-mode bests', () => {
  const record = memory();
  const game = snakeGame.create(context(record));
  assert.equal(game.status, 'ready');
  game.key({kind: 'text', value: '1'});
  assert.equal(game.status, 'playing');
  for (let t = 0; t < 20_000 && game.status === 'playing'; t += 1000 / 60) { game.step(1000 / 60); game.animate(1000 / 60); }
  assert.equal(game.status, 'over', 'driving straight ends at the wall');
  assert.ok(game.result);
  assert.equal(record.raw().plays, 1);
  assert.ok('bestClassic' in record.raw());
});

test('render: every size draws inside its bounds, in color, without color and in Safe Glyphs', () => {
  for (const [columns, rows] of [[20, 8], [40, 14], [80, 24], [120, 36], [200, 60]] as const) {
    for (const mode of [{color: 'truecolor' as const, safe: false}, {color: 'none' as const, safe: false}, {color: 'none' as const, safe: true}]) {
      const game = snakeGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe}));
      game.key({kind: 'enter'});
      for (let index = 0; index < 30; index += 1) game.step(1000 / 60);
      const canvas = new Canvas(columns, rows);
      game.render(canvas, 0, arcadePalette());
      for (const line of canvas.plain({color: 'none', safe: mode.safe})) assert.ok(displayWidth(line) <= columns);
      if (mode.safe) for (const row of canvas.rows({color: 'none', safe: true})) assert.match(row, /^[\x20-\x7e\u001b[0-9;m]*$/u);
    }
  }
  assert.equal(boardFor(120, 36)!.cw, 4, 'big cells when they fit');
  assert.equal(boardFor(40, 14)!.cw, 2);
});
