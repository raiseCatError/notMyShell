import type {Key} from '../terminal/keys.js';
import {renderControlRows} from '../ui/controls.js';
import {framePanel} from '../ui/PanelShell.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi, truncateText} from '../util/text.js';
import {inert} from './document.js';
import type {EditorAction, EditorState} from './EditorPanel.js';
import {sameRealFile, type EditableFile} from './fileEdit.js';
import {chosenLines, hunksOf, merge3, mergedLines, pendingConflicts, setResolution, type Merge, type MergeHunk, type Resolution} from './threeWayMerge.js';

/**
 * Hunk-by-hunk review of a file that changed on disk while it was being edited (#463). The editor's buffer is not touched
 * while reviewing; the review holds a three-way merge of the version the editor opened (`file.lines`), the buffer and the
 * disk's current version, and the person decides each hunk. Applying puts the result in the buffer as one undoable edit and
 * makes the disk's version the new base, so the normal checked save follows. Nothing here reads or writes a file: the app
 * loads the disk's version and revalidates it immediately before applying.
 */

const RESET = '\u001b[0m';
const BOLD = '\u001b[1m';
const WHEEL_ROWS = 3;

export interface ReviewState {
  merge: Merge;
  /** The disk version this review was built from: applying is refused if the file is no longer exactly this. */
  theirs: EditableFile;
  focus: number;
  top: number;
  /** The `top` last drawn: a different one means the person scrolled, and the focus no longer pulls the view. */
  anchor: number;
  /** Decisions in the order taken, so each can be taken back. */
  history: Array<{id: number; previous: Resolution | undefined}>;
  preview: boolean;
  showBase: boolean;
}

export function createReview(state: EditorState, theirs: EditableFile): ReviewState {
  const merge = merge3(state.file.lines, state.buffer.lines, theirs.lines);
  const first = hunksOf(merge).findIndex(hunk => hunk.kind === 'conflict');
  return {merge, theirs, focus: Math.max(0, first), top: 0, anchor: 0, history: [], preview: false, showBase: false};
}

/** Start reviewing, or — when the disk's changes need no decision — just re-base on the disk's version. */
export function beginReview(state: EditorState, theirs: EditableFile): {reviewing: boolean; note: string} {
  if (!theirs.identity) return {reviewing: false, note: `${state.file.title} was deleted; Save anyway recreates it.`};
  // The path now leads to a different file (a symlink was retargeted): its lines have nothing to do with the version opened.
  // (A case-insensitive volume reports one file under whatever case it was created with: compared by identity, never by folding names.)
  if (!sameRealFile(theirs.realPath, state.file.realPath)) return {reviewing: false, note: `${state.file.title} now leads to a different file (${theirs.realPath}); your text was opened from ${state.file.realPath}. Nothing is merged. Keep editing to save a copy elsewhere, or Reload to read the new file.`};
  const review = createReview(state, theirs);
  if (!hunksOf(review.merge).length) {
    applyReview(state, theirs, review);
    return {reviewing: false, note: 'Nothing on disk needs a decision: its changes were already yours or do not touch your text. Save to write.'};
  }
  state.review = review;
  return {reviewing: true, note: ''};
}

/** The file changed again while the review was open: start over from its newest version (decisions are not carried over). */
export function restartReview(state: EditorState, theirs: EditableFile): string {
  state.review = undefined;
  if (!theirs.identity) return `${state.file.title} was deleted while you were reviewing; Save anyway recreates it.`;
  const started = beginReview(state, theirs);
  if (started.reviewing) return 'The file changed again while you were reviewing; the review starts over from its newest version.';
  return `The file changed again while you were reviewing. ${started.note}`;
}

/** Whether `fresh` is exactly the disk version the review was built from. */
export function sameDiskVersion(review: ReviewState, fresh: EditableFile): boolean {
  const a = review.theirs.identity, b = fresh.identity;
  return Boolean(a && b && a.dev === b.dev && a.ino === b.ino && a.hash === b.hash && sameRealFile(review.theirs.realPath, fresh.realPath)
    && review.theirs.lineEnding === fresh.lineEnding && review.theirs.bom === fresh.bom && review.theirs.finalNewline === fresh.finalNewline);
}

