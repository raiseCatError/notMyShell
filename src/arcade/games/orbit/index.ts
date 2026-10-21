import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups, Shake} from '../../effects.js';
import {isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {gradient, rgb, stars} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {BALL_R, BAR_H, BAR_SEG, COLORS, OrbitState, RING_T, type Obstacle} from './logic.js';

/**
 * Color Orbit: tap to climb through rotating rings and sliding bars, touching only the part that matches your color.
 * Four clearly different colors carry the game; each also has its own glyph without color.
 */
const SPACE = [rgb(0x060418), rgb(0x130c33), rgb(0x22154d)];
const GLYPH = ['◆', '●', '▲', '■'];
const SAFE_GLYPH = ['R', 'G', 'B', 'Y'];

function colorSet(look: ArcadeLook): Rgb[] { return [look.hue.rose, look.hue.mint, look.hue.sky, look.hue.butter]; }

class ColorOrbit implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private state: OrbitState;
  private done = false;
  private size: {columns: number; rows: number};
  private camera = 0;
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly shake = new Shake(240);
  private pixels = new PixelBuffer(0, 0);
  private dyingMs = 0;
  private readonly startBest: number;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new OrbitState(context.rng.fork('orbit'));
    this.particles = new ParticleSystem(context.rng.fork('orbit-fx'), 160, context.motion.effects);
    this.popups = new Popups(4, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.state.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.state.started ? 0 : this.context.motion.reduced ? 0 : 50; }

  private screenY(worldY: number): number { return this.size.rows * 2 - 6 - (worldY - this.camera); }

  step(dtMs: number): void {
    if (this.done) return;
    const state = this.state;
    state.step(dtMs);
    this.camera = Math.max(this.camera, state.y - (this.size.rows * 2 - 6) * 0.45);
    const colors = colorSet(arcadeLook());
    const cx = Math.floor(this.size.columns / 2);
    for (const event of state.events.splice(0)) {
      if (event.kind === 'pass' && state.score % 10 === 0) this.popups.add(`${state.score}!`, cx, Math.floor(this.screenY(state.y) / 2) - 3, rgb(0xffffff), 900);
      else if (event.kind === 'switch') this.particles.burst({x: cx, y: this.screenY(event.y), count: 12, speed: 32, life: 450, drag: 1.4, colors: [colors[event.color]!, rgb(0xffffff)]});
      else if (event.kind === 'hit') {
        this.particles.burst({x: cx, y: this.screenY(event.y), count: 24, speed: 55, life: 700, gravity: 60, drag: 0.7, colors});
        this.shake.trigger(!this.context.motion.reduced && this.context.motion.effects !== 'off');
        this.dyingMs = this.context.motion.reduced ? 300 : 800;
      }
    }
    if (!state.alive) { this.dyingMs -= dtMs; if (this.dyingMs <= 0) this.finish(); }
  }

  private finish(): void {
    this.done = true;
    const score = this.state.score;
    const saved = saveScore(this.context.record, score);
    this.result = {score, scoreText: String(score), record: score > 0 && score > this.startBest, details: [`${score} obstacle${score === 1 ? '' : 's'} passed`, `Best ${saved.best}`, `Climbs ${saved.plays}`]};
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.shake.update(dtMs);
    if (!this.state.started) this.state.step(dtMs);
  }

  key(key: Key): GameKeyResult {
    if (this.done) return 'ignored';
    if (isConfirm(key) || key.kind === 'up') { this.state.tap(); return 'handled'; }
    return 'ignored';
  }

  render(canvas: Canvas, alpha: number, palette: ArcadePalette): void {
    void alpha;
    const look = arcadeLook(palette);
    const state = this.state;
    const colors = colorSet(look);
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    if (!color) { this.drawText(canvas, look); return; }
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    gradient(buffer, SPACE, 0, buffer.height);
    stars(buffer, 31, buffer.height, rgb(0xffffff), SPACE[0]!, {density: 120, strength: 0.7, scroll: 0});
    const cx = Math.floor(canvas.width / 2);
    for (const obstacle of state.obstacles) {
      const y = this.screenY(obstacle.y);
      if (y < -30 || y > buffer.height + 30) continue;
      if (obstacle.kind === 'bar') this.drawBar(buffer, obstacle, y, cx, colors);
      else this.drawRing(buffer, obstacle, y, cx, colors);
    }
    for (const prism of state.prisms) {
      if (prism.taken) continue;
      const y = this.screenY(prism.y);
      if (y < -4 || y > buffer.height + 4) continue;
      const spin = Math.floor(state.time * 6) % COLORS;
      [[0, -2], [2, 0], [0, 2], [-2, 0]].forEach(([dx, dy], index) => buffer.rect(cx + dx! - (dx! > 0 ? 0 : dx! < 0 ? 1 : 0), Math.round(y + dy!), dx ? 1 : 2, dy ? 1 : 2, colors[(index + spin) % COLORS]!));
      buffer.set(cx, Math.round(y), rgb(0xffffff));
    }
    const by = Math.round(this.screenY(state.y));
    const ball = colors[state.color]!;
    for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d <= BALL_R + 0.4) buffer.set(cx + dx, by + dy, ball);
      else if (d <= 3.2) buffer.set(cx + dx, by + dy, mixRgb(buffer.get(cx + dx, by + dy) ?? SPACE[1]!, ball, 0.22));
    }
    this.particles.draw(buffer, SPACE[1]);
    const shake = this.shake.offset;
    canvas.blit(buffer, shake.x, shake.y);
    this.popups.draw(canvas, SPACE[1]);
    topRow(canvas, look, 'Color Orbit', `Score ${state.score}`, SPACE[0]);
    if (!state.started) canvas.center(Math.floor(canvas.height * 0.62), 'Space to rise · pass only through your own color', {fg: look.text.strong, bold: true});
  }

  private drawRing(buffer: PixelBuffer, ring: Extract<Obstacle, {kind: 'ring'}>, y: number, cx: number, colors: Rgb[]): void {
    const outer = ring.r + RING_T / 2;
    const inner = ring.r - RING_T / 2;
    for (let dy = -Math.ceil(outer); dy <= Math.ceil(outer); dy += 1) for (let dx = -Math.ceil(outer); dx <= Math.ceil(outer); dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d < inner || d > outer) continue;
      const index = OrbitState.ringColor(ring, this.state.time, Math.atan2(dy, dx));
      buffer.set(cx + dx, Math.round(y) + dy, d > outer - 0.8 ? mixRgb(colors[index]!, rgb(0xffffff), 0.25) : colors[index]!);
    }
  }

  private drawBar(buffer: PixelBuffer, bar: Extract<Obstacle, {kind: 'bar'}>, y: number, cx: number, colors: Rgb[]): void {
    const span = BAR_SEG * COLORS;
    const offset = (((bar.phase + bar.speed * this.state.time) % span) + span) % span;
    for (let x = 0; x < buffer.width; x += 1) {
      const index = Math.floor(((((offset + (x - cx)) % span) + span) % span) / BAR_SEG) % COLORS;
      for (let dy = 0; dy < BAR_H; dy += 1) buffer.set(x, Math.round(y - BAR_H / 2) + dy, dy === 0 ? mixRgb(colors[index]!, rgb(0xffffff), 0.25) : colors[index]!);
    }
  }

  /** Without color: each color is its own glyph, on the ring around the column and on the ball. */
  private drawText(canvas: Canvas, look: ArcadeLook): void {
    const state = this.state;
    const glyphs = this.context.safeGlyphs ? SAFE_GLYPH : GLYPH;
    const cx = Math.floor(canvas.width / 2);
    for (const obstacle of state.obstacles) {
      const row = Math.floor(this.screenY(obstacle.y) / 2);
      if (row < 1 || row >= canvas.height) continue;
      if (obstacle.kind === 'bar') { canvas.put(cx, row, glyphs[OrbitState.barColor(obstacle, state.time)]!, {bold: true}); continue; }
      const rows = Math.round(obstacle.r / 2);
      canvas.put(cx, row - rows, glyphs[OrbitState.ringColor(obstacle, state.time, -Math.PI / 2)]!, {bold: true});
      canvas.put(cx, row + rows, glyphs[OrbitState.ringColor(obstacle, state.time, Math.PI / 2)]!, {bold: true});
    }
    canvas.put(cx, Math.floor(this.screenY(state.y) / 2), glyphs[state.color]!, {bold: true, reverse: true});
    topRow(canvas, look, 'Color Orbit', `Score ${state.score}`);
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: 'Space', action: 'rise'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

/** The hub preview: a spinning four-color ring and a ball rising through its matching arc. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  const colors = colorSet(look);
  canvas.clear(look.surface.base);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  gradient(buffer, SPACE, 0, buffer.height);
  const cx = Math.floor(canvas.width / 2);
  const cy = Math.floor(buffer.height * 0.45);
  const r = Math.max(5, Math.min(14, Math.floor(buffer.height * 0.3)));
  const rotation = frame * 0.12;
  for (let dy = -r - 2; dy <= r + 2; dy += 1) for (let dx = -r - 2; dx <= r + 2; dx += 1) {
    const d = Math.hypot(dx, dy);
    if (d < r - 1.5 || d > r + 1.5) continue;
    buffer.set(cx + dx, cy + dy, colors[Math.floor((((Math.atan2(dy, dx) - rotation) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 2)) % 4]!);
  }
  const by = Math.round(buffer.height - 3 - ((frame * 1.6) % (buffer.height - 2)));
  buffer.rect(cx - 1, by - 1, 3, 3, colors[1]!);
  canvas.blit(buffer);
}

export const orbitGame: GameDefinition = {
  id: 'orbit', aliases: ['color-orbit', 'switch'], title: 'Color Orbit', tagline: 'Only your color is safe',
  description: 'Tap to rise through spinning rings and sliding bars. You can only pass the part that matches your color, and every prism changes it.',
  kind: 'action', category: 'reflex',
  controls: [{keys: 'Space', action: 'rise'}],
  howToPlay: [
    'Each press of Space (or Up) kicks the ball upward; gravity brings it back down. Falling off the bottom ends the climb.',
    'Rings spin and bars slide. Touch only the part in your own color; any other color ends the climb.',
    'A prism above each obstacle switches you to another color. Without color, each color is its own symbol.',
  ],
  summary: record => scoreSummary(record),
  preview,
  create: context => new ColorOrbit(context),
};
