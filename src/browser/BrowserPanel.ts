import type {Key} from '../terminal/keys.js';
import {renderControlRows} from '../ui/controls.js';
import {editText} from '../ui/formControls.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {framePanel, renderTabStrip, selectedRowBand, tabWindow} from '../ui/PanelShell.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';
import {addressKind, displayUrl, hasCredentials, normalizeAddress, plainText} from './address.js';
import {cellToViewport, insideArea, keyToInput, type MouseGeometry} from './keymap.js';
import type {BrowserSession, TabView} from './session.js';

/**
 * The /browser panel, in the viewer family: a tab strip, the address, the page, one status line and the controls.
 *
 * Focus decides who owns the keys, and there are exactly four owners:
 *   chrome   the browser's own commands. The default. No key here ever reaches the page.
 *   page     every key goes to the page, except Esc (back to chrome) and Ctrl+C (closes the browser).
 *   address  keys edit the address; Enter goes there, Esc cancels.
 *   find     keys edit the search text; Enter finds, Esc returns to chrome.
 * The address shown always comes from the tab's real URL, never from anything the page says. Ctrl+L cannot be offered: the key
 * decoder reports no Ctrl+L, so `o` (and a click on the address) open the address bar.
 */
export type BrowserFocus = 'chrome' | 'page' | 'address' | 'find';

export interface BrowserPanelState {
  readonly session: BrowserSession;
  focus: BrowserFocus;
  /** The address being typed. */
  draft: string;
  /** The search text being typed. */
  findDraft: string;
  cwd: string;
  home?: string;
  /** Where the last rendering put things, relative to the panel's first row, for mouse hits. */
  layout?: PanelLayout;
  /** A mouse button is down on the page: the release is forwarded wherever it happens. */
  pressed: boolean;
}

export interface PanelLayout {
  tabRow: number;
  addressRow: number;
  pageRow: number;
  pageRows: number;
  columns: number;
  /** Cell ranges of the visible tabs on the tab row (0-based, end exclusive). */
  tabHits: Array<{start: number; end: number; index: number}>;
}

export type BrowserPanelAction =
  | {kind: 'close'}
  | {kind: 'copy'; text: string; label: string}
  /** A Markdown file was typed in the address: the caller opens it in the document viewer. */
  | {kind: 'open-document'; path: string};

export interface PanelGeometry {
  /** The 1-based screen row and column of the panel's first row and column. */
  top: number;
  left?: number;
  cell: {width: number; height: number};
  scale: number;
}

type MouseKey = {kind: 'mouseClick' | 'mouseRelease' | 'mouseDrag' | 'mouseMove'; x?: number; y?: number};

export const MIN_COLUMNS = 32;
export const MIN_HEIGHT = 10;
const COMPACT_COLUMNS = 50;
const RESET = '\u001b[0m';
const REVERSE = '\u001b[7m';
const BOLD = '\u001b[1m';

export function createBrowserPanel(session: BrowserSession, options: {cwd: string; home?: string}): BrowserPanelState {
  return {session, focus: 'chrome', draft: '', findDraft: '', cwd: options.cwd, ...(options.home ? {home: options.home} : {}), pressed: false};
}

// ---- keys -----------------------------------------------------------------------------------------------------------

export function browserPanelKey(state: BrowserPanelState, key: Key, geometry: PanelGeometry): BrowserPanelAction | undefined {
  if (key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'mouseClick' || key.kind === 'mouseRelease' || key.kind === 'mouseDrag' || key.kind === 'mouseMove') return mouseKey(state, key as MouseKey, geometry);
  if (key.kind === 'wheelUp' || key.kind === 'wheelDown') { void state.session.scroll('line', key.kind === 'wheelUp' ? -1 : 1); return undefined; }
  if (key.kind === 'focusIn' || key.kind === 'focusOut') return undefined;
  switch (state.focus) {
    case 'page': return pageKey(state, key);
    case 'address': return addressKey(state, key);
    case 'find': return findKey(state, key);
    default: return chromeKey(state, key);
  }
}

function pageKey(state: BrowserPanelState, key: Key): BrowserPanelAction | undefined {
  if (key.kind === 'escape') { state.focus = 'chrome'; return undefined; }
  if (key.kind === 'paste') { if (key.value) void state.session.insertText(key.value); return undefined; }
  const input = keyToInput(key);
  if (input) void state.session.sendKey(input);
  return undefined;
}

