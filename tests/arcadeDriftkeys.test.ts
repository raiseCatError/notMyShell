import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {DriftState, levelOf, STEP_MS} from '../src/arcade/games/driftkeys/logic.js';
import {MODES, PHRASES, PROGRAMMER, WORDS} from '../src/arcade/games/driftkeys/words.js';
import {driftkeysGame} from '../src/arcade/games/driftkeys/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
type Probe = {key(k: unknown): unknown; step(d: number): void; animate(d: number): void; render(c: Canvas, a: number, p: unknown): void; status: string; typing: boolean; result: {score: number; record: boolean; details: string[]} | undefined; state: DriftState; dispose(): void; hints(): unknown};
const text = (value: string) => ({kind: 'text', value});

test('phrase lists: printable ASCII, short, tidy, no duplicates, the required samples are present', () => {
  for (const mode of MODES) {
    const all = PHRASES[mode].flat();
    assert.equal(new Set(all).size, all.length, `${mode} has duplicates`);
    assert.equal(PHRASES[mode].length, 3);
    for (const phrase of all) {
      assert.match(phrase, /^[\x20-\x7e]+$/u);
      assert.ok(phrase.length >= 2 && phrase.length <= 24, phrase);
      assert.equal(phrase, phrase.trim());
      assert.ok(!phrase.includes('  '));
    }
  }
  const programmer = PROGRAMMER.flat();
  for (const sample of ['git status', 'docker ps', 'command -v node']) assert.ok(programmer.includes(sample));
  assert.ok(WORDS.flat().some(phrase => phrase.includes(' ')));
  assert.ok(!programmer.some(phrase => /(^|\s)rm\s|sudo|mkfs|dd if/u.test(phrase)), 'nothing destructive, even as data');
});

test('typing rules: only the first phrase takes keys, wrong keys never advance, the last key completes it', () => {
  const state = new DriftState('programmer', createRng(3), 80, 24);
  state.advance(1000);
  assert.ok(state.targets.length >= 1);
  while (state.targets.length < 2) state.advance(STEP_MS);
  const first = state.targets[0]!, second = state.targets[1]!;
  assert.equal(state.active, first);
  const wrong = [...'{}|~^`\\'].find(char => char !== first.text[0])!;
  assert.equal(state.press(wrong), 'wrong');
  assert.equal(first.typed, 0);
  assert.equal(state.wrong, 1);
  // The second phrase's first letter does nothing for the first phrase unless it matches.
  for (let index = 0; index < first.text.length; index += 1) {
    const expected = first.text[index]!;
    const result = state.press(expected === expected.toUpperCase() && /[a-z]/iu.test(expected) ? expected.toLowerCase() : expected.toUpperCase() === expected ? expected : expected.toUpperCase());
    assert.equal(result, index === first.text.length - 1 ? 'done' : 'correct', `${first.text} @${index}`);
    assert.equal(second.typed, 0);
  }
  assert.equal(state.targets.includes(first), false, 'completion is automatic');
  assert.equal(state.completed, 1);
  assert.equal(state.score, first.text.length * 10 + 5);
  assert.equal(state.active, second);
  assert.equal(state.accuracy, Math.floor((first.text.length * 100) / (first.text.length + 1)));
});

test('spaces must be typed where a phrase has them, and a space elsewhere is wrong', () => {
  const state = new DriftState('programmer', createRng(1), 80, 24);
  state.targets.push({id: 1, text: 'git status', typed: 0, x: 5, lane: 3, vx: 0, age: 0, life: 99999});
  for (const char of 'git') assert.equal(state.press(char), 'correct');
  assert.equal(state.press('s'), 'wrong', 'skipping the space is wrong');
  assert.equal(state.press(' '), 'correct');
  assert.equal(state.targets[0]!.typed, 4);
  assert.equal(state.press(' '), 'wrong');
  assert.equal(state.press(''), 'idle');
});

test('simulation is deterministic and independent of frame rate', () => {
  const run = (chunks: number[]) => {
    const state = new DriftState('words', createRng(77), 70, 20);
    for (const chunk of chunks) state.advance(chunk);
    return JSON.stringify([state.targets, state.lives, state.elapsed, state.missed]);
  };
  const every = (ms: number, total: number) => Array<number>(Math.round(total / ms)).fill(ms);
  const reference = run(every(10, 12000));
  assert.equal(run(every(40, 12000)), reference);
  assert.equal(run(every(250, 12000)), reference);
  assert.equal(run(every(1000 / 60, 12000)), reference);
  assert.equal(run([12000]), reference);
  assert.notEqual(reference, JSON.stringify(new DriftState('words', createRng(78), 70, 20)));
  const other = new DriftState('words', createRng(78), 70, 20);
  for (const chunk of every(10, 12000)) other.advance(chunk);
  assert.notEqual(JSON.stringify([other.targets, other.lives, other.elapsed, other.missed]), reference);
});

