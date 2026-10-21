import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {PixelBuffer, type Canvas, type Style} from '../../Canvas.js';
import {easeOutBack} from '../../easing.js';
import type {Reveal} from '../../fx/cells.js';
import {arcadeLook, distinctColors, type ArcadeLook} from '../../look.js';
import {regionColors, type ArcadePalette} from '../../palette.js';
import {typeset} from '../../../ui/typography.js';
import {displayWidth, truncateText} from '../../../util/text.js';
import {wrap} from '../../ArcadeSession.js';
import type {QueensBoard} from './board.js';
import {formatTime} from './board.js';
import {chooseLayout, minimumCanvas, type BoardLayout} from './layout.js';
import {regionLetter} from './rules.js';
import type {Hint} from './solver.js';
import {drawMiniCat, textCat} from './sprite.js';
import {CAT, EXCLUDED} from './types.js';

export const SETTLE_MS = 280;

/** Everything the renderer needs besides the canvas and palette. */
export interface View {
  board: QueensBoard;
  cursor: number;
  hint: Hint | undefined;
  /** Milliseconds since the game began animating, for blinks and tail flicks. */
  idleMs: number;
  /** Per cell: age in ms of the settle animation, or -1. */
  settle: Float32Array;
  reduced: boolean;
  /** Draw text cats and ASCII-safe glyphs (NO_COLOR or Safe Glyphs). */
  plain: boolean;
  safe: boolean;
  paused: boolean;
  won: boolean;
  message: string;
  /** The winning hop wave across the cats, while the game's finale plays. */
  wave?: Reveal | undefined;
  /** Per cell: ms left of the fade after a cat is taken away. */
  vanish?: Float32Array;
}

export const VANISH_MS = 260;

const JUNCTIONS = [' ', '│', '│', '│', '─', '┘', '┐', '┤', '─', '└', '┌', '├', '─', '┴', '┬', '┼'];
const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8;

let pixels: PixelBuffer | undefined;
const scratch = (width: number, height: number): PixelBuffer => {
  if (!pixels || pixels.width !== width || pixels.height !== height) pixels = new PixelBuffer(width, height);
  else pixels.clear();
  return pixels;
};

/** Draw the whole game screen: HUD, board, labels and message. */
export function renderBoard(canvas: Canvas, palette: ArcadePalette, view: View): void {
  const {board} = view;
  const size = board.size;
  const look = arcadeLook(palette);
  canvas.clear(view.plain ? undefined : look.surface.base);
  const layout = chooseLayout(canvas.width, canvas.height, size);
  drawHud(canvas, palette, view);
  if (!layout) {
    const need = minimumCanvas(size);
    canvas.center(Math.floor(canvas.height / 2), `Needs at least ${need.columns}x${need.rows}`, {fg: palette.muted});
    return;
  }
  if (view.paused) {
    const middle = layout.y + Math.floor(layout.height / 2);
    canvas.center(middle - 1, 'Paused', {fg: palette.ink, bold: true});
    canvas.center(middle, 'The board is hidden while the clock is stopped.', {fg: palette.muted});
    return;
  }
  if (view.plain) drawGrid(canvas, palette, view, layout);
  else drawRegions(canvas, palette, view, layout);
  drawMessage(canvas, palette, view);
}

/**
 * The board in color: each region a solid shape in its own clearly different hue, separated from its neighbours by the
 * board's dark channel, with the cells inside a region parted by a quiet seam of its own shade. The region's letter
 * appears once, in its first cell, as a redundant cue next to the channels (which already show region shapes without
 * color). A placed cat sits on a dark rounded badge so the lavender cat reads on every hue; an exclusion is a small
 * pixel cross in the region's own shade; a finished region brightens and its label gets a check.
 */
