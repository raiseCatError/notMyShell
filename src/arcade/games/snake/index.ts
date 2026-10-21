import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups, Shake} from '../../effects.js';
import {count, direction, readyText, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import {rgb} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {GOLDEN_MS, MODE_HINT, MODE_LABEL, SNAKE_MODES, SnakeState, type SnakeMode} from './logic.js';

/**
 * Tail Chase: Snake, with Vespyr's head leading a lavender tail. Three modes (Classic walls, Wrap-around, a Garden of
 * rocks), fish treats, a golden treat that times out, speed that rises with every treat, and a board sized to the
 * terminal when the run starts. The rules live in `logic.ts`; this file draws and feeds keys and time.
 */
const FISH = rgb(0xffb48a);
const FISH_DARK = rgb(0xd9785a);
const GOLD = rgb(0xffe08a);
const ROCK = rgb(0x8d88a8);
const LAWN = rgb(0x14292a);
const LAWN_LIGHT = rgb(0x183231);
const ROCK_LIGHT = rgb(0xb9b5cc);

interface Board { cw: number; ch: number; width: number; height: number; x: number; y: number }

/** The board for a canvas: big cells (4 × 2) when at least 18 × 10 of them fit, otherwise small ones (2 × 1). */
export function boardFor(columns: number, rows: number): Board | undefined {
  for (const [cw, ch] of [[4, 2], [2, 1]] as const) {
    const width = Math.min(40, Math.floor((columns - 2) / cw));
    const height = Math.min(24, Math.floor((rows - 2) / ch));
    if (width >= (cw === 4 ? 18 : 10) && height >= (cw === 4 ? 10 : 8)) {
      return {cw, ch, width, height, x: Math.floor((columns - width * cw) / 2), y: 1 + Math.floor((rows - 1 - height * ch) / 2)};
    }
  }
  return undefined;
}

/** Where a fixed board of `width × height` cells goes on a canvas (after a resize), at the largest cell size that fits. */
function place(width: number, height: number, columns: number, rows: number): Board | undefined {
  for (const [cw, ch] of [[4, 2], [2, 1]] as const) {
    if (width * cw <= columns && height * ch <= rows - 1) return {cw, ch, width, height, x: Math.floor((columns - width * cw) / 2), y: 1 + Math.floor((rows - 1 - height * ch) / 2)};
  }
  return undefined;
}

const cap = (mode: SnakeMode): string => `${mode[0]!.toUpperCase()}${mode.slice(1)}`;

class TailChase implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  private screen: 'menu' | 'play' | 'over' = 'menu';
  private state: SnakeState | undefined;
  private menu: Menu;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private readonly shake = new Shake(260);
  private pixels = new PixelBuffer(0, 0);
  private visualMs = 0;
  private dying = 0;
  private startBest = 0;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('snake-fx'), 120, context.motion.effects);
    this.popups = new Popups(5, context.motion.effects);
    this.menu = this.buildMenu();
  }

  private buildMenu(): Menu {
    const raw = this.context.record.get();
    return new Menu(SNAKE_MODES.map((mode, index) => {
      const best = count(raw[`best${cap(mode)}`]);
      return {id: mode, label: MODE_LABEL[mode], key: String(index + 1), hint: best ? `best ${best}` : MODE_HINT[mode]};
    }));
  }

  get status(): GameStatus { return this.screen === 'menu' ? 'ready' : this.screen === 'over' ? 'over' : 'playing'; }
  get refreshMs(): number { return this.screen === 'menu' && !this.context.motion.reduced ? 120 : 0; }

  private start(mode: SnakeMode): void {
    const board = boardFor(this.size.columns, this.size.rows) ?? {width: 12, height: 8};
    this.state = new SnakeState(board.width, board.height, mode, createRng(this.context.rng.int(1, 0x7fffffff)));
    this.screen = 'play';
    this.dying = 0;
    this.result = undefined;
    this.startBest = count(this.context.record.get()[`best${cap(mode)}`]);
    this.particles.clear();
    this.popups.clear();
  }

  step(dtMs: number): void {
    const state = this.state;
    if (!state || this.screen !== 'play') return;
    if (!state.alive) {
      this.dying -= dtMs;
      if (this.dying <= 0) this.finish();
      return;
    }
    state.advance(dtMs);
    const eaten = state.lastEaten;
    if (eaten) {
      state.lastEaten = undefined;
      const board = place(state.width, state.height, this.size.columns, this.size.rows);
      if (board) {
        const px = board.x + state.x(eaten.cell) * board.cw + board.cw / 2;
        const py = (board.y + state.y(eaten.cell) * board.ch) * 2 + board.ch;
        this.particles.burst({x: px, y: py, count: eaten.golden ? 18 : 9, speed: eaten.golden ? 44 : 30, life: 520, gravity: 30, drag: 1.4, colors: eaten.golden ? [GOLD, rgb(0xfff4c2), FISH] : [FISH, FISH_DARK, rgb(0xffe3d1)]});
        this.popups.add(`+${eaten.points}`, px, Math.max(1, Math.floor(py / 2) - 1), eaten.golden ? GOLD : FISH);
      }
    }
    if (!state.alive) {
      this.dying = this.context.motion.reduced ? 300 : 700;
      this.shake.trigger(!this.context.motion.reduced && this.context.motion.effects !== 'off');
    }
  }

  private finish(): void {
    const state = this.state!;
    this.screen = 'over';
    const saved = saveScore(this.context.record, state.score, {[`best${cap(state.mode)}`]: state.score, longest: state.length});
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record: state.score > 0 && state.score > this.startBest,
      details: [`${MODE_LABEL[state.mode]} · length ${state.length}`, `Treats ${state.eaten}`, `Best ${MODE_LABEL[state.mode].toLowerCase()} ${Math.max(this.startBest, state.score)}`, `Games ${saved.plays}`],
    };
  }

  animate(dtMs: number): void {
    this.visualMs += dtMs;
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.shake.update(dtMs);
  }

  key(key: Key): GameKeyResult {
    if (this.screen === 'menu') {
      if (key.kind === 'escape') return 'ignored';
      const choice = this.menu.key(key);
      if (choice) this.start(choice as SnakeMode);
      return 'handled';
    }
    const turn = direction(key);
    if (turn && this.state?.alive) { this.state.turn(turn); return 'handled'; }
    return 'ignored';
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.state) {
      topRow(canvas, look, 'Tail Chase', scoreSummary(this.context.record.get()));
      const top = Math.max(2, Math.floor(canvas.height / 2) - 5);
      readyText(canvas, look, 'Choose a garden', ['Eat the fish, never your own tail.'], top);
      this.menu.draw(canvas, palette, 0, top + 3, canvas.width);
      return;
    }
    const state = this.state;
    const board = place(state.width, state.height, canvas.width, canvas.height);
    const golden = state.golden >= 0 ? `  ◆ ${Math.ceil(state.goldenMs / 1000)}s` : '';
    topRow(canvas, look, `Tail Chase · ${MODE_LABEL[state.mode]}`, `Length ${state.length}  Score ${state.score.toLocaleString('en-US')}${golden}`);
    if (!board) { canvas.center(Math.floor(canvas.height / 2), 'Make the window a little larger to keep playing', {fg: look.warn}); return; }
    if (!color || this.context.safeGlyphs) { this.drawText(canvas, look, state, board); return; }
    this.drawPixels(canvas, look, palette, state, board);
  }

  /** The board in half-block pixels: the well, rocks, treats, then the tail and Vespyr's head. */
  private drawPixels(canvas: Canvas, look: ArcadeLook, palette: ArcadePalette, state: SnakeState, board: Board): void {
    if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
    const buffer = this.pixels;
    buffer.clear();
    const pw = board.cw;
    const ph = board.ch * 2;
    const ox = board.x;
    const oy = board.y * 2;
    // A mossy garden lawn, so the lavender tail and peach fish stand out.
    const well = LAWN;
    const checker = LAWN_LIGHT;
    for (let y = 0; y < state.height; y += 1) for (let x = 0; x < state.width; x += 1) buffer.rect(ox + x * pw, oy + y * ph, pw, ph, (x + y) % 2 ? checker : well);
    const cellRect = (cell: number, inset = 0, color: Rgb) => buffer.rect(ox + state.x(cell) * pw + inset, oy + state.y(cell) * ph + inset, pw - inset * 2, ph - inset * 2, color);
    for (const rock of state.rocks) { cellRect(rock, 0, ROCK); buffer.set(ox + state.x(rock) * pw + 1, oy + state.y(rock) * ph, ROCK_LIGHT); }
    if (state.treat >= 0) this.drawTreat(buffer, ox + state.x(state.treat) * pw, oy + state.y(state.treat) * ph, pw, ph, FISH, FISH_DARK);
    if (state.golden >= 0) {
      const blink = !this.context.motion.reduced && state.goldenMs < 1500 && Math.floor(this.visualMs / 150) % 2 === 0;
      if (!blink) this.drawTreat(buffer, ox + state.x(state.golden) * pw, oy + state.y(state.golden) * ph, pw, ph, GOLD, rgb(0xe0a84a));
    }
    const dead = !state.alive;
    const body = dead ? mixRgb(palette.cat.body, look.bad, 0.5) : palette.cat.body;
    const tail = mixRgb(body, LAWN, 0.5);
    const length = state.body.length;
    state.body.forEach((cell, index) => {
      if (index === 0) return;
      const shade = mixRgb(body, tail, index / Math.max(1, length - 1));
      cellRect(cell, pw >= 4 && index === length - 1 ? 1 : 0, shade);
      // A darker band every other segment, so the tail reads as segments without gaps.
      if (pw >= 4 && index % 2 === 0) buffer.rect(ox + state.x(cell) * pw, oy + state.y(cell) * ph + ph - 1, pw, 1, mixRgb(shade, look.surface.sunken, 0.3));
    });
    this.drawHead(buffer, state, ox, oy, pw, ph, body, palette);
    this.particles.draw(buffer, look.surface.base);
    const shake = this.shake.offset;
    canvas.blit(buffer, shake.x, shake.y);
    this.popups.draw(canvas, look.surface.base);
  }

  private drawTreat(buffer: PixelBuffer, x: number, y: number, pw: number, ph: number, color: Rgb, dark: Rgb): void {
    if (pw < 4) { buffer.rect(x, y, pw, ph, color); return; }
    // A little fish: body, tail fin and an eye.
    buffer.rect(x, y + 1, 3, 2, color);
    buffer.set(x + 3, y, dark); buffer.set(x + 3, y + 3, dark); buffer.set(x + 3, y + 1, color); buffer.set(x + 3, y + 2, color);
    buffer.set(x, y + 1, dark);
  }

  /** Vespyr's head: the body color with two eyes and two ears facing the way it travels. */
  private drawHead(buffer: PixelBuffer, state: SnakeState, ox: number, oy: number, pw: number, ph: number, body: Rgb, palette: ArcadePalette): void {
    const head = state.body[0]!;
    const x = ox + state.x(head) * pw;
    const y = oy + state.y(head) * ph;
    buffer.rect(x, y, pw, ph, body);
    if (pw < 4) return;
    const eye = palette.cat.eye;
    const ear = mixRgb(body, rgb(0xffffff), 0.25);
    const blink = !this.context.motion.reduced && this.visualMs % 3600 < 140;
    switch (state.heading) {
      case 'right': if (!blink) { buffer.set(x + 2, y + 1, eye); buffer.set(x + 2, y + 2, eye); } buffer.set(x + 3, y, ear); buffer.set(x + 3, y + 3, ear); break;
      case 'left': if (!blink) { buffer.set(x + 1, y + 1, eye); buffer.set(x + 1, y + 2, eye); } buffer.set(x, y, ear); buffer.set(x, y + 3, ear); break;
      case 'up': if (!blink) { buffer.set(x + 1, y + 1, eye); buffer.set(x + 2, y + 1, eye); } buffer.set(x, y, ear); buffer.set(x + 3, y, ear); break;
      case 'down': if (!blink) { buffer.set(x + 1, y + 2, eye); buffer.set(x + 2, y + 2, eye); } buffer.set(x, y + 3, ear); buffer.set(x + 3, y + 3, ear); break;
    }
  }

  /** Without color or in Safe Glyphs: one glyph per cell. */
  private drawText(canvas: Canvas, look: ArcadeLook, state: SnakeState, board: Board): void {
    const safe = this.context.safeGlyphs;
    const glyph = (cell: number): string => {
      if (cell === state.body[0]) return state.alive ? '@' : 'x';
      if (state.body.includes(cell)) return safe ? 'o' : '●';
      if (cell === state.treat) return safe ? '%' : '◆';
      if (cell === state.golden) return '$';
      if (state.rocks.has(cell)) return '#';
      return safe ? '.' : '·';
    };
    for (let y = 0; y < state.height; y += 1) for (let x = 0; x < state.width; x += 1) {
      const cell = state.at(x, y);
      const text = glyph(cell).padEnd(board.cw, ' ');
      for (let dy = 0; dy < board.ch; dy += 1) canvas.text(board.x + x * board.cw, board.y + y * board.ch + dy, dy === 0 ? text : ' '.repeat(board.cw), {fg: look.text.normal, bold: cell === state.body[0]});
    }
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void { /* the session stops stepping; nothing else to hold */ }

  hints(): readonly ControlHint[] {
    if (this.screen === 'menu') return [{keys: '↑↓', action: 'mode'}, {keys: '⏎', action: 'start'}, {keys: 'Esc', action: 'back'}];
    return [{keys: '←↑↓→ wasd', action: 'turn'}];
  }

  persist(): void { /* a run is not resumed */ }
  dispose(): void { this.particles.clear(); this.popups.clear(); this.state = undefined; }
}

