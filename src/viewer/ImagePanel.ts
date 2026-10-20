import fs from 'node:fs/promises';
import path from 'node:path';
import type {Key} from '../terminal/keys.js';
import {renderControlRows} from '../ui/controls.js';
import {framePanel} from '../ui/PanelShell.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';
import type {GraphicsService, LoadedImage, Placement, PlacementOverlay} from '../graphics/service.js';
import {formatBytes, inert} from './document.js';
import type {ViewerState} from './ViewerPanel.js';

/**
 * The image viewer: one image in the viewer's own frame, header and controls, never a separate UI. It shows the image fitted
 * to the panel with its aspect ratio kept, zooms (fit, 150%, 200%, 300%, 400%), pans when zoomed, and steps through the images
 * beside it (the folder's, or the document's own). It asks the graphics service for every placement, so Kitty
 * placeholders, an iTerm2 or Sixel overlay, or character art is chosen in one place, and a resize simply asks again.
 * Esc returns to where it was opened from (the document, with its scroll position, or the shell).
 */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
export const MAX_SIBLINGS = 500;
const ZOOMS = [1, 1.5, 2, 3, 4] as const;
const PAN_STEP = 0.1;

export interface ImageEntry {
  path: string;
  name: string;
  /** From a document: its alt text. */
  alt?: string;
}

export interface ImageViewState {
  entries: ImageEntry[];
  index: number;
  image?: LoadedImage;
  /** The failure for the current entry, said plainly. */
  error?: string;
  loading: boolean;
  zoom: number;
  /** The center of the shown region, as fractions of the image. */
  pan: {x: number; y: number};
  /** Where Esc returns to: the document this image was opened from. */
  returnTo?: ViewerState;
  note?: string;
  /** The owner of this viewer's placements. */
  readonly owner: object;
  /** The last placement's overlay, positioned in the panel rows, for the app to hand to the renderer. */
  overlay?: {y: number; x: number; placement: PlacementOverlay};
}

export type ImageViewAction =
  | {kind: 'close'}
  | {kind: 'load'; index: number}
  | {kind: 'copy'; text: string; label: string};

export function createImageView(entries: ImageEntry[], index: number, options: {returnTo?: ViewerState} = {}): ImageViewState {
  return {entries, index: Math.max(0, Math.min(index, entries.length - 1)), loading: true, zoom: 1, pan: {x: 0.5, y: 0.5}, owner: {}, ...(options.returnTo ? {returnTo: options.returnTo} : {})};
}

/** The images beside a file: regular image files of its folder, naturally sorted, bounded. Symlinks are not followed. */
export async function siblingImages(file: string): Promise<{entries: ImageEntry[]; index: number}> {
  const directory = path.dirname(file);
  let names: string[] = [];
  try {
    const found = await fs.readdir(directory, {withFileTypes: true});
    names = found.filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).slice(1).toLowerCase())).map(entry => entry.name);
  } catch { /* an unreadable folder shows just the one image */ }
  names.sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
  names = names.slice(0, MAX_SIBLINGS);
  const own = path.basename(file);
  if (!names.includes(own)) names.unshift(own);
  return {entries: names.map(name => ({path: path.join(directory, name), name})), index: names.indexOf(own)};
}

export function imageViewKey(state: ImageViewState, key: Key): ImageViewAction | undefined {
  state.note = undefined;
  const text = key.kind === 'text' ? key.value : undefined;
  if (key.kind === 'escape' || key.kind === 'interrupt' || text === 'q') return {kind: 'close'};
  const step = (delta: number): ImageViewAction | undefined => {
    const next = state.index + delta;
    if (next < 0 || next >= state.entries.length) { state.note = state.entries.length > 1 ? (delta > 0 ? 'This is the last image.' : 'This is the first image.') : undefined; return undefined; }
    return {kind: 'load', index: next};
  };
  if (text === 'n' || text === ']' || (key.kind === 'pageDown')) return step(1);
  if (text === 'p' || text === '[' || key.kind === 'pageUp') return step(-1);
  if ((key.kind === 'right' || text === 'l') && state.zoom === 1) return step(1);
  if ((key.kind === 'left' || text === 'h') && state.zoom === 1) return step(-1);
  if (text === '+' || text === '=') { const at = ZOOMS.findIndex(zoom => zoom > state.zoom); if (at >= 0) state.zoom = ZOOMS[at]!; clampPan(state); return undefined; }
  if (text === '-' || text === '_') { const at = [...ZOOMS].reverse().findIndex(zoom => zoom < state.zoom); if (at >= 0) state.zoom = [...ZOOMS].reverse()[at]!; clampPan(state); return undefined; }
  if (text === '0') { state.zoom = 1; state.pan = {x: 0.5, y: 0.5}; return undefined; }
  if (state.zoom > 1) {
    const amount = PAN_STEP / state.zoom * 2;
    if (key.kind === 'left' || text === 'h') state.pan.x -= amount;
    else if (key.kind === 'right' || text === 'l') state.pan.x += amount;
    else if (key.kind === 'up' || text === 'k') state.pan.y -= amount;
    else if (key.kind === 'down' || text === 'j') state.pan.y += amount;
    clampPan(state);
    return undefined;
  }
  if (text === 'c') { const entry = state.entries[state.index]; return entry ? {kind: 'copy', text: entry.path, label: 'Copied the image path'} : undefined; }
  return undefined;
}

