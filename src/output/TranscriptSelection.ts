import type {WrappedRow} from './viewport.js';

/**
 * NMSh-owned transcript selection. Terminal-native (Shift+drag) selection
 * lives in the host's screen grid, which NMSh repaints when its virtual
 * transcript scrolls, so it cannot extend past the visible rows. A plain drag
 * over the transcript selects transcript content instead: rows are indices in
 * the wrapped transcript, so the wheel can scroll while selecting and the
 * selection keeps growing. Presentation only; the transcript never changes.
 */
export interface TranscriptSelection {
  anchor: number;
  head: number;
  /** Button still held; a release ends the drag. */
  dragging: boolean;
  /** At least one drag step beyond the anchor: a plain click selects nothing. */
  moved: boolean;
  /** Last pointer row on screen (terminal row), so a wheel step can re-aim the head. */
  pointerY?: number;
}

export function beginSelection(row: number, pointerY: number): TranscriptSelection {
  return {anchor: row, head: row, dragging: true, moved: false, pointerY};
}

export function extendSelection(selection: TranscriptSelection, row: number, pointerY?: number): void {
  if (row !== selection.anchor) selection.moved = true;
  selection.head = row;
  if (pointerY !== undefined) selection.pointerY = pointerY;
}

export function selectionRange(selection: TranscriptSelection): {start: number; end: number} {
  return {start: Math.min(selection.anchor, selection.head), end: Math.max(selection.anchor, selection.head)};
}

export function isRowSelected(selection: TranscriptSelection | undefined, row: number): boolean {
  if (!selection?.moved) return false;
  const {start, end} = selectionRange(selection);
  return row >= start && row <= end;
}

/**
 * The selected transcript content: wrapped rows of one logical line join
 * without a break (wrapping is presentation, not content), different lines
 * join with newlines, and trailing padding is trimmed. Synthetic rows
 * (filter notices) are not transcript content and are skipped.
 */
export function selectedText(rows: readonly WrappedRow[], selection: TranscriptSelection): string {
  if (!selection.moved) return '';
  const {start, end} = selectionRange(selection);
  const lines: string[] = [];
  let previousLine: number | undefined;
  for (let index = start; index <= end && index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.isFilterHint) continue;
    const text = row.plain.slice(row.indent ?? 0);
    // Continuation rows of the same logical line are joined exactly; padding is trimmed once the line ends.
    if (row.lineIndex !== undefined && row.lineIndex === previousLine && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
    previousLine = row.lineIndex;
  }
  return lines.map(line => line.replace(/\s+$/u, '')).join('\n');
}
