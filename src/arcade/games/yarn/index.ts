import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups, Shake} from '../../effects.js';
import {confetti} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, distinctColors} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {gradient, rgb} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {JAR_H, JAR_W, LINE_Y, RADII, SPAWN_Y, TIERS, YarnState} from './logic.js';

/**
 * Yarn Drop: Suika-style. Aim a ball of yarn and drop it into the jar; two equal balls that touch fuse into the next
 * size. Size is the main cue (each tier is bigger), every tier also has its own digit, texture and text-mode glyph, so
 * color never carries meaning alone.
 */
const NIGHT = [rgb(0x0e0a24), rgb(0x1d1540)];
const GLYPHS = ['.', ':', '+', 'o', 'x', '%', '#', '@', '&'] as const;
const OVER_MS = 900;

interface View { scale: number; left: number; top: number; width: number; height: number }

function viewFor(columns: number, rows: number): View {
  const scale = Math.max(0.12, Math.min((columns - 4) / (JAR_W + 4), (rows * 2 - 4) / (JAR_H + 3)));
  const width = Math.max(4, Math.round(JAR_W * scale));
  const height = Math.max(4, Math.round(JAR_H * scale));
  return {scale, left: Math.floor((columns - width) / 2), top: 2 + Math.max(0, Math.floor((rows * 2 - 3 - height) / 2)), width, height};
}

class YarnDrop implements GameInstance {
  result: GameResult | undefined;
  readonly stepsPerSecond = 60;
  private readonly state: YarnState;
  private started = false;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly shake = new Shake(200);
  private pixels = new PixelBuffer(0, 0);
  private endMs = -1;
  private readonly startBest: number;
  private banner = '';
  private bannerMs = 0;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new YarnState(context.rng.fork('yarn'));
    this.particles = new ParticleSystem(context.rng.fork('yarn-fx'), 220, context.motion.effects);
    this.popups = new Popups(6, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return 0; }

