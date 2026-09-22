import {GLYPHS} from '../ui/glyphs.js';

export type CommandOutcome = 'failure' | 'interrupted';

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;

  const totalWholeSeconds = Math.floor(totalSeconds);
  if (totalWholeSeconds < 3600) {
    const minutes = Math.floor(totalWholeSeconds / 60);
    const seconds = totalWholeSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(totalWholeSeconds / 3600);
  const remainderSeconds = totalWholeSeconds % 3600;
  const minutes = Math.floor(remainderSeconds / 60);
  return `${hours}h ${minutes}m`;
}

export function formatLocalTime(date: Date): string {
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
}

export function completedStatus(
  outcome: CommandOutcome,
  milliseconds: number,
  completedAt: Date,
  exitCode?: number,
): {main: string; detail: string} {
  const duration = formatDuration(milliseconds);
  const time = ` · done ${formatLocalTime(completedAt)}`;
  if (outcome === 'interrupted') return {main: `${GLYPHS.failure} Stopped after ${duration}`, detail: time};
  if (outcome === 'failure') {
    return {main: `${GLYPHS.failure} Failed after ${duration} · exit ${exitCode ?? 1}`, detail: time};
  }
  return {main: `${GLYPHS.info} Stopped after ${duration}`, detail: time};
}
