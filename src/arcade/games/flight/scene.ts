import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {typeset} from '../../../ui/typography.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {clamp} from '../../easing.js';
import type {ParticleSystem, Popups, Trail} from '../../effects.js';
import type {ArcadePalette} from '../../palette.js';
import {along, disc, gradient, hash as sceneHash, rgb, skyline, stars} from '../../scenery.js';
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

const hash = sceneHash;

/**
 * Vespyr Flight's world: a moonlit city of libraries. A navy night with a large moon drifts slowly toward a violet
 * dawn and back; two skylines with warm lit windows scroll beneath; the towers Vespyr flies between are stacked books,
 * glass chimneys and crates. Everything here is cooler and higher than Vespyr Run's meadow, so the two never look alike.
 */
const NIGHT = [rgb(0x0b1030), rgb(0x1a2160), rgb(0x34378a), rgb(0x5b4ea3)];
const DAWN = [rgb(0x262a6a), rgb(0x5a58b0), rgb(0xa889d6), rgb(0xf6b4b4)];
const WINDOW = rgb(0xffd98a);
const BOOKS = [rgb(0xff8fb3), rgb(0x8fc4ff), rgb(0xffe08a), rgb(0x9fe0b8), rgb(0xffb48a), rgb(0xc9b2ff)];