/** The hub preview: a tail chasing a fish around a small garden, turning at the edges. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
  const cols = Math.min(18, Math.floor(canvas.width / 4));
  const rows = Math.min(8, Math.floor(canvas.height));
  const ox = Math.floor((canvas.width - cols * 4) / 2);
  const oy = Math.floor((canvas.height * 2 - rows * 4) / 2);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) buffer.rect(ox + x * 4, oy + y * 4, 4, 4, (x + y) % 2 ? LAWN_LIGHT : LAWN);
  // A loop around the board's inner ring.
  const ring: Array<[number, number]> = [];
  for (let x = 1; x < cols - 1; x += 1) ring.push([x, 1]);
  for (let y = 2; y < rows - 1; y += 1) ring.push([cols - 2, y]);
  for (let x = cols - 3; x >= 1; x -= 1) ring.push([x, rows - 2]);
  for (let y = rows - 3; y >= 2; y -= 1) ring.push([1, y]);
  const head = frame % ring.length;
  const fish = ring[(head + 6) % ring.length]!;
  buffer.rect(ox + fish[0] * 4, oy + fish[1] * 4 + 1, 3, 2, FISH); buffer.set(ox + fish[0] * 4 + 3, oy + fish[1] * 4, FISH_DARK); buffer.set(ox + fish[0] * 4 + 3, oy + fish[1] * 4 + 3, FISH_DARK);
  for (let index = 7; index >= 0; index -= 1) {
    const [x, y] = ring[(head - index + ring.length) % ring.length]!;
    buffer.rect(ox + x * 4, oy + y * 4, 4, 4, mixRgb(palette.cat.body, look.surface.sunken, index / 12));
  }
  canvas.clear(look.surface.base);
  canvas.blit(buffer);
}

export const snakeGame: GameDefinition = {
  id: 'snake', aliases: ['tail-chase', 'tail'], title: 'Tail Chase', tagline: 'Snake, with a cat at the front',
  description: 'Steer Vespyr around the garden, eat the fish and grow a long lavender tail. Every fish speeds you up; a golden one is worth five and does not wait.',
  kind: 'action', category: 'arcade',
  controls: [{keys: '←↑↓→', action: 'turn'}, {keys: '1-3', action: 'mode'}],
  howToPlay: [
    'Turn with the arrows, WASD or hjkl. You cannot reverse into your own neck, and two quick turns make a corner.',
    'Classic walls are solid, Wrap-around lets you leave one side and enter the other, Garden adds rocks.',
    `A golden fish appears after every five and disappears after ${GOLDEN_MS / 1000} seconds.`,
  ],
  summary: record => scoreSummary(record),
  preview,
  create: context => new TailChase(context),
};
