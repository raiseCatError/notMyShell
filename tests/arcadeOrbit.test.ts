import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {COLORS, OrbitState, RING_R, TAP} from '../src/arcade/games/orbit/logic.js';
import {orbitGame} from '../src/arcade/games/orbit/index.js';
import {displayWidth} from '../src/util/text.js';

const STEP = 1000 / 60;
function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 30}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});

test('motion: a tap kicks the ball up, gravity brings it down, the same at any frame rate', () => {
  const at = (step: number) => { const s = new OrbitState(createRng(1)); s.obstacles = []; s.tap(); for (let t = 0; t < 300; t += step) s.step(step); return s.y; };
  assert.ok(at(STEP) > 0);
  assert.ok(Math.abs(at(STEP) - at(STEP / 2)) < 0.8, 'within a fraction of a pixel');
  const s = new OrbitState(createRng(1)); s.obstacles = []; s.tap();
  for (let t = 0; t < 3000; t += STEP) s.step(STEP);
  assert.equal(s.alive, false, 'falling off the bottom ends it');
});

test('collision: crossing a ring through your own color passes, any other color ends the climb', () => {
  for (const match of [true, false]) {
    const s = new OrbitState(createRng(2));
    s.prisms = [];
    const ring = {kind: 'ring' as const, y: 30, r: RING_R, speed: 0, phase: 0};
    s.obstacles = [ring];
    const bottom = OrbitState.ringColor(ring, 0, Math.PI / 2);
    s.color = match ? bottom : (bottom + 1) % COLORS;
    s.started = true;
    s.y = 30 - RING_R - 6;
    s.vy = TAP;
    let crossed = false;
    for (let t = 0; t < 400 && s.alive; t += STEP) { s.step(STEP); if (s.y > 30 - RING_R + 2) crossed = true; }
    assert.equal(crossed, match, match ? 'through the matching arc' : 'stopped by the wrong color');
  }
});

test('prisms always switch to a different color; obstacles keep spawning above the ball', () => {
  const s = new OrbitState(createRng(3));
  s.obstacles = [];
  s.prisms = [{y: 5, taken: false, color: -1}];
  const before = s.color;
  s.tap();
  for (let t = 0; t < 200; t += STEP) s.step(STEP);
  assert.ok(s.prisms[0]!.taken);
  assert.notEqual(s.color, before);
  const climb = new OrbitState(createRng(4));
  climb.obstacles = []; climb.prisms = [];
  for (let i = 0; i < 400; i += 1) { if (climb.vy <= 0) climb.tap(); climb.step(STEP); climb.obstacles = climb.obstacles.filter(o => o.y > climb.y + 200); }
  assert.ok(climb.y > 300);
});

test('game: tapping in a fixed rhythm is deterministic and ends with a saved result', () => {
  const play = () => {
    const record = memory();
    const game = orbitGame.create(context(record));
    for (let t = 0; t < 120_000 && game.status !== 'over'; t += STEP) {
      if (Math.floor(t / 330) !== Math.floor((t + STEP) / 330)) game.key({kind: 'text', value: ' '});
      game.step(STEP); game.animate(STEP);
    }
    return {game, record};
  };
  const a = play(), b = play();
  assert.equal(a.game.status, 'over');
  assert.equal(a.game.result!.score, b.game.result!.score);
  assert.equal(a.record.raw().plays, 1);
});

test('render: every size draws inside its bounds, in color, without color and in Safe Glyphs', () => {
  for (const [columns, rows] of [[20, 8], [50, 16], [100, 30], [200, 60]] as const) {
    for (const mode of [{color: 'truecolor' as const, safe: false}, {color: 'none' as const, safe: false}, {color: 'none' as const, safe: true}]) {
      const game = orbitGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe}));
      game.key({kind: 'text', value: ' '});
      for (let i = 0; i < 20; i += 1) game.step(STEP);
      const canvas = new Canvas(columns, rows);
      game.render(canvas, 0, arcadePalette());
      for (const line of canvas.plain({color: 'none', safe: mode.safe})) assert.ok(displayWidth(line) <= columns);
      if (mode.safe) for (const row of canvas.rows({color: 'none', safe: true})) assert.match(row, /^[\x20-\x7e\u001b[0-9;m]*$/u);
    }
  }
});
