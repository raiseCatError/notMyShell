import type {PromptConfiguration} from '../prompt/configuration.js';
import type {QueueState} from '../session/CommandQueue.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {queueBlock} from './queueStatus.js';

/**
 * The Queue settings' preview: the exact production renderer over frozen observed facts, drawn with the current
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

/**
 * What the current Queue settings actually show: the live timeline with the configured result and upcoming counts,
 * or the classic pending list with the timeline off, plus one factual line about session ownership and review.
 */
export function queueSettingsPreview(config: PromptConfiguration, columns: number): string[] {
  const width = Math.max(24, columns);
  const state = previewState();
  const lines = config.queue.liveTimeline
    ? queueBlock(state, width, 6, {now: PREVIEW_EPOCH, animate: false, animationElapsed: 0, treatment: config.presentation,
      recentResults: config.queue.recentResults, upcoming: config.queue.upcoming})
    : queueBlock(state, width, 5, {now: PREVIEW_EPOCH, animate: false, liveTimeline: false});
  const note = 'Queue state lives in the live session · resume and clear are always reviewed';
  return [...(lines ?? []), `${foreground(UI_COLORS.subtle)}${note}\u001B[0m`];
}
