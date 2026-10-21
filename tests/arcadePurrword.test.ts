import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng} from '../src/arcade/rng.js';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {afterRound, answers, daily, isWord, readStats, score, EPOCH, type Round} from '../src/arcade/games/purrword/logic.js';
import {purrwordGame} from '../src/arcade/games/purrword/index.js';
import {displayWidth} from '../src/util/text.js';

function memory(initial: GameRecord = {}): GameRecordHandle & {raw(): GameRecord} {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
const context = (record = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
type Driver = {key(k: unknown): unknown; animate(d: number): void; status: string; result: {scoreText: string; details: string[]} | undefined};
const type = (game: Driver, word: string) => { for (const letter of word) game.key({kind: 'text', value: letter}); game.key({kind: 'enter'}); };

test('scoring: exact matches first, then a letter is present only as often as the answer still has it', () => {
  assert.deepEqual(score('crane', 'crane'), Array(5).fill('correct'));
  assert.deepEqual(score('speed', 'abide'), ['absent', 'absent', 'present', 'absent', 'present']);
  assert.deepEqual(score('allee', 'apple'), ['correct', 'present', 'absent', 'absent', 'correct']);
  assert.deepEqual(score('eerie', 'alone'), ['absent', 'absent', 'absent', 'absent', 'correct']);
  assert.deepEqual(score('llama', 'hello'), ['present', 'present', 'absent', 'absent', 'absent']);
});

test('word lists: every answer is five lowercase letters, accepted as a guess, and unique', () => {
  assert.ok(answers.length >= 500);
  assert.equal(new Set(answers).size, answers.length);
  for (const word of answers) { assert.match(word, /^[a-z]{5}$/u); assert.ok(isWord(word), word); }
  assert.equal(isWord('zzzzz'), false);
});

test('daily word depends on the date alone, and the number counts from the epoch', () => {
  assert.equal(daily(EPOCH).number, 1);
  assert.equal(daily('2026-10-21').word, daily('2026-10-21').word);
  assert.equal(daily('2026-10-22').number, daily('2026-10-21').number + 1);
  const words = new Set(Array.from({length: 30}, (_, day) => daily(`2026-11-${String(day + 1).padStart(2, '0')}`.replace('2026-11-3', '2026-12-0')).word));
  assert.ok(words.size > 20, 'consecutive days differ');
});

test('streak: consecutive solved dailies grow it, a miss or a gap resets it, practice leaves it alone', () => {
  const base = readStats({});
  const win = (day: string | undefined, guesses = ['crane']): Round => ({answer: 'crane', guesses, daily: day});
  const one = afterRound(base, win('2026-10-20'));
  const two = afterRound(one, win('2026-10-21'));
  assert.equal(two.streak, 2); assert.equal(two.bestStreak, 2);
  assert.equal(afterRound(two, win(undefined)).streak, 2, 'practice does not touch the streak');
  assert.equal(afterRound(two, win('2026-10-23')).streak, 1, 'a gap restarts at one');
  const lost = afterRound(two, {answer: 'crane', guesses: Array(6).fill('stomp'), daily: '2026-10-22'});
  assert.equal(lost.streak, 0); assert.equal(lost.bestStreak, 2);
  assert.equal(two.spread[0], 2);
});

test('readStats survives garbage', () => {
  const stats = readStats({played: 'x', spread: 7, current: {day: 'nope', guesses: ['zzzzz']}, lastDaily: 5});
  assert.equal(stats.played, 0); assert.equal(stats.current, undefined); assert.equal(stats.lastDaily, undefined); assert.equal(stats.spread.length, 6);
});

test('play the daily: invalid guesses are refused, a win records stats, and the day cannot be replayed', () => {
  const record = memory();
  const game = purrwordGame.create(context(record)) as never as Driver;
  game.key({kind: 'text', value: 'd'});
  type(game, 'zzzzz');
  assert.equal(readStats(record.raw()).current, undefined, 'a non-word is not a guess');
  for (let i = 0; i < 5; i += 1) game.key({kind: 'backspace'});
  type(game, answers.find(word => word !== daily('2026-10-21').word)!);
  assert.equal(readStats(record.raw()).current?.guesses.length, 1, 'progress is saved after each daily guess');
  type(game, daily('2026-10-21').word);
  for (let i = 0; i < 40; i += 1) game.animate(100);
  assert.equal(game.status, 'won');
  const stats = readStats(record.raw());
  assert.equal(stats.won, 1); assert.equal(stats.streak, 1); assert.equal(stats.current, undefined); assert.equal(stats.lastDaily, '2026-10-21');
  assert.equal(game.result?.scoreText, '2/6');
  const again = purrwordGame.create(context(record)) as never as Driver;
  again.key({kind: 'text', value: 'd'});
  assert.equal(again.status, 'ready', 'the finished daily does not reopen');
});

test('a half-finished daily resumes; a loss shows the word', () => {
  const word = daily('2026-10-21').word;
  const wrong = answers.filter(candidate => candidate !== word);
  const record = memory({current: {day: '2026-10-21', guesses: [wrong[0], wrong[1]]}});
  const game = purrwordGame.create(context(record)) as never as Driver;
  game.key({kind: 'text', value: 'd'});
  assert.equal(game.status, 'playing');
  for (const guess of wrong.slice(2, 6)) type(game, guess);
  for (let i = 0; i < 40; i += 1) game.animate(100);
  assert.equal(game.status, 'over');
  assert.equal(game.result?.scoreText, word.toUpperCase());
  assert.equal(readStats(record.raw()).streak, 0);
});

test('render: every size and mode draws inside its bounds, mid-game and finished', () => {
  const palette = arcadePalette('truecolor');
  for (const [columns, rows] of [[100, 34], [60, 24], [40, 16], [30, 12]] as const) for (const mode of [{color: 'truecolor', safe: false}, {color: 'none', safe: true}] as const) {
    const game = purrwordGame.create(context(memory(), {size: {columns, rows}, color: mode.color, safeGlyphs: mode.safe})) as never as Driver & {render(c: Canvas, a: number, p: unknown): void};
    const canvas = new Canvas(columns, rows);
    game.render(canvas, 0, palette);
    game.key({kind: 'text', value: 'p'});
    type(game, answers[3]!); game.key({kind: 'text', value: 'a'}); game.key({kind: 'text', value: 'b'});
    game.render(canvas, 0, palette);
    for (let i = 0; i < 40; i += 1) game.animate(100);
    game.render(canvas, 0, palette);
    for (const line of canvas.toLines?.() ?? []) assert.ok(displayWidth(line) <= columns);
  }
});
