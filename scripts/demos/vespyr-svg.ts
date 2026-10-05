/**
 * Renders README art from Vespyr's real sprite (src/idle/catSprite.ts): the
 * same pixels, poses and colors NMSh draws in the terminal, as a small
 * transparent SVG divider. The only motion is the sprite's own blink pose,
 * shown briefly every few seconds (SMIL, no script), so it stays calm.
 *
 *   npx tsx scripts/demos/vespyr-svg.ts      (writes assets/readme/vespyr-divider.svg)
 */
import {writeFileSync} from 'node:fs';
import {CAT_BODY, CAT_EYE, catPixels} from '../../src/idle/catSprite.js';

const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`;
const PIXEL = 4;
const open = catPixels('idle');
const blink = catPixels('blink');
const width = 800, height = 44;
// Vespyr sits centered on the rule, facing the way the sprite faces (left).
const baseline = 38;
const originX = 400 - (open[0]!.length * PIXEL) / 2, originY = baseline - open.length * PIXEL;

const rects: string[] = [];
open.forEach((row, y) => [...row].forEach((pixel, x) => {
  if (pixel === '.') return;
  const at = `x="${originX + x * PIXEL}" y="${originY + y * PIXEL}" width="${PIXEL}" height="${PIXEL}"`;
  if (pixel === 'E' && blink[y]![x] !== 'E') rects.push(`<rect ${at} class="eye"/>`);
  else rects.push(`<rect ${at} fill="${hex(CAT_BODY)}"/>`);
}));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Vespyr, the NMSh cat" shape-rendering="crispEdges">
  <style>
    .line { stroke: #d0d4da; stroke-width: 1; }
    .eye { fill: ${hex(CAT_EYE)}; animation: blink 6.2s step-end infinite; }
    @keyframes blink { 0%, 96.5% { fill: ${hex(CAT_EYE)}; } 97% { fill: ${hex(CAT_BODY)}; } }
    @media (prefers-color-scheme: dark) { .line { stroke: #3d444d; } }
    @media (prefers-reduced-motion: reduce) { .eye { animation: none; } }
  </style>
  <line x1="100" y1="${baseline - 0.5}" x2="${originX - 10}" y2="${baseline - 0.5}" class="line"/>
  <line x1="${originX + open[0]!.length * PIXEL + 10}" y1="${baseline - 0.5}" x2="700" y2="${baseline - 0.5}" class="line"/>
  ${rects.join('\n  ')}
</svg>
`;

writeFileSync(new URL('../../assets/readme/vespyr-divider.svg', import.meta.url), svg);
console.log(`vespyr-divider.svg: ${svg.length} bytes`);
