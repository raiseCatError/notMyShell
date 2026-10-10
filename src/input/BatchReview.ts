import type {Key} from '../terminal/keys.js';
import {renderControlRows} from '../ui/controls.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {classifyCommand, KIND_LABELS, primaryKind, type PasteKind} from './pasteGuard.js';
import {displaySafe} from './PasteReview.js';
import {splitBatch, type BatchCommand, type BatchShell} from './pasteBatch.js';
import {padCells, truncateAnsi, truncateText} from '../util/text.js';

/**
 * Batch Review: a pasted sequence split into the commands the shell would run, to look at before any of it is queued.
 * Nothing runs because it was pasted or shown here. Enter queues exactly the commands listed, in the order listed,
 * into this session's own queue (one at a time, in the same shell, pausing on a failure); every other key leaves the
 * paste as text.
 */
export interface BatchEntry extends BatchCommand {
  kinds: PasteKind[];
}

export interface BatchReviewState {
  /** The paste exactly as it arrived. */
  source: string;
  entries: BatchEntry[];
  cursor: number;
  /** First visible list row. */
  top: number;
  /** Free places in the session's queue. */
  capacity: number;
}

export type BatchReviewAction = {kind: 'queue'} | {kind: 'text'} | {kind: 'edit'} | {kind: 'back'} | {kind: 'cancel'};

/** The paste as separate commands, when the shell grammar says it safely can be (two or more); undefined means "keep it as one block". */
export function createBatchReview(source: string, shell: BatchShell, capacity: number): BatchReviewState | undefined {
  const result = splitBatch(source, shell);
  if (!result.ok || result.commands.length < 2) return undefined;
  return {source, entries: result.commands.map(command => ({...command, kinds: classifyCommand(command.text.split('\n')[0]!.trim(), false)})), cursor: 0, top: 0, capacity};
}

/** Why a paste is not offered as a batch (for the review's own note), or undefined when it is. */
export function batchRefusal(source: string, shell: BatchShell): string | undefined {
  const result = splitBatch(source, shell);
  if (!result.ok) return result.reason;
  return result.commands.length < 2 ? 'It is a single command.' : undefined;
}

export function batchReviewKey(state: BatchReviewState, key: Key, height: number): BatchReviewAction | undefined {
  const rows = listRows(height);
  const last = state.entries.length - 1;
  const select = (to: number) => { state.cursor = Math.max(0, Math.min(last, to)); };
  const move = (by: number) => {
    const to = state.cursor + by;
    if (to < 0 || to > last) return;
    const [entry] = state.entries.splice(state.cursor, 1);
    state.entries.splice(to, 0, entry!);
    state.cursor = to;
  };
  if (key.kind === 'enter') return state.entries.length && state.entries.length <= state.capacity ? {kind: 'queue'} : undefined;
  if (key.kind === 'escape') return {kind: 'back'};
  if (key.kind === 'interrupt') return {kind: 'cancel'};
  if (key.kind === 'up' || key.kind === 'wheelUp') select(state.cursor - 1);
  else if (key.kind === 'down' || key.kind === 'wheelDown') select(state.cursor + 1);
  else if (key.kind === 'pageUp') select(state.cursor - rows);
  else if (key.kind === 'pageDown') select(state.cursor + rows);
  else if (key.kind === 'delete' || key.kind === 'backspace') remove(state);
  else if (key.kind === 'text') {
    const value = key.value.toLowerCase();
    if (value === 'x') remove(state);
    else if (value === 'k') move(-1);
    else if (value === 'j') move(1);
    else if (value === 't') return {kind: 'text'};
    else if (value === 'e' && state.entries.length) return {kind: 'edit'};
    else if (value === 'q' && state.entries.length && state.entries.length <= state.capacity) return {kind: 'queue'};
  }
  state.top = Math.max(0, Math.min(state.top, Math.max(0, state.entries.length - rows)));
  if (state.cursor < state.top) state.top = state.cursor;
  else if (state.cursor >= state.top + rows) state.top = state.cursor - rows + 1;
  return undefined;
}

