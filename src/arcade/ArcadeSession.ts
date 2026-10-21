import {mixRgb} from '../chroma/chroma.js';
import type {Rgb} from '../chroma/escape.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import type {Key} from '../terminal/keys.js';
import {GLYPHS} from '../ui/glyphs.js';
import {typeset} from '../ui/typography.js';
import {displayWidth, truncateText} from '../util/text.js';
import {Canvas, PixelBuffer, type Style, type TextOverlay} from './Canvas.js';
import {localDateKey} from './engine/daily.js';
import {ParticleSystem} from './effects.js';
import {CountUp, Tween} from './fx/sequence.js';
import {confetti} from './fx/cells.js';
import {FixedStep} from './loop.js';
import {arcadeLook, type ArcadeLook} from './look.js';
import {Menu, type MenuItem} from './menu.js';
import {arcadePalette, type ArcadePalette} from './palette.js';
import {createRng} from './rng.js';
import type {ArcadeStore, HubState} from './scores.js';
import {CATEGORY_TITLES, GAME_CATEGORIES, type ControlHint, type GameCategory, type GameContext, type GameDefinition, type GameInstance, type MotionPreferences} from './types.js';

/**
 * One visit to the Vespyr Arcade, drawn over the whole terminal viewport: the Horizon hub (a library on the left, the
 * highlighted game's live preview and details on the right), a running game on the Stage, its pause sheet and its results.
 * It owns the keyboard and the animation frames while it is open and nothing else, and it is the only code that talks to
 * a game: games get keys, fixed steps and a canvas; the session draws everything around them.
 *
 * The session holds no timers. The app subscribes to the shared presentation clock for exactly as long as `interval`
 * says frames are wanted (never while a game is paused or the hub is still under Reduced Motion), calls `frame()` on each
 * tick and `dispose()` when the Arcade closes, so nothing runs once it is closed. Only the highlighted game's preview
 * ever animates. See docs/design/arcade-expansion.md (Horizon hub, Stage gameplay).
 */
export interface ArcadeEnvironment {
  store: ArcadeStore;
  now(): number;
  motion(): MotionPreferences;
  color(): ColorLevel;
  safeGlyphs(): boolean;
  /** A fresh seed for each run. */
  seed(): number;
  /** Today's local date key; defaults to the date of `now()`. */
  today?(): string;
}

type Screen = 'hub' | 'playing' | 'paused' | 'finale' | 'over';
export type HubTier = 'wide' | 'standard' | 'narrow' | 'tiny';

/** Ignore Retry-type keys this long after a game ends, so the mashing that lost the run cannot also restart it. */
const OVER_GUARD_MS = 450;
const HUB_PREVIEW_MS = 100;
const PREVIEW_FADE_MS = 180;
const RECENT_SHOWN = 4;

export interface ArcadeFrame {
  /** Viewport rows, each at most `columns` wide. */
  rows: string[];
  /** Sized-text blocks, with positions relative to `rows`. */
  overlays: TextOverlay[];
}

type HubEntry = {kind: 'header'; label: string} | {kind: 'game'; game: GameDefinition; section: string};
type GameEntry = Extract<HubEntry, {kind: 'game'}>;

const categoryOf = (game: GameDefinition): GameCategory => game.category ?? (game.kind === 'puzzle' ? 'logic' : 'arcade');

export function hubTier(columns: number, rows: number): HubTier {
  if (columns < 40 || rows < 12) return 'tiny';
  if (columns < 72 || rows < 18) return 'narrow';
  return columns >= 110 ? 'wide' : 'standard';
}

export class ArcadeSession {
  screen: Screen = 'hub';
  game: GameInstance | undefined;
  definition: GameDefinition | undefined;
  private columns: number;
  private rowsAvailable: number;
  private canvas: Canvas | undefined;
  private preview: Canvas | undefined;
  private previewFrame = 0;
  private previewClock = 0;
  private previewFade = new Tween(0, 0);
  private readonly loop = new FixedStep();
  private alpha = 0;
  private menu: Menu | undefined;
  private overAt = 0;
  private notice: string | undefined;
  private disposed = false;
  private hub: HubState;
  /** Index into the game entries of the current list (headers excluded). */
  private cursor = 0;
  private scroll = 0;
  /** Defined while the search field is open. */
  private query: string | undefined;
  private howTo = false;
  private countUp: CountUp | undefined;
  private readonly sparkles: ParticleSystem;
  /** Viewport row → game entry index, from the last hub frame (mouse hit testing). */
  private rowHits = new Map<number, number>();

  constructor(private readonly env: ArcadeEnvironment, private readonly games: readonly GameDefinition[], size: {columns: number; rows: number}, open?: GameDefinition) {
    this.columns = Math.max(1, size.columns);
    this.rowsAvailable = Math.max(1, size.rows);
    this.notice = env.store.recovered;
    this.hub = env.store.hub();
    this.sparkles = new ParticleSystem(createRng(env.seed()).fork('arcade-sparkles'), 90, env.motion().effects);
    this.previewFade.skip();
    this.selectGame(open?.id ?? this.hub.selected);
    if (open) this.start(open);
  }

  // ---- the library ----------------------------------------------------------------------------------------------

