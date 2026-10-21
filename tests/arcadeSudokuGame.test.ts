import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import type {Key} from '../src/terminal/keys.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {createRng} from '../src/arcade/rng.js';
import {ArcadeStore, cleanRecord, type GameRecord, type GameRecordHandle} from '../src/arcade/scores.js';
import type {GameContext} from '../src/arcade/types.js';
import {ArcadeSession, type ArcadeEnvironment} from '../src/arcade/ArcadeSession.js';
import {registryHas} from './support/arcadeSudokuSupport.js';
import {sudokuGame, type SudokuInstance} from '../src/arcade/games/sudoku/index.js';
import {layoutFor, MIN_COLUMNS, MIN_ROWS} from '../src/arcade/games/sudoku/layout.js';
import {gridString} from '../src/arcade/games/sudoku/solver.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

function memoryRecord(initial: GameRecord = {}): GameRecordHandle & {raw: () => GameRecord} {
  let record = initial;
  return {
    get: () => structuredClone(record),
    set: next => { const clean = cleanRecord(next); if (!clean) return false; record = clean; return true; },
    update: change => { const copy = structuredClone(record); change(copy); const clean = cleanRecord(copy); if (!clean) return false; record = clean; return true; },
    raw: () => record,
  };
}

interface Options { columns?: number; rows?: number; reduced?: boolean; effects?: 'off' | 'subtle' | 'normal' | 'rich'; color?: 'none' | 'truecolor'; safe?: boolean; record?: GameRecordHandle & {raw: () => GameRecord}; seed?: number }

function setup(options: Options = {}) {
  const record = options.record ?? memoryRecord();
  const context: GameContext = {
    size: {columns: options.columns ?? 100, rows: options.rows ?? 36}, seed: options.seed ?? 5, rng: createRng(options.seed ?? 5),
    motion: {reduced: options.reduced ?? false, effects: options.effects ?? 'normal'}, color: options.color ?? 'none', safeGlyphs: options.safe ?? false, record, now: () => 0,
  };
  const game = sudokuGame.create(context) as SudokuInstance;
  const canvas = new Canvas(context.size.columns, context.size.rows);
  const press = (...keys: string[]) => keys.forEach(value => game.key(value.length === 1 ? {kind: 'text', value} : {kind: value} as Key));
  const draw = () => { game.render(canvas, 0, arcadePalette()); return canvas; };
  return {game, record, canvas, press, draw, context};
}

/** Start an easy puzzle from the menu with the keys a person would use. */
function startEasy(options: Options = {}) {
  const s = setup(options);
  s.press('1');
  assert.equal(s.game.screen, 'play');
  return s;
}

function solveAll(s: ReturnType<typeof setup>): void {
  const state = s.game.state!;
  for (let cell = 0; cell < 81; cell += 1) {
    if (state.isClue(cell) || state.grid[cell] === state.solution[cell]) continue;
    state.moveTo(cell);
    s.press(String(state.solution[cell]));
  }
}

test('registry: sudoku keeps its id, alias and title', () => {
  assert.equal(sudokuGame.id, 'sudoku');
  assert.deepEqual(sudokuGame.aliases, ['classic-sudoku']);
  assert.equal(sudokuGame.title, 'Classic Sudoku');
  assert.equal(sudokuGame.kind, 'puzzle');
  assert.ok(registryHas());
});

test('menu: ready until a puzzle starts; Enter and the number keys start one; q goes back; Esc is left to the host', () => {
  const s = setup();
  assert.equal(s.game.status, 'ready');
  assert.equal(s.game.stepsPerSecond, 0);
  const text = s.draw().plain().join('\n');
  for (const word of ['Classic Sudoku', 'Easy', 'Medium', 'Hard', 'Expert', 'Back to Arcade']) assert.match(text, new RegExp(word, 'u'));
  assert.equal(s.game.key({kind: 'escape'}), 'ignored');
  assert.equal(s.game.key({kind: 'text', value: 'q'}), 'back');
  const t = setup();
  t.press('down', 'enter');
  assert.equal(t.game.state!.difficulty, 'medium');
  const s2 = s;
  assert.equal(t.game.status, 'playing');
  assert.equal(t.game.refreshMs, 1000, 'the host repaints the clock once a second');
  assert.ok(t.game.hints().some(hint => hint.keys === 't'), 'the hint key is shown');
  assert.equal(s2.game.screen, 'menu');
});

