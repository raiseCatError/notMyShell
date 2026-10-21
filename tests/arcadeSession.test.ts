import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import type {Key} from '../src/terminal/keys.js';
import {ArcadeSession, type ArcadeEnvironment} from '../src/arcade/ArcadeSession.js';
import {ArcadeStore} from '../src/arcade/scores.js';
import type {Canvas} from '../src/arcade/Canvas.js';
import type {ArcadePalette} from '../src/arcade/palette.js';
import type {ControlHint, GameDefinition, GameInstance, GameKeyResult, GameStatus} from '../src/arcade/types.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {presentationClock} from '../src/motion/PresentationClock.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/** A scripted game: counts steps, dies after `dieAt` steps, records what it was given. */
function scripted(log: string[], options: {dieAt?: number} = {}): GameDefinition {
  return {
    id: 'scripted', aliases: ['s'], title: 'Scripted', tagline: 'a test game', description: 'Used by tests.', kind: 'action', controls: [{keys: 'Space', action: 'jump'}],
    summary: record => `Best ${String(record.best ?? 0)}`,
    preview: (canvas: Canvas) => canvas.text(0, 0, 'preview'),
    create: context => {
      let status: GameStatus = 'ready';
      let steps = 0;
      let paused = false;
      let size = context.size;
      const instance: GameInstance = {
        get status() { return status; },
        get result() { return status === 'over' ? {score: steps, scoreText: `${steps}`, record: steps > 5, details: ['Distance 1 m']} : undefined; },
        stepsPerSecond: 60, refreshMs: 0,
        step() { steps += 1; if (options.dieAt && steps >= options.dieAt) status = 'over'; },
        animate() {},
        key(key: Key): GameKeyResult {
          log.push(`key:${key.kind}${key.kind === 'text' ? `:${key.value}` : ''}`);
          if (key.kind === 'text' && key.value === ' ') { if (status === 'ready') status = 'playing'; paused = false; return 'handled'; }
          return 'ignored';
        },
        render(canvas: Canvas, _a: number, palette: ArcadePalette) { canvas.clear(); canvas.text(0, 0, `steps ${steps} ${size.columns}x${size.rows}${paused ? ' paused' : ''}`, {fg: palette.ink}); },
        resize(next) { size = next; log.push(`resize:${next.columns}x${next.rows}`); },
        pause() { paused = true; log.push('pause'); },
        hints: (): readonly ControlHint[] => [{keys: 'Space', action: 'jump'}],
        persist() { log.push('persist'); },
        dispose() { log.push('dispose'); },
      };
      return instance;
    },
  };
}

function fixture(options: {dieAt?: number} = {}) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-s-'));
  const log: string[] = [];
  let now = 1000;
  let reduced = false;
  const env: ArcadeEnvironment = {
    store: new ArcadeStore({directory: dir}), now: () => now, motion: () => ({reduced, effects: 'normal'}), color: () => 'none', safeGlyphs: () => false, seed: () => 7,
  };
  const games = [scripted(log, options), {...scripted(log), id: 'second', aliases: [], title: 'Second'}];
  const session = new ArcadeSession(env, games, {columns: 90, rows: 24});
  const key = (value: Key['kind'] | string) => session.key(value.length === 1 ? {kind: 'text', value} : {kind: value} as Key);
  const screen = () => session.render().rows.map(row => stripAnsi(row)).join('\n');
  return {session, log, key, screen, advance: (ms: number) => { now += ms; }, setReduced: (value: boolean) => { reduced = value; }, dir, done: () => { session.dispose(); rmSync(dir, {recursive: true, force: true}); }};
}

test('hub: lists the games, moves with the shared keys, opens one on Enter and Esc closes the arcade', () => {
  const f = fixture();
  try {
    const hub = f.screen();
    assert.match(hub, /Vespyr Arcade/u);
    assert.match(hub, /Scripted/u);
    assert.match(hub, /Second/u);
    assert.match(hub, /Best 0/u);
    assert.equal(f.session.selected, 0);
    f.key('down'); assert.equal(f.session.selected, 1);
    f.key('up'); f.key('up'); assert.equal(f.session.selected, 1, 'wraps');
    f.key('1'); assert.equal(f.session.selected, 0);
    assert.equal(f.session.key({kind: 'enter'}), 'handled');
    assert.equal(f.session.screen, 'playing');
    assert.match(f.screen(), /steps 0/u);
    assert.equal(f.key('escape'), 'handled', 'Esc in a game that has not started leaves it for the hub');
    assert.equal(f.session.screen, 'hub');
    assert.equal(f.key('escape'), 'close');
  } finally { f.done(); }
});

