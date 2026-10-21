import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups} from '../../effects.js';
import {confetti} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {rgb} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {HEIGHT, KINDS, MOVES, TreatBoard, WIDTH, type Step} from './logic.js';

/**
 * Treat Match: swap neighbouring treats to line up three or more. Each kind has its own color and its own shape (and a
 * letter when color or glyphs are off), so no match depends on telling hues apart. Cleared treats flash, the rest fall,
 * and cascades play out one step at a time; any key skips to the end of the cascade.
 */
const FLASH_MS = 170;
const FALL_MS = 130;
const COLORS: readonly Rgb[] = [rgb(0xff8fb3), rgb(0xffc94d), rgb(0x5fc9b0), rgb(0x8fc4ff), rgb(0xb89cff), rgb(0xff9f86)];
const SHAPES = ['♥', '●', '◆', '▲', '■', '★'] as const;
const LETTERS = ['F', 'M', 'C', 'B', 'K', 'T'] as const;
const NAMES = ['fish', 'milk', 'cookie', 'bone', 'kibble', 'tuna'] as const;
const INK = rgb(0x231a3d);

class TreatMatch implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private board: TreatBoard;
  private shown: number[];
  private cursor = 0;
  private selected: number | undefined;
  private queue: Step[] = [];
  private flashing: ReadonlySet<number> = new Set();
  private timer = 0;
  private started = false;
  private over = false;
  private hintCells: [number, number] | undefined;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private pixels = new PixelBuffer(0, 0);
  private readonly startBest: number;
  private shownScore = 0;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.board = new TreatBoard(context.rng.fork('treats'));
    this.shown = this.board.cells.slice();
    this.particles = new ParticleSystem(context.rng.fork('treats-fx'), 120, context.motion.effects);
    this.popups = new Popups(5, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.over ? 'over' : this.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.queue.length || this.flashing.size || this.particles.count ? 30 : 0; }
  private get busy(): boolean { return this.queue.length > 0 || this.flashing.size > 0; }

  step(): void {}

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    if (!this.busy) return;
    this.timer -= dtMs;
    while (this.timer <= 0 && this.busy) this.advance();
  }

  /** One beat of the cascade: flash the next step's cleared treats, then let the board fall into place. */
  private advance(): void {
    if (this.flashing.size) {
      this.shown = this.queue.shift()!.after.slice();
      this.flashing = new Set();
      this.timer += this.context.motion.reduced ? 0 : FALL_MS;
      if (!this.queue.length) this.settleDone();
      return;
    }
    const step = this.queue[0]!;
    this.flashing = new Set(step.cleared);
    this.timer += this.context.motion.reduced ? 0 : FLASH_MS;
    const layout = this.layout();
    if (layout) {
      const middle = step.cleared[Math.floor(step.cleared.length / 2)]!;
      this.popups.add(step.chain > 1 ? `+${step.gained} x${step.chain}` : `+${step.gained}`, layout.x + (middle % WIDTH) * layout.cw, layout.y + Math.floor(middle / WIDTH) * layout.rowStep - 1, COLORS[this.shown[middle]! % KINDS]!, 700);
    }
  }

  private settleDone(): void {
    this.shown = this.board.cells.slice();
    this.hintCells = undefined;
    if (this.board.over) this.finish();
  }

  private skip(): void {
    this.queue = []; this.flashing = new Set(); this.timer = 0;
    this.settleDone();
  }

  key(key: Key): GameKeyResult {
    if (this.over) return 'ignored';
    if (this.busy) { this.skip(); return 'handled'; }
    const move = direction(key);
    if (move) {
      this.started = true;
      this.hintCells = undefined;
      const dx = move === 'left' ? -1 : move === 'right' ? 1 : 0, dy = move === 'up' ? -1 : move === 'down' ? 1 : 0;
      const x = this.cursor % WIDTH + dx, y = Math.floor(this.cursor / WIDTH) + dy;
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return 'handled';
      const target = y * WIDTH + x;
      if (this.selected !== undefined) { const from = this.selected; this.selected = undefined; this.cursor = target; this.trySwap(from, target); } else this.cursor = target;
      return 'handled';
    }
    if (isConfirm(key)) {
      this.started = true;
      if (this.selected === undefined) this.selected = this.cursor;
      else if (this.selected === this.cursor) this.selected = undefined;
      else if (this.board.adjacent(this.selected, this.cursor)) { const from = this.selected; this.selected = undefined; this.trySwap(from, this.cursor); }
      else this.selected = this.cursor;
      return 'handled';
    }
    if (key.kind === 'text' && key.value.toLowerCase() === 'h') { this.hintCells = this.board.hint(); return 'handled'; }
    if (key.kind === 'escape' && this.selected !== undefined) { this.selected = undefined; return 'handled'; }
    return 'ignored';
  }

  private trySwap(a: number, b: number): void {
    const swapped = this.shown.slice();
    [swapped[a], swapped[b]] = [swapped[b]!, swapped[a]!];
    const steps = this.board.swap(a, b);
    if (!steps) { this.popups.add('no match', this.layout()?.x ?? 0, (this.layout()?.y ?? 2) - 1, rgb(0xffb86c), 600); return; }
    this.shown = swapped;
    this.queue = steps;
    this.timer = 0;
    if (this.context.motion.reduced) this.skip();
  }

  private finish(): void {
    this.over = true;
    const board = this.board;
    const saved = saveScore(this.context.record, board.score, {bestChain: board.bestChain});
    const record = board.score > 0 && board.score > this.startBest;
    if (record) confetti(this.particles, this.size.columns, this.size.rows * 2, COLORS, this.context.motion);
    this.result = {
      score: board.score, scoreText: board.score.toLocaleString('en-US'), record,
      details: [`Longest cascade x${board.bestChain}`, `${MOVES} moves used`, `Best ${saved.best.toLocaleString('en-US')}`, `Games ${saved.plays}`],
    };
  }

  private layout(): {cw: number; ch: number; rowStep: number; x: number; y: number} | undefined {
    for (const [cw, ch] of [[6, 3], [5, 2], [4, 1], [3, 1]] as const) {
      const width = WIDTH * cw, height = HEIGHT * ch;
      if (width <= this.size.columns && height + 3 <= this.size.rows) return {cw, ch, rowStep: ch, x: Math.floor((this.size.columns - width) / 2), y: 2 + Math.floor((this.size.rows - 3 - height) / 2)};
    }
    return undefined;
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    const glyphs = color && !this.context.safeGlyphs;
    canvas.clear(color ? look.surface.base : undefined);
    const board = this.board;
    this.shownScore = this.over || !this.busy ? board.score : this.shownScore;
    topRow(canvas, look, 'Treat Match', `Score ${board.score.toLocaleString('en-US')}  Best ${Math.max(this.startBest, board.score).toLocaleString('en-US')}  Moves ${board.movesLeft}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), 'Make the window a little larger', {fg: look.warn}); return; }
    const well = look.surface.sunken;
    if (color) canvas.fill(layout.x - 1, layout.y - 1, WIDTH * layout.cw + 2, HEIGHT * layout.ch + 2, ' ', {bg: well});
    const lines = this.hintCells ? new Set<number>(this.hintCells) : new Set<number>();
    for (let cell = 0; cell < this.shown.length; cell += 1) {
      const kind = this.shown[cell]!;
      const x = layout.x + (cell % WIDTH) * layout.cw, y = layout.y + Math.floor(cell / WIDTH) * layout.ch;
      const flash = this.flashing.has(cell);
      const isCursor = cell === this.cursor, isSelected = cell === this.selected;
      const symbol = glyphs ? SHAPES[kind]! : LETTERS[kind]!;
      if (!color) {
        const text = isSelected ? `<${symbol}>` : isCursor ? `[${symbol}]` : lines.has(cell) ? `*${symbol}*` : ` ${symbol} `;
        canvas.text(x + Math.floor((layout.cw - 3) / 2), y + Math.floor(layout.ch / 2), flash ? ' . ' : text, {bold: isSelected || isCursor});
        continue;
      }
      let fill = COLORS[kind]!;
      if (flash) fill = mixRgb(fill, rgb(0xffffff), 0.75);
      else if (isSelected) fill = mixRgb(fill, rgb(0xffffff), 0.4);
      else if (lines.has(cell)) fill = mixRgb(fill, rgb(0xffffff), 0.25);
      const w = layout.cw - 1, h = layout.ch === 1 ? 1 : layout.ch - (layout.ch === 3 ? 1 : 0);
      if (layout.ch === 3) { canvas.hline(x, y, w, '▄', {fg: fill, bg: well}); canvas.fill(x, y + 1, w, 1, ' ', {bg: fill}); canvas.hline(x, y + 2, w, '▀', {fg: fill, bg: well}); }
      else canvas.fill(x, y, w, h, ' ', {bg: fill});
      const middle = y + Math.floor(layout.ch / 2);
      canvas.put(x + Math.floor(w / 2), middle, flash ? '✦' : symbol, {fg: INK, bg: fill, bold: true});
      if (isCursor || isSelected) {
        const edge = isSelected ? look.text.strong : look.accent;
        canvas.put(x - (layout.cw > 3 ? 0 : 0), middle, isSelected ? '▶' : '▌', {fg: edge, bg: well});
        canvas.put(x + w, middle, isSelected ? '◀' : '▐', {fg: edge, bg: well});
      }
    }
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
    this.popups.draw(canvas, look.surface.base);
    const footer = layout.y + HEIGHT * layout.ch + 1;
    if (footer < canvas.height) {
      const kindName = NAMES[this.shown[this.cursor]! % KINDS]!;
      canvas.center(footer, !this.started ? 'Arrows move · Space picks a treat, then an arrow swaps it · h hints' : this.selected !== undefined ? `Swap the ${kindName}: press an arrow` : `${kindName}`, {fg: look.text.dim});
    }
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: '←↑↓→', action: 'move / swap'}, {keys: 'Space', action: 'pick'}, {keys: 'h', action: 'hint'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

/** The hub preview: a board of treats where one swap keeps clearing a row. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const n = 6, cw = 5;
  const left = Math.floor((canvas.width - n * cw) / 2), top = Math.max(0, Math.floor((canvas.height - n * 2) / 2));
  const phase = frame % 24;
  for (let cell = 0; cell < n * n; cell += 1) {
    const x = cell % n, y = Math.floor(cell / n);
    let kind = (x * 2 + y * 3 + (x ^ y)) % KINDS;
    const row = y === 3 && phase > 12 && phase < 18;
    if (row) kind = 1;
    const fill = row ? mixRgb(COLORS[kind]!, rgb(0xffffff), 0.6) : COLORS[kind]!;
    canvas.fill(left + x * cw, top + y * 2, cw - 1, 1, ' ', {bg: fill});
    canvas.put(left + x * cw + 1, top + y * 2, SHAPES[kind]!, {fg: INK, bg: fill, bold: true});
  }
}

export const treatsGame: GameDefinition = {
  id: 'treats', aliases: ['treat-match', 'match3', 'match-three'], title: 'Treat Match', tagline: 'Swap, match, cascade',
  description: 'Swap two neighbouring treats to line up three or more. Matches clear, the rest fall and new ones drop in, and a lucky fall can chain into a cascade worth more each step. Thirty moves to score as high as you can.',
  kind: 'puzzle', category: 'falling',
  controls: [{keys: '←↑↓→', action: 'move / swap'}, {keys: 'Space', action: 'pick'}, {keys: 'h', action: 'hint'}],
  howToPlay: [
    'Move the cursor, press Space to pick a treat, then an arrow to swap it with that neighbour. A swap only counts if it makes a line of three or more.',
    'Longer lines score extra and every cascade step is worth more than the one before. You have thirty moves; if no swap is possible the board reshuffles for free.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · chain x${count(record.bestChain)}` : 'Not played yet'; },
  preview,
  create: context => new TreatMatch(context),
};