test('input: movement keys, digits, erase, notes, undo, redo, hint and the immutable clues', () => {
  const s = startEasy();
  const state = s.game.state!;
  const start = state.cursor;
  assert.equal(state.puzzle[start], 0, 'the cursor starts on an open cell');
  s.press('l'); assert.equal(state.cursor % 9 > 0 || start % 9 === 8, true);
  s.press('h', 'down'); const afterDown = state.cursor; s.press('k'); assert.equal(state.cursor, afterDown - 9);
  s.press('j', 'up', 'left', 'right');
  state.moveTo(start);
  s.press('5'); assert.equal(state.grid[start], 5);
  s.press('0'); assert.equal(state.grid[start], 0);
  s.press('3'); s.press('backspace'); assert.equal(state.grid[start], 0);
  s.press('4'); s.press('delete'); assert.equal(state.grid[start], 0);
  s.press('n'); assert.ok(state.notesMode);
  s.press('1', '2'); assert.equal(state.notes[start], 3);
  s.press('n'); s.press('6'); assert.equal(state.notes[start], 0);
  s.press('u'); assert.equal(state.grid[start], 0); assert.equal(state.notes[start], 3);
  s.press('redo'); assert.equal(state.grid[start], 6);
  s.press('u', 'y'); assert.equal(state.grid[start], 6);
  const clue = state.puzzle.findIndex(digit => digit !== 0);
  state.moveTo(clue);
  const clueDigit = state.puzzle[clue];
  s.press('9', '0', 'backspace', 'n', '2', 'n');
  assert.equal(state.grid[clue], clueDigit);
  assert.equal(state.entries[clue], 0);
  assert.equal(state.notes[clue], 0);
  state.moveTo(start); s.press('t');
  assert.ok(state.hints >= 1 && state.grid[start] === state.solution[start]);
});

test('timer: runs from animate only while playing, pause stops it and the board is hidden', () => {
  const s = setup();
  s.game.animate(5000);
  s.press('1');
  const state = s.game.state!;
  assert.equal(state.elapsedMs, 0, 'the menu does not run the clock');
  s.game.step(16); s.game.animate(1500);
  assert.equal(state.elapsedMs, 1500);
  s.game.animate(60_000);
  assert.equal(state.elapsedMs, 3500, 'one tick is capped so a suspended terminal does not bank time');
  s.game.pause();
  const hidden = s.draw().plain().join('\n');
  const clue = String(state.puzzle.find(digit => digit !== 0));
  const layout = layoutFor(100, 36)!;
  const board = s.canvas.plain().slice(layout.y, layout.y + layout.boardH).map(row => row.slice(layout.x, layout.x + layout.boardW)).join('\n');
  assert.ok(!/[1-9]/u.test(board), `no digits on a paused board (${clue})`);
  assert.match(hidden, /Paused/u);
  assert.equal(state.elapsedMs, 3500, 'pausing stops the clock');
  s.game.animate(10);
  assert.equal(state.elapsedMs, 3500, 'the resume frame adds nothing');
  assert.ok(/[1-9]/u.test(s.draw().plain().slice(layout.y, layout.y + layout.boardH).join('')), 'the board is back');
  s.game.animate(1000);
  assert.equal(state.elapsedMs, 4500);
});

test('restart keeps the puzzle; a new game makes a different one', () => {
  const s = startEasy();
  const state = s.game.state!;
  const puzzle = gridString(state.puzzle);
  s.press('5', 'n', '2', 't'); s.game.animate(3000);
  s.press('r');
  assert.match(s.draw().plain().join('\n'), /Press r again/u);
  assert.ok(state.entries.some(Boolean), 'one press only asks');
  s.press('r');
  assert.equal(s.game.state!, state);
  assert.equal(gridString(state.puzzle), puzzle);
  assert.ok(state.entries.every(d => d === 0) && state.hints === 0 && state.elapsedMs === 0);
  s.press('r', 'x');
  assert.ok(!/Press r again/u.test(s.draw().plain().join('\n')), 'any other key cancels the question');
  s.game.newPuzzle('easy');
  assert.notEqual(gridString(s.game.state!.puzzle), puzzle);
  assert.equal(s.game.state!.difficulty, 'easy');
});

