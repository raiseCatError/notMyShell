/**
 * Shared prototype kit: theme tokens, a cell canvas, NMSh-shaped primitives and
 * the real Aurora engine. Throwaway design-exploration code, never shipped.
 */
import {homedir} from 'node:os';
import {join} from 'node:path';
import {
  AnsiOutputParser, applyUiTheme, buildContextLine, buildInlineContextPrefix, CAT_CELL_WIDTH, catCells, CellGrid, colorEscape, colorLevel,
  currentBackground, DEFAULT_PROMPT_CONFIGURATION, displayWidth, fromOklch, getCurrentGlyphMode, GLYPHS, graphemes, IDLE_SEED, idlePalette,
  idleStops, minimalPromptConfiguration, mixPacked, NO_COLOR_VALUE, pack, packedLuminance, powerlineShapeGlyphs, PRESET_STOPS, renderScene,
  renderWelcome, resolveChrome, setActiveThemeStops, setThemeContext, themeChromaStops, themePreviewContext, toOklch, UI_COLORS, uiColorsFor, unpack,
  type CatPose, type IdlePalette, type Key, type NativePaletteId, type PromptConfiguration, type Rgb,
} from './src.js';

export const RESET = '\u001b[0m';
export const BOLD = '\u001b[1m';
export const ITALIC = '\u001b[3m';
export const FAINT = '\u001b[2m';
export const INVERSE = '\u001b[7m';

export type Backdrop = 'off' | 'subtle' | 'aurora';
export type Choice = 0 | 1 | 2 | 3;
export type Layout = 'twoLine' | 'oneLine';
export type Screen = 'pick' | 'review' | 'confirm' | 'customize' | 'welcome' | 'quiet' | 'kept' | 'left';

export interface State {
  screen: Screen;
  choice: Choice;
  layout: Layout;
  backdrop: Backdrop;
  /** Leave setup? 0 Stay (default), 1 Leave. */
  confirmIndex: 0 | 1;
  confirmFrom: Screen;
  changedAt: number;
  previousChoice: Choice;
  screenAt: number;
  previousScreen: Screen;
  customize: {row: number; theme: number};
}

export interface Env {
  reduced: boolean;
  palette: NativePaletteId;
  config: PromptConfiguration;
  /** Keep Existing evidence variant shown by the mockups. */
  keepCase?: KeepCase;
  /** Horizon variant: the sky's mood follows the highlighted choice (Stage's lighting idea). */
  reactive?: boolean;
}

export type KeepCase = 'starship' | 'multi' | 'custom';

export interface Concept {
  name: string;
  render(state: State, width: number, height: number, now: number, env: Env): string[];
  /** Picker navigation for this concept's axis; true when the key was used. */
  navigate(state: State, key: Key, now: number): boolean;
  /** Frame interval while something moves, 0 when the frame is still. */
  frameMs(state: State, now: number, env: Env): number;
}

// ---- color ---------------------------------------------------------------------------

export const none = () => colorLevel() === 'none';
export const fg = (color: Rgb) => colorEscape(38, color);
export const bg = (color: Rgb) => colorEscape(48, color);
export const BRAND: Rgb = {red: 166, green: 124, blue: 243};

export function tone(color: Rgb, l: number, chroma?: number): Rgb {
  const lch = toOklch(color);
  return fromOklch({l, c: chroma ?? lch.c, h: lch.h});
}

/** Every color derives from the live theme chrome (UI_COLORS is recolored by the active theme). */
export function tokens() {
  const ui = UI_COLORS;
  return {
    accent: ui.accent, primary: ui.primary, secondary: ui.secondary, subtle: ui.subtle, separator: ui.separator,
    success: ui.success, warning: ui.warning, failure: ui.failure,
    plate: tone(ui.accent, 0.255, 0.035),
    raised: tone(ui.accent, 0.33, 0.05),
    deep: tone(ui.accent, 0.42, 0.085),
    ink: tone(ui.accent, 0.2, 0.045),
    glow: tone(ui.accent, 0.84, 0.07),
    muted: tone(ui.accent, 0.58, 0.035),
  };
}

