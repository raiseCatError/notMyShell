import {fromOklch, toOklch} from '../../chroma/color.js';
import {colorEscape, type Rgb} from '../../chroma/escape.js';
import {CellGrid, unpack} from '../../idle/CellGrid.js';
import {moodPalette} from '../../idle/auroraMoods.js';
import type {PromptConfiguration, StartingPointId} from '../../prompt/configuration.js';
import {buildContextLine, buildInlineContextPrefix, themePreviewContext} from '../../prompt/prompt.js';
import {colorLevel, type ColorLevel} from '../../presentation/capabilities.js';
import {GLYPHS, getCurrentGlyphMode, powerlineShapeGlyphs} from '../../ui/glyphs.js';
import {UI_COLORS} from '../../ui/palette.js';
import {displayWidth, truncateAnsi} from '../../util/text.js';
import type {SetupState} from '../SetupCat.js';
import {keepExistingPlan, type KeepPlan} from '../environment/keepExisting.js';
import {BOLD, FAINT, INVERSE, ITALIC, RESET, StartupCanvas} from './canvas.js';
import {renderSkyBand, skyAvailable, skyCatPose} from './sky.js';
import {STARTING_POINT_COPY, STARTING_POINT_MOODS, startingPointAt} from './startingPoints.js';

/**
 * The starting-point selector, Horizon: the real Aurora above a luminous
 * horizon where Vespyr stands, four choices on solid ground below it, the
 * highlighted one a powerline segment pointing at what it means. The sky and
 * horizon come from the sky band; everything below is the ground, drawn in the
 * saved theme's chrome and cached per state and size (previews draw with the
 * highlighted draft's settings).
 */

export interface StartupContext {
  /** One reused grid for the sky band. */
  sky: CellGrid;
  /** Opened again (from /startup, /setup quick or Settings), not a genuine first run. */
  reopened: boolean;
  /** Reduced Motion or Effects Off: one still sky frame. */
  reduced: boolean;
  /** The real composer for a draft, drawn with that draft's own settings. */
  preview: (config: PromptConfiguration, width: number) => string[];
  /** The guided setup's steps, for Customize's tiles. */
  steps: readonly string[];
  /** Keep Existing: the detected Starship prompt as NMSh draws it, once the app has rendered it (shown while Starship is the answer). */
  sample?: string;
  /** Ground rows cached per state and size. */
  ground?: {key: string; rows: string[]};
}

export interface StartupLayout {skyHeight: number; twoColumn: boolean; tier: 'full' | 'accordion' | 'tiny'; margin: number}

/**
 * Tiers by columns × rows: two columns from 96 columns, an accordion below,
 * a plain list under 40 × 14. The sky takes 42 % of the rows but never what the
 * ground needs (22 rows with two columns, 18 with one), so it never jumps when
 * the highlight changes; there is no sky under 20 rows.
 */
export function startupLayout(columns: number, height: number): StartupLayout {
  const margin = columns >= 120 ? 6 : columns >= 90 ? 4 : columns >= 56 ? 3 : 2;
  if (columns < 40 || height < 14) return {skyHeight: 0, twoColumn: false, tier: 'tiny', margin: 1};
  const twoColumn = columns >= 96;
  const ground = twoColumn ? 22 : 18;
  const skyHeight = height < 20 ? 0 : Math.max(4, Math.min(Math.round(height * 0.42), height - ground));
  return {skyHeight, twoColumn, tier: twoColumn ? 'full' : 'accordion', margin};
}

// ---- tokens --------------------------------------------------------------------------------

const BRAND: Rgb = {red: 166, green: 124, blue: 243};
const tone = (color: Rgb, l: number, chroma?: number): Rgb => { const lch = toOklch(color); return fromOklch({l, c: chroma ?? lch.c, h: lch.h}); };

/** Every color derives from the live theme chrome (the saved theme while the selector is open). */
function tokens() {
  const ui = UI_COLORS;
  return {accent: ui.accent, primary: ui.primary, secondary: ui.secondary, subtle: ui.subtle, separator: ui.separator,
    success: ui.success, warning: ui.warning, failure: ui.failure,
    plate: tone(ui.accent, 0.255, 0.035), raised: tone(ui.accent, 0.33, 0.05), deep: tone(ui.accent, 0.42, 0.085),
    ink: tone(ui.accent, 0.2, 0.045), muted: tone(ui.accent, 0.58, 0.035)};
}
type Tokens = ReturnType<typeof tokens>;

interface Paint {level: ColorLevel; nerd: boolean; t: Tokens}
const fg = (paint: Paint, color: Rgb) => colorEscape(38, color, paint.level);
const bg = (paint: Paint, color: Rgb) => colorEscape(48, color, paint.level);
/** NO_COLOR and 16-color hosts mark the selection in reverse video instead of the accent fill. */
const plainSelection = (paint: Paint) => paint.level === 'none' || paint.level === 'ansi16';

const glyph = (paint: Paint, nerd: string, safe: string) => paint.nerd ? nerd : safe;
const KEY_LABELS: Record<string, [string, string]> = {'↑↓': ['↑↓', 'Up/Dn'], '1–4': ['1–4', '1-4'], '⏎': ['⏎', 'Enter'], 'esc': ['esc', 'Esc'], '←→': ['←→', 'L/R'], 'A': ['A', 'A'], 'R': ['R', 'R']};
const keyLabel = (paint: Paint, key: string) => (KEY_LABELS[key] ?? [key, key])[paint.nerd ? 0 : 1];

