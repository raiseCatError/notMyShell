import type {CompletedCommand} from '../output/OutputBuffer.js';
import type {PaletteItem} from './CommandPalette.js';
import type {WrappedRow} from '../output/viewport.js';
import {displayWidth} from '../util/text.js';
import {recordCopyText} from '../clipboard/copySelection.js';

export type BlockActionId = 'copyCommand' | 'copyOutput' | 'copyBoth' | 'copyReport' | 'pager' | 'rerun' | 'edit' | 'fold' | 'explain';
/** One registry for both pointer-opened and keyboard-opened block palettes. */
export const BLOCK_ACTIONS: readonly {id: BlockActionId; label: string; detail: string}[] = [
  {id: 'copyCommand', label: 'Copy command', detail: 'Stored plain command'},
  {id: 'copyOutput', label: 'Copy output', detail: 'Full stored output, including folded lines'},
  {id: 'copyBoth', label: 'Copy command + output', detail: 'Stored plain command and full output'},
  {id: 'copyReport', label: 'Copy as report…', detail: 'Command, status, exit code, duration and output as Markdown or plain text; reviewed first'},
  {id: 'pager', label: 'Open in pager', detail: 'Command and full stored output in your pager (less), read-only'},
  {id: 'rerun', label: 'Rerun command', detail: 'Explicitly submit a visible command in the current shell directory'},
  {id: 'edit', label: 'Edit & rerun', detail: 'Put command in composer; Enter executes it'},
  {id: 'fold', label: 'Fold / unfold output', detail: 'Same stored disclosure state as Ctrl+O'},
  {id: 'explain', label: 'Explain failure', detail: "Why it failed, from this block's own output (read-only)"},
];

export function blockPaletteItems(record: CompletedCommand): PaletteItem[] {
  // Explain failure is offered only on failed blocks.
  return BLOCK_ACTIONS.filter(action => action.id !== 'explain' || (record.exitCode ?? 0) !== 0).map(action => ({id: `block:${record.startId}:${action.id}`, label: action.label,
    detail: action.detail, category: 'Transcript', action: {kind: 'block', id: action.id, startId: record.startId}}));
}

/** What a block's Copy action puts on the clipboard. Output follows "Include completion status"; Copy command never does. */
export function blockCopyPayload(record: CompletedCommand, action: BlockActionId, includeStatus = false): string | undefined {
  if (action === 'copyCommand') return record.command;
  if (action === 'copyOutput') return recordCopyText(record, includeStatus);
  if (action === 'copyBoth') return [record.command, recordCopyText(record, includeStatus)].filter(Boolean).join('\n');
  return undefined;
}

const ACTIONS_LABEL = '[Actions]';
/** The Copy slot is as wide as its confirmation, so "Copied" never moves [Actions]. */
const copyLabel = (copied: boolean, safe: boolean) => copied ? `[${safe ? '+' : '✓'} Copied]` : '[Copy]';
const COPY_SLOT = displayWidth(copyLabel(true, false));

export interface BlockControls {
  /** Plain text appended after the row: padding, then the controls. */
  suffix: string;
  /** 1-based column where [Actions] starts. */
  column: number;
  /** 1-based columns of the Copy control, when there is room for it. */
  copy?: {column: number; end: number};
}

/** Where the controls sit in a row of `columns` cells whose own text is `used` cells wide; undefined when they do not fit. */
export function blockControlsLayout(used: number, columns: number, options: {copied?: boolean; safe?: boolean} = {}): BlockControls | undefined {
  if (columns - used < ACTIONS_LABEL.length + 2) return undefined;
  const actionsColumn = columns - ACTIONS_LABEL.length + 1;
  // Copy only where both fit with the same two-cell margin; [Actions] keeps its place either way.
  if (columns - used >= ACTIONS_LABEL.length + 1 + COPY_SLOT + 2) {
    const label = copyLabel(Boolean(options.copied), Boolean(options.safe));
    const slot = ' '.repeat(COPY_SLOT - displayWidth(label)) + label;
    const copyColumn = actionsColumn - 1 - COPY_SLOT + (COPY_SLOT - displayWidth(label));
    return {suffix: ' '.repeat(columns - used - ACTIONS_LABEL.length - 1 - COPY_SLOT) + slot + ' ' + ACTIONS_LABEL, column: actionsColumn,
      copy: {column: copyColumn, end: actionsColumn - 2}};
  }
  return {suffix: ' '.repeat(columns - used - ACTIONS_LABEL.length) + ACTIONS_LABEL, column: actionsColumn};
}

/** Decorate only an owning visible row, never cover any command or output cell. */
export function blockAffordance(row: WrappedRow, columns: number, options: {copied?: boolean; safe?: boolean} = {}): BlockControls | undefined {
  if (row.blockStartId === undefined || row.isHistoricalHeader || row.isLiveActivity) return undefined;
  return blockControlsLayout(displayWidth(row.plain), columns, options);
}

/** The sticky header's controls: the same layout, on a row whose header text is cut to leave room for them. */
export function stickyControlsWidth(columns: number): number {
  const full = ACTIONS_LABEL.length + 1 + COPY_SLOT + 2;
  return columns >= full + 16 ? full : columns >= ACTIONS_LABEL.length + 2 + 16 ? ACTIONS_LABEL.length + 2 : 0;
}
