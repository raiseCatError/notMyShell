import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups, Shake} from '../../effects.js';
import {shatter} from '../../fx/cells.js';
import {count, isSpace, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, distinctColors} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {gradient, rgb} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {BALL_R, BRICK_H, BRICK_W, BrickState, FIELD_H, FIELD_W, LAYOUTS, PADDLE_H, PADDLE_Y, type PowerKind} from './logic.js';

/**
 * Brickfall: Breakout. A wall of bricks in original layouts (one of them a cat's face), tough bricks that take two hits,
 * three power-ups, combo points for bricks broken between paddle touches, and pixel fragments from every broken brick.
 */
const NIGHT = [rgb(0x0e0a24), rgb(0x1d1540), rgb(0x2a1d52)];
const POWER_COLOR: Readonly<Record<PowerKind, Rgb>> = {wide: rgb(0x9fe0b8), multi: rgb(0xffe08a), slow: rgb(0x8fc4ff)};
const POWER_LABEL: Readonly<Record<PowerKind, string>> = {wide: 'Wide paddle', multi: 'Three balls', slow: 'Slow ball'};
const STEEL = rgb(0xc9c5dc);

interface Field { x: number; y: number; scale: number; width: number; height: number }

function fieldFor(columns: number, rows: number): Field {
  const width = columns;
  const height = Math.max(8, (rows - 1) * 2);
  const scale = Math.min(width / FIELD_W, height / FIELD_H);
  const w = Math.round(FIELD_W * scale);
  const h = Math.round(FIELD_H * scale);
  return {x: Math.floor((width - w) / 2), y: 2 + Math.floor((height - h) / 2), scale, width: w, height: h};
}