test('game: only the active game gets keys; fixed steps run only while playing; Esc pauses and the menu resumes', () => {
  const f = fixture();
  try {
    f.key('enter');
    f.session.frame(100);
    assert.match(f.screen(), /steps 0/u, 'a game that is ready does not step');
    f.key(' ');
    f.session.frame(100);
    assert.match(f.screen(), /steps 6/u, '100 ms is six 60 Hz steps');
    f.key('escape');
    assert.equal(f.session.screen, 'paused');
    assert.deepEqual(f.log.filter(line => line === 'pause'), ['pause']);
    assert.match(f.screen(), /Paused/u);
    assert.match(f.screen(), /Resume/u);
    f.session.frame(500);
    assert.match(f.screen(), /steps 6/u, 'no steps while paused');
    f.log.length = 0;
    f.key('down'); f.key('up');
    assert.deepEqual(f.log, [], 'menu keys never reach the game');
    f.key('enter');
    assert.equal(f.session.screen, 'playing');
    f.session.frame(100);
    assert.match(f.screen(), /steps 12/u);
    assert.equal(f.session.key({kind: 'interrupt'}), 'close', 'Ctrl+C always leaves the arcade');
  } finally { f.done(); }
});

test('game over: the card names the result, a mashed key right after the end does nothing, then Retry starts a fresh run', () => {
  const f = fixture({dieAt: 30});
  try {
    f.key('enter'); f.key(' ');
    for (let i = 0; i < 12; i += 1) f.session.frame(100);
    assert.equal(f.session.screen, 'over');
    assert.match(f.screen(), /New record|Game over/u);
    assert.match(f.screen(), /Retry/u);
    assert.match(f.screen(), /Back to Arcade/u);
    assert.match(f.screen(), /Exit/u);
    f.key('enter');
    assert.equal(f.session.screen, 'over', 'keys are ignored for a moment after the end');
    f.advance(600);
    f.key('enter');
    assert.equal(f.session.screen, 'playing');
    assert.match(f.screen(), /steps 0/u, 'a new run');
    f.key(' ');
    for (let i = 0; i < 12; i += 1) f.session.frame(100);
    f.advance(600);
    assert.equal(f.session.screen, 'over');
    f.key('b');
    assert.equal(f.session.screen, 'hub');
    assert.ok(f.log.includes('persist') && f.log.includes('dispose'));
  } finally { f.done(); }
});

test('frames: the clock is wanted only while it helps, and reduced motion stops the idle hub', () => {
  const f = fixture();
  try {
    assert.equal(f.session.interval, 100);
    f.setReduced(true);
    assert.equal(f.session.interval, 0, 'a still hub asks for no frames');
    f.setReduced(false);
    f.key('enter'); f.key(' ');
    assert.equal(f.session.interval, 33);
    assert.equal(f.session.floor, 16);
    f.key('escape');
    assert.equal(f.session.interval, 0, 'a paused game asks for no frames');
  } finally { f.done(); }
});

