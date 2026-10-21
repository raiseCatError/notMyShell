import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups} from '../../effects.js';
import {count as safeCount, direction, isConfirm, readScore, saveScore, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {gradient, hash, rgb} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {clamp, confetti, pixelArt} from '../shared3.js';
import {cellText, compact, crowdLayout, MAX_DRAWN, ParadeState, ROW_LENGTH, type Cell, type ParadeEvent, type Row} from './logic.js';

/**
 * Kitten Parade: a crowd of tiny kittens runs up the road through number gates. Each gate shows its sum in text as well
 * as in color (+ mint, × sky, − coral, ÷ butter, saw rose), so no gate is told apart by color alone. At most MAX_DRAWN
 * kittens are ever drawn; the number above the crowd is the real count.
 */
const SKY = [rgb(0x2a2160), rgb(0x6a4fa6), rgb(0xe4a0c0)];
const ROAD = [rgb(0x3b3556), rgb(0x332e4d)];
const GRASS = [rgb(0x2f5a52), rgb(0x2a4f4a)];
const OUTLINE = rgb(0x1a1230);

function gateColor(cell: Cell, look: ArcadeLook): Rgb {
  if (!cell) return look.surface.sunken;
  if (cell.kind === 'saw') return look.hue.rose;
  return cell.op === '+' ? look.hue.mint : cell.op === '×' ? look.hue.sky : cell.op === '-' ? look.hue.coral : look.hue.butter;
}

class KittenParade implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private state: ParadeState;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly startBest: number;
  private visualLane = 1;
  private dyingMs = 0;
  private bump = 0;
  private celebrated = false;
  private pixels = new PixelBuffer(0, 0);

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new ParadeState(context.rng.fork('parade'));
    this.particles = new ParticleSystem(context.rng.fork('parade-fx'), 120, context.motion.reduced ? 'off' : context.motion.effects);
    this.popups = new Popups(5, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.state.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.state.started || this.context.motion.reduced ? 0 : 100; }

  private geometry(): {w: number; h: number; lane: number; playerY: number; ppm: number; left: number} {
    const w = this.size.columns, h = this.size.rows * 2;
    const lane = clamp(Math.floor(w * 0.24), 5, 30);
    const playerY = Math.floor(h * 0.8);
    return {w, h, lane, playerY, ppm: (playerY - 5) / 26, left: Math.floor(w / 2 - lane * 1.5)};
  }
  private laneX(lane: number): number { const g = this.geometry(); return g.left + g.lane * (lane + 0.5); }

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
    const g = this.geometry();
    confetti(this.particles, g.w / 2, g.playerY - 8, [look.gold, look.hue.mint, look.hue.rose, look.hue.sky]);
    this.popups.add('NEW BEST', Math.floor(g.w / 2), Math.floor(this.size.rows / 3), look.gold, 1400);
  }

  private react(event: ParadeEvent): void {
    const look = arcadeLook();
    const g = this.geometry();
    const x = this.laneX(this.state.lane), y = g.playerY - 4;
    if (event.kind === 'gate') {
      const good = event.after >= event.before;
      const color = gateColor({kind: 'gate', op: event.op, n: 1}, look);
      this.particles.burst({x, y, count: good ? 14 : 8, speed: 36, life: 420, gravity: good ? -10 : 50, colors: [color, rgb(0xffffff)]});
      const delta = event.after - event.before;
      this.popups.add(`${delta >= 0 ? '+' : '-'}${compact(Math.abs(delta))}`, Math.round(x), Math.floor(y / 2) - 4, color, 700);
    } else if (event.kind === 'saw') {
      this.particles.burst({x, y, count: 18, speed: 50, life: 500, gravity: 80, colors: [look.hue.rose, rgb(0xffffff), rgb(0xffd0d0)]});
      this.bump = this.context.motion.reduced ? 0 : 200;
      this.popups.add(`-${event.before - event.after}`, Math.round(x), Math.floor(y / 2) - 4, look.hue.rose, 700);
    } else if (event.kind === 'milestone') {
      this.popups.add(`${event.meters} m`, Math.floor(g.w / 2), Math.floor(this.size.rows / 3), look.accent, 1100);
    } else if (event.kind === 'dead') {
      this.dyingMs = this.context.motion.reduced ? 250 : 700;
      this.particles.burst({x, y, count: 30, speed: 55, life: 600, gravity: 70, colors: [look.bad, rgb(0xffffff), look.hue.peach]});
      if (this.state.score > this.startBest && this.state.score > 0) this.celebrate();
    }
  }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {distance: state.meters, crowd: state.peak});
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record: state.score > 0 && state.score > this.startBest,
      details: [`Distance ${state.meters.toLocaleString('en-US')} m`, `Biggest crowd ${state.peak.toLocaleString('en-US')}`, `Best ${saved.best.toLocaleString('en-US')}`, `Parades ${saved.plays}`],
    };
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.bump = Math.max(0, this.bump - dtMs);
    const target = this.state.lane;
    this.visualLane = this.context.motion.reduced ? target : this.visualLane + (target - this.visualLane) * Math.min(1, dtMs / 80);
    if (Math.abs(this.visualLane - target) < 0.02) this.visualLane = target;
  }

  key(key: Key): GameKeyResult {
    if (this.done || !this.state.alive) return 'ignored';
    const turn = direction(key);
    if (turn === 'left' || turn === 'right') { this.state.moveLane(turn === 'left' ? -1 : 1); return 'handled'; }
    if (isConfirm(key) || turn === 'up') { this.state.started = true; return 'handled'; }
    return 'ignored';
  }

  // ---- drawing --------------------------------------------------------------------------------------------------
  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const state = this.state;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const g = this.geometry();
    const art = pixelArt(this.context);
    if (art) this.drawScene(canvas, look, g);
    else this.drawPlain(canvas, g);
    this.drawLabels(canvas, look, g, art);
    this.drawCrowd(canvas, look, g, art);
    this.popups.draw(canvas, SKY[1]);
    topRow(canvas, look, 'Kitten Parade', `${compact(state.count)} kittens  ${state.meters} m  best ${Math.max(this.startBest, state.score).toLocaleString('en-US')}`);
    if (!state.started) {
      const y = Math.max(1, Math.floor(canvas.height / 4));
      canvas.center(y, 'Kitten Parade', {fg: look.text.strong, bold: true});
      canvas.center(y + 1, canvas.width < 40 ? 'Space to start' : '← → pick a gate · Space to start', {fg: look.accent, bold: true});
      if (canvas.height >= 14) canvas.center(y + 2, canvas.width < 44 ? '+ x good  - / SAW bad' : '+n ×n grow the crowd · −n ÷n SAW shrink it', {fg: look.text.normal});
    }
  }

  private rowBox(row: Row, g: {playerY: number; ppm: number}): {top: number; bottom: number} {
    const bottom = g.playerY - (row.z - this.state.z) * g.ppm;
    return {top: bottom - Math.max(3, ROW_LENGTH * g.ppm), bottom};
  }

  private drawScene(canvas: Canvas, look: ArcadeLook, g: {w: number; h: number; lane: number; playerY: number; ppm: number; left: number}): void {
    if (this.pixels.width !== g.w || this.pixels.height !== g.h) this.pixels = new PixelBuffer(g.w, g.h);
    const buffer = this.pixels;
    buffer.clear();
    const z = this.state.z;
    gradient(buffer, SKY, 0, g.h);
    for (let y = 0; y < g.h; y += 1) {
      const world = z + (g.playerY - y) / g.ppm;
      const band = Math.floor(world / 5) & 1;
      buffer.rect(0, y, g.w, 1, GRASS[band]!);
      buffer.rect(g.left, y, g.lane * 3, 1, ROAD[band]!);
      buffer.set(g.left, y, rgb(0xc9bfe6));
      buffer.set(g.left + g.lane * 3 - 1, y, rgb(0xc9bfe6));
      if (band === 0) for (let k = 1; k < 3; k += 1) buffer.set(g.left + g.lane * k, y, rgb(0x7a7298));
    }
    // Trees at the verges give the scroll something to read against.
    for (let index = 0; index < 14; index += 1) {
      const wz = Math.floor(z / 9) - 4 + index;
      const y = Math.round(g.playerY - (wz * 9 - z) * g.ppm);
      const side = hash(wz) & 1 ? 1 : -1;
      const x = side < 0 ? g.left - 3 - (hash(wz + 7) % 3) : g.left + g.lane * 3 + 3 + (hash(wz + 7) % 3);
      if (x < 2 || x > g.w - 3) continue;
      buffer.rect(x - 1, y - 2, 3, 3, rgb(0x1f6b57));
      buffer.set(x, y + 1, rgb(0x5a3a2a));
    }
    for (const row of this.state.rows) {
      const box = this.rowBox(row, g);
      if (box.bottom < 0 || box.top > g.h) continue;
      row.cells.forEach((cell, lane) => {
        if (!cell) return;
        const x = g.left + lane * g.lane + 1, w = g.lane - 2;
        const y = Math.round(box.top), h = Math.max(2, Math.round(box.bottom - box.top));
        const color = gateColor(cell, look);
        const dim = row.applied ? 0.55 : 0;
        buffer.rect(x, y, w, h, mixRgb(color, rgb(0x141020), 0.35 + dim * 0.6));
        buffer.rect(x, y, w, 1, mixRgb(color, rgb(0xffffff), 0.3));
        buffer.rect(x, y + h - 1, w, 1, mixRgb(color, rgb(0), 0.5));
        if (cell.kind === 'saw') for (let k = 0; k < w; k += 2) buffer.set(x + k, y + h - 1 - ((k >> 1) & 1), rgb(0xfff0f0));
      });
    }
    this.particles.draw(buffer, SKY[1]);
    canvas.blit(buffer);
  }

  private drawPlain(canvas: Canvas, g: {w: number; h: number; lane: number; playerY: number; ppm: number; left: number}): void {
    for (let r = 1; r < canvas.height; r += 1) for (let k = 0; k <= 3; k += 1) canvas.put(g.left + g.lane * k, r, k === 0 || k === 3 ? '|' : ':', {dim: true});
  }

  /** The gate sums as text over the gates, in every mode. */
  private drawLabels(canvas: Canvas, look: ArcadeLook, g: {w: number; lane: number; playerY: number; ppm: number; left: number}, art: boolean): void {
    for (const row of this.state.rows) {
      const box = this.rowBox(row, g);
      if (box.bottom < 2 || box.top > canvas.height * 2) continue;
      const y = Math.floor((box.top + box.bottom) / 4);
      row.cells.forEach((cell, lane) => {
        if (!cell) return;
        const bare = cellText(cell);
        const text = !art ? `[${bare}]` : bare;
        const room = g.lane - 1;
        const label = text.length <= room ? text : bare.slice(0, Math.max(1, room));
        const x = g.left + lane * g.lane + Math.floor((g.lane - label.length) / 2);
        canvas.text(x, y, label, art ? {fg: look.surface.sunken, bg: gateColor(cell, look), bold: true} : {bold: true, dim: row.applied});
      });
    }
  }

  private drawCrowd(canvas: Canvas, look: ArcadeLook, g: {w: number; lane: number; playerY: number; left: number}, art: boolean): void {
    const state = this.state;
    const px = g.left + g.lane * (this.visualLane + 0.5);
    const layout = crowdLayout(state.count, MAX_DRAWN, Math.max(1, Math.floor((g.lane - 2) / (art ? 3 : 2))));
    const palette = arcadeLook().palette;
    if (state.alive || this.dyingMs > 0) {
      if (art) {
        const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
        const bob = this.bump > 0 ? 1 : 0;
        for (const p of layout) {
          const sx = Math.round(px + p.x * 3), sy = Math.round(g.playerY - 6 + p.y * 3 + bob + (hash(Math.round(p.x * 7) + p.y * 31) % 2 && Math.floor(state.time * 6) & 1 ? -1 : 0));
          buffer.rect(sx - 1, sy, 3, 2, palette.cat.body);
          buffer.set(sx - 1, sy - 1, palette.cat.body); buffer.set(sx + 1, sy - 1, palette.cat.body);
          buffer.set(sx, sy, palette.cat.eye);
          buffer.rect(sx - 1, sy + 2, 3, 1, OUTLINE);
        }
        canvas.blit(buffer);
      } else {
        for (const p of layout) canvas.put(Math.round(px + p.x * 2), Math.floor(g.playerY / 2) - 1 + Math.round(p.y * 0.5), 'c', {bold: true});
      }
    }
    const label = `x${compact(state.count)}`;
    canvas.text(Math.round(px - label.length / 2), Math.max(1, Math.floor((g.playerY - 6) / 2) - 1), label, {fg: look.text.strong, bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void { /* the session stops stepping; nothing else to hold */ }
  hints(): readonly ControlHint[] { return [{keys: '← →', action: 'choose gate'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  gradient(buffer, SKY, 0, buffer.height);
  const lane = clamp(Math.floor(canvas.width / 5), 3, 14);
  const left = Math.floor(canvas.width / 2 - lane * 1.5);
  for (let y = 0; y < buffer.height; y += 1) buffer.rect(left, y, lane * 3, 1, ROAD[(Math.floor((y + frame * 2) / 5)) & 1]!);
  const gateY = ((frame * 2) % (buffer.height + 6)) - 4;
  const colors = [look.hue.mint, look.hue.coral, look.hue.sky];
  colors.forEach((color, index) => buffer.rect(left + index * lane + 1, gateY, lane - 2, 4, color));
  const cx = left + lane * 0.5 + (Math.floor(frame / 12) % 3) * lane;
  for (let index = 0; index < 9; index += 1) buffer.rect(Math.round(cx + (index % 3) * 3 - 3), buffer.height - 10 + Math.floor(index / 3) * 3, 3, 2, palette.cat.body);
  canvas.blit(buffer);
}

export const paradeGame: GameDefinition = {
  id: 'parade', aliases: ['kitten-parade', 'crowd'], title: 'Kitten Parade', tagline: 'Grow the crowd, pick your gates',
  description: 'Lead a little crowd of kittens up the road. Pick the gate that adds, multiplies or at least spares them, and steer clear of saws: when the last kitten is gone, the parade is over.',
  kind: 'action', category: 'runners',
  controls: [{keys: '← →', action: 'change lane'}, {keys: 'Space', action: 'start'}],
  howToPlay: [
    'Steer the crowd between three lanes with the arrows (or A D, h l). Each row of gates changes the crowd as it passes: +n adds, ×n multiplies, −n and ÷n shrink it, a SAW takes a quarter.',
    'Every row has at least one lane that does not cost you a kitten. Look for the biggest gain, but do not leave your lane too late.',
    'Only up to 48 kittens are drawn; the number above the crowd is the real count. Your score is metres plus twice your biggest crowd.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `Best ${saved.best.toLocaleString('en-US')} · crowd ${safeCount(record.crowd).toLocaleString('en-US')}` : 'Not played yet'; },
  preview,
  create: context => new KittenParade(context),
};
