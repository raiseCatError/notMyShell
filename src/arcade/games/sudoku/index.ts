import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem} from '../../effects.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {DIFFICULTIES, DIFFICULTY_LABEL, generatePuzzle, type Difficulty} from './generator.js';
import {readRecord, formatTime, recordWin, summarize, writeRecord, type Stats} from './record.js';
import type {Saved} from './state.js';
import {SudokuState} from './state.js';
import {completeUnits, drawMenu, drawPlay, POP_MS, type BoardView} from './view.js';

/** Longest single clock step the timer accepts, so a suspended laptop does not bank hours of "play". */
const MAX_TICK_MS = 2000;
const CELEBRATE_MS = 1800;
const GLOW_MS = 1400;
const MESSAGE_MS = 5000;

export interface SudokuInstance extends GameInstance {
  readonly state: SudokuState | undefined;
  readonly screen: 'menu' | 'play';
  readonly stats: Stats;
  /** Start a fresh puzzle of this difficulty (what the start menu does). */
  newPuzzle(difficulty: Difficulty): void;
  /** Back to the clues of the current puzzle: entries, notes, hints and the clock reset. */
  restartPuzzle(): void;
  /** Whether the person is looking at the completion celebration. */
  readonly celebrating: boolean;
}

class Sudoku implements SudokuInstance {
  state: SudokuState | undefined;
  screen: 'menu' | 'play' = 'menu';
  stats: Stats;
  result: GameResult | undefined;
  readonly stepsPerSecond = 0;
  private finished = false;
  private paused = false;
  private celebrateMs = -1;
  private confirmRestart = false;
  private message = '';
  private messageTone: BoardView['messageTone'] = 'info';
  private messageMs = 0;
  private menu: Menu;
  private current: Saved | undefined;
  private readonly pop = new Float32Array(81);
  private readonly glow = new Float32Array(27);
  private readonly fx: ParticleSystem;
  private pixels: PixelBuffer;
  private size: {columns: number; rows: number};
  private units: boolean[] = [];

  constructor(private readonly context: GameContext) {
    const stored = readRecord(context.record.get());
    this.stats = {bestTimes: stored.bestTimes, completed: stored.completed, completedByDifficulty: stored.completedByDifficulty, streak: stored.streak, bestStreak: stored.bestStreak};
    this.current = stored.current;
    this.size = context.size;
    this.fx = new ParticleSystem(context.rng.fork('sudoku-fx'), 120, context.motion.reduced ? 'off' : context.motion.effects);
    this.pixels = new PixelBuffer(context.size.columns, context.size.rows * 2);
    this.menu = this.buildMenu();
  }

  get status(): GameStatus {
    if (this.screen === 'menu') return 'ready';
    return this.finished && this.celebrateMs < 0 ? 'won' : 'playing';
  }
  get celebrating(): boolean { return this.celebrateMs >= 0; }
  get refreshMs(): number {
    if (this.celebrating || this.paused || this.fx.count > 0 || this.pop.some(left => left > 0) || this.glow.some(left => left > 0)) return 80;
    return this.screen === 'play' ? 1000 : 0;
  }

  // ---- menu ---------------------------------------------------------------------------------------------------

  private buildMenu(): Menu {
    const items = [];
    if (this.current) items.push({id: 'continue', label: 'Continue', hint: `${DIFFICULTY_LABEL[this.current.difficulty]} ${formatTime(this.current.elapsedMs / 1000)}`, key: 'c'});
    DIFFICULTIES.forEach((level, index) => {
      const best = this.stats.bestTimes[level];
      items.push({id: level, label: DIFFICULTY_LABEL[level], ...(best ? {hint: `best ${formatTime(best)}`} : {}), key: String(index + 1)});
    });
    items.push({id: 'back', label: 'Back to Arcade', key: 'q'});
    return new Menu(items);
  }

  private save(): void {
    this.context.record.set(writeRecord(this.current ? {...this.stats, current: this.current} : this.stats));
  }

