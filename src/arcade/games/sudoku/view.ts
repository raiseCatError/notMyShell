import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {CAT_ASCII, catPixels} from '../../../idle/catSprite.js';
import {GLYPHS} from '../../../ui/glyphs.js';
import {typeset} from '../../../ui/typography.js';
import {displayWidth, truncateText} from '../../../util/text.js';
import {PixelBuffer, spriteFromRows, type Canvas, type Style} from '../../Canvas.js';
import {clamp} from '../../easing.js';
import type {Reveal} from '../../fx/cells.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {DIFFICULTY_LABEL} from './generator.js';
import {layoutFor, MIN_COLUMNS, MIN_ROWS, type Layout} from './layout.js';
import {formatTime} from './record.js';
import {box, column, row, unitComplete, UNITS, type Grid} from './solver.js';
import type {SudokuState} from './state.js';

/** Everything the board drawing reads. The game owns it; drawing never changes the game. */
export interface BoardView {
  state: SudokuState;
  /** Hide the digits (paused), so a pause cannot be used to think. */
  hidden: boolean;
  color: boolean;
  safe: boolean;
  /** Milliseconds left in the entry animation of each cell. */
  pop: ArrayLike<number>;
  /** 1 → 0 progress of each just-completed row, column or box (index 0..26): a sweep runs along its cells. */
  glow: ArrayLike<number>;
  message: string;
  messageTone: 'info' | 'good' | 'warn';
  /** The solved board's light wave while the game's finale plays. */
  wave: Reveal | undefined;
  /** Shown in the HUD once the puzzle is solved: `Solved in 3:07`. */
  solved: string | undefined;
}

export const POP_MS = 220;

export function needsText(): string { return `Needs at least ${MIN_COLUMNS}x${MIN_ROWS}`; }

/** A short rise and a longer fall: the light of a sweep passing a cell. */
const hump = (t: number): number => (t <= 0 || t >= 1 ? 0 : t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75);

/**
 * How brightly `cell` glows from finished units now. Each unit's sweep runs along its nine cells in order (a row left to
 * right, a column top to bottom, a box in reading order), so a completed line reads as a light passing through it.
 */
function unitLight(view: BoardView, cell: number): number {
  let light = 0;
  for (const unit of [row(cell), 9 + column(cell), 18 + box(cell)]) {
    const left = view.glow[unit] ?? 0;
    if (left <= 0) continue;
    const order = UNITS[unit]!.indexOf(cell);
    light = Math.max(light, hump((1 - left) * 1.6 - order * 0.07));
  }
  return light;
}

// ---- tiles ----------------------------------------------------------------------------------------------------

interface Tile { fill: Rgb; digit?: string; fg?: Rgb; bold?: boolean; underline?: boolean; reverse?: boolean; mark?: string; markFg?: Rgb }

function tileFor(view: BoardView, look: ArcadeLook, cell: number, conflicts: boolean[]): Tile {
  const {state} = view;
  const cursor = state.cursor;
  const digit = state.grid[cell]!;
  const focusDigit = state.grid[cursor]!;
  const clue = state.isClue(cell);
  let fill = look.surface.raised;
  if (view.hidden) return {fill};
  const peer = row(cell) === row(cursor) || column(cell) === column(cursor) || box(cell) === box(cursor);
  if (peer) fill = look.surface.raised2;
  if (focusDigit && digit === focusDigit && cell !== cursor) fill = mixRgb(look.surface.raised2, look.hue.lilac, 0.32);
  const conflict = conflicts[cell]!;
  if (conflict) fill = mixRgb(look.surface.raised, look.bad, 0.34);
  const light = Math.max(unitLight(view, cell), view.wave?.amount(cell) ?? 0);
  if (light > 0) fill = mixRgb(fill, look.ok, 0.5 * light);
  const pop = view.pop[cell] ?? 0;
  if (pop > 0) fill = mixRgb(fill, look.text.strong, 0.35 * (pop / POP_MS));
  const tile: Tile = {fill};
  if (digit) {
    tile.digit = String(digit);
    // Givens are bright and bold; your digits are a different hue and weight (and underlined without color).
    tile.fg = conflict ? look.bad : clue ? look.text.strong : look.hue.sky;
    tile.bold = clue || conflict;
    tile.underline = !view.color && !clue;
  }
  if (conflict) { tile.mark = '!'; tile.markFg = look.bad; }
  if (cell === cursor) {
    tile.fill = look.accent;
    if (tile.digit) tile.fg = look.text.onAccent;
    tile.bold = true;
    tile.reverse = !view.color;
    if (conflict) tile.markFg = look.text.onAccent;
  }
  return tile;
}

