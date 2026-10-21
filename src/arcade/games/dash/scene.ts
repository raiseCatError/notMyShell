import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {typeset} from '../../../ui/typography.js';
import {Canvas, PixelBuffer} from '../../Canvas.js';
import {clamp, lerp, smoothstep} from '../../easing.js';
import type {ParticleSystem, Popups, Trail} from '../../effects.js';
import type {ArcadePalette} from '../../palette.js';
import {gradient, hash as sceneHash, rgb, ridge, stars} from '../../scenery.js';
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

const hash = sceneHash;

/**
 * Vespyr Dash's world: a dark neon stage that changes color every phase. A striped sun sits on the horizon and pulses
 * with the beat, geometric ridges and pillars scroll behind, and the floor is a scrolling neon grid. Spikes are always
 * hot pink with a white tip, a color no phase uses, so a hazard never blends into the scenery.
 */
const NEON: readonly Rgb[] = [rgb(0xb18cff), rgb(0x5fe3ff), rgb(0xb5ff6e), rgb(0xffb15f), rgb(0xff7ad9)];
const NIGHT_TOP = rgb(0x07051a);
const NIGHT_LOW = rgb(0x170f3a);

/** The neon of each color phase; a new one every `PHASE_METERS`. */
export function phaseTones(_palette: ArcadePalette): readonly Rgb[] {
  return NEON;
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
    const skyTop = view.decor ? NIGHT_TOP : mixRgb(palette.deep, tint, 0.16);
    const skyBottom = view.decor ? mixRgb(NIGHT_LOW, tint, 0.22) : mixRgb(palette.dusk, tint, 0.34);
    const ground = view.decor ? rgb(0x0b0820) : mixRgb(skyTop, palette.deep, 0.55);
    const surface = view.decor ? tint : mixRgb(tint, palette.ink, 0.3);
    const blockBody = view.decor ? mixRgb(rgb(0x120c2e), tint, 0.12) : mixRgb(skyBottom, palette.ink, 0.3);
    const blockTop = view.decor ? mixRgb(tint, rgb(0xffffff), 0.35) : mixRgb(tint, palette.ink, 0.65);

    // Sky gradient (in pixels when decorated), then the ground band's cells.
    canvas.clear(view.decor ? undefined : lift(skyBottom));
    if (view.decor) {
      gradient(buffer, [lift(skyTop), lift(mixRgb(NIGHT_LOW, tint, 0.08), beat), lift(skyBottom, beat)], 0, geo.groundY);
      buffer.rect(0, geo.groundY, geo.width, geo.height - geo.groundY, ground);
    } else {
      for (let row = 0; row < geo.skyRows; row += 1) canvas.fill(0, row, canvas.width, 1, ' ', {bg: lift(mixRgb(skyTop, skyBottom, (row + 0.5) / geo.skyRows), beat)});
      canvas.fill(0, geo.skyRows, canvas.width, canvas.height - geo.skyRows, ' ', {bg: ground});
    }

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
      view.trail.draw(buffer, mixRgb(tint, rgb(0xffffff), 0.35), mixRgb(tint, skyBottom, 0.85));
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

  /** Stars, a striped sun on the horizon, a geometric ridge, neon pillars and, at speed, streaks. */
  private backdrop(view: SceneView, geo: Geometry, distance: number, sky: {top: Rgb; bottom: Rgb}, tint: Rgb, beat: number): void {
    const {palette} = view;
    const buffer = this.buffer;
    const calm = view.reduced;
    const drift = calm ? 0 : 1;
    stars(buffer, 13, Math.floor(geo.groundY * 0.6), rgb(0xffffff), sky.top, {density: 150, strength: 0.8});
    // The sun: a disc sitting on the horizon, cut by dark stripes that thicken toward the bottom; it swells on the beat.
    const radius = Math.max(6, Math.round(geo.groundY * 0.32));
    const cx = Math.round(geo.width * 0.66);
    const cy = geo.groundY - 4;
    const top = mixRgb(rgb(0xffe39a), tint, 0.25);
    const bottom = mixRgb(rgb(0xff6fae), tint, 0.3);
    for (let y = cy - radius; y <= cy; y += 1) {
      const t = (y - (cy - radius)) / radius;
      const stripe = t > 0.45 && Math.floor((y - (cy - radius)) * (1 + t)) % 5 < Math.round(t * 2.4);
      if (stripe) continue;
      const half = Math.sqrt(Math.max(0, radius * radius - (cy - y) * (cy - y))) * 1.4;
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x += 1) buffer.set(x, y, mixRgb(mixRgb(top, bottom, t), rgb(0xffffff), beat * 1.6));
    }
    ridge(buffer, {base: geo.groundY, height: Math.round(geo.groundY * 0.12), amplitude: Math.max(2, geo.groundY * 0.08), scale: 9, scroll: distance * 0.12 * drift, seed: 4, step: 4,
      color: mixRgb(rgb(0x120a2c), tint, 0.08), rim: mixRgb(tint, sky.bottom, 0.25 - beat)});
    for (let x = 0; x < geo.width; x += 1) {
      const v = x + distance * 0.32 * drift;
      const pillar = Math.floor(v / 15);
      if (hash(pillar + 977) % 3 !== 0 || v - pillar * 15 >= 2) continue;
      const height = 4 + (hash(pillar) % 10);
      buffer.rect(x, geo.groundY - height, 1, height, mixRgb(rgb(0x0e0826), tint, 0.18));
      buffer.set(x, geo.groundY - height, mixRgb(tint, rgb(0xffffff), 0.3 + beat * 2));
    }
    const fraction = clamp((view.world.speed - SPEED_START) / (SPEED_MAX - SPEED_START), 0, 1);
    const streaks = calm ? 0 : Math.floor(fraction * 7);
    for (let index = 0; index < streaks; index += 1) {
      const length = 4 + (hash(index + 31) % 5) + Math.floor(fraction * 6);
      const span = geo.width + length;
      const x = ((((hash(index * 5) % span) - distance * (1.6 + (index % 3) * 0.4)) % span) + span) % span - length;
      const y = 2 + (hash(index * 11 + 3) % Math.max(2, geo.groundY - 12));
      for (let step = 0; step < length; step += 1) buffer.set(x + step, y, mixRgb(sky.bottom, tint, 0.15 + 0.5 * (step / length)));
    }
    void palette;
  }

  private groundBand(canvas: Canvas, buffer: PixelBuffer, view: SceneView, geo: Geometry, ground: Rgb, surface: Rgb, camera: number): void {
    const {palette} = view;
    const void_ = mixRgb(palette.deep, ground, 0.35);
    const texture = geo.skyRows + 1;
    const scroll = Math.floor(camera);
    for (let x = 0; x < geo.width; x += 1) {
      if (this.gaps[x]) {
        if (view.decor) for (let y = geo.groundY; y < geo.height; y += 1) buffer.set(x, y, rgb(0x030210));
        else canvas.fill(x, geo.skyRows, 1, canvas.height - geo.skyRows, ' ', {bg: void_});
        continue;
      }
      let color = surface;
      if (view.hot.amount > 0 && view.hot.support === -1) {
        const near = 1 - Math.abs(x + camera - view.hot.x) / 18;
        if (near > 0) color = mixRgb(surface, palette.haze, near * view.hot.amount * 0.9);
      }
      buffer.set(x, geo.groundY, color);
      if (view.decor) {
        // A neon grid: a glowing edge, then lines every 8 pixels that scroll with the floor.
        const line = (x + scroll) % 8 === 0;
        for (let y = geo.groundY + 1; y < geo.height; y += 1) buffer.set(x, y, line || y === geo.groundY + 3 ? mixRgb(surface, ground, 0.55) : ground);
        continue;
      }
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
