import {applyOutputFilter, type OutputFilter} from './TranscriptSearch.js';
import {AnsiOutputParser, type SerializedLine} from './AnsiOutputParser.js';
import {type WrappedRow} from './viewport.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {PresentationMode} from './PresentationMode.js';
import {CommandClassifier} from './Classifier.js';
import {TranscriptCut} from '../session/TerminalModes.js';
import {type WelcomeCatFrame, type WelcomeSnapshot} from './Welcome.js';
import {normalizeFirstRunSnapshot, type FirstRunSnapshot} from './FirstRunWelcome.js';
import {foldHighlights, foldWindow, shouldAutoFold, shouldFoldAsk, type OutputFoldingMode, type RecordedAskTurn} from './FoldPolicy.js';
import {type PromptSnapshot} from '../prompt/snapshot.js';
import {type TranscriptAppearance} from '../prompt/configuration.js';
import {TranscriptPresenter, type TranscriptView} from './TranscriptPresenter.js';
import {queueSummaryFrom, SUMMARY_LIMIT, type QueueSummary} from '../session/QueueSummary.js';
import {recognizeOutput, type SemanticResult} from './semantic.js';

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
  /** Wall-clock time from start to completion, waiting included. */
  durationMs?: number;
  /** Of durationMs, the time the command spent waiting for input, and how many waits (see InputWatch). */
  inputWaitMs?: number;
  inputWaits?: number;
  command: string;
  output: string;
  /** The output as the program wrote it for exact copies (tabs kept), stored only when it differs from `output`. */
  copyText?: string;
  /** The program's output ended at a line break: an exact copy ends with one too. */
  outputNewline?: true;
  lifecycleText: string;
  exitCode: number;
  startId: number;
  outputStartId: number;
  endId?: number;
  expanded?: boolean;
  /** Whether this command was started from the command queue. */
  queued?: boolean;
  /** Live presentation observed while running; `FOLDED` only in older transcripts. */
  mode?: PresentationMode;
  historicalContext?: HistoricalContextSnapshot;
  activities?: SecondaryActivity[];
  /** An NMSh-owned block rather than a shell command: never history, /copy or shell-output folding input. */
  frontend?: 'ask';
  /**
   * Some of this command's output was not kept (it finished while no window was attached and the session's
   * retention limit dropped output). Its `output` is what remained; copies, reports and comparisons say so.
   */
  outputIncomplete?: true;
  /** A recorded Ask conversation: its visible turns as plain text (version 1). Older transcripts lack it. */
  ask?: {version: 1; turns: RecordedAskTurn[]};
}

export interface OutputTranscript {
  welcome?: WelcomeSnapshot;
  /** The first-run welcome, when a genuine first run applied NMSh Recommended (version 1). */
  firstRun?: FirstRunSnapshot;
  records: CompletedCommand[];
  lines: SerializedLine[];
  visualGaps: number[];
  lineTypes: Array<[number, 'command' | 'metadata']>;
  /**
   * The session's saved Queue Summaries, oldest first: typed metadata about observed chains, never output and never
   * a record. Display surfaces draw it; /copy, compare, search and exports read only records and lines.
   */
  queueSummaries?: QueueSummary[];
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
  // As the program wrote it: its tabs, and its final line break when it ended with one.
  const exact = record.copyText ?? record.output;
  return exact && record.outputNewline ? `${exact}\n` : exact;
}

/** Stored line text, compared as the transcript draws it: trailing blanks are not content. */
const sameText = (left: string, right: string) => left.split('\n').map(line => line.trimEnd()).join('\n')
  === right.split('\n').map(line => line.trimEnd()).join('\n');

/**
 * The records of a stored transcript that still own their lines, newest first. Transcripts saved before screen
 * clears retired their blocks keep records whose line ids now name other commands' lines; drawing them put one
 * command's fold row inside another command's output. A bounds check alone cannot tell them apart, so each record
 * must also show the evidence the format keeps:
 * - its range lies within the stored lines and ends where the next newer block begins, or earlier;
 * - its header lines are command lines (an Ask block's header is NMSh's own line), unless it is a command that
 *   cleared the screen, which owns its output from line 0 with no header;
 * - the lines it covers read as the output it recorded.
 * A record that fails marks a clear the format did not record, so it and every older record are dropped: their
 * lines stay in the transcript as plain rows, never attributed to a command that did not write them.
 */
