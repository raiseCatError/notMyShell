import {CellGrid, mixPacked, NO_COLOR_VALUE} from './CellGrid.js';
import type {ScreenCapture} from './screenCapture.js';

/**
 * The shared screen-saver engine: a seeded RNG, a fixed-timestep driver and a
 * small particle record, plus four effects that animate the captured screen
 * (Black Hole, Fireworks, Circletastic, raiseCatError). Effects are pure
 * presentation: they read the capture, own their particles, and draw into a
 * CellGrid whose cells keep the host background (no opaque fills). Cost is
 * bounded by capping animated glyphs and particles regardless of screen size.
 */
export const SCREEN_EFFECTS = ['blackHole', 'fireworks', 'circletastic', 'raiseCatError'] as const;
export type ScreenEffectId = typeof SCREEN_EFFECTS[number];

export interface EffectPalette { stops: readonly number[]; text: number; error: number; warn: number; accent: number }
export interface EffectContext { time: number; palette: EffectPalette; nerd: boolean; color: boolean }

export const STEP_MS = 50;
const MAX_STEPS_PER_DRAW = 400;
const MAX_GLYPHS = 900;
/** A terminal cell is about twice as tall as wide: x distances count half. */
export const ASPECT = 2;

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface Glyph {
  ch: string; fg: number;
  ox: number; oy: number; x: number; y: number; vx: number; vy: number;
  state: number; t: number; a: number; r: number; w: number;
}

/** Non-blank captured cells as animatable glyphs; huge screens are sampled down to a cap. */
export function glyphsOf(capture: ScreenCapture, textColor: number): Glyph[] {
  const cells: number[] = [];
  for (let i = 0; i < capture.glyphs.length; i += 1) if (capture.glyphs[i] !== ' ') cells.push(i);
  const stride = Math.max(1, Math.ceil(cells.length / MAX_GLYPHS));
  const out: Glyph[] = [];
  for (let k = 0; k < cells.length; k += stride) {
    const i = cells[k]!;
    const x = i % capture.width, y = Math.floor(i / capture.width);
    const fg = capture.fg[i]!;
    out.push({ch: capture.glyphs[i]!, fg: fg === NO_COLOR_VALUE ? textColor : fg, ox: x, oy: y, x, y, vx: 0, vy: 0, state: 0, t: 0, a: 0, r: 0, w: 0});
  }
  return out;
}

/** Cells that are not in the animated set stay exactly where they were captured. */
function drawStatic(grid: CellGrid, capture: ScreenCapture, skip: ReadonlySet<number>, textColor: number): void {
  for (let i = 0; i < capture.glyphs.length; i += 1) {
    const g = capture.glyphs[i]!;
    if (g === ' ' || skip.has(i)) continue;
    const fg = capture.fg[i]!;
    grid.set(i % capture.width, Math.floor(i / capture.width), g, fg === NO_COLOR_VALUE ? textColor : fg);
  }
}