function addressKey(state: BrowserPanelState, key: Key): BrowserPanelAction | undefined {
  if (key.kind === 'escape') { state.focus = 'chrome'; return undefined; }
  if (key.kind === 'enter') {
    const result = normalizeAddress(state.draft, {cwd: state.cwd, ...(state.home ? {home: state.home} : {})});
    if (!result.ok) { state.session.setNotice(result.reason); return undefined; }
    state.focus = 'chrome';
    if (result.local) return {kind: 'open-document', path: result.local};
    void state.session.navigate(result.url);
    return undefined;
  }
  const next = editText(state.draft, key);
  if (next !== undefined) state.draft = next.slice(0, 2048);
  return undefined;
}

function findKey(state: BrowserPanelState, key: Key): BrowserPanelAction | undefined {
  if (key.kind === 'escape') { state.focus = 'chrome'; return undefined; }
  if (key.kind === 'enter') {
    const current = state.session.activeView()?.find?.query;
    if (!state.findDraft) void state.session.clearFind();
    else if (current === state.findDraft) void state.session.findNext(false);
    else void state.session.find(state.findDraft);
    return undefined;
  }
  const next = editText(state.findDraft, key);
  if (next !== undefined) state.findDraft = next.slice(0, 200);
  return undefined;
}

function chromeKey(state: BrowserPanelState, key: Key): BrowserPanelAction | undefined {
  const session = state.session;
  switch (key.kind) {
    case 'escape': return {kind: 'close'};
    case 'down': void session.scroll('line', 1); return undefined;
    case 'up': void session.scroll('line', -1); return undefined;
    case 'left': void session.scroll('line', -1, true); return undefined;
    case 'right': void session.scroll('line', 1, true); return undefined;
    case 'pageDown': void session.scroll('page', 1); return undefined;
    case 'pageUp': void session.scroll('page', -1); return undefined;
    case 'lineHome': case 'bufferHome': void session.scroll('top', -1); return undefined;
    case 'lineEnd': case 'bufferEnd': void session.scroll('bottom', 1); return undefined;
    case 'complete': session.cycle(1); return undefined;
    case 'focusPrevious': session.cycle(-1); return undefined;
    case 'enter': state.focus = 'page'; return undefined;
    case 'text': return chromeText(state, key.value);
    default: return undefined;
  }
}

function chromeText(state: BrowserPanelState, text: string): BrowserPanelAction | undefined {
  const session = state.session;
  if (/^[1-9]$/u.test(text)) { session.activate(Number(text) - 1); return undefined; }
  switch (text) {
    case 'j': void session.scroll('line', 1); break;
    case 'k': void session.scroll('line', -1); break;
    case ' ': void session.scroll('page', 1); break;
    case 'b': void session.scroll('page', -1); break;
    case 'g': void session.scroll('top', -1); break;
    case 'G': void session.scroll('bottom', 1); break;
    case '+': case '=': void session.zoomBy(1); break;
    case '-': case '_': void session.zoomBy(-1); break;
    case '0': void session.setZoom(1); break;
    case '[': case 'H': void session.back(); break;
    case ']': case 'L': void session.forward(); break;
    case 'r': void session.reload(); break;
    case 'R': void session.hardReload(); break;
    case 's': void session.stop(); break;
    case 'o': { const url = session.activeView()?.url ?? ''; state.draft = url === 'about:blank' ? '' : url; state.focus = 'address'; break; }
    case 't': state.draft = ''; state.focus = 'address'; void session.newTab(); break;
    case 'x': if (session.count <= 1) return {kind: 'close'}; session.closeTab(); break;
    case '/': state.findDraft = session.activeView()?.find?.query ?? ''; state.focus = 'find'; break;
    case 'n': void session.findNext(false); break;
    case 'N': void session.findNext(true); break;
    case 'i': state.focus = 'page'; break;
    case 'c': { const view = session.activeView(); return view ? {kind: 'copy', text: view.url, label: 'Copied the page address'} : undefined; }
    default: break;
  }
  return undefined;
}

