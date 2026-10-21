import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {displayWidth} from '../../../util/text.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem} from '../../effects.js';
import {confetti, Reveal} from '../../fx/cells.js';
import {count, direction, topRow} from '../../kit.js';
import {arcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import type {ControlHint, Finale, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {PICTURE, PICTURE_COLORS, SIZES, SlideBoard} from './logic.js';

/**
 * Tile Slide: the 15-puzzle in three sizes. Arrow keys slide the tile on the far side of the blank toward it; a click
 * slides a whole line. Numbers are always drawn (a picture mode adds a cat portrait behind them in color terminals), so
 * nothing depends on color. The best move count is kept per size.
 */
const key = (n: number): string => `best${n}`;

export function readSlide(raw: Readonly<Record<string, unknown>>): {plays: number; wins: number; best: Record<number, number>} {
  return {plays: count(raw.plays), wins: count(raw.wins), best: {3: count(raw.best3), 4: count(raw.best4), 5: count(raw.best5)}};
}

class TileSlide implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private screen: 'menu' | 'play' = 'menu';
  private board: SlideBoard | undefined;
  private picture = false;
  private readonly menu: Menu;
  private wave: Reveal | undefined;
  private readonly particles: ParticleSystem;
  private pixels = new PixelBuffer(0, 0);
  private size: {columns: number; rows: number};
  private startBest = 0;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('slide-fx'), 140, context.motion.effects);
    const saved = readSlide(context.record.get());
    this.menu = new Menu(SIZES.map(n => ({id: String(n), label: `${n} × ${n}`, key: String(n - 2), hint: `${n * n - 1} tiles${saved.best[n] ? ` · best ${saved.best[n]}` : ''}`})));
  }

  get status(): GameStatus {
    if (this.screen === 'menu' || !this.board) return 'ready';
    return this.board.solved ? 'won' : 'playing';
  }
  get finale(): Finale | undefined { return this.board?.solved ? this.wave : undefined; }
  get refreshMs(): number { return (this.wave && !this.wave.done) || this.particles.count ? 40 : 0; }
  private get canPicture(): boolean { return this.context.color !== 'none' && !this.context.safeGlyphs; }

  private start(n: number): void {
    this.board = new SlideBoard(n, undefined, createRng(this.context.rng.int(1, 0x7fffffff)));
    this.screen = 'play';
    this.wave = undefined;
    this.result = undefined;
    this.startBest = readSlide(this.context.record.get()).best[n]!;
  }

  step(): void {}
  animate(dtMs: number): void { this.wave?.update(dtMs); this.particles.update(dtMs); }

  private after(moved: boolean): GameKeyResult {
    const board = this.board!;
    if (moved && board.solved) this.finish();
    return moved ? 'handled' : 'ignored';
  }

  private finish(): void {
    const board = this.board!, n = board.n;
    const rows = Array.from({length: n}, (_, y) => Array.from({length: n}, (_, x) => y * n + x));
    this.wave = new Reveal(rows, this.context.motion, {stagger: 90, within: 25, rise: 140, hold: 240, fall: 400});
    const saved = readSlide(this.context.record.get());
    const record = this.startBest === 0 || board.moves < this.startBest;
    this.context.record.update(raw => {
      raw.plays = count(raw.plays) + 1;
      raw.wins = count(raw.wins) + 1;
      if (record) raw[key(n)] = Math.max(1, board.moves);
    });
    const best = record ? board.moves : saved.best[n]!;
    this.result = {score: board.moves, scoreText: `${board.moves} moves`, record, details: [`${n} × ${n}`, `Best ${best} moves`, `Solved ${saved.wins + 1} times`]};
    const look = arcadeLook();
    confetti(this.particles, this.size.columns, this.size.rows * 2, [look.ok, look.hue.rose, look.hue.butter, look.hue.sky], this.context.motion);
  }

  key(k: Key): GameKeyResult {
    if (this.screen === 'menu') {
      if (k.kind === 'escape') return 'ignored';
      const choice = this.menu.key(k);
      if (choice) this.start(Number(choice));
      return 'handled';
    }
    const board = this.board!;
    if (board.solved) { this.wave?.skip(); return 'ignored'; }
    const move = direction(k);
    if (move) return this.after(board.slide(move));
    if (k.kind === 'mouseClick') {
      const at = 'x' in k && typeof k.x === 'number' && typeof k.y === 'number' ? this.cellAt(k.x - 1, k.y - 1) : undefined;
      return at === undefined ? 'ignored' : this.after(board.pick(at));
    }
    if (k.kind === 'text') {
      const value = k.value.toLowerCase();
      if (value === 'u') return board.undo() ? 'handled' : 'ignored';
      if (value === 'g' && this.canPicture) { this.picture = !this.picture; return 'handled'; }
      if (value === 'r') { this.start(board.n); return 'handled'; }
    }
    return 'ignored';
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  private layout(): {tw: number; th: number; x: number; y: number} | undefined {
    const n = this.board!.n;
    for (const [tw, th] of [[8, 4], [6, 3], [4, 2], [3, 1]] as const) {
      if (n * tw > this.size.columns || n * th + 2 > this.size.rows) continue;
      return {tw, th, x: Math.floor((this.size.columns - n * tw) / 2), y: 1 + Math.floor((this.size.rows - 2 - n * th) / 2)};
    }
    return undefined;
  }

  private cellAt(column: number, row: number): number | undefined {
    const layout = this.board && this.layout();
    if (!layout) return undefined;
    const x = Math.floor((column - layout.x) / layout.tw), y = Math.floor((row - layout.y) / layout.th);
    const n = this.board!.n;
    return x >= 0 && y >= 0 && x < n && y < n ? y * n + x : undefined;
  }

  private pixel(tile: number, n: number, u: number, v: number): Rgb {
    const home = tile - 1;
    const px = Math.min(15, Math.floor(((home % n) + u) / n * 16)), py = Math.min(15, Math.floor((Math.floor(home / n) + v) / n * 16));
    const [red, green, blue] = PICTURE_COLORS[PICTURE[py]![px]!] ?? PICTURE_COLORS['.']!;
    return {red, green, blue};
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    const safe = this.context.safeGlyphs;
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.board) {
      const saved = readSlide(this.context.record.get());
      topRow(canvas, look, 'Tile Slide', saved.plays ? `Solved ${saved.wins}` : 'Not played yet');
      const top = Math.max(1, Math.floor(canvas.height / 2) - 3);
      canvas.center(top, 'Choose a board', {fg: look.text.strong, bold: true});
      if (canvas.height >= 9) canvas.center(top + 1, 'Every shuffle can be solved.', {fg: look.text.dim});
      this.menu.draw(canvas, palette, 0, top + (canvas.height >= 9 ? 3 : 2), canvas.width);
      return;
    }
    const board = this.board, n = board.n;
    topRow(canvas, look, `Tile Slide · ${n}×${n}`, `Moves ${board.moves}  Best ${this.startBest ? Math.min(this.startBest, board.solved ? board.moves : this.startBest) : '-'}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), `Needs ${n * 3}×${n + 2}`, {fg: look.warn}); return; }
    const {tw, th} = layout;
    const usePicture = this.picture && this.canPicture;
    board.tiles.forEach((tile, cell) => {
      const x = layout.x + (cell % n) * tw, y = layout.y + Math.floor(cell / n) * th;
      if (tile === 0) return;
      const home = tile === cell + 1;
      const glow = this.wave?.amount(cell) ?? 0;
      const gapX = tw >= 4 ? 1 : 0, gapY = th >= 2 ? 1 : 0;
      const w = tw - gapX, h = th - gapY;
      const bg = mixRgb(home ? look.surface.raised2 : look.surface.raised, look.ok, 0.4 * glow);
      const label = String(tile);
      if (usePicture) {
        for (let row = 0; row < h; row += 1) for (let col = 0; col < w; col += 1) {
          const u = (col + 0.5) / w, v0 = (row * 2 + 0.5) / (h * 2), v1 = (row * 2 + 1.5) / (h * 2);
          canvas.put(x + col, y + row, '▀', {fg: mixRgb(this.pixel(tile, n, u, v0), look.ok, 0.3 * glow), bg: mixRgb(this.pixel(tile, n, u, v1), look.ok, 0.3 * glow)});
        }
        canvas.text(x, y, ` ${label}`.padEnd(Math.min(w, 3), ' '), {fg: look.text.strong, bg: look.surface.sunken, bold: true});
        return;
      }
      canvas.fill(x, y, w, h, ' ', {bg: color ? bg : undefined});
      if (!color && w >= 3) for (let row = 0; row < h; row += 1) { canvas.put(x, y + row, '[', {}); canvas.put(x + w - 1, y + row, ']', {}); }
      const text = label.length > w ? label.slice(0, w) : label;
      canvas.text(x + Math.floor((w - displayWidth(text)) / 2), y + Math.floor((h - 1) / 2), text, {fg: home ? look.ok : look.text.strong, bg: color ? bg : undefined, bold: true});
    });
    // The blank is an outline so it is findable without color.
    const blank = board.blank, bx = layout.x + (blank % n) * tw, by = layout.y + Math.floor(blank / n) * th;
    canvas.text(bx, by, safe || !color ? '. .' : '· ·', {fg: look.text.dim});
    const note = board.solved ? 'Solved!' : usePicture ? 'g numbers · u undo · r reshuffle' : this.canPicture ? 'g picture · u undo · r reshuffle' : 'u undo · r reshuffle';
    canvas.center(canvas.height - 1, note.slice(0, canvas.width - 2), {fg: board.solved ? look.ok : look.text.dim, bold: board.solved});
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] {
    if (this.screen === 'menu') return [{keys: '↑↓', action: 'size'}, {keys: '⏎', action: 'start'}, {keys: 'Esc', action: 'back'}];
    return [{keys: '←↑↓→', action: 'slide'}, {keys: 'u', action: 'undo'}, ...(this.canPicture ? [{keys: 'g', action: 'picture'}] : [])];
  }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.wave = undefined; this.board = undefined; }
}

function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const n = 3, tw = Math.min(6, Math.floor(canvas.width / 4)), th = Math.min(2, Math.floor((canvas.height - 1) / n)) || 1;
  const left = Math.floor((canvas.width - n * tw) / 2), top = Math.floor((canvas.height - n * th) / 2);
  const hole = Math.floor(frame / 6) % 9;
  for (let cell = 0; cell < 9; cell += 1) {
    if (cell === hole) continue;
    const tile = cell < hole ? cell + 1 : cell;
    canvas.fill(left + (cell % n) * tw, top + Math.floor(cell / n) * th, tw - 1, Math.max(1, th - (th > 1 ? 1 : 0)), ' ', {bg: (cell + Math.floor(cell / 3)) % 2 ? look.surface.raised : look.surface.raised2});
    canvas.text(left + (cell % n) * tw + Math.floor((tw - 2) / 2), top + Math.floor(cell / n) * th, String(tile), {fg: look.text.strong, bg: (cell + Math.floor(cell / 3)) % 2 ? look.surface.raised : look.surface.raised2, bold: true});
  }
}

export const slideGame: GameDefinition = {
  id: 'slide', aliases: ['tile-slide', 'tiles', '15-puzzle'], title: 'Tile Slide', tagline: 'Put the tiles in order',
  description: 'The classic sliding puzzle in three sizes. Every shuffle can be solved; finish in as few moves as you can.',
  kind: 'puzzle', category: 'logic',
  controls: [{keys: '←↑↓→', action: 'slide'}, {keys: 'u', action: 'undo'}, {keys: 'g', action: 'picture'}],
  howToPlay: [
    'Slide tiles into the gap until the numbers read 1, 2, 3… left to right, top to bottom, with the gap last.',
    'An arrow slides the neighbouring tile that way into the gap. Clicking a tile slides its whole line. g shows a cat picture in color terminals.',
  ],
  summary: record => {
    const saved = readSlide(record);
    const size = ([5, 4, 3] as const).find(n => saved.best[n]);
    return size ? `Best ${saved.best[size]} moves · ${size}×${size}` : 'Not played yet';
  },
  preview,
  create: context => new TileSlide(context),
};
