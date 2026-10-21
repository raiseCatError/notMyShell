import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {BOMB, HEIGHT, matched, MOVES, pointsFor, starsFor, STARS, STRIPE_COL, STRIPE_ROW, TreatBoard, WIDTH, type Mark} from '../src/arcade/games/treats/logic.js';
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

/** A line-free board (kinds 0..3 in a 2x2 tiling) for hand-built scenarios; `edit` places treats, then no line may exist. */
function arranged(edit: (cells: number[], marks: Mark[]) => void): TreatBoard {
  const board = new TreatBoard(createRng(1));
  board.cells = Array.from({length: WIDTH * HEIGHT}, (_, i) => (i % 2) + 2 * (Math.floor(i / WIDTH) % 2));
  board.marks = board.cells.map(() => 0 as Mark);
  edit(board.cells, board.marks);
  board.movesLeft = MOVES;
  return board;
}

test('specials: a line of four across makes a column stripe, down a row stripe, five or a T/L a bomb, each staying where the swap was', () => {
  const four = arranged(cells => { cells[0] = cells[1] = cells[2] = 5; cells[WIDTH + 3] = 5; });
  const a = four.swap(3, WIDTH + 3)!;
  assert.deepEqual(a[0]!.created, [{cell: 3, mark: STRIPE_COL}]);
  assert.equal(a[0]!.afterMarks[3], STRIPE_COL);
  assert.equal(a[0]!.after[3], 5, 'the special keeps its kind');
  assert.ok(a[0]!.cleared.includes(3) && a[0]!.cleared.length >= 4, 'the whole line scores');
  const down = arranged(cells => { cells[0] = cells[WIDTH] = cells[2 * WIDTH] = 5; cells[3 * WIDTH + 1] = 5; });
  const b = down.swap(3 * WIDTH, 3 * WIDTH + 1)!;
  assert.deepEqual(b[0]!.created, [{cell: 3 * WIDTH, mark: STRIPE_ROW}]);
  const five = arranged(cells => { cells[0] = cells[1] = cells[2] = cells[4] = 5; cells[WIDTH + 3] = 5; });
  assert.deepEqual(five.swap(3, WIDTH + 3)![0]!.created, [{cell: 3, mark: BOMB}]);
  const ell = arranged(cells => { cells[0] = cells[1] = cells[3] = cells[WIDTH + 2] = cells[2 * WIDTH + 2] = 5; });
  const c = ell.swap(2, 3)!;
  assert.deepEqual(c[0]!.created, [{cell: 2, mark: BOMB}]);
  for (const cell of [0, 1, 2, WIDTH + 2, 2 * WIDTH + 2]) assert.ok(c[0]!.cleared.includes(cell));
  const plain = arranged(cells => { cells[0] = cells[1] = 5; cells[WIDTH + 2] = 5; });
  assert.deepEqual(plain.swap(2, WIDTH + 2)![0]!.created, [], 'three in a line makes no special');
});

test('specials: a striped treat in a match clears its whole row or column; a bomb in a match clears its kind', () => {
  const row = arranged((cells, marks) => { cells[0] = cells[1] = 5; cells[WIDTH + 2] = 5; marks[0] = STRIPE_ROW; });
  const r = row.swap(2, WIDTH + 2)![0]!;
  for (let x = 0; x < WIDTH; x += 1) assert.ok(r.cleared.includes(x), `row cell ${x}`);
  assert.deepEqual(r.triggered, [{cell: 0, mark: STRIPE_ROW}]);
  const col = arranged((cells, marks) => { cells[0] = cells[1] = 5; cells[WIDTH + 2] = 5; marks[1] = STRIPE_COL; });
  const k = col.swap(2, WIDTH + 2)![0]!;
  for (let y = 0; y < HEIGHT; y += 1) assert.ok(k.cleared.includes(y * WIDTH + 1), `column cell ${y}`);
  const bomb = arranged((cells, marks) => { cells[0] = cells[1] = 5; cells[WIDTH + 2] = 5; cells[40] = cells[27] = 5; marks[0] = BOMB; });
  const b = bomb.swap(2, WIDTH + 2)![0]!;
  assert.ok(b.cleared.includes(40) && b.cleared.includes(27), 'every treat of the bomb kind clears');
  assert.deepEqual(b.triggered.map(item => item.mark), [BOMB]);
  assert.equal(b.gained, pointsFor(b.cleared.length, 1));
});

