import {AnsiOutputParser} from './AnsiOutputParser.js';
import {wrapStyledLine, type WrappedRow} from './viewport.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';

export interface CompletedCommand {
  command: string;
  /** Plain PTY output lines (no ANSI codes). Empty string if no output was produced. */
  output: string;
  /** Plain-text lifecycle/completion row, e.g. "✘ Failed after 0.0s · exit 127 · done 04:12" */
  lifecycleText: string;
  exitCode: number;
}

/** Serialise a completed command into the copy payload (PTY output + lifecycle row). */
export function serializeCopyPayload(record: CompletedCommand): string {
  const parts: string[] = [];
  if (record.output.length > 0) parts.push(record.output);
  if (record.lifecycleText.length > 0) parts.push(record.lifecycleText);
  return parts.join('\n');
}

export class OutputBuffer {
  private readonly parser: AnsiOutputParser;
  private readonly completed: CompletedCommand[] = [];
  private readonly visualGaps = new Set<number>();
  private active?: {command: string; start: number};

  constructor(private readonly onClear?: () => void) {
    this.parser = new AnsiOutputParser(() => {
      this.visualGaps.clear();
      this.onClear?.();
    });
  }

  beginCommand(command: string): void {
    this.parser.ensureLineBoundary();
    if (this.parser.completedCount() > 0) {
      this.visualGaps.add(this.parser.completedCount());
    }
    const lines = command.split('\n');
    this.parser.addLine(`${GLYPHS.prompt} ${lines[0] ?? ''}`, foreground(UI_COLORS.command));
    for (let i = 1; i < lines.length; i++) {
      this.parser.addLine(`  ${lines[i]}`, foreground(UI_COLORS.command));
    }
    this.active = {command, start: this.parser.completedCount()};
  }

  write(data: string): void {
    this.parser.write(data);
  }

  complete(exitCode: number): CompletedCommand | undefined {
    this.parser.ensureLineBoundary();
    if (!this.active) return undefined;
    const record: CompletedCommand = {
      command: this.active.command,
      output: this.parser.snapshotPlain(this.active.start),
      lifecycleText: '',
      exitCode,
    };
    this.completed.unshift(record);
    this.active = undefined;
    return record;
  }

  /**
   * Attach the plain-text lifecycle row to the most recently completed command.
   * Must be called after complete() and before any subsequent beginCommand().
   */
  setCompletionLifecycle(plainText: string): void {
    if (this.completed.length > 0) {
      this.completed[0].lifecycleText = plainText;
    }
  }

  addHistoryLine(text: string, style = ''): void {
    this.parser.ensureLineBoundary();
    if (this.parser.completedCount() > 0) {
      this.visualGaps.add(this.parser.completedCount());
    }
    this.parser.addLine(text, style);
  }

  addFrontendInteraction(command: string, result: string, resultStyle = ''): void {
    this.parser.ensureLineBoundary();
    if (this.parser.completedCount() > 0) {
      this.visualGaps.add(this.parser.completedCount());
    }
    this.parser.addLine(`${GLYPHS.prompt} ${command}`, foreground(UI_COLORS.command));
    this.parser.addLine(`  ${GLYPHS.info} ${result}`, resultStyle);
  }

  recent(index: number): CompletedCommand | undefined {
    return this.completed[index - 1];
  }

  wrapped(width: number): WrappedRow[] {
    const lines = this.parser.allLines();
    const result: WrappedRow[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (this.visualGaps.has(i)) {
        result.push({ansi: '\u001B[0m', plain: ''});
      }
      result.push(...wrapStyledLine(lines[i], width));
    }
    return result;
  }
}