  /** The rows of the library: favorites, recently played, then every category; or the search results. */
  private entries(): HubEntry[] {
    const out: HubEntry[] = [];
    const query = this.query?.trim().toLowerCase();
    if (query) {
      const words = query.split(/\s+/u);
      const found = this.games.filter(game => {
        const haystack = `${game.title} ${game.id} ${game.aliases.join(' ')} ${CATEGORY_TITLES[categoryOf(game)]} ${game.tagline}`.toLowerCase();
        return words.every(word => haystack.includes(word));
      });
      out.push({kind: 'header', label: found.length ? `${found.length} matching` : 'No game matches'});
      for (const game of found) out.push({kind: 'game', game, section: 'search'});
      return out;
    }
    const byId = new Map(this.games.map(game => [game.id, game]));
    const known = (ids: readonly string[]) => ids.map(id => byId.get(id)).filter((game): game is GameDefinition => Boolean(game));
    const favorites = known(this.hub.favorites);
    if (favorites.length) { out.push({kind: 'header', label: 'Favorites'}); for (const game of favorites) out.push({kind: 'game', game, section: 'favorites'}); }
    const recent = known(this.hub.recent).slice(0, RECENT_SHOWN);
    if (recent.length && this.games.length > 6) { out.push({kind: 'header', label: 'Recently played'}); for (const game of recent) out.push({kind: 'game', game, section: 'recent'}); }
    for (const category of GAME_CATEGORIES) {
      const members = this.games.filter(game => categoryOf(game) === category);
      if (!members.length) continue;
      out.push({kind: 'header', label: CATEGORY_TITLES[category]});
      for (const game of members) out.push({kind: 'game', game, section: category});
    }
    // A quiet row between groups.
    return out.flatMap((entry, index) => (entry.kind === 'header' && index > 0 ? [{kind: 'header', label: ''} as HubEntry, entry] : [entry]));
  }

  private gameEntries(entries = this.entries()): GameEntry[] {
    return entries.filter((entry): entry is GameEntry => entry.kind === 'game');
  }

  private current(): GameEntry | undefined { return this.gameEntries()[this.cursor]; }

  /** The highlighted game's index in the catalog (what `/game` and tests refer to). */
  get selected(): number {
    const game = this.current()?.game;
    return game ? Math.max(0, this.games.indexOf(game)) : 0;
  }

  /** Highlight `id` in `section`, or in its own category (not Favorites or Recent), or the first game. */
  private selectGame(id: string | undefined, section?: string): void {
    const list = this.gameEntries();
    const index = list.findIndex(entry => entry.game.id === id && (section ? entry.section === section : !['favorites', 'recent'].includes(entry.section)));
    this.moveTo(index >= 0 ? index : Math.max(0, list.findIndex(entry => entry.game.id === id)));
  }

  private moveTo(index: number): void {
    const count = this.gameEntries().length;
    const next = count ? ((index % count) + count) % count : 0;
    if (next !== this.cursor) this.previewFade = new Tween(this.env.motion().reduced ? 0 : PREVIEW_FADE_MS, 0);
    this.cursor = next;
  }

  private saveHub(change: (hub: HubState) => void): void {
    change(this.hub);
    this.env.store.setHub(this.hub);
  }

  // ---- lifecycle ------------------------------------------------------------------------------------------------

  private start(definition: GameDefinition): void {
    this.game?.dispose();
    this.definition = definition;
    const seed = this.env.seed();
    const size = this.playfield();
    const context: GameContext = {
      size, seed, rng: createRng(seed), motion: this.env.motion(), color: this.env.color(), safeGlyphs: this.env.safeGlyphs(),
      record: this.env.store.record(definition.id), now: () => this.env.now(), today: this.today(),
    };
    this.game = definition.create(context);
    this.loop.reset();
    this.menu = undefined;
    this.countUp = undefined;
    this.howTo = false;
    this.sparkles.clear();
    this.screen = 'playing';
    this.canvas = new Canvas(size.columns, size.rows);
    this.saveHub(hub => { hub.selected = definition.id; hub.recent = [definition.id, ...hub.recent.filter(id => id !== definition.id)].slice(0, 8); });
  }

  private today(): string { return this.env.today?.() ?? localDateKey(this.env.now()); }

  private leaveGame(): void {
    const left = this.definition;
    if (this.game) { this.game.persist(); this.game.dispose(); }
    this.game = undefined;
    this.definition = undefined;
    this.canvas = undefined;
    this.menu = undefined;
    this.countUp = undefined;
    this.screen = 'hub';
    // Back on the game just played (playing it may have moved it into Recently played).
    if (left && this.current()?.game !== left) this.selectGame(left.id);
    this.env.store.flush();
  }

  /** Close the arcade: persist, release the game. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.leaveGame();
    this.env.store.flush();
  }

  // ---- geometry -------------------------------------------------------------------------------------------------

  /** The Stage keeps one row for the controls when there is room for it. */
  private controlRows(): number { return this.rowsAvailable >= 10 ? 1 : 0; }
  /** Cells for a game: the whole viewport minus the controls row. */
  private playfield(): {columns: number; rows: number} {
    return {columns: this.columns, rows: Math.max(4, this.rowsAvailable - this.controlRows())};
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
    if (this.screen === 'playing' && this.game && this.game.status === 'playing') { this.game.pause(); this.showPause(); }
  }

  get isPlaying(): boolean { return this.screen === 'playing'; }

