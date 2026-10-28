/**
 * Procedural logo animation: frames NMSh generates in memory from one still raster, for the native welcome. No file is
 * read or written, nothing is shelled out, and the result is an ordinary `DecodedAnimation`, so it is shown through the
 * same frame path as a GIF or APNG welcome image (Kitty graphics, sixel, character art).
 *
 * The source is reduced first (at most `LOGO_ANIMATION_LIMITS.pixels`), every preset fits the shared animation budget
 * (frames, decoded bytes, total time), and generation is deterministic: the same raster and preset give the same frames.
 * The last frame is always the (reduced) still image itself, so "Once" settles exactly on the picture.
 */
import {ANIMATION_LIMITS, type DecodedAnimation} from './animation.js';
import type {Raster} from './raster.js';
import {scaleBox} from './scale.js';

export const LOGO_ANIMATIONS = ['off', 'assemble', 'shine', 'glow', 'glitch', 'embers'] as const;
export type LogoAnimation = typeof LOGO_ANIMATIONS[number];
export const LOGO_PLAYS = ['once', 'loop'] as const;
export type LogoPlay = typeof LOGO_PLAYS[number];

export const LOGO_ANIMATION_LIMITS = Object.freeze({
  /** Longest side and pixel count of the reduced working raster. */
  longSide: 360, pixels: 90_000,
  /** A gentle loop settles on the still after this long, even if nothing else stopped it. */
  loopPlayMs: 30_000,
});

export interface GeneratedLogoAnimation extends DecodedAnimation {
  preset: Exclude<LogoAnimation, 'off'>;
  play: LogoPlay;
  /** Frames from here repeat after the intro (a loop); `frames.length` when the animation plays once. */
  loopFrom: number;
  /** The longest time the animation plays before it shows its last frame (the still). */
  playMs: number;
}

/** One preset's timing. Intro frames, then (loop only) a rest on the still, the loop motif and another rest. */
interface Plan {intro: number; introStep: number; motif: number; motifStep: number; rest: number}
const PLANS: Record<Exclude<LogoAnimation, 'off'>, Plan> = {
  assemble: {intro: 2040, introStep: 60, motif: 1200, motifStep: 80, rest: 880},
  shine: {intro: 1440, introStep: 60, motif: 900, motifStep: 60, rest: 1300},
  glow: {intro: 1800, introStep: 60, motif: 1600, motifStep: 100, rest: 800},
  glitch: {intro: 1080, introStep: 60, motif: 360, motifStep: 60, rest: 1700},
  embers: {intro: 2040, introStep: 60, motif: 1600, motifStep: 80, rest: 680},
};

/** Frames and total time a preset uses; tests and admission read this, generation follows it. */
export function logoAnimationShape(preset: Exclude<LogoAnimation, 'off'>, play: LogoPlay): {frames: number; totalMs: number} {
  const plan = PLANS[preset];
  const intro = Math.round(plan.intro / plan.introStep), motif = Math.round(plan.motif / plan.motifStep);
  return play === 'once' ? {frames: intro + 1, totalMs: plan.intro + 100} : {frames: intro + 1 + motif + 1, totalMs: plan.intro + plan.rest * 2 + plan.motif};
}

/** Reduce the still before generating so every frame fits the budget. */
export function logoWorkingSize(width: number, height: number, frames: number): {width: number; height: number} {
  const budgetPixels = Math.floor(ANIMATION_LIMITS.maxDecodedBytes / (4 * Math.max(1, frames)));
  const pixels = Math.min(LOGO_ANIMATION_LIMITS.pixels, budgetPixels);
  let scale = Math.min(1, LOGO_ANIMATION_LIMITS.longSide / Math.max(width, height), Math.sqrt(pixels / Math.max(1, width * height)));
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  return {width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale))};
}

