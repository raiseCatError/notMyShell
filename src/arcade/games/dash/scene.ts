import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {typeset} from '../../../ui/typography.js';
import {Canvas, PixelBuffer} from '../../Canvas.js';
import {clamp, lerp, smoothstep} from '../../easing.js';
import type {ParticleSystem, Popups, Trail} from '../../effects.js';
import type {ArcadePalette} from '../../palette.js';
import {SPEED_MAX, SPEED_START, SPIKE_H, SPIKE_W, type Piece} from './physics.js';
import {plainPlayer, playerSprite, spikeSprite, type PlayerPose} from './sprites.js';
import {PHASE_PX, type DashWorld} from './world.js';

/** The scene is one half-block pixel layer (width = columns, height = 2 x rows) over a gradient of cell backgrounds. */
export const MIN_COLUMNS = 40;
export const MIN_ROWS = 12;
/** Ground band, in pixels from the bottom: the surface cell row and one row of texture below it. */
const GROUND_PX = 4;
/** Distance over which the color phase blends into the next one. */
const BLEND_PX = 140;

export interface Geometry { width: number; height: number; groundY: number; catX: number; skyRows: number }

export function geometry(columns: number, rows: number): Geometry {
  const height = rows * 2;
  return {width: columns, height, groundY: height - GROUND_PX, catX: clamp(Math.floor(columns * 0.2), 8, 28), skyRows: Math.max(1, rows - GROUND_PX / 2)};
}

export interface SceneView {
  world: DashWorld;
  alpha: number;
  palette: ArcadePalette;
  /** Parallax, trail, streaks and the pixel spikes; off without color, where every lit pixel would be the same solid block. */
  decor: boolean;
  reduced: boolean;
  visualMs: number;
  pose: PlayerPose;
  particles: ParticleSystem;
  trail: Trail;
  popups: Popups;
  shake: {x: number; y: number};
  flash: number;
  /** The surface the cat last landed on (-1 the ground), the world x of the landing, and how bright it still glows (0..1). */
  hot: {support: number; x: number; amount: number};
  score: number;
  best: number;
  pop: number;
  phase: 'ready' | 'playing' | 'over';
}

