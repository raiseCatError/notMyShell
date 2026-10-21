import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import type {Key} from '../src/terminal/keys.js';
import {ArcadeSession, type ArcadeCompanion, type ArcadeEnvironment} from '../src/arcade/ArcadeSession.js';
import {ARCADE_GAMES} from '../src/arcade/registry.js';
import {ArcadeStore} from '../src/arcade/scores.js';
import {BackgroundActivity} from '../src/notifications/backgroundActivity.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

/** The Arcade session with a companion over the real 33-game registry: layout, toast placement, log, pointer rows. */
function setup(columns: number, rows: number, options: {color?: 'none' | 'truecolor'; safe?: boolean; reduced?: boolean; running?: boolean} = {}) {
  const dir = mkdtempSync(join(process.env.NMSH_TEST_TMPDIR ?? process.env.TMPDIR ?? '.', 'arcade-companion-'));
  let now = 5_000_000;
  const activity = new BackgroundActivity(() => now);
  const env: ArcadeEnvironment = {store: new ArcadeStore({directory: dir}), now: () => now,
    motion: () => ({reduced: options.reduced ?? false, effects: 'normal'}), color: () => options.color ?? 'none', safeGlyphs: () => options.safe ?? false, seed: () => 7, today: () => '2026-10-21'};
  const companion: ArcadeCompanion = {
    view: () => activity.view(now, !(options.reduced ?? false)),
    history: () => activity.history(),
    markRead: () => activity.markRead(),
    running: () => options.running === false ? undefined : {label: 'npm run build', elapsedMs: 12_000},
  };
  const session = new ArcadeSession(env, ARCADE_GAMES, {columns, rows}, undefined, companion);
  const press = (value: string) => session.key(value.length === 1 ? {kind: 'text', value} : {kind: value} as Key);
  const screen = () => session.render().rows.map(row => stripAnsi(row));
  const finish = (command: string, exitCode = 0, elapsedMs = 42_000) => {
    activity.push({kind: 'command', key: `${command}:${now}`, command, elapsedMs, exitCode, interrupted: false});
    now += 400;
  };
  return {session, activity, press, screen, finish, advance: (ms: number) => { now += ms; }, done: () => { session.dispose(); rmSync(dir, {recursive: true, force: true}); }};
}

const SIZES: Array<[number, number]> = [[160, 50], [120, 36], [100, 30], [80, 24], [60, 20], [40, 14]];

test('strip: one reserved row at every size from 160x50 down to 40x14; the toast sits at the right edge and every row fits', () => {
  for (const [columns, rows] of SIZES) {
    const t = setup(columns, rows);
    try {
      assert.equal(t.screen().length, rows, `${columns}x${rows}: one row per terminal row`);
      assert.match(t.screen()[0]!, /npm run build running · 12\.0s/u, `${columns}x${rows}: running label`);
      assert.match(t.screen()[1]!, /Vespyr Arcade|Arcade/u, `${columns}x${rows}: the hub starts below the strip`);
      t.finish('npm test');
      const row = t.screen()[0]!;
      assert.match(row, /✓/u);
      assert.ok(displayWidth(row) <= columns, `${columns}x${rows}: strip fits`);
      assert.ok(row.trimEnd().length >= columns - 2, `${columns}x${rows}: right aligned`);
      for (const [index, line] of t.screen().entries()) assert.ok(displayWidth(line) <= columns, `${columns}x${rows}: row ${index} fits`);
    } finally { t.done(); }
  }
});

test('strip: the toast slides in from the right, holds, leaves, and nothing stale is left in the row', () => {
  const t = setup(100, 30);
  try {
    t.finish('make');
    t.advance(-400);
    const arriving = t.screen()[0]!;
    t.advance(300);
    const steady = t.screen()[0]!;
    assert.ok(steady.includes('✓ make finished'), 'fully shown once settled');
    assert.ok(arriving.trimEnd().length >= steady.trimEnd().length, 'it starts further right than where it settles');
    t.advance(3_300);
    const leaving = t.screen()[0]!;
    assert.ok(leaving.trimEnd().length >= steady.trimEnd().length - 1);
    t.advance(400);
    const gone = t.screen()[0]!;
    assert.doesNotMatch(gone, /finished|✓/u);
    assert.match(gone, /npm run build running/u);
  } finally { t.done(); }
});

