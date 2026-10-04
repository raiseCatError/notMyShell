import {CellGrid, luminance, mixPacked, NO_COLOR_VALUE} from './CellGrid.js';
import type {ScreenCapture} from './screenCapture.js';
import {CAT_ASCII, CAT_ASCII_BLINK, CAT_CELL_HEIGHT, CAT_CELL_WIDTH, catCells, type CatPose} from './catSprite.js';

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
  /** Seconds after the effect's gravity starts before this glyph is disturbed (distance-ordered). */
  wake?: number;
  /** Beyond the simulation cap: moves along a closed-form spiral instead of being integrated. */
  lite?: boolean;
}

/** Non-blank captured cells as animatable glyphs; huge screens are sampled down to a cap. */
export function glyphsOf(capture: ScreenCapture, textColor: number, max = MAX_GLYPHS): Glyph[] {
  const cells: number[] = [];
  for (let i = 0; i < capture.glyphs.length; i += 1) if (capture.glyphs[i] !== ' ') cells.push(i);
  const stride = Math.max(1, Math.ceil(cells.length / max));
  const out: Glyph[] = [];
  for (let k = 0; k < cells.length; k += stride) {
    const i = cells[k]!;
    const x = i % capture.width, y = Math.floor(i / capture.width);
    const fg = capture.fg[i]!;
    out.push({ch: capture.glyphs[i]!, fg: visibleFg(fg, capture.bg[i]!, textColor), ox: x, oy: y, x, y, vx: 0, vy: 0, state: 0, t: 0, a: 0, r: 0, w: 0});
  }
  return out;
}

/**
 * A glyph that leaves its cell is drawn without its background, so its color
 * must stand on its own: dark-on-light chrome (a badge, a selection) would
 * otherwise become dark text on the host's dark background.
 */
export function visibleFg(fg: number, bg: number, textColor: number): number {
  if (fg === NO_COLOR_VALUE) return bg !== NO_COLOR_VALUE && luminance(bg) > 0.35 ? bg : textColor;
  if (luminance(fg) >= 0.3) return fg;
  return bg !== NO_COLOR_VALUE && luminance(bg) >= 0.3 ? bg : textColor;
}

/**
 * Cells that are not in the animated set are drawn exactly as captured:
 * glyph, foreground and authored background (host-default colors stay
 * host-default, so transparency and the prompt chrome survive). A cell whose
 * glyph is animated keeps its authored background and loses only the glyph.
 */
