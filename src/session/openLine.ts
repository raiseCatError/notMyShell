/**
 * The line a running program left the cursor on, as far as its output stream shows it: the evidence a prompt
 * leaves behind ("Fix<y>? ", "Password: ", "Continue? [Y/n] "). Only plain text written left to right counts;
 * a line the program rewrote (carriage-return progress) or drew with cursor addressing is marked unreliable, so
 * a stalled progress bar or a redrawn status line is never mistaken for a question.
 */
const MAX_LINE = 240;
// CSI parameters and intermediates, then the final byte.
const CSI = /^\u001b\[[0-?]*[ -/]*([@-~])/u;
// OSC/DCS/APC/PM/SOS payloads end in BEL or ST.
const STRING = /^\u001b[\]P_^X][\s\S]*?(?:\u0007|\u001b\\)/u;

export class OpenLine {
  private text = '';
  private rewrites = 0;
  private addressed = false;
  private pendingReturn = false;
  private carry = '';

  push(data: string): void {
    const input = this.carry + data;
    this.carry = '';
    let index = 0;
    while (index < input.length) {
      const char = input[index]!;
      if (this.pendingReturn) {
        this.pendingReturn = false;
        if (char !== '\n') { this.text = ''; this.rewrites += 1; }
      }
      if (char === '\u001b') {
        const rest = input.slice(index);
        const csi = CSI.exec(rest);
        if (csi) {
          // Cursor addressing (moves, column/row positioning) means the line is drawn, not written.
          if (/[A-Hdf`]/u.test(csi[1]!)) this.addressed = true;
          index += csi[0].length;
          continue;
        }
        const string = STRING.exec(rest);
        if (string) { index += string[0].length; continue; }
        // Possibly a sequence split across reads: keep a bounded tail for the next chunk.
        if (rest.length < 64 && /^\u001b(?:\[[0-?]*[ -/]*|[\]P_^X][^\u0007]*)?$/u.test(rest)) { this.carry = rest; break; }
        // ESC + one byte (charset, keypad mode): no text.
        index += Math.min(2, rest.length);
        continue;
      }
      if (char === '\n') { this.text = ''; this.rewrites = 0; this.addressed = false; }
      else if (char === '\r') this.pendingReturn = true;
      else if (char === '\b') this.text = [...this.text].slice(0, -1).join('');
      else if (char === '\t') this.text += ' ';
      else if (char >= ' ' && char !== '\u007f') this.text += char;
      index += 1;
    }
    if (this.text.length > MAX_LINE) this.text = this.text.slice(-MAX_LINE);
  }

  reset(): void {
    this.text = '';
    this.rewrites = 0;
    this.addressed = false;
    this.pendingReturn = false;
    this.carry = '';
  }

  /** The visible text left on the cursor's line (trailing spaces kept: they are part of a prompt). */
  get line(): string { return this.pendingReturn ? '' : this.text; }

  /** Rewritten in place or drawn with cursor addressing: not a line written once, so not prompt evidence. */
  get unreliable(): boolean { return this.rewrites > 0 || this.addressed; }

  /** Text was left on the line and nothing rewrote it. */
  get open(): boolean { return this.line.trim() !== '' && !this.unreliable; }
}

/**
 * The shape a question or entry prompt ends in: a question mark, a colon, or a closing bracket/angle that ends a
 * choice list ("[Y/n]", "(yes/no)", "<y>", ">>>"). A line ending in an ellipsis is a status ("Downloading..."),
 * not a request. This is a shape test on the open line only; it never decides anything on its own.
 */
export function promptShaped(line: string): boolean {
  const text = line.trimEnd();
  if (!text || /(?:\.\.\.|…)$/u.test(text)) return false;
  return /[?:>\])»？：]$/u.test(text);
}

/** The prompt as NMSh shows it: one line, control-free, bounded. */
export function promptText(line: string, limit = 120): string | undefined {
  const text = line.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim();
  if (!text) return undefined;
  return text.length > limit ? `…${text.slice(-(limit - 1))}` : text;
}
