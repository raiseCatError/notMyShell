import {AnsiOutputParser, type SerializedLine} from './AnsiOutputParser.js';
import {wrapStyledLine, type WrappedRow} from './viewport.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {PresentationMode} from './PresentationMode.js';
import {CommandClassifier} from './Classifier.js';
import {displayWidth, repeatToWidth, truncateText} from '../util/text.js';

const ARCHIVED_CONTEXT = foreground({red: 139, green: 141, blue: 157});
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

export interface HistoricalContextSnapshot {
  cwd: string;
  branch?: string;
}

export interface CompletedCommand {
  command: string;
  output: string;
  lifecycleText: string;
  exitCode: number;
  startId: number;
  outputStartId: number;
  endId?: number;
  expanded?: boolean;
  mode?: PresentationMode;
  historicalContext?: HistoricalContextSnapshot;
}

export interface OutputTranscript {
  records: CompletedCommand[];
  lines: SerializedLine[];
  visualGaps: number[];
  lineTypes: Array<[number, 'command' | 'metadata']>;
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
  private active?: {
    command: string;
    start: number;
    outputStart: number;
    historicalContext?: HistoricalContextSnapshot;
  };
  private classifier?: CommandClassifier;

  constructor(private readonly onClear?: () => void) {
    this.parser = new AnsiOutputParser(() => {
      this.visualGaps.clear();
      this.lineTypes.clear();
      this.historicalContexts.clear();
      this.onClear?.();
    });
  }

  private readonly historicalContexts = new Map<number, HistoricalContextSnapshot>();

  transcript(): OutputTranscript {
    return {
      records: this.completed.map(record => ({
        ...record,
        historicalContext: record.historicalContext ? {...record.historicalContext} : undefined,
      })),
      lines: this.parser.snapshot(),
      visualGaps: [...this.visualGaps],
      lineTypes: [...this.lineTypes.entries()],
    };
  }

  restoreTranscript(transcript: OutputTranscript): void {
    this.parser.restore(transcript.lines);
    this.completed.splice(0, this.completed.length, ...transcript.records.map(record => ({
      ...record,
      historicalContext: record.historicalContext ? {...record.historicalContext} : undefined,
    })));
    this.visualGaps.clear();
    transcript.visualGaps.forEach(index => this.visualGaps.add(index));
    this.lineTypes.clear();
    transcript.lineTypes.forEach(([index, type]) => this.lineTypes.set(index, type));
    this.historicalContexts.clear();
    for (const record of this.completed) {
      if (record.historicalContext && this.lineTypes.get(record.startId) === 'command') {
        this.historicalContexts.set(record.startId, {...record.historicalContext});
      }
    }
    this.active = undefined;
    this.classifier = undefined;
  }

  clearPresentation(): void {
    this.parser.restore([]);
    this.completed.length = 0;
    this.visualGaps.clear();
    this.lineTypes.clear();
    this.historicalContexts.clear();
    this.active = undefined;
    this.classifier = undefined;
  }

  beginCommand(
    command: string,
    formattedLines: string[],
    onModeChange?: (mode: PresentationMode) => void,
    historicalContext?: HistoricalContextSnapshot,
  ): number {
    this.parser.ensureLineBoundary();
    if (this.parser.completedCount() > 0) {
      this.visualGaps.add(this.parser.completedCount());
    }
    const startId = this.parser.completedCount();
    for (let i = 0; i < formattedLines.length; i++) {
      this.lineTypes.set(startId + i, 'command');
      this.parser.addLine(formattedLines[i]);
    }
    if (historicalContext) this.historicalContexts.set(startId, {...historicalContext});
    this.active = {command, start: startId, outputStart: startId + formattedLines.length, historicalContext};
    this.classifier = new CommandClassifier(Date.now(), onModeChange);
    return startId;
  }

  updateCommandHighlight(startId: number, formattedLines: string[]): void {
    for (let i = 0; i < formattedLines.length; i++) {
      this.parser.replaceLine(startId + i, formattedLines[i] ?? '');
    }
  }

  write(data: string): void {
    this.classifier?.pushChunk(data);
    this.parser.write(data);
  }

  tickActiveCommand(): void {
    this.classifier?.tick();
  }

  complete(exitCode: number): CompletedCommand | undefined {
    this.parser.ensureLineBoundary();
    if (!this.active) return undefined;
    const endId = this.parser.completedCount();

    this.classifier?.finalize(exitCode);
    const mode = this.classifier?.mode ?? 'INLINE';
    let expanded = true;
    if (mode === 'FOLDED') expanded = false;

    const record: CompletedCommand = {
      command: this.active.command,
      output: this.parser.snapshotPlain(this.active.outputStart),
      lifecycleText: '',
      exitCode,
      startId: this.active.start,
      outputStartId: this.active.outputStart,
      endId,
      expanded,
      mode,
      historicalContext: this.active.historicalContext ? {...this.active.historicalContext} : undefined,
    };
    this.completed.unshift(record);
    this.active = undefined;
    this.classifier = undefined;
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

      if (this.visualGaps.has(i)) {
        result.push({ansi: '\u001B[0m', plain: '', lineIndex: -1});
      }

      const historicalContext = this.historicalContexts.get(i);
      if (historicalContext) result.push(renderHistoricalContext(historicalContext, width));

      const cmd = this.completed.find(c => c.outputStartId === i);
      if (cmd && cmd.endId !== undefined && cmd.endId > cmd.outputStartId) {
        const hiddenLines = cmd.endId - cmd.outputStartId;
        // Commands are foldable if they have more than 10 lines, or were explicitly collapsed
        const isFoldable = hiddenLines > 10 || !cmd.expanded;
        if (isFoldable) {
          if (!cmd.expanded) {
            const plain = `  ⇡ ${hiddenLines} lines hidden  (Ctrl+O for details)`;
            const ansi = `${foreground(UI_COLORS.secondary)}${plain}\u001B[0m`;
            result.push({
              ansi, plain, lineIndex: cmd.outputStartId, isFoldHint: true, commandIndex: this.completed.indexOf(cmd)
            });
            skipUntil = cmd.endId;
            continue;
          } else {
            const plain = `  ⇣ Collapse output  (Ctrl+O to hide ${hiddenLines} lines)`;
            const ansi = `${foreground(UI_COLORS.secondary)}${plain}\u001B[0m`;
            result.push({
              ansi, plain, lineIndex: cmd.outputStartId, isFoldHint: true, commandIndex: this.completed.indexOf(cmd)
            });
            // Don't skip, let the output render below this hint
          }
        }
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

function renderHistoricalContext(context: HistoricalContextSnapshot, width: number): WrappedRow {
  const cwd = context.cwd.replace(CONTROL_CHARACTERS, '�');
  const branch = context.branch?.replace(CONTROL_CHARACTERS, '�');
  const label = branch ? `${cwd}  ${GLYPHS.branch} ${branch}` : cwd;
  const visibleLabel = truncateText(label, Math.max(0, width - 1));
  const remaining = Math.max(0, width - displayWidth(visibleLabel) - 1);
  const plain = `${visibleLabel} ${repeatToWidth('─', remaining)}`;
  return {ansi: `${ARCHIVED_CONTEXT}${plain}\u001B[0m`, plain, isHistoricalHeader: true};
}
