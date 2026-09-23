import type {RgbColor} from '../ui/palette.js';
import type {ComposerLayout, NativeEndStyle, PromptProviderId} from './configuration.js';

export interface PromptSegmentSnapshot {
  text: string;
  foreground?: RgbColor;
  background?: RgbColor;
  geometry: 'powerline' | 'plain';
}

/** Semantic prompt data captured at submission; never an ANSI-only string. */
export interface PromptSnapshot {
  provider: PromptProviderId;
  layout: ComposerLayout;
  segments: PromptSegmentSnapshot[];
  endStyle?: NativeEndStyle;
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

export function archiveColor(color: RgbColor, role: 'foreground' | 'background' = 'foreground'): RgbColor {
  const [l, a, b] = toOklab(color);
  const chroma = Math.hypot(a, b);
  if (chroma < 0.025) {
    const dimmed = role === 'foreground' ? Math.max(0.54, Math.min(0.82, l * 0.82)) : Math.max(0.15, l * 0.8);
    return fromOklab(dimmed, 0, 0);
  }
  // Keep the pigment angle while quieting saturation. Raise very dark module
  // backgrounds to a visible floor so the archive remains readable.
  const lightness = role === 'background' ? Math.max(0.36, l * 0.82) : Math.max(0.58, Math.min(0.84, l * 0.84));
  const reducedChroma = chroma * (role === 'background' ? 0.68 : 0.72);
  return fromOklab(lightness, (a / chroma) * reducedChroma, (b / chroma) * reducedChroma);
}
