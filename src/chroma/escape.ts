import {colorLevel, type ColorLevel} from '../presentation/capabilities.js';

export interface Rgb {
  red: number;
  green: number;
  blue: number;
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

function nearestCube(value: number): number {
  let best = 0;
  for (let index = 1; index < CUBE_LEVELS.length; index += 1) {
    if (Math.abs(CUBE_LEVELS[index]! - value) < Math.abs(CUBE_LEVELS[best]! - value)) best = index;
  }
  return best;
}

/** Nearest xterm 256-palette entry (6x6x6 cube or grayscale ramp) for a color. */
export function rgbTo256(color: Rgb): number {
  const r = nearestCube(color.red);
  const g = nearestCube(color.green);
  const b = nearestCube(color.blue);
  const cube = {red: CUBE_LEVELS[r]!, green: CUBE_LEVELS[g]!, blue: CUBE_LEVELS[b]!};
  const average = Math.round((color.red + color.green + color.blue) / 3);
  const grayStep = Math.max(0, Math.min(23, Math.round((average - 8) / 10)));
  const grayValue = 8 + grayStep * 10;
  const gray = {red: grayValue, green: grayValue, blue: grayValue};
  const distance = (a: Rgb) => (a.red - color.red) ** 2 + (a.green - color.green) ** 2 + (a.blue - color.blue) ** 2;
  return distance(gray) < distance(cube) ? 232 + grayStep : 16 + 36 * r + 6 * g + b;
}

/** Conventional ANSI palette. Host palettes can differ; keep fallback predictable. */
const ANSI16 = [
  [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
  [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
  [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

export function rgbTo16(color: Rgb): number {
  let nearest = 0;
  let distance = Infinity;
  ANSI16.forEach(([r, g, b], index) => {
    const next = (color.red - r!) ** 2 + (color.green - g!) ** 2 + (color.blue - b!) ** 2;
    if (next < distance) { distance = next; nearest = index; }
  });
  return nearest;
}

/** SGR sequence for a foreground (38) or background (48) color at a capability level; empty when uncolored. */
export function colorEscape(layer: 38 | 48, color: Rgb, level: ColorLevel = colorLevel()): string {
  if (level === 'none') return '';
  if (level === 'ansi16') {
    const index = rgbTo16(color);
    return `\u001B[${(layer === 38 ? 30 : 40) + (index < 8 ? index : 60 + index - 8)}m`;
  }
  if (level === 'ansi256') return `\u001B[${layer};5;${rgbTo256(color)}m`;
  return `\u001B[${layer};2;${color.red};${color.green};${color.blue}m`;
}