const hash = (value: number): number => {
  let h = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

/** The accent of each color phase, all palette roles; a new one every `PHASE_METERS`. */
export function phaseTones(palette: ArcadePalette): readonly Rgb[] {
  return [palette.accent, palette.ok, palette.warn, palette.accentSoft, palette.bad];
}

/** The tint at `distance`: the current phase's tone, blended in from the previous one over `BLEND_PX`. */
export function phaseTint(palette: ArcadePalette, distance: number): Rgb {
  const tones = phaseTones(palette);
  const index = Math.max(0, Math.floor(distance / PHASE_PX));
  const into = distance - index * PHASE_PX;
  const current = tones[index % tones.length]!;
  if (index === 0) return current;
  return mixRgb(tones[(index - 1) % tones.length]!, current, smoothstep(into / BLEND_PX));
}

export class DashScene {
  private buffer = new PixelBuffer(0, 0);
  private gaps = new Uint8Array(0);

  draw(canvas: Canvas, view: SceneView): void {
    const geo = geometry(canvas.width, canvas.height);
    if (this.buffer.width !== geo.width || this.buffer.height !== geo.height) { this.buffer = new PixelBuffer(geo.width, geo.height); }
    if (this.gaps.length !== geo.width) this.gaps = new Uint8Array(geo.width);
    const {palette, world} = view;
    const buffer = this.buffer;
    buffer.clear();
    const distance = lerp(world.prevDistance, world.distance, view.alpha);
    const feet = lerp(world.prevY, world.y, view.alpha);
    const camera = distance - geo.catX;
    const tint = phaseTint(palette, distance);
    const beat = view.reduced || view.phase !== 'playing' ? 0 : Math.max(0, 1 - ((distance / 48) % 1) / 0.3) ** 2 * 0.12;
    const lift = (color: Rgb, extra = 0): Rgb => {
      const amount = Math.min(1, extra + view.flash * 0.7);
      return amount > 0 ? mixRgb(color, palette.haze, amount) : color;
    };
    const skyTop = mixRgb(palette.deep, tint, 0.16);
    const skyBottom = mixRgb(palette.dusk, tint, 0.34);
    const ground = mixRgb(skyTop, palette.deep, 0.55);
    const surface = mixRgb(tint, palette.ink, 0.3);
    const blockBody = mixRgb(skyBottom, palette.ink, 0.3);
    const blockTop = mixRgb(tint, palette.ink, 0.65);

    // Sky gradient, then the ground band's cells.
    canvas.clear(lift(skyBottom));
    for (let row = 0; row < geo.skyRows; row += 1) canvas.fill(0, row, canvas.width, 1, ' ', {bg: lift(mixRgb(skyTop, skyBottom, (row + 0.5) / geo.skyRows), beat)});
    canvas.fill(0, geo.skyRows, canvas.width, canvas.height - geo.skyRows, ' ', {bg: ground});

    const screenX = (worldX: number): number => Math.round(worldX - camera);
    this.gaps.fill(0);
    for (const piece of world.course.pieces) {
      if (piece.kind !== 'gap') continue;
      const from = Math.max(0, screenX(piece.x));
      const to = Math.min(geo.width, screenX(piece.x + piece.w));
      for (let x = from; x < to; x += 1) this.gaps[x] = 1;
    }

    if (view.decor) this.backdrop(view, geo, distance, {top: skyTop, bottom: skyBottom}, tint, beat);
    this.groundBand(canvas, buffer, view, geo, ground, surface, camera);

    for (const piece of world.course.pieces) {
      const x = screenX(piece.x);
      if (x >= geo.width) break;
      if (x + piece.w < 0 || piece.kind === 'gap') continue;
      if (piece.kind === 'block') this.block(buffer, view, geo, piece, x, blockBody, blockTop, tint);
    }

    // The player, over a soft shadow.
    const sprite = playerSprite(view.pose, palette);
    const footY = geo.groundY - Math.round(feet);
    if (view.decor) {
      view.trail.draw(buffer, mixRgb(palette.accent, palette.haze, 0.35), mixRgb(palette.accent, skyBottom, 0.85));
      view.particles.draw(buffer, skyBottom);
    }
    const spike = spikeSprite(palette);
    for (const piece of world.course.pieces) {
      const x = screenX(piece.x);
      if (x >= geo.width) break;
      if (x + piece.w < 0 || piece.kind !== 'spike') continue;
      if (view.decor) buffer.sprite(spike, x, geo.groundY - piece.level - SPIKE_H);
    }
    if (view.decor) buffer.sprite(sprite, geo.catX, footY - sprite.height);
    canvas.blit(buffer, view.shake.x, view.shake.y);

    if (!view.decor) this.plain(canvas, view, geo, screenX, footY);
    if (view.decor) view.popups.draw(canvas, skyTop);
    this.hud(canvas, view, geo, beat > 0 || (view.phase === 'playing' && !view.reduced && (distance / 48) % 1 < 0.3));
  }

  /** Stars, two parallax layers of sharp geometry and, at speed, a few streaks. Everything is a tint of the sky. */
  private backdrop(view: SceneView, geo: Geometry, distance: number, sky: {top: Rgb; bottom: Rgb}, tint: Rgb, beat: number): void {
    const {palette} = view;
    const buffer = this.buffer;
    const calm = view.reduced;
    const stars = Math.floor((geo.width * geo.groundY) / 260);
    for (let index = 0; index < stars; index += 1) {
      const x = hash(index * 2) % geo.width;
      const y = hash(index * 2 + 1) % Math.max(1, geo.groundY - 14);
      buffer.set(x, y, mixRgb(sky.top, palette.ink, 0.28 + (index % 3) * 0.08));
    }
    const far = mixRgb(sky.bottom, palette.deep, 0.5);
    const near = mixRgb(sky.bottom, palette.deep, 0.68);
    const drift = calm ? 0 : 1;
    for (let x = 0; x < geo.width; x += 1) {
      const u = x + distance * 0.12 * drift;
      const cell = Math.floor(u / 36);
      const peak = 5 + (hash(cell) % 6);
      const rise = 1 - Math.abs(((u - cell * 36) / 36) * 2 - 1);
      const height = Math.round(peak * rise);
      if (height > 0) buffer.rect(x, geo.groundY - height, 1, height, mixRgb(far, tint, beat * 2));
      const v = x + distance * 0.32 * drift;
      const pillar = Math.floor(v / 15);
      if (hash(pillar + 977) % 3 === 0 && v - pillar * 15 < 2) buffer.rect(x, geo.groundY - 3 - (hash(pillar) % 9), 1, 3 + (hash(pillar) % 9), mixRgb(near, tint, beat * 3));
    }
    const fraction = clamp((view.world.speed - SPEED_START) / (SPEED_MAX - SPEED_START), 0, 1);
    const streaks = calm ? 0 : Math.floor(fraction * 7);
    for (let index = 0; index < streaks; index += 1) {
      const length = 4 + (hash(index + 31) % 5) + Math.floor(fraction * 6);
      const span = geo.width + length;
      const x = ((((hash(index * 5) % span) - distance * (1.6 + (index % 3) * 0.4)) % span) + span) % span - length;
      const y = 2 + (hash(index * 11 + 3) % Math.max(2, geo.groundY - 12));
      for (let step = 0; step < length; step += 1) buffer.set(x + step, y, mixRgb(sky.bottom, palette.haze, 0.1 + 0.35 * (step / length)));
    }
  }

  private groundBand(canvas: Canvas, buffer: PixelBuffer, view: SceneView, geo: Geometry, ground: Rgb, surface: Rgb, camera: number): void {
    const {palette} = view;
    const void_ = mixRgb(palette.deep, ground, 0.35);
    const texture = geo.skyRows + 1;
    const scroll = Math.floor(camera);
    for (let x = 0; x < geo.width; x += 1) {
      if (this.gaps[x]) {
        canvas.fill(x, geo.skyRows, 1, canvas.height - geo.skyRows, ' ', {bg: void_});
        continue;
      }
      let color = surface;
      if (view.hot.amount > 0 && view.hot.support === -1) {
        const near = 1 - Math.abs(x + camera - view.hot.x) / 18;
        if (near > 0) color = mixRgb(surface, palette.haze, near * view.hot.amount * 0.9);
      }
      buffer.set(x, geo.groundY, color);
      buffer.set(x, geo.groundY + 1, mixRgb(surface, ground, 0.55));
      const n = hash(x + scroll) % 9;
      if (texture < canvas.height) canvas.put(x, texture, n === 0 ? '▒' : '░', {fg: palette.faint, bg: ground});
    }
  }

  private block(buffer: PixelBuffer, view: SceneView, geo: Geometry, piece: Piece, x: number, body: Rgb, top: Rgb, tint: Rgb): void {
    const {palette} = view;
    const y = geo.groundY - piece.level;
    let edge = top;
    if (view.hot.amount > 0 && view.hot.support === piece.id) edge = mixRgb(top, palette.haze, view.hot.amount);
    buffer.rect(x, y, piece.w, geo.height - y, body);
    buffer.rect(x, y, piece.w, 1, edge);
    buffer.rect(x, y + 1, 1, geo.height - y - 1, mixRgb(body, tint, 0.45));
    buffer.rect(x + piece.w - 1, y + 1, 1, geo.height - y - 1, mixRgb(body, palette.deep, 0.4));
  }

  /** Without color or with Safe Glyphs: spikes are ▲ glyphs, the cat is the ASCII cat; the pixel scene is blocks and ground only. */
  private plain(canvas: Canvas, view: SceneView, geo: Geometry, screenX: (worldX: number) => number, footY: number): void {
    const {palette, world} = view;
    for (const piece of world.course.pieces) {
      const x = screenX(piece.x);
      if (x >= geo.width) break;
      if (x + piece.w < 0 || piece.kind !== 'spike') continue;
      const row = (geo.groundY - piece.level) / 2 - 1;
      for (let column = 0; column < SPIKE_W; column += 1) canvas.put(x + column, row, '▲', {fg: palette.bad, bold: true});
    }
    const rows = plainPlayer(view.pose);
    const bottom = Math.round(footY / 2) - 1;
    rows.forEach((text, index) => canvas.text(geo.catX, bottom - (rows.length - 1) + index, text, {fg: palette.cat.body, bold: true}));
  }

  private hud(canvas: Canvas, view: SceneView, geo: Geometry, tick: boolean): void {
    const {palette, world} = view;
    const digits = String(Math.min(view.score, 99999)).padStart(5, '0');
    const room = canvas.width - 14;
    const block = typeset({role: 'counter', text: digits, maxColumns: Math.max(5, room), maxRows: canvas.height >= 16 ? 2 : 1});
    const lit = view.pop > 0;
    canvas.typeBlock(block, Math.max(0, canvas.width - block.columns - 1), 0, {fg: lit ? palette.accent : palette.ink, bold: true, underline: lit});
    if (canvas.width >= 44) canvas.text(1, 0, `HI ${String(Math.min(view.best, 99999)).padStart(5, '0')}`, {fg: palette.muted});
    if (view.phase !== 'ready') {
      const speed = `${(world.speed / SPEED_START).toFixed(2)}x`;
      const status = `${world.meters} m  ${speed}`;
      canvas.text(1, 1, status, {fg: palette.muted});
      canvas.text(1 + status.length + 1, 1, tick ? '•' : '·', {fg: palette.faint});
    }
    if (view.phase !== 'ready') return;
    const title = typeset({role: 'title', text: 'Vespyr Dash', maxColumns: canvas.width - 4, maxRows: 2});
    const top = clamp(Math.floor(geo.skyRows / 3) - 1, 2, Math.max(2, geo.skyRows - title.rows - 3));
    canvas.typeBlock(title, Math.max(0, Math.floor((canvas.width - title.columns) / 2)), top, {fg: palette.ink, bold: true});
    const prompt = canvas.width >= 40 ? 'Space or Up to dash  ·  jump the spikes' : 'Space to dash';
    if (top + title.rows < geo.skyRows) canvas.center(top + title.rows, prompt, {fg: palette.accent, bold: true});
  }
}

/** The one-line note for a canvas smaller than the game can use. */
export function drawTooSmall(canvas: Canvas, palette: ArcadePalette): void {
  canvas.clear();
  const note = `Needs at least ${MIN_COLUMNS}x${MIN_ROWS}`;
  canvas.text(0, Math.floor(canvas.height / 2), note.slice(0, Math.max(0, canvas.width)), {fg: palette.warn});
}
