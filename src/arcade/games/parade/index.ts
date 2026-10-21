import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {Flash, ParticleSystem, Popups} from '../../effects.js';
import {count as safeCount, direction, isConfirm, readScore, saveScore, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {gradient, hash, rgb} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {clamp, confetti, pixelArt} from '../shared3.js';
import {cellText, compact, crowdLayout, ENEMY_REACH, LEVELS, MAX_DRAWN, MAX_ENEMY_DRAWN, ParadeState, ROW_LENGTH, type Cell, type ParadeEvent, type Row} from './logic.js';

/**
 * Kitten Parade: a crowd of tiny kittens runs up the road through number gates and into rival crowds. Each gate shows its
 * sum in text as well as in color (+ mint, × sky, − coral, ÷ butter, saw rose), a rival group shows its real count
 * (`!24`) over a cluster of horned rivals, and each level ends at a boss formation. At most MAX_DRAWN kittens and
 * MAX_ENEMY_DRAWN rivals are ever drawn; the numbers are the real counts. A fight is played out on screen, exchange by
 * exchange, with both crowds shrinking; winning every level is a victory, running out of kittens is a defeat.
 */
const SKY = [rgb(0x2a2160), rgb(0x6a4fa6), rgb(0xe4a0c0)];
const ROAD = [rgb(0x3b3556), rgb(0x332e4d)];
const GRASS = [rgb(0x2f5a52), rgb(0x2a4f4a)];
const OUTLINE = rgb(0x1a1230);
const RIVAL = rgb(0x9a3a6a);
const RIVAL_DARK = rgb(0x4a1636);
const HORN = rgb(0xff8a5c);
const EYE = rgb(0xffe27a);
const BOSS_BODY = rgb(0x6b2a5a);
const DEAD_MS = 1900;
const VICTORY_MS = 3200;

type Geometry = {w: number; h: number; lane: number; playerY: number; ppm: number; left: number};

function gateColor(cell: Cell, look: ArcadeLook): Rgb {
  if (!cell) return look.surface.sunken;
  if (cell.kind === 'enemy') return look.bad;
  if (cell.kind === 'saw') return look.hue.rose;
  return cell.op === '+' ? look.hue.mint : cell.op === '×' ? look.hue.sky : cell.op === '-' ? look.hue.coral : look.hue.butter;
}

/** Tint every drawn pixel toward a color: the dimming of a lost parade. */
function tint(buffer: PixelBuffer, color: Rgb, amount: number): void {
  for (let y = 0; y < buffer.height; y += 1) for (let x = 0; x < buffer.width; x += 1) { const was = buffer.get(x, y); if (was) buffer.set(x, y, mixRgb(was, color, amount)); }
}

class KittenParade implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private state: ParadeState;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly flash = new Flash(180);
  private readonly startBest: number;
  private visualLane = 1;
  private dyingMs = 0;
  private victoryMs = 0;
  private victoryBurst = 0;
  private bump = 0;
  private clock = 0;
  private lastCrowd = 0;
  private enemyLeft = 0;
  private celebrated = false;
  private pixels = new PixelBuffer(0, 0);

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new ParadeState(context.rng.fork('parade'));
    this.particles = new ParticleSystem(context.rng.fork('parade-fx'), 160, context.motion.reduced ? 'off' : context.motion.effects);
    this.popups = new Popups(6, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? (this.state.won ? 'won' : 'over') : this.state.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.state.started || this.context.motion.reduced ? 0 : 100; }

  private geometry(): Geometry {
    const w = this.size.columns, h = this.size.rows * 2;
    const lane = clamp(Math.floor(w * 0.24), 5, 30);
    const playerY = Math.floor(h * 0.8);
    return {w, h, lane, playerY, ppm: (playerY - 5) / 26, left: Math.floor(w / 2 - lane * 1.5)};
  }
  private laneX(lane: number): number { const g = this.geometry(); return g.left + g.lane * (lane + 0.5); }
  /** Where the fight happens: the lane's x and the pixel row between the two crowds. */
  private clash(): {x: number; y: number} {
    const g = this.geometry();
    return {x: this.laneX(this.state.lane), y: g.playerY - Math.round(ENEMY_REACH * g.ppm * 0.55)};
  }

  step(dtMs: number): void {
    if (this.done) return;
    this.clock += dtMs;
    this.state.step(dtMs);
    for (const event of this.state.events.splice(0)) this.react(event);
    if (this.state.won) {
      this.victoryMs -= dtMs;
      this.victoryBurst -= dtMs;
      if (this.victoryBurst <= 0 && this.victoryMs > 0) { this.victoryBurst = 420; this.victoryConfetti(); }
      if (this.victoryMs <= 0) this.finish();
    } else if (!this.state.alive) {
      this.dyingMs -= dtMs;
      if (this.dyingMs <= 0) this.finish();
    } else if (!this.celebrated && this.startBest > 0 && this.state.score > this.startBest) {
      this.celebrated = true;
      this.celebrate();
    }
  }

  private victoryConfetti(): void {
    const look = arcadeLook();
    const g = this.geometry();
    const colors = [look.gold, look.hue.mint, look.hue.rose, look.hue.sky, rgb(0xffffff)];
    confetti(this.particles, g.w * (0.25 + 0.5 * ((this.clock / 420) % 2 < 1 ? 0.2 : 0.8)), g.playerY - 14, colors, 40);
    confetti(this.particles, g.w / 2, g.playerY - 20, colors, 30);
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
    const calm = this.context.motion.reduced;
    if (event.kind === 'gate') {
      const color = gateColor({kind: 'gate', op: event.op, n: 1}, look);
      this.particles.burst({x, y, count: event.after >= event.before ? 14 : 8, speed: 36, life: 420, gravity: event.after >= event.before ? -10 : 50, colors: [color, rgb(0xffffff)]});
      const delta = event.after - event.before;
      this.popups.add(`${delta >= 0 ? '+' : '-'}${compact(Math.abs(delta))}`, Math.round(x), Math.floor(y / 2) - 4, color, 700);
      if (event.good && this.state.streak >= 3) this.popups.add(`streak ${this.state.streak}`, Math.round(x), Math.floor(y / 2) - 6, look.gold, 800);
    } else if (event.kind === 'saw') {
      this.particles.burst({x, y, count: 18, speed: 50, life: 500, gravity: 80, colors: [look.hue.rose, rgb(0xffffff), rgb(0xffd0d0)]});
      this.bump = calm ? 0 : 200;
      this.popups.add(`-${event.before - event.after}`, Math.round(x), Math.floor(y / 2) - 4, look.hue.rose, 700);
    } else if (event.kind === 'battle') {
      const c = this.clash();
      this.flash.trigger(!calm);
      this.popups.add(event.boss ? 'BOSS!' : 'FIGHT!', Math.round(c.x), Math.floor(c.y / 2) - 5, look.bad, 800);
    } else if (event.kind === 'exchange') {
      const c = this.clash();
      this.flash.trigger(!calm);
      this.bump = calm ? 0 : 120;
      this.particles.burst({x: c.x, y: c.y, count: 10, speed: 42, life: 360, gravity: 40, colors: [look.bad, look.hue.peach, rgb(0xffffff), RIVAL]});
      this.popups.add(`-${event.lost}`, Math.round(c.x - 3), Math.floor(c.y / 2) + 2, look.hue.mint, 420);
      this.popups.add(`-${event.lost}`, Math.round(c.x + 3), Math.floor(c.y / 2) - 3, look.bad, 420);
    } else if (event.kind === 'routed') {
      const c = this.clash();
      confetti(this.particles, c.x, c.y - 4, [look.gold, look.hue.mint, rgb(0xffffff), look.hue.sky], event.boss ? 44 : 22);
      this.popups.add(event.boss ? 'BOSS DOWN!' : 'ROUTED!', Math.round(c.x), Math.floor(c.y / 2) - 5, look.gold, 1100);
    } else if (event.kind === 'level') {
      this.popups.add(`LEVEL ${event.level} CLEAR  +${event.recruits} join`, Math.floor(g.w / 2), Math.floor(this.size.rows / 3), look.gold, 1900);
      confetti(this.particles, g.w / 2, g.playerY - 10, [look.gold, look.hue.mint, look.hue.rose, look.hue.sky], 36);
    } else if (event.kind === 'victory') {
      this.victoryMs = calm ? 900 : VICTORY_MS;
      this.victoryBurst = 0;
      if (this.state.score > this.startBest) this.popups.add('NEW BEST', Math.floor(g.w / 2), Math.floor(this.size.rows / 3) + 3, look.gold, 2200);
    } else if (event.kind === 'milestone') {
      this.popups.add(`${event.meters} m`, Math.floor(g.w / 2), Math.floor(this.size.rows / 3), look.accent, 1100);
    } else if (event.kind === 'dead') {
      this.dyingMs = calm ? 500 : DEAD_MS;
      this.lastCrowd = Math.max(1, event.crowd0);
      this.enemyLeft = event.enemyLeft;
      this.particles.burst({x, y, count: 40, speed: 55, life: 800, gravity: 70, colors: [look.bad, rgb(0xffffff), look.hue.peach]});
      if (this.state.score > this.startBest && this.state.score > 0) this.celebrate();
    }
  }

  private finish(): void {
    this.done = true;
    const state = this.state;
    const saved = saveScore(this.context.record, state.score, {distance: state.meters, crowd: state.peak, level: state.won ? LEVELS : state.level});
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record: state.score > 0 && state.score > this.startBest,
      details: [
        state.won ? `Victory: all ${LEVELS} levels cleared` : `Fell at level ${state.level} of ${LEVELS}`,
        `Rivals beaten ${state.rivalsBeaten.toLocaleString('en-US')} · bosses ${state.bossesDown}`,
        `Biggest crowd ${state.peak.toLocaleString('en-US')} · best gates ${state.perfect}`,
        `Best ${saved.best.toLocaleString('en-US')}`, `Parades ${saved.plays}`,
      ],
    };
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.flash.update(dtMs);
    this.bump = Math.max(0, this.bump - dtMs);
    const target = this.state.lane;
    this.visualLane = this.context.motion.reduced ? target : this.visualLane + (target - this.visualLane) * Math.min(1, dtMs / 80);
    if (Math.abs(this.visualLane - target) < 0.02) this.visualLane = target;
  }

  key(key: Key): GameKeyResult {
    if (this.done || !this.state.alive || this.state.won) return 'ignored';
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
    if (art) this.drawArt(canvas, look, g, palette);
    else { this.drawPlain(canvas, g); this.drawPlainRivals(canvas, g); }
    this.drawLabels(canvas, look, g, art);
    if (!art) this.drawPlainCrowd(canvas, g);
    this.drawCrowdLabel(canvas, look, g);
    this.popups.draw(canvas, SKY[1]);
    topRow(canvas, look, 'Kitten Parade', `Lv ${Math.min(LEVELS, state.level)}/${LEVELS}  ${compact(state.count)} kittens  ${state.score.toLocaleString('en-US')}  best ${Math.max(this.startBest, state.score).toLocaleString('en-US')}`);
    this.drawBanners(canvas, look);
    if (!state.started) {
      const y = Math.max(1, Math.floor(canvas.height / 4));
      canvas.center(y, 'Kitten Parade', {fg: look.text.strong, bold: true});
      canvas.center(y + 1, canvas.width < 40 ? 'Space to start' : '← → pick a gate · Space to start', {fg: look.accent, bold: true});
      if (canvas.height >= 14) canvas.center(y + 2, this.ascii(canvas.width < 44 ? '+ x good  ! rivals' : '+n ×n grow · −n ÷n SAW shrink · !n rivals fight'), {fg: look.text.normal});
    }
  }

  private drawBanners(canvas: Canvas, look: ArcadeLook): void {
    const state = this.state;
    const style = (fg: Rgb) => ({fg, bg: look.surface.sunken, bold: true});
    const mid = Math.max(2, Math.floor(canvas.height / 3));
    if (state.battle && canvas.height >= 10) {
      const b = state.battle;
      canvas.center(1, canvas.width < 36 ? ` ${compact(b.crowd)} v ${compact(b.enemy)} ` : ` ${b.boss ? 'BOSS' : 'RIVALS'}  you ${compact(b.crowd)}  vs  ${compact(b.enemy)} `, style(b.boss ? look.bad : look.hue.butter));
    }
    if (state.won) {
      canvas.center(mid, canvas.width < 30 ? ' VICTORY! ' : ' VICTORY! The parade wins! ', style(look.gold));
      if (canvas.height >= 12) canvas.center(mid + 1, ` ${compact(state.count)} kittens · ${state.score.toLocaleString('en-US')} pts `, style(look.text.strong));
    } else if (!state.alive && this.dyingMs < DEAD_MS * 0.8) {
      canvas.center(mid, canvas.width < 30 ? ' DEFEAT ' : ' DEFEAT  The parade was overwhelmed ', style(look.bad));
      if (canvas.height >= 12) canvas.center(mid + 1, this.enemyLeft > 0 ? ` ${compact(this.enemyLeft)} rivals still stand ` : ' the road ate the last kitten ', style(look.text.normal));
    } else if (state.interlude > 0) {
      canvas.center(mid + 1, ` LEVEL ${state.level} CLEAR `, style(look.gold));
    }
  }

  /** Safe Glyphs draws any character outside its ASCII table as '?': division and the true minus sign stay readable. */
  private ascii(text: string): string { return this.context.safeGlyphs ? text.replace(/÷/gu, '/').replace(/−/gu, '-') : text; }

  private rowBox(row: Row, g: Geometry): {top: number; bottom: number} {
    const bottom = g.playerY - (row.z - this.state.z) * g.ppm;
    return {top: bottom - Math.max(3, ROW_LENGTH * g.ppm), bottom};
  }

  /** The number of rivals shown for a group whose real size is `real`, of `start` at the start of the fight. */
  private rivalsDrawn(real: number, start: number, cap: number): number {
    return Math.max(real > 0 ? 1 : 0, Math.min(real, Math.ceil(cap * real / Math.max(1, start))));
  }

  private drawArt(canvas: Canvas, look: ArcadeLook, g: Geometry, palette: ArcadePalette): void {
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
        if (cell.kind === 'enemy') {
          if (row.applied && !this.state.battle) return;
          buffer.rect(x, y, w, h, mixRgb(color, rgb(0x141020), 0.7));
          return;
        }
        buffer.rect(x, y, w, h, mixRgb(color, rgb(0x141020), 0.35 + dim * 0.6));
        buffer.rect(x, y, w, 1, mixRgb(color, rgb(0xffffff), 0.3));
        buffer.rect(x, y + h - 1, w, 1, mixRgb(color, rgb(0), 0.5));
        if (cell.kind === 'saw') for (let k = 0; k < w; k += 2) buffer.set(x + k, y + h - 1 - ((k >> 1) & 1), rgb(0xfff0f0));
      });
    }
    for (const row of this.state.rows) this.drawRowRivals(buffer, row, g);
    this.drawCrowd(buffer, g, palette);
    if (this.flash.amount > 0 && this.state.battle) {
      const c = this.clash();
      buffer.rect(Math.round(c.x - g.lane / 3), c.y, Math.round(g.lane * 2 / 3), 1, mixRgb(rgb(0xffffff), look.bad, 1 - this.flash.amount));
    }
    this.particles.draw(buffer, SKY[1]);
    if (!this.state.alive) tint(buffer, rgb(0x2a0a18), Math.min(0.6, (1 - this.dyingMs / DEAD_MS) * 0.8));
    canvas.blit(buffer);
  }

  /** Rival groups of one row: a horned cluster per lane (the boss formation fills the road), shrinking as the fight goes. */
  private drawRowRivals(buffer: PixelBuffer, row: Row, g: Geometry): void {
    const box = this.rowBox(row, g);
    if (box.bottom < -4 || box.top > g.h + 20) return;
    const battle = this.state.battle;
    const fighting = Boolean(battle) && row.fought >= 0 && this.state.rows.filter(r => r.applied && r.fought >= 0).at(-1) === row;
    if (row.applied && !fighting) return;
    const bob = this.context.motion.reduced ? 0 : Math.floor(this.clock / 280) & 1;
    if (row.kind === 'boss') {
      const boss = row.cells[0];
      if (boss?.kind !== 'enemy') return;
      const real = fighting ? battle!.enemy : boss.n, start = fighting ? battle!.enemy0 : boss.n;
      const cx = g.left + g.lane * 1.5;
      const bottom = Math.round(box.bottom) - 1;
      const cols = Math.max(2, Math.floor((g.lane * 3 - 4) / 3));
      const cluster = crowdLayout(this.rivalsDrawn(real, start, MAX_ENEMY_DRAWN + 12), MAX_ENEMY_DRAWN + 12, cols);
      const rowsUsed = cluster.reduce((m, p) => Math.max(m, p.y), 0) + 1;
      for (const p of cluster) this.drawRival(buffer, Math.round(cx + p.x * 3), bottom - 14 - (rowsUsed - p.y) * 3 + bob * (p.y & 1), false);
      this.drawBoss(buffer, Math.round(cx), bottom, g.lane >= 8, real > 0 ? Math.max(0.25, real / Math.max(1, start)) : 0, bob);
      return;
    }
    row.cells.forEach((cell, lane) => {
      if (cell?.kind !== 'enemy') return;
      if (row.applied && !(fighting && lane === row.fought)) return;
      const real = fighting && lane === row.fought ? battle!.enemy : cell.n, start = fighting && lane === row.fought ? battle!.enemy0 : cell.n;
      const cx = g.left + g.lane * (lane + 0.5);
      const bottom = Math.round(box.bottom) - 1;
      const cols = Math.max(1, Math.floor((g.lane - 1) / 3));
      const drawn = Math.min(this.rivalsDrawn(real, start, MAX_ENEMY_DRAWN), cols * 4);
      const cluster = crowdLayout(drawn, MAX_ENEMY_DRAWN, cols);
      const rowsUsed = cluster.reduce((m, p) => Math.max(m, p.y), 0) + 1;
      for (const p of cluster) this.drawRival(buffer, Math.round(cx + p.x * 3), bottom - (rowsUsed - p.y) * 3 + bob * ((p.x + p.y) & 1 ? 1 : 0), fighting);
    });
  }

  /** One rival: a horned 3x2 body with glowing eyes, facing the crowd. */
  private drawRival(buffer: PixelBuffer, x: number, y: number, angry: boolean): void {
    buffer.rect(x - 1, y, 3, 2, RIVAL);
    buffer.set(x - 1, y - 1, HORN); buffer.set(x + 1, y - 1, HORN);
    buffer.set(x - 1, y, EYE); buffer.set(x + 1, y, EYE);
    if (angry) buffer.set(x, y + 1, rgb(0xff4a4a));
    buffer.rect(x - 1, y + 2, 3, 1, RIVAL_DARK);
  }

  /** The boss: a big horned, crowned brute; `life` (0..1) dims it as it is beaten down. */
  private drawBoss(buffer: PixelBuffer, cx: number, bottom: number, big: boolean, life: number, bob: number): void {
    const w = big ? 11 : 7, h = big ? 8 : 6;
    const top = bottom - h - bob;
    const body = mixRgb(BOSS_BODY, rgb(0x888888), (1 - life) * 0.5);
    buffer.rect(cx - Math.floor(w / 2), top, w, h, body);
    buffer.rect(cx - Math.floor(w / 2), top + h - 1, w, 1, RIVAL_DARK);
    buffer.rect(cx - Math.floor(w / 2), top - 2, 2, 3, HORN);
    buffer.rect(cx + Math.floor(w / 2) - 1, top - 2, 2, 3, HORN);
    buffer.rect(cx - 1, top - 2, 3, 1, rgb(0xffd45a));
    buffer.set(cx - 1, top - 3, rgb(0xffd45a)); buffer.set(cx + 1, top - 3, rgb(0xffd45a));
    const eyeY = top + Math.floor(h / 3);
    buffer.rect(cx - Math.floor(w / 2) + 2, eyeY, 2, 1, EYE);
    buffer.rect(cx + Math.floor(w / 2) - 3, eyeY, 2, 1, EYE);
    buffer.rect(cx - 2, top + h - 3, 5, 1, rgb(0xfff0f0));
  }

  private drawPlain(canvas: Canvas, g: Geometry): void {
    for (let r = 1; r < canvas.height; r += 1) for (let k = 0; k <= 3; k += 1) canvas.put(g.left + g.lane * k, r, k === 0 || k === 3 ? '|' : ':', {dim: true});
  }

  /** Without pixel art: rivals as R (the boss as B), a few per lane. */
  private drawPlainRivals(canvas: Canvas, g: Geometry): void {
    const battle = this.state.battle;
    for (const row of this.state.rows) {
      const box = this.rowBox(row, g);
      const y = Math.floor(box.bottom / 2) - 1;
      if (y < 1 || y >= canvas.height) continue;
      const fighting = Boolean(battle) && row.fought >= 0 && this.state.rows.filter(r => r.applied && r.fought >= 0).at(-1) === row;
      if (row.applied && !fighting) continue;
      row.cells.forEach((cell, lane) => {
        if (cell?.kind !== 'enemy' || (row.applied && !(fighting && (row.kind === 'boss' || lane === row.fought)))) return;
        const real = fighting ? battle!.enemy : cell.n, start = fighting ? battle!.enemy0 : cell.n;
        const drawn = Math.min(4, this.rivalsDrawn(real, start, 4));
        const cx = g.left + g.lane * (lane + 0.5);
        for (let k = 0; k < drawn; k += 1) canvas.put(Math.round(cx - drawn + 1 + k * 2), y, cell.boss ? 'B' : 'R', {bold: true});
      });
    }
  }

  private drawPlainCrowd(canvas: Canvas, g: Geometry): void {
    const state = this.state;
    const px = g.left + g.lane * (this.visualLane + 0.5);
    const shown = state.alive ? state.count : this.dyingMs > 0 ? Math.round(this.lastCrowd * Math.max(0, this.dyingMs / DEAD_MS)) : 0;
    const layout = crowdLayout(Math.min(shown, 24), 24, 4);
    for (const p of layout) canvas.put(Math.round(px + p.x * 2), Math.floor(g.playerY / 2) - 1 + Math.round(p.y * 0.5), 'c', {bold: true});
  }

  /** The gate sums (and rival counts) as text over the gates, in every mode. */
  private drawLabels(canvas: Canvas, look: ArcadeLook, g: Geometry, art: boolean): void {
    const battle = this.state.battle;
    for (const row of this.state.rows) {
      const box = this.rowBox(row, g);
      if (box.bottom < 2 || box.top > canvas.height * 2) continue;
      const fighting = Boolean(battle) && row.fought >= 0 && this.state.rows.filter(r => r.applied && r.fought >= 0).at(-1) === row;
      if (row.applied && row.cells.some(cell => cell?.kind === 'enemy') && !fighting) continue;
      const y = Math.floor((box.top + box.bottom) / 4) - (row.cells.some(cell => cell?.kind === 'enemy') ? 3 : 0);
      if (y < 1 || y >= canvas.height) continue;
      row.cells.forEach((cell, lane) => {
        if (!cell) return;
        let shown: Cell = cell;
        if (cell.kind === 'enemy' && fighting && (cell.boss || lane === row.fought)) shown = {...cell, n: battle!.enemy};
        if (cell.kind === 'enemy' && row.applied && fighting && !cell.boss && lane !== row.fought) return;
        if (cell.kind === 'enemy' && cell.boss && lane !== 1) return;
        const bare = this.ascii(shown.kind === 'enemy' && shown.boss && g.lane >= 8 ? `BOSS ${compact(shown.n)}` : cellText(shown));
        const text = !art ? `[${bare}]` : bare;
        const room = g.lane - 1;
        const label = text.length <= room ? text : bare.slice(0, Math.max(1, room));
        const x = g.left + lane * g.lane + Math.floor((g.lane - label.length) / 2);
        const dim = row.applied && cell.kind !== 'enemy';
        canvas.text(x, y, label, art ? {fg: look.surface.sunken, bg: gateColor(cell, look), bold: true} : {bold: true, dim});
      });
    }
  }

  private drawCrowd(buffer: PixelBuffer, g: Geometry, palette: ArcadePalette): void {
    const state = this.state;
    const px = clamp(g.left + g.lane * (this.visualLane + 0.5), 4, g.w - 4);
    // A full crowd stays inside its lane (a 3-wide sprite per column, one pixel of road to spare each side).
    const cols = Math.max(1, Math.min(Math.floor((g.lane * 1.5) / 3), Math.floor((g.lane - 2) / 3)));
    const space = Math.max(1, Math.floor((g.h - (g.playerY - 6)) / 3));
    const cap = Math.min(MAX_DRAWN, cols * space);
    const happy = state.won || state.interlude > 0;
    const hop = (index: number): number => (happy && !this.context.motion.reduced ? -(((Math.floor(this.clock / 150) + index) & 1) * 2) : 0);
    if (state.alive || state.won) {
      const layout = crowdLayout(state.count, cap, cols);
      for (const [index, p] of layout.entries()) {
        const sx = Math.round(px + p.x * 3), sy = Math.round(g.playerY - 6 + p.y * 3 + (this.bump > 0 ? 1 : 0) + hop(index) + (hash(Math.round(p.x * 7) + p.y * 31) % 2 && Math.floor(state.time * 6) & 1 ? -1 : 0));
        this.drawKitten(buffer, sx, sy, palette.cat.body, palette.cat.eye);
      }
      return;
    }
    // Defeat: the last kittens tumble, fade to the road and are gone, while the rivals that remain cheer.
    const t = clamp(1 - this.dyingMs / DEAD_MS, 0, 1);
    const layout = crowdLayout(Math.min(this.lastCrowd, cap), cap, cols);
    for (const [index, p] of layout.entries()) {
      if ((index + 1) / Math.max(1, layout.length) < t * 0.9) continue;
      const scatter = (hash(index * 13 + 5) % 9) - 4;
      const sx = Math.round(px + p.x * 3 + scatter * t * 2), sy = Math.round(g.playerY - 6 + p.y * 3 + t * (6 + (hash(index) % 5)));
      this.drawKitten(buffer, sx, sy, mixRgb(palette.cat.body, ROAD[1]!, t * 0.7), mixRgb(palette.cat.eye, ROAD[1]!, t * 0.7));
    }
    if (this.enemyLeft > 0) {
      const cluster = crowdLayout(Math.min(MAX_ENEMY_DRAWN, this.enemyLeft), MAX_ENEMY_DRAWN, Math.max(1, Math.floor((g.lane * 1.5) / 3)));
      const bottom = g.playerY - 4;
      const cheer = Math.floor(this.clock / 200) & 1;
      for (const p of cluster) this.drawRival(buffer, Math.round(px + p.x * 3), bottom - 3 * (p.y + 1) - cheer * (p.x & 1 ? 1 : 0), true);
    }
  }

  private drawKitten(buffer: PixelBuffer, sx: number, sy: number, body: Rgb, eye: Rgb): void {
    buffer.rect(sx - 1, sy, 3, 2, body);
    buffer.set(sx - 1, sy - 1, body); buffer.set(sx + 1, sy - 1, body);
    buffer.set(sx, sy, eye);
    buffer.rect(sx - 1, sy + 2, 3, 1, OUTLINE);
  }

  private drawCrowdLabel(canvas: Canvas, look: ArcadeLook, g: Geometry): void {
    const state = this.state;
    if (!state.alive && this.dyingMs <= 0) return;
    const px = clamp(g.left + g.lane * (this.visualLane + 0.5), 4, g.w - 4);
    const label = `x${compact(state.count)}`;
    canvas.text(Math.round(px - label.length / 2), Math.max(1, Math.floor((g.playerY - 6) / 2) - 1), label, {fg: look.text.strong, bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void { /* the session stops stepping; nothing else to hold */ }
  hints(): readonly ControlHint[] { return [{keys: '← →', action: 'choose lane'}]; }
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
  id: 'parade', aliases: ['kitten-parade', 'crowd'], title: 'Kitten Parade', tagline: 'Grow the crowd, win the battles',
  description: 'Lead a little crowd of kittens up the road through five levels. Pick the gates that grow the crowd, take on the rival crowds in real battles where both sides lose members, and beat the boss at the end of each level. When the last kitten is gone, the parade is over.',
  kind: 'action', category: 'runners',
  controls: [{keys: '← →', action: 'change lane'}, {keys: 'Space', action: 'start'}],
  howToPlay: [
    'Steer the crowd between three lanes with the arrows (or A D, h l). Gates change the crowd as it passes: +n adds, ×n multiplies, −n and ÷n shrink it, a SAW takes a quarter. Work out which lane leaves you the most.',
    'A rival group (!n, with horned rivals drawn above its count) stops the crowd for a fight: both sides lose the same number of members each exchange until one is gone. Beating the group leaves you the difference; a tie or a bigger group ends the parade. Pick the smallest group you can beat, or a gate instead.',
    'Each of the five levels ends at a boss (B n) that fills the whole road. Beat all five to win. Score rewards the best lane in each row, rivals beaten and kittens that survive.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `Best ${saved.best.toLocaleString('en-US')} · crowd ${safeCount(record.crowd).toLocaleString('en-US')}` : 'Not played yet'; },
  preview,
  create: context => new KittenParade(context),
};
