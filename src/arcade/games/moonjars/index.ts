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
import {generateJars, JarBoard, LEVELS, LETTERS, type Level} from './logic.js';

/**
 * Moonjars: sort the liquid so every jar holds one color. Every unit carries a letter as well as a color, so the puzzle
 * reads without color. Tall jars when the terminal has room, one jar per row when it does not. Levels are dealt at
 * random and kept only when a search finds a solution.
 */
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
  get refreshMs(): number { return (this.wave && !this.wave.done) || this.particles.count ? 40 : 0; }

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
  }

  step(): void {}
  animate(dtMs: number): void { this.wave?.update(dtMs); this.particles.update(dtMs); }

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
    this.result = {score: board.moves, scoreText: `${board.moves} pours`, record, details: [LEVELS[this.level].label, `Best ${record ? board.moves : saved.best[this.level]} pours`, `Solved ${saved.wins + 1} times`]};
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
    if (!board.pour(from, jar)) { this.note = 'Cannot pour there'; return 'handled'; }
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
    const total = board.jars.length;
    const move = direction(k);
    if (move === 'left' || move === 'up') { this.cursor = (this.cursor + total - 1) % total; this.note = ''; return 'handled'; }
    if (move === 'right' || move === 'down') { this.cursor = (this.cursor + 1) % total; this.note = ''; return 'handled'; }
    if (k.kind === 'enter' || (k.kind === 'text' && k.value === ' ')) return this.choose(this.cursor);
    if (k.kind === 'text') {
      if (/^[0-9]$/u.test(k.value)) return this.choose(k.value === '0' ? 9 : Number(k.value) - 1);
      const value = k.value.toLowerCase();
      if (value === 'u') { this.source = -1; const undone = board.undo(); this.note = ''; return undone ? 'handled' : 'ignored'; }
      if (value === 'r') { board.restart(); this.source = -1; this.note = ''; return 'handled'; }
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

  private layout(): {mode: 'tall' | 'wide'; x: number; y: number; pitch: number} | undefined {
    const board = this.board!, jars = board.jars.length, cap = board.cap;
    if (jars * 4 <= this.size.columns && cap + 6 <= this.size.rows) return {mode: 'tall', pitch: 4, x: Math.floor((this.size.columns - jars * 4) / 2) + 1, y: 2 + Math.floor((this.size.rows - cap - 6) / 2)};
    const width = 5 + cap * 2 + 1;
    if (jars + 2 <= this.size.rows && width <= this.size.columns) return {mode: 'wide', pitch: 1, x: Math.floor((this.size.columns - width) / 2), y: 1 + Math.floor((this.size.rows - jars - 2) / 2)};
    return undefined;
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
    topRow(canvas, look, `Moonjars · ${LEVELS[this.level].label}`, `Pours ${board.moves}${this.startBest ? `  Best ${this.startBest}` : ''}`);
    const layout = this.layout();
    if (!layout) { canvas.center(Math.floor(canvas.height / 2), `Needs ${Math.min(board.jars.length * 4, 5 + cap * 2 + 1)}×${board.jars.length + 2}`, {fg: look.warn}); return; }
    const colors = distinctColors(board.puzzle.colors, look, look.surface.sunken);
    const unit = (jar: number, level: number) => {
      const value = board.jars[jar]![level];
      const glow = this.wave?.amount(jar * cap + level) ?? 0;
      return {value, glow, bg: value === undefined ? undefined : mixRgb(colors[value]!, look.text.strong, 0.5 * glow), text: value === undefined ? ' ' : LETTERS[value]!};
    };
    const wall = safe ? '|' : '│';
    board.jars.forEach((jarUnits, jar) => {
      const here = jar === this.cursor, from = jar === this.source;
      const done = jarUnits.length === cap && jarUnits.every(u => u === jarUnits[0]);
      if (layout.mode === 'tall') {
        const x = layout.x + jar * layout.pitch;
        for (let level = 0; level < cap; level += 1) {
          const row = layout.y + cap - 1 - level;
          const u = unit(jar, level);
          canvas.text(x - 1, row, wall, {fg: here ? look.focus : look.text.dim});
          canvas.text(x + 1, row, wall, {fg: here ? look.focus : look.text.dim});
          canvas.text(x, row, u.text, {fg: color ? look.text.onAccent : undefined, bg: color ? u.bg : undefined, bold: true});
        }
        canvas.text(x - 1, layout.y + cap, safe ? '+-+' : '╰─╯', {fg: here ? look.focus : look.text.dim});
        canvas.text(x, layout.y + cap + 1, jar === 9 ? '0' : String(jar + 1), {fg: here ? look.text.strong : look.text.dim, bold: here});
        if (here) canvas.text(x, layout.y + cap + 2, safe ? '^' : '▲', {fg: look.focus, bold: true});
        if (from) canvas.text(x, layout.y - 1, safe ? 'v' : '▼', {fg: look.accent, bold: true});
        if (done) canvas.text(x, layout.y - 1, safe ? '*' : '✦', {fg: look.ok, bold: true});
      } else {
        const row = layout.y + jar;
        canvas.text(layout.x, row, from ? (safe ? '*' : '◆') : here ? (safe ? '>' : '▸') : ' ', {fg: from ? look.accent : look.focus, bold: true});
        canvas.text(layout.x + 1, row, jar === 9 ? '0' : String(jar + 1), {fg: here ? look.text.strong : look.text.dim, bold: here});
        canvas.text(layout.x + 3, row, wall, {fg: here ? look.focus : look.text.dim});
        for (let level = 0; level < cap; level += 1) {
          const u = unit(jar, level);
          canvas.text(layout.x + 4 + level * 2, row, u.value === undefined ? safe ? ' .' : ' ·' : ` ${u.text}`, {fg: u.value === undefined ? look.text.dim : (color ? look.text.onAccent : undefined), bg: color ? u.bg : undefined, bold: true});
        }
        canvas.text(layout.x + 4 + cap * 2, row, wall + (done ? (safe ? '*' : '✦') : ''), {fg: here ? look.focus : look.text.dim});
      }
    });
    const note = board.solved ? 'Every jar is sorted!' : this.note || (this.source >= 0 ? `Pour ${this.source + 1} into which jar?` : canvas.width < 68 ? 'Pick a jar · u undo · ? hint' : 'Pick a jar (number or Space), then where to pour · u undo · ? hint');
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
