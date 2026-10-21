import {mixRgb} from '../../../chroma/chroma.js';
import type {Rgb} from '../../../chroma/escape.js';
import type {Key} from '../../../terminal/keys.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem} from '../../effects.js';
import {confetti, Reveal} from '../../fx/cells.js';
import {topRow} from '../../kit.js';
import {arcadeLook, type ArcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import type {ControlHint, Finale, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {afterRound, answers, daily, finished, isWord, LENGTH, letterMarks, readStats, score, solved, TRIES, writeStats, type Mark, type Round} from './logic.js';

/**
 * Purrword: a daily five-letter word, entirely offline, and unlimited practice. Letters flip one by one to show their
 * marks; the keyboard below keeps the best mark of each letter. Marks never rely on color: a correct letter is
 * underlined with a bar beneath its tile, a present one has a dot, and without color they are [A], (A) and  A .
 */
const FLIP_MS = 240;
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function markColor(look: ArcadeLook, mark: Mark | undefined): Rgb {
  if (mark === 'correct') return look.ok;
  if (mark === 'present') return look.hue.butter;
  if (mark === 'absent') return mixRgb(look.surface.sunken, look.surface.base, 0.4);
  return look.surface.raised;
}

class Purrword implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 0;
  private screen: 'menu' | 'play' = 'menu';
  private round: Round | undefined;
  private typed = '';
  private menu: Menu;
  private message = '';
  private messageMs = 0;
  private shakeMs = 0;
  /** The flip of the latest guess: one group per letter. */
  private flip: Reveal | undefined;
  private wave: Reveal | undefined;
  /** How long the latest flip has run; a tile shows its mark once the flip passes its midpoint. */
  private flipElapsed = 0;
  private readonly particles: ParticleSystem;
  private pixels = new PixelBuffer(0, 0);
  private size: {columns: number; rows: number};

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('purrword-fx'), 120, context.motion.effects);
    this.menu = this.buildMenu();
  }

  private today(): string { return this.context.today; }

  private buildMenu(): Menu {
    const stats = readStats(this.context.record.get());
    const today = daily(this.today());
    const done = stats.lastDaily === this.today();
    const resume = stats.current?.day === this.today();
    return new Menu([
      {id: 'daily', label: `Daily #${today.number}`, key: 'd', hint: done ? (stats.lastDailyWon ? '✓ solved today' : 'played today') : resume ? `${stats.current!.guesses.length} of ${TRIES} tried` : 'new today'},
      {id: 'practice', label: 'Practice', key: 'p', hint: 'a random word, any time'},
    ]);
  }

  get status(): GameStatus {
    if (this.screen === 'menu' || !this.round) return 'ready';
    if (!finished(this.round) || (this.flip && !this.flip.done)) return 'playing';
    return solved(this.round) ? 'won' : 'over';
  }
  get finale(): Finale | undefined { return this.round && finished(this.round) ? this.wave : undefined; }
  get refreshMs(): number { return (this.flip && !this.flip.done) || (this.wave && !this.wave.done) || this.shakeMs > 0 || this.particles.count || this.messageMs > 0 ? 40 : 0; }

  private start(kind: 'daily' | 'practice'): void {
    const stats = readStats(this.context.record.get());
    if (kind === 'daily') {
      if (stats.lastDaily === this.today()) { this.say(stats.lastDailyWon ? 'Already solved today: try Practice, or come back tomorrow.' : 'Today\'s word is done: try Practice.'); return; }
      this.round = {answer: daily(this.today()).word, guesses: stats.current?.day === this.today() ? [...stats.current.guesses] : [], daily: this.today()};
    } else {
      this.round = {answer: createRng(this.context.rng.int(1, 0x7fffffff)).pick(answers), guesses: [], daily: undefined};
    }
    this.typed = '';
    this.flip = undefined;
    this.wave = undefined;
    this.result = undefined;
    this.screen = 'play';
  }

  private say(text: string): void { this.message = text; this.messageMs = 2200; }

  step(): void {}

  animate(dtMs: number): void {
    this.flip?.update(dtMs);
    this.flipElapsed += dtMs;
    if (!this.flip || this.flip.done) this.wave?.update(dtMs);
    this.particles.update(dtMs);
    this.shakeMs = Math.max(0, this.shakeMs - dtMs);
    this.messageMs = Math.max(0, this.messageMs - dtMs);
    if (this.messageMs === 0) this.message = '';
  }

  key(key: Key): GameKeyResult {
    if (this.screen === 'menu') {
      if (key.kind === 'escape') return 'ignored';
      const choice = this.menu.key(key);
      if (choice) this.start(choice as 'daily' | 'practice');
      return 'handled';
    }
    const round = this.round!;
    if (finished(round)) { this.flip?.skip(); this.flipElapsed = Infinity; this.wave?.skip(); return 'ignored'; }
    if (this.flip && !this.flip.done) { this.flip.skip(); this.flipElapsed = Infinity; }
    if (key.kind === 'paste') return 'handled';
    if (key.kind === 'backspace') { this.typed = this.typed.slice(0, -1); return 'handled'; }
    if (key.kind === 'enter') { this.submit(); return 'handled'; }
    if (key.kind === 'text' && /^[a-z]$/iu.test(key.value) && this.typed.length < LENGTH) { this.typed += key.value.toLowerCase(); return 'handled'; }
    return 'ignored';
  }

  private submit(): void {
    const round = this.round!;
    if (this.typed.length < LENGTH) { this.say('Five letters, please'); this.shakeMs = 300; return; }
    if (!isWord(this.typed)) { this.say('Not in the word list'); this.shakeMs = 300; return; }
    round.guesses.push(this.typed);
    this.flipElapsed = 0;
    this.typed = '';
    const row = round.guesses.length - 1;
    this.flip = new Reveal([0, 1, 2, 3, 4].map(column => [row * LENGTH + column]), this.context.motion, {stagger: FLIP_MS, within: 0, rise: FLIP_MS / 2, hold: 0, fall: FLIP_MS / 2});
    if (finished(round)) this.finish();
    else if (round.daily) this.context.record.update(raw => { const stats = readStats(raw); stats.current = {day: round.daily!, guesses: round.guesses}; writeStats(raw, stats); });
  }

  private finish(): void {
    const round = this.round!;
    const before = readStats(this.context.record.get());
    const after = afterRound(before, round);
    this.context.record.update(raw => writeStats(raw, after));
    const won = solved(round);
    const row = round.guesses.length - 1;
    // The winning row bounces, letter by letter, once its flip has finished.
    this.wave = new Reveal([[], [], [], [], [], ...[0, 1, 2, 3, 4].map(column => (won ? [row * LENGTH + column] : []))].filter((group, index) => index >= 5 || group.length), this.context.motion, {stagger: 90, within: 0, rise: 140, hold: 60, fall: 260});
    if (won) confetti(this.particles, this.size.columns, this.size.rows * 2, [arcadeLook().ok, arcadeLook().hue.butter, arcadeLook().accent], this.context.motion);
    const label = round.daily ? `Daily #${daily(round.daily).number}` : 'Practice';
    this.result = {
      score: won ? TRIES + 1 - round.guesses.length : 0, scoreText: won ? `${round.guesses.length}/${TRIES}` : round.answer.toUpperCase(),
      record: won && Boolean(round.daily) && after.streak > before.bestStreak && after.streak > 1,
      details: [won ? `${label} · solved` : `${label} · the word was ${round.answer.toUpperCase()}`, `Streak ${after.streak} · best ${after.bestStreak}`, `Won ${after.won} of ${after.played}`, this.spreadLine(after.spread)],
    };
  }

  private spreadLine(spread: number[]): string { return spread.map((value, index) => `${index + 1}:${value}`).join(' '); }

  // ---- drawing ------------------------------------------------------------------------------------------------

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none' && !this.context.safeGlyphs;
    canvas.clear(this.context.color !== 'none' ? look.surface.base : undefined);
    const stats = readStats(this.context.record.get());
    if (this.screen === 'menu' || !this.round) {
      topRow(canvas, look, 'Purrword', stats.played ? `Won ${stats.won} of ${stats.played} · streak ${stats.streak}` : 'Not played yet');
      const top = Math.max(2, Math.floor(canvas.height / 2) - 5);
      canvas.center(top, 'Find the five-letter word in six tries', {fg: look.text.strong, bold: true});
      canvas.center(top + 1, 'One daily word for everyone on the same date · offline', {fg: look.text.dim});
      this.menu.draw(canvas, palette, 0, top + 3, canvas.width);
      if (this.message) canvas.center(top + 7, this.message, {fg: look.warn});
      return;
    }
    const round = this.round;
    topRow(canvas, look, round.daily ? `Purrword · daily #${daily(round.daily).number}` : 'Purrword · practice', `Try ${Math.min(TRIES, round.guesses.length + 1)} of ${TRIES}  ·  streak ${stats.streak}`);
    const big = canvas.height >= TRIES * 3 + 9 && canvas.width >= 40;
    const tileW = big ? 5 : 3;
    const tileH = big ? 3 : 1;
    const gap = 1;
    const gridW = LENGTH * tileW + (LENGTH - 1) * gap;
    const left = Math.floor((canvas.width - gridW) / 2);
    const top = 2;
    for (let row = 0; row < TRIES; row += 1) {
      const guess = round.guesses[row];
      const marks = guess ? score(guess, round.answer) : undefined;
      const typing = row === round.guesses.length;
      const shake = typing && this.shakeMs > 0 && !this.context.motion.reduced ? (Math.floor(this.shakeMs / 50) % 2 ? 1 : -1) : 0;
      for (let column = 0; column < LENGTH; column += 1) {
        const cell = row * LENGTH + column;
        const letter = guess?.[column] ?? (typing ? this.typed[column] : undefined);
        const flipping = this.flip && row === round.guesses.length - 1 ? this.flip.amount(cell) : 0;
        const revealed = marks && !(this.flip && !this.flip.done && row === round.guesses.length - 1 && this.flipElapsed < column * FLIP_MS + FLIP_MS / 2);
        const mark = revealed ? marks[column] : undefined;
        const bounce = this.wave ? Math.round(this.wave.amount(cell) * -1) : 0;
        const x = left + column * (tileW + gap) + shake;
        const y = top + row * (tileH + (big ? 0 : 1)) + bounce;
        this.drawTile(canvas, look, x, y, tileW, tileH, letter, mark, flipping, color, typing && column === this.typed.length);
      }
    }
    const keysTop = top + TRIES * (tileH + (big ? 0 : 1)) + 1;
    this.drawKeyboard(canvas, look, keysTop, color);
    if (this.message) canvas.center(Math.min(canvas.height - 1, keysTop + 4), this.message, {fg: look.warn, bold: true});
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
  }

  private drawTile(canvas: Canvas, look: ArcadeLook, x: number, y: number, w: number, h: number, letter: string | undefined, mark: Mark | undefined, flipping: number, color: boolean, caret: boolean): void {
    const shown = letter?.toUpperCase() ?? '';
    if (!color) {
      const text = mark === 'correct' ? `[${shown}]` : mark === 'present' ? `(${shown})` : ` ${shown || (this.context.safeGlyphs ? '.' : '·')} `;
      canvas.text(x + Math.floor((w - 3) / 2), y + Math.floor(h / 2), text, {bold: Boolean(mark && mark !== 'absent'), underline: caret});
      return;
    }
    let fill = markColor(look, mark);
    if (!mark && letter) fill = look.surface.raised2;
    if (flipping > 0) fill = mixRgb(fill, look.text.strong, 0.3 * Math.sin(flipping * Math.PI));
    const ink = mark === 'correct' || mark === 'present' ? look.text.onAccent : look.text.strong;
    if (h === 3) {
      canvas.hline(x, y, w, '▄', {fg: fill, bg: look.surface.base});
      canvas.fill(x, y + 1, w, 1, ' ', {bg: fill});
      canvas.hline(x, y + 2, w, '▀', {fg: mark === 'correct' ? mixRgb(look.ok, look.surface.sunken, 0.4) : fill, bg: look.surface.base});
    } else canvas.fill(x, y, w, 1, ' ', {bg: fill});
    const middle = y + Math.floor(h / 2);
    canvas.put(x + Math.floor(w / 2), middle, shown || ' ', {fg: ink, bg: fill, bold: true, underline: mark === 'correct' || caret});
    if (mark === 'present' && w >= 5) canvas.put(x + w - 1, middle, '•', {fg: mixRgb(look.hue.butter, look.surface.sunken, 0.55), bg: fill});
  }

  private drawKeyboard(canvas: Canvas, look: ArcadeLook, top: number, color: boolean): void {
    const marks = letterMarks(this.round!);
    ROWS.forEach((row, index) => {
      const width = row.length * 4 - 1;
      const left = Math.floor((canvas.width - width) / 2);
      [...row].forEach((letter, column) => {
        const mark = marks.get(letter);
        const x = left + column * 4;
        if (!color) { canvas.text(x, top + index, mark === 'correct' ? `[${letter.toUpperCase()}]` : mark === 'present' ? `(${letter.toUpperCase()})` : mark === 'absent' ? ' · ' : ` ${letter.toUpperCase()} `); return; }
        const fill = mark ? markColor(look, mark) : look.surface.raised;
        canvas.text(x, top + index, ` ${letter.toUpperCase()} `, {fg: mark === 'absent' ? look.text.dim : mark ? look.text.onAccent : look.text.strong, bg: fill, bold: mark !== 'absent', underline: mark === 'correct'});
      });
    });
  }

  resize(size: {columns: number; rows: number}): void { this.size = size; }
  pause(): void {}
  hints(): readonly ControlHint[] {
    if (this.screen === 'menu') return [{keys: '↑↓', action: 'choose'}, {keys: '⏎', action: 'play'}, {keys: 'Esc', action: 'back'}];
    return [{keys: 'a-z', action: 'type'}, {keys: '⌫', action: 'delete'}, {keys: '⏎', action: 'guess'}];
  }
  persist(): void {}
  dispose(): void { this.particles.clear(); }
}

