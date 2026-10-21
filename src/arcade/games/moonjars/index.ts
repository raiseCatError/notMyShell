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
import {squareLayout} from '../../engine/boardLayout.js';
import {rgb} from '../../scenery.js';
import {bestTarget, generateJars, JarBoard, LEVELS, LETTERS, pourAmount, type Level, type Target} from './logic.js';

/**
 * Moonjars: sort the liquid so every jar holds one color. Every unit carries a letter as well as a color, so the puzzle
 * reads without color. Tall jars when the terminal has room, one jar per row when it does not. Levels are dealt at
 * random and kept only when a search finds a solution.
 */
const WHITE = rgb(0xffffff);
/** Fill patterns that tell colors apart when there is no color (and no non-ASCII in Safe Glyphs). */
const PATTERNS = ['█', '▓', '▒', '░', '▚', '▞', '▤', '▥', '▦', '▧'];
const SAFE_PATTERNS = ['#', '%', '=', '+', 'o', 'x', '*', '@', '&', '$'];
interface JarLayout { mode: 'tall' | 'wide'; cellW: number; cellH: number; sep: number; roomy: boolean; y: number; xs: number[]; total: number }
/** A pour in flight: the source's level drops and the target's rises over `duration` ms. */
interface PourAnim { from: number; to: number; amount: number; color: number; before: readonly number[]; elapsed: number; duration: number }
const LEVEL_IDS = Object.keys(LEVELS) as Level[];
const bestKey = (level: Level): string => `best${level[0]!.toUpperCase()}${level.slice(1)}`;

export function readJars(raw: Readonly<Record<string, unknown>>): {plays: number; wins: number; best: Record<Level, number>} {
  return {plays: count(raw.plays), wins: count(raw.wins), best: {easy: count(raw.bestEasy), medium: count(raw.bestMedium), hard: count(raw.bestHard)}};
}