export function applyTheme(palette: NativePaletteId): PromptConfiguration {
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  config.nmsh.palette = palette;
  setThemeContext(config.nmsh.accent, undefined);
  applyUiTheme(uiColorsFor(resolveChrome(config.uiChrome, config.nmsh.palette, config.nmsh.accent, undefined)));
  setActiveThemeStops(themeChromaStops(config.nmsh.palette, config.nmsh.vibrance));
  return config;
}

// ---- canvas --------------------------------------------------------------------------

interface Cell {ch: string; style: string; bg: string; cont: boolean}

/** A cell buffer: text, fills and already-rendered ANSI rows compose in place; rows serialize with minimal SGR. */
export class Canvas {
  readonly cells: Cell[][];
  constructor(readonly width: number, readonly height: number) {
    this.cells = Array.from({length: Math.max(1, height)}, () => Array.from({length: Math.max(1, width)}, () => ({ch: ' ', style: '', bg: '', cont: false})));
  }

  private put(x: number, y: number, ch: string, style: string, background: string | undefined, wide: boolean): void {
    if (y < 0 || y >= this.height || x < 0 || x >= this.width) return;
    const cell = this.cells[y]![x]!;
    cell.ch = ch; cell.style = style; cell.cont = false;
    if (background !== undefined) cell.bg = background;
    if (wide && x + 1 < this.width) {
      const next = this.cells[y]![x + 1]!;
      next.ch = ''; next.style = style; next.cont = true;
      if (background !== undefined) next.bg = background;
    }
  }

  /** Text in one style; keeps each cell's fill unless `background` is given. Returns the column after the text. */
  text(x: number, y: number, value: string, style = '', background?: string, maxX = this.width): number {
    let column = x;
    for (const glyph of graphemes(value)) {
      const width = Math.max(1, displayWidth(glyph));
      if (column + width > maxX) break;
      this.put(column, y, glyph, style, background, width === 2);
      column += width;
    }
    return column;
  }

  spans(x: number, y: number, spans: ReadonlyArray<readonly [string, string]>, background?: string, maxX?: number): number {
    let column = x;
    for (const [style, value] of spans) column = this.text(column, y, value, style, background, maxX);
    return column;
  }

  /** An NMSh renderer's ANSI row at x; its own backgrounds win, otherwise the fill under it stays. */
  ansi(x: number, y: number, row: string, maxWidth = this.width - x): number {
    const parser = new AnsiOutputParser();
    parser.write(row);
    const line = parser.allLines()[0] ?? [];
    let column = x;
    for (const cell of line) {
      if (cell === null) continue;
      const width = cell ? Math.max(1, cell.width) : 1;
      if (column - x + width > maxWidth) break;
      const style = cell?.style ?? '';
      const own = Boolean(currentBackground(style));
      this.put(column, y, cell?.text ?? ' ', style, own ? '' : undefined, width === 2);
      column += width;
    }
    return column;
  }

  /** The Aurora (or any idle scene) grid, cell for cell. */
  grid(x: number, y: number, grid: CellGrid): void {
    for (let row = 0; row < grid.height; row++) {
      for (let column = 0; column < grid.width; column++) {
        const index = row * grid.width + column;
        const glyph = grid.glyphs[index]!, f = grid.fg[index]!, b = grid.bg[index]!;
        this.put(x + column, y + row, glyph, glyph !== ' ' && f !== NO_COLOR_VALUE ? colorEscape(38, unpack(f)) : '',
          b !== NO_COLOR_VALUE ? colorEscape(48, unpack(b)) : '', false);
      }
    }
  }

