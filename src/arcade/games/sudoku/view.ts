import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {CAT_ASCII, catPixels} from '../../../idle/catSprite.js';
import {GLYPHS} from '../../../ui/glyphs.js';
import {typeset} from '../../../ui/typography.js';
import {displayWidth, truncateText} from '../../../util/text.js';
import {PixelBuffer, spriteFromRows, type Canvas, type Style} from '../../Canvas.js';
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
  /** 0..1 soft highlight of a just-completed row, column or box (index 0..26). */
  glow: ArrayLike<number>;
  message: string;
  messageTone: 'info' | 'good' | 'warn';
  celebration: {heading: string; detail: string} | undefined;
}

export const POP_MS = 220;

export function needsText(): string { return `Needs at least ${MIN_COLUMNS}x${MIN_ROWS}`; }

// ---- lines ----------------------------------------------------------------------------------------------------

type Arm = 0 | 1 | 2;
const LIGHT: Record<string, string> = {ud: '│', lr: '─', dr: '┌', dl: '┐', ur: '└', ul: '┘', udr: '├', udl: '┤', dlr: '┬', ulr: '┴', udlr: '┼', u: '│', d: '│', l: '─', r: '─'};
const HEAVY: Record<string, string> = {ud: '┃', lr: '━', dr: '┏', dl: '┓', ur: '┗', ul: '┛', udr: '┣', udl: '┫', dlr: '┳', ulr: '┻', udlr: '╋', u: '┃', d: '┃', l: '━', r: '━'};
const MIXED: Record<string, string> = {'udr:21': '┠', 'udr:12': '┝', 'udl:21': '┨', 'udl:12': '┥', 'dlr:21': '┰', 'dlr:12': '┯', 'ulr:21': '┸', 'ulr:12': '┷', 'udlr:21': '╂', 'udlr:12': '┿'};

/** A junction of up to four arms (0 none, 1 thin, 2 heavy). Mixed weights use the proper glyph where Unicode has one. */
function junction(up: Arm, down: Arm, left: Arm, right: Arm, safe: boolean): string {
  if (safe) return up || down || left || right ? '+' : ' ';
  const key = `${up ? 'u' : ''}${down ? 'd' : ''}${left ? 'l' : ''}${right ? 'r' : ''}`;
  const vertical = Math.max(up, down);
  const horizontal = Math.max(left, right);
  if (vertical && horizontal && vertical !== horizontal) {
    const mixed = MIXED[`${key}:${vertical}${horizontal}`];
    if (mixed) return mixed;
  }
  return (Math.max(vertical, horizontal) === 2 ? HEAVY : LIGHT)[key] ?? '┼';
}

function drawLines(canvas: Canvas, layout: Layout, palette: ArcadePalette, view: BoardView): void {
  const thin: Style = {fg: palette.line, dim: true};
  const heavy: Style = {fg: palette.accentSoft, bold: true};
  const safe = view.safe;
  const vertical = (heavyLine: boolean): string => (safe ? (heavyLine ? '#' : ':') : heavyLine ? '┃' : '│');
  const horizontal = (heavyLine: boolean): string => (safe ? (heavyLine ? '=' : '-') : heavyLine ? '━' : '─');
  for (const line of layout.hlines) canvas.hline(layout.x, layout.y + line.at, layout.boardW, horizontal(line.heavy), line.heavy ? heavy : thin);
  for (const line of layout.vlines) canvas.vline(layout.x + line.at, layout.y, layout.boardH, vertical(line.heavy), line.heavy ? heavy : thin);
  for (const h of layout.hlines) {
    for (const v of layout.vlines) {
      const vw: Arm = v.heavy ? 2 : 1;
      const hw: Arm = h.heavy ? 2 : 1;
      const up: Arm = h.at > 0 ? vw : 0;
      const down: Arm = h.at < layout.boardH - 1 ? vw : 0;
      const left: Arm = v.at > 0 ? hw : 0;
      const right: Arm = v.at < layout.boardW - 1 ? hw : 0;
      canvas.put(layout.x + v.at, layout.y + h.at, junction(up, down, left, right, safe), h.heavy || v.heavy ? heavy : thin);
    }
  }
}

// ---- cells ----------------------------------------------------------------------------------------------------

interface Tones { tintA: Rgb; tintB: Rgb; matchFill: number }

