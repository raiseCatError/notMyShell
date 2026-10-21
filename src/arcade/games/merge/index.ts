import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {easeOutBack, easeOutCubic} from '../../easing.js';
import {ParticleSystem, Popups} from '../../effects.js';
import {confetti} from '../../fx/cells.js';
import {count, direction, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook} from '../../look.js';
import type {ArcadePalette} from '../../palette.js';
import {rgb} from '../../scenery.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {CELL_ASPECT, cellOrigin, squareLayout, type BoardLayout} from '../../engine/boardLayout.js';
import {GOAL, MergeBoard, type Tile} from './logic.js';

/**
 * Merge 2048: slide the tiles, merge equal pairs, reach 2048 and keep going. Every value has its own color (dark ink on
 * the light ones, light ink on the dark ones), tiles slide between cells, merges pop, and three undos per game.
 */
const SLIDE_MS = 110;
const POP_MS = 180;
const TILE: Readonly<Record<number, Rgb>> = {
  2: rgb(0xe6dcff), 4: rgb(0xcbb8ff), 8: rgb(0xffc7a6), 16: rgb(0xff9f86), 32: rgb(0xff8fb3), 64: rgb(0xf06a8f),
  128: rgb(0xffe08a), 256: rgb(0xffc94d), 512: rgb(0x9fe0b8), 1024: rgb(0x5fc9b0), 2048: rgb(0x8fc4ff), 4096: rgb(0x6f8cff),
};
const INK_DARK = rgb(0x231a3d);
const INK_LIGHT = rgb(0xfffaf5);
const tileColor = (value: number): Rgb => TILE[value] ?? rgb(0x4b3fa0);
const inkOn = (value: number): Rgb => (value >= 64 && value !== 128 && value !== 256 && value !== 512 ? INK_LIGHT : INK_DARK);

/** The board's geometry: square slots from the shared helper, plus the well behind them (undefined when there is no room for a margin). */
interface Layout extends BoardLayout { well: {x: number; y: number; w: number; h: number}; roomy: boolean }
const WELL_X = CELL_ASPECT;

