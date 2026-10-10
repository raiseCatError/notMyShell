import type {Key} from '../terminal/keys.js';
import type {CompletedCommand} from '../output/OutputBuffer.js';
import {renderControlRows} from './controls.js';
import {focusForeground, foreground, UI_COLORS} from './palette.js';
import {GLYPHS} from './glyphs.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';
import {copyStats} from '../clipboard/clipboard.js';
import {COPY_MAX_RECORDS} from '../clipboard/copySelection.js';
import {displaySafe} from '../input/PasteReview.js';

/**
 * `/copy` as an Interactive Picker: recent completed commands, newest first and numbered as /copy numbers them, to
 * copy one or several. It holds a snapshot of the records taken when it opened (identified by startId, never by
 * screen position), so output that arrives meanwhile cannot change what a row means. Copying happens in the caller,
 * through the same payload builder as /copy N; the picker only decides which records, and whether completion
 * statuses are included.
 */
export interface CopyPickerState {
  /** Newest first, as /copy numbers them (records[0] is /copy 1). */
  records: CompletedCommand[];
  /** Search text (`/` starts typing it); rows whose command or output contain it, ignoring case. */
  query: string;
  searching: boolean;
  /** Position within the visible (filtered) rows. */
  cursor: number;
  /** Chosen records by startId; kept while the search changes. Enter with none chosen copies the highlighted row. */
  chosen: Set<number>;
  /** Starts from the setting (or the --status / --no-status given with /copy); `s` toggles it for this copy. */
  includeStatus: boolean;
  /** The highlighted output's first lines below the list. */
  preview: boolean;
}

export function createCopyPicker(recent: readonly CompletedCommand[], includeStatus: boolean): CopyPickerState {
  return {records: recent.slice(0, COPY_MAX_RECORDS), query: '', searching: false, cursor: 0, chosen: new Set(), includeStatus, preview: true};
}

export type CopyPickerAction = {kind: 'close'} | {kind: 'copy'; records: CompletedCommand[]; includeStatus: boolean}
  /** r: the same selection as a report, through its review. */
  | {kind: 'report'; records: CompletedCommand[]};

/** The rows the search leaves, newest first, each with its /copy number. */
export function copyPickerRows(state: CopyPickerState): Array<{record: CompletedCommand; number: number}> {
  const query = state.query.trim().toLowerCase();
  return state.records.map((record, index) => ({record, number: index + 1}))
    .filter(({record}) => !query || record.command.toLowerCase().includes(query) || record.output.toLowerCase().includes(query));
}

/** The records Enter would copy, oldest first (the order they ran). */
export function copyPickerSelection(state: CopyPickerState): CompletedCommand[] {
  const picked = state.chosen.size ? state.records.filter(record => state.chosen.has(record.startId))
    : copyPickerRows(state).slice(state.cursor, state.cursor + 1).map(row => row.record);
  return [...picked].reverse();
}

export function copyPickerKey(state: CopyPickerState, key: Key): CopyPickerAction | undefined {
  if (state.searching) {
    if (key.kind === 'escape' || key.kind === 'enter') { state.searching = false; return undefined; }
    if (key.kind === 'interrupt') return {kind: 'close'};
    if (key.kind === 'backspace') { state.query = [...state.query].slice(0, -1).join(''); state.cursor = 0; return undefined; }
    if (key.kind === 'text' || key.kind === 'paste') {
      // One line of plain text: control characters never enter the query.
      state.query = (state.query + key.value).replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').slice(0, 120);
      state.cursor = 0;
      return undefined;
    }
    if (key.kind !== 'up' && key.kind !== 'down') return undefined;
  }
  const rows = copyPickerRows(state);
  const count = rows.length;
  state.cursor = Math.max(0, Math.min(state.cursor, count - 1));
  if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value === 'q')) {
    // Esc clears a search first, then closes.
    if (key.kind === 'escape' && state.query) { state.query = ''; state.cursor = 0; return undefined; }
    return {kind: 'close'};
  }
  if (key.kind === 'text' && key.value === '/') { state.searching = true; return undefined; }
  if (key.kind === 'text' && key.value === 's') { state.includeStatus = !state.includeStatus; return undefined; }
  if (key.kind === 'text' && key.value === 'p') { state.preview = !state.preview; return undefined; }
  if (!count) return undefined;
  if (key.kind === 'up' || key.kind === 'down') { state.cursor = (state.cursor + (key.kind === 'up' ? -1 : 1) + count) % count; return undefined; }
  if (key.kind === 'text' && key.value === ' ') {
    const id = rows[state.cursor]!.record.startId;
    if (state.chosen.has(id)) state.chosen.delete(id); else state.chosen.add(id);
    // Moving on after a choice makes selecting a run of outputs one key per row.
    if (state.cursor < count - 1) state.cursor += 1;
    return undefined;
  }
  if (key.kind === 'text' && key.value === 'a') {
    // All the visible rows, or none of them when they are all chosen already.
    const ids = rows.map(row => row.record.startId);
    if (ids.every(id => state.chosen.has(id))) for (const id of ids) state.chosen.delete(id);
    else for (const id of ids) state.chosen.add(id);
    return undefined;
  }
  if (key.kind === 'enter') return {kind: 'copy', records: copyPickerSelection(state), includeStatus: state.includeStatus};
  if (key.kind === 'text' && key.value === 'r') return {kind: 'report', records: copyPickerSelection(state)};
  return undefined;
}

