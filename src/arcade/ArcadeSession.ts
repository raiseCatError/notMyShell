import {mixRgb} from '../chroma/chroma.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import type {Key} from '../terminal/keys.js';
import {renderControlRows} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {framePanel} from '../ui/PanelShell.js';
import {typeset} from '../ui/typography.js';
import {displayWidth, truncateText} from '../util/text.js';
import {Canvas, type TextOverlay} from './Canvas.js';
import {FixedStep} from './loop.js';
import {Menu} from './menu.js';
import {arcadePalette, type ArcadePalette} from './palette.js';
import {createRng} from './rng.js';
import type {ArcadeStore} from './scores.js';
import type {ControlHint, GameContext, GameDefinition, GameInstance, MotionPreferences} from './types.js';

/**
 * One visit to the arcade: the hub, a running game, its pause menu and its game over screen, as a single panel that owns
 * the keyboard and the animation frames while it is open and nothing else. It is the only code that talks to a game:
 * games get keys, fixed steps and a canvas, and the session draws the frame, the footer and the menus around them.
 *
 * The session holds no timers. The app subscribes to the shared presentation clock for exactly as long as `interval`
 * says frames are wanted (never while a game is paused or the hub is idle with reduced motion), calls `frame()` on each
 * tick and `dispose()` when the panel closes, so nothing runs when the arcade is closed.
 */
export interface ArcadeEnvironment {
  store: ArcadeStore;
  now(): number;
  motion(): MotionPreferences;
  color(): ColorLevel;
  safeGlyphs(): boolean;
  /** A fresh seed for each run. */
  seed(): number;
}

type Screen = 'hub' | 'playing' | 'paused' | 'over';

/** Ignore Retry-type keys this long after a game ends, so the mashing that lost the run cannot also restart it. */
const OVER_GUARD_MS = 450;
const HUB_PREVIEW_MS = 100;

export interface ArcadeFrame {
  /** Panel rows (including the frame line), each at most `columns` wide. */
  rows: string[];
  /** Sized-text blocks, with positions relative to `rows`. */
  overlays: TextOverlay[];
}

export class ArcadeSession {
  screen: Screen = 'hub';
  selected = 0;
  game: GameInstance | undefined;
  definition: GameDefinition | undefined;
  private columns: number;
  private rowsAvailable: number;
  private canvas: Canvas | undefined;
  private preview: Canvas | undefined;
  private previewFrame = 0;
  private previewClock = 0;
  private readonly loop = new FixedStep();
  private alpha = 0;
  private menu: Menu | undefined;
  private overAt = 0;
  private notice: string | undefined;
  private disposed = false;

