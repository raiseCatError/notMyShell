import {mixRgb} from '../../../chroma/chroma.js';
import {typeset} from '../../../ui/typography.js';
import {Canvas, PixelBuffer} from '../../Canvas.js';
import {clamp} from '../../easing.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {ParticleSystem, Popups} from '../../effects.js';
import {skyAt, type ArcadePalette} from '../../palette.js';
import {catSprite, obstacleSprite, RUN_BOB, type CatLook} from './sprites.js';
import {RunWorld} from './world.js';

/** The scene is drawn into one half-block pixel layer (width = columns, height = 2 x rows) over a gradient of cell backgrounds. */
export const MIN_COLUMNS = 20;
export const MIN_ROWS = 8;
/** Ground band, in pixels from the bottom: surface line, a solid pixel, then one row of texture. */
const GROUND_PX = 4;
/** Distance for one full day/night cycle. */
export const DAY_PX = 8000;

export interface Geometry { width: number; height: number; groundY: number; catX: number; skyRows: number }

export function geometry(columns: number, rows: number): Geometry {
  const height = rows * 2;
  return {width: columns, height, groundY: height - GROUND_PX, catX: clamp(Math.floor(columns * 0.14), 4, 24), skyRows: Math.max(1, rows - GROUND_PX / 2)};
}

export interface SceneView {
  world: RunWorld;
  alpha: number;
  palette: ArcadePalette;
  /** Parallax, clouds, stars and shadows; off without color, where every lit pixel would be the same solid block. */
  decor: boolean;
  reduced: boolean;
  visualMs: number;
  look: CatLook;
  particles: ParticleSystem;
  popups: Popups;
  shake: {x: number; y: number};
  flash: number;
  score: number;
  best: number;
  /** 0..1 while the score counter is celebrating a milestone. */
  pop: number;
  phase: 'ready' | 'playing' | 'over';
}

