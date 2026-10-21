import type {Key} from '../terminal/keys.js';
import type {SyntaxSgr} from '../input/syntaxTheme.js';
import {graphemes} from '../input/inputLayout.js';
import {codeTokenStyle, renderHtml, renderMarkdown, type ImageProvider, type MarkdownRow, type RowBlock} from '../markdown/render.js';
import type {TextOverlay} from '../arcade/Canvas.js';
import {highlightCode, type CodeToken} from '../markdown/highlight.js';
import {colorLevel} from '../presentation/capabilities.js';
import {renderControlRows} from '../ui/controls.js';
import {editText} from '../ui/formControls.js';
import {framePanel} from '../ui/PanelShell.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';
import {headingsOf, rowForLine, type HeadingEntry} from '../markdown/sourceMap.js';
import {formatBytes, inert, type ViewDocument} from './document.js';

/**
 * The native read-only viewer (#397): one document in a full-height panel, never the transcript. Drawing is bounded
 * to what is visible: only the lines on screen are laid out, one wrapped line takes at most MAX_WRAP_ROWS rows, syntax
 * roles cover the first HIGHLIGHT_LINES lines and Markdown and HTML render up to RENDER_MARKDOWN_BYTES. Every character
 * is drawn inert: control and format characters (bidi overrides, zero-width marks) are shown as visible marks and tabs
 * as spaces, and links are links only for the renderer's allowed targets. HTML (a file, or inside Markdown) is
 * rendered natively from its supported subset: never run, styled by CSS or loaded (QA F01).
 */

const HIGHLIGHT_LINES = 20_000;
const RENDER_MARKDOWN_BYTES = 1024 * 1024;
const MAX_WRAP_ROWS = 200;
const TAB = 4;
const HORIZONTAL_STEP = 8;
const WHEEL_ROWS = 3;
const RESET = '\u001b[0m';
const REVERSE = '\u001b[7m';
const BOLD = '\u001b[1m';

interface Segment {text: string; style: string}
/** One logical line of what is shown: a source line (segments), or a rendered Markdown row (prestyled). */
interface Unit {text: string; segments?: Segment[]; prestyled?: string; number?: number; rest?: number; block?: RowBlock}

export interface ViewerState {
  document: ViewDocument;
  /** First visible unit, and the wrapped row inside it. */
  top: number;
  sub: number;
  /** Horizontal offset in cells while not wrapping. */
  left: number;
  wrap: boolean;
  numbers: boolean;
  /** Markdown drawn rendered (true) or as source. */
  rendered: boolean;
  input?: {kind: 'search' | 'goto' | 'heading'; value: string; focus?: number};
  /** Where each heading jump started (newest last), for Backspace (#462). */
  jumps?: Array<{top: number; sub: number}>;
  /** The person's choices for `<details>` (key → open); a block without one shows its own `open` state (#462). */
  disclosure?: Map<string, boolean>;
  query?: string;
  match?: {unit: number; start: number; length: number};
  matchCount?: number;
  /** One line of feedback (copy result, no match, wrapped search). */
  note?: string;
  /** Units the last drawing showed, for the position line. */
  shown?: {first: number; last: number};
  tokens?: CodeToken[][];
  markdown?: {width: number; version: string; rows: MarkdownRow[]};
  /** Sized-text blocks (headings) drawn over the rows by the last render, positioned in the returned panel rows. */
  overlays?: TextOverlay[];
}

export type ViewerAction = {kind: 'close'} | {kind: 'copy'; text: string; lines: number} | {kind: 'edit'; path: string}
  /** Open image `index` of this document in the image viewer. */
  | {kind: 'image'; index: number}
  /** The file shown, for the person's own editor (the /open bridge); line is the first line on screen, when it is one. */
  | {kind: 'open'; path: string; line?: number};

export interface ViewerLook {
  syntax?: SyntaxSgr;
  hyperlinks?: boolean;
  /** Real images in the document, and a version that changes whenever one finishes loading (rows are drawn again). */
  images?: ImageProvider & {count: number; version: number};
  /** Headings may be drawn as sized blocks (the app places them); the cache key includes this. */
  sized?: boolean;
  /** The viewer is the read-only side of a document workspace (Markdown/HTML): its controls name the workspace's keys. */
  workspace?: {mode: 'source' | 'preview'; dirty: boolean; browser: boolean; trusted: boolean};
  /** The viewer is the preview pane of the split view (#461): its controls name the split's keys. */
  split?: {linked: boolean; focused: boolean};
}

export function createViewer(document: ViewDocument): ViewerState {
  const renderable = renders(document);
  const markdown = renderable && Buffer.byteLength(document.text) <= RENDER_MARKDOWN_BYTES;
  const note = renderable && !markdown ? `Too large to render: showing the ${sourceName(document)} source.` : undefined;
  return {document, top: 0, sub: 0, left: 0, wrap: true, numbers: !markdown, rendered: markdown, ...(note ? {note} : {})};
}

