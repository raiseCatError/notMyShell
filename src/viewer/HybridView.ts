import type {Block} from '../markdown/blocks.js';
import {renderMarkdown} from '../markdown/render.js';
import {renderControlRows} from '../ui/controls.js';
import {framePanel} from '../ui/PanelShell.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {getIconStyle} from '../ui/glyphs.js';
import {colorLevel} from '../presentation/capabilities.js';
import {truncateAnsi, truncateText} from '../util/text.js';
import {headingIndex, inside, lineCells, type Cell, type EditorState} from './EditorPanel.js';
import {inert} from './document.js';
import type {ViewerLook} from './ViewerPanel.js';

/**
 * Hybrid Markdown editing (#460): the document reads rendered, except for the block the caret (or a selection) is in, which
 * shows its exact source. It is a presentation of the SAME TextBuffer the other modes use: every key is the editor's, the
 * caret and selection live in source coordinates, so the only mapping needed is from source lines to the rows drawn.
 *
 * - The document is cut into items by the shared source map (`Block.from/to`): each top-level block is one item, every line
 *   no block owns (blank lines, text past the parser's limit) is a one-line item. A block is the smallest region that is safe
 *   to reveal: a caret in a nested list item shows the whole list, in a table cell the whole table, in a fence the whole fence.
 * - Rendered items come from the ordinary renderer applied to that item's own lines, cached by text and width; a keystroke
 *   renders again only the item it changed. Nothing is rendered that is not on screen (or needed to place the caret).
 * - The viewport is anchored to a source line and a row offset inside its item, never to an absolute row, so revealing a block
 *   (which changes its height) does not move what is above it.
 * - A line the renderer cannot place (a block that renders to no rows) is shown raw: the fallback is always the source.
 */

export interface HybridItem {
  from: number;
  /** Exclusive. */
  to: number;
  /** The top-level block(s) the lines parse as; absent for a blank or stray line. */
  block?: Block;
}

export interface RawRow {
  start: number;
  end: number;
  cells: Cell[];
  width: number;
}

export interface HybridState {
  /** The first row drawn: a source line (the first line of an item) and the row offset inside that item. */
  top: {line: number; sub: number};
  stats: {parses: number; renders: number};
  cache: Map<string, string[]>;
  items?: {version: number; list: HybridItem[]};
}

export function createHybrid(): HybridState {
  return {top: {line: 0, sub: 0}, stats: {parses: 0, renders: 0}, cache: new Map()};
}

/** Cut `lineCount` lines into items: blocks as the parser placed them, every other line on its own. */
export function hybridItems(blocks: readonly Block[], lineCount: number): HybridItem[] {
  const items: HybridItem[] = [];
  let next = 0;
  for (const block of blocks) {
    if (block.from === undefined || block.to === undefined || block.from < next || block.to <= block.from || block.to > lineCount) continue;
    for (; next < block.from; next += 1) items.push({from: next, to: next + 1});
    items.push({from: block.from, to: block.to, block});
    next = block.to;
  }
  for (; next < lineCount; next += 1) items.push({from: next, to: next + 1});
  return items;
}

/** One source line cut into rows of at most `width` cells; wide characters and emoji are whole, tabs are spaces. */
export function wrapRaw(line: string, width: number): RawRow[] {
  const cells = lineCells(line, Number.POSITIVE_INFINITY);
  const rows: RawRow[] = [];
  let current: RawRow = {start: 0, end: 0, cells: [], width: 0};
  for (const cell of cells) {
    if (current.cells.length && current.width + cell.width > width) { rows.push(current); current = {start: cell.offset, end: cell.offset, cells: [], width: 0}; }
    current.cells.push(cell);
    current.width += cell.width;
  }
  rows.push(current);
  rows.forEach((row, index) => { row.end = index + 1 < rows.length ? rows[index + 1]!.start : line.length; });
  return rows;
}

const RESET = '\u001b[0m';
const REVERSE = '\u001b[7m';
const MARGIN = 4;
const CACHE_LIMIT = 600;

interface Layout {
  items: HybridItem[];
  active: (item: HybridItem) => boolean;
  width: number;
  rawRows: Map<number, Array<{line: number; row: RawRow}>>;
  look: ViewerLook;
}

function rawOf(editor: EditorState, layout: Layout, index: number): Array<{line: number; row: RawRow}> {
  let rows = layout.rawRows.get(index);
  if (!rows) {
    const item = layout.items[index]!;
    rows = [];
    for (let line = item.from; line < item.to; line += 1) {
      const wrapped = wrapRaw(editor.buffer.lines[line]!, layout.width);
      // The caret at the end of a full row needs a cell of its own.
      const last = wrapped.at(-1)!;
      if (editor.buffer.caret.line === line && editor.buffer.caret.column >= editor.buffer.lines[line]!.length && last.width >= layout.width) wrapped.push({start: editor.buffer.lines[line]!.length, end: editor.buffer.lines[line]!.length, cells: [], width: 0});
      for (const row of wrapped) rows.push({line, row});
    }
    layout.rawRows.set(index, rows);
  }
  return rows;
}

