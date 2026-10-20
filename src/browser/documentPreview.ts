import type {Key} from '../terminal/keys.js';
import type {TextOverlay} from '../arcade/Canvas.js';
import {renderControlRows} from '../ui/controls.js';
import {editText} from '../ui/formControls.js';
import {framePanel} from '../ui/PanelShell.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';
import type {PreviewView} from '../viewer/DocumentWorkspace.js';
import {cellToViewport} from './keymap.js';
import type {BrowserSession} from './session.js';
import type {PreviewHandle, PreviewServer} from './types.js';

/**
 * The document workspace's Chromium preview: the CURRENT buffer of a Markdown or HTML file, rendered by a real browser and shown
 * through the graphics service, with only what reading a document needs (scroll, zoom, find, refresh). It is a thin view over a
 * one-tab `BrowserSession` of kind `preview`:
 *
 *  - the page is served from memory on a loopback-only server (`PreviewServer`), so unsaved text previews without being saved and
 *    relative stylesheets, images and fonts resolve from the document's own folder under the server's restrictions;
 *  - scripts are off unless the person trusts the file; CSS animations and transitions run either way;
 *  - nothing leaves the preview origin: a clicked link is reported, never followed, and `o` offers to open it in `/browser`;
 *  - refresh swaps the served HTML and reloads the page (Chromium restores the scroll position of a reload); the editor's buffer
 *    and undo history are never touched.
 */
export interface PreviewDocument {
  name: string;
  /** The folder relative references resolve against. */
  root: string;
  text: string;
  trusted: boolean;
}

export interface DocumentPreviewDeps {
  session: BrowserSession;
  previews: PreviewServer;
  /** The complete HTML for the buffer's text (a Markdown file is converted, HTML is served as it is). */
  html(text: string): string;
  /** Where the panel sits on the screen, to map mouse clicks onto the page. */
  geometry(): {top: number; left: number; cell: {width: number; height: number}; scale: number};
  /** The person asked to open a refused link in the real browser. */
  openLink(url: string): void;
  /** The buffer has unsaved changes (for the header). */
  dirty(): boolean;
}

const RESET = '\u001b[0m';

export class BrowserPreviewView implements PreviewView {
  private handle: PreviewHandle | undefined;
  private area = {columns: 1, rows: 1, row: 0, column: 0};
  private finding: {value: string} | undefined;
  private disposed = false;
  private document: PreviewDocument;
  /** Refreshes and trust changes run one at a time, in the order they were asked for. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(private readonly deps: DocumentPreviewDeps, document: PreviewDocument) {
    this.document = document;
  }

  /** Serve the document and open its page; resolves with the view, or the reason a preview cannot be shown. */
  static async open(deps: DocumentPreviewDeps, document: PreviewDocument): Promise<BrowserPreviewView | {error: string}> {
    const view = new BrowserPreviewView(deps, document);
    try {
      view.handle = await deps.previews.serve({html: deps.html(document.text), root: document.root, trusted: document.trusted, name: document.name});
      const opened = await deps.session.open(view.handle.url, {kind: 'preview', scripts: document.trusted});
      if (!opened.ok) { view.dispose(); return {error: opened.reason}; }
    } catch (error) {
      view.dispose();
      return {error: error instanceof Error ? error.message : 'The preview could not start.'};
    }
    return view;
  }

