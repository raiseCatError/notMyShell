import stringWidth from 'string-width';

export interface StyledCell {
  text: string;
  width: number;
  style: string;
  /** Original program-emitted OSC 8, never generated presentation. */
  hyperlink?: string;
  /**
   * The link was authored by NMSh itself (help, docs, task URLs, NMSh-written
   * files) through addAuthoredLine and passed the authored-target check.
   * Raw PTY links never carry this mark.
   */
  authored?: true;
}

/** Targets NMSh may author: http(s) without credentials, and local file URLs. */
export function authoredTargetAllowed(target: string): boolean {
  if (!target || target.length > 4096 || /[\u0000-\u0020\u007f-\u009f]/u.test(target)) return false;
  try {
    const url = new URL(target);
    if (url.protocol === 'file:') return !url.hostname;
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

const revisions = new WeakMap<StyledLine, number>();
export function lineRevision(line: StyledLine): number { return revisions.get(line) ?? 0; }

export function validOsc8Payload(payload: string): boolean {
  return payload.length <= 4096 && /^8;[^;]*;.+$/u.test(payload)
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(payload);
}

export type StyledLine = Array<StyledCell | null | undefined>;
export type SerializedCell = StyledCell | null | {empty: true};
export type SerializedLine = SerializedCell[];

export class AnsiOutputParser {
  readonly lines: StyledLine[] = [];
  private current: StyledLine = [];
  private column = 0;
  private style = '';
  private pending = '';
  private hyperlink?: string;
  /** While writing an NMSh-authored line: OSC 8 becomes an authored link only for allowed targets. */
  private authoring = false;
  private discardingOsc = false;

  constructor(private readonly onClear?: () => void) {}

  write(chunk: string): void {
    const input = this.pending + chunk;
    this.pending = '';
    let index = 0;
    if (this.discardingOsc) {
      const bell = input.indexOf('\u0007');
      const st = input.indexOf('\u001B\\');
      const end = bell < 0 ? st : st < 0 ? bell : Math.min(bell, st);
      if (end < 0) { this.pending = input.endsWith('\u001B') ? '\u001B' : ''; return; }
      index = end + (input[end] === '\u0007' ? 1 : 2);
      this.discardingOsc = false;
    }

    while (index < input.length) {
      const character = input[index] ?? '';
      if (character === '\u001B') {
        const parsed = this.consumeEscape(input, index);
        if (!parsed.complete) {
          this.pending = input.slice(index);
          if (']PX^_'.includes(input[index + 1] ?? '\u0000') && this.pending.length > 8192) {
            this.discardingOsc = true;
            this.hyperlink = undefined;
            this.pending = input.endsWith('\u001B') ? '\u001B' : '';
          }
          break;
        }
        index = parsed.next;
        continue;
      }
      if (character === '\n') {
        this.lines.push(this.current);
        this.current = [];
        this.column = 0;
        index += 1;
        continue;
      }
      if (character === '\r') {
        this.column = 0;
        index += 1;
        continue;
      }
      if (character === '\b') {
        this.column = Math.max(0, this.column - 1);
        index += 1;
        continue;
      }
      if (character === '\t') {
        const spaces = 8 - (this.column % 8);
        for (let count = 0; count < spaces; count += 1) this.put(' ', 1);
        index += 1;
        continue;
      }
      const codePoint = input.codePointAt(index);
      if (codePoint === undefined) break;
      const value = String.fromCodePoint(codePoint);
      index += value.length;
      if (codePoint < 0x20 || codePoint === 0x7f) continue;
      const width = stringWidth(value);
      if (width === 0) {
        const previous = this.findPreviousCell();
        if (previous) { previous.text += value; this.touch(); }
      } else {
        this.put(value, width);
      }
    }
  }

  /** An NMSh-authored line: its OSC 8 links are marked authored when the target is allowed, dropped otherwise. */
  addAuthoredLine(text: string, style = ''): void {
    this.authoring = true;
    try { this.addLine(text, style); } finally { this.authoring = false; }
  }

  addLine(text: string, style = ''): void {
    this.ensureLineBoundary();
    this.hyperlink = undefined;
    this.style = style;
    this.write(text);
    this.lines.push(this.current);
    this.current = [];
    this.column = 0;
    this.style = '';
    this.hyperlink = undefined;
  }

  ensureLineBoundary(): void {
    if (this.current.some(cell => cell !== undefined && cell !== null)) {
      this.lines.push(this.current);
      this.current = [];
      this.column = 0;
    }
  }

  replaceLine(index: number, text: string): void {
    if (index < 0 || index >= this.lines.length) return;
    const oldCurrent = this.current;
    const oldColumn = this.column;
    const oldStyle = this.style;
    const oldPending = this.pending;
    const oldHyperlink = this.hyperlink;
    const oldDiscardingOsc = this.discardingOsc;

    this.current = [];
    this.column = 0;
    this.style = '';
    this.pending = '';
    this.discardingOsc = false;
    this.hyperlink = undefined;
    
    this.write(text);
    if (this.pending.length > 0) {
      // Flush any remaining characters if write left pending state (e.g. incomplete escape)
      // For simple replacement lines, this shouldn't happen unless malformed, but just in case.
    }
    this.lines[index] = this.current;

    this.current = oldCurrent;
    this.column = oldColumn;
    this.style = oldStyle;
    this.pending = oldPending;
    this.hyperlink = oldHyperlink;
    this.discardingOsc = oldDiscardingOsc;
  }

  completedCount(): number {
    return this.lines.length;
  }

  snapshotPlain(start: number): string {
    const selected = this.lines.slice(start).map(line => plainLine(line));
    if (this.current.some(cell => cell !== undefined && cell !== null)) selected.push(plainLine(this.current));
    return selected.join('\n');
  }

  plainLineAt(index: number): string | undefined {
    const line = this.lines[index];
    return line ? plainLine(line) : undefined;
  }

  plainCurrentLine(): string {
    return plainLine(this.current);
  }

  hasCurrentContent(): boolean {
    return this.current.some(cell => cell !== undefined && cell !== null);
  }

  allLines(): StyledLine[] {
    const hasContent = this.current.some(cell => cell !== undefined && cell !== null);
    if (!hasContent) return [...this.lines];
    return [...this.lines, this.current];
  }

  snapshot(): SerializedLine[] {
    return this.allLines().map(line => Array.from({length: line.length}, (_, index) => {
      const cell = line[index];
      if (cell === undefined) return {empty: true};
      if (cell === null) return null;
      return {...cell};
    }));
  }

  restore(lines: SerializedLine[]): void {
    this.lines.length = 0;
    this.current = [];
    this.column = 0;
    this.style = '';
    this.pending = '';
    this.discardingOsc = false;
    this.hyperlink = undefined;
    for (const line of lines) {
      const restored: StyledLine = line.map(cell => cell === null ? null : 'empty' in cell ? undefined : {...cell});
      this.lines.push(restored);
    }
  }

  trim(maxLines: number): number {
    if (this.lines.length <= maxLines) return 0;
    const removed = this.lines.length - maxLines;
    this.lines.splice(0, removed);
    return removed;
  }

  private consumeEscape(input: string, start: number): {complete: boolean; next: number} {
    const kind = input[start + 1];
    if (kind === undefined) return {complete: false, next: start};
    if (kind === '[') {
      const match = /^\u001B\[([0-?]*)([ -/]*)([@-~])?/u.exec(input.slice(start, start + 4096))!;
      if (match[3] === undefined) {
        // Incomplete at the end of the chunk; a byte that cannot continue a CSI aborts it, as terminals do.
        if (start + match[0].length >= input.length && match[0].length < 4096) return {complete: false, next: start};
        return {complete: true, next: start + match[0].length};
      }
      const params = match[1] ?? '';
      const final = match[3] ?? '';
      this.applyCsi(params, final);
      return {complete: true, next: start + match[0].length};
    }
    if (kind === ']') {
      const bell = input.indexOf('\u0007', start + 2);
      const stringTerminator = input.indexOf('\u001B\\', start + 2);
      const end = bell === -1 ? stringTerminator : stringTerminator === -1 ? bell : Math.min(bell, stringTerminator);
      if (end === -1) return {complete: false, next: start};
      const payload = input.slice(start + 2, end);
      if (payload.startsWith('8;')) {
        const separator = payload.indexOf(';', 2);
        if (separator !== -1) {
          const target = payload.slice(separator + 1);
          // Preserve safe original payloads; reject controls and bound retained data.
          this.hyperlink = target && validOsc8Payload(payload) && (!this.authoring || authoredTargetAllowed(target))
            ? payload : undefined;
        } else this.hyperlink = undefined;
      }
      return {complete: true, next: end + (input[end] === '\u0007' ? 1 : 2)};
    }
    if (kind === 'P' || kind === 'X' || kind === '^' || kind === '_') {
      // DCS, SOS, PM and APC strings (tmux passthrough, XTGETTCAP, kitty graphics) run to ST and are never text.
      const end = input.indexOf('\u001B\\', start + 2);
      return end === -1 ? {complete: false, next: start} : {complete: true, next: end + 2};
    }
    if (kind >= ' ' && kind <= '/') {
      // nF escapes with intermediates: charset designations (ESC ( B), DECALN (ESC # 8), ESC % G. Their final byte is not text.
      const match = /^\u001B[ -/]+[0-~]/u.exec(input.slice(start, start + 8));
      if (match) return {complete: true, next: start + match[0].length};
      return /^\u001B[ -/]*$/u.test(input.slice(start)) ? {complete: false, next: start} : {complete: true, next: start + 2};
    }
    return {complete: true, next: Math.min(input.length, start + 2)};
  }

  /**
   * SGR in order: 0 resets where it appears, and the arguments of extended
   * colours (38/48/58 with 5;n or 2;r;g;b) are never read as attributes, so a
   * zero colour component does not reset the style. Unreadable parameters are dropped.
   */
  private applySgr(params: string): void {
    if (params === '') { this.style = ''; return; }
    const values = params.split(';');
    let kept: string[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index]!;
      if (!/^\d{1,3}(?::[\d:]*)?$/u.test(value || '0')) return;
      const code = Number((value || '0').split(':')[0]);
      if (code === 0) { this.style = ''; kept = []; continue; }
      if ((code === 38 || code === 48 || code === 58) && !value.includes(':')) {
        const width = values[index + 1] === '5' ? 2 : values[index + 1] === '2' ? 4 : 0;
        const args = values.slice(index + 1, index + 1 + width);
        if (width === 0 || args.length < width || !args.every(arg => /^\d{1,3}$/u.test(arg))) return;
        kept.push([value, ...args].join(';'));
        index += width;
        continue;
      }
      kept.push(value);
    }
    if (kept.length > 0) this.style += `\u001B[${kept.join(';')}m`;
  }

  private applyCsi(params: string, final: string): void {
    this.touch();
    const values = params.replace(/^\?/u, '').split(';').map(value => Number(value || '0'));
    const amount = values[0] || 1;
    if (final === 'm') {
      // A private marker makes it another request (`CSI > 4 ; 2 m` is xterm's modifyOtherKeys), not SGR.
      if (/^[<=>?]/u.test(params)) return;
      this.applySgr(params);
    } else if (final === 'K') {
      if ((values[0] ?? 0) === 2) this.current = [];
      else this.current.splice(this.column);
    } else if (final === 'G') {
      this.column = Math.max(0, amount - 1);
    } else if (final === 'C') {
      this.column += amount;
    } else if (final === 'D') {
      this.column = Math.max(0, this.column - amount);
    } else if (final === 'J') {
      if (amount === 2 || amount === 3) {
        this.lines.length = 0;
        this.current = [];
        this.column = 0;
        this.onClear?.();
      }
    }
  }

  private put(text: string, width: number): void {
    for (let position = 0; position < width; position += 1) this.current[this.column + position] = undefined;
    this.current[this.column] = {text, width, style: this.style, ...(this.hyperlink ? {hyperlink: this.hyperlink, ...(this.authoring ? {authored: true as const} : {})} : {})};
    this.touch();
    for (let position = 1; position < width; position += 1) this.current[this.column + position] = null;
    this.column += width;
  }

  private touch(): void { revisions.set(this.current, lineRevision(this.current) + 1); }

  private findPreviousCell(): StyledCell | undefined {
    for (let index = Math.min(this.column - 1, this.current.length - 1); index >= 0; index -= 1) {
      const cell = this.current[index];
      if (cell) return cell;
    }
    return undefined;
  }
}

export function plainLine(line: StyledLine): string {
  let result = '';
  for (const cell of line) {
    if (cell === undefined) result += ' ';
    else if (cell !== null) result += cell.text;
  }
  return result.replace(/\s+$/u, '');
}