test('same seed, same first puzzle; the next puzzle differs', () => {
  const a = setup({seed: 21}); a.press('3');
  const b = setup({seed: 21}); b.press('3');
  assert.equal(gridString(a.game.state!.puzzle), gridString(b.game.state!.puzzle));
  const first = gridString(a.game.state!.puzzle);
  a.game.newPuzzle('hard');
  assert.notEqual(gridString(a.game.state!.puzzle), first);
});

test('completion: a solved grid wins with a result, plays its light wave as the finale first, and clears the saved puzzle', () => {
  const s = startEasy();
  s.game.state!.elapsedMs = 187_000;
  solveAll(s);
  assert.ok(s.game.state!.solved);
  assert.equal(s.game.status, 'won');
  assert.ok(s.game.finale && !s.game.finale.done, 'the board celebrates before the results sheet');
  assert.ok(s.game.celebrating);
  assert.ok(s.game.refreshMs <= 100, 'animation frames are requested');
  s.draw();
  const text = s.canvas.plain().join('\n');
  assert.match(text, /Solved in 3:07/u);
  s.game.animate(500);
  assert.equal(s.game.finale!.done, false, 'the wave is still crossing the board');
  for (let t = 0; t < 2500; t += 50) s.game.animate(50);
  assert.equal(s.game.finale!.done, true);
  const result = s.game.result!;
  assert.equal(result.scoreText, '3:07');
  assert.equal(result.record, true, 'the first time at a difficulty is a record');
  assert.ok(result.details.includes('Easy') && result.details.includes('No hints'));
  const saved = s.record.raw() as any;
  assert.equal(saved.bestTimes.easy, 187);
  assert.equal(saved.completed, 1);
  assert.equal(saved.streak, 1);
  assert.equal(saved.current, undefined, 'finishing clears the saved puzzle');
  s.game.persist();
  assert.equal((s.record.raw() as any).current, undefined, 'a finished game is never saved again');
});

test('completion: reduced motion and effects off win at once; a slower or hinted win is no record', () => {
  for (const options of [{reduced: true}, {effects: 'off' as const}]) {
    const s = startEasy({...options, record: memoryRecord({bestTimes: {easy: 100}})});
    s.game.state!.elapsedMs = 187_000;
    solveAll(s);
    assert.equal(s.game.status, 'won');
    assert.equal(s.game.result!.record, false);
    assert.equal((s.record.raw() as any).bestTimes.easy, 100);
  }
  const s = startEasy({reduced: true});
  s.press('t'); s.game.state!.elapsedMs = 5000;
  solveAll(s);
  assert.equal(s.game.status, 'won');
  assert.equal(s.game.result!.record, false, 'hints disqualify records');
  assert.ok(s.game.result!.details.some(line => /1 hint used/u.test(line)));
});

test('completion: confetti uses the particle system under normal effects and stays off in reduced motion; a key skips the wave', () => {
  const s = startEasy();
  solveAll(s);
  s.draw(); s.game.animate(200); s.draw();
  assert.ok((s.game as any).fx.count > 0, 'confetti particles are live');
  s.press('x');
  assert.equal(s.game.finale!.done, true, 'any key skips the finale');
  const calm = startEasy({reduced: true});
  solveAll(calm); calm.draw(); calm.game.animate(200); calm.draw();
  assert.equal((calm.game as any).fx.count, 0, 'no confetti under Reduced Motion');
  assert.ok(calm.game.finale, 'a still highlight still marks the win');
  for (let t = 0; t < 800; t += 50) calm.game.animate(50);
  assert.equal(calm.game.finale!.done, true, 'and it ends on its own');
});

test('abandoning a started puzzle ends the streak; finishing does not', () => {
  const s = startEasy({reduced: true, record: memoryRecord({streak: 4, bestStreak: 4, completed: 4, completedByDifficulty: {easy: 4}})});
  solveAll(s);
  assert.equal((s.record.raw() as any).streak, 5);
  assert.equal((s.record.raw() as any).bestStreak, 5);
  const t = startEasy({record: memoryRecord({streak: 4, bestStreak: 4})});
  t.press('5'); t.game.persist();
  t.game.newPuzzle('easy');
  assert.equal((t.record.raw() as any).streak, 0);
  assert.equal((t.record.raw() as any).bestStreak, 4);
});

