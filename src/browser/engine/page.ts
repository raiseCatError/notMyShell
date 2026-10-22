import {randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import {consoleEntry, policyEntry, type RedactContext} from '../console.js';
import type {BrowserPage, Frame, KeyEventInput, MouseEventInput, OpenOptions, PageEvent, PageKind, Viewport} from '../types.js';
import type {CdpClient, CdpEvent} from './cdp.js';
import {cleanForDisplay} from './preview.js';

/**
 * One page of the browser: a DevTools target plus the policy NMSh puts around it. Web pages live in the default (persistent) browser
 * context and may only be at http, https, file or about:blank; previews each get a throwaway context and may only ever reach their
 * own loopback origin (every other request is failed in the network layer and reported as `blocked`).
 */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;
const MAX_URL_DISPLAY = 2000;
const TITLE_POLL_MS = 500;

export interface PageHost {
  cdp: CdpClient;
  /** Called once when the page is gone, for the engine's bookkeeping. */
  released(page: ChromePage): void;
}

export type UrlVerdict = {ok: true; url: string} | {ok: false; reason: string};

/** What a web page may navigate to. Everything else (javascript:, data:, chrome:, devtools:, view-source:, blob:, ftp:…) is refused. */
export function checkWebUrl(address: string): UrlVerdict {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return {ok: false, reason: 'not a valid address'};
  }
  if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:') return {ok: true, url: url.href};
  if (address.trim().toLowerCase() === 'about:blank') return {ok: true, url: 'about:blank'};
  return {ok: false, reason: `${cleanForDisplay(url.protocol, 30)} addresses are not opened`};
}

export function pngSize(png: Uint8Array): {width: number; height: number} {
  if (png.length < 24) return {width: 0, height: 0};
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return {width: view.getUint32(16), height: view.getUint32(20)};
}