function mouseKey(state: BrowserPanelState, key: MouseKey, geometry: PanelGeometry): undefined {
  const layout = state.layout;
  if (!layout || key.x === undefined || key.y === undefined) return undefined;
  const left = geometry.left ?? 1;
  const mouse: MouseGeometry = {
    area: {row: geometry.top + layout.pageRow, column: left, columns: layout.columns, rows: layout.pageRows},
    cell: geometry.cell, scale: geometry.scale, ...(state.session.activeViewport() ? {viewport: state.session.activeViewport()!} : {}),
  };
  const cell = {x: key.x, y: key.y};
  const inside = insideArea(cell, mouse.area);
  if (key.kind === 'mouseClick') {
    if (inside) {
      const point = cellToViewport(cell, mouse);
      state.focus = 'page';
      state.pressed = true;
      if (point) void state.session.sendMouse({type: 'down', ...point, button: 'left', clickCount: 1});
      return undefined;
    }
    const row = key.y - geometry.top;
    if (row === layout.tabRow) {
      const column = key.x - left;
      const hit = layout.tabHits.find(range => column >= range.start && column < range.end);
      if (hit) state.session.activate(hit.index);
    } else if (row === layout.addressRow) {
      const url = state.session.activeView()?.url ?? '';
      state.draft = url === 'about:blank' ? '' : url;
      state.focus = 'address';
    }
    return undefined;
  }
  if (key.kind === 'mouseRelease') {
    if (!state.pressed) return undefined;
    state.pressed = false;
    const point = cellToViewport(cell, mouse, {clamp: true});
    if (point) void state.session.sendMouse({type: 'up', ...point, button: 'left', clickCount: 1});
    return undefined;
  }
  if (key.kind === 'mouseDrag' && state.pressed) {
    const point = cellToViewport(cell, mouse, {clamp: true});
    if (point) void state.session.sendMouse({type: 'move', ...point});
  } else if (key.kind === 'mouseMove' && state.focus === 'page' && inside) {
    const point = cellToViewport(cell, mouse);
    if (point) void state.session.sendMouse({type: 'move', ...point});
  }
  return undefined;
}

// ---- drawing --------------------------------------------------------------------------------------------------------

export interface BrowserRender {
  rows: string[];
  /** Where the page is drawn, relative to the first returned row (and column 0). `rows` is 0 when the panel is too small. */
  pageArea: {row: number; column: number; columns: number; rows: number};
}

export function renderBrowserPanel(state: BrowserPanelState, columns: number, height: number): BrowserRender {
  const subtle = foreground(UI_COLORS.subtle);
  if (columns < MIN_COLUMNS || height < MIN_HEIGHT) {
    const message = `Needs at least ${MIN_COLUMNS}x${MIN_HEIGHT}`;
    const rows = Array.from({length: Math.max(1, height)}, () => '');
    rows[Math.floor(rows.length / 2)] = `${subtle}${truncateText(message, Math.max(1, columns))}${RESET}`;
    delete state.layout;
    return {rows, pageArea: {row: 0, column: 0, columns: 0, rows: 0}};
  }
  const controls = renderControlRows(controlsFor(state), Math.max(1, columns - 4)).slice(0, height < 16 ? 1 : 2).map(row => `  ${row}`);
  const pageRows = Math.max(1, height - 5 - controls.length);
  state.session.resize({columns, rows: pageRows});
  const views = state.session.view();
  const active = state.session.activeIndex;
  const tab = views[active];

  const tabHits: PanelLayout['tabHits'] = [];
  const tabLine = tabRow(views, active, columns, state, tabHits);
  const body = [tabLine, addressRow(state, tab, columns), ...pageContent(state, tab, columns, pageRows), statusRow(state, tab, columns), ...controls];
  const rows = [...framePanel(body.map((row, index) => (index >= 2 && index < 2 + pageRows ? row : truncateAnsi(row, columns))), columns), framePanel([], columns)[0]!];
  state.layout = {tabRow: 1, addressRow: 2, pageRow: 3, pageRows, columns, tabHits};
  return {rows: rows.slice(0, height), pageArea: {row: 3, column: 0, columns, rows: pageRows}};
}

function tabTitle(view: TabView): string {
  let name = view.title;
  if (!name) { try { name = new URL(view.url).hostname; } catch { name = ''; } }
  if (!name) name = view.url === 'about:blank' || !view.url ? 'New tab' : plainText(displayUrl(view.url), 30);
  const marker = view.loading ? (getCurrentGlyphMode() === 'nerd' ? '…' : '*') : '';
  return `${marker}${truncateText(name, 18)}`;
}

function tabRow(views: TabView[], active: number, columns: number, state: BrowserPanelState, hits: PanelLayout['tabHits']): string {
  const subtle = foreground(UI_COLORS.subtle);
  if (!views.length) return `  ${subtle}No tabs${RESET}`;
  if (columns < COMPACT_COLUMNS) {
    const label = `tab ${active + 1} of ${views.length}`;
    hits.push({start: 0, end: columns, index: (active + 1) % views.length});
    return `  ${subtle}${truncateText(`${label} · ${tabTitle(views[active]!)}`, columns - 2)}${RESET}`;
  }
  const labels = views.map(tabTitle);
  const widths = labels.map(label => displayWidth(` ${label} `));
  const {start, end} = tabWindow(widths, active, columns);
  let at = start > 0 ? 2 : 2;
  for (let index = start; index <= end; index += 1) {
    hits.push({start: at, end: at + widths[index]!, index});
    at += widths[index]! + 1;
  }
  void state;
  return renderTabStrip(labels, active, columns, false);
}

