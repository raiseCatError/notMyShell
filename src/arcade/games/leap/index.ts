import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {catPixels} from '../../../idle/catSprite.js';
import type {Key} from '../../../terminal/keys.js';
import {outlineSprite, PixelBuffer, spriteFromRows, type Canvas, type Sprite} from '../../Canvas.js';
import {ParticleSystem, Popups} from '../../effects.js';
import {count, direction, isConfirm, readScore, saveScore, topRow} from '../../kit.js';
import {arcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {along, gradient, hash, rgb, stars} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {FALL_MIN, LeapState, PLATFORM_W, WIDTH, type Platform} from './logic.js';

/**
 * Vespyr Leap: bounce ever upward from platform to platform. The sky climbs from a peach dusk through the night into
 * starry space as the height grows. Solid platforms are mint, sliding ones teal, crumbling ones cracked sand.
 */
const SKIES: readonly (readonly Rgb[])[] = [
  [rgb(0x8d7de0), rgb(0xd6a6d6), rgb(0xffd2a6)],
  [rgb(0x2a2366), rgb(0x5a4aa8), rgb(0xc489c8)],
  [rgb(0x0c0a2a), rgb(0x1d1755), rgb(0x3a2d7a)],
  [rgb(0x02020c), rgb(0x0b0a24), rgb(0x1a1442)],
];
const SOLID = rgb(0x9fe0b8);
const MOVING = rgb(0x7fd6d2);
const CRUMBLE = rgb(0xe8c48f);
const SPRING = rgb(0xffe08a);
/** Vespyr's outline: he climbs through skies close to his own lavender. */
const OUTLINE = rgb(0x2a1d52);

/** The drawn cat's width in pixels: the 14-wide sprite plus its outline. */
const CAT_SPRITE_W = 16;

/** The part of a sprite (mirrored when `flip`) that lies in columns [from, to), with its new left pixel; undefined when none shows. */
export function clipSprite(sprite: Sprite, x: number, from: number, to: number, flip: boolean): {sprite: Sprite; x: number} | undefined {
  const start = Math.max(x, from), end = Math.min(x + sprite.width, to);
  if (end <= start) return undefined;
  const pixels: Array<Rgb | undefined> = [];
  for (let row = 0; row < sprite.height; row += 1) {
    for (let column = start; column < end; column += 1) {
      const source = column - x;
      pixels.push(sprite.pixels[row * sprite.width + (flip ? sprite.width - 1 - source : source)]);
    }
  }
  return {sprite: {...sprite, width: end - start, pixels}, x: start};
}

class VespyrLeap implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private state: LeapState;
  private done = false;
  private size: {columns: number; rows: number};
  private camera = 0;
  private squashMs = 0;
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private pixels = new PixelBuffer(0, 0);
  private dyingMs = 0;
  private readonly startBest: number;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new LeapState(context.rng.fork('leap'));
    this.particles = new ParticleSystem(context.rng.fork('leap-fx'), 140, context.motion.effects);
    this.popups = new Popups(4, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.state.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.state.started ? 0 : this.context.motion.reduced ? 0 : 50; }

  private scale(): number { return Math.max(0.3, Math.min(1.6, this.size.columns / WIDTH)); }
  private left(): number { return Math.floor((this.size.columns - WIDTH * this.scale()) / 2); }
  private screenY(y: number): number { return this.size.rows * 2 - 3 - (y - this.camera); }

  step(dtMs: number): void {
    if (this.done) return;
    const state = this.state;
    const visible = this.size.rows * 2 - 3;
    // The camera keeps the best height 45% of the view above the bottom edge; on a short view a fall may carry the cat below it
    // (marked by an arrow at the edge) for as far as a platform it could still land on can lie.
    state.fallLimit = Math.max(FALL_MIN, visible * 0.45 + 2);
    state.catHalf = (this.context.color !== 'none' && !this.context.safeGlyphs ? CAT_SPRITE_W / 2 : 0.5) / this.scale();
    state.step(dtMs);
    this.camera = Math.max(this.camera, state.best - visible * 0.45);
    for (const event of state.events.splice(0)) {
      if (event.kind === 'bounce') {
        this.squashMs = this.context.motion.reduced ? 0 : 110;
        const px = this.left() + event.x * this.scale();
        this.particles.burst({x: px, y: this.screenY(event.y), count: event.spring ? 12 : 4, speed: event.spring ? 40 : 20, angle: Math.PI / 2, spread: 1.1, life: 360, gravity: 50, drag: 1.4, colors: event.spring ? [SPRING, rgb(0xffffff)] : [SOLID, rgb(0xe9fff2)]});
        if (event.spring) this.popups.add('boing', px, Math.floor(this.screenY(event.y) / 2) - 2, SPRING, 600);
      } else if (event.kind === 'crumble') {
        this.particles.burst({x: this.left() + event.x * this.scale(), y: this.screenY(event.y), count: 8, speed: 18, angle: Math.PI / 2, spread: 0.9, life: 500, gravity: 80, drag: 0.8, colors: [CRUMBLE, mixRgb(CRUMBLE, rgb(0x000000), 0.3)]});
      } else if (event.kind === 'milestone') {
        this.popups.add(`${event.height} m`, Math.floor(this.size.columns / 2), Math.floor(this.screenY(state.y) / 2) - 4, arcadeLook().accent, 1200);
      } else this.dyingMs = this.context.motion.reduced ? 200 : 600;
    }
    if (!state.alive) { this.dyingMs -= dtMs; if (this.dyingMs <= 0) this.finish(); }
  }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.height, {bounces: state.bounces});
    this.result = {
      score: state.height, scoreText: `${state.height.toLocaleString('en-US')} m`, record: state.height > 0 && state.height > this.startBest,
      details: [`${state.bounces} bounces`, `Best ${saved.best.toLocaleString('en-US')} m`, `Climbs ${saved.plays}`],
    };
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.squashMs = Math.max(0, this.squashMs - dtMs);
    if (!this.state.started) this.state.step(dtMs);
  }

  key(key: Key): GameKeyResult {
    if (this.done) return 'ignored';
    const turn = direction(key);
    if (turn === 'left') { this.state.press(-1); return 'handled'; }
    if (turn === 'right') { this.state.press(1); return 'handled'; }
    if (isConfirm(key) || turn === 'up') { this.state.started = true; return 'handled'; }
    return 'ignored';
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const state = this.state;
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const scale = this.scale();
    const left = this.left();
    if (!color) { this.drawText(canvas, scale, left); topRow(canvas, look, 'Vespyr Leap', `${state.height} m`); return; }
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    // The sky darkens with height, from dusk to space, blending between bands.
    const band = Math.min(SKIES.length - 1.001, this.camera / 700);
    const low = SKIES[Math.floor(band)]!, high = SKIES[Math.floor(band) + 1]!;
    const stops = low.map((tone, index) => mixRgb(tone, high[index]!, band - Math.floor(band)));
    gradient(buffer, stops, 0, buffer.height);
    stars(buffer, 17, buffer.height, rgb(0xffffff), stops[0]!, {strength: band - 0.8, scroll: 0, density: 80});
    // Clouds drift past at half the climb's speed while there is still air.
    if (band < 2) for (let index = 0; index < 6; index += 1) {
      const y = ((hash(index * 3) % 400) - this.camera * 0.5) % 400;
      const py = ((y % 400) + 400) % 400 - 60;
      const px = hash(index * 3 + 1) % Math.max(1, canvas.width);
      const tone = mixRgb(along(stops, Math.max(0, Math.min(1, py / buffer.height))), rgb(0xffffff), 0.35 * (1 - band / 2));
      buffer.ellipse(px, py, 14, 3, tone);
      buffer.ellipse(px + 3, py - 1, 8, 3, tone);
    }
    for (const platform of state.platforms) this.drawPlatform(buffer, platform, scale, left);
    const catX = left + state.x * scale;
    const top = this.screenY(state.y);
    const pose = this.squashMs > 0 ? 'land' : state.vy > 0 ? 'jump' : 'idle';
    const sprite = outlineSprite(spriteFromRows(catPixels(pose), {L: palette.cat.body, E: palette.cat.eye}), OUTLINE);
    // One cat only: clipped to the field, it slides out of one edge entirely before it slides in from the other.
    const shown = clipSprite(sprite, Math.round(catX - sprite.width / 2), left, left + Math.round(WIDTH * scale), state.vx < 0);
    if (shown) buffer.sprite(shown.sprite, shown.x, Math.round(top - sprite.height));
    this.particles.draw(buffer, stops[1]);
    canvas.blit(buffer);
    this.dipMarker(canvas, catX, top - sprite.height, '▼');
    this.popups.draw(canvas, stops[1]);
    topRow(canvas, look, 'Vespyr Leap', `${state.height.toLocaleString('en-US')} m  best ${Math.max(this.startBest, state.height).toLocaleString('en-US')}`, stops[0]);
    if (!state.started) canvas.center(Math.floor(canvas.height / 3), '← → to steer · Space to start', {fg: rgb(0x2a1d52), bold: true});
  }

  /** An arrow at the bottom edge, over the cat's column, while a long fall has carried the whole cat below the view. */
  private dipMarker(canvas: Canvas, catX: number, headY: number, glyph: string): void {
    if (headY < canvas.height * 2 - 2) return;
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round(catX)));
    canvas.put(x, canvas.height - 2, glyph, {fg: rgb(0xfff4d6), bold: true});
  }

  private drawPlatform(buffer: PixelBuffer, platform: Platform, scale: number, left: number): void {
    const y = Math.round(this.screenY(platform.y) + platform.fall);
    if (y < -4 || y > buffer.height + 2) return;
    const x = Math.round(left + this.state.platformX(platform) * scale);
    const width = Math.max(3, Math.round(PLATFORM_W * scale));
    const tone = platform.kind === 'moving' ? MOVING : platform.kind === 'crumble' ? CRUMBLE : SOLID;
    buffer.rect(x + 1, y, width - 2, 1, mixRgb(tone, rgb(0xffffff), 0.35));
    buffer.rect(x, y + 1, width, 1, tone);
    buffer.rect(x + 1, y + 2, width - 2, 1, mixRgb(tone, rgb(0x000000), 0.3));
    if (platform.kind === 'crumble') for (let index = 2; index < width - 2; index += 4) buffer.set(x + index, y + 1, mixRgb(tone, rgb(0x000000), 0.45));
    if (platform.spring) { buffer.rect(x + Math.floor(width / 2) - 1, y - 2, 3, 1, SPRING); buffer.set(x + Math.floor(width / 2), y - 1, mixRgb(SPRING, rgb(0x000000), 0.3)); }
  }

  /** Without color: platforms as runs of = (~ sliding, : crumbling), the cat as @. */
  private drawText(canvas: Canvas, scale: number, left: number): void {
    const state = this.state;
    for (const platform of state.platforms) {
      const row = Math.floor(this.screenY(platform.y) / 2);
      if (row < 1 || row >= canvas.height) continue;
      const glyph = platform.kind === 'moving' ? '~' : platform.kind === 'crumble' ? ':' : '=';
      canvas.text(Math.round(left + state.platformX(platform) * scale), row, (platform.spring ? '^' : glyph) + glyph.repeat(Math.max(1, Math.round(PLATFORM_W * scale) - 1)));
    }
    const x = Math.round(left + state.x * scale);
    if (x >= left && x < left + Math.round(WIDTH * scale)) {
      const row = Math.floor(this.screenY(state.y) / 2) - 1;
      if (row < canvas.height - 1) canvas.put(x, row, '@', {bold: true});
      else canvas.put(x, canvas.height - 2, 'v', {bold: true});
    }
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: '← →', action: 'steer'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

/** The hub preview: Vespyr bouncing up a column of platforms at dusk. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  gradient(buffer, SKIES[0]!, 0, buffer.height);
  const climb = frame * 1.2;
  for (let index = 0; index < 12; index += 1) {
    const y = Math.round(buffer.height - 2 - ((index * 9 - climb) % 108 + 108) % 108);
    const x = 4 + (hash(index) % Math.max(1, canvas.width - 18));
    buffer.rect(x, y, 12, 1, index % 4 === 3 ? MOVING : SOLID);
  }
  const t = (frame % 12) / 12;
  const bounce = Math.round(Math.sin(t * Math.PI) * 10);
  const sprite = spriteFromRows(catPixels(t < 0.5 ? 'jump' : 'idle'), {L: palette.cat.body, E: palette.cat.eye});
  buffer.sprite(outlineSprite(sprite, OUTLINE), Math.floor(canvas.width / 2) - 8, Math.floor(buffer.height * 0.55) - bounce - 1);
  canvas.blit(buffer);
}

export const leapGame: GameDefinition = {
  id: 'leap', aliases: ['vespyr-leap', 'jump'], title: 'Vespyr Leap', tagline: 'Bounce ever upward',
  description: 'Vespyr bounces by himself; you steer him from platform to platform, up through the clouds and into the stars. Some platforms slide, some crumble, springs fling you high.',
  kind: 'action', category: 'runners',
  controls: [{keys: '← →', action: 'steer'}, {keys: 'Space', action: 'start'}],
  howToPlay: [
    'Steer with the arrows (or A D, h l); each press pushes Vespyr sideways, holding keeps him going. Leave one side to come back on the other.',
    'Landing on a platform from above bounces you up. Teal platforms slide; cracked sand ones crumble and give no bounce; a yellow spring flings you higher.',
    'Fall below the screen and the climb is over. Your score is the height you reached.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `Best ${saved.best.toLocaleString('en-US')} m · ${count(record.bounces)} bounces` : 'Not played yet'; },
  preview,
  create: context => new VespyrLeap(context),
};
