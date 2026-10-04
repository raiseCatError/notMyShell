import {CellGrid, mixPacked, NO_COLOR_VALUE, pack} from './CellGrid.js';
import {fromOklch, toOklch} from '../chroma/color.js';
import type {Rgb} from '../chroma/escape.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {UI_COLORS} from '../ui/palette.js';
import {CAT_PIXELS} from './catSprite.js';
import type {ScreenCapture} from './screenCapture.js';
import {effectLoops, renderScreenEffect, type ScreenEffectId} from './screenEffects.js';

/**
 * Idle visuals: deterministic, bounded, terminal-native scenes. Every scene is
 * a pure function of (size, time, seed, palette): no randomness, no wall
 * clock, no allocation beyond the reused CellGrid. Motion is calm (no rapid
 * flashing) and particle counts are capped independently of terminal size.
 */
export const IDLE_MODES = ['aurora', 'deepSpace', 'warp', 'rain', 'sparkles', 'fireworks', 'vespyr', 'random', 'blackHole', 'screenFireworks', 'circletastic', 'raiseCatError'] as const;
export type IdleMode = typeof IDLE_MODES[number];
export const IDLE_MODE_LABELS: Record<IdleMode, string> = {
  aurora: 'Aurora Drift', deepSpace: 'Deep Space', warp: 'Warp Starfield', rain: 'Rain', sparkles: 'Sparkles',
  fireworks: 'Night Fireworks', vespyr: 'Bouncing Vespyr',
  random: 'Random', blackHole: 'Black Hole', screenFireworks: 'Fireworks', circletastic: 'Circletastic', raiseCatError: 'raiseCatError',
};
export const IDLE_MODE_NOTES: Record<IdleMode, string> = {
  aurora: 'slow aurora curtains over a starry night sky',
  deepSpace: 'a calm field of distant stars with gentle parallax',
  warp: 'stars streaking outward from a vanishing point',
  rain: 'soft falling light streaks',
  sparkles: 'sparse sparkles that brighten and fade',
  fireworks: 'occasional bursts with gentle gravity',
  vespyr: 'Vespyr the NMSh cat bouncing around',
  random: 'one of all available screen savers, changing only after a full loop',
  blackHole: 'your screen text spirals into a black hole, then rebuilds',
  screenFireworks: 'shells launch across your screen and burst through its text',
  circletastic: 'your screen text gathers into spinning rings, flies apart, and reforms',
  raiseCatError: 'a cat wanders your screen and raises silly, fictional errors about what it finds',
};
/** Calm scenes repaint less often; the ceiling is 10 frames per second. */
export const IDLE_FRAME_MS: Record<IdleMode, number> = {
  aurora: 160, deepSpace: 250, warp: 100, rain: 100, sparkles: 150, fireworks: 100, vespyr: 125,
  random: 66, blackHole: 66, screenFireworks: 66, circletastic: 66, raiseCatError: 66,
};
/** Modes that become a still calm field under Reduced Motion. */
export const HIGH_MOTION: ReadonlySet<IdleMode> = new Set(['warp', 'rain', 'sparkles', 'fireworks', 'vespyr', 'random', 'blackHole', 'screenFireworks', 'circletastic', 'raiseCatError']);
/** Modes that animate a capture of the visible screen. */
export const SCREEN_MODE_EFFECT: Partial<Record<IdleMode, ScreenEffectId>> = {blackHole: 'blackHole', screenFireworks: 'fireworks', circletastic: 'circletastic', raiseCatError: 'raiseCatError'};

export interface IdlePalette {
  /** Accent stops, packed 0xRRGGBB. */
  stops: number[];
  /** Night sky near the horizon and at the top. */
  sky: number;
  skyTop: number;
  star: number;
  warm: number;
}

export interface SceneOptions {
  /** Elapsed scene time in ms (deterministic under NMSH_DETERMINISTIC). */
  time: number;
  seed: number;
  palette: IdlePalette;
  level: ColorLevel;
  /** Nerd/Unicode glyphs, or Safe ASCII-leaning glyphs. */
  nerd: boolean;
  /** The captured visible screen; present for screen-saver modes. */
  capture?: ScreenCapture;
}

