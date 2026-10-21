import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups} from '../../effects.js';
import {count, direction, isConfirm, readScore, saveScore, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {hash} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {clamp, confetti, pixelArt} from '../shared3.js';
import {DIRS, HUNTERS, ProwlerState, oddFit, type Dir, type Hunter, type HunterKind, type ProwlerEvent} from './logic.js';

/**
 * Maze Prowler: the cat eats every dot while four hunters chase it. Hunters are told apart by a letter as well as a
 * color: R Rascal (rose), A Ambush (butter), P Patrol (sky), W Wander (mint). Scared hunters are lower-case and
 * blink as the fright runs out; eaten ones are `e`. Tiles are two cells wide when the terminal has room.
 */
const LETTER: Readonly<Record<HunterKind, string>> = {chaser: 'R', ambusher: 'A', patroller: 'P', wanderer: 'W'};
const NAME: Readonly<Record<HunterKind, string>> = {chaser: 'Rascal', ambusher: 'Ambush', patroller: 'Patrol', wanderer: 'Wander'};

function hunterColor(kind: HunterKind, look: ArcadeLook): Rgb {
  return kind === 'chaser' ? look.hue.rose : kind === 'ambusher' ? look.hue.butter : kind === 'patroller' ? look.hue.sky : look.hue.mint;
}

class MazeProwler implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private state: ProwlerState;
  private done = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly startBest: number;
  private celebrated = false;
  private overMs = 0;
  private pixels = new PixelBuffer(0, 0);

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.state = new ProwlerState(context.rng.fork('prowler'), oddFit(context.size.columns / 2, 9, 31), oddFit(context.size.rows - 3, 5, 21));
    this.particles = new ParticleSystem(context.rng.fork('prowler-fx'), 120, context.motion.reduced ? 'off' : context.motion.effects);
    this.popups = new Popups(5, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.done ? 'over' : this.state.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.state.started || this.context.motion.reduced ? 0 : 100; }

  // ---- layout: tile -> cell, with a viewport that follows the cat when the maze is bigger than the screen ----------
  private tileWidth(): number { return this.size.columns >= this.state.width * 2 ? 2 : 1; }
  private origin(): {tw: number; ox: number; oy: number} {
    const tw = this.tileWidth();
    const mazeCols = this.state.width * tw, viewCols = this.size.columns;
    const viewRows = Math.max(1, this.size.rows - 2), mazeRows = this.state.height;
    const p = this.state.position(this.state.player);
    const follow = (center: number, view: number, total: number): number => (total <= view ? Math.floor((total - view) / 2) : clamp(Math.round(center - view / 2), 0, total - view));
    return {tw, ox: -follow((p.x + 0.5) * tw, viewCols, mazeCols), oy: 1 - follow(p.y + 0.5, viewRows, mazeRows)};
  }

  step(dtMs: number): void {
    if (this.done) return;
    this.state.step(dtMs);
    for (const event of this.state.events.splice(0)) this.react(event);
    if (this.state.phase === 'over') {
      this.overMs += dtMs;
      if (this.overMs > (this.context.motion.reduced ? 200 : 600)) this.finish();
    } else if (!this.celebrated && this.startBest > 0 && this.state.score > this.startBest) {
      this.celebrated = true;
      this.celebrate();
    }
  }

  private celebrate(): void {
    const look = arcadeLook();
    confetti(this.particles, this.size.columns / 2, this.size.rows, [look.gold, look.hue.mint, look.hue.rose, look.hue.sky]);
    this.popups.add('NEW BEST', Math.floor(this.size.columns / 2), Math.floor(this.size.rows / 2), look.gold, 1400);
  }

  private cellOf(x: number, y: number): {x: number; y: number} {
    const o = this.origin();
    return {x: Math.round(o.ox + (x + 0.5) * o.tw), y: Math.round(o.oy + y)};
  }

  private react(event: ProwlerEvent): void {
    const look = arcadeLook();
    const at = this.cellOf(this.state.position(this.state.player).x, this.state.position(this.state.player).y);
    switch (event.kind) {
      case 'power': this.particles.burst({x: at.x, y: at.y * 2, count: 14, speed: 40, life: 500, colors: [look.gold, look.hue.sky]}); break;
      case 'eat': { const c = this.cellOf(event.x, event.y); this.popups.add(String(event.points), c.x, c.y - 1, look.gold, 800); this.particles.burst({x: c.x, y: c.y * 2, count: 12, speed: 45, life: 500, colors: [hunterColor(event.hunter, look), rgb255]}); break; }
      case 'caught': this.particles.burst({x: at.x, y: at.y * 2, count: 24, speed: 50, life: 700, gravity: 40, colors: [look.bad, rgb255, look.hue.peach]}); break;
      case 'cleared': this.popups.add(`LEVEL ${event.level} CLEAR`, Math.floor(this.size.columns / 2), Math.floor(this.size.rows / 2), look.ok, 1400); confetti(this.particles, this.size.columns / 2, this.size.rows, [look.gold, look.hue.mint, look.hue.sky], 24); break;
      case 'level': this.popups.add(`LEVEL ${event.level}`, Math.floor(this.size.columns / 2), Math.floor(this.size.rows / 2), look.accent, 1200); break;
      case 'extra': this.popups.add('EXTRA LIFE', Math.floor(this.size.columns / 2), Math.floor(this.size.rows / 2), look.ok, 1200); break;
      case 'over': if (this.state.score > this.startBest && this.state.score > 0) this.celebrate(); break;
      default: break;
    }
  }

  private finish(): void {
    this.done = true;
    const s = this.state;
    const saved = saveScore(this.context.record, s.score, {level: s.level, hunters: s.huntersEaten});
    this.result = {
      score: s.score, scoreText: s.score.toLocaleString('en-US'), record: s.score > 0 && s.score > this.startBest,
      details: [`Level ${s.level}`, `Dots ${s.dotsEaten}`, `Hunters eaten ${s.huntersEaten}`, `Best ${saved.best.toLocaleString('en-US')}`, `Runs ${saved.plays}`],
    };
  }

  animate(dtMs: number): void { this.particles.update(dtMs); this.popups.update(dtMs); }

  key(key: Key): GameKeyResult {
    if (this.done || this.state.phase === 'over') return 'ignored';
    const turn = direction(key);
    if (turn) { this.state.setWant(({up: 0, right: 1, down: 2, left: 3} as const)[turn] as Dir); return 'handled'; }
    if (isConfirm(key)) { this.state.started = true; return 'handled'; }
    return 'ignored';
  }

  // ---- drawing --------------------------------------------------------------------------------------------------
  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const s = this.state;
    const art = this.context.color !== 'none';
    const ascii = !pixelArt(this.context);
    canvas.clear(art ? look.surface.base : undefined);
    const o = this.origin();
    const wallColor = look.surface.edge, wallBg = mixRgb(look.surface.raised2, look.hue.lilac, 0.25);
    const blink = !this.context.motion.reduced && Math.floor(s.time * 4) % 2 === 0;
    for (let y = 0; y < s.height; y += 1) for (let x = 0; x < s.width; x += 1) {
      const cy = o.oy + y;
      if (cy < 1 || cy > canvas.height - 2) continue;
      const wall = s.maze.wall(x, y);
      const at = y * s.width + x;
      for (let k = 0; k < o.tw; k += 1) {
        const cx = o.ox + x * o.tw + k;
        if (cx < 0 || cx >= canvas.width) continue;
        if (wall) canvas.put(cx, cy, ascii ? '#' : '▓', {fg: wallColor, bg: wallBg});
        else if (s.powers.has(at)) canvas.put(cx, cy, k === 0 || o.tw === 1 ? (ascii ? 'O' : 'O') : ' ', {fg: look.gold, bg: look.surface.sunken, bold: true});
        else if (s.dots.has(at)) canvas.put(cx, cy, k === 0 || o.tw === 1 ? (ascii ? '.' : '·') : ' ', {fg: look.text.dim, bg: look.surface.sunken});
        else canvas.put(cx, cy, ' ', {bg: look.surface.sunken});
      }
    }
    for (const h of s.hunters) this.drawHunter(canvas, h, o, look, blink);
    this.drawCat(canvas, o, look, blink);
    if (art && !ascii) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels);
      canvas.blit(this.pixels);
    }
    this.popups.draw(canvas);
    topRow(canvas, look, 'Maze Prowler', `${s.score.toLocaleString('en-US')}  level ${s.level}  best ${Math.max(this.startBest, s.score).toLocaleString('en-US')}`);
    const scared = s.frightened ? `  scared ${Math.ceil(s.frightMs / 1000)}s` : '';
    const lives = `lives ${'@'.repeat(Math.max(0, s.lives))}`;
    canvas.fill(0, canvas.height - 1, canvas.width, 1, ' ', {bg: look.surface.base});
    canvas.text(1, canvas.height - 1, (lives + scared).slice(0, Math.max(0, canvas.width - 2)), {fg: look.text.normal, bold: true});
    if (!s.started || s.phase === 'ready') {
      const y = Math.max(1, Math.floor(canvas.height / 2) - 1);
      const text = !s.started ? (canvas.width < 36 ? 'Space to start' : 'Arrows to move · Space to start') : 'Get ready';
      canvas.fill(0, y, canvas.width, 1, ' ', {bg: look.surface.base});
      canvas.center(y, text, {fg: look.accent, bg: look.surface.base, bold: true});
      if (!s.started && canvas.height >= 14) {
        canvas.fill(0, y + 1, canvas.width, 1, ' ', {bg: look.surface.base});
        canvas.center(y + 1, canvas.width < 44 ? 'R A P W hunt you · O scares' : 'R Rascal  A Ambush  P Patrol  W Wander · O scares them', {fg: look.text.normal, bg: look.surface.base});
      }
    }
  }

  private drawHunter(canvas: Canvas, h: Hunter, o: {tw: number; ox: number; oy: number}, look: ArcadeLook, blink: boolean): void {
    const s = this.state;
    if (h.mode === 'den' && !blink && s.phase === 'play') { /* waiting hunters bob */ }
    const p = s.position(h);
    const x = Math.round(o.ox + p.x * o.tw), y = Math.round(o.oy + p.y);
    const ending = s.frightMs > 0 && s.frightMs < 2000 && blink;
    const color = h.mode === 'scared' ? (ending ? look.text.strong : look.hue.lilac) : h.mode === 'eyes' ? look.text.dim : hunterColor(h.kind, look);
    const glyph = h.mode === 'scared' ? LETTER[h.kind].toLowerCase() : h.mode === 'eyes' ? 'e' : LETTER[h.kind];
    for (let k = 0; k < o.tw; k += 1) canvas.put(x + k, y, k === 0 ? glyph : (h.mode === 'eyes' ? ' ' : this.eye(h)), {fg: h.mode === 'eyes' ? color : look.surface.sunken, bg: h.mode === 'eyes' ? undefined : color, bold: true});
  }

  /** The second cell of a hunter: a face that looks the way it is going. */
  private eye(h: Hunter): string { return h.dir === 3 ? '<' : h.dir === 1 ? '>' : h.dir === 0 ? '^' : h.dir === 2 ? 'v' : '-'; }

  private drawCat(canvas: Canvas, o: {tw: number; ox: number; oy: number}, look: ArcadeLook, blink: boolean): void {
    const s = this.state;
    const p = s.position(s.player);
    const x = Math.round(o.ox + p.x * o.tw), y = Math.round(o.oy + p.y);
    if (s.phase === 'dying' && blink) return;
    const face = s.phase === 'dying' ? 'x' : '@';
    canvas.put(x, y, face, {fg: look.surface.sunken, bg: look.gold, bold: true});
    if (o.tw === 2) canvas.put(x + 1, y, DIRS[s.facing] ? this.eye({...s.player, dir: s.facing} as Hunter) : '-', {fg: look.surface.sunken, bg: look.gold, bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void { /* the session stops stepping; nothing else to hold */ }
  hints(): readonly ControlHint[] { return [{keys: '← ↑ ↓ →', action: 'move'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

const rgb255: Rgb = {red: 255, green: 255, blue: 255};

function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const wallBg = mixRgb(look.surface.raised2, look.hue.lilac, 0.25);
  for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
    const wall = y % 3 === 0 || (x % 8 === 0 && hash(x * 3 + y) % 3 !== 0);
    canvas.put(x, y, wall ? '▓' : (x + y) % 4 === 0 ? '·' : ' ', {fg: wall ? look.surface.edge : look.text.dim, bg: wall ? wallBg : look.surface.sunken});
  }
  const row = Math.min(canvas.height - 2, 1 + Math.floor(canvas.height / 3) * 1);
  const px = (frame * 2) % Math.max(4, canvas.width - 6) + 2;
  canvas.text(px, row | 0, '@>', {fg: look.surface.sunken, bg: look.gold, bold: true});
  canvas.text(Math.max(1, px - 6), row | 0, 'R<', {fg: look.surface.sunken, bg: look.hue.rose, bold: true});
}

export const prowlerGame: GameDefinition = {
  id: 'prowler', aliases: ['maze-prowler', 'maze'], title: 'Maze Prowler', tagline: 'Eat the dots, outsmart the hunters',
  description: 'Run the maze and eat every dot while four hunters, each with its own way of tracking you, close in. Power treats turn the tables for a few seconds.',
  kind: 'action', category: 'arcade',
  controls: [{keys: '← ↑ ↓ →', action: 'move'}, {keys: 'Space', action: 'start'}],
  howToPlay: [
    `Steer with the arrows (or WASD, hjkl); the cat keeps going until it hits a wall, and your next turn is remembered until a side opening appears.`,
    `${HUNTERS.map(k => `${LETTER[k]} ${NAME[k]}`).join(', ')}: Rascal chases you, Ambush heads where you are going, Patrol tours the corners until you are near, Wander turns at random.`,
    'An O power treat scares them (lower case) for a while: catch them for 200, 400, 800, 1600. Being caught costs one of your three lives. Clear all dots for the next, harder maze.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `Best ${saved.best.toLocaleString('en-US')} · level ${count(record.level)}` : 'Not played yet'; },
  preview,
  create: context => new MazeProwler(context),
};
