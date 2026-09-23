import {background, foreground, type RgbColor} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {fadePromptColor} from './snapshot.js';
import {displayWidth, truncateText} from '../util/text.js';

const RESET = '\u001B[0m';
const NEUTRAL_BACKGROUND = '\u001B[49m';
const FADE_WEDGE_COUNT = 4;

export type PowerlineEndStyle = 'fadeWedge' | 'wedge' | 'fadeFlat' | 'flat';
/** Pointed opens each independent segment with U+E0D7; flat starts square. */
export type PowerlineStartStyle = 'pointed' | 'flat';

export interface PowerlineBlock {
  text: string;
  foreground: RgbColor;
  background: RgbColor;
}

function normalizeEndStyle(endStyle: PowerlineEndStyle | boolean): PowerlineEndStyle | undefined {
  if (typeof endStyle === 'string') return endStyle;
  return endStyle ? 'fadeFlat' : undefined;
}

function transition(from: RgbColor, to: RgbColor): string {
  return `${RESET}${foreground(from)}${background(to)}${GLYPHS.powerlineTrailing}`;
}

function fadeColors(color: RgbColor): RgbColor[] {
  return Array.from({length: FADE_WEDGE_COUNT - 1}, (_, index) => fadePromptColor(color, index));
}

/** Render native/archived segments with either connected or neutral-gap geometry. */
export function renderPowerlineBlocks(
  modules: readonly PowerlineBlock[],
  gap: number,
  spacing: number,
  endStyle: PowerlineEndStyle | boolean = false,
  gapEnabled = gap > 0,
  startStyle: PowerlineStartStyle = 'pointed',
): string {
  if (modules.length === 0) return `${RESET}${NEUTRAL_BACKGROUND}`;
  const style = normalizeEndStyle(endStyle);
  const gapWidth = gapEnabled ? Math.max(0, Math.trunc(gap)) : 0;
  let content = '';

  for (let index = 0; index < modules.length; index += 1) {
    const current = modules[index]!;
    const isLast = index === modules.length - 1;

    if (index === 0 || gapEnabled) {
      content += `${RESET}${NEUTRAL_BACKGROUND}`;
      if (startStyle === 'pointed') content += `${foreground(current.background)}${GLYPHS.powerlineLeading}`;
    }

    content += `${foreground(current.foreground)}${background(current.background)}${' '.repeat(spacing)}${current.text}${' '.repeat(spacing)}`;

    if (!isLast) {
      if (gapEnabled) {
        content += `${RESET}${NEUTRAL_BACKGROUND}${foreground(current.background)}${GLYPHS.powerlineTrailing}`;
        content += `${RESET}${NEUTRAL_BACKGROUND}${' '.repeat(gapWidth)}`;
      } else {
        // One transition cell paints the old segment on the left and the next
        // segment on the right. The next block therefore has no opening cap.
        content += transition(current.background, modules[index + 1]!.background);
      }
      continue;
    }

    if (style === 'wedge') {
      content += `${RESET}${NEUTRAL_BACKGROUND}${foreground(current.background)}${GLYPHS.powerlineTrailing}`;
    } else if (style === 'fadeFlat') {
      content += `${RESET}${NEUTRAL_BACKGROUND}`;
      const stops = fadeColors(current.background);
      content += `${foreground(stops[0]!)}${GLYPHS.powerlineFade[0]}`;
      content += `${foreground(stops[1]!)}${GLYPHS.powerlineFade[1]}`;
      content += `${foreground(stops[2]!)}${GLYPHS.powerlineFade[2]} `;
    } else if (style === 'fadeWedge') {
      const stops = [current.background, ...fadeColors(current.background)];
      content += transition(stops[0]!, stops[1]!);
      content += transition(stops[1]!, stops[2]!);
      content += transition(stops[2]!, stops[3]!);
      content += `${RESET}${foreground(stops[3]!)}${NEUTRAL_BACKGROUND}${GLYPHS.powerlineTrailing}`;
    }
  }

  return `${content}${RESET}${NEUTRAL_BACKGROUND}`;
}

/** Fit complete segment transitions to the cell budget, omitting decorations first. */
export function fitPowerlineBlocks(
  modules: readonly PowerlineBlock[],
  gap: number,
  spacing: number,
  width: number,
  endStyle: PowerlineEndStyle | boolean = false,
  gapEnabled = gap > 0,
  startStyle: PowerlineStartStyle = 'pointed',
): string {
  if (width <= 0 || modules.length === 0) return '';
  const style = normalizeEndStyle(endStyle);
  if (width < 3) {
    const first = modules[0]!;
    return `${foreground(first.foreground)}${truncateText(first.text, width)}${RESET}${NEUTRAL_BACKGROUND}`;
  }

  for (let count = modules.length; count >= 1; count -= 1) {
    const visible = modules.slice(0, count);
    const full = renderPowerlineBlocks(visible, gap, spacing, style ?? false, gapEnabled, startStyle);
    if (displayWidth(full) <= width) {
      if (count < modules.length && displayWidth(full) < width) {
        const last = visible[visible.length - 1]!;
        const withEllipsis = [...visible.slice(0, -1), {...last, text: `${last.text}…`}];
        const marked = renderPowerlineBlocks(withEllipsis, gap, spacing, style ?? false, gapEnabled, startStyle);
        if (displayWidth(marked) <= width) return marked;
      }
      return full;
    }
  }

  const first = modules[0]!;
  for (let textWidth = Math.min(width, displayWidth(first.text)); textWidth >= 0; textWidth -= 1) {
    const text = truncateText(first.text, textWidth);
    const candidate = renderPowerlineBlocks([{...first, text}], 0, Math.min(spacing, textWidth), style ?? false, true, startStyle);
    if (displayWidth(candidate) <= width) return candidate;
  }

  return `${foreground(first.foreground)}${truncateText(first.text, width)}${RESET}${NEUTRAL_BACKGROUND}`;
}
