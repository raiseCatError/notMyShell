import {colorEscape} from '../chroma/escape.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import type {GlyphMode} from '../ui/glyphs.js';
import {UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateText} from '../util/text.js';
import type {ActionState, WorktreeManagerState} from './controller.js';
import {checkoutLabel, displayText, stateWords, type WorktreeRecord} from './model.js';
import {describePlan} from './mutations.js';

/**
 * Pure presentation for a future `/worktrees` panel. Input is immutable view
 * data built by the controller; render does no I/O and reads no environment.
 * Selection is shown by a marker (never color alone); NO_COLOR (`level: 'none'`)
 * emits no escapes at all; Safe glyphs are ASCII. Every line fits `columns`
 * display cells. Narrow layouts keep checkout, path and state, wrapping or
 * dropping secondary detail before the footer controls.
 */
export interface WorktreeView {
  readonly state: WorktreeManagerState;
  readonly rows: readonly WorktreeRecord[];
  readonly selectedId?: string;
  readonly actions: readonly ActionState[];
}

export interface RenderOptions {
  readonly columns: number;
  readonly rows: number;
  readonly glyphs: GlyphMode;
  readonly level: ColorLevel;
  /** Home directory for `~` abbreviation (display only). */
  readonly home?: string;
}

const RESET = '\u001b[0m';

export function buildWorktreeView(controller: {state: WorktreeManagerState; visible(): readonly WorktreeRecord[]; selected(): WorktreeRecord | undefined; actions(): ActionState[]}): WorktreeView {
  return {state: controller.state, rows: controller.visible(), selectedId: controller.selected()?.id, actions: controller.actions()};
}

function displayPath(path: string, home?: string): string {
  const safe = displayText(path);
  return home && home !== '/' && (path === home || path.startsWith(`${home}/`)) ? `~${displayText(path.slice(home.length))}` : safe;
}

/** Keep the leaf of a path visible: `…/notMyShell-foo`. */
function truncateStart(text: string, width: number, ellipsis: string): string {
  if (displayWidth(text) <= width) return text;
  if (width <= displayWidth(ellipsis)) return truncateText(text, width);
  const characters = [...text];
  let tail = '';
  while (characters.length && displayWidth(characters.at(-1)! + tail) <= width - displayWidth(ellipsis)) tail = characters.pop()! + tail;
  return ellipsis + tail;
}

/** Truncate to display cells; Safe mode uses an ASCII `...` (never `~`, which reads as the home directory). */
function fit(text: string, width: number, safe: boolean): string {
  if (!safe || displayWidth(text) <= width) return truncateText(text, Math.max(0, width));
  if (width <= 3) return '.'.repeat(Math.max(0, width));
  return truncateText(text, width - 2).replace(/…$/u, '...');
}

