import {mixRgb} from '../../../chroma/chroma.js';
import {catPixels} from '../../../idle/catSprite.js';
import type {Key} from '../../../terminal/keys.js';
import {outlineSprite, PixelBuffer, spriteFromRows, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups} from '../../effects.js';
import {count, direction, isConfirm, isSpace, readScore, saveScore, topRow} from '../../kit.js';
import {arcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {gradient, hash, rgb, skyline, stars} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {clamp, confetti, drawScaled, pixelArt} from '../shared3.js';
import {AlleyState, type AlleyEvent, type Row} from './logic.js';

/**
 * Alley Sprint: a three-lane runner seen from behind, down a moonlit alley. Crates are jumped, overhead beams slid
 * under, brick walls dodged by changing lane. Shapes differ as much as colors do: a low box, a beam on two posts, a
 * tall striped wall; without color they become `[_]`, `~~~` and `###`.
 */
const SKY = [rgb(0x1b1442), rgb(0x4a2f7a), rgb(0xd68aa8)];
const ROAD = [rgb(0x34304a), rgb(0x2b2840)];
const WALL = [rgb(0x4b3a5e), rgb(0x3f3052)];
const CRATE = rgb(0xc98f55);
const BRICK = rgb(0xb5524a);
const BEAM = rgb(0x8fb4d8);
const COIN = rgb(0xffd45e);
const OUTLINE = rgb(0x1a1230);
const SIDE = 0.27;

class AlleySprint implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private state: AlleyState;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly startBest: number;
  private visualLane = 1;
  private runPhase = 0;
  private dyingMs = 0;
  private celebrated = false;
  private pixels = new PixelBuffer(0, 0);

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new AlleyState(context.rng.fork('alley'));
    this.particles = new ParticleSystem(context.rng.fork('alley-fx'), 120, context.motion.reduced ? 'off' : context.motion.effects);
    this.popups = new Popups(4, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.state.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.state.started || this.context.motion.reduced ? 0 : 100; }

  // ---- projection -----------------------------------------------------------------------------------------------
  private geometry(): {w: number; h: number; hy: number; gb: number; lane: number} {
    const w = this.size.columns, h = this.size.rows * 2;
    const hy = 4 + Math.floor((h - 4) * 0.3);
    return {w, h, hy, gb: h - 1, lane: w * SIDE};
  }
  /** Depth `d` metres ahead to a scale: 1 at the cat, shrinking toward the horizon. */
  private scale(d: number): number { return clamp(1 / (1 + Math.max(d, -3) / 9), 0, 1.3); }

  // ---- simulation -----------------------------------------------------------------------------------------------
  step(dtMs: number): void {
    if (this.done) return;
    const state = this.state;
    state.step(dtMs);
    this.runPhase += dtMs * state.speed / 1000;
    for (const event of state.events.splice(0)) this.react(event);
    if (!state.alive) {
      this.dyingMs -= dtMs;
      if (this.dyingMs <= 0) this.finish();
    } else if (!this.celebrated && this.startBest > 0 && state.score > this.startBest) {
      this.celebrated = true;
      this.celebrate();
    }
  }

  private catPoint(): {x: number; y: number} {
    const g = this.geometry();
    return {x: g.w / 2 + (this.visualLane - 1) * g.lane, y: g.gb - 2 - this.state.y * g.lane * 0.55};
  }

  private celebrate(): void {
    const at = this.catPoint();
    const look = arcadeLook();
    confetti(this.particles, at.x, at.y - 6, [look.gold, look.hue.mint, look.hue.rose, look.hue.sky]);
    this.popups.add('NEW BEST', Math.floor(this.size.columns / 2), Math.floor(this.size.rows / 3), look.gold, 1400);
  }

  private react(event: AlleyEvent): void {
    const at = this.catPoint();
    const look = arcadeLook();
    switch (event.kind) {
      case 'jump': this.particles.burst({x: at.x, y: at.y, count: 5, speed: 22, angle: Math.PI / 2, spread: 0.9, life: 300, gravity: 40, colors: [rgb(0xd9c9f0), rgb(0x8c7bb0)]}); break;
      case 'land': this.particles.burst({x: at.x, y: at.y, count: 5, speed: 24, angle: Math.PI, spread: 0.5, life: 260, gravity: 30, colors: [rgb(0xd9c9f0)]}); break;
      case 'coin': this.particles.burst({x: at.x, y: at.y - 4, count: 6, speed: 26, life: 360, gravity: 60, colors: [COIN, rgb(0xfff2b0)]}); this.popups.add('+10', Math.round(at.x), Math.floor(at.y / 2) - 3, COIN, 500); break;
      case 'milestone': this.popups.add(`${event.meters} m`, Math.floor(this.size.columns / 2), Math.floor(this.size.rows / 3), look.accent, 1100); break;
      case 'crash':
        this.dyingMs = this.context.motion.reduced ? 250 : 700;
        this.particles.burst({x: at.x, y: at.y - 4, count: 30, speed: 55, life: 600, gravity: 90, drag: 0.5, colors: [BRICK, CRATE, rgb(0xffffff), look.bad]});
        if (this.state.score > this.startBest && this.state.score > 0) this.celebrate();
        break;
      default: break;
    }
  }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {distance: state.meters, coins: state.coins});
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record: state.score > 0 && state.score > this.startBest,
      details: [`Distance ${state.meters.toLocaleString('en-US')} m`, `Coins ${state.coins}`, `Best ${saved.best.toLocaleString('en-US')}`, `Runs ${saved.plays}`],
    };
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    const target = this.state.lane;
    this.visualLane = this.context.motion.reduced ? target : this.visualLane + (target - this.visualLane) * Math.min(1, dtMs / 70);
    if (Math.abs(this.visualLane - target) < 0.02) this.visualLane = target;
  }

  key(key: Key): GameKeyResult {
    if (this.done || !this.state.alive) return 'ignored';
    const turn = direction(key);
    if (turn === 'left' || turn === 'right') { this.state.moveLane(turn === 'left' ? -1 : 1); return 'handled'; }
    if (turn === 'down') { this.state.slide(); return 'handled'; }
    if (turn === 'up') { this.state.jump(); return 'handled'; }
    if (isConfirm(key)) {
      if (!this.state.started) this.state.started = true;
      else if (isSpace(key)) this.state.jump();
      return 'handled';
    }
    return 'ignored';
  }

  // ---- drawing --------------------------------------------------------------------------------------------------
  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const state = this.state;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    if (pixelArt(this.context)) this.drawPixels(canvas, palette);
    else this.drawText(canvas);
    this.popups.draw(canvas, SKY[1]);
    const best = Math.max(this.startBest, state.score);
    topRow(canvas, look, 'Alley Sprint', `${state.score.toLocaleString('en-US')}  ${Math.round(state.speed)} m/s  best ${best.toLocaleString('en-US')}`);
    if (!state.started) {
      const y = Math.max(1, Math.floor(canvas.height / 3));
      canvas.center(y, 'Alley Sprint', {fg: look.text.strong, bold: true});
      canvas.center(y + 1, canvas.width < 44 ? 'Space to start' : '← → lanes · ↑ jump · ↓ slide · Space to start', {fg: look.accent, bold: true});
      if (canvas.height >= 14) canvas.center(y + 2, canvas.width < 44 ? '[_] jump ~~~ slide' : '[_] jump   ~~~ slide   ### change lane', {fg: look.text.normal});
    }
  }

  private drawPixels(canvas: Canvas, palette: ArcadePalette): void {
    const g = this.geometry();
    if (this.pixels.width !== g.w || this.pixels.height !== g.h) this.pixels = new PixelBuffer(g.w, g.h);
    const buffer = this.pixels;
    buffer.clear();
    const z = this.state.z;
    gradient(buffer, SKY, 0, g.hy + 1);
    stars(buffer, 9, g.hy, rgb(0xffffff), SKY[0]!, {strength: 0.8, scroll: 0, density: 60});
    skyline(buffer, {base: g.hy + 1, scroll: Math.floor(z * 0.5), seed: 5, color: rgb(0x26194a), window: rgb(0xffd98a), low: 3, high: Math.max(5, Math.floor(g.hy * 0.7)), lit: 0.35});
    // The road and the alley walls, one pixel row at a time.
    for (let y = g.hy + 1; y < g.h; y += 1) {
      const s = (y - g.hy) / (g.gb - g.hy - 2);
      const depth = 9 * (1 / Math.max(s, 0.02) - 1);
      const band = Math.floor((z + depth) / 6) & 1;
      const half = 1.5 * g.lane * s;
      const left = Math.round(g.w / 2 - half), right = Math.round(g.w / 2 + half);
      buffer.rect(0, y, Math.max(0, left), 1, WALL[band]!);
      buffer.rect(right, y, Math.max(0, g.w - right), 1, WALL[band]!);
      buffer.rect(left, y, Math.max(0, right - left), 1, ROAD[band]!);
      if (left > 0) buffer.set(left, y, mixRgb(WALL[band]!, rgb(0xffffff), 0.3));
      if (right < g.w) buffer.set(right - 1, y, mixRgb(WALL[band]!, rgb(0xffffff), 0.3));
      if (band === 0) for (const edge of [-0.5, 0.5]) buffer.set(Math.round(g.w / 2 + edge * g.lane * s), y, rgb(0x7a7298));
    }
    const state = this.state;
    for (let index = state.pickups.length - 1; index >= 0; index -= 1) {
      const coin = state.pickups[index]!;
      if (coin.taken || coin.z - z < -1.5 || coin.z - z > 100) continue;
      const s = this.scale(coin.z - z), u = g.lane * s;
      const cx = g.w / 2 + (coin.lane - 1) * u, cy = g.hy + (g.gb - 2 - g.hy) * s - 0.3 * u;
      const r = Math.max(2, Math.round(u * 0.22));
      buffer.ellipse(Math.round(cx - r / 2), Math.round(cy - r), r, r * 2 > 3 ? r : 2, COIN);
      buffer.set(Math.round(cx - r / 2), Math.round(cy - r), rgb(0xfff6c8));
    }
    for (let index = state.rows.length - 1; index >= 0; index -= 1) {
      const row = state.rows[index]!;
      if (row.z + row.len - z < -1.5 || row.z - z > 110) continue;
      this.drawRow(buffer, row, z, g);
    }
    this.drawCat(buffer, palette, g);
    this.particles.draw(buffer, SKY[1]);
    canvas.blit(buffer);
  }

  private drawRow(buffer: PixelBuffer, row: Row, z: number, g: {w: number; hy: number; gb: number; lane: number}): void {
    const s = this.scale(row.z - z), u = g.lane * s;
    const gy = Math.round(g.hy + (g.gb - 2 - g.hy) * s);
    row.cells.forEach((cell, lane) => {
      if (!cell) return;
      const cx = Math.round(g.w / 2 + (lane - 1) * u);
      if (cell === 'low') {
        const w = Math.max(3, Math.round(u * 0.62)), h = Math.max(2, Math.round(u * 0.38));
        buffer.rect(cx - w / 2, gy - h, w, h, CRATE);
        buffer.rect(cx - w / 2, gy - h, w, 1, mixRgb(CRATE, rgb(0xffffff), 0.4));
        buffer.rect(cx - w / 2, gy - 1, w, 1, mixRgb(CRATE, rgb(0), 0.4));
        if (h >= 4) buffer.rect(cx - Math.floor(w / 2) + Math.floor(w / 2), gy - h, 1, h, mixRgb(CRATE, rgb(0), 0.35));
      } else if (cell === 'wall') {
        const w = Math.max(3, Math.round(u * 0.86)), h = Math.max(3, Math.round(u * 1.0));
        buffer.rect(cx - w / 2, gy - h, w, h, BRICK);
        for (let y = gy - h + 2; y < gy; y += 3) buffer.rect(cx - w / 2, y, w, 1, mixRgb(BRICK, rgb(0), 0.4));
        for (let x = cx - Math.floor(w / 2); x < cx - Math.floor(w / 2) + w; x += 2) buffer.rect(x, gy - h, 1, Math.min(2, h), (x >> 1) & 1 ? rgb(0xfff0d0) : rgb(0x30203a));
      } else {
        const w = Math.max(4, Math.round(u * 0.9)), post = Math.max(1, Math.round(u * 0.08));
        const top = gy - Math.round(u * 0.78), bottom = gy - Math.round(u * 0.42);
        buffer.rect(cx - w / 2, top, post, gy - top, rgb(0x6c86a8));
        buffer.rect(cx + Math.floor(w / 2) - post, top, post, gy - top, rgb(0x6c86a8));
        buffer.rect(cx - w / 2, top, w, Math.max(2, bottom - top), BEAM);
        buffer.rect(cx - w / 2, top, w, 1, mixRgb(BEAM, rgb(0xffffff), 0.5));
        for (let x = cx - Math.floor(w / 2); x < cx - Math.floor(w / 2) + w; x += 3) buffer.set(x, bottom - 1, rgb(0x2a3a58));
      }
    });
  }

  private drawCat(buffer: PixelBuffer, palette: ArcadePalette, g: {w: number; lane: number}): void {
    const state = this.state;
    const sliding = state.sliding;
    const pose = !state.alive ? 'land' : sliding ? 'crouch' : !state.grounded ? 'jump' : (Math.floor(this.runPhase * 0.6) & 1) ? 'walkA' : 'walkB';
    const sprite = outlineSprite(spriteFromRows(catPixels(pose), {L: palette.cat.body, E: palette.cat.eye}), OUTLINE);
    const at = this.catPoint();
    const h = Math.max(5, Math.round(g.lane * (sliding ? 0.3 : 0.5)));
    const w = Math.round(h * (sprite.width / sprite.height) * (sliding ? 1.0 : 1.0));
    if (state.alive) buffer.ellipse(Math.round(at.x - w / 3), Math.round(this.geometry().gb - 2), Math.round(w * 0.66), 1, rgb(0x16102a));
    drawScaled(buffer, sprite, at.x - w / 2, at.y - h, w, h, true);
  }

  /** Without color: the same road in characters, with a distinct glyph for each kind of obstacle. */
  private drawText(canvas: Canvas): void {
    const g = this.geometry();
    const state = this.state;
    const z = state.z;
    const rowOf = (s: number): number => Math.floor((g.hy + (g.gb - 2 - g.hy) * s) / 2);
    const firstRow = Math.floor(g.hy / 2) + 1;
    for (let r = firstRow; r < canvas.height; r += 1) {
      const s = (r * 2 + 1 - g.hy) / (g.gb - g.hy - 2);
      const edge = (k: number): number => Math.round(g.w / 2 + k * g.lane * s);
      canvas.put(edge(-1.5) - 1, r, '/', {dim: true});
      canvas.put(edge(1.5), r, '\\', {dim: true});
      if (((r + Math.floor(z / 3)) & 1) === 0) { canvas.put(edge(-0.5), r, ':', {dim: true}); canvas.put(edge(0.5), r, ':', {dim: true}); }
    }
    for (let index = state.pickups.length - 1; index >= 0; index -= 1) {
      const coin = state.pickups[index]!;
      if (coin.taken || coin.z - z < -1 || coin.z - z > 90) continue;
      const s = this.scale(coin.z - z);
      canvas.put(Math.round(g.w / 2 + (coin.lane - 1) * g.lane * s), rowOf(s) - 1, 'o', {bold: true});
    }
    for (let index = state.rows.length - 1; index >= 0; index -= 1) {
      const row = state.rows[index]!;
      if (row.z + row.len - z < -1.5 || row.z - z > 110) continue;
      const s = this.scale(row.z - z), u = g.lane * s, r = rowOf(s);
      row.cells.forEach((cell, lane) => {
        if (!cell) return;
        const cw = Math.max(1, Math.min(7, Math.round(u * 0.7)));
        const text = cell === 'low' ? (cw >= 3 ? `[${'_'.repeat(cw - 2)}]` : 'n') : cell === 'high' ? (cw >= 3 ? `~${'='.repeat(cw - 2)}~` : '~') : '#'.repeat(cw);
        const x = Math.round(g.w / 2 + (lane - 1) * u - text.length / 2);
        canvas.text(x, r - 1, text, {bold: true});
        if (cell === 'wall') canvas.text(x, r - 2, text, {bold: true});
      });
    }
    const at = this.catPoint();
    const glyph = !state.alive ? 'X' : state.sliding ? '_@_' : '@';
    canvas.text(Math.round(at.x - glyph.length / 2), Math.floor(at.y / 2) - 1, glyph, {bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void { /* the session stops stepping; nothing else to hold */ }
  hints(): readonly ControlHint[] { return [{keys: '← →', action: 'lane'}, {keys: '↑ Space', action: 'jump'}, {keys: '↓', action: 'slide'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  const hy = Math.floor(buffer.height * 0.35);
  gradient(buffer, SKY, 0, hy + 1);
  for (let y = hy + 1; y < buffer.height; y += 1) {
    const s = (y - hy) / (buffer.height - hy);
    const half = Math.round(buffer.width * 0.4 * s);
    const band = Math.floor(((buffer.height - y) + frame * 2) / 4) & 1;
    buffer.rect(0, y, buffer.width, 1, WALL[band]!);
    buffer.rect(Math.round(buffer.width / 2) - half, y, half * 2, 1, ROAD[band]!);
  }
  const t = (frame % 16) / 16;
  const s = 0.2 + t * 0.8;
  const cx = Math.round(buffer.width / 2 + (hash(Math.floor(frame / 16)) % 3 - 1) * buffer.width * 0.2 * s);
  const gy = Math.round(hy + (buffer.height - 2 - hy) * s);
  buffer.rect(cx - Math.round(4 * s + 1), gy - Math.round(5 * s + 1), Math.round(8 * s + 2), Math.round(5 * s + 1), CRATE);
  const sprite = outlineSprite(spriteFromRows(catPixels((frame & 1) ? 'walkA' : 'walkB'), {L: palette.cat.body, E: palette.cat.eye}), OUTLINE);
  drawScaled(buffer, sprite, buffer.width / 2 - 8, buffer.height - 13, 16, 10, true);
  canvas.blit(buffer);
}

export const alleyGame: GameDefinition = {
  id: 'alley', aliases: ['alley-sprint', 'lanes'], title: 'Alley Sprint', tagline: 'Three lanes, no brakes',
  description: 'Run down a moonlit alley: change lanes, jump crates, slide under beams and dodge brick walls while the pace keeps climbing.',
  kind: 'action', category: 'runners',
  controls: [{keys: '← →', action: 'change lane'}, {keys: '↑ / Space', action: 'jump'}, {keys: '↓', action: 'slide'}],
  howToPlay: [
    'Move between three lanes with the arrows (or A D, h l). Up, W or Space jumps; Down or S slides, and pressed in the air it drops you fast.',
    'Jump boxes [_]. Slide under beams ~~~. A tall wall ### cannot be crossed: change lane. Every row leaves a way through.',
    'The alley gets faster the longer you last. Coins are worth 10; your score is metres plus coins.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `Best ${saved.best.toLocaleString('en-US')} · ${count(record.distance)} m` : 'Not played yet'; },
  preview,
  create: context => new AlleySprint(context),
};