  newPuzzle(difficulty: Difficulty): void {
    // Walking away from a puzzle that was started ends the streak; restarting or finishing does not.
    if (this.current && (this.current.elapsedMs > 0 || /[1-9]/u.test(this.current.entries))) this.stats.streak = 0;
    const made = generatePuzzle(difficulty, this.context.rng);
    this.begin(new SudokuState(difficulty, made.puzzle, made.solution));
    this.current = this.state!.toSaved();
    this.save();
  }

  private begin(state: SudokuState): void {
    this.state = state;
    this.screen = 'play';
    this.finished = false;
    this.result = undefined;
    this.paused = false;
    this.celebrateMs = -1;
    this.confirmRestart = false;
    this.message = '';
    this.pop.fill(0);
    this.glow.fill(0);
    this.fx.clear();
    this.units = completeUnits(state.grid);
    if (state.cursor === 40 && state.isClue(40)) state.moveTo(Math.max(0, state.grid.indexOf(0)));
  }

  restartPuzzle(): void {
    if (!this.state || this.finished) return;
    this.state.restart();
    this.pop.fill(0);
    this.glow.fill(0);
    this.units = completeUnits(this.state.grid);
    this.say('Restarted from the clues', 'info');
    this.current = this.state.toSaved();
    this.save();
  }

  private say(text: string, tone: BoardView['messageTone'] = 'info'): void { this.message = text; this.messageTone = tone; this.messageMs = MESSAGE_MS; }

  // ---- loop ---------------------------------------------------------------------------------------------------

  step(): void { /* turn-based: the clock runs in animate() */ }

  animate(dtMs: number): void {
    // The session calls animate again only after a pause menu closes, so the first call after pause() is the resume.
    if (this.paused) { this.paused = false; return; }
    const dt = Math.max(0, Math.min(MAX_TICK_MS, dtMs));
    if (this.screen === 'play' && this.state && !this.finished) this.state.elapsedMs += dt;
    for (let cell = 0; cell < 81; cell += 1) if (this.pop[cell]! > 0) this.pop[cell] = Math.max(0, this.pop[cell]! - dt);
    for (let unit = 0; unit < 27; unit += 1) if (this.glow[unit]! > 0) this.glow[unit] = Math.max(0, this.glow[unit]! - dt / GLOW_MS);
    if (this.messageMs > 0) { this.messageMs -= dt; if (this.messageMs <= 0) this.message = ''; }
    this.fx.update(dt);
    if (this.celebrateMs >= 0) { this.celebrateMs += dt; if (this.celebrateMs >= CELEBRATE_MS) this.celebrateMs = -1; }
  }

  pause(): void {
    if (this.screen !== 'play' || this.finished) return;
    this.paused = true;
    this.current = this.state!.toSaved();
    this.save();
  }

  // ---- keys ---------------------------------------------------------------------------------------------------

  key(key: Key): GameKeyResult {
    if (this.screen === 'menu') return this.menuKey(key);
    const state = this.state!;
    if (this.finished) {
      if (this.celebrating && (key.kind === 'enter' || key.kind === 'text')) { this.celebrateMs = -1; return 'handled'; }
      return 'ignored';
    }
    if ((key.kind !== 'text' || key.value.toLowerCase() !== 'r') && this.confirmRestart) { this.confirmRestart = false; this.message = ''; this.messageMs = 0; }
    switch (key.kind) {
      case 'up': state.move(-1, 0); return 'handled';
      case 'down': state.move(1, 0); return 'handled';
      case 'left': state.move(0, -1); return 'handled';
      case 'right': state.move(0, 1); return 'handled';
      case 'backspace': case 'delete': return this.after(state.erase(), false);
      case 'redo': return this.after(state.redo(), false);
      case 'text': return this.textKey(key.value);
      default: return 'ignored';
    }
  }

