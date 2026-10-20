import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {typeset} from '../../../ui/typography.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {clamp} from '../../easing.js';
import type {ParticleSystem, Popups, Trail} from '../../effects.js';
import {skyAt, type ArcadePalette} from '../../palette.js';
import {OB_W} from './physics.js';
import type {Obstacle, ObstacleStyle} from './course.js';
import {catSprite, HB_X, HB_Y, type CatLook} from './sprites.js';
import type {FlightWorld} from './world.js';

/** The playfield is one half-block pixel layer (width = columns, height = 2 x rows) over a gradient of cell backgrounds. */
export const MIN_COLUMNS = 30;
export const MIN_ROWS = 16;
/** Rows of pixels reserved above the play area (a cloud bank that carries the HUD) and for the ground. */
export const CEILING_PX = 2;
export const GROUND_PX = 4;
export const MIN_WORLD_H = 26;
export const MAX_WORLD_H = 56;
/** World distance for one full day/night cycle. */
export const DAY_PX = 9000;

/** The world height (px, even) a canvas of this many rows gets. It is fixed when a run starts. */
export function worldHeightFor(rows: number): number {
  const play = Math.max(0, rows * 2 - CEILING_PX - GROUND_PX);
  return 2 * Math.floor(clamp(play, MIN_WORLD_H, MAX_WORLD_H) / 2);
}

export interface Geometry {
  width: number;
  height: number;
  /** Screen pixel row of world y = 0 and of the ground surface (both even, so the ground starts on a cell edge). */
  top: number;
  groundY: number;
  /** Screen pixels per world pixel vertically: 1, less when the canvas shrank below the world during a run. */
  scale: number;
  /** Screen column of the cat's hitbox. */
  catX: number;
}

export function geometry(columns: number, rows: number, worldHeight: number): Geometry {
  const height = rows * 2;
  const play = Math.max(2, height - CEILING_PX - GROUND_PX);
  const used = 2 * Math.floor(Math.min(worldHeight, play) / 2);
  const top = CEILING_PX + 2 * Math.floor((play - used) / 4);
  return {width: columns, height, top, groundY: top + used, scale: used / worldHeight, catX: clamp(Math.floor(columns * 0.2), 8, 28)};
}

export interface SceneView {
  world: FlightWorld;
  alpha: number;
  palette: ArcadePalette;
  /** Backdrop, parallax, clouds, stars and glass: off without color, where every lit pixel would be the same solid block. */
  decor: boolean;
  reduced: boolean;
  visualMs: number;
  look: CatLook;
  particles: ParticleSystem;
  trail: Trail;
  popups: Popups;
  shake: {x: number; y: number};
  flash: number;
  /** 0..1: how far the scene has faded toward dusk after a crash. */
  fade: number;
  score: number;
  best: number;
  /** 0..1 while the score counter is celebrating a point. */
  pop: number;
  phase: 'ready' | 'playing' | 'over';
}

