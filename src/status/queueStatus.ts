import {renderExecutionTimeline} from './executionTimeline.js';
import {queueGlyph, pausedGlyph, queuePreview, pauseReason} from './queueText.js';
export {queueGlyph, pausedGlyph, queuePreview, pauseReason} from './queueText.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';
import {displaySafe} from '../input/PasteReview.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import type {QueuePause, QueueState} from '../session/CommandQueue.js';

/**
 * How NMSh shows the command queue. The queue's owner (the session service, or the in-process client) is the one
 * source; this module only words and paints it. No animation: a queue waits, it does not work.
 */
const RESET = '\u001b[0m';
/** Paused: the same amber NMSh uses for a stopped command, apart from waiting-for-input and failure. */
const STOPPED = {red: 198, green: 156, blue: 109};

/**
 * What the queue offers right now from an empty composer at idle (see TerminalApp.queueAffordance), and the inline
 * review that a first Enter arms: nothing runs from a single key.
 */
export type QueueAffordance = 'resume' | 'approve' | 'clear';

export interface QueueRowOptions {
  /** Shown only while the shell is idle, the composer is empty and nothing else owns input. */
  affordance?: QueueAffordance;
  /** The review a first Enter armed: the row says exactly what the next key does. */
  review?: QueueAffordance;
  /** Identity of each actually visible timeline row; never its transient display index as an execution ID. */
  row?: (key: string, index: number) => void;
  now?: number;
  animate?: boolean;
  animationElapsed?: number;
  treatment?: import('../chroma/treatment.js').TreatmentSettings;
  /** The Queue settings' live timeline switch: false renders the classic pending list, never the observed timeline. */
  liveTimeline?: boolean;
  /** Finished results kept visible (0–2, default 2). Bounded again by the renderer. */
  recentResults?: number;
  /** Waiting commands listed (1–2, default 2). Bounded again by the renderer. */
  upcoming?: number;
}

const AFFORDANCE_HINT: Record<QueueAffordance, string> = {resume: 'Enter to review', approve: 'Enter to review', clear: 'Esc to review clear'};

/**
 * The queue's one line under the running command (or at idle while paused), widest form first:
 *   ≡ Queued (2) · next: adb devices · /queue
 *   ⏸ Queue paused · 2 waiting · Enter to review · /queue
 * Why it paused is said once, in the transcript where it happened; this row is the state and what to do about it.
 * Narrow widths drop the hint, then the preview; the count always stays.
 */
export function queueRow(state: QueueState, columns: number, options: QueueRowOptions = {}): string | undefined {
  const count = state.entries.length;
  if (!count || columns <= 0) return undefined;
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const accent = foreground(UI_COLORS.accent);
  const stopped = foreground(STOPPED);
  if (options.review === 'clear') return truncateAnsi(`${accent}Clear ${count} queued commands?${RESET}${secondary} · Enter clears · Esc cancels${RESET}`, columns);
  if (options.review) return reviewRow(state, columns, options.review);
  const hint = options.affordance ? [AFFORDANCE_HINT[options.affordance]] : [];
  if (state.paused) {
    const head = `${pausedGlyph()} Queue paused`;
    const parts = [`${count} waiting`, ...hint, '/queue'];
    const forms = [parts, [parts[0]!, ...hint], [parts[0]!]];
    for (const form of forms) {
      if (displayWidth([head, ...form].join(' · ')) <= columns) return `${stopped}${head}${RESET}${secondary} · ${form.join(' · ')}${RESET}`;
    }
    return `${stopped}${truncateText(`${head} · ${count}`, columns)}${RESET}`;
  }
  const next = state.entries[0]!;
  // The queue is waiting for the person, not for the shell: say so, in the one line that is always there.
  if (next.condition === 'approve' && !next.approved) {
    const asks = `${queueGlyph()} Queued (${count}) · next needs your approval`;
    for (const tail of [` · ${[...hint, '/queue'].join(' · ')}`, hint.length ? ` · ${hint[0]}` : '', '']) {
      const room = columns - displayWidth(`${asks}: `) - displayWidth(tail);
      if (room >= 8) return `${accent}${asks}${RESET}${subtle}: ${queuePreview(next.text, room)}${tail}${RESET}`;
    }
    return `${accent}${truncateText(`${queueGlyph()} Queued (${count}) · needs approval`, columns)}${RESET}`;
  }
  const head = `${queueGlyph()} Queued (${count})`;
  const editing = state.editing === next.id ? ' (editing)' : '';
  for (const tail of [' · /queue', '']) {
    const room = columns - displayWidth(`${head} · next: `) - displayWidth(editing) - displayWidth(tail);
    if (room >= 8) return `${secondary}${head}${RESET}${subtle} · next: ${queuePreview(next.text, room)}${editing}${tail}${RESET}`;
  }
  return `${secondary}${truncateText(head, columns)}${RESET}`;
}

/** The armed review in one line: exactly what Enter does, and how to leave without running anything. */
function reviewRow(state: QueueState, columns: number, review: QueueAffordance): string {
  const accent = foreground(UI_COLORS.accent);
  const secondary = foreground(UI_COLORS.secondary);
  const next = state.entries[0]!;
  const head = review === 'approve' ? 'Approve and run' : 'Resume the queue';
  const keys = review === 'approve' ? ['Enter or y approves', 'n not now', 'e edits', 'Esc'] : ['Enter resumes', 'Esc keeps it paused', 'e edits next'];
  for (const form of [keys, keys.slice(0, 2), keys.slice(0, 1)]) {
    const tail = ` · ${form.join(' · ')}`;
    const room = columns - displayWidth(`${head}: `) - displayWidth(tail);
    if (room >= 8) return `${accent}${head}${RESET}${secondary}: ${queuePreview(next.text, room)}${tail}${RESET}`;
  }
  return `${accent}${truncateText(`${head}? ${keys[0]}`, columns)}${RESET}`;
}