  constructor(private readonly env: ArcadeEnvironment, private readonly games: readonly GameDefinition[], size: {columns: number; rows: number}, open?: GameDefinition) {
    this.columns = Math.max(1, size.columns);
    this.rowsAvailable = Math.max(1, size.rows);
    this.notice = env.store.recovered;
    if (open) { this.selected = Math.max(0, games.indexOf(open)); this.start(open); }
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------------

  private start(definition: GameDefinition): void {
    this.game?.dispose();
    this.definition = definition;
    const seed = this.env.seed();
    const context: GameContext = {
      size: this.playfield(), seed, rng: createRng(seed), motion: this.env.motion(), color: this.env.color(), safeGlyphs: this.env.safeGlyphs(),
      record: this.env.store.record(definition.id), now: () => this.env.now(),
    };
    this.game = definition.create(context);
    this.loop.reset();
    this.menu = undefined;
    this.screen = 'playing';
    this.canvas = new Canvas(context.size.columns, context.size.rows);
  }

  private leaveGame(): void {
    if (this.game) { this.game.persist(); this.game.dispose(); }
    this.game = undefined;
    this.definition = undefined;
    this.canvas = undefined;
    this.menu = undefined;
    this.screen = 'hub';
    this.env.store.flush();
  }

  /** Close the arcade: persist, release the game. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.leaveGame();
    this.env.store.flush();
  }

  // ---- geometry -----------------------------------------------------------------------------------------------

  private footerRows(): number { return this.columns >= 90 ? 1 : 2; }
  /** Cells for a game: the panel minus its frame line and footer. */
  private playfield(): {columns: number; rows: number} {
    return {columns: this.columns, rows: Math.max(4, this.rowsAvailable - 1 - this.footerRows())};
  }

  resize(columns: number, rows: number): void {
    this.columns = Math.max(1, columns);
    this.rowsAvailable = Math.max(1, rows);
    if (this.game) {
      const size = this.playfield();
      this.canvas = new Canvas(size.columns, size.rows);
      this.game.resize(size);
    }
  }

  /** A foreground app, a lost focus or a new command: the game stops where it is. */
  pause(): void {
    if (this.screen === 'playing' && this.game) { this.game.pause(); this.showPause(); }
  }

  get isPlaying(): boolean { return this.screen === 'playing'; }

  /** Milliseconds between frames the session wants right now; 0 when nothing animates. */
  get interval(): number {
    const motion = this.env.motion();
    if (this.screen === 'hub') return motion.reduced ? 0 : HUB_PREVIEW_MS;
    if (!this.game) return 0;
    if (this.screen === 'playing') {
      if (this.game.stepsPerSecond > 0 && this.game.status === 'playing') return 33;
      return this.game.refreshMs || (motion.reduced ? 0 : 100);
    }
    return 0;
  }

  /** Floor for the shared clock: action games ask for up to 60 frames per second, everything else keeps the default. */
  get floor(): number { return this.screen === 'playing' && this.game && this.game.stepsPerSecond > 0 && this.game.status === 'playing' ? 16 : 40; }

  // ---- frames -------------------------------------------------------------------------------------------------

  frame(dtMs: number): void {
    if (this.disposed) return;
    if (this.screen === 'hub') {
      this.previewClock += dtMs;
      while (this.previewClock >= HUB_PREVIEW_MS) { this.previewClock -= HUB_PREVIEW_MS; this.previewFrame += 1; }
      return;
    }
    const game = this.game;
    if (!game || this.screen === 'paused') return;
    game.animate(dtMs);
    if (this.screen === 'playing' && game.status === 'playing' && game.stepsPerSecond > 0) {
      this.alpha = this.loop.advance(dtMs, step => game.step(step));
    }
    this.checkEnd();
  }

  private checkEnd(): void {
    const game = this.game;
    if (!game || this.screen !== 'playing') return;
    if (game.status === 'over' || game.status === 'won') {
      this.screen = 'over';
      this.overAt = this.env.now();
      this.menu = new Menu([
        {id: 'retry', label: game.status === 'won' ? 'Play again' : 'Retry', key: 'r'},
        {id: 'back', label: 'Back to Arcade', key: 'b'},
        {id: 'exit', label: 'Exit', key: 'x'},
      ]);
      game.persist();
      this.env.store.flush();
    }
  }

  // ---- keys ---------------------------------------------------------------------------------------------------

  key(key: Key): 'handled' | 'close' {
    if (this.disposed) return 'close';
    if (key.kind === 'interrupt') return 'close';
    if (this.screen === 'hub') return this.hubKey(key);
    if (this.screen === 'paused') return this.pausedKey(key);
    if (this.screen === 'over') return this.overKey(key);
    return this.playingKey(key);
  }

  private hubKey(key: Key): 'handled' | 'close' {
    this.notice = undefined;
    const count = this.games.length;
    if (key.kind === 'escape') return 'close';
    if (key.kind === 'up') this.selected = (this.selected + count - 1) % count;
    else if (key.kind === 'down' || key.kind === 'complete') this.selected = (this.selected + 1) % count;
    else if (key.kind === 'pageUp' || key.kind === 'lineHome') this.selected = 0;
    else if (key.kind === 'pageDown' || key.kind === 'lineEnd') this.selected = count - 1;
    else if (key.kind === 'enter') this.start(this.games[this.selected]!);
    else if (key.kind === 'text') {
      const value = key.value.toLowerCase();
      if (value === 'q') return 'close';
      if (value === 'k') this.selected = (this.selected + count - 1) % count;
      else if (value === 'j') this.selected = (this.selected + 1) % count;
      else if (value === ' ') this.start(this.games[this.selected]!);
      else if (/^[1-9]$/u.test(value) && Number(value) <= count) this.selected = Number(value) - 1;
    }
    return 'handled';
  }

  private playingKey(key: Key): 'handled' | 'close' {
    const game = this.game!;
    // Esc pauses a running game and leaves a game that has not started; every other key belongs to the game.
    if (key.kind === 'escape' && game.status === 'playing') { game.pause(); this.showPause(); return 'handled'; }
    if (key.kind === 'text' && key.value.toLowerCase() === 'p' && game.status === 'playing' && game.stepsPerSecond > 0) { game.pause(); this.showPause(); return 'handled'; }
    const outcome = game.key(key);
    if (outcome === 'exit') return 'close';
    if (outcome === 'back' || (key.kind === 'escape' && outcome === 'ignored')) { this.leaveGame(); return 'handled'; }
    this.checkEnd();
    return 'handled';
  }

  private showPause(): void {
    this.screen = 'paused';
    this.menu = new Menu([
      {id: 'resume', label: 'Resume', key: 'c'},
      {id: 'restart', label: 'Restart', key: 'r'},
      {id: 'back', label: 'Back to Arcade', key: 'b'},
      {id: 'exit', label: 'Exit', key: 'x'},
    ]);
  }

  private pausedKey(key: Key): 'handled' | 'close' {
    if (key.kind === 'escape') { this.screen = 'playing'; this.menu = undefined; this.loop.reset(); return 'handled'; }
    return this.choose(this.menu!.key(key));
  }

  private overKey(key: Key): 'handled' | 'close' {
    if (this.env.now() - this.overAt < OVER_GUARD_MS && key.kind !== 'escape') return 'handled';
    if (key.kind === 'escape') { this.leaveGame(); return 'handled'; }
    return this.choose(this.menu!.key(key));
  }

  private choose(id: string | undefined): 'handled' | 'close' {
    if (id === 'resume') { this.screen = 'playing'; this.menu = undefined; this.loop.reset(); }
    else if (id === 'restart' || id === 'retry') this.start(this.definition!);
    else if (id === 'back') this.leaveGame();
    else if (id === 'exit') return 'close';
    return 'handled';
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  render(): ArcadeFrame {
    const palette = arcadePalette();
    const encode = {color: this.env.color(), safe: this.env.safeGlyphs()};
    let body: string[];
    let overlays: TextOverlay[] = [];
    let hints: readonly ControlHint[];
    if (this.screen === 'hub' || !this.game || !this.canvas) {
      body = this.hubRows(palette, encode);
      hints = [{keys: '↑↓', action: 'choose'}, {keys: 'Enter', action: 'play'}, {keys: '1-5', action: 'jump'}, {keys: 'Esc', action: 'close'}];
    } else {
      this.game.render(this.canvas, this.alpha, palette);
      if (this.screen === 'paused') this.drawCard(this.canvas, palette, 'Paused', [], this.menu!);
      else if (this.screen === 'over') this.drawOver(this.canvas, palette);
      body = this.canvas.rows(encode);
      overlays = this.canvas.overlays.map(block => ({...block, y: block.y + 1}));
      hints = this.screen === 'playing' ? this.game.hints() : [{keys: '↑↓', action: 'choose'}, {keys: 'Enter', action: 'select'}, {keys: 'Esc', action: this.screen === 'paused' ? 'resume' : 'arcade'}];
    }
    const footer = renderControlRows(hints.map(hint => [hint.keys, hint.action] as const), this.columns).slice(0, this.footerRows());
    while (footer.length < this.footerRows()) footer.push('');
    const rows = framePanel([...body, ...footer.map(row => `  ${row}`)], this.columns);
    return {rows: rows.slice(0, this.rowsAvailable), overlays};
  }

  private hubRows(palette: ArcadePalette, encode: {color: ColorLevel; safe: boolean}): string[] {
    const width = this.columns;
    const height = Math.max(4, this.rowsAvailable - 1 - this.footerRows());
    const canvas = new Canvas(width, height);
    const wide = width >= 72 && height >= 12;
    const listWidth = wide ? Math.min(34, Math.floor(width * 0.45)) : width;
    const title = typeset({role: 'title', text: 'Vespyr Arcade', maxColumns: Math.max(10, width - 4), maxRows: 2});
    canvas.typeBlock(title, 2, 0, {fg: palette.ink, bold: true});
    let y = title.rows;
    canvas.text(2, y, this.notice ? truncateText(this.notice, width - 4) : `${this.games.length} games · local scores, no accounts`, {fg: this.notice ? palette.warn : palette.faint});
    y += 2;
    const rowsPerGame = height - y >= this.games.length * 2 ? 2 : 1;
    this.games.forEach((game, index) => {
      const row = y + index * rowsPerGame;
      if (row >= height) return;
      const selected = index === this.selected;
      const style = selected ? {fg: palette.ink, bg: mixRgb(palette.selection, palette.deep, 0.15), bold: true} : {fg: palette.muted};
      canvas.fill(0, row, listWidth, 1, ' ', style);
      canvas.text(1, row, selected ? GLYPHS.selection : ' ', {...style, fg: palette.accent});
      canvas.text(3, row, `${index + 1}`, {...style, fg: palette.faint, bold: false});
      canvas.text(6, row, truncateText(game.title, listWidth - 8), style);
      if (rowsPerGame === 2 && row + 1 < height) {
        const best = game.summary(this.env.store.record(game.id).get());
        canvas.text(6, row + 1, truncateText(best, listWidth - 8), {fg: palette.faint});
      }
    });
    const chosen = this.games[this.selected];
    if (chosen) {
      const detailY = y + this.games.length * rowsPerGame + 1;
      if (wide) {
        const px = listWidth + 3;
        const pw = width - px - 2;
        const ph = Math.min(Math.max(4, Math.floor(height * 0.45)), height - 6);
        if (pw >= 16 && ph >= 3) {
          this.preview = this.preview?.width === pw && this.preview.height === ph ? this.preview : new Canvas(pw, ph);
          this.preview.clear(palette.deep);
          chosen.preview(this.preview, this.previewFrame, palette);
          for (let row = 0; row < ph; row += 1) for (let column = 0; column < pw; column += 1) {
            const cell = this.preview.cell(column, row)!;
            canvas.put(px + column, 1 + row, cell.ch || ' ', {fg: cell.fg, bg: cell.bg});
          }
          this.describe(canvas, palette, chosen, px, 2 + ph, pw, height);
        }
      } else if (detailY < height) {
        this.describe(canvas, palette, chosen, 2, detailY, width - 4, height);
      }
    }
    return canvas.rows(encode);
  }

  private describe(canvas: Canvas, palette: ArcadePalette, game: GameDefinition, x: number, y: number, width: number, height: number): void {
    let row = y;
    const say = (text: string, style: {fg: typeof palette.ink; bold?: boolean}) => {
      for (const line of wrap(text, width)) { if (row >= height) return; canvas.text(x, row, line, style); row += 1; }
    };
    say(game.tagline, {fg: palette.accent, bold: true});
    say(game.description, {fg: palette.muted});
    row += 1;
    say(game.controls.map(control => `${control.keys} ${control.action}`).join(' · '), {fg: palette.faint});
    say(game.summary(this.env.store.record(game.id).get()), {fg: palette.ink});
  }

  /** A centered card over the playfield: heading, optional lines, and the menu. */
  private drawCard(canvas: Canvas, palette: ArcadePalette, heading: string, lines: readonly string[], menu: Menu, headline?: ReturnType<typeof typeset>): void {
    const contentWidth = Math.max(displayWidth(heading), ...lines.map(line => displayWidth(line)), ...menu.items.map(item => displayWidth(item.label) + 6), headline?.columns ?? 0);
    const cardWidth = Math.min(canvas.width - 2, contentWidth + 6);
    const headRows = headline ? headline.rows : 1;
    const cardHeight = Math.min(canvas.height - 1, 2 + headRows + (lines.length ? lines.length + 1 : 0) + 1 + menu.items.length + 1);
    const left = Math.max(0, Math.floor((canvas.width - cardWidth) / 2));
    const top = Math.max(0, Math.floor((canvas.height - cardHeight) / 2));
    const panel = {fg: palette.ink, bg: mixRgb(palette.deep, palette.dusk, 0.35)};
    canvas.fill(left, top, cardWidth, cardHeight, ' ', panel);
    canvas.hline(left, top, cardWidth, GLYPHS.separator, {...panel, fg: palette.line});
    canvas.hline(left, top + cardHeight - 1, cardWidth, GLYPHS.separator, {...panel, fg: palette.line});
    let y = top + 1;
    if (headline) { canvas.typeBlock(headline, left + Math.max(1, Math.floor((cardWidth - headline.columns) / 2)), y, {...panel, bold: true}); y += headline.rows; }
    else { canvas.text(left + Math.max(1, Math.floor((cardWidth - displayWidth(heading)) / 2)), y, heading, {...panel, bold: true}); y += 1; }
    if (lines.length) {
      y += 0;
      for (const line of lines) { canvas.text(left + Math.max(1, Math.floor((cardWidth - displayWidth(line)) / 2)), y, line, {...panel, fg: palette.muted}); y += 1; }
      y += 1;
    }
    menu.draw(canvas, palette, left, y, cardWidth);
  }

  private drawOver(canvas: Canvas, palette: ArcadePalette): void {
    const game = this.game!;
    const result = game.result;
    const won = game.status === 'won';
    const heading = result?.record ? 'New record' : won ? 'Well done' : 'Game over';
    const headline = typeset({role: 'celebration', text: heading, maxColumns: Math.max(8, canvas.width - 8), maxRows: Math.max(1, Math.floor(canvas.height / 4))});
    const lines = result ? [result.scoreText, ...result.details] : [];
    this.drawCard(canvas, palette, heading, lines, this.menu!, headline);
  }
}

/** Words wrapped to `width` cells. */
export function wrap(text: string, width: number): string[] {
  const rows: string[] = [];
  let row = '';
  for (const word of text.split(' ')) {
    if (row && displayWidth(row) + 1 + displayWidth(word) > width) { rows.push(row); row = word; }
    else row = row ? `${row} ${word}` : word;
  }
  if (row) rows.push(row);
  return rows.map(item => truncateText(item, Math.max(1, width)));
}
