import type {ColorLevel} from '../presentation/capabilities.js';
import {kittyTransmit} from '../presentation/ImageSurface.js';
import type {GraphicsDecision} from './capabilities.js';
import {MAX_PLACEHOLDER_SPAN, kittyDeleteImage, kittyVirtualPlacement, placeholderRows} from './kittyPlaceholder.js';
import {decodePng} from './png.js';
import type {Raster} from './raster.js';
import {renderCells} from './unicode.js';

/**
 * Live frames: a surface whose picture changes while it is shown (a browser page; video later). A `FrameStream` turns each new
 * PNG into rows of text for one cell box, through the same two routes the still-image service uses:
 *
 *   Kitty placeholders (`decision.inline === 'placeholder'`): the PNG is uploaded under one of two alternating image ids with a
 *     virtual placement, and the rows name that id. The id shown before it is deleted one update later, so the terminal never
 *     shows both and never keeps a stale image; `settle()` deletes the last one once nothing newer is coming.
 *   Character art (everything else): the PNG is decoded and drawn with `renderCells`, at a lower rate.
 *
 * Frames are dropped, never queued: identical frames cost nothing, a frame that arrives before the minimum interval is skipped
 * (the previous rows stay), and the interval backs off while uploads are large or the previous write had not drained. Nothing
 * here writes to the terminal except through `host.send`, which the graphics service already withholds while a program owns
 * the screen. Everything is bounded: a PNG over 16 MB is skipped, and a box is clamped to the placeholder span.
 */
export interface StreamHost {
  decision(): GraphicsDecision;
  send(data: string): void;
  /** A fresh Kitty image id (the graphics service's own allocator). */
  allocateId(): number;
  color(): ColorLevel;
  safeGlyphs(): boolean;
  /** Optional: false while the terminal connection has not drained the previous write (the interval then backs off). */
  drained?(): boolean;
  now?(): number;
}

export interface StreamFrame {
  png: Uint8Array;
  width: number;
  height: number;
}

export interface StreamBox {
  columns: number;
  rows: number;
}

export interface StreamOutput {
  /** Exactly `box.rows` rows (clamped), each `box.columns` cells wide. */
  lines: string[];
  kind: 'kitty-placeholder' | 'character-art';
  /** The frame was not drawn (identical, too soon, too large, undecodable); `lines` still show the last picture. */
  skipped: boolean;
  /** Why a frame was refused, when that is worth telling the person. */
  note?: string;
}

export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const KITTY_MIN_INTERVAL = 66;
const KITTY_MAX_INTERVAL = 1000;
const UNICODE_MIN_INTERVAL = 125;
/** Bytes per millisecond the terminal link is assumed to take (about 4 MB/s): a large upload spaces the next one. */
const ASSUMED_THROUGHPUT = 4096;

export class FrameStream {
  private readonly ids: number[] = [];
  private current: number | undefined;
  private retired: number[] = [];
  private hash = 0;
  private length = -1;
  private box: StreamBox = {columns: 0, rows: 0};
  private lines: string[] = [];
  private interval = KITTY_MIN_INTERVAL;
  private nextAllowed = 0;
  private raster: Raster | undefined;
  private disposed = false;
  private route: 'kitty-placeholder' | 'character-art' | undefined;

  constructor(private readonly host: StreamHost) {}

  private now(): number { return this.host.now ? this.host.now() : performance.now(); }

  /** Milliseconds until another frame would be accepted: a consumer may wait this long before offering the next one. */
  retryAfter(): number { return Math.max(0, Math.ceil(this.nextAllowed - this.now())); }

  update(frame: StreamFrame, requested: StreamBox): StreamOutput {
    const box = {
      columns: clamp(requested.columns), rows: clamp(requested.rows),
    };
    const decision = this.host.decision();
    const kitty = decision.inline === 'placeholder';
    const kind = kitty ? 'kitty-placeholder' : 'character-art';
    if (this.disposed) return {lines: blank(box), kind, skipped: true};
    if (this.route && this.route !== kind) this.forget(); // the decision changed (a setting): start over on the other route
    this.route = kind;
    if (decision.inline === 'none') {
      this.box = box;
      return {lines: blank(box), kind: 'character-art', skipped: true, note: 'Graphics are off, so the page cannot be shown.'};
    }
    if (frame.png.length > MAX_FRAME_BYTES) return this.skip(box, kind, 'The page frame is too large to show.');
    return kitty ? this.kitty(frame, box) : this.art(frame, box, decision);
  }

  // ---- Kitty placeholders ----------------------------------------------------------------------------------------