function drawRegions(canvas: Canvas, palette: ArcadePalette, view: View, layout: BoardLayout): void {
  const look = arcadeLook(palette);
  const {board} = view;
  const {style, size} = layout;
  const analysis = board.analysis();
  const regions = board.puzzle.regions;
  const hues = distinctColors(size, look);
  const channel = look.surface.sunken;
  const hintTargets = new Set(view.hint?.targets ?? []);
  const hintInvolved = new Set(view.hint?.involved ?? []);
  const catOfRegion = new Map<number, number>();
  for (let cell = 0; cell < size * size; cell += 1) if (board.marks[cell] === CAT) catOfRegion.set(regions[cell]!, cell);
  const waveAt = (region: number): number => { const cat = catOfRegion.get(region); return cat === undefined ? 0 : view.wave?.amount(cat) ?? 0; };
  const fill = (region: number): Rgb => {
    let color = mixRgb(hues[region]!, look.surface.base, 0.16);
    if (analysis.regionDone[region]) color = mixRgb(color, look.text.strong, 0.18);
    const wave = waveAt(region);
    return wave > 0 ? mixRgb(color, look.text.strong, 0.35 * wave) : color;
  };
  const seam = (region: number): Rgb => mixRgb(fill(region), look.surface.base, 0.14);
  const pitchX = style.cw + style.gx;
  const pitchY = style.ch + style.gy;
  const cellX = (column: number): number => layout.x + (style.gx ? 1 : 0) + column * pitchX;
  const cellY = (row: number): number => layout.y + (style.gy ? 1 : 0) + row * pitchY;
  const at = (row: number, column: number): number | undefined => (row < 0 || column < 0 || row >= size || column >= size ? undefined : regions[row * size + column]);
  canvas.fill(layout.x, layout.y, layout.width, layout.height, ' ', {bg: channel});

  // Seams between cells of one region; channels (left as the board's background) between regions.
  if (style.gx) for (let row = 0; row < size; row += 1) for (let column = 1; column < size; column += 1) {
    const left = at(row, column - 1)!, right = at(row, column)!;
    if (left === right) canvas.fill(cellX(column) - 1, cellY(row), 1, style.ch, ' ', {bg: seam(left)});
  }
  if (style.gy) for (let row = 1; row < size; row += 1) for (let column = 0; column < size; column += 1) {
    const above = at(row - 1, column)!, below = at(row, column)!;
    if (above === below) canvas.fill(cellX(column), cellY(row) - 1, style.cw, 1, ' ', {bg: seam(above)});
  }
  if (style.gx && style.gy) for (let row = 1; row < size; row += 1) for (let column = 1; column < size; column += 1) {
    const region = at(row, column)!;
    if (at(row - 1, column) === region && at(row, column - 1) === region && at(row - 1, column - 1) === region) canvas.put(cellX(column) - 1, cellY(row) - 1, ' ', {bg: seam(region)});
  }

  const anchors = new Map<number, number>();
  for (let cell = 0; cell < size * size; cell += 1) if (!anchors.has(regions[cell]!)) anchors.set(regions[cell]!, cell);
  const big = style.name === 'large' || style.name === 'medium';
  for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) {
    const cell = row * size + column;
    const region = regions[cell]!;
    const mark = board.marks[cell]!;
    const clash = mark === CAT && analysis.conflict[cell] === 1;
    let bg = fill(region);
    if (hintInvolved.has(cell)) bg = mixRgb(bg, look.warn, 0.3);
    if (hintTargets.has(cell)) bg = mixRgb(bg, look.warn, 0.55);
    if (cell === view.cursor) bg = mixRgb(bg, look.text.strong, 0.3);
    const vanish = view.vanish?.[cell] ?? 0;
    if (vanish > 0) bg = mixRgb(bg, look.text.strong, 0.4 * (vanish / VANISH_MS));
    const x = cellX(column);
    const y = cellY(row);
    canvas.fill(x, y, style.cw, style.ch, ' ', {bg});
    // Without a horizontal gutter, a region boundary below the cell is a thin dark rule along its bottom.
    const ruleBelow = !style.gy && row < size - 1 && at(row + 1, column) !== region;
    const ink = mixRgb(bg, look.surface.sunken, 0.62);
    if (anchors.get(region) === cell) {
      const label = `${regionLetter(region)}${analysis.regionDone[region] ? (view.safe ? '+' : '✓') : ''}`;
      canvas.text(x, y, label, {fg: ink, bg, bold: analysis.regionDone[region]});
    }
    if (mark === CAT) drawBadgeCat(canvas, look, palette, view, cell, x, y, style, bg, clash, view.wave?.amount(cell) ?? 0);
    else if (mark === EXCLUDED) {
      if (big) {
        const buffer = scratch(style.cw, style.ch * 2);
        const cx = Math.floor(style.cw / 2);
        const cy = style.ch;
        for (const [dx, dy] of [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]] as const) buffer.set(cx + dx, cy + dy - (style.ch === 3 ? 0 : 1), ink);
        canvas.blit(buffer, x, y);
      } else canvas.put(x + Math.floor((style.cw - 1) / 2), y, view.safe ? 'x' : '×', {fg: ink, bg});
    }
    const marker = hintTargets.has(cell) ? '◆' : hintInvolved.has(cell) && mark !== CAT ? '◇' : '';
    if (marker) canvas.put(x + style.cw - 1, y, marker, {fg: mixRgb(look.warn, look.surface.sunken, 0.45), bg, bold: true});
    if (ruleBelow) for (let dx = 0; dx < style.cw; dx += 1) {
      const under = canvas.cell(x + dx, y);
      if (under && (under.ch === ' ' || under.ch === '')) canvas.put(x + dx, y, '▁', {fg: channel, bg});
    }
  }

  // The cursor: an accent ring in the gutters, brackets when there are only vertical gutters.
  const accent: Style = {fg: look.focus, bold: true};
  const cx = cellX(view.cursor % size);
  const cy = cellY(Math.floor(view.cursor / size));
  if (style.gx && style.gy) {
    const left = cx - 1, right = cx + style.cw, top = cy - 1, bottom = cy + style.ch;
    const under = (x: number, y: number) => ({...accent, bg: canvas.cell(x, y)?.bg});
    for (let dx = 0; dx < style.cw; dx += 1) { canvas.put(cx + dx, top, '▄', {fg: look.focus, bg: canvas.cell(cx + dx, top)?.bg}); canvas.put(cx + dx, bottom, '▀', {fg: look.focus, bg: canvas.cell(cx + dx, bottom)?.bg}); }
    for (let dy = 0; dy < style.ch; dy += 1) { canvas.put(left, cy + dy, '▐', under(left, cy + dy)); canvas.put(right, cy + dy, '▌', under(right, cy + dy)); }
  } else if (style.gx) {
    canvas.put(cx - 1, cy, '▐', {fg: look.focus, bg: canvas.cell(cx - 1, cy)?.bg});
    canvas.put(cx + style.cw, cy, '▌', {fg: look.focus, bg: canvas.cell(cx + style.cw, cy)?.bg});
  } else canvas.put(cx, cy, '▸', {fg: look.focus, bg: canvas.cell(cx, cy)?.bg, bold: true});

  if (layout.labels) drawLabels(canvas, palette, view, layout, cellX, cellY);
}