  /** Milliseconds between frames the session wants right now; 0 when nothing animates. */
  get interval(): number {
    const motion = this.env.motion();
    if (this.screen === 'hub') return motion.reduced ? 0 : HUB_PREVIEW_MS;
    if (!this.game) return 0;
    if (this.screen === 'finale') return 33;
    if (this.screen === 'over') return (this.countUp && !this.countUp.done) || this.sparkles.count > 0 ? 33 : 0;
    if (this.screen === 'playing') {
      if (this.game.stepsPerSecond > 0 && this.game.status === 'playing') return 33;
      return this.game.refreshMs || (motion.reduced ? 0 : 100);
    }
    return 0;
  }

  /** Floor for the shared clock: action games ask for up to 60 frames per second, everything else keeps the default. */
  get floor(): number { return this.screen === 'playing' && this.game && this.game.stepsPerSecond > 0 && this.game.status === 'playing' ? 16 : 40; }

  // ---- frames ---------------------------------------------------------------------------------------------------

  frame(dtMs: number): void {
    if (this.disposed) return;
    if (this.screen === 'hub') {
      this.previewFade.update(dtMs);
      this.previewClock += dtMs;
      while (this.previewClock >= HUB_PREVIEW_MS) { this.previewClock -= HUB_PREVIEW_MS; this.previewFrame += 1; }
      return;
    }
    const game = this.game;
    if (!game || this.screen === 'paused') return;
    game.animate(dtMs);
    if (this.screen === 'over') { this.countUp?.update(dtMs); this.sparkles.update(dtMs); return; }
    if (this.screen === 'finale') { if (!game.finale || game.finale.done) this.showResults(); return; }
    if (game.status === 'playing' && game.stepsPerSecond > 0) {
      this.alpha = this.loop.advance(dtMs, step => game.step(step));
    }
    this.checkEnd();
  }

  private checkEnd(): void {
    const game = this.game;
    if (!game || this.screen !== 'playing') return;
    if (game.status !== 'over' && game.status !== 'won') return;
    game.persist();
    this.env.store.flush();
    if (game.finale && !game.finale.done) { this.screen = 'finale'; return; }
    this.showResults();
  }

  private showResults(): void {
    const game = this.game!;
    this.screen = 'over';
    this.overAt = this.env.now();
    const result = game.result;
    const motion = this.env.motion();
    this.countUp = result && countable(result) ? new CountUp(result.score, 0, 800, motion) : undefined;
    this.sparkles.setLevel(motion.effects);
    if (result?.record) {
      const look = arcadeLook(arcadePalette());
      confetti(this.sparkles, this.columns, this.playfield().rows * 2, [look.gold, look.accent, look.hue.rose, look.hue.mint, look.hue.sky], motion);
    }
    this.menu = new Menu([
      {id: 'retry', label: game.status === 'won' ? 'Play again' : 'Retry', key: 'r'},
      {id: 'back', label: 'Back to Arcade', key: 'b'},
      {id: 'exit', label: 'Exit', key: 'x'},
    ]);
  }

  // ---- keys -----------------------------------------------------------------------------------------------------

  key(key: Key): 'handled' | 'close' {
    if (this.disposed) return 'close';
    if (key.kind === 'interrupt') return 'close';
    if (this.screen === 'hub') return this.hubKey(key);
    if (this.screen === 'paused') return this.pausedKey(key);
    if (this.screen === 'finale') {
      if (isPress(key)) this.game?.finale?.skip();
      if (!this.game?.finale || this.game.finale.done) this.showResults();
      return 'handled';
    }
    if (this.screen === 'over') return this.overKey(key);
    return this.playingKey(key);
  }

  private hubKey(key: Key): 'handled' | 'close' {
    this.notice = undefined;
    const list = this.gameEntries();
    const page = Math.max(1, this.rowsAvailable - 4);
    const narrow = hubTier(this.columns, this.rowsAvailable) === 'narrow';
    if (key.kind === 'mouseClick') return this.hubClick('y' in key && typeof key.y === 'number' ? key.y : 0);
    if (key.kind === 'wheelUp') { this.moveTo(this.cursor - 1); return 'handled'; }
    if (key.kind === 'wheelDown') { this.moveTo(this.cursor + 1); return 'handled'; }
    if (this.query !== undefined) {
      if (key.kind === 'escape') { this.query = this.query ? '' : undefined; this.moveTo(0); return 'handled'; }
      if (key.kind === 'backspace') { this.query = this.query.slice(0, -1); this.moveTo(0); return 'handled'; }
      if (key.kind === 'text' || key.kind === 'paste') {
        this.query = (this.query + key.value.replace(/[\u0000-\u001f\u007f]/gu, ' ')).slice(0, 32);
        this.moveTo(0);
        return 'handled';
      }
    }
    if (key.kind === 'escape') return 'close';
    if (key.kind === 'up' || (narrow && key.kind === 'left')) this.moveTo(this.cursor - 1);
    else if (key.kind === 'down' || (narrow && key.kind === 'right')) this.moveTo(this.cursor + 1);
    else if (key.kind === 'pageUp') this.moveTo(Math.max(0, this.cursor - page));
    else if (key.kind === 'pageDown') this.moveTo(Math.min(list.length - 1, this.cursor + page));
    else if (key.kind === 'lineHome' || key.kind === 'bufferHome') this.moveTo(0);
    else if (key.kind === 'lineEnd' || key.kind === 'bufferEnd') this.moveTo(list.length - 1);
    else if (key.kind === 'complete' || key.kind === 'focusNext') this.jumpSection(1);
    else if (key.kind === 'focusPrevious') this.jumpSection(-1);
    else if (key.kind === 'enter') this.play();
    else if (key.kind === 'text') {
      const value = key.value.toLowerCase();
      if (value === 'q') return 'close';
      if (value === 'k') this.moveTo(this.cursor - 1);
      else if (value === 'j') this.moveTo(this.cursor + 1);
      else if (value === ' ') this.play();
      else if (value === '/') { this.query = ''; this.moveTo(0); }
      else if (value === 'f') this.toggleFavorite();
      else if (/^[1-9]$/u.test(value) && Number(value) <= list.length) this.moveTo(Number(value) - 1);
    }
    return 'handled';
  }