/** Put the merged text in the buffer (one undoable edit) and make `fresh` the base. The caller has checked `fresh` is the reviewed version. */
export function applyReview(state: EditorState, fresh: EditableFile, review: ReviewState): void {
  const merged = mergedLines(review.merge);
  if (!merged) return;
  const buffer = state.buffer;
  const unchanged = merged.length === buffer.lines.length && merged.every((line, index) => line === buffer.lines[index]);
  const caret = buffer.caret;
  const previous = state.file;
  if (!unchanged) {
    // Undo puts the old text back, so it must put the old base back too: otherwise a save after Ctrl+Z would pass the identity check and overwrite what the merge brought in.
    // Only while nothing has replaced that version since: a save in between made the file what the buffer then was, and undo must not put an older one back.
    buffer.replaceAll(merged, {undo: () => { if (state.file === fresh) state.file = previous; }, redo: () => { if (state.file === previous) state.file = fresh; }});
    const line = Math.min(caret.line, buffer.lines.length - 1);
    buffer.caret = {line, column: Math.min(caret.column, buffer.lines[line]!.length)};
    buffer.anchor = undefined;
  }
  state.file = fresh;
  state.review = undefined;
  state.top = Math.min(state.top, Math.max(0, buffer.lines.length - 1));
}

const resolutionText: Record<Resolution, string> = {mine: 'your version', theirs: 'the file\'s version', both: 'both (yours, then the file\'s)', base: 'the original'};

function decide(review: ReviewState, hunk: MergeHunk, resolution: Resolution): void {
  review.history.push({id: hunk.id, previous: hunk.resolution});
  setResolution(review.merge, hunk.id, resolution);
  const next = hunksOf(review.merge).findIndex(candidate => candidate.kind === 'conflict' && !candidate.resolution);
  if (next >= 0 && hunk.kind === 'conflict') review.focus = next;
}

export function reviewKey(state: EditorState, key: Key, columns: number, height: number): EditorAction | undefined {
  const review = state.review!;
  const hunks = hunksOf(review.merge);
  const hunk = hunks[review.focus];
  const text = key.kind === 'text' ? key.value : undefined;
  state.note = undefined;
  const move = (to: number) => { review.focus = Math.max(0, Math.min(hunks.length - 1, to)); review.preview = false; review.anchor = review.top; };
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    state.review = undefined;
    state.note = {text: 'Review closed. Your text is unchanged; saving will ask again while the file differs.', tone: 'info'};
    return undefined;
  }
  if (key.kind === 'enter') {
    const pending = pendingConflicts(review.merge);
    if (pending) {
      const first = hunks.findIndex(candidate => candidate.kind === 'conflict' && !candidate.resolution);
      move(first);
      state.note = {text: `${pending} conflict${pending === 1 ? '' : 's'} still need${pending === 1 ? 's' : ''} a choice.`, tone: 'error'};
      return undefined;
    }
    return {kind: 'review-apply'};
  }
  if (key.kind === 'complete' || text === 'n' || key.kind === 'down') { move(review.focus + 1); return undefined; }
  if (key.kind === 'focusPrevious' || text === 'p' || key.kind === 'up') { move(review.focus - 1); return undefined; }
  if (key.kind === 'wheelUp') { review.top = Math.max(0, review.top - WHEEL_ROWS); return undefined; }
  if (key.kind === 'wheelDown') { review.top += WHEEL_ROWS; return undefined; }
  if (text === 'c') {
    const next = hunks.findIndex((candidate, index) => index > review.focus && candidate.kind === 'conflict' && !candidate.resolution);
    const any = next >= 0 ? next : hunks.findIndex(candidate => candidate.kind === 'conflict' && !candidate.resolution);
    if (any >= 0) move(any); else state.note = {text: 'No undecided conflicts.', tone: 'info'};
    return undefined;
  }
  if (text === 'r') { review.preview = !review.preview; return undefined; }
  if (text === 'v') { review.showBase = !review.showBase; return undefined; }
  if (key.kind === 'suspend' || text === 'z') {
    const last = review.history.pop();
    if (!last) { state.note = {text: 'Nothing to undo.', tone: 'info'}; return undefined; }
    setResolution(review.merge, last.id, last.previous);
    move(hunks.findIndex(candidate => candidate.id === last.id));
    return undefined;
  }
  if (!hunk || !text) return undefined;
  if (text === 'm') decide(review, hunk, 'mine');
  else if (text === 't') decide(review, hunk, 'theirs');
  else if (text === 'b' && hunk.kind === 'conflict') decide(review, hunk, 'both');
  else if (text === 'o' && review.merge.aligned) decide(review, hunk, 'base');
  return undefined;
}

