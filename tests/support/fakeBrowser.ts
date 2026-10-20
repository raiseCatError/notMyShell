import {encodePng} from '../../src/graphics/pngEncode.js';
import type {SessionClock} from '../../src/browser/session.js';
import type {BrowserAvailability, BrowserEngine, BrowserPage, BrowserStats, Frame, KeyEventInput, MouseEventInput, OpenOptions, PageEvent, PageKind, Viewport} from '../../src/browser/types.js';

/** A real PNG of a gradient; different seeds give different bytes. */
export function pngFrame(width = 16, height = 16, seed = 0, sequence = 1): Frame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set([(x * 16 + seed * 37) & 255, (y * 16 + seed * 91) & 255, (seed * 53) & 255, 255], (y * width + x) * 4);
  return {png: encodePng({width, height, data}), width, height, sequence};
}

export interface Call { name: string; args: unknown[] }

/** An in-memory page: records every call, lets a test push frames and events, and drops frames while a listener is busy. */
export class FakePage implements BrowserPage {
  readonly id: string;
  readonly kind: PageKind = 'web';
  url: string;
  title = '';
  loading = false;
  canGoBack = false;
  canGoForward = false;
  viewport: Viewport;
  zoom = 1;
  editable = false;
  closed = false;
  calls: Call[] = [];
  frameListeners = new Set<(frame: Frame) => void | Promise<void>>();
  eventListeners = new Set<(event: PageEvent) => void>();
  droppedFrames = 0;
  private busy = false;
  findResult = {matches: 3, current: 1};
  private sequence = 0;

  constructor(id: string, options: OpenOptions, readonly engine: FakeEngine) {
    this.id = id;
    this.url = options.url ?? 'about:blank';
    this.viewport = options.viewport;
  }

  count(name: string): number { return this.calls.filter(call => call.name === name).length; }
  private record(name: string, ...args: unknown[]): void { this.calls.push({name, args}); }

  async navigate(url: string): Promise<void> { this.record('navigate', url); this.url = url; }
  async reload(options?: {hard?: boolean}): Promise<void> { this.record('reload', options?.hard === true); }
  async back(): Promise<void> { this.record('back'); }
  async forward(): Promise<void> { this.record('forward'); }
  async stop(): Promise<void> { this.record('stop'); }
  async setViewport(viewport: Viewport): Promise<void> { this.record('setViewport', viewport); this.viewport = viewport; }
  async setZoom(zoom: number): Promise<void> { this.record('setZoom', zoom); this.zoom = zoom; }
  async setScripts(enabled: boolean): Promise<void> { this.record('setScripts', enabled); }
  onFrame(listener: (frame: Frame) => void | Promise<void>): () => void {
    this.frameListeners.add(listener);
    return () => { this.frameListeners.delete(listener); };
  }
  async capture(): Promise<Frame> { this.record('capture'); return pngFrame(this.viewport.width, this.viewport.height, 9, ++this.sequence); }
  onEvent(listener: (event: PageEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }
  async mouse(event: MouseEventInput): Promise<void> { this.record('mouse', event); }
  async key(type: 'down' | 'up' | 'char', event: KeyEventInput): Promise<void> { this.record('key', type, event); }
  async insertText(text: string): Promise<void> { this.record('insertText', text); }
  async find(query: string, options?: {backwards?: boolean}): Promise<{matches: number; current: number}> { this.record('find', query, options?.backwards === true); return this.findResult; }
  async clearFind(): Promise<void> { this.record('clearFind'); }
  async close(): Promise<void> { this.record('close'); this.closed = true; this.engine.live.delete(this); }

  emit(event: PageEvent): void {
    if (event.type === 'editable') this.editable = event.editable;
    for (const listener of [...this.eventListeners]) listener(event);
  }

  /** Offer a frame the way the engine does: not while the previous listener promise is pending. Resolves true when delivered. */
  async push(frame: Frame): Promise<boolean> {
    if (this.busy) { this.droppedFrames += 1; return false; }
    const waits: Array<void | Promise<void>> = [];
    for (const listener of [...this.frameListeners]) waits.push(listener(frame));
    const pending = waits.filter((wait): wait is Promise<void> => wait instanceof Promise);
    if (pending.length) {
      this.busy = true;
      void Promise.all(pending).then(() => { this.busy = false; });
    }
    return true;
  }
}

export class FakeEngine implements BrowserEngine {
  opened: FakePage[] = [];
  live = new Set<FakePage>();
  failOpen: string | undefined;
  options: OpenOptions[] = [];
  async available(): Promise<BrowserAvailability> { return {ok: true, executable: '/fake', version: '1'}; }
  async open(options: OpenOptions): Promise<FakePage> {
    if (this.failOpen) throw new Error(this.failOpen);
    const page = new FakePage(`p${this.opened.length + 1}`, options, this);
    this.options.push(options);
    this.opened.push(page);
    this.live.add(page);
    return page;
  }
  pages(): readonly BrowserPage[] { return [...this.live]; }
  async shutdown(): Promise<void> { for (const page of [...this.live]) await page.close(); }
  stats(): BrowserStats { return {running: this.live.size > 0, pages: this.live.size}; }
}

/** A manual clock: timers run only when the test advances time. */
export class FakeClock implements SessionClock {
  time = 1000;
  private timers: Array<{at: number; run: () => void; id: number}> = [];
  private next = 1;
  now(): number { return this.time; }
  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.push({at: this.time + ms, run: callback, id});
    return id;
  }
  clearTimeout(handle: unknown): void { this.timers = this.timers.filter(timer => timer.id !== handle); }
  pending(): number { return this.timers.length; }
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers.filter(timer => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter(timer => timer !== due);
      this.time = Math.max(this.time, due.at);
      due.run();
    }
    this.time = end;
  }
}

/** Let queued promise continuations run. */
export async function settle(times = 5): Promise<void> { for (let i = 0; i < times; i += 1) await new Promise<void>(resolve => setImmediate(resolve)); }