  fill(x: number, y: number, width: number, height: number, background: string): void {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + height); row++) {
      for (let column = Math.max(0, x); column < Math.min(this.width, x + width); column++) {
        const cell = this.cells[row]![column]!;
        cell.ch = ' '; cell.style = ''; cell.cont = false; cell.bg = background;
      }
    }
  }

  /** Faint text over a region (confirmation sheets dim what is behind them). */
  dim(x: number, y: number, width: number, height: number): void {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + height); row++) {
      for (let column = Math.max(0, x); column < Math.min(this.width, x + width); column++) {
        const cell = this.cells[row]![column]!;
        if (cell.ch.trim()) cell.style = `${cell.style}${FAINT}`;
      }
    }
  }

  /** Copy another canvas in; `clip(row)` limits how many columns of each row appear (reveal wipes). */
  blit(source: Canvas, x: number, y: number, clip?: (row: number) => number): void {
    for (let row = 0; row < source.height; row++) {
      const limit = clip ? Math.max(0, Math.min(source.width, clip(row))) : source.width;
      for (let column = 0; column < limit; column++) {
        const from = source.cells[row]![column]!;
        if (y + row < 0 || y + row >= this.height || x + column < 0 || x + column >= this.width) continue;
        // Empty cells leave what is underneath; a space with any style (a parsed segment's fill) is content.
        if (from.ch === ' ' && !from.bg && !from.style && !from.cont) continue;
        const to = this.cells[y + row]![x + column]!;
        to.ch = from.ch; to.style = from.style; to.cont = from.cont;
        if (from.bg) to.bg = from.bg;
      }
    }
  }

  rows(): string[] {
    return this.cells.map(row => {
      let out = '';
      let current = '';
      for (const cell of row) {
        if (cell.cont) continue;
        const style = `${cell.style}${cell.bg}`;
        if (style !== current) { out += `${RESET}${style}`; current = style; }
        out += cell.ch;
      }
      return `${out}${RESET}`;
    });
  }
}

// ---- type and shapes -----------------------------------------------------------------

