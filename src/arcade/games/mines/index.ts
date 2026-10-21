import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem} from '../../effects.js';
import {confetti, Reveal} from '../../fx/cells.js';
import {count, direction, topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import type {ControlHint, Finale, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {FLAG, HIDDEN, MineBoard, OPEN, PRESETS, type Preset} from './logic.js';

/**
 * Minefield: Minesweeper with first-click safety, chording, three presets and a cascade that opens a region in waves.
 * Losing pops every mine outward from the one you found; winning lets every flag bloom. Numbers use distinct hues and are
 * always digits, so color only adds to them.
 */
const PRESET_KEYS: readonly Preset[] = ['beginner', 'intermediate', 'expert'];
const CASCADE_MS = 22;
const cap = (preset: Preset): string => `${preset[0]!.toUpperCase()}${preset.slice(1)}`;

export function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function readMines(raw: Readonly<Record<string, unknown>>): {plays: number; wins: number; best: Record<Preset, number>} {
  return {plays: count(raw.plays), wins: count(raw.wins), best: {beginner: count(raw.bestBeginner), intermediate: count(raw.bestIntermediate), expert: count(raw.bestExpert)}};
}

class Minefield implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private screen: 'menu' | 'play' = 'menu';
  private board: MineBoard | undefined;
  private preset: Preset = 'beginner';
  private cursor = 0;
  private elapsed = 0;
  private menu: Menu;
  private paused = false;
  /** Per cell: ms until a freshly opened cell shows (the cascade). */
  private delay = new Float32Array(0);
  private wave: Reveal | undefined;
  private readonly particles: ParticleSystem;
  private pixels = new PixelBuffer(0, 0);
  private size: {columns: number; rows: number};
  private startBest = 0;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('mines-fx'), 140, context.motion.effects);
    this.menu = this.buildMenu();
  }

  private buildMenu(): Menu {
    const saved = readMines(this.context.record.get());
    return new Menu(PRESET_KEYS.map((preset, index) => {
      const p = PRESETS[preset];
      return {id: preset, label: p.label, key: String(index + 1), hint: `${p.width}×${p.height} · ${p.mines} mines${saved.best[preset] ? ` · best ${formatClock(saved.best[preset])}` : ''}`};
    }));
  }

  get status(): GameStatus {
    if (this.screen === 'menu' || !this.board) return 'ready';
    if (this.board.won) return 'won';
    return this.board.lost >= 0 ? 'over' : 'playing';
  }
  get finale(): Finale | undefined { return this.board?.over ? this.wave : undefined; }
  get refreshMs(): number {
    if (this.screen !== 'play') return 0;
    if ((this.wave && !this.wave.done) || this.particles.count || this.delay.some(left => left > 0)) return 40;
    return this.board?.placed && !this.board.over ? 1000 : 0;
  }

  private start(preset: Preset): void {
    const p = PRESETS[preset];
    this.preset = preset;
    this.board = new MineBoard(p.width, p.height, p.mines, createRng(this.context.rng.int(1, 0x7fffffff)));
    this.cursor = Math.floor(p.height / 2) * p.width + Math.floor(p.width / 2);
    this.elapsed = 0;
    this.delay = new Float32Array(p.width * p.height);
    this.wave = undefined;
    this.result = undefined;
    this.screen = 'play';
    this.startBest = readMines(this.context.record.get()).best[preset];
  }

  step(): void {}

  animate(dtMs: number): void {
    if (this.paused) { this.paused = false; return; }
    const board = this.board;
    if (this.screen === 'play' && board?.placed && !board.over) this.elapsed += Math.min(dtMs, 2000);
    for (let cell = 0; cell < this.delay.length; cell += 1) if (this.delay[cell]! > 0) this.delay[cell] = Math.max(0, this.delay[cell]! - dtMs);
    this.wave?.update(dtMs);
    this.particles.update(dtMs);
  }

  private cascade(): void {
    const board = this.board!;
    if (this.context.motion.reduced || this.context.motion.effects === 'off') return;
    for (const {cell, depth} of board.lastOpened) this.delay[cell] = depth * CASCADE_MS;
  }

  private act(kind: 'reveal' | 'flag' | 'chord'): void {
    const board = this.board!;
    const changed = kind === 'flag' ? board.flag(this.cursor) : kind === 'chord' ? board.chord(this.cursor) : board.state[this.cursor] === OPEN ? board.chord(this.cursor) : board.reveal(this.cursor);
    if (!changed) return;
    if (kind !== 'flag') this.cascade();
    if (board.over) this.finish();
  }

  /** The finale: mines popping outward from the one found, or every mine's flag blooming from the last move. */
  private finish(): void {
    const board = this.board!;
    const origin = board.lost >= 0 ? board.lost : this.cursor;
    const mines = [...Array(board.size).keys()].filter(cell => board.mines[cell]);
    const distance = (cell: number) => Math.hypot(board.x(cell) - board.x(origin), board.y(cell) - board.y(origin));
    const groups: number[][] = [];
    for (const cell of mines.sort((a, b) => distance(a) - distance(b))) {
      const ring = Math.floor(distance(cell) / 2);
      (groups[ring] ??= []).push(cell);
    }
    this.wave = new Reveal(groups.filter(Boolean), this.context.motion, {stagger: board.won ? 70 : 55, within: 15, rise: 120, hold: 200, fall: 400});
    const won = board.won;
    const saved = readMines(this.context.record.get());
    const record = won && (this.startBest === 0 || this.elapsed < this.startBest);
    this.context.record.update(raw => {
      raw.plays = count(raw.plays) + 1;
      if (won) {
        raw.wins = count(raw.wins) + 1;
        const key = `best${cap(this.preset)}`;
        if (record) raw[key] = Math.max(1, Math.round(this.elapsed));
      }
    });
    const best = record ? this.elapsed : saved.best[this.preset];
    this.result = {
      score: Math.round(this.elapsed / 1000), scoreText: won ? formatClock(this.elapsed) : 'Boom', record,
      details: [PRESETS[this.preset].label, won ? 'Every mine found' : `${board.state.reduce((sum, value, cell) => sum + (value === OPEN && !board.mines[cell] ? 1 : 0), 0)} cells cleared`, ...(best ? [`Best ${formatClock(best)}`] : []), `Won ${saved.wins + (won ? 1 : 0)} of ${saved.plays + 1}`],
    };
    if (won) confetti(this.particles, this.size.columns, this.size.rows * 2, [arcadeLook().ok, arcadeLook().hue.rose, arcadeLook().hue.butter], this.context.motion);
  }

  key(key: Key): GameKeyResult {
    if (this.screen === 'menu') {
      if (key.kind === 'escape') return 'ignored';
      const choice = this.menu.key(key);
      if (choice) this.start(choice as Preset);
      return 'handled';
    }
    const board = this.board!;
    if (board.over) { if (this.wave && !this.wave.done) this.wave.skip(); return 'ignored'; }
    this.paused = false;
    const move = direction(key);
    if (move && !(key.kind === 'text' && key.value === 'f')) {
      const x = board.x(this.cursor) + (move === 'left' ? -1 : move === 'right' ? 1 : 0);
      const y = board.y(this.cursor) + (move === 'up' ? -1 : move === 'down' ? 1 : 0);
      this.cursor = Math.max(0, Math.min(board.height - 1, y)) * board.width + Math.max(0, Math.min(board.width - 1, x));
      return 'handled';
    }
    if (key.kind === 'mouseClick') {
      const at = 'x' in key && typeof key.x === 'number' && typeof key.y === 'number' ? this.cellAt(key.x - 1, key.y - 1) : undefined;
      if (at !== undefined) { this.cursor = at; this.act('reveal'); }
      return 'handled';
    }
    if (key.kind === 'enter' || (key.kind === 'text' && key.value === ' ')) { this.act('reveal'); return 'handled'; }
    if (key.kind === 'text' && (key.value === 'f' || key.value === 'm')) { this.act('flag'); return 'handled'; }
    if (key.kind === 'text' && key.value === 'c') { this.act('chord'); return 'handled'; }
    return 'ignored';
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  private layout(): {cw: number; x: number; y: number; side: boolean} | undefined {
    const board = this.board!;
    for (const cw of [3, 2]) {
      const width = board.width * cw;
      const side = this.size.columns >= width + 26;
      if (width > this.size.columns || board.height + 2 > this.size.rows) continue;
      const x = side ? Math.max(1, Math.floor((this.size.columns - width - 24) / 2)) : Math.floor((this.size.columns - width) / 2);
      return {cw, x, y: Math.max(2, Math.floor((this.size.rows - board.height) / 2)), side};
    }
    return undefined;
  }

  private cellAt(column: number, row: number): number | undefined {
    const board = this.board;
    const layout = board && this.layout();
    if (!board || !layout) return undefined;
    const x = Math.floor((column - layout.x) / layout.cw);
    const y = row - layout.y;
    return x >= 0 && y >= 0 && x < board.width && y < board.height ? y * board.width + x : undefined;
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.board) {
      const saved = readMines(this.context.record.get());
      topRow(canvas, look, 'Minefield', saved.plays ? `Won ${saved.wins} of ${saved.plays}` : 'Not played yet');
      const top = Math.max(2, Math.floor(canvas.height / 2) - 4);
      canvas.center(top, 'Choose a field', {fg: look.text.strong, bold: true});
      canvas.center(top + 1, 'The first square you open is always safe.', {fg: look.text.dim});
      this.menu.draw(canvas, palette, 0, top + 3, canvas.width);
      return;
    }
    const board = this.board;
    topRow(canvas, look, `Minefield · ${PRESETS[this.preset].label}`, `Mines ${board.mineCount - board.flags}  ${formatClock(this.elapsed)}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), `Needs ${board.width * 2}×${board.height + 2} for this field`, {fg: look.warn}); return; }
    const numbers: Rgb[] = [look.hue.sky, look.hue.mint, look.hue.rose, look.hue.lilac, look.hue.coral, look.hue.teal, look.hue.butter, look.hue.peach];
    const safe = this.context.safeGlyphs;
    for (let cell = 0; cell < board.size; cell += 1) {
      const x = layout.x + board.x(cell) * layout.cw;
      const y = layout.y + board.y(cell);
      const cursor = cell === this.cursor && !board.over;
      const state = board.state[cell]!;
      const waiting = (this.delay[cell] ?? 0) > 0;
      const glow = this.wave?.amount(cell) ?? 0;
      const mine = board.mines[cell] === 1;
      const showMine = board.over && mine && (glow > 0 || this.wave?.done || cell === board.lost);
      let bg: Rgb;
      let text = ' ';
      let fg: Rgb | undefined = look.text.strong;
      let bold = false;
      if (state === OPEN && !waiting && !(mine && board.won)) {
        bg = look.surface.sunken;
        const n = board.counts[cell]!;
        if (mine) { text = safe ? '*' : '✸'; fg = look.bad; bold = true; bg = cell === board.lost ? mixRgb(look.surface.sunken, look.bad, 0.5) : bg; }
        else if (n) { text = String(n); fg = numbers[n - 1]; bold = true; }
      } else {
        bg = (board.x(cell) + board.y(cell)) % 2 ? look.surface.raised : look.surface.raised2;
        if (state === FLAG || (board.won && mine)) {
          const wrong = board.lost >= 0 && state === FLAG && !mine;
          text = wrong ? (safe ? 'x' : '✗') : safe ? 'F' : '⚑';
          fg = wrong ? look.warn : board.won ? mixRgb(look.hue.rose, look.ok, glow) : look.hue.rose;
          bold = true;
        } else if (showMine) { text = safe ? '*' : '✸'; fg = mixRgb(look.bad, look.text.strong, glow * 0.5); bold = true; }
      }
      if (glow > 0) bg = mixRgb(bg, board.won ? look.ok : look.bad, 0.35 * glow);
      if (cursor) bg = look.accent;
      if (cursor && fg && state !== OPEN) fg = look.text.onAccent;
      const cellText = layout.cw === 3 ? ` ${text} ` : `${text} `;
      canvas.text(x, y, cellText, {bg: color ? bg : undefined, fg, bold, reverse: !color && cursor});
      if (color && !safe && state === HIDDEN && layout.cw === 3 && !cursor) canvas.put(x, y, '▏', {fg: mixRgb(bg, look.text.strong, 0.12), bg});
    }
    if (layout.side) this.drawSide(canvas, look, board, layout.x + board.width * layout.cw + 3, layout.y);
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
  }

  private drawSide(canvas: Canvas, look: ArcadeLook, board: MineBoard, x: number, y: number): void {
    canvas.text(x, y, 'Minefield', {fg: look.text.strong, bold: true});
    canvas.text(x, y + 1, PRESETS[this.preset].label, {fg: look.accent, bold: true});
    canvas.text(x, y + 3, formatClock(this.elapsed), {fg: board.won ? look.ok : look.text.strong, bold: true});
    canvas.text(x, y + 5, `Mines left  ${board.mineCount - board.flags}`, {fg: look.text.normal});
    canvas.text(x, y + 6, `Flags       ${board.flags}`, {fg: look.text.dim});
    if (!board.placed) canvas.text(x, y + 8, 'Open any square:', {fg: look.text.dim});
    if (!board.placed) canvas.text(x, y + 9, 'the first is safe.', {fg: look.text.dim});
    if (board.won) canvas.text(x, y + 8, 'Field cleared', {fg: look.ok, bold: true});
    else if (board.lost >= 0) canvas.text(x, y + 8, 'Found a mine', {fg: look.bad, bold: true});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void { this.paused = true; }
  hints(): readonly ControlHint[] {
    if (this.screen === 'menu') return [{keys: '↑↓', action: 'field'}, {keys: '⏎', action: 'start'}, {keys: 'Esc', action: 'back'}];
    return [{keys: '←↑↓→', action: 'move'}, {keys: 'Space', action: 'open'}, {keys: 'f', action: 'flag'}, {keys: 'c', action: 'chord'}];
  }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.board = undefined; }
}

/** The hub preview: a small field opening in a cascade, a few flags placed. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const width = Math.min(12, Math.floor(canvas.width / 3)), height = Math.min(8, canvas.height - 1);
  const left = Math.floor((canvas.width - width * 3) / 2), top = Math.floor((canvas.height - height) / 2);
  const step = frame % 40;
  const numbers = [look.hue.sky, look.hue.mint, look.hue.rose];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const d = Math.abs(x - 4) + Math.abs(y - 3);
    const open = d <= step / 3 && d < 6;
    const edge = open && d >= 4;
    const flag = !open && (x * 7 + y * 3) % 11 === 0;
    canvas.text(left + x * 3, top + y, open ? (edge ? ` ${1 + ((x + y) % 3)} ` : '   ') : flag ? ' ⚑ ' : '   ', {
      bg: open ? look.surface.sunken : (x + y) % 2 ? look.surface.raised : look.surface.raised2,
      fg: open ? numbers[(x + y) % 3] : look.hue.rose, bold: true,
    });
  }
}

export const minesGame: GameDefinition = {
  id: 'mines', aliases: ['minefield', 'minesweeper'], title: 'Minefield', tagline: 'Find every mine',
  description: 'Classic Minesweeper: open squares, read the numbers, flag the mines. The first square is always safe, and opening a number with all its flags placed opens the rest around it.',
  kind: 'puzzle', category: 'logic',
  controls: [{keys: '←↑↓→', action: 'move'}, {keys: 'Space', action: 'open'}, {keys: 'f', action: 'flag'}, {keys: 'c', action: 'chord'}],
  howToPlay: [
    'A number tells how many of the eight squares around it hide a mine. Flag the mines (f) and open everything else (Space or a click).',
    'Opening an empty square opens its whole region. On a number whose flags are all placed, c (or Space) opens the rest around it.',
  ],
  summary: record => {
    const saved = readMines(record);
    if (!saved.plays) return 'Not played yet';
    const best = PRESET_KEYS.slice().reverse().find(preset => saved.best[preset]);
    return best ? `Won ${saved.wins} · ${PRESETS[best].label.toLowerCase()} ${formatClock(saved.best[best])}` : `Won ${saved.wins} of ${saved.plays}`;
  },
  preview,
  create: context => new Minefield(context),
};
