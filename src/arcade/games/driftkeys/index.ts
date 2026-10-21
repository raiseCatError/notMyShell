import {mixRgb} from '../../../chroma/chroma.js';
import type {Key} from '../../../terminal/keys.js';
import {truncateText} from '../../../util/text.js';
import {PixelBuffer, type Canvas} from '../../Canvas.js';
import {ParticleSystem, Popups} from '../../effects.js';
import {count, readScore, saveScore, topRow} from '../../kit.js';
import {arcadeLook} from '../../look.js';
import {Menu} from '../../menu.js';
import type {ArcadePalette} from '../../palette.js';
import {createRng} from '../../rng.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, GameKeyResult, GameResult, GameStatus} from '../../types.js';
import {DriftState, FADE_OUT, type Target} from './logic.js';
import {MODE_HINT, MODE_LABEL, MODES, type Mode} from './words.js';

/**
 * Driftkeys: phrases float across the field and fade if they are not finished. There is no input box and no echo: the
 * correctly typed part of the oldest phrase lights up right where the phrase floats, the next character is marked, and
 * the last right key completes it by itself. Backspace does nothing (there is nothing to correct: a wrong key simply
 * does not count). The game claims every text key while it plays, never keeps what was typed, and nothing it sees
 * reaches the shell; phrases are data to compare against and are never run.
 */
const cap = (mode: Mode): string => `${mode[0]!.toUpperCase()}${mode.slice(1)}`;

class Driftkeys implements GameInstance {
  result: GameResult | undefined;
  stepsPerSecond = 60;
  readonly typing = true;
  private screen: 'menu' | 'play' | 'over' = 'menu';
  private menu: Menu;
  private state: DriftState | undefined;
  private mode: Mode = 'programmer';
  private size: {columns: number; rows: number};
  private readonly particles: ParticleSystem;
  private readonly popups: Popups;
  private pixels = new PixelBuffer(0, 0);
  private wrongMs = 0;
  private noteMs = 0;
  private startBest = 0;

  constructor(private readonly context: GameContext) {
    this.size = context.size;
    this.particles = new ParticleSystem(context.rng.fork('driftkeys-fx'), 100, context.motion.effects);
    this.popups = new Popups(5, context.motion.effects);
    const raw = context.record.get();
    this.menu = new Menu(MODES.map((mode, index) => ({id: mode, label: MODE_LABEL[mode], key: String(index + 1), hint: count(raw[`best${cap(mode)}`]) ? `best ${count(raw[`best${cap(mode)}`])}` : MODE_HINT[mode]})));
  }

  get status(): GameStatus { return this.screen === 'menu' ? 'ready' : this.screen === 'over' ? 'over' : 'playing'; }
  get refreshMs(): number { return 0; }

  private start(mode: Mode): void {
    this.mode = mode;
    this.state = new DriftState(mode, createRng(this.context.rng.int(1, 0x7fffffff)), this.size.columns, this.size.rows, this.context.motion.reduced ? 0.5 : 1);
    this.screen = 'play';
    this.result = undefined;
    this.wrongMs = 0; this.noteMs = 0;
    this.startBest = count(this.context.record.get()[`best${cap(mode)}`]);
    this.particles.clear(); this.popups.clear();
  }

  step(dtMs: number): void {
    const state = this.state;
    if (!state || this.screen !== 'play') return;
    state.advance(dtMs);
    this.drainEvents();
    if (state.over) this.finish();
  }

  private drainEvents(): void {
    const state = this.state!;
    const look = arcadeLook();
    for (const done of state.events.splice(0)) {
      this.popups.add(`+${done.points}`, done.x, done.lane - 1, look.gold, 800);
      this.particles.burst({x: done.x, y: done.lane * 2 + 1, count: 10, speed: 30, life: 480, gravity: 25, drag: 1.2, colors: [look.ok, look.gold, look.hue.sky]});
    }
  }

  animate(dtMs: number): void {
    this.particles.update(dtMs);
    this.popups.update(dtMs);
    this.wrongMs = Math.max(0, this.wrongMs - dtMs);
    this.noteMs = Math.max(0, this.noteMs - dtMs);
  }