abstract class Sim {
  t = 0;
  /** Completed major loops; Random mode switches effect only on a boundary. */
  loops = 0;
  rng: () => number;
  constructor(readonly capture: ScreenCapture, protected readonly salt: number) { this.rng = makeRng(capture.seed ^ salt); }
  abstract update(dt: number): void;
  abstract paint(grid: CellGrid, ctx: EffectContext): void;
  protected extraLoops(): number { return 0; }
  advance(toMs: number): void {
    let steps = 0;
    while (this.t + STEP_MS <= toMs && steps < MAX_STEPS_PER_DRAW) { this.update(STEP_MS / 1000); this.t += STEP_MS; steps += 1; }
    if (this.t + STEP_MS <= toMs) this.t = toMs - (toMs % STEP_MS); // skip a long stall instead of replaying it
    this.loops = Math.max(this.loops, this.extraLoops());
  }
  protected rand(a: number, b: number) { return a + (b - a) * this.rng(); }
  protected pick<T>(list: readonly T[]): T { return list[Math.floor(this.rng() * list.length)]!; }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease = (u: number) => { const c = clamp(u, 0, 1); return c * c * (3 - 2 * c); };

// ---------------------------------------------------------------- Black Hole

export type BlackHolePhase = 'seed' | 'impact' | 'gravity' | 'accretion' | 'hold' | 'release';
const BH = {seed: 1.6, impact: 0.6, hold: 3, release: 2.8, rest: 1.5, consumeCap: 9};

export class BlackHole extends Sim {
  readonly glyphs: Glyph[];
  phase: BlackHolePhase = 'seed';
  phaseT = 0;
  cx: number; cy: number;
  /** 0 home, 1 falling, 2 orbiting, 3 consumed, 4 returning */
  private readonly diskCap = 150;
  private sparks: Array<{x: number; y: number; vx: number; vy: number; life: number}> = [];
  private coreRadius = 1.4;
  private pulse = 0;
  constructor(capture: ScreenCapture, textColor: number) {
    super(capture, 0xb1ac);
    this.glyphs = glyphsOf(capture, textColor);
    this.cx = capture.width / 2 + this.rand(-2, 2);
    this.cy = capture.height / 2 + this.rand(-1, 1);
  }
  private reset() {
    for (const g of this.glyphs) { g.x = g.ox; g.y = g.oy; g.vx = g.vy = 0; g.state = 0; g.t = 0; }
    this.sparks = []; this.phase = 'seed'; this.phaseT = 0; this.coreRadius = 1.4; this.loops += 1;
  }
  private go(phase: BlackHolePhase) { this.phase = phase; this.phaseT = 0; }
  update(dt: number): void {
    this.phaseT += dt; this.pulse += dt;
    const alive = this.glyphs.filter(g => g.state !== 3).length;
    switch (this.phase) {
      case 'seed': if (this.phaseT >= BH.seed) this.go('impact'); break;
      case 'impact':
        // A few strong frames: nearby glyphs twitch toward the point.
        for (const g of this.glyphs) {
          const d = Math.hypot((g.ox - this.cx) / ASPECT, g.oy - this.cy);
          if (d < 7 && g.state === 0) { const k = 0.35 * (1 - d / 7); g.x = g.ox + (this.cx - g.ox) * k; g.y = g.oy + (this.cy - g.oy) * k; }
        }
        if (this.phaseT >= BH.impact) this.go('gravity');
        break;
      case 'gravity': case 'accretion': {
        const ramp = clamp(this.phaseT / 3.5, 0, 1);
        for (const g of this.glyphs) {
          if (g.state === 3 || g.state === 0 && false) continue;
          const dx = (this.cx - g.x) / ASPECT, dy = this.cy - g.y;
          const r = Math.max(0.3, Math.hypot(dx, dy));
          if (g.state === 0) {
            // Distant glyphs wake later and move subtly at first: closer ones go first.
            const wake = (r / Math.max(this.capture.width / ASPECT, this.capture.height)) * 3.2;
            if (this.phaseT < wake) continue;
            g.state = 1; g.vx = g.vy = 0; g.w = this.rand(0.55, 1.1);
          }
          if (g.state === 1) {
            g.t += dt;
            // Anything lingering is drawn in harder, so the screen is always eventually consumed.
            const pull = (9 + 70 / (r + 1.5)) * ramp * (1 + g.t * 0.6);
            const ux = dx / r, uy = dy / r;
            // Tangential velocity makes the path a spiral rather than a spoke.
            g.vx += (ux * pull + -uy * pull * 0.55 * g.w) * dt * ASPECT;
            g.vy += (uy * pull + ux * pull * 0.55 * g.w) * dt;
            g.vx *= 0.985; g.vy *= 0.985;
            g.x += g.vx * dt; g.y += g.vy * dt;
            const nr = Math.hypot((this.cx - g.x) / ASPECT, this.cy - g.y);
            if (nr < 4.6) {
              if (this.glyphs.filter(h => h.state === 2).length >= this.diskCap) { g.state = 3; continue; }
              g.state = 2; g.a = Math.atan2(g.y - this.cy, (g.x - this.cx) / ASPECT); g.r = clamp(nr, 2.4, 4.4); g.t = this.rand(0.8, 2.6);
              g.w = (2.6 + this.rand(0, 1.2)) / Math.pow(g.r, 0.5);
            }
          } else if (g.state === 2) {
            g.a += g.w * dt * 2.2; g.r = Math.max(this.coreRadius + 0.4, g.r - 0.35 * dt); g.t -= dt;
            g.x = this.cx + Math.cos(g.a) * g.r * ASPECT; g.y = this.cy + Math.sin(g.a) * g.r;
            if (g.t <= 0) g.state = 3;
          }
        }
        if (this.phase === 'gravity' && this.phaseT > 2) this.go('accretion');
        if (this.phase === 'accretion' && (alive === 0 || this.glyphs.every(g => g.state >= 2) && this.phaseT > 5 || this.phaseT > BH.consumeCap)) {
          for (const g of this.glyphs) if (g.state !== 3) g.state = 3;
          this.go('hold');
        }
        break;
      }
      case 'hold':
        if (this.rng() < 0.12) { const a = this.rand(0, Math.PI * 2); this.sparks.push({x: this.cx, y: this.cy, vx: Math.cos(a) * 14, vy: Math.sin(a) * 6, life: 1.1}); }
        this.sparks = this.sparks.filter(s => { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; return s.life > 0; }).slice(-24);
        if (this.phaseT >= BH.hold) { this.go('release'); for (const g of this.glyphs) { g.state = 4; g.x = this.cx; g.y = this.cy; g.t = this.rand(0, 0.5); g.a = this.rand(-1, 1); } }
        break;
      case 'release': {
        // Reconstruct: glyphs leave the center on an arc and settle on their original cells.
        let done = true;
        for (const g of this.glyphs) {
          g.t += dt;
          const u = ease((g.t - 0.2) / (BH.release - 0.8));
          if (u < 1) done = false;
          const swirl = Math.sin(u * Math.PI) * g.a * 6;
          const px = this.cx + (g.ox - this.cx) * u, py = this.cy + (g.oy - this.cy) * u;
          const dx = g.ox - this.cx, dy = g.oy - this.cy, n = Math.hypot(dx, dy) || 1;
          g.x = px + (-dy / n) * swirl; g.y = py + (dx / n) * swirl * 0.5;
        }
        if (done && this.phaseT > BH.release + BH.rest) this.reset();
        break;
      }
    }
  }
  paint(grid: CellGrid, ctx: EffectContext): void {
    const {palette} = ctx;
    const skip = new Set<number>();
    const glyphIndex = (g: Glyph) => Math.floor(g.oy) * this.capture.width + Math.floor(g.ox);
    for (const g of this.glyphs) if (g.state !== 0 || this.phase === 'release') skip.add(glyphIndex(g));
    drawStatic(grid, this.capture, skip, palette.text);
    const rim = palette.stops[0] ?? palette.accent, rim2 = palette.stops[1] ?? rim;
    const cx = this.cx, cy = this.cy;
    if (this.phase === 'seed') {
      const flicker = 0.5 + 0.5 * Math.sin(this.t / 90);
      grid.set(cx, cy, this.phaseT > BH.seed * 0.6 ? '∘' : '·', mixPacked(palette.text, rim, flicker));
    } else if (this.phase === 'impact') {
      const radius = Math.max(0, 3 - this.phaseT * 4.5);
      this.ring(grid, radius, mixPacked(rim, 0xffffff, 0.6), 18);
      grid.set(cx, cy, '•', 0xffffff);
    }
    // Moving glyphs: dim a little as they near the center so they read as stretched into the glow.
    for (const g of this.glyphs) {
      if (g.state === 0 && this.phase !== 'impact') continue;
      if (g.state === 3) continue;
      const r = Math.hypot((cx - g.x) / ASPECT, cy - g.y);
      if (r < this.coreRadius) continue;
      const near = g.state === 2 ? 1 : clamp(1 - r / 9, 0, 0.8);
      grid.plot(g.x, g.y, g.ch, g.state === 2 ? mixPacked(g.fg, rim2, 0.55 + 0.3 * Math.sin(g.a * 3)) : mixPacked(g.fg, rim, near * 0.5));
    }
    if (this.phase === 'accretion' || this.phase === 'hold' || (this.phase === 'gravity' && this.phaseT > 2)) {
      const wobble = this.phase === 'hold' ? Math.sin(this.t / 260) * 0.25 : 0;
      const intensity = this.phase === 'hold' ? 0.7 + 0.3 * Math.sin(this.t / 180) : 0.6;
      this.disk(grid, 3.2 + wobble, ctx, intensity);
      // The core stays empty: nothing is drawn within coreRadius.
    }
    for (const s of this.sparks) grid.plot(s.x, s.y, '·', mixPacked(rim2, 0xffffff, s.life / 1.5));
  }
  private ring(grid: CellGrid, radius: number, color: number, points: number) {
    if (radius <= 0.2) return;
    for (let i = 0; i < points; i += 1) { const a = (i / points) * Math.PI * 2; grid.plot(this.cx + Math.cos(a) * radius * ASPECT, this.cy + Math.sin(a) * radius, '•', color); }
  }
  private disk(grid: CellGrid, radius: number, ctx: EffectContext, intensity: number) {
    const rim = ctx.palette.stops[0] ?? ctx.palette.accent, rim2 = ctx.palette.stops[1] ?? rim;
    const marks = ctx.nerd ? ['·', '∘', '•', '◦'] : ['.', 'o', '*', '+'];
    const n = 44;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + this.t / 700;
      // Brightness varies around the ring: a hot side and a dim side.
      const heat = 0.5 + 0.5 * Math.cos(a - this.t / 1300);
      const color = mixPacked(rim, rim2, heat);
      grid.plot(this.cx + Math.cos(a) * radius * ASPECT, this.cy + Math.sin(a) * radius, marks[Math.floor(heat * (marks.length - 0.01))]!, mixPacked(0x202030, color, 0.35 + heat * 0.65 * intensity));
      if (i % 11 === 0) grid.plot(this.cx + Math.cos(a + 0.12) * (radius + 1) * ASPECT, this.cy + Math.sin(a + 0.12) * (radius + 1), '·', mixPacked(color, 0xffffff, 0.3));
    }
  }
}

