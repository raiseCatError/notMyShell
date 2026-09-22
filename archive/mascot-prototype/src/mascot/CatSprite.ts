import {CAT_FRAMES, CAT_HEIGHT, CAT_WIDTH, type CatFrame, type CatFrameName} from './catFrames.js';
import {CAT_PALETTES, type CatPalette, type CatVariant} from './catPalettes.js';

const RESET = '\u001B[0m';

export function plainCatFrame(frame: CatFrame | CatFrameName): string[] {
  const resolved = typeof frame === 'string' ? CAT_FRAMES[frame] : frame;
  return resolved.rows.map(row => row.map(cell => cell.glyph).join(''));
}

export function renderCatFrame(frameName: CatFrameName, variant: CatVariant): string[] {
  const frame = CAT_FRAMES[frameName];
  const palette = CAT_PALETTES[variant];
  return frame.rows.map(row => renderRow(row, palette));
}

function renderRow(row: CatFrame['rows'][number], palette: CatPalette): string {
  let output = '';
  let activeColor = '';
  for (const cell of row) {
    const color = cell.role ? palette[cell.role] : '';
    if (color !== activeColor) {
      output += color ? `\u001B[${color}m` : RESET;
      activeColor = color;
    }
    output += cell.glyph;
  }
  return `${output}${RESET}`;
}

export function catFrameDimensions(frameName: CatFrameName): {width: number; height: number} {
  const rows = plainCatFrame(frameName);
  return {width: Math.max(...rows.map(row => Array.from(row).length)), height: rows.length};
}

export {CAT_HEIGHT, CAT_WIDTH};