/** Markdown and HTML have a rendered view beside their source. */
const renders = (document: ViewDocument) => document.format === 'markdown' || document.format === 'html';
const sourceName = (document: ViewDocument) => document.format === 'html' ? 'HTML' : 'Markdown';

// ---- Text ---------------------------------------------------------------------------------------------------------

/** Characters drawn as visible marks: controls (not tab) and invisible format, line and paragraph separators. */
const UNSAFE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu;
const PRINTABLE_ASCII = /^[\t\x20-\x7e]*$/u;
const markOf = (character: string) => character === '\u001b' ? '␛' : '·';
const cellWidth = (character: string) => character.length === 1 && character >= ' ' && character <= '~' ? 1 : displayWidth(character);

/**
 * A piece of a line as the viewer draws it, from `column`: tabs expanded to the next stop and every unsafe character
 * a visible mark. Printable ASCII takes a fast path; other text is measured by grapheme.
 */
function safePiece(text: string, column: number): {text: string; column: number} {
  if (PRINTABLE_ASCII.test(text)) {
    if (!text.includes('\t')) return {text, column: column + text.length};
    let out = '';
    for (const character of text) {
      if (character === '\t') { const spaces = TAB - (column % TAB); out += ' '.repeat(spaces); column += spaces; }
      else { out += character; column += 1; }
    }
    return {text: out, column};
  }
  const safe = text.replace(UNSAFE, markOf);
  if (!safe.includes('\t')) return {text: safe, column: column + displayWidth(safe)};
  let out = '';
  for (const character of graphemes(safe)) {
    if (character === '\t') { const spaces = TAB - (column % TAB); out += ' '.repeat(spaces); column += spaces; }
    else { out += character; column += cellWidth(character); }
  }
  return {text: out, column};
}

/** The whole line as drawn: what search matches against, so match offsets are drawing offsets. */
function safeLine(line: string): string {
  return safePiece(line, 0).text;
}

/**
 * Tokens → drawable segments, stopping once `budget` cells are produced: a line is never laid out further than it
 * can be shown. `rest` counts the source characters left undrawn.
 */
function safeSegments(tokens: readonly CodeToken[], styleOf: (token: CodeToken) => string, budget: number): {segments: Segment[]; rest: number} {
  const segments: Segment[] = [];
  let column = 0;
  let rest = 0;
  for (const token of tokens) {
    if (column >= budget) { rest += token.text.length; continue; }
    // Enough source for the remaining cells (a cell is at most a few code units; a longer cluster just shows less).
    const room = (budget - column) * 4 + 8;
    const source = token.text.length > room ? token.text.slice(0, room) : token.text;
    rest += token.text.length - source.length;
    const piece = safePiece(source, column);
    column = piece.column;
    if (piece.text) segments.push({text: piece.text, style: styleOf(token)});
  }
  return {segments, rest};
}

function smartMatch(text: string, query: string): (from: number) => number {
  const insensitive = query === query.toLowerCase();
  const haystack = insensitive ? text.toLowerCase() : text;
  return from => haystack.indexOf(query, from);
}

// ---- Units --------------------------------------------------------------------------------------------------------

function contentWidth(state: ViewerState, columns: number): number {
  return Math.max(4, columns - 4 - gutterWidth(state));
}

function gutterWidth(state: ViewerState): number {
  return state.numbers && !state.rendered ? Math.max(3, String(state.document.lines.length).length) + 1 : 0;
}

function markdownRows(state: ViewerState, width: number, look: ViewerLook): MarkdownRow[] {
  const version = `${look.images?.version ?? 0}|${look.sized ? 'sized' : 'plain'}|${[...(state.disclosure ?? [])].map(([key, open]) => `${key}=${open}`).join(',')}`;
  if (state.markdown?.width !== width || state.markdown.version !== version) {
    const options = {
      ...(look.syntax ? {syntax: look.syntax} : {}), hyperlinks: Boolean(look.hyperlinks),
      ...(look.images ? {images: look.images} : {}),
      ...(look.sized ? {sizedHeadings: {maxRows: 3}} : {}),
      ...(state.disclosure?.size ? {disclosure: {isOpen: (key: string, open: boolean) => state.disclosure!.get(key) ?? open}} : {}),
    };
    state.markdown = {width, version, rows: state.document.format === 'html' ? renderHtml(state.document.text, width, options) : renderMarkdown(state.document.text, width, {...options, html: true})};
  }
  return state.markdown.rows;
}

function unitCount(state: ViewerState, width: number, look: ViewerLook): number {
  return state.rendered ? markdownRows(state, width, look).length : state.document.lines.length;
}