// ----------------------------------------------------------------- Fireworks

type Burst = 'sphere' | 'ring' | 'spray' | 'cross' | 'split';
interface Shell { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number; t: number; dur: number; style: Burst; color: number; }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; ch: string; fg: number; glyph?: Glyph }

export const FIREWORK_CAPS = {shells: 3, sparks: 220};

export class Fireworks extends Sim {
  readonly glyphs: Glyph[];
  shells: Shell[] = [];
  sparks: Spark[] = [];
  private next = 0.6;
  protected override extraLoops() { return Math.floor(this.t / 40_000); }
  /** Origin names recorded so tests can verify launches are not bottom-center only. */
  readonly launches: Array<{origin: string; x0: number; y0: number; x1: number; y1: number; style: Burst}> = [];
  private readonly held = new Set<Glyph>();
  constructor(capture: ScreenCapture, private readonly palette: EffectPalette) {
    super(capture, 0xf1e3);
    this.glyphs = glyphsOf(capture, palette.text);
  }
  private launch() {
    const w = this.capture.width, h = this.capture.height;
    const origins: Array<[string, number, number, number]> = [
      ['bottom-center', w * 0.5, h - 1, 2], ['lower-left', w * 0.2, h - 1, 2], ['lower-right', w * 0.8, h - 1, 2],
      ['left-edge', 1, h * 0.85, 1.5], ['right-edge', w - 2, h * 0.85, 1.5],
    ];
    const total = origins.reduce((s, o) => s + o[3], 0);
    let roll = this.rng() * total, origin = origins[0]!;
    for (const o of origins) { roll -= o[3]; if (roll <= 0) { origin = o; break; } }
    const zones: Array<[number, number, number, number]> = [[0.5, 0.35, 0.2, 0.12], [0.5, 0.2, 0.2, 0.1], [0.25, 0.28, 0.12, 0.1], [0.75, 0.28, 0.12, 0.1], [0.5, 0.55, 0.25, 0.1]];
    const zone = this.pick(zones);
    const tx = clamp(w * (zone[0] + this.rand(-zone[2], zone[2])), 4, w - 5), ty = clamp(h * (zone[1] + this.rand(-zone[3], zone[3])), 2, h - 4);
    const style = this.pick<Burst>(['sphere', 'ring', 'spray', 'cross', 'split']);
    // Each shell bends sideways by its own amount, so paths differ.
    const sway = this.rand(-0.25, 0.25) * w;
    const color = this.palette.stops.length ? this.pick(this.palette.stops) : this.palette.accent;
    this.shells.push({x0: origin[1], y0: origin[2], cx: (origin[1] + tx) / 2 + sway, cy: Math.min(origin[2], ty) - this.rand(0, h * 0.2), x1: tx, y1: ty, t: 0, dur: this.rand(0.9, 1.7), style, color});
    this.launches.push({origin: origin[0], x0: origin[1], y0: origin[2], x1: tx, y1: ty, style});
  }
  private burst(x: number, y: number, style: Burst, color: number) {
    const room = FIREWORK_CAPS.sparks - this.sparks.length;
    const n = Math.min(room, style === 'sphere' ? 34 : style === 'ring' ? 28 : style === 'spray' ? 26 : style === 'cross' ? 24 : 20);
    const bias = this.rand(0, Math.PI * 2);
    // Recruit nearby captured glyphs: they burst out and later settle back home.
    const near = this.glyphs.filter(g => !this.held.has(g) && Math.hypot((g.ox - x) / ASPECT, g.oy - y) < 7).slice(0, 10);
    near.forEach((g, i) => {
      if (this.sparks.length >= FIREWORK_CAPS.sparks) return;
      this.held.add(g);
      const a = (i / near.length) * Math.PI * 2 + bias, sp = this.rand(5, 11);
      this.sparks.push({x: g.ox, y: g.oy, vx: Math.cos(a) * sp * ASPECT, vy: Math.sin(a) * sp * 0.6, life: 1.6, max: 1.6, ch: g.ch, fg: g.fg, glyph: g});
    });
    for (let i = 0; i < n && this.sparks.length < FIREWORK_CAPS.sparks; i += 1) {
      let a: number, sp = this.rand(6, 13);
      if (style === 'ring') { a = (i / n) * Math.PI * 2; sp = 11; }
      else if (style === 'spray') { a = bias + this.rand(-0.7, 0.7); sp = this.rand(7, 16); }
      else if (style === 'cross') { a = Math.floor(i / (n / 4)) * (Math.PI / 2) + bias * 0 + this.rand(-0.08, 0.08); sp = 5 + (i % 6) * 1.4; }
      else a = this.rand(0, Math.PI * 2);
      this.sparks.push({x, y, vx: Math.cos(a) * sp * ASPECT, vy: Math.sin(a) * sp * 0.6, life: this.rand(0.9, 1.6), max: 1.6, ch: this.pick(['*', '·', '+', '•']), fg: color});
      if (style === 'split' && i % 5 === 0 && this.shells.length < FIREWORK_CAPS.shells) {
        this.shells.push({x0: x, y0: y, cx: x + this.rand(-6, 6), cy: y - 3, x1: x + Math.cos(a) * 14, y1: y + Math.sin(a) * 5, t: 0, dur: 0.5, style: 'sphere', color});
      }
    }
  }
  update(dt: number): void {
    this.next -= dt;
    const busy = this.sparks.length > 150;
    if (this.next <= 0 && this.shells.length < FIREWORK_CAPS.shells && !busy) { this.launch(); this.next = this.rand(0.7, 1.7); }
    for (const s of [...this.shells]) {
      s.t += dt;
      if (s.t >= s.dur) { this.shells.splice(this.shells.indexOf(s), 1); this.burst(s.x1, s.y1, s.style, s.color); }
    }
    for (const p of this.sparks) {
      p.vy += 7 * dt; p.vx *= 1 - 0.7 * dt; p.vy *= 1 - 0.4 * dt; // light gravity and drag
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    }
    for (const p of this.sparks) if (p.life <= 0 && p.glyph) this.held.delete(p.glyph);
    this.sparks = this.sparks.filter(p => p.life > 0);
  }
  shellPosition(s: Shell, u = s.t / s.dur): {x: number; y: number} {
    const k = clamp(u, 0, 1), m = 1 - k;
    return {x: m * m * s.x0 + 2 * m * k * s.cx + k * k * s.x1, y: m * m * s.y0 + 2 * m * k * s.cy + k * k * s.y1};
  }
  paint(grid: CellGrid, ctx: EffectContext): void {
    const skip = new Set<number>();
    for (const g of this.held) skip.add(Math.floor(g.oy) * this.capture.width + Math.floor(g.ox));
    drawStatic(grid, this.capture, skip, ctx.palette.text);
    for (const s of this.shells) {
      for (let k = 0; k < 4; k += 1) {
        const p = this.shellPosition(s, s.t / s.dur - k * 0.04);
        grid.plot(p.x, p.y, k === 0 ? '*' : '·', mixPacked(s.color, 0xffffff, k === 0 ? 0.7 : 0.1));
      }
    }
    for (const p of this.sparks) {
      const fade = clamp(p.life / 0.8, 0, 1);
      grid.plot(p.x, p.y, p.glyph ? p.ch : fade > 0.35 ? p.ch : '·', p.glyph ? mixPacked(p.fg, 0x808090, 1 - fade) : mixPacked(0x30303c, p.fg, fade));
    }
  }
}