const hash = (value: number): number => {
  let h = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

/** The palette with every color drawn toward dusk: the frozen scene after a crash. */
export function toned(palette: ArcadePalette, amount: number): ArcadePalette {
  if (amount <= 0) return palette;
  const mix = (color: Rgb): Rgb => mixRgb(color, palette.dusk, amount * 0.55);
  return {
    ...palette, ink: mix(palette.ink), muted: mix(palette.muted), faint: mix(palette.faint), accent: mix(palette.accent), accentSoft: mix(palette.accentSoft),
    line: mix(palette.line), haze: mix(palette.haze), warn: mix(palette.warn),
    cat: {body: mix(palette.cat.body), shade: mix(palette.cat.shade), eye: palette.cat.eye, belly: mix(palette.cat.belly), whisker: mix(palette.cat.whisker)},
  };
}

interface Tones { edge: Rgb; light: Rgb; books: Rgb[]; wood: Rgb; woodDark: Rgb; glass: Rgb; glassLight: Rgb; ink: Rgb }

export class FlightScene {
  private buffer = new PixelBuffer(0, 0);

  draw(canvas: Canvas, view: SceneView): void {
    const geo = geometry(canvas.width, canvas.height, view.world.height);
    if (this.buffer.width !== geo.width || this.buffer.height !== geo.height) this.buffer = new PixelBuffer(geo.width, geo.height);
    const palette = toned(view.palette, view.fade);
    const {world} = view;
    const buffer = this.buffer;
    buffer.clear();
    const x = world.prevX + (world.x - world.prevX) * view.alpha;
    const y = world.prevY + (world.y - world.prevY) * view.alpha;
    const sky = skyAt(palette, 0.08 + x / DAY_PX);
    const lift = (color: Rgb): Rgb => (view.flash > 0 ? mixRgb(color, palette.haze, view.flash * 0.7) : color);
    const ground = mixRgb(palette.dusk, palette.deep, 0.45);
    const groundRow = geo.groundY / 2;

    canvas.clear(lift(sky.bottom));
    for (let row = 0; row < groundRow; row += 1) canvas.fill(0, row, canvas.width, 1, ' ', {bg: lift(mixRgb(sky.top, sky.bottom, (row + 0.5) / groundRow))});
    canvas.fill(0, groundRow, canvas.width, canvas.height - groundRow, ' ', {bg: ground});

    if (view.decor) this.backdrop(view, geo, x, sky, palette);
    this.ceiling(view, geo, x, sky, palette);
    this.ground(canvas, buffer, view, geo, x, ground, palette);

    const tones = this.tones(palette, sky);
    const camera = x - geo.catX;
    const sy = (value: number): number => Math.round(geo.top + value * geo.scale);
    for (const obstacle of world.course.obstacles) {
      const left = Math.round(obstacle.x - camera);
      if (left >= geo.width) break;
      if (left + OB_W < 0) continue;
      this.obstacle(buffer, obstacle, left, geo.top, sy(obstacle.gapTop), sy(obstacle.gapBottom), geo.groundY, tones, view.decor);
    }

    if (view.decor) { view.trail.draw(buffer, palette.accent, sky.bottom); view.particles.draw(buffer, sky.bottom); }
    const sprite = catSprite(view.look, palette);
    buffer.sprite(sprite, geo.catX - HB_X, sy(y) - HB_Y, true);
    if (!view.decor) view.particles.draw(buffer);

    canvas.blit(buffer, view.shake.x, view.shake.y);
    if (view.decor) view.popups.draw(canvas, sky.top);
    this.hud(canvas, view, geo, palette);
  }

  private tones(palette: ArcadePalette, sky: {top: Rgb; bottom: Rgb}): Tones {
    return {
      edge: mixRgb(palette.deep, palette.accent, 0.25), light: mixRgb(palette.haze, palette.ink, 0.5),
      books: [palette.accent, palette.accentSoft, mixRgb(palette.accent, palette.haze, 0.45), palette.muted],
      wood: mixRgb(palette.accent, palette.dusk, 0.55), woodDark: mixRgb(palette.accent, palette.deep, 0.7),
      glass: mixRgb(sky.bottom, palette.haze, 0.3), glassLight: mixRgb(sky.bottom, palette.haze, 0.8), ink: palette.ink,
    };
  }

  /** One obstacle: a top part above the gap and a bottom part below it, each `OB_W` wide. Plain mode draws hollow outlines. */
  private obstacle(buffer: PixelBuffer, obstacle: Obstacle, left: number, ceilingY: number, gapTop: number, gapBottom: number, groundY: number, tones: Tones, decor: boolean): void {
    for (const part of [{from: ceilingY, to: gapTop, upper: true}, {from: gapBottom, to: groundY, upper: false}]) {
      for (let py = part.from; py < part.to; py += 1) {
        // Distance from the gap end of this part: 0 at the lip.
        const d = part.upper ? part.to - 1 - py : py - part.from;
        for (let column = 0; column < OB_W; column += 1) {
          const color = decor ? obstacleColor(obstacle.style, obstacle.id, column, d, tones) : plainColor(column, d, py, tones);
          if (color) buffer.set(left + column, py, color);
        }
      }
    }
  }

  /** Stars at night, two layers of clouds, distant hills and a nearer line of rooftops, each scrolling at its own fraction. */
  private backdrop(view: SceneView, geo: Geometry, x: number, sky: {top: Rgb; bottom: Rgb; stars: number}, palette: ArcadePalette): void {
    const buffer = this.buffer;
    const still = view.reduced;
    const span = geo.width + 40;
    if (sky.stars > 0.05) {
      const count = Math.floor((geo.width * geo.groundY) / 120);
      const twinkle = still ? 0 : Math.floor(view.visualMs / 450);
      for (let index = 0; index < count; index += 1) {
        const dim = (index + twinkle) % 7 === 0 ? 0.35 : 1;
        buffer.set(hash(index * 2) % geo.width, geo.top + (hash(index * 2 + 1) % Math.max(1, geo.groundY - geo.top - 8)), mixRgb(sky.top, palette.ink, clamp(sky.stars * 0.75 * dim, 0, 1)));
      }
    }
    const drift = still ? 0 : view.visualMs * 0.004;
    for (const layer of [{count: 4, factor: 0.07, mix: 0.3, seed: 0, w: 12}, {count: 4, factor: 0.18, mix: 0.5, seed: 50, w: 8}]) {
      const cloud = mixRgb(sky.bottom, palette.haze, layer.mix);
      for (let index = 0; index < layer.count; index += 1) {
        const cx = Math.round(((((hash(index + layer.seed) % span) - x * layer.factor - drift * (layer.factor * 6)) % span) + span) % span - 20);
        const cy = geo.top + 3 + (hash(index + layer.seed + 40) % Math.max(2, Math.floor((geo.groundY - geo.top) / 2)));
        buffer.ellipse(cx, cy, layer.w, 3, cloud);
        buffer.ellipse(cx + 2, cy - 1, Math.round(layer.w / 2), 3, cloud);
      }
    }
    const far = mixRgb(sky.bottom, palette.dusk, 0.5);
    const near = mixRgb(sky.bottom, palette.deep, 0.55);
    for (let column = 0; column < geo.width; column += 1) {
      const u = column + x * 0.1;
      const hill = Math.max(1, Math.round(5 + 3 * Math.sin(u * 0.07) + 2 * Math.sin(u * 0.19 + 1.3)));
      buffer.rect(column, geo.groundY - hill, 1, hill, far);
      const v = column + x * 0.28;
      const block = Math.floor(v / 9);
      const roof = 2 + (hash(block) % 5);
      const inside = v - block * 9;
      if (inside < 7) buffer.rect(column, geo.groundY - roof, 1, roof, near);
      if (inside === 3 && hash(block + 99) % 3 === 0) buffer.rect(column, geo.groundY - roof - 2, 1, 2, near);
    }
  }

  /** The cloud bank across the top (it carries the score) and a bright line on the ceiling the cat cannot pass. */
  private ceiling(view: SceneView, geo: Geometry, x: number, sky: {top: Rgb; bottom: Rgb}, palette: ArcadePalette): void {
    const buffer = this.buffer;
    if (view.decor) {
      const bank = mixRgb(sky.top, palette.haze, 0.22);
      buffer.rect(0, 0, geo.width, geo.top, bank);
      // A scalloped lower edge, scrolling slowly with the world.
      for (let column = 0; column < geo.width; column += 1) {
        if (Math.sin((column + x * 0.2) * 0.45) > 0.2) buffer.set(column, geo.top, mixRgb(bank, palette.haze, 0.2));
      }
    }
    buffer.rect(0, geo.top - 1, geo.width, 1, view.decor ? mixRgb(palette.accent, palette.haze, 0.2) : palette.ink);
  }

  private ground(canvas: Canvas, buffer: PixelBuffer, view: SceneView, geo: Geometry, x: number, ground: Rgb, palette: ArcadePalette): void {
    buffer.rect(0, geo.groundY, geo.width, 1, palette.accent);
    buffer.rect(0, geo.groundY + 1, geo.width, 1, mixRgb(palette.accent, ground, 0.55));
    const scroll = Math.floor(x);
    const texture = geo.groundY / 2 + 1;
    for (let column = 0; column < geo.width; column += 1) {
      const n = hash(column + scroll) % 9;
      if (texture < canvas.height && n < 3) canvas.put(column, texture, n === 0 ? '·' : ':', {fg: palette.faint, bg: ground});
      if (!view.decor && geo.groundY / 2 < canvas.height) canvas.put(column, geo.groundY / 2 + 1, '▒', {fg: palette.faint, bg: ground});
    }
  }

  private hud(canvas: Canvas, view: SceneView, geo: Geometry, palette: ArcadePalette): void {
    const lit = view.pop > 0;
    const block = typeset({role: 'counter', text: String(Math.min(view.score, 99999)), maxColumns: 12, maxRows: canvas.height >= 22 ? 2 : 1});
    canvas.typeBlock(block, Math.max(0, Math.floor((canvas.width - block.columns) / 2)), 0, {fg: lit ? palette.accent : palette.ink, bold: true, underline: lit});
    if (canvas.width >= 34) canvas.text(1, 0, `HI ${Math.min(view.best, 99999)}`, {fg: palette.muted});
    if (view.phase !== 'ready') return;
    const play = geo.groundY - geo.top;
    const title = typeset({role: 'title', text: 'Vespyr Flight', maxColumns: canvas.width - 4, maxRows: 2});
    const top = clamp(geo.top + Math.floor(play / 8), 2, Math.max(2, Math.floor(geo.groundY / 2) - title.rows - 4));
    canvas.typeBlock(title, Math.max(0, Math.floor((canvas.width - title.columns) / 2)), top, {fg: palette.ink, bold: true});
    const prompt = canvas.width >= 30 ? 'Space or Up to flap' : 'Space to flap';
    if (top + title.rows < geo.groundY / 2) canvas.center(top + title.rows, prompt, {fg: palette.accent, bold: true});
  }
}

/** The color of one obstacle pixel (undefined is see-through). `d` is the distance from the lip of its part, `column` 0..OB_W-1. */
export function obstacleColor(style: ObstacleStyle, id: number, column: number, d: number, tones: Tones): Rgb | undefined {
  const side = column === 0 || column === OB_W - 1;
  if (d < 2) return side ? tones.edge : tones.light;
  switch (style) {
    case 'books': {
      const band = Math.floor(d / 4);
      if (side) return tones.edge;
      if (d % 4 === 3) return tones.edge;
      const base = tones.books[(band + id) % tones.books.length]!;
      return d % 4 === 1 && (column === 2 || column === 5) ? tones.light : base;
    }
    case 'glass':
      if (side) return tones.edge;
      if (d % 9 === 8) return tones.glassLight;
      return column === 2 ? tones.glassLight : tones.glass;
    case 'crates': {
      const row = d % 8;
      if (side || row === 0 || row === 7) return tones.woodDark;
      return column === row || column === 7 - row ? tones.woodDark : tones.wood;
    }
  }
}

/** Without color every lit pixel is the same block, so an obstacle is a hollow outline with a dotted fill and a solid lip. */
function plainColor(column: number, d: number, py: number, tones: Tones): Rgb | undefined {
  if (d < 2 || column === 0 || column === OB_W - 1) return tones.ink;
  return (column + py) % 2 === 0 ? tones.ink : undefined;
}

/** The one-line note for a canvas smaller than the game can use. */
export function drawTooSmall(canvas: Canvas, palette: ArcadePalette): void {
  canvas.clear();
  const note = `Needs at least ${MIN_COLUMNS}x${MIN_ROWS}`;
  canvas.text(0, Math.floor(canvas.height / 2), note.slice(0, Math.max(0, canvas.width)), {fg: palette.warn});
}
