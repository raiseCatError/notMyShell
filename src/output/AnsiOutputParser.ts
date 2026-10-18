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
  /**
   * One cell of the spaces a tab character advanced over (drawn as spaces); `tabSpan` on the first says how many.
   * exactLine writes the tab back when the whole span is still intact.
   */
  tab?: true;
  tabSpan?: number;
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

/**
 * Bound on the bytes of one unfinished control sequence the parser retains
 * across reads. OSC, DCS, SOS, PM and APC strings longer than this switch to
 * discarding: only a trailing ESC is kept (a split ST), memory stays at the
 * bound however long the string runs, its content never becomes text, and
 * parsing resumes after its terminator (BEL or ST for OSC, ST only for the
 * others). Any other unfinished sequence that reaches it (CSI, nF escapes) is
 * abandoned at that point, as a terminal would. C1 forms (U+0080–U+009F) are
 * not interpreted as introducers and are dropped as characters.
 */
export const MAX_CONTROL_SEQUENCE = 8192;

/** The screen height assumed until the owner reports the PTY's rows (a terminal's classic default). */
const DEFAULT_SCREEN_ROWS = 24;

/**
 * The live region (#388). A program may redraw its own recent rows in place, as on a terminal: cursor up/down
 * (`CSI A/B/E/F`, `ESC M/D/E`), save/restore (`ESC 7/8`, `CSI s/u`) and erasing (`CSI J` 0/1, `CSI K` 0/1/2) act on
 * the row the cursor is on. The cursor never moves above the fence (the line after the newest one NMSh wrote: a
 * command header, a notice, an earlier command) nor more than a screen height above the newest line, because a
 * terminal cannot address its scrollback either. So a multi-row progress display updates its rows instead of adding
 * a copy of them per frame, and nothing outside the running program's own rows can be changed. Absolute row
 * positioning (`CSI H/f/d` rows) is not mapped: an inline program cannot know where its rows are, so it keeps the
 * previous behavior. The stored lines are what a terminal would show at the end; intermediate frames are not kept.
 */
export class AnsiOutputParser {
  readonly lines: StyledLine[] = [];
  private current: StyledLine = [];
  /** The cursor's row: an index into `lines`, or `lines.length` for the current (newest) line. */
  private row = 0;
  /** The lowest row the program may address (see the live region). */
  private fence = 0;
  private screenRows = DEFAULT_SCREEN_ROWS;
  /** DECSC / SCOSC saved cursor (row, column, and for ESC 7 the style). */
  private saved?: {row: number; column: number; style?: string};
  private column = 0;
  private style = '';
  private pending = '';
  private hyperlink?: string;
  /** While writing an NMSh-authored line: OSC 8 becomes an authored link only for allowed targets. */
  private authoring = false;
  /**
   * Inside an oversized sequence: 'osc' ends at BEL or ST, 'string' (DCS/SOS/PM/APC) at ST; 'csi' and 'nf'
   * skip their parameter/intermediate bytes and swallow the final byte, so no parameter becomes text.
   */
  private discarding: false | 'osc' | 'string' | 'csi' | 'nf' = false;

  /** Whether the last text written ended a line (see takeEnding); undefined until text arrives. */
  private ending?: boolean;

  /** Whether text written since the last call ended with a line break (true), other text (false), or none (undefined). */
  takeEnding(): boolean | undefined {
    const ending = this.ending;
    this.ending = undefined;
    return ending;
  }

  /** Bytes retained for an unfinished sequence; never above MAX_CONTROL_SEQUENCE. */
  get retainedControlBytes(): number {
    return this.pending.length;
  }

  constructor(private readonly onClear?: () => void) {}

  /** The PTY's rows: how far above the newest line a program's cursor can reach. */
  setScreenRows(rows: number): void {
    this.screenRows = Math.max(1, Math.min(1000, Math.floor(rows) || DEFAULT_SCREEN_ROWS));
  }

  /**
   * Program output from here on may redraw only rows from `index` (clamped to the stored lines); NMSh-written rows
   * and earlier commands stay out of reach. Used when a running command is resumed from a journal.
   */
  fenceAt(index: number): void {
    this.fence = Math.max(0, Math.min(index, this.lines.length));
    this.row = this.lines.length;
    this.saved = undefined;
  }