export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    if (line && displayWidth(line) + 1 + displayWidth(word) > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export const ease = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
export const nerd = () => getCurrentGlyphMode() === 'nerd';

export function wordmark(canvas: Canvas, x: number, y: number): number {
  const t = tokens();
  return canvas.spans(x, y, [[BOLD + fg(t.primary), 'not'], [BOLD + fg(BRAND), 'My'], [BOLD + fg(t.primary), 'Shell']]);
}

/**
 * A powerline segment in NMSh's own geometry: the independent-segment notch,
 * the label on its fill, the end wedge. Without color it is reverse video.
 */
export function segment(canvas: Canvas, x: number, y: number, label: string, fill: Rgb, ink: Rgb, options: {bold?: boolean; open?: boolean; close?: boolean; selected?: boolean} = {}): number {
  const {open, close} = powerlineShapeGlyphs('wedge');
  if (none()) return canvas.text(x, y, options.selected ? ` ${label} ` : `[${label}]`, options.selected ? `${BOLD}${INVERSE}` : '');
  let column = x;
  if (options.open !== false) column = canvas.text(column, y, open, fg(fill));
  column = canvas.text(column, y, label, `${options.bold ? BOLD : ''}${fg(ink)}`, bg(fill));
  if (options.close !== false) column = canvas.text(column, y, close, fg(fill));
  return column;
}

export const segmentWidth = (label: string, open = true, close = true) => displayWidth(label) + (open ? 1 : 0) + (close ? 1 : 0);

/** A key on a small plate, then its action. Primary keys sit on the accent. */
export function keycap(canvas: Canvas, x: number, y: number, key: string, action: string, primary = false): number {
  const t = tokens();
  let column = none() ? canvas.text(x, y, `[${key}]`, BOLD)
    : canvas.text(x, y, ` ${key} `, `${BOLD}${fg(primary ? t.ink : t.primary)}`, bg(primary ? t.accent : t.plate));
  if (action) column = canvas.text(column + 1, y, action, fg(t.subtle));
  return column;
}
export const keycapWidth = (key: string, action: string) => displayWidth(` ${key} `) + (action ? 1 + displayWidth(action) : 0);

/** A row of keycaps, dropping trailing ones that do not fit. */
export function keycaps(canvas: Canvas, x: number, y: number, keys: ReadonlyArray<readonly [string, string, boolean?]>, maxX: number, gap = 3): number {
  let column = x;
  for (const [key, action, primary] of keys) {
    if (column + keycapWidth(key, action) > maxX) break;
    column = keycap(canvas, column, y, key, action, Boolean(primary)) + gap;
  }
  return column - gap;
}

/** A solid button with half-block edges: crisp, square, two rows tall (y-1 … y+1). */
export function button(canvas: Canvas, x: number, y: number, width: number, label: string, fill: Rgb, ink: Rgb, edges = true): void {
  if (none()) { canvas.text(x, y, `[ ${label} ]`, `${BOLD}${INVERSE}`); return; }
  if (edges) canvas.text(x, y - 1, '▄'.repeat(width), fg(fill));
  canvas.fill(x, y, width, 1, bg(fill));
  canvas.text(x + Math.max(1, Math.floor((width - displayWidth(label)) / 2)), y, label, `${BOLD}${fg(ink)}`, bg(fill));
  if (edges) canvas.text(x, y + 1, '▀'.repeat(width), fg(fill));
}

/** Segmented choice: the chosen option filled, the others quiet on a plate. */
export function segmented(canvas: Canvas, x: number, y: number, options: readonly string[], index: number, focused = true): number {
  const t = tokens();
  let column = x;
  options.forEach((option, i) => {
    const chosen = i === index;
    if (none()) { column = canvas.text(column, y, chosen ? ` ${option} ` : `  ${option}  `, chosen ? `${BOLD}${INVERSE}` : '') + 1; return; }
    column = canvas.text(column, y, ` ${option} `, chosen ? `${BOLD}${fg(focused ? t.ink : t.primary)}` : fg(t.secondary), bg(chosen ? (focused ? t.accent : t.deep) : t.plate));
  });
  return column;
}

export const truncate = (value: string, width: number) => displayWidth(value) <= width ? value : `${[...value].slice(0, Math.max(0, width - 1)).join('')}…`;

// ---- choices ---------------------------------------------------------------------------

export const CHOICES = [
  {key: '1', title: 'NMSh Recommended', short: 'Recommended', eyebrow: 'EXPRESSIVE', tagline: 'The full NMSh experience',
    line: 'Expressive, colorful, complete',
    lead: 'Color, motion and smart output, ready from your very first command.',
    features: ['Lavender powerline prompt with Git', 'Rich motion for launches and results', 'Smart folding keeps long output tidy', 'Vespyr greets every new session']},
  {key: '2', title: 'Minimal Terminal', short: 'Minimal', eyebrow: 'QUIET', tagline: 'Calm and familiar',
    line: 'NMSh\'s quiet look, nothing moves',
    lead: 'A plain prompt, ordinary output and no decoration. Everything useful, nothing loud.',
    features: ['A plain prompt that stays out of the way', 'No greeting, effects or animation', 'Output exactly as programs print it', 'Every NMSh feature, one keystroke away']},
  {key: '3', title: 'Customize Everything', short: 'Customize', eyebrow: 'TAILORED', tagline: 'Make every choice',
    line: 'A guided tour of every setting',
    lead: 'Walk through every NMSh setting with a live preview of each choice. Apply once, at the end.',
    features: ['Every setting, one clear step at a time', 'A live preview beside each choice', 'Nothing changes until you apply', 'Pick up any step later with /setup']},
  {key: '4', title: 'Keep Existing', short: 'Keep Existing', eyebrow: 'YOUR OWN', tagline: 'Your terminal, as it is',
    line: 'Your setup, plus NMSh\'s features',
    lead: 'Your prompt, colors and tools stay exactly as you set them. NMSh adds its features around them.',
    features: ['Your own prompt: Starship, P10k or Oh My Posh', 'Your terminal colors, font and cursor', 'Your shell, aliases and functions', 'Plus NMSh search, queue, Copy and folding']},
] as const;

export const REVIEW: Record<0 | 1, ReadonlyArray<readonly [string, string]>> = {
  0: [['Prompt', 'Lavender powerline · two lines'], ['Motion', 'Rich · expressive'], ['Transcript', 'Chat · smart folding'], ['Cursor', 'Your terminal\'s caret · effects Off'], ['Welcome', 'Vespyr, plus a first-run hello']],
  1: [['Prompt', 'Minimal · two lines'], ['Motion', 'Off · no effects'], ['Transcript', 'Normal · plain output'], ['Cursor', 'Your terminal\'s caret'], ['Welcome', 'None']],
};

export const KEEP_NOTE = 'Your shell, tools, history and accessibility settings stay exactly as they are.';

/**
 * Keep Existing evidence, as the read-only detector would report it. A fixed,
 * clearly fictional sample for mockups: nothing here is read from this machine.
 */
export const SAMPLE_ENVIRONMENT = {
  shell: 'zsh 5.9', host: 'Ghostty',
  prompt: {label: 'Starship', detail: '1.21 · ~/.config/starship.toml', evidence: 'started by ~/.zshrc'},
  tools: [['zoxide', 'Navigation', 'started by ~/.zshrc'], ['Atuin', 'History', 'started by ~/.zshrc']] as ReadonlyArray<readonly [string, string, string]>,
  other: {label: 'Powerlevel10k', detail: '~/.p10k.zsh', evidence: 'config present · not started by ~/.zshrc'},
};

/** What stays exactly, what NMSh draws through an adapter, what NMSh adds. */
export const KEEP_REVIEW: ReadonlyArray<readonly [string, string, 'keep' | 'adapter' | 'add']> = [
  ['Prompt', 'Starship, from your starship.toml', 'adapter'],
  ['Shell', 'zsh with your .zshrc, aliases and functions', 'keep'],
  ['Colors', 'Your terminal theme; NMSh chrome goes neutral', 'keep'],
  ['Tools', 'zoxide and Atuin, as NMSh providers', 'adapter'],
  ['Motion', 'None added', 'keep'],
  ['NMSh adds', 'Composer, history search, queue, Copy, folding', 'add'],
];

export interface KeepPlan {
  found: ReadonlyArray<{mark: 'ok' | 'warn'; what: string; why: string}>;
  question?: {title: string; options: ReadonlyArray<readonly [string, string]>; note: string};
  review: ReadonlyArray<readonly [string, string, 'keep' | 'adapter' | 'add']>;
  /** The review in three honest lines: unchanged, drawn by NMSh from the user's config, added by NMSh. */
  ledger: ReadonlyArray<readonly ['keep' | 'adapter' | 'add', string, string]>;
}

const LEDGER_KEEP = ['keep', 'Stays exactly', 'zsh with your .zshrc, aliases and functions; Ghostty\'s theme, font and cursor'] as const;
const LEDGER_ADD = ['add', 'NMSh adds', 'its composer, history search, queue, Copy, folding and sessions'] as const;

/** What the read-only detector reports for each mockup case, and the honest choice it leads to. */
export function keepPlan(kind: KeepCase = 'starship'): KeepPlan {
  const shell = {mark: 'ok' as const, what: 'zsh 5.9', why: 'your .zshrc, aliases and functions'};
  const host = {mark: 'ok' as const, what: 'Ghostty', why: 'your theme, font and cursor'};
  const tools = {mark: 'ok' as const, what: 'zoxide and Atuin', why: 'navigation and history'};
  if (kind === 'multi') {
    return {
      found: [shell, {mark: 'ok', what: 'Starship 1.21', why: 'started by ~/.zshrc'}, {mark: 'warn', what: 'Powerlevel10k', why: '~/.p10k.zsh, not started by ~/.zshrc'}, host],
      question: {title: 'Two prompts found. Which one should NMSh keep?', options: [['Starship', 'started by your ~/.zshrc'], ['Powerlevel10k', 'configured in ~/.p10k.zsh']],
        note: 'One prompt runs at a time. Your files stay exactly as they are either way.'},
      review: KEEP_REVIEW,
      ledger: [LEDGER_KEEP, ['adapter', 'Drawn from yours', 'the prompt you pick, from its own config; zoxide and Atuin'], LEDGER_ADD],
    };
  }
  if (kind === 'custom') {
    return {
      found: [shell, {mark: 'warn', what: 'A custom zsh PROMPT', why: 'set in ~/.zshrc'}, host],
      question: {title: 'NMSh can\'t draw custom prompts yet. What should it show?', options: [['Composer only', 'no prompt row; nothing imitates yours'],
        ['Your prompt, captured', 'proposed: zsh renders your PROMPT'], ['NMSh Minimal', 'NMSh\'s quiet prompt instead']],
      note: 'Outside NMSh your prompt is unchanged. Nothing is written to ~/.zshrc.'},
      review: [['Prompt', 'Composer only, until you choose otherwise', 'keep'], ...KEEP_REVIEW.slice(1)],
      ledger: [LEDGER_KEEP, ['adapter', 'Your prompt', 'no prompt row until you choose; your PROMPT still works outside NMSh'], LEDGER_ADD],
    };
  }
  return {found: [shell, {mark: 'ok', what: 'Starship 1.21', why: 'started by your ~/.zshrc'}, tools, host], review: KEEP_REVIEW,
    ledger: [LEDGER_KEEP, ['adapter', 'Drawn from yours', 'Starship from your starship.toml; zoxide and Atuin as NMSh providers'], LEDGER_ADD]};
}

export const LEDGER_MARKS = {keep: ['✓', '='], adapter: ['◐', '~'], add: ['+', '+']} as const;

/** A Starship-style prompt in the host's own ANSI palette (16-color indexes, so the terminal theme decides). Sample only. */
export function sampleExternalPrompt(): string {
  if (none()) return '~/Projects/notMyShell on  main [!] via  v22.11';
  return '\u001b[1;36m~/Projects/notMyShell\u001b[0m on \u001b[1;35m main\u001b[0m \u001b[1;31m[!]\u001b[0m via \u001b[1;32m v22.11\u001b[0m';
}

/** Render with neutral NMSh chrome (the Grayscale preset), as Keep Existing would, then restore the theme. */
export function withNeutralChrome<T>(config: PromptConfiguration, render: () => T): T {
  applyUiTheme(uiColorsFor(resolveChrome({...config.uiChrome, source: 'custom', preset: 'grayscale'}, config.nmsh.palette, config.nmsh.accent, undefined)));
  try { return render(); }
  finally { applyUiTheme(uiColorsFor(resolveChrome(config.uiChrome, config.nmsh.palette, config.nmsh.accent, undefined))); }
}

// ---- the real Aurora engine ----------------------------------------------------------------

export type Mood = 'aurora' | 'subtle' | 'calm' | 'spectrum' | 'dusk' | 'theme';

/** A scene time where the curtains are well formed; the engine is a pure function of time. */
export const AURORA_EPOCH = 30_500;

const hex = (value: string): Rgb => ({red: parseInt(value.slice(1, 3), 16), green: parseInt(value.slice(3, 5), 16), blue: parseInt(value.slice(5, 7), 16)});

function four(stops: readonly number[]): number[] {
  return Array.from({length: 4}, (_, i) => stops[i % stops.length]!);
}

function dimPalette(palette: IdlePalette, amount: number, star: number): IdlePalette {
  return {...palette, stops: four(palette.stops).map(stop => mixPacked(stop, palette.sky, amount)), star: mixPacked(palette.star, palette.sky, star)};
}

/**
 * The onboarding sky: a real aurora's green rim and blue glow, with the active
 * theme's own colors in the rays. Lavender Native gets lavender rays over a
 * green rim; Ocean, Sunset or Forest recolor the rays; Grayscale stays neutral.
 */
export function skyStops(config: PromptConfiguration): Rgb[] {
  const theme = idleStops(config, 'appearance');
  if (config.nmsh.palette === 'grayscale') return theme;
  const accent = theme[0] ?? hex('#a67cf3');
  return [hex('#3ee8b5'), hex('#45b8f0'), accent, theme[1] ?? accent];
}

/** Mood palettes over the same engine: Subtle, Dusk and Calm dim the sky's own colors toward its night. */
export function moodPalette(mood: Mood, config: PromptConfiguration): IdlePalette {
  const night = idlePalette(idleStops(config, 'appearance'));
  const base = {...idlePalette(skyStops(config)), sky: night.sky, skyTop: night.skyTop, star: night.star};
  const normalized = {...base, stops: four(base.stops)};
  switch (mood) {
    case 'aurora': return normalized;
    case 'theme': { const p = idlePalette(idleStops(config, 'appearance')); return {...p, stops: four(p.stops)}; }
    case 'subtle': return dimPalette(base, 0.55, 0.3);
    case 'dusk': return dimPalette(base, 0.76, 0.45);
    case 'calm': return dimPalette(base, 0.9, 0.12);
    case 'spectrum': { const p = idlePalette(PRESET_STOPS.aurora.map(hex)); return {...p, stops: four(p.stops), sky: base.sky, skyTop: base.skyTop}; }
  }
}

export function blendPalettes(a: IdlePalette, b: IdlePalette, t: number): IdlePalette {
  const k = Math.min(1, Math.max(0, t));
  return {stops: four(a.stops).map((stop, i) => mixPacked(stop, four(b.stops)[i]!, k)), sky: mixPacked(a.sky, b.sky, k), skyTop: mixPacked(a.skyTop, b.skyTop, k),
    star: mixPacked(a.star, b.star, k), warm: mixPacked(a.warm, b.warm, k)};
}

export class Sky {
  readonly grid = new CellGrid();
  draw(width: number, height: number, time: number, palette: IdlePalette, decorate?: (grid: CellGrid) => void): CellGrid {
    this.grid.resize(Math.max(1, width), Math.max(1, height));
    renderScene('aurora', this.grid, {time, seed: IDLE_SEED, palette, level: colorLevel(), nerd: nerd()});
    decorate?.(this.grid);
    return this.grid;
  }
}

/** Vespyr's approved pixels composited onto a scene, so the sky shows around the silhouette. */
export function drawCat(grid: CellGrid, x: number, y: number, pose: CatPose, facingRight: boolean): void {
  for (const cell of catCells(pose, facingRight)) {
    const cx = x + cell.dx, cy = y + cell.dy;
    if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) continue;
    const index = cy * grid.width + cx;
    grid.glyphs[index] = cell.glyph;
    grid.fg[index] = cell.fg;
    if (cell.bg !== undefined) grid.bg[index] = cell.bg;
  }
  const whisker = pack({red: 150, green: 142, blue: 172});
  for (const source of [0, 6]) grid.set(x + (facingRight ? CAT_CELL_WIDTH - 1 - source : source), y + 1, '=', whisker);
}