export function generateLogoAnimation(source: Raster, preset: Exclude<LogoAnimation, 'off'>, play: LogoPlay): GeneratedLogoAnimation {
  const shape = logoAnimationShape(preset, play);
  const size = logoWorkingSize(source.width, source.height, shape.frames);
  const still = size.width === source.width && size.height === source.height ? {width: source.width, height: source.height, data: source.data.slice()} : scaleBox(source, size.width, size.height);
  const scene = new Scene(still, seedFor(preset, still));
  const plan = PLANS[preset];
  const draw = DRAW[preset];
  const frames: DecodedAnimation['frames'] = [];
  const steps = (span: number, step: number) => Array.from({length: Math.round(span / step)}, (_, i) => i * step);
  for (const t of steps(plan.intro, plan.introStep)) frames.push({raster: draw(scene, 'intro', t / 1000, plan.intro / 1000), delayMs: plan.introStep});
  let loopFrom = frames.length + 1;
  if (play === 'once') { frames.push({raster: copy(still), delayMs: 100}); loopFrom = frames.length; }
  else {
    frames.push({raster: copy(still), delayMs: plan.rest});
    for (const t of steps(plan.motif, plan.motifStep)) frames.push({raster: draw(scene, 'motif', t / 1000, plan.motif / 1000), delayMs: plan.motifStep});
    frames.push({raster: copy(still), delayMs: plan.rest});
  }
  const totalMs = frames.reduce((sum, frame) => sum + frame.delayMs, 0);
  return {width: still.width, height: still.height, frames, loopCount: play === 'once' ? 1 : 0, truncated: false, preset, play, loopFrom,
    playMs: play === 'once' ? totalMs : LOGO_ANIMATION_LIMITS.loopPlayMs};
}