// ---- primitives ------------------------------------------------------------------------------

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    if (line && displayWidth(line) + 1 + displayWidth(word) > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const truncate = (value: string, width: number) => displayWidth(value) <= width ? value : `${[...value].slice(0, Math.max(0, width - 1)).join('')}…`;

/** The independent-segment notch, the label on the accent in dark ink, the end wedge pointing at the details. */
function segment(canvas: StartupCanvas, paint: Paint, x: number, y: number, label: string, options: {open?: boolean} = {}): number {
  if (plainSelection(paint)) return canvas.text(x, y, label, `${BOLD}${INVERSE}`);
  const {open, close} = powerlineShapeGlyphs('wedge');
  let column = x;
  if (options.open !== false) column = canvas.text(column, y, open, fg(paint, paint.t.accent));
  column = canvas.text(column, y, label, `${BOLD}${fg(paint, paint.t.ink)}`, bg(paint, paint.t.accent));
  return canvas.text(column, y, close, fg(paint, paint.t.accent));
}

/** A key on a small square plate, then what it does; the primary key sits on the accent. */
function keycap(canvas: StartupCanvas, paint: Paint, x: number, y: number, key: string, action: string, primary = false): number {
  const label = keyLabel(paint, key);
  let column = paint.level === 'none' ? canvas.text(x, y, `[${label}]`, BOLD)
    : canvas.text(x, y, ` ${label} `, `${BOLD}${fg(paint, primary ? paint.t.ink : paint.t.primary)}`, bg(paint, primary ? paint.t.accent : paint.t.plate));
  if (action) column = canvas.text(column + 1, y, action, fg(paint, paint.t.subtle));
  return column;
}
const keycapWidth = (paint: Paint, key: string, action: string) => displayWidth(paint.level === 'none' ? `[${keyLabel(paint, key)}]` : ` ${keyLabel(paint, key)} `) + (action ? 1 + displayWidth(action) : 0);

type KeySpec = readonly [key: string, action: string, primary?: boolean];

/** A row of keycaps; when they do not all fit, the least essential go first (jump, then choose). */
function keycaps(canvas: StartupCanvas, paint: Paint, x: number, y: number, keys: readonly KeySpec[], maxX: number, gap = 3): void {
  const fits = (list: readonly KeySpec[]) => list.reduce((sum, [key, action]) => sum + keycapWidth(paint, key, action) + gap, -gap) <= maxX - x;
  const essential = (list: readonly KeySpec[]) => list.filter(([key]) => key !== '1–4');
  const shown = [keys, essential(keys), essential(keys).filter(([key]) => key !== '↑↓')].find(fits) ?? essential(keys).filter(([key]) => key !== '↑↓');
  let column = x;
  for (const [key, action, primary] of shown) {
    if (column + keycapWidth(paint, key, action) > maxX) break;
    column = keycap(canvas, paint, column, y, key, action, Boolean(primary)) + gap;
  }
}

/** A solid button with half-block edges: square, three rows tall (y-1 … y+1). */
function button(canvas: StartupCanvas, paint: Paint, x: number, y: number, label: string): number {
  const width = displayWidth(label) + 8;
  if (plainSelection(paint)) return canvas.text(x, y, `[ ${label} ]`, `${BOLD}${INVERSE}`);
  canvas.text(x, y - 1, '▄'.repeat(width), fg(paint, paint.t.accent));
  canvas.fill(x, y, width, 1, bg(paint, paint.t.accent));
  canvas.text(x + 4, y, label, `${BOLD}${fg(paint, paint.t.ink)}`, bg(paint, paint.t.accent));
  canvas.text(x, y + 1, '▀'.repeat(width), fg(paint, paint.t.accent));
  return x + width;
}

/** Segmented control: the chosen option filled, the others quiet on a plate. */
function segmented(canvas: StartupCanvas, paint: Paint, x: number, y: number, options: readonly string[], index: number): number {
  let column = x;
  options.forEach((option, i) => {
    const chosen = i === index;
    if (plainSelection(paint)) { column = canvas.text(column, y, chosen ? ` ${option} ` : `  ${option}  `, chosen ? `${BOLD}${INVERSE}` : '') + 1; return; }
    column = canvas.text(column, y, ` ${option} `, chosen ? `${BOLD}${fg(paint, paint.t.ink)}` : fg(paint, paint.t.secondary), bg(paint, chosen ? paint.t.accent : paint.t.plate));
  });
  return column;
}

function eyebrow(canvas: StartupCanvas, paint: Paint, x: number, y: number, label: string, width: number): void {
  const end = canvas.text(x, y, glyph(paint, '◆', '*'), fg(paint, paint.t.accent));
  const text = canvas.text(end + 1, y, label.split('').join(' '), fg(paint, paint.t.muted));
  canvas.text(text + 2, y, glyph(paint, '─', '-').repeat(Math.max(0, x + width - text - 2)), fg(paint, paint.t.plate));
}

function wordmark(canvas: StartupCanvas, paint: Paint, x: number, y: number): number {
  return canvas.spans(x, y, [[`${BOLD}${fg(paint, paint.t.primary)}`, 'not'], [`${BOLD}${fg(paint, BRAND)}`, 'My'], [`${BOLD}${fg(paint, paint.t.primary)}`, 'Shell']]);
}

// ---- content --------------------------------------------------------------------------------

const CHOICE_IDS: readonly StartingPointId[] = ['recommended', 'minimal', 'customize', 'existing'];
const firstRun = (state: SetupState, context: StartupContext) => !context.reopened && !state.saved.onboardingComplete;
const current = (state: SetupState, id: StartingPointId) => state.saved.onboardingComplete && state.saved.startingPoint === id;

/** What a preset would set, said from its actual draft. */
function presetReview(state: SetupState, id: 'recommended' | 'minimal', context: StartupContext): Array<readonly [string, string]> {
  const draft = state.draft;
  const lines = draft.composerLayout === 'oneLine' ? 'one line' : 'two lines';
  const motion = draft.presentation.effectsOff ? 'Off · no effects'
    : `${draft.motion.rendering === 'rich' ? 'Rich' : 'Clean'}${draft.motion.contextTransitions === 'expressive' ? ' · expressive' : ''}${draft.presentation.reducedMotion ? ' · Reduced Motion stays on' : ''}`;
  const folding = draft.outputFolding === 'smart' ? 'smart folding' : draft.outputFolding === 'never' ? 'plain output' : 'always folded';
  const caret = draft.cursor.shape === 'host' ? 'Your terminal\'s caret' : `A ${draft.cursor.shape} caret`;
  const welcome = draft.welcome === 'none' ? 'None' : id === 'recommended' && firstRun(state, context) ? 'Vespyr, plus a first-run hello' : 'Vespyr greets each new session';
  return [['Prompt', `${id === 'minimal' ? 'Minimal' : 'Lavender powerline'} · ${lines}`], ['Motion', motion],
    ['Transcript', `${draft.transcriptPresentation === 'chat' ? 'Chat' : 'Normal'} · ${folding}`],
    ['Cursor', `${caret}${draft.cursor.effect === 'none' && id === 'recommended' ? ' · effects Off' : ''}`], ['Welcome', welcome]];
}

/** Keep Existing's honest three lines: unchanged, drawn by NMSh from the person's own config, added by NMSh. */
function keepLedger(state: SetupState, plan: KeepPlan): Array<readonly ['keep' | 'adapter' | 'add', string, string]> {
  const evidence = state.quick?.evidence;
  const shell = evidence?.shell.id ? `${evidence.shell.id} with your ${evidence.shell.id === 'fish' ? 'config.fish' : evidence.shell.id === 'bash' ? '.bashrc' : '.zshrc'}, aliases and functions` : 'your shell';
  const host = evidence?.host ? `${evidence.host}'s theme, font and cursor` : 'your terminal\'s theme, font and cursor';
  const draft = state.draft;
  const tools = evidence?.tools.filter(tool => tool.state === 'active').map(tool => tool.label) ?? [];
  const toolText = tools.length ? `; ${tools.join(' and ')} as NMSh providers` : '';
  const prompt = draft.provider === 'starship' ? 'Starship from your starship.toml'
    : draft.provider === 'powerlevel10k' ? 'Powerlevel10k from your .p10k.zsh'
    : draft.provider === 'ohMyPosh' ? 'Oh My Posh from your own config'
    : draft.provider === 'none' ? 'no prompt row; yours still works outside NMSh'
    : 'NMSh\'s quiet prompt; yours still works outside NMSh';
  return [['keep', 'Stays exactly', `${shell}; ${host}`], ['adapter', plan.question ? 'Your prompt' : 'Drawn from yours', `${prompt}${toolText}`],
    ['add', 'NMSh adds', 'its composer, history search, queue, Copy, folding and sessions']];
}

const LEDGER_MARKS = {keep: ['✓', '='], adapter: ['◐', '~'], add: ['+', '+']} as const;

const PROVIDER_LABELS: Readonly<Record<PromptConfiguration['provider'], string>> = {nmsh: 'NMSh Native', starship: 'Starship', powerlevel10k: 'Powerlevel10k', ohMyPosh: 'Oh My Posh', none: 'Composer only'};

/** What a re-detection would change on a configured install: only the detected facts. */
function redetectChanges(saved: PromptConfiguration, draft: PromptConfiguration): Array<{label: string; from: string; to: string}> {
  const changes: Array<{label: string; from: string; to: string}> = [];
  const add = (label: string, from: string, to: string) => { if (from !== to) changes.push({label, from, to}); };
  add('Shell', saved.shellBackend, draft.shellBackend);
  add('Prompt', PROVIDER_LABELS[saved.provider], PROVIDER_LABELS[draft.provider]);
  add('Navigation', saved.navigation === 'zoxide' ? 'zoxide' : 'NMSh Native', draft.navigation === 'zoxide' ? 'zoxide' : 'NMSh Native');
  add('History', saved.history === 'atuin' ? 'Atuin' : 'NMSh Native', draft.history === 'atuin' ? 'Atuin' : 'NMSh Native');
  return changes;
}

// ---- ground ---------------------------------------------------------------------------------

interface Ground {canvas: StartupCanvas; paint: Paint; state: SetupState; context: StartupContext; layout: StartupLayout}

function header(g: Ground, x: number, y: number, width: number): number {
  const {canvas, paint, context} = g;
  if (context.reopened) canvas.text(x, y, 'Your starting point', `${BOLD}${fg(paint, paint.t.primary)}`);
  else wordmark(canvas, paint, canvas.text(x, y, 'Welcome to ', `${BOLD}${fg(paint, paint.t.primary)}`), y);
  const lead = context.reopened ? 'Four ways to use NMSh. Nothing changes until you confirm.'
    : 'Four ways to begin. Nothing changes until you confirm, and /startup brings you back.';
  const lines = wrap(lead, width);
  lines.forEach((line, i) => canvas.text(x, y + 1 + i, line, fg(paint, paint.t.secondary)));
  return y + 1 + lines.length;
}

/** The four choices; the highlighted one is a filled segment whose wedge points at its details. */
function list(g: Ground, x: number, y: number, width: number, compact: boolean, faded: boolean, expand?: (row: number) => number, textMax = x + width + 1): number {
  const {canvas, paint, state} = g;
  const quick = state.quick!;
  let row = y;
  CHOICE_IDS.forEach((id, index) => {
    const copy = STARTING_POINT_COPY[id];
    const selected = index === quick.choice;
    const tag = current(state, id) ? ' · current' : '';
    if (selected) {
      const label = ` ${copy.key}  ${copy.title}${tag}`;
      segment(canvas, paint, x, row, plainSelection(paint) ? `${label} `.padEnd(width) : label.padEnd(width - 2));
    } else {
      canvas.text(x + 1, row, ` ${copy.key}`, fg(paint, paint.t.muted));
      const end = canvas.text(x + 5, row, copy.title, `${faded ? FAINT : ''}${fg(paint, paint.t.secondary)}`, undefined, textMax);
      if (tag) canvas.text(end, row, tag, `${faded ? FAINT : ''}${fg(paint, paint.t.subtle)}`, undefined, textMax);
    }
    row += 1;
    if (!compact || selected) {
      canvas.text(x + 5, row, copy.line, `${faded && !selected ? FAINT : ''}${fg(paint, selected ? paint.t.secondary : paint.t.subtle)}`, undefined, textMax);
      row += 1;
    }
    if (selected && expand) row = expand(row);
    if (!compact) row += 1;
  });
  return row;
}

/** Read-only evidence, as the detector found it. Returns the next free row. */
function keepEvidence(g: Ground, x: number, y: number, width: number, maxY: number, plan: KeepPlan): number {
  const {canvas, paint, state} = g;
  const where = process.platform === 'darwin' ? 'Found on this Mac' : 'Found on this computer';
  const end = canvas.text(x, y, where, fg(paint, paint.t.muted));
  canvas.text(end + 1, y, 'read-only · nothing is changed', `${ITALIC}${fg(paint, paint.t.subtle)}`, undefined, x + width);
  let row = y + 1;
  if (!state.quick?.evidence) {
    canvas.text(x, row++, 'Looking at your shell and its startup files…', fg(paint, paint.t.subtle), undefined, x + width);
    return row;
  }
  for (const item of plan.found) {
    if (row >= maxY) return row;
    const mark = canvas.text(x, row, item.mark === 'ok' ? glyph(paint, '✓', '+') : '!', fg(paint, item.mark === 'ok' ? paint.t.success : paint.t.warning));
    const after = canvas.text(mark + 1, row, item.what, fg(paint, paint.t.primary), undefined, x + width);
    canvas.text(after + 2, row++, item.why, fg(paint, paint.t.subtle), undefined, x + width);
  }
  return row;
}

/** Customize: the guided setup's steps as tiles with colored caps. */
function tiles(g: Ground, x: number, y: number, width: number, maxY: number): void {
  const {canvas, paint, context} = g;
  const columns = Math.max(2, Math.floor((width + 1) / 13));
  const caps = moodPalette('spectrum', g.state.saved).stops;
  context.steps.forEach((title, i) => {
    const cx = x + (i % columns) * 13, cy = y + Math.floor(i / columns) * 3;
    if (cy + 1 >= maxY || cx + 12 > x + width) return;
    if (plainSelection(paint)) { canvas.text(cx, cy + 1, `[${title}]`, ''); return; }
    canvas.text(cx, cy, '▀'.repeat(12), fg(paint, unpack(caps[i % caps.length]!)), bg(paint, paint.t.plate));
    canvas.text(cx, cy + 1, ` ${title}`.padEnd(12).slice(0, 12), fg(paint, paint.t.primary), bg(paint, paint.t.plate));
  });
}

function preview(g: Ground, x: number, y: number, width: number, maxY: number): void {
  const {canvas, paint, state, context} = g;
  const id = startingPointAt(state.quick!.choice);
  if (y >= maxY) return;
  if (id === 'customize') { tiles(g, x, y, width, maxY); return; }
  if (id === 'existing') {
    const plan = keepExistingPlan(state.quick!.evidence, state.saved, state.quick!.keep.redetect);
    const row = keepEvidence(g, x, y, width, maxY - 3, plan);
    if (row + 2 >= maxY || !state.quick!.evidence) return;
    const sample = state.draft.provider === 'starship' ? context.sample : undefined;
    if (sample) {
      canvas.ansi(x, row + 1, sample, width);
      canvas.text(x, row + 2, GLYPHS.prompt, `${BOLD}${fg(paint, paint.t.accent)}`);
      canvas.text(x + 2, row + 2, 'your prompt, as NMSh will draw it', `${ITALIC}${fg(paint, paint.t.subtle)}`, undefined, x + width);
    } else {
      const rows = context.preview(state.draft, width);
      rows.forEach((line, i) => { if (row + 1 + i < maxY) canvas.ansi(x, row + 1 + i, line, width); });
    }
    return;
  }
  let row = y;
  if (id === 'minimal') {
    canvas.text(x, row, 'Layout', fg(paint, paint.t.muted));
    const end = segmented(canvas, paint, x + 8, row, ['Two-line', 'One-line'], state.quick!.layout === 'twoLine' ? 0 : 1);
    canvas.text(end + 2, row, keyLabel(paint, '←→'), fg(paint, paint.t.subtle));
    row += 2;
  }
  for (const line of context.preview(state.draft, width)) if (row < maxY) canvas.ansi(x, row++, line, width);
}

function details(g: Ground, x: number, y: number, width: number, maxY: number): void {
  const {canvas, paint, state} = g;
  const id = startingPointAt(state.quick!.choice);
  const copy = STARTING_POINT_COPY[id];
  eyebrow(canvas, paint, x, y, copy.eyebrow, width);
  let row = y + 2;
  for (const line of wrap(copy.lead, width)) canvas.text(x, row++, line, fg(paint, paint.t.primary));
  row += 1;
  if (state.message) { for (const line of wrap(state.message, width)) canvas.text(x, row++, line, fg(paint, paint.t.warning)); row += 1; }
  // Recommended and Minimal list what they bring; Customize shows its map and Keep Existing its evidence instead of promises.
  if ((id === 'recommended' || id === 'minimal') && maxY - row >= 8) {
    for (const feature of copy.features) {
      const end = canvas.text(x, row, id === 'minimal' ? glyph(paint, '◇', 'o') : glyph(paint, '◆', '*'), fg(paint, id === 'minimal' ? paint.t.muted : paint.t.accent));
      canvas.text(end + 1, row++, feature, fg(paint, paint.t.secondary), undefined, x + width);
    }
    row += 1;
  }
  preview(g, x, row, width, maxY);
}

function keepQuestion(g: Ground, x: number, y: number, width: number, plan: KeepPlan): number {
  const {canvas, paint, state} = g;
  const question = plan.question!;
  let row = y;
  for (const line of wrap(question.title, width)) canvas.text(x, row++, line, `${BOLD}${fg(paint, paint.t.warning)}`);
  const labelWidth = Math.max(...question.options.map(option => displayWidth(option.label))) + 2;
  question.options.forEach((option, i) => {
    const chosen = i === state.quick!.keep.answer;
    canvas.text(x, row, chosen ? GLYPHS.selection : ' ', `${BOLD}${fg(paint, paint.t.accent)}`);
    if (plainSelection(paint)) canvas.text(x + 2, row, ` ${option.label} `.padEnd(labelWidth), chosen ? `${BOLD}${INVERSE}` : '');
    else canvas.text(x + 2, row, ` ${option.label} `.padEnd(labelWidth), chosen ? `${BOLD}${fg(paint, paint.t.ink)}` : fg(paint, paint.t.secondary), bg(paint, chosen ? paint.t.accent : paint.t.plate));
    canvas.text(x + 4 + labelWidth, row++, option.detail, fg(paint, paint.t.subtle), undefined, x + width);
  });
  for (const line of wrap(question.note, width)) canvas.text(x, row++, line, `${ITALIC}${fg(paint, paint.t.subtle)}`);
  return row;
}

function review(g: Ground, x: number, y: number, width: number, maxY: number): void {
  const {canvas, paint, state} = g;
  const quick = state.quick!;
  const id = startingPointAt(quick.choice);
  const message = (row: number) => {
    if (!state.message) return row;
    for (const line of wrap(state.message, width)) canvas.text(x, row++, line, fg(paint, paint.t.warning));
    return row + 1;
  };
  if (id === 'existing') {
    const plan = keepExistingPlan(quick.evidence, state.saved, quick.keep.redetect);
    if (plan.noop) {
      eyebrow(canvas, paint, x, y, 'REVIEW', width);
      canvas.text(x, y + 2, 'Keep your setup as it is?', `${BOLD}${fg(paint, paint.t.primary)}`);
      let row = y + 3;
      for (const line of wrap('Your NMSh settings, prompt, shell and terminal stay exactly as they are. R reads your environment again and shows what would change.', width)) canvas.text(x, row++, line, fg(paint, paint.t.secondary));
      row = message(row + 1);
      button(canvas, paint, x, row + 1, `${keyLabel(paint, '⏎')}  Keep my setup`);
      keycap(canvas, paint, x + displayWidth(`${keyLabel(paint, '⏎')}  Keep my setup`) + 11, row + 1, 'esc', 'back');
      return;
    }
    if (state.saved.onboardingComplete && quick.keep.redetect && quick.evidence && !plan.question) {
      eyebrow(canvas, paint, x, y, 'RE-DETECTED', width);
      const changes = redetectChanges(state.saved, state.draft);
      canvas.text(x, y + 2, changes.length ? 'Use what NMSh found?' : 'Nothing to change', `${BOLD}${fg(paint, paint.t.primary)}`);
      let row = y + 3;
      for (const line of wrap(changes.length ? 'Only these settings change; everything else stays exactly as it is.' : 'Your NMSh settings already match your shell, prompt and tools.', width)) canvas.text(x, row++, line, fg(paint, paint.t.secondary));
      row += 1;
      for (const change of changes) {
        canvas.text(x, row, change.label, fg(paint, paint.t.subtle));
        canvas.text(x + 13, row++, `${change.from} ${glyph(paint, '→', '->')} ${change.to}`, fg(paint, paint.t.primary), undefined, x + width);
      }
      row = message(row + 1);
      const label = `${keyLabel(paint, '⏎')}  ${changes.length ? 'Use these' : 'Keep my setup'}`;
      button(canvas, paint, x, row + 1, label);
      keycap(canvas, paint, x + displayWidth(label) + 11, row + 1, 'esc', 'back');
      return;
    }
    if (!plan.question) eyebrow(canvas, paint, x, y, 'REVIEW', width);
    const top = plan.question ? y : y + 2;
    canvas.text(x, top, 'Keep your terminal as it is?', `${BOLD}${fg(paint, paint.t.primary)}`);
    canvas.text(x, top + 1, 'NMSh never edits your prompt, theme or shell files.', fg(paint, paint.t.secondary), undefined, x + width);
    let row = top + 3;
    if (!quick.evidence) {
      canvas.text(x, row, 'Looking at your shell and its startup files…', fg(paint, paint.t.subtle), undefined, x + width);
      return;
    }
    if (plan.question) row = keepQuestion(g, x, row, width, plan) + 1;
    const colors = {keep: paint.t.success, adapter: paint.t.accent, add: paint.t.warning} as const;
    for (const [kind, label, text] of keepLedger(state, plan)) {
      if (row >= maxY - 4) break;
      canvas.text(x, row, LEDGER_MARKS[kind][paint.nerd && paint.level !== 'none' ? 0 : 1], `${BOLD}${fg(paint, colors[kind])}`);
      canvas.text(x + 3, row, label, fg(paint, paint.t.subtle));
      const lines = plan.question ? [truncate(text, width - 21)] : wrap(text, width - 21);
      lines.forEach((line, i) => canvas.text(x + 21, row + i, line, fg(paint, paint.t.primary)));
      row += lines.length + (lines.length > 1 ? 1 : 0);
    }
    row = message(row + 1);
    const label = `${keyLabel(paint, '⏎')}  Keep my setup`;
    button(canvas, paint, x, row + 1, label);
    keycap(canvas, paint, x + displayWidth(label) + 11, row + 1, 'esc', 'back');
    return;
  }
  const copy = STARTING_POINT_COPY[id];
  eyebrow(canvas, paint, x, y, 'REVIEW', width);
  canvas.text(x, y + 2, `Start with ${copy.title}?`, `${BOLD}${fg(paint, paint.t.primary)}`, undefined, x + width);
  let row = y + 3;
  const note = current(state, id) ? 'This is your current starting point; applying it again resets its look and feel.'
    : state.saved.onboardingComplete ? 'This replaces NMSh\'s current look and feel. Your shell, tools, history and accessibility settings stay exactly as they are.'
    : 'This sets NMSh\'s look and feel. Your shell, tools, history and accessibility settings stay exactly as they are.';
  for (const line of wrap(note, width)) canvas.text(x, row++, line, fg(paint, paint.t.secondary));
  row += 1;
  for (const [label, value] of presetReview(state, id as 'recommended' | 'minimal', g.context)) {
    canvas.text(x, row, label, fg(paint, paint.t.subtle));
    canvas.text(x + 13, row++, value, fg(paint, paint.t.primary), undefined, x + width);
  }
  row = message(row + 1);
  const label = `${keyLabel(paint, '⏎')}  Apply`;
  button(canvas, paint, x, row + 1, label);
  keycap(canvas, paint, x + displayWidth(label) + 11, row + 1, 'esc', 'back');
}

function auroraLabel(state: SetupState, paint: Paint): string {
  const backdrop = state.quick!.backdrop;
  if (!skyAvailable(backdrop, paint.level)) return 'Aurora off';
  return backdrop === 'subtle' ? 'Aurora subtle' : 'Aurora on';
}

function footer(g: Ground, y: number): void {
  const {canvas, paint, state, layout} = g;
  const quick = state.quick!;
  const width = canvas.width, margin = layout.margin;
  const keeping = startingPointAt(quick.choice) === 'existing';
  let keys: KeySpec[];
  if (quick.review) {
    const plan = keeping ? keepExistingPlan(quick.evidence, state.saved, quick.keep.redetect) : undefined;
    keys = [...(plan?.question && plan.question.options.length > 1 ? [['↑↓', 'answer'] as const] : []),
      ...(keeping && state.saved.onboardingComplete ? [['R', 're-detect'] as const] : [])];
  } else keys = [['↑↓', 'choose'], ['1–4', 'jump'], ['⏎', 'continue', true], ['esc', 'leave']];
  const label = auroraLabel(state, paint);
  const right = width - margin - (displayWidth(label) + 4);
  keycaps(canvas, paint, margin, y, keys, width >= 60 ? right - 2 : width - margin);
  if (width >= 60) keycap(canvas, paint, right, y, 'A', label);
}

/** Leave setup?: a sheet rising from the bottom, Stay focused first; the ground behind it recedes (never the sky). */
function confirmSheet(g: Ground): void {
  const {canvas, paint, state, layout} = g;
  const width = canvas.width, margin = layout.margin, top = canvas.height - 4;
  canvas.dim(0, 1, width, top - 1);
  const stay = (state.quick!.confirmIndex ?? 0) === 0;
  const leaveX = width - margin - 9, stayX = leaveX - 10;
  if (plainSelection(paint)) {
    canvas.fill(0, top, width, 4, '');
    canvas.text(margin, top + 1, 'Leave setup?', BOLD);
    canvas.text(margin, top + 2, 'Nothing changes. /startup reopens this anytime.', '', undefined, stayX - 2);
    canvas.text(stayX, top + 1, ' Stay ', stay ? `${BOLD}${INVERSE}` : '');
    canvas.text(leaveX, top + 1, ' Leave ', stay ? '' : `${BOLD}${INVERSE}`);
    canvas.text(margin, top + 3, `${keyLabel(paint, '←→')} choose · ${keyLabel(paint, '⏎')} confirm · ${keyLabel(paint, 'esc')} stay`, '');
    return;
  }
  canvas.text(0, top, '▄'.repeat(width), fg(paint, paint.t.plate));
  canvas.fill(0, top + 1, width, 3, bg(paint, paint.t.plate));
  canvas.text(margin, top + 1, 'Leave setup?', `${BOLD}${fg(paint, paint.t.primary)}`, bg(paint, paint.t.plate));
  canvas.text(margin, top + 2, 'Nothing changes: NMSh keeps its current settings. /startup reopens this anytime.', fg(paint, paint.t.secondary), bg(paint, paint.t.plate), stayX - 2);
  canvas.text(stayX, top + 1, '  Stay  ', `${BOLD}${fg(paint, stay ? paint.t.ink : paint.t.primary)}`, bg(paint, stay ? paint.t.accent : paint.t.raised));
  canvas.text(leaveX, top + 1, '  Leave  ', `${BOLD}${fg(paint, !stay ? paint.t.ink : paint.t.primary)}`, bg(paint, !stay ? paint.t.accent : paint.t.raised));
  canvas.text(margin, top + 3, `${keyLabel(paint, '←→')} choose · ${keyLabel(paint, '⏎')} confirm · ${keyLabel(paint, 'esc')} stay`, fg(paint, paint.t.subtle), bg(paint, paint.t.plate), width - margin);
}

function drawGround(g: Ground): void {
  const {canvas, state, layout} = g;
  const quick = state.quick!;
  const width = canvas.width, margin = layout.margin;
  // Row 0 is the horizon's (or a blank top margin when there is no sky).
  const y = header(g, margin, 1, Math.min(width - margin * 2, 90)) + 1;
  const maxY = canvas.height - 2;
  const reviewing = quick.review;
  if (layout.twoColumn) {
    const listWidth = Math.max(34, Math.min(46, Math.round(width * 0.34)));
    list(g, margin, y, listWidth, maxY - y < 15, reviewing);
    const dx = margin + listWidth + 4, dw = Math.min(72, width - dx - margin);
    if (reviewing) review(g, dx, y, dw, maxY); else details(g, dx, y, dw, maxY);
  } else {
    // Narrow: the highlighted choice opens in place (an accordion) with its essentials.
    const textMax = width - margin;
    list(g, margin, y, Math.min(width - margin * 2, 40), true, reviewing, row => {
      const {canvas: c, paint} = g;
      const id = startingPointAt(quick.choice);
      type Line = {draw: (line: number) => void; keep: number};
      const text = (value: string, style: string, keep: number): Line => ({keep, draw: line => c.text(margin + 5, line, truncate(value, textMax - margin - 5), style, undefined, textMax)});
      const lines: Line[] = [];
      if (state.message) for (const line of wrap(state.message, width - margin * 2 - 5)) lines.push(text(line, fg(paint, paint.t.warning), 3));
      if (reviewing) {
        const keepPlan = id === 'existing' ? keepExistingPlan(quick.evidence, state.saved, quick.keep.redetect) : undefined;
        keepPlan?.question?.options.forEach((option, i) => {
          const chosen = i === quick.keep.answer;
          lines.push(text(`${chosen ? GLYPHS.selection : ' '} ${option.label}`, chosen ? `${BOLD}${fg(paint, paint.t.primary)}` : fg(paint, paint.t.secondary), chosen ? 3 : 1));
        });
        const prompt = id === 'existing' ? (quick.evidence || state.saved.onboardingComplete ? `Keep my setup? ${keyLabel(paint, '⏎')} to confirm` : 'Looking at your setup…')
          : `Apply ${STARTING_POINT_COPY[id].short}? ${keyLabel(paint, '⏎')} to confirm`;
        lines.push(text(prompt, `${BOLD}${fg(paint, paint.t.primary)}`, 4));
        lines.push(text(`${keyLabel(paint, 'esc')} back`, fg(paint, paint.t.subtle), 0));
      } else {
        if (id === 'minimal') lines.push({keep: 3, draw: line => { c.text(margin + 5, line, 'Layout', fg(paint, paint.t.muted)); segmented(c, paint, margin + 13, line, ['Two-line', 'One-line'], quick.layout === 'twoLine' ? 0 : 1); }});
        STARTING_POINT_COPY[id].features.slice(0, 3).forEach((feature, i) => lines.push(text(feature, fg(paint, paint.t.subtle), i === 0 ? 1 : 0)));
      }
      // The opened choice takes only the rows left once every later choice has its own row; the least needed lines go first.
      const room = Math.max(0, maxY + 1 - row - (CHOICE_IDS.length - 1 - quick.choice));
      let shown = lines;
      for (let keep = 0; shown.length > room && keep <= 4; keep++) shown = shown.filter(line => line.keep > keep);
      shown = shown.slice(0, room);
      shown.forEach((line, i) => line.draw(row + i));
      return row + shown.length + (shown.length < room ? 1 : 0);
    }, textMax);
  }
  if (quick.confirm) confirmSheet(g);
  else footer(g, canvas.height - 1);
}

/** Below 40 × 14: a plain four-line list and the keys; every choice, Apply and Leave stay reachable down to 16 × 6. */
function tinyRows(state: SetupState, width: number, height: number, paint: Paint): string[] {
  const quick = state.quick!;
  const mark = GLYPHS.selection;
  const narrow = width < 18;
  const choice = (index: number) => {
    const copy = STARTING_POINT_COPY[CHOICE_IDS[index]!];
    const selected = index === quick.choice;
    const text = narrow ? `${selected ? mark : ' '}${copy.key} ${copy.short}` : `${selected ? mark : ' '} ${copy.key} ${copy.short}`;
    return selected && paint.level !== 'none' ? `${BOLD}${colorEscape(38, paint.t.primary, paint.level)}${text}${RESET}` : selected ? `${BOLD}${text}${RESET}` : text;
  };
  let rows: string[];
  if (quick.confirm) {
    const index = quick.confirmIndex ?? 0;
    rows = ['Leave setup?', `${index === 0 ? mark : ' '} Stay`, `${index === 1 ? mark : ' '} Leave`, 'Nothing changes.', `${keyLabel(paint, '⏎')} confirm`, `${keyLabel(paint, 'esc')} stay`];
  } else if (quick.review) {
    const id = CHOICE_IDS[quick.choice]!;
    const plan = id === 'existing' ? keepExistingPlan(quick.evidence, state.saved, quick.keep.redetect) : undefined;
    const answers = plan?.question?.options.map((option, i) => `${i === quick.keep.answer ? mark : ' '} ${option.label}`) ?? [];
    rows = [choice(quick.choice), ...answers, ...(quick.choice === 1 ? [quick.layout === 'oneLine' ? 'One-line' : 'Two-line'] : []),
      `${keyLabel(paint, '⏎')} ${id === 'existing' ? 'keep' : 'apply'}`, `${keyLabel(paint, 'esc')} back`];
  } else {
    rows = [narrow ? 'notMyShell' : 'notMyShell · start', ...CHOICE_IDS.map((_, index) => choice(index)),
      ...(quick.choice === 1 ? [`${quick.layout === 'oneLine' ? 'One-line' : 'Two-line'} ${keyLabel(paint, '←→')}`] : []),
      `${keyLabel(paint, '⏎')} go · ${keyLabel(paint, 'esc')} leave`];
    // Short terminals give up the title first, then Minimal's layout line; the keys always stay.
    if (rows.length > height) rows = rows.filter((_, i) => i !== 0);
    if (rows.length > height) rows = rows.filter(row => !/-line/u.test(row) || row.includes(mark));
  }
  if (state.message) rows = [state.message, ...rows];
  if (rows.length > height) rows = [...rows.slice(0, Math.max(0, height - 1)), rows.at(-1)!];
  // The selector owns the whole screen at every size.
  const shown = rows.slice(0, Math.max(1, height)).map(row => truncateAnsi(row, width));
  return [...shown, ...Array<string>(Math.max(0, height - shown.length)).fill('')];
}

function themeSignature(): string {
  const ui = UI_COLORS;
  return [ui.accent, ui.primary, ui.secondary, ui.subtle, ui.separator, ui.success, ui.warning].map(color => `${color.red},${color.green},${color.blue}`).join(';');
}

/** One frame of the selector: the sky band (if any), the horizon, then the ground. Rows always fit columns × height. */
export function renderStartup(state: SetupState, columns: number, height: number, now: number, context: StartupContext): string[] {
  const quick = state.quick!;
  const width = Math.max(1, Math.floor(columns)), rows = Math.max(1, Math.floor(height));
  const level = colorLevel();
  const paint: Paint = {level, nerd: getCurrentGlyphMode() === 'nerd', t: tokens()};
  const layout = startupLayout(width, rows);
  if (layout.tier === 'tiny') return tinyRows(state, width, rows, paint);
  const mood = STARTING_POINT_MOODS[startingPointAt(quick.choice)], previousMood = STARTING_POINT_MOODS[startingPointAt(quick.previousChoice)];
  const timing = {now, started: quick.sky.started, mood, previousMood, changedAt: quick.changedAt, from: quick.sky.from, timeAt: quick.sky.timeAt,
    activeAt: quick.sky.activeAt, reduced: context.reduced};
  const cat = width >= 56 && layout.skyHeight >= 5 && level !== 'none' ? {x: layout.margin, pose: skyCatPose(timing)} : undefined;
  const sky = layout.skyHeight
    ? renderSkyBand(context.sky, {...timing, width, height: layout.skyHeight, backdrop: quick.backdrop, config: state.saved, level, nerd: paint.nerd, ...(cat ? {cat} : {})})
    : {rows: [], horizon: ''};
  const groundHeight = rows - layout.skyHeight;
  const key = JSON.stringify([width, groundHeight, layout.skyHeight > 0, quick.choice, quick.review, quick.confirm ?? false, quick.confirmIndex ?? 0, quick.layout,
    quick.backdrop, quick.keep, quick.evidence ?? null, state.message ?? '', state.saved.startingPoint ?? '', state.saved.onboardingComplete, context.reopened,
    context.sample ?? '', level, paint.nerd, themeSignature()]);
  if (context.ground?.key !== key) {
    const canvas = new StartupCanvas(width, groundHeight);
    drawGround({canvas, paint, state, context, layout});
    context.ground = {key, rows: canvas.rows()};
  }
  const ground = [...context.ground.rows];
  if (layout.skyHeight) ground[0] = sky.horizon;
  return [...sky.rows, ...ground].slice(0, rows);
}

const PREVIEW_CONTEXT = () => ({...themePreviewContext(), toolchains: ['node' as const], git: {staged: 0, modified: 2, untracked: 0, conflicts: 0, ahead: 1, behind: 0}});

/** The real composer for a draft, in the current theme: its prompt row and the input row with a sample command. */
export function defaultStartupPreview(config: PromptConfiguration, width: number): string[] {
  const context = PREVIEW_CONTEXT();
  const typed = `${colorEscape(38, UI_COLORS.subtle)}git status${RESET}`;
  const marker = `${colorEscape(38, UI_COLORS.accent)}${GLYPHS.prompt}${RESET} ${typed}`;
  if (config.provider === 'none') return [marker];
  // An external prompt is drawn by its own tool; without a rendered sample, say so rather than imitate it.
  if (config.provider !== 'nmsh') return [`${ITALIC}${colorEscape(38, UI_COLORS.subtle)}${PROVIDER_LABELS[config.provider]} draws this row from your own config${RESET}`, marker];
  if (config.composerLayout === 'oneLine') return [`${buildInlineContextPrefix(context, width, config)}${typed}`];
  return [buildContextLine(context, width, config, 'composer'), `${colorEscape(38, UI_COLORS.accent)}${GLYPHS.prompt}${RESET} ${typed}`];
}

export function createStartupContext(options: Partial<Omit<StartupContext, 'sky'>> = {}): StartupContext {
  return {sky: new CellGrid(), reopened: false, reduced: false, preview: defaultStartupPreview, steps: [], ...options};
}