/** A one-eighth hairline along the bottom row, brightest under the brightest light above it. */
export function drawHorizon(grid: CellGrid, accent: Rgb): void {
  const y = grid.height - 1;
  const glow = mixPacked(pack(accent), 0xffffff, 0.3);
  for (let x = 0; x < grid.width; x++) {
    let peak = 0;
    for (let row = Math.max(0, grid.height - 5); row < grid.height; row++) {
      const j = row * grid.width + x;
      for (const value of [grid.fg[j]!, grid.bg[j]!]) if (value !== NO_COLOR_VALUE) peak = Math.max(peak, packedLuminance(value));
    }
    const i = y * grid.width + x;
    const sky = grid.bg[i] === NO_COLOR_VALUE ? 0x15141c : grid.glyphs[i] === '▀' ? mixPacked(grid.fg[i]!, grid.bg[i]!, 0.5) : grid.bg[i]!;
    grid.glyphs[i] = '▁';
    grid.bg[i] = sky;
    grid.fg[i] = mixPacked(mixPacked(sky, glow, 0.55), 0xffffff, Math.min(0.45, peak * 0.9));
  }
}

/** Scene time for the sky: still under Reduced Motion, slower for quieter moods. */
export function skyTime(now: number, started: number, env: Env, speed = 1): number {
  return env.reduced ? AURORA_EPOCH : AURORA_EPOCH + (now - started) * speed;
}

