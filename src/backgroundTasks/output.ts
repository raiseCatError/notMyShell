import {stripTerminalControls} from '../util/terminalControls.js';

/**
 * One background task's output (#382), as NMSh presents it: plain text
 * lines, bounded in count and bytes, each numbered so a view can tell what
 * is new. A PTY merges stdout and stderr exactly as a terminal shows them,
 * so the stream is one stream; separating them would need pipes, which
 * change how programs buffer and color their output.
 *
 * Output is hostile text: escape sequences (colors, OSC titles and links,
 * cursor movement), C0/C1 controls and bidi overrides are removed when a
 * line completes, so nothing a program prints can restyle NMSh, move its
 * cursor or pose as another task. Carriage-return progress lines keep only
 * their last state. Invalid UTF-8 arrives already replaced (U+FFFD) by the
 * PTY decoder.
 */

export interface OutputLine {
  /** 1-based, increasing for the task's lifetime (also across dropped lines). */
  seq: number;
  text: string;
}

export interface OutputLimits {
  lines: number;
  bytes: number;
  /** Longest line kept, in characters; longer lines are split. */
  lineLength?: number;
}

const DEFAULT_LINE_LENGTH = 4096;

export class TaskOutput {
  private readonly kept: OutputLine[] = [];
  private keptBytes = 0;
  private partialRaw = '';
  private nextSeq = 1;
  /** Lines removed to stay within the limits (oldest first). */
  dropped = 0;
  /** Bytes received in total, before any bound. */
  received = 0;

  constructor(private readonly limits: OutputLimits) {}

  /** Append raw PTY text. Complete lines are sanitized and kept; a trailing partial line waits for its end. */
  append(chunk: string): void {
    this.received += Buffer.byteLength(chunk);
    let data = this.partialRaw + chunk;
    const maxRaw = (this.limits.lineLength ?? DEFAULT_LINE_LENGTH) * 4;
    let newline: number;
    while ((newline = data.indexOf('\n')) >= 0) {
      this.push(data.slice(0, newline));
      data = data.slice(newline + 1);
    }
    // A line that never ends (a stream without newlines) is split rather than held without bound.
    while (data.length > maxRaw) { this.push(data.slice(0, maxRaw)); data = data.slice(maxRaw); }
    this.partialRaw = data;
  }

  /** The unfinished last line as it would be shown now (a progress line shows its latest state). */
  partial(): string {
    return this.mirroredPartial ?? clean(this.partialRaw, this.limits.lineLength ?? DEFAULT_LINE_LENGTH);
  }

  /** The owner's unfinished line, when this output mirrors a task that runs elsewhere (the session service). */
  private mirroredPartial?: string;

  /**
   * Mirror the owner's output: lines keep the owner's seq (a line already held is not taken twice), are cleaned again
   * here, and the same limits apply. Earlier lines that were never received count as dropped.
   */
  receive(update: {lines: readonly OutputLine[]; partial: string; dropped: number; received: number}): void {
    const length = this.limits.lineLength ?? DEFAULT_LINE_LENGTH;
    for (const line of update.lines) {
      if (line.seq <= this.lastSeq) continue;
      const text = clean(line.text, length);
      this.kept.push({seq: line.seq, text});
      this.keptBytes += Buffer.byteLength(text) + 1;
      this.nextSeq = line.seq + 1;
      this.bound();
    }
    this.mirroredPartial = clean(update.partial, length);
    this.received = Math.max(this.received, update.received);
    this.dropped = Math.max(this.dropped, update.dropped, (this.kept[0]?.seq ?? this.nextSeq) - 1);
  }

  /** Flush the unfinished line, when the task ends. */
  finish(): void {
    if (this.partialRaw) this.push(this.partialRaw);
    this.partialRaw = '';
  }

  lines(): readonly OutputLine[] { return this.kept; }

  /** Lines after `seq` (what a view has not shown yet). */
  since(seq: number): OutputLine[] {
    const first = this.kept.findIndex(line => line.seq > seq);
    return first === -1 ? [] : this.kept.slice(first);
  }

  get lastSeq(): number { return this.nextSeq - 1; }
  get bytes(): number { return this.keptBytes; }

  private push(raw: string): void {
    const length = this.limits.lineLength ?? DEFAULT_LINE_LENGTH;
    const text = clean(raw, length * 4);
    for (let start = 0; start === 0 || start < text.length; start += length) {
      const piece = text.slice(start, start + length);
      this.kept.push({seq: this.nextSeq++, text: piece});
      this.keptBytes += Buffer.byteLength(piece) + 1;
      if (text.length <= length) break;
    }
    this.bound();
  }

  private bound(): void {
    while (this.kept.length > this.limits.lines || (this.keptBytes > this.limits.bytes && this.kept.length > 1)) {
      const removed = this.kept.shift()!;
      this.keptBytes -= Buffer.byteLength(removed.text) + 1;
      this.dropped += 1;
    }
  }
}

/** One raw line → display text: `\r\n` ends a line, a lone `\r` overwrites it (progress output), escapes and controls go. */
export function clean(raw: string, maxLength: number): string {
  // A PTY turns a program's "\r\n" into "\r\r\n": every trailing \r belongs to the line ending, not to a progress overwrite.
  // Trimmed by hand: `/\r+$/` retries from every \r of a long run, which is quadratic on hostile output.
  let end = raw.length;
  while (end > 0 && raw.charCodeAt(end - 1) === 13) end -= 1;
  const line = raw.slice(0, end);
  const last = line.lastIndexOf('\r');
  const visible = last === -1 ? line : line.slice(last + 1);
  return stripTerminalControls(visible.replace(/\t/gu, '    '), maxLength);
}
