import type {Key} from '../terminal/keys.js';
import {graphemes} from '../input/inputLayout.js';
import {colorLevel} from '../presentation/capabilities.js';
import {renderActionRow, type ActionControl} from '../ui/actionControls.js';
import {renderControlRows} from '../ui/controls.js';
import {editText} from '../ui/formControls.js';
import {framePanel} from '../ui/PanelShell.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';
import {formatForPath, inert} from './document.js';
import {alignColumn, deleteColumn, deleteRow, findTable, insertColumn, insertRow, tableStatus, tableTab} from './markdownTable.js';
import {continueList, insertLink, renumberList, shiftListItems, toggleTask, wrapSelection, type EditResult, type WrapKind} from './markdownEdit.js';
import type {EditableFile, SaveConflict} from './fileEdit.js';
import {displayColumn, TAB_WIDTH, TextBuffer, type Position} from './textBuffer.js';
import {describeDifference, type DraftOffer} from './draftRecovery.js';

/**
 * The native editor (#402): one small text file in a full-height panel. It owns keys only while open; the composer,
 * its draft and the shell are untouched. Saving and reloading are the app's work (they touch the disk); the panel says
 * what the person asked for and shows the result. Unsaved changes are never dropped without a choice.
 */

const RESET = '\u001b[0m';
const REVERSE = '\u001b[7m';
const WHEEL_ROWS = 3;

export interface EditorDialog {
  kind: 'unsaved' | 'conflict' | 'recover' | 'markdown';
  /** The Markdown menu opened with the caret in a table: the table actions come first. */
  table?: boolean;
  /** A recovered draft this dialog offers (#469), the file's lines when it was offered, and what Compare found. */
  offer?: DraftOffer;
  disk?: string[];
  detail?: string;
  focus: number;
  conflict?: SaveConflict;
  reason?: string;
  /** Close once the save this dialog leads to succeeds. */
  thenClose?: boolean;
}

export interface EditorState {
  file: EditableFile;
  buffer: TextBuffer;
  top: number;
  left: number;
  input?: {kind: 'find'; value: string};
  query?: string;
  dialog?: EditorDialog;
  note?: {text: string; tone: 'info' | 'error' | 'success'};
  /** A save or reload is in progress; keys wait. */
  busy?: boolean;
}

export type EditorAction =
  | {kind: 'close'}
  | {kind: 'save'; force?: boolean; thenClose?: boolean}
  | {kind: 'reload'}
  | {kind: 'copy'; text: string}
  /** The draft was restored into the buffer, discarded for good, or kept for later (#469); the app updates the store. */
  | {kind: 'draft'; target: DraftOffer}
  | {kind: 'draft-discard'; target: DraftOffer}
  | {kind: 'draft-keep'; target: DraftOffer};

export function createEditor(file: EditableFile): EditorState {
  return {file, buffer: new TextBuffer(file.lines), top: 0, left: 0, ...(file.identity ? {} : {note: {text: 'New file: it is created when you save.', tone: 'info' as const}})};
}

/** Offer a draft recovered after a crash; nothing changes until the person chooses. */
export function offerDraft(state: EditorState, offer: DraftOffer): void {
  state.dialog = {kind: 'recover', focus: 0, offer, disk: [...state.buffer.lines]};
}

/** The Markdown actions menu (F1 in a Markdown file): each is a source-preserving helper and one undo step. */
const TABLE_ACTIONS = [
  {id: 'Action.RowAdd', label: 'Row+', key: 'r'}, {id: 'Action.RowDelete', label: 'Row−', key: 'd'},
  {id: 'Action.ColumnAdd', label: 'Col+', key: 'o'}, {id: 'Action.ColumnDelete', label: 'Col−', key: 'x'}, {id: 'Action.Align', label: 'Align', key: 'a'},
] as const;