export const backdropMood = (backdrop: Backdrop): Mood | undefined => backdrop === 'off' || none() ? undefined : backdrop === 'subtle' ? 'subtle' : 'aurora';

/** Ambient cadence: Aurora a little calmer than the screensaver's 160 ms, Subtle half that. */
export const backdropFrameMs = (backdrop: Backdrop, env: Env) => env.reduced || backdrop === 'off' || none() ? 0 : backdrop === 'subtle' ? 320 : 200;

export const BACKDROP_LABEL: Record<Backdrop, string> = {off: 'Off', subtle: 'Subtle', aurora: 'Aurora'};

// ---- NMSh renderers ----------------------------------------------------------------------

export function configFor(choice: Choice, layout: Layout, palette: NativePaletteId): PromptConfiguration {
  const config = choice === 1 ? minimalPromptConfiguration(layout) : structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  config.nmsh.palette = palette;
  return config;
}

/** A realistic preview context: a project on a branch with a change or two, one toolchain (not every module at once). */
export function previewContext() {
  return {...themePreviewContext(), toolchains: ['node' as const], git: {staged: 0, modified: 2, untracked: 0, conflicts: 0, ahead: 1, behind: 0}};
}

/** The composer exactly as the real prompt renderer draws it for a configuration. */
export function composerRows(config: PromptConfiguration, width: number, after = ''): string[] {
  const context = previewContext();
  const marker = `${fg(UI_COLORS.accent)}${GLYPHS.prompt}${RESET} `;
  if (config.composerLayout === 'oneLine') return [`${buildInlineContextPrefix(context, width, config)}${after}`];
  return [buildContextLine(context, width, config, 'composer'), `${marker}${after}`];
}