/** The text of a cell's notes in its digit row: positional (digit d at column d) when the tile is nine wide. */
function notesText(mask: number, width: number, safe: boolean): string {
  const digits = [...Array(9).keys()].filter(index => mask & (1 << index)).map(index => String(index + 1));
  if (!digits.length) return '';
  if (width >= 9) return [...Array(9).keys()].map(index => (mask & (1 << index) ? String(index + 1) : ' ')).join('').slice(0, width);
  const packed = digits.join('');
  if (displayWidth(packed) <= width) return packed;
  if (width >= 3) return `${packed.slice(0, width - 1)}${safe ? '+' : '…'}`;
  return safe ? '.' : '·';
}

function drawTile(canvas: Canvas, layout: Layout, look: ArcadeLook, view: BoardView, cell: number, tile: Tile, plate: Rgb): void {
  const x = layout.x + layout.xs[column(cell)]!;
  const y = layout.y + layout.ys[row(cell)]!;
  const {cw, ch} = layout;
  // Half-block edges keep tiles apart vertically; without color or in Safe Glyphs the edges are plain rows.
  const edges = view.color && !view.safe;
  const digitRow = ch === 3 ? y + 1 : y;
  for (let dy = 0; dy < ch; dy += 1) {
    const top = ch === 3 && dy === 0;
    const bottom = (ch === 3 && dy === 2) || (ch === 2 && dy === 1);
    if (edges && (top || bottom)) canvas.hline(x, y + dy, cw, top ? '▄' : '▀', {fg: tile.fill, bg: plate});
    else canvas.fill(x, y + dy, cw, 1, ' ', {bg: tile.fill, ...(tile.reverse && y + dy === digitRow ? {reverse: true} : {})});
  }
  const style: Style = {bg: tile.fill, ...(tile.fg ? {fg: tile.fg} : {}), bold: Boolean(tile.bold), underline: Boolean(tile.underline), reverse: Boolean(tile.reverse)};
  if (tile.digit) canvas.put(x + Math.floor((cw - 1) / 2), digitRow, tile.digit, style);
  else if (!view.hidden && view.state.notes[cell]) {
    const text = notesText(view.state.notes[cell]!, cw >= 9 ? 9 : cw, view.safe);
    canvas.text(x + Math.floor((cw - displayWidth(text)) / 2), digitRow, text, {...style, fg: cell === view.state.cursor ? look.text.onAccent : look.hue.lilac, bold: false});
  }
  if (tile.mark && cw >= 3) canvas.put(x + cw - 1, digitRow, tile.mark, {...style, fg: tile.markFg, bold: true});
}

function drawBoard(canvas: Canvas, layout: Layout, look: ArcadeLook, view: BoardView, conflicts: boolean[]): void {
  const well = look.surface.sunken;
  const plate = look.surface.base;
  canvas.fill(layout.x, layout.y, layout.boardW, layout.boardH, ' ', {bg: well});
  if (!view.color) {
    // Without color the channels carry the box structure as lines.
    const line = view.safe ? {v: '#', h: '=', cross: '+'} : {v: '┃', h: '━', cross: '╋'};
    for (const span of layout.plateX.slice(1)) canvas.vline(layout.x + span.at - 1, layout.y, layout.boardH, line.v, {bold: true});
    for (const span of layout.plateY.slice(1)) canvas.hline(layout.x, layout.y + span.at - 1, layout.boardW, line.h, {bold: true});
    for (const across of layout.plateX.slice(1)) for (const down of layout.plateY.slice(1)) canvas.put(layout.x + across.at - 1, layout.y + down.at - 1, line.cross, {bold: true});
  }
  for (const across of layout.plateX) for (const down of layout.plateY) canvas.fill(layout.x + across.at, layout.y + down.at, across.size, down.size, ' ', {bg: plate});
  for (let cell = 0; cell < 81; cell += 1) drawTile(canvas, layout, look, view, cell, tileFor(view, look, cell, conflicts), plate);
  if (view.hidden) {
    const label = ' Paused ';
    canvas.center(layout.y + Math.floor(layout.boardH / 2), label, {fg: look.text.strong, bg: look.surface.selected, bold: true}, layout.x, layout.boardW);
  }
}

// ---- HUD ------------------------------------------------------------------------------------------------------

function messageStyle(look: ArcadeLook, tone: BoardView['messageTone']): Style {
  return {fg: tone === 'good' ? look.ok : tone === 'warn' ? look.warn : look.text.normal};
}

function conflictText(conflicts: boolean[]): string {
  const count = conflicts.reduce((sum, bad) => sum + (bad ? 1 : 0), 0);
  return count ? `! ${count} clash${count === 1 ? '' : 'es'}` : 'No clashes';
}

