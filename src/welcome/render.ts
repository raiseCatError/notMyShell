/** Shared frame adapter. GraphicsService alone turns image plans into cells or typed overlays. */
import type {GraphicsDecision} from '../graphics/capabilities.js';
import type {GraphicsService, PlacementOverlay} from '../graphics/service.js';
import type {WelcomeAsset} from './assets.js';
import type {WelcomeCapabilities, WelcomeComposition} from './compose.js';
import {displayWidth} from '../util/text.js';
export interface WelcomeOverlay {x: number; y: number; placement: PlacementOverlay}
/** Inline startup and P preview must explain when a viewer-only protocol becomes cells. */
export function inlineWelcomeReason(decision: GraphicsDecision): string | undefined {
  if (decision.inline === 'placeholder') return undefined;
  return ['kitty', 'iterm2', 'sixel'].includes(decision.backend)
    ? `${decision.reason} Welcome uses character art because verified inline placement is unavailable.` : decision.reason;
}
export function assetCapabilities(asset: WelcomeAsset | undefined, reason?: string, animate = true): WelcomeCapabilities['asset'] {
  if (!asset) return reason ? {width: 1, height: 1, reason} : undefined;
  return {width: asset.metadata.width, height: asset.metadata.height, ...(asset.kind === 'image' && asset.animation?.truncated ? {truncated: true} : {}), ...(asset.kind === 'art' ? {rows: asset.rows} : animate && asset.animation && !asset.animation.truncated ? {frameDelays: asset.animation.frames.map(f => f.delayMs), loopCount: asset.animation.loopCount} : {}), ...((asset.metadata.note ?? reason) ? {reason: [asset.metadata.note, reason].filter(Boolean).join(' ')} : {})};
}
export function paintWelcome(frame: WelcomeComposition, asset: WelcomeAsset | undefined, service: GraphicsService, owner: unknown,
  surface: 'inline' | 'viewer', background: {red: number; green: number; blue: number}, cellsOnly = false): {rows: string[]; overlay?: WelcomeOverlay} {
  const rows = frame.rows.map(r => r.ansi);
  let overlay: WelcomeOverlay | undefined;
  const keys: string[] = [];
  if (asset?.kind === 'image') for (const box of frame.images) {
    const bg = box.alpha === 'preserve' ? undefined : box.alpha === 'theme' ? background : box.alpha === 'black' ? {red: 0, green: 0, blue: 0} : {red: 255, green: 255, blue: 255};
    const frameIndex = Math.max(0, Math.min(asset.animation?.frames.length ? asset.animation.frames.length - 1 : 0, frame.frameIndex ?? 0));
    const decodedFrame = asset.animation?.frames[frameIndex];
    const image = decodedFrame ? {...asset.image, raster: decodedFrame.raster, key: `${asset.image.key}|frame:${frameIndex}`} : asset.image;
    const placed = service.place(image, {...box, owner, surface, cellsOnly, upscale: true, ...(bg ? {background: bg} : {})});
    if (placed.key) keys.push(placed.key);
    for (let i = 0; i < box.rows; i++) {
      const row = box.row + i;
      if (row >= rows.length) break;
      rows[row] = replaceCells(rows[row]!, box.column, box.columns, placed.lines[i] ?? '', box.columns);
    }
    if (placed.overlay) overlay = {x: box.column, y: box.row, placement: placed.overlay};
  }
  service.keepOnly(owner, keys);
  return {rows, ...(overlay ? {overlay} : {})};
}

function replaceCells(row: string, start: number, count: number, insert: string, width: number): string {
  let prefix = '', suffix = '', style = '', cells = 0;
  const tokens = row.match(/\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]/gu) ?? [];
  for (const token of tokens) {
    if (token.startsWith('\x1b')) { style += token; if (cells < start) prefix += token; if (cells >= start + count) suffix += token; continue; }
    if (cells < start) prefix += token;
    else if (cells >= start + count) suffix += token;
    cells += displayWidth(token);
  }
  return prefix + ' '.repeat(Math.max(0, start - displayWidth(prefix))) + insert + ' '.repeat(Math.max(0, width - displayWidth(insert))) + style + suffix;
}