/** Palette for idle visuals from accent stops: a dark sky tinted toward their hue. */
export function idlePalette(stops: readonly Rgb[]): IdlePalette {
  const list = stops.length ? stops : [{red: 166, green: 124, blue: 243}];
  const hues = list.map(color => toOklch(color));
  const hue = hues[0]!.h;
  return {
    stops: list.slice(0, 6).map(pack),
    sky: pack(fromOklch({l: 0.17, c: 0.035, h: hue})),
    skyTop: pack(fromOklch({l: 0.1, c: 0.025, h: hue})),
    star: pack(fromOklch({l: 0.96, c: 0.015, h: hue})),
    warm: pack(fromOklch({l: 0.86, c: 0.07, h: 70})),
  };
}

/** Integer hash to [0, 1). */
export function noise(seed: number, index: number, salt = 0): number {
  let n = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 0x100000000;
}

/** Smooth 1-D value noise in [0, 1). */
function smooth(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return noise(seed, i) * (1 - u) + noise(seed, i + 1) * u;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;

function skyRow(palette: IdlePalette, y: number, height: number): number {
  return mixPacked(palette.skyTop, palette.sky, Math.pow(y / Math.max(1, height - 1), 1.3));
}

function fillSky(grid: CellGrid, palette: IdlePalette, level: ColorLevel): void {
  if (level === 'none') { grid.clear(NO_COLOR_VALUE); return; }
  grid.clear(NO_COLOR_VALUE);
  for (let y = 0; y < grid.height; y++) {
    const color = skyRow(palette, y, grid.height);
    for (let x = 0; x < grid.width; x++) grid.bg[y * grid.width + x] = color;
  }
}

/** Twinkle stays gentle: amplitude 15 %, periods of several seconds, never a blink. */
function drawStars(grid: CellGrid, options: SceneOptions, density: number, maxStars: number, salt: number, drift = 0): void {
  const {seed, palette, nerd, time} = options;
  const count = Math.min(maxStars, Math.round(grid.width * grid.height * density));
  for (let i = 0; i < count; i++) {
    const layer = noise(seed, i, salt + 3);
    const speed = drift * (0.25 + layer);
    const x = ((noise(seed, i, salt) * grid.width + time / 1000 * speed) % grid.width + grid.width) % grid.width;
    const y = noise(seed, i, salt + 1) * grid.height;
    const base = 0.3 + 0.7 * Math.pow(noise(seed, i, salt + 2), 1.6) * (0.45 + 0.55 * layer);
    const twinkle = 0.85 + 0.15 * Math.sin(time / (2200 + 2600 * noise(seed, i, salt + 4)) * TAU + noise(seed, i, salt + 5) * TAU);
    const brightness = base * twinkle;
    const big = noise(seed, i, salt + 6) > 0.985 && layer > 0.5;
    const tint = noise(seed, i, salt + 7);
    const hue = tint > 0.94 ? palette.warm : tint > 0.75 ? palette.stops[i % palette.stops.length]! : palette.star;
    const sky = grid.getBg(Math.floor(x), Math.floor(y));
    const color = mixPacked(sky === NO_COLOR_VALUE ? 0 : sky, hue, Math.min(1, brightness));
    const glyph = big ? (nerd ? '✦' : '*') : brightness > 0.7 ? (nerd ? '•' : '+') : (nerd ? '·' : '.');
    grid.plot(x, y, glyph, options.level === 'none' ? NO_COLOR_VALUE : color);
  }
}

// ---- Aurora Drift -------------------------------------------------------------

/**
 * Aurora as a few layered bands across the sky. Each band has a folding lower
 * edge, vertical rays that fade upward from that edge, and bright patches
 * that drift slowly sideways. Colors run from one stop at the edge to the
 * next stop at the top of the rays; light adds over the night sky.
 */
interface AuroraLayer {base: number; fold1: number; fold2: number; height: number; drift: number; bottom: number; top: number; breathe: number; salt: number; strength: number}

function auroraLayers(options: SceneOptions): AuroraLayer[] {
  const {seed, palette} = options;
  const t = options.time / 1000;
  const n = palette.stops.length;
  return Array.from({length: 3}, (_, l) => ({
    base: 0.5 + 0.12 * l - 0.06 * noise(seed, l, 111),
    fold1: t / (26 + 10 * noise(seed, l, 112)) * TAU + l * 2.3,
    fold2: t / (17 + 8 * noise(seed, l, 113)) * TAU + l * 0.9,
    height: 0.34 - 0.06 * l,
    drift: t * (0.9 + 0.7 * noise(seed, l, 114)) * (l % 2 ? -1 : 1),
    bottom: palette.stops[l % n]!,
    top: palette.stops[(l + 1) % n]!,
    breathe: 0.78 + 0.22 * Math.sin(t / (13 + 6 * noise(seed, l, 115)) * TAU + l * 1.9),
    salt: seed + 131 * (l + 1),
    strength: 1 - 0.22 * l,
  }));
}

interface AuroraColumn {edge: number; height: number; patch: number; ray: number}

/** Per-column layer geometry, computed once per frame per column. */
function auroraColumn(x: number, width: number, layer: AuroraLayer): AuroraColumn {
  const xn = x / Math.max(1, width);
  const edge = layer.base + 0.07 * Math.sin(xn * 5.1 + layer.fold1) + 0.035 * Math.sin(xn * 13.7 - layer.fold2)
    + 0.03 * (smooth(x * 0.08 + layer.drift * 0.3, layer.salt) - 0.5);
  const height = layer.height * (0.65 + 0.55 * smooth(x * 0.05 + layer.drift * 0.2, layer.salt + 1));
  // Patches: bright stretches of curtain that drift sideways, separated by quieter sky.
  const patch = smoothstep(0.28, 0.72, smooth(x * 0.03 + layer.drift * 0.08, layer.salt + 2)) * 0.85
    + 0.15 * smooth(x * 0.11 - layer.drift * 0.05, layer.salt + 3);
  // Rays: fine vertical streaks, mostly a function of x, changing slowly.
  const ray = Math.pow(0.35 + 0.65 * smooth(x * 0.75 + layer.drift * 0.25, layer.salt + 4), 1.4);
  return {edge, height, patch, ray};
}

function auroraLight(yn: number, layer: AuroraLayer, column: AuroraColumn): {intensity: number; mix: number} {
  const d = (column.edge - yn) / column.height;
  let curtain = 0;
  // Rays fade upward from the edge; a luminous rim sits right at it; light falls off softly below.
  if (d >= 0 && d <= 1) curtain = (Math.pow(1 - d, 1.8) + 0.55 * Math.exp(-Math.pow(d / 0.07, 2))) * column.ray;
  else if (d < 0) curtain = 1.55 * Math.exp(-Math.pow((yn - column.edge) / 0.035, 2)) * column.ray;
  const glow = 0.12 * Math.exp(-Math.pow((yn - column.edge + column.height * 0.35) / (column.height * 0.8), 2));
  return {intensity: (curtain + glow) * column.patch * layer.breathe * layer.strength, mix: Math.max(0, Math.min(1, d))};
}

/** Rounds each channel to a multiple of 4: invisible in a gradient, fewer distinct escapes. */
function quantize(color: number): number {
  return color & 0xfcfcfc;
}

function aurora(grid: CellGrid, options: SceneOptions): void {
  const {width, height} = grid;
  const layers = auroraLayers(options);
  const columns = layers.map(layer => Array.from({length: width}, (_, x) => auroraColumn(x, width, layer)));
  const sample = (x: number, yn: number, sky: number): {color: number; light: number} => {
    let r = (sky >> 16) & 0xff, g = (sky >> 8) & 0xff, b = sky & 0xff, light = 0;
    for (let l = 0; l < layers.length; l++) {
      const layer = layers[l]!;
      const {intensity, mix} = auroraLight(yn, layer, columns[l]![x]!);
      if (intensity < 0.004) continue;
      light += intensity;
      const tone = mixPacked(layer.bottom, layer.top, mix);
      r += ((tone >> 16) & 0xff) * intensity;
      g += ((tone >> 8) & 0xff) * intensity;
      b += (tone & 0xff) * intensity;
    }
    return {color: ((Math.min(255, Math.round(r)) << 16) | (Math.min(255, Math.round(g)) << 8) | Math.min(255, Math.round(b))) & 0xffffff, light};
  };
  const h2 = height * 2;
  if (options.level === 'none') {
    grid.clear(NO_COLOR_VALUE);
    drawStars(grid, options, 0.012, 160, 11);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const {light} = sample(x, (y * 2 + 1) / h2, 0);
        if (light > 0.6) grid.set(x, y, '|', NO_COLOR_VALUE);
        else if (light > 0.32) grid.set(x, y, ':', NO_COLOR_VALUE);
        else if (light > 0.16) grid.set(x, y, '.', NO_COLOR_VALUE);
      }
    }
    return;
  }
  fillSky(grid, options.palette, options.level);
  const lights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const sky = skyRow(options.palette, y, height);
    for (let x = 0; x < width; x++) {
      const top = sample(x, (y * 2) / h2, sky);
      const bottom = sample(x, (y * 2 + 1) / h2, sky);
      const index = y * width + x;
      // Light quantization lets neighbouring cells share escapes; equal halves need no glyph at all.
      const upper = quantize(top.color), lower = quantize(bottom.color);
      grid.glyphs[index] = upper === lower ? ' ' : '▀';
      grid.fg[index] = upper;
      grid.bg[index] = lower;
      lights[index] = (top.light + bottom.light) / 2;
    }
  }
  // Stars show between and behind faint curtain light.
  const {seed, palette, nerd, time} = options;
  const count = Math.min(240, Math.round(width * height * 0.022));
  for (let i = 0; i < count; i++) {
    const x = Math.floor(noise(seed, i, 11) * width), y = Math.floor(noise(seed, i, 12) * height * 0.92);
    const index = y * width + x;
    const behind = lights[index]!;
    if (behind > 0.35) continue;
    const brightness = (0.35 + 0.65 * Math.pow(noise(seed, i, 13), 2)) * (0.85 + 0.15 * Math.sin(time / (2500 + 2500 * noise(seed, i, 14)) * TAU + i)) * (1 - behind * 2);
    const bg = mixPacked(grid.fg[index]!, grid.bg[index]!, 0.5);
    grid.glyphs[index] = noise(seed, i, 15) > 0.975 ? (nerd ? '✦' : '*') : (nerd ? '·' : '.');
    grid.fg[index] = mixPacked(bg, noise(seed, i, 16) > 0.9 ? palette.warm : palette.star, Math.max(0, brightness));
    grid.bg[index] = bg;
  }
}

