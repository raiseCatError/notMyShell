import {AnsiOutputParser} from './AnsiOutputParser.js';
import {wrapStyledLine, type WrappedRow} from './viewport.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';

export interface CompletedCommand {
  command: string;
  output: string;
  lifecycleText: string;
  exitCode: number;
  startId: number;
  outputStartId: number;
  endId?: number;
  expanded?: boolean;
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
  public readonly lineTypes = new Map<number, 'command' | 'metadata'>();
  private active?: {command: string; start: number; outputStart: number};

  constructor(private readonly onClear?: () => void) {
    this.parser = new AnsiOutputParser(() => {
      this.visualGaps.clear();
      this.lineTypes.clear();
      this.onClear?.();
    });
  }

  beginCommand(command: string, formattedLines: string[]): number {
    this.parser.ensureLineBoundary();
    if (this.parser.completedCount() > 0) {
      this.visualGaps.add(this.parser.completedCount());
    }
    const startId = this.parser.completedCount();
    for (let i = 0; i < formattedLines.length; i++) {
      this.lineTypes.set(startId + i, 'command');
      this.parser.addLine(formattedLines[i]);
    }
    this.active = {command, start: startId, outputStart: startId + formattedLines.length};
    return startId;
  }

  updateCommandHighlight(startId: number, formattedLines: string[]): void {
    for (let i = 0; i < formattedLines.length; i++) {
      this.parser.replaceLine(startId + i, formattedLines[i] ?? '');
    }
  }

  write(data: string): void {
    this.parser.write(data);
  }

  complete(exitCode: number): CompletedCommand | undefined {
    this.parser.ensureLineBoundary();
    if (!this.active) return undefined;
    const endId = this.parser.completedCount();
    const record: CompletedCommand = {
      command: this.active.command,
      output: this.parser.snapshotPlain(this.active.outputStart),
      lifecycleText: '',
      exitCode,
      startId: this.active.start,
      outputStartId: this.active.outputStart,
      endId,
      expanded: endId - this.active.outputStart <= 10,
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
    this.lineTypes.set(this.parser.completedCount(), 'metadata');
    this.parser.addLine(text, style);
  }

  addFrontendInteraction(command: string, result: string, resultStyle = ''): void {
    this.parser.ensureLineBoundary();
    if (this.parser.completedCount() > 0) {
      this.visualGaps.add(this.parser.completedCount());
    }
    this.lineTypes.set(this.parser.completedCount(), 'metadata');
    this.parser.addLine(`${GLYPHS.prompt} ${command}`, foreground(UI_COLORS.command));
    this.lineTypes.set(this.parser.completedCount(), 'metadata');
    this.parser.addLine(`  ${GLYPHS.info} ${result}`, resultStyle);
  }

  recent(index: number): CompletedCommand | undefined {
    return this.completed[index - 1];
  }

  wrapped(width: number): WrappedRow[] {
    const lines = this.parser.allLines();
    const result: WrappedRow[] = [];
    let skipUntil = -1;
    
    for (let i = 0; i < lines.length; i++) {
      if (i < skipUntil) continue;
      
      const cmd = this.completed.find(c => c.outputStartId === i);
      if (cmd && !cmd.expanded && cmd.endId !== undefined && cmd.endId > cmd.outputStartId) {
        const hiddenLines = cmd.endId - cmd.outputStartId;
        const plain = `  ⇡ ${hiddenLines} lines hidden  (Ctrl+O for details)`;
        const ansi = `${foreground(UI_COLORS.secondary)}${plain}\u001B[0m`;
        result.push({
          ansi,
          plain,
          lineIndex: cmd.outputStartId,
          isFoldHint: true,
          commandIndex: this.completed.indexOf(cmd)
        });
        skipUntil = cmd.endId;
        continue;
      }

      if (this.visualGaps.has(i)) {
        result.push({ansi: '\u001B[0m', plain: '', lineIndex: -1});
      }
      const wrappedRows = wrapStyledLine(lines[i], width);
      const cmdIndex = this.completed.findIndex(c => c.startId <= i);
      for (const row of wrappedRows) {
        row.lineIndex = i;
        if (cmdIndex !== -1) row.commandIndex = cmdIndex;
        result.push(row);
      }
    }
    return result;
  }
  
  toggleExpanded(commandIndex: number): void {
    const cmd = this.completed[commandIndex];
    if (cmd) {
      cmd.expanded = !cmd.expanded;
    }
  }

  toggleMostRelevant(focusedLineIndex?: number): void {
    let cmdIndex = -1;
    if (focusedLineIndex !== undefined) {
      cmdIndex = this.completed.findIndex(c => c.startId <= focusedLineIndex);
    } else if (this.completed.length > 0) {
      cmdIndex = 0;
    }
    if (cmdIndex !== -1) {
      this.toggleExpanded(cmdIndex);
    }
  }
}