/** A placed cat on its dark rounded badge; it drops in with a little bounce, hops in the winning wave and blinks now and then. */
function drawBadgeCat(canvas: Canvas, look: ArcadeLook, palette: ArcadePalette, view: View, cell: number, x: number, y: number, style: BoardLayout['style'], bg: Rgb, clash: boolean, wave: number): void {
  const blink = !view.reduced && (Math.floor(view.idleMs / 250) + cell * 3) % 22 === 0;
  const badge = clash ? mixRgb(look.surface.sunken, look.bad, 0.5) : wave > 0 ? mixRgb(look.surface.sunken, look.accent, 0.45 * wave) : look.surface.sunken;
  if (style.name === 'large' || style.name === 'medium') {
    const width = style.cw;
    const height = style.ch * 2;
    const buffer = scratch(width, height);
    for (let py = 0; py < height; py += 1) for (let px = 0; px < width; px += 1) {
      const corner = (px === 0 || px === width - 1) && (py === 0 || py === height - 1);
      if (!corner) buffer.set(px, py, badge);
    }
    const age = view.settle[cell]!;
    const drop = !view.reduced && age >= 0 && age < SETTLE_MS ? Math.round((1 - easeOutBack(age / SETTLE_MS)) * -3) : 0;
    const hop = Math.round(-2 * Math.sin(Math.PI * Math.min(1, wave)));
    const top = (style.name === 'large' ? 1 : 0) + drop + hop;
    const flick = !view.reduced && (Math.floor(view.idleMs / 500) + cell) % 11 === 0;
    drawMiniCat(buffer, style.name === 'large' ? 1 : 0, top, palette, {blink, tail: style.name === 'large' ? (flick ? 1 : 0) : -1});
    // Keep the badge's rounded corners: the region shows through them.
    for (const [px, py] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]] as const) if (buffer.get(px, py) === badge) buffer.set(px, py, undefined);
    canvas.blit(buffer, x, y);
    for (let row = 0; row < style.ch; row += 1) for (let column = 0; column < width; column += 1) {
      const target = canvas.cell(x + column, y + row);
      if (target && !target.bg) canvas.tint(x + column, y + row, {bg});
    }
    if (clash) canvas.put(x + width - 1, y, '!', {fg: look.text.strong, bg: badge, bold: true});
    return;
  }
  const face = clash ? '^!^' : blink ? '-.-' : '^.^';
  const text = style.name === 'mini' ? (clash ? '^!' : '^^') : face;
  canvas.fill(x, y, style.cw, 1, ' ', {bg: badge});
  canvas.text(x + Math.max(0, Math.floor((style.cw - displayWidth(text)) / 2)), y, text, {fg: palette.cat.body, bg: badge, bold: true});
}