// ---- Deep Space -----------------------------------------------------------------

function deepSpace(grid: CellGrid, options: SceneOptions): void {
  fillSky(grid, {...options.palette, sky: mixPacked(options.palette.skyTop, 0, 0.3), skyTop: mixPacked(options.palette.skyTop, 0, 0.5)}, options.level);
  // Three depth layers drift at different speeds for a slow parallax.
  drawStars(grid, options, 0.06, 420, 21, 0.15);
  drawStars(grid, options, 0.03, 220, 41, 0.4);
  drawStars(grid, options, 0.012, 90, 61, 0.85);
}

// ---- Warp Starfield -----------------------------------------------------------------

const lineGlyph = (dx: number, dy: number, nerd: boolean): string => {
  if (Math.abs(dx) > Math.abs(dy) * 2) return nerd ? '─' : '-';
  if (Math.abs(dy) * 2 > Math.abs(dx) * 1.2) return nerd ? '│' : '|';
  return (dx > 0) === (dy > 0) ? (nerd ? '╲' : '\\') : (nerd ? '╱' : '/');
};

function warpPosition(i: number, time: number, seed: number, width: number, height: number): {col: number; row: number; z: number} {
  const speed = 0.16 + 0.22 * noise(seed, i, 201);
  const cycle = time / 1000 * speed + noise(seed, i, 202);
  const k = Math.floor(cycle);
  const z = 1 - (cycle - k) * 0.94;
  const angle = noise(seed, i * 977 + k, 203) * TAU;
  const radius = 0.06 + 0.94 * Math.sqrt(noise(seed, i * 977 + k, 204));
  const scale = Math.min(width / 2, height) * 0.5;
  return {col: width / 2 + (Math.cos(angle) * radius / z) * scale * 2, row: height / 2 + (Math.sin(angle) * radius / z) * scale, z};
}

