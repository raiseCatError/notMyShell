import {applyOutputFilter, type OutputFilter} from './TranscriptSearch.js';
import {AnsiOutputParser, type SerializedLine} from './AnsiOutputParser.js';
import {type WrappedRow} from './viewport.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {PresentationMode} from './PresentationMode.js';
import {CommandClassifier} from './Classifier.js';
import {TranscriptCut} from '../session/TerminalModes.js';
import {type WelcomeCatFrame, type WelcomeSnapshot} from './Welcome.js';
import {shouldAutoFold, shouldFoldAsk, type OutputFoldingMode, type RecordedAskTurn} from './FoldPolicy.js';
import {type PromptSnapshot} from '../prompt/snapshot.js';
import {type TranscriptAppearance} from '../prompt/configuration.js';
import {TranscriptPresenter, type TranscriptView} from './TranscriptPresenter.js';

export {renderHistoricalContext} from './TranscriptPresenter.js';

export interface HistoricalContextSnapshot {
  cwd: string;
  project?: string;
  branch?: string;
  prompt?: PromptSnapshot;
  /** Submitted under Prompt None: there was no prompt, so history renders none (never a substituted Native one). */
  promptless?: true;
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
  /** Only explicitly eligible commands enter command history; transcript retention is separate. */
  historyEligible?: boolean;
  startedAt?: number;
  durationMs?: number;
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
  /** An NMSh-owned block rather than a shell command: never history, /copy or shell-output folding input. */
  frontend?: 'ask';
  /** A recorded Ask conversation: its visible turns as plain text (version 1). Older transcripts lack it. */
  ask?: {version: 1; turns: RecordedAskTurn[]};
}

export interface OutputTranscript {
  welcome?: WelcomeSnapshot;
  records: CompletedCommand[];
  lines: SerializedLine[];
  visualGaps: number[];
  lineTypes: Array<[number, 'command' | 'metadata']>;
}

/** Serialise a completed command into the copy payload (PTY output + lifecycle row). */
/**
 * What /copy and /copy N put on the clipboard: the command's own output (stdout and stderr as the PTY delivered them,
 * line breaks kept), from the record's output field. NMSh's lifecycle row ("✔ Completed · 21.6s · 15:42") is stored
 * separately in `lifecycleText` and is presentation, so it is never part of the payload; neither are folding,
 * activity rows or separators, which never enter `output`. Output that merely looks like a status line is the
 * command's and is kept.
 */
