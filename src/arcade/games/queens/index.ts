import {mixRgb} from '../../../chroma/chroma.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem} from '../../effects.js';
import {Menu, type MenuItem} from '../../menu.js';
import {regionColors, type ArcadePalette} from '../../palette.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import type {Key} from '../../../terminal/keys.js';
import {typeset} from '../../../ui/typography.js';
import {truncateText} from '../../../util/text.js';
import {QueensBoard, formatTime, newBoard, readCurrent, readStats, writeStats} from './board.js';
import {SIZES, makePuzzle} from './puzzle.js';
import {regionLetter} from './rules.js';
import {renderBoard, SETTLE_MS} from './render.js';
import {nextHint, type Hint} from './solver.js';
import {CAT, DIFFICULTIES, type Difficulty} from './types.js';

const MAX_TICK_MS = 5000;
const SCHEMA_VERSION = 1;

const cap = (word: string): string => `${word[0]!.toUpperCase()}${word.slice(1)}`;
const sizeRange = (difficulty: Difficulty): string => { const [low, high] = SIZES[difficulty]; return low === high ? `${low}×${low}` : `${low}×${low}–${high}×${high}`; };

const CONTROLS: readonly ControlHint[] = [
  {keys: '←↑↓→ hjkl', action: 'move'}, {keys: 'Space', action: 'cat'}, {keys: 'x', action: 'exclude'}, {keys: 'u', action: 'undo'},
  {keys: 'Ctrl+Y', action: 'redo'}, {keys: 't', action: 'hint'}, {keys: 'Esc', action: 'pause'},
];

let demo: ReturnType<typeof makePuzzle> | undefined;

