import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import type {Key} from '../src/terminal/keys.js';
import {ArcadeSession, type ActivityRow, type ArcadeCompanion, type ArcadeEnvironment} from '../src/arcade/ArcadeSession.js';
import {ARCADE_GAMES} from '../src/arcade/registry.js';
import {ArcadeStore} from '../src/arcade/scores.js';
import {BackgroundActivity} from '../src/notifications/backgroundActivity.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

/** The Arcade session with a companion over the real 33-game registry: layout, toast placement, log, pointer rows. */
function setup(columns: number, rows: number, options: {color?: 'none' | 'truecolor'; safe?: boolean; reduced?: boolean; running?: boolean; rows?: ActivityRow[]} = {}) {
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
    activities: () => options.rows ?? (options.running === false ? [] : [{id: 'run', label: 'npm run build', status: 'running' as const, detail: '12.0s'}]),
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

const SIZES: Array<[number, number]> = [[160, 50], [120, 36], [100, 30], [80, 24], [70, 20]];
const top = (rows: string[], count = 4) => rows.slice(0, count).join('\n');
const rowsOf = (count: number, status: ActivityRow['status'] = 'running'): ActivityRow[] => Array.from({length: count}, (_, index) => ({id: `a${index}`, label: `task${index}`, status, detail: `${index}s`}));

test('header: a two-row header from the start at every size down to 70x20; banner right, activities left, every row fits', () => {
  for (const [columns, rows] of SIZES) {
    const t = setup(columns, rows);
    try {
      const before = t.screen();
      assert.equal(before.length, rows, `${columns}x${rows}: one row per terminal row`);
      assert.match(before[0]!, /◷ npm run build\s+12\.0s/u, `${columns}x${rows}: activity at the top-left`);
      t.finish('npm test');
      t.advance(300);
      const after = t.screen();
      assert.match(after[0]!, /▎ ✓ Command completed/u, `${columns}x${rows}: title with the accent bar`);
      assert.match(after[1]!, /npm test · 42\.0s · exit 0/u, `${columns}x${rows}: detail line`);
      assert.deepEqual(after.slice(2), before.slice(2), `${columns}x${rows}: the playfield is untouched by the banner`);
      const bar = after[0]!.indexOf('▎');
      assert.ok(bar > columns / 2 - 4, `${columns}x${rows}: the banner is on the right`);
      assert.ok(after[0]!.slice(0, bar).trimEnd().length < bar - 2 || !/\S/u.test(after[0]!.slice(bar - 2, bar)), `${columns}x${rows}: no overlap with the list`);
      for (const [index, line] of after.entries()) assert.ok(displayWidth(line) <= columns, `${columns}x${rows}: row ${index} fits`);
    } finally { t.done(); }
  }
});

test('header: up to three activities, then a "+N more" line; the header grows once and never shrinks', () => {
  const t = setup(120, 36, {rows: rowsOf(2)});
  try {
    const small = t.screen();
    assert.match(top(small), /task0[\s\S]*task1/u);
    assert.doesNotMatch(top(small), /more/u);
    assert.match(small[2]!, /Vespyr Arcade/u, 'two header rows');
    const options = (t.session as unknown as {companion: {activities: () => ActivityRow[]}}).companion;
    options.activities = () => rowsOf(3);
    assert.match(top(t.screen()), /task0[\s\S]*task1[\s\S]*task2/u);
    options.activities = () => rowsOf(7);
    const many = t.screen();
    assert.match(top(many), /task0[\s\S]*task1[\s\S]*task2/u);
    assert.match(many[3]!, /\+ 4 more activities/u);
    assert.doesNotMatch(top(many), /task3/u);
    assert.match(many[4]!, /Vespyr Arcade/u, 'four header rows');
    options.activities = () => rowsOf(1);
    assert.match(t.screen()[4]!, /Vespyr Arcade/u, 'it does not shrink when activity ends: the playfield stays put');
  } finally { t.done(); }
});

test('header: settled work is tinted, readable without color, and statuses use their own words', () => {
  const rows: ActivityRow[] = [
    {id: '1', label: 'npm run build', status: 'done', detail: 'completed'}, {id: '2', label: 'npm test', status: 'failed', detail: 'exit 1'},
    {id: '3', label: 'Queue · 2 waiting', status: 'waiting', detail: 'approval needed'}, {id: '4', label: 'track df', status: 'tracking', detail: 'next 4.0s'}];
  const t = setup(120, 36, {rows, color: 'none'});
  try {
    const text = top(t.screen());
    assert.match(text, /✓ npm run build\s+completed/u);
    assert.match(text, /✕ npm test\s+exit 1/u);
    assert.match(text, /≡ Queue · 2 waiting\s+approval needed/u);
    assert.match(text, /\+ 1 more activity/u);
  } finally { t.done(); }
  const safe = setup(120, 36, {rows: rows.slice(0, 3), safe: true, color: 'none'});
  try {
    const text = top(safe.screen());
    assert.match(text, /\+ npm run build\s+completed/u);
    assert.match(text, /x npm test\s+exit 1/u);
    assert.match(text, /\? Queue [·.] 2 waiting\s+approval needed/u);
  } finally { safe.done(); }
});

test('banner: slides in from the right, then stays; nothing expires and a steady banner asks for no frames', () => {
  const t = setup(100, 30);
  try {
    t.finish('make');
    t.advance(-400);
    const arriving = t.screen()[0]!;
    assert.ok(t.session.interval > 0 && t.session.interval <= 40, 'a sliding banner asks for frames');
    t.advance(300);
    const steady = t.screen()[0]!;
    assert.ok(steady.includes('▎ ✓ Command completed'));
    assert.ok(arriving.indexOf('▎') > steady.indexOf('▎') || !arriving.includes('▎'), 'it starts further right');
    assert.equal(t.session.interval, 100, 'only the hub preview rate once steady');
    t.advance(10 * 60_000);
    assert.equal(t.screen()[0]!, steady, 'ten minutes later: identical, no pulsing');
  } finally { t.done(); }
});

test('banner: Reduced Motion is in place from the first frame and asks for no animation', () => {
  const t = setup(100, 30, {reduced: true});
  try {
    t.finish('make');
    t.advance(-400);
    assert.match(t.screen()[0]!, /▎ ✓ Command completed/u);
    assert.equal(t.session.interval, 0);
  } finally { t.done(); }
});

test('banner: Safe Glyphs and NO_COLOR keep the words, glyph and bar, with no color escape', () => {
  const t = setup(100, 30, {safe: true, color: 'none'});
  try {
    t.finish('make', 2, 3_000);
    t.advance(300);
    const raw = t.session.render().rows.slice(0, 2).join('\n');
    assert.doesNotMatch(raw, /\u001b\[[0-9;]*[34]8;/u);
    assert.match(stripAnsi(raw), /\| x Command failed[\s\S]*make . 3\.0s . exit 2/u);
  } finally { t.done(); }
  const colored = setup(100, 30, {color: 'truecolor'});
  try {
    colored.finish('make', 2, 3_000);
    colored.advance(300);
    const raw = colored.session.render().rows[0]!;
    assert.match(raw, /\u001b\[/u);
    assert.match(stripAnsi(raw), /▎ ✕ Command failed/u, 'a failure is a glyph and words, not just a color');
  } finally { colored.done(); }
});

test('banner: an attention state shows its own title; the list says the same in words', () => {
  const t = setup(100, 30, {rows: [{id: 'q', label: 'Queue · 1 waiting', status: 'waiting', detail: 'approval needed'}]});
  try {
    t.activity.push({kind: 'attention', key: 'a', state: 'approval'});
    t.advance(60_000);
    assert.match(top(t.screen()), /◷ Queue waiting[\s\S]*approval needed/u);
    t.activity.push({kind: 'cleared', state: 'approval'});
    assert.doesNotMatch(top(t.screen()), /◷ Queue waiting/u);
  } finally { t.done(); }
});

test('small terminals: one row of header at most, a one-line banner, then only a compact marker below 40x14', () => {
  const narrow = setup(60, 20);
  try {
    narrow.finish('make', 1, 2_000);
    const screen = narrow.screen();
    assert.match(screen[0]!, /◷ npm run build/u);
    assert.match(screen[0]!, /✕ make failed/u, 'the same news on one line');
    assert.match(screen[1]!, /Vespyr Arcade/u);
  } finally { narrow.done(); }
  for (const [columns, rows] of [[39, 20], [60, 13], [30, 10]] as const) {
    const t = setup(columns, rows);
    try {
      t.finish('make', 1, 2_000);
      const screen = t.screen();
      assert.equal(screen.length, rows);
      assert.match(screen.join('\n'), /✕ 1/u, `${columns}x${rows}: the marker shows a failure and one unread`);
      for (const line of screen) assert.ok(displayWidth(line) <= columns);
    } finally { t.done(); }
  }
});

test('a game keeps its size when a banner appears: only the header changes', () => {
  const t = setup(100, 30);
  try {
    t.press('enter');
    const before = t.screen();
    t.finish('make');
    t.advance(300);
    const after = t.screen();
    assert.deepEqual(after.slice(2), before.slice(2));
    assert.notEqual(top(after, 2), top(before, 2));
  } finally { t.done(); }
});

test('pointer rows shift by the header: a click on it does nothing, a click on a row below selects that row', () => {
  const t = setup(120, 36);
  try {
    const selected = t.session.selected;
    t.session.key({kind: 'mouseClick', x: 5, y: 2} as Key);
    assert.equal(t.session.selected, selected, 'the header is not clickable');
    const rows = t.screen();
    const target = rows.findIndex((row, index) => index > 3 && /Vespyr Dash/u.test(row.slice(0, 40)));
    assert.ok(target > 0, 'a game row is on screen');
    t.session.key({kind: 'mouseClick', x: 5, y: target + 1} as Key);
    assert.notEqual(t.session.selected, selected);
  } finally { t.done(); }
});

test('notifications log: n in the hub and Notifications in the pause sheet show newest first, any key returns, and unread clears', () => {
  const t = setup(100, 30);
  try {
    t.finish('npm test', 1, 3_000);
    t.finish('npm run build', 0, 42_000);
    assert.equal(t.activity.unread, 2);
    assert.match(top(t.screen(), 2), /✕ Commands finished[\s\S]*2 finished · 1 failed/u);
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
    session.setCompanion({view: () => activity.view(1), history: () => activity.history(), markRead: () => activity.markRead(), running: () => ({label: 'make', elapsedMs: 0}), activities: () => [{id: 'run', label: 'make', status: 'running', detail: '0ms'}]});
    assert.equal(session.game, game, 'the same game instance');
    const rows = session.render().rows.map(row => stripAnsi(row));
    assert.equal(rows.length, 30);
    assert.match(rows[0]!, /◷ make/u);
    session.dispose();
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