const MARKDOWN_ACTIONS = [
  {id: 'Action.Task', label: 'Task', key: 't'}, {id: 'Action.Renumber', label: 'Renumber', key: 'n'},
  {id: 'Action.Link', label: 'Link', key: 'l'}, {id: 'Action.Image', label: 'Image', key: 'p'},
  {id: 'Action.Bold', label: 'Bold', key: 'b'}, {id: 'Action.Italic', label: 'Italic', key: 'i'},
  {id: 'Action.Code', label: 'Code', key: 'c'}, {id: 'Action.Strike', label: 'Strike', key: 's'},
] as const;

export const isMarkdownFile = (state: EditorState) => formatForPath(state.file.path).format === 'markdown';

function runMarkdownAction(state: EditorState, id: string): EditResult {
  const buffer = state.buffer;
  switch (id) {
    case 'Action.RowAdd': return insertRow(buffer);
    case 'Action.RowDelete': return deleteRow(buffer);
    case 'Action.ColumnAdd': return insertColumn(buffer);
    case 'Action.ColumnDelete': return deleteColumn(buffer);
    case 'Action.Align': return alignColumn(buffer);
    case 'Action.Task': return toggleTask(buffer);
    case 'Action.Renumber': return renumberList(buffer);
    case 'Action.Link': return insertLink(buffer, false);
    case 'Action.Image': return insertLink(buffer, true);
    default: return wrapSelection(buffer, ({'Action.Bold': 'bold', 'Action.Italic': 'italic', 'Action.Code': 'code', 'Action.Strike': 'strike'} as Record<string, WrapKind>)[id]!);
  }
}

function dialogControls(dialog: EditorDialog): ActionControl[] {
  const focused = (index: number, destructive = false) => dialog.focus === index ? (destructive ? 'destructiveFocused' : 'focused') : destructive ? 'destructive' : 'default';
  if (dialog.kind === 'markdown') return [...(dialog.table ? TABLE_ACTIONS : []), ...MARKDOWN_ACTIONS].map((action, index) => ({id: action.id, label: action.label, state: focused(index), key: action.key, essential: true}));
  if (dialog.kind === 'recover') return [
    {id: 'Action.Restore', label: 'Restore draft', state: focused(0), key: 'r', essential: true},
    {id: 'Action.Compare', label: 'Compare with file', state: focused(1), key: 'c', essential: true},
    {id: 'Action.Discard', label: 'Discard draft', state: focused(2, true), key: 'd', essential: true},
    {id: 'Action.Keep', label: 'Keep for later', state: focused(3), key: 'Esc', essential: true},
  ];
  if (dialog.kind === 'unsaved') return [
    {id: 'Action.Save', label: 'Save', state: focused(0), key: 's', essential: true},
    {id: 'Action.Discard', label: 'Discard changes', state: focused(1, true), key: 'd', essential: true},
    {id: 'Action.Keep', label: 'Keep editing', state: focused(2), key: 'Esc', essential: true},
  ];
  return [
    {id: 'Action.Keep', label: 'Keep editing', state: focused(0), key: 'Esc', essential: true},
    {id: 'Action.Overwrite', label: dialog.conflict === 'deleted' ? 'Save anyway' : 'Overwrite', state: focused(1, true), key: 'o', essential: true},
    ...(dialog.conflict === 'deleted' || dialog.conflict === 'exists' ? [] : [{id: 'Action.Reload', label: 'Reload, discard mine', state: focused(2, true), key: 'r', essential: true} as ActionControl]),
  ];
}

function recoverChoice(state: EditorState, dialog: EditorDialog, offer: DraftOffer, chosen: string): EditorAction | undefined {
  if (chosen === 'Action.Compare') { dialog.detail = describeDifference(dialog.disk ?? state.buffer.lines, offer.draft.lines); return undefined; }
  state.dialog = undefined;
  if (chosen === 'Action.Keep') return {kind: 'draft-keep', target: offer};
  if (chosen === 'Action.Discard') return {kind: 'draft-discard', target: offer};
  const buffer = state.buffer;
  buffer.replaceAll(offer.draft.lines);
  const clamp = (at: Position): Position => {
    const line = Math.min(at.line, buffer.lines.length - 1);
    return {line, column: Math.min(at.column, buffer.lines[line]!.length)};
  };
  buffer.caret = clamp(offer.draft.caret);
  buffer.anchor = offer.draft.anchor ? clamp(offer.draft.anchor) : undefined;
  state.top = Math.min(offer.draft.top, buffer.lines.length - 1);
  state.note = {text: 'Restored the recovered draft. It is not saved; the file is unchanged.', tone: 'info'};
  return {kind: 'draft', target: offer};
}