function remove(state: BatchReviewState): void {
  if (!state.entries.length) return;
  state.entries.splice(state.cursor, 1);
  state.cursor = Math.max(0, Math.min(state.cursor, state.entries.length - 1));
}

/** The commands as they will be queued (the reviewed list, one entry per command). */
export function batchTexts(state: BatchReviewState): string[] {
  return state.entries.map(entry => entry.text);
}

const PREVIEW_ROWS = 4;
const listRows = (height: number) => Math.max(1, Math.min(10, height - PREVIEW_ROWS - 7));
const RISKY: ReadonlySet<PasteKind> = new Set(['destructive', 'privilege', 'pipeline']);

/** At most `height` rows: header, the list (scrolling), the selected command in full, the notes and the controls. */
export function renderBatchReview(state: BatchReviewState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const accent = foreground(UI_COLORS.accent);
  const failure = foreground(UI_COLORS.failure);
  const reset = '\u001B[0m';
  const count = state.entries.length;
  const width = Math.max(10, columns - 4);
  const out: string[] = [`  ${primary}Review commands${reset}  ${subtle}${count} command${count === 1 ? '' : 's'}, in this order${reset}`, ''];
  const rows = listRows(height);
  const numberWidth = String(count).length;
  const labelWidth = columns >= 76 ? 22 : 0;
  if (!count) out.push(`  ${secondary}Nothing left to queue. Esc goes back to the paste.${reset}`);
  for (let index = state.top; index < Math.min(count, state.top + rows); index += 1) {
    const entry = state.entries[index]!;
    const focused = index === state.cursor;
    const kind = primaryKind(entry.kinds);
    const color = RISKY.has(kind) ? failure : kind === 'install' || kind === 'modifies' ? accent : subtle;
    const label = labelWidth ? `${color}${padCells(truncateText(KIND_LABELS[kind], labelWidth - 1), labelWidth)}${reset}` : RISKY.has(kind) ? `${failure}! ${reset}` : '';
    const lines = entry.text.split('\n');
    const first = displaySafe(lines[0]!) + (lines.length > 1 ? `  ⏎ +${lines.length - 1}` : '');
    out.push(truncateAnsi(`${focused ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${subtle}${String(index + 1).padStart(numberWidth)}${reset}  ${label}${focusForeground(focused)}${truncateText(first, Math.max(8, width - numberWidth - labelWidth - 4))}${reset}`, columns));
  }
  if (count > rows) out.push(`  ${subtle}${state.top + 1}–${Math.min(count, state.top + rows)} of ${count}${reset}`);
  const selected = state.entries[state.cursor];
  if (selected) {
    out.push('', `  ${subtle}Command ${state.cursor + 1} exactly as it will be queued:${reset}`);
    const lines = selected.text.split('\n');
    for (const line of lines.slice(0, PREVIEW_ROWS)) out.push(truncateAnsi(`    ${secondary}${displaySafe(line)}${reset}`, columns));
    if (lines.length > PREVIEW_ROWS) out.push(`    ${subtle}… ${lines.length - PREVIEW_ROWS} more line${lines.length - PREVIEW_ROWS === 1 ? '' : 's'}${reset}`);
  }
  out.push('');
  if (count > state.capacity) out.push(`  ${failure}${truncateText(`The queue has room for ${state.capacity} more; remove ${count - state.capacity} to queue these.`, width)}${reset}`);
  else out.push(`  ${subtle}${truncateText('Nothing runs until you press Enter. Then the shell runs them one at a time, and the queue stops if one fails.', width)}${reset}`);
  out.push(...renderControlRows([['↑↓', 'select'], ['x', 'remove'], ['k j', 'move'], ['Enter', `queue ${count}`], ['e', 'edit as text'], ['t', 'original text'], ['Esc', 'back']], columns).map(row => `  ${row}`));
  const fixed = Math.max(4, height);
  return (out.length > fixed ? [...out.slice(0, fixed - 1), out[out.length - 1]!] : out).map(row => truncateAnsi(row, columns));
}

