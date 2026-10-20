import type {Rgb} from '../../../chroma/escape.js';
import {mixRgb} from '../../../chroma/chroma.js';
import {catPixels} from '../../../idle/catSprite.js';
import {spriteFromRows, type Sprite} from '../../Canvas.js';
import type {ArcadePalette} from '../../palette.js';
import type {ObstacleKind} from './course.js';

/**
 * Vespyr's poses and the obstacle art, all authored as pixel rows. Every cat pose starts from `catPixels()` (so the
 * ears, eyes, body, tail and four legs are the approved silhouette) and changes only legs, tail, ears and eyelids.
 * The sprites face left like the source art; the renderer mirrors them to run to the right.
 */
export type CatShape = 'run' | 'air' | 'fall' | 'land' | 'duck' | 'hit' | 'idle' | 'blink';

const LEGS = ['..L.L....L.L..', '.L.L......L.L.', '.L..L....L..L.', '...LL....LL...', '..L.L....L.L..', '...L.L..L.L...'] as const;
/** The cat is lifted a pixel in the airy half of the gallop. */
export const RUN_BOB: readonly number[] = [0, 0, 1, 1, 0, 0];
export const RUN_FRAMES = LEGS.length;
const DUCK_LEGS = ['..L.L....L.L..', '...LL...LL....'] as const;

const put = (rows: string[], row: number, column: number, value: string): void => {
  const text = rows[row] ?? '';
  rows[row] = `${text.slice(0, column)}${value}${text.slice(column + 1)}`;
};

export interface CatLook {
  shape: CatShape;
  /** Gallop frame (from distance) for run and duck. */
  frame: number;
  /** Tail position 0..3 (from distance, or time when idle). */
  tail: number;
  /** An ear flick (a brief moment in the idle and run animation). */
  twitch: boolean;
}

/** The pose's pixel rows (each exactly SPRITE_W wide; a duck is shorter). */
export function catRows(look: CatLook): string[] {
  const idle = catPixels('idle');
  let rows: string[];
  switch (look.shape) {
    case 'air': rows = catPixels('jump'); break;
    case 'fall': rows = idle; rows[7] = '.L.L......L.L.'; break;
    case 'land': rows = catPixels('land'); break;
    case 'blink': rows = catPixels('sit').map((row, index) => (index === 2 || index === 3 ? row.replace(/E/gu, 'L') : row)); break;
    case 'hit': rows = catPixels('blink'); rows[7] = '.L.L......L.L.'; break;
    case 'duck':
      rows = ['.LLLLL......L.', '.LELELLLLLLLL.', '..LLLLLLLLLL..', '..LLLLLLLLLL..', DUCK_LEGS[look.frame % 2 === 0 ? 0 : 1]];
      return rows;
    case 'run': rows = idle; rows[7] = LEGS[look.frame % RUN_FRAMES]!; break;
    default: rows = catPixels('sit'); break;
  }
  if (look.shape === 'run' || look.shape === 'idle' || look.shape === 'blink') {
    // Tail: base, flicked up, base, low.
    const tail = look.tail % 4;
    if (tail === 1) { put(rows, 0, 13, 'L'); put(rows, 1, 12, 'L'); put(rows, 2, 13, '.'); put(rows, 3, 12, '.'); }
    if (tail === 3) { put(rows, 2, 13, '.'); put(rows, 3, 12, '.'); put(rows, 3, 13, 'L'); put(rows, 4, 12, 'L'); }
  }
  if (look.twitch) { put(rows, 0, 5, '.'); put(rows, 0, 6, 'L'); }
  return rows;
}

export function catSprite(look: CatLook, palette: ArcadePalette): Sprite {
  const rows = catRows(look);
  const last = rows.length - 1;
  // Legs in the shade, the lower belly lit, everything else the body color.
  const shaded = rows.map((row, index) => [...row].map((char, column) => {
    if (char === 'E') return 'E';
    if (char !== 'L') return char;
    if (index === last && look.shape !== 'duck') return 'S';
    if (index === last - 1 && column >= 4 && column <= 8) return 'B';
    return 'L';
  }).join(''));
  return spriteFromRows(shaded, {L: palette.cat.body, S: palette.cat.shade, B: palette.cat.belly, E: palette.cat.eye});
}

// ---- obstacles ----------------------------------------------------------------------------------------------------

/** A = base color, B = darker accent, '.' = see-through (a slit in a crate, the hole in a ball of yarn). */
const ART: Readonly<Record<ObstacleKind, readonly string[]>> = {
  crates: ['AAAAAA', 'AB..BA', 'AAAAAA', 'AAAAAA', 'AB..BA', 'AAAAAA'],
  crate: ['AAAAAA', 'AB..BA', 'AAAAAA'],
  yarn: ['.AAA.', 'ABAAA', 'AABBA', 'AAABA', '.AAA.'],
  stones: ['..AA....', '.AABBA..', 'AAAABAAA'],
  cans: ['.AA.', 'AAAA', 'ABBA', 'ABBA', 'AAAA'],
  bird: ['.A......A.', '.AA....AA.', '..AAAAAA..', '.BAAAA....'],
  plane: ['....AAAA', 'AAAAAABA', '...AAA..'],
};
const BIRD_DOWN = ['..........', '..AAAAAA..', 'BAAAAAAAA.', '.A......A.'];

/** Base colors for each obstacle, all from the palette. */
export function obstacleColor(kind: ObstacleKind, palette: ArcadePalette): Rgb {
  switch (kind) {
    case 'crates': case 'crate': return palette.warn;
    case 'yarn': return palette.accent;
    case 'stones': return mixRgb(palette.muted, palette.ink, 0.35);
    case 'cans': return palette.ink;
    case 'bird': return palette.bad;
    default: return palette.haze;
  }
}

/** One unit of an obstacle; `flap` picks the bird's wing. */
export function obstacleSprite(kind: ObstacleKind, palette: ArcadePalette, flap = false): Sprite {
  const base = obstacleColor(kind, palette);
  const rows = kind === 'bird' && flap ? BIRD_DOWN : ART[kind];
  return spriteFromRows(rows, {A: base, B: mixRgb(base, palette.deep, 0.5)});
}

/** Rows of an obstacle's art, for tests (width and height must match the kind's physics box). */
export const obstacleRows = (kind: ObstacleKind, flap = false): readonly string[] => (kind === 'bird' && flap ? BIRD_DOWN : ART[kind]);
