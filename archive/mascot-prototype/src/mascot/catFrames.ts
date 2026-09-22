import type {CatColorRole} from './catPalettes.js';

export const CAT_WIDTH = 8;
export const CAT_HEIGHT = 3;

export type CatFrameName =
  | 'idle'
  | 'blink'
  | 'tail-low'
  | 'tail-high'
  | 'walk-left-a'
  | 'walk-left-b'
  | 'walk-right-a'
  | 'walk-right-b'
  | 'sleep-a'
  | 'sleep-b'
  | 'wake-a'
  | 'wake-b';

export interface CatCell {
  glyph: string;
  role?: CatColorRole;
}

export interface CatFrame {
  name: CatFrameName;
  rows: CatCell[][];
}

function roleFor(name: CatFrameName, row: number, glyph: string, rowText: string): CatColorRole | undefined {
  if (glyph === ' ') return undefined;
  if (name.startsWith('sleep') && row === 0) return 'sleep';
  if (glyph === '⠂' || glyph === '⠒') return 'detail';
  if (row === 1 && glyph === '▄' && (rowText.includes('⠂') || rowText.includes('⠒'))) return 'detail';
  if (glyph === '█' || glyph === '▀' || glyph === '▄') return 'body';
  return 'outline';
}

function defineFrame(name: CatFrameName, rows: [string, string, string]): CatFrame {
  const cells = rows.map((row, rowIndex) => {
    const glyphs = Array.from(row);
    if (glyphs.length !== CAT_WIDTH) throw new Error(`${name} row must be ${CAT_WIDTH} cells wide`);
    return glyphs.map(glyph => ({glyph, role: roleFor(name, rowIndex, glyph, row)}));
  });
  return {name, rows: cells};
}

export const CAT_FRAMES: Record<CatFrameName, CatFrame> = {
  idle: defineFrame('idle', [
    '▗▄   ▄▖⡇',
    '▐█⠂▄⠂█▌⢸',
    '▝▀▄█▄▀▘⠘',
  ]),
  blink: defineFrame('blink', [
    '▗▄   ▄▖⡇',
    '▐█⠒▄⠒█▌⢸',
    '▝▀▄█▄▀▘⠘',
  ]),
  'tail-low': defineFrame('tail-low', [
    '▗▄   ▄▖⡄',
    '▐█⠂▄⠂█▌⢸',
    '▝▀▄█▄▀▘⠸',
  ]),
  'tail-high': defineFrame('tail-high', [
    '▗▄   ▄▖⢀',
    '▐█⠂▄⠂█▌⡇',
    '▝▀▄█▄▀▘⠘',
  ]),
  'walk-left-a': defineFrame('walk-left-a', [
    '⣀▗▄  ▄▖ ',
    '⡇▐█⠂▄⠂█▌',
    '⠘ ▀▄▀▄▀ ',
  ]),
  'walk-left-b': defineFrame('walk-left-b', [
    '⣀▗▄  ▄▖ ',
    '⡇▐█⠂▄⠂█▌',
    '⠃ ▄▀▄▀▄ ',
  ]),
  'walk-right-a': defineFrame('walk-right-a', [
    ' ▗▄  ▄▖⣀',
    '▐█⠂▄⠂█▌⡇',
    ' ▀▄▀▄▀ ⠃',
  ]),
  'walk-right-b': defineFrame('walk-right-b', [
    ' ▗▄  ▄▖⣀',
    '▐█⠂▄⠂█▌⡇',
    ' ▄▀▄▀▄ ⠘',
  ]),
  'sleep-a': defineFrame('sleep-a', [
    '    ⠐⠠  ',
    ' ▄▀▄▀▄⣀ ',
    '▝█████▘ ',
  ]),
  'sleep-b': defineFrame('sleep-b', [
    '   ⠐ ⠠  ',
    ' ▄▀▄▀▄⣀ ',
    '▝█████▘ ',
  ]),
  'wake-a': defineFrame('wake-a', [
    ' ▗▄ ▄▖⡄ ',
    ' ▐█▄█▌⢸ ',
    ' ▝▀▄▄▀▘ ',
  ]),
  'wake-b': defineFrame('wake-b', [
    '▗▄   ▄▖⡄',
    '▐█⠂▄⠂█▌⢸',
    '▝▀▄█▄▀▘⠘',
  ]),
};