function lineTokens(state: ViewerState, index: number): CodeToken[] {
  const line = state.document.lines[index] ?? '';
  if (!state.document.language) return [{text: line, kind: 'plain'}];
  state.tokens ??= highlightCode(state.document.lines.slice(0, HIGHLIGHT_LINES), state.document.language, HIGHLIGHT_LINES);
  return state.tokens[index] ?? [{text: line, kind: 'plain'}];
}

/** The cells a unit may need to draw: a bounded wrap, or the visible window when scrolled sideways. */
function cellBudget(state: ViewerState, width: number): number {
  return state.wrap ? MAX_WRAP_ROWS * width : state.left + width + 1;
}

function unitAt(state: ViewerState, index: number, width: number, look: ViewerLook): Unit {
  if (state.rendered) {
    const row = markdownRows(state, width, look)[index];
    return {text: row?.plain ?? '', prestyled: row?.ansi ?? '', ...(row?.block ? {block: row.block} : {})};
  }
  const level = colorLevel();
  const styleOf = (token: CodeToken) => level === 'none' ? '' : codeTokenStyle(token.kind, {...(look.syntax ? {syntax: look.syntax} : {}), level});
  const {segments, rest} = safeSegments(lineTokens(state, index), styleOf, cellBudget(state, width));
  return {text: segments.map(segment => segment.text).join(''), segments, number: index + 1, rest};
}

/** The searchable text of a unit (the same characters it is drawn with), without styling work. */
function unitText(state: ViewerState, index: number, width: number, look: ViewerLook): string {
  if (state.rendered) return markdownRows(state, width, look)[index]?.plain ?? '';
  return safeLine(state.document.lines[index] ?? '');
}

interface Cell {text: string; width: number; style: string}
type Highlight = {start: number; end: number; current: boolean};

function cellsOf(unit: Unit, highlights: readonly Highlight[]): Cell[] {
  const cells: Cell[] = [];
  let offset = 0;
  let range = 0;
  for (const segment of unit.segments ?? []) {
    for (const character of PRINTABLE_ASCII.test(segment.text) ? segment.text : graphemes(segment.text)) {
      while (range < highlights.length && highlights[range]!.end <= offset) range += 1;
      const mark = range < highlights.length && offset >= highlights[range]!.start ? highlights[range] : undefined;
      cells.push({text: character, width: cellWidth(character), style: mark ? `${segment.style}${REVERSE}${mark.current ? BOLD : ''}` : segment.style});
      offset += character.length;
    }
  }
  return cells;
}

function paint(cells: readonly Cell[]): string {
  let out = '';
  let style: string | undefined;
  for (const cell of cells) {
    if (cell.style !== style) { out += `${RESET}${cell.style}`; style = cell.style; }
    out += cell.text;
  }
  return `${out}${RESET}`;
}

/** The rows a unit takes: wrapped (bounded), or one row scrolled by `left`. */
function unitRows(state: ViewerState, unit: Unit, width: number, highlights: readonly Highlight[]): string[] {
  if (unit.prestyled !== undefined) {
    return [highlights.length ? `${REVERSE}${truncateAnsi(unit.text, width)}${RESET}` : unit.prestyled];
  }
  const cells = cellsOf(unit, highlights);
  const subtle = foreground(UI_COLORS.subtle);
  const more = Boolean(unit.rest);
  if (!state.wrap) {
    let skipped = 0;
    let index = 0;
    while (index < cells.length && skipped + cells[index]!.width <= state.left) { skipped += cells[index]!.width; index += 1; }
    const row: Cell[] = [];
    let used = 0;
    while (index < cells.length && used + cells[index]!.width <= width) { row.push(cells[index]!); used += cells[index]!.width; index += 1; }
    if ((index < cells.length || more) && row.length) row[row.length - 1] = {text: '›', width: 1, style: subtle};
    if (state.left > 0 && row.length) row[0] = {text: '‹', width: 1, style: subtle};
    return [paint(row)];
  }
  const rows: string[] = [];
  let row: Cell[] = [];
  let used = 0;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    if (used + cell.width > width && row.length) {
      rows.push(paint(row));
      row = [];
      used = 0;
      if (rows.length === MAX_WRAP_ROWS - 1) {
        const rest = cells.length - index + (unit.rest ?? 0);
        rows.push(`${subtle}${truncateText(`… ${rest.toLocaleString('en-US')} more characters on this line · w turns wrapping off`, width)}${RESET}`);
        return rows;
      }
    }
    row.push(cell);
    used += cell.width;
  }
  rows.push(paint(row));
  return rows;
}