  key(key: Key): GameKeyResult {
    if (this.screen === 'menu') {
      if (key.kind === 'escape') return 'ignored';
      const choice = this.menu.key(key);
      if (choice) this.start(choice as Mode);
      return 'handled';
    }
    const state = this.state;
    if (this.screen !== 'play' || !state) return 'handled';
    if (key.kind === 'escape') return 'ignored';
    if (key.kind === 'paste') { this.noteMs = 2200; return 'handled'; }
    if (key.kind === 'backspace' || key.kind === 'delete' || key.kind === 'deleteWord') return 'handled';
    if (key.kind !== 'text') return 'ignored';
    for (const char of key.value) {
      if (char < ' ' || char === '\u007f') continue;
      const outcome = state.press(char);
      if (outcome === 'wrong') this.wrongMs = 320;
      if (outcome === 'done') this.drainEvents();
    }
    return 'handled';
  }

  private finish(): void {
    const state = this.state!;
    this.screen = 'over';
    const key = `best${cap(this.mode)}`;
    const saved = saveScore(this.context.record, state.score, {[key]: state.score, bestAccuracy: state.accuracy});
    this.result = {
      score: state.score, scoreText: state.score.toLocaleString('en-US'), record: state.score > 0 && state.score > this.startBest,
      details: [`${MODE_LABEL[this.mode]} mode · level ${state.level}`, `Accuracy ${state.accuracy}% · ${state.completed} phrases`, `Best ${Math.max(this.startBest, state.score).toLocaleString('en-US')}`, `Games ${saved.plays}`],
    };
  }

  render(canvas: Canvas, _alpha: number, palette: ArcadePalette): void {
    const look = arcadeLook(palette);
    const color = this.context.color !== 'none';
    const unicode = color && !this.context.safeGlyphs;
    canvas.clear(color ? look.surface.base : undefined);
    if (this.screen === 'menu' || !this.state) {
      const saved = readScore(this.context.record.get());
      topRow(canvas, look, 'Driftkeys', saved.plays ? `Best ${saved.best.toLocaleString('en-US')}` : 'Not played yet');
      const top = Math.max(2, Math.floor(canvas.height / 2) - 4);
      canvas.center(top, 'Type the drifting phrases', {fg: look.text.strong, bold: true});
      canvas.center(top + 1, truncateText('No box, no echo: the phrase lights up as you go.', canvas.width - 2), {fg: look.text.normal});
      this.menu.draw(canvas, palette, 0, top + 3, canvas.width);
      return;
    }
    const state = this.state;
    const best = Math.max(this.startBest, state.score);
    topRow(canvas, look, `Driftkeys · ${MODE_LABEL[this.mode]}`, `Lives ${state.lives}`);
    const full = `Score ${state.score}  Best ${best}  Accuracy ${state.accuracy}%  Level ${state.level}`;
    const medium = `${state.score} pts · best ${best} · ${state.accuracy}% · Lv ${state.level}`;
    const small = `${state.score} ${state.accuracy}% Lv${state.level}`;
    const line = [full, medium, small].find(text => text.length <= canvas.width - 2) ?? small;
    canvas.text(1, 1, truncateText(line, canvas.width - 2), {fg: look.text.dim});
    state.targets.forEach((target, index) => this.drawTarget(canvas, look, target, index === 0, color, unicode));
    if (this.particles.count) {
      if (this.pixels.width !== canvas.width || this.pixels.height !== canvas.height * 2) this.pixels = new PixelBuffer(canvas.width, canvas.height * 2);
      this.pixels.clear();
      this.particles.draw(this.pixels, look.surface.base);
      canvas.blit(this.pixels);
    }
    this.popups.draw(canvas, look.surface.base);
    const bottom = canvas.height - 1;
    if (this.noteMs > 0) canvas.center(bottom, 'Paste is not allowed here', {fg: look.warn, bold: true});
    else if (state.elapsed < 8000 || !state.targets.length) canvas.center(bottom, truncateText('Type the marked phrase · Esc pauses', canvas.width - 2), {fg: look.text.dim});
  }