/**
 * The remaining-digit counter: a chip per digit with how many are still to place beneath it, a ✓ when all nine are in,
 * and the digit under the cursor lit, so "where else does this go" is one glance.
 */
function drawCounter(canvas: Canvas, look: ArcadeLook, view: BoardView, x: number, y: number, width: number): number {
  const counts = view.state.counts();
  const focus = view.state.grid[view.state.cursor]!;
  const step = width >= 26 ? 3 : 2;
  for (let digit = 1; digit <= 9; digit += 1) {
    const done = counts[digit]! >= 9;
    const px = x + (digit - 1) * step;
    const lit = digit === focus;
    const chip: Style = lit ? {fg: look.text.onAccent, bg: look.accent, bold: true} : done ? {fg: look.text.dim, bg: look.surface.raised} : {fg: look.text.strong, bg: look.surface.raised2, bold: true};
    canvas.text(px, y, step === 3 ? ` ${digit}` : String(digit), chip);
    const left = 9 - counts[digit]!;
    const below = done ? (view.safe ? '+' : GLYPHS.saved) : String(Math.max(0, left));
    canvas.text(px + (step === 3 ? 1 : 0), y + 1, below, done ? {fg: look.ok, bold: true} : {fg: look.text.normal});
  }
  return 2;
}

/** The counter in one row, for the top HUD: `1:5 2:✓ …`, or just the digits still to place when narrow. */
function drawRemainingLine(canvas: Canvas, look: ArcadeLook, view: BoardView, x: number, y: number, width: number): void {
  const counts = view.state.counts();
  const focus = view.state.grid[view.state.cursor]!;
  const wide = width >= 36;
  let at = x;
  if (width >= 42) { canvas.text(at, y, 'Left', {fg: look.text.dim}); at += 5; }
  for (let digit = 1; digit <= 9; digit += 1) {
    const done = counts[digit]! >= 9;
    const text = wide ? `${digit}:${done ? (view.safe ? '+' : GLYPHS.saved) : 9 - counts[digit]!}` : done ? (view.safe ? '.' : '·') : String(digit);
    if (at + displayWidth(text) > x + width) break;
    canvas.text(at, y, text, digit === focus ? {fg: look.text.onAccent, bg: look.accent, bold: true} : done ? {fg: look.ok} : {fg: look.text.normal});
    at += displayWidth(text) + 1;
  }
}

function drawTopHud(canvas: Canvas, layout: Layout, look: ArcadeLook, view: BoardView, conflicts: boolean[]): void {
  const {state} = view;
  const width = canvas.width - layout.hudX;
  const title = typeset({role: 'heading', text: 'Sudoku', maxColumns: 12, maxRows: 1});
  canvas.typeBlock(title, layout.hudX, layout.hudY, {fg: look.text.strong, bold: true});
  let at = layout.hudX + title.columns + 2;
  const put = (text: string, style: Style): void => { if (at + displayWidth(text) <= layout.hudX + width) { canvas.text(at, layout.hudY, text, style); at += displayWidth(text) + 2; } };
  put(DIFFICULTY_LABEL[state.difficulty], {fg: look.accent, bold: true});
  put(formatTime(state.elapsedMs / 1000), {fg: look.text.strong, bold: true});
  put(`Hints ${state.hints}`, {fg: look.text.dim});
  put(state.notesMode ? 'Notes ON' : 'Notes off', state.notesMode ? {fg: look.hue.lilac, bold: true} : {fg: look.text.dim});
  if (conflicts.includes(true)) put(conflictText(conflicts), {fg: look.bad, bold: true});
  if (view.solved) put(view.solved, {fg: look.ok, bold: true});
  const second = layout.messageRow === undefined && view.message;
  if (second) canvas.text(layout.hudX, layout.hudY + 1, truncateText(view.message, width), messageStyle(look, view.messageTone));
  else drawRemainingLine(canvas, look, view, layout.hudX, layout.hudY + 1, width);
  if (layout.messageRow !== undefined && view.message) canvas.text(layout.hudX, layout.messageRow, truncateText(view.message, width), messageStyle(look, view.messageTone));
}