function warp(grid: CellGrid, options: SceneOptions): void {
  const {width, height} = grid;
  fillSky(grid, {...options.palette, sky: mixPacked(options.palette.skyTop, 0, 0.4), skyTop: mixPacked(options.palette.skyTop, 0, 0.6)}, options.level);
  const count = Math.min(320, Math.round(width * height * 0.07));
  const {seed, palette, nerd, time, level} = options;
  for (let i = 0; i < count; i++) {
    const head = warpPosition(i, time, seed, width, height);
    const tail = warpPosition(i, Math.max(0, time - 220), seed, width, height);
    if (tail.z < head.z) continue; // Respawned this frame: no streak across the screen.
    const brightness = Math.pow(1 - head.z, 0.8);
    const tint = noise(seed, i, 205) > 0.7 ? palette.stops[i % palette.stops.length]! : palette.star;
    const dx = head.col - tail.col, dy = head.row - tail.row;
    const length = Math.min(12, Math.max(Math.abs(dx), Math.abs(dy) * 2));
    const steps = Math.max(1, Math.round(length));
    const glyph = lineGlyph(dx, dy, nerd);
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const x = tail.col + dx * u, y = tail.row + dy * u;
      const fade = brightness * (0.25 + 0.75 * u);
      const sky = grid.getBg(Math.max(0, Math.min(width - 1, Math.floor(x))), Math.max(0, Math.min(height - 1, Math.floor(y))));
      const color = level === 'none' ? NO_COLOR_VALUE : mixPacked(sky === NO_COLOR_VALUE ? 0 : sky, tint, Math.min(1, fade + 0.15));
      grid.plot(x, y, s === steps ? (length < 1.2 ? (head.z > 0.55 ? (nerd ? '·' : '.') : (nerd ? '•' : '*')) : glyph) : glyph, color);
    }
  }
}