function rowCount(state: ViewerState, index: number, width: number, look: ViewerLook): number {
  if (!state.wrap || state.rendered) return 1;
  const line = state.document.lines[index] ?? '';
  if (!line) return 1;
  // Printable ASCII wraps by simple division; anything else is laid out, bounded (wide characters move whole to the next row).
  if (PRINTABLE_ASCII.test(line)) return Math.min(MAX_WRAP_ROWS, Math.max(1, Math.ceil(safeLine(line).length / width)));
  return unitRows(state, unitAt(state, index, width, look), width, []).length;
}

// ---- Scrolling ----------------------------------------------------------------------------------------------------

/** The top position at which the last unit's last row is at the bottom: no scrolling past the end. */
function lastTop(state: ViewerState, width: number, height: number, look: ViewerLook): {top: number; sub: number} {
  let remaining = height;
  for (let index = unitCount(state, width, look) - 1; index >= 0; index -= 1) {
    const rows = rowCount(state, index, width, look);
    if (rows >= remaining) return {top: index, sub: rows - remaining};
    remaining -= rows;
  }
  return {top: 0, sub: 0};
}

function clampTop(state: ViewerState, width: number, height: number, look: ViewerLook): void {
  const last = lastTop(state, width, height, look);
  if (state.top > last.top || (state.top === last.top && state.sub > last.sub)) { state.top = last.top; state.sub = last.sub; }
  state.top = Math.max(0, state.top);
  state.sub = Math.max(0, Math.min(state.sub, rowCount(state, state.top, width, look) - 1));
}

function scroll(state: ViewerState, delta: number, width: number, height: number, look: ViewerLook): void {
  let remaining = delta;
  while (remaining > 0) {
    const rows = rowCount(state, state.top, width, look);
    if (state.sub + remaining < rows) { state.sub += remaining; break; }
    remaining -= rows - state.sub;
    if (state.top + 1 >= unitCount(state, width, look)) { state.sub = rows - 1; break; }
    state.top += 1;
    state.sub = 0;
  }
  while (remaining < 0) {
    if (state.sub + remaining >= 0) { state.sub += remaining; break; }
    remaining += state.sub + 1;
    if (state.top === 0) { state.sub = 0; break; }
    state.top -= 1;
    state.sub = rowCount(state, state.top, width, look) - 1;
  }
  clampTop(state, width, height, look);
}

function reveal(state: ViewerState, unit: number, width: number, height: number, look: ViewerLook): void {
  const visible = state.shown && unit >= state.shown.first && unit <= state.shown.last && unit !== state.shown.last;
  if (!visible) { state.top = Math.max(0, unit - Math.floor(height / 3)); state.sub = 0; }
  clampTop(state, width, height, look);
}

// ---- Search -------------------------------------------------------------------------------------------------------

function findFrom(state: ViewerState, unit: number, offset: number, direction: 1 | -1, width: number, look: ViewerLook): {unit: number; start: number; wrapped: boolean} | undefined {
  const query = state.query;
  if (!query) return undefined;
  const count = unitCount(state, width, look);
  for (let step = 0; step <= count; step += 1) {
    const raw = unit + direction * step;
    const index = ((raw % count) + count) % count;
    const text = unitText(state, index, width, look);
    const find = smartMatch(text, query);
    let found = -1;
    if (direction === 1) found = find(step === 0 ? offset : 0);
    else {
      const limit = step === 0 ? offset - 1 : text.length;
      for (let at = find(0); at >= 0 && at <= limit; at = find(at + 1)) found = at;
    }
    if (found >= 0) return {unit: index, start: found, wrapped: direction === 1 ? raw >= count : raw < 0};
  }
  return undefined;
}

function countMatches(state: ViewerState, width: number, look: ViewerLook): number {
  const query = state.query;
  if (!query) return 0;
  let total = 0;
  for (let index = 0; index < unitCount(state, width, look); index += 1) {
    const find = smartMatch(unitText(state, index, width, look), query);
    for (let at = find(0); at >= 0; at = find(at + query.length)) total += 1;
  }
  return total;
}

// ---- Disclosure -------------------------------------------------------------------------------------------------

/**
 * `z` opens or closes the `<details>` summary at or below the top of the screen (else the last one above it); `Z` all the
 * summaries now in the rendered rows. The choices live in the viewer, keyed by summary text, and never touch the source.
 */
function toggleDetails(state: ViewerState, every: boolean, width: number, body: number, look: ViewerLook): void {
  if (!state.rendered) { state.note = 'Details open and close in the rendered view (m).'; return; }
  const rows = markdownRows(state, width, look);
  const keys: Array<{key: string; at: number}> = [];
  rows.forEach((row, at) => { if (row.details) keys.push({key: row.details, at}); });
  if (!keys.length) { state.note = 'No details in this document.'; return; }
  const disclosure = state.disclosure ??= new Map();
  // Whether a summary is open is read from how its row was drawn (▾ or v), so a block's own `open` attribute is respected.
  const isOpen = (at: number) => /^(▾|v )/u.test(rows[at]!.plain);
  if (every) {
    const anyClosed = keys.some(({at}) => !isOpen(at));
    for (const {key} of keys) disclosure.set(key, anyClosed);
  } else {
    const target = keys.find(({at}) => at >= state.top) ?? keys.at(-1)!;
    disclosure.set(target.key, !isOpen(target.at));
  }
  delete state.markdown;
  state.sub = 0;
  clampTop(state, width, body, look);
}