test('difficulty ramps up: levels rise with phrases, drift speeds up, time per phrase shrinks', () => {
  assert.equal(levelOf(0), 1); assert.equal(levelOf(5), 2); assert.equal(levelOf(1000), 12);
  const sample = (completed: number) => {
    const state = new DriftState('programmer', createRng(5), 90, 30);
    state.completed = completed;
    let speed = 0, life = 0, length = 0, n = 0;
    for (let i = 0; i < 400; i += 1) { state.targets = []; state.advance(1000); const t = state.targets[0]; if (t) { speed += Math.abs(t.vx); life += t.life / t.text.length; length += t.text.length; n += 1; } }
    return {speed: speed / n, life: life / n, length: length / n};
  };
  const early = sample(0), late = sample(50);
  assert.ok(late.speed > early.speed * 1.8, 'faster drift');
  assert.ok(late.life < early.life, 'less time per character');
  assert.ok(late.length > early.length, 'longer phrases');
});

test('a perfect typist survives; with no input the three lives run out; phrases always stay on the field', () => {
  for (const [width, height] of [[100, 34], [40, 16], [28, 12], [20, 8]] as const) for (const mode of MODES) {
    const state = new DriftState(mode, createRng(width + height), width, height);
    let longest = 0;
    for (let tick = 0; tick < 50 * 60 && !state.over; tick += 1) {
      state.advance(STEP_MS);
      const active = state.active;
      if (active && tick % 4 === 0) state.press(active.text[active.typed]!);
      for (const t of state.targets) {
        assert.ok(t.x >= 3 && t.x + t.text.length + 2 <= width + 1e-9, `${t.text} inside ${width}`);
        assert.ok(t.lane >= 2 && t.lane <= Math.max(2, height - 3));
        longest = Math.max(longest, t.text.length);
      }
      assert.equal(new Set(state.targets.map(t => t.lane)).size, state.targets.length, 'one phrase per row');
    }
    assert.equal(state.lives > 0 || state.over, true);
    assert.ok(state.completed >= 15, `${mode} ${width}x${height} completed ${state.completed}`);
    assert.equal(state.accuracy, 100);
  }
  const idle = new DriftState('words', createRng(2), 80, 24);
  for (let tick = 0; tick < 50 * 120 && !idle.over; tick += 1) idle.advance(STEP_MS);
  assert.ok(idle.over);
  assert.equal(idle.lives, 0);
  assert.equal(idle.missed, 3);
});

test('resize drops phrases that no longer fit and keeps the rest inside', () => {
  const state = new DriftState('programmer', createRng(9), 100, 34);
  for (let i = 0; i < 400; i += 1) { state.advance(STEP_MS); if (state.active) state.targets.forEach(t => (t.age = 0)); }
  state.resize(24, 10);
  for (const t of state.targets) { assert.ok(t.text.length + 6 <= 24); assert.ok(t.x + t.text.length + 2 <= 24 + 1e-9); assert.ok(t.lane <= 7); }
});

test('the game claims every text key while playing; Backspace is ignored; paste is refused', () => {
  const game = driftkeysGame.create(context(memory())) as never as Probe;
  assert.equal(game.typing, true);
  assert.equal(game.status, 'ready');
  assert.equal(game.key({kind: 'enter'}), 'handled', 'Enter picks the default mode: Programmer');
  assert.equal(game.status, 'playing');
  assert.equal(game.state.mode, 'programmer');
  game.step(1000);
  const target = game.state.active!;
  for (const value of ['p', 'q', 'h', 'j', ' ', '/', '1', 'Z', '{']) assert.equal(game.key(text(value)), 'handled', `text "${value}" is claimed`);
  const typedBefore = target.typed;
  assert.equal(game.key({kind: 'backspace'}), 'handled');
  assert.equal(target.typed, typedBefore, 'Backspace does not undo');
  const wrongBefore = game.state.wrong;
  assert.equal(game.key({kind: 'backspace'}), 'handled');
  assert.equal(game.state.wrong, wrongBefore, 'Backspace is not a mistake either');
  const correctBefore = game.state.correct;
  assert.equal(game.key({kind: 'paste', value: target.text}), 'handled');
  assert.equal(game.state.correct, correctBefore, 'pasted text scores nothing');
  assert.equal(game.state.completed, 0);
  const canvas = new Canvas(100, 34);
  game.render(canvas, 0, arcadePalette('truecolor'));
  assert.ok(canvas.plain().some(line => line.includes('Paste is not allowed')));
  assert.equal(game.key({kind: 'escape'}), 'ignored', 'Esc is the session\'s (pause)');
});

