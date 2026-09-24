import {background, foreground, type RgbColor} from '../ui/palette.js';
import {GLYPHS, powerlineShapeGlyphs, type PowerlineShape} from '../ui/glyphs.js';
import {fadePromptColor} from './snapshot.js';
import {displayWidth, truncateText} from '../util/text.js';

const RESET = '\u001B[0m';
const NEUTRAL_BACKGROUND = '\u001B[49m';
const FADE_STEPS = 3;

export type {PowerlineShape};

/**
 * Outer-edge styles (Start and End): a shape, optionally faded. Fading exists
 * only on the prompt's outer edges; connectors are always solid shapes.
 */
export type PowerlineEdgeStyle = PowerlineShape | 'fadeWedge' | 'fadeFlat' | 'fadeRounded' | 'fadeSlash';
export type PowerlineEndStyle = PowerlineEdgeStyle;
export type PowerlineStartStyle = PowerlineEdgeStyle;
export type PowerlineConnectorStyle = PowerlineShape;

/** Cycle order for /prompt: each shape followed by its fade, where one exists. */
export const POWERLINE_EDGE_STYLES: readonly PowerlineEdgeStyle[] = [
  'wedge', 'fadeWedge', 'flat', 'fadeFlat', 'rounded', 'fadeRounded', 'slash', 'fadeSlash', 'backslash',
];
export const POWERLINE_SHAPES: readonly PowerlineShape[] = ['wedge', 'flat', 'rounded', 'slash', 'backslash'];

export interface PowerlineBlock {
  text: string;
  foreground: RgbColor;
  background: RgbColor;
}

/** Accepts current ids plus legacy spellings (`pointed`, booleans). */
export function normalizeEdgeStyle(value: unknown, fallback: PowerlineEdgeStyle): PowerlineEdgeStyle {
  if (value === 'pointed') return 'wedge';
  return POWERLINE_EDGE_STYLES.includes(value as PowerlineEdgeStyle) ? value as PowerlineEdgeStyle : fallback;
}

export function normalizeConnectorStyle(value: unknown): PowerlineConnectorStyle {
  if (value === 'pointed') return 'wedge';
  return POWERLINE_SHAPES.includes(value as PowerlineShape) ? value as PowerlineShape : 'wedge';
}

export function edgeParts(style: PowerlineEdgeStyle): {shape: PowerlineShape; fade: boolean} {
  switch (style) {
    case 'fadeWedge': return {shape: 'wedge', fade: true};
    case 'fadeFlat': return {shape: 'flat', fade: true};
    case 'fadeRounded': return {shape: 'rounded', fade: true};
    case 'fadeSlash': return {shape: 'slash', fade: true};
    default: return {shape: style, fade: false};
  }
}

function normalizeEndStyle(endStyle: PowerlineEndStyle | boolean): PowerlineEndStyle {
  if (typeof endStyle === 'string') return endStyle;
  return endStyle ? 'fadeFlat' : 'flat';
}

/** One cell painting `from` on the left and `to` on the right. */
function join(from: RgbColor, to: RgbColor, glyph: string): string {
  return `${RESET}${foreground(from)}${background(to)}${glyph}`;
}

/** Brightest to dimmest same-hue steps for outer-edge fades. */
function fadeColors(color: RgbColor): RgbColor[] {
  return Array.from({length: FADE_STEPS}, (_, index) => fadePromptColor(color, index));
}

function renderStart(first: RgbColor, style: PowerlineStartStyle): string {
  const {shape, fade} = edgeParts(style);
  const glyphs = powerlineShapeGlyphs(shape);
  let content = `${RESET}${NEUTRAL_BACKGROUND}`;
  if (!fade) return glyphs.open ? `${content}${foreground(first)}${glyphs.open}` : content;
  const [bright, middle, dim] = fadeColors(first) as [RgbColor, RgbColor, RgbColor];
  if (shape === 'flat') {
    const cells = [...GLYPHS.powerlineFadeIn];
    return `${content}${foreground(dim)}${cells[0]}${foreground(middle)}${cells[1]}${foreground(bright)}${cells[2]}`;
  }
  // Mirror of the end fade: dim cap, then solid joins brightening into the prompt.
  content += `${foreground(dim)}${glyphs.open}`;
  return `${content}${join(dim, middle, glyphs.join)}${join(middle, bright, glyphs.join)}${join(bright, first, glyphs.join)}`;
}

