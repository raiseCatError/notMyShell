import {queueOutcomeTone, queueRowKey} from './queueTransitions.js';
import {toneColor} from '../motion/transitions.js';
import type {QueueState} from '../session/CommandQueue.js';
import type {QueueExecution} from '../session/ExecutionTimeline.js';
import type {QueueRowOptions} from './queueStatus.js';
import {queuePreview, pauseReason, failurePolicyNote, pausedGlyph} from './queueText.js';
import {displaySafe} from '../input/PasteReview.js';
import {activityGlyph} from './activity.js';
import {formatDuration} from './commandTiming.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {contrastOn, fromOklch, relativeLuminance, surfaceFor, toOklch} from '../chroma/color.js';
import {colorLevel} from '../presentation/capabilities.js';
import {selectionBand} from '../ui/selectionBand.js';
import {GLYPHS} from '../ui/glyphs.js';
import {paintDivider, DEFAULT_TREATMENT_SETTINGS} from '../chroma/treatment.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';

const RESET = '\u001b[0m';
/** Presentation counts are bounded here too: a hand-edited configuration can never break the layout. */
function countSetting(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
}
/** Faint fills derive from the active selection surface and semantic hue, never a terminal-background guess. */
function rowTint(tone: RgbColor, strength = 0.3): RgbColor | undefined {
  if (colorLevel() === 'none' || colorLevel() === 'ansi16') return undefined;
  const selection = toOklch(UI_COLORS.selection), semantic = toOklch(tone);
  const lightText = relativeLuminance(UI_COLORS.primary) > relativeLuminance(UI_COLORS.selection);
  const fill = fromOklch({l: lightText ? selection.l * 0.48 : 1 - (1 - selection.l) * 0.25, c: semantic.c * strength, h: semantic.h});
  return surfaceFor(fill, UI_COLORS.primary);
}

