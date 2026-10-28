import {colorEscape} from '../chroma/escape.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {renderLegacyWelcome, vespyrSprite, type WelcomeSnapshot, type WelcomeCatFrame} from './legacy.js';
import {welcomeText, type WelcomeFact, type WelcomeStudio} from './model.js';
import {displayWidth, stripAnsi, truncateAnsi, truncateText} from '../util/text.js';
import type {WrappedRow} from '../output/viewport.js';

export type WelcomeFacts = Partial<Record<WelcomeFact, string>>;
export interface WelcomeCapabilities {
  color: boolean; level?: ColorLevel; home?: string; safeGlyphs?: boolean; reducedMotion?: boolean; effectsOff?: boolean;
  accent?: {red: number; green: number; blue: number};
  chroma?: {red: number; green: number; blue: number};
  legacy?: WelcomeSnapshot; catFrame?: WelcomeCatFrame;
  asset?: {rows?: string[]; width: number; height: number; reason?: string; frameDelays?: readonly number[]; loopCount?: number};
}
export interface WelcomeImagePlacement {
  row: number; column: number; columns: number; rows: number;
  crop?: {x: number; y: number; width: number; height: number};
  alpha: WelcomeStudio['alpha'];
  treatment?: {brightness?: number; opacity?: number; shimmer?: number; parallax?: number};
}
export interface WelcomeComposition {rows: WrappedRow[]; images: WelcomeImagePlacement[]; active: boolean; frameIndex?: number}

