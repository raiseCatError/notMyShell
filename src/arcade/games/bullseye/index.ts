import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups, Shake} from '../../effects.js';
import {count, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {gradient, rgb} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {BullseyeState, FLIGHT_MS, isBoss, stageDarts} from './logic.js';

/**
 * Vespyr Bullseye: throw darts from below into a spinning target without touching a dart already in it. The target's
 * spin speeds up, reverses and pauses; a boss target every fifth stage brings more darts in its rim.
 */
const WOOD = rgb(0xd9a36a);
const WOOD_DARK = rgb(0xa8723f);
const CREAM = rgb(0xf7e3c4);
const BULL = rgb(0xff8fb3);
const STEEL = rgb(0x8d88b8);
const STEEL_DARK = rgb(0x5d5888);
const SHAFT = rgb(0xf7efdc);
const FISH = rgb(0xffb48a);
const BACK = [rgb(0x140e2e), rgb(0x261a4f), rgb(0x3a2a6a)];

interface Geometry { cx: number; cy: number; r: number; length: number; throwY: number }

function geometryFor(columns: number, rows: number): Geometry {
  const width = columns;
  const height = rows * 2;
  const r = Math.max(5, Math.min(Math.floor(width * 0.22), Math.floor((height - 4) * 0.24)));
  const length = Math.max(5, Math.round(r * 0.55));
  const cy = 2 + Math.round(height * 0.08) + r + length;
  return {cx: Math.floor(width / 2), cy, r, length, throwY: Math.min(height - 3, cy + r + Math.round(height * 0.32))};
}

class Bullseye implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private state: BullseyeState;
  private started = false;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly shake = new Shake(220);
  private pixels = new PixelBuffer(0, 0);
  private dyingMs = 0;
  private hitMs = 0;
  private readonly startBest: number;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new BullseyeState(context.rng.fork('bullseye'));
    this.particles = new ParticleSystem(context.rng.fork('bullseye-fx'), 180, context.motion.effects);
    this.popups = new Popups(4, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.started ? 0 : this.context.motion.reduced ? 0 : 60; }

  step(dtMs: number): void {
    if (this.done) return;
    const state = this.state;
    state.step(dtMs);
    const geo = geometryFor(this.size.columns, this.size.rows);
    const rim = (angle: number, extra = 0) => ({x: geo.cx + Math.cos(angle + state.rotation) * (geo.r + extra), y: geo.cy + Math.sin(angle + state.rotation) * (geo.r + extra)});
    for (const event of state.events.splice(0)) {
      if (event.kind === 'stick') {
        const at = rim(event.angle);
        this.particles.burst({x: at.x, y: at.y, count: 5, speed: 24, angle: Math.PI / 2, spread: 1, life: 380, gravity: 70, drag: 1, colors: [isBoss(state.stage) ? STEEL : WOOD, CREAM]});
        this.hitMs = 90;
      } else if (event.kind === 'fish') {
        const at = rim(event.angle, 2);
        this.particles.burst({x: at.x, y: at.y, count: 10, speed: 30, life: 500, drag: 1.2, colors: [FISH, rgb(0xffe08a)]});
        this.popups.add('+5', at.x, Math.floor(at.y / 2), FISH);
      } else if (event.kind === 'glance') {
        this.particles.burst({x: geo.cx, y: geo.cy + geo.r, count: 14, speed: 50, angle: Math.PI / 2, spread: 1.2, life: 600, gravity: 120, drag: 0.6, colors: [SHAFT, rgb(0xffe08a), rgb(0xff8f6e)]});
        this.shake.trigger(!this.context.motion.reduced && this.context.motion.effects !== 'off');
        this.dyingMs = this.context.motion.reduced ? 300 : 900;
      } else {
        // The target bursts apart, and the next stage arrives.
        const colors = isBoss(event.stage) ? [STEEL, STEEL_DARK, CREAM] : [WOOD, WOOD_DARK, CREAM, BULL];
        for (let ring = 0; ring < 3; ring += 1) this.particles.burst({x: geo.cx, y: geo.cy, count: 16, speed: 30 + ring * 18, spread: Math.PI, life: 700, gravity: 60, drag: 0.5, colors});
        this.popups.add(isBoss(event.stage) ? 'Boss cleared' : `Stage ${event.stage} clear`, geo.cx, Math.floor(geo.cy / 2) - 1, rgb(0xffe08a), 1000);
      }
    }
    if (!state.alive) { this.dyingMs -= dtMs; if (this.dyingMs <= 0) this.finish(); }
  }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {bestStage: state.stage});
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record: state.score > 0 && state.score > this.startBest,
      details: [`Reached stage ${state.stage}`, `Darts thrown ${state.thrown}`, `Best ${saved.best}`, `Games ${saved.plays}`],
    };
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.shake.update(dtMs);
    this.hitMs = Math.max(0, this.hitMs - dtMs);
  }

  key(key: Key): GameKeyResult {
    if (this.done) return 'ignored';
    if (isConfirm(key) || key.kind === 'up') {
      if (!this.started) this.started = true;
      this.state.throw();
      return 'handled';
    }
    return 'ignored';
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const state = this.state;
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const geo = geometryFor(canvas.width, canvas.height);
    if (!color) {
      this.drawText(canvas, geo);
      topRow(canvas, look, `Vespyr Bullseye · stage ${state.stage}`, `Darts ${state.left}  Score ${state.score}`);
      return;
    }
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    gradient(buffer, BACK, 0, buffer.height);
    const boss = isBoss(state.stage);
    const showTarget = state.clearMs <= 0 || state.clearMs > 900;
    // A soft halo, then the disc: rings and grain lines that turn with it.
    if (showTarget) {
      for (let y = -geo.r - 3; y <= geo.r + 3; y += 1) for (let x = -geo.r - 3; x <= geo.r + 3; x += 1) {
        const d = Math.hypot(x, y);
        if (d > geo.r + 3) continue;
        const px = geo.cx + x, py = geo.cy + y;
        if (d > geo.r) { buffer.set(px, py, mixRgb(buffer.get(px, py) ?? BACK[1]!, boss ? STEEL : WOOD, 0.15)); continue; }
        const angle = Math.atan2(y, x) - state.rotation;
        let tone = boss ? STEEL : WOOD;
        if (d < geo.r * 0.3) tone = boss ? rgb(0xff6f9a) : BULL;
        else if (d < geo.r * 0.62 && d > geo.r * 0.48) tone = boss ? STEEL_DARK : CREAM;
        const grain = ((angle % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3);
        if (d > geo.r * 0.35 && grain < 0.07) tone = mixRgb(tone, boss ? STEEL_DARK : WOOD_DARK, 0.7);
        if (d > geo.r - 1) tone = mixRgb(tone, rgb(0x000000), 0.25);
        if (this.hitMs > 0) tone = mixRgb(tone, rgb(0xffffff), 0.15);
        buffer.set(px, py, tone);
      }
      if (boss) for (let k = 0; k < 8; k += 1) {
        const a = state.rotation + (k * Math.PI) / 4;
        buffer.set(Math.round(geo.cx + Math.cos(a) * geo.r * 0.82), Math.round(geo.cy + Math.sin(a) * geo.r * 0.82), CREAM);
      }
      for (const fish of state.fish) {
        if (fish.taken) continue;
        const a = fish.angle + state.rotation;
        const x = Math.round(geo.cx + Math.cos(a) * (geo.r + 2));
        const y = Math.round(geo.cy + Math.sin(a) * (geo.r + 2));
        buffer.rect(x - 1, y - 1, 3, 2, FISH);
        buffer.set(x + 2, y - 1, mixRgb(FISH, rgb(0x000000), 0.3));
      }
      for (const dart of state.darts) this.dart(buffer, geo.cx + Math.cos(dart + state.rotation) * (geo.r - 1), geo.cy + Math.sin(dart + state.rotation) * (geo.r - 1), dart + state.rotation, geo.length, look.accent);
    }
    // The dart in hand, or in flight toward the bottom of the rim.
    if (state.alive && state.left + (state.flying >= 0 ? 1 : 0) > 0 && state.clearMs <= 0) {
      const t = state.flying >= 0 ? 1 - state.flying / FLIGHT_MS : 0;
      const tip = geo.throwY - geo.length + t * (geo.cy + geo.r - (geo.throwY - geo.length));
      this.dart(buffer, geo.cx, tip, Math.PI / 2, geo.length, look.accent);
    }
    // Darts still to throw this stage.
    for (let index = 0; index < state.left - (state.flying >= 0 ? 0 : 1); index += 1) buffer.rect(3, buffer.height - 4 - index * 3, 1, 2, SHAFT);
    this.particles.draw(buffer, BACK[1]);
    const shake = this.shake.offset;
    canvas.blit(buffer, shake.x, shake.y);
    this.popups.draw(canvas, BACK[1]);
    topRow(canvas, look, `Vespyr Bullseye · ${boss ? `boss ${state.stage}` : `stage ${state.stage}`}`, `Darts ${state.left}/${stageDarts(state.stage)}  Score ${state.score}`, BACK[0]);
    if (!this.started) canvas.center(Math.floor(geo.throwY / 2) - geo.length, 'Space to throw · miss the darts already in the target', {fg: look.text.strong, bold: true});
  }

  /** A dart whose tip is at (x, y) pointing along `angle` into the target: a cream shaft and lavender fletching. */
  private dart(buffer: PixelBuffer, x: number, y: number, angle: number, length: number, fletch: Rgb): void {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    for (let step = 0; step <= length; step += 1) {
      const px = x + dx * step, py = y + dy * step;
      buffer.set(px, py, step >= length - 2 ? fletch : SHAFT);
      if (step >= length - 2) { buffer.set(px - dy, py + dx, mixRgb(fletch, rgb(0xffffff), 0.3)); buffer.set(px + dy, py - dx, mixRgb(fletch, rgb(0xffffff), 0.3)); }
    }
  }

  /** Without color: the target as a ring of characters, darts as their position on it. */
  private drawText(canvas: Canvas, geo: Geometry): void {
    const state = this.state;
    const cy = Math.floor(geo.cy / 2);
    const rows = Math.max(2, Math.floor(geo.r / 2));
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      canvas.put(geo.cx + Math.round(Math.cos(a) * geo.r), cy + Math.round(Math.sin(a) * rows), 'o');
    }
    for (const dart of state.darts) {
      const a = dart + state.rotation;
      canvas.put(geo.cx + Math.round(Math.cos(a) * (geo.r + 2)), cy + Math.round(Math.sin(a) * (rows + 1)), '|', {bold: true});
    }
    canvas.put(geo.cx, Math.floor(geo.throwY / 2), '^', {bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: 'Space', action: 'throw'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

/** The hub preview: a spinning target collecting darts, one at a time. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  gradient(buffer, BACK, 0, buffer.height);
  const r = Math.max(4, Math.min(Math.floor(canvas.width * 0.16), Math.floor(canvas.height * 0.55)));
  const cx = Math.floor(canvas.width / 2), cy = Math.floor(canvas.height);
  const rotation = frame * 0.22;
  for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) {
    const d = Math.hypot(x, y);
    if (d > r) continue;
    const grain = (((Math.atan2(y, x) - rotation) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3);
    buffer.set(cx + x, cy + y, d < r * 0.3 ? BULL : d < r * 0.62 && d > r * 0.48 ? CREAM : grain < 0.08 && d > r * 0.35 ? WOOD_DARK : WOOD);
  }
  const stuck = Math.floor(frame / 9) % 6;
  for (let index = 0; index < stuck; index += 1) {
    const a = rotation + index * 1.1;
    for (let step = 0; step < Math.max(3, Math.round(r * 0.5)); step += 1) buffer.set(cx + Math.cos(a) * (r - 1 + step), cy + Math.sin(a) * (r - 1 + step), step > r * 0.35 ? look.accent : SHAFT);
  }
  canvas.blit(buffer);
}

export const bullseyeGame: GameDefinition = {
  id: 'bullseye', aliases: ['vespyr-bullseye', 'darts'], title: 'Vespyr Bullseye', tagline: 'Darts into a spinning target',
  description: 'Throw darts from below into a turning target. Each one sticks in the rim and turns with it, and a throw that touches one already there glances off.',
  kind: 'action', category: 'reflex',
  controls: [{keys: 'Space', action: 'throw'}],
  howToPlay: [
    'Press Space (or Enter, or Up) to throw. The dart flies straight up and sticks into the bottom of the target.',
    'The target speeds up, slows down and reverses. A dart that lands too close to another glances off and ends the run.',
    'Throw every dart of a stage to clear it. Hit a fish on the rim for five points; every fifth stage is a steel boss.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · stage ${count(record.bestStage) || 1}` : 'Not played yet'; },
  preview,
  create: context => new Bullseye(context),
};