  private play(): void { const entry = this.current(); if (entry) this.start(entry.game); }

  /** A click on a library row selects it; a click on the selected row plays it. `y` is the terminal's 1-based row. */
  private hubClick(y: number): 'handled' {
    const index = this.rowHits.get(y - 1);
    if (index === undefined) return 'handled';
    if (index === this.cursor) this.play();
    else this.moveTo(index);
    return 'handled';
  }

  /** The first game of the next (or previous) section. */
  private jumpSection(direction: 1 | -1): void {
    const list = this.gameEntries();
    const starts = list.flatMap((entry, index) => (index === 0 || list[index - 1]!.section !== entry.section ? [index] : []));
    const here: number = starts.filter(start => start <= this.cursor).at(-1) ?? 0;
    const position = starts.indexOf(here);
    this.moveTo(starts[(position + direction + starts.length) % starts.length] ?? 0);
  }

  private toggleFavorite(): void {
    const entry = this.current();
    if (!entry) return;
    const id = entry.game.id;
    const section = entry.section;
    this.saveHub(hub => { hub.favorites = hub.favorites.includes(id) ? hub.favorites.filter(item => item !== id) : [...hub.favorites, id]; });
    // The same game stays highlighted; leaving Favorites lands on it in its own category.
    this.selectGame(id, section === 'favorites' && !this.hub.favorites.includes(id) ? undefined : section);
  }

  private playingKey(key: Key): 'handled' | 'close' {
    const game = this.game!;
    // Esc pauses a running game and leaves a game that has not started; every other key belongs to the game.
    if (key.kind === 'escape' && game.status === 'playing') { game.pause(); this.showPause(); return 'handled'; }
    if (!game.typing && key.kind === 'text' && key.value.toLowerCase() === 'p' && game.status === 'playing') { game.pause(); this.showPause(); return 'handled'; }
    const outcome = game.key(key);
    if (outcome === 'exit') return 'close';
    if (outcome === 'back' || (key.kind === 'escape' && outcome === 'ignored')) { this.leaveGame(); return 'handled'; }
    this.checkEnd();
    return 'handled';
  }

  private showPause(): void {
    this.screen = 'paused';
    this.howTo = false;
    const items: MenuItem[] = [
      {id: 'resume', label: 'Resume', key: 'c'}, {id: 'restart', label: 'Restart', key: 'r'}, {id: 'howto', label: 'How to play', key: 'h'},
      {id: 'back', label: 'Back to Arcade', key: 'b'}, {id: 'exit', label: 'Exit', key: 'x'},
    ];
    this.menu = new Menu(items);
  }

  private pausedKey(key: Key): 'handled' | 'close' {
    if (this.howTo) { if (isPress(key)) this.howTo = false; return 'handled'; }
    if (key.kind === 'escape') { this.resume(); return 'handled'; }
    return this.choose(this.menu!.key(key));
  }

  private resume(): void { this.screen = 'playing'; this.menu = undefined; this.loop.reset(); }

  private overKey(key: Key): 'handled' | 'close' {
    if (this.env.now() - this.overAt < OVER_GUARD_MS && key.kind !== 'escape') return 'handled';
    if (key.kind === 'escape') { this.leaveGame(); return 'handled'; }
    // A key finishes the count-up and still counts as a choice.
    if (isPress(key)) this.countUp?.skip();
    return this.choose(this.menu!.key(key));
  }

  private choose(id: string | undefined): 'handled' | 'close' {
    if (id === 'resume') this.resume();
    else if (id === 'howto') this.howTo = true;
    else if (id === 'restart' || id === 'retry') this.start(this.definition!);
    else if (id === 'back') this.leaveGame();
    else if (id === 'exit') return 'close';
    return 'handled';
  }

  // ---- drawing --------------------------------------------------------------------------------------------------

  render(): ArcadeFrame {
    const palette = arcadePalette();
    const look = arcadeLook(palette);
    const encode = {color: this.env.color(), safe: this.env.safeGlyphs()};
    if (this.screen === 'hub' || !this.game || !this.canvas) {
      const canvas = this.hubCanvas(look, palette);
      return {rows: canvas.rows(encode).slice(0, this.rowsAvailable), overlays: overlaysOf(canvas, encode)};
    }
    const canvas = this.canvas;
    this.game.render(canvas, this.alpha, palette);
    if (this.screen === 'paused') this.drawPause(canvas, look);
    else if (this.screen === 'over') this.drawResults(canvas, look);
    else if (this.screen === 'finale' && canvas.height > 3 && !this.controlRows()) {
      const hint = 'any key to skip';
      canvas.text(canvas.width - displayWidth(hint) - 2, canvas.height - 1, hint, {fg: look.text.dim});
    }
    const rows = canvas.rows(encode);
    if (this.controlRows()) rows.push(this.controlsRow(look, encode));
    return {rows: rows.slice(0, this.rowsAvailable), overlays: overlaysOf(canvas, encode)};
  }

