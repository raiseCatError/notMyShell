import fs from 'node:fs/promises';
import path from 'node:path';
import {displayWidth, truncateText} from '../util/text.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {createImageOverlay, iterm2Image, kittyDelete, kittyTransmit, type ImageOverlay} from '../presentation/ImageSurface.js';
import type {GraphicsDecision} from './capabilities.js';
import {decodeImage, readImageFile} from './decode.js';
import {PLACEHOLDER_ID_BASE, PLACEHOLDER_ID_LIMIT, kittyDeleteImage, kittyVirtualPlacement, placeholderRows, MAX_PLACEHOLDER_SPAN} from './kittyPlaceholder.js';
import {encodePng} from './pngEncode.js';
import {ImageError, type ImageInfo, type Raster} from './raster.js';
import {fitCells, scaleBox} from './scale.js';
import {encodeSixel} from './sixel.js';
import {FrameStream} from './stream.js';
import {renderCells} from './unicode.js';

/**
 * NMSh's one graphics service. Every surface that shows an actual image (the viewer, Markdown and HTML documents, the
 * browser's page frames) asks this service and nothing else; no surface decodes, scales, encodes, numbers, uploads,
 * places, resizes, caches or deletes an image itself. Menus, text and selection controls are never images.
 *
 *   load(path)       -> a decoded, bounded `LoadedImage` (cached; remote and unsafe references are refused)
 *   place(image, box) -> a `Placement`: text rows to draw in the flow (Kitty Unicode placeholders, or character art), or a
 *                       protocol overlay for iTerm2/Sixel on a surface the app positions
 *   release*()       -> deletes what was uploaded to the terminal; called when a surface closes, when a program takes the
 *                       screen and when NMSh exits, so no image outlives its owner
 *
 * Resource policy: file size, pixel count and inflation are bounded by the decoders; the cache holds at most
 * `cacheBytes` of decoded pixels (six images by default); the terminal holds at most `uploadBytes` of uploaded data and
 * the oldest upload is deleted first; stored images are reduced to at most `storeLongSide` pixels.
 */
export interface GraphicsHost {
  decision(): GraphicsDecision;
  /** Raw terminal bytes (an upload or a delete). Nothing may be written while a program owns the screen. */
  send(data: string): void;
  /** A private directory for converters (WebP). */
  scratchDir(): string;
  color(): ColorLevel;
  safeGlyphs(): boolean;
}

export interface GraphicsLimits {
  cacheBytes: number;
  cacheImages: number;
  uploadBytes: number;
  storeLongSide: number;
  /** The longest side, in pixels, of anything uploaded for a placement. */
  uploadLongSide: number;
}

export const DEFAULT_LIMITS: GraphicsLimits = {cacheBytes: 48 * 1024 * 1024, cacheImages: 6, uploadBytes: 32 * 1024 * 1024, storeLongSide: 1920, uploadLongSide: 2048};

export interface LoadedImage {
  /** Stable for the life of the cache entry. */
  key: string;
  name: string;
  path: string;
  info: ImageInfo;
  /** Reduced to `storeLongSide`; `info` has the file's own size. */
  raster: Raster;
  fileBytes: number;
}

export type PlacementKind = 'kitty-placeholder' | 'character-art' | 'overlay' | 'text';

export interface PlacementOverlay {
  key: string;
  size: {columns: number; rows: number};
  transmit: string;
  place: string;
  cleanup: string;
}

export interface Placement {
  kind: PlacementKind;
  /** The cells it occupies (an overlay is placed by the app at a screen cell). */
  columns: number;
  rows: number;
  /** Text rows, exactly `rows` of them, each `columns` cells wide (blank for an overlay). */
  lines: string[];
  overlay?: PlacementOverlay;
  owner: unknown;
  /** Identifies the upload behind it (Kitty placeholders), for `keepOnly`. */
  key?: string;
}

export interface PlaceRequest {
  columns: number;
  rows: number;
  /** Who is showing this: released together with `releaseOwner`. */
  owner: unknown;
  /** `viewer` may use an overlay protocol; `inline` is always text cells. */
  surface: 'inline' | 'viewer';
  /** A region of the image to show (fractions 0..1), for zoom and pan. */
  crop?: {x: number; y: number; width: number; height: number};
  /** Allow the image to be shown larger than its own pixel size. */
  upscale?: boolean;
}

interface Upload {
  id: number;
  bytes: number;
  owners: Set<unknown>;
  at: number;
}