  /** Whether scripts are on for the page being shown (what the page is actually served and run with). */
  get trusted(): boolean { return this.document.trusted; }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Replace the served page with the buffer's text now and reload it. Never reads or writes the file. */
  refresh(text: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed || !this.handle) return;
      this.document = {...this.document, text};
      this.handle.update(this.deps.html(text));
      await this.deps.session.reload();
    });
  }

  /** Turn scripts on or off for this file: the page is served and loaded again under the new rules. */
  setTrusted(trusted: boolean, text: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed) return;
      // Scripts go off before anything else changes, so a failure part-way never leaves them on.
      if (!trusted) await this.deps.session.setScripts(false);
      this.document = {...this.document, trusted, text};
      this.handle?.dispose();
      this.handle = await this.deps.previews.serve({html: this.deps.html(text), root: this.document.root, trusted, name: this.document.name});
      if (trusted) await this.deps.session.setScripts(true);
      await this.deps.session.navigate(this.handle.url);
    });
  }

  problems(): ReadonlyArray<{path: string; reason: string}> { return this.handle?.problems() ?? []; }
  capturing(): boolean { return Boolean(this.finding); }

  status(): string | undefined {
    const view = this.deps.session.activeView();
    const parts: string[] = [];
    if (view?.error) parts.push(view.error);
    if (view && view.zoom !== 1) parts.push(`${Math.round(view.zoom * 100)}%`);
    if (view?.find) parts.push(view.find.matches ? `${view.find.current}/${view.find.matches} for “${view.find.query}”` : `no match for “${view.find.query}”`);
    const notice = this.deps.session.notice();
    if (notice) parts.push(notice);
    const missing = this.problems();
    if (missing.length) parts.push(`${missing.length} resource${missing.length === 1 ? '' : 's'} missing or refused (${missing.at(-1)!.path})`);
    return parts.join(' · ') || undefined;
  }

  render(columns: number, height: number): {rows: string[]; overlays?: TextOverlay[]} {
    const subtle = foreground(UI_COLORS.subtle);
    const primary = foreground(UI_COLORS.primary);
    const warning = foreground(UI_COLORS.warning);
    const width = Math.max(10, columns - 4);
    const controls = renderControlRows(this.finding
      ? [['Enter', 'find'], ['Esc', 'cancel']]
      : [['↑↓', 'scroll'], ['/', 'find'], ['+/-', 'zoom'], ['h', 'source'], ['e', 'edit'], ['r', 'refresh'], ['T', this.document.trusted ? 'scripts off' : 'scripts on'], ...(this.deps.session.lastBlocked ? [['o', 'open link'] as const] : []), ['Esc', 'source']], width);
    const title = truncateText(this.document.name, Math.max(8, Math.floor(width * 0.5)));
    const detail = `rendered by Chromium${this.document.trusted ? ' · scripts on' : ''}`;
    const header = `  ${primary}${title}${RESET}${this.deps.dirty() ? `${warning} ● edited${RESET}` : ''}  ${subtle}${truncateText(detail, Math.max(1, width - displayWidth(title) - (this.deps.dirty() ? 10 : 0) - 2))}${RESET}`;
    const pageRows = Math.max(1, height - 2 - 1 - 1 - controls.length);
    // The page fills the panel inside its margins; the session debounces the viewport change and renders the new size.
    this.area = {columns: width, rows: pageRows, row: 0, column: 0};
    this.deps.session.resize({columns: width, rows: pageRows});
    const lines = this.deps.session.pageLines();
    const body = Array.from({length: pageRows}, (_, index) => `  ${lines[index] ?? ''}`);
    const status = this.finding
      ? `${foreground(UI_COLORS.accent)}Find: ${RESET}${truncateText(this.finding.value, Math.max(1, width - 8))}${foreground(UI_COLORS.accent)}▏${RESET}`
      : `${subtle}${truncateText(this.status() ?? '', width)}${RESET}`;
    const out = [header, ...body, `  ${status}`, ...controls.map(row => `  ${row}`)].slice(0, Math.max(0, height - 2)).map(row => truncateAnsi(row, columns));
    const rule = framePanel([], columns)[0]!;
    this.deps.session.settle();
    return {rows: [...framePanel(out, columns), rule]};
  }

  key(key: Key): void {
    const session = this.deps.session;
    if (this.finding) {
      if (key.kind === 'escape' || key.kind === 'interrupt') { this.finding = undefined; return; }
      if (key.kind === 'enter') { const query = this.finding.value; this.finding = undefined; void session.find(query); return; }
      const next = editText(this.finding.value, key);
      if (next !== undefined) this.finding.value = next.slice(0, 200);
      return;
    }
    const text = key.kind === 'text' ? key.value : undefined;
    if (key.kind === 'mouseClick' || key.kind === 'mouseRelease' || key.kind === 'mouseDrag' || key.kind === 'mouseMove') { this.mouse(key); return; }
    if (key.kind === 'wheelUp') void session.scroll('line', -1);
    else if (key.kind === 'wheelDown') void session.scroll('line', 1);
    else if (key.kind === 'up' || text === 'k') void session.scroll('line', -1);
    else if (key.kind === 'down' || text === 'j') void session.scroll('line', 1);
    else if (key.kind === 'pageUp' || text === 'b') void session.scroll('page', -1);
    else if (key.kind === 'pageDown' || text === ' ' || text === 'f') void session.scroll('page', 1);
    else if (key.kind === 'bufferHome' || key.kind === 'lineHome' || text === 'g') void session.scroll('top', -1);
    else if (key.kind === 'bufferEnd' || key.kind === 'lineEnd' || text === 'G') void session.scroll('bottom', 1);
    else if (text === '+' || text === '=') void session.zoomBy(1);
    else if (text === '-' || text === '_') void session.zoomBy(-1);
    else if (text === '0') void session.setZoom(1);
    else if (text === '/' || key.kind === 'find') this.finding = {value: session.activeView()?.find?.query ?? ''};
    else if (text === 'n') void session.findNext(false);
    else if (text === 'N') void session.findNext(true);
    else if (text === 'o') { const link = session.lastBlocked; if (link) this.deps.openLink(link.url); }
  }

  private mouse(key: Key & {x?: number; y?: number}): void {
    if (key.kind !== 'mouseClick' && key.kind !== 'mouseRelease' && key.kind !== 'mouseDrag' && key.kind !== 'mouseMove') return;
    if (key.x === undefined || key.y === undefined) return;
    const geometry = this.deps.geometry();
    // The page starts one row below the panel's header row and two columns in (the margins of render()).
    const area = {row: geometry.top + 1, column: geometry.left + 2, columns: this.area.columns, rows: this.area.rows};
    const point = cellToViewport({x: key.x, y: key.y}, {area, cell: geometry.cell, scale: geometry.scale}, {clamp: key.kind === 'mouseRelease'});
    if (!point) return;
    const session = this.deps.session;
    if (key.kind === 'mouseClick') void session.sendMouse({type: 'down', ...point, button: 'left', clickCount: 1});
    else if (key.kind === 'mouseRelease') void session.sendMouse({type: 'up', ...point, button: 'left', clickCount: 1});
    else void session.sendMouse({type: 'move', ...point});
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.handle?.dispose();
    this.handle = undefined;
    this.deps.session.dispose();
  }
}
