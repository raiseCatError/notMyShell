import type {FrameStream} from '../graphics/stream.js';
import {plainText, popupAddress} from './address.js';
import type {BrowserEngine, BrowserPage, Frame, KeyEventInput, MouseEventInput, PageEvent, Viewport} from './types.js';

/**
 * The tabs of one /browser panel, without any drawing. It owns the pages the engine opened, one `FrameStream` per tab, the
 * latest frame of each, and everything the page tells us (title, address, loading, notices). The panel only reads `view()` and
 * calls the methods here; tests drive it with a fake engine.
 *
 * Bounded by construction: at most MAX_TABS tabs, one notice, one pending frame per tab, one change notification per 33 ms
 * however many frames arrive, and a listener that cannot keep up simply sees frames skipped (the engine's rule).
 */
export const MAX_TABS = 12;
export const ZOOM_STEPS: readonly number[] = [0.25, 0.33, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
export const CHANGE_INTERVAL_MS = 33;
const RESIZE_DEBOUNCE_MS = 150;
const NOTICE_MS = 5000;
const BACKGROUND_FRAME_MS = 500;

export interface SessionClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_CLOCK: SessionClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => { const handle = setTimeout(callback, ms); handle.unref?.(); return handle; },
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
};

export interface SessionOptions {
  engine: BrowserEngine;
  /** One stream per tab (`GraphicsService.openStream`). */
  openStream(owner: unknown): FrameStream;
  /** Terminal pixels per cell, from the graphics decision. */
  cell(): {width: number; height: number};
  /** Device pixel ratio of the page frames; `auto` follows the cell height (a Retina cell of 32 px gives 2). */
  scale?: number | 'auto';
  colorScheme?: 'light' | 'dark';
  reducedMotion?: boolean;
  clock?: SessionClock;
}

export interface FindState {
  query: string;
  matches: number;
  current: number;
}

export interface TabView {
  id: number;
  title: string;
  url: string;
  loading: boolean;
  /** The tab cannot show a page: it crashed, closed or never opened. */
  error?: string;
  editable: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoom: number;
  find?: FindState;
}

export type OpenResult = {ok: true} | {ok: false; reason: string};

interface Tab {
  id: number;
  page?: BrowserPage;
  stream: FrameStream;
  lines: string[];
  linesBox?: {columns: number; rows: number};
  frame?: Frame;
  title: string;
  url: string;
  loading: boolean;
  editable: boolean;
  error?: string;
  zoom: number;
  find?: FindState;
  unsubscribe: Array<() => void>;
  retry?: unknown;
  closed: boolean;
}

export class BrowserSession {
  private tabs_: Tab[] = [];
  private active_ = 0;
  private nextId = 1;
  private area = {columns: 80, rows: 24};
  private cellSize: {width: number; height: number};
  private resizeTimer: unknown;
  private changeTimer: unknown;
  private lastChange = -Infinity;
  private listeners = new Set<() => void>();
  private noticeText: {text: string; at: number} | undefined;
  private disposed = false;
  private readonly clock: SessionClock;

  constructor(private readonly options: SessionOptions) {
    this.clock = options.clock ?? REAL_CLOCK;
    this.cellSize = options.cell();
  }

  // ---- reading ---------------------------------------------------------------------------------------------------

  get count(): number { return this.tabs_.length; }
  get activeIndex(): number { return this.active_; }

  view(): TabView[] { return this.tabs_.map(viewOf); }

  activeView(): TabView | undefined {
    const tab = this.tabs_[this.active_];
    return tab ? viewOf(tab) : undefined;
  }

  /** The page-area rows of the active tab, exactly as many as the last `resize` asked for. */
  pageLines(): string[] {
    const tab = this.tabs_[this.active_];
    const {columns, rows} = this.area;
    if (tab && tab.lines.length === rows && tab.linesBox?.columns === columns) return tab.lines;
    return Array.from({length: rows}, () => ' '.repeat(columns));
  }

  /** The active page's viewport in CSS pixels, for keeping a mouse point inside it. */
  activeViewport(): {width: number; height: number} | undefined {
    const viewport = this.tabs_[this.active_]?.page?.viewport;
    return viewport ? {width: viewport.width, height: viewport.height} : undefined;
  }