class QueensGame implements GameInstance {
  result: GameResult | undefined;
  readonly stepsPerSecond = 0;
  private screen: 'menu' | 'play' | 'won' = 'menu';
  private board: QueensBoard | undefined;
  private menu: Menu;
  private cursor = 0;
  private hint: Hint | undefined;
  private message = '';
  private armedRestart = false;
  private paused = false;
  private idleMs = 0;
  private size: {columns: number; rows: number};
  private settle = new Float32Array(0);
  private settling = 0;
  private readonly particles: ParticleSystem;
  private disposed = false;
  private saved: QueensBoard | undefined;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('queens-fx'), 120, context.motion.effects);
    const record = context.record.get();
    const saved = record.current === undefined ? undefined : readCurrent(record.current);
    if (record.current !== undefined && !saved) context.record.update(entry => { delete entry.current; });
    this.saved = saved;
    this.menu = this.buildMenu(saved);
  }

  get status(): GameStatus { return this.screen === 'menu' ? 'ready' : this.screen === 'won' ? 'won' : 'playing'; }
  /** A repaint every second for the clock; faster while something is settling, blinking or waking from pause. */
  get refreshMs(): number {
    if (this.paused || this.settling > 0) return 50;
    if (this.screen === 'play' && !this.context.motion.reduced) return 250;
    return 1000;
  }

  // ---- menu ---------------------------------------------------------------------------------------------------

  private buildMenu(saved: QueensBoard | undefined): Menu {
    const stats = readStats(this.context.record.get());
    const items: MenuItem[] = [];
    if (saved) items.push({id: 'continue', label: 'Continue', key: 'c', hint: `${cap(saved.difficulty)} ${saved.size}×${saved.size} · ${formatTime(saved.elapsedMs)}`});
    for (const difficulty of DIFFICULTIES) {
      const best = stats.bestTimes[difficulty];
      items.push({id: difficulty, label: `New ${difficulty} puzzle`, key: difficulty === 'expert' ? 'x' : difficulty[0]!, hint: best ? `${sizeRange(difficulty)} · best ${formatTime(best)}` : sizeRange(difficulty)});
    }
    return new Menu(items);
  }

  private startPuzzle(board: QueensBoard): void {
    this.board = board;
    this.screen = 'play';
    this.cursor = Math.floor(board.size / 2) * board.size + Math.floor(board.size / 2);
    this.settle = new Float32Array(board.size * board.size).fill(-1);
    this.settling = 0;
    this.hint = undefined;
    this.message = '';
    this.armedRestart = false;
    this.paused = false;
    this.persistCurrent();
  }

  // ---- time and animation -------------------------------------------------------------------------------------

  step(): void { /* turn-based: the clock runs in animate */ }

  animate(dtMs: number): void {
    if (this.disposed) return;
    if (this.paused) { this.paused = false; return; }
    this.idleMs += dtMs;
    this.particles.update(dtMs);
    if (this.settling > 0) {
      this.settling = 0;
      for (let cell = 0; cell < this.settle.length; cell += 1) {
        const age = this.settle[cell]!;
        if (age < 0) continue;
        if (age + dtMs >= SETTLE_MS) this.settle[cell] = -1;
        else { this.settle[cell] = age + dtMs; this.settling += 1; }
      }
    }
    if (this.screen === 'play' && this.board) this.board.elapsedMs = Math.min(this.board.elapsedMs + Math.min(dtMs, MAX_TICK_MS), 99 * 3_600_000);
  }

  pause(): void {
    if (this.screen === 'play') { this.paused = true; this.persistCurrent(); }
  }

  // ---- keys ---------------------------------------------------------------------------------------------------

  key(key: Key): GameKeyResult {
    if (this.screen === 'menu') return this.menuKey(key);
    const board = this.board;
    if (this.screen !== 'play' || !board) return 'ignored';
    this.paused = false;
    const size = board.size;
    const row = Math.floor(this.cursor / size);
    const column = this.cursor % size;
    const value = key.kind === 'text' ? key.value.toLowerCase() : '';
    const restartArmed = this.armedRestart;
    this.armedRestart = false;
    if (key.kind === 'up' || value === 'k') this.cursor = Math.max(0, row - 1) * size + column;
    else if (key.kind === 'down' || value === 'j') this.cursor = Math.min(size - 1, row + 1) * size + column;
    else if (key.kind === 'left' || value === 'h') this.cursor = row * size + Math.max(0, column - 1);
    else if (key.kind === 'right' || value === 'l') this.cursor = row * size + Math.min(size - 1, column + 1);
    else if (key.kind === 'enter' || value === ' ') { this.message = ''; this.change(board.toggleCat(this.cursor), [this.cursor]); }
    else if (value === 'x') { this.message = ''; this.change(board.toggleExclude(this.cursor), []); }
    else if (value === 'u') { this.message = board.canUndo ? '' : 'Nothing to undo.'; this.change(board.undo(), []); }
    else if (key.kind === 'redo' || value === 'y') { this.message = board.canRedo ? '' : 'Nothing to redo.'; this.change(board.redo(), []); }
    else if (value === 'c') { this.message = ''; this.change(board.clearMarks(), []); if (!this.message && !board.canUndo) this.message = 'The board is already clear.'; }
    else if (value === 't') this.hintKey(board);
    else if (value === 'r') {
      if (restartArmed) { board.restart(); this.settle.fill(-1); this.settling = 0; this.hint = undefined; this.message = 'Restarted: same puzzle, clock at zero.'; this.persistCurrent(); }
      else { this.armedRestart = true; this.message = 'Press r again to restart this puzzle (clock and hints reset).'; }
    } else if (value === 'n') { this.persistCurrent(); this.toMenu(); }
    else return 'ignored';
    return 'handled';
  }

  private menuKey(key: Key): GameKeyResult {
    if (key.kind === 'escape') return 'ignored';
    const choice = this.menu.key(key);
    if (!choice) return key.kind === 'up' || key.kind === 'down' || key.kind === 'text' || key.kind === 'complete' ? 'handled' : 'ignored';
    if (choice === 'continue' && this.saved) this.startPuzzle(this.saved);
    else if ((DIFFICULTIES as readonly string[]).includes(choice)) {
      this.startPuzzle(newBoard(this.context.rng.int(1, 0x7fffffff), choice as Difficulty));
    }
    return 'handled';
  }

  private toMenu(): void {
    this.screen = 'menu';
    this.board = undefined;
    this.saved = (() => { const entry = this.context.record.get().current; return entry === undefined ? undefined : readCurrent(entry); })();
    this.menu = this.buildMenu(this.saved);
    this.hint = undefined;
    this.message = '';
  }

  /** Any change to the marks drops a pending hint, restarts settle animations and checks for the win. */
  private change(changed: boolean, placed: number[]): void {
    const board = this.board!;
    if (!changed) return;
    this.hint = undefined;
    if (!this.context.motion.reduced) {
      for (const cell of placed) if (board.marks[cell] === CAT) { this.settle[cell] = 0; this.settling += 1; }
    }
    this.persistCurrent();
    if (board.solved) this.win();
  }

  private hintKey(board: QueensBoard): void {
    if (this.hint) {
      const hint = this.hint;
      this.hint = undefined;
      const placed = hint.changes.filter(change => change.to === CAT).map(change => change.cell);
      this.message = '';
      this.change(board.apply(hint.changes), placed);
      return;
    }
    const hint = nextHint(board.size, board.puzzle.regions, board.puzzle.solution, board.marks);
    if (!hint) { this.message = 'Nothing left to hint: the board is complete.'; return; }
    board.hints += 1;
    this.hint = hint;
    this.message = `${hint.text} Press t again to do it.`;
    if (hint.targets[0] !== undefined) this.cursor = hint.targets[0];
    this.persistCurrent();
  }

  // ---- finishing ----------------------------------------------------------------------------------------------

  private win(): void {
    const board = this.board!;
    this.screen = 'won';
    this.hint = undefined;
    const stats = readStats(this.context.record.get());
    const best = stats.bestTimes[board.difficulty];
    stats.completed += 1;
    stats.completedByDifficulty[board.difficulty] += 1;
    const clean = board.hints === 0;
    const newBest = clean && (best === undefined || board.elapsedMs < best);
    if (newBest) stats.bestTimes[board.difficulty] = Math.max(1, Math.round(board.elapsedMs));
    stats.streak = clean ? stats.streak + 1 : 0;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    this.context.record.update(entry => { writeStats(entry, stats); entry.version = SCHEMA_VERSION; delete entry.current; });
    const shown = newBest ? board.elapsedMs : best;
    this.result = {
      score: Math.round(board.elapsedMs / 1000), scoreText: formatTime(board.elapsedMs), record: newBest,
      details: [
        `${cap(board.difficulty)} ${board.size}×${board.size}`,
        board.hints === 0 ? 'No hints' : `${board.hints} hint${board.hints === 1 ? '' : 's'}`,
        newBest ? 'New best time' : shown !== undefined ? `Best ${formatTime(shown)}` : 'Hinted solves do not set best times',
        `Solved ${stats.completed} · streak ${stats.streak}`,
      ],
    };
    this.celebrate();
  }

  private celebrate(): void {
    const motion = this.context.motion;
    if (motion.reduced || motion.effects === 'off') return;
    const colors = regionColors(this.board!.size, {red: 12, green: 10, blue: 22});
    this.particles.burst({x: this.size.columns / 2, y: this.size.rows, count: 36, speed: 46, life: 900, gravity: 24, drag: 0.6, colors});
    this.particles.update(280);
  }

  private persistCurrent(): void {
    if (this.screen !== 'play' || !this.board) return;
    const current = this.board.toRecord();
    this.context.record.update(entry => { entry.version = SCHEMA_VERSION; entry.current = current; });
  }

  persist(): void { this.persistCurrent(); }

  // ---- drawing ------------------------------------------------------------------------------------------------

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    if (this.screen === 'menu' || !this.board) { this.renderMenu(canvas, palette); return; }
    const plain = this.context.color === 'none' || this.context.safeGlyphs;
    renderBoard(canvas, palette, {
      board: this.board, cursor: this.cursor, hint: this.hint, idleMs: this.idleMs, settle: this.settle, reduced: this.context.motion.reduced,
      plain, safe: this.context.safeGlyphs, paused: this.paused, won: this.screen === 'won', message: this.message,
    });
    if (this.particles.count > 0) {
      const layer = new PixelBuffer(canvas.width, canvas.height * 2);
      this.particles.draw(layer, palette.deep);
      canvas.blit(layer);
    }
  }

  private renderMenu(canvas: Canvas, palette: ArcadePalette): void {
    canvas.clear(palette.deep);
    const stats = readStats(this.context.record.get());
    const width = canvas.width;
    const title = typeset({role: 'title', text: 'Vespyr Queens', maxColumns: Math.max(8, width - 4), maxRows: 2});
    const tall = canvas.height >= this.menu.items.length + title.rows + 5;
    let y = 0;
    if (tall) {
      canvas.typeBlock(title, 2, y, {fg: palette.ink, bold: true});
      y += title.rows;
      canvas.text(2, y, truncateText('A cat in every row, column and color. No two touching.', width - 4), {fg: palette.accent});
      y += 2;
    } else {
      canvas.text(1, y, 'Vespyr Queens', {fg: palette.ink, bold: true});
      y += 1;
    }
    this.menu.draw(canvas, palette, 0, y, width);
    y += this.menu.items.length + 1;
    const line = stats.completed > 0
      ? `Solved ${stats.completed} · streak ${stats.streak} (best ${stats.bestStreak})`
      : 'Hints explain a logical step first; a second press applies it.';
    if (y < canvas.height) canvas.center(y, truncateText(line, width - 2), {fg: palette.faint});
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  hints(): readonly ControlHint[] {
    return this.screen === 'play' ? CONTROLS : [{keys: '↑↓', action: 'choose'}, {keys: 'Enter', action: 'select'}, {keys: 'Esc', action: 'back'}];
  }

  dispose(): void {
    this.disposed = true;
    this.particles.clear();
    this.board = undefined;
    this.saved = undefined;
    this.result = undefined;
  }
}