function clampPan(state: ImageViewState): void {
  const half = 0.5 / state.zoom;
  state.pan.x = Math.max(half, Math.min(1 - half, state.pan.x));
  state.pan.y = Math.max(half, Math.min(1 - half, state.pan.y));
  if (state.zoom === 1) state.pan = {x: 0.5, y: 0.5};
}

/** A step to a different image: the viewer starts over at fit. */
export function showImage(state: ImageViewState, index: number, image: LoadedImage | undefined, error?: string): void {
  state.index = index;
  if (image) state.image = image; else delete state.image;
  if (error) state.error = error; else delete state.error;
  state.loading = false;
  state.zoom = 1;
  state.pan = {x: 0.5, y: 0.5};
}

function controls(state: ImageViewState, columns: number): string[] {
  const width = Math.max(1, columns - 4);
  return renderControlRows([
    ...(state.entries.length > 1 ? [['n/p', 'next/previous'] as const] : []),
    ['+/-', 'zoom'], ...(state.zoom > 1 ? [['←→↑↓', 'pan'] as const] : []), ['0', 'fit'], ['c', 'copy path'], ['Esc', state.returnTo ? 'back to document' : 'close'],
  ], width);
}

function header(state: ImageViewState, columns: number): string[] {
  const width = Math.max(10, columns - 4);
  const primary = foreground(UI_COLORS.primary);
  const subtle = foreground(UI_COLORS.subtle);
  const entry = state.entries[state.index];
  const name = truncateText(inert(entry?.alt ? `${entry.alt} (${entry.name})` : entry?.name ?? 'image'), Math.max(8, Math.floor(width * 0.55)));
  const image = state.image;
  const parts: string[] = [];
  if (image) {
    parts.push(image.info.format.toUpperCase(), `${image.info.width} × ${image.info.height}`, formatBytes(image.fileBytes));
    if (image.info.animated) parts.push('animated: first frame');
    if (image.raster.width !== image.info.width) parts.push('shown reduced');
  }
  if (state.zoom > 1) parts.push(`${Math.round(state.zoom * 100)}%`);
  if (state.entries.length > 1) parts.push(`${state.index + 1} of ${state.entries.length}`);
  return [`  ${primary}${name}${RESET}  ${subtle}${truncateText(parts.join(' · '), Math.max(1, width - displayWidth(name) - 2))}${RESET}`];
}

const RESET = '\u001b[0m';

export interface ImageRender {
  rows: string[];
  /** Set by `renderImageView` for an overlay placement: where the app should draw it, in the returned rows. */
  overlay?: {y: number; x: number; placement: PlacementOverlay};
}

/** The panel rows for the current image at `columns` x `height` (the viewer's own convention: a leading frame rule and a trailing one). */
export function renderImageView(state: ImageViewState, columns: number, height: number, service: GraphicsService): string[] {
  const subtle = foreground(UI_COLORS.subtle);
  const failure = foreground(UI_COLORS.failure);
  const head = header(state, columns);
  const foot = controls(state, columns);
  const body = Math.max(1, height - 2 - head.length - 1 - foot.length);
  const width = Math.max(4, columns - 4);
  const out = [...head];
  const area: string[] = [];
  state.overlay = undefined;
  if (state.loading) area.push(`  ${subtle}Loading…${RESET}`);
  else if (state.error) area.push(`  ${failure}${truncateText(state.error, width)}${RESET}`);
  else if (state.image) {
    const half = 0.5 / state.zoom;
    const crop = state.zoom > 1 ? {x: state.pan.x - half, y: state.pan.y - half, width: 1 / state.zoom, height: 1 / state.zoom} : undefined;
    let placement: Placement;
    try { placement = service.place(state.image, {columns: width, rows: body, owner: state.owner, surface: 'viewer', upscale: state.zoom > 1, ...(crop ? {crop} : {})}); }
    catch { placement = {kind: 'text', columns: 1, rows: 1, lines: ['[the image could not be drawn here]'], owner: state.owner}; }
    const left = Math.max(0, Math.floor((width - placement.columns) / 2));
    const top = Math.max(0, Math.floor((body - placement.rows) / 2));
    for (let row = 0; row < top; row += 1) area.push('');
    for (const line of placement.lines) area.push(`  ${' '.repeat(left)}${line}`);
    if (placement.overlay) state.overlay = {y: 1 + out.length + top, x: 2 + left, placement: placement.overlay};
    service.keepOnly(state.owner, placement.key ? [placement.key] : []);
  }
  while (area.length < body) area.push('');
  out.push(...area.slice(0, body));
  const note = state.note ?? (state.image && state.image.info.format === 'gif' && state.image.info.animated ? 'Animated GIF: the first frame is shown.' : '');
  out.push(`  ${subtle}${truncateText(note, width)}${RESET}`, ...foot.map(row => `  ${row}`));
  const rule = framePanel([], columns)[0]!;
  return [...framePanel(out.slice(0, Math.max(0, height - 2)).map(row => truncateAnsi(row, columns)), columns), rule];
}
