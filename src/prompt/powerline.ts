import {readableTextTone, samplePromptTreatment, treatmentFor, type Treatment, type TreatmentSettings} from '../chroma/treatment.js';
import {fromOklch, mixOklch, readableForeground, toOklch} from '../chroma/color.js';
import {graphemes} from '../input/inputLayout.js';
import {background, foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {defaultStyleProfiles, type PromptStyle, type StyleProfiles} from './styles.js';
import {getCurrentGlyphMode, GLYPHS, powerlineShapeGlyphs, type PowerlineShape} from '../ui/glyphs.js';
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

export {PROMPT_STYLES, PROMPT_STYLE_LABELS, normalizePromptStyle, type PromptStyle} from './styles.js';

export interface PowerlineBlock {
  /** Present when this block may receive Chroma; protected status/Git-state blocks never carry it. */
  treatment?: TreatmentSettings;
  /** Visual style; every block of one prompt carries the same one. Missing means Powerline. */
  style?: PromptStyle;
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

/**
 * The renderer paints a list of cells rather than a string, so geometry can
 * be oriented structurally. `sgr` is the exact escape prefix of the normal
 * orientation; `foreground`/`background` are the cell's resolved colors
 * (background `undefined` is the terminal's own). `text` cells hold a whole
 * block body and are never reflected; `glyph` cells are single geometry
 * glyphs; `space` cells are symmetric fill. Empty-text cells only carry SGR.
 */
interface Cell {
  sgr: string;
  text: string;
  kind: 'glyph' | 'text' | 'space';
  background?: RgbColor;
  foreground?: RgbColor;
}

class Painter {
  readonly cells: Cell[] = [];
  add(sgr: string, text: string, zone: Zone, color?: RgbColor, kind: Cell['kind'] = 'glyph'): void {
    this.cells.push({sgr, text, kind, ...(zone ? {background: zone} : {}), ...(color ? {foreground: color} : {})});
  }
}

/** Horizontal reflection of every geometry glyph, in both glyph modes. */
const REFLECTED_GLYPHS: Readonly<Record<string, string>> = {
  '\ue0b0': '\ue0b2', '\ue0b2': '\ue0b0', '\ue0d7': '\ue0d6', '\ue0d6': '\ue0d7',
  '\ue0b1': '\ue0b3', '\ue0b3': '\ue0b1', '\ue0bb': '\ue0b9', '\ue0b9': '\ue0bb', '\ue0b5': '\ue0b7', '\ue0b7': '\ue0b5',
  '[': ']', ']': '[',
  '\ue0b4': '\ue0b6', '\ue0b6': '\ue0b4',
  '\ue0b8': '\ue0ba', '\ue0ba': '\ue0b8', '\ue0bc': '\ue0be', '\ue0be': '\ue0bc',
  '<': '>', '>': '<', '(': ')', ')': '(', '/': '\\', '\\': '/',
};

/** Reflect every geometry glyph in a glyph cell, leaving embedded SGR sequences intact. */
function reflectGlyphs(text: string): string {
  return text.split(/(\u001B\[[0-9;]*m)/u).map(part => part.startsWith('\u001B[') ? part
    : [...part].map(glyph => REFLECTED_GLYPHS[glyph] ?? glyph).join('')).join('');
}

/** Normal orientation: the exact escape sequence this renderer has always produced. */
function serialize(cells: readonly Cell[]): string {
  return cells.map(cell => `${cell.sgr}${cell.text}`).join('');
}

/**
 * Mirrored orientation: the horizontal reflection of the cells. Cell order
 * reverses and geometry glyphs reflect; each cell keeps its colors, and
 * block text keeps its reading order.
 */
function serializeReflected(cells: readonly Cell[]): string {
  return cells.filter(cell => cell.text).reverse().map(cell => {
    const text = cell.kind === 'glyph' ? reflectGlyphs(cell.text) : cell.text;
    return `${RESET}${zoneBackground(cell.background)}${cell.foreground ? foreground(cell.foreground) : ''}${text}`;
  }).join('');
}

/** One cell painting `from` on the left and `to` on the right. */
function join(paint: Painter, from: RgbColor, to: RgbColor, glyph: string): void {
  paint.add(`${RESET}${foreground(from)}${background(to)}`, glyph, to, from);
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

/** Zone for both cap cells of a Compact faded gap: one side only (Mixed resolves to Previous). */
function fadeZone(previous: RgbColor, following: RgbColor, mode: ConnectorFadeColors): RgbColor {
  return connectorFadeColor(mode === 'next' ? following : previous);
}

/** A zone color between two segments; `undefined` is the terminal's default background. */
type Zone = RgbColor | undefined;

function zoneBackground(zone: Zone): string {
  return zone ? background(zone) : NEUTRAL_BACKGROUND;
}

/**
 * One transition cell reading `from` on the left and `to` on the right.
 * Exit cells (A side) use the shape's close glyph painted in `from`; entry
 * cells (B side) use its open glyph painted in `to`, so each glyph's filled
 * half sits on the correct side. A Flat shape has no glyph: the cell is a
 * plain space in the zone it opens onto (exit: `to`, entry: `from`).
 */
function transitionCell(paint: Painter, from: Zone, to: Zone, shape: PowerlineShape, side: 'exit' | 'entry'): void {
  const glyphs = powerlineShapeGlyphs(shape);
  const glyph = side === 'exit' ? glyphs.close : glyphs.open;
  const painted = side === 'exit' ? from : to;
  const behind = side === 'exit' ? to : from;
  if (!glyph || !painted) {
    const zone = side === 'exit' ? to : from;
    paint.add(`${RESET}${zoneBackground(zone)}`, ' ', zone, undefined, 'space');
    return;
  }
  paint.add(`${RESET}${zoneBackground(behind)}${foreground(painted)}`, glyph, behind, painted);
}

function solidCell(paint: Painter, zone: Zone): void {
  paint.add(`${RESET}${zoneBackground(zone)}`, ' ', zone, undefined, 'space');
}

/**
 * Normal/Wide transition cells between A and B. Normal is three cells,
 * Wide four; Connector shapes the A-side cells, the connector fade the
 * B-side cells (and Normal Mixed's darkA/darkB bridge).
 *   Normal Previous  [A|darkA][darkA][darkA|B]
 *   Normal Next      [A|darkB][darkB][darkB|B]
 *   Normal Mixed     [A|darkA][darkA|darkB][darkB|B]
 *   Wide   Previous  [A|darkA][darkA][darkA|term][term|B]
 *   Wide   Next      [A|term][term|darkB][darkB][darkB|B]
 *   Wide   Mixed     [A|darkA][darkA|term][term|darkB][darkB|B]
 */
function bridgeCells(paint: Painter, a: RgbColor, b: RgbColor, exit: PowerlineShape, entry: PowerlineShape,
  mode: ConnectorFadeColors, wide: boolean): void {
  if (!wide) {
    if (mode === 'mixed') {
      const fadeA = connectorFadeColor(a);
      const fadeB = connectorFadeColor(b);
      transitionCell(paint, a, fadeA, exit, 'exit');
      transitionCell(paint, fadeA, fadeB, entry, 'entry');
      transitionCell(paint, fadeB, b, entry, 'entry');
      return;
    }
    const fade = connectorFadeColor(mode === 'next' ? b : a);
    transitionCell(paint, a, fade, exit, 'exit');
    solidCell(paint, fade);
    transitionCell(paint, fade, b, entry, 'entry');
    return;
  }
  if (mode === 'next') {
    const fadeB = connectorFadeColor(b);
    transitionCell(paint, a, undefined, exit, 'exit');
    transitionCell(paint, undefined, fadeB, entry, 'entry');
    solidCell(paint, fadeB);
    transitionCell(paint, fadeB, b, entry, 'entry');
    return;
  }
  const fadeA = connectorFadeColor(a);
  if (mode === 'mixed') {
    const fadeB = connectorFadeColor(b);
    transitionCell(paint, a, fadeA, exit, 'exit');
    transitionCell(paint, fadeA, undefined, exit, 'exit');
    transitionCell(paint, undefined, fadeB, entry, 'entry');
    transitionCell(paint, fadeB, b, entry, 'entry');
    return;
  }
  transitionCell(paint, a, fadeA, exit, 'exit');
  solidCell(paint, fadeA);
  transitionCell(paint, fadeA, undefined, exit, 'exit');
  transitionCell(paint, undefined, b, entry, 'entry');
}

/** Mixed needs a Normal or Wide gap; Compact and Off resolve it to Previous. */
export function fadeColorsAllowMixed(gapEnabled: boolean, gap: number): boolean {
  return gapEnabled && Math.trunc(gap) >= 1;
}

export function fadeColorChoices(gapEnabled: boolean, gap: number): readonly ConnectorFadeColors[] {
  return fadeColorsAllowMixed(gapEnabled, gap) ? CONNECTOR_FADE_COLORS : ['previous', 'next'];
}

export function resolveFadeColors(mode: ConnectorFadeColors, gapEnabled: boolean, gap: number): ConnectorFadeColors {
  return mode === 'mixed' && !fadeColorsAllowMixed(gapEnabled, gap) ? 'previous' : mode;
}

function blockContent(paint: Painter, block: PowerlineBlock, spacing: number): void {
  const body = block.compact ? ' ' : `${' '.repeat(spacing)}${block.text}${' '.repeat(spacing)}`;
  paint.add(`${foreground(block.foreground)}${background(block.background)}`, body, block.background, block.foreground, 'text');
}

function renderStart(paint: Painter, first: RgbColor, style: PowerlineStartStyle): void {
  const {shape, fade} = edgeParts(style);
  const glyphs = powerlineShapeGlyphs(shape);
  paint.add(`${RESET}${NEUTRAL_BACKGROUND}`, '', undefined);
  if (!fade) {
    if (glyphs.open) paint.add(foreground(first), glyphs.open, undefined, first);
    return;
  }
  const [bright, middle, dim] = fadeColors(first) as [RgbColor, RgbColor, RgbColor];
  if (shape === 'flat') {
    const cells = [...GLYPHS.powerlineFadeIn];
    paint.add(foreground(dim), cells[0]!, undefined, dim);
    paint.add(foreground(middle), cells[1]!, undefined, middle);
    paint.add(foreground(bright), cells[2]!, undefined, bright);
    return;
  }
  // Mirror of the end fade: dim cap, then solid joins brightening into the prompt.
  paint.add(foreground(dim), glyphs.open, undefined, dim);
  join(paint, dim, middle, glyphs.join);
  join(paint, middle, bright, glyphs.join);
  join(paint, bright, first, glyphs.join);
}

function renderEnd(paint: Painter, last: RgbColor, style: PowerlineEndStyle): void {
  const {shape, fade} = edgeParts(style);
  const glyphs = powerlineShapeGlyphs(shape);
  if (!fade) {
    if (glyphs.close) paint.add(`${RESET}${NEUTRAL_BACKGROUND}${foreground(last)}`, glyphs.close, undefined, last);
    return;
  }
  const stops = [last, ...fadeColors(last)] as [RgbColor, RgbColor, RgbColor, RgbColor];
  if (shape === 'flat') {
    const cells = [...GLYPHS.powerlineFade];
    paint.add(`${RESET}${NEUTRAL_BACKGROUND}${foreground(stops[1])}`, cells[0]!, undefined, stops[1]);
    paint.add(foreground(stops[2]), cells[1]!, undefined, stops[2]);
    paint.add(foreground(stops[3]), cells[2]!, undefined, stops[3]);
    paint.add('', ' ', undefined, stops[3], 'space');
    return;
  }
  join(paint, stops[0], stops[1], glyphs.join);
  join(paint, stops[1], stops[2], glyphs.join);
  join(paint, stops[2], stops[3], glyphs.join);
  paint.add(`${RESET}${foreground(stops[3])}${NEUTRAL_BACKGROUND}`, glyphs.close, undefined, stops[3]);
}

/** Which way a prompt's geometry faces: toward the right (a left prompt) or reflected toward the left. */
export type PowerlineOrientation = 'normal' | 'mirrored';

/**
 * Render Native/archived segments. Start shapes only the outer left edge,
 * End only the outer right edge, Connector only module-to-module geometry,
 * and Gap only whether modules are joined or separated by neutral cells.
 *
 * `mirrored` is the horizontal reflection of rendering the blocks in reverse:
 * blocks keep their visual left-to-right order, the flow runs from the right
 * edge inward, Start shapes the right (anchored) edge and End the left, and
 * Previous/Next keep their meaning along that flow.
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
  orientation: PowerlineOrientation = 'normal',
  extras: RenderExtras = {},
): string {
  if (modules.length === 0) return `${RESET}${NEUTRAL_BACKGROUND}`;
  const style = modules[0]!.style ?? 'powerline';
  const profiles = extras.profiles ?? defaultStyleProfiles(gapEnabled ? gap : 0, spacing);
  const chroma = resolveChroma(modules, extras);
  const paint = (blocks: readonly PowerlineBlock[]) => paintStyle(style, blocks, profiles, chroma,
    {gap, spacing, endStyle, gapEnabled, startStyle, connector, connectorFade, fadeColors});
  if (orientation === 'mirrored') return `${serializeReflected(paint([...modules].reverse()))}${RESET}${NEUTRAL_BACKGROUND}`;
  return serialize(paint(modules));
}

/** Per-prompt render options beyond the Powerline geometry. */
export interface RenderExtras {
  /** Style profiles; missing means the legacy shared gap/spacing (historical snapshots). */
  profiles?: StyleProfiles;
  chroma?: PromptChroma;
}

/** A resolved Chroma treatment for one prompt render: what, when, and whether it may move. */
export interface PromptChroma {
  treatment: Treatment;
  time: number;
  still: boolean;
}

/** Explicit Chroma wins; otherwise blocks carrying treatment settings render it statically. */
function resolveChroma(modules: readonly PowerlineBlock[], extras: RenderExtras): PromptChroma | undefined {
  if (extras.chroma) return extras.chroma;
  const settings = modules.find(block => block.treatment)?.treatment;
  const treatment = settings && treatmentFor(settings);
  return treatment ? {treatment, time: 0, still: true} : undefined;
}

interface Geometry {
  gap: number;
  spacing: number;
  endStyle: PowerlineEndStyle | boolean;
  gapEnabled: boolean;
  startStyle: PowerlineStartStyle;
  connector: PowerlineConnectorStyle;
  connectorFade: ResolvedConnectorFade;
  fadeColors: ConnectorFadeColors;
}

/** Block centers along the prompt, 0..1. */
function blockPosition(index: number, count: number): number {
  return count <= 1 ? 0.5 : index / (count - 1);
}

/**
 * Filled-surface Chroma: each eligible block's background moves toward the
 * gradient at its place in the prompt, and its text is re-chosen for
 * contrast. Boundaries stay because neighbors sample different positions.
 */
function treatFilled(blocks: readonly PowerlineBlock[], chroma: PromptChroma | undefined): PowerlineBlock[] {
  if (!chroma) return [...blocks];
  return blocks.map((block, index) => {
    if (!block.treatment) return block;
    const fill = samplePromptTreatment(chroma.treatment, block.background, blockPosition(index, blocks.length), chroma.time, chroma.still);
    return {...block, background: fill, foreground: readableForeground(fill, block.foreground)};
  });
}

function paintStyle(style: PromptStyle, modules: readonly PowerlineBlock[], profiles: StyleProfiles, chroma: PromptChroma | undefined,
  geometry: Geometry): Cell[] {
  switch (style) {
    case 'minimal': case 'outline': case 'breadcrumb': return paintTextStyle(modules, style, profiles, chroma);
    case 'soft': {
      const profile = profiles.soft;
      const blocks = treatFilled(profile.fill === 'subtle' ? modules.map(subtleBlock) : modules, chroma);
      const cap: PowerlineShape = profile.cap === 'slant' ? 'slash' : profile.cap === 'square' ? 'flat' : 'rounded';
      return profile.layout === 'connected'
        ? paintPowerlineBlocks(blocks, 0, profile.padding, cap, false, cap, 'flat', undefined, 'previous')
        : paintPowerlineBlocks(blocks, profile.gap, profile.padding, cap, true, cap, cap, undefined, 'previous');
    }
    case 'compact': return paintCompact(treatFilled(modules, chroma), profiles.compact);
    case 'ribbon': return paintRibbon(modules, profiles.ribbon, chroma);
    case 'powerline': return paintPowerlineBlocks(treatFilled(modules, chroma), geometry.gap, geometry.spacing, geometry.endStyle,
      geometry.gapEnabled, geometry.startStyle, geometry.connector, geometry.connectorFade, geometry.fadeColors);
  }
}

const TERMINAL_DARK: RgbColor = {red: 30, green: 30, blue: 36};

/** Soft's subtle fill: a quiet tinted surface with the module color carried by its text. */
function subtleBlock(block: PowerlineBlock): PowerlineBlock {
  const fill = mixOklch(block.background, TERMINAL_DARK, 0.6);
  return {...block, background: fill, foreground: readableForeground(fill, readableTextTone(mixOklch(block.background, {red: 255, green: 255, blue: 255}, 0.25)))};
}

function compactEdge(ends: StyleProfiles['compact']['ends']): PowerlineShape {
  return ends === 'rounded' ? 'rounded' : ends === 'wedge' ? 'wedge' : 'flat';
}

/** Compact: dense filled cells, no gaps; optional thin same-hue seams. */
function paintCompact(modules: readonly PowerlineBlock[], profile: StyleProfiles['compact']): Cell[] {
  const paint = new Painter();
  const edge = compactEdge(profile.ends);
  renderStart(paint, modules[0]!.background, edge);
  modules.forEach((block, index) => {
    blockContent(paint, block, profile.padding);
    const next = modules[index + 1];
    if (next && profile.seams === 'thin') {
      const seam = connectorFadeColor(next.background);
      paint.add(`${RESET}${background(next.background)}${foreground(seam)}`, getCurrentGlyphMode() === 'nerd' ? '\u2595' : '|', next.background, seam);
    }
  });
  renderEnd(paint, modules[modules.length - 1]!.background, edge);
  paint.add(`${RESET}${NEUTRAL_BACKGROUND}`, '', undefined);
  return paint.cells;
}

/** The ribbon's single band color. */
function ribbonBand(first: RgbColor, band: StyleProfiles['ribbon']['band']): RgbColor {
  if (band === 'neutral') return {red: 40, green: 40, blue: 48};
  const lch = toOklch(first);
  return fromOklch({l: 0.3, c: Math.min(0.06, lch.c), h: lch.h});
}

/** Ribbon: one band across the prompt; each module is colored text on it, divided by thin slants. */
function paintRibbon(modules: readonly PowerlineBlock[], profile: StyleProfiles['ribbon'], chroma: PromptChroma | undefined): Cell[] {
  const paint = new Painter();
  const band = ribbonBand(modules[0]!.background, profile.band);
  const nerd = getCurrentGlyphMode() === 'nerd';
  const edge: PowerlineShape = profile.ends === 'pointed' ? 'wedge' : profile.ends === 'flat' ? 'flat' : profile.slant === 'forward' ? 'slash' : 'backslash';
  const divider = profile.slant === 'forward' ? (nerd ? '\ue0bb' : '/') : (nerd ? '\ue0b9' : '\\');
  const dividerColor = readableForeground(band, mixOklch(band, {red: 255, green: 255, blue: 255}, 0.3), 2);
  const pad = ' '.repeat(profile.padding);
  const tones = modules.map(block => readableForeground(band, readableTextTone(textTone(block.background)), 4.5));
  const spans: Span[] = [];
  modules.forEach((block, index) => {
    if (index > 0) spans.push({text: ` ${divider} `, color: dividerColor, kind: 'glyph', eligible: false});
    spans.push({text: `${pad}${block.compact ? (nerd ? '●' : '*') : block.text}${pad}`, color: tones[index]!, kind: 'text', eligible: Boolean(block.treatment)});
  });
  renderStart(paint, band, edge);
  paintSpans(paint, spans, chroma, band);
  renderEnd(paint, band, edge);
  paint.add(`${RESET}${NEUTRAL_BACKGROUND}`, '', undefined);
  return paint.cells;
}

function paintPowerlineBlocks(
  modules: readonly PowerlineBlock[],
  gap: number,
  spacing: number,
  endStyle: PowerlineEndStyle | boolean,
  gapEnabled: boolean,
  startStyle: PowerlineStartStyle,
  connector: PowerlineConnectorStyle,
  connectorFade: ResolvedConnectorFade,
  fadeColors: ConnectorFadeColors,
): Cell[] {
  const paint = new Painter();
  const gapWidth = gapEnabled ? Math.max(0, Math.trunc(gap)) : 0;
  renderStart(paint, modules[0]!.background, normalizeEdgeStyle(startStyle, 'wedge'));

  for (let index = 0; index < modules.length; index += 1) {
    const current = modules[index]!;
    blockContent(paint, current, spacing);
    const next = modules[index + 1];
    if (!next) continue;
    const shape = boundary(current, next, block => block.geometry, connector);
    if (!gapEnabled) {
      // Joined: one transition cell paints the old segment on the left and the
      // next on the right, so the next block has no opening cap. No gap, no fade.
      const glyph = powerlineShapeGlyphs(shape).join;
      if (glyph) join(paint, current.background, next.background, glyph);
      continue;
    }
    // Separated: close cap (Connector shape), gap cells, open cap. A connector
    // fade picks only the open cap's shape; fade colors only pick colors.
    const fade = boundary<PowerlineShape | 'off'>(current, next, block => block.fade, connectorFade ?? 'off');
    const close = powerlineShapeGlyphs(shape).close;
    if (fade === 'off') {
      const open = powerlineShapeGlyphs(shape).open;
      if (close) paint.add(`${RESET}${NEUTRAL_BACKGROUND}${foreground(current.background)}`, close, undefined, current.background);
      paint.add(`${RESET}${NEUTRAL_BACKGROUND}`, ' '.repeat(gapWidth), undefined, undefined, 'space');
      paint.add(`${RESET}${NEUTRAL_BACKGROUND}`, '', undefined);
      if (open) paint.add(foreground(next.background), open, undefined, next.background);
      continue;
    }
    const open = powerlineShapeGlyphs(fade).open;
    const mode = resolveFadeColors(fadeColors, gapEnabled, gapWidth);
    if (gapWidth === 0) {
      // Compact: the zones touch, so a one-sided mode carries its color across
      // both caps. No width is added; Flat + Flat has nothing to color.
      const zone = fadeZone(current.background, next.background, mode);
      if (close) paint.add(`${RESET}${background(zone)}${foreground(current.background)}`, close, zone, current.background);
      if (open) paint.add(`${RESET}${background(zone)}${foreground(next.background)}`, open, zone, next.background);
      continue;
    }
    // Flat + Flat has no glyph to split a cell, so Normal and Wide fall back
    // to one and two terminal-background cells with no fade color.
    if (!close && !open) {
      paint.add(`${RESET}${NEUTRAL_BACKGROUND}`, ' '.repeat(gapWidth >= 2 ? 2 : 1), undefined, undefined, 'space');
      continue;
    }
    bridgeCells(paint, current.background, next.background, shape, fade, mode, gapWidth >= 2);
  }

  renderEnd(paint, modules[modules.length - 1]!.background, normalizeEndStyle(endStyle));
  paint.add(`${RESET}${NEUTRAL_BACKGROUND}`, '', undefined);
  return paint.cells;
}

/** A segment color lifted toward white so it reads as text on a dark terminal background. */
function textTone(color: RgbColor): RgbColor {
  const lift = (channel: number) => Math.round(channel + (255 - channel) * 0.45);
  return {red: lift(color.red), green: lift(color.green), blue: lift(color.blue)};
}

/** A run of text one color (or one Chroma sweep) wide. */
interface Span {
  text: string;
  color: RgbColor;
  kind: Cell['kind'];
  /** Whether Chroma may color this span. */
  eligible: boolean;
  bold?: boolean;
  /** A filled span (breadcrumb anchor); text spans are unfilled. */
  fill?: RgbColor;
}

/**
 * Paint spans as cells. With Chroma, eligible spans take a per-column color
 * from one sweep across the whole prompt; each span stays one cell so a
 * mirrored render keeps its reading order.
 */
function paintSpans(paint: Painter, spans: readonly Span[], chroma: PromptChroma | undefined, zone?: RgbColor): void {
  const total = spans.reduce((sum, span) => sum + displayWidth(span.text), 0);
  let column = 0;
  let previous = '';
  for (const span of spans) {
    const fill = span.fill ?? zone;
    const backgroundSgr = fill ? background(fill) : NEUTRAL_BACKGROUND;
    const bold = span.bold ? BOLD : '';
    let body = span.text;
    if (chroma && span.eligible && span.text.trim()) {
      let offset = column;
      body = graphemes(span.text).map(glyph => {
        const position = total <= 1 ? 0 : offset / (total - 1);
        offset += displayWidth(glyph);
        const treated = samplePromptTreatment(chroma.treatment, span.color, position, chroma.time, chroma.still);
        const color = fill ? readableForeground(fill, treated, 3) : readableTextTone(treated);
        return `${foreground(color)}${glyph}`;
      }).join('');
    }
    const sgr = `${RESET}${backgroundSgr}${bold}${foreground(span.color)}`;
    // Adjacent spans in the same plain style share one escape.
    paint.add(sgr === previous ? '' : sgr, body, fill, span.color, span.kind);
    previous = body === span.text ? sgr : '';
    column += displayWidth(span.text);
  }
}

const BOLD = '\u001B[1m';
const SUBTLE_SEPARATOR = UI_COLORS.subtle;

function minimalSeparator(profile: StyleProfiles['minimal']): string {
  const nerd = getCurrentGlyphMode() === 'nerd';
  const glyph = {space: '', dot: '·', pipe: nerd ? '│' : '|', slash: '/', chevron: nerd ? '\ue0b1' : '>'}[profile.separator];
  if (!glyph) return ' '.repeat(profile.spacing);
  const side = ' '.repeat(Math.max(1, Math.ceil(profile.spacing / 2)));
  return `${side}${glyph}${side}`;
}

function outlineCaps(cap: StyleProfiles['outline']['cap']): [string, string] {
  const nerd = getCurrentGlyphMode() === 'nerd';
  if (cap === 'square') return ['[', ']'];
  if (cap === 'angle') return nerd ? ['\ue0b3', '\ue0b1'] : ['<', '>'];
  return nerd ? ['\uE0B7', '\uE0B5'] : ['(', ')'];
}

function breadcrumbSeparator(profile: StyleProfiles['breadcrumb']): string {
  const nerd = getCurrentGlyphMode() === 'nerd';
  const glyph = {chevron: nerd ? '\ue0b1' : '>', slash: nerd ? '\ue0bb' : '/', dot: '·'}[profile.separator];
  const side = ' '.repeat(profile.spacing);
  return `${side}${glyph}${side}`;
}

/**
 * Minimal, Outline and Breadcrumb: no filled module backgrounds (the
 * Breadcrumb anchor is the one filled pill). Module colors become text
 * tones; separators and outlines stay quiet unless Chroma treats them.
 */
function paintTextStyle(modules: readonly PowerlineBlock[], style: 'minimal' | 'outline' | 'breadcrumb', profiles: StyleProfiles,
  chroma: PromptChroma | undefined): Cell[] {
  const nerd = getCurrentGlyphMode() === 'nerd';
  const label = (block: PowerlineBlock) => block.compact ? (nerd ? '●' : '*') : block.text;
  const tone = (block: PowerlineBlock) => textTone(block.background);
  const spans: Span[] = [];
  if (style === 'minimal') {
    const profile = profiles.minimal;
    const separator = minimalSeparator(profile);
    modules.forEach((block, index) => {
      if (index > 0) spans.push({text: separator, color: SUBTLE_SEPARATOR, kind: separator.trim() ? 'glyph' : 'space',
        eligible: Boolean(modules[index - 1]!.treatment && block.treatment)});
      spans.push({text: label(block), color: tone(block), kind: 'text', eligible: Boolean(block.treatment),
        bold: profile.emphasis === 'all' || (profile.emphasis === 'first' && index === 0)});
    });
  } else if (style === 'outline') {
    const profile = profiles.outline;
    const [open, close] = outlineCaps(profile.cap);
    const pad = ' '.repeat(profile.padding);
    if (profile.layout === 'connected') {
      const divider = nerd ? '│' : '|';
      modules.forEach((block, index) => {
        const color = tone(block);
        const eligible = Boolean(block.treatment);
        if (index === 0) spans.push({text: open, color, kind: 'glyph', eligible});
        else spans.push({text: divider, color: SUBTLE_SEPARATOR, kind: 'glyph', eligible: eligible && Boolean(modules[index - 1]!.treatment)});
        spans.push({text: `${pad}${label(block)}${pad}`, color, kind: 'text', eligible});
        if (index === modules.length - 1) spans.push({text: close, color, kind: 'glyph', eligible});
      });
    } else {
      modules.forEach((block, index) => {
        const color = tone(block);
        const eligible = Boolean(block.treatment);
        if (index > 0 && profile.gap > 0) spans.push({text: ' '.repeat(profile.gap), color, kind: 'space', eligible: false});
        spans.push({text: open, color, kind: 'glyph', eligible});
        spans.push({text: `${pad}${label(block)}${pad}`, color, kind: 'text', eligible});
        spans.push({text: close, color, kind: 'glyph', eligible});
      });
    }
  } else {
    const profile = profiles.breadcrumb;
    const separator = breadcrumbSeparator(profile);
    const anchor = profile.anchor === 'none' ? -1 : profile.anchor === 'first' ? 0 : modules.length - 1;
    const filled = treatFilled(modules, chroma);
    modules.forEach((block, index) => {
      if (index > 0) spans.push({text: separator, color: SUBTLE_SEPARATOR, kind: 'glyph', eligible: false});
      if (index !== anchor) {
        spans.push({text: label(block), color: tone(block), kind: 'text', eligible: Boolean(block.treatment)});
        return;
      }
      const pill = filled[index]!;
      const caps = powerlineShapeGlyphs(nerd ? 'rounded' : 'flat');
      if (caps.open) spans.push({text: caps.open, color: pill.background, kind: 'glyph', eligible: false});
      spans.push({text: ` ${label(pill)} `, color: pill.foreground, kind: 'text', eligible: false, fill: pill.background});
      if (caps.close) spans.push({text: caps.close, color: pill.background, kind: 'glyph', eligible: false});
    });
  }
  const paint = new Painter();
  paint.add(`${RESET}${NEUTRAL_BACKGROUND}`, '', undefined);
  paintSpans(paint, spans, chroma);
  paint.add(`${RESET}${NEUTRAL_BACKGROUND}`, '', undefined);
  return paint.cells;
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
  extras: RenderExtras = {},
): string {
  if (width <= 0 || modules.length === 0) return '';
  const style = normalizeEndStyle(endStyle);
  if (width < 3) {
    const first = modules[0]!;
    return `${foreground(first.foreground)}${truncateText(first.text, width)}${RESET}${NEUTRAL_BACKGROUND}`;
  }
  const render = (blocks: readonly PowerlineBlock[], blockGap: number, blockSpacing: number, enabled: boolean) =>
    renderPowerlineBlocks(blocks, blockGap, blockSpacing, style, enabled, startStyle, connector, connectorFade, fadeColors, 'normal', extras);

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

/**
 * Fit the right-aligned context group into what the left prompt leaves.
 * Right-side context is lower priority: it never truncates text and never
 * squeezes the left prompt. Blocks farthest from the right edge drop first,
 * mirroring how the left prompt drops blocks farthest from its anchor.
 */
export function fitRightPowerlineBlocks(
  modules: readonly PowerlineBlock[],
  width: number,
  render: (blocks: readonly PowerlineBlock[]) => string,
): string {
  for (let start = 0; start < modules.length; start += 1) {
    const candidate = render(modules.slice(start));
    if (displayWidth(candidate) <= width) return candidate;
  }
  return '';
}