// ---- Headings ---------------------------------------------------------------------------------------------------

const outlines = new WeakMap<ViewerState, {text: string; headings: HeadingEntry[]}>();

/** The document's headings (computed once per text) that contain every word typed. */
function headingMatches(state: ViewerState, query: string): HeadingEntry[] {
  let cached = outlines.get(state);
  if (cached?.text !== state.document.text) { cached = {text: state.document.text, headings: headingsOf(state.document.text, {html: true})}; outlines.set(state, cached); }
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  return cached.headings.filter(heading => words.every(word => heading.text.toLowerCase().includes(word)));
}

function jumpToHeading(state: ViewerState, line: number, width: number, body: number, look: ViewerLook): void {
  const jumps = state.jumps ??= [];
  jumps.push({top: state.top, sub: state.sub});
  if (jumps.length > 20) jumps.shift();
  state.top = state.rendered ? rowForLine(markdownRows(state, width, look), line) : Math.min(line, Math.max(0, state.document.lines.length - 1));
  state.sub = 0;
  clampTop(state, width, body, look);
}

function step(state: ViewerState, direction: 1 | -1, width: number, height: number, look: ViewerLook): void {
  const from = state.match ? {unit: state.match.unit, offset: state.match.start + (direction === 1 ? 1 : 0)} : {unit: state.top, offset: 0};
  const found = findFrom(state, from.unit, from.offset, direction, width, look);
  if (!found) { state.match = undefined; state.note = `No match for “${state.query}”.`; return; }
  state.match = {unit: found.unit, start: found.start, length: state.query!.length};
  state.note = found.wrapped ? (direction === 1 ? 'Search wrapped to the top.' : 'Search wrapped to the bottom.') : undefined;
  reveal(state, found.unit, width, height, look);
}

/** Scroll to the first row of the block holding source line `line` (the split view's linked scrolling). */
export function showSourceLine(state: ViewerState, line: number, columns: number, height: number, look: ViewerLook = {}): void {
  const width = contentWidth(state, columns);
  const body = bodyHeight(state, columns, height, look);
  state.top = state.rendered ? rowForLine(markdownRows(state, width, look), line) : Math.min(line, Math.max(0, state.document.lines.length - 1));
  state.sub = 0;
  clampTop(state, width, body, look);
}

// ---- Keys ---------------------------------------------------------------------------------------------------------