// ---- Drawing ------------------------------------------------------------------------------------------------------

interface Row {text: string; hunk?: number}

function describe(hunk: MergeHunk, count: number): string {
  const state = hunk.resolution ? `→ ${resolutionText[hunk.resolution]}` : 'undecided';
  return `Hunk ${hunk.id} of ${count} · ${hunk.kind === 'conflict' ? 'conflict' : 'changed on disk'} · ${state}`;
}

function rowsOf(review: ReviewState, width: number): Row[] {
  const rows: Row[] = [];
  const subtle = foreground(UI_COLORS.subtle), warning = foreground(UI_COLORS.warning), success = foreground(UI_COLORS.success), accent = foreground(UI_COLORS.accent);
  const hunks = hunksOf(review.merge);
  const clip = (line: string, label: string, color: string, chosen: boolean) =>
    `${color}${chosen ? '●' : '○'} ${label.padEnd(5)}${RESET}${subtle}│${RESET} ${truncateText(inert(line), Math.max(1, width - 10))}`;
  review.merge.segments.forEach((segment, index) => {
    if (segment.kind === 'text') {
      const before = review.merge.segments[index - 1]?.kind === 'hunk', after = review.merge.segments[index + 1]?.kind === 'hunk';
      const lines = segment.lines;
      const head = before ? lines.slice(0, 2) : [];
      const tail = after ? lines.slice(Math.max(head.length, lines.length - 2)) : [];
      const skipped = lines.length - head.length - tail.length;
      for (const line of head) rows.push({text: `  ${subtle}  ${truncateText(inert(line), Math.max(1, width - 4))}${RESET}`});
      if (skipped > 0) rows.push({text: `  ${subtle}⋯ ${skipped.toLocaleString('en-US')} unchanged line${skipped === 1 ? '' : 's'}${RESET}`});
      for (const line of tail) rows.push({text: `  ${subtle}  ${truncateText(inert(line), Math.max(1, width - 4))}${RESET}`});
      return;
    }
    const hunk = segment.hunk;
    const focused = hunks[review.focus] === hunk;
    const head = describe(hunk, hunks.length);
    rows.push({hunk: hunk.id, text: `${focused ? `${accent}${BOLD}▶ ` : '  '}${hunk.resolution ? success : warning}${truncateText(head, Math.max(1, width - 2))}${RESET}`});
    const chosen = hunk.resolution;
    const show = (lines: string[], label: string, color: string, picks: Resolution[]) => {
      const marked = chosen !== undefined && picks.includes(chosen);
      if (!lines.length) rows.push({hunk: hunk.id, text: `  ${subtle}${marked ? '●' : '○'} ${label.padEnd(5)}│ (no lines)${RESET}`});
      for (const line of lines) rows.push({hunk: hunk.id, text: `  ${clip(line, label, marked ? success : color, marked)}`});
    };
    if (review.showBase && review.merge.aligned) show(hunk.base, 'base', subtle, ['base']);
    show(hunk.mine, 'you', accent, ['mine', 'both']);
    show(hunk.theirs, 'file', warning, ['theirs', 'both']);
  });
  return rows;
}

/** The result preview as cheap entries; only the visible window is styled (a large file is not restyled on every key). */
interface PreviewEntry {text: string; mark?: 'you' | 'file'; note?: boolean; hunk?: number; number?: number}

function previewEntries(review: ReviewState): PreviewEntry[] {
  const entries: PreviewEntry[] = [];
  let number = 0;
  const line = (text: string, mark?: 'you' | 'file', hunk?: number) => { number += 1; entries.push({text, number, ...(mark ? {mark} : {}), ...(hunk === undefined ? {} : {hunk})}); };
  for (const segment of review.merge.segments) {
    if (segment.kind === 'text') { for (const text of segment.lines) line(text); continue; }
    const chosen = chosenLines(segment.hunk);
    if (chosen) { chosen.forEach((text, index) => line(text, undefined, index === 0 ? segment.hunk.id : undefined)); continue; }
    entries.push({text: `⚠ undecided conflict (hunk ${segment.hunk.id}): yours, then the file's`, note: true, hunk: segment.hunk.id});
    segment.hunk.mine.forEach(text => line(text, 'you'));
    segment.hunk.theirs.forEach(text => line(text, 'file'));
  }
  return entries;
}

