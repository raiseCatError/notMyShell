import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {truncateText} from '../../../util/text.js';
import {ParticleSystem} from '../../effects.js';
import {cellX, cellY} from '../../engine/grid.js';
import {confetti, Reveal} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook, distinctColors} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import {rgb} from '../../scenery.js';
import type {ControlHint, Finale, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {generateLines, LinesBoard, SIZES} from './logic.js';

/**
 * Yarn Lines: join each pair of same-colored yarn ends with a path so that no paths cross and every cell is covered.
 * Every color has a letter (capital on its ends, small along its path), so the board never relies on hue alone, and the
 * footer lists which colors are already linked. Moving the cursor while a yarn is picked up draws it; Space picks up
 * or lets go; going back over your own path pulls it in; crossing another color cuts that one.
 */
const INK = rgb(0x1a1530);
const WHITE = rgb(0xffffff);
const LAYOUTS: ReadonlyArray<readonly [number, number]> = [[4, 2], [3, 1], [2, 1]];

class YarnLines implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private screen: 'menu' | 'play' = 'menu';
  private menu: Menu;
  private board: LinesBoard | undefined;
  private n = 5;
  private cursor = 0;
  private undos = 0;
  private hintsUsed = 0;
  private note = '';
  private won = false;
  private wave: Reveal | undefined;
  private startBest = 0;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private pixels = new PixelBuffer(0, 0);

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('lines-fx'), 120, context.motion.effects);
    const raw = context.record.get();
    this.menu = new Menu(SIZES.map(size => ({id: String(size), label: `${size} × ${size}`, key: String(size), hint: count(raw[`best${size}`]) ? `best ${count(raw[`best${size}`])}` : `${size} colors`})));
  }

  get status(): GameStatus { return this.screen === 'menu' ? 'ready' : this.won ? 'won' : 'playing'; }
  get finale(): Finale | undefined { return this.won ? this.wave : undefined; }
  get refreshMs(): number { return (this.wave && !this.wave.done) || this.particles.count ? 40 : 0; }

  private start(size: number): void {
    this.n = size;
    this.board = new LinesBoard(generateLines(size, createRng(this.context.rng.int(1, 0x7fffffff))));
    this.cursor = 0;
    this.undos = 0; this.hintsUsed = 0; this.note = '';
    this.won = false; this.wave = undefined; this.result = undefined;
    this.screen = 'play';
    this.startBest = count(this.context.record.get()[`best${size}`]);
    this.particles.clear();
  }

  step(): void {}
  animate(dtMs: number): void { this.wave?.update(dtMs); this.particles.update(dtMs); }

  key(key: Key): GameKeyResult {
    if (this.screen === 'menu') {
      if (key.kind === 'escape') return 'ignored';
      const choice = this.menu.key(key);
      if (choice) this.start(Number(choice));
      return 'handled';
    }
    const board = this.board!;
    if (this.won) { this.wave?.skip(); return 'ignored'; }
    this.note = '';
    const move = direction(key);
    if (move) {
      const x = cellX(board.shape, this.cursor) + (move === 'left' ? -1 : move === 'right' ? 1 : 0);
      const y = cellY(board.shape, this.cursor) + (move === 'up' ? -1 : move === 'down' ? 1 : 0);
      if (x < 0 || y < 0 || x >= this.n || y >= this.n) return 'handled';
      const target = y * this.n + x;
      if (board.active !== undefined) {
        if (!board.move(target)) return 'handled';
        this.cursor = target;
        this.check();
      } else this.cursor = target;
      return 'handled';
    }
    if (isConfirm(key)) {
      if (board.active !== undefined) { board.stop(); return 'handled'; }
      const snap = board.snapshot();
      if (board.begin(this.cursor)) { board.history.push(snap); if (board.history.length > 200) board.history.shift(); }
      else this.note = 'Pick up a yarn end, or a cell of a path';
      return 'handled';
    }
    if (key.kind === 'escape') { if (board.active !== undefined) { board.stop(); return 'handled'; } return 'ignored'; }
    if (key.kind !== 'text') return 'ignored';
    const value = key.value.toLowerCase();
    if (value === 'u') {
      const previous = board.history.pop();
      if (previous) { board.restore(previous); this.undos += 1; } else this.note = 'Nothing to undo';
      return 'handled';
    }
    if (value === 'r') { board.history.push(board.snapshot()); board.clear(); this.note = 'Cleared (u undoes)'; return 'handled'; }
    if (value === 't') { this.hint(); return 'handled'; }
    return 'ignored';
  }

  private hint(): void {
    const board = this.board!;
    const wrong = board.data.solution.map((cells, color) => ({cells, color})).filter(({cells, color}) => !board.complete(color) || board.paths[color]!.some(cell => !cells.includes(cell)));
    const pick = wrong[0];
    if (!pick) return;
    board.history.push(board.snapshot());
    board.place(pick.color, pick.cells);
    this.hintsUsed += 1;
    this.note = `Hint: ${String.fromCharCode(65 + pick.color)} laid in`;
    this.check();
  }

  private check(): void {
    const board = this.board!;
    if (!board.won || this.won) return;
    this.won = true;
    board.stop();
    const score = Math.max(10, this.n * this.n * 10 - this.undos * 5 - this.hintsUsed * 50);
    const saved = saveScore(this.context.record, score, {[`best${this.n}`]: score});
    const groups = board.data.solution.flatMap(path => path.map(cell => [cell]));
    this.wave = new Reveal(groups, this.context.motion, {stagger: 22, within: 0, rise: 140, hold: 200, fall: 400});
    const look = arcadeLook();
    confetti(this.particles, this.size.columns, this.size.rows * 2, [look.ok, look.hue.rose, look.hue.butter, look.hue.sky], this.context.motion);
    this.result = {
      score, scoreText: score.toLocaleString('en-US'), record: score > this.startBest,
      details: [`${this.n} × ${this.n} board, ${this.n} colors`, `Undos ${this.undos} · hints ${this.hintsUsed}`, `Best ${Math.max(this.startBest, score)}`, `Solved ${saved.plays}`],
    };
  }

  private layout(): {cw: number; ch: number; x: number; y: number} | undefined {
    for (const [cw, ch] of LAYOUTS) {
      if (this.n * cw <= this.size.columns && this.n * ch + 3 <= this.size.rows) return {cw, ch, x: Math.floor((this.size.columns - this.n * cw) / 2), y: 1 + Math.floor((this.size.rows - 3 - this.n * ch) / 2) + (this.size.rows - 3 - this.n * ch > 1 ? 1 : 0)};
    }
    return undefined;
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.board) {
      topRow(canvas, look, 'Yarn Lines', scoreSummary(this.context.record.get()));
      const top = Math.max(2, Math.floor(canvas.height / 2) - 4);
      canvas.center(top, 'Choose a board', {fg: look.text.strong, bold: true});
      canvas.center(top + 1, 'Join the pairs, fill every cell.', {fg: look.text.normal});
      this.menu.draw(canvas, palette, 0, top + 3, canvas.width);
      return;
    }
    const board = this.board;
    topRow(canvas, look, `Yarn Lines · ${this.n}×${this.n}`, `Linked ${board.connected}/${this.n}  Filled ${board.filled}/${this.n * this.n}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), 'Make the window a little larger', {fg: look.warn}); return; }
    const colors = distinctColors(this.n, look);
    const well = look.surface.sunken;
    if (color) canvas.fill(layout.x - 1, layout.y - 1, this.n * layout.cw + 2, this.n * layout.ch + 2, ' ', {bg: well});
    for (let cell = 0; cell < this.n * this.n; cell += 1) {
      const px = layout.x + (cell % this.n) * layout.cw, py = layout.y + Math.floor(cell / this.n) * layout.ch;
      const isEnd = board.endOf(cell) >= 0;
      const owner = isEnd ? board.endOf(cell) : board.ownerOf(cell);
      const glow = this.wave && this.wave.has(cell) ? this.wave.amount(cell) : 0;
      let bg = well;
      let fg: Rgb = look.text.dim;
      let letter = (cell + Math.floor(cell / this.n)) % 2 ? '·' : ' ';
      if (this.context.safeGlyphs || !color) letter = '.';
      if (owner >= 0) {
        const hue = colors[owner]!;
        bg = isEnd ? hue : mixRgb(hue, well, 0.55);
        fg = isEnd ? INK : mixRgb(hue, WHITE, 0.55);
        const base = String.fromCharCode(65 + owner);
        letter = isEnd ? base : base.toLowerCase();
        if (glow > 0) bg = mixRgb(bg, WHITE, 0.5 * glow);
      }
      const cursor = cell === this.cursor;
      const main = py + Math.floor((layout.ch - 1) / 2);
      if (color) canvas.fill(px, py, layout.cw, layout.ch, ' ', {bg});
      const style = {fg: color ? fg : undefined, bg: color ? bg : undefined, bold: isEnd, reverse: !color && cursor && layout.cw < 3, underline: cursor && layout.cw < 3};
      if (layout.cw >= 3) {
        const mid = px + Math.floor(layout.cw / 2) - (layout.cw === 4 ? 1 : 0);
        canvas.put(mid, main, letter, style);
        if (isEnd) { canvas.put(mid - 1, main, layout.cw >= 3 ? '(' : ' ', style); canvas.put(mid + 1, main, ')', style); }
        if (cursor) { canvas.put(px, main, '[', {fg: color ? look.text.strong : undefined, bg: color ? bg : undefined, bold: true}); canvas.put(px + layout.cw - 1, main, ']', {fg: color ? look.text.strong : undefined, bg: color ? bg : undefined, bold: true}); }
      } else canvas.put(px, main, letter, style);
    }
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
    const footer = Math.min(canvas.height - 1, layout.y + this.n * layout.ch + 1);
    const linked = [...Array(this.n).keys()].filter(c => board.complete(c)).map(c => String.fromCharCode(65 + c)).join(' ');
    const line = this.won ? 'Solved! Every pair joined, every cell covered.' : this.note || (board.active !== undefined ? `Drawing ${String.fromCharCode(65 + board.active)}: arrows extend, Space lets go` : `Linked: ${linked || 'none'} · Space picks up a yarn`);
    canvas.center(footer, truncateText(line, canvas.width - 2), {fg: this.won ? look.ok : look.text.dim, bold: this.won});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return HINTS; }
  persist(): void {}
  dispose(): void { this.particles.clear(); }
}

const HINTS: readonly ControlHint[] = [{keys: '←↑↓→', action: 'move / draw'}, {keys: 'Space', action: 'pick up / let go'}, {keys: 'u', action: 'undo'}, {keys: 't', action: 'hint'}, {keys: 'r', action: 'clear'}];

/** The hub preview: a small board with a yarn path growing across it. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const colors = distinctColors(4, look);
  const route: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
    [[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 1], [0, 2], [0, 3], [1, 3]], [[1, 1], [2, 1], [3, 1], [3, 2]], [[1, 2], [2, 2], [2, 3], [3, 3]],
  ];
  const cw = 5, left = Math.floor((canvas.width - 4 * cw) / 2), top = Math.max(0, Math.floor((canvas.height - 8) / 2));
  const shown = (frame % 40) / 2;
  let drawn = 0;
  route.forEach((cells, c) => cells.forEach(([x, y], index) => {
    drawn += 1;
    if (drawn > shown && index !== 0 && index !== cells.length - 1) return;
    const end = index === 0 || index === cells.length - 1;
    canvas.fill(left + x * cw, top + y * 2, cw - 1, 2, ' ', {bg: end ? colors[c]! : mixRgb(colors[c]!, look.surface.sunken, 0.5)});
    canvas.put(left + x * cw + 1, top + y * 2, end ? String.fromCharCode(65 + c) : String.fromCharCode(97 + c), {fg: INK, bg: end ? colors[c]! : mixRgb(colors[c]!, look.surface.sunken, 0.5), bold: true});
  }));
}

export const linesGame: GameDefinition = {
  id: 'lines', aliases: ['yarn-lines', 'flow'], title: 'Yarn Lines', tagline: 'Join the pairs, fill the board',
  description: 'Connect each pair of same-lettered yarn ends with a path that never crosses another and, together, covers every cell. Boards from 5 × 5 to 8 × 8 are generated fresh and always have a solution.',
  kind: 'puzzle', category: 'logic', controls: HINTS,
  howToPlay: [
    'Move the cursor onto a yarn end (a capital letter) and press Space, then use the arrows to draw its path to the matching end. Space lets go.',
    'Paths cannot cross: drawing over another color cuts it, and stepping back over your own path pulls it in. Win when every pair is joined and no cell is empty. u undoes a stroke, t lays in one path.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? scoreSummary(record) : 'Not played yet'; },
  preview,
  create: context => new YarnLines(context),
};