function drawHud(canvas: Canvas, palette: ArcadePalette, view: View): void {
  const {board} = view;
  const look = arcadeLook(palette);
  const analysis = board.analysis();
  const wide = canvas.width >= 44;
  const title = typeset({role: 'heading', text: 'Vespyr Queens', maxColumns: Math.max(6, canvas.width - 2), maxRows: 1});
  canvas.typeBlock(title, 1, 0, {fg: look.text.strong, bold: true});
  const level = `${board.difficulty[0]!.toUpperCase()}${board.difficulty.slice(1)} ${board.size}×${board.size}`;
  const timer = typeset({role: 'counter', text: formatTime(board.elapsedMs), maxColumns: 9, maxRows: 1});
  const stats = wide ? `Cats ${analysis.cats}/${board.size} · Hints ${board.hints}` : `${analysis.cats}/${board.size}`;
  const right = timer.columns + 2 + displayWidth(stats);
  const left = 1 + title.columns + 2;
  if (left + displayWidth(level) + 3 + right <= canvas.width) canvas.text(left, 0, level, {fg: look.accent, bold: true});
  if (left + right <= canvas.width) {
    canvas.text(canvas.width - 1 - right, 0, stats, {fg: look.text.normal});
    canvas.typeBlock(timer, canvas.width - 1 - timer.columns, 0, {fg: view.won ? look.ok : look.text.strong, bold: true});
  } else if (timer.columns + 1 + title.columns + 2 <= canvas.width) {
    canvas.typeBlock(timer, canvas.width - 1 - timer.columns, 0, {fg: look.text.strong, bold: true});
  }
}

