import {BASELINE_CAPABILITIES, type TerminalCapabilities} from '../host/capabilities.js';
import {AlternateScreenTracker} from '../session/TerminalModes.js';
import {displayWidth} from '../util/text.js';

/** DECSCUSR reset: the terminal's own configured cursor. */
export const CURSOR_RESET = '\u001B[0 q';

/**
 * DECSCUSR for a caret choice, or '' for Host default (NMSh then sends
 * nothing). Blink "Host default" with a chosen shape uses the blinking form,
 * which is the xterm default for that shape. Terminals without DECSCUSR
 * ignore the sequence and keep their own cursor.
 */
export function cursorStyleSequence(shape: 'host' | 'block' | 'bar' | 'underline', blink: 'host' | 'on' | 'off'): string {
  if (shape === 'host') return '';
  const steady = blink === 'off' ? 1 : 0;
  const base = shape === 'block' ? 1 : shape === 'underline' ? 3 : 5;
  return `\u001B[${base + steady} q`;
}

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
  /** NMSh's caret style while it owns the composer; '' leaves the host's cursor alone. */
  private cursorStyle = '';
  private readonly childModes = new AlternateScreenTracker();
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

  /**
   * Absolute terminal state for when the foreground program's ownership ends, however it ended (a program
   * killed with SIGKILL cannot undo its own modes). Everything NMSh could have inherited is set or reset
   * explicitly, so the physical terminal equals NMSh's desired state rather than relying on a clean exit.
   * `desired` keeps the modes NMSh itself needs; otherwise they are all released.
   */
  private reconcileModes(desired: boolean): string {
    const wanted = new Set<number>();
    if (desired && this.capabilities.mouseReporting && this.capabilities.clickSupport) {
      wanted.add(1000); wanted.add(1006);
      if (this.capabilities.mouseMovement) wanted.add(1003);
    }
    // Child entries belong to independent screen stacks; inherited entries stay intact.
    let sequence = this.childModes.releaseKeyboardSequence();
    for (const mode of [1000, 1002, 1003, 1005, 1006, 1015]) if (!wanted.has(mode)) sequence += `\u001B[?${mode}l`;
    // Keypad and cursor-key modes are never wanted by NMSh's own composer.
    sequence += '\u001B>\u001B[?1l';
    return sequence + (desired ? this.inputModes(true) : `\u001B[?1004l\u001B[?2004l`);
  }

  /**
   * Applied only while NMSh owns the editable composer: written on entry and
   * after passthrough, reset to the host default on passthrough and exit.
   */
  setCursorStyle(sequence: string): void {
    if (sequence === this.cursorStyle) return;
    const previous = this.cursorStyle;
    this.cursorStyle = sequence;
    if (!this.active || this.suspended) return;
    this.write(sequence || (previous ? CURSOR_RESET : ''));
  }

  get currentCursorStyle(): string {
    return this.cursorStyle;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    // Push alt screen FIRST, then push kitty mode onto the alt screen's stack
    this.suspended = false;
    this.write(`\u001B[?1049h${this.inputModes(true)}\u001B[?25l\u001B[2J\u001B[H${this.cursorStyle}`);
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
    this.childModes.reset('alternate');
    this.childModes.observeModes(restore);
    // The foreground program gets the host's own cursor, not NMSh's caret style.
    this.write(`${this.inputModes(false)}${this.cursorStyle ? CURSOR_RESET : ''}\u001B[?25h\u001B[2J\u001B[H${restore}`);
    this.previous = [];
    this.previousCursor = undefined;
  }

  /** Observe only bytes actually sent to the host terminal while the child owns it. */
  observePassthrough(data: string): void {
    if (this.suspended) this.childModes.observeModes(data);
  }

  resumeAfterPassthrough(): void {
    if (!this.active || !this.suspended) return;
    this.suspended = false;
    this.previous = [];
    this.previousCursor = undefined;
    // Clean each child keyboard stack on its own screen, finish on alternate,
    // then restore NMSh's modes even if the child exited abnormally.
    this.write(`${this.reconcileModes(true)}${this.cursorStyle}\u001B[?25l\u001B[2J\u001B[H`);
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
    // Suspended means a foreground program still owns the terminal: release whatever it left, not just NMSh's own modes.
    this.write(`\u001B[0m${this.suspended ? this.reconcileModes(false) : this.inputModes(false)}${this.cursorStyle ? CURSOR_RESET : ''}\u001B[?25h\u001B[?1049l`);
  }
}
