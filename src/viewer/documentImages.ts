import fs from 'node:fs/promises';
import path from 'node:path';
import type {GraphicsService, LoadedImage} from '../graphics/service.js';
import {GraphicsService as Service} from '../graphics/service.js';
import {ImageError} from '../graphics/raster.js';
import type {ImageProvider, ImageSlot} from '../markdown/render.js';
import {renderHtml, renderMarkdown} from '../markdown/render.js';
import type {ViewDocument} from './document.js';

/**
 * The images of one open document. It is the renderer's `ImageProvider`, and the only thing that connects a Markdown or HTML
 * document to the graphics service:
 *
 *  - references are found by rendering the document once with a collecting provider (the same parser the viewer uses);
 *  - each is resolved relative to the document and must stay inside the document's folder, or its git project if it has
 *    one (`GraphicsService.resolveReference`); remote, `data:` and escaping references are never read;
 *  - loading is bounded (`MAX_IMAGES` per document, a few at a time, a deadline before the viewer opens, the rest later);
 *  - placements belong to this object, so closing the document releases everything uploaded for it.
 */
export const MAX_IMAGES = 24;
const CONCURRENCY = 3;

type Entry = {
  index: number;
  src: string;
  alt: string;
  state: 'pending' | 'loading' | 'ready' | 'failed';
  image?: LoadedImage;
  note?: string;
  path?: string;
};

export class DocumentImages implements ImageProvider {
  private readonly entries = new Map<string, Entry>();
  private collecting = false;
  private closed = false;
  /** Bumped whenever an image finishes, so the viewer draws the document again. */
  version = 0;

  constructor(private readonly service: GraphicsService, private readonly base: string, private readonly root: string, private readonly changed: () => void = () => {}) {}

  get count(): number { return this.entries.size; }

  /** The images in order of first appearance, with their files (for the image viewer's list). */
  list(): Array<{index: number; src: string; alt: string; ready: boolean; path?: string; note?: string}> {
    return [...this.entries.values()].map(entry => ({index: entry.index, src: entry.src, alt: entry.alt, ready: entry.state === 'ready', ...(entry.path ? {path: entry.path} : {}), ...(entry.note ? {note: entry.note} : {})}));
  }

  slot(src: string, alt: string): ImageSlot | undefined {
    let entry = this.entries.get(src);
    if (!entry) {
      if (this.entries.size >= MAX_IMAGES) return undefined;
      entry = {index: this.entries.size, src, alt, state: 'pending'};
      this.entries.set(src, entry);
    }
    const current = entry;
    return {
      index: current.index,
      ...(current.state !== 'ready' && current.note ? {note: current.note} : {}),
      place: (columns, maxRows) => {
        if (this.collecting || current.state !== 'ready' || !current.image || this.closed) return undefined;
        const placement = this.service.place(current.image, {columns, rows: maxRows, owner: this, surface: 'inline'});
        return placement.kind === 'text' ? undefined : {lines: placement.lines, columns: placement.columns, rows: placement.rows};
      },
    };
  }

  /** Find every image reference of a Markdown or HTML document. */
  collect(document: ViewDocument): void {
    if (document.format !== 'markdown' && document.format !== 'html') return;
    this.collecting = true;
    try {
      if (document.format === 'html') renderHtml(document.text, 80, {images: this});
      else renderMarkdown(document.text, 80, {images: this, html: true});
    } finally { this.collecting = false; }
  }

  /** Resolve and load the references, a few at a time, until done or `deadlineMs` has passed (the rest finish later). */
  async load(deadlineMs: number): Promise<void> {
    const pending = [...this.entries.values()].filter(entry => entry.state === 'pending');
    let next = 0;
    const work = async () => {
      while (next < pending.length && !this.closed) {
        const entry = pending[next++]!;
        entry.state = 'loading';
        entry.note = 'loading…';
        try {
          const real = await Service.resolveReference(entry.src, this.base, this.root);
          entry.path = real;
          entry.image = await this.service.load(real);
          entry.state = 'ready';
          delete entry.note;
        } catch (error) {
          entry.state = 'failed';
          entry.note = error instanceof ImageError ? shortReason(error) : 'could not be read';
        }
        if (!this.closed) { this.version += 1; if (deadlineMs <= 0) this.changed(); }
      }
    };
    const all = Promise.all(Array.from({length: Math.min(CONCURRENCY, pending.length)}, work));
    if (deadlineMs > 0) {
      await Promise.race([all, new Promise<void>(done => { setTimeout(done, deadlineMs).unref?.(); })]);
      // Whatever is still loading finishes after the viewer opens, and then asks for a redraw.
      void all.then(() => { if (!this.closed) { this.version += 1; this.changed(); } });
    } else await all;
    this.version += 1;
  }

  /** The loaded image for the image viewer, loading it if it has not been yet. */
  async image(index: number): Promise<LoadedImage | undefined> {
    const entry = [...this.entries.values()].find(item => item.index === index);
    if (!entry) return undefined;
    if (entry.state === 'ready') return entry.image;
    if (entry.state === 'failed' && !entry.path) return undefined;
    try {
      const real = entry.path ?? await Service.resolveReference(entry.src, this.base, this.root);
      entry.path = real;
      entry.image = await this.service.load(real);
      entry.state = 'ready';
      return entry.image;
    } catch { return undefined; }
  }

  close(): void {
    this.closed = true;
    this.service.releaseOwner(this);
  }
}

function shortReason(error: ImageError): string {
  if (error.code === 'unsafe') return /Remote/u.test(error.message) ? 'remote images are not fetched' : /outside/u.test(error.message) ? 'outside this folder, not shown' : 'not shown';
  if (error.code === 'unavailable') return /not found/u.test(error.message) ? 'file not found' : 'not available';
  if (error.code === 'unsupported') return /SVG/u.test(error.message) ? 'SVG is not drawn' : 'unsupported format';
  if (error.code === 'too-large') return 'too large to show';
  return 'could not be shown';
}

/** The folder an image may come from: the document's git project when it has one (within a few levels), else its own folder. */
export async function documentRoot(documentDirectory: string): Promise<string> {
  let directory = documentDirectory;
  for (let level = 0; level < 12; level += 1) {
    if (await fs.stat(path.join(directory, '.git')).then(() => true, () => false)) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return documentDirectory;
}