class Brickfall implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private state: BrickState;
  private started = false;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly shake = new Shake(180);
  private pixels = new PixelBuffer(0, 0);
  private banner = '';
  private bannerMs = 0;
  private readonly startBest: number;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new BrickState(context.rng.fork('bricks'));
    this.particles = new ParticleSystem(context.rng.fork('brick-fx'), 200, context.motion.effects);
    this.popups = new Popups(6, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.started ? 0 : this.context.motion.reduced ? 0 : 100; }

  step(dtMs: number): void {
    if (this.done) return;
    this.state.step(dtMs);
    const field = fieldFor(this.size.columns, this.size.rows);
    const px = (x: number) => field.x + x * field.scale;
    const py = (y: number) => field.y + y * field.scale;
    const colors = this.rowColors();
    for (const event of this.state.events.splice(0)) {
      if (event.kind === 'break') {
        const color = event.brick.tough ? STEEL : colors[event.brick.row % colors.length]!;
        shatter(this.particles, {x: px(event.brick.x), y: py(event.brick.y), width: BRICK_W * field.scale, height: BRICK_H * field.scale}, [color, mixRgb(color, rgb(0xffffff), 0.4)], {speed: 30, gravity: 80});
        if (event.combo >= 4 && event.combo % 4 === 0) this.popups.add(`×${Math.min(5, 1 + Math.floor(event.combo / 4))}`, px(event.brick.x + BRICK_W / 2), Math.floor(py(event.brick.y) / 2), rgb(0xffe08a), 800);
      } else if (event.kind === 'dent') this.shake.trigger(!this.context.motion.reduced && this.context.motion.effects !== 'off');
      else if (event.kind === 'power') this.say(POWER_LABEL[event.power]);
      else if (event.kind === 'lost') this.say(this.state.lives > 0 ? `${this.state.lives} ${this.state.lives === 1 ? 'life' : 'lives'} left · Space to launch` : 'No lives left');
      else if (event.kind === 'clear') this.say(`Level ${event.level} clear · +${500 * event.level}`);
    }
    if (this.state.over) this.finish();
  }

  private say(text: string): void { this.banner = text; this.bannerMs = 1800; }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {bestLevel: state.level, bestCombo: state.bestCombo});
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record: state.score > 0 && state.score > this.startBest,
      details: [`Reached level ${state.level}`, `Best combo ${state.bestCombo}`, `Best ${saved.best.toLocaleString('en-US')}`, `Games ${saved.plays}`],
    };
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.shake.update(dtMs);
    this.bannerMs = Math.max(0, this.bannerMs - dtMs);
  }

  key(key: Key): GameKeyResult {
    if (this.done) return 'ignored';
    const value = key.kind === 'text' ? key.value.toLowerCase() : '';
    if (isSpace(key) || key.kind === 'enter' || key.kind === 'up') {
      this.started = true;
      this.state.launch();
      return 'handled';
    }
    if (key.kind === 'left' || value === 'a' || value === 'h') { this.started = true; this.state.press(-1); return 'handled'; }
    if (key.kind === 'right' || value === 'd' || value === 'l') { this.started = true; this.state.press(1); return 'handled'; }
    return 'ignored';
  }

  /** One clearly different color per brick row. */
  private rowColors(): Rgb[] { return distinctColors(8, arcadeLook()); }

  render(canvas: Canvas, alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    const state = this.state;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const lives = color ? '♥'.repeat(Math.max(0, state.lives)) : `Lives ${state.lives}`;
    topRow(canvas, look, `Brickfall · level ${state.level}`, `${lives}  Score ${state.score.toLocaleString('en-US')}${state.combo >= 4 ? `  combo ${state.combo}` : ''}`);
    const field = fieldFor(canvas.width, canvas.height);
    if (!color) { this.drawText(canvas, field); return; }
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    const px = (x: number) => field.x + x * field.scale;
    const py = (y: number) => field.y + y * field.scale;
    const box = (x: number, y: number, w: number, h: number, fill: Rgb) => buffer.rect(Math.round(px(x)), Math.round(py(y)), Math.max(1, Math.round(w * field.scale)), Math.max(1, Math.round(h * field.scale)), fill);
    gradient(buffer, NIGHT, field.y, field.y + field.height);
    for (let x = field.x; x < field.x + field.width; x += 1) buffer.set(x, field.y, rgb(0x3d2f70));
    const colors = this.rowColors();
    for (const brick of state.bricks) {
      const base = brick.tough ? (brick.hits > 1 ? STEEL : mixRgb(STEEL, rgb(0x6c6888), 0.5)) : colors[brick.row % colors.length]!;
      box(brick.x, brick.y, BRICK_W, BRICK_H, base);
      box(brick.x, brick.y, BRICK_W, 0.6, mixRgb(base, rgb(0xffffff), 0.35));
      box(brick.x, brick.y + BRICK_H - 0.6, BRICK_W, 0.6, mixRgb(base, rgb(0x000000), 0.3));
    }
    for (const power of state.powers) box(power.x - 2, power.y - 1, 4, 2, POWER_COLOR[power.kind]);
    const paddleTone = state.wideMs > 0 ? POWER_COLOR.wide : look.accent;
    box(state.paddleX - state.paddleW / 2, PADDLE_Y, state.paddleW, PADDLE_H, paddleTone);
    box(state.paddleX - state.paddleW / 2, PADDLE_Y, state.paddleW, 0.6, mixRgb(paddleTone, rgb(0xffffff), 0.5));
    this.particles.draw(buffer, NIGHT[1]);
    for (const ball of state.balls) {
      const x = ball.px + (ball.x - ball.px) * alpha;
      const y = ball.py + (ball.y - ball.py) * alpha;
      const r = Math.max(2, Math.round(BALL_R * 2 * field.scale));
      buffer.rect(Math.round(px(x) - r / 2), Math.round(py(y) - r / 2), r, r, state.slowMs > 0 ? POWER_COLOR.slow : rgb(0xfff8ef));
    }
    const shake = this.shake.offset;
    canvas.blit(buffer, shake.x, shake.y);
    this.popups.draw(canvas, NIGHT[1]);
    const message = !this.started ? 'Space to launch  ·  ← → to move' : this.bannerMs > 0 ? this.banner : state.balls.some(ball => ball.stuck) ? 'Space to launch' : '';
    if (message) canvas.center(Math.floor((field.y + field.height) / 2) - 5, message, {fg: look.text.strong, bold: true});
  }

  /** Without color: bricks as [] pairs, the paddle as =, balls as o. */
  private drawText(canvas: Canvas, field: Field): void {
    const state = this.state;
    const cx = (x: number) => field.x + Math.floor(x * field.scale);
    const cy = (y: number) => Math.floor((field.y + y * field.scale) / 2);
    for (const brick of state.bricks) canvas.text(cx(brick.x), cy(brick.y), (brick.tough && brick.hits > 1 ? '#' : '=').repeat(Math.max(1, Math.round(BRICK_W * field.scale) - 1)), {bold: brick.tough});
    canvas.text(cx(state.paddleX - state.paddleW / 2), cy(PADDLE_Y), '='.repeat(Math.max(1, Math.round(state.paddleW * field.scale))), {bold: true});
    for (const ball of state.balls) canvas.put(cx(ball.x), cy(ball.y), 'o', {bold: true});
    for (const power of state.powers) canvas.put(cx(power.x), cy(power.y), power.kind[0]!.toUpperCase(), {bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: '← →', action: 'move'}, {keys: 'Space', action: 'launch'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

/** The hub preview: a ball bouncing under a wall of colored bricks. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const field = fieldFor(canvas.width, canvas.height + 1);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  const px = (x: number) => field.x + x * field.scale;
  const py = (y: number) => field.y - 2 + y * field.scale;
  gradient(buffer, NIGHT, field.y - 2, field.y - 2 + field.height);
  const colors = distinctColors(8, look);
  const layout = LAYOUTS[2]!;
  const left = (FIELD_W - 12 * (BRICK_W + 1) + 1) / 2;
  const gone = Math.floor(frame / 8) % 20;
  layout.forEach((line, row) => [...line].forEach((ch, column) => {
    if (ch === '.' || (row * 12 + column) % 20 < gone % 7) return;
    buffer.rect(Math.round(px(left + column * (BRICK_W + 1))), Math.round(py(8 + row * 4)), Math.max(1, Math.round(BRICK_W * field.scale)), Math.max(1, Math.round(BRICK_H * field.scale)), ch === '=' ? STEEL : colors[row % colors.length]!);
  }));
  const t = (frame % 30) / 30;
  const bx = 20 + Math.abs(((frame * 2.3) % 160) - 80);
  const by = 40 + Math.abs(t - 0.5) * 60;
  buffer.rect(Math.round(px(bx)), Math.round(py(by)), 2, 2, rgb(0xfff8ef));
  buffer.rect(Math.round(px(bx - 9)), Math.round(py(PADDLE_Y)), Math.round(18 * field.scale), 1, look.accent);
  canvas.blit(buffer);
}

export const brickfallGame: GameDefinition = {
  id: 'brickfall', aliases: ['breakout', 'bricks'], title: 'Brickfall', tagline: 'Break the wall',
  description: 'Bounce the ball into a wall of bricks: handcrafted layouts, tough bricks, wide paddles, extra balls and combos for every brick broken before the ball comes back.',
  kind: 'action', category: 'arcade',
  controls: [{keys: '← →', action: 'move'}, {keys: 'Space', action: 'launch'}],
  howToPlay: [
    'Move the paddle with the arrows (or A D, h l) and press Space to launch. Where the ball meets the paddle sets its angle.',
    'Steel bricks take two hits. Catch falling capsules: green widens the paddle, gold adds two balls, blue slows the ball.',
    'Bricks broken before the ball touches the paddle again build a combo worth up to five times the points.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · level ${count(record.bestLevel) || 1}` : 'Not played yet'; },
  preview,
  create: context => new Brickfall(context),
};
