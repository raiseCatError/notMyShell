import {BASELINE_CAPABILITIES, type TerminalCapabilities} from '../host/capabilities.js';
import {displayWidth} from '../util/text.js';

export interface TerminalFrame {
  rows: string[];
  cursorRow: number;
  cursorColumn: number;
  cursorVisible?: boolean;
  /** Viewport width; lets the renderer keep rows that fill the last column intact. */
  columns?: number;
}

/**
 * A row that already reaches the final column leaves the terminal in its
 * pending-wrap state with the cursor still on that cell, so a trailing
 * erase-to-end-of-line (surface fills use `CSI K`) would erase the last
 * visible character. Full-width rows need no fill, so their EL is dropped.
 */
export function rowForTerminal(row: string, columns: number | undefined): string {
  if (!columns || !row.includes('\u001B[') || displayWidth(row) < columns) return row;
  return row.replace(/\u001B\[0?K/gu, '');
}

export class TerminalRenderer {
  private previous: string[] = [];
  private active = false;
  private previousCursor?: {row: number; column: number; visible: boolean};

  private suspended = false;
  constructor(private readonly write: (data: string) => unknown = data => process.stdout.write(data),
    private capabilities: Readonly<TerminalCapabilities> = BASELINE_CAPABILITIES) {}

  /** Resolve before entry; an attached foreground app owns its own modes. */
  setCapabilities(capabilities: Readonly<TerminalCapabilities>): void {
    if (this.active) throw new Error('Host capabilities must be resolved before renderer entry');
    this.capabilities = capabilities;
  }

  private inputModes(enable: boolean): string {
    const suffix = enable ? 'h' : 'l';
    let modes = this.capabilities.kittyKeyboard ? (enable ? '\u001B[>1u' : '\u001B[<u') : '';
    modes += `\u001B[?1004${suffix}\u001B[?2004${suffix}`;
    if (this.capabilities.mouseReporting && this.capabilities.clickSupport) {
      modes += `\u001B[?1000${suffix}`;
      if (this.capabilities.mouseMovement) modes += `\u001B[?1003${suffix}`;
      modes += `\u001B[?1006${suffix}`;
    }
    return modes;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    // Push alt screen FIRST, then push kitty mode onto the alt screen's stack
    this.suspended = false;
    this.write(`\u001B[?1049h${this.inputModes(true)}\u001B[?25l\u001B[2J\u001B[H`);
  }

  render(frame: TerminalFrame): void {
    if (!this.active || this.suspended) return;
    const maximum = Math.max(this.previous.length, frame.rows.length);
    const changedRows: number[] = [];
    for (let index = 0; index < maximum; index += 1) {
      const next = frame.rows[index] ?? '';
      if (this.previous[index] !== next) changedRows.push(index);
    }
    const cursor = {
      row: frame.cursorRow,
      column: frame.cursorColumn,
      visible: frame.cursorVisible !== false,
    };
    const cursorChanged = !this.previousCursor
      || cursor.row !== this.previousCursor.row
      || cursor.column !== this.previousCursor.column
      || cursor.visible !== this.previousCursor.visible;
    if (changedRows.length === 0 && !cursorChanged) return;

    let output = '\u001B[?25l';
    for (const index of changedRows) {
      const next = frame.rows[index] ?? '';
      output += `\u001B[${index + 1};1H\u001B[2K${rowForTerminal(next, frame.columns)}\u001B[0m`;
    }
    output += `\u001B[${frame.cursorRow};${frame.cursorColumn}H`;
    if (cursor.visible) output += '\u001B[?25h';
    if (this.capabilities.synchronizedOutput) {
      try { this.write(`\u001B[?2026h${output}`); }
      finally { this.write('\u001B[?2026l'); }
    } else this.write(output);
    this.previous = [...frame.rows];
    this.previousCursor = cursor;
  }

  /** `restore` re-applies the foreground app's own terminal modes, e.g. after reattaching to it. */
  suspendForPassthrough(restore = ''): void {
    if (!this.active || this.suspended) return;
    this.suspended = true;
    // Pop kitty mode while still on the alt screen
    this.write(`${this.inputModes(false)}\u001B[?25h\u001B[2J\u001B[H${restore}`);
    this.previous = [];
    this.previousCursor = undefined;
  }

  resumeAfterPassthrough(): void {
    if (!this.active || !this.suspended) return;
    this.suspended = false;
    this.previous = [];
    this.previousCursor = undefined;
    // Push kitty mode back onto the alt screen
    this.write(`${this.inputModes(true)}\u001B[?25l\u001B[2J\u001B[H`);
  }

  invalidate(): void {
    this.previous = [];
    this.previousCursor = undefined;
  }

  leave(): void {
    if (!this.active) return;
    this.active = false;
    this.previous = [];
    this.previousCursor = undefined;
    // Pop kitty mode first, THEN leave alt screen
    this.write(`\u001B[0m${this.suspended ? '' : this.inputModes(false)}\u001B[?25h\u001B[?1049l`);
  }
}