/** The hub preview: a few rows of guesses revealing, ending on the word PURRS. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const rows = [['crane', 'absent absent absent absent absent'], ['stomp', 'absent absent absent absent present'], ['purse', 'correct correct correct absent present'], ['purrs', 'correct correct correct correct correct']] as const;
  const shown = Math.min(rows.length, Math.floor((frame % 48) / 10) + 1);
  const left = Math.floor((canvas.width - 19) / 2), top = Math.max(0, Math.floor((canvas.height - rows.length * 2) / 2));
  rows.slice(0, shown).forEach(([word, marks], row) => [...word].forEach((letter, column) => {
    const mark = marks.split(' ')[column] as Mark;
    canvas.text(left + column * 4, top + row * 2, ` ${letter.toUpperCase()} `, {bg: markColor(look, mark), fg: mark === 'absent' ? look.text.strong : look.text.onAccent, bold: true, underline: mark === 'correct'});
  }));
}

export const purrwordGame: GameDefinition = {
  id: 'purrword', aliases: ['wordle', 'word'], title: 'Purrword', tagline: 'Find the word in six',
  description: 'Guess the five-letter word in six tries. Letters show whether they are in the right place, in the word elsewhere, or not in it. One daily word, the same for everyone on that date, and practice any time, all offline.',
  kind: 'puzzle', category: 'words',
  controls: [{keys: 'a-z', action: 'type'}, {keys: '⏎', action: 'guess'}, {keys: '⌫', action: 'delete'}],
  howToPlay: [
    'Type a five-letter word and press Enter. A green, underlined letter is in the right place; a yellow letter with a dot is in the word somewhere else; a dim letter is not in it.',
    'A repeated letter is marked only as many times as the word has it. The daily word changes at midnight on your own clock; practice words never count toward the streak.',
  ],
  summary: record => { const stats = readStats(record); return stats.played ? `Won ${stats.won} of ${stats.played} · streak ${stats.streak}` : 'Not played yet'; },
  daily: (record, today) => (readStats(record).lastDaily === today ? 'done' : 'open'),
  preview,
  create: context => new Purrword(context),
};