// -------------------------------------------------------------- Circletastic

export type CircPhase = 'hold' | 'gather' | 'spin' | 'unstable' | 'scatter' | 'settle';
export interface RingSpec { cx: number; cy: number; r: number; dir: 1 | -1; slots: number }
const CIRC = {gather: 2.4, spin: 6.5, unstable: 1.2, scatter: 3.2, settle: 1.6, hold: 0.8, maxClusters: 3, spacing: 0.95, ringGap: 1.7};

/** Capacity of one ring at physical radius r (rows units): glyphs are spaced by arc length. */
export const ringCapacity = (r: number) => Math.max(0, Math.floor((2 * Math.PI * r) / CIRC.spacing));

/**
 * Lay out rings for `count` glyphs in a width×height cell area. Physical
 * units are rows (x cells count half), so the ring looks circular. One
 * dominant cluster with concentric rings when needed and an always-empty
 * center; a few separate clusters only when one cannot fit.
 */
export function layoutRings(count: number, width: number, height: number, rng: () => number): RingSpec[] {
  const W = width / ASPECT, H = height;
  const maxR = Math.max(2.5, Math.min(W, H) / 2 - 1.5);
  const minInner = Math.max(1.8, maxR * 0.3);
  const cluster = (R: number, cx: number, cy: number, need: number, dir: 1 | -1): {rings: RingSpec[]; held: number} => {
    const rings: RingSpec[] = []; let held = 0;
    for (let r = R, k = 0; r >= minInnerFor(R) && held < need; r -= CIRC.ringGap, k += 1) {
      const slots = Math.min(ringCapacity(r), need - held);
      if (slots < 3) continue;
      rings.push({cx, cy, r, dir: (k % 2 === 0 ? dir : -dir) as 1 | -1, slots}); held += slots;
    }
    return {rings, held};
  };
  const minInnerFor = (R: number) => Math.max(1.8, R * 0.3);
  void minInner;
  // Smallest dominant ring that holds everything in a single circle, if it fits.
  const singleR = count / ((2 * Math.PI) / CIRC.spacing);
  const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
  if (singleR <= maxR) {
    const R = clamp(Math.max(singleR, 2.5), 2.5, maxR);
    return cluster(R, W / 2, height / 2, count, dir).rings;
  }
  const one = cluster(maxR, W / 2, height / 2, count, dir);
  if (one.held >= count) return one.rings;
  // Too much text for one cluster: a small number of well-spaced circles, bounded.
  const n = Math.min(CIRC.maxClusters, Math.ceil(count / Math.max(1, one.held)) + 1);
  const spots = (n <= 2 ? [[0.28, 0.5], [0.72, 0.5]] : [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]).slice(0, n);
  const R = Math.max(2.5, Math.min(n <= 2 ? W * 0.2 : W * 0.14, H / 2 - 1.5));
  const all: RingSpec[] = [];
  let remaining = count;
  spots.forEach(([fx, fy], i) => {
    const c = cluster(R, W * fx!, height * fy!, remaining, i % 2 === 0 ? dir : (-dir as 1 | -1));
    all.push(...c.rings); remaining -= c.held;
  });
  return all;
}

