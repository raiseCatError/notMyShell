import {background, foreground, type RgbColor} from '../ui/palette.js';
import {GLYPHS, powerlineShapeGlyphs, type PowerlineShape} from '../ui/glyphs.js';
import {fadePromptColor} from './snapshot.js';
import {displayWidth, truncateText} from '../util/text.js';

const RESET = '\u001B[0m';
const NEUTRAL_BACKGROUND = '\u001B[49m';
const FADE_STEPS = 3;

export type {PowerlineShape};

/**
 * Outer-edge styles (Start and End): a shape, optionally faded over three
 * cells. Between separated segments, Connector shapes the closing cap and the
 * optional connector fade shapes the opening cap over a darker left color.
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
  /** Marker-sized: one background cell, no text or padding; geometry still applies. */
  compact?: boolean;
  /** Connector shape for boundaries touching this block, overriding the prompt's. */
  geometry?: PowerlineShape;
  /** Gap fade for boundaries touching this block: a shape, `off`, or the prompt's when unset. */
  fade?: PowerlineShape | 'off';
}

/** The shape a connector fade actually uses, or undefined for solid connectors. */
export type ResolvedConnectorFade = PowerlineShape | undefined;

/** Which neighbor(s) supply the darker transition zones around a separated gap. */
export type ConnectorFadeColors = 'previous' | 'next' | 'mixed';
export const CONNECTOR_FADE_COLORS: readonly ConnectorFadeColors[] = ['previous', 'next', 'mixed'];

export function normalizeConnectorFadeColors(value: unknown): ConnectorFadeColors {
  return CONNECTOR_FADE_COLORS.includes(value as ConnectorFadeColors) ? value as ConnectorFadeColors : 'previous';
}

