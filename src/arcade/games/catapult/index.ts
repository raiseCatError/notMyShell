import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {truncateText} from '../../../util/text.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {clamp} from '../../easing.js';
import {ParticleSystem, Popups, Shake} from '../../effects.js';
import {confetti, shatter} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {disc, gradient, ridge, rgb, stars} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {CAT_INFO, CatapultState, GROUND, MATERIAL, SLING, WORLD_H, WORLD_W, type Block, type CatKind, type Material} from './logic.js';

/**
 * Catapult Cats: an original slingshot game. Aim with the arrows (the dotted arc is the exact path), launch with Space,
 * and press Space again in flight for the cat's own trick: Dash speeds up, Triple splits in three, Boom explodes. Knock
 * every mouse off its tower; cats left over turn into stars and points. Levels are generated from the run's seed, and a
 * run goes on until a level cannot be cleared.
 */
const MOUSE = rgb(0xe9e4f2);
const MOUSE_EAR = rgb(0xff9ab0);
const WOOD = rgb(0xc58a52);
const STONE = rgb(0x8f8bab);
const GLASS = rgb(0xa5e6f2);
const GRASS = rgb(0x7fe0a8);
const DIRT = [rgb(0x5b3f6e), rgb(0x432d58)];
const ANGLE_STEP = (1.5 * Math.PI) / 180;
const POWER_STEP = 0.03;

const materialColor = (kind: Material): Rgb => (kind === 'wood' ? WOOD : kind === 'stone' ? STONE : kind === 'glass' ? GLASS : MOUSE);

interface Layout { scale: number; ox: number; oy: number }
function layoutFor(columns: number, rows: number): Layout {
  const height = Math.max(8, rows * 2) - 3;
  const scale = Math.min(columns / WORLD_W, height / WORLD_H);
  return {scale, ox: Math.floor((columns - WORLD_W * scale) / 2), oy: 3 + Math.floor((height - WORLD_H * scale) / 2)};
}

function catColors(look: ArcadeLook): Readonly<Record<CatKind, Rgb>> {
  return {tabby: look.hue.coral, dash: look.hue.sky, split: look.hue.mint, boom: look.hue.lilac};
}

function drawCat(buffer: PixelBuffer, cx: number, cy: number, radius: number, body: Rgb, eye: Rgb): void {
  const r = Math.max(1, Math.round(radius));
  buffer.ellipse(Math.round(cx) - r, Math.round(cy) - r, r * 2, r * 2, body);
  if (r >= 2) {
    buffer.set(cx - r + 0.5, cy - r - 0.5, body); buffer.set(cx + r - 1.5, cy - r - 0.5, body);
    buffer.set(cx - 0.8, cy - 0.3, eye); buffer.set(cx + 0.8, cy - 0.3, eye);
  }
}

class Catapult implements GameInstance {
  result: GameResult | undefined;
  readonly stepsPerSecond = 60;
  private state: CatapultState;
  private started = false;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly shake = new Shake(240);
  private pixels = new PixelBuffer(0, 0);
  private clock = 0;
  private banner = '';
  private bannerMs = 0;
  private flash = 0;
  private readonly startBest: number;
  private lastPalette: ArcadePalette | undefined;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new CatapultState(context.seed, 1);
    this.particles = new ParticleSystem(context.rng.fork('catapult-fx'), 220, context.motion.effects);
    this.popups = new Popups(6, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.context.motion.reduced ? 0 : 120; }

  private world(): {px: (x: number) => number; py: (y: number) => number} {
    const layout = layoutFor(this.size.columns, this.size.rows);
    return {px: x => layout.ox + x * layout.scale, py: y => layout.oy + y * layout.scale};
  }

