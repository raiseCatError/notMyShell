import {AnsiOutputParser, type SerializedLine} from './AnsiOutputParser.js';
import {type WrappedRow} from './viewport.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {PresentationMode} from './PresentationMode.js';
import {CommandClassifier} from './Classifier.js';
import {type WelcomeCatFrame, type WelcomeSnapshot} from './Welcome.js';
import {shouldAutoFold, type OutputFoldingMode} from './FoldPolicy.js';
import {type PromptSnapshot} from '../prompt/snapshot.js';
import {type TranscriptAppearance} from '../prompt/configuration.js';
import {TranscriptPresenter, type TranscriptView} from './TranscriptPresenter.js';

export {renderHistoricalContext} from './TranscriptPresenter.js';

export interface HistoricalContextSnapshot {
  cwd: string;
  project?: string;
  branch?: string;
  prompt?: PromptSnapshot;
}

export interface SecondaryActivity {
  id: string;
  kind: 'tap-stream';
  label: string;
  startedAt: number;
  completedAt?: number;
  status: 'running' | 'completed' | 'failed';
  outputStartId: number;
  outputEndId: number;
  expanded: boolean;
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
  /** Live presentation observed while running; `FOLDED` only in older transcripts. */
  mode?: PresentationMode;
  historicalContext?: HistoricalContextSnapshot;
  activities?: SecondaryActivity[];
}