/** Same renderer for real chrome and deterministic preview fixtures. All input is observed session data. */
export function renderExecutionTimeline(state: QueueState, columns: number, height: number, options: QueueRowOptions = {}): string[] {
  const chain = state.timeline;
  if (!chain || columns < 1 || height < 1) return [];
  const now = options.now ?? Date.now();
  const counts = chain.counts;
  const running = chain.executions.find(entry => entry.status === 'running');
  const recentResults = countSetting(options.recentResults, 0, 2, 2);
  const upcoming = countSetting(options.upcoming, 1, 2, 2);
  const completed = recentResults === 0 ? [] : chain.executions.filter(entry => entry.status !== 'running').slice(-recentResults);
  const total = counts.succeeded + counts.failed + counts.interrupted + counts.skipped + counts.unobserved + Number(Boolean(running || state.dispatching)) + state.entries.length;
  const title = options.review === 'clear' ? 'Clear queued commands?'
    : options.review === 'resume' ? `Resume the queue? ${state.entries.length} pending`
    : options.review === 'approve' ? 'Approve and run this command?'
    : state.paused ? `${pausedGlyph()} Queue paused · ${state.entries.length} pending`
    : chain.status === 'cleared' ? `Queue cleared · ${counts.skipped} skipped`
    : chain.status === 'shell-ended' ? 'Queue · shell ended'
    : chain.status === 'finished' ? `Queue finished · ${total} commands` : `Queue · ${total} commands`;
  const head = truncateText(title, Math.max(1, columns - 4));
  options.row?.(queueRowKey(chain.id, 'heading'), 0);
  const treatment = {...(options.treatment ?? DEFAULT_TREATMENT_SETTINGS), motion: 'static' as const};
  const headerFill = state.paused ? rowTint(UI_COLORS.warning, 0.12) : undefined;
  const headerTone = toneColor(queueOutcomeTone(state));
  const header = `${paintDivider(GLYPHS.separator, treatment, now)} ${foreground(headerFill ? contrastOn(headerTone, headerFill) : headerTone)}${head}${RESET} ${paintDivider(GLYPHS.separator.repeat(Math.max(0, columns - displayWidth(head) - 3)), treatment, now)}${RESET}`;
  const out = [headerFill ? selectionBand(truncateAnsi(header, columns), columns, headerFill) : truncateAnsi(header, columns)];
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
  if (reason && out.length < height) out.push(`${foreground(UI_COLORS.warning)}${truncateText(reason, columns)}${RESET}`);
  if (options.review === 'resume' && height >= 4) out.push(`${foreground(UI_COLORS.subtle)}${truncateText(failurePolicyNote(chain.failurePolicy), columns)}${RESET}`);
  // Allocate by importance, then paint in chronological order. Hidden entries remain in the owner's queue.
  const candidates: Array<{order: number; priority: number; text: string; key?: string; pending?: boolean}> = [];
  const line = (mark: string, text: string, detail: string, color: RgbColor = UI_COLORS.secondary, tone?: RgbColor, strength?: number): string => {
    const fill = tone && rowTint(tone, strength);
    const fg = (color_: RgbColor) => foreground(fill ? contrastOn(color_, fill) : color_);
    const suffix = truncateText(detail, Math.max(1, columns - displayWidth(mark) - 2));
    const room = Math.max(0, columns - displayWidth(mark) - displayWidth(suffix) - 3);
    const label = room > 0 ? truncateText(queuePreview(text, room), room) : '';
    const painted = truncateAnsi(`${fg(color)}${mark}${RESET} ${fg(UI_COLORS.primary)}${label}${RESET}${' '.repeat(Math.max(1, columns - displayWidth(mark) - 1 - displayWidth(label) - displayWidth(suffix)))}${fg(color)}${suffix}${RESET}`, columns);
    return fill ? selectionBand(painted, columns, fill) : painted;
  };
  const result = (entry: QueueExecution): string => {
    const duration = entry.durationMs === undefined ? '' : formatDuration(entry.durationMs);
    const detail = entry.status === 'interrupted' ? `Interrupted${entry.exitCode === undefined ? '' : ` · exit ${entry.exitCode}`} · ${duration}`
      : entry.status === 'failed' ? `exit ${entry.exitCode} · ${duration}` : duration;
    return line(entry.status === 'succeeded' ? GLYPHS.success : GLYPHS.failure, entry.text, detail,
      entry.status === 'succeeded' ? UI_COLORS.success : entry.status === 'failed' ? UI_COLORS.failure : UI_COLORS.warning,
      entry.status === 'succeeded' ? UI_COLORS.success : entry.status === 'failed' ? UI_COLORS.failure : UI_COLORS.warning);
  };
  completed.forEach((entry,index) => candidates.push({order: index, priority: 4 - index, key: queueRowKey(chain.id, 'execution', entry.id), text: result(entry)}));
  if (running) candidates.push({order: 2, priority: 0, key: queueRowKey(chain.id, 'execution', running.id), text: line(activityGlyph(options.animate === false ? 0 : options.animationElapsed ?? now - running.startedAt), running.text, 'Running', UI_COLORS.accent, UI_COLORS.accent, 0.18)});
  if (!running && state.dispatching) candidates.push({order: 2, priority: 0, key: queueRowKey(chain.id, 'pending', state.dispatching.id), text: line('·', state.dispatching.text, 'Starting')});
  state.entries.slice(0, upcoming).forEach((entry,index) => {
    const next = index === 0;
    const detail = entry.condition === 'approve' && !entry.approved ? 'Approval' : state.paused ? 'Paused' : next ? 'Next' : 'Queued';
    candidates.push({order: 3 + index, priority: next ? 1 : 5, pending: true, key: queueRowKey(chain.id, 'pending', entry.id),
      text: line(next ? GLYPHS.selection : ' ', entry.text, detail, next && !state.paused ? UI_COLORS.accent : UI_COLORS.subtle, next ? state.paused ? UI_COLORS.warning : UI_COLORS.accent : undefined, 0.12)});
  });
  let room = Math.max(0, height - out.length);
  // Reserve a compact overflow count whenever pending work cannot all be listed.
  const overflow = state.entries.length > Math.min(upcoming, Math.max(0, room - Number(Boolean(running || state.dispatching))));
  if (overflow && room >= 3) room--;
  const selected = candidates.sort((a,b) => a.priority-b.priority).slice(0,room).sort((a,b) => a.order-b.order);
  for (const item of selected) { if (item.key) options.row?.(item.key, out.length); out.push(item.text); }
  const hidden = state.entries.length - selected.filter(item => item.pending).length;
  if (hidden && out.length < height) out.push(`${foreground(UI_COLORS.subtle)}${truncateText(`  +${hidden} more`, columns)}${RESET}`);
  if (options.affordance && !options.review && out.length < height) out.push(`${foreground(UI_COLORS.subtle)}${truncateText('Enter to review · /queue', columns)}${RESET}`);
  return out;
}