export function flightSky(phase: number): {stops: Rgb[]; night: number} {
  const wrapped = ((phase % 1) + 1) % 1;
  const dawn = (1 - Math.cos(wrapped * Math.PI * 2)) / 2;
  return {stops: NIGHT.map((color, index) => mixRgb(color, DAWN[index]!, dawn * 0.85)), night: 1 - dawn};
}

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
  /** How far the frozen scene has faded after a crash (the obstacles fade with it). */
  private fade = 0;

  draw(canvas: Canvas, view: SceneView): void {
    const geo = geometry(canvas.width, canvas.height, view.world.height);
    if (this.buffer.width !== geo.width || this.buffer.height !== geo.height) this.buffer = new PixelBuffer(geo.width, geo.height);
    const palette = toned(view.palette, view.fade);
    this.fade = view.fade;
    const {world} = view;
    const buffer = this.buffer;
    buffer.clear();
    const x = world.prevX + (world.x - world.prevX) * view.alpha;
    const y = world.prevY + (world.y - world.prevY) * view.alpha;
    const {stops: clear, night} = flightSky(x / DAY_PX);
    const stops = view.fade > 0 ? clear.map(color => mixRgb(color, palette.dusk, view.fade * 0.55)) : clear;
    const sky = {top: stops[0]!, bottom: stops[stops.length - 1]!, stars: night};
    const lift = (color: Rgb): Rgb => (view.flash > 0 ? mixRgb(color, palette.haze, view.flash * 0.7) : color);
    const ground = view.decor ? rgb(0x1c1b42) : mixRgb(palette.dusk, palette.deep, 0.45);
    const groundRow = geo.groundY / 2;

    canvas.clear(view.decor ? undefined : lift(sky.bottom));
    if (view.decor) {
      gradient(buffer, stops.map(lift), 0, geo.groundY);
      buffer.rect(0, geo.groundY, geo.width, geo.height - geo.groundY, ground);
      this.backdrop(view, geo, x, sky, stops, palette);
    } else {
      for (let row = 0; row < groundRow; row += 1) canvas.fill(0, row, canvas.width, 1, ' ', {bg: lift(mixRgb(sky.top, sky.bottom, (row + 0.5) / groundRow))});
      canvas.fill(0, groundRow, canvas.width, canvas.height - groundRow, ' ', {bg: ground});
    }
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

    if (view.decor) { view.trail.draw(buffer, rgb(0xffe08a), mixRgb(rgb(0xffb48a), sky.bottom, 0.6)); view.particles.draw(buffer, sky.bottom); }
    const sprite = catSprite(view.look, palette);
    buffer.sprite(sprite, geo.catX - HB_X, sy(y) - HB_Y, true);
    if (!view.decor) view.particles.draw(buffer);

    canvas.blit(buffer, view.shake.x, view.shake.y);
    if (view.decor) view.popups.draw(canvas, sky.top);
    this.hud(canvas, view, geo, palette);
  }

  private tones(palette: ArcadePalette, sky: {top: Rgb; bottom: Rgb}): Tones {
    // Fixed, readable hazard colors (dimmed with the scene after a crash), never Vespyr's lavender.
    const dim = (color: Rgb): Rgb => mixRgb(color, palette.dusk, this.fade * 0.55);
    return {
      edge: rgb(0x14153a), light: dim(rgb(0xf7efdc)),
      books: BOOKS.map(dim),
      wood: dim(rgb(0xc98f5e)), woodDark: dim(rgb(0x6e4630)),
      glass: dim(mixRgb(rgb(0x6fd1d6), sky.bottom, 0.35)), glassLight: dim(rgb(0xd8fbff)), ink: palette.ink,
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

  /** Stars and a large moon, wisps of cloud, and two skylines with lit windows, each scrolling at its own fraction. */
  private backdrop(view: SceneView, geo: Geometry, x: number, sky: {top: Rgb; bottom: Rgb; stars: number}, stops: readonly Rgb[], palette: ArcadePalette): void {
    const buffer = this.buffer;
    const still = view.reduced;
    const span = geo.width + 40;
    stars(buffer, 5, geo.groundY - 10, rgb(0xf4f1ff), sky.top, {time: still ? 0 : view.visualMs, strength: sky.stars, scroll: x * 0.02, density: 70});
    const moonY = geo.top + (geo.groundY - geo.top) * 0.28;
    disc(buffer, geo.width * 0.72, moonY, Math.max(4, Math.round(geo.height * 0.08)), rgb(0xfaf6ff), along(stops, moonY / geo.groundY), 7);
    const drift = still ? 0 : view.visualMs * 0.004;
    for (const layer of [{count: 4, factor: 0.05, light: 0.18, seed: 0, w: 16}, {count: 3, factor: 0.14, light: 0.3, seed: 50, w: 10}]) {
      for (let index = 0; index < layer.count; index += 1) {
        const cx = Math.round(((((hash(index + layer.seed) % span) - x * layer.factor - drift * (layer.factor * 6)) % span) + span) % span - 20);
        const cy = geo.top + 3 + (hash(index + layer.seed + 40) % Math.max(2, Math.floor((geo.groundY - geo.top) / 2)));
        const behind = along(stops, cy / geo.groundY);
        buffer.ellipse(cx, cy, layer.w, 2, mixRgb(behind, rgb(0xe9e4ff), layer.light));
        buffer.ellipse(cx + 3, cy - 1, Math.round(layer.w / 2), 2, mixRgb(behind, rgb(0xe9e4ff), layer.light + 0.08));
      }
    }
    skyline(buffer, {base: geo.groundY, scroll: x * 0.09, seed: 7, color: mixRgb(sky.bottom, rgb(0x1d2257), 0.7), window: mixRgb(WINDOW, sky.bottom, 0.45), low: 8, high: Math.max(10, Math.round((geo.groundY - geo.top) * 0.42)), lit: 0.28});
    skyline(buffer, {base: geo.groundY, scroll: x * 0.26, seed: 19, color: rgb(0x12133a), window: WINDOW, low: 4, high: Math.max(6, Math.round((geo.groundY - geo.top) * 0.24)), lit: 0.18});
    void palette;
  }

  /** The cloud bank across the top (it carries the score) and a bright line on the ceiling the cat cannot pass. */
  private ceiling(view: SceneView, geo: Geometry, x: number, sky: {top: Rgb; bottom: Rgb}, palette: ArcadePalette): void {
    const buffer = this.buffer;
    if (view.decor) {
      const bank = mixRgb(sky.top, rgb(0x4a4596), 0.55);
      buffer.rect(0, 0, geo.width, geo.top, bank);
      // A scalloped lower edge, scrolling slowly with the world.
      for (let column = 0; column < geo.width; column += 1) {
        if (Math.sin((column + x * 0.2) * 0.45) > 0.2) buffer.set(column, geo.top, mixRgb(bank, rgb(0xb7aef0), 0.3));
      }
    }
    buffer.rect(0, geo.top - 1, geo.width, 1, view.decor ? rgb(0x9a8fe0) : palette.ink);
  }

  private ground(canvas: Canvas, buffer: PixelBuffer, view: SceneView, geo: Geometry, x: number, ground: Rgb, palette: ArcadePalette): void {
    const scroll = Math.floor(x);
    if (view.decor) {
      // A lamplit cobbled street: a bright curb, then stones whose joints scroll with the world.
      buffer.rect(0, geo.groundY, geo.width, 1, rgb(0x9a8fe0));
      for (let column = 0; column < geo.width; column += 1) for (let py = geo.groundY + 1; py < geo.height; py += 1) {
        const joint = (column + scroll + (py % 2) * 3) % 6 === 0 || py === geo.groundY + 3;
        buffer.set(column, py, joint ? rgb(0x14133a) : (hash((column + scroll) >> 2) % 3 === 0 ? rgb(0x2a2860) : ground));
      }
      return;
    }
    buffer.rect(0, geo.groundY, geo.width, 1, palette.accent);
    buffer.rect(0, geo.groundY + 1, geo.width, 1, mixRgb(palette.accent, ground, 0.55));
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
