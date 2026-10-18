import {displaySafe} from '../input/PasteReview.js';
import {colorLevel} from '../presentation/capabilities.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi, truncateText} from '../util/text.js';
import type {WatchRun, WatchTask} from './WatchTasks.js';

/**
 * A /track block's live rows (#393), drawn under its stored lines and replaced on every refresh: a status row that
 * says only what is known (first run pending, refreshing, when the last result completed and how, paused, stale,
 * stopped), then the latest completed result. The result keeps a stable height (the largest seen, at most
 * MAX_TRACK_ROWS) so a shorter refresh never moves what is below it; a longer one says how much is not shown.
 */

export const MAX_TRACK_ROWS = 12;
const RESET = '\u001b[0m';

const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', {hour12: false});
const every = (ms: number) => ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 100) / 10}s`;
const span = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;

/** How a completed sample ended, in words: never a healthy result when it was not one. */
export function runOutcome(run: WatchRun): {text: string; ok: boolean} {
  if (run.timedOut) return {text: `timed out after ${span(run.durationMs)}`, ok: false};
  if (run.error) return {text: `could not run: ${run.error}`, ok: false};
  if (run.signal) return {text: `ended by ${run.signal}`, ok: false};
  return run.exitCode === 0 ? {text: 'exit 0', ok: true} : {text: `exit ${run.exitCode}`, ok: false};
}

export function trackStatus(watch: WatchTask, now: number, sampling: boolean): string {
  const color = colorLevel() !== 'none';
  const paint = (role: keyof typeof UI_COLORS) => color ? foreground(UI_COLORS[role]) : '';
  const run = watch.current;
  const outcome = run && runOutcome(run);
  const finished = run ? run.at + run.durationMs : undefined;
  const parts: string[] = [];
  let mark: string;
  let role: keyof typeof UI_COLORS = 'subtle';
  if (watch.status === 'stopped') { mark = '■'; parts.push('stopped'); }
  else if (watch.status === 'paused') { mark = '‖'; parts.push('paused'); }
  else if (!run) { mark = '◌'; parts.push(sampling ? 'first run…' : 'first run pending'); }
  else { mark = '◉'; role = outcome!.ok ? 'success' : 'failure'; parts.push('live'); }
  parts.push(`every ${every(watch.intervalMs)}`);
  if (run && outcome) parts.push(`updated ${clock(finished!)}`, outcome.text);
  if (run?.truncated) parts.push('output cut at 200 kB');
  if (watch.status === 'running' && run && now - finished! > watch.intervalMs * 2 + 5000) parts.push(`no new result for ${span(now - finished!)}`);
  if (watch.status === 'running' && run && sampling) parts.push('refreshing…');
  parts.push(`${watch.runs} run${watch.runs === 1 ? '' : 's'}`);
  return `${paint(role)}${mark}${RESET} ${paint('secondary')}${parts.join(' · ')}${RESET}`;
}

export function trackBlockRows(watch: WatchTask | undefined, width: number, now: number, reserved: number, sampling = false): {rows: string[]; reserved: number} {
  const color = colorLevel() !== 'none';
  const subtle = color ? foreground(UI_COLORS.subtle) : '';
  const fit = (text: string) => truncateText(text, Math.max(1, width - 4));
  if (!watch) return {rows: [`    ${subtle}■ not running: trackers stop with the window that started them${RESET}`], reserved: 0};
  const status = truncateAnsi(`    ${trackStatus(watch, now, sampling)}`, width);
  // Stopped by the person: the final result was written into the transcript; the live rows end here.
  if (watch.status === 'stopped') return {rows: [status], reserved: 0};
  const lines = watch.current ? watch.current.output.replace(/\n$/u, '').split('\n') : [];
  const height = Math.max(reserved, Math.min(MAX_TRACK_ROWS, Math.max(1, lines.length)));
  const body: string[] = [];
  if (!watch.current) body.push(`    ${subtle}waiting for the first result…${RESET}`);
  else {
    const take = lines.length > height ? height - 1 : lines.length;
    for (const line of lines.slice(0, take)) body.push(`    ${fit(displaySafe(line))}`);
    if (take < lines.length) body.push(`    ${subtle}${fit(`… ${lines.length - take} more lines · /track copy copies them all`)}${RESET}`);
  }
  while (body.length < height) body.push('');
  return {rows: [status, ...body], reserved: height};
}

/** The final result written into the transcript when the person stops a tracker: bounded, plain, said once. */
export function finalResultRows(watch: WatchTask, maxLines = 200): string[] {
  const run = watch.current;
  if (!run) return [`Stopped before the first result · ${watch.runs} runs`];
  const lines = run.output.replace(/\n$/u, '').split('\n');
  const kept = lines.slice(0, maxLines).map(line => displaySafe(line));
  return [`Stopped · last result ${clock(run.at + run.durationMs)} · ${runOutcome(run).text} · ${watch.runs} run${watch.runs === 1 ? '' : 's'}`, ...kept,
    ...(lines.length > maxLines ? [`… ${lines.length - maxLines} more lines were not kept`] : [])];
}