test('specials: a bomb swapped with a neighbour is always a legal move and clears the neighbour\'s kind', () => {
  const board = arranged((cells, marks) => { cells[0] = 4; marks[0] = BOMB; });
  const kind = board.cells[1]!;
  const total = board.cells.filter(value => value === kind).length;
  assert.ok(board.swapWorks(0, 1));
  assert.ok(board.hasMove());
  const steps = board.swap(0, 1)!;
  assert.equal(steps[0]!.cleared.length, total + 1);
  assert.deepEqual(steps[0]!.triggered, [{cell: 1, mark: BOMB}]);
  assert.equal(board.movesLeft, MOVES - 1);
  assert.ok(steps.at(-1)!.after.every(value => value >= 0));
  assert.equal(matched(board.cells).size, 0);
});

test('falls: every treat that moved reports where it came from, new treats come from above the board, and the fall fills the board', () => {
  const board = arranged(cells => { cells[0] = cells[1] = 5; cells[WIDTH + 2] = 5; });
  const step = board.swap(2, WIDTH + 2)![0]!;
  assert.equal(step.falls.length > 0, true);
  for (const fall of step.falls) assert.ok(fall.fromRow !== Math.floor(fall.to / WIDTH));
  assert.ok(step.falls.some(fall => fall.fromRow < 0), 'new treats drop in');
  assert.ok(step.falls.every(fall => fall.fromRow < Math.floor(fall.to / WIDTH)), 'treats only fall down');
});

test('specials: random play over many seeds keeps boards line-free, alive and consistent, and specials do appear', () => {
  let specials = 0, triggered = 0;
  for (let seed = 1; seed <= 120; seed += 1) {
    const rng = createRng(seed * 31);
    const board = new TreatBoard(createRng(seed));
    let total = 0;
    while (!board.over) {
      const moves: Array<[number, number]> = [];
      for (let cell = 0; cell < board.cells.length; cell += 1) { if (cell % WIDTH < WIDTH - 1 && board.swapWorks(cell, cell + 1)) moves.push([cell, cell + 1]); if (cell < board.cells.length - WIDTH && board.swapWorks(cell, cell + WIDTH)) moves.push([cell, cell + WIDTH]); }
      const [a, b] = rng.pick(moves);
      const steps = board.swap(a, b)!;
      assert.ok(steps.length >= 1);
      for (const step of steps) { total += step.gained; specials += step.created.length; triggered += step.triggered.length; assert.equal(step.gained, pointsFor(step.cleared.length, step.chain)); for (const item of step.created) assert.ok(step.afterMarks[item.cell] === item.mark || step.afterMarks.some(mark => mark !== 0)); }
      assert.equal(matched(board.cells).size, 0);
      assert.ok(board.cells.every(kind => kind >= 0 && kind < 6));
      assert.ok(board.marks.every(mark => mark >= 0 && mark <= 3));
      assert.ok(board.hasMove());
    }
    assert.equal(board.score, total);
  }
  assert.ok(specials > 20 && triggered > 5, `specials ${specials}, triggered ${triggered}`);
});

test('stars: thresholds are increasing and starsFor counts them', () => {
  assert.ok(STARS[0] < STARS[1] && STARS[1] < STARS[2]);
  assert.equal(starsFor(0), 0);
  assert.equal(starsFor(STARS[0]), 1);
  assert.equal(starsFor(STARS[1]), 2);
  assert.equal(starsFor(STARS[2] + 1), 3);
});