test('typed text is never drawn as an echo or composer and never leaves the game', () => {
  const record = memory();
  const game = driftkeysGame.create(context(record)) as never as Probe;
  game.key(text('1'));
  game.step(2000);
  const secret = '{{}}||';
  game.key(text(secret));
  const target = game.state.active!;
  const prefix = target.text.slice(0, 4);
  for (const char of prefix) game.key(text(char));
  assert.equal(target.typed, Math.min(4, target.text.length));
  const canvas = new Canvas(100, 34);
  game.render(canvas, 0, arcadePalette('truecolor'));
  const lines = canvas.plain();
  assert.ok(!lines.some(line => line.includes('{{') || line.includes('||')), 'wrong keys are not echoed');
  const phraseLine = lines.filter(line => line.includes(target.text));
  assert.equal(phraseLine.length, 1, 'the phrase is drawn once, with the typed part highlighted in place');
  assert.ok(!lines.filter(line => !line.includes(target.text)).some(line => line.includes(prefix)), 'no composer shows the typed prefix elsewhere');
  assert.ok(!JSON.stringify(game.state).includes('{{'), 'the state keeps counts, not strings typed');
  // Finish the run with no more input; nothing typed appears in the result or the saved record.
  for (let i = 0; i < 60 * 120 && game.status === 'playing'; i += 1) game.step(1000 / 60);
  assert.equal(game.status, 'over');
  assert.ok(!JSON.stringify(game.result).includes('{{'));
  assert.ok(!JSON.stringify(record.raw()).includes('{{'));
  assert.ok(!JSON.stringify(record.raw()).includes(prefix + 'zzz'));
});

test('a full run: Words mode via the menu, perfect typing, game over, record and accuracy saved', () => {
  const record = memory();
  const game = driftkeysGame.create(context(record)) as never as Probe;
  game.key(text('2'));
  assert.equal(game.state.mode, 'words');
  let wrongKeys = 0;
  for (let tick = 0; tick < 60 * 40; tick += 1) {
    game.step(1000 / 60);
    const active = game.state.active;
    if (active && tick % 5 === 0) game.key(text(active.text[active.typed]!));
    if (tick % 400 === 0) { game.key(text('{')); wrongKeys += 1; }
  }
  assert.ok(game.state.completed >= 10);
  assert.ok(game.state.wrong >= 1 && game.state.wrong <= wrongKeys, 'stray keys count against accuracy (none while no phrase is up)');
  const score = game.state.score;
  for (let i = 0; i < 60 * 200 && game.status === 'playing'; i += 1) game.step(1000 / 60);
  assert.equal(game.status, 'over');
  assert.ok(game.result!.score >= score);
  assert.ok(game.result!.record);
  assert.match(game.result!.details.join(' '), /Accuracy \d+%/u);
  const raw = record.raw() as {best: number; plays: number; bestWords: number; bestAccuracy: number};
  assert.equal(raw.plays, 1); assert.equal(raw.best, game.result!.score); assert.equal(raw.bestWords, game.result!.score); assert.ok(raw.bestAccuracy > 0 && raw.bestAccuracy < 100);
  const again = driftkeysGame.create(context(record)) as never as Probe;
  again.key(text('2'));
  for (let i = 0; i < 60 * 200 && again.status === 'playing'; i += 1) again.step(1000 / 60);
  assert.equal(again.result!.record, false, 'zero does not beat the best');
  assert.equal((record.raw() as {best: number}).best, raw.best);
  assert.match(driftkeysGame.summary(record.get()), /Best .* accuracy/u);
  game.dispose(); again.dispose();
});

test('render: every size and mode draws inside its bounds with no color-only information', () => {
  const palette = arcadePalette('truecolor');
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [28, 12]] as const) for (const mode of [{color: 'truecolor', safe: false}, {color: 'none', safe: true}] as const) for (const reduced of [false, true]) for (const pick of ['1', '2']) {
    const game = driftkeysGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe, motion: {reduced, effects: reduced ? 'off' : 'normal'}})) as never as Probe;
    const canvas = new Canvas(columns, rows);
    const check = () => { for (const line of canvas.plain()) assert.ok(displayWidth(line) <= columns, `${columns}x${rows}: "${line}"`); };
    game.render(canvas, 0, palette); check();
    game.key(text(pick));
    let seenActive = false;
    for (let i = 0; i < 60 * 25; i += 1) {
      game.step(1000 / 60);
      const active = game.state.active;
      if (active && i % 7 === 0) game.key(text(active.text[active.typed]!));
      if (i % 50 === 0) { game.animate(50); game.render(canvas, 0, palette); check(); if (canvas.plain().some(line => line.includes(mode.safe ? '>' : '▸'))) seenActive = true; }
    }
    assert.ok(seenActive, 'the active phrase has a text marker');
    game.key({kind: 'paste', value: 'x'});
    game.render(canvas, 0, palette); check();
    game.resize({columns: Math.max(20, columns - 6), rows: Math.max(8, rows - 2)});
    game.render(new Canvas(Math.max(20, columns - 6), Math.max(8, rows - 2)), 0, palette);
    while (game.status === 'playing') game.step(1000 / 60);
    game.render(canvas, 0, palette); check();
    game.dispose();
  }
});
