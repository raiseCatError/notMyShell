import type {PixelBuffer} from '../../Canvas.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {ArcadePalette} from '../../palette.js';
import {CAT_ASCII, CAT_ASCII_BLINK} from '../../../idle/catSprite.js';

/**
 * A mini Vespyr for a board cell: the head and ears of the NMSh cat's sprite (`idle/catSprite.ts`), five pixels wide and
 * four tall (two terminal rows), with a tail that can flick. L is body, E an eye, S shade; every other character is clear.
 */
const HEAD: readonly string[] = [
  'L...L',
  'LLLLL',
  'LELEL',
  '.SSS.',
];
const HEAD_BLINK: readonly string[] = [
  'L...L',
  'LLLLL',
  'LSSSL',
  '.SSS.',
];

/** Draw the cat into `buffer` with the head's top-left pixel at (x, y); `tail` is 0 (rest), 1 (flicked) or -1 (none). */
export function drawMiniCat(buffer: PixelBuffer, x: number, y: number, palette: ArcadePalette, options: {blink: boolean; tail: -1 | 0 | 1}): void {
  const colors: Record<string, Rgb> = {L: palette.cat.body, E: palette.cat.eye, S: palette.cat.shade};
  const rows = options.blink ? HEAD_BLINK : HEAD;
  rows.forEach((row, dy) => [...row].forEach((glyph, dx) => { const color = colors[glyph]; if (color) buffer.set(x + dx, y + dy, color); }));
  if (options.tail >= 0) {
    const tailX = x + 5;
    const base = y + 3 - options.tail * 2;
    buffer.set(tailX, base, palette.cat.body);
    buffer.set(tailX, base + 1, palette.cat.shade);
  }
}

/** Text forms for NO_COLOR and Safe Glyphs, sized to a cell (`large` 7 x 3, `medium` 6 x 2, one row otherwise). */
export function textCat(kind: 'large' | 'medium' | 'compact' | 'tight' | 'mini', state: {blink: boolean; conflict: boolean}): string[] {
  const eyes = state.conflict ? '!' : state.blink ? '-' : 'o';
  if (kind === 'large') {
    const base = state.blink ? CAT_ASCII_BLINK : CAT_ASCII;
    return [base[0]!, `( ${eyes}.${eyes} )`, base[2]!];
  }
  if (kind === 'medium') return [CAT_ASCII[0]!.slice(0, 6), ` (${eyes}.${eyes})`];
  const face = state.conflict ? '^!^' : state.blink ? '-.-' : '^.^';
  if (kind === 'mini') return [state.conflict ? '^!' : '^^'];
  return [face];
}