/** A mini board for the hub: the demo puzzle's regions, with cats arriving one by one. */
function drawPreview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  demo ??= makePuzzle(7, 'easy');
  const size = demo.size;
  const colors = regionColors(size, palette.deep, palette);
  const cw = canvas.width >= size * 4 ? 4 : 3;
  const left = Math.max(0, Math.floor((canvas.width - size * cw) / 2));
  const placed = Math.floor(frame / 6) % (size + 3);
  for (let row = 0; row < Math.min(size, canvas.height); row += 1) {
    for (let column = 0; column < size; column += 1) {
      const cell = row * size + column;
      const bg = colors[demo.regions[cell]!]!;
      const cat = demo.solution[row] === column && row < placed;
      canvas.fill(left + column * cw, row, cw, 1, ' ', {bg, fg: palette.deep});
      canvas.text(left + column * cw + (cw === 4 ? 1 : 0), row, cat ? '^.^' : regionLetter(demo.regions[cell]!), {fg: cat ? mixRgb(palette.cat.body, palette.haze, 0.2) : mixRgb(palette.deep, bg, 0.3), bg: cat ? mixRgb(bg, palette.deep, 0.5) : bg, bold: cat});
    }
  }
}

export const queensGame: GameDefinition = {
  id: 'queens', aliases: ['vespyr-queens', 'vespyr-doku', 'doku'], title: 'Vespyr Queens', tagline: 'Cats and colored regions',
  description: 'One cat in every row, column and colored region, and no two cats touching. Unlimited puzzles, four difficulties, logical hints.',
  kind: 'puzzle', category: 'logic',
  controls: [{keys: 'Space', action: 'cat'}, {keys: 'x', action: 'exclude'}, {keys: 'u', action: 'undo'}, {keys: 't', action: 'hint'}],
  summary: record => {
    const stats = readStats(record);
    if (stats.completed === 0) return 'Not played yet';
    const best = [...DIFFICULTIES].reverse().find(difficulty => stats.bestTimes[difficulty] !== undefined);
    return best ? `Solved ${stats.completed} · best ${best} ${formatTime(stats.bestTimes[best]!)}` : `Solved ${stats.completed}`;
  },
  preview: drawPreview,
  create: context => new QueensGame(context),
};
