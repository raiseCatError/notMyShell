import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {catPixels} from '../../../idle/catSprite.js';
import type {Key} from '../../../terminal/keys.js';
import {outlineSprite, PixelBuffer, spriteFromRows, type Canvas} from '../../Canvas.js';
import {easeOutBack} from '../../easing.js';
import {ParticleSystem, Popups} from '../../effects.js';
import {isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, distinctColors} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {along, gradient, rgb, stars} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {FIELD, TowerState} from './logic.js';

/**
 * Cat Tower: precision stacking. Drop the sliding slab onto the tower; whatever hangs over breaks off. Vespyr rides the
 * top of the tower, the sky darkens toward the stars as it climbs, and perfect drops build a streak.
 */
const SKY_LOW = [rgb(0x8f7fe0), rgb(0xd7a8d8), rgb(0xffd2a6)];
const SKY_HIGH = [rgb(0x0d0a26), rgb(0x24195a), rgb(0x4a3a8a)];
const GROUND = rgb(0x3a2c4e);

interface View { scale: number; left: number; slabPx: number }

function viewFor(columns: number, rows: number): View {
  const scale = Math.max(0.5, Math.min(2, (columns - 4) / FIELD));
  return {scale, left: Math.floor((columns - FIELD * scale) / 2), slabPx: rows >= 30 ? 4 : 2};
}