  private textKey(value: string): GameKeyResult {
    const state = this.state!;
    const lower = value.toLowerCase();
    if (/^[1-9]$/u.test(lower)) {
      const cell = state.cursor;
      if (state.isClue(cell)) { this.say('That one is a given', 'warn'); return 'handled'; }
      const changed = state.enter(Number(lower));
      if (changed && !state.notesMode) this.placed(cell);
      return this.after(changed, true);
    }
    switch (lower) {
      case '0': return this.after(state.erase(), false);
      case 'h': state.move(0, -1); return 'handled';
      case 'j': state.move(1, 0); return 'handled';
      case 'k': state.move(-1, 0); return 'handled';
      case 'l': state.move(0, 1); return 'handled';
      case 'n': state.notesMode = !state.notesMode; this.say(state.notesMode ? 'Notes on: digits add pencil marks' : 'Notes off', 'info'); return 'handled';
      case 'u': if (!state.undo()) this.say('Nothing to undo', 'warn'); return 'handled';
      case 'y': if (!state.redo()) this.say('Nothing to redo', 'warn'); return 'handled';
      case 't': return this.hint();
      case 'r':
        if (this.confirmRestart) { this.confirmRestart = false; this.restartPuzzle(); }
        else { this.confirmRestart = true; this.say('Press r again to restart this puzzle', 'warn'); }
        return 'handled';
      case 'm': this.persist(); this.leaveToMenu(); return 'handled';
      default: return 'ignored';
    }
  }

  private leaveToMenu(): void {
    this.paused = false;
    this.screen = 'menu';
    this.menu = this.buildMenu();
  }

  private hint(): GameKeyResult {
    const state = this.state!;
    const given = state.hint();
    if (!given) { this.say('No hint needed', 'info'); return 'handled'; }
    this.placed(given.cell);
    this.say(`Hint: ${given.message}`, 'good');
    return this.after(true, true);
  }

  private placed(cell: number): void {
    if (this.context.motion.reduced || this.context.motion.effects === 'off') return;
    this.pop[cell] = POP_MS;
  }

  /** After an edit: notice finished units and a solved grid. */
  private after(changed: boolean, forward: boolean): GameKeyResult {
    const state = this.state!;
    if (!changed) return 'handled';
    const now = completeUnits(state.grid);
    if (forward && !this.context.motion.reduced && this.context.motion.effects !== 'off') now.forEach((done, unit) => { if (done && !this.units[unit]) this.glow[unit] = 1; });
    this.units = now;
    if (state.solved) this.win();
    return 'handled';
  }

  private menuKey(key: Key): GameKeyResult {
    const choice = this.menu.key(key);
    if (!choice) return key.kind === 'escape' ? 'ignored' : 'handled';
    if (choice === 'back') return 'back';
    if (choice === 'continue' && this.current) { this.begin(SudokuState.fromSaved(this.current)); return 'handled'; }
    if ((DIFFICULTIES as readonly string[]).includes(choice)) this.newPuzzle(choice as Difficulty);
    return 'handled';
  }

  // ---- finishing ----------------------------------------------------------------------------------------------