export function placeableRecords(records: readonly CompletedCommand[], lines: readonly string[], lineTypes: ReadonlyMap<number, 'command' | 'metadata'>): CompletedCommand[] {
  let limit = lines.length;
  const placed: CompletedCommand[] = [];
  for (const record of records) {
    const end = record.endId ?? limit;
    const inRange = Number.isSafeInteger(record.startId) && Number.isSafeInteger(record.outputStartId) && Number.isSafeInteger(end)
      && record.startId >= 0 && record.startId <= record.outputStartId && record.outputStartId <= end && end <= limit;
    if (!inRange) break;
    const headerLines = Array.from({length: record.outputStartId - record.startId}, (_, offset) => lineTypes.get(record.startId + offset));
    const header = record.frontend === 'ask'
      ? headerLines.length > 0 && headerLines.every(type => type === 'metadata')
      : headerLines.length > 0 ? headerLines.every(type => type === 'command') : record.startId === 0;
    // A shell command's output leaves out NMSh's own lines inside its block; records saved before that rule kept them.
    const covered = lines.slice(record.outputStartId, end);
    const own = record.frontend === 'ask' ? covered : covered.filter((_, offset) => lineTypes.get(record.outputStartId + offset) !== 'metadata');
    if (!header || !(sameText(own.join('\n'), record.output) || sameText(covered.join('\n'), record.output))) break;
    placed.push(record);
    limit = record.startId;
  }
  return placed;
}

export class OutputBuffer {
  /** Changes whenever line/start IDs can be reused; selectors must not cross this boundary. */
  private generation = 0;
  get presentationGeneration(): number { return this.generation; }
  private welcome?: WelcomeSnapshot;
  private firstRun?: FirstRunSnapshot;
  private welcomeVisible = true;