const VIRTUAL_KEYS: Readonly<Record<string, number>> = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46
};
const EDIT_COMMANDS: Readonly<Record<string, string>> = {a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo', y: 'redo'};
const BUTTON_MASK = {left: 1, right: 2, middle: 4} as const;

export function keyParameters(type: 'down' | 'up' | 'char', event: KeyEventInput): Record<string, unknown> {
  const modifiers = event.modifiers ?? 0;
  const key = event.key;
  let virtual = VIRTUAL_KEYS[key];
  if (virtual === undefined && /^F([1-9]|1[0-2])$/u.test(key)) virtual = 111 + Number(key.slice(1));
  if (virtual === undefined && key.length === 1) {
    const upper = key.toUpperCase();
    if (/^[A-Z0-9]$/u.test(upper)) virtual = upper.charCodeAt(0);
  }
  const text = event.text ?? (key.length === 1 ? key : key === 'Enter' ? '\r' : undefined);
  const params: Record<string, unknown> = {key, modifiers};
  if (event.code) params.code = event.code;
  if (virtual !== undefined) params.windowsVirtualKeyCode = virtual;
  if (type === 'up') return {...params, type: 'keyUp'};
  if (type === 'char') return {...params, type: 'char', text: event.text ?? (key.length === 1 ? key : '')};
  const shortcut = (modifiers & (2 | 4)) !== 0 && key.length === 1; // Ctrl or Meta: an editing command, not text
  if (shortcut) {
    const command = EDIT_COMMANDS[key.toLowerCase()];
    return {...params, type: 'rawKeyDown', ...(command ? {commands: [command]} : {})};
  }
  const printable = text !== undefined && text !== '' && (modifiers & 1) === 0;
  return printable ? {...params, type: 'keyDown', text, unmodifiedText: text} : {...params, type: 'rawKeyDown'};
}

const EDITABLE_SCRIPT = (binding: string): string => `(() => {
  const send = window[${JSON.stringify(binding)}];
  if (typeof send !== 'function') return;
  try { delete window[${JSON.stringify(binding)}]; } catch {}
  const NON_TEXT = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'image', 'file', 'range', 'color']);
  const editable = () => {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT') return !NON_TEXT.has((el.type || 'text').toLowerCase());
    return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  };
  let last = false;
  const report = () => { const now = editable(); if (now !== last) { last = now; send(now ? '1' : '0'); } };
  addEventListener('focusin', report, true);
  addEventListener('focusout', () => setTimeout(report, 0), true);
})();`;

const FIND_FUNCTION = `(query, backwards) => {
  const state = globalThis.__nmshFind || (globalThis.__nmshFind = {query: '', index: -1});
  const needle = query.toLowerCase();
  const ranges = [];
  if (needle && document.body) {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE']);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.checkVisibility && !parent.checkVisibility({visibilityProperty: true})) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
    for (let node; (node = walker.nextNode()) && ranges.length < 10000;) {
      const text = node.nodeValue.toLowerCase();
      for (let at = 0, i; (i = text.indexOf(needle, at)) !== -1; at = i + needle.length) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + needle.length);
        ranges.push(range);
      }
    }
  }
  const selection = getSelection();
  selection.removeAllRanges();
  if (ranges.length === 0) { state.query = query; state.index = -1; return {matches: 0, current: 0}; }
  const index = state.query !== query || state.index < 0
    ? (backwards ? ranges.length - 1 : 0)
    : (state.index + (backwards ? -1 : 1) + ranges.length) % ranges.length;
  state.query = query;
  state.index = index;
  selection.addRange(ranges[index]);
  const element = ranges[index].startContainer.parentElement;
  if (element) element.scrollIntoView({block: 'center', inline: 'nearest'});
  return {matches: ranges.length, current: index + 1};
}`;

const CLEAR_FIND = `(() => { const state = globalThis.__nmshFind; if (state) { state.query = ''; state.index = -1; } getSelection().removeAllRanges(); })()`;

export class ChromePage implements BrowserPage {
  readonly id: string;
  readonly kind: PageKind;
  private _url = 'about:blank';
  private _title = '';
  private _loading = false;
  private _canGoBack = false;
  private _canGoForward = false;
  private _viewport: Viewport;
  private _zoom = 1;
  private _editable = false;
  private scripts: boolean;
  private colorScheme: OpenOptions['colorScheme'];
  private reducedMotion: boolean | undefined;

  private targetId = '';
  private sessionId = '';
  private contextId: string | undefined;
  private mainFrameId = '';
  private allowedOrigin: string | undefined;
  private binding = '';
  private findWorld: number | undefined;
  private mouseButtons = 0;
  private frameSequence = 0;
  private screencasting = false;
  private delivering = false;
  private skipped: number[] = [];
  private closing: Promise<void> | undefined;
  private done = false;
  private readonly frameListeners = new Set<(frame: Frame) => void | Promise<void>>();
  private readonly eventListeners = new Set<(event: PageEvent) => void>();
  private readonly unsubscribe: () => void;
  private titleTimer: NodeJS.Timeout | undefined;
  private titlePolling = false;
  /** Console records are made only for a preview opened with `console`; the page's own (default) worlds only, never NMSh's isolated ones. */
  private readonly consoleName: string | undefined;
  private readonly pageWorlds = new Set<number>();
  /**
   * The document starts loading inside `open()`, before anyone can listen: a Console page keeps what it reports until the first
   * listener arrives (bounded), so errors of the first load are not lost.
   */
  private early: PageEvent[] | undefined;

  private constructor(private readonly host: PageHost, id: string, options: OpenOptions) {
    this.id = id;
    this.kind = options.kind;
    this._viewport = {...options.viewport};
    this.scripts = options.scripts ?? options.kind === 'web';
    this.colorScheme = options.colorScheme;
    this.reducedMotion = options.reducedMotion;
    this.consoleName = options.kind === 'preview' ? options.console?.documentName : undefined;
    if (this.consoleName !== undefined) this.early = [];
    this.unsubscribe = host.cdp.onEvent(event => this.onCdpEvent(event));
    // `Target.targetInfoChanged` is not sent for every title change (a script setting document.title, a background window), so the
    // title is also read directly; one small call twice a second.
    this.titleTimer = setInterval(() => { void this.refreshTitle(); }, TITLE_POLL_MS);
    this.titleTimer.unref();
  }

  static async open(host: PageHost, id: string, options: OpenOptions): Promise<ChromePage> {
    const page = new ChromePage(host, id, options);
    try {
      await page.setup(options);
    } catch (error) {
      await page.close().catch(() => undefined);
      throw error;
    }
    return page;
  }

  get url(): string { return this._url; }
  get title(): string { return this._title; }
  get loading(): boolean { return this._loading; }
  get canGoBack(): boolean { return this._canGoBack; }
  get canGoForward(): boolean { return this._canGoForward; }
  get viewport(): Viewport { return {...this._viewport}; }
  get zoom(): number { return this._zoom; }
  get editable(): boolean { return this._editable; }
  get isClosed(): boolean { return this.done; }
  get target(): string { return this.targetId; }
  get frame(): string { return this.mainFrameId; }

  /** For the engine's own specialised pages (the diagram renderer): one protocol command on this page's session. */
  protocol<T = any>(method: string, params: object = {}, timeoutMs?: number): Promise<T> {
    return this.host.cdp.send<T>(method, params, {sessionId: this.sessionId, ...(timeoutMs !== undefined ? {timeoutMs} : {})});
  }

  // ---- setup -------------------------------------------------------------------------------------------------------------

  /**
   * Right after a navigation commits Chrome briefly answers "Not attached to an active page" while the renderer is swapped; the
   * command works a moment later, so it is retried for up to two seconds.
   */
  private async send<T = any>(method: string, params: object = {}): Promise<T> {
    for (let attempt = 0;; attempt++) {
      try {
        return await this.host.cdp.send<T>(method, params, {sessionId: this.sessionId});
      } catch (error) {
        if (attempt >= 20 || this.done || !(error instanceof Error) || !/Not attached to an active page/u.test(error.message)) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  private async setup(options: OpenOptions): Promise<void> {
    const cdp = this.host.cdp;
    if (this.kind === 'preview') {
      this.contextId = (await cdp.send<{browserContextId: string}>('Target.createBrowserContext', {disposeOnDetach: true})).browserContextId;
      await cdp.send('Browser.setDownloadBehavior', {behavior: 'deny', browserContextId: this.contextId, eventsEnabled: true});
      if (options.url) this.allowedOrigin = new URL(options.url).origin;
    }
    this.targetId = (await cdp.send<{targetId: string}>('Target.createTarget', {url: 'about:blank', newWindow: true, ...(this.contextId ? {browserContextId: this.contextId} : {})})).targetId;
    this.sessionId = (await cdp.send<{sessionId: string}>('Target.attachToTarget', {targetId: this.targetId, flatten: true})).sessionId;
    this.binding = `__nmsh${randomBytes(8).toString('hex')}`;
    await Promise.all([
      this.send('Page.enable'),
      this.send('Runtime.enable'),
      this.send('Log.enable'),
      this.send('Emulation.setFocusEmulationEnabled', {enabled: true}),
      this.send('Runtime.addBinding', {name: this.binding}),
      this.send('Page.addScriptToEvaluateOnNewDocument', {source: EDITABLE_SCRIPT(this.binding)}),
      this.kind === 'preview' ? this.send('Fetch.enable', {patterns: [{urlPattern: '*'}]}) : undefined,
      this.applyMetrics(),
      this.applyMedia(),
      this.scripts ? undefined : this.send('Emulation.setScriptExecutionDisabled', {value: true})
    ]);
    const tree = await this.send<{frameTree: {frame: {id: string}}}>('Page.getFrameTree');
    this.mainFrameId = tree.frameTree.frame.id;
    if (options.url) await this.navigate(options.url);
  }

  private applyMetrics(): Promise<unknown> {
    const {width, height, scale} = this._viewport;
    return this.send('Emulation.setDeviceMetricsOverride', {
      width: Math.max(1, Math.round(width / this._zoom)),
      height: Math.max(1, Math.round(height / this._zoom)),
      deviceScaleFactor: scale * this._zoom,
      mobile: false
    });
  }

  private applyMedia(): Promise<unknown> {
    const features: Array<{name: string; value: string}> = [];
    if (this.colorScheme) features.push({name: 'prefers-color-scheme', value: this.colorScheme});
    if (this.reducedMotion !== undefined) features.push({name: 'prefers-reduced-motion', value: this.reducedMotion ? 'reduce' : 'no-preference'});
    return this.send('Emulation.setEmulatedMedia', {media: '', features});
  }

  // ---- events ------------------------------------------------------------------------------------------------------------

  private emit(event: PageEvent): void {
    if (this.early && (event.type === 'console' || event.type === 'document')) {
      if (this.eventListeners.size === 0) { if (this.early.length < 200) this.early.push(event); return; }
      this.early = undefined;
    }
    for (const listener of [...this.eventListeners]) {
      try { listener(event); } catch { /* a listener's bug must not break the page */ }
    }
  }

  onEvent(listener: (event: PageEvent) => void): () => void {
    this.eventListeners.add(listener);
    const early = this.early;
    this.early = undefined;
    for (const event of early ?? []) { try { listener(event); } catch { /* a listener's bug must not break the page */ } }
    return () => { this.eventListeners.delete(listener); };
  }

  private setLoading(loading: boolean): void {
    if (this._loading === loading) return;
    this._loading = loading;
    this.emit({type: 'loading', loading});
  }

  private setEditable(editable: boolean): void {
    if (this._editable === editable) return;
    this._editable = editable;
    this.emit({type: 'editable', editable});
  }

  private setUrl(url: string): void {
    this._url = cleanForDisplay(url, MAX_URL_DISPLAY);
    this.emit({type: 'navigated', url: this._url});
  }

  /** `record`: also a Console entry (false when Chrome's own log entry for the same refusal is recorded instead). */
  private block(url: string, reason: string, record = true): void {
    this.emit({type: 'blocked', url: cleanForDisplay(url, MAX_URL_DISPLAY), reason: cleanForDisplay(reason, 120)});
    if (record && this.consoleName !== undefined) this.emit({type: 'console', entry: policyEntry(url, reason, this.redaction())});
  }

  /** What the Console's redaction needs: the document's address (its token is never shown), its name, the home folder. */
  private redaction(): RedactContext {
    return {documentUrl: this._url, documentName: this.consoleName ?? 'this document', home: homedir()};
  }

  /** A DevTools event for the Console: Runtime events count only from the page's own worlds of its current document. */
  private onConsoleEvent(method: string, params: any): void {
    if (this.consoleName === undefined) return;
    if (method !== 'Log.entryAdded') {
      const context = method === 'Runtime.exceptionThrown' ? params?.exceptionDetails?.executionContextId : params?.executionContextId;
      if (!this.pageWorlds.has(context)) return;
    }
    const entry = consoleEntry(method, params, this.redaction());
    if (entry) this.emit({type: 'console', entry});
  }

  private onCdpEvent(event: CdpEvent): void {
    if (this.done) return;
    const {method, params} = event;
    if (event.sessionId === undefined) {
      if (method === 'Target.targetInfoChanged' && params.targetInfo?.targetId === this.targetId) {
        this.setTitle(String(params.targetInfo.title ?? ''));
      } else if (method === 'Target.targetDestroyed' && params.targetId === this.targetId) {
        void this.gone(false);
      } else if (method === 'Target.targetCrashed' && params.targetId === this.targetId) {
        void this.gone(true);
      } else if (method === 'Browser.downloadWillBegin' && params.frameId === this.mainFrameId) {
        this.emit({type: 'download-blocked', url: cleanForDisplay(String(params.url ?? ''), MAX_URL_DISPLAY)});
      }
      return;
    }
    if (event.sessionId !== this.sessionId) return;
    switch (method) {
      case 'Page.frameStartedLoading':
        if (params.frameId === this.mainFrameId) this.setLoading(true);
        break;
      case 'Page.frameStoppedLoading':
        if (params.frameId === this.mainFrameId) {
          this.setLoading(false);
          void this.refreshTitle();
        }
        break;
      case 'Page.frameNavigated':
        if (!params.frame.parentId) this.onMainFrameNavigated(params.frame);
        break;
      case 'Page.navigatedWithinDocument':
        if (params.frameId === this.mainFrameId) {
          this.setUrl(String(params.url));
          void this.refreshHistory();
        }
        break;
      case 'Page.screencastFrame':
        void this.onScreencastFrame(params);
        break;
      case 'Page.javascriptDialogOpening':
        this.emit({type: 'dialog', kind: String(params.type), message: cleanForDisplay(String(params.message ?? ''), 500)});
        void this.send('Page.handleJavaScriptDialog', {accept: params.type === 'alert'}).catch(() => undefined);
        break;
      case 'Page.windowOpen':
        this.onWindowOpen(String(params.url ?? ''));
        break;
      case 'Runtime.bindingCalled':
        if (params.name === this.binding) this.setEditable(params.payload === '1');
        break;
      case 'Runtime.executionContextsCleared':
        this.findWorld = undefined;
        this.pageWorlds.clear();
        this.setEditable(false);
        break;
      case 'Runtime.executionContextCreated':
        if (params.context?.auxData?.isDefault === true && typeof params.context.id === 'number') this.pageWorlds.add(params.context.id);
        break;
      case 'Runtime.executionContextDestroyed':
        this.pageWorlds.delete(params.executionContextId);
        break;
      case 'Runtime.exceptionThrown':
      case 'Runtime.consoleAPICalled':
        this.onConsoleEvent(method, params);
        break;
      case 'Fetch.requestPaused':
        void this.onRequestPaused(params);
        break;
      case 'Log.entryAdded':
        this.onLogEntry(params.entry);
        this.onConsoleEvent(method, params);
        break;
      case 'Inspector.targetCrashed':
        void this.gone(true);
        break;
      case 'Inspector.detached':
        void this.gone(false);
        break;
    }
  }

  private setTitle(raw: string): void {
    const title = cleanForDisplay(raw, 300);
    if (title === this._title) return;
    this._title = title;
    this.emit({type: 'title', title});
  }

  private async refreshTitle(): Promise<void> {
    if (this.done || this.titlePolling || !this.targetId) return;
    this.titlePolling = true;
    try {
      const info = await this.host.cdp.send<{targetInfo: {title?: string}}>('Target.getTargetInfo', {targetId: this.targetId}, {timeoutMs: 3000});
      if (!this.done) this.setTitle(String(info.targetInfo.title ?? ''));
    } catch { /* the page is going away */ } finally {
      this.titlePolling = false;
    }
  }

  private onMainFrameNavigated(frame: {id: string; url: string; unreachableUrl?: string}): void {
    this.mainFrameId = frame.id;
    // A new document: what the previous one reported belongs to it (Page.frameNavigated is cross-document only).
    this.emit({type: 'document'});
    if (frame.url.startsWith('chrome-error:')) {
      // Chrome's own page for a failed load: show the address the person asked for.
      this.setUrl(frame.unreachableUrl ?? this._url);
    } else {
      const verdict = this.kind === 'preview' ? this.checkPreviewUrl(frame.url) : checkWebUrl(frame.url);
      if (!verdict.ok) {
        this.block(frame.url, verdict.reason);
        void this.send('Page.navigate', {url: 'about:blank'}).catch(() => undefined);
        return;
      }
      this.setUrl(frame.url);
    }
    void this.refreshHistory();
  }

  private checkPreviewUrl(address: string): UrlVerdict {
    if (address === 'about:blank') return {ok: true, url: address};
    try {
      const url = new URL(address);
      if (this.allowedOrigin !== undefined && url.origin === this.allowedOrigin) return {ok: true, url: url.href};
    } catch { /* fall through */ }
    return {ok: false, reason: 'a preview only shows its own document'};
  }

  private async refreshHistory(): Promise<void> {
    try {
      const history = await this.send<{currentIndex: number; entries: unknown[]}>('Page.getNavigationHistory');
      this._canGoBack = history.currentIndex > 0;
      this._canGoForward = history.currentIndex < history.entries.length - 1;
    } catch { /* the page is going away */ }
  }

  private onWindowOpen(url: string): void {
    const verdict = checkWebUrl(url);
    if (this.kind === 'preview') this.block(url, 'new windows are not opened from a preview');
    else if (verdict.ok && url !== 'about:blank') this.emit({type: 'popup', url: verdict.url});
    else this.block(url, verdict.ok ? 'empty window' : verdict.reason);
  }

  private async onRequestPaused(params: any): Promise<void> {
    const url = String(params.request?.url ?? '');
    let allowed = false;
    try {
      const parsed = new URL(url);
      allowed = parsed.origin === this.allowedOrigin
        || (parsed.protocol === 'data:' && (params.resourceType === 'Image' || params.resourceType === 'Font'));
    } catch { /* not a URL: refuse */ }
    try {
      if (allowed) {
        await this.send('Fetch.continueRequest', {requestId: params.requestId});
      } else {
        this.block(url, 'a preview loads nothing from outside its own folder');
        // A refused main-frame navigation is aborted (the current page stays); anything else fails as blocked.
        const navigation = params.resourceType === 'Document' && params.frameId === this.mainFrameId;
        await this.send('Fetch.failRequest', {requestId: params.requestId, errorReason: navigation ? 'Aborted' : 'BlockedByClient'});
      }
    } catch { /* the request or page is already gone */ }
  }

  /** Requests the page's CSP stopped never reach the network layer; Chrome reports them in the log. */
  private onLogEntry(entry: any): void {
    if (this.kind !== 'preview' || entry?.source !== 'security') return;
    const text = String(entry.text ?? '');
    if (!/Content Security Policy|violates the following/iu.test(text)) return;
    const quoted = /'((?:https?|ftp|ws|wss|data|blob):[^']*)'/iu.exec(text);
    this.block(quoted?.[1] ?? String(entry.url ?? ''), 'a preview loads nothing from outside its own folder', false);
  }

  // ---- screencast --------------------------------------------------------------------------------------------------------

  onFrame(listener: (frame: Frame) => void | Promise<void>): () => void {
    this.frameListeners.add(listener);
    if (this.frameListeners.size === 1) void this.startScreencast();
    return () => {
      this.frameListeners.delete(listener);
      if (this.frameListeners.size === 0) void this.stopScreencast();
    };
  }

  private async startScreencast(): Promise<void> {
    if (this.screencasting || this.done) return;
    this.screencasting = true;
    await this.send('Page.startScreencast', {format: 'png', everyNthFrame: 1}).catch(() => { this.screencasting = false; });
  }

  private async stopScreencast(): Promise<void> {
    if (!this.screencasting) return;
    this.screencasting = false;
    await this.send('Page.stopScreencast').catch(() => undefined);
  }

  private async onScreencastFrame(params: {data: string; sessionId: number}): Promise<void> {
    if (this.frameListeners.size === 0) return this.acknowledge([params.sessionId]);
    if (this.delivering) {
      // A listener is still busy: this frame is skipped. Its acknowledgement waits until the listener is done, which is what
      // keeps Chrome from producing frames faster than they are consumed; nothing is queued.
      this.skipped.push(params.sessionId);
      return;
    }
    this.delivering = true;
    try {
      const frame = await this.frameFor(params.data);
      await Promise.allSettled([...this.frameListeners].map(async listener => listener(frame)));
    } finally {
      this.delivering = false;
      const ids = [params.sessionId, ...this.skipped];
      this.skipped = [];
      await this.acknowledge(ids);
    }
  }

  private async acknowledge(ids: number[]): Promise<void> {
    if (this.done || !this.screencasting) return;
    await Promise.all(ids.map(sessionId => this.send('Page.screencastFrameAck', {sessionId}).catch(() => undefined)));
  }

  /**
   * A screencast frame is always in CSS pixels. At 1:1 it is the frame; otherwise (a device scale or zoom) the same moment is
   * captured again at full resolution so every frame is `viewport * scale` pixels, as the contract promises.
   */
  private async frameFor(screencastData: string): Promise<Frame> {
    if (Math.abs(this._viewport.scale * this._zoom - 1) < 0.001) return this.toFrame(screencastData);
    return this.capture().catch(() => this.toFrame(screencastData));
  }

  private toFrame(base64: string): Frame {
    const png = new Uint8Array(Buffer.from(base64, 'base64'));
    return {png, ...pngSize(png), sequence: ++this.frameSequence};
  }

  async capture(): Promise<Frame> {
    const shot = await this.send<{data: string}>('Page.captureScreenshot', {format: 'png', fromSurface: true});
    return this.toFrame(shot.data);
  }

  // ---- navigation --------------------------------------------------------------------------------------------------------

  async navigate(address: string): Promise<void> {
    const verdict = this.kind === 'preview' ? this.checkPreviewUrl(address) : checkWebUrl(address);
    if (!verdict.ok) {
      this.block(address, verdict.reason);
      return;
    }
    const result = await this.send<{errorText?: string}>('Page.navigate', {url: verdict.url});
    void result; // a failed load is shown by Chrome's own error page, which the frames carry
  }

  async reload(options: {hard?: boolean} = {}): Promise<void> {
    await this.send('Page.reload', {ignoreCache: options.hard === true});
  }

  async back(): Promise<void> { await this.step(-1); }
  async forward(): Promise<void> { await this.step(1); }

  private async step(delta: number): Promise<void> {
    const history = await this.send<{currentIndex: number; entries: Array<{id: number}>}>('Page.getNavigationHistory');
    const entry = history.entries[history.currentIndex + delta];
    if (entry) await this.send('Page.navigateToHistoryEntry', {entryId: entry.id});
  }

  async stop(): Promise<void> {
    await this.send('Page.stopLoading');
  }

  // ---- view --------------------------------------------------------------------------------------------------------------

  async setViewport(viewport: Viewport): Promise<void> {
    this._viewport = {...viewport};
    await this.applyMetrics();
  }

  async setZoom(zoom: number): Promise<void> {
    this._zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : 1));
    await this.applyMetrics();
  }

  async setScripts(enabled: boolean): Promise<void> {
    if (this.scripts === enabled) return;
    this.scripts = enabled;
    this.setEditable(false);
    await this.send('Emulation.setScriptExecutionDisabled', {value: !enabled});
    await this.reload();
  }

  // ---- input -------------------------------------------------------------------------------------------------------------

  async mouse(event: MouseEventInput): Promise<void> {
    const x = event.x / this._zoom;
    const y = event.y / this._zoom;
    const modifiers = event.modifiers ?? 0;
    if (event.type === 'wheel') {
      await this.send('Input.dispatchMouseEvent', {type: 'mouseWheel', x, y, deltaX: event.deltaX / this._zoom, deltaY: event.deltaY / this._zoom, modifiers});
      return;
    }
    if (event.type === 'move') {
      await this.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x, y, buttons: this.mouseButtons, modifiers});
      return;
    }
    const mask = BUTTON_MASK[event.button];
    this.mouseButtons = event.type === 'down' ? this.mouseButtons | mask : this.mouseButtons & ~mask;
    await this.send('Input.dispatchMouseEvent', {
      type: event.type === 'down' ? 'mousePressed' : 'mouseReleased', x, y, button: event.button,
      buttons: this.mouseButtons, clickCount: event.clickCount ?? 1, modifiers
    });
  }

  async key(type: 'down' | 'up' | 'char', event: KeyEventInput): Promise<void> {
    await this.send('Input.dispatchKeyEvent', keyParameters(type, event));
  }

  async insertText(text: string): Promise<void> {
    await this.send('Input.insertText', {text});
  }

  // ---- find --------------------------------------------------------------------------------------------------------------

  /**
   * Runs in an isolated world: a DevTools evaluation is not page script, so it works on previews whose scripts are off. It counts
   * case-insensitive matches in visible text, selects the next one (the selection is the highlight) and scrolls it to the middle.
   */
  private async inFindWorld(expression: string): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.findWorld === undefined) {
        this.findWorld = (await this.send<{executionContextId: number}>('Page.createIsolatedWorld', {frameId: this.mainFrameId, worldName: 'nmsh-find'})).executionContextId;
      }
      try {
        const result = await this.send<{result: {value?: unknown}; exceptionDetails?: unknown}>('Runtime.evaluate', {expression, contextId: this.findWorld, returnByValue: true});
        if (result.exceptionDetails) throw new Error('find failed');
        return result.result.value;
      } catch (error) {
        this.findWorld = undefined;
        if (attempt === 1) throw error;
      }
    }
  }

  async find(query: string, options: {backwards?: boolean} = {}): Promise<{matches: number; current: number}> {
    if (query === '') {
      await this.clearFind();
      return {matches: 0, current: 0};
    }
    const value = await this.inFindWorld(`(${FIND_FUNCTION})(${JSON.stringify(query)}, ${options.backwards === true})`);
    return {matches: Number(value?.matches) || 0, current: Number(value?.current) || 0};
  }

  async clearFind(): Promise<void> {
    await this.inFindWorld(CLEAR_FIND).catch(() => undefined);
  }

  // ---- end of life -------------------------------------------------------------------------------------------------------

  /** The browser or target went away (or crashed) without being asked. */
  private async gone(crashed: boolean): Promise<void> {
    if (this.done) return;
    if (crashed) this.emit({type: 'crashed'});
    await this.close();
  }

  /** The whole browser is gone: no commands can be sent any more. */
  browserGone(crashed: boolean): void {
    if (this.done) return;
    if (crashed) this.emit({type: 'crashed'});
    this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.screencasting = false;
    this.unsubscribe();
    if (this.titleTimer) clearInterval(this.titleTimer);
    this.emit({type: 'closed'});
    this.frameListeners.clear();
    this.eventListeners.clear();
    this.host.released(this);
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      if (!this.done) {
        await this.stopScreencast();
        if (this.targetId) await this.host.cdp.send('Target.closeTarget', {targetId: this.targetId}, {timeoutMs: 3000}).catch(() => undefined);
        if (this.contextId) await this.host.cdp.send('Target.disposeBrowserContext', {browserContextId: this.contextId}, {timeoutMs: 3000}).catch(() => undefined);
      }
      this.finish();
    })();
    return this.closing;
  }
}