/** Wrap words joined by a separator onto at most `maxLines` lines. */
function wrapWords(words: readonly string[], separator: string, width: number, maxLines: number, safe: boolean): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line}${separator}${word}` : word;
    if (!line || displayWidth(candidate) <= width) { line = candidate; continue; }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  const kept = lines.slice(0, maxLines).map(text => fit(text, width, safe));
  if (lines.length > maxLines && kept.length) kept[kept.length - 1] = fit(`${lines[maxLines - 1]}${separator}${lines.slice(maxLines).join(separator)}`, width, safe);
  return kept;
}

const CONTROL_LABELS: Record<string, [nerd: string, safe: string, label: string]> = {
  navigate: ['Enter', 'Enter', 'open'],
  new: ['n', 'n', 'new'],
  remove: ['x', 'x', 'remove'],
  refresh: ['r', 'r', 'refresh'],
  search: ['/', '/', 'search'],
};

export function renderWorktreeView(view: WorktreeView, options: RenderOptions): string[] {
  const safe = options.glyphs === 'safe';
  const width = Math.max(1, options.columns);
  const color = (rgb: (typeof UI_COLORS)[keyof typeof UI_COLORS]) => colorEscape(38, rgb, options.level);
  const bold = options.level === 'none' ? '' : '\u001b[1m';
  const reset = options.level === 'none' ? '' : RESET;
  const paint = (style: string, text: string) => style ? `${style}${text}${reset}` : text;
  const dot = safe ? ' - ' : ' · ';
  const marker = safe ? '>' : '›';
  const ellipsis = safe ? '...' : '…';
  const {state} = view;

  const header: string[] = [];
  const count = state.snapshot ? `${state.snapshot.worktrees.length}${state.snapshot.truncated ? '+' : ''}` : '';
  const title = ['Worktrees', count && `(${count})`, state.loading ? (safe ? 'refreshing...' : 'refreshing…') : ''].filter(Boolean).join(' ');
  header.push(paint(bold + color(UI_COLORS.primary), fit(title, width, safe)));
  if (state.error) {
    const label = state.snapshot ? `stale: ${state.error}` : `unavailable: ${state.error}`;
    header.push(paint(color(UI_COLORS.failure), fit(label, width, safe)));
  }
  if (state.searching || state.query) header.push(fit(`/ ${displayText(state.query, 128)}${state.searching ? '_' : ''}`, width, safe));

  const footer = renderFooter(view, width, safe, dot, color);
  if (state.message) footer.unshift(paint(color(UI_COLORS.secondary), fit(displayText(state.message, 400), width, safe)));

  if (state.review) {
    const title = state.review.kind === 'remove' ? 'Remove worktree?' : 'Create worktree?';
    const body = describePlan(state.review.plan).map(line => fit(line, width, safe));
    const controls = fit(`Enter confirm${dot}Esc cancel`, width, safe);
    return [paint(bold + color(UI_COLORS.primary), fit(title, width, safe)), '', ...body, '', controls].slice(0, Math.max(1, options.rows));
  }

  const budget = Math.max(0, options.rows - header.length - footer.length - 1);
  const entries = view.rows.map(row => renderEntry(row, row.id === view.selectedId, {width, safe, dot, marker, ellipsis, home: options.home, paint, bold, color}));
  const body: string[] = [];
  if (!state.snapshot) { if (!state.error) body.push(fit(state.loading ? 'Discovering worktrees' : 'Not loaded', width, safe)); }
  else if (!view.rows.length) body.push(fit(state.query ? 'No worktrees match' : 'No worktrees', width, safe));
  else {
    // Window around the selection: whole entries only, selection always visible.
    const selected = Math.max(0, view.rows.findIndex(row => row.id === view.selectedId));
    let start = selected, end = selected + 1, used = entries[selected]?.length ?? 0;
    while (true) {
      const grewDown = end < entries.length && used + 1 + entries[end]!.length <= budget;
      if (grewDown) { used += 1 + entries[end]!.length; end += 1; }
      const grewUp = start > 0 && used + 1 + entries[start - 1]!.length <= budget;
      if (grewUp) { start -= 1; used += 1 + entries[start]!.length; }
      if (!grewDown && !grewUp) break;
    }
    for (let index = start; index < end; index += 1) {
      if (index > start) body.push('');
      body.push(...entries[index]!);
    }
    if (body.length > budget) body.length = Math.max(1, budget);
    if (start > 0 || end < entries.length) header[0] = paint(bold + color(UI_COLORS.primary), fit(`${title} ${start + 1}-${end}/${entries.length}`, width, safe));
  }
  return [...header, '', ...body, ...footer].slice(0, Math.max(1, options.rows));
}

function renderEntry(row: WorktreeRecord, selected: boolean, style: {width: number; safe: boolean; dot: string; marker: string; ellipsis: string; home?: string;
  paint: (style: string, text: string) => string; bold: string; color: (rgb: (typeof UI_COLORS)[keyof typeof UI_COLORS]) => string}): string[] {
  const {width, safe} = style;
  const prefix = selected ? `${style.marker} ` : '  ';
  const indent = '    ';
  const inner = Math.max(1, width - displayWidth(indent));
  const label = style.paint(selected ? style.bold + style.color(UI_COLORS.accent) : style.color(UI_COLORS.primary), fit(prefix + checkoutLabel(row), width, safe));
  const path = indent.slice(0, Math.min(indent.length, width - 1)) + truncateStart(displayPath(row.path, style.home), inner, style.ellipsis);
  const words = stateWords(row);
  const tone = row.status.kind === 'dirty' || row.locked || row.prunable || row.pathState !== 'present' ? UI_COLORS.failure : UI_COLORS.subtle;
  const state = wrapWords(words, style.dot, inner, 2, safe).map(line => style.paint(style.color(tone), indent + line));
  return [label, style.paint(style.color(UI_COLORS.secondary), fit(path, width, safe)), ...state];
}

function renderFooter(view: WorktreeView, width: number, safe: boolean, dot: string, color: (rgb: (typeof UI_COLORS)[keyof typeof UI_COLORS]) => string): string[] {
  const controls: string[] = [safe ? 'Up/Down select' : '↑↓ select'];
  for (const action of view.actions) {
    const label = CONTROL_LABELS[action.id];
    if (label && action.available) controls.push(`${safe ? label[1] : label[0]} ${label[2]}`);
  }
  controls.push(view.state.query ? 'Esc clear' : 'Esc back');
  // Wrap at control boundaries: controls are never cut off.
  const lines = wrapWords(controls, dot, width, controls.length, safe).map(line => color(UI_COLORS.subtle) ? `${color(UI_COLORS.subtle)}${line}${RESET}` : line);
  const removal = view.actions.find(action => action.id === 'remove');
  if (removal && !removal.available && view.rows.length) lines.unshift(fit(`x unavailable: ${removal.reason}`, width, safe));
  return lines;
}