const hash = (value: number): number => {
  let h = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

export class RunScene {
  private buffer = new PixelBuffer(0, 0);

  draw(canvas: Canvas, view: SceneView): void {
    const geo = geometry(canvas.width, canvas.height);
    if (this.buffer.width !== geo.width || this.buffer.height !== geo.height) this.buffer = new PixelBuffer(geo.width, geo.height);
    const {palette, world} = view;
    const buffer = this.buffer;
    buffer.clear();
    const distance = world.prevDistance + (world.distance - world.prevDistance) * view.alpha;
    const feet = world.prevY + (world.y - world.prevY) * view.alpha;
    const sky = skyAt(palette, distance / DAY_PX);
    const lift = (color: Rgb): Rgb => (view.flash > 0 ? mixRgb(color, palette.haze, view.flash * 0.7) : color);
    const ground = mixRgb(palette.dusk, palette.deep, 0.45);

    canvas.clear(lift(sky.bottom));
    for (let row = 0; row < geo.skyRows; row += 1) canvas.fill(0, row, canvas.width, 1, ' ', {bg: lift(mixRgb(sky.top, sky.bottom, (row + 0.5) / geo.skyRows))});
    canvas.fill(0, geo.skyRows, canvas.width, canvas.height - geo.skyRows, ' ', {bg: ground});

    if (view.decor) this.backdrop(view, geo, distance, sky);
    this.groundLine(canvas, buffer, view, geo, distance, ground);

    const camera = distance - geo.catX;
    const flap = Math.floor(distance / 6) % 2 === 1;
    for (const o of world.course.obstacles) {
      const x = Math.round(o.x - camera);
      if (x >= geo.width) break;
      if (x + o.w < 0) continue;
      const sprite = obstacleSprite(o.kind, palette, flap);
      const top = geo.groundY - o.lift - o.h;
      for (let unit = 0; unit < o.count; unit += 1) buffer.sprite(sprite, x + unit * (sprite.width + 1), top);
    }

    if (view.decor && feet > 0.5) {
      const span = Math.max(3, Math.round(10 - feet / 2.5));
      buffer.rect(geo.catX + 7 - Math.floor(span / 2), geo.groundY - 1, span, 1, mixRgb(palette.deep, ground, 0.3));
    }
    if (view.decor) view.particles.draw(buffer, sky.bottom);
    const sprite = catSprite(view.look, palette);
    const bob = view.look.shape === 'run' ? RUN_BOB[view.look.frame % RUN_BOB.length]! : 0;
    buffer.sprite(sprite, geo.catX, geo.groundY - sprite.height - Math.round(feet) - bob, true);
    if (!view.decor) view.particles.draw(buffer);

    canvas.blit(buffer, view.shake.x, view.shake.y);
    if (view.decor) view.popups.draw(canvas, sky.top);
    this.hud(canvas, view, geo);
  }

  /** Stars at night, clouds, distant hills and a nearer row of shrubs, each scrolling at its own fraction of the speed. */
  private backdrop(view: SceneView, geo: Geometry, distance: number, sky: {top: Rgb; bottom: Rgb; stars: number}): void {
    const palette = view.palette;
    const buffer = this.buffer;
    const still = view.reduced;
    if (sky.stars > 0.05) {
      const count = Math.floor((geo.width * geo.groundY) / 110);
      const twinkle = still ? 0 : Math.floor(view.visualMs / 450);
      for (let index = 0; index < count; index += 1) {
        const x = (hash(index * 2) % geo.width);
        const y = hash(index * 2 + 1) % Math.max(1, geo.groundY - 12);
        const dim = (index + twinkle) % 7 === 0 ? 0.35 : 1;
        buffer.set(x, y, mixRgb(sky.top, palette.ink, clamp(sky.stars * 0.75 * dim, 0, 1)));
      }
    }
    const cloud = mixRgb(sky.bottom, palette.haze, 0.5);
    const drift = still ? 0 : view.visualMs * 0.004;
    for (let index = 0; index < 5; index += 1) {
      const span = geo.width + 40;
      const x = ((((hash(index) % span) - distance * 0.05 - drift) % span) + span) % span - 20;
      const y = 2 + (hash(index + 40) % Math.max(2, Math.floor(geo.groundY / 3)));
      buffer.ellipse(Math.round(x), y, 10, 3, cloud);
      buffer.ellipse(Math.round(x) + 2, y - 1, 6, 3, cloud);
    }
    const far = mixRgb(sky.bottom, palette.dusk, 0.55);
    const near = mixRgb(sky.bottom, palette.deep, 0.5);
    for (let x = 0; x < geo.width; x += 1) {
      const u = x + distance * 0.12;
      const height = Math.max(1, Math.round(5 + 3 * Math.sin(u * 0.09) + 2 * Math.sin(u * 0.23 + 1.3)));
      buffer.rect(x, geo.groundY - height, 1, height, far);
      const v = x + distance * 0.3;
      const cell = Math.floor(v / 7);
      const bump = Math.round((2 + (hash(cell) % 3)) * (1 - Math.abs((v - cell * 7) - 3) / 4));
      if (bump > 0) buffer.rect(x, geo.groundY - bump, 1, bump, near);
    }
  }

  private groundLine(canvas: Canvas, buffer: PixelBuffer, view: SceneView, geo: Geometry, distance: number, ground: Rgb): void {
    const {palette} = view;
    buffer.rect(0, geo.groundY, geo.width, 1, palette.accent);
    buffer.rect(0, geo.groundY + 1, geo.width, 1, mixRgb(palette.accent, ground, 0.55));
    const scroll = Math.floor(distance);
    const texture = geo.skyRows + 1;
    for (let x = 0; x < geo.width; x += 1) {
      const n = hash(x + scroll) % 9;
      if (n === 0 && view.decor) buffer.set(x, geo.groundY - 1, palette.muted);
      if (texture < canvas.height && n < 3) canvas.put(x, texture, n === 0 ? '·' : ':', {fg: palette.faint, bg: ground});
    }
  }

  private hud(canvas: Canvas, view: SceneView, geo: Geometry): void {
    const {palette} = view;
    const digits = String(Math.min(view.score, 99999)).padStart(5, '0');
    const room = canvas.width - 14;
    const block = typeset({role: 'counter', text: digits, maxColumns: Math.max(5, room), maxRows: canvas.height >= 16 ? 2 : 1});
    const lit = view.pop > 0;
    canvas.typeBlock(block, Math.max(0, canvas.width - block.columns - 1), 0, {fg: lit ? palette.accent : palette.ink, bold: true, underline: lit});
    if (canvas.width >= 28) canvas.text(1, 0, `HI ${String(Math.min(view.best, 99999)).padStart(5, '0')}`, {fg: palette.muted, bold: false});
    if (view.phase !== 'ready') return;
    const title = typeset({role: 'title', text: 'Vespyr Run', maxColumns: canvas.width - 4, maxRows: 2});
    const top = clamp(Math.floor(geo.skyRows / 3) - 1, 1, Math.max(1, geo.skyRows - title.rows - 3));
    canvas.typeBlock(title, Math.max(0, Math.floor((canvas.width - title.columns) / 2)), top, {fg: palette.ink, bold: true});
    const prompt = canvas.width >= 34 ? 'Space or Up to run  ·  Down to duck' : 'Space to run';
    if (top + title.rows < geo.skyRows) canvas.center(top + title.rows, prompt, {fg: palette.accent, bold: true});
  }
}

/** The one-line note for a canvas smaller than the game can use. */
export function drawTooSmall(canvas: Canvas, palette: ArcadePalette): void {
  canvas.clear();
  const note = `Needs at least ${MIN_COLUMNS}x${MIN_ROWS}`;
  canvas.text(0, Math.floor(canvas.height / 2), note.slice(0, Math.max(0, canvas.width)), {fg: palette.warn});
}