  /** True once the active tab has drawn a picture. */
  hasPicture(): boolean {
    const tab = this.tabs_[this.active_];
    return Boolean(tab && tab.lines.length && tab.linesBox);
  }

  notice(): string | undefined {
    if (!this.noticeText) return undefined;
    if (this.clock.now() - this.noticeText.at > NOTICE_MS) { this.noticeText = undefined; return undefined; }
    return this.noticeText.text;
  }

  setNotice(text: string): void {
    this.noticeText = {text: plainText(text, 160), at: this.clock.now()};
    this.touch();
  }

  /** The page area's viewport in CSS pixels at the current size and cell. */
  viewport(): Viewport {
    const scale = this.scale();
    return {width: Math.max(1, Math.round(this.area.columns * this.cellSize.width / scale)), height: Math.max(1, Math.round(this.area.rows * this.cellSize.height / scale)), scale};
  }

  private scale(): number {
    const set = this.options.scale;
    if (typeof set === 'number' && set > 0) return set;
    return Math.max(1, Math.min(3, Math.round(this.cellSize.height / 16)));
  }

  /** Changes are announced at most every 33 ms, however many frames and events arrive. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ---- tabs ------------------------------------------------------------------------------------------------------

  async open(url = 'about:blank', options: {background?: boolean} = {}): Promise<OpenResult> {
    if (this.disposed) return {ok: false, reason: 'The browser is closed.'};
    if (this.tabs_.length >= MAX_TABS) {
      const reason = `${MAX_TABS} tabs are open. Close one first.`;
      this.setNotice(reason);
      return {ok: false, reason};
    }
    const tab = this.makeTab(url);
    this.tabs_.push(tab);
    if (!options.background) this.activateTab(tab);
    this.touch();
    return this.attach(tab, url);
  }

  newTab(url = 'about:blank'): Promise<OpenResult> { return this.open(url); }

  private makeTab(url: string): Tab {
    return {id: this.nextId++, stream: this.options.openStream({}), lines: [], title: '', url, loading: true, editable: false, zoom: 1, unsubscribe: [], closed: false};
  }

  private async attach(tab: Tab, url: string): Promise<OpenResult> {
    let page: BrowserPage;
    try {
      page = await this.options.engine.open({
        kind: 'web', url, viewport: this.viewport(),
        ...(this.options.colorScheme ? {colorScheme: this.options.colorScheme} : {}),
        ...(this.options.reducedMotion !== undefined ? {reducedMotion: this.options.reducedMotion} : {}),
      });
    } catch (error) {
      const reason = plainText(error instanceof Error ? error.message : 'The browser could not start.', 160);
      if (!tab.closed) { tab.loading = false; tab.error = reason; this.touch(); }
      this.setNotice(reason);
      return {ok: false, reason};
    }
    if (tab.closed || this.disposed) { void page.close().catch(() => undefined); return {ok: false, reason: 'The tab was closed.'}; }
    tab.page = page;
    tab.url = page.url || url;
    tab.title = page.title;
    tab.zoom = page.zoom;
    tab.loading = page.loading;
    delete tab.error;
    tab.unsubscribe.push(page.onEvent(event => this.event(tab, event)));
    tab.unsubscribe.push(page.onFrame(frame => this.frame(tab, frame)));
    this.touch();
    return {ok: true};
  }

  closeTab(index = this.active_): void {
    const tab = this.tabs_[index];
    if (!tab) return;
    this.tabs_.splice(index, 1);
    this.retire(tab);
    if (index < this.active_ || this.active_ >= this.tabs_.length) this.active_ = Math.max(0, this.active_ - 1);
    const now = this.tabs_[this.active_];
    if (now) this.show(now);
    this.touch();
  }

  activate(index: number): void {
    const tab = this.tabs_[index];
    if (!tab || index === this.active_) return;
    this.activateTab(tab);
    this.touch();
  }

  /** Step to the next (+1) or previous (-1) tab, wrapping. */
  cycle(delta: number): void {
    if (this.tabs_.length < 2) return;
    this.activate((this.active_ + delta + this.tabs_.length) % this.tabs_.length);
  }

  private activateTab(tab: Tab): void {
    const was = this.tabs_[this.active_];
    if (was && was !== tab) was.stream.release();
    this.active_ = this.tabs_.indexOf(tab);
    this.show(tab);
  }

