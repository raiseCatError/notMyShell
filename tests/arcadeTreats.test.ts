import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {HEIGHT, matched, MOVES, pointsFor, TreatBoard, WIDTH} from '../src/arcade/games/treats/logic.js';
import {treatsGame} from '../src/arcade/games/treats/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});

test('matched finds runs of three or more across and down, and nothing shorter', () => {
  // A 2x2 tiling of four kinds has no run longer than one in any direction.
  const tiling = () => Array.from({length: WIDTH * HEIGHT}, (_, i) => (i % 2) + 2 * (Math.floor(i / WIDTH) % 2));
  assert.equal(matched(tiling()).size, 0);
  const across = tiling(); across[0] = across[1] = across[2] = 5;
  assert.deepEqual([...matched(across)].sort((a, b) => a - b), [0, 1, 2]);
  const ell = across.slice(); ell[WIDTH] = ell[2 * WIDTH] = 5;
  assert.deepEqual([...matched(ell)].sort((a, b) => a - b), [0, 1, 2, WIDTH, 2 * WIDTH]);
  const pairs = tiling(); pairs[0] = pairs[1] = 5; pairs[WIDTH] = 5;
  assert.equal(matched(pairs).size, 0, 'runs of two do not count');
  const four = tiling(); for (let y = 0; y < 4; y += 1) four[y * WIDTH + 3] = 5;
  assert.equal(matched(four).size, 4);
});

test('fresh boards: no lines, a legal move, 300 seeds', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const board = new TreatBoard(createRng(seed));
    assert.equal(matched(board.cells).size, 0);
    assert.ok(board.hasMove());
    assert.ok(board.cells.every(kind => kind >= 0 && kind < 6));
  }
});

test('an illegal swap changes nothing and costs no move', () => {
  const board = new TreatBoard(createRng(9));
  const before = board.cells.slice();
  const bad = [...Array(board.cells.length).keys()].find(cell => cell % WIDTH < WIDTH - 1 && !board.swapWorks(cell, cell + 1))!;
  assert.equal(board.swap(bad, bad + 1), undefined);
  assert.deepEqual(board.cells, before);
  assert.equal(board.movesLeft, MOVES);
  assert.equal(board.swap(0, 5), undefined, 'not neighbours');
});

test('a hinted swap clears, scores, leaves a full line-free board, and spends one move; 100 seeds of random play', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const board = new TreatBoard(createRng(seed));
    let total = 0;
    while (!board.over) {
      const [a, b] = board.hint()!;
      const steps = board.swap(a, b)!;
      assert.ok(steps.length >= 1);
      for (const step of steps) { assert.ok(step.cleared.length >= 3); assert.equal(step.gained, pointsFor(step.cleared.length, step.chain)); total += step.gained; }
      assert.equal(matched(board.cells).size, 0, 'settled board has no lines');
      assert.ok(board.cells.every(kind => kind >= 0 && kind < 6));
      assert.ok(board.hasMove(), 'there is always a legal swap');
    }
    assert.equal(board.score, total);
    assert.equal(board.movesLeft, 0);
    assert.equal(board.swap(0, 1), undefined, 'no moves after the end');
  }
});

test('pointsFor rewards long lines and later cascade steps', () => {
  assert.equal(pointsFor(3, 1), 30); assert.equal(pointsFor(5, 1), 70); assert.equal(pointsFor(3, 3), 90);
});

test('play through the UI: swap, skip the cascade, finish, record saved', () => {
  const record = memory();
  const game = treatsGame.create(context(record)) as never as {key(k: unknown): unknown; animate(d: number): void; status: string; result: {score: number} | undefined; board: TreatBoard; cursor: number};
  for (let moves = 0; moves < MOVES; moves += 1) {
    const [a, b] = game.board.hint()!;
    game.cursor = a;
    game.key({kind: 'text', value: ' '});
    game.cursor = a;
    const dir = b === a + 1 ? 'right' : 'down';
    game.key({kind: dir});
    for (let i = 0; i < 30; i += 1) game.animate(100);
  }
  assert.equal(game.status, 'over');
  assert.ok(game.result!.score > 0);
  assert.equal((record.raw() as {best: number}).best, game.result!.score);
});

test('render: every size and mode draws inside its bounds', () => {
  const palette = arcadePalette('truecolor');
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) for (const mode of [{color: 'truecolor', safe: false}, {color: 'none', safe: true}] as const) for (const reduced of [false, true]) {
    const game = treatsGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe, motion: {reduced, effects: reduced ? 'off' : 'normal'}})) as never as {key(k: unknown): unknown; render(c: Canvas, a: number, p: unknown): void; animate(d: number): void};
    const canvas = new Canvas(columns, rows);
    game.render(canvas, 0, palette);
    game.key({kind: 'text', value: ' '}); game.key({kind: 'right'}); game.key({kind: 'text', value: 'h'});
    game.render(canvas, 0, palette);
    game.animate(100);
    game.render(canvas, 0, palette);
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns);
  }
});
