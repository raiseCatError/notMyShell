import {catPixels} from '../../../idle/catSprite.js';
import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {spriteFromRows, type Sprite} from '../../Canvas.js';
import type {ArcadePalette} from '../../palette.js';

/**
 * Vespyr in flight. Every pose starts from `catPixels()` (ears, eyes, body, four legs, the curled tail: the approved
 * silhouette) and changes only legs, tail, ear tips and eyelids, then adds a pair of small wings on his back. The
 * sprite faces left like the source art; the renderer mirrors it to fly to the right.
 */
export type Wing = 'up' | 'mid' | 'down';
export type Legs = 'tucked' | 'glide' | 'dangle';
export type TailShape = 'streaming' | 'curled' | 'level' | 'trailing';

export interface CatLook {
  wing: Wing;
  legs: Legs;
  tail: TailShape;
  /** Eyes closed (a blink, or hit). */
  blink: boolean;
  /** An ear flick. */
  twitch: boolean;
  /** Stunned: closed eyes, wings up, legs dangling. */
  hit: boolean;
}

export const SPRITE_W = 14;
export const SPRITE_H = 8;
/** The hitbox sits at this offset inside the sprite (8 x 5, the body and the lower head). */
export const HB_X = 3;
export const HB_Y = 2;

const NEAR: Readonly<Record<Wing, ReadonlyArray<readonly [number, number]>>> = {
  up: [[0, 9], [1, 8], [1, 9], [2, 7], [2, 8], [2, 9], [3, 7], [3, 8]],
  mid: [[2, 9], [2, 10], [3, 6], [3, 7], [3, 8], [3, 9], [3, 10], [4, 8], [4, 9]],
  down: [[4, 7], [4, 8], [4, 9], [5, 6], [5, 7], [5, 8], [5, 9], [6, 7], [6, 8], [7, 9], [7, 10]],
};
/** The wing on the far side: a darker shape peeking out behind the near one. */
const FAR: Readonly<Record<Wing, ReadonlyArray<readonly [number, number]>>> = {
  up: [[0, 11], [1, 10], [1, 11], [2, 10], [2, 11]],
  mid: [[3, 11], [3, 12], [4, 11]],
  down: [[7, 11], [7, 12], [6, 11]],
};
const TAILS: Readonly<Record<TailShape, ReadonlyArray<readonly [number, number]>>> = {
  curled: [[2, 13], [3, 12]],
  streaming: [[1, 13], [2, 13], [3, 12]],
  level: [[4, 12], [4, 13], [3, 13]],
  trailing: [[5, 12], [6, 12], [6, 13]],
};
const LEGS: Readonly<Record<Legs, string>> = {tucked: '..............', glide: '..LL.....LL...', dangle: '.L.L......L.L.'};

const put = (rows: string[], row: number, column: number, value: string): void => {
  const text = rows[row] ?? '';
  if (column < 0 || column >= text.length) return;
  rows[row] = `${text.slice(0, column)}${value}${text.slice(column + 1)}`;
};

/** The pose's pixel rows, SPRITE_W wide. L body, E eye, W near wing, V far wing, T tail, K whisker. */
export function catRows(look: CatLook): string[] {
  const rows = catPixels('idle');
  put(rows, 2, 13, '.'); put(rows, 3, 12, '.');
  rows[7] = LEGS[look.hit ? 'dangle' : look.legs];
  if (look.legs === 'tucked' && !look.hit) { rows[6] = '..LLLLLLLLLL..'; }
  if (look.blink || look.hit) for (const row of [2, 3]) rows[row] = rows[row]!.replace(/E/gu, 'L');
  if (look.twitch) { put(rows, 0, 5, '.'); put(rows, 0, 6, 'L'); }
  for (const [row, column] of TAILS[look.hit ? 'streaming' : look.tail]) put(rows, row, column, 'T');
  for (const [row, column] of FAR[look.hit ? 'up' : look.wing]) put(rows, row, column, 'V');
  for (const [row, column] of NEAR[look.hit ? 'up' : look.wing]) put(rows, row, column, 'W');
  // Whiskers in front of the face.
  put(rows, 3, 0, 'K'); put(rows, 2, 0, 'K');
  if (look.hit) { put(rows, 2, 2, 'X'); put(rows, 2, 4, 'X'); }
  return rows;
}

export interface CatColors { body: Rgb; shade: Rgb; belly: Rgb; eye: Rgb; wing: Rgb; wingFar: Rgb; whisker: Rgb }

export function catColors(palette: ArcadePalette): CatColors {
  return {
    body: palette.cat.body, shade: palette.cat.shade, belly: palette.cat.belly, eye: palette.cat.eye,
    wing: mixRgb(palette.haze, palette.cat.belly, 0.35), wingFar: mixRgb(palette.cat.shade, palette.accent, 0.35), whisker: palette.cat.whisker,
  };
}

export function catSprite(look: CatLook, palette: ArcadePalette): Sprite {
  const colors = catColors(palette);
  // Legs in the shade, the lower belly lit, everything else the body color.
  const rows = catRows(look).map((row, index) => [...row].map((char, column) => {
    if (char !== 'L') return char;
    if (index === 7) return 'S';
    if (index === 6) return column >= 4 && column <= 8 ? 'B' : 'S';
    return 'L';
  }).join(''));
  return spriteFromRows(rows, {L: colors.body, S: colors.shade, B: colors.belly, E: colors.eye, X: colors.eye, T: colors.body, W: colors.wing, V: colors.wingFar, K: colors.whisker});
}