/** Aggregate wall time is sampled from the owner's monotonic observation; pause/gap time is included. */
export function queueActivitySummary(state: QueueState, sinceObservationMs = 0, columns = Number.POSITIVE_INFINITY): string {
  const chain = state.timeline;
  if (!chain) return '';
  const elapsed = chain.elapsedMs + (chain.status === 'active' && chain.startedAt !== undefined ? Math.max(0, sinceObservationMs) : 0);
  const counts = chain.counts;
  const facts = [counts.succeeded ? `${counts.succeeded} succeeded` : '', counts.failed ? `${counts.failed} failed` : '',
    counts.interrupted ? `${counts.interrupted} interrupted` : '', counts.skipped ? `${counts.skipped} skipped` : '',
    counts.unobserved ? `${counts.unobserved} without exec` : '', chain.executions.some(entry => entry.status === 'running') ? '1 running' : state.dispatching ? '1 starting' : '', state.entries.length ? `${state.entries.length} waiting` : ''].filter(Boolean);
  const status = state.paused ? 'Queue paused' : chain.status === 'active' ? 'Queue activity' : chain.status === 'cleared' ? 'Queue cleared' : chain.status === 'shell-ended' ? 'Queue ended' : 'Queue finished';
  const full = `${status} · ${chain.startedAt === undefined ? 'no execution observed' : `${formatDuration(elapsed)} ${state.paused ? 'wall (includes pause)' : 'elapsed'}`}${facts.length ? ` · ${facts.join(' · ')}` : ''}`;
  if (displayWidth(full) <= columns) return full;
  const running = chain.executions.some(entry => entry.status === 'running');
  const latest = chain.executions.at(-1);
  const interrupted = state.paused?.reason === 'interrupted';
  const compactStatus = interrupted ? 'Interrupted' : state.paused ? 'Paused' : chain.status === 'cleared' ? 'Cleared'
    : chain.status === 'shell-ended' ? 'Shell ended' : chain.status === 'finished' ? 'Finished' : running ? 'Running'
    : state.dispatching ? 'Starting' : state.entries[0]?.condition === 'approve' && !state.entries[0].approved ? 'Approval' : 'Queued';
  const code = state.paused?.reason === 'failed' ? state.paused.exitCode : interrupted ? latest?.exitCode : undefined;
  const priority = [code !== undefined ? `exit ${code}` : '', counts.failed && code === undefined ? `${counts.failed} failed` : '',
    chain.startedAt === undefined ? '' : `${formatDuration(elapsed)}${state.paused && !interrupted ? ' wall' : ''}`,
    state.entries.length ? `${state.entries.length} pending` : '', counts.interrupted && !interrupted ? `${counts.interrupted} interrupted` : '',
    counts.skipped ? `${counts.skipped} skipped` : '', counts.unobserved ? `${counts.unobserved} unknown` : '',
    counts.succeeded ? `${counts.succeeded} succeeded` : ''].filter(Boolean);
  const parts = displayWidth(compactStatus) <= columns ? [compactStatus] : [];
  for (const fact of priority) if (displayWidth([...parts, fact].join(' · ')) <= columns) parts.push(fact);
  return parts.join(' · ');
}


/** Semantic emphasis is presentation-only; the plain formatter remains useful for review and accessibility. */
export function renderQueueActivitySummary(state: QueueState, sinceObservationMs = 0, columns = Number.POSITIVE_INFINITY): string {
  const parts = queueActivitySummary(state, sinceObservationMs, columns).split(' · ');
  return parts.map((part, index) => {
    const color = index === 0 ? toneColor(queueOutcomeTone(state))
      : /failed|^exit /u.test(part) ? state.paused?.reason === 'interrupted' ? UI_COLORS.warning : UI_COLORS.failure
      : /interrupted|skipped|unknown|without exec/u.test(part) ? UI_COLORS.warning
      : /succeeded/u.test(part) ? UI_COLORS.success : /running|starting/u.test(part) ? UI_COLORS.accent
      : /waiting|pending/u.test(part) ? UI_COLORS.subtle : UI_COLORS.secondary;
    return `${foreground(color)}${part}${RESET}`;
  }).join(`${foreground(UI_COLORS.subtle)} · ${RESET}`);
}