/** No I/O, uploads or clock ownership. A sequencer supplies elapsed time; 6b can use this exact frame plan. */
export function composeWelcome(model: WelcomeStudio, facts: WelcomeFacts, size: {columns: number; rows: number}, capabilities: WelcomeCapabilities, time: number): WelcomeComposition {
  const width = Math.max(0, Math.min(240, Math.floor(size.columns)));
  const height = Math.max(0, Math.min(80, Math.floor(size.rows)));
  if (!width || !height) return {rows: [], images: [], active: false};
  if (!model.customized && capabilities.legacy && !capabilities.legacy.captured) return {rows: renderLegacyWelcome(capabilities.legacy, width, capabilities.catFrame, {level: capabilities.color ? capabilities.level ?? 'truecolor' : 'none', home: capabilities.home ?? '', safeGlyphs: capabilities.safeGlyphs ?? false}).slice(0, height), images: [], active: false};
  const allowed = capabilities.color && !capabilities.reducedMotion && !capabilities.effectsOff;
  const moving = allowed && model.effect !== 'original';
  const animated = allowed && (capabilities.asset?.frameDelays?.length ?? 0) > 1;
  const t = (moving || animated) && Number.isFinite(time) ? Math.max(0, Math.min(time, 5000)) : 0;
  const phase = Math.sin(t / 450);
  const offset = model.effect === 'float' || model.effect === 'parallax' ? Math.round((phase + 1) / 2) : 0;
  const image = model.logo === 'image';
  const art = model.logo === 'art';
  const logoWidth = Math.max(1, Math.min(22, Math.floor(width / 3)));
  let logo = model.logo === 'mascot' ? vespyrSprite().map(r => stripAnsi(r)) :
    image || art ? capabilities.asset?.rows ?? [image ? '(image)' : '(art)'] : [];
  if (image) logo = Array.from({length: Math.min(6, Math.max(1, height - 4))}, (_, i) => i === 0 ? '(image)' : '');
  if (model.effect === 'reveal' && moving) logo = logo.map(row => truncateAnsi(row, Math.ceil(logoWidth * Math.min(1, t / 1200))));
  if (model.effect === 'particles' && moving && !image) logo = logo.map((row, i) => i === Math.floor(t / 250) % Math.max(1, logo.length) ? `${row} ·` : row);
  if (model.effect === 'parallax' && moving) logo = logo.map((row, i) => `${' '.repeat(i % 2 ? offset : 0)}${row}`);
  logo = [...Array<string>(moving ? offset : 0).fill(''), ...logo].map(r => truncateAnsi(r, logoWidth));
  const body = [model.title, model.greeting, ...model.modules.flatMap(id => facts[id] === undefined ? [] : [`${id === 'version' ? 'NMSh' : id}: ${welcomeText(facts[id])}`]), ...model.links].filter(Boolean);
  if (model.density === 'expanded') body.splice(Math.min(2, body.length), 0, '');
  const side = model.layout !== 'top' && width >= 40 && logo.length > 0;
  const gap = side ? 2 : 0;
  const textWidth = side ? width - logoWidth - gap : width;
  const hex = model.customColor;
  let color = model.palette === 'custom' ? {red: parseInt(hex.slice(1, 3), 16), green: parseInt(hex.slice(3, 5), 16), blue: parseInt(hex.slice(5, 7), 16)} : model.palette === 'chroma' ? capabilities.chroma ?? capabilities.accent : capabilities.accent;
  color ??= {red: 166, green: 124, blue: 243};
  const gain = moving && ['pulse', 'glow', 'shimmer'].includes(model.effect) ? 0.72 + (phase + 1) * 0.14 : 1;
  const style = colorEscape(38, {red: Math.round(color.red * gain), green: Math.round(color.green * gain), blue: Math.round(color.blue * gain)}, capabilities.color ? capabilities.level ?? 'truecolor' : 'none');
  const reset = capabilities.color ? '\x1b[0m' : '';
  if (model.logo === 'mascot' && capabilities.color) logo = logo.map(row => `${style}${row}${reset}`);
  const text = body.map((row, i) => `${i === 0 || model.effect === 'shimmer' && moving && i === Math.floor(t / 180) % body.length ? style : ''}${truncateText(row, textWidth)}${reset}`);
  let lines: string[];
  if (!side) lines = [...logo, ...text];
  else lines = Array.from({length: Math.max(logo.length, text.length)}, (_, i) => {
    const l = logo[i] ?? ''; const r = text[i] ?? '';
    const spark = image && model.effect === 'particles' && moving && i === Math.floor(t / 250) % Math.max(1, logo.length);
    return model.layout === 'right' ? `${r}${' '.repeat(Math.max(0, textWidth - displayWidth(r)))}${spark ? ' ·' : '  '}${l}` : `${l}${' '.repeat(Math.max(0, logoWidth - displayWidth(l)))}${spark ? '· ' : '  '}${r}`;
  });
  if (image && model.effect === 'particles' && moving && !side) lines.splice(logo.length, 0, `${' '.repeat(Math.floor(t / 250) % Math.max(1, logoWidth))}·`);
  const images: WelcomeImagePlacement[] = [];
  if (image && capabilities.asset) {
    const box: WelcomeImagePlacement = {row: moving ? offset : 0, column: side && model.layout === 'right' ? textWidth + gap : 0, columns: logoWidth, rows: Math.min(6, Math.max(1, height - 4)), alpha: model.alpha};
    if (model.fit !== 'contain') {
      const aspect = capabilities.asset.width / capabilities.asset.height;
      const target = box.columns / (box.rows * 2);
      const zoom = model.fit === 'crop' ? 0.8 : 1;
      const w = Math.min(1, target / aspect) * zoom, h = Math.min(1, aspect / target) * zoom;
      box.crop = {x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h};
    }
    if (moving && model.effect === 'pulse') box.treatment = {opacity: 0.75 + (phase + 1) / 8};
    if (moving && model.effect === 'glow') box.treatment = {brightness: 1.05 + (phase + 1) / 8};
    if (moving && model.effect === 'shimmer') box.treatment = {shimmer: (t % 1800) / 1800};
    if (moving && model.effect === 'reveal') box.crop = {x: 0, y: 0, width: Math.max(0.01, Math.min(1, t / 1200)), height: 1};
    if (moving && model.effect === 'parallax') box.treatment = {parallax: phase};
    if (model.effect === 'panZoom' && moving) { const span = 0.85 + phase * 0.1; box.crop = {x: (1 - span) * t / 5000, y: (1 - span) / 2, width: span, height: span}; }
    if (box.row + box.rows <= Math.min(lines.length, height)) images.push(box);
  }
  if ((image || art) && capabilities.asset?.reason) lines.push(truncateText(capabilities.asset.reason, width));
  else if ((image || art) && !capabilities.asset) lines.push('Choose a local asset to preview.');
  if (model.border) lines.push('-'.repeat(width));
  return {rows: lines.slice(0, height).map(line => { const ansi = truncateAnsi(capabilities.color ? line : stripAnsi(line), width); return {ansi, plain: stripAnsi(ansi)}; }), images, active: (moving || animated) && t < 5000, frameIndex: animated ? sampleFrame(capabilities.asset!.frameDelays!, t, capabilities.asset?.loopCount ?? 1) : 0};
}

/** Delays already passed decoder admission. Cap work again so callers cannot supply an unbounded schedule. */
function sampleFrame(delays: readonly number[], time: number, plays: number): number {
  const bounded = delays.slice(0, 75).map(delay => Number.isFinite(delay) ? Math.max(1, Math.min(5000, delay)) : 100);
  const duration = bounded.reduce((sum, delay) => sum + delay, 0);
  if (!duration || !bounded.length) return 0;
  if (plays > 0 && time >= duration * plays) return bounded.length - 1;
  let position = time % duration;
  for (let i = 0; i < bounded.length; i++) { if (position < bounded[i]!) return i; position -= bounded[i]!; }
  return bounded.length - 1;
}