  /** The line the cursor is on. */
  private get target(): StyledLine {
    return this.row < this.lines.length ? this.lines[this.row]! : this.current;
  }

  /** The highest row the cursor may move to: the fence, or a screen height above the newest line. */
  private get topRow(): number {
    return Math.max(this.fence, this.lines.length - (this.screenRows - 1));
  }

  private moveRow(delta: number): void {
    this.row = Math.max(this.topRow, Math.min(this.lines.length, this.row + delta));
  }

  /** Line feed: down a row, or a new line at the bottom. */
  private lineFeed(): void {
    if (this.row < this.lines.length) { this.row += 1; return; }
    this.lines.push(this.current);
    this.current = [];
    this.row = this.lines.length;
  }

  /** NMSh wrote a line: the cursor returns below it and nothing at or above it can be redrawn. */
  private settle(): void {
    this.row = this.lines.length;
    this.fence = this.lines.length;
    this.saved = undefined;
  }

  write(chunk: string): void {
    const input = this.pending + chunk;
    this.pending = '';
    let index = 0;
    if (this.discarding === 'csi' || this.discarding === 'nf') {
      const body = this.discarding === 'csi' ? /^[0-?\x20-/]*/u : /^[\x20-/]*/u;
      index = body.exec(input)![0].length;
      if (index >= input.length) return;
      if (/[@-~]/u.test(input[index]!) || (this.discarding === 'nf' && /[0-~]/u.test(input[index]!))) index += 1;
      this.discarding = false;
    } else if (this.discarding) {
      const bell = this.discarding === 'osc' ? input.indexOf('\u0007') : -1;
      const st = input.indexOf('\u001B\\');
      const end = bell < 0 ? st : st < 0 ? bell : Math.min(bell, st);
      if (end < 0) { this.pending = input.endsWith('\u001B') ? '\u001B' : ''; return; }
      index = end + (input[end] === '\u0007' ? 1 : 2);
      this.discarding = false;
    }

    while (index < input.length) {
      const character = input[index] ?? '';
      if (character === '\u001B') {
        const parsed = this.consumeEscape(input, index);
        if (!parsed.complete) {
          if (input.length - index < MAX_CONTROL_SEQUENCE) { this.pending = input.slice(index); break; }
          const kind = input[index + 1]!;
          if (kind === '[' || (kind >= ' ' && kind <= '/')) {
            // Oversized CSI or nF: drop what was seen and skip the rest of its body, then its final byte.
            this.discarding = kind === '[' ? 'csi' : 'nf';
            const rest = input.slice(index + 2);
            this.write(rest);
            return;
          }
          this.discarding = kind === ']' ? 'osc' : 'string';
          if (kind === ']') this.hyperlink = undefined;
          this.pending = input.endsWith('\u001B') ? '\u001B' : '';
          break;
        }
        index = parsed.next;
        continue;
      }
      if (character === '\n') {
        this.lineFeed();
        this.column = 0;
        this.ending = true;
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
        for (let count = 0; count < spaces; count += 1) {
          this.put(' ', 1);
          const cell = this.target[this.column - 1]!;
          cell.tab = true;
          if (count === 0) cell.tabSpan = spaces;
        }
        index += 1;
        continue;
      }
      const codePoint = input.codePointAt(index);
      if (codePoint === undefined) break;
      const value = String.fromCodePoint(codePoint);
      index += value.length;
      if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) continue;
      const width = stringWidth(value);
      if (width === 0) {
        const previous = this.findPreviousCell();
        if (previous) { previous.text += value; this.touch(); this.ending = false; }
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
    // Text with its own line breaks or row movement still ends on the newest line.
    this.row = this.lines.length;
    this.lines.push(this.current);
    this.current = [];
    this.column = 0;
    this.style = '';
    this.hyperlink = undefined;
    this.settle();
  }

  ensureLineBoundary(): void {
    if (this.current.some(cell => cell !== undefined && cell !== null)) {
      this.lines.push(this.current);
      this.current = [];
      this.column = 0;
    }
    this.settle();
  }

  replaceLine(index: number, text: string): void {
    if (index < 0 || index >= this.lines.length) return;
    const oldCurrent = this.current;
    const oldColumn = this.column;
    const oldStyle = this.style;
    const oldPending = this.pending;
    const oldHyperlink = this.hyperlink;
    const oldDiscarding = this.discarding;
    const oldRow = this.row;
    const oldFence = this.fence;
    const oldSaved = this.saved;
    const oldLength = this.lines.length;

    this.current = [];
    this.column = 0;
    this.style = '';
    this.pending = '';
    this.discarding = false;
    this.hyperlink = undefined;
    // Replacement text is one line of NMSh's own: it is written as the newest line and cannot reach other rows.
    this.row = this.lines.length;
    this.fence = this.lines.length;
    this.saved = undefined;

    this.write(text);
    // A line break in replacement text would add lines; only the first one replaces the stored line.
    const replaced = this.lines.length > oldLength ? this.lines.splice(oldLength)[0]! : this.current;
    this.lines[index] = replaced;

    this.current = oldCurrent;
    this.column = oldColumn;
    this.style = oldStyle;
    this.pending = oldPending;
    this.hyperlink = oldHyperlink;
    this.discarding = oldDiscarding;
    this.row = oldRow;
    this.fence = oldFence;
    this.saved = oldSaved;
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

  /** A finished line as the program wrote it, tabs included (see exactLine). */
  exactLineAt(index: number): string | undefined {
    const line = this.lines[index];
    return line ? exactLine(line) : undefined;
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
    this.discarding = false;
    this.hyperlink = undefined;
    for (const line of lines) {
      const restored: StyledLine = line.map(cell => cell === null ? null : 'empty' in cell ? undefined : {...cell});
      this.lines.push(restored);
    }
    // A restored transcript is history; a resumed command reopens its own rows with fenceAt.
    this.settle();
  }

  trim(maxLines: number): number {
    if (this.lines.length <= maxLines) return 0;
    const removed = this.lines.length - maxLines;
    this.lines.splice(0, removed);
    this.row = Math.max(0, this.row - removed);
    this.fence = Math.max(0, this.fence - removed);
    if (this.saved) this.saved = {...this.saved, row: Math.max(0, this.saved.row - removed)};
    return removed;
  }

  private consumeEscape(input: string, start: number): {complete: boolean; next: number} {
    const kind = input[start + 1];
    if (kind === undefined) return {complete: false, next: start};
    if (kind === '[') {
      const match = /^\u001B\[([0-?]*)([ -/]*)([@-~])?/u.exec(input.slice(start, start + MAX_CONTROL_SEQUENCE))!;
      if (match[3] === undefined) {
        // Incomplete at the end of the chunk (oversized ones are discarded by write); a byte that cannot continue a CSI aborts it, as terminals do.
        if (start + match[0].length >= input.length || match[0].length >= MAX_CONTROL_SEQUENCE) return {complete: false, next: start};
        return {complete: true, next: start + match[0].length};
      }
      const params = match[1] ?? '';
      const final = match[3] ?? '';
      this.applyCsi(params, final, match[2] ?? '');
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
      const match = /^\u001B[ -/]+[0-~]/u.exec(input.slice(start, start + MAX_CONTROL_SEQUENCE));
      if (match) return {complete: true, next: start + match[0].length};
      const intermediates = /^\u001B[ -/]*/u.exec(input.slice(start, start + MAX_CONTROL_SEQUENCE))![0].length - 1;
      if (start + 1 + intermediates >= input.length || intermediates >= MAX_CONTROL_SEQUENCE - 1) return {complete: false, next: start};
      return {complete: true, next: start + 1 + intermediates};
    }
    // Two-byte escapes that move within the live region; others (keypad modes, RIS…) are dropped as before.
    if (kind === '7') this.saved = {row: this.row, column: this.column, style: this.style};
    else if (kind === '8') this.restoreCursor(true);
    else if (kind === 'M') this.moveRow(-1);
    else if (kind === 'D') { this.lineFeed(); this.ending = true; }
    else if (kind === 'E') { this.lineFeed(); this.column = 0; this.ending = true; }
    return {complete: true, next: Math.min(input.length, start + 2)};
  }

  private restoreCursor(withStyle: boolean): void {
    if (!this.saved) return;
    this.row = Math.max(this.topRow, Math.min(this.lines.length, this.saved.row));
    this.column = this.saved.column;
    if (withStyle && this.saved.style !== undefined) this.style = this.saved.style;
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

  private applyCsi(params: string, final: string, intermediates = ''): void {
    this.touch();
    const values = params.replace(/^\?/u, '').split(';').map(value => Number(value || '0'));
    const amount = values[0] || 1;
    // Row movement, save/restore and partial erases: plain forms only (a private marker or intermediate is another request).
    const plain = !intermediates && !/^[<=>?]/u.test(params);
    if (final === 'm') {
      // A private marker makes it another request (`CSI > 4 ; 2 m` is xterm's modifyOtherKeys), not SGR.
      if (/^[<=>?]/u.test(params)) return;
      this.applySgr(params);
    } else if (final === 'K') {
      const line = this.target;
      const mode = values[0] ?? 0;
      if (mode === 2) line.length = 0;
      else if (mode === 1) { for (let position = 0; position <= this.column && position < line.length; position += 1) line[position] = undefined; }
      else line.splice(this.column);
      this.touch(line);
    } else if (plain && (final === 'A' || final === 'B' || final === 'E' || final === 'F')) {
      this.moveRow(final === 'A' || final === 'F' ? -amount : amount);
      if (final === 'E' || final === 'F') this.column = 0;
    } else if (plain && params === '' && final === 's') {
      this.saved = {row: this.row, column: this.column};
    } else if (plain && params === '' && final === 'u') {
      this.restoreCursor(false);
    } else if (plain && final === 'J' && (values[0] ?? 0) <= 1) {
      this.eraseDisplay(values[0] ?? 0);
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
        this.row = 0;
        this.fence = 0;
        this.saved = undefined;
        this.onClear?.();
      }
    }
  }

  private put(text: string, width: number): void {
    this.ending = false;
    const line = this.target;
    for (let position = 0; position < width; position += 1) line[this.column + position] = undefined;
    line[this.column] = {text, width, style: this.style, ...(this.hyperlink ? {hyperlink: this.hyperlink, ...(this.authoring ? {authored: true as const} : {})} : {})};
    this.touch();
    for (let position = 1; position < width; position += 1) line[this.column + position] = null;
    this.column += width;
  }

  private touch(line: StyledLine = this.target): void { revisions.set(line, lineRevision(line) + 1); }

  private findPreviousCell(): StyledCell | undefined {
    const line = this.target;
    for (let index = Math.min(this.column - 1, line.length - 1); index >= 0; index -= 1) {
      const cell = line[index];
      if (cell) return cell;
    }
    return undefined;
  }

  /** Erase in display within the live region: 0 below the cursor, 1 above it. */
  private eraseDisplay(mode: number): void {
    const line = this.target;
    if (mode === 0) {
      line.splice(this.column);
      if (this.row < this.lines.length) {
        // The cursor's row becomes the newest line; the program's rows below it are gone, as on the screen.
        this.current = line;
        this.lines.length = this.row;
      } else this.touch(line);
      this.touch(this.current);
      return;
    }
    for (let row = this.topRow; row < this.row; row += 1) {
      this.lines[row]!.length = 0;
      this.touch(this.lines[row]!);
    }
    for (let position = 0; position <= this.column && position < line.length; position += 1) line[position] = undefined;
    this.touch(line);
  }
}

/**
 * plainLine, except that a tab whose spaces are all still on the line is written as the tab the program printed.
 * A span something later overwrote (even in part) stays the spaces now shown. Trailing whitespace is trimmed alike.
 */
export function exactLine(line: StyledLine): string {
  let result = '';
  for (let index = 0; index < line.length; index += 1) {
    const cell = line[index];
    const span = cell?.tabSpan ?? 0;
    if (span && Array.from({length: span}, (_, offset) => line[index + offset]).every(item => item?.tab && item.text === ' ')) {
      result += '\t';
      index += span - 1;
    } else if (cell === undefined) result += ' ';
    else if (cell !== null) result += cell.text;
  }
  return result.replace(/\s+$/u, '');
}

export function plainLine(line: StyledLine): string {
  let result = '';
  for (const cell of line) {
    if (cell === undefined) result += ' ';
    else if (cell !== null) result += cell.text;
  }
  return result.replace(/\s+$/u, '');
}