function drawMessage(canvas: Canvas, palette: ArcadePalette, view: View): void {
  const analysis = view.board.analysis();
  const clashes = analysis.conflict.reduce((sum, value) => sum + value, 0);
  const look = arcadeLook(palette);
  let text = view.message;
  let color = look.warn;
  if (!text) {
    if (view.won) { text = 'Every row, column and region has its cat, and none touch.'; color = look.ok; }
    else if (clashes) { text = `${clashes} cat${clashes === 1 ? '' : 's'} clash (marked !): same row, column or region, or touching.`; color = look.bad; }
    else { text = 'One cat in every row, column and region. No two cats touch, even diagonally.'; color = look.text.dim; }
  }
  const lines = wrap(text, Math.max(8, canvas.width - 2));
  const room = canvas.height >= 8 ? 2 : 1;
  const shown = lines.slice(0, room);
  shown.forEach((line, index) => canvas.text(1, canvas.height - shown.length + index, truncateText(line, canvas.width - 2), {fg: color}));
}

function drawGrid(canvas: Canvas, palette: ArcadePalette, view: View, layout: BoardLayout): void {
  const {board} = view;
  const {style, size} = layout;
  const analysis = board.analysis();
  const colors = regionColors(size, palette.deep, palette);
  const regions = board.puzzle.regions;
  const lineFg = mixRgb(palette.muted, palette.deep, 0.1);
  const cursorRow = Math.floor(view.cursor / size);
  const cursorColumn = view.cursor % size;
  const hintTargets = new Set(view.hint?.targets ?? []);
  const hintInvolved = new Set(view.hint?.involved ?? []);
  const pitchX = style.cw + style.gx;
  const pitchY = style.ch + style.gy;
  const cellX = (column: number): number => layout.x + (style.gx ? 1 : 0) + column * pitchX;
  const cellY = (row: number): number => layout.y + (style.gy ? 1 : 0) + row * pitchY;
  const regionAt = (row: number, column: number): number => regions[Math.min(size - 1, row) * size + Math.min(size - 1, column)]!;
  const vEdge = (row: number, column: number): boolean => column === 0 || column === size || regions[row * size + column] !== regions[row * size + column - 1];
  const hEdge = (row: number, column: number): boolean => row === 0 || row === size || regions[row * size + column] !== regions[(row - 1) * size + column];
  const glow = (region: number): number => (analysis.regionDone[region] ? 0.3 : 0);
  const regionBg = (region: number): Rgb => mixRgb(colors[region]!, palette.haze, glow(region));

  // lattice and gutters
  if (style.gx) {
    for (let column = 0; column <= size; column += 1) {
      const gx = layout.x + column * pitchX;
      for (let row = 0; row < size; row += 1) {
        const edge = vEdge(row, column);
        const bg = edge ? palette.deep : regionBg(regionAt(row, column));
        for (let line = 0; line < style.ch; line += 1) canvas.put(gx, cellY(row) + line, edge ? '│' : ' ', {fg: lineFg, bg, bold: edge});
      }
    }
  }
  if (style.gy) {
    for (let row = 0; row <= size; row += 1) {
      const gy = layout.y + row * pitchY;
      for (let column = 0; column < size; column += 1) {
        const edge = hEdge(row, column);
        const bg = edge ? palette.deep : regionBg(regionAt(row, column));
        for (let step = 0; step < style.cw; step += 1) canvas.put(cellX(column) + step, gy, edge ? '─' : ' ', {fg: lineFg, bg, bold: edge});
      }
      for (let column = 0; column <= size; column += 1) {
        const mask = (row > 0 && vEdge(row - 1, column) ? UP : 0) | (row < size && vEdge(row, column) ? DOWN : 0)
          | (column > 0 && hEdge(row, column - 1) ? LEFT : 0) | (column < size && hEdge(row, column) ? RIGHT : 0);
        canvas.put(layout.x + column * pitchX, gy, JUNCTIONS[mask]!, {fg: lineFg, bg: mask ? palette.deep : regionBg(regionAt(row, column)), bold: true});
      }
    }
  }

  // cells
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const cell = row * size + column;
      const mark = board.marks[cell]!;
      const clash = mark === CAT && analysis.conflict[cell] === 1;
      const region = regions[cell]!;
      let bg = regionBg(region);
      if (mark === CAT) bg = mixRgb(bg, palette.deep, 0.5);
      if (hintInvolved.has(cell)) bg = mixRgb(bg, palette.warn, 0.35);
      if (hintTargets.has(cell)) bg = mixRgb(bg, palette.warn, 0.6);
      if (clash) bg = mixRgb(bg, palette.bad, 0.55);
      if (cell === view.cursor) bg = mixRgb(bg, palette.haze, 0.45);
      const underline = !style.gy && hEdge(row + 1, column);
      const x = cellX(column);
      const y = cellY(row);
      const base: Style = {fg: palette.deep, bg, underline};
      canvas.fill(x, y, style.cw, style.ch, ' ', base);
      const marker = clash ? '!' : hintTargets.has(cell) ? '◆' : hintInvolved.has(cell) ? '◇' : '';
      const markerStyle: Style = {fg: clash ? palette.bad : mark === CAT ? palette.warn : palette.deep, bg, bold: true, underline};
      const letter = regionLetter(region);
      const letterStyle: Style = {...base, fg: mark === CAT ? mixRgb(palette.cat.belly, bg, 0.2) : mixRgb(palette.deep, bg, 0.25)};
      const blink = !view.reduced && (Math.floor(view.idleMs / 250) + cell * 3) % 22 === 0;
      const flick = !view.reduced && (Math.floor(view.idleMs / 500) + cell) % 11 === 0;
      const useText = view.plain;
      if (style.name === 'large' || style.name === 'medium') {
        canvas.text(x, y, letter, letterStyle);
        if (marker) canvas.text(x + style.cw - 1, y, marker, markerStyle);
        if (mark === EXCLUDED) drawCross(canvas, x, y, style, view.safe, {...base, fg: mixRgb(palette.deep, bg, 0.1), bold: true});
        else if (mark === CAT) {
          if (useText) {
            const lines = textCat(style.name, {blink, conflict: clash});
            lines.forEach((line, index) => canvas.text(x, y + index, line, {fg: palette.cat.body, bg, bold: true}));
            canvas.text(x, y, letter, letterStyle);
          } else {
            const buffer = scratch(style.cw, style.ch * 2);
            const age = view.settle[cell]!;
            const drop = !view.reduced && age >= 0 && age < SETTLE_MS ? Math.round((1 - easeOutBack(age / SETTLE_MS)) * -3) : 0;
            drawMiniCat(buffer, 1, (style.name === 'large' ? 1 : 0) + drop, palette, {blink, tail: style.name === 'large' ? (flick ? 1 : 0) : -1});
            canvas.blit(buffer, x, y);
            if (clash) canvas.text(x + style.cw - 1, y, '!', markerStyle);
          }
        }
        continue;
      }
      if (style.name === 'compact') {
        const slot = clash && mark === CAT ? '' : marker;
        canvas.text(x, y, slot || letter, slot ? markerStyle : letterStyle);
        if (mark === EXCLUDED) canvas.text(x + 2, y, view.safe ? 'x' : '×', {...base, bold: true});
        if (mark === CAT) canvas.text(x + 1, y, textCat('compact', {blink, conflict: clash})[0]!, {...base, fg: mixRgb(palette.cat.body, palette.haze, 0.3), bold: true});
      } else if (style.name === 'tight') {
        if (mark === CAT) canvas.text(x, y, textCat('tight', {blink, conflict: clash})[0]!, {...base, fg: mixRgb(palette.cat.body, palette.haze, 0.3), bold: true});
        else if (mark === EXCLUDED) canvas.text(x + 1, y, view.safe ? 'x' : '×', {...base, bold: true});
        else canvas.text(x + 1, y, letter, letterStyle);
        if (marker && mark !== CAT) canvas.text(x, y, marker, markerStyle);
      } else {
        if (mark === CAT) canvas.text(x, y, textCat('mini', {blink, conflict: clash})[0]!, {...base, fg: mixRgb(palette.cat.body, palette.haze, 0.3), bold: true});
        else canvas.text(x, y, `${marker || letter}${mark === EXCLUDED ? (view.safe ? 'x' : '×') : ' '}`, mark === EXCLUDED ? {...base, bold: true} : letterStyle);
        if (cell === view.cursor && mark !== CAT) canvas.put(x, y, '▶', {...markerStyle, fg: palette.accent});
      }
    }
  }

  // cursor: a ring in the accent over the lattice, brackets over the gutters
  const accent: Style = {fg: palette.accent, bold: true};
  const cx = cellX(cursorColumn);
  const cy = cellY(cursorRow);
  if (style.gx && style.gy) {
    const left = cx - 1;
    const right = cx + style.cw;
    const top = cy - 1;
    const bottom = cy + style.ch;
    canvas.hline(left + 1, top, style.cw, '─', accent);
    canvas.hline(left + 1, bottom, style.cw, '─', accent);
    canvas.vline(left, top + 1, style.ch, '│', accent);
    canvas.vline(right, top + 1, style.ch, '│', accent);
    canvas.put(left, top, '┌', accent); canvas.put(right, top, '┐', accent);
    canvas.put(left, bottom, '└', accent); canvas.put(right, bottom, '┘', accent);
  } else if (style.gx) {
    canvas.put(cx - 1, cy, '[', accent);
    canvas.put(cx + style.cw, cy, ']', accent);
  }

  if (layout.labels) drawLabels(canvas, palette, view, layout, cellX, cellY);
}