test('strip: Reduced Motion shows the toast in place from the first frame, and asks for no animation frames', () => {
  const t = setup(100, 30, {reduced: true});
  try {
    t.finish('make');
    t.advance(-400);
    assert.match(t.screen()[0]!, /✓ make finished/u);
    assert.equal(t.session.interval, 0, 'no frames requested for a toast');
  } finally { t.done(); }
  const moving = setup(100, 30);
  try {
    moving.finish('make');
    moving.advance(-400);
    assert.ok(moving.session.interval > 0 && moving.session.interval <= 40, 'a sliding toast asks for frames');
    moving.advance(500);
    assert.equal(moving.session.interval, 100, 'and stops asking once it is steady (the hub preview rate)');
  } finally { moving.done(); }
});

test('strip: Safe Glyphs and NO_COLOR carry the meaning in words and glyphs, with no color escape', () => {
  const t = setup(100, 30, {safe: true, color: 'none'});
  try {
    t.finish('make', 2, 3_000);
    t.advance(300);
    const raw = t.session.render().rows[0]!;
    assert.doesNotMatch(raw, /\u001b\[[0-9;]*[34]8;/u, 'no color escape without color');
    assert.match(stripAnsi(raw), /x make failed . exit 2/u);
  } finally { t.done(); }
  const colored = setup(100, 30, {color: 'truecolor'});
  try {
    colored.finish('make', 2, 3_000);
    colored.advance(300);
    const raw = colored.session.render().rows[0]!;
    assert.match(raw, /\u001b\[/u);
    assert.match(stripAnsi(raw), /✕ make failed · exit 2/u, 'the failure is a glyph and words, not just a color');
  } finally { colored.done(); }
});

test('strip: an attention state outlives the toast and uses its own glyph and words', () => {
  const t = setup(100, 30);
  try {
    t.activity.push({kind: 'attention', key: 'a', state: 'approval'});
    t.advance(60_000);
    assert.match(t.screen()[0]!, /◷ Queue waiting for approval/u);
    t.activity.push({kind: 'cleared', state: 'approval'});
    assert.doesNotMatch(t.screen()[0]!, /approval/u);
  } finally { t.done(); }
});

test('small terminals keep every row for the Arcade and show a compact marker instead', () => {
  for (const [columns, rows] of [[39, 20], [60, 13], [30, 10]] as const) {
    const t = setup(columns, rows);
    try {
      t.finish('make', 1, 2_000);
      const screen = t.screen();
      assert.equal(screen.length, rows);
      assert.doesNotMatch(screen[0]!, /running/u, `${columns}x${rows}: no strip`);
      assert.match(screen.join('\n'), /✕ 1/u, `${columns}x${rows}: the marker shows a failure and one unread`);
      for (const line of screen) assert.ok(displayWidth(line) <= columns);
    } finally { t.done(); }
  }
});

test('a game keeps its size when a toast appears: only the strip row changes', () => {
  const t = setup(100, 30);
  try {
    t.press('enter');
    const before = t.screen();
    t.finish('make');
    t.advance(300);
    const after = t.screen();
    assert.deepEqual(after.slice(1), before.slice(1));
    assert.notEqual(after[0], before[0]);
  } finally { t.done(); }
});

test('pointer rows shift by the strip: a click on the strip does nothing, a click on a row below it selects that row', () => {
  const t = setup(120, 36);
  try {
    const selected = t.session.selected;
    t.session.key({kind: 'mouseClick', x: 5, y: 1} as Key);
    assert.equal(t.session.selected, selected, 'the strip is not clickable');
    assert.equal(t.session.screen, 'hub');
    // Find a game row on screen and click it by its terminal row (1-based).
    const rows = t.screen();
    const target = rows.findIndex((row, index) => index > 2 && /Vespyr Queens|Classic Sudoku/u.test(row.slice(0, 40)));
    assert.ok(target > 0, 'a game row is on screen');
    t.session.key({kind: 'mouseClick', x: 5, y: target + 1} as Key);
    assert.match(t.screen().join('\n'), /Vespyr Queens|Classic Sudoku/u);
    assert.notEqual(t.session.selected, selected);
  } finally { t.done(); }
});

test('notifications log: n in the hub and Notifications in the pause sheet show newest first, any key returns, and unread clears', () => {
  const t = setup(100, 30);
  try {
    t.finish('npm test', 1, 3_000);
    t.finish('npm run build', 0, 42_000);
    assert.equal(t.activity.unread, 2);
    assert.match(t.screen()[0]!, /✕ 2 commands finished · 1 failed/u);
    t.press('n');
    const log = t.screen().join('\n');
    assert.match(log, /Notifications/u);
    assert.ok(log.indexOf('npm run build finished') < log.indexOf('npm test failed'), 'newest first');
    assert.match(log, /leave the Arcade to read it/u, 'it says where the output is');
    assert.equal(t.activity.unread, 0);
    t.press('x');
    assert.equal(t.session.screen, 'hub');
    // From a paused game.
    t.press('enter'); t.press(' ');
    t.press('escape');
    assert.equal(t.session.screen, 'paused');
    assert.match(t.screen().join('\n'), /Notifications/u, 'the pause sheet offers it');
    t.press('n');
    assert.match(t.screen().join('\n'), /npm test failed/u);
    t.press('enter');
    assert.equal(t.session.screen, 'paused', 'back to the pause sheet, the game still paused');
    t.press('escape');
    assert.equal(t.session.screen, 'playing');
  } finally { t.done(); }
});

test('an empty log says so without inventing anything', () => {
  const t = setup(100, 30);
  try {
    t.press('n');
    assert.match(t.screen().join('\n'), /Nothing yet/u);
  } finally { t.done(); }
});

test('without a companion nothing changes: no strip, no log key, no pause entry', () => {
  const dir = mkdtempSync(join(process.env.NMSH_TEST_TMPDIR ?? process.env.TMPDIR ?? '.', 'arcade-bare-'));
  try {
    const env: ArcadeEnvironment = {store: new ArcadeStore({directory: dir}), now: () => 1, motion: () => ({reduced: false, effects: 'normal'}), color: () => 'none', safeGlyphs: () => false, seed: () => 1};
    const session = new ArcadeSession(env, ARCADE_GAMES, {columns: 100, rows: 30});
    assert.match(stripAnsi(session.render().rows[0]!), /Vespyr Arcade/u);
    session.key({kind: 'text', value: 'n'});
    assert.equal(session.screen, 'hub');
    session.key({kind: 'enter'}); session.key({kind: 'text', value: ' '}); session.key({kind: 'escape'});
    assert.doesNotMatch(session.render().rows.map(row => stripAnsi(row)).join('\n'), /Notifications/u);
    session.dispose();
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('attaching a companion mid-game re-lays the game out without restarting it', () => {
  const dir = mkdtempSync(join(process.env.NMSH_TEST_TMPDIR ?? process.env.TMPDIR ?? '.', 'arcade-late-'));
  try {
    const env: ArcadeEnvironment = {store: new ArcadeStore({directory: dir}), now: () => 1, motion: () => ({reduced: false, effects: 'normal'}), color: () => 'none', safeGlyphs: () => false, seed: () => 1};
    const session = new ArcadeSession(env, ARCADE_GAMES, {columns: 100, rows: 30});
    session.key({kind: 'enter'});
    const game = session.game;
    assert.ok(game);
    const activity = new BackgroundActivity(() => 1);
    session.setCompanion({view: () => activity.view(1), history: () => activity.history(), markRead: () => activity.markRead(), running: () => ({label: 'make', elapsedMs: 0})});
    assert.equal(session.game, game, 'the same game instance');
    const rows = session.render().rows.map(row => stripAnsi(row));
    assert.equal(rows.length, 30);
    assert.match(rows[0]!, /make running/u);
    session.dispose();
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