function drawCell(canvas: Canvas, layout: Layout, palette: ArcadePalette, view: BoardView, cell: number, conflicts: boolean[], tones: Tones): void {
  const {state} = view;
  const r = row(cell);
  const c = column(cell);
  const x = layout.x + layout.xs[c]!;
  const y = layout.y + layout.ys[r]!;
  const {cw, ch} = layout;
  const cursor = state.cursor;
  const isCursor = cell === cursor;
  const digit = state.grid[cell]!;
  const focusDigit = state.grid[cursor]!;
  const clue = state.isClue(cell);
  let bg = (box(cell) + Math.floor(box(cell) / 3)) % 2 === 0 ? tones.tintA : tones.tintB;
  if (!view.hidden) {
    if (r === row(cursor) || c === column(cursor) || box(cell) === box(cursor)) bg = mixRgb(bg, palette.accent, 0.12);
    if (focusDigit && digit === focusDigit) bg = mixRgb(bg, palette.accent, tones.matchFill);
    const glow = Math.max(view.glow[r] ?? 0, view.glow[9 + c] ?? 0, view.glow[18 + box(cell)] ?? 0);
    if (glow > 0) bg = mixRgb(bg, palette.ok, 0.28 * glow);
    const pop = view.pop[cell] ?? 0;
    if (pop > 0) bg = mixRgb(bg, palette.haze, 0.55 * (pop / POP_MS));
  }
  let style: Style = {bg};
  if (isCursor && !view.hidden) style = view.color ? {bg: palette.accent, fg: palette.deep, bold: true} : {reverse: true, bold: true};
  canvas.fill(x, y, cw, ch, ' ', style);
  if (view.hidden) return;
  const middle = y + Math.floor(ch / 2);
  const conflict = conflicts[cell]!;
  const mark = (xx: number, glyph: string): void => { canvas.put(xx, middle, glyph, isCursor ? {...style, bold: true} : {bg, fg: palette.warn, bold: true}); };

  if (digit) {
    const fg = isCursor && view.color ? palette.deep : conflict ? palette.bad : clue ? palette.ink : palette.accent;
    const matched = focusDigit && digit === focusDigit && !isCursor;
    const digitStyle: Style = {...style, bg: isCursor ? style.bg : bg, fg: isCursor && !view.color ? undefined : fg, bold: clue || conflict || isCursor || (view.pop[cell] ?? 0) > 0, underline: Boolean(matched), reverse: isCursor && !view.color};
    canvas.put(x + Math.floor((cw - 1) / 2), middle, String(digit), digitStyle);
  } else if (state.notes[cell]) {
    drawNotes(canvas, layout, palette, view, cell, x, y, bg, isCursor ? style : undefined);
  }
  if (cw >= 3 && isCursor) { canvas.put(x, middle, '[', style); canvas.put(x + cw - 1, middle, conflict && cw === 3 ? '!' : ']', style); }
  if (conflict) {
    if (cw >= 5) mark(x + 1, '!');
    else if (cw === 3) { if (!isCursor) mark(x + 2, '!'); }
    else mark(x + 1, '!');
  }
}

function drawNotes(canvas: Canvas, layout: Layout, palette: ArcadePalette, view: BoardView, cell: number, x: number, y: number, bg: Rgb, cursorStyle: Style | undefined): void {
  const mask = view.state.notes[cell]!;
  const base: Style = cursorStyle ?? {bg, fg: palette.muted};
  const style: Style = cursorStyle ? cursorStyle : {...base, dim: true};
  if (layout.ch === 3 && layout.cw >= 5) {
    const left = x + Math.floor((layout.cw - 5) / 2);
    for (let digit = 1; digit <= 9; digit += 1) {
      if (mask & (1 << (digit - 1))) canvas.put(left + ((digit - 1) % 3) * 2, y + Math.floor((digit - 1) / 3), String(digit), style);
    }
    return;
  }
  const marks = [...Array(9).keys()].filter(index => mask & (1 << index));
  const middle = y + Math.floor(layout.ch / 2);
  if (layout.cw >= 3 && marks.length === 1) canvas.put(x + Math.floor((layout.cw - 1) / 2), middle, String(marks[0]! + 1), {...style, italic: true});
  else canvas.put(x + Math.floor((layout.cw - 1) / 2), middle, view.safe ? '.' : '·', style);
}

// ---- HUD ------------------------------------------------------------------------------------------------------

function remainingLine(view: BoardView, width: number): string {
  const counts = view.state.counts();
  const done = view.safe ? '+' : GLYPHS.saved;
  if (width >= 35) return [...Array(9).keys()].map(index => `${index + 1}:${counts[index + 1]! >= 9 ? done : 9 - counts[index + 1]!}`).join(' ');
  return [...Array(9).keys()].map(index => (counts[index + 1]! >= 9 ? (view.safe ? '.' : '·') : String(index + 1))).join(' ');
}

