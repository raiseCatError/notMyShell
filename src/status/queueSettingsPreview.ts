import type {PromptConfiguration} from '../prompt/configuration.js';
import type {QueueState} from '../session/CommandQueue.js';
import type {QueueSummary} from '../session/QueueSummary.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {queueBlock} from './queueStatus.js';
import {renderQueueSummary} from './queueSummaryView.js';

/**
 * The Queue settings' preview: the exact production renderers over frozen observed facts, drawn with the current
 * palette, glyph style and motion policy. No shell, no session and no execution: changing a setting can never run
 * anything, and the same configuration always draws the same lines.
 */
const PREVIEW_EPOCH = Date.UTC(2026, 9, 16, 12, 0, 0);

/** One deterministic chain: two results, the running command, and two waiting entries. */
function previewState(): QueueState {
  const at = (seconds: number) => PREVIEW_EPOCH + Math.round(seconds * 1000);
  return {revision: 1,
    entries: [{id: 4, text: 'git status', addedAt: at(1.4)}, {id: 5, text: 'echo done', addedAt: at(1.4)}],
    timeline: {id: 1, createdAt: at(0), startedAt: at(0), observedAt: at(2.1), elapsedMs: 2100, failurePolicy: 'pause', status: 'active',
      counts: {succeeded: 2, failed: 0, interrupted: 0, skipped: 0, unobserved: 0},
      executions: [
        {id: 1, text: 'npm run build', source: 'queue', entryId: 1, startedAt: at(0), endedAt: at(1), durationMs: 1000, status: 'succeeded', exitCode: 0},
        {id: 2, text: 'npm run lint', source: 'queue', entryId: 2, startedAt: at(1), endedAt: at(1.4), durationMs: 400, status: 'succeeded', exitCode: 0},
        {id: 3, text: 'npm test', source: 'queue', entryId: 3, startedAt: at(1.4), runningMs: 700, status: 'running'}]}};
}

/** One deterministic saved artifact: recognized labels only, one observed failure, no text and no paths. */
function previewSummary(): QueueSummary {
  const at = (seconds: number) => PREVIEW_EPOCH + Math.round(seconds * 1000);
  return {version: 1, id: 'chain-6', chainId: 6, savedAt: at(6), origin: 'automatic', status: 'finished', failurePolicy: 'pause',
    createdAt: at(0), startedAt: at(0), endedAt: at(5.6), elapsedMs: 5600,
    counts: {succeeded: 2, failed: 1, interrupted: 0, skipped: 0, unobserved: 0},
    entries: [
      {outcome: 'succeeded', label: 'npm', durationMs: 1000, exitCode: 0},
      {outcome: 'failed', label: 'npm', durationMs: 1200, exitCode: 1},
      {outcome: 'succeeded', label: 'npm', durationMs: 3400, exitCode: 0}],
    entriesOmitted: 0};
}

/** The saved summary container as the current summary settings draw it. */
export function queueSummaryPreview(config: PromptConfiguration, columns: number): string[] {
  return renderQueueSummary(previewSummary(), Math.max(24, columns), 40, {detail: config.queue.summaryDetail,
    placement: config.queue.summaryPlacement, align: config.queue.summaryAlign, durations: config.queue.summaryDurations,
    exitCodes: config.queue.summaryExitCodes, inputWaits: config.queue.summaryInputWaits, treatment: config.presentation, now: PREVIEW_EPOCH});
}

/**
 * What the current Queue settings actually show: the live timeline with the configured result and upcoming counts,
 * or the classic pending list with the timeline off, the saved summary container as the summary settings draw it,
 * and factual lines about session ownership and what saved artifacts can ever contain.
 */
export function queueSettingsPreview(config: PromptConfiguration, columns: number): string[] {
  const width = Math.max(24, columns);
  const state = previewState();
  const lines = config.queue.liveTimeline
    ? queueBlock(state, width, 6, {now: PREVIEW_EPOCH, animate: false, animationElapsed: 0, treatment: config.presentation,
      recentResults: config.queue.recentResults, upcoming: config.queue.upcoming})
    : queueBlock(state, width, 5, {now: PREVIEW_EPOCH, animate: false, liveTimeline: false});
  const notes = ['Queue state lives in the live session · resume and clear are always reviewed',
    'Saved summaries keep only observed facts: outcomes, durations, exit codes and counts',
    'Never output, prompts, hidden input, secret arguments or private paths'];
  return [...(lines ?? []), ...queueSummaryPreview(config, width), ...notes.map(note => `${foreground(UI_COLORS.subtle)}${note}\u001B[0m`)];
}