// ---- Rain -------------------------------------------------------------------------

function rain(grid: CellGrid, options: SceneOptions): void {
  const {width, height} = grid;
  fillSky(grid, options.palette, options.level);
  const {seed, palette, nerd, time, level} = options;
  const drops = Math.min(160, Math.max(4, Math.round(width * 0.4)));
  for (let i = 0; i < drops; i++) {
    const depth = noise(seed, i, 301);
    const speed = 5 + 16 * depth;
    const length = 2 + Math.round(depth * 4);
    const travel = height + length;
    const y = ((time / 1000 * speed + noise(seed, i, 302) * travel) % travel) - length;
    const cycle = Math.floor((time / 1000 * speed + noise(seed, i, 302) * travel) / travel);
    const x = Math.floor(noise(seed, i * 31 + cycle, 303) * width);
    const tint = palette.stops[i % palette.stops.length]!;
    for (let s = 0; s < length; s++) {
      const row = Math.floor(y) - s;
      if (row < 0 || row >= height) continue;
      const fade = (1 - s / length) * (0.35 + 0.65 * depth);
      const sky = grid.getBg(x, row);
      const color = level === 'none' ? NO_COLOR_VALUE
        : mixPacked(sky === NO_COLOR_VALUE ? 0 : sky, s === 0 ? mixPacked(tint, palette.star, 0.5) : tint, fade);
      grid.plot(x, row, depth < 0.25 ? (nerd ? '╎' : ':') : (nerd ? '│' : '|'), color);
    }
  }
}

// ---- Sparkles ---------------------------------------------------------------------

function sparkles(grid: CellGrid, options: SceneOptions): void {
  const {width, height} = grid;
  fillSky(grid, options.palette, options.level);
  const {seed, palette, nerd, time, level} = options;
  const count = Math.min(200, Math.max(6, Math.round(width * height * 0.025)));
  for (let i = 0; i < count; i++) {
    const period = 2600 + 2600 * noise(seed, i, 401);
    const cycle = time / period + noise(seed, i, 402);
    const k = Math.floor(cycle);
    const u = cycle - k;
    const intensity = Math.pow(Math.sin(Math.PI * u), 2);
    if (intensity < 0.12) continue;
    const x = noise(seed, i * 53 + k, 403) * width + Math.sin(u * TAU) * 0.4;
    const y = noise(seed, i * 53 + k, 404) * height - u * 1.2;
    const glyph = intensity > 0.78 ? (nerd ? '✦' : '*') : intensity > 0.45 ? (nerd ? '✧' : '+') : (nerd ? '·' : '.');
    const tint = mixPacked(palette.stops[i % palette.stops.length]!, palette.star, intensity * 0.35);
    const sky = grid.getBg(Math.max(0, Math.min(width - 1, Math.floor(x))), Math.max(0, Math.min(height - 1, Math.floor(y))));
    grid.plot(x, y, glyph, level === 'none' ? NO_COLOR_VALUE : mixPacked(sky === NO_COLOR_VALUE ? 0 : sky, tint, intensity));
  }
}

// ---- Fireworks --------------------------------------------------------------------

const LAUNCH_PERIOD = 1700;
const RISE = 1100;
const BURST = 1800;

