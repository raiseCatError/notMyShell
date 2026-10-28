/** Shared frame adapter. GraphicsService alone turns image plans into cells or typed overlays. */
import type {GraphicsDecision} from '../graphics/capabilities.js';
import type {GraphicsService, PlacementOverlay} from '../graphics/service.js';
import type {WelcomeAsset} from './assets.js';
import type {WelcomeCapabilities, WelcomeComposition} from './compose.js';
import {displayWidth} from '../util/text.js';
import {generateLogoAnimation, type GeneratedLogoAnimation} from '../graphics/logoAnimation.js';
import type {WelcomeStudio} from './model.js';

/** One generated animation per admitted image (the latest preset): editors cycling presets never pile frames up. */
const generated = new WeakMap<object, {key: string; animation: GeneratedLogoAnimation}>();
/**
 * The asset startup and preview animate: a still image logo with a Logo animation gets generated frames, shown through the
 * same frame path as a GIF. Off, text logos, GIF/APNG files, no color, Reduced Motion, Effects Off and a hidden window keep
 * the admitted asset itself, so the still picture is exactly what Off shows.
 */
export function motionAsset(asset: WelcomeAsset | undefined, model: Pick<WelcomeStudio, 'logo' | 'logoAnimation' | 'logoPlay'> | undefined,
  caps: Pick<WelcomeCapabilities, 'color' | 'reducedMotion' | 'effectsOff' | 'hidden'>): WelcomeAsset | undefined {
  if (!asset || asset.kind !== 'image' || !model || model.logo !== 'image' || model.logoAnimation === 'off') return asset;
  if (!caps.color || caps.reducedMotion || caps.effectsOff || caps.hidden) return asset;
  if ((asset.animation?.frames.length ?? 1) > 1 || asset.animation?.truncated) return asset;
  const key = `${model.logoAnimation}:${model.logoPlay}`;
  let entry = generated.get(asset.image);
  if (entry?.key !== key) {
    try { entry = {key, animation: generateLogoAnimation(asset.image.raster, model.logoAnimation, model.logoPlay)}; }
    catch { return asset; }
    generated.set(asset.image, entry);
  }
  return {...asset, image: {...asset.image, key: `${asset.image.key}|logo:${key}`}, animation: entry.animation};
}
export interface WelcomeOverlay {x: number; y: number; placement: PlacementOverlay}
/** Inline startup and P preview must explain when a viewer-only protocol becomes cells. */
export function inlineWelcomeReason(decision: GraphicsDecision): string | undefined {
  if (decision.inline === 'placeholder') return undefined;
  return ['kitty', 'iterm2', 'sixel'].includes(decision.backend)
    ? `${decision.reason} Welcome uses character art because verified inline placement is unavailable.` : decision.reason;
}
export function assetCapabilities(asset: WelcomeAsset | undefined, reason?: string, animate = true): WelcomeCapabilities['asset'] {
  if (!asset) return reason ? {width: 1, height: 1, reason} : undefined;
  return {width: asset.metadata.width, height: asset.metadata.height, ...(asset.kind === 'image' && asset.animation?.truncated ? {truncated: true} : {}), ...(asset.kind === 'art' ? {rows: asset.rows} : animate && asset.animation && !asset.animation.truncated ? {frameDelays: asset.animation.frames.map(f => f.delayMs), loopCount: asset.animation.loopCount, ...('loopFrom' in asset.animation ? {loopFrom: (asset.animation as GeneratedLogoAnimation).loopFrom, playMs: (asset.animation as GeneratedLogoAnimation).playMs} : {})} : {}), ...((asset.metadata.note ?? reason) ? {reason: [asset.metadata.note, reason].filter(Boolean).join(' ')} : {})};
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
