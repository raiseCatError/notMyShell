import type {DiagramLibrary, DiagramRenderer, DiagramFailure} from '../browser/types.js';
import type {GraphicsService, LoadedImage} from '../graphics/service.js';
import type {LocatedLibrary} from './library.js';

/**
 * Drawing diagrams for every open document, with one renderer page at most (docs/design/diagrams.md).
 *
 *  - Lazy: nothing is located, imported or started until a document that wants diagrams drawn shows one.
 *  - One queue, one diagram at a time. Work starts only after `settleMs` without a new request (typing never waits on it, and a
 *    burst of edits costs one drawing). Before each job the text must still be shown by an open document: drafts typed past are
 *    dropped, never drawn.
 *  - Cached by content (text + theme): the same diagram in another document, after undo, or at another width is not drawn again.
 *    Bounded in images and decoded bytes; a diagram some document still shows is never evicted (documents are capped instead).
 *  - A timeout or a crash closes the renderer page; the next diagram opens a fresh one. Failures are remembered (not retried in a
 *    loop) until the person asks again.
 *  - The renderer page closes as soon as no document is attached, or after `idleMs` without work; the browser engine then stops
 *    on its own idle timer.
 */

export interface DiagramBackend {
  /** Why diagrams cannot be drawn now (the browser setting is off, no browser is installed, images are off), if so. */
  blocked(): Promise<string | undefined>;
  library(): Promise<LocatedLibrary>;
  open(library: DiagramLibrary): Promise<DiagramRenderer>;
  /** Decode a PNG from the renderer with the graphics service's bounded decoder. */
  decode(png: Uint8Array, name: string, key: string): Promise<LoadedImage>;
}

export type DiagramPlacer = Pick<GraphicsService, 'place' | 'releaseOwner'>;

/** What the service needs from a document showing diagrams. */
export interface DiagramClient {
  wants(key: string): boolean;
  notify(): void;
}

export type EntryState = 'queued' | 'drawing' | 'ready' | 'failed';

export interface DiagramEntry {
  key: string;
  source: string;
  config: Record<string, unknown>;
  state: EntryState;
  image?: LoadedImage;
  /** The PNG as drawn, for the browser preview's `data:` image. */
  png?: Uint8Array;
  type?: string;
  reason?: string;
  code?: DiagramFailure | 'unavailable';
  at: number;
}

export interface DiagramServiceOptions {
  backend: DiagramBackend;
  timeoutMs?: number;
  settleMs?: number;
  idleMs?: number;
  cacheImages?: number;
  cacheBytes?: number;
  /** Device pixels per CSS pixel for the drawings (a little extra for the enlarged view). */
  scale?: number;
  schedule?: (fn: () => void, ms: number) => {cancel(): void};
}

const TRANSIENT = new Set<DiagramEntry['code']>(['timeout', 'crashed', 'unavailable']);
const MAX_FAILURES = 200;

function realSchedule(fn: () => void, ms: number): {cancel(): void} {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return {cancel: () => clearTimeout(timer)};
}

export class DiagramService {
  private readonly entries = new Map<string, DiagramEntry>();
  private queue: string[] = [];
  private readonly clients = new Set<DiagramClient>();
  private renderer: DiagramRenderer | undefined;
  private opening: Promise<DiagramRenderer | {error: string}> | undefined;
  private library: Promise<LocatedLibrary> | undefined;
  private working = false;
  private settle: {cancel(): void} | undefined;
  private idle: {cancel(): void} | undefined;
  private clock = 0;
  private readonly options: Required<Omit<DiagramServiceOptions, 'backend' | 'schedule'>> & Pick<DiagramServiceOptions, 'backend'> & {schedule: NonNullable<DiagramServiceOptions['schedule']>};
  readonly counters = {renders: 0, dropped: 0, timeouts: 0, crashes: 0, opened: 0};

