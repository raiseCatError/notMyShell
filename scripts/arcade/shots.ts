/**
 * Photograph Arcade frames for visual review, without a terminal emulator: each frame's ANSI rows become a grid of
 * fixed-size cells in an HTML page (half blocks drawn as exact two-color cells, so pixel art is not distorted by font
 * metrics), and headless Chrome screenshots the page.
 *
 *   npx tsx scripts/arcade/shots.ts <shots.json> <output directory>
 *
 * shots.json: [{"name": "hub-wide", "cols": 160, "rows": 45, "game": "run", "keys": ["space"], "advance": 2500}, ...]
 * (every frame option of scripts/arcade/frame.ts). Run it through `t7run` with the output on the scratch volume.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arcadeFrame, type FrameOptions} from './frame.js';
import {displayWidth} from '../../src/util/text.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CELL_W = 10;
const CELL_H = 20;
const DEFAULT_FG = '#f2f0ec';
const DEFAULT_BG = '#15141c';

interface Shot extends Partial<FrameOptions> { name: string; cols?: number }

const escapeHtml = (text: string) => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;

/** One ANSI row (SGR only) as positioned cells. */
function rowCells(row: string): string {
  let fg: string | undefined, bg: string | undefined, bold = false, dim = false, reverse = false;
  let out = '';
  let column = 0;
  const pattern = /\u001b\[([0-9;]*)m|([\s\S])/gu;
  for (const match of row.matchAll(pattern)) {
    if (match[1] !== undefined) {
      const codes = match[1] === '' ? [0] : match[1].split(';').map(Number);
      for (let index = 0; index < codes.length; index += 1) {
        const code = codes[index]!;
        if (code === 0) { fg = bg = undefined; bold = dim = reverse = false; }
        else if (code === 1) bold = true;
        else if (code === 2) dim = true;
        else if (code === 7) reverse = true;
        else if ((code === 38 || code === 48) && codes[index + 1] === 2) {
          const color = hex(codes[index + 2]!, codes[index + 3]!, codes[index + 4]!);
          if (code === 38) fg = color; else bg = color;
          index += 4;
        }
      }
      continue;
    }
    const ch = match[2]!;
    const width = Math.max(1, displayWidth(ch));
    let f = fg ?? DEFAULT_FG, b = bg ?? 'transparent';
    if (reverse) [f, b] = [bg ?? DEFAULT_BG, fg ?? DEFAULT_FG];
    const left = column * CELL_W;
    const style = `left:${left}px;width:${CELL_W * width}px`;
    if (ch === '▀') out += `<i style="${style};background:linear-gradient(${f} 50%,${b} 50%)"></i>`;
    else if (ch === '▄') out += `<i style="${style};background:linear-gradient(${b} 50%,${f} 50%)"></i>`;
    else if (ch === '█') out += `<i style="${style};background:${f}"></i>`;
    else if (ch === ' ') { if (b !== 'transparent') out += `<i style="${style};background:${b}"></i>`; }
    else out += `<i style="${style};background:${b};color:${f};${bold ? 'font-weight:700;' : ''}${dim ? 'opacity:.6;' : ''}">${escapeHtml(ch)}</i>`;
    column += width;
  }
  return out;
}

function page(rows: string[], columns: number): string {
  const body = rows.map((row, index) => `<div class="r" style="top:${index * CELL_H}px">${rowCells(row)}</div>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:${DEFAULT_BG}}
.s{position:relative;width:${columns * CELL_W}px;height:${rows.length * CELL_H}px;font:16px/20px "JetBrainsMono Nerd Font Mono","JetBrains Mono",monospace;color:${DEFAULT_FG}}
.r{position:absolute;left:0;height:${CELL_H}px;width:100%}
.r i{position:absolute;top:0;height:${CELL_H}px;font-style:normal;text-align:center;overflow:hidden;white-space:pre}
</style><div class="s">${body}</div>`;
}

const [shotsFile, outDir] = process.argv.slice(2);
if (!shotsFile || !outDir) { console.error('usage: shots.ts <shots.json> <output directory>'); process.exit(2); }
mkdirSync(outDir, {recursive: true});
const shots = JSON.parse(readFileSync(shotsFile, 'utf8')) as Shot[];
for (const shot of shots) {
  const columns = shot.cols ?? 120;
  const rows = shot.rows ?? 36;
  const frame = arcadeFrame({...shot, columns, rows});
  const html = join(outDir, `${shot.name}.html`);
  writeFileSync(html, page(frame, columns));
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${join(outDir, '.chrome')}`,
    `--screenshot=${join(outDir, `${shot.name}.png`)}`, `--window-size=${columns * CELL_W},${rows * CELL_H}`, `file://${html}`], {stdio: 'ignore'});
  console.log(`${shot.name}: ${columns}x${rows}`);
}