class Moonjars implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private screen: 'menu' | 'play' = 'menu';
  private board: JarBoard | undefined;
  private level: Level = 'easy';
  private cursor = 0;
  /** The jar a pour will come from, or -1. */
  private source = -1;
  private note = '';
  private readonly menu: Menu;
  private wave: Reveal | undefined;
  private readonly particles: ParticleSystem;
  private pixels = new PixelBuffer(0, 0);
  private size: {columns: number; rows: number};
  private startBest = 0;
  private target: Target | undefined;
  private anim: PourAnim | undefined;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('jars-fx'), 140, context.motion.effects);
    const saved = readJars(context.record.get());
    this.menu = new Menu(LEVEL_IDS.map((id, index) => ({id, label: LEVELS[id].label, key: String(index + 1), hint: `${LEVELS[id].colors} colors${saved.best[id] ? ` · best ${saved.best[id]}` : ''}`})));
  }

  get status(): GameStatus {
    if (this.screen === 'menu' || !this.board) return 'ready';
    return this.board.solved ? 'won' : 'playing';
  }
  get finale(): Finale | undefined { return this.board?.solved ? this.wave : undefined; }
  get refreshMs(): number { return this.anim ? 30 : (this.wave && !this.wave.done) || this.particles.count ? 40 : 0; }
  private get still(): boolean { return this.context.motion.reduced || this.context.motion.effects === 'off'; }

  private start(level: Level): void {
    this.level = level;
    this.board = new JarBoard(generateJars(level, createRng(this.context.rng.int(1, 0x7fffffff))));
    this.cursor = 0;
    this.source = -1;
    this.note = '';
    this.wave = undefined;
    this.result = undefined;
    this.screen = 'play';
    this.startBest = readJars(this.context.record.get()).best[level];
    this.anim = undefined;
    this.target = bestTarget(this.board.puzzle.jars, this.board.cap);
  }

  step(): void {}
  animate(dtMs: number): void {
    if (this.anim) {
      this.anim.elapsed += dtMs;
      if (this.anim.elapsed >= this.anim.duration) this.anim = undefined;
      return;
    }
    this.wave?.update(dtMs); this.particles.update(dtMs);
  }

  private finish(): void {
    const board = this.board!, cap = board.cap;
    this.wave = new Reveal(board.jars.map((_, jar) => Array.from({length: cap}, (_, level) => jar * cap + level)), this.context.motion, {stagger: 90, within: 30, rise: 140, hold: 240, fall: 400});
    const saved = readJars(this.context.record.get());
    const record = this.startBest === 0 || board.moves < this.startBest;
    this.context.record.update(raw => {
      raw.plays = count(raw.plays) + 1;
      raw.wins = count(raw.wins) + 1;
      if (record) raw[bestKey(this.level)] = Math.max(1, board.moves);
    });
    this.result = {score: board.moves, scoreText: `${board.moves} pours`, record, details: [LEVELS[this.level].label, this.target ? (board.moves <= this.target.pours ? `Met the target of ${this.target.pours}${this.target.proven ? ' (the fewest possible)' : ''}` : `Target ${this.target.pours}${this.target.proven ? ' (the fewest possible)' : ' (a good solution, not proven minimal)'}`) : `Pours ${board.moves}`, `Best ${record ? board.moves : saved.best[this.level]} pours`, `Solved ${saved.wins + 1} times`]};
    const look = arcadeLook();
    confetti(this.particles, this.size.columns, this.size.rows * 2, [look.ok, look.hue.lilac, look.hue.butter, look.hue.sky], this.context.motion);
  }

  /** Choose a jar: the first choice is the source, the second the target; the same jar again cancels. */
  private choose(jar: number): GameKeyResult {
    const board = this.board!;
    if (jar < 0 || jar >= board.jars.length) return 'ignored';
    this.cursor = jar;
    this.note = '';
    if (this.source < 0) {
      if (!board.jars[jar]!.length) { this.note = 'That jar is empty'; return 'handled'; }
      this.source = jar;
      return 'handled';
    }
    if (jar === this.source) { this.source = -1; return 'handled'; }
    const from = this.source;
    this.source = -1;
    const before = board.jars[from]!, color = before[before.length - 1]!;
    const amount = board.pour(from, jar);
    if (!amount) { this.note = 'Cannot pour there'; return 'handled'; }
    if (!this.still) this.anim = {from, to: jar, amount, color, before, elapsed: 0, duration: 170 + 130 * amount};
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
    if (this.anim) this.anim = undefined;
    if (board.solved) { this.wave?.skip(); return 'ignored'; }
    const total = board.jars.length;
    const move = direction(k);
    if (move === 'left' || move === 'up') { this.cursor = (this.cursor + total - 1) % total; this.note = ''; return 'handled'; }
    if (move === 'right' || move === 'down') { this.cursor = (this.cursor + 1) % total; this.note = ''; return 'handled'; }
    if (k.kind === 'mouseClick') {
      const jar = 'x' in k && typeof k.x === 'number' && typeof k.y === 'number' ? this.jarAt(k.x - 1, k.y - 1) : undefined;
      return jar === undefined ? 'ignored' : this.choose(jar);
    }
    if (k.kind === 'enter' || (k.kind === 'text' && k.value === ' ')) return this.choose(this.cursor);
    if (k.kind === 'text') {
      if (/^[0-9]$/u.test(k.value)) return this.choose(k.value === '0' ? 9 : Number(k.value) - 1);
      const value = k.value.toLowerCase();
      if (value === 'u') { this.source = -1; this.anim = undefined; const undone = board.undo(); this.note = ''; return undone ? 'handled' : 'ignored'; }
      if (value === 'r') { board.restart(); this.source = -1; this.anim = undefined; this.note = ''; return 'handled'; }
      if (value === '?' || value === 't') {
        const pour = board.hint();
        if (!pour) return 'ignored';
        this.source = pour.from;
        this.cursor = pour.to;
        this.note = `Hint: pour ${pour.from + 1} into ${pour.to + 1}`;
        return 'handled';
      }
    }
    if (k.kind === 'escape' && this.source >= 0) { this.source = -1; return 'handled'; }
    return 'ignored';
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  /**
   * Jar slots on a square-geometry grid: a unit of liquid is a physically square cell (cellW = 2 * cellH), a jar is one
   * unit wide and `cap` units tall, so it is always visibly taller than wide. Walls take two columns per jar and
   * `sep` columns separate neighbours. `roomy` layouts also have a lift row (the picked jar rises) and a stream row.
   */
  private layout(): JarLayout | undefined {
    const board = this.board!, jars = board.jars.length, cap = board.cap;
    const {columns, rows} = this.size;
    let best: JarLayout | undefined;
    // The largest cell wins; at equal size prefer the roomy layout (lift and stream rows), then a gap between jars.
    for (const roomy of [true, false]) for (const sep of [1, 0]) {
      const reduced = columns - jars * 2 - (jars - 1) * sep;
      const grid = squareLayout({columns: reduced, rows, top: roomy ? 3 : 1, bottom: roomy ? 4 : 3}, jars, cap, {maxCellH: 3});
      if (!grid || (best && best.cellH >= grid.cellH)) continue;
      const total = jars * (grid.cellW + 2) + (jars - 1) * sep;
      const left = Math.floor((columns - total) / 2);
      best = {mode: 'tall', cellW: grid.cellW, cellH: grid.cellH, sep, roomy, y: grid.y, xs: Array.from({length: jars}, (_, k) => left + 1 + k * (grid.cellW + 2 + sep)), total};
    }
    if (best) return best;
    const width = 5 + cap * 2 + 1;
    if (jars + 2 <= rows && width <= columns) return {mode: 'wide', cellW: 2, cellH: 1, sep: 0, roomy: false, y: 1 + Math.floor((rows - jars - 2) / 2), xs: [Math.floor((columns - width) / 2)], total: width};
    return undefined;
  }

  /** The jar under a terminal position, or undefined. */
  private jarAt(column: number, row: number): number | undefined {
    const layout = this.board && this.layout();
    if (!layout) return undefined;
    const jars = this.board!.jars.length;
    if (layout.mode === 'wide') { const jar = row - layout.y; return jar >= 0 && jar < jars ? jar : undefined; }
    const top = layout.y - (layout.roomy ? 2 : 0), bottom = layout.y + this.board!.cap * layout.cellH + 2;
    if (row < top || row > bottom) return undefined;
    const jar = layout.xs.findIndex(x => column >= x - 1 - Math.floor(layout.sep / 2) && column <= x + layout.cellW + Math.ceil(layout.sep / 2));
    return jar >= 0 ? jar : undefined;
  }

  /** What a jar shows now: the units to draw and the (fractional) level, mid-pour included. */
  private shown(jar: number): {units: readonly number[]; level: number} {
    const units = this.board!.jars[jar]!;
    const anim = this.anim;
    if (!anim || (jar !== anim.from && jar !== anim.to)) return {units, level: units.length};
    const t = Math.min(1, anim.elapsed / anim.duration), p = t * t * (3 - 2 * t);
    if (jar === anim.from) return {units: anim.before, level: anim.before.length - anim.amount * p};
    return {units, level: units.length - anim.amount * (1 - p)};
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    const safe = this.context.safeGlyphs;
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.board) {
      const saved = readJars(this.context.record.get());
      topRow(canvas, look, 'Moonjars', saved.plays ? `Solved ${saved.wins}` : 'Not played yet');
      const top = Math.max(1, Math.floor(canvas.height / 2) - 3);
      canvas.center(top, 'Choose a shelf', {fg: look.text.strong, bold: true});
      if (canvas.height >= 9) canvas.center(top + 1, 'Pour until every jar holds one letter.', {fg: look.text.dim});
      this.menu.draw(canvas, palette, 0, top + (canvas.height >= 9 ? 3 : 2), canvas.width);
      return;
    }
    const board = this.board, cap = board.cap;
    const targetText = this.target ? `Target ${this.target.proven ? '' : safe ? '<=' : '≤'}${this.target.pours}` : '';
    topRow(canvas, look, `Moonjars · ${LEVELS[this.level].label}`, `Pours ${board.moves}${targetText ? `  ${targetText}` : ''}${this.startBest ? `  Best ${this.startBest}` : ''}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), `Needs ${Math.min(board.jars.length * 4, 5 + cap * 2 + 1)}×${board.jars.length + 2}`, {fg: look.warn}); return; }
    const colors = distinctColors(board.puzzle.colors, look, look.surface.sunken);
    const wall = safe ? '|' : '│';
    const valid = (jar: number) => this.source >= 0 && jar !== this.source && pourAmount(board.jars, cap, this.source, jar) > 0;
    const unitColor = (jar: number, level: number, value: number) => mixRgb(colors[value]!, look.text.strong, 0.5 * (this.wave?.amount(jar * cap + level) ?? 0));

    if (layout.mode === 'wide') {
      board.jars.forEach((_, jar) => {
        const {units} = this.shown(jar);
        const here = jar === this.cursor, from = jar === this.source;
        const done = units.length === cap && units.every(u => u === units[0]);
        const row = layout.y + jar;
        canvas.text(layout.xs[0]!, row, from ? (safe ? '*' : '◆') : here ? (safe ? '>' : '▸') : valid(jar) ? '+' : ' ', {fg: from ? look.accent : valid(jar) ? look.ok : look.focus, bold: true});
        canvas.text(layout.xs[0]! + 1, row, jar === 9 ? '0' : String(jar + 1), {fg: here ? look.text.strong : look.text.dim, bold: here});
        canvas.text(layout.xs[0]! + 3, row, wall, {fg: here ? look.focus : look.text.dim});
        for (let level = 0; level < cap; level += 1) {
          const value = units[level];
          canvas.text(layout.xs[0]! + 4 + level * 2, row, value === undefined ? safe ? ' .' : ' ·' : ` ${LETTERS[value]}`, {fg: value === undefined ? look.text.dim : (color ? look.text.onAccent : undefined), bg: color && value !== undefined ? unitColor(jar, level, value) : undefined, bold: true});
        }
        canvas.text(layout.xs[0]! + 4 + cap * 2, row, wall + (done ? (safe ? '*' : '✦') : ''), {fg: here ? look.focus : look.text.dim});
      });
    } else {
      const {cellW, cellH, y, xs} = layout;
      const px = new PixelBuffer(canvas.width, canvas.height * 2);
      const glass = mixRgb(look.surface.base, look.surface.raised, 0.55);
      const baseRow = y + cap * cellH;
      const lifted = (jar: number) => layout.roomy && (jar === this.source || jar === this.anim?.from);
      const unitPx = cellH * 2;
      const levels: Array<{top: number; surface: number}> = [];
      board.jars.forEach((_, jar) => {
        const {units, level} = this.shown(jar);
        const y0 = y - (lifted(jar) ? 1 : 0), x0 = xs[jar]!;
        const bottom = (y0 + cap * cellH) * 2;
        const here = jar === this.cursor, from = jar === this.source || jar === this.anim?.from;
        const ok = valid(jar);
        const wallStyle = {fg: from ? look.accent : ok ? look.ok : here ? look.focus : look.text.dim, bold: here || from || ok};
        if (color) px.rect(x0, y0 * 2, cellW, cap * unitPx, glass);
        const liquidPx = Math.round(level * unitPx);
        levels[jar] = {top: y0 * 2, surface: bottom - liquidPx};
        for (let i = 0; i < units.length; i += 1) {
          const from = i * unitPx, to = Math.min(liquidPx, (i + 1) * unitPx);
          if (to <= from) break;
          const fill = unitColor(jar, i, units[i]!);
          if (color) {
            px.rect(x0, bottom - to, cellW, to - from, fill);
            // A lighter meniscus on the top of the liquid, and a sheen down the left side of the glass.
            if (i === units.length - 1 || to < (i + 1) * unitPx) px.rect(x0, bottom - to, cellW, 1, mixRgb(fill, WHITE, 0.3));
            px.rect(x0, bottom - to, 1, to - from, mixRgb(fill, WHITE, 0.12));
          }
        }
        for (let row = 0; row < cap * cellH; row += 1) { canvas.text(x0 - 1, y0 + row, wall, wallStyle); canvas.text(x0 + cellW, y0 + row, wall, wallStyle); }
        canvas.text(x0 - 1, baseRow - (lifted(jar) ? 1 : 0), (safe ? '+' : '╰') + (safe ? '-' : '─').repeat(cellW) + (safe ? '+' : '╯'), wallStyle);
        // Without color, units carry a pattern as well as their letter.
        if (!color) {
          for (let i = 0; i < Math.ceil(level - 1e-6); i += 1) {
            const row = y0 + (cap - 1 - i) * cellH;
            canvas.fill(x0, row, cellW, cellH, (safe ? SAFE_PATTERNS : PATTERNS)[units[i]! % PATTERNS.length]!);
          }
        }
      });
      // The pouring stream: out of the lifted jar, across the stream row and down into the target.
      if (color && layout.roomy && this.anim) {
        const anim = this.anim, t = anim.elapsed / anim.duration;
        if (t > 0.06 && t < 0.94) {
          const fill = mixRgb(colors[anim.color]!, WHITE, 0.15);
          const rowPx = (y - 2) * 2 + 1, width = cellW >= 4 ? 2 : 1;
          const sx = xs[anim.from]! + Math.floor((cellW - width) / 2), dx = xs[anim.to]! + Math.floor((cellW - width) / 2);
          px.rect(Math.min(sx, dx), rowPx, Math.abs(dx - sx) + width, 1, fill);
          px.rect(sx, rowPx, width, (y - 1) * 2 - rowPx, fill);
          px.rect(dx, rowPx, width, Math.max(0, levels[anim.to]!.surface - rowPx), fill);
        }
      }
      canvas.blit(px);
      board.jars.forEach((_, jar) => {
        const {units, level} = this.shown(jar);
        const y0 = y - (lifted(jar) ? 1 : 0), x0 = xs[jar]!;
        for (let i = 0; i < Math.floor(level + 1e-6); i += 1) {
          const value = units[i]!;
          canvas.put(x0 + Math.floor((cellW - 1) / 2), y0 + (cap - 1 - i) * cellH + Math.floor((cellH - 1) / 2), LETTERS[value]!, {fg: color ? look.text.onAccent : undefined, bold: true});
        }
        const here = jar === this.cursor, from = jar === this.source;
        const done = units.length === cap && units.every(u => u === units[0]) && !this.anim;
        const label = (jar === 9 ? '0' : String(jar + 1)) + (done ? (safe ? '*' : '✦') : '');
        const lx = x0 + Math.floor((cellW - label.length + 1) / 2);
        canvas.text(lx, baseRow + 1, label, {fg: here ? look.text.strong : valid(jar) ? look.ok : done ? look.ok : look.text.dim, bold: here || valid(jar)});
        if (layout.roomy && baseRow + 2 < canvas.height - 1) {
          const mark = here ? (safe ? '^' : '▲') : valid(jar) ? '+' : from ? (safe ? '*' : '◆') : '';
          if (mark) canvas.text(x0 + Math.floor((cellW - 1) / 2), baseRow + 2, mark, {fg: valid(jar) && !here ? look.ok : look.focus, bold: true});
        }
      });
    }
    const note = board.solved ? 'Every jar is sorted!' : this.note || (this.source >= 0 ? `Pour ${this.source + 1} into which jar?${board.jars.some((_, jar) => valid(jar)) ? ' (+ can take it)' : ''}` : canvas.width < 68 ? 'Pick a jar · u undo · ? hint' : 'Pick a jar (number, Space or click), then where to pour · u undo · ? hint');
    canvas.center(canvas.height - 1, note.slice(0, canvas.width - 2), {fg: board.solved ? look.ok : this.note.startsWith('Hint') ? look.accent : this.note ? look.warn : look.text.dim, bold: board.solved});
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
    if (this.screen === 'menu') return [{keys: '↑↓', action: 'shelf'}, {keys: '⏎', action: 'start'}, {keys: 'Esc', action: 'back'}];
    return [{keys: '←→', action: 'jar'}, {keys: 'Space', action: this.source >= 0 ? 'pour' : 'pick'}, {keys: '1-9', action: 'jar'}, {keys: 'u', action: 'undo'}, {keys: '?', action: 'hint'}];
  }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.wave = undefined; this.board = undefined; }
}

function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const colors = distinctColors(3, look);
  const jars = [[0, 1, 0], [1, 2, 2], [2, 0, 1], []];
  const t = Math.floor((frame % 24) / 6);
  const rows = Math.min(3, canvas.height - 3), pitch = 4, left = Math.floor((canvas.width - jars.length * pitch) / 2) + 1, top = Math.max(0, Math.floor((canvas.height - rows - 1) / 2));
  jars.forEach((jar, index) => {
    const shown = t >= 2 && index === 3 ? [2] : t >= 2 && index === 1 ? [1, 2] : jar;
    for (let level = 0; level < rows; level += 1) {
      const row = top + rows - 1 - level;
      canvas.text(left + index * pitch - 1, row, '│', {fg: look.text.dim});
      canvas.text(left + index * pitch + 1, row, '│', {fg: look.text.dim});
      const unit = shown[level];
      if (unit !== undefined) canvas.text(left + index * pitch, row, 'ABC'[unit]!, {fg: look.text.onAccent, bg: colors[unit]!, bold: true});
    }
    canvas.text(left + index * pitch - 1, top + rows, '╰─╯', {fg: look.text.dim});
  });
}

export const moonjarsGame: GameDefinition = {
  id: 'moonjars', aliases: ['jars', 'liquid-sort', 'water-sort'], title: 'Moonjars', tagline: 'Sort the glowing liquid',
  description: 'Pour glowing liquid between jars until every jar holds a single color. Each color also has a letter. Every shelf is dealt solvable and checked by a search.',
  kind: 'puzzle', category: 'logic',
  controls: [{keys: '←→', action: 'jar'}, {keys: 'Space', action: 'pick / pour'}, {keys: 'u', action: 'undo'}, {keys: '?', action: 'hint'}],
  howToPlay: [
    'Pick a jar, then the jar to pour into. The top color moves over if the other jar is empty or shows the same color on top, and as much as fits.',
    'Every jar must end up empty or full of one letter. Number keys pick a jar directly, ? suggests a pour, u undoes, r restarts the shelf.',
  ],
  summary: record => {
    const saved = readJars(record);
    const level = ([...LEVEL_IDS].reverse()).find(id => saved.best[id]);
    return level ? `Best ${saved.best[level]} pours · ${LEVELS[level].label.toLowerCase()}` : 'Not played yet';
  },
  preview,
  create: context => new Moonjars(context),
};
