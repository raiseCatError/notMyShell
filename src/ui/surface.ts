import {
  backgroundOf, foregroundOf, gradientCells, resolveColor, sampleGradient, type ColorRef, type Gradient,
} from '../chroma/chroma.js';
import {colorEscape} from '../chroma/escape.js';
import {graphemes} from '../input/inputLayout.js';
import {displayWidth, repeatToWidth, truncateAnsi} from '../util/text.js';
import {getCurrentGlyphMode} from './glyphs.js';

/**
 * Surface geometry: where a panel's cells are (frame, padding, inset, width,
 * alignment). Which colors those cells get is Chroma's job; a surface only
 * holds color references. Frame and fill are independent.
 */
export type FrameStyle = 'none' | 'topLine' | 'square' | 'rounded' | 'double' | 'heavy';
/** A single color reference, or a left-to-right gradient. */
export type Paint = ColorRef | Gradient;

export interface SurfaceSpec {
  frame?: FrameStyle;
  frameColor?: Paint;
  fill?: Paint;
  /** Blank columns/rows between the frame and the content. */
  padding?: {x?: number; y?: number};
  /** Columns left of the surface. */
  inset?: number;
  /** `fill` spans the available width; `content` hugs the widest row. */
  width?: 'fill' | 'content';
  /** Where a `content`-width surface sits in the available width. */
  align?: 'left' | 'center' | 'right';
}

const RESET = '\u001B[0m';
const SGR = /^\u001B\[[0-9;]*m/u;

interface Box {tl: string; tr: string; bl: string; br: string; h: string; v: string}
const BOXES: Record<'square' | 'rounded' | 'double' | 'heavy', Box> = {
  square: {tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│'},
  rounded: {tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│'},
  double: {tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║'},
  heavy: {tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃'},
};
const SAFE_BOX: Box = {tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|'};

function isGradient(paint: Paint): paint is Gradient {
  return 'stops' in paint;
}

function boxFor(frame: 'square' | 'rounded' | 'double' | 'heavy'): Box {
  return getCurrentGlyphMode() === 'nerd' ? BOXES[frame] : SAFE_BOX;
}

/** Foreground escape for cell `index` of `count` across a frame edge. */
function edgeColor(paint: Paint | undefined, index: number, count: number): string {
  if (!paint) return '';
  if (!isGradient(paint)) return foregroundOf(paint);
  return colorEscape(38, sampleGradient(paint, count <= 1 ? 0 : index / (count - 1)));
}

/** Background escape for a column of a filled row. */
function cellFill(fill: Paint, column: number, width: number): string {
  return isGradient(fill)
    ? colorEscape(48, gradientCells(fill, Math.max(1, width))[Math.min(column, Math.max(0, width - 1))]!)
    : backgroundOf(fill);
}

/** Paints `row` (already ANSI-styled) onto a fill, keeping the fill behind every glyph and restoring it after resets. */
function fillRow(row: string, fill: Paint, width: number, startColumn: number): string {
  let out = '';
  let column = startColumn;
  let index = 0;
  let plainRun = '';
  const flush = () => {
    for (const glyph of graphemes(plainRun)) {
      out += `${cellFill(fill, column, width)}${glyph}`;
      column += displayWidth(glyph);
    }
    plainRun = '';
  };
  while (index < row.length) {
    const match = row[index] === '\u001B' ? SGR.exec(row.slice(index)) : null;
    if (match) { flush(); out += match[0]; index += match[0].length; continue; }
    const codePoint = row.codePointAt(index)!;
    const character = String.fromCodePoint(codePoint);
    plainRun += character;
    index += character.length;
  }
  flush();
  return `${out}${RESET}`;
}

/** A run of `glyph` across `count` cells starting at edge position `from` of `width`; solid paints emit one escape. */
function run(glyph: string, count: number, from: number, width: number, frameColor: Paint | undefined): string {
  if (count <= 0) return '';
  if (frameColor && isGradient(frameColor)) {
    return Array.from({length: count}, (_, offset) => `${edgeColor(frameColor, from + offset, width)}${glyph}`).join('');
  }
  return `${edgeColor(frameColor, 0, 1)}${repeatToWidth(glyph, count)}`;
}

function ruleRow(left: string, glyph: string, right: string, width: number, frameColor: Paint | undefined): string {
  if (!left) return `${run(glyph, width, 0, width, frameColor)}${RESET}`;
  return `${run(left, 1, 0, width, frameColor)}${run(glyph, width - 2, 1, width, frameColor)}${run(right, 1, width - 1, width, frameColor)}${RESET}`;
}

/**
 * Lays `rows` out as a surface within `columns`. Narrow widths degrade in a
 * fixed order: padding first, then boxed frames fall back to a top line.
 * With no fill, padding or side frame, rows pass through unchanged.
 */
export function renderSurface(rows: readonly string[], columns: number, spec: SurfaceSpec = {}): string[] {
  const total = Math.max(1, columns);
  const inset = Math.max(0, Math.min(spec.inset ?? 0, total - 1));
  const available = total - inset;
  let frame: FrameStyle = spec.frame ?? 'none';
  let padX = Math.max(0, spec.padding?.x ?? 0);
  const padY = Math.max(0, spec.padding?.y ?? 0);
  const widest = Math.max(0, ...rows.map(row => displayWidth(row)));
  const sides = () => (frame === 'square' || frame === 'rounded' || frame === 'double' || frame === 'heavy' ? 2 : 0);

  let width = spec.width === 'content' ? Math.min(available, widest + 2 * padX + sides()) : available;
  while (width - sides() - 2 * padX < 1) {
    if (padX > 0) padX -= 1;
    else if (sides() > 0) frame = 'topLine';
    else break;
  }
  if (spec.width === 'content') width = Math.min(available, widest + 2 * padX + sides());
  const inner = Math.max(1, width - sides() - 2 * padX);
  const align = spec.align ?? 'left';
  const slack = available - width;
  const lead = ' '.repeat(inset + (align === 'center' ? Math.floor(slack / 2) : align === 'right' ? slack : 0));

  const needsWidth = spec.fill !== undefined || sides() > 0;
  const boxed = sides() > 0;
  const box = boxed ? boxFor(frame as 'square') : undefined;
  const body = [...Array<string>(padY).fill(''), ...rows, ...Array<string>(padY).fill('')].map((row, index) => {
    const isBlank = index < padY || index >= padY + rows.length;
    const content = truncateAnsi(isBlank ? '' : row, inner);
    if (!needsWidth && padX === 0) return `${lead}${content}`;
    const middle = `${' '.repeat(padX)}${content}${' '.repeat(padX + Math.max(0, inner - displayWidth(content)))}`;
    const painted = spec.fill ? fillRow(middle, spec.fill, width, boxed ? 1 : 0) : middle;
    if (!box) return `${lead}${painted}`;
    return `${lead}${edgeColor(spec.frameColor, 0, width)}${box.v}${RESET}${painted}${edgeColor(spec.frameColor, width - 1, width)}${box.v}${RESET}`;
  });

  const topGlyph = getCurrentGlyphMode() === 'nerd' ? '─' : '-';
  const top = box ? [`${lead}${ruleRow(box.tl, box.h, box.tr, width, spec.frameColor)}`]
    : frame === 'topLine' ? [`${lead}${ruleRow('', topGlyph, '', width, spec.frameColor)}`] : [];
  const bottom = box ? [`${lead}${ruleRow(box.bl, box.h, box.br, width, spec.frameColor)}`] : [];
  return [...top, ...body, ...bottom];
}