  /** Draw the tab's latest frame into the current area (a switch, a close, a resize). */
  private show(tab: Tab): void {
    if (!tab.frame) { tab.lines = []; delete tab.linesBox; return; }
    this.draw(tab, tab.frame);
    // The viewport may have changed while the tab was hidden.
    if (tab.page && this.keyOf(tab.page.viewport) !== this.keyOf(this.viewport())) this.scheduleViewport(0);
  }

  private retire(tab: Tab): void {
    tab.closed = true;
    for (const off of tab.unsubscribe.splice(0)) { try { off(); } catch { /* already gone */ } }
    if (tab.retry !== undefined) { this.clock.clearTimeout(tab.retry); tab.retry = undefined; }
    tab.stream.dispose();
    const page = tab.page;
    tab.page = undefined;
    if (page) void page.close().catch(() => undefined);
  }

  // ---- frames and events -----------------------------------------------------------------------------------------

  private frame(tab: Tab, frame: Frame): void | Promise<void> {
    if (tab.closed || this.disposed) return;
    tab.frame = frame;
    if (this.tabs_[this.active_] !== tab) return delay(this.clock, BACKGROUND_FRAME_MS);
    const skipped = this.draw(tab, frame);
    this.touch();
    const wait = tab.stream.retryAfter();
    if (skipped && wait > 0) {
      // The stream held this frame back for rate: draw the newest one once it is due, so the last picture is never lost.
      if (tab.retry === undefined) {
        tab.retry = this.clock.setTimeout(() => {
          tab.retry = undefined;
          if (!tab.closed && !this.disposed && tab.frame && this.tabs_[this.active_] === tab) { this.draw(tab, tab.frame); this.touch(); }
        }, wait);
      }
      return delay(this.clock, wait);
    }
    return undefined;
  }

  /** True when the stream skipped the frame. */
  private draw(tab: Tab, frame: Frame): boolean {
    const box = {...this.area};
    const output = tab.stream.update({png: frame.png, width: frame.width, height: frame.height}, box);
    tab.lines = output.lines;
    tab.linesBox = box;
    if (output.note) this.setNotice(output.note);
    return output.skipped;
  }

  /** The terminal's pictures are gone (a program took the screen): every tab uploads again on its next frame. */
  forgetPictures(): void {
    for (const tab of this.tabs_) tab.stream.forget();
    const tab = this.tabs_[this.active_];
    if (tab?.frame) this.draw(tab, tab.frame);
    this.touch();
  }

  /** Delete the previous picture once the new one is on screen. The panel calls it after a render. */
  settle(): void {
    this.tabs_[this.active_]?.stream.settle();
  }

  private event(tab: Tab, event: PageEvent): void {
    if (tab.closed || this.disposed) return;
    switch (event.type) {
      case 'navigated': tab.url = event.url; delete tab.find; break;
      case 'title': tab.title = event.title; break;
      case 'loading': tab.loading = event.loading; break;
      case 'editable': tab.editable = event.editable; break;
      case 'dialog': this.setNotice(`The page showed ${event.kind === 'beforeunload' ? 'a leave prompt' : `an ${event.kind}`}: ${plainText(event.message, 80)}`); break;
      case 'blocked': this.setNotice(`Blocked: ${plainText(event.reason, 80)}`); break;
      case 'download-blocked': this.setNotice('A download was blocked. NMSh does not save files from pages.'); break;
      case 'popup': {
        const url = popupAddress(event.url);
        if (url === undefined) this.setNotice('A popup to an address that cannot open here was blocked.');
        else if (this.tabs_.length >= MAX_TABS) this.setNotice(`A popup was blocked: ${MAX_TABS} tabs are open.`);
        else void this.open(url);
        break;
      }
      case 'crashed': this.fail(tab, 'The page crashed.'); break;
      case 'closed': this.fail(tab, 'The page was closed.'); break;
    }
    this.touch();
  }

  private fail(tab: Tab, message: string): void {
    tab.error = message;
    tab.loading = false;
    tab.editable = false;
    for (const off of tab.unsubscribe.splice(0)) { try { off(); } catch { /* gone */ } }
    const page = tab.page;
    tab.page = undefined;
    if (page) void page.close().catch(() => undefined);
    tab.stream.release();
    tab.lines = [];
    delete tab.linesBox;
    delete tab.frame;
  }