export class GraphicsService {
  private readonly cache = new Map<string, LoadedImage>();
  private cacheSize = 0;
  private uploads = new Map<string, Upload>();
  private uploadSize = 0;
  private nextId = PLACEHOLDER_ID_BASE;
  private clock = 0;
  private readonly limits: GraphicsLimits;

  constructor(private readonly host: GraphicsHost, limits: Partial<GraphicsLimits> = {}) {
    this.limits = {...DEFAULT_LIMITS, ...limits};
  }

  // ---- loading ------------------------------------------------------------------------------------------------

  /**
   * Resolve an image reference found in a document. Remote and `data:` references are never fetched; an absolute or
   * relative path must resolve (symlinks included) inside `root`. The result is the real path, or an `unsafe` error saying why.
   */
  static async resolveReference(reference: string, base: string, root: string): Promise<string> {
    const trimmed = reference.trim();
    if (!trimmed) throw new ImageError('unsafe', 'The image has no source.');
    if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed) && !/^[a-z]:[\\/]/iu.test(trimmed)) {
      throw new ImageError('unsafe', /^https?:/iu.test(trimmed) ? 'Remote images are never fetched automatically.' : 'Only local image files are shown.');
    }
    let decoded = trimmed;
    try { decoded = decodeURI(trimmed); } catch { /* keep the literal text */ }
    // Network-style and malformed paths are refused before any filesystem call (a UNC-style path would otherwise be probed).
    for (const text of [trimmed, decoded]) {
      if (text.includes('\0') || text.startsWith('//') || text.startsWith('\\') || /^[\\/]{2}/u.test(text)) throw new ImageError('unsafe', 'The image path is not valid.');
    }
    const outside = () => new ImageError('unsafe', 'The image lies outside this document\'s folder or project, so it is not shown.');
    const inside = (target: string, within: string): boolean => {
      const relative = path.relative(within, target);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    };
    const candidate = path.resolve(base, decoded.split(/[?#]/u)[0]!);
    // Lexical containment first, so whether a path outside the root exists is never revealed; then again on the real path.
    const lexicalRoot = path.resolve(root);
    const realRoot = await fs.realpath(root).catch(() => lexicalRoot);
    if (!inside(candidate, lexicalRoot) && !inside(candidate, realRoot)) throw outside();
    let real: string;
    try { real = await fs.realpath(candidate); }
    catch { throw new ImageError('unavailable', 'The image file was not found.'); }
    if (!inside(real, realRoot)) throw outside();
    return real;
  }

  async load(realPath: string, signal?: AbortSignal): Promise<LoadedImage> {
    const stat = await fs.stat(realPath).catch(() => undefined);
    if (!stat) throw new ImageError('unavailable', 'The image file was not found.');
    const key = `${realPath}\0${stat.mtimeMs}\0${stat.size}`;
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return hit; }
    const {bytes} = await readImageFile(realPath);
    const {info, raster} = await decodeImage(bytes, {scratchDir: this.host.scratchDir(), ...(signal ? {signal} : {})});
    const longest = Math.max(raster.width, raster.height);
    const stored = longest > this.limits.storeLongSide
      ? scaleBox(raster, Math.max(1, Math.round((raster.width * this.limits.storeLongSide) / longest)), Math.max(1, Math.round((raster.height * this.limits.storeLongSide) / longest)))
      : raster;
    const image: LoadedImage = {key, name: safeName(path.basename(realPath)), path: realPath, info, raster: stored, fileBytes: stat.size};
    this.remember(image);
    return image;
  }

  private remember(image: LoadedImage): void {
    const size = image.raster.data.length;
    this.cache.set(image.key, image);
    this.cacheSize += size;
    while ((this.cacheSize > this.limits.cacheBytes || this.cache.size > this.limits.cacheImages) && this.cache.size > 1) {
      const oldest = this.cache.keys().next().value as string;
      const gone = this.cache.get(oldest)!;
      this.cache.delete(oldest);
      this.cacheSize -= gone.raster.data.length;
    }
  }

  // ---- placing ------------------------------------------------------------------------------------------------

  place(image: LoadedImage, request: PlaceRequest): Placement {
    const decision = this.host.decision();
    const source = request.crop ? cropRaster(image.raster, request.crop) : image.raster;
    const cell = decision.cell;
    const natural = {columns: Math.max(1, Math.ceil(source.width / cell.width)), rows: Math.max(1, Math.ceil(source.height / cell.height))};
    const limit = {
      columns: Math.max(1, Math.min(request.columns, MAX_PLACEHOLDER_SPAN)),
      rows: Math.max(1, Math.min(request.rows, MAX_PLACEHOLDER_SPAN)),
    };
    const fit = fitCells(source.width, source.height, limit.columns, limit.rows, cell, Boolean(request.upscale));
    const box = {columns: Math.min(fit.columns, request.upscale ? fit.columns : Math.max(natural.columns, 1)), rows: Math.min(fit.rows, request.upscale ? fit.rows : Math.max(natural.rows, 1))};
    const mode = decision.backend;
    const useText = request.surface === 'inline' || decision.inline === 'placeholder';

    if (mode === 'off') return this.textPlacement(image, limit, request.owner);
    if (mode === 'kitty' && useText && decision.inline === 'placeholder') return this.kittyPlacement(image, source, box, cell, request);
    if (request.surface === 'viewer' && (mode === 'kitty' || mode === 'iterm2' || mode === 'sixel')) return this.overlayPlacement(image, source, box, cell, request, mode);
    return this.artPlacement(image, source, box, request.owner);
  }

  private artPlacement(image: LoadedImage, source: Raster, box: {columns: number; rows: number}, owner: unknown): Placement {
    const decision = this.host.decision();
    const art = renderCells(source, {columns: box.columns, rows: box.rows, mode: decision.unicode === 'ascii' ? 'ascii' : decision.unicode, color: this.host.color(), safe: this.host.safeGlyphs()});
    void image;
    return {kind: 'character-art', columns: art.columns, rows: art.height, lines: art.rows, owner};
  }

  private textPlacement(image: LoadedImage, box: {columns: number; rows: number}, owner: unknown): Placement {
    const label = `[image: ${image.name}]`;
    return {kind: 'text', columns: Math.min(box.columns, displayWidth(label)), rows: 1, lines: [truncateText(label, Math.max(4, box.columns))], owner};
  }

  private kittyPlacement(image: LoadedImage, source: Raster, box: {columns: number; rows: number}, cell: {width: number; height: number}, request: PlaceRequest): Placement {
    const key = `${image.key}|${cropKey(request.crop)}|${box.columns}x${box.rows}|${cell.width}x${cell.height}`;
    let upload = this.uploads.get(key);
    if (!upload) {
      const target = this.uploadSize_(source, box, cell);
      const png = encodePng(scaleBox(source, target.width, target.height), {level: 3});
      const id = this.allocateId();
      this.makeRoom(png.length);
      this.host.send(`${kittyTransmit(png, id)}${kittyVirtualPlacement(id, box.columns, box.rows)}`);
      upload = {id, bytes: png.length, owners: new Set(), at: 0};
      this.uploads.set(key, upload);
      this.uploadSize += png.length;
    }
    upload.owners.add(request.owner);
    upload.at = ++this.clock;
    return {kind: 'kitty-placeholder', columns: box.columns, rows: box.rows, lines: placeholderRows(upload.id, box.columns, box.rows), owner: request.owner, key};
  }

  private overlayPlacement(image: LoadedImage, source: Raster, box: {columns: number; rows: number}, cell: {width: number; height: number}, request: PlaceRequest, mode: 'kitty' | 'iterm2' | 'sixel'): Placement {
    const target = this.uploadSize_(source, box, cell);
    const scaled = scaleBox(source, target.width, target.height);
    const key = `${image.key}|${cropKey(request.crop)}|${box.columns}x${box.rows}|${mode}`;
    let overlay: PlacementOverlay | undefined;
    if (mode === 'sixel') {
      const stream = encodeSixel(scaled, {maxColors: 256, dither: 'none'});
      overlay = {key, size: box, transmit: '', place: stream, cleanup: ''};
    } else {
      const png = encodePng(scaled, {level: 3});
      const made: ImageOverlay | undefined = createImageOverlay(mode, png, key, 0, 0, box);
      if (made) overlay = {key, size: box, transmit: made.transmit, place: made.place, cleanup: made.cleanup};
      else overlay = {key, size: box, transmit: '', place: iterm2Image(png, box, image.name), cleanup: ''};
    }
    return {kind: 'overlay', columns: box.columns, rows: box.rows, lines: Array<string>(box.rows).fill(' '.repeat(box.columns)), overlay, owner: request.owner};
  }

  /** The pixel size to upload for a cell box: the box at the terminal's cell size, never above the source or the upload cap. */
  private uploadSize_(source: Raster, box: {columns: number; rows: number}, cell: {width: number; height: number}): {width: number; height: number} {
    let width = Math.min(source.width, box.columns * cell.width);
    let height = Math.min(source.height, box.rows * cell.height);
    const longest = Math.max(width, height);
    if (longest > this.limits.uploadLongSide) {
      width = Math.max(1, Math.round((width * this.limits.uploadLongSide) / longest));
      height = Math.max(1, Math.round((height * this.limits.uploadLongSide) / longest));
    }
    return {width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height))};
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------------

  private allocateId(): number {
    this.nextId += 1;
    if (this.nextId > PLACEHOLDER_ID_LIMIT) this.nextId = PLACEHOLDER_ID_BASE + 1;
    return this.nextId;
  }

  /** Delete the oldest uploads until `incoming` bytes fit under the cap. */
  private makeRoom(incoming: number): void {
    while (this.uploadSize + incoming > this.limits.uploadBytes && this.uploads.size) {
      let oldestKey: string | undefined;
      let oldest = Infinity;
      for (const [key, upload] of this.uploads) if (upload.at < oldest) { oldest = upload.at; oldestKey = key; }
      if (oldestKey === undefined) break;
      this.drop(oldestKey);
    }
  }

  private drop(key: string): void {
    const upload = this.uploads.get(key);
    if (!upload) return;
    this.uploads.delete(key);
    this.uploadSize -= upload.bytes;
    this.host.send(kittyDeleteImage(upload.id));
  }

  /** Everything one surface showed: deleted from the terminal unless another owner still shows it. */
  releaseOwner(owner: unknown): void {
    for (const [key, upload] of [...this.uploads]) {
      upload.owners.delete(owner);
      if (upload.owners.size === 0) this.drop(key);
    }
  }

  /** An owner that redraws (zoom, pan, resize) keeps only the uploads its current placements use; the rest are deleted now. */
  keepOnly(owner: unknown, keys: readonly string[]): void {
    const keep = new Set(keys);
    for (const [key, upload] of [...this.uploads]) {
      if (!upload.owners.has(owner) || keep.has(key)) continue;
      upload.owners.delete(owner);
      if (upload.owners.size === 0) this.drop(key);
    }
  }

  /** The terminal's images are gone (a program took the screen, or NMSh is exiting): forget and delete all. */
  releaseAll(): void {
    for (const key of [...this.uploads.keys()]) this.drop(key);
    this.uploads.clear();
    this.uploadSize = 0;
  }

  /** A fullscreen program cleared the screen on its own: the terminal-side images are gone, so forget them without deleting twice. */
  forgetUploads(): void {
    this.uploads.clear();
    this.uploadSize = 0;
  }

  /**
   * A stream for live frames (a browser page): it uploads through this service's host and id allocator and deletes its own
   * pictures on `dispose()`. `owner` is only for the caller's bookkeeping; the stream owns what it uploads. After `releaseAll`
   * or `forgetUploads` a stream's pictures are gone: call `stream.forget()` so its next frame uploads again.
   */
  openStream(owner: unknown): FrameStream {
    void owner;
    return new FrameStream({
      decision: () => this.host.decision(),
      send: data => this.host.send(data),
      allocateId: () => this.allocateId(),
      color: () => this.host.color(),
      safeGlyphs: () => this.host.safeGlyphs(),
    });
  }

  clearCache(): void { this.cache.clear(); this.cacheSize = 0; }

  stats(): {cached: number; cacheBytes: number; uploads: number; uploadBytes: number} {
    return {cached: this.cache.size, cacheBytes: this.cacheSize, uploads: this.uploads.size, uploadBytes: this.uploadSize};
  }
}

/** A file name made safe to draw: control, format and separator characters (an escape in a name!) become marks. */
export function safeName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu, character => (character === '\u001b' ? '␛' : '·')).slice(0, 200);
}

function cropKey(crop: PlaceRequest['crop']): string {
  return crop ? `${crop.x.toFixed(4)},${crop.y.toFixed(4)},${crop.width.toFixed(4)},${crop.height.toFixed(4)}` : 'full';
}

/** A region (fractions of the image) as its own raster; clamped, at least one pixel. */
export function cropRaster(source: Raster, crop: NonNullable<PlaceRequest['crop']>): Raster {
  const x = Math.max(0, Math.min(source.width - 1, Math.floor(crop.x * source.width)));
  const y = Math.max(0, Math.min(source.height - 1, Math.floor(crop.y * source.height)));
  const width = Math.max(1, Math.min(source.width - x, Math.round(crop.width * source.width)));
  const height = Math.max(1, Math.min(source.height - y, Math.round(crop.height * source.height)));
  if (x === 0 && y === 0 && width === source.width && height === source.height) return source;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * source.width + x) * 4;
    data.set(source.data.subarray(from, from + width * 4), row * width * 4);
  }
  return {width, height, data};
}

export { kittyDelete };