  /** Presentation preference only: archives retain their original welcome snapshot. */
  setWelcomeVisible(visible: boolean): void { this.welcomeVisible = visible; }
  /** How rows look; presentation state here is never serialized into transcripts. */
  readonly presenter = new TranscriptPresenter();
  private outputFolding: OutputFoldingMode = 'smart';
  /** Semantic Output (#386): readings of completed output, derived and never stored; details open/closed per block. */
  private semanticOutput = true;
  private readonly semanticReadings = new WeakMap<CompletedCommand, SemanticResult | null>();
  private readonly semanticDetails = new Map<number, boolean>();
  /** /track: the stored line each live result is drawn under (line id → tracker id), and who draws it. */
  private readonly trackAnchors = new Map<number, string>();
  private liveRowsProvider?: (id: string, width: number) => readonly string[];
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
    /** Its output cleared the screen: its header and earlier lines are gone. */
    cleared?: boolean;
    /** The program's last text ended a line (see endsLine). */
    endsLine?: boolean;
  };
  private classifier?: CommandClassifier;
  /** What of the active command's output is transcript text (see TranscriptCut). */
  private cut?: TranscriptCut;
  /** The session's saved summaries, newest last; bounded by the owner's own limit. */
  private queueSummaryList: QueueSummary[] = [];

  constructor(private readonly onClear?: () => void) {
    this.parser = new AnsiOutputParser(() => {
      this.generation++;
      this.visualGaps.clear();
      this.lineTypes.clear();
      this.historicalContexts.clear();
      this.retireClearedBlocks();
      this.onClear?.();
    });
  }

  /**
   * A screen clear (`clear`, `ESC[2J`, `ESC[3J`) removes every stored line, so every block those lines belonged to
   * goes with them: a record left behind would keep line ids that now name another command's lines, and its fold
   * row, ownership and toggles would land inside that command. The running command keeps its identity and owns
   * what it writes after the clear, from the first line on.
   */
  private retireClearedBlocks(): void {
    this.completed.length = 0;
    this.userToggled.clear();
    this.semanticDetails.clear();
    this.trackAnchors.clear();
    this.setOutputFilter(undefined);
    if (!this.active) return;
    this.active.start = 0;
    this.active.outputStart = 0;
    this.active.historicalContext = undefined;
    // Activity ranges were counted before the clear; none of them can be placed again.
    this.active.activities = [];
    this.active.cleared = true;
  }

  private readonly historicalContexts = new Map<number, HistoricalContextSnapshot>();

  private savedWelcome(): WelcomeSnapshot {
    // Runtime layout includes a private asset path; only the final portable still is durable.
    const {studio, ...snapshot} = this.welcome!;
    // Never a private asset path. A customized card that was never painted keeps its layout (without the path) so the
    // archive does not fall back to the historical card.
    if (snapshot.still || !studio?.customized) return structuredClone(snapshot);
    const {assetPath: _path, ...layout} = studio;
    return structuredClone({...snapshot, studio: layout as typeof studio});
  }

  transcript(): OutputTranscript {
    return {
      ...(this.welcome ? {welcome: this.savedWelcome()} : {}),
      ...(this.firstRun ? {firstRun: {...this.firstRun}} : {}),
      records: this.completed.map(record => ({
        ...record,
        historicalContext: record.historicalContext ? structuredClone(record.historicalContext) : undefined,
        activities: record.activities?.map(activity => ({...activity})),
        ...(record.ask ? {ask: {version: 1 as const, turns: record.ask.turns.map(turn => ({role: turn.role, text: turn.text}))}} : {}),
      })),
      lines: this.parser.snapshot(),
      visualGaps: [...this.visualGaps],
      lineTypes: [...this.lineTypes.entries()],
      ...(this.queueSummaryList.length ? {queueSummaries: this.queueSummaryList.map(summary => structuredClone(summary))} : {}),
    };
  }

  /** The session's saved summaries as this presentation holds them, newest last. */
  get queueSummaries(): readonly QueueSummary[] {
    return this.queueSummaryList;
  }

  /** Replace the presentation's summaries with the owner's exact list; nothing here is ever replayed or executed. */
  setQueueSummaries(summaries: readonly QueueSummary[]): void {
    this.queueSummaryList = summaries.slice(-SUMMARY_LIMIT).map(summary => structuredClone(summary));
  }

  restoreTranscript(transcript: OutputTranscript): void {
    this.generation++;
    this.welcome = transcript.welcome ? {...transcript.welcome, identity: {...transcript.welcome.identity}} : undefined;
    // An unknown version is refused, never guessed at.
    this.firstRun = normalizeFirstRunSnapshot(transcript.firstRun);
    this.parser.restore(transcript.lines);
    const lines = Array.from({length: this.parser.completedCount()}, (_, index) => this.parser.plainLineAt(index) ?? '');
    this.completed.splice(0, this.completed.length, ...placeableRecords(transcript.records, lines, new Map(transcript.lineTypes)).map(record => ({
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
    // A restored transcript adopts its own summaries; malformed journal data is refused, never guessed.
    this.queueSummaryList = (transcript.queueSummaries ?? []).slice(-SUMMARY_LIMIT)
      .map(summary => queueSummaryFrom(summary)).filter((summary): summary is QueueSummary => summary !== undefined);
  }

  clearPresentation(): void {
    this.generation++;
    this.welcome = undefined;
    this.firstRun = undefined;
    this.parser.restore([]);
    this.completed.length = 0;
    this.semanticDetails.clear();
    this.trackAnchors.clear();
    this.visualGaps.clear();
    this.lineTypes.clear();
    this.historicalContexts.clear();
    this.active = undefined;
    this.classifier = undefined;
    this.cut = undefined;
    this.queueSummaryList = [];
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

  /** The first-run welcome joins the transcript once; it is never replaced or added again. */
  setFirstRunWelcome(snapshot: FirstRunSnapshot): void {
    this.firstRun ??= {...snapshot};
  }

  get hasFirstRunWelcome(): boolean {
    return Boolean(this.firstRun);
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
  resumeActive(command: string, startId: number, outputStartId: number, onModeChange?: (mode: PresentationMode) => void): {cleared: boolean} {
    this.active = {command, start: startId, outputStart: outputStartId,
      historicalContext: this.historicalContexts.get(startId), activities: []};
    this.classifier = new CommandClassifier(Date.now(), onModeChange);
    this.cut = new TranscriptCut();
    // A command that cleared the screen owns its output from line 0 (see retireClearedBlocks). A journal from before
    // that rule kept its pre-clear position: a header that is no longer a command line, or a start inside or past
    // the stored blocks, means the clear happened while it ran, so it owns everything stored and nothing older stays.
    const after = this.completed[0]?.endId ?? 0;
    const header = outputStartId > startId
      && Array.from({length: outputStartId - startId}, (_, offset) => this.lineTypes.get(startId + offset)).every(type => type === 'command');
    const placed = startId >= after && outputStartId <= this.parser.completedCount() && (header || (startId === 0 && outputStartId === 0));
    if (!placed) this.retireClearedBlocks();
    else if (!header) this.active.cleared = true;
    // The resumed command may go on redrawing its own rows (not NMSh's lines written into its block meanwhile).
    let ownRows = placed ? outputStartId : 0;
    for (let line = ownRows; line < this.parser.completedCount(); line += 1) if (this.lineTypes.has(line)) ownRows = line + 1;
    this.parser.fenceAt(ownRows);
    return {cleared: Boolean(this.active.cleared)};
  }

  /** The PTY's rows, which bound how far a program's output can redraw rows above its newest line. */
  setScreenRows(rows: number): void {
    this.parser.setScreenRows(rows);
  }

  /** The PTY's columns: a program's long lines occupy rows at this width when it moves its cursor over them. */
  setScreenColumns(columns: number): void {
    this.parser.setScreenColumns(columns);
  }

  updateCommandHighlight(startId: number, formattedLines: string[]): void {
    for (let i = 0; i < formattedLines.length; i++) {
      this.parser.replaceLine(startId + i, formattedLines[i] ?? '');
    }
  }

  get activeStartId(): number | undefined {
    return this.active?.start;
  }

  get activeOutputStartId(): number | undefined {
    return this.active?.outputStart;
  }

  setActiveActivities(activities: SecondaryActivity[]): void {
    if (!this.active || this.active.cleared) return;
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
    if (text) this.writeProgramText(text);
  }

  /** Program output (never NMSh's own lines): drawn, and whether it last ended a line is remembered for exact copies. */
  private writeProgramText(text: string): void {
    // The parser's own reading of the text: escapes (even split across writes) are not text. NMSh's lines don't count.
    this.parser.takeEnding();
    this.parser.write(text);
    const ends = this.parser.takeEnding();
    if (ends !== undefined && this.active) this.active.endsLine = ends;
  }

  tickActiveCommand(): void {
    this.classifier?.tick();
  }

  /** Options passed when a command block settles. Presentation only. */
  complete(exitCode: number, options: {holdOpen?: boolean; queued?: boolean; foldQueued?: boolean; interrupted?: boolean} = {}): CompletedCommand | undefined {
    const held = this.cut?.flush();
    if (held) this.writeProgramText(held);
    this.parser.ensureLineBoundary();
    if (!this.active) return undefined;
    const endId = this.parser.completedCount();

    this.classifier?.finalize(exitCode);
    const mode = this.classifier?.mode ?? 'INLINE';
    const output = this.commandOutput(this.active.outputStart, endId);
    const exact = this.commandOutput(this.active.outputStart, endId, true);
    const lineCount = endId - this.active.outputStart;
    const isInterrupted = Boolean(options.interrupted || exitCode === 130);
    const isFailed = exitCode !== 0 || isInterrupted;

    // Activity-bearing parents keep their own disclosure; otherwise the fold policy decides from the finished output.
    // Queued commands: never fold failed or interrupted commands (critical failure facts stay visible).
    // If foldQueued is set (outputDisplay === 'fold') and command succeeded with output, start folded.
    let autoFolded = false;
    if (this.active.activities.length === 0 && !options.holdOpen) {
      if (options.queued) {
        if (!isFailed && options.foldQueued && lineCount > 0) {
          autoFolded = true;
        }
      } else {
        autoFolded = shouldAutoFold(this.outputFolding, {command: this.active.command, output, exitCode, lineCount,
          ...(this.classifier ? {facts: this.classifier.streamFacts} : {})});
      }
    }
    const expanded = this.active.activities.length === 0 && !autoFolded;

    const record: CompletedCommand = {
      command: this.active.command,
      output,
      ...(exact !== output ? {copyText: exact} : {}),
      ...(output && this.active.endsLine ? {outputNewline: true as const} : {}),
      lifecycleText: '',
      exitCode,
      startId: this.active.start,
      outputStartId: this.active.outputStart,
      endId,
      expanded,
      ...(options.queued ? {queued: true as const} : {}),
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
   * What a command wrote: its block's lines without the ones NMSh added while it ran (a /copy confirmation, an Ask
   * exchange, a notice). Those stay where they were shown, but they were never the command's output.
   */
  private commandOutput(start: number, end: number, exact = false): string {
    const lines: string[] = [];
    for (let index = start; index < end; index += 1) {
      if (this.lineTypes.get(index) !== 'metadata') lines.push((exact ? this.parser.exactLineAt(index) : this.parser.plainLineAt(index)) ?? '');
    }
    return lines.join('\n');
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

  /** Completed shell command records, newest first, as /copy numbers them (NMSh-owned blocks such as recorded Ask are skipped). */
  recentShellCommands(): CompletedCommand[] {
    return this.completed.filter(record => !record.frontend);
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
      // The first-run welcome keeps Vespyr's block with it, whatever the recurring welcome preference.
      welcome: this.welcomeVisible || this.firstRun ? this.welcome : undefined,
      firstRun: this.firstRun,
      ownerOf: this.blockOwnership(),
      foldHighlights: record => this.foldHighlightsFor(record),
      // Only a transcript with /track blocks pays for the per-line lookup.
      ...(this.trackAnchors.size ? {liveRows: (line: number, width: number) => {
        const id = this.trackAnchors.get(line);
        return id === undefined ? undefined : this.liveRowsProvider?.(id, width);
      }} : {}),
      semantic: record => {
        const result = this.semanticFor(record);
        return result ? {result, open: this.semanticDetailsOpen(record, result)} : undefined;
      },
    };
  }

  setSemanticOutput(on: boolean): void { this.semanticOutput = on; }

  /** Who draws each /track block's live rows (presentation only; nothing it returns is stored). */
  setLiveRows(provider: (id: string, width: number) => readonly string[]): void { this.liveRowsProvider = provider; }

  /**
   * A /track block: NMSh's lines for the command, stored once like any frontend block; the tracker's live result is
   * drawn under its last line and replaced in place on every refresh. Returns that line's id.
   */
  addTrackBlock(id: string, command: string, rows: readonly string[]): number {
    this.addFrontendBlock(command, rows);
    const anchor = this.parser.completedCount() - 1;
    this.trackAnchors.set(anchor, id);
    return anchor;
  }


  /**
   * The block's Semantic Output reading, computed once per record from its stored output (never stored, so a resumed
   * transcript reads it again lazily). Only shell commands with output are read; Off reads nothing.
   */
  semanticFor(record: CompletedCommand): SemanticResult | undefined {
    if (!this.semanticOutput || record.frontend || record.activities?.length || !record.output) return undefined;
    let reading = this.semanticReadings.get(record);
    if (reading === undefined) {
      reading = recognizeOutput(record.command, record.output, record.exitCode) ?? null;
      this.semanticReadings.set(record, reading);
    }
    // The usefulness gate: a short, passing output already reads well; a listing of failures is always worth it.
    if (!reading || (reading.outcome === 'passed' && !reading.items.length && record.output.split('\n').length < 10)) return undefined;
    return reading;
  }

  /** Details start open when the raw output is folded (they are what it hides), closed when it is expanded. */
  semanticDetailsOpen(record: CompletedCommand, result = this.semanticFor(record)): boolean {
    if (!result?.items.length) return false;
    return this.semanticDetails.get(record.startId) ?? !record.expanded;
  }

  toggleSemanticDetails(startId: number): boolean {
    const record = this.completed.find(item => item.startId === startId);
    const result = record && this.semanticFor(record);
    if (!record || !result?.items.length) return false;
    this.semanticDetails.set(startId, !this.semanticDetailsOpen(record, result));
    return true;
  }

  /** Important hidden lines of a collapsed block, by line id; computed on first draw and kept per block identity. */
  private readonly highlightCache = new Map<string, readonly number[]>();
  private foldHighlightsFor(record: CompletedCommand): readonly number[] {
    if (record.endId === undefined) return [];
    const key = `${record.startId}:${record.outputStartId}:${record.endId}`;
    const cached = this.highlightCache.get(key);
    if (cached) return cached;
    const {head, tail} = foldWindow(record.endId - record.outputStartId);
    const from = record.outputStartId + head;
    const to = record.endId - tail;
    // Only the command's own lines: NMSh's lines inside the block are never highlighted as its output.
    const lines: string[] = [];
    for (let id = from; id < to; id += 1) lines.push(this.lineTypes.get(id) !== 'metadata' ? this.parser.plainLineAt(id) ?? '' : '');
    const picked = foldHighlights(lines, 0, lines.length).map(index => from + index);
    if (this.highlightCache.size > 512) this.highlightCache.clear();
    this.highlightCache.set(key, picked);
    return picked;
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
  presentSticky(startId: number, width: number, trailing = '', trailingWidth = 0): string | undefined {
    return this.presenter.presentSticky(this.view(), startId, width, trailing, trailingWidth);
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

  /**
   * Unfold these blocks (by startId) as the person's own choice: hints never fold them again, and they can still be
   * collapsed by hand. Unknown ids (a cleared or replaced block) are ignored; nothing else changes.
   */
  expandBlocks(startIds: readonly number[]): void {
    for (const startId of startIds) {
      const record = this.completed.find(item => item.startId === startId);
      if (!record || record.expanded) continue;
      record.expanded = true;
      this.userToggled.add(startId);
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