  // ---- resizing --------------------------------------------------------------------------------------------------

  /**
   * The page area's size in cells (and the terminal's cell size, when it changed). The picture is fitted to the new area at
   * once; the page's viewport follows after the size has stopped changing, and fresh frames are then requested.
   */
  resize(area: {columns: number; rows: number}, cell?: {width: number; height: number}): void {
    if (this.disposed) return;
    const columns = Math.max(1, Math.floor(area.columns));
    const rows = Math.max(1, Math.floor(area.rows));
    const nextCell = cell ?? this.options.cell();
    if (columns === this.area.columns && rows === this.area.rows && nextCell.width === this.cellSize.width && nextCell.height === this.cellSize.height) return;
    this.area = {columns, rows};
    this.cellSize = nextCell;
    const tab = this.tabs_[this.active_];
    if (tab?.frame) this.draw(tab, tab.frame);
    this.scheduleViewport(RESIZE_DEBOUNCE_MS);
    this.touch();
  }

  private scheduleViewport(ms: number): void {
    if (this.resizeTimer !== undefined) this.clock.clearTimeout(this.resizeTimer);
    this.resizeTimer = this.clock.setTimeout(() => { this.resizeTimer = undefined; void this.applyViewport(); }, ms);
  }

  private keyOf(viewport: Viewport): string { return `${viewport.width}x${viewport.height}@${viewport.scale}`; }

  private async applyViewport(): Promise<void> {
    if (this.disposed) return;
    const viewport = this.viewport();
    const tabs = [...this.tabs_];
    for (const tab of tabs) {
      if (!tab.page || tab.closed) continue;
      try { await tab.page.setViewport(viewport); } catch { /* a page that went away reports it through its events */ }
    }
    const active = this.tabs_[this.active_];
    if (!active?.page || active.closed) return;
    try {
      const frame = await active.page.capture();
      if (!active.closed && !this.disposed) { active.frame = frame; this.draw(active, frame); this.touch(); }
    } catch { /* the next frame the page sends will do */ }
  }

  // ---- navigation ------------------------------------------------------------------------------------------------

  private act(run: (page: BrowserPage) => Promise<unknown>): Promise<void> {
    const tab = this.tabs_[this.active_];
    if (!tab?.page) return Promise.resolve();
    return run(tab.page).then(() => { this.sync(tab); }, (error: unknown) => {
      this.setNotice(error instanceof Error ? error.message : 'The page did not answer.');
    });
  }

  private sync(tab: Tab): void {
    if (tab.closed || !tab.page) return;
    tab.zoom = tab.page.zoom;
    tab.url = tab.page.url || tab.url;
    this.touch();
  }

  /** Load an address in the active tab, or open one when there is no tab. */
  async navigate(url: string): Promise<void> {
    const tab = this.tabs_[this.active_];
    if (!tab) { await this.open(url); return; }
    tab.url = url;
    if (!tab.page) { await this.reopen(tab, url); return; }
    await this.act(page => page.navigate(url));
  }

  back(): Promise<void> { return this.act(page => page.back()); }
  forward(): Promise<void> { return this.act(page => page.forward()); }
  stop(): Promise<void> { return this.act(page => page.stop()); }

  async reload(options: {hard?: boolean} = {}): Promise<void> {
    const tab = this.tabs_[this.active_];
    if (!tab) return;
    // A tab whose page crashed or closed gets a new page at the same address.
    if (!tab.page) { await this.reopen(tab, tab.url); return; }
    await this.act(page => page.reload(options.hard ? {hard: true} : undefined));
  }

  hardReload(): Promise<void> { return this.reload({hard: true}); }

  private async reopen(tab: Tab, url: string): Promise<void> {
    tab.loading = true;
    delete tab.error;
    this.touch();
    await this.attach(tab, url);
  }

