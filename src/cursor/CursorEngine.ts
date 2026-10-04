import type {CursorSettings} from '../prompt/configuration.js';
import type {RgbColor} from '../ui/palette.js';
import {mixRgb} from '../chroma/chroma.js';
import type {CellPaint} from '../presentation/cellOverlay.js';

/**
 * The portable cursor-effects engine: terminal cells only (ANSI color,
 * partial blocks, small glyphs), no GPU, no framebuffer. It never moves the
 * logical caret: `target()` records where the caret IS; the visual caret and
 * its trail/particles catch up over a few frames. Input never waits for it.
 *
 * Phases are deterministic:
 *   MOVEMENT  the visual caret is travelling to the target
 *   SETTLING  it arrived; the trail collapses and particles expire
 *   IDLE      nothing moves; an opt-in idle effect may run at a low cadence
 * A new target during MOVEMENT retargets from the current visual position;
 * movements are never queued.
 */
export type CursorPhase = 'idle' | 'movement' | 'settling';

export interface CursorPoint {row: number; column: number}
export interface Particle {x: number; y: number; vx: number; vy: number; age: number; life: number; heat: number}

/** Why the caret moved: adjacent typing barely animates; jumps travel the full distance. */
export type MoveCause = 'typing' | 'jump';

export interface EffectPalette {
  caret: RgbColor;
  trail: RgbColor[];
  particles: RgbColor[];
}

/** Where the engine may draw (the input rows), so effects never paint over the transcript or other chrome. */
export interface DrawBounds {top: number; bottom: number; columns: number}

const SPEED = {low: 1.45, medium: 1, high: 0.65} as const;
const INTENSITY = {low: 0.55, medium: 0.8, high: 1} as const;
const TRAIL = {low: 0.5, medium: 1, high: 1.6} as const;
const AMOUNT = {low: 0.45, medium: 1, high: 1.9} as const;
export const MAX_PARTICLES = 48;
/** Idle effects never need more than this (frames per second). */
export const IDLE_FPS = 15;

const easeOut = (t: number, easing: CursorSettings['advanced']['easing']) => {
  const x = Math.min(1, Math.max(0, t));
  if (easing === 'linear') return x;
  if (easing === 'out-expo') return x === 1 ? 1 : 1 - 2 ** (-10 * x);
  if (easing === 'spring') return 1 - Math.cos(x * Math.PI * 2.2) * Math.exp(-6 * x);
  return 1 - (1 - x) ** 3;
};

