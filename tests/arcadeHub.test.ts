import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import type {Key} from '../src/terminal/keys.js';
import {ArcadeSession, hubTier, type ArcadeEnvironment} from '../src/arcade/ArcadeSession.js';
import {ArcadeStore} from '../src/arcade/scores.js';
import type {Canvas} from '../src/arcade/Canvas.js';
import type {GameCategory, GameDefinition, GameInstance, GameKeyResult, GameStatus, Finale} from '../src/arcade/types.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {presentationClock} from '../src/motion/PresentationClock.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

interface Probe { keys: string[]; finale?: {left: number} }

function game(id: string, category: GameCategory, probe: Probe, options: {typing?: boolean; finaleMs?: number; score?: number; daily?: 'open' | 'done'} = {}): GameDefinition {
  return {
    id, aliases: [], title: `Game ${id}`, tagline: `${id} tagline`, description: `About ${id}.`, kind: 'action', category,
    controls: [{keys: 'Space', action: 'go'}], howToPlay: [`Play ${id} well.`],
    summary: () => 'Not played yet',
    ...(options.daily ? {daily: () => options.daily!} : {}),
    preview: (canvas: Canvas, frame: number) => canvas.text(0, 0, `preview ${id} ${frame}`),
    create: () => {
      let status: GameStatus = 'playing';
      let finale: (Finale & {left: number}) | undefined;
      const instance: GameInstance = {
        get status() { return status; },
        get result() { return status === 'won' ? {score: options.score ?? 1240, scoreText: (options.score ?? 1240).toLocaleString('en-US'), record: true, details: ['Well played']} : undefined; },
        get finale() { return finale; },
        typing: options.typing,
        stepsPerSecond: 0, refreshMs: 0,
        step() {},
        animate(dt) { if (finale) finale.left = Math.max(0, finale.left - dt); },
        key(key: Key): GameKeyResult {
          probe.keys.push(key.kind === 'text' ? key.value : key.kind);
          if (key.kind === 'text' && key.value === 'w') {
            status = 'won';
            if (options.finaleMs) finale = {left: options.finaleMs, get done() { return this.left <= 0; }, skip() { this.left = 0; }};
          }
          return 'handled';
        },
        render(canvas: Canvas) { canvas.clear(); canvas.text(0, 0, `playing ${id}`); },
        resize() {}, pause() {}, hints: () => [{keys: 'Space', action: 'go'}], persist() {}, dispose() {},
      };
      return instance;
    },
  };
}

const categories: GameCategory[] = ['runners', 'runners', 'arcade', 'arcade', 'reflex', 'physics', 'falling', 'logic', 'logic', 'words'];

function hub(options: {columns?: number; rows?: number; reduced?: boolean; dir?: string; games?: GameDefinition[]} = {}) {
  const dir = options.dir ?? mkdtempSync(join(process.env.NMSH_TEST_TMPDIR ?? process.env.TMPDIR ?? '.', 'arcade-hub-'));
  const probe: Probe = {keys: []};
  let now = 10_000;
  const store = new ArcadeStore({directory: dir});
  const env: ArcadeEnvironment = {store, now: () => now, motion: () => ({reduced: options.reduced ?? false, effects: 'normal'}), color: () => 'none', safeGlyphs: () => false, seed: () => 3, today: () => '2026-10-21'};
  const games = options.games ?? categories.map((category, index) => game(`g${index}`, category, probe));
  const session = new ArcadeSession(env, games, {columns: options.columns ?? 120, rows: options.rows ?? 36});
  const press = (value: string) => session.key(value.length === 1 ? {kind: 'text', value} : {kind: value} as Key);
  const screen = () => session.render().rows.map(row => stripAnsi(row));
  return {session, games, probe, press, screen, store, dir, advance: (ms: number) => { now += ms; }, done: () => { session.dispose(); if (!options.dir) rmSync(dir, {recursive: true, force: true}); }};
}

test('hub: the library is grouped by category with headers, and the highlighted game opens its own preview and details', () => {
  const h = hub();
  try {
    const rows = h.screen().join('\n');
    for (const header of ['RUNNERS AND PLATFORMERS', 'ARCADE CLASSICS', 'LOGIC AND BOARD PUZZLES', 'WORDS AND TYPING']) assert.match(rows, new RegExp(header, 'u'));
    assert.match(rows, /Vespyr Arcade/u);
    assert.match(rows, /10 games · offline/u);
    assert.match(rows, /preview g0/u, 'only the highlighted game draws a preview');
    assert.doesNotMatch(rows, /preview g1/u);
    assert.match(rows, /About g0\./u);
    h.press('down');
    assert.match(h.screen().join('\n'), /preview g1/u);
    assert.equal(h.session.selected, 1);
  } finally { h.done(); }
});