  private drawTarget(canvas: Canvas, look: ReturnType<typeof arcadeLook>, target: Target, active: boolean, color: boolean, unicode: boolean): void {
    const state = this.state!;
    const alpha = state.alpha(target);
    const x = Math.round(target.x), y = target.lane;
    const fading = target.age / target.life > 1 - FADE_OUT;
    const dim = alpha < 0.5;
    const fade = (rgbColor: typeof look.text.normal) => mixRgb(rgbColor, look.surface.base, 1 - Math.max(0.15, alpha));
    const wrong = active && this.wrongMs > 0;
    const marker = wrong ? '!' : active ? (unicode ? '▸' : '>') : ' ';
    canvas.put(x - 2, y, marker, {fg: color ? (wrong ? look.bad : look.focus) : undefined, bold: true});
    const done = target.text.slice(0, target.typed), next = target.text[target.typed], rest = target.text.slice(target.typed + 1);
    const base = active ? look.text.strong : look.text.dim;
    canvas.text(x, y, done, {fg: color ? fade(look.ok) : undefined, bold: true, underline: true, dim: !color && dim});
    const at = x + done.length;
    if (active && next !== undefined) {
      canvas.put(at, y, next, {fg: color ? look.text.strong : undefined, bg: color ? (wrong && !this.context.motion.reduced ? look.bad : look.surface.selected) : undefined, bold: true, underline: true, reverse: !color});
      canvas.text(at + 1, y, rest, {fg: color ? fade(base) : undefined, bold: true, dim: !color && dim});
    } else canvas.text(at, y, target.text.slice(target.typed), {fg: color ? fade(base) : undefined, dim: !color && dim});
    if (fading) canvas.put(x + target.text.length + 1, y, '~', {fg: color ? fade(look.warn) : undefined});
  }

  resize(size: {columns: number; rows: number}): void {
    this.size = size;
    this.state?.resize(size.columns, size.rows);
  }

  pause(): void {}
  hints(): readonly ControlHint[] { return HINTS; }
  persist(): void {}
  dispose(): void { this.particles.clear(); this.popups.clear(); this.state = undefined; }
}

const HINTS: readonly ControlHint[] = [{keys: 'type', action: 'the marked phrase'}, {keys: 'Esc', action: 'pause'}];

/** The hub preview: a few phrases drifting, the first one being typed. */
function preview(canvas: Canvas, frame: number, palette: ArcadePalette): void {
  const look = arcadeLook(palette);
  canvas.clear(look.surface.base);
  const words = ['git status', 'docker ps', 'command -v node'];
  const typed = Math.min(words[0]!.length, Math.floor((frame % 40) / 3));
  words.forEach((word, row) => {
    const wobble = Math.round(Math.sin((frame + row * 9) / 12) * 3);
    const x = Math.max(3, Math.floor((canvas.width - word.length) / 2) + wobble);
    const y = 1 + row * Math.max(1, Math.floor((canvas.height - 2) / 3));
    const done = row === 0 ? typed : 0;
    canvas.put(x - 2, y, row === 0 ? '▸' : ' ', {fg: look.focus, bold: true});
    canvas.text(x, y, word.slice(0, done), {fg: look.ok, bold: true, underline: true});
    canvas.text(x + done, y, word.slice(done), {fg: row === 0 ? look.text.strong : look.text.dim});
  });
}

export const driftkeysGame: GameDefinition = {
  id: 'driftkeys', aliases: ['typing', 'type', 'typefall'], title: 'Driftkeys', tagline: 'Type the drifting phrases',
  description: 'Phrases float across the field and fade away if you do not finish them. Type the marked one: the letters you get right light up where it floats, the last one completes it, and there is no typing box to watch. Programmer mode uses command and code phrases, Words mode ordinary words.',
  kind: 'action', category: 'words', controls: HINTS,
  howToPlay: [
    'Type the phrase marked ▸ exactly, spaces included. Right letters light up in place; a wrong key just counts against your accuracy, and Backspace does nothing. The last right letter finishes the phrase at once.',
    'Phrases that fade out before you finish cost a life; three lives and the run ends. Pick Programmer or Words from the menu. Everything is offline and nothing you type leaves the game.',
  ],
  summary: record => { const saved = readScore(record); return saved.plays ? `Best ${saved.best.toLocaleString('en-US')} · ${count(record.bestAccuracy)}% accuracy` : 'Not played yet'; },
  preview,
  create: context => new Driftkeys(context),
};