function dialogKey(state: EditorState, dialog: EditorDialog, key: Key): EditorAction | undefined {
  const controls = dialogControls(dialog);
  const text = key.kind === 'text' ? key.value.toLowerCase() : undefined;
  if (key.kind === 'left' || key.kind === 'focusPrevious') { dialog.focus = (dialog.focus + controls.length - 1) % controls.length; return undefined; }
  if (key.kind === 'right' || key.kind === 'complete') { dialog.focus = (dialog.focus + 1) % controls.length; return undefined; }
  const chosen = key.kind === 'enter' ? controls[dialog.focus]!.id
    : key.kind === 'escape' || key.kind === 'interrupt' ? 'Action.Keep'
    : controls.find(control => control.key && control.key.length === 1 && control.key === text)?.id;
  if (!chosen) return undefined;
  if (dialog.kind === 'markdown') {
    state.dialog = undefined;
    if (chosen === 'Action.Keep') return undefined;
    const result = runMarkdownAction(state, chosen);
    if (result.note) state.note = {text: result.note, tone: 'info'};
    return undefined;
  }
  if (dialog.kind === 'recover' && dialog.offer) return recoverChoice(state, dialog, dialog.offer, chosen);
  state.dialog = undefined;
  if (chosen === 'Action.Keep') return undefined;
  if (chosen === 'Action.Save') return {kind: 'save', thenClose: true};
  if (chosen === 'Action.Discard') return {kind: 'close'};
  if (chosen === 'Action.Overwrite') return {kind: 'save', force: true, ...(dialog.thenClose ? {thenClose: true} : {})};
  return {kind: 'reload'};
}

/** The rows the text area has (the frame, header, status and footer take the rest). */
function textRows(state: EditorState, columns: number, height: number): number {
  return Math.max(1, height - 2 - 1 - 1 - footerRows(state, columns).length);
}

function gutter(state: EditorState): number {
  return Math.max(3, String(state.buffer.lines.length).length) + 1;
}

function textWidth(state: EditorState, columns: number): number {
  return Math.max(4, columns - 4 - gutter(state));
}

/** Keep the caret on screen, with a little room around it. */
function reveal(state: EditorState, columns: number, height: number): void {
  const rows = textRows(state, columns, height);
  const width = textWidth(state, columns);
  const caret = state.buffer.caret;
  if (caret.line < state.top) state.top = caret.line;
  else if (caret.line >= state.top + rows) state.top = caret.line - rows + 1;
  const column = displayColumn(state.buffer.lines[caret.line]!, caret.column);
  const margin = Math.min(8, Math.floor(width / 4));
  if (column < state.left) state.left = Math.max(0, column - margin);
  else if (column >= state.left + width) state.left = column - width + 1 + margin;
}