export function viewerKey(state: ViewerState, key: Key, columns: number, height: number, look: ViewerLook = {}): ViewerAction | undefined {
  const width = contentWidth(state, columns);
  const body = bodyHeight(state, columns, height, look);
  if (state.input) {
    const input = state.input;
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.input = undefined; return undefined; }
    if (input.kind === 'heading') {
      const matches = headingMatches(state, input.value);
      if (key.kind === 'up' || key.kind === 'focusPrevious') { input.focus = Math.max(0, (input.focus ?? 0) - 1); return undefined; }
      if (key.kind === 'down' || key.kind === 'complete') { input.focus = Math.min(Math.max(0, matches.length - 1), (input.focus ?? 0) + 1); return undefined; }
      if (key.kind === 'enter') {
        const heading = matches[input.focus ?? 0];
        state.input = undefined;
        // The prompt's own footer is gone: the page is measured without it, or the last rows would be cut off.
        if (heading) jumpToHeading(state, heading.line, width, bodyHeight(state, columns, height, look), look);
        return undefined;
      }
      const edited = editText(input.value, key);
      if (edited !== undefined) { input.value = edited.slice(0, 80); input.focus = 0; }
      return undefined;
    }
    if (key.kind === 'enter') {
      state.input = undefined;
      if (input.kind === 'goto') {
        const line = Number(input.value.trim());
        if (!Number.isInteger(line) || line < 1) { state.note = 'Type a line number.'; return undefined; }
        state.top = Math.min(line, unitCount(state, width, look)) - 1;
        state.sub = 0;
        clampTop(state, width, body, look);
        state.note = undefined;
        return undefined;
      }
      state.query = input.value;
      state.match = undefined;
      if (!state.query) { state.matchCount = undefined; return undefined; }
      state.matchCount = countMatches(state, width, look);
      step(state, 1, width, body, look);
      return undefined;
    }
    const next = editText(input.value, key);
    if (next !== undefined) input.value = next.slice(0, 200);
    return undefined;
  }
  state.note = undefined;
  const text = key.kind === 'text' ? key.value : undefined;
  if (key.kind === 'escape' && state.query) { state.query = undefined; state.match = undefined; state.matchCount = undefined; return undefined; }
  if (key.kind === 'escape' || key.kind === 'interrupt' || text === 'q') return {kind: 'close'};
  if (key.kind === 'up' || text === 'k') scroll(state, -1, width, body, look);
  else if (key.kind === 'down' || text === 'j') scroll(state, 1, width, body, look);
  else if (key.kind === 'wheelUp') scroll(state, -WHEEL_ROWS, width, body, look);
  else if (key.kind === 'wheelDown') scroll(state, WHEEL_ROWS, width, body, look);
  else if (key.kind === 'pageUp' || text === 'b') scroll(state, -Math.max(1, body - 1), width, body, look);
  else if (key.kind === 'pageDown' || text === ' ' || text === 'f') scroll(state, Math.max(1, body - 1), width, body, look);
  else if (key.kind === 'lineHome' || key.kind === 'bufferHome' || text === 'g') { state.top = 0; state.sub = 0; }
  else if (key.kind === 'lineEnd' || key.kind === 'bufferEnd' || key.kind === 'latest' || text === 'G') Object.assign(state, lastTop(state, width, body, look));
  else if ((key.kind === 'left' || key.kind === 'right') && !state.wrap && !state.rendered) state.left = Math.max(0, state.left + (key.kind === 'left' ? -HORIZONTAL_STEP : HORIZONTAL_STEP));
  else if (text === 'w' && !state.rendered) { state.wrap = !state.wrap; state.left = 0; state.sub = 0; clampTop(state, width, body, look); }
  else if (text === 'l' && !state.rendered) { state.numbers = !state.numbers; state.sub = 0; }
  else if (text === 'm' && renders(state.document)) {
    if (!state.rendered && Buffer.byteLength(state.document.text) > RENDER_MARKDOWN_BYTES) state.note = `Too large to render: showing the ${sourceName(state.document)} source.`;
    else { state.rendered = !state.rendered; state.numbers = !state.rendered; state.top = 0; state.sub = 0; state.match = undefined; state.matchCount = undefined; }
  }
  else if (text === '/' || key.kind === 'find') state.input = {kind: 'search', value: state.query ?? ''};
  else if (text === 'z' || text === 'Z') toggleDetails(state, text === 'Z', width, body, look);
  else if (text === ':') state.input = {kind: 'goto', value: ''};
  else if (text === '#' && renders(state.document)) state.input = {kind: 'heading', value: '', focus: 0};
  else if (key.kind === 'backspace' && state.jumps) {
    const back = state.jumps.pop();
    if (!back) { state.note = 'No earlier position to go back to.'; return undefined; }
    state.top = back.top; state.sub = back.sub;
    clampTop(state, width, body, look);
  }
  else if (key.kind === 'backspace' && renders(state.document)) state.note = 'No earlier position to go back to.';
  else if (text === 'n' && state.query) step(state, 1, width, body, look);
  else if (text === 'N' && state.query) step(state, -1, width, body, look);
  else if (text === 'i' && state.rendered && look.images) {
    if (!look.images.count) state.note = 'No images in this document.';
    else {
      const rows = markdownRows(state, width, look);
      const shown = rows.slice(state.top).find(row => row.image !== undefined) ?? rows.find(row => row.image !== undefined);
      return {kind: 'image', index: shown?.image ?? 0};
    }
  }
  else if (text === 'c') return {kind: 'copy', text: state.document.text, lines: state.document.lines.length};
  else if (text === 'e' && state.document.origin.kind === 'file') return {kind: 'edit', path: state.document.origin.path};
  // Rendered Markdown rows are not source lines: the file then opens at its start.
  else if (text === 'o' && state.document.origin.kind === 'file') return {kind: 'open', path: state.document.origin.path, ...(state.rendered ? {} : {line: state.top + 1})};
  return undefined;
}

// ---- Drawing ------------------------------------------------------------------------------------------------------

function detail(document: ViewDocument): string {
  const lines = `${document.lines.length.toLocaleString('en-US')} line${document.lines.length === 1 ? '' : 's'}`;
  if (document.origin.kind === 'output') {
    const status = document.origin.exitCode === undefined ? '' : ` · exit ${document.origin.exitCode}`;
    return `output ${document.origin.number}${status} · ${lines}${document.format === 'diff' ? ' · diff' : ''}`;
  }
  const kind = document.format === 'markdown' ? 'Markdown' : document.format === 'html' ? 'HTML' : document.format === 'diff' ? 'diff' : document.language ?? 'text';
  const ending = document.lineEnding === 'crlf' ? ' · CRLF' : document.lineEnding === 'mixed' ? ' · mixed line endings' : '';
  const link = document.origin.symlink ? ` · → ${inert(document.origin.realPath)}` : '';
  return `${kind} · ${lines} · ${formatBytes(document.origin.bytes)}${ending}${link}`;
}

