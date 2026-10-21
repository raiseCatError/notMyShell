import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {rgb} from '../../scenery.js';

/**
 * Pixel art for the six treats. Each sprite is a square grid (6 or 4 pixels on a side, one pixel = one terminal column by
 * half a row, so it is physically square): `o` the treat's color, `l` a lighter shade, `d` a darker one, `w` white, `k` dark
 * ink for eyes and chips, `.` empty. Every kind has its own silhouette so no match depends on hue.
 */
export const KIND_COLORS: readonly Rgb[] = [rgb(0xff8fb3), rgb(0xffc94d), rgb(0x5fc9b0), rgb(0x8fc4ff), rgb(0xb89cff), rgb(0xff9f86)];
export const KIND_SHAPES = ['♥', '●', '◆', '▲', '■', '★'] as const;
export const KIND_LETTERS = ['F', 'M', 'C', 'B', 'K', 'T'] as const;
export const KIND_NAMES = ['fish', 'milk', 'cookie', 'bone', 'kibble', 'tuna'] as const;
export const INK = rgb(0x231a3d);

/** Sprites by size, in kind order: fish, milk, cookie, bone, kibble, tuna can. */
export const SPRITES: Record<6 | 4, readonly (readonly string[])[]> = {
  6: [
    ['......', '..ooo.', 'o.ooko', 'oooooo', 'o.oooo', '......'],
    ['..ll..', '.oooo.', '.owwo.', '.owwo.', '.oooo.', '.odod.'],
    ['.oooo.', 'okoooo', 'ooooko', 'okoooo', 'ooook.', '.oooo.'],
    ['oo..oo', 'oooooo', '..oo..', '..oo..', 'oooooo', 'oo..oo'],
    ['..oo..', '..oo..', '......', 'oo..oo', 'oo..oo', '......'],
    ['.llll.', 'oooooo', 'owwwwo', 'owwwwo', 'oooooo', '.dddd.'],
  ],
  4: [
    ['..o.', 'ooko', 'oooo', 'o.o.'],
    ['.oo.', 'owwo', 'owwo', 'oooo'],
    ['.oo.', 'okoo', 'oook', '.oo.'],
    ['o..o', 'oooo', 'oooo', 'o..o'],
    ['.o..', 'ooo.', '..oo', '.oo.'],
    ['llll', 'oooo', 'owwo', 'dddd'],
  ],
};

/** The color of one sprite glyph for a treat of `kind`. */
export function spriteColor(glyph: string, kind: number): Rgb | undefined {
  const base = KIND_COLORS[kind % KIND_COLORS.length]!;
  switch (glyph) {
    case 'o': return base;
    case 'l': return mixRgb(base, rgb(0xffffff), 0.55);
    case 'd': return mixRgb(base, INK, 0.4);
    case 'w': return rgb(0xfff6e8);
    case 'k': return INK;
    default: return undefined;
  }
}
