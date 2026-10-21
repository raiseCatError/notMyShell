import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import {catPixels} from '../../../idle/catSprite.js';
import type {Key} from '../../../terminal/keys.js';
import {outlineSprite, PixelBuffer, spriteFromRows, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups} from '../../effects.js';
import {count, direction, isConfirm, readScore, saveScore, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {gradient, hash, rgb, skyline, stars} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {clamp, confetti, drawScaled, pixelArt} from '../shared3.js';
import {GRAVITY, GlassState, LAUNCH_Y, SPHERE_SPEED, paneSpan, type GlassEvent, type Pane} from './logic.js';

/**
 * Glass Rush: Smash Hit in a 2D side view. The cat glides right along a mirrored corridor and throws glowing spheres
 * along an arc at the glass in its way. Pane kinds differ in shape and in a marker glyph as well as in color: plain
 * glass `|`, ringing (chain) glass `!`, tough glass `#`, and a hanging canopy `;`.
 */
const SKY = [rgb(0x0f1e3d), rgb(0x2b3f7a), rgb(0x7f6fb8)];
const FLOOR = [rgb(0x23304f), rgb(0x1b2742)];
const SPHERE = rgb(0xfff0a8);
const CRYSTAL = rgb(0x7ff0c4);
const OUTLINE = rgb(0x0d1630);
const GLYPH = {glass: '|', resonant: '!', tough: '#', canopy: ';'} as const;

function glassColor(kind: Pane['kind'], look: ArcadeLook): Rgb {
  return kind === 'resonant' ? look.hue.rose : kind === 'tough' ? look.hue.lilac : kind === 'canopy' ? look.hue.butter : look.hue.sky;
}

interface View { w: number; h: number; gy: number; sx: number; sy: number; catX: number }

class GlassRush implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private state: GlassState;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly startBest: number;
  private dyingMs = 0;
  private celebrated = false;
  private pixels = new PixelBuffer(0, 0);

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new GlassState(context.rng.fork('glass'));
    this.particles = new ParticleSystem(context.rng.fork('glass-fx'), 160, context.motion.reduced ? 'off' : context.motion.effects);
    this.popups = new Popups(5, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.state.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.state.started || this.context.motion.reduced ? 0 : 100; }

  private view(): View {
    const w = this.size.columns, h = this.size.rows * 2;
    const gy = h - Math.max(2, Math.floor(h * 0.12));
    return {w, h, gy, sx: Math.max(0.6, w / 40), sy: Math.max(1, (gy - 5) / 9), catX: Math.max(3, Math.round(w * 0.18))};
  }
  private toX(x: number, v = this.view()): number { return v.catX + (x - this.state.x) * v.sx; }
  private toY(y: number, v = this.view()): number { return v.gy - y * v.sy; }

  step(dtMs: number): void {
    if (this.done) return;
    this.state.step(dtMs);
    for (const event of this.state.events.splice(0)) this.react(event);
    if (!this.state.alive) {
      this.dyingMs -= dtMs;
      if (this.dyingMs <= 0) this.finish();
    } else if (!this.celebrated && this.startBest > 0 && this.state.score > this.startBest) {
      this.celebrated = true;
      this.celebrate();
    }
  }

  private celebrate(): void {
    const look = arcadeLook();
    const v = this.view();
    confetti(this.particles, v.w / 2, v.h / 3, [look.gold, look.hue.mint, look.hue.rose, look.hue.sky]);
    this.popups.add('NEW BEST', Math.floor(v.w / 2), Math.floor(this.size.rows / 3), look.gold, 1400);
  }

  private shards(pane: Pane, colors: readonly Rgb[], amount: number): void {
    const v = this.view();
    const span = paneSpan(pane, this.state.time);
    const x = this.toX(pane.x, v);
    for (let index = 0; index < 3; index += 1) {
      const y = this.toY(span.low + ((index + 0.5) / 3) * pane.height, v);
      this.particles.burst({x, y, count: amount, speed: 38, angle: 0, spread: Math.PI, life: 700, gravity: 110, drag: 0.4, colors});
    }
  }

  private react(event: GlassEvent): void {
    const look = arcadeLook();
    const v = this.view();
    switch (event.kind) {
      case 'break': this.shards(event.pane, [glassColor(event.pane.kind, look), rgb(0xffffff), mixRgb(glassColor(event.pane.kind, look), rgb(0xffffff), 0.5)], 4); break;
      case 'crack': this.shards(event.pane, [rgb(0xffffff)], 1); break;
      case 'chain': this.popups.add(`CHAIN x${event.size}`, Math.round(this.toX(event.x, v)), Math.floor(this.size.rows / 3), look.hue.rose, 1000); break;
      case 'crystal': this.particles.burst({x: this.toX(event.crystal.x, v), y: this.toY(event.crystal.y, v), count: 16, speed: 40, life: 600, gravity: 20, colors: [CRYSTAL, rgb(0xffffff)]}); this.popups.add('+4', Math.round(this.toX(event.crystal.x, v)), Math.floor(this.toY(event.crystal.y, v) / 2) - 2, CRYSTAL, 800); break;
      case 'smash': this.shards(event.pane, [look.bad, rgb(0xffffff)], 5); this.popups.add('-4', v.catX, Math.floor(this.toY(LAUNCH_Y, v) / 2) - 3, look.bad, 800); break;
      case 'milestone': this.popups.add(`${event.meters} m`, Math.floor(v.w / 2), Math.floor(this.size.rows / 3), look.accent, 1100); break;
      case 'dry':
        this.dyingMs = this.context.motion.reduced ? 250 : 700;
        this.popups.add('OUT OF SPHERES', Math.floor(v.w / 2), Math.floor(this.size.rows / 2), look.bad, 1400);
        if (this.state.score > this.startBest && this.state.score > 0) this.celebrate();
        break;
      default: break;
    }
  }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {distance: state.meters, shattered: state.shattered, chain: state.bestChain});
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record: state.score > 0 && state.score > this.startBest,
      details: [`Distance ${state.meters.toLocaleString('en-US')} m`, `Glass shattered ${state.shattered}`, `Longest chain ${state.bestChain}`, `Best ${saved.best.toLocaleString('en-US')}`, `Runs ${saved.plays}`],
    };
  }

  animate(dtMs: number): void { this.particles.update(dtMs); this.popups.update(dtMs); }

  key(key: Key): GameKeyResult {
    if (this.done || !this.state.alive) return 'ignored';
    const turn = direction(key);
    if (turn === 'up') { this.state.tilt(1); return 'handled'; }
    if (turn === 'down') { this.state.tilt(-1); return 'handled'; }
    if (isConfirm(key) || (key.kind === 'text' && key.value.toLowerCase() === 'f')) {
      if (!this.state.started) this.state.started = true; else this.state.fire();
      return 'handled';
    }
    return 'ignored';
  }

  // ---- drawing --------------------------------------------------------------------------------------------------
  /** Where a sphere thrown now would be, every tenth of a second, until it lands or a second passes. */
  private guide(): Array<{x: number; y: number}> {
    const state = this.state;
    const angle = (state.aim * Math.PI) / 180;
    const vx = Math.cos(angle) * SPHERE_SPEED + state.speed, vy = Math.sin(angle) * SPHERE_SPEED;
    const out: Array<{x: number; y: number}> = [];
    for (let t = 0.08; t < 1.2; t += 0.08) {
      const y = LAUNCH_Y + vy * t - 0.5 * GRAVITY * t * t;
      if (y < 0) break;
      out.push({x: state.x + vx * t, y});
    }
    return out;
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const state = this.state;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const art = pixelArt(this.context);
    const v = this.view();
    if (art) this.drawScene(canvas, palette, look, v); else this.drawPlain(canvas, v);
    this.drawMarkers(canvas, look, v, art);
    this.popups.draw(canvas, SKY[1]);
    topRow(canvas, look, 'Glass Rush', `${state.score.toLocaleString('en-US')}  spheres ${state.spheres}  aim ${state.aim}  best ${Math.max(this.startBest, state.score).toLocaleString('en-US')}`);
    if (!state.started) {
      const y = Math.max(1, Math.floor(canvas.height / 4));
      canvas.center(y, 'Glass Rush', {fg: look.text.strong, bold: true});
      canvas.center(y + 1, canvas.width < 44 ? 'Space to start' : '↑ ↓ aim · Space throw · Space to start', {fg: look.accent, bold: true});
      if (canvas.height >= 14) canvas.center(y + 2, canvas.width < 44 ? '| ! # glass  * refill' : '| glass   ! ringing   # tough   * crystal refill', {fg: look.text.normal});
    }
  }

  private drawScene(canvas: Canvas, palette: ArcadePalette, look: ArcadeLook, v: View): void {
    if (this.pixels.width !== v.w || this.pixels.height !== v.h) this.pixels = new PixelBuffer(v.w, v.h);
    const buffer = this.pixels;
    buffer.clear();
    const state = this.state;
    gradient(buffer, SKY, 0, v.gy);
    stars(buffer, 3, v.gy, rgb(0xffffff), SKY[0]!, {strength: 0.7, scroll: 0, density: 50});
    skyline(buffer, {base: v.gy, scroll: Math.floor(state.x * v.sx * 0.35), seed: 11, color: rgb(0x1a2a55), window: rgb(0xaad8ff), low: 3, high: Math.max(5, Math.floor(v.gy * 0.5)), lit: 0.3});
    for (let y = v.gy; y < v.h; y += 1) buffer.rect(0, y, v.w, 1, FLOOR[(y - v.gy) & 1]!);
    for (let x = 0; x < v.w; x += 1) buffer.set(x, v.gy, ((Math.floor(state.x * v.sx) + x) >> 2) & 1 ? rgb(0x6f86c0) : rgb(0x4d6199));
    // Crystals: faceted diamonds, with a marker glyph drawn over them.
    for (const c of state.crystals) {
      const cx = Math.round(this.toX(c.x, v)), cy = Math.round(this.toY(c.y, v)), r = Math.max(2, Math.round(0.7 * v.sy));
      if (cx < -r || cx > v.w + r) continue;
      for (let d = -r; d <= r; d += 1) buffer.rect(cx - (r - Math.abs(d)), cy + d, (r - Math.abs(d)) * 2 + 1, 1, d < 0 ? mixRgb(CRYSTAL, rgb(0xffffff), 0.4) : CRYSTAL);
    }
    for (const pane of state.panes) this.drawPane(buffer, pane, look, v);
    // The aiming guide, then spheres with a short streak.
    if (state.alive) this.guide().forEach((p, index) => { if (index % 2 === 0) buffer.set(this.toX(p.x, v), this.toY(p.y, v), mixRgb(SPHERE, rgb(0), 0.35)); });
    for (const s of state.flying) {
      const x = Math.round(this.toX(s.x, v)), y = Math.round(this.toY(s.y, v));
      buffer.line(x, y, Math.round(x - s.vx * 0.012 * v.sx), Math.round(y + s.vy * 0.012 * v.sy), mixRgb(SPHERE, SKY[1]!, 0.5));
      buffer.ellipse(x - 1, y - 1, 3, 3, SPHERE);
    }
    const sprite = outlineSprite(spriteFromRows(catPixels(state.alive ? ((Math.floor(state.time * 5) & 1) ? 'walkA' : 'walkB') : 'land'), {L: palette.cat.body, E: palette.cat.eye}), OUTLINE);
    const h = Math.max(6, Math.round(1.1 * v.sy));
    drawScaled(buffer, sprite, v.catX - h * 0.8, v.gy - h, h * 1.6, h, false);
    this.particles.draw(buffer, SKY[1]);
    canvas.blit(buffer);
  }

  private drawPane(buffer: PixelBuffer, pane: Pane, look: ArcadeLook, v: View): void {
    if (pane.broken) return;
    const span = paneSpan(pane, this.state.time);
    const x = Math.round(this.toX(pane.x, v));
    if (x < -3 || x > v.w + 3) return;
    const low = Math.round(this.toY(Math.max(0, span.low), v)), high = Math.round(this.toY(span.high, v));
    const color = glassColor(pane.kind, look);
    const width = pane.kind === 'tough' ? 3 : 2;
    for (let y = high; y < low; y += 1) {
      for (let dx = 0; dx < width; dx += 1) {
        const behind = buffer.get(x + dx, y) ?? SKY[1]!;
        const glint = pane.kind === 'resonant' && ((y + dx * 2) % 6 === 0);
        buffer.set(x + dx, y, mixRgb(behind, glint ? rgb(0xffffff) : color, glint ? 0.8 : dx === 0 ? 0.6 : 0.35));
      }
    }
    buffer.rect(x - 1, high, width + 2, 1, mixRgb(color, rgb(0xffffff), 0.5));
    if (pane.kind === 'tough' && pane.hp < 2) buffer.line(x, high + 2, x + 2, Math.round((high + low) / 2), rgb(0xffffff));
    if (pane.kind === 'canopy') for (let y = high; y > 0 && y > high - 3; y -= 1) buffer.set(x, y, color);
  }

  private drawPlain(canvas: Canvas, v: View): void {
    const state = this.state;
    const row = (y: number): number => Math.floor(this.toY(y, v) / 2);
    canvas.hline(0, Math.floor(v.gy / 2), canvas.width, '_', {dim: true});
    for (const c of state.crystals) canvas.put(Math.round(this.toX(c.x, v)), row(c.y), '*', {bold: true});
    for (const pane of state.panes) {
      if (pane.broken) continue;
      const span = paneSpan(pane, state.time);
      const x = Math.round(this.toX(pane.x, v));
      const top = row(span.high), bottom = Math.min(row(Math.max(0, span.low)), Math.floor(v.gy / 2) - 1);
      for (let r = top; r <= bottom; r += 1) canvas.put(x, r, pane.kind === 'tough' && pane.hp < 2 ? 'x' : GLYPH[pane.kind], {bold: pane.kind !== 'canopy'});
    }
    if (state.alive) this.guide().forEach((p, index) => { if (index % 2 === 0) canvas.put(Math.round(this.toX(p.x, v)), row(p.y), '.', {dim: true}); });
    for (const s of state.flying) canvas.put(Math.round(this.toX(s.x, v)), row(s.y), 'o', {bold: true});
    canvas.text(v.catX - 1, Math.floor(v.gy / 2) - 1, state.alive ? '=^>' : '=x>', {bold: true});
    this.particles.particles.forEach(p => { if (p.life > p.maxLife * 0.4) canvas.put(Math.round(p.x), Math.floor(p.y / 2), ',', {dim: true}); });
  }

  /** Marker glyphs over panes and crystals in the pixel view, so kinds never rest on color alone. */
  private drawMarkers(canvas: Canvas, look: ArcadeLook, v: View, art: boolean): void {
    if (!art) return;
    for (const pane of this.state.panes) {
      if (pane.broken || pane.kind === 'glass') continue;
      const span = paneSpan(pane, this.state.time);
      const x = Math.round(this.toX(pane.x, v)) + 3;
      const row = Math.max(1, Math.floor(this.toY(span.high, v) / 2) - 1);
      canvas.put(x, row, GLYPH[pane.kind], {fg: glassColor(pane.kind, look), bold: true});
    }
    for (const c of this.state.crystals) canvas.put(Math.round(this.toX(c.x, v)), Math.max(1, Math.floor(this.toY(c.y, v) / 2) - 2), '*', {fg: CRYSTAL, bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void { /* the session stops stepping; nothing else to hold */ }
  hints(): readonly ControlHint[] { return [{keys: '↑ ↓', action: 'aim'}, {keys: 'Space', action: 'throw'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  gradient(buffer, SKY, 0, buffer.height);
  const gy = buffer.height - 3;
  buffer.rect(0, gy, buffer.width, 3, FLOOR[0]!);
  const t = (frame % 24) / 24;
  const px = Math.round(buffer.width * 0.7);
  if (t < 0.55) buffer.rect(px, 3, 2, gy - 3, mixRgb(SKY[1]!, look.hue.sky, 0.6));
  else for (let index = 0; index < 18; index += 1) buffer.set(px + (hash(index) % 12) * (t - 0.5) * 3, gy - 2 - (hash(index + 9) % (gy - 4)) + (t - 0.55) * 20 * (hash(index + 4) % 3), look.hue.sky);
  const bx = Math.round(buffer.width * 0.2 + t * buffer.width * 0.5);
  buffer.ellipse(bx, Math.round(gy - 6 - Math.sin(t * Math.PI) * 5), 3, 3, SPHERE);
  const sprite = outlineSprite(spriteFromRows(catPixels('idle'), {L: palette.cat.body, E: palette.cat.eye}), OUTLINE);
  drawScaled(buffer, sprite, Math.round(buffer.width * 0.1), gy - 9, 14, 9, false);
  canvas.blit(buffer);
}

export const glassGame: GameDefinition = {
  id: 'glass', aliases: ['glass-rush', 'smash'], title: 'Glass Rush', tagline: 'Throw spheres, shatter the way',
  description: 'Glide down a glass corridor and smash every pane before it reaches you. Spheres arc under gravity and are limited: shatter chains, hit crystals to refill, and keep the rush alive.',
  kind: 'action', category: 'reflex',
  controls: [{keys: '↑ ↓', action: 'aim'}, {keys: 'Space', action: 'throw'}],
  howToPlay: [
    'Aim with Up and Down (W S, k j): the dotted arc shows where a sphere will go. Space or F throws one; there is a short pause between throws.',
    'Glass that reaches you costs 4 spheres. Ringing glass ! shatters the panes near it too (chains score big), tough glass # needs two hits, bobbing panes need good timing, and a hit on a * crystal gives 4 spheres back.',
    'With no spheres left the rush ends. Score is distance plus 5 per pane plus chain bonuses.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `Best ${saved.best.toLocaleString('en-US')} · ${count(record.shattered)} panes` : 'Not played yet'; },
  preview,
  create: context => new GlassRush(context),
};