function drawStatic(grid: CellGrid, capture: ScreenCapture, skip: ReadonlySet<number>, _textColor: number): void {
  for (let i = 0; i < capture.glyphs.length; i += 1) {
    const g = capture.glyphs[i]!, bg = capture.bg[i]!;
    if (g === ' ' && bg === NO_COLOR_VALUE) continue;
    const x = i % capture.width, y = Math.floor(i / capture.width);
    if (skip.has(i)) grid.set(x, y, ' ', NO_COLOR_VALUE, bg);
    else grid.set(x, y, g, capture.fg[i]!, bg);
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
const BH = {seed: 1.6, impact: 0.6, hold: 3, release: 2.8, rest: 1.5, consumeCap: 11, simCap: 1800, wakeSpan: 4.2};

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
  /** Seconds since gravity began (continuous across gravity and accretion). */
  gt = 0;
  constructor(capture: ScreenCapture, textColor: number) {
    super(capture, 0xb1ac);
    // Every visible glyph takes part. Above the simulation cap the excess follows a cheap closed-form spiral,
    // so a dense screen is still swallowed whole rather than half left untouched.
    this.glyphs = glyphsOf(capture, textColor, Number.MAX_SAFE_INTEGER);
    const stride = Math.max(1, Math.ceil(this.glyphs.length / BH.simCap));
    this.glyphs.forEach((g, i) => { if (stride > 1 && i % stride !== 0) g.lite = true; });
    this.cx = capture.width / 2 + this.rand(-2, 2);
    this.cy = capture.height / 2 + this.rand(-1, 1);
    // One global field: nearby text reacts first, the far edges and corners last, all within the same span.
    const dist = this.glyphs.map(g => Math.hypot((g.ox - this.cx) / ASPECT, g.oy - this.cy));
    const dmax = Math.max(1, ...dist);
    this.glyphs.forEach((g, i) => { g.wake = BH.wakeSpan * Math.pow(dist[i]! / dmax, 0.9) + this.rand(0, 0.5); });
  }
  private reset() {
    for (const g of this.glyphs) { g.x = g.ox; g.y = g.oy; g.vx = g.vy = 0; g.state = 0; g.t = 0; }
    this.sparks = []; this.phase = 'seed'; this.phaseT = 0; this.gt = 0; this.coreRadius = 1.4; this.loops += 1;
  }
  private go(phase: BlackHolePhase) { this.phase = phase; this.phaseT = 0; }
  update(dt: number): void {
    this.phaseT += dt; this.pulse += dt;
    if (this.phase === 'gravity' || this.phase === 'accretion') this.gt += dt;
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
          if (g.state === 3) continue;
          if (g.lite) {
            const dur = 2.4 + 1.6 * ((g.wake ?? 0) / BH.wakeSpan);
            if (g.state === 0 && this.gt >= (g.wake ?? 0)) { g.state = 5; g.a = Math.atan2(g.oy - this.cy, (g.ox - this.cx) / ASPECT); g.r = Math.hypot((g.ox - this.cx) / ASPECT, g.oy - this.cy); g.w = dur; }
            if (g.state === 5 && this.gt >= (g.wake ?? 0) + g.w) g.state = 3;   // swallowed: retired from the simulation
            continue;
          }
          const dx = (this.cx - g.x) / ASPECT, dy = this.cy - g.y;
          const r = Math.max(0.3, Math.hypot(dx, dy));
          if (g.state === 0) {
            // Distant glyphs wake later and move subtly at first: closer ones go first.
            if (this.gt < (g.wake ?? 0)) continue;
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
      if (g.state === 5) {
        // Closed-form inward spiral: radius shrinks, angle sweeps faster near the core.
        const u = clamp((this.gt - (g.wake ?? 0)) / g.w, 0, 1);
        const radius = g.r * Math.pow(1 - u, 1.5) + this.coreRadius * 0.6 * u, angle = g.a + 3.4 * u + 2.2 * u * u * u;
        if (radius < this.coreRadius) continue;
        grid.plot(this.cx + Math.cos(angle) * radius * ASPECT, this.cy + Math.sin(angle) * radius, g.ch, mixPacked(g.fg, rim, 0.25 + 0.5 * u));
        continue;
      }
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

export type CircPhase = 'hold' | 'gather' | 'spin' | 'collapse' | 'explode' | 'scatter' | 'settle';
export type ClusterStage = 'gather' | 'spin' | 'collapse' | 'critical' | 'exploded';
export interface RingSpec { cx: number; cy: number; r: number; dir: 1 | -1; slots: number; cluster: number }
export interface Cluster { cx: number; cy: number; R: number; dir: 1 | -1; rings: RingSpec[] }
export const CIRC = {
  scatter: 3.2, settle: 1.6, hold: 0.7, spacing: 0.8, ringGap: 1.5, minClusters: 2, maxClusters: 5, omegaStart: 0.5, omegaCollapse: 7, omegaMax: 15,
  collapseSeconds: 1.7, collapseScale: 0.2, criticalSeconds: 0.3, flashSeconds: 0.4, glyphCap: 1200, debrisCap: 90, shockPoints: 40,
  /** Share of the source screen harvested on run 1, 2, 3, 4; the fifth run starts from a restored screen. */
  harvest: [0.4, 0.62, 0.85, 0.97], runsBeforeReset: 4,
};

/** Capacity of one ring at physical radius r (rows units): glyphs are spaced by arc length. */
export const ringCapacity = (r: number) => Math.max(0, Math.floor((2 * Math.PI * r) / CIRC.spacing));
const innerLimit = (R: number) => Math.max(1.6, R * 0.32);
const ringRadii = (R: number) => { const out: number[] = []; for (let r = R; r >= innerLimit(R); r -= CIRC.ringGap) out.push(r); return out; };
export const clusterCapacity = (R: number) => ringRadii(R).reduce((sum, r) => sum + ringCapacity(r), 0);

/**
 * A small bounded set (2–5) of compact text circles, each with a clear empty
 * center and negative space around it. Physical units are rows (x cells count
 * half) so rings look circular. Placement is seeded and collision-aware;
 * when a viewport is too small for several, fewer (down to one) are used.
 * Glyphs beyond the circles' total capacity simply do not participate.
 */
export function layoutCircles(count: number, width: number, height: number, rng: () => number): Cluster[] {
  const W = width / ASPECT, H = height, margin = 1.5;
  const Rmax = Math.max(2.6, Math.min(W, H) * 0.3);
  const place = (k: number, scale: number): Cluster[] | undefined => {
    const need = Math.ceil(count / k);
    let base = 2.6; while (base < Rmax && clusterCapacity(base) < need) base += 0.4;
    const placed: Cluster[] = [];
    for (let n = 0; n < k; n += 1) {
      const R = clamp(base * scale * (0.85 + rng() * 0.3), 2.6, Rmax);
      if (R * 2 + margin * 2 > Math.min(W, H) + 0.01 && k > 1) return undefined;
      let spot: {cx: number; cy: number} | undefined;
      for (let attempt = 0; attempt < 200 && !spot; attempt += 1) {
        const cx = margin + R + rng() * Math.max(0, W - 2 * (margin + R)), cy = margin + R + rng() * Math.max(0, H - 2 * (margin + R));
        if (placed.every(other => Math.hypot(cx - other.cx, cy - other.cy) >= R + other.R + 2.5)) spot = {cx, cy};
      }
      if (!spot) return undefined;
      placed.push({...spot, R, dir: rng() < 0.5 ? 1 : -1, rings: []});
    }
    return placed;
  };
  let clusters: Cluster[] | undefined;
  for (let k = clamp(Math.ceil(count / 70), CIRC.minClusters, CIRC.maxClusters); k >= 2 && !clusters; k -= 1) {
    // Prefer the full radius; shrink the circles a little before giving up on having several.
    for (const scale of [1, 0.85, 0.72]) { clusters = place(k, scale); if (clusters) break; }
  }
  clusters ??= [{cx: W / 2, cy: H / 2, R: Math.max(2.4, Math.min(Rmax, Math.min(W, H) / 2 - margin)), dir: 1, rings: []}];
  // Share the glyphs between clusters by capacity; inside a cluster, between rings by capacity.
  const totalCapacity = clusters.reduce((sum, c) => sum + clusterCapacity(c.R), 0);
  let remaining = Math.min(count, totalCapacity);
  clusters.forEach((cluster, index) => {
    const cap = clusterCapacity(cluster.R);
    const quota = index === clusters!.length - 1 ? Math.min(cap, remaining) : Math.min(cap, Math.round(Math.min(count, totalCapacity) * cap / totalCapacity));
    let left = quota; const radii = ringRadii(cluster.R);
    radii.forEach((r, k) => {
      const share = k === radii.length - 1 ? left : Math.min(left, Math.round(quota * ringCapacity(r) / cap));
      const slots = Math.min(share, ringCapacity(r));
      if (slots >= 3) { cluster.rings.push({cx: cluster.cx, cy: cluster.cy, r, dir: (k % 2 === 0 ? cluster.dir : -cluster.dir) as 1 | -1, slots, cluster: index}); left -= slots; }
    });
    remaining -= quota - left;
  });
  return clusters.filter(c => c.rings.length);
}

interface ClusterRuntime {
  stage: ClusterStage; t: number; start: number; order: number; alpha: number; scale: number; formed: boolean;
  rings: number[]; readyAt: number; flash: number; blastAt?: number;
}
interface Debris { x: number; y: number; vx: number; vy: number; life: number; ch: string; fg: number }

export class Circletastic extends Sim {
  readonly glyphs: Glyph[];
  phase: CircPhase = 'hold';
  phaseT = 0;
  clusters: Cluster[] = [];
  runtime: ClusterRuntime[] = [];
  rings: RingSpec[] = [];
  angle: number[] = [];
  omega: number[] = [];
  assigned: Array<{ring: number; slot: number} | undefined> = [];
  private delay: number[] = [];
  private duration: number[] = [];
  /** Seeded order in which source glyphs are harvested (stable for the life of the capture). */
  readonly harvestOrder: number[];
  /** Glyphs removed from their source position this reset cycle (presentation only). */
  readonly consumed = new Set<number>();
  debris: Debris[] = [];
  shock: Array<{cx: number; cy: number; t: number}> = [];
  private lastBlast = -1e9;
  private nextGap = 0.4;
  cycles = 0;
  /** Runs since the source screen was last restored. */
  run = 0;
  /** Phase names in the order they were entered (for tests and diagnostics). */
  readonly history: CircPhase[] = ['hold'];
  readonly explosions: Array<{cluster: number; at: number}> = [];
  constructor(capture: ScreenCapture, private readonly textColor: number) {
    super(capture, 0xc12c);
    this.glyphs = glyphsOf(capture, textColor, CIRC.glyphCap);
    const order = this.glyphs.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) { const j = Math.floor(this.rng() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
    this.harvestOrder = order;
    this.plan();
  }
  /** Share of the source harvested on the current run. */
  harvestShare(): number { return CIRC.harvest[Math.min(this.run, CIRC.harvest.length - 1)]!; }
  /** ASSIGN: pick this run's harvest, lay out the circles, and give every participant a ring and slot before anything moves. */
  private plan() {
    const target = Math.ceil(this.harvestShare() * this.glyphs.length);
    const harvest = this.harvestOrder.slice(0, target);
    this.consumed.clear();
    this.clusters = layoutCircles(harvest.length, this.capture.width, this.capture.height, this.rng);
    this.rings = this.clusters.flatMap(c => c.rings);
    this.angle = this.rings.map(() => this.rand(0, Math.PI * 2));
    this.omega = this.rings.map(() => CIRC.omegaStart);
    this.assigned = []; this.delay = []; this.duration = [];
    const capacity = this.rings.reduce((sum, ring) => sum + ring.slots, 0);
    // Harvested glyphs fill the rings; harvested glyphs beyond the capacity are consumed outright (hidden).
    const participants = harvest.slice(0, capacity);
    let g = 0;
    this.rings.forEach((ring, ri) => { for (let s = 0; s < ring.slots && g < participants.length; s += 1, g += 1) this.assigned[participants[g]!] = {ring: ri, slot: s}; });
    for (const index of harvest.slice(capacity)) this.consumed.add(index);
    this.glyphs.forEach((glyph, i) => {
      glyph.a = glyph.x; glyph.r = glyph.y; glyph.t = 0; glyph.vx = glyph.vy = 0;
      glyph.state = this.assigned[i] ? 0 : this.consumed.has(i) ? 4 : 3;
      this.delay[i] = this.rand(0, 0.9); this.duration[i] = this.rand(1.2, 2.2);
    });
    const base = this.rand(1.5, 2.1);
    this.runtime = this.clusters.map((_, ci) => ({
      stage: 'gather', t: 0, start: ci === 0 ? 0 : this.rand(0.2, 0.7) * ci, order: ci,
      // Later circles spin up harder, so they catch up with the first.
      alpha: base * (1 + 0.65 * ci), scale: 1, formed: false, rings: this.rings.map((r, i) => (r.cluster === ci ? i : -1)).filter(i => i >= 0), readyAt: Infinity, flash: 0,
    }));
    this.lastBlast = -1e9; this.nextGap = this.rand(0.3, 0.6);
    this.debris = []; this.shock = [];
  }
  slotPosition(i: number): {x: number; y: number} | undefined {
    const a = this.assigned[i];
    if (!a) return undefined;
    const ring = this.rings[a.ring]!;
    const scale = this.runtime[ring.cluster]?.scale ?? 1;
    const th = this.angle[a.ring]! + (a.slot / ring.slots) * Math.PI * 2;
    return {x: (ring.cx + Math.cos(th) * ring.r * scale) * ASPECT, y: ring.cy + Math.sin(th) * ring.r * scale};
  }
  clusterOf(i: number): number | undefined { const a = this.assigned[i]; return a ? this.rings[a.ring]!.cluster : undefined; }
  private setPhase(phase: CircPhase) { if (phase === this.phase) return; this.phase = phase; this.phaseT = 0; this.history.push(phase); }
  update(dt: number): void {
    this.phaseT += dt;
    const w = this.capture.width, h = this.capture.height;
    if (this.phase === 'hold') { if (this.phaseT >= CIRC.hold) this.setPhase('gather'); else return; }
    if (this.phase === 'scatter' || this.phase === 'settle') {
      this.integrate(dt, w, h);
      this.tickBlasts(dt);
      if (this.phase === 'scatter' && this.phaseT >= CIRC.scatter) this.setPhase('settle');
      else if (this.phase === 'settle') {
        for (const g of this.glyphs) if (g.state === 2) { g.vx *= 0.8; g.vy *= 0.8; }
        if (this.phaseT >= CIRC.settle) this.nextRun();
      }
      return;
    }
    this.runtime.forEach((rt, ci) => this.stepCluster(rt, ci, dt));
    this.integrate(dt, w, h);
    this.tickBlasts(dt);
    // Order of readiness decides who blows next, one after another.
    const ready = this.runtime.map((rt, ci) => ({rt, ci})).filter(({rt}) => rt.stage === 'critical' && rt.readyAt <= this.t).sort((a, b) => a.rt.readyAt - b.rt.readyAt);
    if (ready.length && this.t - this.lastBlast >= this.nextGap * 1000) { this.detonate(ready[0]!.ci); this.lastBlast = this.t; this.nextGap = this.rand(0.35, 0.8); }
    const stages = this.runtime.map(rt => rt.stage);
    if (stages.every(stage => stage === 'exploded')) this.setPhase('scatter');
    else if (stages.includes('exploded')) this.setPhase('explode');
    else if (stages.some(stage => stage === 'collapse' || stage === 'critical')) this.setPhase('collapse');
    else if (stages.includes('spin')) this.setPhase('spin');
    else this.setPhase('gather');
  }
  private stepCluster(rt: ClusterRuntime, ci: number, dt: number) {
    if (rt.stage === 'exploded') return;
    rt.t += dt;
    if (rt.stage === 'gather') {
      if (rt.t < rt.start) return;
      const local = rt.t - rt.start;
      let allHome = true;
      this.glyphs.forEach((g, i) => {
        if (this.clusterOf(i) !== ci || g.state === 1) return;
        const target = this.slotPosition(i)!;
        const u = ease((local - this.delay[i]!) / this.duration[i]!);
        const swirl = Math.sin(u * Math.PI) * 3;
        g.x = g.a + (target.x - g.a) * u + swirl * (g.oy < this.capture.height / 2 ? 1 : -1); g.y = g.r + (target.y - g.r) * u;
        if (local >= this.delay[i]! + this.duration[i]!) { g.x = target.x; g.y = target.y; g.state = 1; } else allHome = false;
      });
      if (allHome) { rt.stage = 'spin'; rt.formed = true; rt.t = 0; }   // this circle starts turning right away
      return;
    }
    // Spin (and keep accelerating through the collapse): angular acceleration, never a speed jump.
    const lead = this.omega[rt.rings[0]!]!;
    for (const ri of rt.rings) {
      const ring = this.rings[ri]!;
      this.omega[ri] = Math.min(CIRC.omegaMax * (1 + 0.06 * rt.rings.indexOf(ri)), this.omega[ri]! + rt.alpha * (1 + 0.3 * rt.rings.indexOf(ri)) * dt * (rt.stage === 'collapse' ? 1.6 : 1));
      this.angle[ri]! += this.omega[ri]! * ring.dir * dt;
    }
    if (rt.stage === 'spin' && lead >= CIRC.omegaCollapse) { rt.stage = 'collapse'; rt.t = 0; }
    if (rt.stage === 'collapse') {
      const u = clamp(rt.t / CIRC.collapseSeconds, 0, 1);
      rt.scale = 1 - (1 - CIRC.collapseScale) * u * u;           // tightens faster and faster
      if (u >= 1) { rt.stage = 'critical'; rt.t = 0; rt.readyAt = this.t + CIRC.criticalSeconds * 1000; }
    }
    if (rt.stage === 'critical') rt.scale = CIRC.collapseScale * (1 + 0.05 * Math.sin(this.t / 30));
    // Strain: radial wobble and an occasional slipping glyph while the ring is stressed.
    const strain = rt.stage === 'collapse' || rt.stage === 'critical' ? 1 : clamp((lead - CIRC.omegaCollapse * 0.6) / (CIRC.omegaCollapse * 0.4), 0, 1);
    this.glyphs.forEach((g, i) => {
      if (this.clusterOf(i) !== ci || g.state !== 1) return;
      const p = this.slotPosition(i)!;
      const slip = strain > 0 && (i * 2654435761 >>> 0) % 97 < 3 ? strain * 1.2 : 0;
      const wob = strain * 0.4 * Math.sin(this.t / 55 + i);
      const a = this.assigned[i]!, ring = this.rings[a.ring]!, th = this.angle[a.ring]! + (a.slot / ring.slots) * Math.PI * 2;
      g.x = p.x + Math.cos(th) * (wob + slip) * ASPECT; g.y = p.y + Math.sin(th) * (wob + slip);
    });
  }
  /** The supernova: the compressed core releases its spin; every glyph keeps tangential momentum plus a hard radial kick. */
  private detonate(ci: number) {
    const rt = this.runtime[ci]!; rt.stage = 'exploded'; rt.flash = CIRC.flashSeconds; rt.blastAt = this.t;
    const cluster = this.clusters[ci]!;
    this.explosions.push({cluster: ci, at: this.t});
    this.shock.push({cx: cluster.cx * ASPECT, cy: cluster.cy, t: 0});
    this.glyphs.forEach((g, i) => {
      const a = this.assigned[i];
      if (!a || this.rings[a.ring]!.cluster !== ci) return;
      const ring = this.rings[a.ring]!;
      const th = this.angle[a.ring]! + (a.slot / ring.slots) * Math.PI * 2;
      const speed = this.omega[a.ring]! * ring.r * rt.scale * ring.dir;     // rows/s along the tangent at the moment of release
      const out = this.rand(9, 22);
      g.vx = (-Math.sin(th) * speed * 0.9 + Math.cos(th) * out) * ASPECT + this.rand(-2, 2);
      g.vy = Math.cos(th) * speed * 0.9 + Math.sin(th) * out + this.rand(-1.2, 1.2);
      g.state = 2;
    });
    // Debris: consumed source characters and sparks fly out too (bounded).
    const pool = [...this.consumed];
    const n = Math.min(CIRC.debrisCap - this.debris.length, 36);
    for (let k = 0; k < n; k += 1) {
      const a = this.rand(0, Math.PI * 2), sp = this.rand(8, 26);
      const source = pool.length ? this.glyphs[pool[Math.floor(this.rng() * pool.length)]!] : undefined;
      this.debris.push({x: cluster.cx * ASPECT, y: cluster.cy, vx: Math.cos(a) * sp * ASPECT, vy: Math.sin(a) * sp, life: this.rand(0.6, 1.4), ch: source?.ch ?? this.pick(['*', '·', '+', '•']), fg: source?.fg ?? 0xffffff});
    }
  }
  private tickBlasts(dt: number) {
    for (const rt of this.runtime) if (rt.flash > 0) rt.flash = Math.max(0, rt.flash - dt);
    for (const d of this.debris) { d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 1 - 0.9 * dt; d.vy *= 1 - 0.9 * dt; d.life -= dt; }
    this.debris = this.debris.filter(d => d.life > 0 && d.x >= 0 && d.x < this.capture.width && d.y >= 0 && d.y < this.capture.height);
    for (const s of this.shock) s.t += dt;
    this.shock = this.shock.filter(s => s.t < 0.55);
  }
  private integrate(dt: number, w: number, h: number) {
    for (const g of this.glyphs) {
      if (g.state !== 2) continue;
      g.vx *= 1 - 0.5 * dt; g.vy *= 1 - 0.5 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt;
      if (g.x < 1) { g.x = 1; g.vx = Math.abs(g.vx) * 0.5; } else if (g.x > w - 2) { g.x = w - 2; g.vx = -Math.abs(g.vx) * 0.5; }
      if (g.y < 1) { g.y = 1; g.vy = Math.abs(g.vy) * 0.5; } else if (g.y > h - 2) { g.y = h - 2; g.vy = -Math.abs(g.vy) * 0.5; }
    }
  }
  /** Next run: more of the source is consumed each time; after the configured number of runs the screen is restored cleanly. */
  private nextRun() {
    this.cycles += 1; this.loops = this.cycles; this.run += 1;
    if (this.run >= CIRC.runsBeforeReset) {
      this.run = 0;
      for (const g of this.glyphs) { g.x = g.ox; g.y = g.oy; g.vx = g.vy = 0; g.state = 0; }
    }
    this.plan();
    this.setPhase('hold'); this.phaseT = 0;
  }
  paint(grid: CellGrid, ctx: EffectContext): void {
    // Source glyphs that are harvested (this or an earlier run) are gone from their original cells.
    const skip = new Set<number>();
    this.glyphs.forEach(g => { if (g.state !== 3) skip.add(Math.floor(g.oy) * this.capture.width + Math.floor(g.ox)); });
    drawStatic(grid, this.capture, skip, ctx.palette.text);
    const accent = ctx.palette.stops[0] ?? ctx.palette.accent;
    this.glyphs.forEach((g, i) => {
      if (g.state === 4 || g.state === 3) return;
      const ci = this.clusterOf(i); const rt = ci === undefined ? undefined : this.runtime[ci];
      const heat = rt ? (rt.stage === 'collapse' ? 0.5 + 0.4 * (1 - rt.scale) : rt.stage === 'critical' ? 1 : rt.stage === 'spin' ? clamp((this.omega[this.assigned[i]!.ring]! - CIRC.omegaStart) / CIRC.omegaCollapse, 0, 1) * 0.5 : 0) : 0;
      const flash = rt && rt.flash > 0 ? rt.flash / CIRC.flashSeconds : 0;
      grid.set(g.x, g.y, g.ch, mixPacked(mixPacked(g.fg, accent, heat * 0.7), 0xffffff, Math.max(flash * 0.8, rt?.stage === 'critical' ? 0.7 : 0)));
    });
    for (const s of this.shock) {
      const radius = s.t / 0.55 * 12;
      for (let k = 0; k < CIRC.shockPoints; k += 1) { const a = (k / CIRC.shockPoints) * Math.PI * 2; grid.plot(s.cx + Math.cos(a) * radius * ASPECT, s.cy + Math.sin(a) * radius, '·', mixPacked(0x303040, 0xffffff, 1 - s.t / 0.55)); }
    }
    for (const d of this.debris) grid.plot(d.x, d.y, d.ch, mixPacked(0x303040, d.fg, clamp(d.life / 0.6, 0, 1)));
  }
}

// ------------------------------------------------------------- raiseCatError

export interface Platform { y: number; x0: number; x1: number; floor?: boolean }
const CAT_W = CAT_CELL_WIDTH, CAT_H = CAT_CELL_HEIGHT;
const HOP_RISE = 1.4;

/** Short, clearly fictional jokes; none claims a real fault, breach, loss or corruption. */
export const JOKES: readonly string[] = [
  'Too many words, not enough naps', 'Expected cat, found project', 'Purrmission denied', 'Catastrophic purrsing failure', 'Unexpected meow in expression',
  'Lint found 3 loose whiskers', 'Variable refuses to be pet', 'Function has not been fed recently', 'This line is not sufficiently loaf-shaped',
  'Build blocked by nap dependency', 'Keyboard currently occupied by cat', 'Cat hair found in type system', 'Project requires more treats',
  'Syntax hiss-lighting conflict', 'Tail recursion has become literal', 'Command may knock items off desk', 'File is sitting in the box but not the repository',
  'Import contains unauthorized zoomies', 'Compiler requested belly rubs', 'Object is climbing the curtains', 'Semicolon escaped the scratching post',
  'Too much seriousness detected', 'Error raised successfully', 'Pointer chased laser into invalid memory', 'This token is acting suspiciously dog-like',
  'Thread tangled in yarn scheduler', 'Path is suspiciously walkable', 'Command contains traces of responsibility', 'Variable has exceeded daily zoomie allowance',
  'Missing dependency: treats', 'Runtime entered loaf mode', 'Whisker alignment check failed', 'Paw-sized race condition detected', 'Catastrophe successfully reproduced',
  'Process interrupted by mandatory nap', 'Excessive keyboard warmth detected', 'Stack contains forbidden tuna', 'Cache invalidated by tail movement',
  'Box exists and therefore must be occupied', 'This module has not been sniffed', 'Warning: suspiciously empty cardboard box',
  '`{w}` looks suspiciously productive', 'Expected cat, found `{w}`', '`{w}` appears emotionally unavailable', '`{w}` has been judged', 'Unknown identifier: `{w}`',
];
export const KEYBOARD_JOKES: readonly string[] = ['Input method: paws', 'Unexpected paw event', 'Keyboard privileges revoked', 'Typing accuracy degraded by loaf',
  'Eight paws detected. Expected zero.', 'Composer under temporary cat management', 'Keyboard appears sufficiently warm'];
export const MEOWS: readonly string[] = ['meow', 'meow!', 'mrow', 'mrow?', 'mrrp', 'mrrrp!', 'prrr', 'purr...', 'purrrrr', 'nya', 'mrrow!', 'mrowe!', 'mreow', 'brrrp', 'chirp!', 'ekekekek'];
export const CHARACTER_JOKE = 'Unexpected character';
export const DIVIDER_JOKE = 'Structural integrity questionable';
export const KEYSMASH = 'asdfjkl;qwertyuiopzxcvbnm,./[]0123456789';
export interface Diagnostic { row: number; x0: number; x1: number; text: string; level: 'error' | 'warn'; born: number; labelRow?: number; labelX?: number }
export const DIAGNOSTIC_CAP = 14;
export const WOBBLE_CAP = 64;
export const KEYBOARD_MAX = 14;

/** Horizontal stretches of occupied cells (single gaps tolerated) the cat can stand on, from geometry only. The screen's bottom edge is always one more floor. */
export function extractPlatforms(capture: ScreenCapture, minWidth = 6): Platform[] {
  const out: Platform[] = [];
  for (let y = CAT_H; y < capture.height; y += 1) {
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
  if (capture.height > CAT_H) out.push({y: capture.height, x0: 0, x1: capture.width - 1, floor: true});
  return out;
}

/** Hops between platforms: up to 9 rows up, 16 down, and a bounded horizontal gap. Pure geometry. */
export function platformGraph(platforms: readonly Platform[]): number[][] {
  return platforms.map((a, i) => platforms.flatMap((b, j) => {
    if (i === j) return [];
    const up = a.y - b.y, gap = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
    // A rising hop needs room above the target for the whole sprite; drops are always possible.
    const fits = up < 0 || (b.y - 1) - HOP_RISE - (CAT_H - 1) >= 0;
    return (up <= 9 && up >= -16 && gap <= 18 && !(b.floor && a.floor) && fits) ? [j] : [];
  }));
}

/** Fewest-hop route (excluding the start) over the graph, or undefined when unreachable or longer than `limit`. */
export function routeBetween(graph: readonly number[][], from: number, to: number, limit = 8): number[] | undefined {
  if (from === to) return [];
  const previous = new Map<number, number>([[from, -1]]); const queue = [from];
  while (queue.length) {
    const node = queue.shift()!;
    for (const next of graph[node] ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, node); queue.push(next);
      if (next === to) {
        const route: number[] = []; for (let n: number = to; n !== from; n = previous.get(n)!) route.unshift(n);
        return route.length <= limit ? route : undefined;
      }
    }
  }
  return undefined;
}

export type CatState = 'walk' | 'idle' | 'sit' | 'jump' | 'land' | 'paw';

export class RaiseCatError extends Sim {
  platforms: Platform[];
  graph: number[][];
  cat = {x: 2, feet: 1, vx: 0, vy: 0, state: 'idle' as CatState, t: 0, dir: 1 as 1 | -1, platform: -1, walkTo: undefined as number | undefined, pose: 'idle' as CatPose};
  diagnostics: Diagnostic[] = [];
  wobble = new Map<number, {dx: number; dy: number; until: number}>();
  /** A short-lived cat sound near the cat; never an error. */
  speech?: {text: string; until: number};
  /** Fake keyboard garbage over the composer row: pure overlay text, owned entirely by this effect. */
  typing?: {row: number; x: number; text: string; until: number; next: number};
  route: number[] = [];
  goal = -1;
  readonly visits = new Map<string, number>();
  readonly sounds: string[] = [];
  readonly keyboard: string[] = [];
  readonly composerRow: number;
  private think = 0.6;
  private cycleStart = 0;
  private resetting = 0;
  private lastSpeech = -1e9;
  private lastTyping = -1e9;
  private dwell = 0;
  /** The platform just left; it cannot catch the cat again until the cat is clearly away from it. */
  private origin = -1;
  private originFeet = 0;
  readonly log: string[] = [];
  constructor(capture: ScreenCapture, private readonly textColor: number) {
    super(capture, 0xca7e);
    this.platforms = extractPlatforms(capture);
    this.graph = platformGraph(this.platforms);
    let last = -1;
    for (let i = 0; i < capture.glyphs.length; i += 1) if (capture.glyphs[i] !== ' ') last = Math.floor(i / capture.width);
    this.composerRow = Math.max(0, last);
    // Start somewhere it can also leave again.
    const mobile = this.platforms.map((_, i) => i).filter(i => this.graph[i]!.length > 0 && !this.platforms[i]!.floor);
    this.place(mobile.length ? this.pick(mobile) : Math.max(0, this.platforms.length - 1));
  }
  private place(index: number) {
    const p = this.platforms[index];
    if (!p) { this.cat.platform = -1; this.cat.feet = this.capture.height - 1; this.cat.x = 0; return; }
    this.cat.platform = index; this.cat.feet = p.y - 1;
    this.cat.x = clamp(p.x0 + this.rand(0, Math.max(0, p.x1 - p.x0 - CAT_W)), 0, Math.max(0, this.capture.width - CAT_W));
    this.visit(p);
  }
  private region(p: Platform): string { return `${Math.min(2, Math.floor((p.y / (this.capture.height + 1)) * 3))}:${Math.min(2, Math.floor((((p.x0 + p.x1) / 2) / this.capture.width) * 3))}`; }
  private visit(p: Platform) { const key = this.region(p); this.visits.set(key, (this.visits.get(key) ?? 0) + 1); }
  /** Regions (thirds of the screen) the cat has been to. */
  regionsVisited(): number { return this.visits.size; }
  private wordAt(row: number, x: number): {x0: number; x1: number; text: string} | undefined {
    const w = this.capture.width; let i = clamp(Math.round(x), 0, w - 1);
    const at = (c: number) => this.capture.glyphs[row * w + c] ?? ' ';
    for (let d = 0; d < 8 && at(i) === ' '; d += 1) i = clamp(i + (d % 2 === 0 ? d + 1 : -(d + 1)), 0, w - 1);
    if (at(i) === ' ') return undefined;
    let a = i, b = i; while (a > 0 && at(a - 1) !== ' ') a -= 1; while (b < w - 1 && at(b + 1) !== ' ') b += 1;
    let text = ''; for (let c = a; c <= b; c += 1) text += at(c);
    return {x0: a, x1: b, text: text.replace(/[^\p{L}\p{N}_./~-]/gu, '').slice(0, 14) || 'text'};
  }
  private raise(row: number, x: number, joke?: string, pool: readonly string[] = JOKES) {
    const word = this.wordAt(row, x);
    if (!word || this.diagnostics.some(d => d.row === row && d.x0 === word.x0)) return;
    const text = joke ?? this.pick(pool).replace('{w}', word.text);
    this.diagnostics.push({row, x0: word.x0, x1: word.x1, text, level: this.rng() < 0.7 ? 'error' : 'warn', born: this.t});
    if (this.diagnostics.length > DIAGNOSTIC_CAP) this.diagnostics.shift();
    this.log.push(text);
    this.placeLabel(this.diagnostics[this.diagnostics.length - 1]!);
  }
  /** A label goes on a blank stretch near its range (never over text), or is skipped when the screen is full there. */
  private placeLabel(d: Diagnostic) {
    const need = Math.min(d.text.length + 4, this.capture.width - 2);
    for (const dy of [-1, 1, -2, 2, -3, 3]) {
      const row = d.row + dy; if (row < 0 || row >= this.capture.height) continue;
      const x = clamp(d.x0, 0, this.capture.width - need);
      let free = true;
      for (let c = x; c < x + need && free; c += 1) if (this.capture.glyphs[row * this.capture.width + c] !== ' ' || this.diagnostics.some(o => o !== d && o.labelRow === row && o.labelX !== undefined && c >= o.labelX && c < o.labelX + o.text.length + 4)) free = false;
      if (free) { d.labelRow = row; d.labelX = x; return; }
    }
  }
  private wobbleCell(i: number, dx: number, dy: number, ms: number) { if (this.wobble.size < WOBBLE_CAP) this.wobble.set(i, {dx, dy, until: this.t + ms}); }
  /** The cat bumps a word: its glyphs shift 1–3 cells and spring back. */
  private bump(row: number, x: number) {
    const word = this.wordAt(row, x); if (!word) return;
    const shift = (this.rng() < 0.5 ? -1 : 1) * (1 + Math.floor(this.rng() * 3));
    for (let c = word.x0; c <= word.x1; c += 1) { const i = row * this.capture.width + c; if (this.capture.glyphs[i] !== ' ') this.wobbleCell(i, Math.sign(shift) * Math.min(Math.abs(shift), 1 + (c - word.x0) % 3), c % 2 === 0 ? -1 : 0, 700); }
  }
  private isDivider(row: number): boolean {
    let n = 0, lines = 0; const w = this.capture.width;
    for (let c = 0; c < w; c += 1) { const g = this.capture.glyphs[row * w + c]!; if (g !== ' ') { n += 1; if ('─━═-_—│┄┈'.includes(g)) lines += 1; } }
    return n >= 10 && lines / n >= 0.6;
  }
  /** Landing on a line makes it dip a row and rebound; a divider bends along its length. */
  private landOn(platform: Platform, x: number) {
    if (platform.floor) return;
    const w = this.capture.width;
    const divider = this.isDivider(platform.y);
    const from = divider ? platform.x0 : Math.max(platform.x0, Math.round(x) - 4), to = divider ? Math.min(platform.x1, platform.x0 + 47) : Math.min(platform.x1, Math.round(x) + CAT_W + 4);
    for (let c = from; c <= to; c += 1) { const i = platform.y * w + c; if (this.capture.glyphs[i] !== ' ') this.wobbleCell(i, 0, divider ? (c % 4 < 2 ? 1 : -1) : 1, divider ? 900 : 450); }
    if (divider && this.rng() < 0.6) this.raise(platform.y, x + CAT_W / 2, DIVIDER_JOKE);
  }
  private maybeMeow(probability: number) {
    if (this.t - this.lastSpeech < 4000 || this.rng() >= probability) return;
    const text = this.pick(MEOWS); this.lastSpeech = this.t; this.speech = {text, until: this.t + 1800}; this.sounds.push(text);
  }
  private floorIndex() { return this.platforms.findIndex(p => p.floor); }
  /** Weighted target: usually somewhere plausible nearby, sometimes a far part of the screen, favouring regions not visited yet. */
  pickGoal(): number {
    const here = this.platforms[this.cat.platform];
    const candidates: Array<{i: number; w: number}> = [];
    this.platforms.forEach((p, i) => {
      if (i === this.cat.platform) return;
      if (!routeBetween(this.graph, this.cat.platform, i)) return;
      const near = here ? Math.abs(p.y - here.y) <= 8 && Math.abs((p.x0 + p.x1) / 2 - this.cat.x) <= 25 : true;
      // The composer row is a favourite spot: that is where a cat sits on a keyboard.
      candidates.push({i, w: (near ? 3 : 1) * (p.floor || p.y >= this.composerRow ? 2.5 : 1) / (1 + (this.visits.get(this.region(p)) ?? 0))});
    });
    if (!candidates.length) return -1;
    let roll = this.rng() * candidates.reduce((s, c) => s + c.w, 0);
    for (const c of candidates) { roll -= c.w; if (roll <= 0) return c.i; }
    return candidates[0]!.i;
  }
  update(dt: number): void {
    const cat = this.cat; cat.t += dt; this.think -= dt;
    for (const [i, w] of this.wobble) if (this.t > w.until) this.wobble.delete(i);
    if (this.speech && this.t > this.speech.until) this.speech = undefined;
    if (this.typing) {
      if (this.t >= this.typing.until) { this.typing = undefined; this.maybeMeow(1); this.lastSpeech = this.t; }
      else if (this.t >= this.typing.next) { this.typing.text = this.keysmash(); this.typing.next = this.t + 250; }
    }
    if (this.resetting > 0) {
      this.resetting -= dt;
      if (this.resetting <= 0) { this.diagnostics = []; this.wobble.clear(); this.typing = undefined; this.speech = undefined; this.cycleStart = this.t; this.loops += 1; this.visits.clear(); }
      return;
    }
    // Cycle: errors accumulate, hold briefly when overwhelmed, then one tasteful reset.
    if (this.diagnostics.length >= DIAGNOSTIC_CAP - 2 || this.t - this.cycleStart > 90_000) { this.resetting = 3; return; }
    const p = this.platforms[cat.platform];
    if (cat.state === 'jump') { this.flying(dt); return; }
    if (cat.platform < 0 && this.platforms.length) { const near = this.nearestPlatform(); if (near >= 0) this.place(near); }
    if (cat.state === 'walk' && p) {
      const [left, right] = this.bounds(p);
      cat.x += cat.dir * 6 * dt;
      if (cat.walkTo !== undefined) {
        const target = clamp(cat.walkTo, left, right);
        if ((cat.dir === 1 && cat.x >= target) || (cat.dir === -1 && cat.x <= target)) { cat.x = target; cat.walkTo = undefined; cat.state = 'idle'; cat.t = 0; this.think = 0; }
      } else if (cat.x < left || cat.x > right) { cat.x = clamp(cat.x, left, right); cat.dir = (cat.dir * -1) as 1 | -1; cat.state = 'idle'; cat.t = 0; }
    }
    if ((cat.state === 'land' || cat.state === 'paw' || cat.state === 'sit') && cat.t > (cat.state === 'sit' ? 1.4 : 0.55)) { cat.state = 'idle'; cat.t = 0; }
    if (this.think > 0 || cat.state === 'walk' || !p) return;
    this.think = this.rand(0.6, 1.8);
    this.decide(p);
  }
  /** Where the cat's left edge may be while it stands on a platform: it can overhang the ends a little, never leave the screen. */
  private bounds(p: Platform): [number, number] {
    const left = Math.max(0, p.x0 - 3);
    return [left, Math.max(left, Math.min(this.capture.width - CAT_W, p.x1 - CAT_W + 4))];
  }
  private keysmash(): string {
    const length = 6 + Math.floor(this.rng() * (KEYBOARD_MAX - 5));
    let text = ''; for (let i = 0; i < length; i += 1) text += KEYSMASH[Math.floor(this.rng() * KEYSMASH.length)]!;
    return text;
  }
  private decide(p: Platform) {
    const cat = this.cat; const centre = cat.x + CAT_W / 2;
    if (this.goal === cat.platform) { this.goal = -1; this.route = []; }
    if (!this.route.length && this.goal >= 0) this.route = routeBetween(this.graph, cat.platform, this.goal) ?? [];
    if (!this.route.length) this.goal = -1;
    // Following a route: walk to the takeoff point, then hop.
    if (this.route.length) {
      const next = this.platforms[this.route[0]!]!;
      const [lo, hi] = this.bounds(p);
      const takeoff = clamp((next.x0 + next.x1) / 2 - CAT_W / 2, lo, hi);
      if (Math.abs(cat.x - takeoff) > 1.2) { cat.walkTo = takeoff; cat.dir = takeoff > cat.x ? 1 : -1; cat.state = 'walk'; cat.t = 0; return; }
      this.hop(this.route[0]!);
      return;
    }
    // Arrived (or no goal): small local business, then sometimes pick somewhere far.
    const roll = this.rng();
    const onComposer = p.floor || p.y >= this.composerRow;
    if (onComposer && this.t - this.lastTyping > 12_000 && !this.typing && roll < 0.5) { this.startTyping(); return; }
    this.dwell += 1;
    if (this.dwell >= 3 && this.rng() < 0.55) {
      const goal = this.pickGoal();
      const route = goal >= 0 ? routeBetween(this.graph, cat.platform, goal) : undefined;
      if (route?.length) { this.goal = goal; this.route = route; this.dwell = 0; this.maybeMeow(0.15); return; }
    }
    if (roll < 0.28) { cat.state = 'walk'; cat.dir = this.rng() < 0.5 ? 1 : -1; cat.t = 0; cat.walkTo = undefined; }
    else if (roll < 0.48) { cat.state = 'sit'; cat.t = 0; if (!p.floor && this.rng() < 0.8) this.raise(p.y, centre); this.maybeMeow(0.3); }
    else if (roll < 0.66) { cat.state = 'paw'; cat.t = 0; if (!p.floor) { this.bump(p.y, cat.dir === 1 ? cat.x + CAT_W + 1 : cat.x - 2); this.raise(p.y, cat.dir === 1 ? cat.x + CAT_W + 1 : cat.x - 2, CHARACTER_JOKE); } this.maybeMeow(0.3); }
    else if (roll < 0.74) this.maybeMeow(1);
    else { const goal = this.pickGoal(); const route = goal >= 0 ? routeBetween(this.graph, cat.platform, goal) : undefined; if (route?.length) { this.goal = goal; this.route = route; } else { cat.state = 'walk'; cat.dir = (cat.dir * -1) as 1 | -1; cat.walkTo = undefined; } }
  }
  private startTyping() {
    const cat = this.cat; cat.state = 'sit'; cat.t = -0.8; // sits a little longer on the keyboard
    this.lastTyping = this.t;
    const w = this.capture.width; let last = -1;
    for (let c = 0; c < w; c += 1) if (this.capture.glyphs[this.composerRow * w + c] !== ' ') last = c;
    const text = this.keysmash();
    const x = clamp(last + 2, 0, Math.max(0, w - text.length - 1));
    this.typing = {row: this.composerRow, x, text, until: this.t + 2300, next: this.t + 250};
    this.keyboard.push(text);
    if (this.rng() < 0.35) this.raise(this.composerRow, Math.max(0, last - 2), this.pick(KEYBOARD_JOKES));
  }
  private nearestPlatform(): number {
    let best = -1, bestD = 1e9;
    this.platforms.forEach((q, i) => { const d = Math.abs(q.y - 1 - this.cat.feet) + Math.abs(q.x0 - this.cat.x) * 0.1; if (d < bestD) { bestD = d; best = i; } });
    return best;
  }
  /** Platforms one hop away from where the cat stands. */
  jumpTargets(): number[] { return this.graph[this.cat.platform] ?? []; }
  private hop(index: number) {
    const cat = this.cat; const q = this.platforms[index]!;
    const targetFeet = q.y - 1, dy = cat.feet - targetFeet;       // dy > 0: the target is higher
    const g = 38;
    const landX = clamp(q.x0 + (q.x1 - q.x0 - CAT_W) / 2 + this.rand(-2, 2), Math.max(0, q.x0 - 4), Math.max(0, Math.min(this.capture.width - CAT_W, q.x1 - CAT_W + 4)));
    if (dy < 0) {
      // A drop: step off the edge and fall; no upward arc.
      const tDown = Math.sqrt(Math.max(0.0001, 2 * -dy / g));
      cat.vy = -2; cat.vx = (landX - cat.x) / (tDown + 0.1);
    } else {
      const rise = dy + HOP_RISE;
      // The arc must keep the whole sprite inside the screen; otherwise this hop is not taken.
      if (targetFeet - HOP_RISE - (CAT_H - 1) < 0 || cat.feet - rise - (CAT_H - 1) < 0) { this.route = []; this.goal = -1; cat.state = 'walk'; cat.dir = (cat.dir * -1) as 1 | -1; cat.walkTo = undefined; return; }
      const vy0 = -Math.sqrt(2 * g * rise);
      const tUp = -vy0 / g, tDown = Math.sqrt(Math.max(0.0001, 2 * Math.max(0.2, targetFeet - (cat.feet - rise)) / g));
      cat.vy = vy0; cat.vx = (landX - cat.x) / (tUp + tDown);
    }
    this.origin = cat.platform; this.originFeet = cat.feet;
    cat.state = 'jump'; cat.t = 0; cat.platform = -1; cat.walkTo = undefined;
  }
  private flying(dt: number) {
    const cat = this.cat;
    cat.vy += 38 * dt; cat.x += cat.vx * dt; cat.feet += cat.vy * dt;
    cat.x = clamp(cat.x, 0, Math.max(0, this.capture.width - CAT_W));
    if (cat.feet < CAT_H - 1) { cat.feet = CAT_H - 1; cat.vy = Math.max(cat.vy, 0); } // never above the top row
    if (cat.vy <= 0) return;
    const centre = cat.x + CAT_W / 2;
    const hit = this.platforms.findIndex((q, i) => !(i === this.origin && Math.abs(cat.feet - this.originFeet) < 1.5) && Math.abs(cat.feet - (q.y - 1)) < 0.9 && centre >= q.x0 - 3 && centre <= q.x1 + 3 && cat.feet <= q.y - 1 + 0.9);
    if (hit < 0) return;
    const q = this.platforms[hit]!;
    cat.platform = hit; cat.feet = q.y - 1; cat.vx = cat.vy = 0; cat.state = 'land'; cat.t = 0;
    this.visit(q);
    if (this.route[0] === hit) this.route.shift();
    // Landed on a line along the way (intermediate text catches the fall): keep the goal, plan again from here.
    else if (this.route.length || this.goal >= 0) this.route = this.goal >= 0 && this.goal !== hit ? routeBetween(this.graph, hit, this.goal) ?? [] : [];
    if (this.goal === hit) { this.goal = -1; this.route = []; }
    this.landOn(q, cat.x);
    if (!q.floor) { this.bump(q.y, centre); if (this.rng() < 0.7) this.raise(q.y, centre); }
    this.maybeMeow(0.35);
    this.think = 0.4;
  }
  frame(): CatPose {
    const c = this.cat;
    if (c.state === 'jump') return 'jump';
    if (c.state === 'land') return 'crouch';
    if (c.state === 'walk') return Math.floor(c.t * 5) % 2 === 0 ? 'walkA' : 'walkB';
    if (c.state === 'paw') return 'paw';
    if (c.state === 'sit') return 'sit';
    const phase = this.t % 4800;
    if (phase < 160) return 'blink';
    if (phase > 2200 && phase < 2700) return 'tail';
    return 'idle';
  }
  paint(grid: CellGrid, ctx: EffectContext): void {
    const w = this.capture.width;
    // Captured text, with wobbling cells nudged (presentation only; the capture itself is never written).
    const moved = new Map<number, {x: number; y: number}>();
    for (const [i, wb] of this.wobble) {
      const remaining = clamp((wb.until - this.t) / 700, 0, 1);
      const scale = remaining > 0.5 ? 1 : remaining * 2;
      moved.set(i, {x: (i % w) + Math.round(wb.dx * scale), y: Math.floor(i / w) + Math.round(wb.dy * scale)});
    }
    drawStatic(grid, this.capture, new Set(moved.keys()), ctx.palette.text);
    for (const [i, pos] of moved) {
      const fg = this.capture.fg[i]!, bg = this.capture.bg[i]!;
      grid.set(i % w, Math.floor(i / w), ' ', NO_COLOR_VALUE, bg);
      grid.set(pos.x, pos.y, this.capture.glyphs[i]!, fg);
    }
    const newest = this.diagnostics.length - 1;
    this.diagnostics.forEach((d, i) => {
      const age = clamp((this.diagnostics.length - 1 - i) / 8, 0, 0.7);
      const base = d.level === 'error' ? ctx.palette.error : ctx.palette.warn;
      const colour = mixPacked(base, 0x707078, age);
      // Highlight the range: tint in color, underline-style marks always (readable without color).
      for (let x = d.x0; x <= d.x1; x += 1) {
        const index = d.row * w + x; const glyph = this.capture.glyphs[index]!;
        if (ctx.color) grid.set(x, d.row, glyph, visibleFg(this.capture.fg[index]!, NO_COLOR_VALUE, ctx.palette.text), mixPacked(0x101014, base, 0.45 - age * 0.25));
        if (d.row + 1 < this.capture.height && this.capture.glyphs[(d.row + 1) * w + x] === ' ' && d.labelRow !== d.row + 1) grid.set(x, d.row + 1, ctx.nerd ? '~' : '^', colour);
      }
      const icon = d.level === 'error' ? (ctx.nerd ? '✕' : 'x') : (ctx.nerd ? '⚠' : '!');
      if (d.labelRow !== undefined && d.labelX !== undefined) {
        const label = ` ${icon} ${d.text} `.slice(0, this.capture.width - d.labelX);
        for (let k = 0; k < label.length; k += 1) grid.set(d.labelX + k, d.labelRow, label[k]!, i === newest ? mixPacked(colour, 0xffffff, 0.35) : colour);
      } else if (d.x0 > 0) grid.set(d.x0 - 1, d.row, icon, colour);
    });
    if (this.typing) for (let k = 0; k < this.typing.text.length; k += 1) grid.set(this.typing.x + k, this.typing.row, this.typing.text[k]!, ctx.palette.warn);
    const cat = this.cat; const x = Math.round(cat.x), top = Math.round(cat.feet) - (CAT_H - 1);
    if (this.speech) { const label = this.speech.text; for (let k = 0; k < label.length; k += 1) grid.set(x + 3 + k, top - 1, label[k]!, ctx.palette.accent); }
    const facingRight = cat.dir === 1, pose = this.frame();
    if (ctx.color) for (const cell of catCells(pose, facingRight)) grid.set(x + cell.dx, top + cell.dy, cell.glyph, cell.fg, cell.bg);
    else (pose === 'blink' ? CAT_ASCII_BLINK : CAT_ASCII).forEach((line, dy) => { for (let k = 0; k < line.length; k += 1) grid.set(x + 3 + k, top + 1 + dy, line[k]!, NO_COLOR_VALUE); });
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