export function serializeCopyPayload(record: CompletedCommand): string {
  return record.output;
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
  /** What of the active command's output is transcript text (see TranscriptCut). */
  private cut?: TranscriptCut;

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
        ...(record.ask ? {ask: {version: 1 as const, turns: record.ask.turns.map(turn => ({role: turn.role, text: turn.text}))}} : {}),
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
    this.cut = undefined;
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
    this.cut = undefined;
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
    this.cut = new TranscriptCut();
    return startId;
  }

  /**
   * Re-open the command a restored transcript was still running: its header
   * and output lines are already in the transcript, so only the active block
   * is re-established and new output continues it.
   */
  resumeActive(command: string, startId: number, outputStartId: number, onModeChange?: (mode: PresentationMode) => void): void {
    this.active = {command, start: startId, outputStart: outputStartId,
      historicalContext: this.historicalContexts.get(startId), activities: []};
    this.classifier = new CommandClassifier(Date.now(), onModeChange);
    this.cut = new TranscriptCut();
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
    const text = this.cut ? this.cut.push(data) : data;
    if (text) this.parser.write(text);
  }

  tickActiveCommand(): void {
    this.classifier?.tick();
  }

  complete(exitCode: number): CompletedCommand | undefined {
    const held = this.cut?.flush();
    if (held) this.parser.write(held);
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
    this.cut = undefined;
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

  /**
   * `authoredLinks`: the result was rendered by NMSh (for example /help) and
   * may carry NMSh-authored OSC 8 links; they are kept as authored cells.
   */
  addFrontendInteraction(command: string, result: string, resultStyle = '', authoredLinks = false): void {
    this.parser.ensureLineBoundary();
    if (this.parser.completedCount() > 0) {
      this.visualGaps.add(this.parser.completedCount());
    }
    this.lineTypes.set(this.parser.completedCount(), 'metadata');
    this.parser.addLine(`${GLYPHS.prompt} ${command}`, foreground(UI_COLORS.command));
    this.lineTypes.set(this.parser.completedCount(), 'metadata');
    if (authoredLinks) this.parser.addAuthoredLine(`  ${GLYPHS.info} ${result}`, resultStyle);
    else this.parser.addLine(`  ${GLYPHS.info} ${result}`, resultStyle);
  }

  /**
   * A recorded Ask conversation as one foldable block: the request is its
   * header line and each visible turn follows as plain rows. Folding comes
   * from the conversation's structure (shouldFoldAsk), and Ctrl+O and the
   * user's own fold choices apply as for any block. While a shell command is
   * running, the conversation is added as plain rows instead.
   */
  addAskInteraction(request: string, turns: readonly RecordedAskTurn[], command: '/btw' | '/ask' = '/btw'): void {
    const body = turns.length ? turns : [{role: 'ask' as const, text: 'Closed without an answer.'}];
    if (this.active) {
      this.addFrontendInteraction(`${command} ${request}`, body.map(turn => turn.text.split('\n').map((line, index) => `${index === 0 ? (turn.role === 'you' ? 'You   ' : 'Ask   ') : '      '}${line}`).join('\n')).join('\n'), '');
      return;
    }
    this.parser.ensureLineBoundary();
    if (this.parser.completedCount() > 0) this.visualGaps.add(this.parser.completedCount());
    const startId = this.parser.completedCount();
    this.lineTypes.set(startId, 'metadata');
    this.parser.addLine(`${GLYPHS.prompt} ${command} ${request}`, foreground(UI_COLORS.command));
    const outputStartId = this.parser.completedCount();
    const plain: string[] = [];
    // Compact exchanges: a role column, then the turn's own lines; a blank row separates exchanges.
    body.forEach((turn, turnIndex) => {
      if (turn.role === 'you' && turnIndex > 0) { plain.push(''); this.lineTypes.set(this.parser.completedCount(), 'metadata'); this.parser.addLine('', ''); }
      turn.text.split('\n').forEach((line, index) => {
        const row = `  ${index === 0 ? (turn.role === 'you' ? 'You   ' : 'Ask   ') : '      '}${line}`;
        plain.push(row);
        this.lineTypes.set(this.parser.completedCount(), 'metadata');
        this.parser.addLine(row, turn.role === 'you' ? foreground(UI_COLORS.primary) : foreground(UI_COLORS.secondary));
      });
    });
    const endId = this.parser.completedCount();
    this.completed.unshift({command: `${command} ${request}`, output: plain.join('\n'), lifecycleText: '', exitCode: 0, startId, outputStartId, endId,
      expanded: !shouldFoldAsk(this.outputFolding, body), frontend: 'ask', ask: {version: 1, turns: body.map(turn => ({role: turn.role, text: turn.text}))}});
  }

  /** The index-th newest shell command record (NMSh-owned blocks such as recorded Ask are skipped). */
  recentShell(index: number): CompletedCommand | undefined {
    return this.completed.filter(record => !record.frontend)[index - 1];
  }

  /** A multi-row NMSh-owned result (for example /agents); presentation rows, never shell output. */
  addFrontendBlock(command: string, rows: readonly string[], authoredLinks = false): void {
    this.parser.ensureLineBoundary();
    if (this.parser.completedCount() > 0) this.visualGaps.add(this.parser.completedCount());
    this.lineTypes.set(this.parser.completedCount(), 'metadata');
    this.parser.addLine(`${GLYPHS.prompt} ${command}`, foreground(UI_COLORS.command));
    for (const row of rows) {
      this.lineTypes.set(this.parser.completedCount(), 'metadata');
      if (authoredLinks) this.parser.addAuthoredLine(`  ${row}`, '');
      else this.parser.addLine(`  ${row}`, '');
    }
  }

  recent(index: number): CompletedCommand | undefined {
    return this.completed[index - 1];
  }

  /** Rows for this transcript as the owned presenter draws them. */
  wrapped(width: number): WrappedRow[] {
    const rows = this.presenter.rows(this.view(), width);
    if (!this.outputFilter) return rows;
    // Cached per presented rows + filter, so frames and hit-tests never re-filter.
    if (this.filterCache?.rows === rows && this.filterCache.filter === this.outputFilter) return this.filterCache.result;
    // Presentation only: stored lines, records and /copy payloads are untouched.
    const result = applyOutputFilter(rows, this.outputFilter, line => !this.lineTypes.has(line));
    this.filterCache = {rows, filter: this.outputFilter, result: result.rows};
    this.filterStatus = {kept: result.kept, total: result.total, ...(result.error ? {error: result.error} : {})};
    return result.rows;
  }

  private outputFilter?: OutputFilter;
  private filterCache?: {rows: WrappedRow[]; filter: OutputFilter; result: WrappedRow[]};
  /** Last applied filter's counts, for status text. */
  filterStatus?: {kept: number; total: number; error?: string};

  /** Show only matching output lines of one block (presentation only); undefined clears it. */
  setOutputFilter(filter: OutputFilter | undefined): void {
    this.outputFilter = filter;
    if (!filter) this.filterStatus = undefined;
  }

  get activeFilter(): OutputFilter | undefined { return this.outputFilter; }

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
      this.userToggled.add(cmd.startId);
    }
  }

  /** Blocks the user expanded or collapsed themselves; advisory hints never override them. */
  private readonly userToggled = new Set<number>();

  /**
   * Advisory folding from a late semantic hint: only for a block the user has
   * not touched. Presentation only; the output itself is never changed.
   */
  applyAdvisoryFold(startId: number, folded: boolean): boolean {
    const record = this.completed.find(item => item.startId === startId);
    if (!record || this.userToggled.has(startId) || record.activities?.length || record.expanded === !folded) return false;
    record.expanded = !folded;
    return true;
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
