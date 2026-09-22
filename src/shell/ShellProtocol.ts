export interface ShellMarker {
  exitCode: number;
  cwd: string;
}

export type ProtocolEvent =
  | {kind: 'data'; data: string}
  | {kind: 'marker'; marker: ShellMarker};

export class ShellProtocolDecoder {
  private readonly prefix: string;
  private buffered = '';

  constructor(token: string) {
    this.prefix = `\u001B]777;nmsh;${token};`;
  }

  push(chunk: string): ProtocolEvent[] {
    this.buffered += chunk;
    const events: ProtocolEvent[] = [];

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
      if (end === -1) break;
      const payload = this.buffered.slice(this.prefix.length, end);
      this.buffered = this.buffered.slice(end + 1);
      const separator = payload.indexOf(';');
      const statusText = separator === -1 ? payload : payload.slice(0, separator);
      const cwd = separator === -1 ? '' : payload.slice(separator + 1);
      const exitCode = Number.parseInt(statusText, 10);
      if (Number.isFinite(exitCode) && cwd) {
        events.push({kind: 'marker', marker: {exitCode, cwd}});
      }
    }
    return events;
  }

  private partialPrefixLength(value: string): number {
    const limit = Math.min(value.length, this.prefix.length - 1);
    for (let length = limit; length > 0; length -= 1) {
      if (this.prefix.startsWith(value.slice(-length))) return length;
    }
    return 0;
  }
}