  step(dtMs: number): void {
    if (this.done) return;
    const state = this.state;
    state.step(dtMs);
    const {px, py} = this.world();
    const look = arcadeLook(this.lastPalette);
    for (const event of state.events.splice(0)) {
      if (event.kind === 'break') {
        const base = materialColor(event.material);
        shatter(this.particles, {x: px(event.x), y: py(event.y), width: Math.max(2, event.w * layoutFor(this.size.columns, this.size.rows).scale), height: Math.max(2, event.h * layoutFor(this.size.columns, this.size.rows).scale)}, [base, mixRgb(base, rgb(0xffffff), 0.4)], {speed: 36, gravity: 80});
        this.popups.add(`+${event.points}`, px(event.x + event.w / 2), Math.floor(py(event.y) / 2) - 1, look.gold, 900);
      } else if (event.kind === 'hit') {
        if (event.damage > 0) this.particles.burst({x: px(event.x), y: py(event.y), count: 3, speed: 22, angle: 0, spread: Math.PI, life: 260, drag: 2, colors: [materialColor(event.material), rgb(0xfff8ef)]});
      } else if (event.kind === 'explosion') {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 26, speed: 70, angle: 0, spread: Math.PI, life: 520, drag: 2.5, colors: [rgb(0xffb347), rgb(0xff6a6a), rgb(0xfff2c0)]});
        this.shake.trigger(!this.context.motion.reduced && this.context.motion.effects !== 'off');
        this.flash = this.context.motion.reduced ? 0 : 1;
      } else if (event.kind === 'ability') {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 8, speed: 30, angle: 0, spread: Math.PI, life: 340, drag: 2, colors: [catColors(look)[event.cat], rgb(0xffffff)]});
        this.say(CAT_INFO[event.cat].name + '!');
      } else if (event.kind === 'poof') {
        this.particles.burst({x: px(event.x), y: py(event.y), count: 5, speed: 14, angle: -Math.PI / 2, spread: 1.4, life: 380, drag: 2, colors: [rgb(0xe9e4f2)]});
      } else if (event.kind === 'clear') {
        this.say(`Level ${state.level} clear  [${'*'.repeat(event.stars)}${'-'.repeat(3 - event.stars)}]${event.bonus ? `  +${event.bonus} bonus` : ''}`);
        this.bannerMs = 1e9;
        confetti(this.particles, this.size.columns, this.size.rows * 2, [look.hue.coral, look.hue.sky, look.hue.mint, look.hue.butter], this.context.motion);
      } else if (event.kind === 'lost') this.say('Out of cats');
    }
    if (state.phase === 'lost') this.finish();
  }

  private say(text: string): void { this.banner = text; this.bannerMs = 1800; }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {bestLevel: state.levelsCleared, bestStars: state.totalStars});
    const record = state.score > 0 && state.score > this.startBest;
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record,
      details: [`Levels cleared ${state.levelsCleared}`, `Stars ${state.totalStars}`, `Reached level ${state.level}`, `Best ${saved.best.toLocaleString('en-US')}`],
    };
    if (record) confetti(this.particles, this.size.columns, this.size.rows * 2, [rgb(0xffb347), rgb(0x7fe0a8), rgb(0x8fc4ff), rgb(0xff9ab0)], this.context.motion);
  }

  animate(dtMs: number): void {
    this.clock += dtMs;
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.shake.update(dtMs);
    this.flash = Math.max(0, this.flash - dtMs / 260);
    if (this.bannerMs < 1e8) this.bannerMs = Math.max(0, this.bannerMs - dtMs);
  }

  key(key: Key): GameKeyResult {
    if (this.done) return 'ignored';
    const state = this.state;
    const dir = direction(key);
    if (dir === 'up') state.aim(ANGLE_STEP, 0);
    else if (dir === 'down') state.aim(-ANGLE_STEP, 0);
    else if (dir === 'right') state.aim(0, POWER_STEP);
    else if (dir === 'left') state.aim(0, -POWER_STEP);
    else if (isConfirm(key)) {
      if (state.phase === 'aim') { state.fire(); this.bannerMs = 0; }
      else if (state.phase === 'flight') state.ability();
      else if (state.phase === 'clear') { state.nextLevel(); this.bannerMs = 0; }
    } else return 'ignored';
    this.started = true;
    return 'handled';
  }

  render(canvas: Canvas, alpha: number, palette: ArcadePalette): void {
    this.lastPalette = palette;
    const look = arcadeLook(palette);
    const state = this.state;
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const layout = layoutFor(canvas.width, canvas.height);
    if (color) this.drawScene(canvas, palette, look, layout, alpha); else this.drawText(canvas, look, layout);
    topRow(canvas, look, 'Catapult Cats', `Score ${state.score.toLocaleString('en-US')}`);
    this.drawHud(canvas, look);
    this.popups.draw(canvas, look.surface.base);
    const mid = Math.floor(canvas.height / 3);
    const say = (y: number, text: string, style: {fg: Rgb; bold: boolean}) => canvas.center(y, truncateText(text, Math.max(1, canvas.width - 2)), style);
    if (!this.started) {
      say(mid, 'Catapult Cats', {fg: look.text.strong, bold: true});
      say(mid + 1, '↑↓ angle  ←→ power  Space launch', {fg: look.accent, bold: true});
      say(mid + 2, 'Knock every mouse (M) off its tower', {fg: look.text.normal, bold: false});
    } else if (state.phase === 'clear') {
      say(mid, this.banner, {fg: look.gold, bold: true});
      say(mid + 1, 'Space: next level', {fg: look.text.strong, bold: true});
    } else if (this.bannerMs > 0 && !this.done) say(mid, this.banner, {fg: look.gold, bold: true});
    if (this.done) {
      say(mid, 'OUT OF CATS', {fg: look.bad, bold: true});
      say(mid + 1, `${state.score.toLocaleString('en-US')}${this.result?.record ? '  *  NEW RECORD  *' : ''}`, {fg: this.result?.record ? look.gold : look.text.strong, bold: true});
    }
  }

  private drawHud(canvas: Canvas, look: ArcadeLook): void {
    const state = this.state;
    const colors = catColors(look);
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    let x = 1;
    const head = `Lv ${state.level}  Mice ${state.targetsLeft}  Cats `;
    x += canvas.text(x, 1, truncateText(head, Math.max(0, canvas.width - 2)), {fg: look.text.normal});
    state.queue.forEach((kind, index) => {
      if (x + 3 > canvas.width - 1) return;
      const text = index === 0 && state.phase === 'aim' ? `[${CAT_INFO[kind].letter}]` : ` ${CAT_INFO[kind].letter} `;
      x += canvas.text(x, 1, text, {fg: color ? colors[kind] : look.text.strong, bold: index === 0});
    });
    if (canvas.height >= 14) {
      const loaded = state.loaded;
      const aim = `${Math.round((state.angle * 180) / Math.PI)} deg  power ${Math.round(state.power * 100)}%`;
      const line = state.phase === 'aim' && loaded ? `${aim}  ${CAT_INFO[loaded].name}: ${CAT_INFO[loaded].ability}` : state.phase === 'flight' ? 'Space: ability' : '';
      if (line) canvas.text(1, 2, truncateText(line, Math.max(0, canvas.width - 2)), {fg: look.text.dim});
    }
  }

  private drawScene(canvas: Canvas, palette: ArcadePalette, look: ArcadeLook, layout: Layout, alpha: number): void {
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    const state = this.state;
    const x = (v: number) => layout.ox + v * layout.scale;
    const y = (v: number) => layout.oy + v * layout.scale;
    const sky = [mixRgb(palette.deep, rgb(0x000000), 0.2), palette.dusk, mixRgb(palette.dusk, palette.haze, 0.5)];
    const bottom = Math.round(y(GROUND));
    gradient(buffer, sky, 2, bottom);
    stars(buffer, 5, Math.max(1, bottom - 8), palette.haze, sky[0]!, {time: this.context.motion.reduced ? 0 : this.clock, strength: 0.9});
    disc(buffer, Math.round(x(100)), Math.round(y(12)), Math.max(2, Math.round(layout.scale * 5)), rgb(0xfff4d6), sky[1]!, 2);
    ridge(buffer, {base: bottom, height: layout.scale * 18, amplitude: layout.scale * 6, scale: 26, scroll: 0, seed: 12, color: mixRgb(sky[1]!, palette.deep, 0.5), step: 2});
    ridge(buffer, {base: bottom, height: layout.scale * 9, amplitude: layout.scale * 4, scale: 14, scroll: 40, seed: 3, color: mixRgb(sky[1]!, palette.deep, 0.75), rim: mixRgb(sky[2]!, palette.deep, 0.5), step: 2});
    buffer.rect(0, bottom, buffer.width, buffer.height - bottom, DIRT[0]!);
    buffer.rect(0, bottom, buffer.width, 1, GRASS);
    buffer.rect(0, bottom + 1, buffer.width, 1, mixRgb(GRASS, DIRT[0]!, 0.5));
    for (let i = bottom + 4; i < buffer.height; i += 4) buffer.rect(0, i, buffer.width, 1, DIRT[1]!);
    const colors = catColors(look);
    // The sling: a post, a fork and the band.
    const sx = x(SLING.x), sy = y(SLING.y);
    buffer.line(sx, sy + 4 * layout.scale, sx, bottom, WOOD);
    buffer.line(sx, sy + 4 * layout.scale, sx - 3 * layout.scale, sy, WOOD);
    buffer.line(sx, sy + 4 * layout.scale, sx + 3 * layout.scale, sy, WOOD);
    const loaded = state.loaded;
    if (loaded) {
      const pull = 3 + 6 * state.power;
      const cx = x(SLING.x - Math.cos(state.angle) * pull), cy = y(SLING.y + Math.sin(state.angle) * pull);
      buffer.line(sx - 3 * layout.scale, sy, cx, cy, mixRgb(WOOD, rgb(0x000000), 0.4));
      buffer.line(sx + 3 * layout.scale, sy, cx, cy, mixRgb(WOOD, rgb(0x000000), 0.4));
      drawCat(buffer, cx, cy, CAT_R_PX(layout), colors[loaded], rgb(0x1b1830));
      const points = state.preview();
      points.forEach((point, index) => { if (index % 2 === 0) buffer.set(x(point.x), y(point.y), rgb(0xfff8ef)); else buffer.set(x(point.x), y(point.y), mixRgb(rgb(0xfff8ef), sky[1]!, 0.5)); });
    }
    for (const block of state.blocks) this.drawBlock(buffer, block, layout);
    for (const cat of state.cats) {
      const cx = x(cat.px + (cat.x - cat.px) * alpha), cy = y(cat.py + (cat.y - cat.py) * alpha);
      drawCat(buffer, cx, cy, cat.r * layout.scale, colors[cat.kind], rgb(0x1b1830));
    }
    this.particles.draw(buffer, sky[1]!);
    if (this.flash > 0) for (let py = 2; py < bottom; py += 2) for (let px = 0; px < buffer.width; px += 2) { const c = buffer.get(px, py); if (c) buffer.set(px, py, mixRgb(c, rgb(0xffffff), this.flash * 0.25)); }
    const shake = this.shake.offset;
    canvas.blit(buffer, shake.x, shake.y);
    // A letter on every mouse and on each queued cat's icon: no meaning rests on color alone.
    for (const block of state.blocks) if (block.kind === 'target' && block.w * layout.scale >= 2.5) canvas.put(Math.round(x(block.x + block.w / 2)), Math.floor(y(block.y + block.h / 2) / 2), 'M', {fg: rgb(0x2a1a2f), bold: true});
  }

  private drawBlock(buffer: PixelBuffer, block: Block, layout: Layout): void {
    const x = Math.round(layout.ox + block.x * layout.scale), y = Math.round(layout.oy + block.y * layout.scale);
    const w = Math.max(1, Math.round(block.w * layout.scale)), h = Math.max(1, Math.round(block.h * layout.scale));
    const base = materialColor(block.kind);
    if (block.kind === 'target') {
      buffer.ellipse(x, y, w, h, base);
      buffer.set(x, y, MOUSE_EAR); buffer.set(x + w - 1, y, MOUSE_EAR);
      buffer.set(x + w * 0.3, y + h * 0.45, rgb(0x1b1830)); buffer.set(x + w * 0.7, y + h * 0.45, rgb(0x1b1830));
      return;
    }
    buffer.rect(x, y, w, h, base);
    buffer.rect(x, y, w, 1, mixRgb(base, rgb(0xffffff), 0.35));
    if (h > 1) buffer.rect(x, y + h - 1, w, 1, mixRgb(base, rgb(0x000000), 0.3));
    if (block.kind === 'glass') for (let i = 0; i < Math.min(w, h); i += 3) buffer.set(x + i + 1, y + i, rgb(0xffffff));
    // Cracks show wear without relying on color.
    const wear = 1 - block.hp / block.maxHp;
    if (wear > 0.35) for (let i = 0; i < Math.max(w, h); i += 2) buffer.set(x + (i % w), y + ((i * 3) % h), mixRgb(base, rgb(0x000000), 0.6));
  }

  /** Without color: blocks by material letter (= wood, # stone, : glass, M mouse), % when cracked, cats @, the arc dots. */
  private drawText(canvas: Canvas, look: ArcadeLook, layout: Layout): void {
    const state = this.state;
    const cx = (v: number) => Math.round(layout.ox + v * layout.scale);
    const cy = (v: number) => Math.floor((layout.oy + v * layout.scale) / 2);
    for (let column = 0; column < canvas.width; column += 1) canvas.put(column, cy(GROUND), '_', {fg: look.text.dim});
    canvas.put(cx(SLING.x), cy(SLING.y), 'Y', {bold: true});
    canvas.vline(cx(SLING.x), cy(SLING.y) + 1, Math.max(0, cy(GROUND) - cy(SLING.y) - 1), '|');
    if (state.loaded) {
      for (const point of state.preview()) canvas.put(cx(point.x), cy(point.y), '.', {fg: look.text.normal});
      canvas.put(cx(SLING.x - Math.cos(state.angle) * 5), cy(SLING.y + Math.sin(state.angle) * 5), '@', {bold: true});
    }
    for (const block of state.blocks) {
      const wear = 1 - block.hp / block.maxHp;
      const letter = block.kind === 'target' ? 'M' : wear > 0.5 ? '%' : MATERIAL[block.kind].letter;
      const x0 = cx(block.x), x1 = Math.max(x0, cx(block.x + block.w) - 1), y0 = cy(block.y), y1 = Math.max(y0, cy(block.y + block.h) - 1);
      for (let yy = y0; yy <= y1; yy += 1) for (let xx = x0; xx <= x1; xx += 1) canvas.put(xx, yy, letter, {bold: block.kind === 'target'});
    }
    for (const cat of state.cats) canvas.put(cx(cat.x), cy(cat.y), '@', {bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] {
    const phase = this.state.phase;
    if (phase === 'flight') return [{keys: 'Space', action: 'ability'}];
    if (phase === 'clear') return [{keys: 'Space', action: 'next level'}];
    return [{keys: '↑↓', action: 'angle'}, {keys: '←→', action: 'power'}, {keys: 'Space', action: 'launch'}];
  }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

const CAT_R_PX = (layout: Layout): number => 2 * layout.scale;

/** The hub preview: a cat arcing toward a small tower. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  const w = buffer.width, h = buffer.height;
  buffer.rect(0, 0, w, h, mixRgb(palette.deep, palette.dusk, 0.5));
  const ground = Math.round(h * 0.82);
  buffer.rect(0, ground, w, h - ground, DIRT[0]!);
  buffer.rect(0, ground, w, 1, GRASS);
  const block = (fx: number, fy: number, bw: number, bh: number, color: Rgb) => buffer.rect(Math.round(w * fx), Math.round(h * fy), Math.max(1, Math.round(w * bw)), Math.max(1, Math.round(h * bh)), color);
  const t = (frame % 30) / 30;
  const hit = t > 0.7;
  block(0.7, 0.55, 0.04, 0.27, WOOD); block(0.86, 0.55, 0.04, 0.27, WOOD); block(0.68, 0.47, 0.26, 0.08, hit ? mixRgb(WOOD, rgb(0x000000), 0.4) : WOOD);
  if (!hit) buffer.ellipse(Math.round(w * 0.76), Math.round(h * 0.36), Math.max(2, Math.round(w * 0.08)), Math.max(2, Math.round(h * 0.11)), MOUSE);
  const flight = Math.min(1, t / 0.7);
  const cx = w * (0.14 + 0.58 * flight), cy = h * (0.55 - 0.9 * flight * (1 - flight) * 1.2 + 0.1 * flight);
  buffer.line(w * 0.14, h * 0.55, w * 0.14, ground, WOOD);
  drawCat(buffer, cx, cy, Math.max(1.5, w * 0.04), catColors(look).tabby, rgb(0x1b1830));
  canvas.blit(buffer);
}

export const catapultGame: GameDefinition = {
  id: 'catapult', aliases: ['catapult-cats', 'slingshot'], title: 'Catapult Cats', tagline: 'Fling cats, topple towers',
  description: 'Aim a slingshot at towers of wood, stone and glass and knock every mouse off. Four kinds of cat, each with a trick: Dash, Triple, Boom. Unused cats turn into stars; levels get harder.',
  kind: 'action', category: 'physics',
  controls: [{keys: '↑↓', action: 'angle'}, {keys: '←→', action: 'power'}, {keys: 'Space', action: 'launch / ability'}],
  howToPlay: [
    'Aim with ↑ ↓ (angle) and ← → (power); the dotted arc shows the cat\'s exact path. Press Space to launch.',
    'Press Space again while a cat flies: Dash (D) speeds up, Triple (S) splits in three, Boom (B) explodes. Tabby (T) has no trick but hits hard.',
    'Mice (M) are knocked out by a hit or a falling block. Clear all of them to finish a level; every cat left over adds a star and 1,000 points.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · ${count(record.bestStars)} stars` : 'Not played yet'; },
  preview,
  create: context => new Catapult(context),
};