/** Order connectors for the expanded queue; Safe glyphs use ASCII that lines up the same. */
function connectors(): {first: string; middle: string; last: string; rail: string} {
  return getCurrentGlyphMode() === 'safe' ? {first: '+-', middle: '|-', last: "'-", rail: '| '} : {first: '╭─', middle: '├─', last: '╰─', rail: '│ '};
}

/**
 * The expanded queue: a header and up to `rows - 1` rows below it, in run order, for when the screen has room. The
 * header replaces the one-line row; the rows below are the screen plan's queue region (see withQueueRows). Shows at
 * most three commands, then "+N more"; the last row carries the contextual hint or the armed review's keys.
 *   ╭─ ≡ Queue · 5 pending
 *   ├─ next  npm run build
 *   ├─ 2     npm test · asks first
 *   ╰─ +3 more · /queue
 * Returns undefined when the one-line row says it all (one plain entry, or no room for at least one listed command).
 */
export function queueBlock(state: QueueState, columns: number, rows: number, options: QueueRowOptions = {}): string[] | undefined {
  if (state.timeline && options.liveTimeline !== false) return renderExecutionTimeline(state, columns, rows, options);
  const entries = state.entries;
  if (!entries.length || rows < 2 || columns < 24) return undefined;
  const plain = !state.paused && !options.review && !options.affordance && entries.length === 1 && !entries[0]!.condition;
  if (plain) return undefined;
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const stopped = foreground(STOPPED);
  const glyph = connectors();
  const count = entries.length;
  const next = entries[0]!;
  const asks = !state.paused && next.condition === 'approve' && !next.approved;
  const review = options.review;
  const headText = review === 'approve' ? 'Approve and run this command?'
    : review === 'resume' ? `${pausedGlyph()} Resume the queue? ${count} pending`
      : state.paused ? `${pausedGlyph()} Queue paused · ${count} pending`
        : asks ? `${queueGlyph()} Queue · next needs your approval` : `${queueGlyph()} Queue · ${count} pending`;
  const headColor = review || asks ? accent : state.paused ? stopped : secondary;
  const out = [truncateAnsi(`${subtle}${glyph.first}${RESET} ${headColor}${headText}${RESET}`, columns)];
  // The footer: what is not listed, and what a key does here.
  const footer = review === 'approve' ? 'Enter or y approves · n not now · e edits · Esc'
    : review === 'resume' ? 'Enter resumes · Esc keeps it paused · e edits next'
      : options.affordance ? `${options.affordance === 'approve' ? 'Enter to review it' : 'Enter to review before anything runs'} · /queue` : '';
  const body = rows - 1;
  if (review === 'approve') {
    // The whole command, as it will run (bounded): approval is for this exact text.
    const lines = next.text.split('\n');
    const room = Math.max(1, body - 1);
    const shown = lines.length > room ? lines.slice(0, room - 1) : lines;
    shown.forEach((line, index) => out.push(truncateAnsi(`${subtle}${index ? glyph.rail : glyph.middle}${RESET} ${primary}${displaySafe(line) || ' '}${RESET}`, columns)));
    if (lines.length > shown.length) out.push(truncateAnsi(`${subtle}${glyph.rail} … ${lines.length - shown.length} more line${lines.length - shown.length === 1 ? '' : 's'} · e shows all${RESET}`, columns));
    out.push(truncateAnsi(`${subtle}${glyph.last}${RESET} ${secondary}${footer}${RESET}`, columns));
    return out;
  }
  const listed = Math.min(3, count, body - (footer || count > 3 ? 1 : 0));
  if (listed < 1) return undefined;
  const hidden = count - listed;
  const label = (index: number) => index === 0 && !state.paused ? 'next' : `${index + 1}`;
  const width = Math.max(...entries.slice(0, listed).map((_, index) => displayWidth(label(index))));
  const tail = [hidden ? `+${hidden} more` : '', footer || (hidden ? '/queue' : '')].filter(Boolean).join(' · ');
  entries.slice(0, listed).forEach((entry, index) => {
    const note = conditionNoteFor(entry);
    const last = index === listed - 1 && !tail;
    const connector = last ? glyph.last : glyph.middle;
    const room = Math.max(4, columns - displayWidth(`${connector} ${label(index).padEnd(width)}  `) - (note ? displayWidth(` · ${note}`) : 0));
    const color = index === 0 && !state.paused ? primary : secondary;
    out.push(truncateAnsi(`${subtle}${connector}${RESET} ${subtle}${label(index).padEnd(width)}${RESET}  ${color}${queuePreview(entry.text, room)}${RESET}${note ? `${entry.condition === 'approve' && !entry.approved ? accent : subtle} · ${note}${RESET}` : ''}`, columns));
  });
  if (tail) out.push(truncateAnsi(`${subtle}${glyph.last}${RESET} ${options.affordance ? secondary : subtle}${tail}${RESET}`, columns));
  return out;
}

/** A queued entry's condition in a few words (the same words /queue uses). */
function conditionNoteFor(entry: QueueState['entries'][number]): string {
  return entry.condition === 'always' ? 'runs even after a failure' : entry.condition === 'approve' ? (entry.approved ? 'approved' : 'asks first') : '';
}
