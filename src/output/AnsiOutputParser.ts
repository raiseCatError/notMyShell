import stringWidth from 'string-width';

export interface StyledCell {
  text: string;
  width: number;
  style: string;
}

export type StyledLine = Array<StyledCell | null | undefined>;

export class AnsiOutputParser {
  readonly lines: StyledLine[] = [];
  private current: StyledLine = [];
  private column = 0;
  private style = '';
  private pending = '';

  constructor(private readonly onClear?: () => void) {}

  write(chunk: string): void {
    const input = this.pending + chunk;
    this.pending = '';
    let index = 0;

    while (index < input.length) {
      const character = input[index] ?? '';
      if (character === '\u001B') {
        const parsed = this.consumeEscape(input, index);
        if (!parsed.complete) {
          this.pending = input.slice(index);
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
        if (previous) previous.text += value;
      } else {
        this.put(value, width);
      }
    }
  }

  addLine(text: string, style = ''): void {
    this.ensureLineBoundary();
    this.style = style;
    this.write(text);
    this.lines.push(this.current);
    this.current = [];
    this.column = 0;
    this.style = '';
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

    this.current = [];
    this.column = 0;
    this.style = '';
    this.pending = '';
    
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
  }

  completedCount(): number {
    return this.lines.length;
  }

  snapshotPlain(start: number): string {
    const selected = this.lines.slice(start).map(line => plainLine(line));
    if (this.current.some(cell => cell !== undefined && cell !== null)) selected.push(plainLine(this.current));
    return selected.join('\n');
  }

  allLines(): StyledLine[] {
    const hasContent = this.current.some(cell => cell !== undefined && cell !== null);
    if (!hasContent) return [...this.lines];
    return [...this.lines, this.current];
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
      const match = /^\u001B\[([0-?]*)([ -/]*)([@-~])/u.exec(input.slice(start));
      if (!match) return {complete: false, next: start};
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
      return {complete: true, next: end + (input[end] === '\u0007' ? 1 : 2)};
    }
    return {complete: true, next: Math.min(input.length, start + 2)};
  }

  private applyCsi(params: string, final: string): void {
    const values = params.replace(/^\?/u, '').split(';').map(value => Number(value || '0'));
    const amount = values[0] || 1;
    if (final === 'm') {
      if (params === '' || values.includes(0)) this.style = '';
      const nonReset = values.filter(value => value !== 0);
      if (nonReset.length > 0) this.style += `\u001B[${nonReset.join(';')}m`;
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
    this.current[this.column] = {text, width, style: this.style};
    for (let position = 1; position < width; position += 1) this.current[this.column + position] = null;
    this.column += width;
  }

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