export class Circletastic extends Sim {
  readonly glyphs: Glyph[];
  phase: CircPhase = 'hold';
  phaseT = 0;
  rings: RingSpec[] = [];
  /** Per-ring angle and angular speed (rad/s). */
  angle: number[] = [];
  omega: number[] = [];
  private assigned: Array<{ring: number; slot: number}> = [];
  private alpha = 1.4;
  cycles = 0;
  constructor(capture: ScreenCapture, textColor: number) {
    super(capture, 0xc12c);
    this.glyphs = glyphsOf(capture, textColor);
    // Reading order keeps neighbours together, so words travel as loose groups.
    this.plan();
  }
  private plan() {
    this.rings = layoutRings(this.glyphs.length, this.capture.width, this.capture.height, this.rng);
    this.angle = this.rings.map(() => this.rand(0, Math.PI * 2));
    this.omega = this.rings.map(() => 0.25);
    this.assigned = [];
    let g = 0;
    this.rings.forEach((ring, ri) => { for (let s = 0; s < ring.slots && g < this.glyphs.length; s += 1, g += 1) this.assigned[g] = {ring: ri, slot: s}; });
    for (const glyph of this.glyphs) { glyph.vx = glyph.vy = 0; }
    this.glyphs.forEach(glyph => { glyph.a = glyph.x; glyph.r = glyph.y; glyph.t = 0; });
    this.alpha = this.rand(1.1, 1.7);
  }
  slotPosition(i: number): {x: number; y: number} | undefined {
    const a = this.assigned[i];
    if (!a) return undefined;
    const ring = this.rings[a.ring]!;
    const th = this.angle[a.ring]! + (a.slot / ring.slots) * Math.PI * 2;
    return {x: (ring.cx + Math.cos(th) * ring.r) * ASPECT, y: ring.cy + Math.sin(th) * ring.r};
  }
  private go(phase: CircPhase) { this.phase = phase; this.phaseT = 0; }
  update(dt: number): void {
    this.phaseT += dt;
    const w = this.capture.width, h = this.capture.height;
    switch (this.phase) {
      case 'hold': if (this.phaseT >= CIRC.hold) { this.glyphs.forEach(g => { g.a = g.x; g.r = g.y; g.t = 0; }); this.go('gather'); } break;
      case 'gather': {
        const u = ease(this.phaseT / CIRC.gather);
        this.glyphs.forEach((g, i) => {
          const target = this.slotPosition(i);
          if (!target) return; // glyphs beyond ring capacity stay put
          const swirl = Math.sin(u * Math.PI) * 3;
          g.x = g.a + (target.x - g.a) * u + swirl * (g.oy < h / 2 ? 1 : -1);
          g.y = g.r + (target.y - g.r) * u;
        });
        if (this.phaseT >= CIRC.gather) this.go('spin');
        break;
      }
      case 'spin': case 'unstable': {
        // Angular acceleration: visible slow start, then faster and faster.
        this.rings.forEach((ring, ri) => {
          this.omega[ri]! += this.alpha * (1 + ri * 0.35) * dt * (this.phase === 'unstable' ? 1.6 : 1);
          this.angle[ri]! += this.omega[ri]! * ring.dir * dt;
        });
        this.glyphs.forEach((g, i) => {
          const p = this.slotPosition(i); if (!p) return;
          const jitter = this.phase === 'unstable' ? 0.55 : 0;
          g.x = p.x + (jitter ? (this.rng() - 0.5) * jitter * 2 * ASPECT : 0); g.y = p.y + (jitter ? (this.rng() - 0.5) * jitter * 2 : 0);
        });
        if (this.phase === 'spin' && this.phaseT >= CIRC.spin) this.go('unstable');
        if (this.phase === 'unstable' && this.phaseT >= CIRC.unstable) this.explode();
        break;
      }
      case 'scatter': {
        for (const g of this.glyphs) {
          g.vx *= 1 - 0.55 * dt; g.vy *= 1 - 0.55 * dt;
          g.x += g.vx * dt; g.y += g.vy * dt;
          if (g.x < 1) { g.x = 1; g.vx = Math.abs(g.vx) * 0.5; } else if (g.x > w - 2) { g.x = w - 2; g.vx = -Math.abs(g.vx) * 0.5; }
          if (g.y < 1) { g.y = 1; g.vy = Math.abs(g.vy) * 0.5; } else if (g.y > h - 2) { g.y = h - 2; g.vy = -Math.abs(g.vy) * 0.5; }
        }
        if (this.phaseT >= CIRC.scatter) this.go('settle');
        break;
      }
      case 'settle':
        for (const g of this.glyphs) { g.vx *= 0.8; g.vy *= 0.8; g.x += g.vx * dt; g.y += g.vy * dt; g.x = clamp(g.x, 1, w - 2); g.y = clamp(g.y, 1, h - 2); }
        if (this.phaseT >= CIRC.settle) { this.cycles += 1; this.loops = this.cycles; this.plan(); this.go('hold'); this.phaseT = CIRC.hold; }
        break;
    }
  }
  /** The structure fails: each glyph keeps the velocity its ring was giving it, plus an outward kick. */
  explode() {
    this.glyphs.forEach((g, i) => {
      const a = this.assigned[i];
      if (!a) { g.vx = this.rand(-4, 4); g.vy = this.rand(-2, 2); return; }
      const ring = this.rings[a.ring]!;
      const th = this.angle[a.ring]! + (a.slot / ring.slots) * Math.PI * 2;
      const speed = this.omega[a.ring]! * ring.r * ring.dir;           // rows/s along the tangent
      const tx = -Math.sin(th) * speed * ASPECT, ty = Math.cos(th) * speed;
      const out = this.rand(3, 9);
      g.vx = tx * 0.6 + Math.cos(th) * out * ASPECT; g.vy = ty * 0.6 + Math.sin(th) * out;
    });
    this.go('scatter');
  }
  paint(grid: CellGrid, ctx: EffectContext): void {
    const skip = new Set<number>();
    const moving = this.phase !== 'hold' || this.cycles > 0;
    if (moving) this.glyphs.forEach(g => skip.add(Math.floor(g.oy) * this.capture.width + Math.floor(g.ox)));
    drawStatic(grid, this.capture, skip, ctx.palette.text);
    const hot = clamp((this.omega[0] ?? 0) / 9, 0, 1);
    for (const g of this.glyphs) {
      if (!moving) continue;
      const lit = this.phase === 'spin' || this.phase === 'unstable' ? hot : 0;
      grid.plot(g.x, g.y, g.ch, mixPacked(g.fg, ctx.palette.stops[0] ?? ctx.palette.accent, lit * 0.6));
    }
  }
}

