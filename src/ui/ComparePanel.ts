import type {Key} from '../terminal/keys.js';
import type {CompletedCommand} from '../output/OutputBuffer.js';
import {renderControlRows} from './controls.js';
import {focusForeground, foreground, UI_COLORS} from './palette.js';
import {GLYPHS} from './glyphs.js';
import {displayWidth, padCells, truncateAnsi, truncateText} from '../util/text.js';
import {displaySafe} from '../input/PasteReview.js';
import {compareRecords, comparisonNotes, previousRun, sideLabel, summary, type Comparison, type DiffLine} from '../output/compare.js';

/**
 * Compare output…: choose the other block (the previous run of the same command is suggested), then read the
 * difference. Records are identified by startId from a snapshot taken when the panel opened; the comparison is
 * computed only when both sides are chosen, and again only when an option changes.
 */
export interface ComparePanelState {
  base: CompletedCommand;
  /** Newest first, as /copy numbers them, without the base block. */
  candidates: Array<{record: CompletedCommand; number: number}>;
  suggested?: number;
  cursor: number;
  comparison?: Comparison;
  ignoreWhitespace: boolean;
  /** Side-by-side when the window is wide enough and the person has not turned it off. */
  sideBySide: boolean;
  scroll: number;
  /** A brief note shown in the panel (copy feedback: notices stay out of the way while a panel is open). */
  note?: string;
}

export function createComparePanel(base: CompletedCommand, recent: readonly CompletedCommand[], partner?: CompletedCommand): ComparePanelState {
  const candidates = recent.map((record, index) => ({record, number: index + 1})).filter(item => item.record !== base);
  const previous = previousRun(base, recent);
  const suggested = previous ? candidates.findIndex(item => item.record === previous) : -1;
  const state: ComparePanelState = {base, candidates, ...(suggested >= 0 ? {suggested} : {}), cursor: Math.max(0, suggested), ignoreWhitespace: false, sideBySide: true, scroll: 0};
  if (partner) choose(state, partner);
  return state;
}

function choose(state: ComparePanelState, other: CompletedCommand): void {
  state.comparison = compareRecords(state.base, other, {ignoreWhitespace: state.ignoreWhitespace, context: 3});
  state.scroll = 0;
}

export type ComparePanelAction = {kind: 'close'} | {kind: 'copy'; what: 'diff' | 'report'; comparison: Comparison};

/** Rows of the diff view, in order, with where each change starts (for n / N). */
interface ViewRow { text: string; change: boolean }

export function comparePanelKey(state: ComparePanelState, key: Key, columns: number, height: number): ComparePanelAction | undefined {
  if (!state.comparison) {
    const count = state.candidates.length;
    if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value === 'q')) return {kind: 'close'};
    if (!count) return undefined;
    if (key.kind === 'up' || key.kind === 'down') state.cursor = (state.cursor + (key.kind === 'up' ? -1 : 1) + count) % count;
    else if (key.kind === 'enter') choose(state, state.candidates[state.cursor]!.record);
    return undefined;
  }
  const comparison = state.comparison;
  const rows = viewRows(state, columns);
  const room = Math.max(1, height - headerRows(state).length - 3);
  const changes = rows.map((row, index) => row.change && !rows[index - 1]?.change ? index : -1).filter(index => index >= 0);
  if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value === 'q')) {
    // Esc goes back to choosing the other side; a second Esc closes.
    state.comparison = undefined;
    return undefined;
  }
  if (key.kind === 'up' || key.kind === 'down') state.scroll += key.kind === 'up' ? -1 : 1;
  else if (key.kind === 'pageUp' || key.kind === 'pageDown') state.scroll += (key.kind === 'pageUp' ? -1 : 1) * Math.max(1, room - 1);
  else if (key.kind === 'text' && key.value === 'n') state.scroll = changes.find(index => index > state.scroll) ?? state.scroll;
  else if (key.kind === 'text' && key.value === 'N') state.scroll = [...changes].reverse().find(index => index < state.scroll) ?? state.scroll;
  else if (key.kind === 'text' && key.value === 'w') { state.ignoreWhitespace = !state.ignoreWhitespace; choose(state, comparison.a === state.base ? comparison.b : comparison.a); }
  else if (key.kind === 'text' && key.value === 's') state.sideBySide = !state.sideBySide;
  else if (key.kind === 'text' && key.value === 'c') return {kind: 'copy', what: 'diff', comparison};
  else if (key.kind === 'text' && key.value === 'r') return {kind: 'copy', what: 'report', comparison};
  state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, rows.length - room)));
  return undefined;
}

/** Side by side needs room for two readable columns. */
export const SIDE_BY_SIDE_COLUMNS = 140;