function renderEnd(last: RgbColor, style: PowerlineEndStyle): string {
  const {shape, fade} = edgeParts(style);
  const glyphs = powerlineShapeGlyphs(shape);
  if (!fade) return glyphs.close ? `${RESET}${NEUTRAL_BACKGROUND}${foreground(last)}${glyphs.close}` : '';
  const stops = [last, ...fadeColors(last)];
  if (shape === 'flat') {
    const cells = [...GLYPHS.powerlineFade];
    return `${RESET}${NEUTRAL_BACKGROUND}${foreground(stops[1]!)}${cells[0]}${foreground(stops[2]!)}${cells[1]}${foreground(stops[3]!)}${cells[2]} `;
  }
  return `${join(stops[0]!, stops[1]!, glyphs.join)}${join(stops[1]!, stops[2]!, glyphs.join)}${join(stops[2]!, stops[3]!, glyphs.join)}`
    + `${RESET}${foreground(stops[3]!)}${NEUTRAL_BACKGROUND}${glyphs.close}`;
}

/**
 * Render Native/archived segments. Start shapes only the outer left edge,
 * End only the outer right edge, Connector only module-to-module geometry,
 * and Gap only whether modules are joined or separated by neutral cells.
 */
export function renderPowerlineBlocks(
  modules: readonly PowerlineBlock[],
  gap: number,
  spacing: number,
  endStyle: PowerlineEndStyle | boolean = false,
  gapEnabled = gap > 0,
  startStyle: PowerlineStartStyle = 'wedge',
  connector: PowerlineConnectorStyle = 'wedge',
): string {
  if (modules.length === 0) return `${RESET}${NEUTRAL_BACKGROUND}`;
  const gapWidth = gapEnabled ? Math.max(0, Math.trunc(gap)) : 0;
  const connectorGlyphs = powerlineShapeGlyphs(connector);
  let content = renderStart(modules[0]!.background, normalizeEdgeStyle(startStyle, 'wedge'));

  for (let index = 0; index < modules.length; index += 1) {
    const current = modules[index]!;
    content += `${foreground(current.foreground)}${background(current.background)}${' '.repeat(spacing)}${current.text}${' '.repeat(spacing)}`;
    const next = modules[index + 1];
    if (!next) continue;
    if (gapEnabled) {
      if (connectorGlyphs.close) content += `${RESET}${NEUTRAL_BACKGROUND}${foreground(current.background)}${connectorGlyphs.close}`;
      content += `${RESET}${NEUTRAL_BACKGROUND}${' '.repeat(gapWidth)}`;
      content += `${RESET}${NEUTRAL_BACKGROUND}`;
      if (connectorGlyphs.open) content += `${foreground(next.background)}${connectorGlyphs.open}`;
    } else if (connectorGlyphs.join) {
      // One transition cell paints the old segment on the left and the next
      // segment on the right. The next block therefore has no opening cap.
      content += join(current.background, next.background, connectorGlyphs.join);
    }
  }

  content += renderEnd(modules[modules.length - 1]!.background, normalizeEndStyle(endStyle));
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
  startStyle: PowerlineStartStyle = 'wedge',
  connector: PowerlineConnectorStyle = 'wedge',
): string {
  if (width <= 0 || modules.length === 0) return '';
  const style = normalizeEndStyle(endStyle);
  if (width < 3) {
    const first = modules[0]!;
    return `${foreground(first.foreground)}${truncateText(first.text, width)}${RESET}${NEUTRAL_BACKGROUND}`;
  }
  const render = (blocks: readonly PowerlineBlock[], blockGap: number, blockSpacing: number, enabled: boolean) =>
    renderPowerlineBlocks(blocks, blockGap, blockSpacing, style, enabled, startStyle, connector);

  for (let count = modules.length; count >= 1; count -= 1) {
    const visible = modules.slice(0, count);
    const full = render(visible, gap, spacing, gapEnabled);
    if (displayWidth(full) <= width) {
      if (count < modules.length && displayWidth(full) < width) {
        const last = visible[visible.length - 1]!;
        const withEllipsis = [...visible.slice(0, -1), {...last, text: `${last.text}…`}];
        const marked = render(withEllipsis, gap, spacing, gapEnabled);
        if (displayWidth(marked) <= width) return marked;
      }
      return full;
    }
  }

  const first = modules[0]!;
  for (let textWidth = Math.min(width, displayWidth(first.text)); textWidth >= 0; textWidth -= 1) {
    const text = truncateText(first.text, textWidth);
    const candidate = render([{...first, text}], 0, Math.min(spacing, textWidth), true);
    if (displayWidth(candidate) <= width) return candidate;
  }

  return `${foreground(first.foreground)}${truncateText(first.text, width)}${RESET}${NEUTRAL_BACKGROUND}`;
}