// ------------------------------------------------------------- raiseCatError

export interface Platform { y: number; x0: number; x1: number }
export const CAT_FRAMES = {
  idle: ['/\\_/\\ ', '(o.o)~'], blink: ['/\\_/\\ ', '(-.-)~'], walkA: ['/\\_/\\ ', '(o.o)/'], walkB: ['/\\_/\\ ', '(o.o)\\'],
  sit: ['/\\_/\\ ', '(o.o)_'], jump: ['/\\_/\\ ', '(O.O)^'], land: ['      ', '(=.=)_'], paw: ['/\\_/\\ ', '(o.o)>'],
} as const;
const CAT_W = 6;
export const JOKES = [
  '`{w}` looks suspiciously productive', 'Expected cat, found `{w}`', '`{w}` appears emotionally unavailable', 'Unknown identifier: `{w}`',
  'This line has exceeded its recommended seriousness', '`{w}` is 3 characters away from becoming a cat', 'Path is not sufficiently lavender',
  'Command may result in responsibilities', 'Text exists here', 'Unexpected semicolon energy', 'This function has been inspected by a cat',
  '`{w}` has been judged', 'Too many words, not enough naps',
] as const;
export const CHARACTER_JOKE = 'Unexpected character';
export const DIVIDER_JOKE = 'Structural integrity questionable';
export interface Diagnostic { row: number; x0: number; x1: number; text: string; level: 'error' | 'warn'; born: number; labelRow?: number; labelX?: number }
export const DIAGNOSTIC_CAP = 14;

/** Horizontal stretches of occupied cells (single gaps tolerated) wide enough for the cat, from geometry only. */
export function extractPlatforms(capture: ScreenCapture, minWidth = 6): Platform[] {
  const out: Platform[] = [];
  for (let y = 1; y < capture.height; y += 1) {
    let start = -1, gap = 0;
    for (let x = 0; x <= capture.width; x += 1) {
      const occupied = x < capture.width && capture.glyphs[y * capture.width + x] !== ' ';
      if (occupied) { if (start < 0) start = x; gap = 0; }
      else if (start >= 0) {
        gap += 1;
        if (gap > 1 || x === capture.width) {
          const end = x - gap;
          if (end - start + 1 >= minWidth) out.push({y, x0: start, x1: end});
          start = -1; gap = 0;
        }
      }
    }
  }
  return out;
}

export type CatState = 'walk' | 'idle' | 'blink' | 'sit' | 'jump' | 'land' | 'paw';

