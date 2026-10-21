import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {truncateText} from '../../../util/text.js';
import {ParticleSystem} from '../../effects.js';
import {cellAt, cellOrigin, squareLayout, type BoardLayout} from '../../engine/boardLayout.js';
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
const PULSE_MS_PER_CELL = 45;

/** Whether pixel (px, py) of a size x size end cell is inside the color's own silhouette (a different shape per color). */
export function shapeHas(color: number, size: number, px: number, py: number): boolean {
  if (size < 4) return true;
  const u = (px + 0.5 - size / 2) / (size / 2), v = (py + 0.5 - size / 2) / (size / 2);
  const au = Math.abs(u), av = Math.abs(v);
  switch (color % 8) {
    case 0: return u * u + v * v <= 1;
    case 1: return au <= 0.76 && av <= 0.76;
    case 2: return au + av <= 1.15;
    case 3: return v >= -0.95 && v <= 0.95 && au <= (v + 0.95) / 1.9;
    case 4: return (au <= 0.4 && av <= 1) || (av <= 0.4 && au <= 1);
    case 5: return v <= 0.95 && v >= -0.95 && (v >= -0.1 ? au <= 0.9 : au <= (v + 0.95) * 1.05);
    case 6: return Math.abs(au - av) <= 0.4;
    default: return av <= au + 0.15;
  }
}

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
  /** Completion pulses by color: ms since that pair was joined. */
  private pulses = new Map<number, number>();

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('lines-fx'), 120, context.motion.effects);
    const raw = context.record.get();
    this.menu = new Menu(SIZES.map(size => ({id: String(size), label: `${size} × ${size}`, key: String(size), hint: count(raw[`best${size}`]) ? `best ${count(raw[`best${size}`])}` : `${size} colors`})));
  }

  get status(): GameStatus { return this.screen === 'menu' ? 'ready' : this.won ? 'won' : 'playing'; }
  get finale(): Finale | undefined { return this.won ? this.wave : undefined; }
  get refreshMs(): number { return (this.wave && !this.wave.done) || this.particles.count || this.pulses.size ? 40 : 0; }

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
  animate(dtMs: number): void {
    for (const [color, age] of this.pulses) {
      const next = age + dtMs;
      if (next > (this.board?.paths[color]?.length ?? 0) * PULSE_MS_PER_CELL + 400) this.pulses.delete(color); else this.pulses.set(color, next);
    }
    this.wave?.update(dtMs); this.particles.update(dtMs);
  }

  private get still(): boolean { return this.context.motion.reduced || this.context.motion.effects === 'off'; }

  /** Start a pulse along every pair that has just been joined. */
  private joined(before: boolean[]): void {
    const board = this.board!;
    board.paths.forEach((_, color) => { if (board.complete(color) && !before[color] && !this.still) this.pulses.set(color, 0); else if (!board.complete(color)) this.pulses.delete(color); });
  }

  private completion(): boolean[] { return this.board!.paths.map((_, color) => this.board!.complete(color)); }

  key(key: Key): GameKeyResult {
    const before = this.board && this.screen === 'play' ? this.completion() : [];
    const result = this.keyInner(key);
    if (this.board && this.screen === 'play') this.joined(before);
    return result;
  }

  private keyInner(key: Key): GameKeyResult {
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
    if (key.kind === 'mouseClick') {
      const at = 'x' in key && typeof key.x === 'number' && typeof key.y === 'number' ? this.cellAtMouse(key.x - 1, key.y - 1) : undefined;
      if (at === undefined) return 'ignored';
      if (board.active !== undefined) {
        if (board.move(at)) { this.cursor = at; this.check(); return 'handled'; }
        board.stop();
      }
      this.cursor = at;
      const snap = board.snapshot();
      if (board.begin(at)) { board.history.push(snap); if (board.history.length > 200) board.history.shift(); }
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
    const groups: number[][] = [];
    for (const path of board.data.solution) path.forEach((cell, index) => (groups[Math.min(index, path.length - 1 - index)] ??= []).push(cell));
    this.wave = new Reveal(groups, this.context.motion, {stagger: 90, within: 0, rise: 160, hold: 240, fall: 500});
    const look = arcadeLook();
    confetti(this.particles, this.size.columns, this.size.rows * 2, [look.ok, look.hue.rose, look.hue.butter, look.hue.sky], this.context.motion);
    this.result = {
      score, scoreText: score.toLocaleString('en-US'), record: score > this.startBest,
      details: [`${this.n} × ${this.n} board, ${this.n} colors`, `Undos ${this.undos} · hints ${this.hintsUsed}`, `Best ${Math.max(this.startBest, score)}`, `Solved ${saved.plays}`],
    };
  }

  /** Physically square cells under the title row; the frame, then the legend and status line, are kept when there is room. */
  private layout(): BoardLayout | undefined {
    const area = {columns: this.size.columns, rows: this.size.rows, top: 1};
    return squareLayout({...area, bottom: 3}, this.n, this.n, {maxCellH: 4, frame: 1}) ?? squareLayout({...area, bottom: 1}, this.n, this.n, {maxCellH: 4});
  }

  private cellAtMouse(column: number, row: number): number | undefined {
    const layout = this.board && this.layout();
    const at = layout && cellAt(layout, column, row);
    return at ? at.cy * this.n + at.cx : undefined;
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    const safe = this.context.safeGlyphs;
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.board) {
      topRow(canvas, look, 'Yarn Lines', scoreSummary(this.context.record.get()));
      const top = Math.max(2, Math.floor(canvas.height / 2) - 4);
      canvas.center(top, 'Choose a board', {fg: look.text.strong, bold: true});
      canvas.center(top + 1, 'Join the pairs, fill every cell.', {fg: look.text.normal});
      this.menu.draw(canvas, palette, 0, top + 3, canvas.width);
      return;
    }
    const board = this.board, n = this.n;
    topRow(canvas, look, `Yarn Lines · ${n}×${n}`, `Linked ${board.connected}/${n}  Filled ${board.filled}/${n * n}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), 'Make the window a little larger', {fg: look.warn}); return; }
    const {cellW: cw, cellH: ch} = layout;
    const colors = distinctColors(n, look);
    const well = look.surface.sunken;
    const tile = mixRgb(well, look.surface.raised, 0.7);
    const framed = layout.x >= 1 && layout.y >= 2 && layout.height + layout.y + 1 <= canvas.height - 2;
    if (color && framed) canvas.fill(layout.x - 1, layout.y - 1, layout.width + 2, layout.height + 2, ' ', {bg: well});
    else if (color) canvas.fill(layout.x, layout.y, layout.width, layout.height, ' ', {bg: well});

    // The board as pixels: two per terminal row, so a cell is cw by cw pixels and square. Paths are drawn as ropes with joins.
    const pixels = new PixelBuffer(layout.width, layout.height * 2);
    const drawing = board.active;
    const cells = n * n;
    const links = (cell: number): {n: boolean; e: boolean; s: boolean; w: boolean} => {
      const owner = board.ownerOf(cell);
      const out = {n: false, e: false, s: false, w: false};
      if (owner < 0) return out;
      const path = board.paths[owner]!;
      const at = path.indexOf(cell);
      for (const other of [path[at - 1], path[at + 1]]) {
        if (other === undefined) continue;
        if (other === cell - n) out.n = true; else if (other === cell + n) out.s = true; else if (other === cell - 1) out.w = true; else out.e = true;
      }
      return out;
    };
    const margin = cw >= 8 ? 2 : cw >= 4 ? 1 : 0;
    const centers: Array<{x: number; y: number}> = [];
    for (let cell = 0; cell < cells; cell += 1) {
      const cx = cell % n, cy = Math.floor(cell / n);
      const o = cellOrigin(layout, cx, cy);
      const ox = o.x - layout.x, oy = (o.y - layout.y) * 2, size = cw;
      centers.push({x: o.x, y: o.y});
      const end = board.endOf(cell);
      const owner = end >= 0 ? end : board.ownerOf(cell);
      if (owner < 0) { if (color && size >= 6) pixels.rect(ox + 1, oy + 1, size - 2, size - 2, tile); continue; }
      if (!color) continue;
      let hue = colors[owner]!;
      if (drawing !== undefined) hue = drawing === owner ? mixRgb(hue, WHITE, 0.18) : mixRgb(hue, well, 0.3);
      const glow = (this.wave?.has(cell) ? this.wave.amount(cell) : 0) + this.pulseAt(owner, cell);
      if (glow > 0) hue = mixRgb(hue, WHITE, Math.min(0.7, 0.55 * glow));
      const l = links(cell);
      const m = margin;
      const rope = end >= 0 ? hue : mixRgb(hue, well, 0.08);
      pixels.rect(ox + m, oy + m, size - 2 * m, size - 2 * m, rope);
      if (l.n) pixels.rect(ox + m, oy, size - 2 * m, m, rope);
      if (l.s) pixels.rect(ox + m, oy + size - m, size - 2 * m, m, rope);
      if (l.w) pixels.rect(ox, oy + m, m, size - 2 * m, rope);
      if (l.e) pixels.rect(ox + size - m, oy + m, m, size - 2 * m, rope);
      if (end >= 0) {
        const lit = mixRgb(hue, WHITE, 0.2);
        for (let py = 0; py < size; py += 1) for (let px = 0; px < size; px += 1) if (shapeHas(owner, size, px, py)) pixels.set(ox + px, oy + py, lit);
        if (board.complete(owner)) for (let px = Math.floor(size / 2) - 1; px <= Math.floor(size / 2); px += 1) if (size >= 6) pixels.set(ox + px, oy + Math.floor(size / 2) - 2, mixRgb(hue, WHITE, 0.7));
      }
    }
    // Cursor corners (color) go into the pixels so the rope never hides them.
    const cursor = cellOrigin(layout, this.cursor % n, Math.floor(this.cursor / n));
    if (color && cw >= 4) {
      const ox = cursor.x - layout.x, oy = (cursor.y - layout.y) * 2, arm = cw >= 6 ? 2 : 1, strong = look.text.strong;
      for (let k = 0; k < arm; k += 1) for (const [px, py, dx, dy] of [[0, 0, 1, 0], [0, 0, 0, 1], [cw - 1, 0, -1, 0], [cw - 1, 0, 0, 1], [0, cw - 1, 1, 0], [0, cw - 1, 0, -1], [cw - 1, cw - 1, -1, 0], [cw - 1, cw - 1, 0, -1]] as const) pixels.set(ox + px + dx * k, oy + py + dy * k, strong);
    }
    canvas.blit(pixels, layout.x, layout.y);

    for (let cell = 0; cell < cells; cell += 1) {
      const {x, y} = centers[cell]!;
      const end = board.endOf(cell);
      const owner = end >= 0 ? end : board.ownerOf(cell);
      const mid = y + Math.floor((ch - 1) / 2), col = x + (cw === 2 ? 1 : Math.floor((cw - 1) / 2));
      const cursorHere = cell === this.cursor;
      if (owner >= 0 && !color) {
        // Without color a cell is filled with its pair's letter: capitals on the ends, small along the path.
        const base = String.fromCharCode(65 + owner);
        canvas.fill(x, y, cw, ch, end >= 0 ? base : base.toLowerCase(), {bold: end >= 0, reverse: cursorHere && cw < 3});
      } else if (owner >= 0) {
        const base = String.fromCharCode(65 + owner);
        // Ends always carry their capital; path cells carry the small letter when hue alone is not enough.
        if (end >= 0) canvas.put(col, mid, base, {fg: INK, bold: true});
        else if (cw < 4) canvas.put(col, mid, base.toLowerCase(), {fg: INK});
      } else {
        canvas.put(col, mid, color && cw >= 6 ? ' ' : safe || !color ? '.' : '·', {fg: look.text.dim, ...(cursorHere && cw < 4 ? {underline: true, reverse: !color} : {})});
      }
      if (cursorHere && cw === 2) canvas.put(x, mid, '[', {fg: color ? look.text.strong : undefined, bold: true});
      if (cursorHere && cw >= 3) {
        canvas.put(x, mid, '[', {fg: color ? look.text.strong : undefined, bold: true});
        canvas.put(x + cw - 1, mid, ']', {fg: color ? look.text.strong : undefined, bold: true});
      }
    }
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
    const footer = canvas.height - 1;
    const linked = [...Array(n).keys()].filter(c => board.complete(c)).map(c => String.fromCharCode(65 + c)).join(' ');
    const line = this.won ? 'Solved! Every pair joined, every cell covered.' : this.note || (board.active !== undefined ? `Drawing ${String.fromCharCode(65 + board.active)}: arrows extend, Space lets go` : `Linked: ${linked || 'none'} · Space picks up a yarn`);
    canvas.center(footer, truncateText(line, canvas.width - 2), {fg: this.won ? look.ok : look.text.dim, bold: this.won});
    // Legend: each color's letter in its own color, filled when its pair is joined.
    if (layout.y + layout.height + 1 < footer) {
      const items = [...Array(n).keys()].map(c => ({c, text: `${String.fromCharCode(65 + c)}${board.complete(c) ? (safe ? '+' : '✓') : (safe ? '-' : '·')}`}));
      const width = items.reduce((sum, item) => sum + item.text.length + 1, -1);
      let lx = Math.floor((canvas.width - width) / 2);
      for (const item of items) { canvas.text(lx, footer - 1, item.text, {fg: color ? colors[item.c]! : undefined, bold: board.complete(item.c)}); lx += item.text.length + 1; }
    }
  }

  /** The brightness of the completion pulse running along a color's path at `cell`. */
  private pulseAt(color: number, cell: number): number {
    const age = this.pulses.get(color);
    if (age === undefined) return 0;
    const path = this.board!.paths[color]!;
    const at = path.indexOf(cell);
    if (at < 0) return 0;
    return Math.max(0, 1 - Math.abs(at - age / PULSE_MS_PER_CELL) / 2.5);
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