function fireworks(grid: CellGrid, options: SceneOptions): void {
  const {width, height} = grid;
  fillSky(grid, {...options.palette, sky: mixPacked(options.palette.skyTop, 0, 0.3)}, options.level);
  drawStars(grid, options, 0.004, 40, 501);
  const {seed, palette, nerd, time, level} = options;
  const latest = Math.floor(time / LAUNCH_PERIOD);
  for (let k = latest - 2; k <= latest; k++) {
    if (k < 0) continue;
    const start = k * LAUNCH_PERIOD + noise(seed, k, 502) * 600;
    const tau = time - start;
    if (tau < 0 || tau > RISE + BURST) continue;
    const x0 = width * (0.15 + 0.7 * noise(seed, k, 503));
    const burstY = height * (0.15 + 0.35 * noise(seed, k, 504));
    const color = palette.stops[k % palette.stops.length]!;
    const second = palette.stops[(k + 1) % palette.stops.length]!;
    const sky = (x: number, y: number) => {
      const value = grid.getBg(Math.max(0, Math.min(width - 1, Math.floor(x))), Math.max(0, Math.min(height - 1, Math.floor(y))));
      return value === NO_COLOR_VALUE ? 0 : value;
    };
    if (tau < RISE) {
      const p = 1 - Math.pow(1 - tau / RISE, 2);
      const y = height - 1 - (height - 1 - burstY) * p;
      const x = x0 + Math.sin(p * 3) * 0.6;
      grid.plot(x, y, nerd ? '•' : '*', level === 'none' ? NO_COLOR_VALUE : mixPacked(color, palette.star, 0.6));
      for (let trail = 1; trail <= 2; trail++) {
        grid.plot(x, y + trail, nerd ? '·' : '.', level === 'none' ? NO_COLOR_VALUE : mixPacked(sky(x, y + trail), color, 0.55 / trail));
      }
      continue;
    }
    const burstTime = (tau - RISE) / 1000;
    const geometry = Math.floor(noise(seed, k, 505) * 3); // ring, sphere, willow
    const particles = geometry === 0 ? 28 : geometry === 1 ? 36 : 24;
    const gravity = geometry === 2 ? 9 : 6;
    const reach = Math.min(width / 2, height) * (geometry === 2 ? 0.28 : 0.4);
    // Full brightness for most of the burst, then a calm fade: the droop under gravity stays visible.
    const life = (tau - RISE) / BURST;
    const fade = life < 0.6 ? 1 : Math.max(0, 1 - (life - 0.6) / 0.4);
    for (let j = 0; j < particles; j++) {
      const angle = j / particles * TAU + noise(seed, k * 97 + j, 506) * 0.25;
      // Every geometry gets a little per-particle variation so bursts never look stamped.
      const speed = (geometry === 1 ? 0.45 + 0.55 * Math.sqrt(noise(seed, k * 97 + j, 507)) : 1) * (0.86 + 0.28 * noise(seed, k * 97 + j, 508));
      const travel = (1 - Math.exp(-burstTime * 2.6)) * reach * speed;
      for (const [lag, dim] of (geometry === 2 ? [[0, 1], [0.12, 0.65], [0.26, 0.4], [0.4, 0.22]] : [[0, 1], [0.1, 0.6], [0.2, 0.3]]) as ReadonlyArray<readonly [number, number]>) {
        const tb = Math.max(0, burstTime - lag);
        const along = (1 - Math.exp(-tb * 2.6)) * reach * speed;
        const x = x0 + Math.cos(angle) * along * 2;
        const y = burstY + Math.sin(angle) * along + 0.5 * gravity * tb * tb;
        // Bright and saturated: a fresh burst starts near white and settles into its color.
        const tint = mixPacked(j % 3 === 0 && geometry === 1 ? second : color, palette.star, Math.max(0.25, 0.75 - burstTime * 0.8));
        const glyph = lag ? (nerd ? '·' : '.') : life < 0.25 ? (nerd ? '✦' : '*') : life < 0.7 ? (nerd ? '•' : '+') : (nerd ? '·' : '.');
        grid.plot(x, y, glyph, level === 'none' ? NO_COLOR_VALUE : mixPacked(sky(x, y), tint, fade * dim));
      }
      void travel;
    }
  }
}

// ---- Bouncing Vespyr --------------------------------------------------------------