  step(dtMs: number): void {
    if (this.done || !this.started) return;
    if (this.state.over) {
      this.endMs -= dtMs;
      if (this.endMs <= 0) this.finish();
      return;
    }
    this.state.step(dtMs);
    const view = viewFor(this.size.columns, this.size.rows);
    const colors = distinctColors(TIERS, arcadeLook());
    const px = (x: number) => view.left + x * view.scale;
    const py = (y: number) => view.top + y * view.scale;
    for (const event of this.state.events.splice(0)) {
      if (event.kind === 'fuse') {
        const color = colors[event.tier]!;
        const r = RADII[event.tier]! * view.scale;
        this.particles.burst({x: px(event.x), y: py(event.y), count: 6 + event.tier * 3, speed: 22 + r * 4, life: 520, gravity: 50, drag: 0.8, colors: [color, mixRgb(color, rgb(0xffffff), 0.5)]});
        if (event.tier >= 3) this.popups.add(`+${[0, 2, 5, 9, 14, 20, 28, 38, 50][event.tier]}`, px(event.x), py(event.y) / 2, rgb(0xffe08a), 800);
        if (event.tier >= 6) this.shake.trigger(!this.context.motion.reduced && this.context.motion.effects !== 'off');
      } else if (event.kind === 'burst') {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 40, speed: 50, life: 800, gravity: 40, drag: 0.6, colors});
        this.say('Giant fusion · +150');
      } else if (event.kind === 'full') this.say('The jar is full');
    }
    if (this.state.over) {
      this.endMs = this.context.motion.reduced ? 300 : OVER_MS;
      if (this.state.score > 0 && this.state.score > this.startBest) confetti(this.particles, this.size.columns, this.size.rows * 2, colors, this.context.motion);
    }
  }

  private say(text: string): void { this.banner = text; this.bannerMs = 1800; }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {bestTier: state.bestTier + 1});
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record: state.score > 0 && state.score > this.startBest,
      details: [`Biggest ball ${state.bestTier + 1} of ${TIERS}`, `Fusions ${state.fusions}`, `Best ${saved.best.toLocaleString('en-US')}`, `Games ${saved.plays}`],
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
    const dir = direction(key);
    if (dir === 'left' || dir === 'right') { this.started = true; if (!this.state.over) this.state.move(dir === 'left' ? -1 : 1); return 'handled'; }
    if (isConfirm(key) || dir === 'down') { this.started = true; if (!this.state.over) this.state.drop(); return 'handled'; }
    return 'ignored';
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    const state = this.state;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    topRow(canvas, look, `Yarn Drop · next ${state.next + 1}`, `Score ${state.score.toLocaleString('en-US')}`);
    const view = viewFor(canvas.width, canvas.height);
    const colors = distinctColors(TIERS, look);
    if (color) this.drawPixels(canvas, view, look, colors);
    else this.drawText(canvas, view, look, colors);
    this.popups.draw(canvas, NIGHT[1]);
    const message = !this.started ? '← → aim  ·  Space drops' : this.bannerMs > 0 ? this.banner : state.dangerMs > 0 ? 'Jar nearly full' : '';
    if (message) canvas.center(Math.max(1, Math.floor((view.top + view.height * 0.18) / 2)), message, {fg: look.text.strong, bold: true});
  }

  private drawPixels(canvas: Canvas, view: View, look: ReturnType<typeof arcadeLook>, colors: Rgb[]): void {
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    const state = this.state;
    const px = (x: number) => view.left + x * view.scale;
    const py = (y: number) => view.top + y * view.scale;
    gradient(buffer, [look.surface.sunken, mixRgb(look.surface.sunken, NIGHT[1]!, 0.6)], view.top, view.top + view.height);
    // Only the jar's interior gets the gradient: clear what the full-width gradient painted outside it.
    for (let y = view.top; y < view.top + view.height; y += 1) {
      for (let x = 0; x < buffer.width; x += 1) if (x < view.left || x >= view.left + view.width) buffer.set(x, y, undefined);
    }
    // The danger line, dashed; it blinks when the pile is over it (steady with reduced motion).
    const lineY = Math.round(py(LINE_Y));
    const blink = state.dangerMs > 0 && !this.context.motion.reduced ? Math.floor(state.dangerMs / 160) % 2 === 0 : true;
    for (let x = view.left; x < view.left + view.width; x += 1) if (x % 4 < 2) buffer.set(x, lineY, state.dangerMs > 0 && blink ? look.bad : look.surface.edge);
    for (const body of state.bodies) this.disc(buffer, px(body.x), py(body.y), RADII[body.tier]! * view.scale, colors[body.tier]!, body.tier);
    if (state.ready && !state.over) {
      const r = RADII[state.current]! * view.scale;
      this.disc(buffer, px(state.aimX), py(SPAWN_Y), r, colors[state.current]!, state.current);
      for (let y = Math.round(py(SPAWN_Y) + r) + 1; y < view.top + view.height - 1; y += 3) buffer.set(px(state.aimX), y, mixRgb(look.surface.sunken, look.text.dim, 0.5));
    }
    // Jar walls last.
    const wall = look.surface.edge;
    for (let y = view.top - 1; y <= view.top + view.height; y += 1) { buffer.set(view.left - 1, y, wall); buffer.set(view.left + view.width, y, wall); }
    for (let x = view.left - 1; x <= view.left + view.width; x += 1) { buffer.set(x, view.top + view.height, wall); buffer.set(x, view.top + view.height + 1, mixRgb(wall, rgb(0x000000), 0.4)); }
    this.particles.draw(buffer, NIGHT[1]);
    const shake = this.shake.offset;
    canvas.blit(buffer, shake.x, shake.y);
    // Each ball big enough to hold one shows its size number.
    const digit = (body: {x: number; y: number; tier: number}) => {
      const r = RADII[body.tier]! * view.scale;
      if (r < 3) return;
      canvas.put(Math.round(px(body.x)) + shake.x, Math.floor(py(body.y) / 2) + shake.y, String(body.tier + 1), {fg: look.text.onAccent, bold: true});
    };
    for (const body of state.bodies) digit(body);
    if (state.ready && !state.over) digit({x: state.aimX, y: SPAWN_Y, tier: state.current});
  }

  /** A shaded yarn ball: lit from the upper left, with a texture that depends on its size class. */
  private disc(buffer: PixelBuffer, cx: number, cy: number, radius: number, base: Rgb, tier: number): void {
    const r = Math.max(0.8, radius);
    const light = mixRgb(base, rgb(0xffffff), 0.4);
    const dark = mixRgb(base, rgb(0x000000), 0.35);
    const thread = mixRgb(base, rgb(0x000000), 0.18);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        let tone = base;
        if (r >= 2) {
          const shade = (dx * 0.5 + dy * 0.7) / r;
          if (d > r - 1) tone = dark;
          else if (shade < -0.45) tone = light;
          else if (shade > 0.55) tone = mixRgb(base, dark, 0.5);
          const pattern = tier % 3 === 0 ? (x + y) % 4 === 0 : tier % 3 === 1 ? y % 3 === 0 : (x % 4 === 0 || y % 4 === 0);
          if (pattern && d < r - 1) tone = thread;
        }
        buffer.set(x, y, tone);
      }
    }
  }

  /** Text mode: each size is a disc of its own glyph; walls and the danger line are ASCII. */
  private drawText(canvas: Canvas, view: View, look: ReturnType<typeof arcadeLook>, colors: Rgb[]): void {
    const tint = this.context.color !== 'none';
    const state = this.state;
    const left = view.left;
    const top = Math.floor(view.top / 2);
    const bottom = Math.min(canvas.height - 1, top + Math.ceil(view.height / 2));
    const right = left + view.width;
    const edge = {fg: tint ? look.surface.edge : undefined, bold: true};
    const lineRow = Math.floor((view.top + LINE_Y * view.scale) / 2);
    for (let x = left; x < right; x += 2) canvas.put(x, lineRow, '-', {fg: tint ? (state.dangerMs > 0 ? look.bad : look.text.dim) : undefined});
    const fill = (cx: number, cy: number, r: number, tier: number) => {
      const rr = Math.max(0.9, r);
      for (let y = Math.floor((cy - rr) / 2); y <= Math.ceil((cy + rr) / 2); y += 1) {
        for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x += 1) {
          if ((x + 0.5 - cx) ** 2 + (y * 2 + 1 - cy) ** 2 <= rr * rr) canvas.put(x, y, GLYPHS[tier]!, {fg: tint ? colors[tier] : undefined, bold: true});
        }
      }
    };
    for (const body of state.bodies) fill(view.left + body.x * view.scale, view.top + body.y * view.scale, RADII[body.tier]! * view.scale, body.tier);
    if (state.ready && !state.over) fill(view.left + state.aimX * view.scale, view.top + SPAWN_Y * view.scale, RADII[state.current]! * view.scale, state.current);
    for (let y = top; y <= bottom; y += 1) { canvas.put(left - 1, y, '|', edge); canvas.put(right, y, '|', edge); }
    for (let x = left - 1; x <= right; x += 1) canvas.put(x, bottom, '=', edge);
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: '← →', action: 'aim'}, {keys: 'Space', action: 'drop'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

/** The hub preview: a pile of fused balls with one swinging in to drop. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const view = viewFor(canvas.width, canvas.height + 1);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  const colors = distinctColors(TIERS, look);
  const px = (x: number) => view.left + x * view.scale;
  const py = (y: number) => view.top - 2 + y * view.scale;
  buffer.rect(view.left, view.top - 2, view.width, view.height, look.surface.sunken);
  const pile: ReadonlyArray<[number, number, number]> = [[13, 78, 3], [34, 76, 4], [49, 79, 2], [24, 63, 1], [44, 63, 2], [14, 58, 0]];
  for (const [x, y, tier] of pile) buffer.ellipse(Math.round(px(x) - RADII[tier]! * view.scale), Math.round(py(y) - RADII[tier]! * view.scale), Math.max(2, Math.round(RADII[tier]! * 2 * view.scale)), Math.max(2, Math.round(RADII[tier]! * 2 * view.scale)), colors[tier]!);
  const t = (frame % 40) / 40;
  const x = 12 + Math.abs(((frame * 1.7) % 72) - 36);
  const y = 10 + t * 38;
  buffer.ellipse(Math.round(px(x) - 3 * view.scale), Math.round(py(y) - 3 * view.scale), Math.max(2, Math.round(6 * view.scale)), Math.max(2, Math.round(6 * view.scale)), colors[1]!);
  canvas.blit(buffer);
}

export const yarnGame: GameDefinition = {
  id: 'yarn', aliases: ['yarn-drop', 'suika', 'fruit-merge'], title: 'Yarn Drop', tagline: 'Fuse the yarn',
  description: 'Aim and drop balls of yarn into the jar. Two equal balls that touch fuse into the next size, and a pile that stays over the line ends the run.',
  kind: 'action', category: 'falling',
  controls: [{keys: '← →', action: 'aim'}, {keys: 'Space', action: 'drop'}],
  howToPlay: [
    'Aim with the arrows (or A D, h l) and press Space or Down to drop the ball shown above the jar. The next one is named in the top row.',
    'Two balls of the same size that touch fuse into the next size and score points. Sizes are numbered 1 to 9; two of the biggest burst for a bonus.',
    'Do not let the pile stay above the dashed line: after a few seconds the jar counts as full.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · size ${count(record.bestTier) || 1}` : 'Not played yet'; },
  preview,
  create: context => new YarnDrop(context),
};