  private kitty(frame: StreamFrame, box: StreamBox): StreamOutput {
    const hash = fnv(frame.png);
    const same = hash === this.hash && frame.png.length === this.length && this.current !== undefined;
    const resized = box.columns !== this.box.columns || box.rows !== this.box.rows;
    if (same) {
      // The picture is already in the terminal; a different box only needs its placement restated.
      if (resized) this.restate(box);
      return {lines: this.lines, kind: 'kitty-placeholder', skipped: true};
    }
    const now = this.now();
    if (now < this.nextAllowed && this.current !== undefined) {
      if (resized) this.restate(box);
      return {lines: this.lines, kind: 'kitty-placeholder', skipped: true};
    }
    const backlog = this.host.drained ? !this.host.drained() : false;
    if (backlog && this.current !== undefined) {
      this.interval = Math.min(KITTY_MAX_INTERVAL, this.interval * 2);
      this.nextAllowed = now + this.interval;
      return {lines: this.lines, kind: 'kitty-placeholder', skipped: true};
    }
    // The id shown two uploads ago is deleted now: it was replaced a whole frame ago.
    const deletes = this.retired.map(kittyDeleteImage).join('');
    this.retired = [];
    const id = this.nextId();
    const previous = this.current;
    let data: string;
    try { data = `${kittyTransmit(frame.png, id)}${kittyVirtualPlacement(id, box.columns, box.rows)}`; }
    catch { return this.skip(box, 'kitty-placeholder', 'The page frame could not be sent.'); }
    this.host.send(`${deletes}${data}`);
    if (previous !== undefined) this.retired.push(previous);
    this.current = id;
    this.hash = hash;
    this.length = frame.png.length;
    this.box = box;
    this.lines = placeholderRows(id, box.columns, box.rows);
    this.interval = Math.max(KITTY_MIN_INTERVAL, Math.floor(this.interval * 0.75));
    this.nextAllowed = now + Math.max(this.interval, data.length / ASSUMED_THROUGHPUT);
    return {lines: this.lines, kind: 'kitty-placeholder', skipped: false};
  }

  private restate(box: StreamBox): void {
    if (this.current === undefined) return;
    this.host.send(kittyVirtualPlacement(this.current, box.columns, box.rows));
    this.box = box;
    this.lines = placeholderRows(this.current, box.columns, box.rows);
  }

  private nextId(): number {
    while (this.ids.length < 2) this.ids.push(this.host.allocateId());
    return this.ids[0] === this.current ? this.ids[1]! : this.ids[0]!;
  }

  /** Delete the picture shown before the current one. Call once a frame has been painted and nothing newer is due. */
  settle(): void {
    if (!this.retired.length) return;
    this.host.send(this.retired.map(kittyDeleteImage).join(''));
    this.retired = [];
  }

  /** The terminal lost its images (a program took the screen): forget them without deleting, so the next frame uploads again. */
  forget(): void {
    this.current = undefined;
    this.retired = [];
    this.hash = 0;
    this.length = -1;
    this.lines = [];
    this.raster = undefined;
    this.nextAllowed = 0;
  }

  // ---- character art ---------------------------------------------------------------------------------------------

  private art(frame: StreamFrame, box: StreamBox, decision: GraphicsDecision): StreamOutput {
    const hash = fnv(frame.png);
    const same = hash === this.hash && frame.png.length === this.length && this.raster !== undefined;
    const resized = box.columns !== this.box.columns || box.rows !== this.box.rows;
    const now = this.now();
    if (same && !resized) return {lines: this.lines, kind: 'character-art', skipped: true};
    if (!same && now < this.nextAllowed && this.lines.length) return {lines: this.lines, kind: 'character-art', skipped: true};
    let raster = this.raster;
    if (!same) {
      try { raster = decodePng(frame.png); }
      catch { return this.skip(box, 'character-art', 'The page frame could not be read.'); }
    }
    if (!raster) return this.skip(box, 'character-art', 'The page frame could not be read.');
    const start = this.now();
    let art;
    try { art = renderCells(raster, {columns: box.columns, rows: box.rows, mode: decision.unicode === 'ascii' ? 'ascii' : decision.unicode, color: this.host.color(), safe: this.host.safeGlyphs()}); }
    catch { return this.skip(box, 'character-art', 'The page frame could not be drawn.'); }
    const end = this.now();
    this.raster = raster;
    this.hash = hash;
    this.length = frame.png.length;
    this.box = box;
    this.lines = fit(art.rows, art.columns, box);
    // A render that took longer than the interval pushes the next one out by as much, so a slow terminal falls behind by dropping.
    this.nextAllowed = end + Math.max(UNICODE_MIN_INTERVAL, end - start);
    return {lines: this.lines, kind: 'character-art', skipped: false};
  }

  private skip(box: StreamBox, kind: StreamOutput['kind'], note: string): StreamOutput {
    const lines = this.lines.length === box.rows && this.box.columns === box.columns ? this.lines : blank(box);
    return {lines, kind, skipped: true, note};
  }

  /** Delete every picture this stream put in the terminal. Safe to repeat; later updates draw nothing. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const ids = new Set<number>([...this.retired, ...(this.current === undefined ? [] : [this.current])]);
    if (ids.size && this.route === 'kitty-placeholder') this.host.send([...ids].map(kittyDeleteImage).join(''));
    this.current = undefined;
    this.retired = [];
    this.raster = undefined;
    this.lines = [];
  }
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(MAX_PLACEHOLDER_SPAN, Math.floor(value))) : 1;
}

function blank(box: StreamBox): string[] {
  return Array.from({length: box.rows}, () => ' '.repeat(box.columns));
}

/** Art rows padded to exactly the box (the art keeps the picture's aspect inside it). */
function fit(rows: readonly string[], width: number, box: StreamBox): string[] {
  const out: string[] = [];
  for (const row of rows.slice(0, box.rows)) out.push(width >= box.columns ? row : `${row}${' '.repeat(box.columns - width)}`);
  while (out.length < box.rows) out.push(' '.repeat(box.columns));
  return out;
}

/** FNV-1a over the bytes: cheap, and enough to tell an unchanged frame from a changed one. */
function fnv(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