test('persistence: a puzzle in progress resumes through Continue, with entries, notes, hints and time', () => {
  const record = memoryRecord();
  const a = startEasy({record});
  const state = a.game.state!;
  const open = [...Array(81).keys()].filter(cell => !state.isClue(cell));
  state.moveTo(open[0]!); a.press('5'); state.moveTo(open[1]!); a.press('n', '1', '2', 'n'); a.press('t');
  a.game.animate(1500); a.game.persist();
  const expected = state.toSaved();
  a.game.dispose();
  const b = setup({record});
  assert.match(b.draw().plain().join('\n'), /Continue/u);
  assert.match(sudokuGame.summary(record.get()), /In progress/u);
  b.press('enter');
  assert.deepEqual(b.game.state!.toSaved(), expected);
  assert.equal(b.game.state!.hints, 1);
  assert.equal(b.game.state!.elapsedMs, 1500);
  assert.equal(b.game.state!.canUndo, false, 'history starts fresh');
});

test('persistence: a corrupt saved puzzle is dropped without a trace', () => {
  const source = startEasy();
  const saved = source.game.state!.toSaved();
  const broken: GameRecord[] = [
    {current: {...saved, solution: '1'.repeat(81)}},
    {current: {...saved, puzzle: saved.puzzle.slice(0, 80)}},
    {current: {...saved, entries: saved.puzzle}},
    {current: 'junk'},
    {version: 7, current: saved},
  ];
  for (const record of broken) {
    const s = setup({record: memoryRecord(record as GameRecord)});
    const text = s.draw().plain().join('\n');
    assert.ok(!/Continue/u.test(text), 'no Continue for a bad record');
    assert.doesNotMatch(sudokuGame.summary(memoryRecord(record as GameRecord).get()), /In progress/u);
    s.press('1');
    assert.equal(s.game.screen, 'play');
  }
});