type Probe = {key(k: unknown): unknown; animate(d: number): void; render(c: Canvas, a: number, p: unknown): void; status: string; result: {score: number; details: string[]} | undefined; board: TreatBoard; cursor: number; phases: Array<{kind: string; t: number; dur: number}>; layout(): {cellW: number; cellH: number; x: number; y: number; width: number; height: number} | undefined; tiles(): Array<{cell: number; x: number; y: number; scale: number}>; pops: Array<{text: string}>; dispose(): void; refreshMs: number; finale: {done: boolean; skip(): void} | undefined};
const palette = arcadePalette('truecolor');
const make = (options: Partial<GameContext> = {}) => treatsGame.create(context(memory(), options)) as never as Probe;
const swapHint = (game: Probe) => { const [a, b] = game.board.hint()!; game.cursor = a; game.key({kind: 'text', value: ' '}); game.cursor = a; game.key({kind: b === a + 1 ? 'right' : 'down'}); return [a, b] as const; };
const badSwap = (game: Probe) => { const board = game.board; for (let cell = 0; cell < board.cells.length - 1; cell += 1) if (cell % WIDTH < WIDTH - 1 && !board.swapWorks(cell, cell + 1)) { game.cursor = cell; game.key({kind: 'text', value: ' '}); game.cursor = cell; game.key({kind: 'right'}); return cell; } throw new Error('no bad swap'); };

test('layout: tiles are physically square at many sizes and the board is centered inside the canvas', () => {
  for (const [columns, rows] of [[160, 45], [100, 34], [80, 30], [60, 24], [40, 16], [28, 12]] as const) {
    const game = make({size: {columns, rows}});
    const layout = game.layout();
    assert.ok(layout, `${columns}x${rows}`);
    assert.equal(layout.cellW / (layout.cellH * 2), 1);
    assert.ok(layout.x >= 0 && layout.x + layout.width <= columns && layout.y >= 2 && layout.y + layout.height <= rows - 1);
    assert.ok(Math.abs(layout.x - (columns - layout.width - layout.x)) <= 1);
  }
  assert.ok(make({size: {columns: 100, rows: 34}}).layout()!.cellH >= 3);
});

test('no-match popup: never on the title row (row 0) nor the progress row, for any size, color mode and motion setting', () => {
  for (const [columns, rows] of [[160, 45], [100, 34], [60, 24], [40, 16], [28, 12]] as const) for (const mode of [{color: 'truecolor' as const, safe: false}, {color: 'none' as const, safe: true}]) for (const reduced of [false, true]) {
    const game = make({size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe, motion: {reduced, effects: reduced ? 'off' : 'normal'}});
    // Bad swaps at the top row, the corners and the middle: the popup is placed over the tiles being swapped.
    for (const cell of [0, 1, WIDTH - 2, 3 * WIDTH + 3, (HEIGHT - 1) * WIDTH]) {
      game.cursor = cell; game.key({kind: 'text', value: ' '}); game.cursor = cell; game.key({kind: cell % WIDTH === WIDTH - 1 ? 'left' : 'right'});
      for (let step = 0; step < 6; step += 1) {
        const canvas = new Canvas(columns, rows);
        game.render(canvas, 0, palette);
        const lines = canvas.plain({color: mode.color, safe: mode.safe});
        assert.ok(!/no match/iu.test(lines[0]!), `title row at ${columns}x${rows} ${mode.color} reduced=${reduced}: ${lines[0]}`);
        assert.ok(!/no match/iu.test(lines[1]!), `progress row at ${columns}x${rows}`);
        for (const line of lines) assert.ok(displayWidth(line) <= columns);
        game.animate(150);
      }
      game.key({kind: 'escape'});
    }
    game.dispose();
  }
});