function marker(kind: ReturnType<typeof addressKind>): string {
  switch (kind) {
    case 'https': return `${foreground(UI_COLORS.success)}${GLYPHS.saved}${RESET}`;
    case 'http': return `${foreground(UI_COLORS.warning)}!${RESET}`;
    case 'file': return `${foreground(UI_COLORS.subtle)}f${RESET}`;
    default: return `${foreground(UI_COLORS.subtle)}${GLYPHS.separator}${RESET}`;
  }
}

function addressRow(state: BrowserPanelState, tab: TabView | undefined, columns: number): string {
  const width = Math.max(4, columns - 6);
  if (state.focus === 'address') {
    const text = displayUrl(state.draft);
    const shown = [...text].length > width - 1 ? `…${[...text].slice(-(width - 2)).join('')}` : text;
    const row = `  ${foreground(UI_COLORS.accent)}>${RESET} ${foreground(UI_COLORS.primary)}${shown}${REVERSE} ${RESET}`;
    return selectedRowBand(row, columns);
  }
  const url = tab?.url ?? '';
  const kind = addressKind(url);
  const flag = hasCredentials(url) ? ` ${foreground(UI_COLORS.warning)}(has a user name)${RESET}` : '';
  const shown = url ? truncateText(displayUrl(url), Math.max(4, width - (flag ? 16 : 0))) : '';
  return `  ${marker(kind)} ${foreground(UI_COLORS.primary)}${shown}${RESET}${flag}`;
}

function pageContent(state: BrowserPanelState, tab: TabView | undefined, columns: number, rows: number): string[] {
  const session = state.session;
  if (tab && !tab.error && session.hasPicture()) return session.pageLines().slice(0, rows);
  const subtle = foreground(UI_COLORS.subtle);
  const failure = foreground(UI_COLORS.failure);
  let message = '';
  let color = subtle;
  if (!tab) message = 'No tab is open. Press t to open one.';
  else if (tab.error) { message = `${tab.error} Press r to reload.`; color = failure; }
  else if (tab.loading) message = 'Loading…';
  else if (tab.url === 'about:blank') message = 'A blank page. Press o to type an address.';
  else message = 'Waiting for the page…';
  const out = Array.from({length: rows}, () => ' '.repeat(columns));
  const at = Math.floor((rows - 1) / 2);
  const text = truncateText(message, Math.max(1, columns - 4));
  const pad = Math.max(0, Math.floor((columns - displayWidth(text)) / 2));
  out[at] = `${' '.repeat(pad)}${color}${text}${RESET}${' '.repeat(Math.max(0, columns - pad - displayWidth(text)))}`;
  return out;
}

function statusRow(state: BrowserPanelState, tab: TabView | undefined, columns: number): string {
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const width = Math.max(4, columns - 4);
  if (state.focus === 'find') {
    return `  ${accent}/${RESET} ${foreground(UI_COLORS.primary)}${truncateText(plainText(state.findDraft, 200), width - 4)}${REVERSE} ${RESET}`;
  }
  const chip = state.focus === 'page' ? `${BOLD}${accent}[page]${RESET} ` : state.focus === 'address' ? `${BOLD}${accent}[address]${RESET} ` : '';
  const parts: string[] = [];
  const notice = state.session.notice();
  if (notice) parts.push(notice);
  else if (state.focus === 'page' && tab?.editable) parts.push('typing in the page · Esc for browser commands');
  if (tab && !notice) {
    if (tab.title && !(state.focus === 'page' && tab.editable)) parts.push(tab.title);
    if (addressKind(tab.url) === 'http') parts.push('not secure');
  }
  if (tab && tab.zoom !== 1) parts.push(`${Math.round(tab.zoom * 100)}%`);
  if (tab?.find) parts.push(tab.find.matches ? `${tab.find.current} of ${tab.find.matches}` : 'no match');
  const chipWidth = displayWidth(chip);
  return `  ${chip}${subtle}${truncateText(parts.join(' · '), Math.max(1, width - chipWidth))}${RESET}`;
}

function controlsFor(state: BrowserPanelState): Array<readonly [string, string]> {
  switch (state.focus) {
    case 'page': return [['Esc', 'browser commands'], ['Ctrl+C', 'close browser']];
    case 'address': return [['Enter', 'go'], ['Esc', 'cancel']];
    case 'find': return [['Enter', 'find'], ['Esc', 'done']];
    default: return [['j/k', 'scroll'], ['Space', 'page'], ['o', 'address'], ['/', 'find'], ['[ ]', 'back/forward'], ['r', 'reload'], ['t', 'new tab'], ['x', 'close tab'], ['+/-', 'zoom'], ['Enter', 'type in page'], ['Esc', 'close']];
  }
}