export function editorKey(state: EditorState, key: Key, columns: number, height: number): EditorAction | undefined {
  if (state.busy) return undefined;
  if (state.dialog) return dialogKey(state, state.dialog, key);
  const buffer = state.buffer;
  if (state.input) {
    const input = state.input;
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.input = undefined; return undefined; }
    if (key.kind === 'enter') {
      state.input = undefined;
      state.query = input.value;
      const found = buffer.find(input.value);
      state.note = !input.value ? undefined : found ? (found.wrapped ? {text: 'Search wrapped to the top.', tone: 'info'} : undefined) : {text: `No match for “${input.value}”.`, tone: 'info'};
      reveal(state, columns, height);
      return undefined;
    }
    const next = editText(input.value, key);
    if (next !== undefined) input.value = next.slice(0, 200);
    return undefined;
  }
  state.note = undefined;
  const rows = textRows(state, columns, height);
  switch (key.kind) {
    case 'escape':
      if (buffer.dirty) { state.dialog = {kind: 'unsaved', focus: 0}; return undefined; }
      return {kind: 'close'};
    case 'sendToProgram': return {kind: 'save'};
    case 'suspend': if (!buffer.undo()) state.note = {text: 'Nothing to undo.', tone: 'info'}; break;
    case 'redo': if (!buffer.redo()) state.note = {text: 'Nothing to redo.', tone: 'info'}; break;
    case 'find': state.input = {kind: 'find', value: state.query ?? ''}; return undefined;
    case 'interrupt': {
      const selected = buffer.selectedText();
      if (selected) return {kind: 'copy', text: selected};
      state.note = {text: 'Esc closes · Ctrl+S saves · select text to copy it.', tone: 'info'};
      return undefined;
    }
    case 'historyDelete': {
      const selected = buffer.selectedText();
      if (!selected) { state.note = {text: 'Select text to cut it.', tone: 'info'}; return undefined; }
      buffer.insert('');
      reveal(state, columns, height);
      return {kind: 'copy', text: selected};
    }
    case 'text': buffer.insert(key.value); break;
    case 'paste': buffer.insert(key.value); break;
    case 'enter': if (isMarkdownFile(state) && continueList(buffer)) break; buffer.insert('\n'); break;
    case 'newline': buffer.insert('\n'); break;
    case 'complete': {
      if (isMarkdownFile(state) && shiftListItems(buffer, false)) break;
      const moved = isMarkdownFile(state) ? tableTab(buffer, false) : {handled: false};
      if (moved.handled) { if (moved.note) state.note = {text: moved.note, tone: 'info'}; break; }
      buffer.insert('\t'); break;
    }
    case 'focusPrevious': {
      if (!isMarkdownFile(state)) return undefined;
      if (shiftListItems(buffer, true)) break;
      const moved = tableTab(buffer, true);
      if (!moved.handled) return undefined;
      if (moved.note) state.note = {text: moved.note, tone: 'info'};
      break;
    }
    case 'palette': if (!isMarkdownFile(state)) return undefined; state.dialog = {kind: 'markdown', focus: 0, ...(findTable(buffer.lines, buffer.caret.line) ? {table: true} : {})}; return undefined;
    case 'backspace': buffer.backspace(); break;
    case 'delete': buffer.delete(); break;
    case 'deleteWord': buffer.deleteWord(); break;
    case 'deleteLineBefore': buffer.deleteLineBefore(); break;
    case 'deleteLineAfter': buffer.deleteLineAfter(); break;
    case 'left': buffer.left(); break;
    case 'right': buffer.right(); break;
    case 'up': buffer.vertical(-1); break;
    case 'down': buffer.vertical(1); break;
    case 'selectLeft': buffer.left(true); break;
    case 'selectRight': buffer.right(true); break;
    case 'selectUp': buffer.vertical(-1, true); break;
    case 'selectDown': buffer.vertical(1, true); break;
    case 'wordLeft': buffer.wordLeft(); break;
    case 'wordRight': buffer.wordRight(); break;
    case 'selectWordLeft': buffer.wordLeft(true); break;
    case 'selectWordRight': buffer.wordRight(true); break;
    case 'lineHome': buffer.home(); break;
    case 'lineEnd': buffer.end(); break;
    case 'selectLineHome': buffer.home(true); break;
    case 'selectLineEnd': buffer.end(true); break;
    case 'bufferHome': buffer.bufferHome(); break;
    case 'bufferEnd': case 'latest': buffer.bufferEnd(); break;
    case 'selectBufferHome': buffer.bufferHome(true); break;
    case 'selectBufferEnd': buffer.bufferEnd(true); break;
    case 'selectAll': buffer.selectAll(); break;
    case 'pageUp': buffer.vertical(-Math.max(1, rows - 1)); break;
    case 'pageDown': buffer.vertical(Math.max(1, rows - 1)); break;
    case 'wheelUp': state.top = Math.max(0, state.top - WHEEL_ROWS); return undefined;
    case 'wheelDown': state.top = Math.max(0, Math.min(buffer.lines.length - rows, state.top + WHEEL_ROWS)); return undefined;
    default: return undefined;
  }
  reveal(state, columns, height);
  return undefined;
}