export interface OutputTranscript {
  welcome?: WelcomeSnapshot;
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
  private welcome?: WelcomeSnapshot;
  /** How rows look; presentation state here is never serialized into transcripts. */
  readonly presenter = new TranscriptPresenter();
  private outputFolding: OutputFoldingMode = 'smart';
  private readonly parser: AnsiOutputParser;
  private readonly completed: CompletedCommand[] = [];
  private readonly visualGaps = new Set<number>();
  public readonly lineTypes = new Map<number, 'command' | 'metadata'>();
  private active?: {
    command: string;
    start: number;
    outputStart: number;
    historicalContext?: HistoricalContextSnapshot;
    activities: SecondaryActivity[];
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
      ...(this.welcome ? {welcome: {...this.welcome, identity: {...this.welcome.identity}}} : {}),
      records: this.completed.map(record => ({
        ...record,
        historicalContext: record.historicalContext ? structuredClone(record.historicalContext) : undefined,
        activities: record.activities?.map(activity => ({...activity})),
      })),
      lines: this.parser.snapshot(),
      visualGaps: [...this.visualGaps],
      lineTypes: [...this.lineTypes.entries()],
    };
  }

  restoreTranscript(transcript: OutputTranscript): void {
    this.welcome = transcript.welcome ? {...transcript.welcome, identity: {...transcript.welcome.identity}} : undefined;
    this.parser.restore(transcript.lines);
    this.completed.splice(0, this.completed.length, ...transcript.records.map(record => ({
      ...record,
      historicalContext: record.historicalContext ? structuredClone(record.historicalContext) : undefined,
      activities: record.activities?.map(activity => ({...activity})),
    })));
    this.visualGaps.clear();
    transcript.visualGaps.forEach(index => this.visualGaps.add(index));
    this.lineTypes.clear();
    transcript.lineTypes.forEach(([index, type]) => this.lineTypes.set(index, type));
    this.historicalContexts.clear();
    for (const record of this.completed) {
      if (record.historicalContext && this.lineTypes.get(record.startId) === 'command') {
        this.historicalContexts.set(record.startId, structuredClone(record.historicalContext));
      }
    }
    this.active = undefined;
    this.classifier = undefined;
  }

  clearPresentation(): void {
    this.welcome = undefined;
    this.parser.restore([]);
    this.completed.length = 0;
    this.visualGaps.clear();
    this.lineTypes.clear();
    this.historicalContexts.clear();
    this.active = undefined;
    this.classifier = undefined;
  }

  /** Applies to commands that finish from now on; existing blocks keep their state. */
  setOutputFolding(mode: OutputFoldingMode): void {
    this.outputFolding = mode;
  }

  setTranscriptAppearance(appearance: TranscriptAppearance): void {
    this.presenter.setAppearance(appearance);
  }

  get hasWelcome(): boolean {
    return Boolean(this.welcome);
  }

  setWelcomeFrame(frame: WelcomeCatFrame): void {
    this.presenter.setWelcomeFrame(frame);
  }

  setWelcome(snapshot: WelcomeSnapshot): void {
    this.welcome = {...snapshot, identity: {...snapshot.identity}};
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
    if (historicalContext) this.historicalContexts.set(startId, structuredClone(historicalContext));
    this.active = {command, start: startId, outputStart: startId + formattedLines.length,
      historicalContext: historicalContext ? structuredClone(historicalContext) : undefined, activities: []};
    this.classifier = new CommandClassifier(Date.now(), onModeChange);
    return startId;
  }

  updateCommandHighlight(startId: number, formattedLines: string[]): void {
    for (let i = 0; i < formattedLines.length; i++) {
      this.parser.replaceLine(startId + i, formattedLines[i] ?? '');
    }
  }

  get activeOutputStartId(): number | undefined {
    return this.active?.outputStart;
  }

  setActiveActivities(activities: SecondaryActivity[]): void {
    if (!this.active) return;
    const previous = new Map(this.active.activities.map(activity => [activity.id, activity]));
    this.active.activities = activities.map(activity => {
      const prior = previous.get(activity.id);
      return {
        ...activity,
        expanded: prior && !(prior.status === 'running' && activity.status !== 'running')
          ? prior.expanded
          : activity.expanded,
      };
    });
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
    const output = this.parser.snapshotPlain(this.active.outputStart);
    // Activity-bearing parents keep their own disclosure; otherwise the fold
    // policy decides from the finished output. Presentation only.
    const autoFolded = this.active.activities.length === 0
      && shouldAutoFold(this.outputFolding, {command: this.active.command, output, exitCode, lineCount: endId - this.active.outputStart,
        ...(this.classifier ? {facts: this.classifier.streamFacts} : {})});
    const expanded = this.active.activities.length === 0 && !autoFolded;

    const record: CompletedCommand = {
      command: this.active.command,
      output,
      lifecycleText: '',
      exitCode,
      startId: this.active.start,
      outputStartId: this.active.outputStart,
      endId,
      expanded,
      mode,
      historicalContext: this.active.historicalContext ? structuredClone(this.active.historicalContext) : undefined,
      activities: this.active.activities.length > 0
        ? this.active.activities.map(activity => ({...activity}))
        : undefined,
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

  /** Rows for this transcript as the owned presenter draws them. */
  wrapped(width: number): WrappedRow[] {
    return this.presenter.rows(this.view(), width);
  }

  /** Read-only view of the transcript data for presentation. */
  view(): TranscriptView {
    return {
      lines: this.parser.allLines(),
      completed: this.completed,
      active: this.active,
      visualGaps: this.visualGaps,
      lineTypes: this.lineTypes,
      historicalContexts: this.historicalContexts,
      welcome: this.welcome,
      ownerOf: this.blockOwnership(),
    };
  }

  /**
   * Maps a source line to the startId of the command block that owns it.
   * Blocks span [startId, endId) from the command records; the running
   * command owns everything from its start onward.
   */
  private blockOwnership(): (lineIndex: number) => number | undefined {
    const blocks = [
      ...this.completed.map(command => ({start: command.startId, end: command.endId ?? Number.POSITIVE_INFINITY})),
      ...(this.active ? [{start: this.active.start, end: Number.POSITIVE_INFINITY}] : []),
    ].filter(block => this.lineTypes.get(block.start) === 'command').sort((a, b) => a.start - b.start);
    return lineIndex => {
      let low = 0;
      let high = blocks.length - 1;
      let found: {start: number; end: number} | undefined;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (blocks[middle]!.start <= lineIndex) { found = blocks[middle]; low = middle + 1; } else high = middle - 1;
      }
      return found && lineIndex < found.end ? found.start : undefined;
    };
  }

  /** The finished, aligned sticky row for a block. */
  presentSticky(startId: number, width: number): string | undefined {
    return this.presenter.presentSticky(this.view(), startId, width);
  }

  /** One-row sticky rendering of a block's submitted command (see the presenter). */
  stickyHeaderRow(startId: number, width: number): string | undefined {
    return this.presenter.stickyHeaderRow(this.view(), startId, width);
  }

  toggleExpanded(commandIndex: number): void {
    const cmd = this.completed[commandIndex];
    if (cmd) {
      cmd.expanded = !cmd.expanded;
    }
  }

  toggleActivityExpanded(activityId: string): void {
    const activities = [
      ...this.completed.flatMap(command => command.activities ?? []),
      ...(this.active?.activities ?? []),
    ];
    const activity = activities.find(candidate => candidate.id === activityId);
    if (activity) activity.expanded = !activity.expanded;
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