function styledPreview(entry: PreviewEntry, width: number): Row {
  const subtle = foreground(UI_COLORS.subtle), warning = foreground(UI_COLORS.warning);
  if (entry.note) return {hunk: entry.hunk, text: `  ${warning}${truncateText(entry.text, Math.max(1, width - 2))}${RESET}`};
  const mark = entry.mark === 'you' ? `${warning}you ${RESET}` : entry.mark === 'file' ? `${warning}file${RESET} ` : '';
  return {text: `  ${subtle}${String(entry.number).padStart(4)}${RESET} ${mark}${truncateText(inert(entry.text), Math.max(1, width - 8))}`};
}

export function reviewFooter(state: EditorState, columns: number): string[] {
  const review = state.review!;
  const hunk = hunksOf(review.merge)[review.focus];
  const choices: Array<[string, string]> = hunk?.kind === 'conflict'
    ? [['m', 'yours'], ['t', 'the file\'s'], ['b', 'both'], ...(review.merge.aligned ? [['o', 'original'] as [string, string]] : [])]
    : [['m', 'keep yours'], ['t', 'take the file\'s']];
  return renderControlRows([['n/p', 'hunk'], ...choices, ['c', 'next conflict'], ['r', review.preview ? 'hunks' : 'preview'], ['z', 'undo'], ['Enter', 'apply'], ['Esc', 'close']], Math.max(1, columns - 4));
}

export function renderReview(state: EditorState, columns: number, height: number): string[] {
  const review = state.review!;
  const width = Math.max(10, columns - 4);
  const subtle = foreground(UI_COLORS.subtle), primary = foreground(UI_COLORS.primary), warning = foreground(UI_COLORS.warning);
  const hunks = hunksOf(review.merge);
  const pending = pendingConflicts(review.merge);
  const footer = reviewFooter(state, columns);
  const extra = (review.merge.notes[0] ? 1 : 0) + (state.note ? 1 : 0);
  const body = Math.max(1, height - 2 - 1 - 1 - extra - footer.length);
  const entries = review.preview ? previewEntries(review) : undefined;
  const rows = entries ? [] : rowsOf(review, width);
  const total = entries ? entries.length : rows.length;
  // Keep the focused hunk's first row in view; wheel scrolling moves from there.
  const focusRow = entries ? entries.findIndex(entry => entry.hunk === hunks[review.focus]?.id) : rows.findIndex(row => row.hunk === hunks[review.focus]?.id);
  if (focusRow >= 0 && review.top === review.anchor) {
    if (focusRow < review.top) review.top = Math.max(0, focusRow - 1);
    else if (focusRow >= review.top + body) review.top = focusRow - 1;
  }
  review.top = Math.max(0, Math.min(review.top, Math.max(0, total - body)));
  review.anchor = review.top;
  const title = truncateText(`Review changes to ${state.file.title}`, Math.max(8, Math.floor(width * 0.7)));
  const out = [`  ${primary}${title}${RESET}  ${subtle}${review.preview ? 'result preview' : `${hunks.length} hunk${hunks.length === 1 ? '' : 's'}`}${RESET}`];
  for (let offset = 0; offset < body; offset += 1) {
    const entry = entries?.[review.top + offset];
    out.push(entries ? (entry ? styledPreview(entry, width).text : '') : rows[review.top + offset]?.text ?? '');
  }
  const status = pending ? `${warning}${pending} conflict${pending === 1 ? '' : 's'} need${pending === 1 ? 's' : ''} a choice before applying${RESET}` : `${subtle}Ready: Enter puts the result in the editor (undoable); nothing is saved until you save.${RESET}`;
  out.push(`  ${status}`);
  if (review.merge.notes[0]) out.push(`  ${subtle}${truncateText(review.merge.notes[0], width)}${RESET}`);
  if (state.note) out.push(`  ${state.note.tone === 'error' ? foreground(UI_COLORS.failure) : subtle}${truncateText(inert(state.note.text), width)}${RESET}`);
  out.push(...footer.map(row => `  ${row}`));
  const rule = framePanel([], columns)[0]!;
  if (height <= 1) return [rule].slice(0, Math.max(0, height));
  return [...framePanel(out.slice(0, Math.max(0, height - 2)).map(row => truncateAnsi(row, columns)), columns), rule];
}
