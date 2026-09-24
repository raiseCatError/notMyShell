import type {RgbColor} from '../ui/palette.js';
import type {ComposerLayout, ConnectorFadeStyle, GitColorMode, NativeConnectorStyle, NativeEndStyle, NativePaletteId, NativeStartStyle, PromptProviderId} from './configuration.js';

export interface PromptSegmentSnapshot {
  text: string;
  /** Native semantic role, so history can be re-themed without touching stored colors. */
  role?: string;
  foreground?: RgbColor;
  background?: RgbColor;
  geometry: 'powerline' | 'plain';
  /** A marker-sized segment (e.g. clean Git): no text, shaped only by the prompt geometry. */
  compact?: boolean;
}

/** Semantic prompt data captured at submission; never an ANSI-only string. */
export interface PromptSnapshot {
  provider: PromptProviderId;
  layout: ComposerLayout;
  segments: PromptSegmentSnapshot[];
  endStyle?: NativeEndStyle;
  /** Older transcripts may hold the legacy `pointed`; renderers normalize it. */
  startStyle?: NativeStartStyle;
  connector?: NativeConnectorStyle;
  /** Missing in older snapshots, which rendered solid connectors. */
  connectorFade?: ConnectorFadeStyle;
  palette?: NativePaletteId;
  /** Rich Git color mode at submission; older snapshots followed the theme. */
  gitColors?: GitColorMode;
  gap?: number;
  gapEnabled?: boolean;
  spacing?: number;
  cwd: string;
  branch?: string;
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function gamma(channel: number): number {
  const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/** Convert sRGB to OKLab for hue-aware archival dimming. */
function toOklab(color: RgbColor): [number, number, number] {
  const r = linearize(color.red), g = linearize(color.green), b = linearize(color.blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromOklab(l: number, a: number, b: number): RgbColor {
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    red: gamma(4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc),
    green: gamma(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc),
    blue: gamma(-0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc),
  };
}

/** Lower prompt emphasis while keeping a color's OKLab hue angle stable. */
export function fadePromptColor(color: RgbColor, step: number): RgbColor {
  const [lightness, a, b] = toOklab(color);
  const lightnessFactors = [0.88, 0.76, 0.64];
  const chromaFactors = [0.88, 0.74, 0.60];
  const index = Math.max(0, Math.min(lightnessFactors.length - 1, Math.trunc(step)));
  return fromOklab(lightness * lightnessFactors[index]!, a * chromaFactors[index]!, b * chromaFactors[index]!);
}

/** Light live segments (e.g. the lime project block) must not stay bright in history. */
const ARCHIVE_BACKGROUND_CEILING = 0.56;

/** Dark text on a light live segment becomes light muted text over the darkened archive block. */
function archiveForegroundLightness(l: number, factor: number): number {
  return l < 0.5 ? 0.8 : Math.max(0.54, Math.min(0.84, l * factor));
}

export function archiveColor(color: RgbColor, role: 'foreground' | 'background' = 'foreground'): RgbColor {
  const [l, a, b] = toOklab(color);
  const chroma = Math.hypot(a, b);
  if (chroma < 0.025) {
    const dimmed = role === 'foreground' ? archiveForegroundLightness(l, 0.82) : Math.min(ARCHIVE_BACKGROUND_CEILING, Math.max(0.15, l * 0.8));
    return fromOklab(dimmed, 0, 0);
  }
  // Keep the pigment angle while quieting saturation. Raise very dark module
  // backgrounds to a visible floor so the archive remains readable.
  const lightness = role === 'background'
    ? Math.min(ARCHIVE_BACKGROUND_CEILING, Math.max(0.36, l * 0.82))
    : Math.max(0.58, archiveForegroundLightness(l, 0.84));
  const reducedChroma = chroma * (role === 'background' ? 0.68 : 0.72);
  return fromOklab(lightness, (a / chroma) * reducedChroma, (b / chroma) * reducedChroma);
}

/** Explicitly neutral history: the archive transform with all chroma removed. */
export function grayscaleArchiveColor(color: RgbColor, role: 'foreground' | 'background' = 'foreground'): RgbColor {
  const [l] = toOklab(archiveColor(color, role));
  return fromOklab(l, 0, 0);
}

/** Perceptual blend: `amount` 0 is `from`, 1 is `to`. */
export function mixPromptColors(from: RgbColor, to: RgbColor, amount = 0.5): RgbColor {
  const a = toOklab(from), b = toOklab(to);
  return fromOklab(a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount);
}

/** Same perceived lightness, no hue. */
export function desaturatePromptColor(color: RgbColor): RgbColor {
  return fromOklab(toOklab(color)[0], 0, 0);
}