function renderedOf(editor: EditorState, hybrid: HybridState, layout: Layout, index: number): string[] | undefined {
  const item = layout.items[index]!;
  if (!item.block) return undefined;
  const text = editor.buffer.lines.slice(item.from, item.to).join('\n');
  // Colour depth and glyph set are part of the key: NO_COLOR and Safe Glyphs can change while the document is open.
  const key = `${layout.width}|${colorLevel()}|${getIconStyle()}|${layout.look.syntax ? 's' : ''}|${text}`;
  let rows = hybrid.cache.get(key);
  if (!rows) {
    hybrid.stats.renders += 1;
    const rendered = renderMarkdown(text, layout.width, {...(layout.look.syntax ? {syntax: layout.look.syntax} : {}), hyperlinks: Boolean(layout.look.hyperlinks), html: true});
    rows = rendered.map(row => row.ansi);
    if (hybrid.cache.size >= CACHE_LIMIT) hybrid.cache.delete(hybrid.cache.keys().next().value!);
    hybrid.cache.set(key, rows);
  }
  // A block that renders to nothing (a link reference definition) is shown as its source rather than disappearing.
  return rows.length ? rows : undefined;
}

function heightOf(editor: EditorState, hybrid: HybridState, layout: Layout, index: number): number {
  if (layout.active(layout.items[index]!)) return rawOf(editor, layout, index).length;
  return renderedOf(editor, hybrid, layout, index)?.length ?? rawOf(editor, layout, index).length;
}

function itemAt(items: readonly HybridItem[], line: number): number {
  let low = 0, high = items.length - 1;
  while (low < high) { const mid = (low + high + 1) >> 1; if (items[mid]!.from <= line) low = mid; else high = mid - 1; }
  return low;
}

/** Row of the caret inside its item (0-based), counting the wrapped rows of the lines above it in the item. */
function caretRowIn(editor: EditorState, layout: Layout, index: number): number {
  const caret = editor.buffer.caret;
  const rows = rawOf(editor, layout, index);
  let found = 0;
  rows.forEach((entry, at) => {
    if (entry.line !== caret.line) return;
    if (caret.column >= entry.row.start && (caret.column < entry.row.end || at + 1 >= rows.length || rows[at + 1]!.line !== caret.line || caret.column === entry.row.end && entry.row.end === entry.row.start)) found = at;
  });
  return found;
}

function revealCaret(editor: EditorState, hybrid: HybridState, layout: Layout, body: number): void {
  const items = layout.items;
  if (!items.length) return;
  let topIndex = itemAt(items, hybrid.top.line);
  let sub = Math.min(hybrid.top.sub, Math.max(0, heightOf(editor, hybrid, layout, topIndex) - 1));
  const caretItem = itemAt(items, editor.buffer.caret.line);
  const caretRow = caretRowIn(editor, layout, caretItem);
  if (caretItem < topIndex || (caretItem === topIndex && caretRow < sub)) { topIndex = caretItem; sub = Math.max(0, caretRow - 1); }
  else {
    let rows = -sub, far = false;
    for (let at = topIndex; at < caretItem; at += 1) { rows += heightOf(editor, hybrid, layout, at); if (rows > body * 4) { far = true; break; } }
    if (far) { topIndex = caretItem; sub = Math.max(0, caretRow - body + 2); }
    else {
      let delta = rows + caretRow - body + 1;
      while (delta > 0 && topIndex < caretItem + 0) {
        const remaining = heightOf(editor, hybrid, layout, topIndex) - sub;
        if (delta >= remaining) { delta -= remaining; topIndex += 1; sub = 0; } else { sub += delta; delta = 0; }
      }
      if (delta > 0) sub += delta;
    }
  }
  hybrid.top = {line: items[topIndex]!.from, sub};
}

/** Scroll the viewport by `rows` without moving the caret (the wheel). */
export function scrollHybrid(editor: EditorState, hybrid: HybridState, rows: number, columns: number, look: ViewerLook = {}): void {
  const layout = layoutOf(editor, hybrid, columns, look);
  let index = itemAt(layout.items, hybrid.top.line), sub = hybrid.top.sub + rows;
  while (sub < 0 && index > 0) { index -= 1; sub += heightOf(editor, hybrid, layout, index); }
  while (index < layout.items.length - 1 && sub >= heightOf(editor, hybrid, layout, index)) { sub -= heightOf(editor, hybrid, layout, index); index += 1; }
  hybrid.top = {line: layout.items[index]!.from, sub: Math.max(0, Math.min(sub, heightOf(editor, hybrid, layout, index) - 1))};
}