// ---- Drawing ------------------------------------------------------------------------------------------------------

interface Cell {text: string; width: number; offset: number}

/** A line's drawn cells from display column 0: tabs as spaces, unsafe characters as marks, each with its offset. */
function lineCells(line: string, limit: number): Cell[] {
  const cells: Cell[] = [];
  let column = 0;
  let offset = 0;
  for (const character of graphemes(line)) {
    if (column >= limit) break;
    if (character === '\t') {
      const spaces = TAB_WIDTH - (column % TAB_WIDTH);
      for (let index = 0; index < spaces; index += 1) cells.push({text: ' ', width: 1, offset});
      column += spaces;
    } else {
      const shown = inert(character);
      const width = displayWidth(shown);
      cells.push({text: shown, width, offset});
      column += width;
    }
    offset += character.length;
  }
  return cells;
}

const inside = (position: Position, start: Position, end: Position) =>
  (position.line > start.line || (position.line === start.line && position.column >= start.column)) && (position.line < end.line || (position.line === end.line && position.column < end.column));

function drawLine(state: EditorState, index: number, width: number): string {
  const line = state.buffer.lines[index]!;
  const selection = state.buffer.selection;
  const caret = state.buffer.caret;
  const cells = lineCells(line, state.left + width);
  let out = '';
  let used = 0;
  let skipped = 0;
  let caretDrawn = caret.line !== index;
  for (const cell of cells) {
    if (skipped < state.left) { skipped += cell.width; continue; }
    if (used + cell.width > width) break;
    const position = {line: index, column: cell.offset};
    const atCaret = !caretDrawn && cell.offset === caret.column;
    const selected = selection && inside(position, selection.start, selection.end);
    out += atCaret || selected ? `${REVERSE}${cell.text}${RESET}` : cell.text;
    if (atCaret) caretDrawn = true;
    used += cell.width;
  }
  // The caret at the end of the line (or of the visible part) is a reverse-video space.
  if (!caretDrawn && used < width) out += `${REVERSE} ${RESET}`;
  return out;
}

/** A draft made from a different version of the file than the one now on disk: said first, before anything is restored. */
function draftIsStale(state: EditorState, offer: DraftOffer): boolean {
  return (offer.draft.baseHash ?? null) !== (state.file.identity?.hash ?? null);
}

function recoverMessage(state: EditorState, dialog: EditorDialog): string {
  const draft = dialog.offer!.draft;
  const when = new Date(draft.savedAt).toLocaleString();
  return `Recovered draft of ${state.file.title} (${draft.lines.length.toLocaleString('en-US')} lines, ${when}).`;
}

