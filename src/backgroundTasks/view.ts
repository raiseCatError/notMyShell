import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateText} from '../util/text.js';
import {commandLine, elapsed, fitHints, stateWords, taskLabel, taskText} from './bar.js';
import type {OutputLine, TaskOutput} from './output.js';
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
 *   instead of jumping. A scrolled-back view is anchored to the line it
 *   shows, not to a row index, so lines dropped by the retention limit at
 *   the top do not move what the person is reading.
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

/** Index of the first kept line at or after `seq`. Kept lines have consecutive seqs, so this is arithmetic. */
function indexOfSeq(lines: readonly OutputLine[], seq: number): number {
  if (!lines.length) return 0;
  return Math.max(0, Math.min(lines.length - 1, seq - lines[0]!.seq));
}

/** A scrolled-back view's status: its notes while they fit, last note first to go; End and Esc always. */
function scrolledStatus(notes: string[], width: number): string {
  const keys = ['End follow', 'Esc back'];
  const kept = notes.filter(Boolean);
  while (kept.length && displayWidth([...kept, ...keys].join(' · ')) > width) kept.pop();
  return fitHints([...kept, ...keys], width);
}

export class TaskOutputView {
  /** Whether new lines keep the view at the bottom. Scrolling back turns it off; End turns it on again. */
  follow = true;
  /** The seq of the first line shown, when not following: what the person is reading stays put as lines arrive or go. */
  topSeq = 0;
  /** The last line seq the person has seen at the bottom; lines after it are "new". */
  seenSeq = 0;
  /** The line being read was dropped by the retention limit; the view moved to the oldest line still kept. */
  private overtaken = false;

  scroll(delta: number, output: TaskOutput, height: number): void {
    const lines = output.lines();
    const bottom = Math.max(0, lines.length - height);
    const current = this.follow ? bottom : indexOfSeq(lines, this.topSeq);
    const next = Math.max(0, Math.min(bottom, current + delta));
    this.follow = next >= bottom;
    this.topSeq = lines[next]?.seq ?? 0;
    this.overtaken = false;
    if (this.follow) this.seenSeq = output.lastSeq;
  }

  end(output: TaskOutput): void { this.follow = true; this.overtaken = false; this.seenSeq = output.lastSeq; }

  /** Exactly `height` lines: header, output window, and a status row saying what is new or how to follow again. */
  render(task: TaskRecord, output: TaskOutput, options: {width: number; height: number; now: number; color: boolean; safe: boolean}): string[] {
    const width = Math.max(1, options.width);
    const body = Math.max(0, options.height - 2);
    const lines = output.lines();
    // While following a live task, its unfinished line (a progress bar, a prompt without a newline) is the last row.
    const partial = this.follow && (task.state === 'running' || task.state === 'stopping') ? output.partial() : '';
    let top: number;
    if (this.follow) {
      top = Math.max(0, lines.length - Math.max(0, body - (partial ? 1 : 0)));
      this.seenSeq = output.lastSeq;
    } else {
      if (lines.length && this.topSeq < lines[0]!.seq) { this.topSeq = lines[0]!.seq; this.overtaken = true; }
      top = Math.min(indexOfSeq(lines, this.topSeq), Math.max(0, lines.length - body));
    }
    const reset = options.color ? '\u001b[0m' : '';
    const paint = (text: string, color: {red: number; green: number; blue: number}) => options.color ? `${foreground(color)}${text}${reset}` : text;
    const header = `${taskLabel(task)} · ${task.id} · ${stateWords(task)} ${elapsed((task.endedAt ?? options.now) - task.startedAt)} · ${taskText(task.cwd)}`;
    const out = [paint(truncateText(header, width), UI_COLORS.secondary)];
    for (const line of lines.slice(top, top + body)) out.push(truncateText(line.text, width));
    if (partial && out.length - 1 < body) out.push(truncateText(partial, width));
    while (out.length < options.height - 1) out.push('');
    const fresh = Math.min(lines.length, Math.max(0, output.lastSeq - this.seenSeq));
    const live = task.state === 'running' || task.state === 'stopping';
    const status = this.follow
      ? fitHints([`following · ${lines.length} lines${output.dropped ? ` (+${output.dropped} dropped)` : ''}`, live ? 'x stop' : '', 'Esc back'], width)
      : scrolledStatus([fresh ? `${fresh} new line${fresh === 1 ? '' : 's'} below` : '', this.overtaken ? 'older lines dropped (retention limit)' : ''], width);
    if (options.height >= 2) out.push(paint(status, UI_COLORS.subtle));
    return out.slice(0, Math.max(0, options.height));
  }
}
