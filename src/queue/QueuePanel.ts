import type {Key} from '../terminal/keys.js';
import type {QueueOp, QueueState} from '../session/CommandQueue.js';
import {renderControls} from '../ui/controls.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';
import {pauseReason, pausedGlyph, queueGlyph, queuePreview} from '../status/queueStatus.js';
import {displaySafe} from '../input/PasteReview.js';

/**
 * `/queue`: the session's command queue as a keyboard-first list. It holds no queue of its own: every change is a
 * QueueOp sent to the queue's owner, and the list redraws from the owner's next state, so what you see is what will
 * run.
 */
export interface QueuePanelState {
  selected: number;
  /** Waiting for y/n before clearing everything. */
  confirmClear?: boolean;
}

export type QueuePanelAction =
  | {kind: 'close'}
  | {kind: 'change'; change: QueueOp}
  /** Load the entry into the composer for editing in place. */
  | {kind: 'edit'; id: number};

export function queuePanelKey(panel: QueuePanelState, key: Key, queue: QueueState): QueuePanelAction | undefined {
  const entries = queue.entries;
  panel.selected = Math.max(0, Math.min(panel.selected, entries.length - 1));
  if (panel.confirmClear) {
    panel.confirmClear = false;
    if (key.kind === 'text' && key.value.toLowerCase() === 'y') return {kind: 'change', change: {op: 'clear'}};
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value === 'q')) return {kind: 'close'};
  const entry = entries[panel.selected];
  if (key.kind === 'up' || key.kind === 'down') {
    if (entries.length) panel.selected = (panel.selected + (key.kind === 'up' ? -1 : 1) + entries.length) % entries.length;
    return undefined;
  }
  if (key.kind === 'text' && key.value === 'p') return {kind: 'change', change: {op: queue.paused ? 'resume' : 'pause'}};
  if (!entry) return undefined;
  if (key.kind === 'selectUp' || key.kind === 'selectDown') {
    const to = Math.max(0, Math.min(entries.length - 1, panel.selected + (key.kind === 'selectUp' ? -1 : 1)));
    if (to === panel.selected) return undefined;
    panel.selected = to;
    return {kind: 'change', change: {op: 'move', id: entry.id, to}};
  }
  if (key.kind === 'enter' || (key.kind === 'text' && key.value === 'e')) return {kind: 'edit', id: entry.id};
  if (key.kind === 'delete' || key.kind === 'backspace' || (key.kind === 'text' && key.value === 'd')) return {kind: 'change', change: {op: 'remove', id: entry.id}};
  if (key.kind === 'text' && key.value === 'c') { panel.confirmClear = true; return undefined; }
  return undefined;
}

/** The panel's rows (unframed): what runs now, what runs next, and every queued command in order. */
export function renderQueuePanel(panel: QueuePanelState, queue: QueueState, running: string | undefined, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const width = Math.max(10, columns - 4);
  const entries = queue.entries;
  const status = queue.paused ? `${pausedGlyph()} paused · ${pauseReason(queue.paused)}` : entries.length ? `${queueGlyph()} runs in order, one at a time` : 'empty';
  const out = [`  ${primary}Command queue${reset}  ${queue.paused ? accent : subtle}${truncateText(status, Math.max(4, width - 15))}${reset}`];
  out.push(`  ${subtle}${truncateText(running ? `Running: ${queuePreview(running, width)}` : 'Nothing running', width)}${reset}`, '');
  if (!entries.length) {
    out.push(`  ${secondary}Nothing queued. While a command runs, type the next one and press Enter (or Ctrl+Q).${reset}`);
  }
  const listRoom = Math.max(1, height - 12);
  const first = Math.max(0, Math.min(panel.selected - Math.floor(listRoom / 2), entries.length - listRoom));
  entries.slice(first, first + listRoom).forEach((entry, offset) => {
    const index = first + offset;
    const selected = index === panel.selected;
    const label = index === 0 && !queue.paused ? 'next' : `${index + 1}`;
    const editing = queue.editing === entry.id ? '  (editing)' : '';
    const text = queuePreview(entry.text, Math.max(4, width - displayWidth(label) - displayWidth(editing) - 4));
    out.push(`${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${subtle}${label.padStart(4)}${reset}  ${focusForeground(selected)}${text}${reset}${subtle}${editing}${reset}`);
  });
  const selected = entries[panel.selected];
  if (selected && selected.text.includes('\n') && height >= out.length + 8) {
    const lines = selected.text.split('\n');
    out.push('', `  ${subtle}Runs as one block:${reset}`, ...lines.slice(0, 5).map(line => `  ${secondary}${truncateText(displaySafe(line), width)}${reset}`));
    if (lines.length > 5) out.push(`  ${subtle}… ${lines.length - 5} more line${lines.length === 6 ? '' : 's'}${reset}`);
  }
  out.push('');
  if (panel.confirmClear) out.push(`  ${accent}Clear ${entries.length} queued command${entries.length === 1 ? '' : 's'}? y / n${reset}`);
  else out.push(renderControls([['↑↓', 'select'], ['Shift+↑↓', 'move'], ['Enter', 'edit'], ['Del', 'remove'], ['p', queue.paused ? 'resume' : 'pause'], ['c', 'clear'], ['Esc', 'close']]));
  return out.map(line => truncateAnsi(line, columns));
}
