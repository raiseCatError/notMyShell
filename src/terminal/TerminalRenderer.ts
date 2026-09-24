export interface TerminalFrame {
  rows: string[];
  cursorRow: number;
  cursorColumn: number;
  cursorVisible?: boolean;
}

export class TerminalRenderer {
  private previous: string[] = [];
  private active = false;
  private previousCursor?: {row: number; column: number; visible: boolean};

  constructor(private readonly write: (data: string) => unknown = data => process.stdout.write(data)) {}

  enter(): void {
    if (this.active) return;
    this.active = true;
    // Push alt screen FIRST, then push kitty mode onto the alt screen's stack
    this.write('\u001B[?1049h\u001B[>1u\u001B[?2004h\u001B[?1000h\u001B[?1003h\u001B[?1006h\u001B[?1004h\u001B[?25l\u001B[2J\u001B[H');
  }

  render(frame: TerminalFrame): void {
    if (!this.active) return;
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
      output += `\u001B[${index + 1};1H\u001B[2K${next}\u001B[0m`;
    }
    output += `\u001B[${frame.cursorRow};${frame.cursorColumn}H`;
    if (cursor.visible) output += '\u001B[?25h';
    this.write(output);
    this.previous = [...frame.rows];
    this.previousCursor = cursor;
  }

  suspendForPassthrough(): void {
    if (!this.active) return;
    // Pop kitty mode while still on the alt screen
    this.write('\u001B[?1004l\u001B[?1006l\u001B[?1003l\u001B[?1000l\u001B[?2004l\u001B[?25h\u001B[<u\u001B[2J\u001B[H');
    this.previous = [];
    this.previousCursor = undefined;
  }

  resumeAfterPassthrough(): void {
    if (!this.active) return;
    this.previous = [];
    this.previousCursor = undefined;
    // Push kitty mode back onto the alt screen
    this.write('\u001B[>1u\u001B[?1000h\u001B[?1003h\u001B[?1006h\u001B[?1004h\u001B[?2004h\u001B[?25l\u001B[2J\u001B[H');
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
    this.write('\u001B[0m\u001B[?1004l\u001B[?1006l\u001B[?1003l\u001B[?1000l\u001B[?2004l\u001B[?25h\u001B[<u\u001B[?1049l');
  }
}