function copy(raster: Raster): Raster { return {width: raster.width, height: raster.height, data: raster.data.slice()}; }
function seedFor(preset: string, raster: Raster): number {
  let hash = 2166136261;
  for (const char of `${preset}:${raster.width}x${raster.height}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
/** mulberry32: small, fast and deterministic. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a: number, b: number, v: number) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
const easeInOut = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

interface Point {x: number; y: number; r: number; g: number; b: number}

/** What every preset needs to know about the still: alpha, edges, colors and seeded sample points. */
class Scene {
  readonly width: number; readonly height: number; readonly size: number;
  readonly alpha: Float32Array;
  readonly edge: Float32Array;
  readonly opaque: Point[] = [];
  readonly edges: Point[] = [];
  readonly tops: Point[] = [];
  readonly bounds: {left: number; top: number; right: number; bottom: number};
  private haloCache?: {light: Float32Array; reach: number};
  constructor(readonly still: Raster, readonly seed: number) {
    const {width, height, data} = still;
    this.width = width; this.height = height; this.size = Math.max(8, Math.min(width, height));
    this.alpha = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) this.alpha[i] = data[i * 4 + 3]! / 255;
    this.edge = new Float32Array(width * height);
    const d = Math.max(1, Math.round(this.size / 140));
    const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? 0 : this.alpha[y * width + x]!;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, a = this.alpha[i]!;
      if (a <= 0.5) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      const low = Math.min(at(x - d, y), at(x + d, y), at(x, y - d), at(x, y + d));
      const lum = (0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!) / 255;
      const point = {x, y, r: data[i * 4]!, g: data[i * 4 + 1]!, b: data[i * 4 + 2]!};
      this.opaque.push(point);
      const edge = a * (1 - low);
      this.edge[i] = edge;
      if (edge > 0.4) { this.edges.push(point); if (at(x, y - d) < 0.5 && lum > 0.2) this.tops.push(point); }
    }
    // A logo without transparency still animates: its rim is the image border.
    if (!this.edges.length) for (const p of this.opaque) if (p.x === 0 || p.y === 0 || p.x === width - 1 || p.y === height - 1) this.edges.push(p);
    if (!this.tops.length) this.tops.push(...this.edges.filter(p => p.y <= (top + (bottom - top) * 0.6)));
    this.bounds = right < 0 ? {left: 0, top: 0, right: width - 1, bottom: height - 1} : {left, top, right, bottom};
  }
  rng(salt: number): () => number { return random(this.seed ^ Math.imul(salt + 1, 0x9e3779b1)); }
  /** A fresh premultiplied float canvas. */
  canvas(): Float32Array { return new Float32Array(this.width * this.height * 4); }
  /** The still, premultiplied, with alpha and light multipliers per pixel. */
  logo(buf: Float32Array, opacity = 1, lift?: (i: number, x: number, y: number) => number, cover?: (i: number) => number): void {
    const {data} = this.still;
    for (let y = 0, i = 0; y < this.height; y++) for (let x = 0; x < this.width; x++, i++) {
      const a = this.alpha[i]! * opacity * (cover ? cover(i) : 1);
      if (a <= 0) continue;
      const k = lift ? lift(i, x, y) : 0;
      const o = i * 4;
      for (let c = 0; c < 3; c++) { const v = data[o + c]! / 255; buf[o + c] = buf[o + c]! * (1 - a) + (v + (1 - v) * k) * a; }
      buf[o + 3] = buf[o + 3]! * (1 - a) + a;
    }
  }
  /** Additive light: brightens what is there and lights transparent pixels with its own color. */
  light(buf: Float32Array, x: number, y: number, radius: number, r: number, g: number, b: number, k: number): void {
    if (k <= 0.002 || radius <= 0) return;
    const reach = Math.ceil(radius * 2.2);
    const x0 = Math.max(0, Math.floor(x - reach)), x1 = Math.min(this.width - 1, Math.ceil(x + reach));
    const y0 = Math.max(0, Math.floor(y - reach)), y1 = Math.min(this.height - 1, Math.ceil(y + reach));
    const inv = 1 / (radius * radius);
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const d2 = ((px - x) ** 2 + (py - y) ** 2) * inv;
      if (d2 > 4.8) continue;
      const w = k * Math.exp(-d2 * 1.4);
      const o = (py * this.width + px) * 4;
      buf[o] = buf[o]! + r * w; buf[o + 1] = buf[o + 1]! + g * w; buf[o + 2] = buf[o + 2]! + b * w; buf[o + 3] = buf[o + 3]! + w;
    }
  }
  /** A four-point glint: a hot core with thin horizontal and vertical rays. */
  star(buf: Float32Array, x: number, y: number, length: number, r: number, g: number, b: number, k: number): void {
    if (k <= 0.002 || length < 1) return;
    const thick = Math.max(0.7, length / 12);
    const reach = Math.ceil(length);
    for (let py = Math.max(0, Math.floor(y - reach)); py <= Math.min(this.height - 1, Math.ceil(y + reach)); py++) {
      for (let px = Math.max(0, Math.floor(x - reach)); px <= Math.min(this.width - 1, Math.ceil(x + reach)); px++) {
        const dx = Math.abs(px - x), dy = Math.abs(py - y);
        const ray = Math.max(Math.exp(-(dy * dy) / (thick * thick)) * Math.max(0, 1 - dx / length) ** 2,
          Math.exp(-(dx * dx) / (thick * thick)) * Math.max(0, 1 - dy / length) ** 2);
        const core = Math.exp(-(dx * dx + dy * dy) / (thick * thick * 4));
        const w = k * Math.min(1, ray + core);
        if (w <= 0.002) continue;
        const o = (py * this.width + px) * 4;
        buf[o] = buf[o]! + r * w; buf[o + 1] = buf[o + 1]! + g * w; buf[o + 2] = buf[o + 2]! + b * w; buf[o + 3] = buf[o + 3]! + w;
      }
    }
  }
  /** The halo: a blurred, outside-only copy of the logo's own colors (computed once). */
  halo(): {light: Float32Array; reach: number} {
    if (this.haloCache) return this.haloCache;
    const {width, height} = this;
    const reach = Math.max(2, Math.round(this.size * 0.045));
    let field: Float32Array = new Float32Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const a = this.alpha[i]!;
      for (let c = 0; c < 3; c++) field[i * 4 + c] = this.still.data[i * 4 + c]! / 255 * a;
      field[i * 4 + 3] = a;
    }
    for (let pass = 0; pass < 3; pass++) field = blur(blur(field, width, height, reach, 1, 0), width, height, reach, 0, 1);
    for (let i = 0; i < width * height; i++) {
      const a = field[i * 4 + 3]!;
      const outside = 1 - this.alpha[i]!;
      // Lift halo colors toward white a little so dark logos still read as glowing.
      for (let c = 0; c < 3; c++) { const color = a > 0.001 ? field[i * 4 + c]! / a : 0; field[i * 4 + c] = (color + (1 - color) * 0.25) * a * outside; }
      field[i * 4 + 3] = a * outside;
    }
    this.haloCache = {light: field, reach};
    return this.haloCache;
  }
  /** Premultiplied float canvas to straight-alpha RGBA. Added light over a full pixel brightens it. */
  raster(buf: Float32Array): Raster {
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    for (let o = 0; o < data.length; o += 4) {
      const a = Math.min(1, buf[o + 3]!);
      if (a <= 0.002) continue;
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(Math.min(1, buf[o + c]! / a) * 255);
      data[o + 3] = Math.round(a * 255);
    }
    return {width: this.width, height: this.height, data};
  }
}

function blur(src: Float32Array, width: number, height: number, radius: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;
  const lines = dx ? height : width, length = dx ? width : height;
  const index = (line: number, pos: number) => (dx ? line * width + pos : pos * width + line) * 4;
  const sum = new Float64Array(4);
  for (let line = 0; line < lines; line++) {
    sum.fill(0);
    for (let pos = -radius; pos <= radius; pos++) if (pos >= 0 && pos < length) for (let c = 0; c < 4; c++) sum[c] = sum[c]! + src[index(line, pos) + c]!;
    for (let pos = 0; pos < length; pos++) {
      const o = index(line, pos);
      for (let c = 0; c < 4; c++) out[o + c] = sum[c]! / span;
      const leave = pos - radius, enter = pos + radius + 1;
      if (leave >= 0) for (let c = 0; c < 4; c++) sum[c] = sum[c]! - src[index(line, leave) + c]!;
      if (enter < length) for (let c = 0; c < 4; c++) sum[c] = sum[c]! + src[index(line, enter) + c]!;
    }
  }
  return out;
}

const pick = <T>(list: readonly T[], rnd: () => number): T => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))]!;
const hot = (p: Point, k: number) => [(p.r / 255) + (1 - p.r / 255) * k, (p.g / 255) + (1 - p.g / 255) * k, (p.b / 255) + (1 - p.b / 255) * k] as const;

type Draw = (scene: Scene, part: 'intro' | 'motif', t: number, span: number) => Raster;

/** Sparks drift in, gather into the logo's shape and the picture forms out of their light; the motif twinkles. */
const assemble: Draw = (scene, part, t, span) => {
  const buf = scene.canvas();
  const {width, height, size, bounds} = scene;
  if (part === 'motif') return twinkle(scene, buf, t, span);
  const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
  const reach = Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top) / 2 + 1;
  // Pixels form from the center outwards with a little grain, each one lit as it appears.
  const formAt = formTimes(scene, cx, cy, reach);
  scene.logo(buf, 1, i => {
    const at = formAt[i]!;
    return (1 - smooth(at, at + 0.25, t)) * 0.85 + Math.max(0, 1 - Math.abs(t - at - 0.1) / 0.14) * 0.3;
  }, i => smooth(formAt[i]!, formAt[i]! + 0.25, t));
  const rnd = scene.rng(1);
  const count = Math.max(60, Math.min(170, Math.round(scene.opaque.length / 150)));
  const radius = Math.max(1, size / 85);
  for (let n = 0; n < count && scene.opaque.length; n++) {
    const p = pick(scene.opaque, rnd);
    // Sparks start scattered on a loose ring around the logo, inside the picture.
    const angle = rnd() * Math.PI * 2, distance = Math.min(reach * (0.55 + rnd() * 0.75), Math.min(width, height) * (0.3 + rnd() * 0.2));
    const sx = Math.max(0, Math.min(width - 1, cx + Math.cos(angle) * distance)), sy = Math.max(0, Math.min(height - 1, cy + Math.sin(angle) * distance));
    const appear = rnd() * 0.6, leave = 0.35 + rnd() * 0.35, arrive = leave + 0.55 + rnd() * 0.45;
    const swirl = (rnd() - 0.5) * size * 0.35, twinklePhase = rnd() * Math.PI * 2;
    const progress = easeInOut(clamp01((t - leave) / (arrive - leave)));
    const bend = Math.sin(Math.PI * progress) * swirl;
    const dx = p.x - sx, dy = p.y - sy, len = Math.hypot(dx, dy) || 1;
    const x = sx + dx * progress - (dy / len) * bend, y = sy + dy * progress + (dx / len) * bend;
    const fadeIn = smooth(appear, appear + 0.18, t);
    const settle = 1 - smooth(arrive, arrive + 0.35, t);
    const flicker = 0.7 + 0.3 * Math.sin(t * 22 + twinklePhase);
    const k = fadeIn * settle * flicker * (progress > 0 && progress < 1 ? 1 : 0.75);
    const [r, g, b] = hot(p, 0.35);
    scene.light(buf, x, y, radius * (1 + 0.6 * (1 - progress)), r, g, b, k * 0.9);
    // A short tail while travelling.
    if (progress > 0.02 && progress < 0.98) scene.light(buf, x - dx * 0.035, y - dy * 0.035, radius * 0.8, r, g, b, k * 0.35);
  }
  // As the picture completes, one bright glint marks it done.
  const glint = scene.edges.length ? glintPoint(scene) : undefined;
  if (glint) {
    const g = Math.max(0, 1 - Math.abs(t - (span - 0.28)) / 0.22);
    scene.star(buf, glint.x, glint.y, size * 0.16 * (0.5 + g), 1, 1, 1, g);
  }
  return scene.raster(buf);
};

const FORM = new WeakMap<Scene, Float32Array>();
/** When each pixel of the logo appears during Assemble (seconds): center first, with grain. */
function formTimes(scene: Scene, cx: number, cy: number, reach: number): Float32Array {
  let times = FORM.get(scene);
  if (times) return times;
  times = new Float32Array(scene.width * scene.height);
  for (let y = 0, i = 0; y < scene.height; y++) for (let x = 0; x < scene.width; x++, i++) {
    times[i] = 0.95 + 0.55 * clamp01(Math.hypot(x - cx, y - cy) / reach * 0.85 + (hash2(x, y, scene.seed) - 0.5) * 0.2);
  }
  FORM.set(scene, times);
  return times;
}

/** Small deterministic per-pixel noise in 0..1. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The upper-right bright rim point: where a glint reads as light catching the logo. */
function glintPoint(scene: Scene): Point {
  let best = scene.edges[0]!, score = -Infinity;
  for (const p of scene.edges) {
    const s = (p.x / scene.width) - (p.y / scene.height) * 1.2 + (p.r + p.g + p.b) / 765 * 0.3;
    if (s > score) { score = s; best = p; }
  }
  return best;
}

/** Gentle loop for Assemble: a few glints on the rim and some drifting dust. */
function twinkle(scene: Scene, buf: Float32Array, t: number, span: number): Raster {
  scene.logo(buf);
  const rnd = scene.rng(11);
  const glints = Math.min(5, Math.max(2, Math.round(scene.edges.length / 400)));
  for (let n = 0; n < glints && scene.edges.length; n++) {
    const p = pick(scene.edges, rnd);
    const born = (n / glints) * (span - 0.45) + rnd() * 0.12, life = 0.42;
    const k = Math.sin(Math.PI * clamp01((t - born) / life));
    const [r, g, b] = hot(p, 0.7);
    scene.star(buf, p.x, p.y, scene.size * 0.11 * (0.6 + 0.4 * k), r, g, b, k);
  }
  for (let n = 0; n < 14 && scene.opaque.length; n++) {
    const p = pick(scene.opaque, rnd);
    const phase = rnd();
    const k = Math.sin(Math.PI * ((t / span + phase) % 1)) ** 2 * 0.45;
    const drift = (t / span) * scene.size * 0.06;
    const [r, g, b] = hot(p, 0.5);
    scene.light(buf, p.x + Math.cos(phase * 6.28) * drift, p.y - drift, Math.max(0.8, scene.size / 140), r, g, b, k);
  }
  return scene.raster(buf);
}

/** A specular band sweeps over the logo's own pixels; its rim catches the light; a glint finishes the pass. */
const shine: Draw = (scene, part, t, span) => {
  const buf = scene.canvas();
  const {width, height} = scene;
  const sweepStart = part === 'intro' ? 0.1 : 0, sweepEnd = part === 'intro' ? 1.1 : span * 0.85;
  const strength = part === 'intro' ? 1 : 0.7;
  const p = clamp01((t - sweepStart) / (sweepEnd - sweepStart));
  const u = -0.12 + 1.24 * (0.6 * p + 0.4 * easeInOut(p));
  const {bounds} = scene;
  const bw = Math.max(1, bounds.right - bounds.left), bh = Math.max(1, bounds.bottom - bounds.top);
  const across = (x: number, y: number) => ((x - bounds.left) / bw) * 0.75 + ((y - bounds.top) / bh) * 0.25;
  void width; void height;
  const band = (x: number, y: number) => {
    const d = across(x, y) - u;
    return Math.exp(-(d * d) / 0.0025) * 0.95 + Math.exp(-(d * d) / 0.03) * 0.32;
  };
  const opening = part === 'intro' ? smooth(0, 0.12, t) : 1;
  scene.logo(buf, 0.6 + 0.4 * opening, (i, x, y) => strength * band(x, y) * (0.75 + 0.5 * scene.edge[i]!));
  // Light spills a little past the rim where the band crosses it.
  if (t > sweepStart && t < sweepEnd + 0.05) {
    for (const p of scene.edges) {
      const k = band(p.x, p.y) * strength;
      if (k > 0.25 && hash2(p.x, p.y, scene.seed) < 0.35) scene.light(buf, p.x, p.y, Math.max(1, scene.size / 90), 1, 1, 1, k * 0.22);
    }
  }
  const glint = scene.edges.length ? glintPoint(scene) : undefined;
  if (glint) {
    const at = sweepEnd + 0.08, g = Math.max(0, 1 - Math.abs(t - at) / 0.2) * strength;
    scene.star(buf, glint.x, glint.y, scene.size * 0.15 * (0.5 + g), 1, 1, 1, g);
  }
  return scene.raster(buf);
};

/** A soft halo in the logo's own colors blooms in, then breathes out; the motif is one slow breath. */
const glow: Draw = (scene, part, t, span) => {
  const buf = scene.canvas();
  const level = part === 'intro'
    ? (smooth(0, 0.45, t) * (1 - 0.6 * smooth(0.5, 0.9, t)) + 0.35 * Math.sin(Math.PI * clamp01((t - 0.85) / 0.6)) ** 2) * (1 - smooth(1.25, span - 0.06, t))
    : 0.75 * Math.sin(Math.PI * t / span) ** 2;
  const fade = part === 'intro' ? smooth(0, 0.35, t) : 1;
  const {light} = scene.halo();
  const gain = 2.6 * level;
  const {width, height} = scene, margin = Math.max(2, scene.size * 0.06);
  for (let o = 0; o < light.length; o += 4) {
    if (light[o + 3]! <= 0.001) continue;
    // The halo thins out toward the picture's border so it never ends in a hard edge.
    const x = (o / 4) % width, y = Math.floor(o / 4 / width);
    const border = smooth(0, margin, Math.min(x, y, width - 1 - x, height - 1 - y));
    for (let c = 0; c < 4; c++) buf[o + c] = light[o + c]! * gain * border;
  }
  scene.logo(buf, fade, i => level * 0.45 * scene.edge[i]! + level * 0.08);
  return scene.raster(buf);
};

/** Cyberpunk: RGB-split ghosts, displaced slices, scanlines and flicker, resolving into the clean logo. */
const glitch: Draw = (scene, part, t, span) => {
  const frame = Math.round(t * 1000 / 60) + (part === 'motif' ? 1000 : 0);
  const rnd = scene.rng(frame);
  const level = part === 'intro'
    ? (t < 0.55 ? 0.85 + 0.15 * rnd() : (1 - smooth(0.55, span - 0.12, t)) * (0.5 + 0.5 * rnd()))
    : [0.9, 0.35, 1, 0.55, 0.25, 0.08][Math.min(5, Math.floor(t / 0.06))]!;
  const {width, height, still} = scene;
  const buf = scene.canvas();
  const shift = Math.max(1, Math.round(scene.size * 0.035 * level)) * (rnd() < 0.5 ? -1 : 1);
  // Ghosts: the logo's shape in cyan and magenta, offset either way.
  const ghost = (dx: number, r: number, g: number, b: number, k: number) => {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= width) continue;
      const a = scene.alpha[y * width + sx]! * k;
      if (a <= 0.01) continue;
      const o = (y * width + x) * 4;
      buf[o] = buf[o]! + r * a; buf[o + 1] = buf[o + 1]! + g * a; buf[o + 2] = buf[o + 2]! + b * a; buf[o + 3] = buf[o + 3]! + a;
    }
  };
  ghost(-shift, 0, 0.95, 1, 0.65 * level);
  ghost(shift, 1, 0.1, 0.75, 0.65 * level);
  // Displaced slices of the logo itself.
  const slices: Array<{top: number; bottom: number; dx: number}> = [];
  const count = level > 0.15 ? 1 + Math.floor(rnd() * 4 * level) : 0;
  for (let n = 0; n < count; n++) {
    const top = Math.floor(rnd() * height), tall = Math.max(1, Math.round(height * (0.03 + rnd() * 0.1)));
    slices.push({top, bottom: top + tall, dx: Math.round((rnd() - 0.5) * width * 0.22 * level)});
  }
  const flicker = level > 0.4 && rnd() < 0.22 ? 0.45 : 1;
  const opacity = (1 - 0.18 * level) * flicker;
  const data = still.data;
  for (let y = 0; y < height; y++) {
    const slice = slices.find(s => y >= s.top && y < s.bottom);
    const dx = slice?.dx ?? 0;
    const scan = level > 0.1 && y % 3 === 0 ? 1 - 0.35 * level : 1;
    for (let x = 0; x < width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= width) continue;
      const si = y * width + sx;
      const a = scene.alpha[si]! * opacity;
      if (a <= 0) continue;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) buf[o + c] = buf[o + c]! * (1 - a) + data[si * 4 + c]! / 255 * scan * a;
      buf[o + 3] = buf[o + 3]! * (1 - a) + a;
    }
  }
  // A few blocks of corrupted color inside the logo's bounds.
  const {bounds} = scene;
  const blocks = level > 0.3 ? Math.floor(rnd() * 3 * level) : 0;
  for (let n = 0; n < blocks; n++) {
    const bw = Math.max(2, Math.round(scene.size * (0.04 + rnd() * 0.08))), bh = Math.max(1, Math.round(scene.size * (0.01 + rnd() * 0.025)));
    const bx = bounds.left + Math.floor(rnd() * Math.max(1, bounds.right - bounds.left - bw)), by = bounds.top + Math.floor(rnd() * Math.max(1, bounds.bottom - bounds.top - bh));
    const color = rnd() < 0.5 ? [0, 1, 0.95] : [1, 0.15, 0.8];
    for (let y = by; y < Math.min(height, by + bh); y++) for (let x = bx; x < Math.min(width, bx + bw); x++) {
      const o = (y * width + x) * 4;
      const a = 0.75 * level;
      for (let c = 0; c < 3; c++) buf[o + c] = buf[o + c]! * (1 - a) + color[c]! * a;
      buf[o + 3] = buf[o + 3]! * (1 - a) + a;
    }
  }
  return scene.raster(buf);
};

/** Glowing embers lift off the logo's bright upper rims, sway, flicker and fade; the rim warms while they rise. */
const embers: Draw = (scene, part, t, span) => {
  const buf = scene.canvas();
  const fade = part === 'intro' ? smooth(0, 0.3, t) : 1;
  const rnd = scene.rng(part === 'intro' ? 3 : 5);
  const count = part === 'intro' ? Math.max(26, Math.min(60, Math.round(scene.tops.length / 12))) : Math.max(14, Math.min(28, Math.round(scene.tops.length / 25)));
  const sources = scene.tops.length ? scene.tops : scene.edges;
  let heat = 0;
  const sparks: Array<() => void> = [];
  for (let n = 0; n < count && sources.length; n++) {
    const p = pick(sources, rnd);
    const born = part === 'intro' ? 0.1 + rnd() * (span - 1.0) : rnd() * (span - 0.9);
    const life = 0.6 + rnd() * 0.35;
    const age = (t - born) / life;
    const rise = scene.size * (0.3 + rnd() * 0.3), sway = scene.size * (0.015 + rnd() * 0.03), phase = rnd() * 6.28, flick = rnd() * 6.28;
    if (age <= 0 || age >= 1) continue;
    heat += Math.sin(Math.PI * age);
    const x = p.x + Math.sin(phase + age * 5) * sway, y = p.y - easeOut(age) * rise;
    const k = Math.sin(Math.PI * Math.min(1, age * 1.6)) * (1 - age) * (0.75 + 0.25 * Math.sin(t * 30 + flick));
    // Ember color: the logo's own color at its source, warmed toward fire.
    const [r, g, b] = [(p.r / 255) * 0.45 + 0.55, (p.g / 255) * 0.45 + 0.6 * 0.55, (p.b / 255) * 0.45 + 0.22 * 0.55];
    const tx = p.x + Math.sin(phase + age * 5 - 0.4) * sway, ty = p.y - easeOut(Math.max(0, age - 0.08)) * rise;
    sparks.push(() => {
      scene.light(buf, tx, ty, Math.max(1, scene.size / 75), r, g, b, k * 0.45);
      scene.light(buf, x, y, Math.max(1.5, scene.size / 30) * (1 - age * 0.4), r, g, b, k * 0.6);
      scene.light(buf, x, y, Math.max(1, scene.size / 75), 1, 0.92, 0.75, k * 1.5);
    });
  }
  const warm = Math.min(1, heat / Math.max(4, count * 0.25)) * 0.3;
  scene.logo(buf, fade, i => warm * scene.edge[i]!);
  for (const spark of sparks) spark();
  return scene.raster(buf);
};

const DRAW: Record<Exclude<LogoAnimation, 'off'>, Draw> = {assemble, shine, glow, glitch, embers};