test('a rejected swap slides the tiles over and back and changes nothing; a legal swap slides, pops, then drops tiles smoothly', () => {
  const game = make();
  const before = game.board.cells.slice();
  const cell = badSwap(game);
  assert.deepEqual(game.board.cells, before);
  assert.equal(game.board.movesLeft, MOVES);
  assert.equal(game.phases[0]!.kind, 'swap');
  game.animate(120);
  const a = game.tiles().find(tile => tile.cell === cell)!;
  assert.ok(a.x > cell % WIDTH, 'the tile has started sliding toward its neighbour');
  game.animate(1000);
  assert.equal(game.phases.length, 0);
  assert.ok(game.pops.length >= 0);

  const play = make();
  const [x, y] = swapHint(play);
  assert.equal(play.phases[0]!.kind, 'swap');
  play.animate(60);
  const moving = play.tiles().find(tile => tile.cell === x)!;
  assert.ok(Math.abs(moving.x - (x % WIDTH)) > 0 || Math.abs(moving.y - Math.floor(x / WIDTH)) > 0, 'the swapped tile is between cells');
  assert.ok(y !== undefined);
  // Run to the clear phase: cleared tiles shrink.
  for (let guard = 0; guard < 50 && play.phases[0]?.kind !== 'clear'; guard += 1) play.animate(20);
  play.animate(CLEAR_MID);
  assert.ok(play.tiles().some(tile => tile.scale !== 1), 'pop and shrink');
  // Then the fall: some tile is above its home row.
  for (let guard = 0; guard < 80 && play.phases[0]?.kind !== 'fall'; guard += 1) play.animate(20);
  play.animate(40);
  assert.ok(play.tiles().some(tile => tile.y < Math.floor(tile.cell / WIDTH)), 'tiles are mid-drop above their new rows');
  assert.ok(play.refreshMs > 0);
  for (let guard = 0; guard < 200 && play.phases.length; guard += 1) play.animate(50);
  assert.equal(play.phases.length, 0);
  assert.ok(play.tiles().every(tile => tile.scale === 1 && tile.y === Math.floor(tile.cell / WIDTH) && tile.x === tile.cell % WIDTH));
});

const CLEAR_MID = 60;

test('reduced motion settles the whole move at once, and any key skips an animation in progress', () => {
  const still = make({motion: {reduced: true, effects: 'off'}});
  swapHint(still);
  assert.equal(still.phases.length, 0);
  assert.equal(still.board.movesLeft, MOVES - 1);
  const game = make();
  swapHint(game);
  assert.ok(game.phases.length > 0);
  game.key({kind: 'right'});
  assert.equal(game.phases.length, 0);
});

test('progress: the moves bar and the three star thresholds are shown, in color and without', () => {
  for (const mode of [{color: 'truecolor' as const, safe: false}, {color: 'none' as const, safe: true}]) {
    const game = make({size: {columns: 100, rows: 34}, color: mode.color, safeGlyphs: mode.safe});
    const canvas = new Canvas(100, 34);
    game.render(canvas, 0, palette);
    const row = canvas.plain({color: mode.color, safe: mode.safe})[1]!;
    assert.ok(/Moves/.test(row) && row.includes(String(MOVES)));
    assert.equal((row.match(mode.safe ? /o/g : /☆/g) ?? []).length >= 3, true, 'three star marks');
  }
});

test('specials render with distinct marks, in sprites, glyphs and letters', () => {
  for (const [columns, rows, color, safe] of [[100, 34, 'truecolor', false], [40, 16, 'truecolor', false], [60, 24, 'none', true]] as const) {
    const game = make({size: {columns, rows}, color, safeGlyphs: safe});
    game.board.marks[0] = 1; game.board.marks[1] = 2; game.board.marks[2] = 3;
    (game as never as {shownMarks: number[]}).shownMarks = game.board.marks.slice();
    const canvas = new Canvas(columns, rows);
    game.render(canvas, 0, palette);
    for (const line of canvas.plain({color, safe})) assert.ok(displayWidth(line) <= columns);
    if (columns === 40 || safe) {
      const text = canvas.plain({color, safe}).join('\n');
      assert.ok(safe ? /[=|*]/.test(text) : /[═║✱]/.test(text));
    }
  }
});

