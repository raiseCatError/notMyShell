import {background, foreground, type RgbColor} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {displayWidth, truncateText} from '../util/text.js';

const RESET = '\u001B[0m';
const NEUTRAL_BACKGROUND = '\u001B[49m';

export interface PowerlineBlock {
  text: string;
  foreground: RgbColor;
  background: RgbColor;
}

/** Render module bodies and the neutral-background Powerline edges between them. */
export function renderPowerlineBlocks(
  modules: readonly PowerlineBlock[],
  gap: number,
  spacing: number,
  fadeTail = false,
): string {
  let content = '';
  for (let index = 0; index < modules.length; index += 1) {
    const current = modules[index]!;
    if (index > 0) {
      content += `${RESET}${NEUTRAL_BACKGROUND}${' '.repeat(gap)}${foreground(current.background)}${GLYPHS.powerlineReverse}`;
    }
    content += `${foreground(current.foreground)}${background(current.background)}${' '.repeat(spacing)}${current.text}${' '.repeat(spacing)}`;
    if (index < modules.length - 1) {
      content += `${RESET}${NEUTRAL_BACKGROUND}${foreground(current.background)}${GLYPHS.powerlineTransition}`;
    }
  }
  if (fadeTail && modules.length > 0) {
    const last = modules[modules.length - 1]!;
    content += `${RESET}${NEUTRAL_BACKGROUND}${foreground(last.background)}${GLYPHS.powerlineFade} `;
  }
  return content;
}

/** Fit complete module edges to a cell budget, omitting rather than orphaning a cap. */
export function fitPowerlineBlocks(
  modules: readonly PowerlineBlock[],
  gap: number,
  spacing: number,
  width: number,
  fadeTail = false,
): string {
  if (width <= 0 || modules.length === 0) return '';
  const renderTail = fadeTail && width > displayWidth(`${GLYPHS.powerlineFade} `);
  const tailWidth = renderTail ? displayWidth(`${GLYPHS.powerlineFade} `) : 0;
  const bodyWidth = Math.max(0, width - tailWidth);

  for (let count = modules.length; count >= 1; count -= 1) {
    const visible = modules.slice(0, count);
    const full = renderPowerlineBlocks(visible, gap, spacing, renderTail);
    if (displayWidth(full) <= width) {
      if (count < modules.length && displayWidth(full) < width) {
        const last = visible[visible.length - 1]!;
        const withEllipsis = [...visible.slice(0, -1), {...last, text: `${last.text}…`}];
        const marked = renderPowerlineBlocks(withEllipsis, gap, spacing, renderTail);
        if (displayWidth(marked) <= width) return marked;
      }
      return full;
    }
  }

  const first = modules[0]!;
  const innerSpacing = Math.min(spacing, Math.floor(Math.max(0, bodyWidth - 1) / 2));
  const textRoom = Math.max(0, bodyWidth - innerSpacing * 2);
  const text = truncateText(first.text, textRoom);
  return renderPowerlineBlocks([{...first, text}], 0, innerSpacing, renderTail);
}
