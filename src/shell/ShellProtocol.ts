export interface ShellMarker {
  exitCode: number;
  cwd: string;
  knowledge?: string;
  /** Time the finished command spent waiting for input, and how many waits (see InputWatch); absent when none. */
  inputWaitMs?: number;
  inputWaits?: number;
}

export type ProtocolEvent =
  | {kind: 'data'; data: string}
  | {kind: 'marker'; marker: ShellMarker}
  /** zsh preexec: a command line is about to run in the foreground. */
  | {kind: 'exec'; command: string; historyAllowed?: number};

/**
 * Bound on one marker's payload (a command line can be long; a cwd cannot).
 * Past it the decoder keeps only the bounded payload and skips to the BEL, so
 * memory never follows an unterminated marker and later output still flows.
 */
export const MAX_MARKER_PAYLOAD = 1024 * 1024;

export class ShellProtocolDecoder {
  private readonly prefix: string;
  private buffered = '';
  /** The bounded start of an oversized marker, while its remainder is skipped. */
  private oversized?: string;

  /** Characters retained across reads; never above the prefix plus MAX_MARKER_PAYLOAD. */
  get retainedLength(): number {
    return this.buffered.length + (this.oversized?.length ?? 0);
  }

  constructor(token: string) {
    this.prefix = `\u001B]777;nmsh;${token};`;
  }

  push(chunk: string): ProtocolEvent[] {
    const events: ProtocolEvent[] = [];
    if (this.oversized !== undefined) {
      const bell = chunk.indexOf('\u0007');
      if (bell === -1) return events;
      // Only a command line is still meaningful truncated; an oversized prompt marker is dropped.
      const payload = this.oversized;
      this.oversized = undefined;
      if (/^exec2?;/u.test(payload)) this.emit(payload, events);
      chunk = chunk.slice(bell + 1);
    }
    this.buffered += chunk;

    while (this.buffered.length > 0) {
      const start = this.buffered.indexOf(this.prefix);
      if (start === -1) {
        const retained = this.partialPrefixLength(this.buffered);
        const emitLength = this.buffered.length - retained;
        if (emitLength > 0) {
          events.push({kind: 'data', data: this.buffered.slice(0, emitLength)});
          this.buffered = this.buffered.slice(emitLength);
        }
        break;
      }
      if (start > 0) {
        events.push({kind: 'data', data: this.buffered.slice(0, start)});
        this.buffered = this.buffered.slice(start);
      }
      const end = this.buffered.indexOf('\u0007', this.prefix.length);
      if (end === -1) {
        if (this.buffered.length - this.prefix.length > MAX_MARKER_PAYLOAD) {
          this.oversized = this.buffered.slice(this.prefix.length, this.prefix.length + MAX_MARKER_PAYLOAD);
          this.buffered = '';
        }
        break;
      }
      const payload = this.buffered.slice(this.prefix.length, end);
      this.buffered = this.buffered.slice(end + 1);
      if (payload.length <= MAX_MARKER_PAYLOAD || /^exec2?;/u.test(payload)) this.emit(payload.slice(0, MAX_MARKER_PAYLOAD), events);
    }
    return events;
  }

  private emit(payload: string, events: ProtocolEvent[]): void {
    if (/^exec2;[01];/u.test(payload)) {
      events.push({kind: 'exec', command: payload.slice(8), historyAllowed: Number(payload[6])});
      return;
    }
    if (payload.startsWith('exec;')) {
      events.push({kind: 'exec', command: payload.slice(5)});
      return;
    }
    const separator = payload.indexOf(';');
    const statusText = separator === -1 ? payload : payload.slice(0, separator);
    const cwd = separator === -1 ? '' : payload.slice(separator + 1);
    const exitCode = Number.parseInt(statusText, 10);
    if (Number.isFinite(exitCode) && cwd) {
      events.push({kind: 'marker', marker: {exitCode, cwd}});
    }
  }

  private partialPrefixLength(value: string): number {
    const limit = Math.min(value.length, this.prefix.length - 1);
    for (let length = limit; length > 0; length -= 1) {
      if (this.prefix.startsWith(value.slice(-length))) return length;
    }
    return 0;
  }
}
