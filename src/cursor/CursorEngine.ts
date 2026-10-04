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
/** What a particle is, so Fire, Sparks, Embers, Lightning and Railgun each keep their own look and motion. */
export type ParticleStyle = 'fire' | 'sparks' | 'embers' | 'bolt' | 'beam';
export interface Particle {x: number; y: number; vx: number; vy: number; age: number; life: number; heat: number; style: ParticleStyle;
  /** A fixed glyph (bolt segments, beam cells); the others are chosen from their energy. */
  glyph?: string}

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
/** Bolt and beam cells are placed whole when a jump starts, so they have their own cap. */
const MAX_FIXED = 110;
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
  /** Wireframe: the box around the last travelled span, held briefly after arrival. */
  private wire?: {row: number; left: number; right: number; until: number; start: number};
  /** A bolt strikes twice, a moment apart, so it flickers. */
  private restrike?: {from: CursorPoint; to: CursorPoint; at: number};

  constructor(private settings: CursorSettings, private readonly random: () => number = seededRandom(Date.now())) {}

  configure(settings: CursorSettings): void {
    this.settings = settings;
    if (settings.motion === 'off' && settings.effect === 'none') { this.particles.length = 0; this.rings = []; this.wire = undefined; this.restrike = undefined; this.tail = undefined; if (this.goal) this.head = {...this.goal}; this.phase = 'idle'; }
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
    const effect = this.settings.effect;
    if (effect === 'ripple' && !short) this.rings.push({row: point.row, column: point.column, start: now});
    if (this.rings.length > 4) this.rings.shift();
    if (!short && effect === 'lightning') { this.strike(this.from, point); this.restrike = {from: {...this.from}, to: {...point}, at: now + 70}; }
    if (!short && effect === 'railgun') this.beam(this.from, point);
    if (!short && effect === 'wireframe') this.wire = {row: point.row, left: Math.round(Math.min(this.from.column, point.column)), right: Math.round(Math.max(this.from.column, point.column)),
      start: now, until: now + this.moveDuration + 260};
  }

  /** Forget everything (passthrough began, the composer was hidden, a resize invalidated positions). */
  reset(): void {
    this.goal = undefined; this.head = undefined; this.tail = undefined; this.from = undefined;
    this.particles.length = 0; this.rings = []; this.wire = undefined; this.restrike = undefined; this.phase = 'idle'; this.lastFrame = 0;
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
    // Particles: drag, gravity by style (fire rises, sparks fall, embers drift up), a flame's sideways wobble, age.
    const gravityOf = (style: ParticleStyle) => advanced.gravity * (style === 'fire' ? -0.00003 : style === 'sparks' ? 0.00006 : style === 'embers' ? -0.00001 : 0);
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]!;
      particle.age += dt;
      if (particle.age >= particle.life) { this.particles.splice(index, 1); continue; }
      const drag = advanced.drag ** (dt / 16);
      if (particle.style === 'fire') particle.vx += Math.sin(particle.age / 70 + particle.heat * 7) * 0.0005 * (dt / 16);
      particle.vx *= drag; particle.vy = particle.vy * drag + gravityOf(particle.style) * dt;
      particle.x += particle.vx * dt; particle.y += particle.vy * dt;
    }
    if (this.restrike && now >= this.restrike.at) { this.strike(this.restrike.from, this.restrike.to); this.restrike = undefined; }
    if (this.wire && now >= this.wire.until) this.wire = undefined;
    this.rings = this.rings.filter(ring => now - ring.start < 420);
    if (this.phase === 'settling' && !this.tail && !this.particles.length && !this.rings.length && !this.wire && !this.restrike) { this.phase = 'idle'; this.restSince = now; }
    // Idle effects: a small, slow source at the resting caret, after the dwell time.
    if (this.phase === 'idle' && this.settings.idleEffect !== 'off' && now - this.restSince >= advanced.dwellMs) this.idleEmit(dt);
    return this.phase;
  }

  /**
   * Movement emission. Fire licks up from the path with a flame's wobble; Sparks are sparse bright
   * points thrown sideways that fall. Lightning, Railgun, Ripple and Wireframe are drawn as shapes
   * when the jump starts, not as shed particles.
   */
  private emit(from: {row: number; column: number}, to: {row: number; column: number}, dt: number): void {
    const effect = this.settings.effect;
    if (effect !== 'fire' && effect !== 'sparks') return;
    const advanced = this.settings.advanced;
    const travelled = Math.hypot(to.column - from.column, (to.row - from.row) * 2);
    const rate = (effect === 'sparks' ? 0.35 : 1.1) * advanced.particleDensity * AMOUNT[this.settings.particleAmount];
    let count = Math.min(effect === 'sparks' ? 3 : 6, Math.round(travelled * rate + (dt > 0 ? this.random() * 0.6 : 0)));
    const spread = advanced.spread * advanced.particleSpeed;
    while (count-- > 0 && this.particles.length < MAX_PARTICLES) {
      // Some are born where the caret is going, which is often past the end of the text, where a glyph can show.
      const t = this.random() < 0.4 ? 1 : this.random();
      const x = from.column + (to.column - from.column) * t + (t === 1 ? this.random() * 3 - 0.5 : 0);
      if (effect === 'fire') {
        // Born on the caret's row and the one above, so the flame is seen reaching up.
        const y = from.row + (to.row - from.row) * t - this.random() * 0.9;
        this.particles.push({x, y, vx: (this.random() - 0.5) * 0.004 * spread, vy: -0.0006 - this.random() * 0.0012,
          age: 0, life: advanced.particleLifetimeMs * (0.5 + this.random() * 0.5), heat: 0.7 + this.random() * 0.3, style: 'fire'});
      } else {
        const y = from.row + (to.row - from.row) * t;
        const side = this.random() < 0.5 ? -1 : 1;
        this.particles.push({x, y, vx: side * (0.012 + this.random() * 0.03) * spread, vy: -0.0012 - this.random() * 0.003,
          age: 0, life: advanced.particleLifetimeMs * (0.35 + this.random() * 0.3), heat: 0.7 + this.random() * 0.3, style: 'sparks'});
      }
    }
  }

  private pushFixed(particle: Particle): void {
    if (this.particles.length < MAX_FIXED) this.particles.push(particle);
  }

  /** Lightning: a jagged bolt of slanted segments from where the caret was to where it is, with the odd fork. */
  private strike(from: CursorPoint, to: CursorPoint): void {
    const direction = to.column >= from.column ? 1 : -1;
    const steps = Math.min(40, Math.abs(Math.round(to.column - from.column)));
    const life = this.settings.advanced.particleLifetimeMs * 0.4;
    let offset = 0;
    for (let index = 0; index <= steps; index += 1) {
      const next = this.random() < 0.5 ? (this.random() < 0.5 ? -1 : 1) : 0;
      const delta = next - offset;
      const glyph = delta === 0 ? '─' : (delta < 0) === (direction > 0) ? '╱' : '╲';
      this.pushFixed({x: from.column + direction * index, y: to.row + next, vx: 0, vy: 0, age: 0, life: life * (0.7 + this.random() * 0.5), heat: 1, style: 'bolt', glyph});
      if (this.random() < 0.12) {
        const fork = this.random() < 0.5 ? -1 : 1;
        this.pushFixed({x: from.column + direction * (index + 1), y: to.row + next + fork, vx: 0, vy: 0, age: 0, life: life * 0.6, heat: 0.8, style: 'bolt', glyph: fork < 0 ? '╱' : '╲'});
      }
      offset = next;
    }
  }

  /** Railgun: one straight heavy beam along the caret's row, with a flash where it lands. */
  private beam(from: CursorPoint, to: CursorPoint): void {
    const direction = to.column >= from.column ? 1 : -1;
    const steps = Math.min(60, Math.abs(Math.round(to.column - from.column)));
    const life = this.settings.advanced.particleLifetimeMs * 0.5;
    for (let index = 0; index <= steps; index += 1) {
      this.pushFixed({x: from.column + direction * index, y: to.row, vx: 0, vy: 0, age: 0, life, heat: 1, style: 'beam', glyph: '━'});
    }
    this.pushFixed({x: to.column, y: to.row, vx: 0, vy: 0, age: 0, life: life * 1.4, heat: 1, style: 'beam', glyph: '◉'});
  }

  private idleEmit(dt: number): void {
    const idle = this.settings.idleEffect;
    if (!this.goal || idle === 'glow') return;
    const chance = (idle === 'flame' ? 0.02 : idle === 'embers' ? 0.006 : 0.005) * dt * AMOUNT[this.settings.particleAmount];
    if (this.random() >= chance || this.particles.length >= MAX_PARTICLES / 3) return;
    const x = this.goal.column + (this.random() - 0.5) * (idle === 'embers' ? 3 : idle === 'flame' ? 2.6 : 1.6);
    if (idle === 'flame') this.particles.push({x, y: this.goal.row - 0.1, vx: (this.random() - 0.5) * 0.002, vy: -0.0008 - this.random() * 0.0012, age: 0, life: 280 + this.random() * 320, heat: 0.6 + this.random() * 0.4, style: 'fire'});
    else if (idle === 'embers') this.particles.push({x, y: this.goal.row - 0.2, vx: (this.random() - 0.5) * 0.001, vy: -0.0003 - this.random() * 0.0004, age: 0, life: 800 + this.random() * 700, heat: 0.5 + this.random() * 0.4, style: 'embers'});
    else this.particles.push({x, y: this.goal.row - 0.3, vx: (this.random() < 0.5 ? -1 : 1) * (0.008 + this.random() * 0.02), vy: -0.002 - this.random() * 0.003, age: 0, life: 220 + this.random() * 220, heat: 0.7 + this.random() * 0.3, style: 'sparks'});
  }

  /** Frames per second needed now: 0 when nothing animates (no scheduler at all). */
  cadence(now: number): number {
    if (this.phase === 'movement' || this.phase === 'settling') return Math.min(this.settings.advanced.fps, 60);
    if (this.settings.idleEffect !== 'off' && this.goal) return now - this.restSince >= this.settings.advanced.dwellMs ? Math.min(IDLE_FPS, this.settings.advanced.fps) : 4;
    return 0;
  }

  /** Where the logical caret is (undefined before the first target). */
  get caretCell(): CursorPoint | undefined { return this.goal ? {...this.goal} : undefined; }

  /** True while the visual caret is away from the logical one (the host caret is hidden and drawn by NMSh instead). */
  get drawsCaret(): boolean {
    return this.settings.motion !== 'off' && this.phase === 'movement';
  }

  /**
   * The overlay for this frame: foreground tints over text cells and shading
   * glyphs on blank cells (trail, ripple, particles, caret tip). It never
   * fills a background behind text, so a transparent terminal stays
   * transparent; only the travelling caret and the resting caret's glow fill
   * the single caret cell. Never outside `bounds`; text glyphs never change.
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
        const amount = Math.max(0.08, strength * intensity);
        // Smear is a solid band of shading; Tail is a comet: dots that shrink away from the head.
        put(row, column, {tint: {color, amount}, glyph: motion === 'tail' ? taper(t) : shade(amount), foreground: color});
      }
    }
    // Ripple: a wave that opens outward from the destination, ( ) at its crest and dots on the rows around it.
    for (const ring of this.rings) {
      const progress = (now - ring.start) / 420;
      const radius = Math.max(1, Math.round(progress * 5));
      const fade = 1 - progress;
      const crest = fade > 0.5 ? ['(', ')'] : fade > 0.2 ? ['‹', '›'] : ['·', '·'];
      const amount = 0.7 * fade * intensity;
      put(ring.row, ring.column - radius, {tint: {color: palette.caret, amount}, glyph: crest[0]!, foreground: palette.caret});
      put(ring.row, ring.column + radius, {tint: {color: palette.caret, amount}, glyph: crest[1]!, foreground: palette.caret});
      const lean = Math.round(radius * 0.6);
      for (const row of [ring.row - 1, ring.row + 1]) {
        put(row, ring.column - lean, {tint: {color: palette.caret, amount: amount * 0.7}, glyph: '·', foreground: palette.caret});
        put(row, ring.column + lean, {tint: {color: palette.caret, amount: amount * 0.7}, glyph: '·', foreground: palette.caret});
      }
    }
    // Wireframe: a bracket around the travelled span (corners above, posts on the caret row), fading after arrival.
    if (this.wire && now < this.wire.until) {
      const { row, left, right } = this.wire;
      const fade = Math.min(1, (this.wire.until - now) / 260);
      const style = {foreground: palette.caret, tint: {color: palette.caret, amount: 0.6 * fade}, ...(fade < 0.4 ? {dim: true} : {})};
      for (let column = left; column <= right; column += 1) put(row - 1, column, {...style, glyph: column === left ? '┌' : column === right ? '┐' : '─'});
      put(row, left, {...style, glyph: '│'});
      if (right !== left) put(row, right, {...style, glyph: '│'});
    }
    // Particles: energy → glyph for the style, age → gradient position. Bolt and beam cells keep their own glyph and flicker out.
    for (const particle of this.particles) {
      const life = 1 - particle.age / particle.life;
      const glyph = particle.glyph ? (life < 0.25 ? (particle.style === 'beam' ? '·' : particle.glyph) : particle.style === 'beam' && life < 0.55 && particle.glyph === '━' ? '─' : particle.glyph) : particleGlyph(particle.style, life * particle.heat);
      const color = gradientAt(palette.particles, 1 - life);
      // A glyph where the cell is blank; over text, the text itself takes the particle's color.
      put(Math.round(particle.y), Math.round(particle.x), {glyph, foreground: color, tint: {color, amount: Math.max(0.3, life * intensity)}, ...(intensity < 0.7 || life < 0.3 ? {dim: true} : {})});
    }
    // Idle glow: the cell beside the resting caret breathes slowly (bounded, 15 fps). Glyph and foreground only: the caret's own cell stays the host's.
    if (this.phase === 'idle' && this.settings.idleEffect !== 'off') {
      const pulse = 0.35 + 0.25 * Math.sin(now / 520);
      if (this.settings.idleEffect === 'glow' || this.settings.idleEffect === 'flame') {
        const level = Math.max(0.15, Math.min(1, pulse * intensity));
        put(this.goal.row, this.goal.column, {tint: {color: palette.caret, amount: level}});
        put(this.goal.row, this.goal.column + 1, {glyph: shade(level), foreground: palette.caret, tint: {color: palette.caret, amount: level}, ...(level < 0.4 ? {dim: true} : {})});
      }
    }
    // The visual caret while travelling: a block at the rounded head with a partial block for the fractional column.
    if (this.drawsCaret) {
      const row = Math.round(this.head.row);
      const column = Math.floor(this.head.column);
      const fraction = this.head.column - column;
      // Drawn in the chosen shape (Host default has none of its own: a block), so the travelling caret matches the one that settles.
      put(row, column, {caret: true, caretShape: this.settings.shape === 'host' ? 'block' : this.settings.shape, color: palette.caret});
      if (fraction > 0.15 && motion !== 'smooth' && (this.settings.shape === 'block' || this.settings.shape === 'host')) put(row, column + 1, {glyph: PARTIAL[Math.min(7, Math.floor(fraction * 8))], foreground: palette.caret});
    }
    return paints;
  }
}

/** Trail shading for a blank cell: light texture, never a solid block, so the host background stays visible. */
const shade = (amount: number) => amount > 0.6 ? '▒' : amount > 0.3 ? '░' : '·';
const PARTIAL = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

/** Energy (0 spent … 1 fresh) → glyph, per style: flames climb ▲ ^ ˄, sparks twinkle ✦ * ·, embers glow • · ˙. */
function particleGlyph(style: ParticleStyle, energy: number): string {
  if (style === 'sparks') return energy > 0.6 ? '✦' : energy > 0.3 ? '*' : '·';
  if (style === 'embers') return energy > 0.55 ? '•' : energy > 0.25 ? '·' : '˙';
  if (style === 'fire') return energy > 0.75 ? '▲' : energy > 0.55 ? '▴' : energy > 0.35 ? '^' : energy > 0.18 ? '˄' : '·';
  return '·';
}

/** A comet's tail: dots that shrink away from the head (t = 1 at the head). */
const taper = (t: number) => t > 0.7 ? '•' : t > 0.35 ? '·' : '˙';

export function gradientAt(colors: readonly RgbColor[], t: number): RgbColor {
  if (colors.length <= 1) return colors[0] ?? {red: 255, green: 255, blue: 255};
  const x = Math.min(1, Math.max(0, t)) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(x));
  return mixRgb(colors[index]!, colors[index + 1]!, x - index);
}