function messageStyle(palette: ArcadePalette, tone: BoardView['messageTone']): Style {
  return {fg: tone === 'good' ? palette.ok : tone === 'warn' ? palette.warn : palette.muted};
}

function conflictText(conflicts: boolean[]): string {
  const count = conflicts.reduce((sum, bad) => sum + (bad ? 1 : 0), 0);
  return count ? `! ${count} clash${count === 1 ? '' : 'es'}` : 'No clashes';
}

function drawTopHud(canvas: Canvas, layout: Layout, palette: ArcadePalette, view: BoardView, conflicts: boolean[]): void {
  const {state} = view;
  const width = canvas.width - layout.hudX;
  const time = formatTime(state.elapsedMs / 1000);
  const title = typeset({role: 'title', text: 'Sudoku', maxColumns: 12, maxRows: 1});
  canvas.typeBlock(title, layout.hudX, layout.hudY, {fg: palette.ink, bold: true});
  let at = layout.hudX + title.columns + 2;
  const put = (text: string, style: Style): void => { if (at + displayWidth(text) <= layout.hudX + width) { canvas.text(at, layout.hudY, text, style); at += displayWidth(text) + 2; } };
  put(DIFFICULTY_LABEL[state.difficulty], {fg: palette.accent, bold: true});
  const clock = typeset({role: 'counter', text: time, maxColumns: 8, maxRows: 1});
  if (at + clock.columns <= layout.hudX + width) { canvas.typeBlock(clock, at, layout.hudY, {fg: palette.ink, bold: true}); at += clock.columns + 2; }
  put(`Hints ${state.hints}`, {fg: palette.muted});
  put(state.notesMode ? 'Notes ON' : 'Notes off', state.notesMode ? {fg: palette.accent, bold: true} : {fg: palette.faint});
  if (conflicts.includes(true)) put(conflictText(conflicts), {fg: palette.bad, bold: true});
  const remaining = remainingLine(view, layout.hudW);
  const second = layout.messageRow === undefined && view.message ? view.message : remaining;
  canvas.text(layout.hudX, layout.hudY + 1, truncateText(second, width), layout.messageRow === undefined && view.message ? messageStyle(palette, view.messageTone) : {fg: palette.muted});
  if (layout.messageRow !== undefined && view.message) canvas.text(layout.hudX, layout.messageRow, truncateText(view.message, width), messageStyle(palette, view.messageTone));
}

