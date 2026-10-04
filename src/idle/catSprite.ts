/**
 * The NMSh cat (Vespyr) as pixels: the approved Welcome/idle sprite, one
 * source for both the bouncing-Vespyr scene and raiseCatError. L is body, E an
 * eye; every two pixel rows make one terminal row (half blocks). Poses are
 * derived from the same pixels so the silhouette (ears, eyes, body, tail,
 * four legs) is always recognizably the same cat.
 */
export const CAT_PIXELS: readonly string[] = [
  '.L...L........',
  '.LLLLL........',
  '.LELEL.......L',
  '.LELEL......L.',
  '.LLLLLLLLLLL..',
  '..LLLLLLLLLL..',
  '..LLLLLLLLLL..',
  '..L.L....L.L..',
];
export const CAT_CELL_WIDTH = 14;
export const CAT_CELL_HEIGHT = 4;
export const CAT_BODY = 0xac96e6;
export const CAT_EYE = 0x161220;
/** The plain-character cat for NO_COLOR / no-color terminals (7 × 3). */
export const CAT_ASCII: readonly string[] = [' /\\_/\\ ', '( o.o )', ' > ^ < '];
export const CAT_ASCII_BLINK: readonly string[] = [' /\\_/\\ ', '( -.- )', ' > ^ < '];

export type CatPose = 'idle' | 'blink' | 'walkA' | 'walkB' | 'tail' | 'crouch' | 'jump' | 'sit' | 'land' | 'paw';

const set = (row: string, column: number, value: string) => `${row.slice(0, column)}${value}${row.slice(column + 1)}`;

export function catPixels(pose: CatPose): string[] {
  const base = [...CAT_PIXELS];
  switch (pose) {
    case 'blink': return base.map((row, i) => (i === 2 || i === 3 ? row.replace(/E/gu, 'L') : row));
    case 'walkA': base[7] = '..LL.....LL...'; return base;
    case 'walkB': base[7] = '...L.L..L.L...'; return base;
    case 'tail': base[0] = set(base[0]!, 13, 'L'); base[1] = set(base[1]!, 12, 'L'); base[2] = '.LELEL......L.'; base[3] = '.LELEL........'; return base;
    case 'paw': base[7] = '..L.L.....LLL.'; base[4] = '.LLLLLLLLLLLLL'; return base;
    case 'sit': base[7] = '..LL......LL..'; base[3] = '.LELEL.......L'; return base;
    case 'jump': base[7] = '..............'; base[6] = '..L.LLLLLL.L..'; base[0] = set(base[0]!, 13, 'L'); return base;
    case 'crouch': case 'land': return ['..............', ...base.slice(0, 6), '..L.L....L.L..'];
    default: return base;
  }
}

export interface CatCell {dx: number; dy: number; glyph: '▀' | '▄'; fg: number; bg?: number}

/** Terminal cells for a pose; the sprite faces left unless mirrored. */
export function catCells(pose: CatPose, facingRight: boolean): CatCell[] {
  const pixels = catPixels(pose);
  const color = (pixel: string) => (pixel === 'L' ? CAT_BODY : pixel === 'E' ? CAT_EYE : undefined);
  const cells: CatCell[] = [];
  for (let row = 0; row < CAT_CELL_HEIGHT; row += 1) {
    for (let column = 0; column < CAT_CELL_WIDTH; column += 1) {
      const source = facingRight ? CAT_CELL_WIDTH - 1 - column : column;
      const top = color(pixels[row * 2]![source]!), bottom = color(pixels[row * 2 + 1]![source]!);
      if (top === undefined && bottom === undefined) continue;
      if (top !== undefined) cells.push({dx: column, dy: row, glyph: '▀', fg: top, ...(bottom !== undefined ? {bg: bottom} : {})});
      else cells.push({dx: column, dy: row, glyph: '▄', fg: bottom!});
    }
  }
  return cells;
}