/** The approved Vespyr pixels live in catSprite.ts (shared with raiseCatError). */
const CAT = CAT_PIXELS;
const CAT_WIDTH = 14;
const CAT_HEIGHT = 4;
const BODY = pack({red: 172, green: 150, blue: 230});
const EYE = pack({red: 22, green: 18, blue: 32});
const ASCII_CAT = [' /\\_/\\ ', '( o.o )', ' > ^ < '];

/** Position on a bounce path: a triangle wave over [0, span]. */
function bounce(distance: number, span: number): {value: number; forward: boolean} {
  if (span <= 0) return {value: 0, forward: true};
  const period = span * 2;
  const p = ((distance % period) + period) % period;
  return p <= span ? {value: p, forward: true} : {value: period - p, forward: false};
}

export function vespyrPosition(time: number, seed: number, width: number, height: number, spriteWidth = CAT_WIDTH, spriteHeight = CAT_HEIGHT):
{x: number; y: number; facingRight: boolean; corner: boolean} {
  const t = time / 1000;
  const horizontal = bounce(t * 7 + noise(seed, 1, 601) * width, Math.max(0, width - spriteWidth));
  const vertical = bounce(t * 2.4 + noise(seed, 2, 601) * height, Math.max(0, height - spriteHeight));
  const nearX = horizontal.value < 0.5 || horizontal.value > width - spriteWidth - 0.5;
  const nearY = vertical.value < 0.25 || vertical.value > height - spriteHeight - 0.25;
  return {x: Math.round(horizontal.value), y: Math.round(vertical.value), facingRight: horizontal.forward, corner: nearX && nearY};
}

function vespyr(grid: CellGrid, options: SceneOptions): void {
  const {width, height} = grid;
  fillSky(grid, options.palette, options.level);
  drawStars(grid, options, 0.01, 90, 701, 0.1);
  const {time, seed, level, nerd, palette} = options;
  if (level === 'none') {
    const position = vespyrPosition(time, seed, width, height, 7, 3);
    ASCII_CAT.forEach((line, row) => { [...line].forEach((glyph, column) => { if (glyph !== ' ') grid.set(position.x + column, position.y + row, glyph, NO_COLOR_VALUE); }); });
    return;
  }
  const position = vespyrPosition(time, seed, width, height);
  // An occasional calm blink: closed for 160 ms every ~6.4 s.
  const blinking = (time % 6400) < 160;
  for (let row = 0; row < CAT_HEIGHT; row++) {
    for (let column = 0; column < CAT_WIDTH; column++) {
      // Mirror horizontally to face the direction of travel; never flip vertically.
      const source = position.facingRight ? CAT_WIDTH - 1 - column : column;
      const top = CAT[row * 2]![source]!, bottom = CAT[row * 2 + 1]![source]!;
      const color = (pixel: string, upper: boolean) => pixel === 'L' ? BODY : pixel === 'E' ? (blinking && upper ? BODY : EYE) : -2;
      const fg = color(top, true), bg = color(bottom, false);
      if (fg === -2 && bg === -2) continue;
      const x = position.x + column, y = position.y + row;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = y * width + x;
      const sky = grid.bg[index]!;
      grid.glyphs[index] = fg === -2 ? '▄' : '▀';
      grid.fg[index] = fg === -2 ? bg : fg;
      grid.bg[index] = fg === -2 || bg === -2 ? sky : bg;
    }
  }
  // Whiskers either side of the face (as in the Welcome cat), mirrored with the sprite.
  for (const source of [0, 6]) {
    const column = position.facingRight ? CAT_WIDTH - 1 - source : source;
    grid.plot(position.x + column, position.y + 1, '=', pack({red: 150, green: 142, blue: 172}));
  }
  // A tiny, rare sparkle when it reaches a corner exactly.
  if (position.corner) {
    for (let j = 0; j < 4; j++) {
      grid.plot(position.x + CAT_WIDTH / 2 + Math.cos(j * Math.PI / 2) * 9, position.y + 2 + Math.sin(j * Math.PI / 2) * 3, nerd ? '✦' : '*', palette.stops[j % palette.stops.length]!);
    }
  }
}

function screenScene(effect: ScreenEffectId) {
  return (grid: CellGrid, options: SceneOptions): void => {
    // Without a capture there is nothing of the user's to animate: show the calm star field instead.
    if (!options.capture) { deepSpace(grid, options); return; }
    const {palette} = options;
    renderScreenEffect(effect, grid, options.capture, {time: options.time, nerd: options.nerd, color: options.level !== 'none',
      palette: {stops: palette.stops, text: 0xc8c8d4, error: pack(UI_COLORS.failure), warn: 0xe5c07b, accent: palette.stops[0] ?? 0xa67cf3}});
  };
}

