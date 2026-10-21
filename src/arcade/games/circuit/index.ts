import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {truncateText} from '../../../util/text.js';
import {ParticleSystem} from '../../effects.js';
import {confetti, Reveal} from '../../fx/cells.js';
import {count, direction, isConfirm, readScore, saveScore, scoreSummary, topRow} from '../../kit.js';
import {arcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import {rgb} from '../../scenery.js';
import type {ControlHint, Finale, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {CircuitBoard, E, generateCircuit, N, S, SIZES, W, wireCount} from './logic.js';

/**
 * Circuit: rotate tiles until current from the source reaches every lamp. Lit wires are drawn heavy (━ ┃ ┏) and unlit
 * ones light (─ │ ┌), lamps show ◉ lit or ○ unlit and the source ◆, and without Unicode the same split is `=`/`!`
 * against `-`/`|` and `*`/`o`/`S`, so no state depends on color. Lighting is recomputed from the real wire graph after
 * every turn.
 */
const LIGHT: Readonly<Record<number, string>> = {1: '╵', 2: '╶', 4: '╷', 8: '╴', 3: '└', 6: '┌', 12: '┐', 9: '┘', 5: '│', 10: '─', 7: '├', 14: '┬', 13: '┤', 11: '┴', 15: '┼', 0: ' '};
const HEAVY: Readonly<Record<number, string>> = {1: '╹', 2: '╺', 4: '╻', 8: '╸', 3: '┗', 6: '┏', 12: '┓', 9: '┛', 5: '┃', 10: '━', 7: '┣', 14: '┳', 13: '┫', 11: '┻', 15: '╋', 0: ' '};
const AMBER = rgb(0xffd166);
const INK = rgb(0x1a1530);
const LAYOUTS: ReadonlyArray<readonly [number, number]> = [[5, 3], [4, 1], [3, 1]];

/** ASCII drawing of a tile's wires on the 3 x 1 core: west arm, center, east arm. */
function asciiCenter(mask: number, lit: boolean): string {
  const vertical = (mask & (N | S)) === (N | S) ? '+' : mask & N ? (lit ? 'A' : '^') : mask & S ? (lit ? 'V' : 'v') : '';
  const h = lit ? '=' : '-', v = lit ? '!' : '|';
  const center = vertical === '+' ? ((mask & (E | W)) ? (lit ? '#' : '+') : v) : vertical || (mask & (E | W) ? h : ' ');
  return `${mask & W ? h : ' '}${center}${mask & E ? h : ' '}`;
}

class Circuit implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private screen: 'menu' | 'play' = 'menu';
  private menu: Menu;
  private board: CircuitBoard | undefined;
  private n = 5;
  private cursor = 0;
  private hintsUsed = 0;
  private won = false;
  private note = '';
  private wave: Reveal | undefined;
  private startBest = 0;
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private pixels = new PixelBuffer(0, 0);

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('circuit-fx'), 120, context.motion.effects);
    const raw = context.record.get();
    this.menu = new Menu(SIZES.map(size => ({id: String(size), label: `${size} × ${size}`, key: String(size), hint: count(raw[`best${size}`]) ? `best ${count(raw[`best${size}`])}` : 'wire grid'})));
  }

  get status(): GameStatus { return this.screen === 'menu' ? 'ready' : this.won ? 'won' : 'playing'; }
  get finale(): Finale | undefined { return this.won ? this.wave : undefined; }
  get refreshMs(): number { return (this.wave && !this.wave.done) || this.particles.count ? 40 : 0; }

  private start(size: number): void {
    this.n = size;
    this.board = new CircuitBoard(generateCircuit(size, createRng(this.context.rng.int(1, 0x7fffffff))));
    this.cursor = this.board.data.source;
    this.hintsUsed = 0; this.note = ''; this.won = false; this.wave = undefined; this.result = undefined;
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
      const x = this.cursor % this.n + (move === 'left' ? -1 : move === 'right' ? 1 : 0);
      const y = Math.floor(this.cursor / this.n) + (move === 'up' ? -1 : move === 'down' ? 1 : 0);
      if (x >= 0 && y >= 0 && x < this.n && y < this.n) this.cursor = y * this.n + x;
      return 'handled';
    }
    if (isConfirm(key) || (key.kind === 'text' && key.value.toLowerCase() === 'r')) { this.turn(true); return 'handled'; }
    if (key.kind !== 'text') return 'ignored';
    const value = key.value.toLowerCase();
    if (value === 'e') this.turn(false);
    else if (value === 'u') { if (!board.undo()) this.note = 'Nothing to undo'; }
    else if (value === 't') {
      const cell = board.hintCell();
      if (cell !== undefined) { this.cursor = cell; board.fix(cell); this.hintsUsed += 1; this.note = 'Hint: one tile set'; this.check(); }
    } else return 'ignored';
    return 'handled';
  }

  private turn(clockwise: boolean): void {
    const board = this.board!;
    if (!board.rotate(this.cursor, clockwise)) { this.note = 'That tile looks the same turned'; return; }
    this.check();
  }

  private check(): void {
    const board = this.board!;
    if (this.won || !board.won) return;
    this.won = true;
    const extra = Math.max(0, board.turns - board.minimum);
    const score = Math.max(10, this.n * this.n * 10 - extra * 2 - this.hintsUsed * 40);
    const saved = saveScore(this.context.record, score, {[`best${this.n}`]: score});
    const dist = board.distances();
    const groups: number[][] = [];
    for (const [cell, d] of dist) (groups[d] ??= []).push(cell);
    this.wave = new Reveal(groups.filter(Boolean), this.context.motion, {stagger: 55, within: 0, rise: 130, hold: 220, fall: 400});
    const look = arcadeLook();
    confetti(this.particles, this.size.columns, this.size.rows * 2, [look.ok, AMBER, look.hue.sky], this.context.motion);
    this.result = {
      score, scoreText: score.toLocaleString('en-US'), record: score > this.startBest,
      details: [`${this.n} × ${this.n} grid, ${board.data.lamps.length} lamps`, `${board.turns} turns (${board.minimum} needed at the least)`, `Best ${Math.max(this.startBest, score)}`, `Lit ${saved.plays}`],
    };
  }

  private layout(): {cw: number; ch: number; x: number; y: number} | undefined {
    for (const [cw, ch] of LAYOUTS) {
      const room = this.size.rows - 3 - this.n * ch;
      if (this.n * cw <= this.size.columns && room >= 0) return {cw, ch, x: Math.floor((this.size.columns - this.n * cw) / 2), y: 1 + Math.floor(room / 2) + (room > 1 ? 1 : 0)};
    }
    return undefined;
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    const unicode = color && !this.context.safeGlyphs;
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.board) {
      topRow(canvas, look, 'Circuit', scoreSummary(this.context.record.get()));
      const top = Math.max(2, Math.floor(canvas.height / 2) - 4);
      canvas.center(top, 'Choose a board', {fg: look.text.strong, bold: true});
      canvas.center(top + 1, 'Turn the tiles until every lamp glows.', {fg: look.text.normal});
      this.menu.draw(canvas, palette, 0, top + 3, canvas.width);
      return;
    }
    const board = this.board;
    const lit = board.lit();
    const lampsOn = board.data.lamps.filter(lamp => lit[lamp]).length;
    topRow(canvas, look, `Circuit · ${this.n}×${this.n}`, `Lamps ${lampsOn}/${board.data.lamps.length}  Turns ${board.turns}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), 'Make the window a little larger', {fg: look.warn}); return; }
    const well = look.surface.sunken;
    if (color) canvas.fill(layout.x - 1, layout.y - 1, this.n * layout.cw + 2, this.n * layout.ch + 2, ' ', {bg: well});
    for (let cell = 0; cell < this.n * this.n; cell += 1) {
      const px = layout.x + (cell % this.n) * layout.cw, py = layout.y + Math.floor(cell / this.n) * layout.ch;
      const mask = board.masks[cell]!;
      const on = lit[cell] === 1;
      const lamp = board.isLamp(cell), source = cell === board.data.source;
      const glow = this.wave && this.wave.has(cell) ? this.wave.amount(cell) : 0;
      let fg: Rgb = on ? AMBER : look.text.dim;
      if (lamp && on) fg = look.ok;
      if (glow > 0) fg = mixRgb(fg, rgb(0xffffff), glow);
      const cursor = cell === this.cursor;
      const bg = cursor && color ? look.surface.selected : color ? (on ? mixRgb(well, AMBER, 0.12) : well) : undefined;
      const style = {fg: color ? fg : undefined, bg, bold: on, reverse: cursor && !color};
      const midX = px + Math.floor(layout.cw / 2), midY = py + Math.floor(layout.ch / 2);
      canvas.fill(px, py, layout.cw, layout.ch, ' ', {bg, reverse: cursor && !color});
      const heavy = unicode ? (on ? HEAVY : LIGHT) : undefined;
      if (layout.ch === 3) {
        const arm = unicode ? (on ? ['━', '┃'] as const : ['─', '│'] as const) : (on ? ['=', '!'] as const : ['-', '|'] as const);
        if (mask & N) canvas.put(midX, py, arm[1], style);
        if (mask & S) canvas.put(midX, py + 2, arm[1], style);
        if (mask & W) canvas.text(px, midY, arm[0].repeat(Math.floor(layout.cw / 2)), style);
        if (mask & E) canvas.text(midX + 1, midY, arm[0].repeat(Math.floor(layout.cw / 2)), style);
        canvas.put(midX, midY, heavy ? heavy[mask]! : asciiCenter(mask, on)[1]!, style);
      } else if (heavy) {
        canvas.put(px, midY, mask & W ? (on ? '━' : '─') : ' ', style);
        canvas.put(px + 1, midY, heavy[mask]!, style);
        canvas.put(px + 2, midY, mask & E ? (on ? '━' : '─') : ' ', style);
      } else canvas.text(px, midY, asciiCenter(mask, on), style);
      // Markers: lamp lit/unlit and the source, in the tile's corner (left column of the single row).
      const mark = source ? (unicode ? '◆' : 'S') : lamp ? (on ? (unicode ? '◉' : '*') : (unicode ? '○' : 'o')) : '';
      if (mark) canvas.put(px, layout.ch === 3 ? py : midY, mark, {...style, fg: color ? (source ? AMBER : fg) : undefined, bold: true});
      void INK;
    }
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
    const footer = Math.min(canvas.height - 1, layout.y + this.n * layout.ch + 1);
    const line = this.won ? 'Every lamp is lit!' : this.note || `${unicode ? '◆' : 'S'} source · ${unicode ? '○' : 'o'} dark lamp · ${unicode ? '◉' : '*'} lit · Space turns`;
    canvas.center(footer, truncateText(line, canvas.width - 2), {fg: this.won ? look.ok : look.text.dim, bold: this.won});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] { return HINTS; }
  persist(): void {}
  dispose(): void { this.particles.clear(); }
}

const HINTS: readonly ControlHint[] = [{keys: '←↑↓→', action: 'move'}, {keys: 'Space', action: 'turn'}, {keys: 'e', action: 'turn back'}, {keys: 'u', action: 'undo'}, {keys: 't', action: 'hint'}];

/** The hub preview: a short wire with current running along it into a lamp. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const y = Math.floor(canvas.height / 2), x0 = Math.max(1, Math.floor((canvas.width - 24) / 2));
  const reach = (frame % 30) / 2;
  const pieces = ['◆', '━', '┓', '┃', '┗', '━', '━', '◉'];
  const rows = [0, 0, 0, 1, 2, 2, 2, 2];
  pieces.forEach((glyph, index) => {
    const on = index <= reach;
    canvas.put(x0 + index * 3, y - 1 + rows[index]!, on ? glyph : glyph === '◉' ? '○' : glyph === '━' || glyph === '┃' ? (glyph === '━' ? '─' : '│') : glyph, {fg: on ? AMBER : look.text.dim, bold: on});
  });
  void wireCount;
}

export const circuitGame: GameDefinition = {
  id: 'circuit', aliases: ['wires', 'lamps'], title: 'Circuit', tagline: 'Turn the wires, light the lamps',
  description: 'Rotate square wire tiles until current from the source reaches every lamp. Current only crosses an edge when both tiles have a wire there, and lit wires are drawn heavy so you can see it flow. Boards from 5 × 5 to 8 × 8 are always solvable.',
  kind: 'puzzle', category: 'logic', controls: HINTS,
  howToPlay: [
    'Move over a tile and press Space to turn it a quarter clockwise (e turns back). Current flows from the ◆ source along wires that meet end to end.',
    'Heavy wires are lit and ○ lamps are dark until current reaches them (◉). Light every lamp to win. u undoes a turn and t sets one tile right at a cost.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? scoreSummary(record) : 'Not played yet'; },
  preview,
  create: context => new Circuit(context),
};
