import type {CompletedCommand} from '../output/OutputBuffer.js';
import type {PaletteItem} from './CommandPalette.js';
import type {WrappedRow} from '../output/viewport.js';
import {displayWidth} from '../util/text.js';

export type BlockActionId = 'copyCommand' | 'copyOutput' | 'copyBoth' | 'rerun' | 'edit' | 'fold' | 'explain';
/** One registry for both pointer-opened and keyboard-opened block palettes. */
export const BLOCK_ACTIONS: readonly {id: BlockActionId; label: string; detail: string}[] = [
  {id: 'copyCommand', label: 'Copy command', detail: 'Stored plain command'},
  {id: 'copyOutput', label: 'Copy output', detail: 'Full stored output, including folded lines'},
  {id: 'copyBoth', label: 'Copy command + output', detail: 'Stored plain command and full output'},
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

export function blockCopyPayload(record: CompletedCommand, action: BlockActionId): string | undefined {
  if (action === 'copyCommand') return record.command;
  if (action === 'copyOutput') return record.output;
  if (action === 'copyBoth') return [record.command, record.output].filter(Boolean).join('\n');
  return undefined;
}

/** Decorate only an owning visible row, never cover any command or output cell. */
export function blockAffordance(row: WrappedRow, columns: number): {suffix: string; column: number} | undefined {
  if (row.blockStartId === undefined || row.isHistoricalHeader || row.isLiveActivity) return undefined;
  const label = '[Actions]';
  const used = displayWidth(row.plain);
  if (columns - used < label.length + 2) return undefined;
  return {suffix: ' '.repeat(columns - used - label.length) + label, column: columns - label.length + 1};
}
