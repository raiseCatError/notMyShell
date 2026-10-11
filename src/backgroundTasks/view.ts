import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateText} from '../util/text.js';
import {commandLine, elapsed, stateWords, taskLabel, taskText} from './bar.js';
import type {TaskOutput} from './output.js';
import type {TaskRecord} from './supervisor.js';

/**
 * How a background task's output appears (#382). Two pure presentations over
 * the same bounded stream:
 *
 * - a **transcript block**, NMSh-owned and labelled with the task, placed in
 *   the main transcript where the task started; it shows the latest lines
 *   (folded) and is never mixed into a foreground command's block, so
 *   `git status` run meanwhile keeps its own block;
 * - a **focused live view** (Enter on a task), which follows new output
 *   unless the person scrolls back, and then says how many lines are new
 *   instead of jumping.
 *
 * Lines are already sanitized by TaskOutput; nothing here interprets them.
 */

export interface BlockOptions {
  width: number;
  now: number;
  /** Latest lines shown in the folded block. */
  lines?: number;
  color: boolean;
  safe: boolean;
}

/** The task's transcript block: a header naming the task, its latest lines, and what was folded or dropped. */
export function taskBlock(task: TaskRecord, output: TaskOutput, options: BlockOptions): string[] {
  const width = Math.max(1, options.width);
  const reset = options.color ? '\u001b[0m' : '';
  const paint = (text: string, color: {red: number; green: number; blue: number}) => options.color ? `${foreground(color)}${text}${reset}` : text;
  const time = elapsed((task.endedAt ?? options.now) - task.startedAt);
  const header = `${options.safe ? '>' : '▸'} Background · ${taskLabel(task)} · ${task.id} · ${stateWords(task)} ${time}`;
  const lines = output.lines();
  const shown = lines.slice(-(options.lines ?? 6));
  const earlier = lines.length - shown.length + output.dropped;
  const result = [paint(truncateText(header, width), UI_COLORS.secondary)];
  if (earlier > 0) result.push(paint(truncateText(`  … ${earlier.toLocaleString('en-US')} earlier line${earlier === 1 ? '' : 's'}${output.dropped ? ` (${output.dropped.toLocaleString('en-US')} beyond the retention limit)` : ''} · /background ${task.id}`, width), UI_COLORS.subtle));
  for (const line of shown) result.push(truncateText(`  ${line.text}`, width));
  const partial = output.partial();
  if (partial && (task.state === 'running' || task.state === 'stopping')) result.push(truncateText(`  ${partial}`, width));
  if (!lines.length && !partial) result.push(paint('  (no output yet)', UI_COLORS.subtle));
  return result;
}

/** Plain text of a block for copying: the task's own lines with its label, never NMSh's styling. */
export function taskBlockText(task: TaskRecord, output: TaskOutput): string {
  return [`# background ${task.id}: ${commandLine(task).text}`, ...output.lines().map(line => line.text)].join('\n');
}

export class TaskOutputView {
  /** Whether new lines keep the view at the bottom. Scrolling back turns it off; End turns it on again. */
  follow = true;
  /** First line shown (index into the kept lines), when not following. */
  top = 0;
  /** The last line seq the person has seen at the bottom; lines after it are "new". */
  seenSeq = 0;

  scroll(delta: number, output: TaskOutput, height: number): void {
    const lines = output.lines();
    const bottom = Math.max(0, lines.length - height);
    const current = this.follow ? bottom : this.top;
    const next = Math.max(0, Math.min(bottom, current + delta));
    this.follow = next >= bottom;
    this.top = next;
    if (this.follow) this.seenSeq = output.lastSeq;
  }

  end(output: TaskOutput): void { this.follow = true; this.seenSeq = output.lastSeq; }

  /** Exactly `height` lines: header, output window, and a status row saying what is new or how to follow again. */
  render(task: TaskRecord, output: TaskOutput, options: {width: number; height: number; now: number; color: boolean; safe: boolean}): string[] {
    const width = Math.max(1, options.width);
    const body = Math.max(0, options.height - 2);
    const lines = output.lines();
    if (this.follow) { this.top = Math.max(0, lines.length - body); this.seenSeq = output.lastSeq; }
    this.top = Math.max(0, Math.min(this.top, Math.max(0, lines.length - body)));
    const reset = options.color ? '\u001b[0m' : '';
    const paint = (text: string, color: {red: number; green: number; blue: number}) => options.color ? `${foreground(color)}${text}${reset}` : text;
    const header = `${taskLabel(task)} · ${task.id} · ${stateWords(task)} ${elapsed((task.endedAt ?? options.now) - task.startedAt)} · ${taskText(task.cwd)}`;
    const out = [paint(truncateText(header, width), UI_COLORS.secondary)];
    for (const line of lines.slice(this.top, this.top + body)) out.push(truncateText(line.text, width));
    while (out.length < options.height - 1) out.push('');
    const fresh = lines.filter(line => line.seq > this.seenSeq).length;
    const status = this.follow ? `following · ${lines.length} lines${output.dropped ? ` (+${output.dropped} dropped)` : ''} · x stop · Esc back`
      : `${fresh ? `${fresh} new line${fresh === 1 ? '' : 's'} below · ` : ''}End follow · Esc back`;
    if (options.height >= 2) out.push(paint(truncateText(status, width), UI_COLORS.subtle));
    return out.slice(0, Math.max(0, options.height));
  }
}
