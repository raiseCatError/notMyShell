import {mixRgb} from '../../../chroma/chroma.js';
import {CAT_ASCII, CAT_ASCII_BLINK, catPixels} from '../../../idle/catSprite.js';
import {spriteFromRows, type Sprite} from '../../Canvas.js';
import type {ArcadePalette} from '../../palette.js';

/**
 * Vespyr on his glowing board. The silhouette is cut from `catPixels()` (the approved sprite): the head with its two ears
 * and the two eyes, and the chest, in a 7 x 6 block that sits on a board of light. Only the board and the eyelids change
 * between poses, so he is recognizably the same cat as everywhere else.
 */
export type PlayerPose = 'ride' | 'air' | 'land' | 'hit' | 'blink';

const HEAD_FIRST = 1;
const HEAD_LAST = 6;

/** The pose's pixel rows: `L` body, `E` eye, `S` chest, `B` board, `G` the board's glowing ends, `.` see-through. */
export function playerRows(pose: PlayerPose): string[] {
  const source = catPixels(pose === 'hit' || pose === 'blink' ? 'blink' : 'idle');
  const head = source.slice(0, 5).map((row, index) => `.${row.slice(HEAD_FIRST, HEAD_LAST)}.`.replace(/L/gu, index === 4 ? 'S' : 'L'));
  switch (pose) {
    case 'air': return [...head, '.GBBBG.'];
    case 'land': return [head[0]!, head[1]!, head[2]!, head[4]!, 'GBBBBBG'];
    case 'hit': return [...head, 'G.B.B.G'];
    default: return [...head, 'GBBBBBG'];
  }
}

export function playerSprite(pose: PlayerPose, palette: ArcadePalette): Sprite {
  return spriteFromRows(playerRows(pose), {
    L: palette.cat.body, E: palette.cat.eye, S: palette.cat.shade, B: palette.accent, G: mixRgb(palette.accent, palette.haze, 0.6),
  });
}

/** The cat for a plain render (NO_COLOR, Safe Glyphs): the NMSh ASCII cat, 7 x 3 cells, the same width as the sprite. */
export const plainPlayer = (pose: PlayerPose): readonly string[] => (pose === 'hit' || pose === 'blink' ? CAT_ASCII_BLINK : CAT_ASCII);

/** A spike, 6 x 4: `A` fill, `B` the lit tip. Its hitbox is the 4 x 3 core (see physics). */
export const SPIKE_ROWS: readonly string[] = ['..BB..', '.AAAA.', '.AAAA.', 'AAAAAA'];

export function spikeSprite(palette: ArcadePalette): Sprite {
  const base = mixRgb(palette.bad, palette.ink, 0.15);
  return spriteFromRows(SPIKE_ROWS, {A: base, B: mixRgb(base, palette.ink, 0.6)});
}