/** `follow` tracks the Connector shape; a fixed shape is a deliberate override. */
export function resolveConnectorFade(setting: 'follow' | 'off' | PowerlineShape | undefined,
  connector: PowerlineConnectorStyle): ResolvedConnectorFade {
  if (setting === undefined || setting === 'off') return undefined;
  return setting === 'follow' ? connector : setting;
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

/**
 * A boundary takes the geometry of the block it enters when that block sets
 * one, else of the block it leaves, else the prompt's. So a region of
 * overriding blocks owns its entry, internal, and exit boundaries.
 */
function boundary<T>(current: PowerlineBlock, next: PowerlineBlock, pick: (block: PowerlineBlock) => T | undefined, fallback: T): T {
  return pick(next) ?? pick(current) ?? fallback;
}

/** The faded transition background: one darker step of the left segment only. */
export function connectorFadeColor(left: RgbColor): RgbColor {
  return fadePromptColor(left, 0);
}

/** Background escapes for the close (left) and open (right) cells of a Compact faded gap. */
function fadeZones(previous: RgbColor, following: RgbColor, mode: ConnectorFadeColors): {left: string; right: string} {
  const fadeA = background(connectorFadeColor(previous));
  const fadeB = background(connectorFadeColor(following));
  switch (mode) {
    case 'mixed': return {left: fadeA, right: fadeB};
    case 'next': return {left: fadeB, right: fadeB};
    default: return {left: fadeA, right: fadeA};
  }
}

/** Cap colors for a notched (Normal/Wide) gap: only the chosen side(s) darken. */
function gapCapColors(previous: RgbColor, following: RgbColor, mode: ConnectorFadeColors): {left: RgbColor; right: RgbColor} {
  const fadeA = connectorFadeColor(previous);
  const fadeB = connectorFadeColor(following);
  switch (mode) {
    case 'mixed': return {left: fadeA, right: fadeB};
    case 'next': return {left: previous, right: fadeB};
    default: return {left: fadeA, right: following};
  }
}

function blockContent(block: PowerlineBlock, spacing: number): string {
  const body = block.compact ? ' ' : `${' '.repeat(spacing)}${block.text}${' '.repeat(spacing)}`;
  return `${foreground(block.foreground)}${background(block.background)}${body}`;
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
  connectorFade: ResolvedConnectorFade = undefined,
  fadeColors: ConnectorFadeColors = 'previous',
): string {
  if (modules.length === 0) return `${RESET}${NEUTRAL_BACKGROUND}`;
  const gapWidth = gapEnabled ? Math.max(0, Math.trunc(gap)) : 0;
  let content = renderStart(modules[0]!.background, normalizeEdgeStyle(startStyle, 'wedge'));

  for (let index = 0; index < modules.length; index += 1) {
    const current = modules[index]!;
    content += blockContent(current, spacing);
    const next = modules[index + 1];
    if (!next) continue;
    const shape = boundary(current, next, block => block.geometry, connector);
    if (!gapEnabled) {
      // Joined: one transition cell paints the old segment on the left and the
      // next on the right, so the next block has no opening cap. No gap, no fade.
      const glyph = powerlineShapeGlyphs(shape).join;
      if (glyph) content += join(current.background, next.background, glyph);
      continue;
    }
    // Separated: close cap (Connector shape), gap cells, open cap. A connector
    // fade picks only the open cap's shape; fade colors only pick colors.
    const fade = boundary<PowerlineShape | 'off'>(current, next, block => block.fade, connectorFade ?? 'off');
    const close = powerlineShapeGlyphs(shape).close;
    if (fade === 'off') {
      const open = powerlineShapeGlyphs(shape).open;
      if (close) content += `${RESET}${NEUTRAL_BACKGROUND}${foreground(current.background)}${close}`;
      content += `${RESET}${NEUTRAL_BACKGROUND}${' '.repeat(gapWidth)}${RESET}${NEUTRAL_BACKGROUND}`;
      if (open) content += `${foreground(next.background)}${open}`;
      continue;
    }
    const open = powerlineShapeGlyphs(fade).open;
    if (gapWidth === 0) {
      // Compact: the zones touch, so a one-sided mode carries its color across
      // both caps. No width is added; Flat + Flat has nothing to color.
      const {left, right} = fadeZones(current.background, next.background, fadeColors);
      if (close) content += `${RESET}${left}${foreground(current.background)}${close}`;
      if (open) content += `${RESET}${right}${foreground(next.background)}${open}`;
      continue;
    }
    // Normal and Wide: both caps cut their (faded) side into terminal
    // background, forming a notch between them. Wide adds one blank cell.
    // With no cap glyph on either side (Flat + Flat), Normal falls back to one
    // blank cell and Wide to two.
    const {left, right} = gapCapColors(current.background, next.background, fadeColors);
    const wide = gapWidth >= 2;
    const spacer = close || open ? (wide ? 1 : 0) : (wide ? 2 : 1);
    if (close) content += `${RESET}${NEUTRAL_BACKGROUND}${foreground(left)}${close}`;
    if (spacer) content += `${RESET}${NEUTRAL_BACKGROUND}${' '.repeat(spacer)}`;
    if (open) content += `${RESET}${NEUTRAL_BACKGROUND}${foreground(right)}${open}`;
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
  connectorFade: ResolvedConnectorFade = undefined,
  fadeColors: ConnectorFadeColors = 'previous',
): string {
  if (width <= 0 || modules.length === 0) return '';
  const style = normalizeEndStyle(endStyle);
  if (width < 3) {
    const first = modules[0]!;
    return `${foreground(first.foreground)}${truncateText(first.text, width)}${RESET}${NEUTRAL_BACKGROUND}`;
  }
  const render = (blocks: readonly PowerlineBlock[], blockGap: number, blockSpacing: number, enabled: boolean) =>
    renderPowerlineBlocks(blocks, blockGap, blockSpacing, style, enabled, startStyle, connector, connectorFade, fadeColors);

  for (let count = modules.length; count >= 1; count -= 1) {
    const visible = modules.slice(0, count);
    const full = render(visible, gap, spacing, gapEnabled);
    if (displayWidth(full) <= width) {
      if (count < modules.length && displayWidth(full) < width) {
        const last = visible[visible.length - 1]!;
        if (last.compact) return full;
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