  constructor(options: DiagramServiceOptions) {
    this.options = {timeoutMs: 8000, settleMs: 250, idleMs: 60_000, cacheImages: 24, cacheBytes: 48 * 1024 * 1024, scale: 2, schedule: realSchedule, ...options};
  }

  get stats(): {renders: number; dropped: number; timeouts: number; crashes: number; opened: number; cachedImages: number; cacheBytes: number; documents: number; queued: number; rendererOpen: boolean} {
    let cachedImages = 0, cacheBytes = 0;
    for (const entry of this.entries.values()) if (entry.image) { cachedImages += 1; cacheBytes += entry.image.raster.data.length + (entry.png?.length ?? 0); }
    return {...this.counters, cachedImages, cacheBytes, documents: this.clients.size, queued: this.queue.length, rendererOpen: Boolean(this.renderer && !this.renderer.closed)};
  }

  attach(client: DiagramClient): void { this.clients.add(client); }

  detach(client: DiagramClient): void {
    this.clients.delete(client);
    if (this.clients.size) return;
    // Nobody shows a diagram: queued work is dropped and the page closes now (the browser stops on its own idle timer).
    this.queue = [];
    for (const [key, entry] of this.entries) if (entry.state === 'queued') this.entries.delete(key);
    this.settle?.cancel();
    this.settle = undefined;
    this.closeRenderer();
  }

  private wanted(key: string): boolean {
    for (const client of this.clients) if (client.wants(key)) return true;
    return false;
  }

  entry(key: string): DiagramEntry | undefined {
    const entry = this.entries.get(key);
    if (entry) entry.at = ++this.clock;
    return entry;
  }

  /** The entry for a diagram, queueing it when it is new. */
  request(key: string, source: string, config: Record<string, unknown>): DiagramEntry {
    const known = this.entry(key);
    if (known) return known;
    const entry: DiagramEntry = {key, source, config, state: 'queued', at: ++this.clock};
    this.entries.set(key, entry);
    this.queue.push(key);
    this.idle?.cancel();
    // Work waits for a pause in requests: a burst of edits is drawn once, as it ends.
    if (!this.working) {
      this.settle?.cancel();
      this.settle = this.options.schedule(() => { this.settle = undefined; void this.work(); }, this.options.settleMs);
    }
    return entry;
  }

  /** The person asked again: failures that might not happen this time (timeout, crash, nothing available) are forgotten. */
  retry(): void {
    for (const [key, entry] of this.entries) if (entry.state === 'failed' && TRANSIENT.has(entry.code)) this.entries.delete(key);
    this.library = undefined;
  }

  private notify(): void {
    for (const client of [...this.clients]) client.notify();
  }

  private fail(entry: DiagramEntry, code: DiagramEntry['code'], reason: string): void {
    entry.state = 'failed';
    entry.code = code;
    entry.reason = reason;
  }