function headerRows(state: ViewerState, columns: number, height: number, look: ViewerLook = {}): string[] {
  const width = Math.max(10, columns - 4);
  const primary = foreground(UI_COLORS.primary);
  const subtle = foreground(UI_COLORS.subtle);
  const warning = foreground(UI_COLORS.warning);
  const title = state.document.origin.kind === 'output' ? `$ ${state.document.title}` : state.document.title;
  const shownTitle = truncateText(title.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu, '·'), Math.max(8, Math.floor(width * 0.6)));
  const edited = look.workspace?.dirty ? ` ${warning}● edited${RESET}` : '';
  const rows = [`  ${primary}${shownTitle}${RESET}${edited}  ${subtle}${truncateText(detail(state.document), Math.max(1, width - displayWidth(shownTitle) - (edited ? 10 : 0) - 2))}${RESET}`];
  const notes = height >= 12 ? state.document.notes.slice(0, 2) : [];
  for (const note of notes) rows.push(`  ${warning}${truncateText(note, width)}${RESET}`);
  return rows;
}

function controls(state: ViewerState, columns: number, look: ViewerLook): string[] {
  const width = Math.max(1, columns - 4);
  if (state.input?.kind === 'heading') return renderControlRows([['↑↓', 'choose'], ['Enter', 'go'], ['Esc', 'cancel']], width);
  if (look.split && !state.input) return renderControlRows([['Ctrl+O', look.split.focused ? 'to the text' : 'here'], ['F2', 'close split'], ['↑↓', 'scroll'], ['/', 'find'], ['#', 'headings'], ['x', 'swap'], ['< >', 'width'], ['l', look.split.linked ? 'unlink' : 'link'], ['Esc', 'source']], width);
  if (state.input) return renderControlRows([['Enter', state.input.kind === 'search' ? 'find' : 'go'], ['Esc', 'cancel']], width);
  if (look.workspace) {
    const preview = look.workspace.mode === 'preview';
    return renderControlRows([
      ['↑↓', 'scroll'], ['/', 'find'], ['#', 'headings'], ...(state.rendered && state.markdown?.rows.some(row => row.details) ? [['z', 'details'] as const] : []), ...(preview ? [] : [[':', 'line'] as const]),
      ['h', preview ? 'source' : 'preview'], ['e', 'edit'], ...(preview ? [['r', 'refresh'] as const] : []),
      ...(preview && state.rendered && look.images?.count ? [['i', 'images'] as const] : []),
      ['Ctrl+S', 'save'], ['R', 'reload from disk'], ['Esc', preview ? 'source' : 'close'],
    ], width);
  }
  return renderControlRows([
    ['↑↓', 'scroll'], ['/', 'find'], ...(renders(state.document) ? [['#', 'headings'] as const] : []), ...(state.rendered && state.markdown?.rows.some(row => row.details) ? [['z', 'details'] as const] : []), ...(state.query ? [['n/N', 'next/previous'] as const] : []), [':', 'line'],
    ...(renders(state.document) ? [['m', state.rendered ? 'source' : 'rendered'] as const] : []),
    ...(!state.rendered ? [['w', state.wrap ? 'no wrap' : 'wrap'] as const, ['l', 'numbers'] as const] : []),
    ...(state.rendered && look.images?.count ? [['i', 'images'] as const] : []),
    ['c', 'copy all'], ...(state.document.origin.kind === 'file' ? [['e', 'edit'] as const, ['o', 'open in editor'] as const] : []), ['Esc', 'close'],
  ], width);
}

function bodyHeight(state: ViewerState, columns: number, height: number, look: ViewerLook): number {
  return Math.max(1, height - 2 - headerRows(state, columns, height, look).length - 1 - controls(state, columns, look).length);
}

