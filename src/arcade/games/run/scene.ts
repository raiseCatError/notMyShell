import {mixRgb} from '../../../chroma/chroma.js';
import {typeset} from '../../../ui/typography.js';
import {Canvas, PixelBuffer} from '../../Canvas.js';
import {clamp} from '../../easing.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {ParticleSystem, Popups} from '../../effects.js';
import type {ArcadePalette} from '../../palette.js';
import {along, disc, gradient, hash as sceneHash, rgb, ridge, stars} from '../../scenery.js';
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

const hash = sceneHash;

/**
 * Vespyr Run's world: a meadow at the edge of evening. The sky's stops run from the zenith to the horizon and drift from
 * a lavender-and-peach dusk to an indigo night and back as the run goes on; three ridges scroll at their own speeds.
 */
const DUSK = [rgb(0x5d50ab), rgb(0x9c8ae4), rgb(0xd9a9d0), rgb(0xffcfa8)];
const NIGHT = [rgb(0x100d24), rgb(0x221b4a), rgb(0x382c69), rgb(0x564378)];
const GRASS = rgb(0x9fe0b8);
const GRASS_DARK = rgb(0x5aa785);
const SOIL = rgb(0x3a2c4e);
const PEBBLE = rgb(0x5b4a72);

/** The sky's stops at `phase` (0..1 around a full dusk → night → dusk cycle) and how much night there is. */
export function runSky(phase: number): {stops: Rgb[]; night: number} {
  const wrapped = ((phase % 1) + 1) % 1;
  const night = (1 - Math.cos(wrapped * Math.PI * 2)) / 2;
  return {stops: DUSK.map((color, index) => mixRgb(color, NIGHT[index]!, night)), night};
}

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
    const {stops, night} = runSky(distance / DAY_PX);
    const sky = {top: stops[0]!, bottom: stops[stops.length - 1]!, stars: night};
    const ground = view.decor ? SOIL : mixRgb(palette.dusk, palette.deep, 0.45);

    canvas.clear(view.decor ? sky.bottom : undefined);
    if (view.decor) {
      // An impact lifts the whole sky for a moment (never under Reduced Motion: the game does not trigger it then).
      gradient(buffer, view.flash > 0 ? stops.map(color => mixRgb(color, palette.haze, view.flash * 0.7)) : stops, 0, geo.groundY);
      buffer.rect(0, geo.groundY, geo.width, geo.height - geo.groundY, ground);
      this.backdrop(view, geo, distance, sky, stops, night);
    }
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

  /** Stars and the moon at night, the sun at dusk, two-tone clouds, far mountains, rolling hills and a row of bushes. */
  private backdrop(view: SceneView, geo: Geometry, distance: number, sky: {top: Rgb; bottom: Rgb}, stops: readonly Rgb[], night: number): void {
    const buffer = this.buffer;
    const still = view.reduced;
    const horizon = geo.groundY;
    stars(buffer, 11, Math.floor(horizon * 0.7), rgb(0xf4efff), sky.top, {time: still ? 0 : view.visualMs, strength: night * 1.2 - 0.15, scroll: distance * 0.01});
    // The sun sinks as night comes; the moon rises in its place.
    const sunY = horizon * (0.22 + night * 0.7);
    const moonY = horizon * (0.92 - night * 0.7);
    const cx = geo.width * 0.74;
    disc(buffer, cx, sunY, Math.max(3, Math.round(geo.height * 0.06)), rgb(0xffe2b8), along(stops, sunY / horizon), 5);
    if (night > 0.25) disc(buffer, cx - geo.width * 0.3, moonY, Math.max(2, Math.round(geo.height * 0.045)), rgb(0xf3eeff), along(stops, Math.max(0, moonY) / horizon), 4, 0.45);
    const drift = still ? 0 : view.visualMs * 0.004;
    for (let index = 0; index < 6; index += 1) {
      const span = geo.width + 40;
      const x = ((((hash(index) % span) - distance * 0.04 - drift) % span) + span) % span - 20;
      const y = 3 + (hash(index + 40) % Math.max(2, Math.floor(horizon / 3)));
      const behind = along(stops, y / horizon);
      const light = mixRgb(behind, rgb(0xfff4fb), 0.55 - night * 0.3);
      const shade = mixRgb(light, behind, 0.45);
      buffer.ellipse(Math.round(x), y + 1, 12, 3, shade);
      buffer.ellipse(Math.round(x) + 1, y, 10, 3, light);
      buffer.ellipse(Math.round(x) + 4, y - 1, 6, 3, light);
    }
    const mist = sky.bottom;
    ridge(buffer, {base: horizon, height: Math.round(horizon * 0.22), amplitude: Math.max(3, horizon * 0.1), scale: 26, scroll: distance * 0.06, seed: 3, step: 2,
      color: mixRgb(mist, rgb(0x7462b4), 0.72 + night * 0.18), rim: mixRgb(mist, rgb(0xf2e6ff), 0.45)});
    ridge(buffer, {base: horizon, height: Math.round(horizon * 0.1), amplitude: Math.max(2, horizon * 0.05), scale: 14, scroll: distance * 0.18, seed: 9, step: 1,
      color: mixRgb(rgb(0x4b3f7d), rgb(0x241e45), night), rim: mixRgb(rgb(0x7d6cb6), rgb(0x3a3168), night)});
    ridge(buffer, {base: horizon, height: 2, amplitude: 2, scale: 3.5, scroll: distance * 0.45, seed: 21, step: 1,
      color: mixRgb(rgb(0x356e62), rgb(0x1d3b39), night), rim: mixRgb(rgb(0x58a08a), rgb(0x2c5650), night)});
  }

  /** Grass with flowers along the top of the ground and pebbled soil below, scrolling with the run. */
  private groundLine(canvas: Canvas, buffer: PixelBuffer, view: SceneView, geo: Geometry, distance: number, ground: Rgb): void {
    const {palette} = view;
    const scroll = Math.floor(distance);
    if (!view.decor) {
      buffer.rect(0, geo.groundY, geo.width, 1, palette.accent);
      buffer.rect(0, geo.groundY + 1, geo.width, 1, mixRgb(palette.accent, ground, 0.55));
      const texture = geo.skyRows + 1;
      for (let x = 0; x < geo.width; x += 1) if (texture < canvas.height && hash(x + scroll) % 9 < 3) canvas.put(x, texture, hash(x + scroll) % 9 === 0 ? '·' : ':', {fg: palette.faint});
      return;
    }
    buffer.rect(0, geo.groundY, geo.width, 1, GRASS);
    buffer.rect(0, geo.groundY + 1, geo.width, 1, GRASS_DARK);
    for (let x = 0; x < geo.width; x += 1) {
      const n = hash(x + scroll);
      if (n % 13 === 0) buffer.set(x, geo.groundY - 1, GRASS);
      if (n % 37 === 0) buffer.set(x, geo.groundY - 1, n % 2 ? rgb(0xffb4c8) : rgb(0xffe08a));
      for (let y = geo.groundY + 2; y < geo.height; y += 1) if (hash((x + scroll) * 7 + y) % 11 === 0) buffer.set(x, y, PEBBLE);
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
