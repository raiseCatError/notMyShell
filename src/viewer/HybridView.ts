import type {Block} from '../markdown/blocks.js';
import {renderMarkdown} from '../markdown/render.js';
import {mermaidSources} from '../diagrams/mermaid.js';
import {renderControlRows} from '../ui/controls.js';
import {framePanel} from '../ui/PanelShell.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {getIconStyle} from '../ui/glyphs.js';
import {colorLevel} from '../presentation/capabilities.js';
import {truncateAnsi, truncateText} from '../util/text.js';
import {displayColumn} from './textBuffer.js';
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
  stats: {parses: number; renders: number; wraps: number};
  /** Rendered inactive items, for the current width only and at most CACHE_BYTES of rows. */
  cache: Map<string, string[]>;
  cacheBytes: number;
  cacheWidth: number;
  /** Source lines wrapped to a width, so a caret move or a keystroke wraps only what changed. */
  wraps: Map<string, RawRow[]>;
  /** The wheel scrolled the view on purpose: the caret is not pulled back until a key moves or edits. */
  free: boolean;
  items?: {version: number; list: HybridItem[]};
  /** The document version and diagram state the provider was last told about (which diagrams the document shows). */
  diagramsSeen?: string;
}

export function createHybrid(): HybridState {
  return {top: {line: 0, sub: 0}, stats: {parses: 0, renders: 0, wraps: 0}, cache: new Map(), cacheBytes: 0, cacheWidth: 0, wraps: new Map(), free: false};
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
const CACHE_BYTES = 2_000_000;
const WRAP_ENTRIES = 20_000;
const MAX_CACHED_TEXT = 65_536;
/** A block longer than this is not rendered whole to show a screenful of it: it stays source. */
const MAX_RENDER_LINES = 2000;

interface Layout {
  hybrid: HybridState;
  margin: number;
  items: HybridItem[];
  active: (item: HybridItem) => boolean;
  width: number;
  rawRows: Map<number, Array<{line: number; row: RawRow}>>;
  look: ViewerLook;
}

function wrappedLine(hybrid: HybridState, text: string, width: number): RawRow[] {
  const key = `${width}|${text}`;
  const cached = text.length <= 4096 ? hybrid.wraps.get(key) : undefined;
  if (cached) return cached;
  hybrid.stats.wraps += 1;
  const rows = wrapRaw(text, width);
  if (text.length <= 4096) {
    if (hybrid.wraps.size >= WRAP_ENTRIES) hybrid.wraps.clear();
    hybrid.wraps.set(key, rows);
  }
  return rows;
}

function rawOf(editor: EditorState, layout: Layout, index: number): Array<{line: number; row: RawRow}> {
  let rows = layout.rawRows.get(index);
  if (!rows) {
    const item = layout.items[index]!;
    rows = [];
    for (let line = item.from; line < item.to; line += 1) {
      const text = editor.buffer.lines[line]!;
      const wrapped = [...wrappedLine(layout.hybrid, text, layout.width)];
      // The caret at the end of a full row needs a cell of its own.
      const last = wrapped.at(-1)!;
      if (editor.buffer.caret.line === line && editor.buffer.caret.column >= text.length && last.width >= layout.width) wrapped.push({start: text.length, end: text.length, cells: [], width: 0});
      for (const row of wrapped) rows.push({line, row});
    }
    layout.rawRows.set(index, rows);
  }
  return rows;
}

function renderedOf(editor: EditorState, hybrid: HybridState, layout: Layout, index: number): string[] | undefined {
  const item = layout.items[index]!;
  if (!item.block || item.to - item.from > MAX_RENDER_LINES) return undefined;
  const text = editor.buffer.lines.slice(item.from, item.to).join('\n');
  // A block with a diagram is drawn fresh each time (its picture can arrive or change at any moment); never cached.
  const diagrams = layout.look.diagrams;
  if (diagrams && mermaidSources([item.block]).length) {
    hybrid.stats.renders += 1;
    const rows = renderMarkdown(text, layout.width, {...(layout.look.syntax ? {syntax: layout.look.syntax} : {}), hyperlinks: Boolean(layout.look.hyperlinks), html: true, math: true, diagrams}).map(row => row.ansi);
    return rows.length ? rows : undefined;
  }
  // Everything the rendered rows depend on is in the key: colour depth, glyph set, links, syntax roles and the theme's colours can all
  // change while the document is open. Only the current width is kept.
  const theme = `${foreground(UI_COLORS.primary)}${foreground(UI_COLORS.accent)}${foreground(UI_COLORS.secondary)}`;
  const key = `${colorLevel()}|${getIconStyle()}|${layout.look.hyperlinks ? 'h' : ''}|${JSON.stringify(layout.look.syntax ?? 0)}|${theme}|${text}`;
  if (hybrid.cacheWidth !== layout.width) { hybrid.cache.clear(); hybrid.cacheBytes = 0; hybrid.cacheWidth = layout.width; }
  let rows = hybrid.cache.get(key);
  if (!rows) {
    hybrid.stats.renders += 1;
    const rendered = renderMarkdown(text, layout.width, {...(layout.look.syntax ? {syntax: layout.look.syntax} : {}), hyperlinks: Boolean(layout.look.hyperlinks), html: true, math: true});
    rows = rendered.map(row => row.ansi);
    if (text.length <= MAX_CACHED_TEXT) {
      hybrid.cache.set(key, rows);
      hybrid.cacheBytes += key.length + rows.reduce((sum, row) => sum + row.length, 0);
      while (hybrid.cacheBytes > CACHE_BYTES && hybrid.cache.size > 1) {
        const oldest = hybrid.cache.keys().next().value!;
        hybrid.cacheBytes -= oldest.length + hybrid.cache.get(oldest)!.reduce((sum, row) => sum + row.length, 0);
        hybrid.cache.delete(oldest);
      }
    }
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
  return caretEntry(rawOf(editor, layout, index), editor.buffer.caret);
}

/** The row that holds the caret: the last row of its line that starts at or before its column (so one row, always). */
function caretEntry(rows: ReadonlyArray<{line: number; row: RawRow}>, caret: {line: number; column: number}): number {
  let found = 0;
  rows.forEach((entry, at) => { if (entry.line === caret.line && entry.row.start <= caret.column) found = at; });
  return found;
}

function revealCaret(editor: EditorState, hybrid: HybridState, layout: Layout, body: number): void {
  const items = layout.items;
  if (!items.length) return;
  let topIndex = itemAt(items, hybrid.top.line);
  let sub = Math.min(hybrid.top.sub, Math.max(0, heightOf(editor, hybrid, layout, topIndex) - 1));
  const caretItem = itemAt(items, editor.buffer.caret.line);
  const caretRow = caretRowIn(editor, layout, caretItem);
  // One row of context above the caret when the body has room for it; a one-row body shows the caret's row and nothing else.
  const context = Math.min(1, body - 1);
  if (caretItem < topIndex || (caretItem === topIndex && caretRow < sub)) { topIndex = caretItem; sub = Math.max(0, caretRow - context); }
  else {
    let rows = -sub, far = false;
    for (let at = topIndex; at < caretItem; at += 1) { rows += heightOf(editor, hybrid, layout, at); if (rows > body * 4) { far = true; break; } }
    if (far) { topIndex = caretItem; sub = Math.max(0, caretRow - body + 1 + context); }
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
  hybrid.free = true;
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
  // The diagrams the document shows now, so the provider draws those and drops drafts typed past.
  const seen = look.diagrams ? `${index.version}|${look.diagrams.version}` : undefined;
  if (look.diagrams && hybrid.diagramsSeen !== seen) { hybrid.diagramsSeen = seen; look.diagrams.want(mermaidSources(blocks)); }
  const buffer = editor.buffer;
  const selection = buffer.selection;
  const first = Math.min(buffer.caret.line, selection?.start.line ?? buffer.caret.line);
  const last = Math.max(buffer.caret.line, selection?.end.line ?? buffer.caret.line);
  const margin = columns >= 16 ? 4 : 2;
  return {hybrid, margin, items: hybrid.items.list, active: item => item.to > first && item.from <= last, width: Math.max(2, columns - margin), rawRows: new Map(), look};
}

function drawRaw(editor: EditorState, line: number, row: RawRow, caretHere: boolean): string {
  const caret = editor.buffer.caret;
  const selection = editor.buffer.selection;
  let out = '';
  let caretDrawn = !caretHere;
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
  const status = `${subtle}Ln ${caret.line + 1}, Col ${displayColumn(editor.buffer.lines[caret.line]!, caret.column) + 1} · ${kind.kind}${kind.lines > 1 ? ` (${kind.lines} lines)` : ''} · Hybrid${RESET}${editor.note ? `  ${editor.note.tone === 'error' ? foreground(UI_COLORS.failure) : subtle}${truncateText(inert(editor.note.text), Math.max(1, columns - 40))}${RESET}` : ''}`;
  const footer = renderControlRows([['Ctrl+S', 'save'], ['Esc', 'source'], ['Ctrl+O', 'preview'], ['F3', 'source editor'], ['F2', 'split'], ['F1', 'Markdown']], Math.max(1, columns - 4));
  const body = Math.max(1, height - 2 - 1 - 1 - footer.length);
  if (!hybrid.free) revealCaret(editor, hybrid, layout, body);
  const title = truncateText(editor.file.title, Math.max(8, Math.floor((columns - 4) * 0.6)));
  const out = [`  ${primary}${title}${RESET}${editor.buffer.dirty ? `${warning} ● edited${RESET}` : ''}  ${subtle}hybrid · ${editor.buffer.lines.length.toLocaleString('en-US')} lines${RESET}`];
  const bar = `${accent}${safe ? '|' : '▎'}${RESET}`;
  const lead = layout.margin === 4 ? '  ' : '';
  const plain = ' '.repeat(layout.margin);
  let index = itemAt(layout.items, hybrid.top.line), sub = hybrid.top.sub;
  while (out.length - 1 < body && index < layout.items.length) {
    const item = layout.items[index]!;
    const holdsCaret = item.from <= caret.line && caret.line < item.to;
    if (layout.active(item)) {
      const entries = rawOf(editor, layout, index);
      const caretAt = holdsCaret ? caretEntry(entries, caret) : -1;
      for (let at = sub; at < entries.length; at += 1) { if (out.length - 1 >= body) break; out.push(`${lead}${bar} ${drawRaw(editor, entries[at]!.line, entries[at]!.row, at === caretAt)}`); }
    } else {
      const rows = renderedOf(editor, hybrid, layout, index);
      if (rows) { for (const row of rows.slice(sub)) { if (out.length - 1 >= body) break; out.push(`${plain}${truncateAnsi(row, layout.width)}${RESET}`); } }
      else {
        const entries = rawOf(editor, layout, index);
        for (let at = sub; at < entries.length; at += 1) { if (out.length - 1 >= body) break; out.push(`${plain}${subtle}${drawRaw(editor, entries[at]!.line, entries[at]!.row, false)}${RESET}`); }
      }
    }
    index += 1; sub = 0;
  }
  while (out.length - 1 < body) out.push('');
  out.push(`  ${status}`, ...footer.map(row => `  ${row}`));
  const rule = framePanel([], columns)[0]!;
  if (height <= 1) return [rule].slice(0, Math.max(0, height));
  return [...framePanel(out.slice(0, Math.max(0, height - 2)).map(row => truncateAnsi(row, columns)), columns), rule];
}