  private async work(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const key = this.queue.shift()!;
        const entry = this.entries.get(key);
        if (!entry || entry.state !== 'queued') continue;
        if (!this.wanted(key)) { this.entries.delete(key); this.counters.dropped += 1; continue; }
        entry.state = 'drawing';
        await this.draw(entry);
        this.trim();
        if (this.clients.size) this.notify();
      }
    } finally {
      this.working = false;
      if (this.queue.length) void this.work();
      else this.armIdle();
    }
  }

  private async draw(entry: DiagramEntry): Promise<void> {
    const blocked = await this.options.backend.blocked().catch(error => error instanceof Error ? error.message : 'Diagrams cannot be drawn here.');
    if (blocked) { this.fail(entry, 'unavailable', blocked); return; }
    const renderer = await this.rendererNow();
    if (this.abandoned(entry)) return;
    if ('error' in renderer) { this.fail(entry, 'unavailable', renderer.error); return; }
    this.counters.renders += 1;
    const result = await renderer.render({source: entry.source, config: entry.config, scale: this.options.scale, timeoutMs: this.options.timeoutMs})
      .catch(error => ({ok: false as const, code: 'failed' as const, reason: error instanceof Error ? error.message : 'The diagram could not be drawn.'}));
    if (!result.ok && (result.code === 'timeout' || result.code === 'crashed' || renderer.closed)) this.closeRenderer();
    // Nobody shows it any more (the document closed or switched while it was drawing, which may also have closed the page): it is
    // forgotten, not failed, so the next document that shows the same text gets it drawn.
    if (this.abandoned(entry)) return;
    if (!result.ok) {
      if (result.code === 'timeout') this.counters.timeouts += 1;
      if (result.code === 'crashed') this.counters.crashes += 1;
      this.fail(entry, result.code, result.reason);
      return;
    }
    try {
      entry.image = await this.options.backend.decode(result.png, `Mermaid ${result.type}`, `diagram:${entry.key}`);
      entry.png = result.png;
      entry.type = result.type;
      entry.state = 'ready';
    } catch (error) {
      this.fail(entry, 'failed', error instanceof Error ? error.message : 'The drawing could not be read.');
    }
  }

  private abandoned(entry: DiagramEntry): boolean {
    if (this.wanted(entry.key)) return false;
    this.entries.delete(entry.key);
    this.counters.dropped += 1;
    return true;
  }

  private async rendererNow(): Promise<DiagramRenderer | {error: string}> {
    if (this.renderer && !this.renderer.closed) return this.renderer;
    this.renderer = undefined;
    this.opening ??= (async () => {
      this.library ??= this.options.backend.library();
      const library = await this.library.catch(error => ({ok: false as const, reason: error instanceof Error ? error.message : 'Mermaid could not be read.'}));
      if (!library.ok) { this.library = undefined; return {error: library.reason}; }
      try {
        const renderer = await this.options.backend.open({source: library.source, version: library.version});
        this.counters.opened += 1;
        return renderer;
      } catch (error) {
        return {error: error instanceof Error ? error.message : 'The diagram renderer could not start.'};
      }
    })().finally(() => { this.opening = undefined; });
    const opened = await this.opening;
    if (!('error' in opened)) {
      // Everyone left while it was opening: close it again at once.
      if (!this.clients.size) { void opened.close(); return {error: 'No document shows diagrams any more.'}; }
      this.renderer = opened;
    }
    return opened;
  }

  private armIdle(): void {
    this.idle?.cancel();
    if (!this.renderer) return;
    this.idle = this.options.schedule(() => { this.idle = undefined; if (!this.working) this.closeRenderer(); }, this.options.idleMs);
  }

  private closeRenderer(): void {
    this.idle?.cancel();
    this.idle = undefined;
    const renderer = this.renderer;
    this.renderer = undefined;
    if (renderer) void renderer.close().catch(() => undefined);
  }

  /** Forget the oldest drawings and failures beyond the bounds, never one an open document shows. */
  private trim(): void {
    const ready = [...this.entries.values()].filter(entry => entry.state === 'ready').sort((a, b) => a.at - b.at);
    let images = ready.length;
    const size = (entry: DiagramEntry) => (entry.image?.raster.data.length ?? 0) + (entry.png?.length ?? 0);
    let bytes = ready.reduce((sum, entry) => sum + size(entry), 0);
    for (const entry of ready) {
      if (images <= this.options.cacheImages && bytes <= this.options.cacheBytes) break;
      if (this.wanted(entry.key)) continue;
      this.entries.delete(entry.key);
      images -= 1;
      bytes -= size(entry);
    }
    const failed = [...this.entries.values()].filter(entry => entry.state === 'failed').sort((a, b) => a.at - b.at);
    for (const entry of failed.slice(0, Math.max(0, failed.length - MAX_FAILURES))) this.entries.delete(entry.key);
  }

  /** NMSh is exiting or the person turned diagrams off: drop everything. */
  dispose(): void {
    this.queue = [];
    this.entries.clear();
    this.settle?.cancel();
    this.closeRenderer();
  }
}