test('hub: favorites and recently played come first, persist, and keep the same game highlighted', () => {
  const dir = mkdtempSync(join(process.env.NMSH_TEST_TMPDIR ?? process.env.TMPDIR ?? '.', 'arcade-hub-'));
  try {
    const h = hub({dir});
    h.press('down'); h.press('down'); h.press('down'); // g3
    h.press('f');
    assert.equal(h.session.selected, 3, 'still on g3 after favoriting');
    assert.match(h.screen()[2] ?? '', /Game g3/u, 'Favorites is the first section');
    assert.match(h.screen().join('\n'), /★/u);
    h.press('enter');
    assert.equal(h.session.definition?.id, 'g3');
    h.press('escape'); h.press('b');
    assert.equal(h.session.screen, 'hub');
    assert.equal(h.session.selected, 3, 'back on the game just played');
    h.done();
    const again = hub({dir});
    const rows = again.screen().join('\n');
    assert.match(rows, /FAVORITES/u);
    assert.match(rows, /RECENTLY PLAYED/u);
    assert.equal(again.session.selected, 3, 'reopening selects the game last played');
    again.done();
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('hub: / searches titles, ids and categories; Esc clears, then closes the field; Tab jumps between groups', () => {
  const h = hub();
  try {
    h.press('/');
    for (const char of 'logic') h.press(char);
    const rows = h.screen().join('\n');
    assert.match(rows, /2 MATCHING/u);
    assert.match(rows, /Game g7/u);
    assert.doesNotMatch(rows, /Game g0/u);
    h.press('enter');
    assert.equal(h.session.definition?.id, 'g7', 'Enter plays the first match');
    h.press('escape'); h.press('b');
    h.press('/'); h.press('z'); h.press('z'); h.press('z');
    assert.match(h.screen().join('\n'), /NO GAME MATCHES/u);
    h.press('escape');
    assert.doesNotMatch(h.screen().join('\n'), /NO GAME MATCHES/u, 'Esc clears the query');
    h.press('escape');
    assert.equal(h.press('q'), 'close', 'with the field closed, q closes the arcade again');
    const fresh = hub();
    fresh.press('complete');
    assert.equal(fresh.session.selected, 2, 'Tab: first game of the next group');
    fresh.press('focusPrevious');
    assert.equal(fresh.session.selected, 0);
    fresh.done();
  } finally { h.done(); }
});

test('hub: the mouse selects a row, a second click plays it, the wheel moves the selection', () => {
  const h = hub();
  try {
    const rows = h.screen();
    const y = rows.findIndex(row => /Game g2/u.test(row));
    assert.ok(y > 0);
    h.session.key({kind: 'mouseClick', x: 4, y: y + 1} as Key);
    assert.equal(h.session.selected, 2);
    h.session.key({kind: 'wheelDown'} as Key);
    assert.equal(h.session.selected, 3);
    h.session.key({kind: 'wheelUp'} as Key);
    h.session.key({kind: 'mouseClick', x: 4, y: y + 1} as Key);
    assert.equal(h.session.definition?.id, 'g2');
  } finally { h.done(); }
});

test('hub: the selection stays visible while scrolling a long library', () => {
  const probe: Probe = {keys: []};
  const games = Array.from({length: 33}, (_, index) => game(`n${index}`, (['runners', 'arcade', 'reflex', 'physics', 'falling', 'logic', 'words'] as const)[index % 7], probe));
  const h = hub({games, rows: 20, columns: 100});
  try {
    for (let step = 0; step < 33; step += 1) {
      const title = games[h.session.selected]!.title;
      const rows = h.screen();
      const listed = rows.slice(1, -1).some(row => row.includes(title));
      assert.ok(listed, `${title} visible at step ${step}`);
      h.press('down');
    }
  } finally { h.done(); }
});

test('hub: every tier fills the whole viewport exactly and never overflows a row', () => {
  for (const [columns, rows] of [[30, 10], [50, 14], [70, 24], [90, 24], [120, 36], [200, 60]] as const) {
    const h = hub({columns, rows});
    try {
      const frame = h.session.render().rows;
      assert.equal(frame.length, rows, `${columns}x${rows}: one row per terminal row`);
      for (const row of frame) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}x${rows}: ${stripAnsi(row)}`);
      h.press('enter');
      const stage = h.session.render().rows;
      assert.equal(stage.length, rows, `${columns}x${rows}: the Stage fills the viewport`);
      assert.ok(stage.every(row => displayWidth(stripAnsi(row)) <= columns));
    } finally { h.done(); }
  }
  assert.equal(hubTier(30, 10), 'tiny');
  assert.equal(hubTier(60, 24), 'narrow');
  assert.equal(hubTier(90, 30), 'standard');
  assert.equal(hubTier(140, 40), 'wide');
});

test('hub: a narrow terminal shows one game at a time and ←→ changes it', () => {
  const h = hub({columns: 60, rows: 24});
  try {
    const rows = h.screen().join('\n');
    assert.match(rows, /‹ 1 \/ 10 ›/u);
    assert.match(rows, /Game g0/u);
    assert.doesNotMatch(rows, /Game g1/u);
    h.press('right');
    assert.match(h.screen().join('\n'), /‹ 2 \/ 10 ›/u);
  } finally { h.done(); }
});

test('hub: daily status shows in the list; Reduced Motion keeps one still preview and asks for no frames', () => {
  const probe: Probe = {keys: []};
  const h = hub({reduced: true, games: [game('d', 'words', probe, {daily: 'open'}), game('e', 'words', probe, {daily: 'done'})]});
  try {
    const rows = h.screen().join('\n');
    assert.match(rows, /◷ daily/u);
    assert.match(rows, /✓ daily/u);
    assert.equal(h.session.interval, 0);
    h.session.frame(5000);
    assert.equal(h.screen().join('\n'), rows, 'nothing moves');
  } finally { h.done(); }
});

test('stage: a finale plays before the results; any key skips it; the score counts up and ends exact', () => {
  const probe: Probe = {keys: []};
  const h = hub({games: [game('fin', 'logic', probe, {finaleMs: 1500, score: 4321})]});
  try {
    h.press('enter');
    h.press('w');
    assert.equal(h.session.screen, 'finale', 'the game celebrates first');
    h.session.frame(500);
    assert.equal(h.session.screen, 'finale');
    assert.doesNotMatch(h.screen().join('\n'), /New record/u, 'no results card over the celebration');
    h.press('x');
    assert.equal(h.session.screen, 'over');
    h.session.frame(100);
    const mid = h.screen().join('\n');
    assert.match(mid, /New record/u);
    h.session.frame(2000);
    assert.match(h.screen().join('\n'), /4,321/u);
  } finally { h.done(); }
});

test('stage: a typing game receives p and every printable key; only Esc pauses it; How to play is in the pause sheet', () => {
  const probe: Probe = {keys: []};
  const h = hub({games: [game('typer', 'words', probe, {typing: true})]});
  try {
    h.press('enter');
    for (const char of 'pq ') h.press(char);
    assert.deepEqual(probe.keys, ['p', 'q', ' ']);
    assert.equal(h.session.screen, 'playing');
    h.press('escape');
    assert.equal(h.session.screen, 'paused');
    h.press('h');
    assert.match(h.screen().join('\n'), /Play typer well\./u);
    h.press('enter');
    assert.equal(h.session.screen, 'paused', 'any key returns to the pause menu');
    h.press('escape');
    assert.equal(h.session.screen, 'playing');
  } finally { h.done(); }
});

// ---- viewport ownership in the app ------------------------------------------------------------------------------

test('app: the Arcade takes the whole viewport with no NMSh chrome, never resizes the PTY, and leaves no clock behind', async () => {
  const frame = executionFrameFixture(100, 30);
  const app = frame.app;
  app['shellId'] = 'zsh';
  let painted: string[] = [];
  const write = app['renderer'].render.bind(app['renderer']);
  app['renderer'].render = (value: {rows: string[]}) => { painted = value.rows; write(value as never); };
  const subscribers = presentationClock.subscriberCount;
  try {
    app['render']();
    const before = painted.map(row => stripAnsi(row));
    const sizes = frame.session.sizes.length;
    await app['runSlash']('/games', {kind: 'arcade'});
    app['arcade'].handoff = undefined;
    app['render']();
    const rows = painted.map(row => stripAnsi(row));
    assert.equal(rows.length, 30, 'one row per terminal row');
    assert.match(rows[0] ?? '', /Vespyr Arcade/u, 'the Arcade starts at the very top');
    assert.ok(rows.at(-1)!.includes('play'), 'its own controls on the last row, not the composer');
    for (const row of before.filter(line => line.trim())) assert.ok(!rows.includes(row) || /Vespyr/u.test(row), `no NMSh row left around the Arcade: ${row}`);
    app['handleKey']({kind: 'enter'});
    app['render']();
    assert.equal(frame.session.sizes.length, sizes, 'the shell never sees a resize');
    for (let index = 0; index < 6 && app['arcade']; index += 1) app['handleKey']({kind: 'escape'});
    assert.equal(app['arcade'], undefined);
    app['arcadeClosing'] = undefined;
    app['render']();
    assert.ok(painted.length > 0);
    assert.doesNotMatch(painted.map(row => stripAnsi(row)).join('\n'), /Vespyr Arcade/u, 'the ordinary frame is back');
    assert.equal(presentationClock.subscriberCount <= subscribers, true, 'no clock subscription left');
  } finally { frame.dispose(); }
});

test('app: any key finishes the handoff, and that key still reaches the Arcade', async () => {
  const frame = executionFrameFixture(100, 30);
  const app = frame.app;
  try {
    await app['runSlash']('/games', {kind: 'arcade'});
    app['arcade'].handoff = {direction: 'in', started: performance.now(), under: Array.from({length: 30}, () => 'nmsh')};
    app['handleKey']({kind: 'down'});
    assert.equal(app['arcade'].handoff, undefined);
    assert.equal(app['arcade'].session.selected, 1);
  } finally { frame.dispose(); }
});