function lineCount(output: string): string {
  const {lines} = copyStats(output);
  return lines === 0 ? 'no output' : `${lines.toLocaleString()} line${lines === 1 ? '' : 's'}`;
}

/** The picker's rows (unframed). The status line says, before Enter, whether completion statuses will be copied. */
export function renderCopyPicker(state: CopyPickerState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const width = Math.max(10, columns - 4);
  const rows = copyPickerRows(state);
  const count = rows.length;
  state.cursor = Math.max(0, Math.min(state.cursor, count - 1));
  const target = state.chosen.size ? `${state.chosen.size} selected` : count ? 'the highlighted output' : 'nothing';
  const out = [`  ${primary}Copy output${reset}  ${subtle}${truncateText(`Enter copies ${target}, oldest first`, Math.max(4, width - 13))}${reset}`];
  out.push(`  ${state.includeStatus ? accent : subtle}${truncateText(`Completion status: ${state.includeStatus ? 'included after each output' : 'not included'} (s)`, width)}${reset}`);
  if (state.searching || state.query) out.push(`  ${state.searching ? accent : subtle}${truncateText(`Search: ${state.query}${state.searching ? '▏' : ''}  ${count} of ${state.records.length}`, width)}${reset}`);
  out.push('');
  if (!state.records.length) out.push(`  ${secondary}No completed command output yet.${reset}`);
  else if (!count) out.push(`  ${secondary}No output matches "${truncateText(state.query, Math.max(4, width - 24))}".${reset}`);
  const controls = renderControlRows(state.searching
    ? [['type', 'search'], ['↑↓', 'move'], ['Enter', 'done'], ['Esc', 'done']]
    : [['↑↓', 'move'], ['Space', 'select'], ['a', 'all'], ['/', 'search'], ['s', 'status'], ['p', 'preview'], ['Enter', 'copy'], ['r', 'report'], ['Esc', 'cancel']], width);
  const focused = rows[state.cursor]?.record;
  const previewLines = state.preview && focused ? focused.output.split('\n').slice(0, 4) : [];
  const previewRoom = previewLines.length && height - out.length - controls.length >= 12 ? previewLines.length + 2 : 0;
  const listRoom = Math.max(1, height - out.length - controls.length - 2 - previewRoom);
  const first = Math.max(0, Math.min(state.cursor - Math.floor(listRoom / 2), count - listRoom));
  rows.slice(first, first + listRoom).forEach(({record, number}, offset) => {
    const isCursor = first + offset === state.cursor;
    const box = state.chosen.has(record.startId) ? '[x]' : '[ ]';
    const outcome = record.exitCode === 0 ? '' : ` · exit ${record.exitCode}`;
    const detail = `${lineCount(record.output)}${outcome}`;
    const label = String(number).padStart(3);
    const commandRoom = Math.max(4, width - displayWidth(label) - displayWidth(detail) - 9);
    const command = truncateText(displaySafe(record.command.split('\n')[0]!) + (record.command.includes('\n') ? ' …' : ''), commandRoom);
    out.push(`${isCursor ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${isCursor ? accent : subtle}${box}${reset} ${subtle}${label}${reset}  ${focusForeground(isCursor)}${command}${reset}  ${subtle}${detail}${reset}`);
  });
  if (previewRoom) {
    out.push('', ...previewLines.map(line => `  ${subtle}│${reset} ${secondary}${truncateText(displaySafe(line), Math.max(4, width - 2))}${reset}`));
    if (focused!.output.split('\n').length > previewLines.length) out.push(`  ${subtle}│ …${reset}`);
  }
  out.push('', ...controls.map(row => `  ${row}`));
  return out.map(line => truncateAnsi(line, columns));
}