function drawSideHud(canvas: Canvas, layout: Layout, look: ArcadeLook, view: BoardView, conflicts: boolean[]): void {
  const {state} = view;
  const x = layout.hudX;
  const width = layout.hudW;
  const bottom = layout.hudY + layout.boardH;
  let y = layout.hudY + (layout.boardH >= 25 ? 1 : 0);
  const roomy = layout.boardH >= 22;
  canvas.text(x, y, 'Classic Sudoku', {fg: look.text.strong, bold: true});
  y += 1;
  canvas.text(x, y, DIFFICULTY_LABEL[state.difficulty], {fg: look.accent, bold: true});
  y += roomy ? 2 : 1;
  const clock = typeset({role: 'counter', text: formatTime(state.elapsedMs / 1000), maxColumns: width, maxRows: roomy ? 2 : 1});
  canvas.typeBlock(clock, x, y, {fg: view.solved ? look.ok : look.text.strong, bold: true});
  y += clock.rows + (roomy ? 1 : 0);
  if (view.solved) { canvas.text(x, y, view.solved, {fg: look.ok, bold: true}); y += 2; }
  canvas.text(x, y, `Hints used  ${state.hints}`, {fg: look.text.normal});
  canvas.text(x, y + 1, state.notesMode ? 'Notes  ON (n)' : 'Notes  off (n)', state.notesMode ? {fg: look.hue.lilac, bold: true} : {fg: look.text.dim});
  const bad = conflicts.includes(true);
  canvas.text(x, y + 2, conflictText(conflicts), bad ? {fg: look.bad, bold: true} : {fg: look.text.dim});
  y += roomy ? 4 : 3;
  canvas.text(x, y, 'Still to place', {fg: look.text.dim});
  y += 1;
  y += drawCounter(canvas, look, view, x, y, width) + 1;
  if (view.message && y < bottom) {
    const words = view.message.split(' ');
    let line = '';
    for (const word of words) {
      if (line && displayWidth(line) + 1 + displayWidth(word) > width) {
        if (y < bottom) canvas.text(x, y, line, messageStyle(look, view.messageTone));
        y += 1; line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line && y < bottom) canvas.text(x, y, line, messageStyle(look, view.messageTone));
  }
}

/** Draw the playing screen (or the small-canvas note). */
export function drawPlay(canvas: Canvas, palette: ArcadePalette, view: BoardView): void {
  const look = arcadeLook(palette);
  canvas.clear(view.color ? look.surface.base : undefined);
  const layout = layoutFor(canvas.width, canvas.height);
  if (!layout) {
    canvas.center(Math.floor(canvas.height / 2), truncateText(needsText(), canvas.width), {fg: look.warn});
    return;
  }
  const conflicts = view.state.conflicts();
  drawBoard(canvas, layout, look, view, conflicts);
  if (layout.hud === 'side') drawSideHud(canvas, layout, look, view, conflicts);
  else drawTopHud(canvas, layout, look, view, conflicts);
}

/** Which of the 27 units are complete, for the glow. */
export function completeUnits(grid: Grid): boolean[] {
  return UNITS.map((_, unit) => unitComplete(grid, unit));
}

/** The cells of the solved board grouped by diagonal, top-left first: the order of the winning light wave. */
export function waveGroups(): number[][] {
  return Array.from({length: 17}, (_, sum) => [...Array(81).keys()].filter(cell => row(cell) + column(cell) === sum));
}

/** 0..1 eased progress of a unit's sweep, exported for tests. */
export const sweepAt = (left: number, order: number): number => hump(clamp((1 - left) * 1.6 - order * 0.07, 0, 1));

// ---- start menu -----------------------------------------------------------------------------------------------

/** The start screen: Vespyr sitting quietly above the title, then the choices. */
export function drawMenu(canvas: Canvas, palette: ArcadePalette, menu: Menu, view: {color: boolean; safe: boolean; note: string}): void {
  const look = arcadeLook(palette);
  canvas.clear(view.color ? look.surface.base : undefined);
  const total = menu.items.length;
  let y = Math.max(0, Math.floor((canvas.height - total - 10) / 2));
  const tall = canvas.height >= total + 9;
  if (tall) {
    if (view.color && !view.safe && canvas.width >= 16) {
      const pixels = new PixelBuffer(14, 8);
      pixels.sprite(spriteFromRows(catPixels('sit'), {L: palette.cat.body, E: palette.cat.eye}), 0, 0);
      canvas.blit(pixels, Math.floor((canvas.width - 14) / 2), y);
      y += 4;
    } else {
      CAT_ASCII.forEach((line, index) => canvas.center(y + index, line, {fg: look.accent}));
      y += 3;
    }
    y += 1;
  }
  if (canvas.height >= total + 3) {
    canvas.center(y, 'Classic Sudoku', {fg: look.text.strong, bold: true});
    y += 1;
    canvas.center(y, truncateText(view.note || 'Choose a puzzle', canvas.width - 2), {fg: look.text.dim});
    y += 2;
  }
  const room = Math.max(1, canvas.height - y);
  const first = Math.max(0, Math.min(menu.index - Math.floor(room / 2), total - room));
  const shown = new Menu(menu.items.slice(first, first + room));
  shown.index = menu.index - first;
  shown.draw(canvas, palette, 0, y, canvas.width);
}