const SCENES: Record<IdleMode, (grid: CellGrid, options: SceneOptions) => void> = {aurora, deepSpace, warp, rain, sparkles, fireworks, vespyr,
  random: screenScene('blackHole'), blackHole: screenScene('blackHole'), screenFireworks: screenScene('fireworks'), circletastic: screenScene('circletastic'), raiseCatError: screenScene('raiseCatError')};

/** Paint one frame of `mode` into `grid`. */
export function renderScene(mode: IdleMode, grid: CellGrid, options: SceneOptions): void {
  (SAVER_REGISTRY.find(entry => entry.id === mode)?.render ?? SCENES[mode] ?? deepSpace)(grid, options);
}

/** The scene shown for a mode under Reduced Motion: calm modes hold still; high-motion modes become a still star field. */
export function reducedMotionScene(mode: IdleMode): IdleMode {
  return HIGH_MOTION.has(mode) ? 'deepSpace' : mode;
}


// ---- registry ----------------------------------------------------------------
/**
 * The canonical list of screen savers. Random derives its candidates from this
 * registry (everything except itself and entries marked `randomEligible:
 * false`), so registering a saver here is all a new one needs; Random has no
 * list of its own. `loop` says when one natural loop has completed:
 * stateful screen effects report their own loop counter, scenes that are
 * pure functions of time declare their cycle length.
 */
export interface SaverDescriptor {
  id: string;
  /** Default true. False only for manual-only, debugging or test entries. */
  randomEligible?: boolean;
  /** Stateless scene cycle in ms for a given size; ambient scenes with no natural boundary declare a fixed dwell. */
  cycleMs?: (size: {width: number; height: number}) => number;
  /** Stateful screen effect whose own loop counter marks the boundary. */
  effect?: ScreenEffectId;
  /** Custom renderer for a saver registered outside this file. */
  render?: (grid: CellGrid, options: SceneOptions) => void;
}

const SPARKLE_CYCLE = 5200;
export const SAVER_REGISTRY: SaverDescriptor[] = [
  {id: 'aurora', cycleMs: () => 40_000}, {id: 'deepSpace', cycleMs: () => 30_000}, {id: 'warp', cycleMs: () => 20_000}, {id: 'rain', cycleMs: () => 20_000},
  {id: 'sparkles', cycleMs: () => SPARKLE_CYCLE * 4},
  {id: 'fireworks', cycleMs: () => LAUNCH_PERIOD * 6},
  // One full vertical round trip of the bouncing cat.
  {id: 'vespyr', cycleMs: ({height}) => Math.max(1, (2 * Math.max(1, height - CAT_HEIGHT)) / 2.4) * 1000},
  {id: 'random', randomEligible: false},
  {id: 'blackHole', effect: 'blackHole'}, {id: 'screenFireworks', effect: 'fireworks'}, {id: 'circletastic', effect: 'circletastic'}, {id: 'raiseCatError', effect: 'raiseCatError'},
];

export function randomCandidates(registry: readonly SaverDescriptor[] = SAVER_REGISTRY): string[] {
  return registry.filter(entry => entry.id !== 'random' && entry.randomEligible !== false).map(entry => entry.id);
}

/** Next Random choice: from the registry, never the previous one when there is a choice. */
export function pickRandomSaver(rng: () => number, previous?: string, registry: readonly SaverDescriptor[] = SAVER_REGISTRY): string | undefined {
  const all = randomCandidates(registry);
  const options = all.length > 1 ? all.filter(id => id !== previous) : all;
  return options.length ? options[Math.floor(rng() * options.length)] : undefined;
}

/** True once the saver has completed one natural loop since it started (`elapsed` ms of its own scene time). */
export function saverLoopComplete(id: string, state: {elapsed: number; width: number; height: number; capture?: ScreenCapture},
  registry: readonly SaverDescriptor[] = SAVER_REGISTRY): boolean {
  const entry = registry.find(item => item.id === id);
  if (!entry) return true;
  if (entry.effect && state.capture) return effectLoops(state.capture, entry.effect) >= 1;
  return entry.cycleMs ? state.elapsed >= entry.cycleMs(state) : false;
}
