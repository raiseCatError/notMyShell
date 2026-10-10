/**
 * Keeps input in the order a local terminal would deliver it around a program's device-attributes query.
 *
 * A program that asks `CSI c` (primary device attributes) and waits for the answer may treat keys that reach it
 * before the answer as part of that wait. Fish 4 does this each time its line editor starts (its prompt and its
 * `read` builtin) and drops them: natively, with the answer delayed until after type-ahead, fish lost the type-ahead
 * in 7 of 10 runs while zsh and Bash kept all of it. A local terminal answers within microseconds, so the answer is
 * always first. Through NMSh the answer makes a round trip (PTY, session service, frontend, host terminal and back),
 * and keys typed in that window used to overtake it.
 *
 * From the moment the program asks until the answer is delivered, other input is held, then delivered right after
 * the answer, in order. Answers to other queries that arrive with it (cursor position, colours) go first too. A host
 * that never answers cannot stall typing: after `holdMs` the held input is delivered as it came.
 */
const DA1_QUERY = /\u001b\[0?c/u;
const DA1_REPLY = /\u001b\[\?[\d;]{1,64}c/u;
/** Terminal answers that may precede the device attributes in the same burst; they keep their place before the keys. */
const OTHER_REPLIES = /\u001b\[\d{1,6};\d{1,6}R|\u001b\[\??\d+;\d\$y|\u001b\[>[\d;]{1,64}c|\u001b\](?:1[0-2]|4;\d{1,3});[ -~]{1,128}(?:\u0007|\u001b\\)|\u001b\[\?\d{1,10}u/gu;
/** Held input beyond this is delivered at once: the hold exists for typing, not for bulk transfers. */
const HOLD_LIMIT = 64 * 1024;
const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';

/** `text` split into bracketed-paste spans (start to end marker, or to the end while a paste is still arriving) and the rest. */
function pasteSegments(text: string): Array<{text: string; paste: boolean}> {
  const segments: Array<{text: string; paste: boolean}> = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf(PASTE_START, index);
    if (start === -1) { segments.push({text: text.slice(index), paste: false}); break; }
    if (start > index) segments.push({text: text.slice(index, start), paste: false});
    const end = text.indexOf(PASTE_END, start + PASTE_START.length);
    const stop = end === -1 ? text.length : end + PASTE_END.length;
    segments.push({text: text.slice(start, stop), paste: true});
    index = stop;
  }
  return segments;
}
export const QUERY_HOLD_MS = 500;

export class QueryOrder {
  private awaiting = false;
  private held = '';
  /** The tail of the last output chunk, so a query split across reads is still seen. */
  private carry = '';
  private timer?: NodeJS.Timeout;

  constructor(private readonly write: (data: string) => void, private readonly holdMs = QUERY_HOLD_MS) {}

  /** Whether input is being held for an answer (for tests and diagnostics). */
  get holding(): boolean { return this.awaiting; }

  /** Program output: a device-attributes query starts a hold. */
  observeOutput(data: string): void {
    const text = this.carry + data;
    this.carry = text.slice(-3);
    if (DA1_QUERY.test(text)) this.awaiting = true;
  }

  /** NMSh answered the query itself: the answer goes first, then whatever was held. */
  answer(reply: string): void {
    this.write(reply);
    if (DA1_REPLY.test(reply)) this.release('');
  }

  /** Input for the program (keys, pastes, the host terminal's answers). */
  input(data: string): void {
    if (!this.awaiting) { this.write(data); return; }
    const buffer = this.held + data;
    const segments = pasteSegments(buffer);
    // Only an answer outside a bracketed paste counts: pasted bytes are the person's, never the terminal's.
    let offset = 0;
    let found: {index: number; length: number} | undefined;
    for (const segment of segments) {
      if (!segment.paste) {
        const match = DA1_REPLY.exec(segment.text);
        if (match) { found = {index: offset + match.index, length: match[0].length}; break; }
      }
      offset += segment.text.length;
    }
    if (!found) {
      this.held = buffer;
      if (this.held.length > HOLD_LIMIT) { this.release(''); return; }
      this.timer ??= setTimeout(() => { this.timer = undefined; this.release(''); }, this.holdMs);
      this.timer.unref?.();
      return;
    }
    // Answers that came before it keep their place before the keys; a paste is never taken apart or reordered.
    let answers = '';
    let keys = '';
    for (const segment of pasteSegments(buffer.slice(0, found.index))) {
      if (segment.paste) { keys += segment.text; continue; }
      answers += segment.text.match(OTHER_REPLIES)?.join('') ?? '';
      keys += segment.text.replace(OTHER_REPLIES, '');
    }
    this.held = '';
    this.write(`${answers}${buffer.slice(found.index, found.index + found.length)}`);
    this.release(`${keys}${buffer.slice(found.index + found.length)}`);
  }

  /** An interrupt: like a terminal's Ctrl+C, it discards input the program has not received yet. */
  discard(): void {
    this.held = '';
    this.release('');
  }

  /** Stops holding and delivers held input followed by `after`. */
  private release(after: string): void {
    this.awaiting = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    const data = `${this.held}${after}`;
    this.held = '';
    if (data) this.write(data);
  }

  dispose(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.held = '';
    this.awaiting = false;
  }
}
