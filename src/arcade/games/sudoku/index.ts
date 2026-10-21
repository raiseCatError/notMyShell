import {mixRgb} from '../../../chroma/chroma.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem} from '../../effects.js';
import {confetti, Reveal} from '../../fx/cells.js';
import {arcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {DIFFICULTIES, DIFFICULTY_LABEL, generatePuzzle, type Difficulty} from './generator.js';
import {readRecord, formatTime, recordWin, summarize, writeRecord, type Stats} from './record.js';
import type {Saved} from './state.js';
import {SudokuState} from './state.js';
import {cellAtPoint, layoutFor} from './layout.js';
import {completeUnits, drawMenu, drawPlay, POP_MS, waveGroups, type BoardView} from './view.js';

/** Longest single clock step the timer accepts, so a suspended laptop does not bank hours of "play". */
const MAX_TICK_MS = 2000;
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
  /** Whether the solved board's light wave is still playing. */
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
  /** The solved board's light wave: the game's finale, played before the shared results sheet. */
  private wave: Reveal | undefined;
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
    return this.finished ? 'won' : 'playing';
  }
  get finale(): Reveal | undefined { return this.finished ? this.wave : undefined; }
  get celebrating(): boolean { return Boolean(this.wave && !this.wave.done); }
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
    this.wave = undefined;
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
    this.wave?.update(dt);
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
      if (this.celebrating && (key.kind === 'enter' || key.kind === 'text')) { this.wave!.skip(); return 'handled'; }
      return 'ignored';
    }
    if ((key.kind !== 'text' || key.value.toLowerCase() !== 'r') && this.confirmRestart) { this.confirmRestart = false; this.message = ''; this.messageMs = 0; }
    switch (key.kind) {
      case 'up': state.move(-1, 0); return 'handled';
      case 'down': state.move(1, 0); return 'handled';
      case 'left': state.move(0, -1); return 'handled';
      case 'right': state.move(0, 1); return 'handled';
      case 'mouseClick': {
        const layout = layoutFor(this.size.columns, this.size.rows);
        const at = layout && typeof key.x === 'number' && typeof key.y === 'number' ? cellAtPoint(layout, key.x - 1, key.y - 1) : undefined;
        if (at !== undefined) state.moveTo(at);
        return 'handled';
      }
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
    // Every cell lights in a diagonal wave from the top-left; Reduced Motion holds one calm, still highlight instead.
    this.wave = new Reveal(waveGroups(), this.context.motion, {stagger: 55, within: 0, rise: 140, hold: 260, fall: 520});
    this.burstPending = !this.context.motion.reduced && this.context.motion.effects !== 'off';
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  private burstPending = false;

  /** Soft confetti in the Arcade's hues, started on the first frame of the finale. */
  private burst(palette: ArcadePalette): void {
    this.burstPending = false;
    const look = arcadeLook(palette);
    confetti(this.fx, this.pixels.width, this.pixels.height, [look.ok, look.accent, look.hue.sky, look.hue.butter, look.hue.rose], this.context.motion);
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    if (this.burstPending) this.burst(palette);
    const view = {color: this.context.color !== 'none', safe: this.context.safeGlyphs};
    if (this.screen === 'menu' || !this.state) {
      drawMenu(canvas, palette, this.menu, {...view, note: this.current ? 'A puzzle is waiting' : 'Numbers, calmly'});
      return;
    }
    drawPlay(canvas, palette, {
      state: this.state, hidden: this.paused, ...view, pop: this.pop, glow: this.glow, message: this.confirmRestart || this.messageMs > 0 ? this.message : '', messageTone: this.messageTone,
      wave: this.wave, solved: this.finished && this.result ? `Solved in ${this.result.scoreText}` : undefined,
    });
    if (this.fx.count > 0) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.fx.draw(this.pixels, arcadeLook(palette).surface.base);
      canvas.blit(this.pixels);
    }
  }

  resize(size: {columns: number; rows: number}): void {
    this.size = size;
    this.pixels = new PixelBuffer(size.columns, size.rows * 2);
  }

  hints(): readonly ControlHint[] {
    if (this.screen === 'menu') return [{keys: '↑↓', action: 'choose'}, {keys: 'Enter', action: 'start'}, {keys: '1-4', action: 'new'}, {keys: 'Esc', action: 'back'}];
    if (this.celebrating) return [{keys: 'any key', action: 'skip'}];
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

/** The hub preview: a box of tiles filling in, the cursor moving on, and the box lighting up once it is complete. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const digits = '534672198';
  const clues = new Set([0, 4, 8]);
  const cycle = frame % 40;
  const shown = Math.min(9, Math.floor(cycle / 3));
  const complete = shown >= 9;
  const tileW = canvas.width >= 40 ? 7 : 5;
  const boxW = tileW * 3 + 4;
  const boxH = 9;
  const left = Math.floor((canvas.width - boxW) / 2);
  const top = Math.max(0, Math.floor((canvas.height - boxH) / 2));
  canvas.fill(left - 1, top - 1, boxW + 2, boxH + 2, ' ', {bg: look.surface.sunken});
  canvas.fill(left, top, boxW, boxH, ' ', {bg: look.surface.base});
  for (let index = 0; index < 9; index += 1) {
    const x = left + 1 + (index % 3) * (tileW + 1);
    const y = top + Math.floor(index / 3) * 3;
    const filled = clues.has(index) || index < shown;
    const cursor = !complete && index === shown;
    const glow = complete ? Math.max(0, 1 - Math.abs(cycle - 30 - index * 0.6) / 4) : 0;
    let fill = cursor ? look.accent : look.surface.raised;
    if (glow > 0) fill = mixRgb(fill, look.ok, 0.5 * glow);
    canvas.hline(x, y, tileW, '▄', {fg: fill, bg: look.surface.base});
    canvas.fill(x, y + 1, tileW, 1, ' ', {bg: fill});
    canvas.hline(x, y + 2, tileW, '▀', {fg: fill, bg: look.surface.base});
    if (filled) canvas.put(x + Math.floor(tileW / 2), y + 1, digits[index]!, {bg: fill, fg: cursor ? look.text.onAccent : clues.has(index) ? look.text.strong : look.hue.sky, bold: clues.has(index)});
  }
}

export const sudokuGame: GameDefinition = {
  id: 'sudoku', aliases: ['classic-sudoku'], title: 'Classic Sudoku', tagline: 'Numbers, calmly',
  description: 'The classic 9x9 puzzle in four difficulties, with pencil notes, hints, undo and unlimited fresh puzzles. Your puzzle in progress is saved.',
  kind: 'puzzle', category: 'logic',
  controls: [{keys: '←↑↓→', action: 'move'}, {keys: '1-9', action: 'digit'}, {keys: 'n', action: 'notes'}, {keys: 'u', action: 'undo'}, {keys: 't', action: 'hint'}],
  summary: record => summarize(record),
  preview,
  create: context => new Sudoku(context),
};

export {DIFFICULTIES, generatePuzzle};