function footerRows(state: EditorState, columns: number): string[] {
  const width = Math.max(1, columns - 4);
  if (state.dialog) {
    const dialog = state.dialog;
    const message = dialog.kind === 'markdown' ? `Markdown · ${dialog.table ? 'r row+ · d row− · o col+ · x col− · a align · ' : ''}t task · n renumber · l link · p image · b bold · i italic · c code · s strike` : dialog.kind === 'unsaved' ? `${state.file.title} has unsaved changes.` : dialog.kind === 'recover' ? recoverMessage(state, dialog)
      : dialog.reason ?? `${state.file.title} changed on disk.`;
    const accent = foreground(UI_COLORS.warning);
    const actions = renderActionRow(dialogControls(dialog), {columns: width, keys: true, color: colorLevel() !== 'none'}).rows;
    const stale = dialog.kind === 'recover' && dialog.offer && draftIsStale(state, dialog.offer) ? 'The file changed on disk since this draft was saved. ' : '';
    const detail = dialog.detail || stale ? [`${foreground(UI_COLORS.subtle)}${truncateText(inert(`${stale}${dialog.detail ?? ''}`.trim()), width)}${RESET}`] : [];
    return [`${accent}${truncateText(message, width)}${RESET}`, ...detail, ...actions];
  }
  if (state.input) return renderControlRows([['Enter', 'find'], ['Esc', 'cancel']], width);
  return renderControlRows([['Ctrl+S', 'save'], ['Esc', 'close'], ['Ctrl+Z', 'undo'], ['Ctrl+Y', 'redo'], ['Ctrl+F', 'find'], ['Ctrl+C', 'copy'], ['Ctrl+X', 'cut'],
    ...(isMarkdownFile(state) ? [['F1', 'Markdown']] as Array<[string, string]> : [])], width);
}

export function renderEditor(state: EditorState, columns: number, height: number): string[] {
  const width = textWidth(state, columns);
  const rows = textRows(state, columns, height);
  state.top = Math.max(0, Math.min(state.top, Math.max(0, state.buffer.lines.length - 1)));
  const primary = foreground(UI_COLORS.primary);
  const subtle = foreground(UI_COLORS.subtle);
  const warning = foreground(UI_COLORS.warning);
  const dirty = state.buffer.dirty;
  const detail = [`${state.buffer.lines.length.toLocaleString('en-US')} lines`, state.file.lineEnding === 'crlf' ? 'CRLF' : '', state.file.bom ? 'BOM' : '', state.file.identity ? '' : 'new file'].filter(Boolean).join(' · ');
  const title = truncateText(state.file.title, Math.max(8, Math.floor((columns - 4) * 0.6)));
  const out = [`  ${primary}${title}${RESET}${dirty ? `${warning} ● edited${RESET}` : ''}  ${subtle}${truncateText(detail, Math.max(1, columns - 8 - displayWidth(title) - (dirty ? 9 : 0)))}${RESET}`];
  const number = gutter(state);
  for (let offset = 0; offset < rows; offset += 1) {
    const index = state.top + offset;
    if (index >= state.buffer.lines.length) { out.push(`  ${subtle}${'~'.padStart(number - 1)}${RESET}`); continue; }
    out.push(`  ${subtle}${String(index + 1).padStart(number - 1)}${RESET} ${drawLine(state, index, width)}`);
  }
  const caret = state.buffer.caret;
  const position = `Ln ${caret.line + 1}, Col ${displayColumn(state.buffer.lines[caret.line]!, caret.column) + 1}`;
  const selected = state.buffer.selection ? ` · ${state.buffer.selectedText().length.toLocaleString('en-US')} selected` : '';
  const table = isMarkdownFile(state) ? tableStatus(state.buffer.lines, caret) : undefined;
  const status = state.input
    ? `${foreground(UI_COLORS.accent)}Find: ${RESET}${truncateText(inert(state.input.value), Math.max(1, columns - 12))}${foreground(UI_COLORS.accent)}▏${RESET}`
    : `${subtle}${truncateText(`${position}${selected}${table ? ` · ${table}` : ''}${state.busy ? ' · saving…' : ''}`, Math.max(1, columns - 4))}${RESET}${state.note ? `  ${state.note.tone === 'error' ? foreground(UI_COLORS.failure) : state.note.tone === 'success' ? foreground(UI_COLORS.success) : subtle}${truncateText(inert(state.note.text), Math.max(1, columns - 8 - displayWidth(position + selected)))}${RESET}` : ''}`;
  out.push(`  ${status}`, ...footerRows(state, columns).map(row => `  ${row}`));
  const rule = framePanel([], columns)[0]!;
  if (height <= 1) return [rule].slice(0, Math.max(0, height));
  return [...framePanel(out.slice(0, Math.max(0, height - 2)).map(row => truncateAnsi(row, columns)), columns), rule];
}