  /** The Stage's one row: the game's title, then keycaps for its keys and for pause. */
  private controlsRow(look: ArcadeLook, encode: {color: ColorLevel; safe: boolean}): string {
    const row = new Canvas(this.columns, 1);
    row.clear(look.surface.raised);
    let hints: readonly ControlHint[];
    if (this.screen === 'playing') hints = [...this.game!.hints().filter(hint => !/^esc$/iu.test(hint.keys)), {keys: 'Esc', action: 'pause'}];
    else if (this.screen === 'finale') hints = [{keys: 'any key', action: 'skip'}];
    else if (this.screen === 'paused' && this.howTo) hints = [{keys: 'any key', action: 'back'}];
    else hints = [{keys: '↑↓', action: 'choose'}, {keys: '⏎', action: 'select'}, {keys: 'Esc', action: this.screen === 'paused' ? 'resume' : 'arcade'}];
    const title = this.definition?.title ?? '';
    let x = 1;
    if (this.columns >= 60 && title) { row.text(x, 0, title, {fg: look.accent, bg: look.surface.raised, bold: true}); x += displayWidth(title) + 3; }
    keycaps(row, x, 0, hints, look, this.columns - 1);
    return row.rows(encode)[0]!;
  }

  // ---- hub drawing ----------------------------------------------------------------------------------------------

  private hubCanvas(look: ArcadeLook, palette: ArcadePalette): Canvas {
    const width = this.columns;
    const height = this.rowsAvailable;
    const canvas = new Canvas(width, height);
    canvas.clear(look.surface.base);
    this.rowHits.clear();
    const tier = hubTier(width, height);
    if (tier === 'tiny') { this.drawTiny(canvas, look); return canvas; }
    this.drawHeader(canvas, look);
    const footerY = height - 1;
    this.drawHubFooter(canvas, look, footerY, tier);
    const top = 1;
    if (tier === 'narrow') { this.drawCarousel(canvas, look, palette, top, footerY); return canvas; }
    const listWidth = tier === 'wide' ? Math.min(40, Math.max(34, Math.round(width * 0.26))) : Math.min(32, Math.round(width * 0.36));
    canvas.fill(0, top, listWidth, footerY - top, ' ', {bg: look.surface.sunken});
    this.drawList(canvas, look, 0, top, listWidth, footerY - top);
    const chosen = this.current()?.game;
    if (chosen) this.drawDetail(canvas, look, palette, chosen, listWidth + 3, top, width - listWidth - 5, footerY - top);
    else canvas.text(listWidth + 3, top + 1, 'No game matches. Esc clears the search.', {fg: look.text.dim, bg: look.surface.base});
    return canvas;
  }

  private drawHeader(canvas: Canvas, look: ArcadeLook): void {
    const bg = look.surface.raised;
    canvas.fill(0, 0, canvas.width, 1, ' ', {bg});
    canvas.text(1, 0, '◆', {bg, fg: look.accent});
    canvas.text(3, 0, 'Vespyr Arcade', {bg, fg: look.text.strong, bold: true});
    let x = 18;
    if (this.query !== undefined) {
      const field = ` ${GLYPHS.search} ${this.query}▏`;
      const fieldWidth = Math.min(canvas.width - x - 1, Math.max(20, displayWidth(field) + 2));
      canvas.fill(x, 0, fieldWidth, 1, ' ', {bg: look.surface.selected});
      canvas.text(x, 0, truncateText(field, fieldWidth), {bg: look.surface.selected, fg: look.text.strong});
      x += fieldWidth + 2;
    }
    const right = this.notice ?? `${this.games.length} games · offline · local scores`;
    const room = canvas.width - x - 1;
    if (room > 8) {
      const text = truncateText(right, room);
      canvas.text(canvas.width - 1 - displayWidth(text), 0, text, {bg, fg: this.notice ? look.warn : look.text.dim});
    }
  }

  private drawHubFooter(canvas: Canvas, look: ArcadeLook, y: number, tier: HubTier): void {
    canvas.fill(0, y, canvas.width, 1, ' ', {bg: look.surface.raised});
    const hints: ControlHint[] = this.query !== undefined
      ? [{keys: '↑↓', action: 'choose'}, {keys: '⏎', action: 'play'}, {keys: 'Esc', action: this.query ? 'clear' : 'done'}]
      : [{keys: tier === 'narrow' ? '←→' : '↑↓', action: 'choose'}, {keys: '⏎', action: 'play'}, {keys: '/', action: 'search'},
        {keys: 'f', action: this.isFavorite() ? 'unfavorite' : 'favorite'}, {keys: 'Tab', action: 'next group'}, {keys: 'Esc', action: 'close'}];
    keycaps(canvas, 1, y, hints, look, canvas.width - 1);
  }