class CatTower implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private state = new TowerState();
  private started = false;
  private done = false;
  private size: {columns: number; rows: number};
  private camera = 0;
  private hopMs = 0;
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private pixels = new PixelBuffer(0, 0);
  private readonly startBest: number;
  private overMs = 0;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('tower-fx'), 140, context.motion.effects);
    this.popups = new Popups(4, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.started ? 0 : this.context.motion.reduced ? 0 : 100; }

  step(dtMs: number): void {
    if (this.done) return;
    this.state.step(dtMs);
    const view = viewFor(this.size.columns, this.size.rows);
    for (const event of this.state.events.splice(0)) {
      if (event.kind === 'miss') { this.overMs = this.context.motion.reduced ? 300 : 900; continue; }
      this.hopMs = this.context.motion.reduced ? 0 : 220;
      const x = view.left + (event.x + event.w / 2) * view.scale;
      const y = this.screenY(event.floor, view);
      if (event.perfect) {
        this.particles.burst({x, y, count: 14, speed: 40, spread: Math.PI, life: 600, drag: 1.2, colors: [rgb(0xffe08a), rgb(0xffffff), arcadeLook().accent]});
        this.popups.add(this.state.streak >= 2 ? `Perfect ×${this.state.streak}` : 'Perfect', x, Math.floor(y / 2) - 3, rgb(0xffe08a), 900);
      } else {
        this.particles.burst({x: view.left + event.x * view.scale, y, count: 4, speed: 18, angle: Math.PI / 2, spread: 1, life: 400, gravity: 60, drag: 1.5, colors: [rgb(0xd8d0f0)]});
      }
      if (event.floor % 10 === 0) this.popups.add(`${event.floor} floors`, x, Math.floor(y / 2) - 5, arcadeLook().accent, 1200);
    }
    if (!this.state.alive) { this.overMs -= dtMs; if (this.overMs <= 0) this.finish(); }
  }

  /** Pixel row of the top of `floor` on screen, given the camera. */
  private screenY(floor: number, view: View): number {
    const base = this.size.rows * 2 - 4;
    return base - (floor - this.camera) * view.slabPx;
  }

  private finish(): void {
    this.done = true;
    const floors = this.state.floors;
    const saved = saveScore(this.context.record, floors, {bestPerfects: this.state.perfects});
    this.result = {
      score: floors, scoreText: `${floors}`, record: floors > 0 && floors > this.startBest,
      details: [`${floors} floor${floors === 1 ? '' : 's'}`, `Perfect drops ${this.state.perfects}`, `Best ${saved.best}`, `Towers ${saved.plays}`],
    };
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.hopMs = Math.max(0, this.hopMs - dtMs);
    // The camera keeps the top of the tower about a third of the way down the screen.
    const view = viewFor(this.size.columns, this.size.rows);
    const visible = (this.size.rows * 2 - 4) / view.slabPx;
    const target = Math.max(0, this.state.floors - visible * 0.55);
    const rate = this.context.motion.reduced ? 1 : Math.min(1, dtMs / 180);
    this.camera += (target - this.camera) * rate;
  }

  key(key: Key): GameKeyResult {
    if (this.done) return 'ignored';
    if (isConfirm(key) || key.kind === 'down') {
      if (!this.started) { this.started = true; return 'handled'; }
      this.state.drop();
      return 'handled';
    }
    return 'ignored';
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const state = this.state;
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const view = viewFor(canvas.width, canvas.height);
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    const height = Math.min(1, this.camera / 60);
    const stops = SKY_LOW.map((low, index) => mixRgb(low, SKY_HIGH[index]!, height));
    const hues = distinctColors(8, look);
    const slabColor = (floor: number): Rgb => (floor === 0 ? GROUND : hues[floor % hues.length]!);
    if (color) {
      gradient(buffer, stops, 0, buffer.height);
      stars(buffer, 9, Math.floor(buffer.height * 0.7), rgb(0xffffff), stops[0]!, {strength: height * 1.4 - 0.2});
    }
    const px = (x: number) => Math.round(view.left + x * view.scale);
    const slab = (x: number, w: number, top: number, tone: Rgb) => {
      if (!color) return;
      buffer.rect(px(x), top, Math.max(1, Math.round(w * view.scale)), view.slabPx, tone);
      buffer.rect(px(x), top, Math.max(1, Math.round(w * view.scale)), 1, mixRgb(tone, rgb(0xffffff), 0.35));
    };
    state.slabs.forEach((s, floor) => {
      const top = this.screenY(floor, view);
      if (top > buffer.height || top + view.slabPx < 0) return;
      if (floor === 0) { if (color) buffer.rect(0, top, buffer.width, buffer.height - top, GROUND); return; }
      slab(s.x, s.w, top, slabColor(floor));
    });
    for (const chip of state.chips) slab(chip.x, chip.w, this.screenY(chip.floor, view) + Math.round(chip.y * view.scale), mixRgb(slabColor(chip.floor), stops[1]!, 0.35));
    if (state.alive && this.started) slab(state.moving.x, state.moving.w, this.screenY(state.slabs.length, view), slabColor(state.slabs.length));
    // Vespyr sits on the top slab and hops up when a new one lands.
    if (color) {
      const top = state.top;
      const sprite = outlineSprite(spriteFromRows(catPixels('sit'), {L: palette.cat.body, E: palette.cat.eye}), rgb(0x2a1d52));
      const hop = this.hopMs > 0 ? Math.round(easeOutBack(1 - this.hopMs / 220) * view.slabPx - view.slabPx) - Math.round(Math.sin((1 - this.hopMs / 220) * Math.PI) * 3) : 0;
      const sx = px(top.x + top.w / 2) - Math.floor(sprite.width / 2);
      buffer.sprite(sprite, sx, this.screenY(state.floors, view) - sprite.height + hop);
      this.particles.draw(buffer, along(stops, 0.5));
      canvas.blit(buffer);
      this.popups.draw(canvas, stops[1]);
    } else this.drawText(canvas, view);
    topRow(canvas, look, 'Cat Tower', `Floors ${state.floors}${state.streak >= 2 ? `  perfect ×${state.streak}` : ''}`, color ? stops[0] : undefined);
    if (!this.started) canvas.center(Math.floor(canvas.height / 3), 'Space to drop the slab  ·  line it up with the one below', {fg: color ? rgb(0x2a1d52) : look.text.strong, bold: true});
  }

  /** Without color: slabs as runs of = and the moving one as #. */
  private drawText(canvas: Canvas, view: View): void {
    const state = this.state;
    const row = (floor: number) => Math.floor(this.screenY(floor, view) / 2);
    state.slabs.forEach((s, floor) => { if (floor) canvas.text(Math.round(view.left + s.x * view.scale), row(floor), '='.repeat(Math.max(1, Math.round(s.w * view.scale)))); });
    if (state.alive && this.started) canvas.text(Math.round(view.left + state.moving.x * view.scale), row(state.slabs.length), '#'.repeat(Math.max(1, Math.round(state.moving.w * view.scale))), {bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: 'Space', action: 'drop'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

/** The hub preview: a tower growing slab by slab, the sliding slab above it. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  gradient(buffer, SKY_LOW, 0, buffer.height);
  const hues = distinctColors(8, look);
  const floors = 3 + (Math.floor(frame / 12) % 6);
  const scale = Math.max(0.5, Math.min(2, (canvas.width - 4) / FIELD));
  const left = Math.floor((canvas.width - FIELD * scale) / 2);
  buffer.rect(0, buffer.height - 3, buffer.width, 3, GROUND);
  for (let floor = 1; floor <= floors; floor += 1) {
    const width = 24 - floor * 1.5;
    const x = (FIELD - width) / 2 + Math.sin(floor * 1.7) * 2;
    buffer.rect(Math.round(left + x * scale), buffer.height - 3 - floor * 2, Math.round(width * scale), 2, hues[floor % hues.length]!);
  }
  const slide = Math.sin(frame * 0.25) * 20;
  buffer.rect(Math.round(left + (FIELD / 2 - 9 + slide) * scale), buffer.height - 3 - (floors + 1) * 2 - 4, Math.round(18 * scale), 2, hues[(floors + 1) % hues.length]!);
  canvas.clear(look.surface.base);
  canvas.blit(buffer);
}

export const towerGame: GameDefinition = {
  id: 'tower', aliases: ['cat-tower', 'stack'], title: 'Cat Tower', tagline: 'Stack it high',
  description: 'Drop each sliding slab onto the tower. Whatever hangs over the edge breaks off, so the tower narrows; perfect drops keep it whole and three in a row grow it back.',
  kind: 'action', category: 'reflex',
  controls: [{keys: 'Space', action: 'drop'}],
  howToPlay: [
    'Press Space (or Enter, or Down) to drop the sliding slab. Only the part over the slab below stays.',
    'A drop lined up almost exactly is perfect: nothing breaks off. Three perfect drops in a row widen the slab again.',
    'The slabs slide faster as the tower grows. Missing the tower entirely ends the climb.',
  ],
  summary: record => scoreSummary(record, ' floors'),
  preview,
  create: context => new CatTower(context),
};