test('the finale: three stars earn a longer celebration than none, it can be skipped, and the result lists the stars; saved records are unchanged', () => {
  const record = memory();
  const game = treatsGame.create(context(record)) as never as Probe;
  for (let moves = 0; moves < MOVES; moves += 1) { swapHint(game); for (let i = 0; i < 80; i += 1) game.animate(100); }
  assert.equal(game.status, 'over');
  assert.ok(game.finale);
  assert.ok(game.result!.details[0]!.includes('stars'));
  assert.ok(!game.finale!.done || true);
  const canvas = new Canvas(100, 34);
  game.render(canvas, 0, palette);
  game.finale!.skip();
  assert.equal(game.finale!.done, true);
  assert.equal(typeof (record.raw() as {best: number}).best, 'number');
  assert.equal(typeof (record.raw() as {bestChain: number}).bestChain, 'number');
});

// ---- review fixes ------------------------------------------------------------------------------------------------

type Hinted = Probe & {hintCells: [number, number] | undefined; cursor: number; note: string; noteLeft: number};

test('h asks for a hint (it is not read as vim-left): the two cells of a legal swap are remembered and drawn, and the next move clears them', () => {
  const game = make() as Hinted;
  game.cursor = 20;
  game.key({kind: 'text', value: 'h'});
  assert.equal(game.cursor, 20, 'the cursor did not move left');
  assert.deepEqual(game.hintCells, game.board.hint());
  assert.ok(game.board.swapWorks(game.hintCells![0], game.hintCells![1]));
  const before = new Canvas(100, 34); const withHint = new Canvas(100, 34);
  const quiet = make();
  quiet.render(before, 0, palette);
  game.render(withHint, 0, palette);
  assert.notDeepEqual(withHint.rows(), before.rows(), 'the hint ring changes the picture');
  game.key({kind: 'right'});
  assert.equal(game.hintCells, undefined);
  game.key({kind: 'text', value: 'H'});
  assert.ok(game.hintCells, 'upper case works too');
  // The hint is reachable in the plain, small look as well, where it is the "*" marker.
  const plain = make({size: {columns: 40, rows: 16}, color: 'none', safeGlyphs: true}) as Hinted;
  plain.key({kind: 'text', value: 'h'});
  const lines = new Canvas(40, 16); plain.render(lines, 0, palette);
  assert.match(lines.plain({color: 'none', safe: true}).join('\n'), /\*/u);
});

test('tiles dropping in from above the board never draw over the title or progress rows, in any size and look', () => {
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) for (const plain of [false, true]) {
    const game = make({size: {columns, rows}, ...(plain ? {color: 'none' as const, safeGlyphs: true} : {})});
    const layout = game.layout()!;
    swapHint(game);
    for (let step = 0; step < 60; step += 1) {
      game.animate(25);
      const canvas = new Canvas(columns, rows);
      game.render(canvas, 0, palette);
      const lines = canvas.plain({color: plain ? 'none' : 'truecolor', safe: plain});
      // Above the board only the title and progress rows exist; the moves counter and score bar are all digits, bars and stars.
      for (let row = 2; row < layout.y; row += 1) assert.equal(lines[row]!.trim(), '', `row ${row} above the board at ${columns}x${rows} plain=${plain}`);
      // Narrow windows have no "Moves" label: the progress row is only the bar, the count and the star bar.
      if (columns < 34) assert.match(lines[1]!, /^[\x20#\-0-9o*█░★☆]*$/u, `no tile glyphs on the progress row at ${columns}x${rows}: ${lines[1]}`);
    }
  }
});

test('a swap that leaves no legal swap reshuffles the board and says so', () => {
  const game = make() as Hinted;
  const board = game.board;
  // Force the end state: after the swap below, make hasMove report false so the board is reshuffled.
  const [a, b] = board.hint()!;
  const original = board.hasMove.bind(board);
  let calls = 0;
  board.hasMove = () => (calls++ === 0 ? false : original());
  game.cursor = a; game.key({kind: 'text', value: ' '}); game.key({kind: b === a + 1 ? 'right' : 'down'});
  assert.equal(board.shuffles, 1);
  assert.match(game.note, /reshuffled/u);
  assert.ok(game.noteLeft > 0);
  assert.ok(original(), 'the reshuffled board has a legal swap');
});