  private isFavorite(): boolean { const id = this.current()?.game.id; return Boolean(id && this.hub.favorites.includes(id)); }

  private drawList(canvas: Canvas, look: ArcadeLook, x: number, top: number, width: number, height: number): void {
    const entries = this.entries();
    const gameRows: number[] = [];
    entries.forEach((entry, row) => { if (entry.kind === 'game') gameRows.push(row); });
    const selectedRow = gameRows[this.cursor] ?? 0;
    // Keep the selection two rows from either edge, and its section header in view when it fits.
    const margin = Math.min(2, Math.floor((height - 1) / 2));
    if (selectedRow - margin < this.scroll) this.scroll = selectedRow - margin;
    if (selectedRow + margin >= this.scroll + height) this.scroll = selectedRow + margin - height + 1;
    let header = selectedRow;
    while (header > 0 && entries[header]!.kind !== 'header') header -= 1;
    if (header < this.scroll && selectedRow - header < height - margin) this.scroll = header;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, entries.length - height)));
    const sunk = look.surface.sunken;
    for (let row = 0; row < height; row += 1) {
      const index = this.scroll + row;
      const entry = entries[index];
      if (!entry) break;
      const y = top + row;
      if (entry.kind === 'header') {
        if (!entry.label) continue;
        canvas.text(x + 2, y, truncateText(entry.label.toUpperCase(), width - 4), {fg: look.text.dim, bg: sunk, bold: true});
        continue;
      }
      const gameIndex = gameRows.indexOf(index);
      this.rowHits.set(y, gameIndex);
      const selected = gameIndex === this.cursor;
      const bg = selected ? look.surface.selected : sunk;
      canvas.fill(x, y, width, 1, ' ', {bg});
      if (selected) canvas.text(x, y, '▌', {fg: look.accent, bg});
      const status = this.rowStatus(entry.game);
      const statusWidth = displayWidth(status);
      const titleRoom = width - 5 - (statusWidth ? statusWidth + 1 : 0);
      canvas.text(x + 2, y, truncateText(entry.game.title, Math.max(4, titleRoom)), {fg: selected ? look.text.strong : look.text.normal, bg, bold: selected});
      if (this.hub.favorites.includes(entry.game.id)) canvas.text(x + width - 2, y, '★', {fg: look.gold, bg});
      if (status && titleRoom >= displayWidth(entry.game.title)) canvas.text(x + width - 3 - statusWidth, y, status, {fg: selected ? look.text.normal : look.text.dim, bg});
    }
    if (this.scroll > 0) canvas.text(x + width - 2, top, '▲', {fg: look.text.dim, bg: sunk});
    if (entries.length - this.scroll > height) canvas.text(x + width - 2, top + height - 1, '▼', {fg: look.text.dim, bg: sunk});
  }

  /** A row's short right-hand status: today's daily state, or nothing (the details carry the bests). */
  private rowStatus(game: GameDefinition): string {
    const daily = game.daily?.(this.env.store.record(game.id).get(), this.today());
    return daily === 'done' ? '✓ daily' : daily === 'open' ? '◷ daily' : '';
  }

  private drawPreview(canvas: Canvas, look: ArcadeLook, palette: ArcadePalette, game: GameDefinition, x: number, y: number, width: number, height: number): void {
    if (width < 8 || height < 3) return;
    // A dark frame around the preview, so it reads as a screen of its own above the details.
    canvas.fill(x - 1, y - 1, width + 2, height + 2, ' ', {bg: look.surface.sunken});
    this.preview = this.preview?.width === width && this.preview.height === height ? this.preview : new Canvas(width, height);
    this.preview.clear(palette.deep);
    // Reduced Motion shows one representative still.
    game.preview(this.preview, this.env.motion().reduced ? 24 : this.previewFrame, palette);
    const fade = this.previewFade.value;
    for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
      const cell = this.preview.cell(column, row)!;
      const fg = cell.fg && fade < 1 ? mixRgb(look.surface.base, cell.fg, fade) : cell.fg;
      const bg = cell.bg && fade < 1 ? mixRgb(look.surface.base, cell.bg, fade) : cell.bg;
      canvas.put(x + column, y + row, cell.ch || ' ', {fg, bg});
    }
  }

  private drawDetail(canvas: Canvas, look: ArcadeLook, palette: ArcadePalette, game: GameDefinition, x: number, top: number, width: number, height: number): void {
    const textWidth = Math.max(10, width);
    const description = wrap(game.description, textWidth);
    const howTo = (game.howToPlay ?? []).slice(0, 2).flatMap(line => wrap(line, textWidth));
    const needed = 3 + description.length + (howTo.length ? howTo.length + 1 : 0) + 3;
    // The preview takes what the details do not need, up to a 16:9 picture (cells are about twice as tall as wide).
    const previewHeight = Math.max(3, Math.min(Math.round(width * 0.3), Math.round(height * 0.58), height - needed - 1));
    const previewTop = top + 1;
    this.drawPreview(canvas, look, palette, game, x, previewTop, width, previewHeight);
    let y = previewTop + previewHeight + 1;
    const bottom = top + height;
    const bg = look.surface.base;
    const line = (text: string, style: Style) => { if (y >= bottom) return; canvas.text(x, y, truncateText(text, width), {bg, ...style}); y += 1; };
    if (y < bottom) {
      canvas.text(x, y, truncateText(game.title, width), {fg: look.text.strong, bg, bold: true});
      const category = CATEGORY_TITLES[categoryOf(game)];
      if (width - displayWidth(game.title) - 4 > displayWidth(category)) canvas.text(x + width - displayWidth(category), y, category, {fg: look.text.dim, bg});
      y += 1;
    }
    line(game.tagline, {fg: look.accent, bold: true});
    for (const text of description) line(text, {fg: look.text.normal});
    if (howTo.length) { y += 1; for (const text of howTo) line(text, {fg: look.text.dim}); }
    y += 1;
    if (y < bottom) { keycaps(canvas, x, y, game.controls, look, x + width); y += 1; }
    const record = this.env.store.record(game.id).get();
    const daily = game.daily?.(record, this.today());
    const parts = [game.summary(record), daily === 'done' ? '✓ Daily done' : daily === 'open' ? '◷ Daily open' : '', this.hub.favorites.includes(game.id) ? '★ Favorite' : ''];
    line(parts.filter(Boolean).join('   '), {fg: look.text.strong});
  }

  /** Narrow terminals: one game at a time, its preview across the full width. */
  private drawCarousel(canvas: Canvas, look: ArcadeLook, palette: ArcadePalette, top: number, bottom: number): void {
    const list = this.gameEntries();
    const entry = list[this.cursor];
    if (!entry) { canvas.text(2, top + 1, this.query ? 'No game matches' : 'No games', {fg: look.text.dim}); return; }
    const width = canvas.width;
    const counter = `‹ ${this.cursor + 1} / ${list.length} ›`;
    const sections: Record<string, string> = {favorites: 'Favorites', recent: 'Recently played', search: 'Search', ...CATEGORY_TITLES};
    canvas.text(2, top, truncateText((sections[entry.section] ?? '').toUpperCase(), Math.max(1, width - displayWidth(counter) - 6)), {fg: look.text.dim, bold: true});
    canvas.text(width - displayWidth(counter) - 2, top, counter, {fg: look.text.normal});
    const game = entry.game;
    const description = wrap(game.description, width - 4);
    const room = bottom - top - 1;
    const previewHeight = Math.max(3, Math.min(Math.round(width * 0.28), room - 6 - Math.min(2, description.length)));
    this.drawPreview(canvas, look, palette, game, 3, top + 2, width - 6, previewHeight);
    let y = top + 3 + previewHeight;
    const put = (text: string, style: Style) => { if (y < bottom) { canvas.text(2, y, truncateText(text, width - 4), style); y += 1; } };
    put(`${game.title}${this.hub.favorites.includes(game.id) ? '  ★' : ''}`, {fg: look.text.strong, bold: true});
    put(game.tagline, {fg: look.accent});
    for (const text of description.slice(0, Math.max(0, bottom - y - 1))) put(text, {fg: look.text.normal});
    put(game.summary(this.env.store.record(game.id).get()), {fg: look.text.strong});
  }

  /** Under 40 × 12: a plain list and the keys. */
  private drawTiny(canvas: Canvas, look: ArcadeLook): void {
    canvas.text(0, 0, truncateText(this.query !== undefined ? `/ ${this.query}` : 'Vespyr Arcade', canvas.width), {fg: look.text.strong, bold: true});
    const list = this.gameEntries();
    const height = Math.max(1, canvas.height - 2);
    const start = Math.max(0, Math.min(this.cursor - Math.floor(height / 2), list.length - height));
    for (let row = 0; row < height; row += 1) {
      const index = start + row;
      const entry = list[index];
      if (!entry) break;
      const selected = index === this.cursor;
      this.rowHits.set(1 + row, index);
      canvas.text(0, 1 + row, truncateText(`${selected ? GLYPHS.selection : ' '} ${entry.game.title}`, canvas.width),
        selected ? {fg: look.text.strong, bg: look.surface.selected, bold: true} : {fg: look.text.normal});
    }
    canvas.text(0, canvas.height - 1, truncateText('↑↓ ⏎ play  Esc close', canvas.width), {fg: look.text.dim});
  }

  // ---- sheets ---------------------------------------------------------------------------------------------------

  /** Dim the playfield behind a sheet, so the sheet reads as above the game without hiding it. */
  private dim(canvas: Canvas, look: ArcadeLook, amount: number): void {
    for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
      const cell = canvas.cell(x, y)!;
      canvas.tint(x, y, {fg: cell.fg ? mixRgb(cell.fg, look.surface.sunken, amount) : undefined, bg: cell.bg ? mixRgb(cell.bg, look.surface.sunken, amount) : look.surface.sunken});
    }
  }

  /** A centered card: a colored top edge, heading, subtitle, an optional headline block, lines, then the menu. */
  private drawCard(canvas: Canvas, look: ArcadeLook, heading: {text: string; color: Rgb}, lines: readonly string[], menu: Menu | undefined,
    headline?: ReturnType<typeof typeset>, subtitle?: string): void {
    const menuWidth = menu ? Math.max(...menu.items.map(item => displayWidth(item.label) + 6)) : 0;
    const contentWidth = Math.max(displayWidth(heading.text), displayWidth(subtitle ?? ''), ...lines.map(line => displayWidth(line)), menuWidth, headline?.columns ?? 0, 22);
    const cardWidth = Math.min(canvas.width - 2, contentWidth + 8);
    const headRows = headline ? headline.rows + 1 : 0;
    const wanted = 3 + (subtitle ? 1 : 0) + headRows + (lines.length ? lines.length + 1 : 0) + (menu ? menu.items.length + 1 : 0);
    const cardHeight = Math.min(canvas.height, wanted);
    const left = Math.max(0, Math.floor((canvas.width - cardWidth) / 2));
    const top = Math.max(0, Math.floor((canvas.height - cardHeight) / 2));
    const panel = {fg: look.text.normal, bg: look.surface.raised};
    canvas.fill(left, top, cardWidth, cardHeight, ' ', panel);
    canvas.hline(left, top, cardWidth, '▀', {fg: heading.color, bg: look.surface.raised});
    const center = (text: string) => left + Math.max(1, Math.floor((cardWidth - displayWidth(text)) / 2));
    const end = top + cardHeight;
    let y = top + 1;
    canvas.text(center(heading.text), y, heading.text, {...panel, fg: heading.color, bold: true}); y += 1;
    if (subtitle && y < end) { canvas.text(center(subtitle), y, truncateText(subtitle, cardWidth - 2), {...panel, fg: look.text.dim}); y += 1; }
    if (headline && y + headline.rows < end) {
      y += 1;
      canvas.typeBlock(headline, left + Math.max(1, Math.floor((cardWidth - headline.columns) / 2)), y, {...panel, fg: look.text.strong, bold: true});
      y += headline.rows;
    }
    if (lines.length) {
      y += 1;
      for (const line of lines) { if (y >= end - 1) break; canvas.text(center(line), y, truncateText(line, cardWidth - 2), {...panel, fg: look.text.normal}); y += 1; }
    }
    if (menu && y + 1 < end) menu.draw(canvas, look.palette, left, y + 1, cardWidth);
  }

  private drawPause(canvas: Canvas, look: ArcadeLook): void {
    this.dim(canvas, look, 0.55);
    const definition = this.definition!;
    if (this.howTo) {
      const width = Math.max(20, Math.min(canvas.width - 10, 56));
      const lines = [...(definition.howToPlay ?? [definition.description]).flatMap(line => wrap(line, width)), '',
        ...definition.controls.map(control => `${control.keys}  ${control.action}`)];
      this.drawCard(canvas, look, {text: 'How to play', color: look.accent}, lines, undefined, undefined, definition.title);
      return;
    }
    this.drawCard(canvas, look, {text: 'Paused', color: look.accent}, [], this.menu!, undefined, definition.title);
  }

  private drawResults(canvas: Canvas, look: ArcadeLook): void {
    const game = this.game!;
    const result = game.result;
    this.dim(canvas, look, 0.5);
    if (this.sparkles.count) {
      const buffer = new PixelBuffer(canvas.width, canvas.height * 2);
      this.sparkles.draw(buffer, look.surface.sunken);
      canvas.blit(buffer);
    }
    const heading = result?.record ? {text: '★ New record', color: look.gold} : game.status === 'won' ? {text: 'Complete', color: look.ok} : {text: 'Game over', color: look.text.strong};
    const scoreText = result ? (this.countUp ? this.countUp.value.toLocaleString('en-US') : result.scoreText) : '';
    const headline = result ? typeset({role: 'celebration', text: scoreText, maxColumns: Math.max(8, canvas.width - 12), maxRows: Math.max(1, Math.floor(canvas.height / 5))}) : undefined;
    this.drawCard(canvas, look, heading, result?.details ?? [], this.menu!, headline, this.definition?.title);
  }
}