function drawSideHud(canvas: Canvas, layout: Layout, palette: ArcadePalette, view: BoardView, conflicts: boolean[]): void {
  const {state} = view;
  const x = layout.hudX;
  const width = layout.hudW;
  let y = layout.hudY;
  const roomy = layout.boardH >= 17;
  const title = typeset({role: 'title', text: 'Classic Sudoku', maxColumns: width, maxRows: roomy ? 2 : 1});
  canvas.typeBlock(title, x, y, {fg: palette.ink, bold: true});
  y += title.rows;
  canvas.text(x, y, DIFFICULTY_LABEL[state.difficulty], {fg: palette.accent, bold: true});
  y += roomy ? 2 : 1;
  const clock = typeset({role: 'counter', text: formatTime(state.elapsedMs / 1000), maxColumns: width, maxRows: roomy ? 2 : 1});
  canvas.typeBlock(clock, x, y, {fg: palette.ink, bold: true});
  y += clock.rows + (roomy ? 1 : 0);
  canvas.text(x, y, `Hints used  ${state.hints}`, {fg: palette.muted});
  canvas.text(x, y + 1, state.notesMode ? 'Notes: ON (n)' : 'Notes: off (n)', state.notesMode ? {fg: palette.accent, bold: true} : {fg: palette.faint});
  const bad = conflicts.includes(true);
  canvas.text(x, y + 2, conflictText(conflicts), bad ? {fg: palette.bad, bold: true} : {fg: palette.faint});
  y += roomy ? 4 : 3;
  const counts = state.counts();
  const done = view.safe ? '+' : GLYPHS.saved;
  canvas.text(x, y, 'Left', {fg: palette.faint});
  for (let digit = 1; digit <= 9; digit += 1) {
    const left = counts[digit]! >= 9;
    const px = x + (digit - 1) * 2;
    canvas.text(px, y + 1, String(digit), {fg: palette.accentSoft, bold: true});
    canvas.text(px, y + 2, left ? done : String(9 - counts[digit]!), left ? {fg: palette.ok} : {fg: palette.ink});
  }
  y += 4;
  if (view.message) {
    const words = view.message.split(' ');
    let line = '';
    for (const word of words) {
      if (line && displayWidth(line) + 1 + displayWidth(word) > width) {
        if (y < layout.hudY + layout.boardH) canvas.text(x, y, line, messageStyle(palette, view.messageTone));
        y += 1; line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line && y < layout.hudY + layout.boardH) canvas.text(x, y, line, messageStyle(palette, view.messageTone));
  }
}

function drawCelebration(canvas: Canvas, layout: Layout, palette: ArcadePalette, view: BoardView): void {
  const celebration = view.celebration!;
  const head = typeset({role: 'celebration', text: celebration.heading, maxColumns: Math.max(6, layout.boardW - 4), maxRows: layout.boardH >= 19 ? 2 : 1});
  const rows = head.rows + 1;
  const width = Math.min(layout.boardW, Math.max(head.columns, displayWidth(celebration.detail)) + 6);
  const left = layout.x + Math.floor((layout.boardW - width) / 2);
  const top = layout.y + Math.max(0, Math.floor((layout.boardH - rows - 2) / 2));
  const band = {bg: mixRgb(palette.deep, palette.dusk, 0.5), fg: palette.ink};
  canvas.fill(left, top, width, rows + 2, ' ', band);
  canvas.typeBlock(head, left + Math.floor((width - head.columns) / 2), top + 1, {...band, fg: palette.accent, bold: true});
  canvas.center(top + 1 + head.rows, celebration.detail, {...band, fg: palette.muted}, left, width);
}

/** Draw the playing screen (or the small-canvas note). */
export function drawPlay(canvas: Canvas, palette: ArcadePalette, view: BoardView): void {
  canvas.clear();
  const layout = layoutFor(canvas.width, canvas.height);
  if (!layout) {
    canvas.center(Math.floor(canvas.height / 2), truncateText(needsText(), canvas.width), {fg: palette.warn});
    return;
  }
  const conflicts = view.state.conflicts();
  const tones: Tones = {
    tintA: mixRgb(palette.deep, palette.accent, 0.06), tintB: mixRgb(palette.deep, palette.accent, 0.16), matchFill: 0.3,
  };
  drawLines(canvas, layout, palette, view);
  for (let cell = 0; cell < 81; cell += 1) drawCell(canvas, layout, palette, view, cell, conflicts, tones);
  if (view.hidden) canvas.center(layout.y + Math.floor(layout.boardH / 2), ' Paused ', {fg: palette.ink, bg: mixRgb(palette.deep, palette.dusk, 0.5), bold: true}, layout.x, layout.boardW);
  if (layout.hud === 'side') drawSideHud(canvas, layout, palette, view, conflicts);
  else drawTopHud(canvas, layout, palette, view, conflicts);
  if (view.celebration && !view.hidden) drawCelebration(canvas, layout, palette, view);
}

/** Which of the 27 units are complete, for the glow. */
export function completeUnits(grid: Grid): boolean[] {
  return UNITS.map((_, unit) => unitComplete(grid, unit));
}

// ---- start menu -----------------------------------------------------------------------------------------------

/** The start screen: Vespyr sitting quietly above the title, then the choices. */
export function drawMenu(canvas: Canvas, palette: ArcadePalette, menu: Menu, view: {color: boolean; safe: boolean; note: string}): void {
  canvas.clear();
  const total = menu.items.length;
  let y = 0;
  const tall = canvas.height >= total + 9;
  if (tall) {
    if (view.color && !view.safe && canvas.width >= 16) {
      const pixels = new PixelBuffer(14, 8);
      pixels.sprite(spriteFromRows(catPixels('sit'), {L: palette.cat.body, E: palette.cat.eye}), 0, 0);
      canvas.blit(pixels, Math.floor((canvas.width - 14) / 2), y);
      y += 4;
    } else {
      CAT_ASCII.forEach((line, index) => canvas.center(y + index, line, {fg: palette.accentSoft}));
      y += 3;
    }
    y += 1;
  }
  if (canvas.height >= total + 3) {
    const title = typeset({role: 'title', text: 'Classic Sudoku', maxColumns: canvas.width - 2, maxRows: tall && canvas.height >= total + 12 ? 2 : 1});
    canvas.typeBlock(title, Math.floor((canvas.width - title.columns) / 2), y, {fg: palette.ink, bold: true});
    y += title.rows;
    canvas.center(y, truncateText(view.note || 'Choose a puzzle', canvas.width - 2), {fg: palette.faint});
    y += 2;
  }
  const room = Math.max(1, canvas.height - y);
  const first = Math.max(0, Math.min(menu.index - Math.floor(room / 2), total - room));
  const window = {items: menu.items.slice(first, first + room), index: menu.index - first};
  const shown = new Menu(window.items);
  shown.index = window.index;
  shown.draw(canvas, palette, 0, y, canvas.width);
}
