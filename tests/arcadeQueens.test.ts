import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import type {Key} from '../src/terminal/keys.js';
import {ArcadeSession, type ArcadeEnvironment} from '../src/arcade/ArcadeSession.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {createRng} from '../src/arcade/rng.js';
import {ArcadeStore, type GameRecord, type GameRecordHandle} from '../src/arcade/scores.js';
import {findGame} from '../src/arcade/registry.js';
import type {GameContext, GameInstance} from '../src/arcade/types.js';
import {queensGame} from '../src/arcade/games/queens/index.js';
import {readCurrent} from '../src/arcade/games/queens/board.js';
import {minimumCanvas} from '../src/arcade/games/queens/layout.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';

const text = (value: string): Key => ({kind: 'text', value} as Key);
const named = (kind: string): Key => ({kind} as Key);

function memoryRecord(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data: GameRecord = structuredClone(initial);
  return {get: () => structuredClone(data), set: record => { data = structuredClone(record); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}

interface Options { columns?: number; rows?: number; reduced?: boolean; color?: 'none' | 'truecolor'; safe?: boolean; record?: ReturnType<typeof memoryRecord>; seed?: number }

function open(options: Options = {}) {
  const record = options.record ?? memoryRecord();
  const context: GameContext = {
    size: {columns: options.columns ?? 100, rows: options.rows ?? 40}, seed: options.seed ?? 5, rng: createRng(options.seed ?? 5),
    motion: {effects: options.reduced ? 'off' : 'normal', reduced: options.reduced ?? false}, color: options.color ?? 'truecolor', safeGlyphs: options.safe ?? false,
    record, now: () => 0,
  };
  const game = queensGame.create(context);
  const canvas = new Canvas(context.size.columns, context.size.rows);
  const press = (...keys: Array<string | Key>) => { for (const key of keys) game.key(typeof key === 'string' ? (key.length === 1 ? text(key) : named(key)) : key); };
  const plain = (safe = options.safe ?? false, color: 'none' | 'truecolor' = options.color ?? 'truecolor') => { game.render(canvas, 0, arcadePalette()); return canvas.plain({color, safe}); };
  const current = () => readCurrent(record.raw().current);
  return {game, record, canvas, press, plain, current, context};
}

/** Let `ms` of real time pass, in frames the way the host delivers them. */
function elapse(game: GameInstance, ms: number) { for (let left = ms; left > 0; left -= 1000) game.animate(Math.min(1000, left)); }

function goto(press: (...keys: string[]) => void, from: number, to: number, size: number) {
  const rows = Math.floor(to / size) - Math.floor(from / size);
  const columns = (to % size) - (from % size);
  for (let step = 0; step < Math.abs(rows); step += 1) press(rows > 0 ? 'down' : 'up');
  for (let step = 0; step < Math.abs(columns); step += 1) press(columns > 0 ? 'right' : 'left');
}

/** Start a puzzle and track the cursor, which opens at the middle of the board. */
function play(options: Options = {}, difficulty = 'e') {
  const harness = open(options);
  harness.press(difficulty);
  const board = harness.current()!;
  const size = board.size;
  let cursor = Math.floor(size / 2) * size + Math.floor(size / 2);
  const move = (to: number) => { goto(harness.press as never, cursor, to, size); cursor = to; };
  return {...harness, board, size, move, at: () => cursor, cat: (cell: number) => { move(cell); harness.press(' '); }};
}

test('registry: Vespyr Queens is a puzzle with id, alias and title', () => {
  assert.equal(findGame('doku'), queensGame);
  assert.equal(findGame('vespyr-doku'), queensGame);
  assert.equal(findGame('queens'), queensGame);
  assert.equal(queensGame.id, 'queens');
  assert.equal(queensGame.title, 'Vespyr Queens');
  assert.equal(queensGame.kind, 'puzzle');
  const game = open().game;
  assert.equal(game.stepsPerSecond, 0);
  assert.equal(game.refreshMs, 1000);
});

test('menu: new game by difficulty, Continue only when something is saved, Esc leaves', () => {
  const h = open();
  assert.equal(h.game.status, 'ready');
  const menu = h.plain().join('\n');
  assert.match(menu, /New easy puzzle/u);
  assert.match(menu, /New expert puzzle/u);
  assert.doesNotMatch(menu, /Continue/u);
  assert.equal(h.game.key(named('escape')), 'ignored');
  h.press('down', 'down', 'up');
  assert.equal(h.game.status, 'ready');
  h.press('m');
  assert.equal(h.game.status, 'playing');
  assert.equal(h.current()!.difficulty, 'medium');
  assert.equal(h.current()!.size, 7);
  for (const [key, difficulty, sizes] of [['h', 'hard', [8]], ['x', 'expert', [9, 10]], ['e', 'easy', [5, 6]]] as const) {
    const next = open();
    next.press(key);
    assert.equal(next.current()!.difficulty, difficulty);
    assert.ok((sizes as readonly number[]).includes(next.current()!.size));
  }
});

test('moving: arrows and hjkl, clamped at the edges', () => {
  const h = play();
  const {size} = h;
  h.press('left', 'left', 'left', 'left', 'left', 'left', 'up', 'up', 'up', 'up', 'up', 'up', 'h', 'k');
  h.press(' ');
  assert.equal(h.current()!.marks[0], 2, 'Space on the corner cell');
  h.press('l', 'j', 'x');
  assert.equal(h.current()!.marks[size + 1], 1, 'l then j reached row 2, column 2');
  for (let index = 0; index < size + 3; index += 1) h.press('right', 'down');
  h.press('x');
  assert.equal(h.current()!.marks[size * size - 1], 1);
});

test('marks: Space and Enter toggle a cat, x toggles X, a cat clears the X, x leaves a cat alone', () => {
  const h = play();
  const cell = h.at();
  h.press('x');
  assert.equal(h.current()!.marks[cell], 1);
  h.press(' ');
  assert.equal(h.current()!.marks[cell], 2, 'a cat replaces the X');
  h.press('x');
  assert.equal(h.current()!.marks[cell], 2, 'x does not remove a cat');
  h.press('enter');
  assert.equal(h.current()!.marks[cell], 0, 'Enter takes the cat away');
  h.press('x', 'x');
  assert.equal(h.current()!.marks[cell], 0, 'x twice clears the X');
});

test('undo and redo: u, Ctrl+Y and y round trip; c clears everything as one move', () => {
  const h = play();
  const marks = () => [...h.current()!.marks].join('');
  const start = marks();
  h.cat(h.at()); h.press('right', 'x', 'right', ' ');
  const done = marks();
  assert.notEqual(done, start);
  h.press('u', 'u', 'u');
  assert.equal(marks(), start);
  h.press(named('redo'));
  h.press('y', 'y');
  assert.equal(marks(), done);
  h.press('c');
  assert.equal(marks(), start);
  h.press('u');
  assert.equal(marks(), done, 'undo restores the cleared marks');
  h.press('y');
  assert.equal(marks(), start);
});

test('timer: runs from animate only while playing, not in the menu or while paused or won', () => {
  const h = open();
  h.game.animate(5000);
  h.press('e');
  const read = () => h.current()!.elapsedMs;
  assert.equal(read(), 0, 'the menu did not run the clock');
  h.game.animate(1000); h.game.animate(1500);
  h.press('x');
  assert.equal(read(), 2500);
  h.game.step(16);
  assert.equal(read(), 2500, 'step does not move the clock');
  h.game.pause();
  assert.equal(h.game.refreshMs, 50, 'a quick repaint brings the board back after resume');
  h.game.animate(40);
  h.game.animate(1000);
  h.press('x');
  assert.equal(read(), 3500);
  assert.equal(h.game.refreshMs, 250);
});

test('hints: the first press explains and highlights, the second applies; counted; undoable; never touches the puzzle', () => {
  const h = play({}, 'm');
  const before = structuredClone(h.record.raw().current) as Record<string, unknown>;
  h.press('t');
  const shown = h.plain().join('\n');
  assert.match(shown, /Press t again/u);
  assert.match(shown, /[◆◇]|\*|o/u);
  const after = h.record.raw().current as Record<string, unknown>;
  assert.equal(after.marks, before.marks, 'explaining changes nothing');
  assert.equal(after.regions, before.regions);
  assert.equal(after.solution, before.solution);
  assert.equal(after.hints, 1, 'a hint is counted when it is shown');
  h.press('right');
  assert.match(h.plain().join('\n'), /Press t again/u, 'moving the cursor keeps the hint');
  h.press('t');
  const applied = h.current()!;
  assert.notEqual([...applied.marks].join(''), '0'.repeat(applied.marks.length), 'the second press applies it');
  assert.equal(applied.hints, 1, 'applying does not count a second time');
  assert.doesNotMatch(h.plain().join('\n'), /Press t again/u);
  h.press('u');
  assert.equal([...h.current()!.marks].join(''), '0'.repeat(applied.marks.length), 'the applied hint is one undoable move');
  h.press('t', 'x');
  assert.doesNotMatch(h.plain().join('\n'), /Press t again/u, 'any other change drops the hint');
});

test('hints: repeated hints solve the puzzle and the win records no best time', () => {
  const h = play({}, 'e');
  for (let index = 0; index < 200 && h.game.status === 'playing'; index += 1) h.press('t');
  assert.equal(h.game.status, 'won');
  assert.ok(h.game.result!.details.some(line => /hints?$/u.test(line)));
  const record = h.record.raw();
  assert.equal(record.completed, 1);
  assert.equal(record.streak, 0, 'a hinted solve does not extend the streak');
  assert.deepEqual(record.bestTimes, {});
  assert.equal(record.current, undefined, 'a finished puzzle is no longer saved');
});

test('winning by hand: result, statistics, best time per difficulty, streak', () => {
  const h = play({}, 'e');
  const {board} = h;
  elapse(h.game, 83_000);
  board.puzzle.solution.forEach((column, row) => h.cat(row * board.size + column));
  assert.equal(h.game.status, 'won');
  const result = h.game.result!;
  assert.equal(result.scoreText, '1:23');
  assert.equal(result.score, 83);
  assert.equal(result.record, true);
  assert.match(result.details.join(' '), /Easy/u);
  assert.match(result.details.join(' '), /No hints/u);
  const record = h.record.raw() as Record<string, any>;
  assert.equal(record.completed, 1);
  assert.equal(record.completedByDifficulty.easy, 1);
  assert.equal(record.bestTimes.easy, 83_000);
  assert.equal(record.streak, 1);
  assert.equal(record.bestStreak, 1);
  assert.equal(record.version, 1);
  assert.equal(record.current, undefined);
  const rows = h.plain().join('\n');
  assert.match(rows, /Vespyr Queens/u);
  // a slower second solve keeps the best time and extends the streak
  const second = open({record: h.record, seed: 9});
  second.press('e');
  const next = second.current()!;
  elapse(second.game, 120_000);
  let cursor = Math.floor(next.size / 2) * next.size + Math.floor(next.size / 2);
  next.puzzle.solution.forEach((column, row) => { const cell = row * next.size + column; goto(second.press as never, cursor, cell, next.size); cursor = cell; second.press(' '); });
  assert.equal(second.game.status, 'won');
  assert.equal(second.game.result!.record, false);
  assert.match(second.game.result!.details.join(' '), /Best 1:23/u);
  const after = h.record.raw() as Record<string, any>;
  assert.equal(after.bestTimes.easy, 83_000);
  assert.equal(after.streak, 2);
  assert.equal(after.completed, 2);
  assert.match(queensGame.summary(after), /Solved 2/u);
});

test('restart (r twice), new puzzle (n) and Continue', () => {
  const h = play();
  h.cat(h.at());
  h.game.animate(4000);
  h.press('r');
  assert.match(h.plain().join('\n'), /Press r again/u);
  h.press('x');
  h.press('r');
  assert.match(h.plain().join('\n'), /Press r again/u, 'any other key disarms the restart');
  h.press('r');
  const fresh = h.current()!;
  assert.ok([...fresh.marks].every(mark => mark === 0));
  assert.equal(fresh.elapsedMs, 0);
  assert.equal(fresh.seed, h.board.seed, 'the same puzzle');
  assert.deepEqual(fresh.puzzle.regions, h.board.puzzle.regions);
  h.press(' ');
  h.game.animate(2000);
  h.press('n');
  assert.equal(h.game.status, 'ready');
  assert.match(h.plain().join('\n'), /Continue/u);
  h.press('c');
  assert.equal(h.game.status, 'playing');
  const saved = h.current()!;
  assert.equal(saved.marks.filter(mark => mark === 2).length, 1);
  assert.equal(saved.elapsedMs, 2000);
});

test('persistence: leaving saves the board, a new game continues it, a corrupt save is discarded', () => {
  const first = play({}, 'h');
  first.cat(first.at());
  first.press('x');
  elapse(first.game, 7000);
  first.game.persist();
  first.game.dispose();
  const again = open({record: first.record});
  assert.match(again.plain().join('\n'), /Continue .*Hard 8×8 · 0:07/u);
  again.press('enter');
  assert.equal(again.game.status, 'playing');
  assert.equal(again.current()!.elapsedMs, 7000);
  assert.equal(again.current()!.marks.filter(mark => mark === 2).length, 1);
  for (const damage of [{size: 3}, {marks: 'zz'}, {regions: 'AB'}, {elapsedMs: -1}, {solution: '0,1'}]) {
    const record = memoryRecord({...first.record.raw(), current: {...(first.record.raw().current as object), ...damage}});
    const recovered = open({record});
    assert.doesNotMatch(recovered.plain().join('\n'), /Continue/u);
    assert.equal(record.raw().current, undefined, 'the bad save is dropped');
  }
  assert.doesNotMatch(open({record: memoryRecord({current: 'garbage', completed: 'x', bestTimes: 7})}).plain().join('\n'), /Continue/u);
});

test('layout: every canvas from 20 x 8 to 200 x 60 draws within its width, in every screen', () => {
  const sizes: Array<[number, number]> = [[20, 8], [24, 9], [28, 10], [32, 12], [40, 14], [50, 16], [60, 20], [80, 24], [100, 30], [120, 40], [160, 50], [200, 60]];
  for (const [columns, rows] of sizes) {
    for (const key of ['e', 'm', 'h', 'x']) {
      const h = open({columns, rows, seed: 3});
      h.plain();
      h.press(key);
      h.press('t', ' ', 'right', 'x');
      for (const mode of ['truecolor', 'none'] as const) {
        const lines = h.plain(false, mode);
        assert.equal(lines.length, rows);
        for (const line of lines) assert.ok(displayWidth(line) <= columns, `${columns}x${rows} ${key}: "${line}"`);
      }
      const size = h.current()!.size;
      const needs = minimumCanvas(size);
      if (columns < needs.columns || rows < needs.rows) assert.match(h.plain().join('\n'), /Needs at least \d+x\d+/u);
      else assert.doesNotMatch(h.plain().join('\n'), /Needs at least/u);
      h.game.resize({columns: columns + 5, rows: rows + 2});
      h.game.pause();
      for (const line of new Canvas(columns, rows).plain()) assert.ok(displayWidth(line) <= columns);
    }
  }
});

test('regions stay distinguishable without color: letters, borders, cats, X marks and clashes', () => {
  const h = play({color: 'none', columns: 120, rows: 45}, 'm');
  const {size, board} = h;
  const solution = board.puzzle.solution;
  h.cat(solution[0]!);
  h.cat(size + solution[1]!);
  h.move(2 * size + 0); h.press('x');
  // two cats in one row: a clash
  const crowded = 3 * size;
  const wrongColumn = (solution[3]! + 3) % size;
  h.cat(crowded + wrongColumn);
  h.cat(crowded + ((wrongColumn + 4) % size));
  const rows = h.plain(false, 'none');
  const screen = rows.join('\n');
  for (let region = 0; region < size; region += 1) assert.ok(screen.includes(String.fromCharCode(65 + region)), `region letter ${String.fromCharCode(65 + region)}`);
  assert.match(screen, /[┌┐└┘├┤┬┴┼│─]/u, 'borders carry region shapes');
  assert.match(screen, /\( o\.o \)/u, 'a text cat');
  assert.match(screen, /\( !\.! \)/u, 'a clashing cat has its own face');
  assert.match(screen, /[╲╳╱]/u, 'an X mark');
  assert.match(screen, /clash/u);
  assert.match(screen, /!/u);
  const catFaces = screen.match(/\( [o!]\.[o!] \)/gu) ?? [];
  assert.equal(catFaces.length, 4);
  // Safe Glyphs: ASCII only, and the same information
  const safe = play({color: 'none', safe: true, columns: 120, rows: 45}, 'm');
  const answer = safe.board.puzzle.solution;
  safe.cat(answer[0]!);
  safe.cat(safe.size + answer[1]!);
  safe.move(2 * safe.size + ((answer[2]! + 1) % safe.size)); safe.press('x');
  safe.cat(3 * safe.size + ((answer[3]! + 2) % safe.size));
  safe.cat(3 * safe.size + ((answer[3]! + 5) % safe.size));
  const ascii = safe.plain(true, 'none');
  for (const line of ascii) assert.match(line, /^[\x20-\x7e]*$/u, line);
  const asciiScreen = ascii.join('\n');
  assert.match(asciiScreen, /[+|-]/u);
  assert.match(asciiScreen, /\( o\.o \)/u);
  assert.match(asciiScreen, /\( !\.! \)/u);
  assert.match(asciiScreen, /\\ \/|X/u);
});

test('small cells keep the information too: letters, ^.^ cats, × marks and ! clashes', () => {
  const h = play({color: 'none', columns: 80, rows: 24}, 'x');
  const {size} = h;
  h.cat(0); h.cat(1);
  h.move(size * 2 + 2); h.press('x');
  const screen = h.plain(false, 'none').join('\n');
  assert.match(screen, /\^!\^/u, 'clashing cats');
  assert.match(screen, /×/u);
  assert.match(screen, /│/u);
  assert.match(screen, /\[/u, 'the cursor brackets');
  assert.ok(screen.includes('A') && screen.includes('B'));
  const mini = play({color: 'none', columns: 24, rows: 9}, 'e');
  mini.cat(0);
  const text = mini.plain(false, 'none').join('\n');
  assert.match(text, /\^/u);
  assert.match(text, /A/u);
});

test('completed rows, columns and regions are marked', () => {
  const h = play({color: 'none', columns: 120, rows: 45}, 'e');
  const solution = h.board.puzzle.solution;
  h.cat(solution[0]!);
  const first = h.plain(false, 'none').join('\n');
  assert.match(first, /✔/u, 'a satisfied row and column show a tick');
  assert.equal(h.board.size > 0, true);
  const analysis = readCurrent(h.record.raw().current)!.analysis();
  assert.ok(analysis.rowDone[0] && analysis.columnDone[solution[0]!] && analysis.regionDone[0]);
});

test('reduced motion is static; normal motion blinks', () => {
  const frames = (reduced: boolean) => {
    const h = play({color: 'none', reduced, columns: 120, rows: 45}, 'e');
    h.cat(h.at());
    h.game.animate(1);
    const seen = new Set<string>();
    for (let tick = 0; tick < 60; tick += 1) { h.game.animate(250); seen.add(h.plain(false, 'none').join('\n').replace(/\d+:\d\d/gu, '')); }
    return {seen, refresh: h.game.refreshMs};
  };
  const still = frames(true);
  assert.equal(still.seen.size, 1, 'reduced motion never changes between frames');
  assert.equal(still.refresh, 1000);
  const lively = frames(false);
  assert.ok(lively.seen.size > 1, 'the cat blinks now and then');
  const h = play({reduced: false}, 'e');
  h.cat(h.at());
  assert.equal(h.game.refreshMs, 50, 'a placement settles quickly');
  for (let index = 0; index < 4; index += 1) h.game.animate(100);
  assert.equal(h.game.refreshMs, 250);
  const calm = play({reduced: true}, 'e');
  calm.cat(calm.at());
  assert.equal(calm.game.refreshMs, 1000, 'no settle animation under reduced motion');
});

test('the winning board is drawn with its cats, and particles only when motion allows', () => {
  const win = (reduced: boolean) => {
    const h = play({reduced, columns: 100, rows: 40}, 'e');
    h.board.puzzle.solution.forEach((column, row) => h.cat(row * h.board.size + column));
    assert.equal(h.game.status, 'won');
    return h;
  };
  const calm = win(true);
  const lively = win(false);
  const cells = (h: ReturnType<typeof win>) => { h.plain(); return h.canvas; };
  const particles = (h: ReturnType<typeof win>) => { let count = 0; const canvas = cells(h); for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) if (canvas.cell(x, y)?.ch === '▀' || canvas.cell(x, y)?.ch === '▄') count += 1; return count; };
  assert.ok(particles(lively) >= particles(calm));
  assert.match(calm.plain().join('\n'), /Every row, column and region/u);
});

test('the shared session: pause hides the board, resume brings it back, a win shows the card', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-doku-'));
  try {
    let now = 1000;
    const env: ArcadeEnvironment = {store: new ArcadeStore({directory: dir}), now: () => now, motion: () => ({reduced: false, effects: 'normal'}), color: () => 'none', safeGlyphs: () => false, seed: () => 11};
    const session = new ArcadeSession(env, [queensGame], {columns: 100, rows: 40}, queensGame);
    const screen = () => session.render().rows.map(row => stripAnsi(row)).join('\n');
    assert.match(screen(), /New easy puzzle/u);
    session.key(text('e'));
    assert.equal(session.screen, 'playing');
    assert.match(screen(), /Easy [56]×[56]/u);
    assert.match(screen(), /A/u);
    assert.ok(session.interval > 0 && session.interval <= 1000);
    session.key(named('escape'));
    assert.equal(session.screen, 'paused');
    const paused = screen();
    assert.match(paused, /Paused/u);
    assert.doesNotMatch(paused, /│A/u, 'the board is hidden');
    session.key(named('escape'));
    assert.equal(session.screen, 'playing');
    session.frame(50);
    assert.match(screen(), /│A|A/u);
    assert.doesNotMatch(screen(), /board is hidden/u);
    // leaving saves the unfinished puzzle for next time
    session.dispose();
    const store = new ArcadeStore({directory: dir});
    assert.ok(readCurrent(store.record('vespyr-doku').get().current));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('preview and summary behave for an empty or odd record', () => {
  const canvas = new Canvas(30, 8);
  for (let frame = 0; frame < 30; frame += 3) { canvas.clear(); queensGame.preview(canvas, frame, arcadePalette()); }
  assert.match(canvas.plain().join('\n'), /[A-E]/u);
  assert.equal(queensGame.summary({}), 'Not played yet');
  assert.equal(queensGame.summary({completed: 'many', bestTimes: null}), 'Not played yet');
  assert.match(queensGame.summary({completed: 3, bestTimes: {hard: 95_000}}), /Solved 3 · best hard 1:35/u);
  const tiny = new Canvas(16, 3);
  queensGame.preview(tiny, 4, arcadePalette());
});

test('dispose releases the board and is safe to repeat', () => {
  const h = play();
  (h.game as GameInstance).dispose();
  (h.game as GameInstance).dispose();
  h.game.animate(100);
});

// ---- the redesigned board (color) ------------------------------------------------------------------------------

test('color board: each region is labelled once, not in every cell; region hues are clearly different', async () => {
  const {arcadeLook, deltaE, distinctColors} = await import('../src/arcade/look.js');
  const h = play({color: 'truecolor'});
  const screen = h.plain(false, 'truecolor').join('\n');
  for (let region = 0; region < h.size; region += 1) {
    const letter = String.fromCharCode(65 + region);
    const count = (screen.match(new RegExp(`(?<![A-Za-z])${letter}(?![a-z])`, 'gu')) ?? []).length;
    assert.ok(count <= 2, `region ${letter} labelled at most once on the board (found ${count})`);
  }
  const hues = distinctColors(h.size, arcadeLook());
  for (let a = 0; a < hues.length; a += 1) for (let b = a + 1; b < hues.length; b += 1) assert.ok(deltaE(hues[a]!, hues[b]!) >= 6, `regions ${a} and ${b}`);
  assert.doesNotMatch(screen, /[╲╳╱]/u, 'no box-drawing X: exclusions are a pixel mark');
});

test('color board: the win plays a hop wave across every cat as the finale; any key skips it; Reduced Motion holds still', () => {
  const h = play();
  h.board.puzzle.solution.forEach((column, row) => h.cat(row * h.board.size + column));
  assert.equal(h.game.status, 'won');
  assert.ok(h.game.finale && !h.game.finale.done, 'the cats celebrate first');
  h.game.animate(200);
  assert.ok(h.game.refreshMs <= 60, 'frames while it plays');
  h.press('x');
  assert.equal(h.game.finale!.done, true);
  const calm = play({reduced: true});
  calm.board.puzzle.solution.forEach((column, row) => calm.cat(row * calm.board.size + column));
  assert.ok(calm.game.finale, 'a still highlight marks the win');
  for (let t = 0; t < 1000; t += 100) calm.game.animate(100);
  assert.equal(calm.game.finale!.done, true);
});

test('color board: taking a cat away fades its cell briefly; nothing fades under Reduced Motion', () => {
  const h = play();
  const cell = h.at();
  h.press(' ');
  h.press(' ');
  assert.ok((h.game as any).vanish[cell] > 0);
  h.game.animate(400);
  assert.equal((h.game as any).vanish[cell], 0);
  const calm = play({reduced: true});
  calm.press(' '); calm.press(' ');
  assert.equal((calm.game as any).vanish[calm.at()], 0);
});