export class RaiseCatError extends Sim {
  platforms: Platform[];
  cat = {x: 2, feet: 1, vx: 0, vy: 0, state: 'idle' as CatState, t: 0, dir: 1 as 1 | -1, platform: -1};
  diagnostics: Diagnostic[] = [];
  private wobble = new Map<number, {dx: number; dy: number; until: number}>();
  private think = 0.6;
  private cycleStart = 0;
  private resetting = 0;
  readonly log: string[] = [];
  constructor(capture: ScreenCapture, private readonly textColor: number) {
    super(capture, 0xca7e);
    this.platforms = extractPlatforms(capture);
    this.place(this.platforms.length ? Math.floor(this.rng() * this.platforms.length) : -1);
  }
  private place(index: number) {
    const p = this.platforms[index];
    if (!p) { this.cat.platform = -1; this.cat.feet = this.capture.height - 1; this.cat.x = this.capture.width / 2; return; }
    this.cat.platform = index; this.cat.feet = p.y - 1; this.cat.x = clamp(p.x0 + this.rand(0, Math.max(0, p.x1 - p.x0 - CAT_W)), 0, this.capture.width - CAT_W - 1);
  }
  private wordAt(row: number, x: number): {x0: number; x1: number; text: string} | undefined {
    const w = this.capture.width; let i = clamp(Math.round(x), 0, w - 1);
    const at = (c: number) => this.capture.glyphs[row * w + c] ?? ' ';
    for (let d = 0; d < 6 && at(i) === ' '; d += 1) i = clamp(i + (d % 2 === 0 ? d + 1 : -(d + 1)), 0, w - 1);
    if (at(i) === ' ') return undefined;
    let a = i, b = i; while (a > 0 && at(a - 1) !== ' ') a -= 1; while (b < w - 1 && at(b + 1) !== ' ') b += 1;
    let text = ''; for (let c = a; c <= b; c += 1) text += at(c);
    return {x0: a, x1: b, text: text.replace(/[^\p{L}\p{N}_./~-]/gu, '').slice(0, 14) || 'text'};
  }
  private raise(row: number, x: number, joke?: string) {
    const word = this.wordAt(row, x);
    if (!word || this.diagnostics.some(d => d.row === row && d.x0 === word.x0)) return;
    const text = joke ?? this.pick(JOKES).replace('{w}', word.text);
    this.diagnostics.push({row, x0: word.x0, x1: word.x1, text, level: this.rng() < 0.7 ? 'error' : 'warn', born: this.t});
    if (this.diagnostics.length > DIAGNOSTIC_CAP) this.diagnostics.shift();
    this.log.push(text);
    this.placeLabel(this.diagnostics[this.diagnostics.length - 1]!);
  }
  /** A label goes on a blank stretch near its range (never over text), or is skipped when the screen is full there. */
  private placeLabel(d: Diagnostic) {
    const need = Math.min(d.text.length + 2, this.capture.width - 2);
    for (const dy of [-1, 1, -2, 2, -3, 3]) {
      const row = d.row + dy; if (row < 0 || row >= this.capture.height) continue;
      const x = clamp(d.x0, 0, this.capture.width - need);
      let free = true;
      for (let c = x; c < x + need && free; c += 1) if (this.capture.glyphs[row * this.capture.width + c] !== ' ' || this.diagnostics.some(o => o !== d && o.labelRow === row && o.labelX !== undefined && c >= o.labelX && c < o.labelX + o.text.length + 2)) free = false;
      if (free) { d.labelRow = row; d.labelX = x; return; }
    }
  }
  private bump(row: number, x: number) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const c = Math.round(x) + dx; if (c < 0 || c >= this.capture.width) continue;
      const i = row * this.capture.width + c;
      if (this.capture.glyphs[i] !== ' ' && this.wobble.size < 24) this.wobble.set(i, {dx: dx === 0 ? 0 : Math.sign(dx) * 1, dy: dx % 2 === 0 ? -1 : 0, until: this.t + 700});
    }
  }
  update(dt: number): void {
    const cat = this.cat; cat.t += dt; this.think -= dt;
    for (const [i, w] of this.wobble) if (this.t > w.until) this.wobble.delete(i);
    if (this.resetting > 0) {
      this.resetting -= dt;
      if (this.resetting <= 0) { this.diagnostics = []; this.cycleStart = this.t; this.loops += 1; }
      return;
    }
    // Cycle: errors accumulate, hold briefly when overwhelmed, then one tasteful reset.
    if (this.diagnostics.length >= DIAGNOSTIC_CAP - 2 || this.t - this.cycleStart > 60_000) { this.resetting = 3; return; }
    const p = this.platforms[cat.platform];
    if (cat.state === 'jump') {
      cat.vy += 38 * dt; cat.x += cat.vx * dt; cat.feet += cat.vy * dt;
      cat.x = clamp(cat.x, 0, this.capture.width - CAT_W - 1);
      if (cat.feet < 1) { cat.feet = 1; cat.vy = Math.max(cat.vy, 0); } // never above the top row
      if (cat.vy > 0) {
        const hit = this.platforms.findIndex(q => Math.abs(cat.feet - (q.y - 1)) < 0.9 && cat.x + 2 >= q.x0 && cat.x + 2 <= q.x1 && cat.feet <= q.y - 1 + 0.9);
        if (hit >= 0) {
          cat.platform = hit; cat.feet = this.platforms[hit]!.y - 1; cat.vx = cat.vy = 0; cat.state = 'land'; cat.t = 0;
          const row = this.platforms[hit]!.y;
          this.bump(row, cat.x + 2);
          if (this.rng() < 0.8) this.raise(row, cat.x + 2);
        } else if (cat.feet >= this.capture.height - 1) { cat.feet = this.capture.height - 1; cat.vx = cat.vy = 0; cat.platform = -1; cat.state = 'land'; cat.t = 0; }
      }
      return;
    }
    if (cat.platform < 0 && this.platforms.length) { const near = this.nearestPlatform(); if (near >= 0) this.place(near); }
    if (cat.state === 'walk' && p) {
      cat.x += cat.dir * 5 * dt;
      const left = Math.max(0, p.x0 - 1), right = Math.min(this.capture.width - CAT_W - 1, p.x1 + 2 - CAT_W);
      if (cat.x < left || cat.x > right) { cat.x = clamp(cat.x, left, Math.max(left, right)); cat.dir = (cat.dir * -1) as 1 | -1; cat.state = 'idle'; cat.t = 0; }
    }
    if ((cat.state === 'land' || cat.state === 'paw' || cat.state === 'blink' || cat.state === 'sit') && cat.t > (cat.state === 'sit' ? 1.4 : 0.5)) { cat.state = 'idle'; cat.t = 0; }
    if (this.think > 0) return;
    this.think = this.rand(0.7, 2);
    const roll = this.rng();
    if (!p) return;
    const row = p.y;
    if (roll < 0.34) { cat.state = 'walk'; cat.dir = this.rng() < 0.5 ? 1 : -1; cat.t = 0; }
    else if (roll < 0.46) { cat.state = 'blink'; cat.t = 0; }
    else if (roll < 0.66) { cat.state = 'sit'; cat.t = 0; if (this.rng() < 0.75) this.raise(row, cat.x + CAT_W / 2); }
    else if (roll < 0.78) { cat.state = 'paw'; cat.t = 0; this.bump(row, cat.x + CAT_W); this.raise(row, cat.x + CAT_W, CHARACTER_JOKE); }
    else this.tryJump();
  }
  private nearestPlatform(): number {
    let best = -1, bestD = 1e9;
    this.platforms.forEach((q, i) => { const d = Math.abs(q.y - this.cat.feet) + Math.abs(q.x0 - this.cat.x) * 0.1; if (d < bestD) { bestD = d; best = i; } });
    return best;
  }
  /** A bounded set of nearby platforms the arc can reach; none means keep walking. */
  jumpTargets(): number[] {
    const cat = this.cat;
    return this.platforms.map((q, i) => ({q, i})).filter(({q, i}) => i !== cat.platform && Math.abs(q.y - 1 - cat.feet) <= 7 && Math.abs(q.y - 1 - cat.feet) >= 1
      && q.x1 >= cat.x - 16 && q.x0 <= cat.x + CAT_W + 16).map(({i}) => i);
  }
  private tryJump() {
    const cat = this.cat; const targets = this.jumpTargets();
    if (!targets.length) { cat.state = 'walk'; cat.dir = (cat.dir * -1) as 1 | -1; return; }
    const q = this.platforms[this.pick(targets)]!;
    const landX = clamp(q.x0 + (q.x1 - q.x0 - CAT_W) / 2 + this.rand(-2, 2), q.x0, Math.max(q.x0, q.x1 - CAT_W + 1));
    const rise = Math.max(0, cat.feet - (q.y - 1)) + 2.2;      // apex above the higher of the two floors
    const g = 38, vy0 = -Math.sqrt(2 * g * rise);
    const fall = (q.y - 1) - (cat.feet + (-(vy0 * vy0) / (2 * -g)) * -1);
    const tUp = -vy0 / g, tDown = Math.sqrt(Math.max(0.0001, 2 * Math.max(0.2, (q.y - 1) - (cat.feet - rise)) / g));
    void fall;
    cat.vy = vy0; cat.vx = (landX - cat.x) / (tUp + tDown); cat.state = 'jump'; cat.t = 0; cat.platform = -1;
  }
  paint(grid: CellGrid, ctx: EffectContext): void {
    const w = this.capture.width;
    // Captured text, with wobbling cells nudged (presentation only).
    const moved = new Map<number, {x: number; y: number}>();
    for (const [i, wb] of this.wobble) moved.set(i, {x: (i % w) + wb.dx, y: Math.floor(i / w) + wb.dy});
    drawStatic(grid, this.capture, new Set(moved.keys()), ctx.palette.text);
    for (const [i, pos] of moved) { const fg = this.capture.fg[i]!; grid.set(pos.x, pos.y, this.capture.glyphs[i]!, fg === NO_COLOR_VALUE ? ctx.palette.text : fg); }
    const newest = this.diagnostics.length - 1;
    this.diagnostics.forEach((d, i) => {
      const age = clamp((this.diagnostics.length - 1 - i) / 8, 0, 0.7);
      const base = d.level === 'error' ? ctx.palette.error : ctx.palette.warn;
      const colour = mixPacked(base, 0x707078, age);
      // Highlight the range: tint in color, underline-style marks always (readable without color).
      for (let x = d.x0; x <= d.x1; x += 1) {
        const index = d.row * w + x; const glyph = this.capture.glyphs[index]!;
        if (ctx.color) grid.set(x, d.row, glyph, mixPacked(ctx.palette.text, 0xffffff, 0.2), mixPacked(0x101014, base, 0.45 - age * 0.25));
        if (d.row + 1 < this.capture.height && this.capture.glyphs[(d.row + 1) * w + x] === ' ' && d.labelRow !== d.row + 1) grid.set(x, d.row + 1, ctx.nerd ? '~' : '^', colour);
      }
      const icon = d.level === 'error' ? (ctx.nerd ? '✕' : 'x') : (ctx.nerd ? '⚠' : '!');
      if (d.labelRow !== undefined && d.labelX !== undefined) {
        const label = ` ${icon} ${d.text} `.slice(0, this.capture.width - d.labelX);
        for (let k = 0; k < label.length; k += 1) grid.set(d.labelX + k, d.labelRow, label[k]!, i === newest ? mixPacked(colour, 0xffffff, 0.35) : colour);
      } else if (d.x0 > 0) grid.set(d.x0 - 1, d.row, icon, colour);
    });
    // The cat is drawn last so it is never hidden by diagnostics.
    const f = this.frame(); const x = Math.round(this.cat.x), y = Math.round(this.cat.feet) - 1;
    f.forEach((line, dy) => { for (let k = 0; k < line.length; k += 1) if (line[k] !== ' ') grid.set(x + k, y + dy, line[k]!, ctx.palette.accent); });
  }
  frame(): readonly string[] {
    const c = this.cat;
    if (c.state === 'jump') return CAT_FRAMES.jump;
    if (c.state === 'walk') return Math.floor(c.t * 4) % 2 === 0 ? CAT_FRAMES.walkA : CAT_FRAMES.walkB;
    if (c.state === 'idle' && Math.floor(this.t / 1600) % 4 === 3 && this.t % 1600 < 200) return CAT_FRAMES.blink;
    return CAT_FRAMES[c.state === 'idle' ? 'idle' : c.state] ?? CAT_FRAMES.idle;
  }
}

// --------------------------------------------------------------- registry

export function createEffect(id: ScreenEffectId, capture: ScreenCapture, palette: EffectPalette): Sim & {glyphs?: Glyph[]} {
  switch (id) {
    case 'blackHole': return new BlackHole(capture, palette.text);
    case 'fireworks': return new Fireworks(capture, palette);
    case 'circletastic': return new Circletastic(capture, palette.text);
    case 'raiseCatError': return new RaiseCatError(capture, palette.text);
  }
}

/** Draw one frame of a screen effect for scene time `time` into `grid` (cleared to the host background). */
export function renderScreenEffect(id: ScreenEffectId, grid: CellGrid, capture: ScreenCapture, ctx: EffectContext): void {
  const instance = (capture.instances[id] ??= createEffect(id, capture, ctx.palette)) as Sim;
  instance.advance(ctx.time);
  grid.clear(NO_COLOR_VALUE);
  instance.paint(grid, ctx);
}

/** How many full loops the capture's running effect has completed (0 when none). */
export function effectLoops(capture: ScreenCapture, id: ScreenEffectId): number {
  return ((capture.instances[id] as Sim | undefined)?.loops) ?? 0;
}