  private win(): void {
    const state = this.state!;
    this.finished = true;
    const seconds = Math.max(1, Math.round(state.elapsedMs / 1000));
    const outcome = recordWin(this.stats, state.difficulty, seconds, state.hints);
    this.stats = outcome.stats;
    this.current = undefined;
    this.save();
    const best = this.stats.bestTimes[state.difficulty];
    this.result = {
      score: seconds, scoreText: formatTime(seconds), record: outcome.record,
      details: [DIFFICULTY_LABEL[state.difficulty], state.hints ? `${state.hints} hint${state.hints === 1 ? '' : 's'} used` : 'No hints', ...(best ? [`Best ${formatTime(best)}`] : []), `Streak ${this.stats.streak}`],
    };
    const calm = this.context.motion.reduced || this.context.motion.effects === 'off';
    if (calm) return;
    this.celebrateMs = 0;
    this.burstPending = true;
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  private burstPending = false;

  /** Three quiet fountains of the theme's colors, started on the first frame of the celebration. */
  private burst(palette: ArcadePalette): void {
    this.burstPending = false;
    const colors = [palette.accent, palette.haze, palette.ok, palette.cat.body];
    for (const share of [0.28, 0.5, 0.72]) {
      this.fx.burst({x: this.pixels.width * share, y: this.pixels.height * 0.7, count: 14, speed: Math.max(14, this.pixels.height * 0.9), angle: -Math.PI / 2, spread: 0.7, life: 1500, gravity: Math.max(20, this.pixels.height * 0.8), drag: 0.4, colors});
    }
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    if (this.burstPending) this.burst(palette);
    const view = {color: this.context.color !== 'none', safe: this.context.safeGlyphs};
    if (this.screen === 'menu' || !this.state) {
      drawMenu(canvas, palette, this.menu, {...view, note: this.current ? 'A puzzle is waiting' : 'Numbers, calmly'});
      return;
    }
    const heading = this.celebrating && this.result ? {heading: 'Solved', detail: `${this.result.scoreText} · ${this.result.details[0] ?? ''}`} : undefined;
    drawPlay(canvas, palette, {
      state: this.state, hidden: this.paused, ...view, pop: this.pop, glow: this.glow, message: this.confirmRestart || this.messageMs > 0 ? this.message : '', messageTone: this.messageTone, celebration: heading,
    });
    if (this.fx.count > 0) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.fx.draw(this.pixels, palette.deep);
      canvas.blit(this.pixels);
    }
  }

  resize(size: {columns: number; rows: number}): void {
    this.size = size;
    this.pixels = new PixelBuffer(size.columns, size.rows * 2);
  }

  hints(): readonly ControlHint[] {
    if (this.screen === 'menu') return [{keys: '↑↓', action: 'choose'}, {keys: 'Enter', action: 'start'}, {keys: '1-4', action: 'new'}, {keys: 'Esc', action: 'back'}];
    if (this.celebrating) return [{keys: 'Enter', action: 'continue'}];
    return [
      {keys: '←↑↓→/hjkl', action: 'move'}, {keys: '1-9', action: 'digit'}, {keys: '0', action: 'erase'}, {keys: 'n', action: this.state?.notesMode ? 'notes off' : 'notes'},
      {keys: 'u', action: 'undo'}, {keys: 'y', action: 'redo'}, {keys: 't', action: 'hint'}, {keys: 'r', action: 'restart'}, {keys: 'm', action: 'menu'}, {keys: 'Esc', action: 'pause'},
    ];
  }

  persist(): void {
    if (this.screen === 'play' && this.state && !this.finished) {
      this.current = this.state.toSaved();
      this.save();
    }
  }

  dispose(): void {
    this.fx.clear();
    this.state = undefined;
    this.current = undefined;
  }
}

/** The hub preview: one box filling in, quietly. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const digits = '534672198';
  const shown = Math.min(9, Math.floor((frame % 24) / 2));
  const width = 11;
  const left = Math.floor((canvas.width - width) / 2);
  const top = Math.floor((canvas.height - 3) / 2);
  for (let index = 0; index < 9; index += 1) {
    const x = left + (index % 3) * 4;
    const y = top + Math.floor(index / 3);
    const revealed = index < shown;
    const cursor = index === shown && shown < 9;
    canvas.text(x, y, cursor ? '[ ]' : ` ${revealed ? digits[index]! : '·'} `, {fg: revealed ? (index % 2 ? palette.accent : palette.ink) : palette.faint, bold: revealed || cursor});
  }
}

export const sudokuGame: GameDefinition = {
  id: 'sudoku', aliases: ['classic-sudoku'], title: 'Classic Sudoku', tagline: 'Numbers, calmly',
  description: 'The classic 9x9 puzzle in four difficulties, with pencil notes, hints, undo and unlimited fresh puzzles. Your puzzle in progress is saved.',
  kind: 'puzzle',
  controls: [{keys: '←↑↓→', action: 'move'}, {keys: '1-9', action: 'digit'}, {keys: 'n', action: 'notes'}, {keys: 'u', action: 'undo'}, {keys: 't', action: 'hint'}],
  summary: record => summarize(record),
  preview,
  create: context => new Sudoku(context),
};

export {DIFFICULTIES, generatePuzzle};