function statusRow(state: ViewerState, width: number, total: number): string {
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  if (state.input?.kind === 'heading') {
    const matches = headingMatches(state, state.input.value);
    const chosen = matches[state.input.focus ?? 0];
    const label = 'Heading: ';
    const detail = chosen ? `  ▸ ${'#'.repeat(chosen.level)} ${chosen.text}  (${(state.input.focus ?? 0) + 1}/${matches.length})` : state.input.value ? '  no heading matches' : '  no headings in this document';
    const typed = truncateText(state.input.value.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu, '·'), Math.max(1, width - label.length - 1));
    return `  ${accent}${label}${RESET}${typed}${accent}▏${RESET}${subtle}${truncateText(inert(detail), Math.max(1, width - label.length - displayWidth(typed) - 2))}${RESET}`;
  }
  if (state.input) {
    const label = state.input.kind === 'search' ? 'Find: ' : 'Go to line: ';
    return `  ${accent}${label}${RESET}${truncateText(state.input.value.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu, '·'), Math.max(1, width - label.length - 1))}${accent}▏${RESET}`;
  }
  const unit = state.rendered ? 'Row' : 'Line';
  const first = state.shown ? state.shown.first + 1 : 0;
  const last = state.shown ? state.shown.last + 1 : 0;
  const position = total === 0 ? 'Empty' : `${unit}${last > first ? 's' : ''} ${first.toLocaleString('en-US')}${last > first ? `–${last.toLocaleString('en-US')}` : ''} of ${total.toLocaleString('en-US')}`;
  const search = state.query ? ` · ${state.matchCount === undefined ? '' : `${state.matchCount.toLocaleString('en-US')} match${state.matchCount === 1 ? '' : 'es'} for `}“${state.query}”` : '';
  const note = state.note ? ` · ${state.note}` : '';
  return `  ${subtle}${truncateText(`${position}${search}${note}`.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu, '·'), width)}${RESET}`;
}

export function renderViewer(state: ViewerState, columns: number, height: number, look: ViewerLook = {}): string[] {
  const width = contentWidth(state, columns);
  const gutter = gutterWidth(state);
  const body = bodyHeight(state, columns, height, look);
  clampTop(state, width, body, look);
  const out = headerRows(state, columns, height, look);
  const total = unitCount(state, width, look);
  const subtle = foreground(UI_COLORS.subtle);
  const rows: string[] = [];
  const meta: Array<{block?: RowBlock; highlighted: boolean}> = [];
  let first = -1;
  let last = -1;
  for (let index = state.top; index < total && rows.length < body; index += 1) {
    const unit = unitAt(state, index, width, look);
    const highlights = state.query ? matchRanges(unit.text, state.query, state.match?.unit === index ? state.match.start : -1) : [];
    let unitRowsList = unitRows(state, unit, width, highlights);
    if (index === state.top) unitRowsList = unitRowsList.slice(state.sub);
    unitRowsList.forEach((row, offset) => {
      if (rows.length >= body) return;
      const number = gutter ? `${subtle}${(offset === 0 && (index !== state.top || state.sub === 0) ? String(unit.number ?? '') : '').padStart(gutter - 1)}${RESET} ` : '';
      rows.push(`  ${number}${row}`);
      meta.push({...(unit.block ? {block: unit.block} : {}), highlighted: highlights.length > 0});
    });
    if (first < 0) first = index;
    last = index;
  }
  // Sized headings: drawn over their rows only when every row of the block is on screen and none holds a search match;
  // anywhere else the heading shows as its ordinary styled text on its first row.
  const overlays: TextOverlay[] = [];
  const visibleRows = Math.max(0, height - 2 - out.length);
  for (let at = 0; at < rows.length; at += 1) {
    const block = meta[at]?.block;
    if (!block?.sized || block.index !== 0 || meta[at]!.highlighted) continue;
    let whole = at + block.of <= rows.length && at + block.of <= visibleRows;
    for (let part = 0; whole && part < block.of; part += 1) {
      const row = meta[at + part];
      whole = row?.block?.id === block.id && row.block.index === part && !row.highlighted;
    }
    if (!whole) continue;
    overlays.push({x: 2 + gutter, y: 1 + out.length + at, columns: block.sized.columns, rows: block.sized.rows, sequence: block.sized.sequence});
    for (let part = 0; part < block.of; part += 1) rows[at + part] = '  ';
  }
  state.overlays = overlays;
  state.shown = first < 0 ? undefined : {first, last};
  if (!total) rows.push(`  ${subtle}${state.document.origin.kind === 'output' ? 'No output.' : 'Empty file.'}${RESET}`);
  while (rows.length < body) rows.push('');
  out.push(...rows, statusRow(state, Math.max(1, columns - 4), total), ...controls(state, columns, look).map(row => `  ${row}`));
  const rule = framePanel([], columns)[0]!;
  if (height <= 1) return [rule].slice(0, Math.max(0, height));
  return [...framePanel(out.slice(0, Math.max(0, height - 2)).map(row => truncateAnsi(row, columns)), columns), rule];
}

function matchRanges(text: string, query: string, current: number): Array<{start: number; end: number; current: boolean}> {
  const ranges: Array<{start: number; end: number; current: boolean}> = [];
  const find = smartMatch(text, query);
  for (let at = find(0); at >= 0 && ranges.length < 256; at = find(at + Math.max(1, query.length))) ranges.push({start: at, end: at + query.length, current: at === current});
  return ranges;
}