/** A seeded generator (mulberry32), so tests replay exactly; production seeds from time. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CursorEngine {
  phase: CursorPhase = 'idle';
  /** The logical caret (always exact). */
  private goal?: CursorPoint;
  /** The visual head, in fractional cells. */
  private head?: {row: number; column: number};
  /** The trailing end of a smear/tail, lagging the head. */
  private tail?: {row: number; column: number};
  private from?: {row: number; column: number};
  private moveStart = 0;
  private moveDuration = 0;
  private lastFrame = 0;
  private restSince = 0;
  readonly particles: Particle[] = [];
  /** Ripple rings (center + start), bounded. */
  private rings: Array<{row: number; column: number; start: number}> = [];

  constructor(private settings: CursorSettings, private readonly random: () => number = seededRandom(Date.now())) {}

  configure(settings: CursorSettings): void {
    this.settings = settings;
    if (settings.motion === 'off' && settings.effect === 'none') { this.particles.length = 0; this.rings = []; this.tail = undefined; if (this.goal) this.head = {...this.goal}; this.phase = 'idle'; }
  }

  /** Effects that need frames at all (Off + None + no idle effect schedules nothing). */
  get enabled(): boolean { return this.settings.motion !== 'off' || this.settings.effect !== 'none' || this.settings.idleEffect !== 'off'; }

  /** The logical caret moved (or was first placed). Never delays anything; retargets from the current visual state. */
  target(point: CursorPoint, now: number, cause: MoveCause = 'jump'): void {
    if (this.goal && this.goal.row === point.row && this.goal.column === point.column) return;
    const first = !this.goal || !this.head;
    this.goal = {...point};
    if (first || !this.enabled) { this.head = {...point}; this.tail = undefined; this.restSince = now; this.phase = 'idle'; return; }
    const distance = Math.hypot(point.column - this.head!.column, (point.row - this.head!.row) * 2);
    const advanced = this.settings.advanced;
    const short = cause === 'typing' && distance <= advanced.moveThreshold + 0.01;
    this.from = {...this.head!};
    this.tail ??= {...this.head!};
    this.moveStart = now;
    this.moveDuration = (short ? advanced.shortMoveMs : advanced.longMoveMs) * SPEED[this.settings.speed];
    this.phase = 'movement';
    this.lastFrame ||= now;
    if (this.settings.effect === 'ripple' && !short) this.rings.push({row: point.row, column: point.column, start: now});
    if (this.rings.length > 4) this.rings.shift();
  }

  /** Forget everything (passthrough began, the composer was hidden, a resize invalidated positions). */
  reset(): void {
    this.goal = undefined; this.head = undefined; this.tail = undefined; this.from = undefined;
    this.particles.length = 0; this.rings = []; this.phase = 'idle'; this.lastFrame = 0;
  }

  /** Advance to `now`. Returns the phase after the step. */
  step(now: number): CursorPhase {
    if (!this.goal || !this.head) return this.phase;
    const dt = Math.min(100, Math.max(0, now - (this.lastFrame || now)));
    this.lastFrame = now;
    const advanced = this.settings.advanced;
    if (this.phase === 'movement') {
      const t = this.moveDuration <= 0 ? 1 : (now - this.moveStart) / this.moveDuration;
      const k = easeOut(t, advanced.easing);
      const previous = {...this.head};
      this.head = {row: this.from!.row + (this.goal.row - this.from!.row) * k, column: this.from!.column + (this.goal.column - this.from!.column) * k};
      this.emit(previous, this.head, dt);
      if (t >= 1) { this.head = {...this.goal}; this.phase = 'settling'; }
    }
    // The tail chases the head (stiffness per 16 ms), so the smear stretches while moving and collapses after.
    if (this.tail) {
      const follow = 1 - (1 - advanced.tailStiffness) ** (dt / 16);
      this.tail = {row: this.tail.row + (this.head.row - this.tail.row) * follow, column: this.tail.column + (this.head.column - this.tail.column) * follow};
      if (Math.hypot(this.tail.column - this.head.column, this.tail.row - this.head.row) < 0.2) this.tail = undefined;
    }
    // Particles: drag, gravity (fire rises: negative rows), age.
    const gravity = advanced.gravity * (this.settings.effect === 'fire' ? -0.004 : this.settings.effect === 'sparks' ? 0.003 : 0);
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]!;
      particle.age += dt;
      if (particle.age >= particle.life) { this.particles.splice(index, 1); continue; }
      const drag = advanced.drag ** (dt / 16);
      particle.vx *= drag; particle.vy = particle.vy * drag + gravity * dt;
      particle.x += particle.vx * dt; particle.y += particle.vy * dt;
    }
    this.rings = this.rings.filter(ring => now - ring.start < 420);
    if (this.phase === 'settling' && !this.tail && !this.particles.length && !this.rings.length) { this.phase = 'idle'; this.restSince = now; }
    // Idle effects: a small, slow source at the resting caret, after the dwell time.
    if (this.phase === 'idle' && this.settings.idleEffect !== 'off' && now - this.restSince >= advanced.dwellMs) this.idleEmit(dt);
    return this.phase;
  }

  /** Movement emission: particles shed along the path travelled this frame. */
  private emit(from: {row: number; column: number}, to: {row: number; column: number}, dt: number): void {
    const effect = this.settings.effect;
    if (effect === 'none' || effect === 'ripple' || effect === 'wireframe') return;
    const advanced = this.settings.advanced;
    const travelled = Math.hypot(to.column - from.column, (to.row - from.row) * 2);
    const rate = (effect === 'lightning' || effect === 'railgun' ? 0.6 : 1.1) * advanced.particleDensity * AMOUNT[this.settings.particleAmount];
    let count = Math.min(6, Math.round(travelled * rate + (dt > 0 ? this.random() * 0.6 : 0)));
    while (count-- > 0 && this.particles.length < MAX_PARTICLES) {
      const t = this.random();
      const x = from.column + (to.column - from.column) * t;
      const y = from.row + (to.row - from.row) * t;
      const spread = advanced.spread * advanced.particleSpeed;
      const vx = (this.random() - 0.5) * 0.02 * spread - (to.column - from.column) * 0.0015;
      const vy = (this.random() - 0.5) * 0.012 * spread + (effect === 'fire' ? -0.006 : 0);
      this.particles.push({x, y, vx, vy, age: 0, life: advanced.particleLifetimeMs * (0.55 + this.random() * 0.6) * (effect === 'railgun' ? 0.6 : 1), heat: 0.7 + this.random() * 0.3});
    }
  }

  private idleEmit(dt: number): void {
    const idle = this.settings.idleEffect;
    if (!this.goal || idle === 'glow') return;
    const chance = (idle === 'flame' ? 0.012 : idle === 'embers' ? 0.004 : 0.006) * dt * AMOUNT[this.settings.particleAmount];
    if (this.random() >= chance || this.particles.length >= MAX_PARTICLES / 3) return;
    this.particles.push({x: this.goal.column + (this.random() - 0.5) * 0.8, y: this.goal.row - 0.2, vx: (this.random() - 0.5) * 0.002,
      vy: idle === 'sparks' ? (this.random() - 0.7) * 0.01 : -0.0025 - this.random() * 0.002, age: 0, life: 380 + this.random() * 420, heat: 0.5 + this.random() * 0.4});
  }

  /** Frames per second needed now: 0 when nothing animates (no scheduler at all). */
  cadence(now: number): number {
    if (this.phase === 'movement' || this.phase === 'settling') return Math.min(this.settings.advanced.fps, 60);
    if (this.settings.idleEffect !== 'off' && this.goal) return now - this.restSince >= this.settings.advanced.dwellMs ? Math.min(IDLE_FPS, this.settings.advanced.fps) : 4;
    return 0;
  }

  /** True while the visual caret is away from the logical one (the host caret is hidden and drawn by NMSh instead). */
  get drawsCaret(): boolean {
    return this.settings.motion !== 'off' && this.phase === 'movement';
  }

  /**
   * The overlay for this frame: background tints over text cells (trail,
   * glow) and glyphs on blank cells (particles, caret tip). Never outside
   * `bounds`; text glyphs and their foregrounds are never changed.
   */
  paints(palette: EffectPalette, bounds: DrawBounds, now: number): Map<number, Map<number, CellPaint>> {
    const paints = new Map<number, Map<number, CellPaint>>();
    if (!this.goal || !this.head) return paints;
    const put = (row: number, column: number, paint: CellPaint) => {
      if (row < bounds.top || row > bounds.bottom || column < 0 || column >= bounds.columns) return;
      const line = paints.get(row) ?? new Map<number, CellPaint>();
      const existing = line.get(column);
      line.set(column, {...existing, ...paint});
      paints.set(row, line);
    };
    const intensity = INTENSITY[this.settings.intensity];
    const motion = this.settings.motion;
    const base = palette.trail[0] ?? palette.caret;
    // Trail: Smear stretches a uniform band; Tail tapers (exponent) toward the end.
    if (this.tail && (motion === 'smear' || motion === 'tail')) {
      const dx = this.head.column - this.tail.column;
      const dy = this.head.row - this.tail.row;
      const length = Math.min(this.settings.advanced.maxTrail * TRAIL[this.settings.trailLength], Math.ceil(Math.hypot(dx, dy * 2)) + 1);
      for (let index = 0; index <= length; index += 1) {
        const t = length ? index / length : 0;
        const column = Math.round(this.tail.column + dx * t);
        const row = Math.round(this.tail.row + dy * t);
        const strength = motion === 'tail' ? t ** this.settings.advanced.trailExponent : 0.55 + 0.45 * t;
        const color = gradientAt(palette.trail.length ? palette.trail : [base], 1 - t);
        put(row, column, {background: mixRgb(DARK, color, Math.max(0.08, strength * intensity))});
      }
    }
    // Ripple rings around a jump destination.
    for (const ring of this.rings) {
      const radius = ((now - ring.start) / 420) * 4;
      const fade = 1 - (now - ring.start) / 420;
      for (let column = Math.floor(ring.column - radius - 1); column <= Math.ceil(ring.column + radius + 1); column += 1) {
        const distance = Math.abs(column - ring.column);
        if (Math.abs(distance - radius) < 0.6) put(ring.row, column, {background: mixRgb(DARK, palette.caret, 0.5 * fade * intensity)});
      }
    }
    // Wireframe: an outline of the travelled box while moving.
    if (this.settings.effect === 'wireframe' && this.phase === 'movement' && this.from) {
      const left = Math.round(Math.min(this.from.column, this.head.column));
      const right = Math.round(Math.max(this.from.column, this.head.column));
      for (let column = left; column <= right; column += 1) put(Math.round(this.head.row), column, {glyph: column === left || column === right ? '┆' : '┄', foreground: palette.caret});
    }
    // Particles: brightness → glyph, age → gradient position.
    for (const particle of this.particles) {
      const life = 1 - particle.age / particle.life;
      const glyph = particleGlyph(this.settings.effect === 'none' ? (this.settings.idleEffect === 'sparks' ? 'sparks' : 'fire') : this.settings.effect, life * particle.heat);
      const color = gradientAt(palette.particles, 1 - life);
      put(Math.round(particle.y), Math.round(particle.x), {glyph, foreground: mixRgb(DARK, color, Math.max(0.25, life * intensity))});
    }
    // Idle glow: the resting caret cell's background breathes slowly (bounded, 15 fps).
    if (this.phase === 'idle' && this.settings.idleEffect !== 'off') {
      const pulse = 0.18 + 0.12 * Math.sin(now / 520);
      if (this.settings.idleEffect === 'glow' || this.settings.idleEffect === 'flame') put(this.goal.row, this.goal.column, {background: mixRgb(DARK, palette.caret, pulse * intensity)});
    }
    // The visual caret while travelling: a block at the rounded head with a partial block for the fractional column.
    if (this.drawsCaret) {
      const row = Math.round(this.head.row);
      const column = Math.floor(this.head.column);
      const fraction = this.head.column - column;
      put(row, column, {background: palette.caret, caret: true});
      if (fraction > 0.15 && motion !== 'smooth') put(row, column + 1, {glyph: PARTIAL[Math.min(7, Math.floor(fraction * 8))], foreground: palette.caret});
    }
    return paints;
  }
}

const DARK: RgbColor = {red: 16, green: 16, blue: 20};
const PARTIAL = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

function particleGlyph(effect: string, energy: number): string {
  if (effect === 'lightning') return energy > 0.6 ? '╱' : energy > 0.3 ? '╲' : '·';
  if (effect === 'railgun') return energy > 0.5 ? '━' : '─';
  if (effect === 'sparks') return energy > 0.65 ? '✦' : energy > 0.35 ? '*' : '·';
  return energy > 0.7 ? '▴' : energy > 0.45 ? '*' : energy > 0.2 ? '·' : '˙';
}

export function gradientAt(colors: readonly RgbColor[], t: number): RgbColor {
  if (colors.length <= 1) return colors[0] ?? {red: 255, green: 255, blue: 255};
  const x = Math.min(1, Math.max(0, t)) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(x));
  return mixRgb(colors[index]!, colors[index + 1]!, x - index);
}
