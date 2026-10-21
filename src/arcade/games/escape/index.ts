import {mixRgb} from '../../../chroma/chroma.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem} from '../../effects.js';
import {confetti, Reveal} from '../../fx/cells.js';
import {count, direction, topRow} from '../../kit.js';
import {arcadeLook, distinctColors} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import type {ControlHint, Finale, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {BOARD, carLabel, EXIT_ROW, EscapeBoard, generate, LEVELS, type Level, type Puzzle} from './logic.js';

/**
 * Box Escape: slide the cars out of the way until car A can leave through the exit on the right. Every board is
 * verified solvable by search and shows its shortest solution (par). Every car carries its own letter, so nothing
 * depends on color.
 */
const LEVEL_IDS = Object.keys(LEVELS) as Level[];

export function readEscape(raw: Readonly<Record<string, unknown>>): {plays: number; wins: number; best: Record<Level, number>} {
  return {plays: count(raw.plays), wins: count(raw.wins), best: {easy: count(raw.bestEasy), medium: count(raw.bestMedium), hard: count(raw.bestHard)}};
}
const bestKey = (level: Level): string => `best${level[0]!.toUpperCase()}${level.slice(1)}`;
const NAMES = {up: 'up', down: 'down', left: 'left', right: 'right'} as const;

class BoxEscape implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private screen: 'menu' | 'play' = 'menu';
  private board: EscapeBoard | undefined;
  private puzzle: Puzzle | undefined;
  private level: Level = 'easy';
  private selected = 0;
  private tip = '';
  private readonly menu: Menu;
  private wave: Reveal | undefined;
  private readonly particles: ParticleSystem;
  private pixels = new PixelBuffer(0, 0);
  private size: {columns: number; rows: number};
  private startBest = 0;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('escape-fx'), 140, context.motion.effects);
    const saved = readEscape(context.record.get());
    this.menu = new Menu(LEVEL_IDS.map((id, index) => ({id, label: LEVELS[id].label, key: String(index + 1), hint: saved.best[id] ? `best ${saved.best[id]}` : 'new'})));
  }

  get status(): GameStatus {
    if (this.screen === 'menu' || !this.board) return 'ready';
    return this.board.solved ? 'won' : 'playing';
  }
  get finale(): Finale | undefined { return this.board?.solved ? this.wave : undefined; }
  get refreshMs(): number { return (this.wave && !this.wave.done) || this.particles.count ? 40 : 0; }

  private start(level: Level): void {
    this.level = level;
    this.puzzle = generate(level, createRng(this.context.rng.int(1, 0x7fffffff)));
    this.board = new EscapeBoard(this.puzzle.cars, this.puzzle.start, this.puzzle.minMoves);
    this.selected = 0;
    this.tip = '';
    this.wave = undefined;
    this.result = undefined;
    this.screen = 'play';
    this.startBest = readEscape(this.context.record.get()).best[level];
  }

  step(): void {}
  animate(dtMs: number): void { this.wave?.update(dtMs); this.particles.update(dtMs); }

  private finish(): void {
    const board = this.board!;
    const columns = Array.from({length: BOARD}, (_, x) => board.grid.reduce<number[]>((cells, car, cell) => (car >= 0 && cell % BOARD === x ? [...cells, cell] : cells), []));
    this.wave = new Reveal(columns, this.context.motion, {stagger: 80, within: 10, rise: 140, hold: 240, fall: 400});
    const saved = readEscape(this.context.record.get());
    const record = this.startBest === 0 || board.moves < this.startBest;
    this.context.record.update(raw => {
      raw.plays = count(raw.plays) + 1;
      raw.wins = count(raw.wins) + 1;
      if (record) raw[bestKey(this.level)] = Math.max(1, board.moves);
    });
    this.result = {
      score: board.moves, scoreText: `${board.moves} moves`, record,
      details: [LEVELS[this.level].label, board.moves <= board.par ? 'Perfect: the shortest way' : `Shortest is ${board.par} moves`, `Best ${record ? board.moves : saved.best[this.level]} moves`],
    };
    const look = arcadeLook();
    confetti(this.particles, this.size.columns, this.size.rows * 2, [look.ok, look.hue.rose, look.hue.butter, look.hue.sky], this.context.motion);
  }

  private move(delta: -1 | 1): GameKeyResult {
    const board = this.board!;
    const moved = board.step(this.selected, delta);
    if (!moved) return 'ignored';
    this.tip = '';
    if (board.solved) this.finish();
    return 'handled';
  }

  key(k: Key): GameKeyResult {
    if (this.screen === 'menu') {
      if (k.kind === 'escape') return 'ignored';
      const choice = this.menu.key(k);
      if (choice) this.start(choice as Level);
      return 'handled';
    }
    const board = this.board!;
    if (board.solved) { this.wave?.skip(); return 'ignored'; }
    const cars = board.cars;
    const move = direction(k);
    if (move) {
      const horizontal = cars[this.selected]!.horizontal;
      if (horizontal && (move === 'left' || move === 'right')) return this.move(move === 'left' ? -1 : 1);
      if (!horizontal && (move === 'up' || move === 'down')) return this.move(move === 'up' ? -1 : 1);
      return 'ignored';
    }
    if (k.kind === 'enter' || k.kind === 'complete' || (k.kind === 'text' && k.value === ' ')) { this.selected = (this.selected + 1) % cars.length; return 'handled'; }
    if (k.kind === 'focusPrevious') { this.selected = (this.selected + cars.length - 1) % cars.length; return 'handled'; }
    if (k.kind === 'mouseClick') {
      const at = 'x' in k && typeof k.x === 'number' && typeof k.y === 'number' ? this.cellAt(k.x - 1, k.y - 1) : undefined;
      const car = at === undefined ? -1 : board.grid[at]!;
      if (car < 0) return 'ignored';
      this.selected = car;
      return 'handled';
    }
    if (k.kind === 'text') {
      const value = k.value.toLowerCase();
      if (value === 'u') { const undone = board.undo(); if (undone) this.tip = ''; return undone ? 'handled' : 'ignored'; }
      if (value === 'r') { board.restart(this.puzzle!.start); this.tip = ''; return 'handled'; }
      if (value === '?' || value === 't') {
        const step = board.hint();
        if (!step) return 'ignored';
        this.selected = step.car;
        const horizontal = cars[step.car]!.horizontal;
        this.tip = `Hint: move ${carLabel(step.car)} ${NAMES[horizontal ? (step.delta < 0 ? 'left' : 'right') : (step.delta < 0 ? 'up' : 'down')]}`;
        return 'handled';
      }
    }
    return 'ignored';
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  private layout(): {cw: number; rh: number; x: number; y: number} | undefined {
    for (const [cw, rh] of [[4, 2], [3, 1], [2, 1]] as const) {
      if (BOARD * cw + 4 > this.size.columns || BOARD * rh + 3 > this.size.rows) continue;
      return {cw, rh, x: Math.floor((this.size.columns - BOARD * cw) / 2), y: 1 + Math.floor((this.size.rows - 2 - BOARD * rh) / 2)};
    }
    return undefined;
  }

  private cellAt(column: number, row: number): number | undefined {
    const layout = this.layout();
    if (!layout) return undefined;
    const x = Math.floor((column - layout.x) / layout.cw), y = Math.floor((row - layout.y) / layout.rh);
    return x >= 0 && y >= 0 && x < BOARD && y < BOARD ? y * BOARD + x : undefined;
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    const safe = this.context.safeGlyphs;
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.board) {
      const saved = readEscape(this.context.record.get());
      topRow(canvas, look, 'Box Escape', saved.plays ? `Solved ${saved.wins}` : 'Not played yet');
      const top = Math.max(1, Math.floor(canvas.height / 2) - 3);
      canvas.center(top, 'Choose a difficulty', {fg: look.text.strong, bold: true});
      if (canvas.height >= 9) canvas.center(top + 1, 'Every board can be solved.', {fg: look.text.dim});
      this.menu.draw(canvas, palette, 0, top + (canvas.height >= 9 ? 3 : 2), canvas.width);
      return;
    }
    const board = this.board;
    topRow(canvas, look, `Box Escape · ${LEVELS[this.level].label}`, `Moves ${board.moves}  Par ${board.par}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), `Needs ${BOARD * 2 + 4}×${BOARD + 3}`, {fg: look.warn}); return; }
    const {cw, rh} = layout;
    const colors = distinctColors(board.cars.length, look, look.surface.sunken);
    const grid = board.grid;
    const wall = safe ? '|' : '│';
    for (let y = 0; y < BOARD; y += 1) for (let r = 0; r < rh; r += 1) {
      canvas.text(layout.x - 1, layout.y + y * rh + r, wall, {fg: look.text.dim});
      canvas.text(layout.x + BOARD * cw, layout.y + y * rh + r, y === EXIT_ROW ? (safe ? '>' : '»') : wall, {fg: y === EXIT_ROW ? look.ok : look.text.dim, bold: y === EXIT_ROW});
    }
    for (let cell = 0; cell < BOARD * BOARD; cell += 1) {
      const cx = cell % BOARD, cy = Math.floor(cell / BOARD);
      const x = layout.x + cx * cw, y = layout.y + cy * rh;
      const car = grid[cell]!;
      if (car < 0) {
        canvas.fill(x, y, cw, rh, ' ', {bg: color ? look.surface.sunken : undefined});
        canvas.text(x + Math.floor(cw / 2) - (cw === 2 ? 1 : 0), y, safe ? '.' : '·', {fg: look.text.dim});
        continue;
      }
      const spec = board.cars[car]!;
      const glow = this.wave?.amount(cell) ?? 0;
      const selected = car === this.selected && !board.solved;
      const base = car === 0 ? look.accent : colors[car]!;
      const bg = mixRgb(selected ? mixRgb(base, look.text.strong, 0.22) : base, look.ok, 0.5 * glow);
      const first = (spec.horizontal ? cx : cy) === board.layout[car], last = (spec.horizontal ? cx : cy) === board.layout[car]! + spec.len - 1;
      const style = {fg: color ? look.text.onAccent : undefined, bg: color ? bg : undefined, bold: true};
      canvas.fill(x, y, cw, rh, ' ', style);
      const label = carLabel(car);
      const middle = y + Math.floor((rh - 1) / 2);
      const text = selected ? (cw >= 3 ? `<${label}>` : `<${label}`) : cw >= 3 ? ` ${label} ` : `${label} `;
      canvas.text(x, middle, text.padEnd(cw, ' ').slice(0, cw), style);
      if (spec.horizontal && cw >= 3) {
        if (first && !selected) canvas.put(x, middle, '[', style);
        if (last && !selected) canvas.put(x + cw - 1, middle, ']', style);
      }
    }
    const note = board.solved ? 'Out! A is free.' : this.tip || (canvas.width < 56 ? `Car ${carLabel(this.selected)} · Space picks` : `Car ${carLabel(this.selected)} selected · Space next car · ? hint · u undo`);
    canvas.center(canvas.height - 1, note.slice(0, canvas.width - 2), {fg: board.solved ? look.ok : this.tip ? look.accent : look.text.dim, bold: board.solved});
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
    if (this.screen === 'menu') return [{keys: '↑↓', action: 'level'}, {keys: '⏎', action: 'start'}, {keys: 'Esc', action: 'back'}];
    return [{keys: '←↑↓→', action: 'slide'}, {keys: 'Space', action: 'next car'}, {keys: '?', action: 'hint'}, {keys: 'u', action: 'undo'}];
  }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.wave = undefined; this.board = undefined; }
}

function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const cw = Math.max(2, Math.min(4, Math.floor((canvas.width - 4) / BOARD))), rh = canvas.height >= 14 ? 2 : 1;
  const left = Math.floor((canvas.width - BOARD * cw) / 2), top = Math.max(0, Math.floor((canvas.height - BOARD * rh) / 2));
  const slide = Math.min(4, Math.floor((frame % 30) / 5));
  const cars = [{x: slide, y: 2, len: 2, h: true, color: look.accent, label: 'A'}, {x: 3, y: 0, len: 3, h: false, color: look.hue.sky, label: 'B'}, {x: 1, y: 4, len: 2, h: true, color: look.hue.butter, label: 'C'}, {x: 5, y: 3, len: 3, h: false, color: look.hue.mint, label: 'D'}];
  canvas.fill(left, top, BOARD * cw, BOARD * rh, ' ', {bg: look.surface.sunken});
  for (const car of cars) for (let step = 0; step < car.len; step += 1) {
    const x = car.h ? car.x + step : car.x, y = car.h ? car.y : car.y + step;
    canvas.fill(left + x * cw, top + y * rh, cw, rh, ' ', {bg: car.color});
    canvas.text(left + x * cw + (cw >= 3 ? 1 : 0), top + y * rh, car.label, {fg: look.text.onAccent, bg: car.color, bold: true});
  }
}

export const escapeGame: GameDefinition = {
  id: 'escape', aliases: ['box-escape', 'rush-hour', 'unblock'], title: 'Box Escape', tagline: 'Slide the boxes, free car A',
  description: 'Sliding-block traffic jam: boxes slide along their own line. Clear the way for car A to reach the exit on the right. Every board is checked solvable and shows its shortest solution.',
  kind: 'puzzle', category: 'logic',
  controls: [{keys: '←↑↓→', action: 'slide'}, {keys: 'Space', action: 'next car'}, {keys: '?', action: 'hint'}, {keys: 'u', action: 'undo'}],
  howToPlay: [
    'Pick a box with Space (or a click); the arrow keys along its line slide it one cell. Horizontal boxes move left and right, vertical ones up and down.',
    'Get car A to the exit » on the right edge in as few moves as you can. ? shows the best next move, u undoes, r restarts the board.',
  ],
  summary: record => {
    const saved = readEscape(record);
    const level = ([...LEVEL_IDS].reverse()).find(id => saved.best[id]);
    return level ? `Best ${saved.best[level]} · ${LEVELS[level].label.toLowerCase()}` : 'Not played yet';
  },
  preview,
  create: context => new BoxEscape(context),
};