  async zoomBy(direction: 1 | -1): Promise<void> {
    const tab = this.tabs_[this.active_];
    if (!tab?.page) return;
    const current = tab.page.zoom;
    let index = 0;
    for (let at = 0; at < ZOOM_STEPS.length; at += 1) if (Math.abs(ZOOM_STEPS[at]! - current) < Math.abs(ZOOM_STEPS[index]! - current)) index = at;
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + direction))]!;
    await this.setZoom(next);
  }

  async setZoom(zoom: number): Promise<void> {
    await this.act(page => page.setZoom(zoom));
    this.setNotice(`Zoom ${Math.round((this.tabs_[this.active_]?.zoom ?? zoom) * 100)}%`);
  }

  // ---- find ------------------------------------------------------------------------------------------------------

  async find(query: string, options: {backwards?: boolean} = {}): Promise<void> {
    const tab = this.tabs_[this.active_];
    if (!tab?.page) return;
    if (!query) { await this.clearFind(); return; }
    try {
      const result = await tab.page.find(query, options.backwards ? {backwards: true} : undefined);
      if (tab.closed) return;
      tab.find = {query, matches: result.matches, current: result.current};
      if (!result.matches) this.setNotice(`No match for "${plainText(query, 40)}".`);
      this.touch();
    } catch { this.setNotice('The page did not answer.'); }
  }

  /** The next or previous match of the active tab's current query. */
  async findNext(backwards = false): Promise<void> {
    const query = this.tabs_[this.active_]?.find?.query;
    if (query) await this.find(query, {backwards});
  }

  async clearFind(): Promise<void> {
    const tab = this.tabs_[this.active_];
    if (!tab) return;
    delete tab.find;
    this.touch();
    if (tab.page) { try { await tab.page.clearFind(); } catch { /* the page is gone */ } }
  }

  // ---- input to the page -----------------------------------------------------------------------------------------

  /** A key press for the page: down (carrying the text) then up. */
  async sendKey(input: KeyEventInput): Promise<void> {
    await this.act(async page => { await page.key('down', input); await page.key('up', input); });
  }

  sendMouse(event: MouseEventInput): Promise<void> { return this.act(page => page.mouse(event)); }
  insertText(text: string): Promise<void> { return this.act(page => page.insertText(text)); }

  /** Scroll the active page with wheel events at the middle of the page. */
  scroll(amount: 'line' | 'page' | 'top' | 'bottom', direction: 1 | -1, horizontal = false): Promise<void> {
    const viewport = this.tabs_[this.active_]?.page?.viewport ?? this.viewport();
    const line = Math.max(16, Math.round(this.cellSize.height * 3 / viewport.scale));
    const distance = amount === 'line' ? line : amount === 'page' ? Math.round((horizontal ? viewport.width : viewport.height) * 0.9) : 100_000;
    const delta = direction * distance;
    return this.sendMouse({type: 'wheel', x: Math.round(viewport.width / 2), y: Math.round(viewport.height / 2), deltaX: horizontal ? delta : 0, deltaY: horizontal ? 0 : delta});
  }

  // ---- change notification ---------------------------------------------------------------------------------------

  private touch(): void {
    if (this.disposed || this.changeTimer !== undefined || !this.listeners.size) return;
    const wait = this.lastChange + CHANGE_INTERVAL_MS - this.clock.now();
    if (wait <= 0) { this.emit(); return; }
    this.changeTimer = this.clock.setTimeout(() => { this.changeTimer = undefined; this.emit(); }, wait);
  }

  private emit(): void {
    this.lastChange = this.clock.now();
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* a listener's failure is its own */ } }
  }

  // ---- end -------------------------------------------------------------------------------------------------------

  /** Close every tab, delete every picture, remove every subscription. Safe to repeat. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.resizeTimer !== undefined) this.clock.clearTimeout(this.resizeTimer);
    if (this.changeTimer !== undefined) this.clock.clearTimeout(this.changeTimer);
    this.resizeTimer = this.changeTimer = undefined;
    for (const tab of this.tabs_.splice(0)) this.retire(tab);
    this.listeners.clear();
  }
}

function viewOf(tab: Tab): TabView {
  const page = tab.page;
  return {
    id: tab.id,
    title: plainText(tab.title, 120),
    url: tab.url,
    loading: tab.loading,
    ...(tab.error ? {error: tab.error} : {}),
    editable: tab.editable,
    canGoBack: page?.canGoBack ?? false,
    canGoForward: page?.canGoForward ?? false,
    zoom: tab.zoom,
    ...(tab.find ? {find: {...tab.find}} : {}),
  };
}

function delay(clock: SessionClock, ms: number): Promise<void> {
  return new Promise(resolve => { clock.setTimeout(resolve, ms); });
}
