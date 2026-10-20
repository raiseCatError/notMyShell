import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {PixelBuffer, type Canvas, type Style} from '../../Canvas.js';
import {easeOutBack} from '../../easing.js';
import {regionColors, type ArcadePalette} from '../../palette.js';
import {typeset} from '../../../ui/typography.js';
import {displayWidth, truncateText} from '../../../util/text.js';
import {wrap} from '../../ArcadeSession.js';
import type {DokuBoard} from './board.js';
import {formatTime} from './board.js';
import {chooseLayout, minimumCanvas, type BoardLayout} from './layout.js';
import {regionLetter} from './rules.js';
import type {Hint} from './solver.js';
import {drawMiniCat, textCat} from './sprite.js';
import {CAT, EXCLUDED} from './types.js';

export const SETTLE_MS = 280;

/** Everything the renderer needs besides the canvas and palette. */
export interface View {
  board: DokuBoard;
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
}

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
  canvas.clear(palette.deep);
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
  drawGrid(canvas, palette, view, layout);
  drawMessage(canvas, palette, view);
}

function drawHud(canvas: Canvas, palette: ArcadePalette, view: View): void {
  const {board} = view;
  const analysis = board.analysis();
  const wide = canvas.width >= 44;
  const title = typeset({role: 'heading', text: 'Vespyr Doku', maxColumns: Math.max(6, canvas.width - 2), maxRows: 1});
  canvas.typeBlock(title, 1, 0, {fg: palette.ink, bold: true});
  const level = `${board.difficulty[0]!.toUpperCase()}${board.difficulty.slice(1)} ${board.size}×${board.size}`;
  const timer = typeset({role: 'counter', text: formatTime(board.elapsedMs), maxColumns: 9, maxRows: 1});
  const stats = wide ? `Cats ${analysis.cats}/${board.size} · Hints ${board.hints}` : `${analysis.cats}/${board.size}`;
  const right = timer.columns + 2 + displayWidth(stats);
  const left = 1 + title.columns + 2;
  if (left + displayWidth(level) + 3 + right <= canvas.width) canvas.text(left, 0, level, {fg: palette.accent});
  if (left + right <= canvas.width) {
    canvas.text(canvas.width - 1 - right, 0, stats, {fg: palette.muted});
    canvas.typeBlock(timer, canvas.width - 1 - timer.columns, 0, {fg: view.won ? palette.ok : palette.ink, bold: true});
  } else if (timer.columns + 1 + title.columns + 2 <= canvas.width) {
    canvas.typeBlock(timer, canvas.width - 1 - timer.columns, 0, {fg: palette.ink, bold: true});
  }
}

function drawMessage(canvas: Canvas, palette: ArcadePalette, view: View): void {
  const analysis = view.board.analysis();
  const clashes = analysis.conflict.reduce((sum, value) => sum + value, 0);
  let text = view.message;
  let color = palette.warn;
  if (!text) {
    if (view.won) { text = 'Every row, column and region has its cat, and none touch.'; color = palette.ok; }
    else if (clashes) { text = `${clashes} cat${clashes === 1 ? '' : 's'} clash (marked !): same row, column or region, or touching.`; color = palette.bad; }
    else { text = 'One cat in every row, column and region. No two cats touch, even diagonally.'; color = palette.faint; }
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