function viewRows(state: ComparePanelState, columns: number): ViewRow[] {
  const comparison = state.comparison!;
  const width = Math.max(10, columns - 4);
  const added = foreground(UI_COLORS.success);
  const removed = foreground(UI_COLORS.failure);
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const reset = '\u001b[0m';
  const rows: ViewRow[] = [];
  if (comparison.identical) return [{text: `${secondary}No differences.${reset}`, change: false}];
  const sideBySide = state.sideBySide && columns >= SIDE_BY_SIDE_COLUMNS;
  const half = Math.floor((width - 3) / 2);
  const cell = (line: DiffLine | undefined, side: 'a' | 'b') => {
    if (!line) return ' '.repeat(half);
    const number = side === 'a' ? (line.kind !== 'add' ? line.a + 1 : undefined) : (line.kind !== 'remove' ? line.b + 1 : undefined);
    const color = line.kind === 'same' ? secondary : line.kind === 'add' ? added : removed;
    const text = `${String(number ?? '').padStart(5)} ${truncateText(displaySafe(line.text), Math.max(1, half - 6))}`;
    return `${color}${padCells(text, half)}${reset}`;
  };
  comparison.hunks.forEach((hunk, index) => {
    const label = `@@ A ${hunk.aStart + 1}–${hunk.aStart + hunk.aCount} · B ${hunk.bStart + 1}–${hunk.bStart + hunk.bCount}`;
    if (index > 0) rows.push({text: `${subtle}⋯${reset}`, change: false});
    rows.push({text: `${subtle}${truncateText(label, width)}${reset}`, change: false});
    if (!sideBySide) {
      for (const line of hunk.lines) {
        const mark = line.kind === 'same' ? ' ' : line.kind === 'add' ? '+' : '-';
        const color = line.kind === 'same' ? secondary : line.kind === 'add' ? added : removed;
        rows.push({text: `${color}${mark} ${truncateText(displaySafe(line.text), width - 2)}${reset}`, change: line.kind !== 'same'});
      }
      return;
    }
    // Side by side: a run of removals pairs with the additions that follow it.
    for (let at = 0; at < hunk.lines.length;) {
      const line = hunk.lines[at]!;
      if (line.kind === 'same') { rows.push({text: `${cell(line, 'a')} ${subtle}│${reset} ${cell(line, 'b')}`, change: false}); at += 1; continue; }
      const removes: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (hunk.lines[at]?.kind === 'remove') removes.push(hunk.lines[at++]!);
      while (hunk.lines[at]?.kind === 'add') adds.push(hunk.lines[at++]!);
      for (let pair = 0; pair < Math.max(removes.length, adds.length); pair += 1) {
        rows.push({text: `${cell(removes[pair], 'a')} ${subtle}│${reset} ${cell(adds[pair], 'b')}`, change: true});
      }
    }
  });
  return rows;
}

function headerRows(state: ComparePanelState): string[] {
  const comparison = state.comparison!;
  return ['title', 'a', 'b', 'summary', ...comparisonNotes(comparison).map(() => 'note'), 'gap'];
}

export function renderComparePanel(state: ComparePanelState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const width = Math.max(10, columns - 4);
  const out: string[] = [];
  if (!state.comparison) {
    out.push(`  ${primary}Compare output${reset}  ${subtle}${truncateText(`with ${sideLabel(state.base)}`, Math.max(4, width - 16))}${reset}`, '');
    if (!state.candidates.length) out.push(`  ${secondary}No other completed command to compare with.${reset}`);
    const controls = renderControlRows([['↑↓', 'choose'], ['Enter', 'compare'], ['Esc', 'cancel']], width);
    const room = Math.max(1, height - out.length - controls.length - 1);
    const first = Math.max(0, Math.min(state.cursor - Math.floor(room / 2), state.candidates.length - room));
    state.candidates.slice(first, first + room).forEach(({record, number}, offset) => {
      const index = first + offset;
      const focused = index === state.cursor;
      const note = index === state.suggested ? '  previous run' : '';
      const label = truncateText(displaySafe(sideLabel(record)), Math.max(4, width - 8 - displayWidth(note)));
      out.push(`${focused ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${subtle}${String(number).padStart(3)}${reset}  ${focusForeground(focused)}${label}${reset}${accent}${note}${reset}`);
    });
    out.push('', ...controls.map(row => `  ${row}`));
    return out.map(line => truncateAnsi(line, columns));
  }
  const comparison = state.comparison;
  const sideBySideAvailable = columns >= SIDE_BY_SIDE_COLUMNS;
  out.push(`  ${primary}Compare output${reset}  ${subtle}${truncateText(sideBySideAvailable && state.sideBySide ? 'side by side' : 'unified', width - 16)}${reset}`);
  out.push(`  ${foreground(UI_COLORS.failure)}A${reset} ${secondary}${truncateText(displaySafe(sideLabel(comparison.a)), width - 2)}${reset}`);
  out.push(`  ${foreground(UI_COLORS.success)}B${reset} ${secondary}${truncateText(displaySafe(sideLabel(comparison.b)), width - 2)}${reset}`);
  out.push(`  ${accent}${truncateText(summary(comparison), width)}${reset}${state.note ? `${subtle}  ·  ${truncateText(state.note, Math.max(4, width - displayWidth(summary(comparison)) - 5))}${reset}` : ''}`);
  for (const note of comparisonNotes(comparison)) out.push(`  ${subtle}${truncateText(note, width)}${reset}`);
  out.push('');
  const controls = renderControlRows([['↑↓', 'scroll'], ['n/N', 'next/previous change'], ['w', state.ignoreWhitespace ? 'exact' : 'ignore spaces'],
    ...(sideBySideAvailable ? [['s', state.sideBySide ? 'unified' : 'side by side'] as const] : []), ['c', 'copy diff'], ['r', 'report…'], ['Esc', 'back']], width);
  const rows = viewRows(state, columns);
  const room = Math.max(1, height - out.length - controls.length - 1);
  state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, rows.length - room)));
  for (const row of rows.slice(state.scroll, state.scroll + room)) out.push(`  ${row.text}`);
  out.push('', ...controls.map(row => `  ${row}`));
  return out.map(line => truncateAnsi(line, columns)).slice(0, Math.max(1, height));
}