function overlaysOf(canvas: Canvas, encode: {color: ColorLevel; safe: boolean}): TextOverlay[] {
  return canvas.overlays.map(block => ({...block, sequence: `${Canvas.styleEscape(block.style ?? {}, encode)}${block.sequence}\u001b[0m`}));
}

/** Whether the result's score text is just the number, so it can count up. */
function countable(result: {score: number; scoreText: string}): boolean {
  return Number.isInteger(result.score) && result.score > 0 && result.scoreText === result.score.toLocaleString('en-US');
}

/** A real key press (not focus, mouse motion or a release). */
function isPress(key: Key): boolean {
  return !['focusIn', 'focusOut', 'mouseMove', 'mouseDrag', 'mouseRelease'].includes(key.kind);
}

/** Square keycaps (` ⏎ ` on a raised fill) and their actions, in one row from x until `limit`. Returns the next column. */
export function keycaps(canvas: Canvas, x: number, y: number, hints: readonly ControlHint[], look: ArcadeLook, limit: number): number {
  let column = x;
  const base = canvas.cell(Math.min(canvas.width - 1, x), y)?.bg ?? look.surface.base;
  const cap = mixRgb(look.surface.raised2, look.surface.selected, 0.35);
  for (const hint of hints) {
    const keys = ` ${hint.keys} `;
    const need = displayWidth(keys) + 1 + displayWidth(hint.action);
    if (column + need > limit) break;
    canvas.text(column, y, keys, {fg: look.text.strong, bg: cap, bold: true});
    column += displayWidth(keys) + 1;
    canvas.text(column, y, hint.action, {fg: look.text.dim, bg: base});
    column += displayWidth(hint.action) + 2;
  }
  return column;
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
