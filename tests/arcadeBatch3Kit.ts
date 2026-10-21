import assert from 'node:assert/strict';
import {Canvas} from '../src/arcade/Canvas.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {createRng} from '../src/arcade/rng.js';
import type {GameRecord} from '../src/arcade/scores.js';
import type {GameContext, GameDefinition, GameInstance, GameRecordHandle} from '../src/arcade/types.js';
import {displayWidth} from '../src/util/text.js';

export const STEP = 1000 / 60;
export type Memory = GameRecordHandle & {raw(): GameRecord};
export function memory(initial: GameRecord = {}): Memory {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }, raw: () => data};
}
export const context = (record: GameRecordHandle = memory(), options: Partial<GameContext> = {}): GameContext => ({
  size: {columns: 100, rows: 34}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false,
  record, now: () => 0, today: '2026-10-21', ...options,
});
export const SIZES = [[100, 34], [60, 24], [40, 16], [28, 12]] as const;

/** Render a game after some play at every size and look; every plain line must fit the columns. */
export function checkRenders(definition: GameDefinition, play: (game: GameInstance) => void): void {
  const looks: Array<Partial<GameContext>> = [
    {color: 'truecolor'}, {color: 'none', safeGlyphs: true}, {color: 'truecolor', motion: {reduced: true, effects: 'off'}}, {color: 'none', safeGlyphs: false},
  ];
  for (const [columns, rows] of SIZES) for (const look of looks) {
    const game = definition.create(context(memory(), {size: {columns, rows}, ...look}));
    const canvas = new Canvas(columns, rows);
    game.render(canvas, 0, arcadePalette());
    play(game);
    for (let i = 0; i < 3; i += 1) { game.animate(16); canvas.clear(); game.render(canvas, 0.5, arcadePalette()); }
    for (const safe of [false, true]) {
      const lines = canvas.plain({color: 'none', safe});
      assert.equal(lines.length, rows);
      for (const line of lines) assert.ok(displayWidth(line) <= columns, `${definition.id} ${columns}x${rows} ${JSON.stringify(look)}: "${line}"`);
      if (safe) for (const line of lines) assert.ok(/^[\x20-\x7e]*$/u.test(line), `${definition.id}: non-ASCII in safe mode: "${line}"`);
    }
    // Shrinking mid-game stays inside the new bounds too.
    game.resize({columns: 28, rows: 12});
    const small = new Canvas(28, 12);
    game.render(small, 0, arcadePalette());
    for (const line of small.plain()) assert.ok(displayWidth(line) <= 28);
    game.dispose();
  }
}
