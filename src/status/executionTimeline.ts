import type {QueueState} from '../session/CommandQueue.js';
import type {QueueExecution} from '../session/ExecutionTimeline.js';
import type {QueueRowOptions} from './queueStatus.js';
import {queuePreview, pauseReason, failurePolicyNote} from './queueText.js';
import {displaySafe} from '../input/PasteReview.js';
import {activityGlyph} from './activity.js';
import {formatDuration} from './commandTiming.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {paintDivider, DEFAULT_TREATMENT_SETTINGS} from '../chroma/treatment.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';

const RESET = '\u001b[0m';
const amber = {red: 198, green: 156, blue: 109};

/** Same renderer for real chrome and deterministic preview fixtures. All input is observed session data. */
export function renderExecutionTimeline(state: QueueState, columns: number, height: number, options: QueueRowOptions = {}): string[] {
  const chain = state.timeline;
  if (!chain || columns < 1 || height < 1) return [];
  const now = options.now ?? Date.now();
  const counts = chain.counts;
  const running = chain.executions.find(entry => entry.status === 'running');
  const completed = chain.executions.filter(entry => entry.status !== 'running').slice(-2);
  const total = counts.succeeded + counts.failed + counts.interrupted + counts.skipped + counts.unobserved + Number(Boolean(running || state.dispatching)) + state.entries.length;
  const title = options.review === 'clear' ? 'Clear queued commands?'
    : options.review === 'resume' ? `Resume the queue? ${state.entries.length} pending`
    : options.review === 'approve' ? 'Approve and run this command?'
    : state.paused ? `Queue paused · ${state.entries.length} pending`
    : chain.status === 'cleared' ? `Queue cleared · ${counts.skipped} skipped`
    : chain.status === 'shell-ended' ? 'Queue · shell ended'
    : chain.status === 'finished' ? `Queue finished · ${total} commands` : `Queue · ${total} commands`;
  const head = truncateText(title, Math.max(1, columns - 4));
  const rule = `${GLYPHS.separator} ${head} ${GLYPHS.separator.repeat(Math.max(0, columns - displayWidth(head) - 3))}`;
  const out = [paintDivider(truncateText(rule, columns), {...(options.treatment ?? DEFAULT_TREATMENT_SETTINGS), motion: 'static'}, now) + RESET];
  const reviewKeys = options.review === 'clear' ? 'Enter clears · Esc cancels' : options.review === 'resume' ? 'Enter resumes · Esc keeps it paused · e edits next'
    : options.review === 'approve' ? 'Enter approves · Esc cancels · e edits' : undefined;
  if (options.review === 'approve' && height >= 2 && state.entries[0]) {
    const lines = state.entries[0].text.split('\n');
    const capacity = Math.max(0, height - 2);
    const shown = lines.slice(0, lines.length > capacity ? Math.max(0, capacity - 1) : capacity);
    out.push(...shown.map(line => `${foreground(UI_COLORS.primary)}${truncateText(displaySafe(line), columns)}${RESET}`));
    if (lines.length > shown.length && out.length < height - 1) out.push(`${foreground(UI_COLORS.subtle)}${truncateText(`… ${lines.length-shown.length} more lines · e shows all`, columns)}${RESET}`);
    out.push(`${foreground(UI_COLORS.secondary)}${truncateText('Enter or y approves · n not now · e edits · Esc', columns)}${RESET}`);
    return out;
  }
  const reason = reviewKeys ?? (state.paused ? state.paused.reason === 'user' ? 'Paused manually'
    : state.paused.reason === 'failed' ? `Failed · exit ${state.paused.exitCode} · ${queuePreview(state.paused.command, columns)}`
    : state.paused.reason === 'interrupted' ? `Interrupted · ${queuePreview(state.paused.command ?? '', columns)}` : pauseReason(state.paused)
    : state.entries[0]?.condition === 'approve' && !state.entries[0].approved ? 'Awaiting approval' : undefined);
  if (reason && out.length < height) out.push(`${foreground(amber)}${truncateText(reason, columns)}${RESET}`);
  if (options.review === 'resume' && height >= 4) out.push(`${foreground(UI_COLORS.subtle)}${truncateText(failurePolicyNote(chain.failurePolicy), columns)}${RESET}`);
  // Allocate by importance, then paint in chronological order. Hidden entries remain in the owner's queue.
  const candidates: Array<{order: number; priority: number; text: string; pending?: boolean}> = [];
  const line = (mark: string, text: string, detail: string, color: RgbColor = UI_COLORS.secondary): string => {
    const suffix = truncateText(detail, Math.max(1, columns - displayWidth(mark) - 2));
    const room = Math.max(0, columns - displayWidth(mark) - displayWidth(suffix) - 3);
    const label = room > 0 ? truncateText(queuePreview(text, room), room) : '';
    return truncateAnsi(`${foreground(color)}${mark}${RESET} ${foreground(UI_COLORS.primary)}${label}${RESET}${' '.repeat(Math.max(1, columns - displayWidth(mark) - 1 - displayWidth(label) - displayWidth(suffix)))}${foreground(color)}${suffix}${RESET}`, columns);
  };
  const result = (entry: QueueExecution): string => {
    const duration = entry.durationMs === undefined ? '' : formatDuration(entry.durationMs);
    const detail = entry.status === 'interrupted' ? `Interrupted${entry.exitCode === undefined ? '' : ` · exit ${entry.exitCode}`} · ${duration}`
      : entry.status === 'failed' ? `exit ${entry.exitCode} · ${duration}` : duration;
    return line(entry.status === 'succeeded' ? GLYPHS.success : GLYPHS.failure, entry.text, detail,
      entry.status === 'succeeded' ? UI_COLORS.success : entry.status === 'failed' ? UI_COLORS.failure : amber);
  };
  completed.forEach((entry,index) => candidates.push({order: index, priority: 4 - index, text: result(entry)}));
  if (running) candidates.push({order: 2, priority: 0, text: line(activityGlyph(options.animate === false ? 0 : options.animationElapsed ?? now - running.startedAt), running.text, 'Running', UI_COLORS.secondary)});
  if (!running && state.dispatching) candidates.push({order: 2, priority: 0, text: line('·', state.dispatching.text, 'Starting')});
  state.entries.slice(0,2).forEach((entry,index) => {
    const next = index === 0;
    const detail = entry.condition === 'approve' && !entry.approved ? 'Approval' : state.paused ? 'Paused' : next ? 'Next' : 'Queued';
    candidates.push({order: 3 + index, priority: next ? 1 : 5, pending: true,
      text: line(next && !state.paused ? GLYPHS.selection : ' ', entry.text, detail, next && !state.paused ? UI_COLORS.secondary : UI_COLORS.subtle)});
  });
  let room = Math.max(0, height - out.length);
  // Reserve a compact overflow count whenever pending work cannot all be listed.
  const overflow = state.entries.length > Math.min(2, Math.max(0, room - Number(Boolean(running || state.dispatching))));
  if (overflow && room >= 3) room--;
  const selected = candidates.sort((a,b) => a.priority-b.priority).slice(0,room).sort((a,b) => a.order-b.order);
  out.push(...selected.map(item => item.text));
  const hidden = state.entries.length - selected.filter(item => item.pending).length;
  if (hidden && out.length < height) out.push(`${foreground(UI_COLORS.subtle)}${truncateText(`  +${hidden} more`, columns)}${RESET}`);
  if (options.affordance && !options.review && out.length < height) out.push(`${foreground(UI_COLORS.subtle)}${truncateText('Enter to review · /queue', columns)}${RESET}`);
  return out;
}

