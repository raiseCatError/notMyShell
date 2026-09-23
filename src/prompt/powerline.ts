import {background, foreground, type RgbColor} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {displayWidth, truncateText} from '../util/text.js';

const RESET = '\u001B[0m';
const NEUTRAL_BACKGROUND = '\u001B[49m';

export type PowerlineEndStyle = 'fadeWedge' | 'wedge' | 'fadeFlat' | 'flat';

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
  endStyle: PowerlineEndStyle | boolean = false,
): string {
  const style: PowerlineEndStyle | undefined = typeof endStyle === 'string' ? endStyle : endStyle ? 'fadeFlat' : undefined;
  let content = '';
  for (let index = 0; index < modules.length; index += 1) {
    const current = modules[index]!;
    // Leading edge points into this segment; both edges sit on neutral
    // background so the terminal background remains visible through gaps.
    content += `${RESET}${NEUTRAL_BACKGROUND}${' '.repeat(index > 0 ? gap : 0)}${foreground(current.background)}${GLYPHS.powerlineLeading}`;
    content += `${foreground(current.foreground)}${background(current.background)}${' '.repeat(spacing)}${current.text}${' '.repeat(spacing)}`;
    const isLast = index === modules.length - 1;
    if (!isLast || style === 'wedge' || style === 'fadeWedge') {
      content += `${RESET}${NEUTRAL_BACKGROUND}${foreground(current.background)}${GLYPHS.powerlineTrailing}`;
    }
  }
  if (style === 'fadeFlat' && modules.length > 0) {
    const last = modules[modules.length - 1]!;
    content += `${RESET}${NEUTRAL_BACKGROUND}${foreground(last.background)}${GLYPHS.powerlineFade} `;
  } else if (style === 'fadeWedge' && modules.length > 0) {
    // Decreasing chevrons keep the fade pointed and taper toward the neutral
    // terminal background instead of switching to rectangular shade blocks.
    const last = modules[modules.length - 1]!;
    const factors = [0.68, 0.42, 0.2];
    content += GLYPHS.powerlineFadeWedge.map((glyph, index) => {
      const factor = factors[index] ?? 0.2;
      const faded = {
        red: Math.round(last.background.red * factor),
        green: Math.round(last.background.green * factor),
        blue: Math.round(last.background.blue * factor),
      };
      return `${RESET}${NEUTRAL_BACKGROUND}${foreground(faded)}${glyph}`;
    }).join('');
  }
  return `${content}${RESET}${NEUTRAL_BACKGROUND}`;
}

/** Fit complete module edges to a cell budget, omitting rather than orphaning a cap. */
export function fitPowerlineBlocks(
  modules: readonly PowerlineBlock[],
  gap: number,
  spacing: number,
  width: number,
  endStyle: PowerlineEndStyle | boolean = false,
): string {
  if (width <= 0 || modules.length === 0) return '';
  const style: PowerlineEndStyle | undefined = typeof endStyle === 'string' ? endStyle : endStyle ? 'fadeFlat' : undefined;
  if (width < 3) {
    const first = modules[0]!;
    return `${foreground(first.foreground)}${truncateText(first.text, width)}${RESET}${NEUTRAL_BACKGROUND}`;
  }
  const tail = style === 'fadeFlat' ? `${GLYPHS.powerlineFade} ` : style === 'fadeWedge' ? `${GLYPHS.powerlineTrailing}${GLYPHS.powerlineFadeWedge.join('')}` : style === 'wedge' ? GLYPHS.powerlineTrailing : '';
  const renderTail = Boolean(tail) && width > displayWidth(tail);
  const tailWidth = renderTail ? displayWidth(tail) : 0;
  const bodyWidth = Math.max(0, width - tailWidth);

  for (let count = modules.length; count >= 1; count -= 1) {
    const visible = modules.slice(0, count);
    const full = renderPowerlineBlocks(visible, gap, spacing, renderTail ? style! : false);
    if (displayWidth(full) <= width) {
      if (count < modules.length && displayWidth(full) < width) {
        const last = visible[visible.length - 1]!;
        const withEllipsis = [...visible.slice(0, -1), {...last, text: `${last.text}…`}];
        const marked = renderPowerlineBlocks(withEllipsis, gap, spacing, renderTail ? style! : false);
        if (displayWidth(marked) <= width) return marked;
      }
      return full;
    }
  }

  const first = modules[0]!;
  const innerSpacing = Math.min(spacing, Math.floor(Math.max(0, bodyWidth - 3) / 2));
  const textRoom = Math.max(0, bodyWidth - 2 - innerSpacing * 2);
  const text = truncateText(first.text, textRoom);
  return renderPowerlineBlocks([{...first, text}], 0, innerSpacing, renderTail ? style! : false);
}