test('layout: every row fits, at any size from tiny to wide, and a resize reaches the game', () => {
  for (const [columns, rows] of [[20, 8], [30, 10], [60, 16], [90, 24], [160, 50]] as const) {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'arcade-l-'));
    try {
      const session = new ArcadeSession({store: new ArcadeStore({directory: dir}), now: () => 0, motion: () => ({reduced: false, effects: 'normal'}), color: () => 'truecolor', safeGlyphs: () => false, seed: () => 1},
        [scripted([]), scripted([])], {columns, rows});
      for (const phase of ['hub', 'game', 'paused'] as const) {
        if (phase === 'game') { session.key({kind: 'enter'}); session.key({kind: 'text', value: ' '}); }
        if (phase === 'paused') session.key({kind: 'escape'});
        const frame = session.render();
        assert.ok(frame.rows.length <= rows, `${columns}x${rows} ${phase}: ${frame.rows.length} rows`);
        for (const row of frame.rows) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}x${rows} ${phase}: ${stripAnsi(row)}`);
      }
      session.dispose();
    } finally { rmSync(dir, {recursive: true, force: true}); }
  }
  const f = fixture();
  try {
    f.key('enter');
    f.log.length = 0;
    f.session.resize(60, 14);
    assert.deepEqual(f.log, ['resize:60x13'], 'the Stage keeps one row for the controls');
  } finally { f.done(); }
});

test('dispose: releases the game once, persists and is safe to repeat', () => {
  const f = fixture();
  f.key('enter');
  f.session.dispose(); f.session.dispose();
  assert.equal(f.log.filter(line => line === 'dispose').length, 1);
  assert.equal(f.session.key({kind: 'enter'}), 'close');
  rmSync(f.dir, {recursive: true, force: true});
});

// ---- the app: ownership, isolation, clock lifecycle -----------------------------------------------------------

function appFixture() {
  const frame = executionFrameFixture(100, 30);
  const app = frame.app;
  app['shellId'] = 'zsh';
  const key = (value: Key) => app['handleKey'](value);
  // The Arcade paints the whole viewport itself, outside the ordinary presentation frame: read what reached the renderer.
  let painted: string[] = [];
  const write = app['renderer'].render.bind(app['renderer']);
  app['renderer'].render = (value: {rows: string[]}) => { painted = value.rows; write(value as never); };
  const screen = () => { app['render'](); return painted.map(row => stripAnsi(row)).join('\n'); };
  return {frame, app, key, screen, painted: () => painted};
}

test('app: /games opens the hub at the prompt, the arcade owns keys, Esc restores the composer exactly, nothing reaches the shell', async () => {
  const f = appFixture();
  const submitted: string[] = [];
  Object.defineProperty(f.frame.session, 'submit', {value: (text: string) => { submitted.push(text); }, configurable: true});
  const subscribers = presentationClock.subscriberCount;
  try {
    for (const char of 'draft') f.key({kind: 'text', value: char});
    f.app['editor'].clear();
    await f.app['runSlash']('/games', {kind: 'arcade'});
    assert.ok(f.app['arcade'], 'the arcade is open');
    assert.match(f.screen(), /Vespyr Arcade/u);
    for (const char of 'ls') f.key({kind: 'text', value: char});
    f.key({kind: 'enter'});
    assert.deepEqual(submitted, [], 'typing and Enter in the arcade never reach the shell');
    assert.equal(f.app['editor'].text, '', 'nor the composer');
    for (let i = 0; i < 6 && f.app['arcade']; i += 1) f.key({kind: 'escape'});
    assert.equal(f.app['arcade'], undefined, 'Esc leaves the game, then the hub');
    assert.equal(f.app['editor'].text, '');
    assert.equal(presentationClock.subscriberCount, subscribers, 'every clock subscription is released');
  } finally { f.frame.dispose(); }
});

test('app: /game <name> opens that game; an unknown name is explained; a running command blocks the arcade', async () => {
  const f = appFixture();
  try {
    await f.app['runSlash']('/game run', {kind: 'arcade', game: 'run'});
    assert.equal(f.app['arcade']?.session.definition?.id, 'run');
    f.app['closeArcade']();
    await f.app['runSlash']('/game tetris', {kind: 'arcade', game: 'tetris'});
    assert.equal(f.app['arcade'], undefined);
    assert.match(f.screen(), /No game named "tetris"/u);
    f.frame.begin('sleep 5');
    await f.app['runSlash']('/games', {kind: 'arcade'});
    assert.equal(f.app['arcade'], undefined, 'never over a running command');
    assert.match(f.screen(), /let the running command finish first/u);
  } finally { f.frame.dispose(); }
});

test('app: a command that starts while the arcade is open closes it, so a game can never take its input', async () => {
  const f = appFixture();
  const subscribers = presentationClock.subscriberCount;
  try {
    await f.app['runSlash']('/game run', {kind: 'arcade', game: 'run'});
    assert.ok(f.app['arcade']);
    f.frame.begin('read -s password');
    assert.equal(f.app['arcade'], undefined);
    assert.match(f.screen(), /Closed the arcade/u);
    assert.equal(presentationClock.subscriberCount, subscribers);
  } finally { f.frame.dispose(); }
});

test('app: stopping NMSh while a game runs releases its clock and persists', async () => {
  const f = appFixture();
  const subscribers = presentationClock.subscriberCount;
  await f.app['runSlash']('/game run', {kind: 'arcade', game: 'run'});
  f.frame.dispose();
  assert.equal(f.app['arcade'], undefined);
  assert.equal(presentationClock.subscriberCount <= subscribers, true);
  void TerminalApp;
});