function layoutOf(editor: EditorState, hybrid: HybridState, columns: number, look: ViewerLook): Layout {
  const index = headingIndex(editor);
  const blocks = index.blocks();
  hybrid.stats.parses = index.parseCount;
  if (hybrid.items?.version !== index.version || hybrid.items.list.at(-1)?.to !== editor.buffer.lines.length) hybrid.items = {version: index.version, list: hybridItems(blocks, editor.buffer.lines.length)};
  const buffer = editor.buffer;
  const selection = buffer.selection;
  const first = Math.min(buffer.caret.line, selection?.start.line ?? buffer.caret.line);
  const last = Math.max(buffer.caret.line, selection?.end.line ?? buffer.caret.line);
  return {items: hybrid.items.list, active: item => item.to > first && item.from <= last, width: Math.max(8, columns - MARGIN), rawRows: new Map(), look};
}

function drawRaw(editor: EditorState, line: number, row: RawRow): string {
  const caret = editor.buffer.caret;
  const selection = editor.buffer.selection;
  let out = '';
  let caretDrawn = caret.line !== line || caret.column < row.start || caret.column > row.end;
  for (const cell of row.cells) {
    const atCaret = !caretDrawn && cell.offset === caret.column;
    const selected = selection && inside({line, column: cell.offset}, selection.start, selection.end);
    out += atCaret || selected ? `${REVERSE}${cell.text}${RESET}` : cell.text;
    if (atCaret) caretDrawn = true;
  }
  if (!caretDrawn) out += `${REVERSE} ${RESET}`;
  return out;
}

export function activeKind(editor: EditorState, hybrid: HybridState, columns: number, look: ViewerLook = {}): {kind: string; lines: number} {
  const layout = layoutOf(editor, hybrid, columns, look);
  const item = layout.items[itemAt(layout.items, editor.buffer.caret.line)];
  return item ? {kind: item.block?.kind ?? (editor.buffer.lines[item.from]!.trim() ? 'text' : 'blank line'), lines: item.to - item.from} : {kind: 'text', lines: 1};
}

export function renderHybrid(editor: EditorState, hybrid: HybridState, columns: number, height: number, look: ViewerLook = {}): string[] {
  const safe = getIconStyle() === 'safe';
  const accent = foreground(UI_COLORS.accent), subtle = foreground(UI_COLORS.subtle), primary = foreground(UI_COLORS.primary), warning = foreground(UI_COLORS.warning);
  const layout = layoutOf(editor, hybrid, columns, look);
  const caret = editor.buffer.caret;
  const kind = activeKind(editor, hybrid, columns, look);
  const status = `${subtle}Ln ${caret.line + 1}, Col ${caret.column + 1} · ${kind.kind}${kind.lines > 1 ? ` (${kind.lines} lines)` : ''} · Hybrid${RESET}${editor.note ? `  ${editor.note.tone === 'error' ? foreground(UI_COLORS.failure) : subtle}${truncateText(inert(editor.note.text), Math.max(1, columns - 40))}${RESET}` : ''}`;
  const footer = renderControlRows([['Ctrl+S', 'save'], ['Esc', 'source'], ['Ctrl+O', 'preview'], ['F3', 'source editor'], ['F2', 'split'], ['F1', 'Markdown']], Math.max(1, columns - 4));
  const body = Math.max(1, height - 2 - 1 - 1 - footer.length);
  revealCaret(editor, hybrid, layout, body);
  const title = truncateText(editor.file.title, Math.max(8, Math.floor((columns - 4) * 0.6)));
  const out = [`  ${primary}${title}${RESET}${editor.buffer.dirty ? `${warning} ● edited${RESET}` : ''}  ${subtle}hybrid · ${editor.buffer.lines.length.toLocaleString('en-US')} lines${RESET}`];
  const bar = `${accent}${safe ? '|' : '▎'}${RESET}`;
  let index = itemAt(layout.items, hybrid.top.line), sub = hybrid.top.sub;
  while (out.length - 1 < body && index < layout.items.length) {
    const item = layout.items[index]!;
    if (layout.active(item)) {
      for (const entry of rawOf(editor, layout, index).slice(sub)) { if (out.length - 1 >= body) break; out.push(`  ${bar} ${drawRaw(editor, entry.line, entry.row)}`); }
    } else {
      const rows = renderedOf(editor, hybrid, layout, index);
      if (rows) { for (const row of rows.slice(sub)) { if (out.length - 1 >= body) break; out.push(`    ${truncateAnsi(row, layout.width)}${RESET}`); } }
      else for (const entry of rawOf(editor, layout, index).slice(sub)) { if (out.length - 1 >= body) break; out.push(`    ${subtle}${drawRaw(editor, entry.line, entry.row)}${RESET}`); }
    }
    index += 1; sub = 0;
  }
  while (out.length - 1 < body) out.push('');
  out.push(`  ${status}`, ...footer.map(row => `  ${row}`));
  const rule = framePanel([], columns)[0]!;
  if (height <= 1) return [rule].slice(0, Math.max(0, height));
  return [...framePanel(out.slice(0, Math.max(0, height - 2)).map(row => truncateAnsi(row, columns)), columns), rule];
}