/** Aggregate wall time is sampled from the owner's monotonic observation; pause/gap time is included. */
export function queueActivitySummary(state: QueueState, sinceObservationMs = 0): string {
  const chain = state.timeline;
  if (!chain) return '';
  const elapsed = chain.elapsedMs + (chain.status === 'active' && chain.startedAt !== undefined ? Math.max(0, sinceObservationMs) : 0);
  const counts = chain.counts;
  const facts = [counts.succeeded ? `${counts.succeeded} succeeded` : '', counts.failed ? `${counts.failed} failed` : '',
    counts.interrupted ? `${counts.interrupted} interrupted` : '', counts.skipped ? `${counts.skipped} skipped` : '',
    counts.unobserved ? `${counts.unobserved} without exec` : '', chain.executions.some(entry => entry.status === 'running') ? '1 running' : state.dispatching ? '1 starting' : '', state.entries.length ? `${state.entries.length} waiting` : ''].filter(Boolean);
  const status = state.paused ? 'Queue paused' : chain.status === 'active' ? 'Queue activity' : chain.status === 'cleared' ? 'Queue cleared' : chain.status === 'shell-ended' ? 'Queue ended' : 'Queue finished';
  return `${status} · ${chain.startedAt === undefined ? 'no execution observed' : `${formatDuration(elapsed)} ${state.paused ? 'wall (includes pause)' : 'elapsed'}`}${facts.length ? ` · ${facts.join(' · ')}` : ''}`;
}