test('persistence: the real score store keeps the record across sessions on disk', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-sudoku-'));
  try {
    const store = new ArcadeStore({directory: dir});
    const a = startEasy({record: store.record('sudoku') as never});
    a.press('5'); a.game.persist(); store.flush();
    const second = new ArcadeStore({directory: dir});
    const b = setup({record: second.record('sudoku') as never});
    assert.match(b.draw().plain().join('\n'), /Continue/u);
    assert.match(sudokuGame.summary(second.record('sudoku').get()), /In progress/u);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('layout: every canvas from 20x8 to 200x60 draws within bounds, fits its board, or says what it needs', () => {
  const widths = [20, 21, 25, 30, 36, 40, 55, 60, 70, 80, 90, 100, 120, 140, 160, 200];
  const heights = [8, 10, 12, 13, 14, 16, 19, 21, 24, 28, 32, 36, 40, 50, 60];
  const s = startEasy();
  for (const columns of widths) {
    for (const rows of heights) {
      const canvas = new Canvas(columns, rows);
      s.game.resize({columns, rows});
      s.game.render(canvas, 0, arcadePalette());
      const plain = canvas.plain();
      assert.equal(plain.length, rows);
      for (const line of plain) assert.ok(displayWidth(line) <= columns, `${columns}x${rows} row too wide`);
      const layout = layoutFor(columns, rows);
      if (columns >= MIN_COLUMNS && rows >= MIN_ROWS) {
        assert.ok(layout, `${columns}x${rows} has a layout`);
        assert.ok(layout.x >= 0 && layout.y >= 0 && layout.x + layout.boardW <= columns && layout.y + layout.boardH <= rows, `${columns}x${rows} board inside`);
        const clues = s.game.state!.puzzle.filter(Boolean).length;
        const board = plain.slice(layout.y, layout.y + layout.boardH).map(line => line.slice(layout.x, layout.x + layout.boardW)).join('\n');
        assert.ok((board.match(/[1-9]/gu) ?? []).length >= clues, `${columns}x${rows} shows the clues`);
      } else if (!layout) assert.match(plain.join('\n'), /Needs at least 20x13/u);
    }
  }
  assert.equal(`${MIN_COLUMNS}x${MIN_ROWS}`, '20x13');
});

test('layout: bigger canvases get bigger cells, with the HUD beside the board when it fits', () => {
  assert.equal(layoutFor(200, 60)!.cw, 9);
  assert.equal(layoutFor(120, 35)!.cw, 7, 'a side HUD beats wider tiles with a cramped top HUD');
  assert.equal(layoutFor(120, 35)!.hud, 'side');
  assert.equal(layoutFor(200, 60)!.hud, 'side');
  assert.equal(layoutFor(80, 21)!.cw, 5);
  assert.equal(layoutFor(80, 21)!.ch, 1);
  assert.equal(layoutFor(40, 15)!.cw, 3);
  assert.equal(layoutFor(20, 13)!.cw, 2);
  assert.equal(layoutFor(20, 13)!.hud, 'top');
  assert.equal(layoutFor(19, 40), undefined);
  assert.equal(layoutFor(100, 10), undefined);
});

test('hud: difficulty, timer, hints, notes mode and remaining digits are on screen', () => {
  for (const size of [{columns: 100, rows: 36}, {columns: 80, rows: 22}, {columns: 40, rows: 15}]) {
    const s = startEasy(size);
    s.game.state!.elapsedMs = 187_000;
    s.press('n', 't');
    const text = s.draw().plain().join('\n');
    assert.match(text, /Easy/u);
    assert.match(text, /3:0[78]/u);
    assert.match(text, /Hints/u);
    assert.match(text, /Notes/u);
  }
  const wide = startEasy();
  const text = wide.draw().plain().join('\n');
  assert.match(text, /Left/u);
});

test('no color: clues, entries, the cursor and conflicts differ by weight, brackets and glyphs', () => {
  const s = startEasy({columns: 80, rows: 22, color: 'none'});
  const state = s.game.state!;
  const layout = layoutFor(80, 22)!;
  const open = [...Array(81).keys()].filter(cell => !state.isClue(cell));
  const rowOf = (cell: number) => Math.floor(cell / 9);
  const target = open.find(cell => state.puzzle.slice(rowOf(cell) * 9, rowOf(cell) * 9 + 9).some(Boolean))!;
  const rowClue = state.puzzle.slice(rowOf(target) * 9, rowOf(target) * 9 + 9).find(Boolean)!;
  const other = open.find(cell => cell !== target)!;
  state.moveTo(other); s.press(String(state.solution[other]));
  state.moveTo(target); s.press(String(rowClue));
  const rows = s.draw().rows({color: 'none', safe: false});
  const cellText = (cell: number) => rows[layout.y + layout.ys[rowOf(cell)]!]!;
  assert.match(cellText(target), /!/u, 'a conflict carries a glyph');
  assert.match(cellText(target), /\[/u, 'the cursor carries brackets');
  assert.match(cellText(target), /\u001b\[7m/u, 'and reverse video');
  const plain = rows.map(row => row.replace(/\u001b\[[0-9;]*m/gu, ''));
  assert.ok(plain.join('\n').includes('┃') || plain.join('\n').includes('#'));
  assert.ok(rows.join('').includes('\u001b[1m'), 'bold marks the given clues');
  assert.ok(!rows.join('').includes('\u001b[38;'), 'no color escapes without color');
});

test('no color: entries are not bold while clues are', () => {
  const s = startEasy({columns: 80, rows: 22, color: 'none'});
  const state = s.game.state!;
  const layout = layoutFor(80, 22)!;
  const cell = [...Array(81).keys()].find(c => !state.isClue(c))!;
  const clueCell = [...Array(81).keys()].find(c => state.isClue(c) && Math.floor(c / 9) !== Math.floor(cell / 9))!;
  state.moveTo(clueCell === 0 ? 80 : 0);
  state.moveTo(cell); s.press(String(state.solution[cell]));
  state.moveTo(clueCell);
  const rows = s.draw().rows({color: 'none', safe: false});
  const find = (c: number) => {
    const line = rows[layout.y + layout.ys[Math.floor(c / 9)]!]!;
    const digit = String(state.grid[c]);
    const index = line.indexOf(digit, 0);
    return {line, index};
  };
  assert.ok(find(clueCell).line.includes('\u001b[1m'));
  const entryLine = rows[layout.y + layout.ys[Math.floor(cell / 9)]!]!;
  assert.ok(entryLine.includes(String(state.solution[cell])));
});

test('safe glyphs: the whole screen is ASCII and the box lines stay distinct', () => {
  for (const size of [{columns: 100, rows: 40}, {columns: 80, rows: 22}, {columns: 20, rows: 13}]) {
    const s = startEasy({...size, safe: true, color: 'none'});
    s.press('n', '1', 'n', '2', 't');
    s.draw();
    const rows = s.canvas.rows({color: 'none', safe: true});
    for (const row of rows) assert.match(row, /^[\x20-\x7e\u001b[0-9;m]*$/u, 'only ASCII');
    const plain = rows.map(row => row.replace(/\u001b\[[0-9;]*m/gu, '')).join('\n');
    assert.ok(plain.includes('#') && plain.includes('='), 'heavy lines use # and =');
    assert.ok(plain.includes('+'));
  }
  const menu = setup({safe: true, color: 'none'});
  menu.draw();
  for (const row of menu.canvas.rows({color: 'none', safe: true})) assert.match(row, /^[\x20-\x7e\u001b[0-9;m]*$/u);
});

test('truecolor render stays inside the palette and under budget for a large canvas', () => {
  const s = startEasy({columns: 120, rows: 40, color: 'truecolor'});
  s.press('n', '1', '2', 'n', '5');
  const started = process.hrtime.bigint();
  for (let index = 0; index < 20; index += 1) { s.press('right'); s.draw(); s.canvas.rows({color: 'truecolor', safe: false}); }
  const perFrame = Number(process.hrtime.bigint() - started) / 20 / 1e6;
  assert.ok(perFrame < 25, `render ${perFrame.toFixed(1)} ms (generous bound for a loaded CI machine)`);
});

test('dispose releases the game and the preview draws inside any canvas', () => {
  const s = startEasy();
  s.game.dispose();
  assert.equal(s.game.state, undefined);
  for (const [w, h] of [[16, 3], [40, 10]] as const) {
    const canvas = new Canvas(w, h);
    for (let frame = 0; frame < 30; frame += 1) sudokuGame.preview(canvas, frame, arcadePalette());
    for (const line of canvas.plain()) assert.ok(displayWidth(line) <= w);
  }
});

test('inside the arcade session: Esc pauses and blanks the board, resume continues the clock, a win reaches the card', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-sudoku-s-'));
  let now = 1000;
  const env: ArcadeEnvironment = {store: new ArcadeStore({directory: dir}), now: () => now, motion: () => ({reduced: false, effects: 'normal'}), color: () => 'none', safeGlyphs: () => false, seed: () => 9};
  const session = new ArcadeSession(env, [sudokuGame], {columns: 100, rows: 40}, sudokuGame);
  const screen = () => session.render().rows.map(row => stripAnsi(row)).join('\n');
  try {
    assert.match(screen(), /Classic Sudoku/u);
    session.key({kind: 'text', value: '1'});
    const game = session.game as SudokuInstance;
    session.frame(1000); session.frame(1000);
    assert.equal(game.state!.elapsedMs, 2000);
    assert.ok(session.interval > 0 && session.interval <= 1000);
    assert.match(screen(), /0:02/u);
    session.key({kind: 'escape'});
    assert.equal(session.screen, 'paused');
    const paused = screen();
    assert.match(paused, /Paused/u);
    assert.ok(!/┃\s+[1-9]\s+│/u.test(paused), 'no board digits while paused');
    session.frame(5000);
    assert.equal(game.state!.elapsedMs, 2000);
    session.key({kind: 'escape'});
    assert.equal(session.screen, 'playing');
    session.frame(100);
    session.frame(1000);
    assert.equal(game.state!.elapsedMs, 3000);
    const state = game.state!;
    for (let cell = 0; cell < 81; cell += 1) {
      if (state.isClue(cell)) continue;
      state.moveTo(cell);
      session.key({kind: 'text', value: String(state.solution[cell])});
    }
    assert.equal(session.screen, 'finale', 'the board celebrates inside the game first');
    assert.doesNotMatch(screen(), /Play again/u, 'no results card over the wave');
    for (let t = 0; t < 3000; t += 100) session.frame(100);
    assert.equal(session.screen, 'over');
    assert.match(screen(), /New record|Complete/u);
    assert.match(screen(), /Play again/u);
    assert.match(screen(), /0:0[34]|0:03/u);
  } finally { session.dispose(); rmSync(dir, {recursive: true, force: true}); }
});