function drawCross(canvas: Canvas, x: number, y: number, style: BoardLayout['style'], safe: boolean, look: Style): void {
  const rows = style.name === 'large' ? (safe ? ['\\ /', ' X ', '/ \\'] : ['╲ ╱', ' ╳ ', '╱ ╲']) : (safe ? ['\\/', '/\\'] : ['╲╱', '╱╲']);
  const left = x + Math.floor((style.cw - displayWidth(rows[0]!)) / 2);
  const top = y + Math.floor((style.ch - rows.length) / 2);
  rows.forEach((row, index) => canvas.text(left, top + index, row, look));
}

function drawLabels(canvas: Canvas, palette: ArcadePalette, view: View, layout: BoardLayout, cellX: (column: number) => number, cellY: (row: number) => number): void {
  const analysis = view.board.analysis();
  const size = layout.size;
  const style = layout.style;
  const tick = '✔';
  for (let row = 0; row < size; row += 1) {
    const y = cellY(row) + Math.floor((style.ch - 1) / 2);
    const label = String(row + 1);
    const active = row === Math.floor(view.cursor / size);
    canvas.text(layout.x - 1 - label.length, y, label, {fg: active ? palette.ink : palette.faint, bold: active});
    if (analysis.rowDone[row]) canvas.text(layout.x + layout.width + 1, y, tick, {fg: palette.ok, bold: true});
    else if (analysis.rowCats[row]! > 1) canvas.text(layout.x + layout.width + 1, y, '!', {fg: palette.bad, bold: true});
  }
  for (let column = 0; column < size; column += 1) {
    const text = analysis.columnDone[column] ? tick : analysis.columnCats[column]! > 1 ? '!' : String(column + 1);
    const color = analysis.columnDone[column] ? palette.ok : analysis.columnCats[column]! > 1 ? palette.bad : column === view.cursor % size ? palette.ink : palette.faint;
    const x = cellX(column) + Math.floor((style.cw - text.length) / 2);
    canvas.text(x, layout.headerY, text, {fg: color, bold: text === tick || text === '!' || column === view.cursor % size});
  }
}