class Merge2048 implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private board: MergeBoard;
  private slideMs = SLIDE_MS;
  private popMs = 0;
  private started = false;
  private over = false;
  private celebrated = false;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private pixels = new PixelBuffer(0, 0);
  private readonly startBest: number;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.board = new MergeBoard(context.rng.fork('merge'));
    this.particles = new ParticleSystem(context.rng.fork('merge-fx'), 120, context.motion.effects);
    this.popups = new Popups(5, context.motion.effects);
    this.startBest = readScore(context.record.get()).best;
  }

  get status(): GameStatus { return this.over ? (this.board.reached ? 'won' : 'over') : this.started ? 'playing' : 'ready'; }
  get refreshMs(): number { return this.slideMs < SLIDE_MS || this.popMs > 0 || this.particles.count > 0 ? 30 : 0; }

  step(): void {}

  animate(dtMs: number): void {
    this.slideMs = Math.min(SLIDE_MS, this.slideMs + dtMs);
    this.popMs = Math.max(0, this.popMs - dtMs);
    this.particles.update(dtMs);
    this.popups.update(dtMs);
  }

  key(key: Key): GameKeyResult {
    if (this.over) return 'ignored';
    const move = direction(key);
    if (move) {
      this.started = true;
      const before = this.board.score;
      if (this.board.move(move)) {
        this.slideMs = this.context.motion.reduced ? SLIDE_MS : 0;
        this.popMs = this.context.motion.reduced ? 0 : POP_MS;
        const gained = this.board.score - before;
        const layout = this.layout();
        if (gained && layout) this.popups.add(`+${gained}`, layout.x + 2 * layout.stepX, layout.well.y - 1, rgb(0xffe08a), 600);
        if (this.board.reached && !this.celebrated) {
          this.celebrated = true;
          confetti(this.particles, this.size.columns, this.size.rows * 2, [TILE[2048]!, TILE[128]!, TILE[32]!, TILE[512]!], this.context.motion);
          this.popups.add('2048! keep going', Math.floor(this.size.columns / 2), 2, TILE[2048]!, 1600);
        }
        if (!this.board.canMove) this.finish();
      }
      return 'handled';
    }
    if (key.kind === 'text' && key.value.toLowerCase() === 'u') { this.board.undo(); this.slideMs = SLIDE_MS; return 'handled'; }
    return 'ignored';
  }

  private finish(): void {
    this.over = true;
    const board = this.board;
    const saved = saveScore(this.context.record, board.score, {bestTile: board.best});
    this.result = {
      score: board.score, scoreText: board.score.toLocaleString('en-US'), record: board.score > 0 && board.score > this.startBest,
      details: [`Largest tile ${board.best}`, `${board.moves} moves`, `Best ${saved.best.toLocaleString('en-US')}`, board.reached ? 'Reached 2048' : `Games ${saved.plays}`],
    };
  }

  /**
   * The largest physically square tiles that fit: a roomy tier (a gap of one row and two columns between tiles and a
   * margin of the same around them), a tight tier (no gaps), and finally cramped one-row tiles four columns wide, which
   * are not square but still show every value.
   */
  private layout(): Layout | undefined {
    const n = this.board.size;
    const {columns, rows} = this.size;
    const roomy = squareLayout({columns, rows, top: 2, bottom: 3, left: WELL_X, right: WELL_X}, n, n, {gap: 1, minCellH: 2, maxCellH: 8});
    if (roomy) return {...roomy, roomy: true, well: {x: roomy.x - WELL_X, y: roomy.y - 1, w: roomy.width + 2 * WELL_X, h: roomy.height + 2}};
    const tight = squareLayout({columns, rows, top: 1, bottom: 1}, n, n, {gap: 0, minCellH: 2, maxCellH: 8});
    if (tight) return {...tight, roomy: false, well: {x: tight.x, y: tight.y, w: tight.width, h: tight.height}};
    const width = n * 4, height = n;
    if (width > columns || height + 2 > rows) return undefined;
    const x = Math.floor((columns - width) / 2), y = Math.floor((rows - height) / 2) + 1;
    return {cellW: 4, cellH: 1, gap: 0, x, y, width, height, across: n, down: n, stepX: 4, stepY: 1, roomy: false, well: {x, y, w: width, h: height}};
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    canvas.clear(color ? look.surface.base : undefined);
    const board = this.board;
    topRow(canvas, look, 'Merge 2048', `Score ${board.score.toLocaleString('en-US')}  Best ${Math.max(this.startBest, board.score).toLocaleString('en-US')}  Undo ${board.undosLeft}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), 'Make the window a little larger', {fg: look.warn}); return; }
    const n = board.size;
    const cellX = (cell: number) => cellOrigin(layout, cell % n, Math.floor(cell / n)).x;
    const cellY = (cell: number) => cellOrigin(layout, cell % n, Math.floor(cell / n)).y;
    const well = look.surface.sunken;
    const plain = !color;
    if (color) {
      canvas.fill(layout.well.x, layout.well.y, layout.well.w, layout.well.h, ' ', {bg: well});
      for (let cell = 0; cell < n * n; cell += 1) this.drawTile(canvas, cellX(cell), cellY(cell), layout, mixRgb(well, look.surface.base, 0.6), '', undefined, well);
    } else {
      for (let cell = 0; cell < n * n; cell += 1) canvas.put(cellX(cell) + Math.floor((layout.cellW - 1) / 2), cellY(cell) + Math.floor(layout.cellH / 2), this.context.safeGlyphs ? '.' : '·', {});
    }
    const t = easeOutCubic(this.slideMs / SLIDE_MS);
    const position = (tile: Tile) => ({x: Math.round(cellX(tile.from) + (cellX(tile.cell) - cellX(tile.from)) * t), y: Math.round(cellY(tile.from) + (cellY(tile.cell) - cellY(tile.from)) * t)});
    const sliding = this.slideMs < SLIDE_MS;
    if (sliding) for (const ghost of board.ghosts) { const at = position(ghost); this.drawTile(canvas, at.x, at.y, layout, tileColor(ghost.value), String(ghost.value), inkOn(ghost.value), well, plain); }
    for (const tile of board.tiles) {
      if (sliding && (tile.merged || tile.fresh)) continue;
      const at = position(tile);
      let fill = tileColor(tile.value);
      if (tile.merged && this.popMs > 0) fill = mixRgb(fill, rgb(0xffffff), 0.45 * easeOutBack(this.popMs / POP_MS));
      if (tile.fresh && this.popMs > 0) fill = mixRgb(fill, well, 0.5 * (this.popMs / POP_MS));
      this.drawTile(canvas, at.x, at.y, layout, fill, String(tile.value), inkOn(tile.value), well, plain);
    }
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
    this.popups.draw(canvas, look.surface.base);
    const hintRow = layout.well.y + layout.well.h;
    if (!this.started && hintRow < canvas.height) canvas.center(hintRow, 'Arrows or WASD slide every tile · u undoes (three per game)', {fg: look.text.dim});
  }

  private drawTile(canvas: Canvas, x: number, y: number, layout: Layout, fill: Rgb, text: string, ink: Rgb | undefined, well: Rgb, plain = false): void {
    const {cellW, cellH} = layout;
    const mid = y + Math.floor(cellH / 2);
    if (plain) {
      const safe = this.context.safeGlyphs;
      if (cellH >= 3) {
        const [tl, tr, bl, br, h, v] = safe ? ['+', '+', '+', '+', '-', '|'] : ['┌', '┐', '└', '┘', '─', '│'];
        canvas.text(x, y, `${tl}${h.repeat(cellW - 2)}${tr}`, {bold: true});
        canvas.text(x, y + cellH - 1, `${bl}${h.repeat(cellW - 2)}${br}`, {bold: true});
        for (let dy = 1; dy < cellH - 1; dy += 1) { canvas.put(x, y + dy, v, {bold: true}); canvas.put(x + cellW - 1, y + dy, v, {bold: true}); }
        canvas.text(x + Math.floor((cellW - text.length) / 2), y + Math.floor(cellH / 2), text, {bold: true});
      } else canvas.text(x, mid, `[${text.padStart(Math.max(1, cellW - 2), ' ')}]`.slice(0, cellW), {bold: true});
      return;
    }
    canvas.fill(x, y, cellW, cellH, ' ', {bg: fill});
    // Big tiles space their digits out so a value fills more of the tile.
    const shown = cellH >= 4 && text.length * 2 - 1 <= cellW - 2 ? [...text].join(' ') : text;
    if (shown) canvas.text(x + Math.floor((cellW - shown.length) / 2), y + Math.floor(cellH / 2), shown.slice(0, cellW), {fg: ink, bg: fill, bold: true});
    void well;
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return [{keys: '←↑↓→', action: 'slide'}, {keys: 'u', action: 'undo'}]; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); }
}

/** The hub preview: a board of colored tiles, two of them merging. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const values = [2, 4, 8, 16, 32, 64, 128, 256, 4, 2, 512, 8, 2048, 16, 2, 4];
  const cw = 6, n = 4;
  const left = Math.floor((canvas.width - n * (cw + 1)) / 2), top = Math.max(0, Math.floor((canvas.height - n * 2) / 2));
  const phase = frame % 20;
  canvas.fill(left - 1, top - 1, n * (cw + 1) + 1, n * 2 + 1, ' ', {bg: look.surface.sunken});
  values.forEach((value, index) => {
    const x = left + (index % n) * (cw + 1), y = top + Math.floor(index / n) * 2;
    const shown = index === 1 && phase > 10 ? 8 : value;
    const fill = index === 1 && phase > 10 && phase < 14 ? mixRgb(tileColor(shown), rgb(0xffffff), 0.4) : tileColor(shown);
    canvas.fill(x, y, cw, 1, ' ', {bg: fill});
    canvas.text(x + Math.floor((cw - String(shown).length) / 2), y, String(shown), {fg: inkOn(shown), bg: fill, bold: true});
  });
}

export const mergeGame: GameDefinition = {
  id: 'merge', aliases: ['2048', 'merge-2048'], title: 'Merge 2048', tagline: 'Slide, merge, double',
  description: 'Slide every tile at once; two equal tiles that meet become one worth double. Reach 2048, then see how far you can go. Three undos per game.',
  kind: 'puzzle', category: 'falling',
  controls: [{keys: '←↑↓→', action: 'slide'}, {keys: 'u', action: 'undo'}],
  howToPlay: [
    'An arrow (or WASD) slides every tile as far as it can. Two equal tiles that meet merge into one worth double; a tile only merges once per move.',
    'After every move a new 2 (sometimes a 4) appears. The game ends when no move can change the board. You have three undos.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `${scoreSummary(record)} · tile ${count(record.bestTile)}` : 'Not played yet'; },
  preview,
  create: context => new Merge2048(context),
};
void GOAL;