export function headerRow(config: PromptConfiguration, width: number): string {
  return buildContextLine(previewContext(), width, config, config.placement);
}

export function welcomeRows(width: number, frame: 'open' | 'blink' = 'open'): string[] {
  return renderWelcome({identity: {version: '0.21.0', commit: 'a1b2c3d'}, cwd: join(homedir(), 'Projects'), shell: 'zsh'}, width, frame).map(row => row.ansi);
}

/** NMSh's composer at the bottom of the screen: prompt row, input row with the caret, bottom rule. */
export function composerBar(canvas: Canvas, config: PromptConfiguration, width: number, height: number): void {
  const t = tokens();
  canvas.ansi(0, height - 3, headerRow(config, width), width);
  canvas.text(0, height - 2, GLYPHS.prompt, `${BOLD}${fg(t.accent)}`);
  canvas.text(2, height - 2, ' ', '', bg(t.accent));
  canvas.text(0, height - 1, (nerd() ? '─' : '-').repeat(width), fg(t.separator));
}

/** After Minimal, Keep Existing or Leave: the real NMSh screen, quiet, with one factual line. */
export function settledScreen(canvas: Canvas, state: State, width: number, height: number, env: Env): void {
  const t = tokens();
  const check = none() ? '+' : '✓';
  if (state.screen === 'quiet') {
    canvas.text(0, 0, check, fg(t.success));
    canvas.text(2, 0, `Minimal Terminal is ready · ${state.layout === 'twoLine' ? 'Two-line' : 'One-line'} · /startup to change`, fg(t.subtle));
    composerRows(configFor(1, state.layout, env.palette), width, '').forEach((row, i) => canvas.ansi(0, 2 + i, row, width));
    return;
  }
  if (state.screen === 'kept') {
    withNeutralChrome(env.config, () => {
      const n = tokens();
      canvas.text(0, 0, check, fg(n.success));
      canvas.text(2, 0, 'Keeping your setup: Starship, zsh and your terminal theme · /startup to change', fg(n.subtle));
      canvas.ansi(0, height - 3, sampleExternalPrompt(), width);
      canvas.text(0, height - 2, GLYPHS.prompt, `${BOLD}${fg(n.accent)}`);
      canvas.text(2, height - 2, ' ', '', bg(n.accent));
      canvas.text(0, height - 1, (nerd() ? '─' : '-').repeat(width), fg(n.separator));
    });
    return;
  }
  canvas.text(0, 0, 'Setup closed. Nothing was applied · /startup reopens it', fg(t.subtle));
  composerBar(canvas, env.config, width, height);
}

export const TIPS: ReadonlyArray<readonly [string, string]> = [['/guide', 'take the tour: everything NMSh can do'], ['/btw', 'ask NMSh anything, in plain English'],
  ['F1', 'open the command palette'], ['/startup', 'change your starting point anytime']];

export function sectionTitles(): string[] {
  return ['Start', 'Terminal', 'Look', 'Prompt', 'Motion', 'Cursor', 'Editor', 'Transcript', 'History', 'Shell', 'Sessions', 'Ask', 'Welcome', 'Idle', 'Tools', 'Review'];
}
