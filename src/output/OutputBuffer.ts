import {AnsiOutputParser, type SerializedLine} from './AnsiOutputParser.js';
import {wrapStyledLine, type WrappedRow} from './viewport.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {PresentationMode} from './PresentationMode.js';
import {CommandClassifier} from './Classifier.js';
import {displayWidth, repeatToWidth, stripAnsi, truncateAnsi, truncateText} from '../util/text.js';
import {formatDuration} from '../status/commandTiming.js';
import {homedir} from 'node:os';
import {fitPowerlineBlocks, fitRightPowerlineBlocks, renderPowerlineBlocks, normalizeConnectorFadeColors, normalizeConnectorStyle, normalizeEdgeStyle, resolveConnectorFade, type PowerlineBlock, type PowerlineShape} from '../prompt/powerline.js';
import {renderWelcome, type WelcomeCatFrame, type WelcomeSnapshot} from './Welcome.js';
import {archiveColor, grayscaleArchiveColor, type PromptSnapshot} from '../prompt/snapshot.js';
import {isPromptRole, promptRoleColors} from '../prompt/prompt.js';
import {DEFAULT_TRANSCRIPT_APPEARANCE, normalizeConnectorFade, type GitColorMode, type TranscriptAppearance} from '../prompt/configuration.js';

const ARCHIVE_DIVIDER = foreground({red: 162, green: 151, blue: 190});
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

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
  /** Presentation-only history header settings from /transcript. */
  private transcriptAppearance: TranscriptAppearance = {...DEFAULT_TRANSCRIPT_APPEARANCE};
  /** Presentation-only idle frame; never serialized into transcripts. */
  private welcomeFrame: WelcomeCatFrame = 'open';
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

  setTranscriptAppearance(appearance: TranscriptAppearance): void {
    this.transcriptAppearance = {...appearance};
  }

  get hasWelcome(): boolean {
    return Boolean(this.welcome);
  }

  setWelcomeFrame(frame: WelcomeCatFrame): void {
    this.welcomeFrame = frame;
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
    let expanded = true;
    if (mode === 'FOLDED' || this.active.activities.length > 0) expanded = false;

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

  wrapped(width: number): WrappedRow[] {
    const lines = this.parser.allLines();
    const result: WrappedRow[] = this.welcome ? renderWelcome(this.welcome, width, this.welcomeFrame) : [];
    let skipUntil = -1;
    const activitiesByStart = new Map<number, SecondaryActivity>();
    for (const activity of [
      ...this.completed.flatMap(command => command.activities ?? []),
      ...(this.active?.activities ?? []),
    ]) activitiesByStart.set(activity.outputStartId, activity);
    const ownerOf = this.blockOwnership();

    for (let i = 0; i < lines.length; i++) {
      if (i < skipUntil) continue;

      if (this.visualGaps.has(i)) {
        result.push({ansi: '\u001B[0m', plain: '', lineIndex: -1});
      }

      const historicalContext = this.historicalContexts.get(i);
      const header = historicalContext && renderHistoricalContext(historicalContext, width, this.transcriptAppearance);
      if (header) {
        const owner = ownerOf(i);
        if (owner !== undefined) header.blockStartId = owner;
        result.push(header);
      }

      const cmd = this.completed.find(c => c.outputStartId === i);
      if (cmd && cmd.endId !== undefined && cmd.endId > cmd.outputStartId) {
        const hiddenLines = cmd.endId - cmd.outputStartId;
        // Activity-bearing parents use their lifecycle row as the disclosure control below.
        const hasActivities = Boolean(cmd.activities?.length);
        if (hasActivities) {
          if (!cmd.expanded) {
            skipUntil = cmd.endId;
            continue;
          }
        } else {
          const isFoldable = hiddenLines > 10 || !cmd.expanded;
          if (isFoldable) {
            if (!cmd.expanded) {
              const plain = foldHint(`${hiddenLines} lines hidden · Ctrl+O`, '›', width);
              const ansi = `${foreground(UI_COLORS.secondary)}${plain}\u001B[0m`;
              result.push({
                ansi, plain, lineIndex: cmd.outputStartId, isFoldHint: true, commandIndex: this.completed.indexOf(cmd)
              });
              skipUntil = cmd.endId;
              continue;
            } else {
              const plain = foldHint(`${hiddenLines} lines shown · Ctrl+O`, '⌄', width);
              const ansi = `${foreground(UI_COLORS.secondary)}${plain}\u001B[0m`;
              result.push({
                ansi, plain, lineIndex: cmd.outputStartId, isFoldHint: true, commandIndex: this.completed.indexOf(cmd)
              });
              // Don't skip, let the output render below this hint
            }
          }
        }
      }

      const activity = activitiesByStart.get(i);
      if (activity) {
        if (this.active) {
          // During execution the activity owns this source range; render it in
          // the live chronological timeline below instead of duplicating it.
          skipUntil = Math.max(skipUntil, activity.outputEndId);
          continue;
        } else {
          result.push(renderActivityRow(activity, width));
          if (activity.expanded) appendActivityOutput(result, lines, activity, width);
          skipUntil = Math.max(skipUntil, activity.outputEndId);
          continue;
        }
      }

      const parentDisclosure = this.completed.find(command => command.activities?.length && command.endId === i);
      const wrappedRows = wrapStyledLine(lines[i], parentDisclosure ? Math.max(1, width - 2) : width);
      const cmdIndex = this.completed.findIndex(c => c.startId <= i);
      if (parentDisclosure && wrappedRows.length > 0) {
        const finalRow = wrappedRows[wrappedRows.length - 1];
        if (finalRow) {
          const disclosure = parentDisclosure.expanded ? '⌄' : '›';
          finalRow.ansi = `${finalRow.ansi.replace(/\u001B\[0m$/u, '')}${foreground(UI_COLORS.secondary)} ${disclosure}\u001B[0m`;
          finalRow.plain += ` ${disclosure}`;
          finalRow.isFoldHint = true;
          finalRow.commandIndex = this.completed.indexOf(parentDisclosure);
        }
      }
      for (const row of wrappedRows) {
        row.lineIndex = i;
        if (parentDisclosure) row.commandIndex = this.completed.indexOf(parentDisclosure);
        else if (cmdIndex !== -1) row.commandIndex = cmdIndex;
        result.push(row);
      }
    }
    if (this.active) {
      for (const activity of this.active.activities) {
        result.push(renderActivityRow(activity, width));
        if (activity.expanded) appendActivityOutput(result, lines, activity, width);
      }
    }
    for (const row of result) {
      if (row.isHistoricalHeader || row.lineIndex === undefined || row.lineIndex < 0) continue;
      const owner = ownerOf(row.lineIndex);
      if (owner !== undefined) row.blockStartId = owner;
    }
    return result;
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

  /**
   * One-row sticky rendering of a block's submitted command: the start of the
   * stored command row, ANSI-safe truncated with an ellipsis when it is wider
   * than the viewport or continues onto more rows. Never stored anywhere.
   */
  stickyHeaderRow(startId: number, width: number): string | undefined {
    if (width <= 0 || this.lineTypes.get(startId) !== 'command') return undefined;
    const lines = this.parser.allLines();
    const line = lines[startId];
    if (!line) return undefined;
    const ansi = wrapStyledLine(line, Number.MAX_SAFE_INTEGER)[0]?.ansi ?? '';
    const continues = this.lineTypes.get(startId + 1) === 'command' && this.blockOwnership()(startId + 1) === startId;
    if (continues && displayWidth(ansi) < width) return `${ansi}${foreground(UI_COLORS.secondary)}…\u001B[0m`;
    return truncateAnsi(ansi, width);
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

function renderActivityRow(activity: SecondaryActivity, width: number): WrappedRow {
  const running = activity.status === 'running';
  const elapsed = Math.max(0, (activity.completedAt ?? Date.now()) - activity.startedAt);
  const duration = formatDuration(elapsed);
  const disclosure = activity.expanded ? '⌄' : '›';
  const status = activity.status === 'failed' ? 'Failed' : 'Completed';
  const summary = running
    ? `  ◌ ${activity.label} · ${duration}`
    : `  ${activity.status === 'failed' ? '✗' : '✓'} ${activity.label} · ${status} · ${duration}`;
  const text = `${truncateText(summary, Math.max(0, width - displayWidth(` ${disclosure}`)))} ${disclosure}`;
  return {
    ansi: `${foreground(running ? UI_COLORS.secondary : UI_COLORS.subtle)}${text}\u001B[0m`,
    plain: text,
    lineIndex: activity.outputStartId,
    activityId: activity.id,
    activityStartedAt: activity.startedAt,
    isLiveActivity: running,
    isFoldHint: true,
  };
}

function foldHint(summary: string, disclosure: string, width: number): string {
  const suffix = `  ${disclosure}`;
  if (width <= displayWidth(suffix)) return truncateText(suffix, width);
  return `${truncateText(summary, width - displayWidth(suffix))}${suffix}`;
}

function appendActivityOutput(result: WrappedRow[], lines: ReturnType<AnsiOutputParser['allLines']>, activity: SecondaryActivity, width: number): void {
  for (let lineIndex = activity.outputStartId; lineIndex < Math.min(activity.outputEndId, lines.length); lineIndex += 1) {
    for (const row of wrapStyledLine(lines[lineIndex] ?? [], Math.max(1, width - 4))) {
      result.push({
        ansi: `    ${row.ansi}`,
        plain: `    ${row.plain}`,
        lineIndex,
        activityId: activity.id,
      });
    }
  }
}

type Rgb = {red: number; green: number; blue: number};
const ARCHIVE_DIVIDER_COLOR = {red: 185, green: 176, blue: 197};
const ARCHIVE_BLOCK_COLOR = {red: 75, green: 67, blue: 86};
const LEGACY_FOREGROUND = {red: 220, green: 211, blue: 237};
const LEGACY_BACKGROUNDS: Record<string, Rgb> = {
  project: {red: 82, green: 73, blue: 111},
  cwd: {red: 70, green: 65, blue: 98},
  gitBranch: {red: 91, green: 80, blue: 119},
};
/** Compact density: a finer dashed rule in a quieter tone, same single row. */
const DIVIDER_STYLES = {
  normal: {glyph: '─', color: ARCHIVE_DIVIDER},
  compact: {glyph: '┈', color: foreground({red: 118, green: 112, blue: 138})},
} as const;

interface HistoricalSegment {
  text: string;
  role?: string;
  foreground?: Rgb;
  background?: Rgb;
  /** Legacy headers carry pre-muted colors that must not be archived twice. */
  preMuted?: boolean;
  compact?: boolean;
  shape?: PowerlineShape;
  fade?: PowerlineShape | 'off';
  placement?: 'right';
  /** Rich Git color mode the segment was captured under. */
  gitColors?: GitColorMode;
}

function historyColor(color: Rgb | undefined, fallback: Rgb, part: 'foreground' | 'background', segment: HistoricalSegment,
  appearance: TranscriptAppearance): Rgb | undefined {
  if (appearance.historyColors === 'theme' && isPromptRole(segment.role)) {
    // Recolored history keeps the captured Rich Git mode; old snapshots followed the theme.
    return archiveColor(promptRoleColors(segment.role, appearance.historyTheme, segment.gitColors ?? 'followTheme')[part], part);
  }
  if (!color) return part === 'foreground' ? fallback : undefined;
  if (appearance.historyColors === 'grayscale') return grayscaleArchiveColor(color, part);
  return segment.preMuted ? color : archiveColor(color, part);
}

function legacySegments(context: HistoricalContextSnapshot): HistoricalSegment[] {
  const cwd = context.cwd.replace(CONTROL_CHARACTERS, '�');
  const home = homedir().replace(/\/$/u, '');
  const cwdLabel = cwd === home ? '~' : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
  const project = context.project?.replace(CONTROL_CHARACTERS, '�');
  const segments: HistoricalSegment[] = [];
  if (project) segments.push({text: project, role: 'project'});
  if (!project || project !== cwdLabel) segments.push({text: cwdLabel, role: 'cwd'});
  const branch = context.branch?.replace(CONTROL_CHARACTERS, '�');
  if (branch) segments.push({text: `${GLYPHS.branch} ${branch}`, role: 'gitBranch'});
  return segments.map(segment => ({...segment, foreground: LEGACY_FOREGROUND, background: LEGACY_BACKGROUNDS[segment.role!], preMuted: true}));
}

/** The prompt part of a historical header, colored per the transcript appearance. */
/** Divider cells kept between a historical left prompt and its right context. */
const RIGHT_CONTEXT_MIN_DIVIDER = 2;

/** A historical prompt: its left part, plus right-aligned context when the snapshot recorded any. */
function historicalPrompt(context: HistoricalContextSnapshot, width: number, appearance: TranscriptAppearance): string | {left: string; right: string} {
  const snapshot = context.prompt;
  const segments: HistoricalSegment[] = snapshot
    ? snapshot.segments.map(segment => ({...segment, gitColors: snapshot.gitColors,
      text: segment.text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')}))
    : legacySegments(context);
  if (!snapshot || snapshot.segments.every(segment => segment.geometry === 'powerline')) {
    const blocks: PowerlineBlock[] = segments.map(segment => ({
      text: segment.text,
      foreground: historyColor(segment.foreground, ARCHIVE_DIVIDER_COLOR, 'foreground', segment, appearance)!,
      background: historyColor(segment.background, ARCHIVE_BLOCK_COLOR, 'background', segment, appearance) ?? ARCHIVE_BLOCK_COLOR,
      ...(segment.compact ? {compact: true} : {}),
      ...(segment.shape ? {geometry: segment.shape} : {}),
      ...(segment.fade ? {fade: segment.fade} : {}),
    }));
    if (!snapshot) return fitPowerlineBlocks(blocks, 1, 1, width, true);
    const gap = snapshot.gap ?? 1;
    const connector = normalizeConnectorStyle(snapshot.connector);
    const endStyle = normalizeEdgeStyle(snapshot.endStyle, 'flat');
    const startStyle = normalizeEdgeStyle(snapshot.startStyle, 'wedge');
    const gapEnabled = snapshot.gapEnabled ?? gap > 0;
    const spacing = snapshot.spacing ?? 1;
    // Snapshots without a connector fade predate it and rendered solid connectors.
    const fade = snapshot.connectorFade === undefined ? undefined
      : resolveConnectorFade(normalizeConnectorFade(snapshot.connectorFade), connector);
    const fadeColors = normalizeConnectorFadeColors(snapshot.connectorFadeColors);
    const left = fitPowerlineBlocks(blocks.filter((_, index) => segments[index]!.placement !== 'right'), gap, spacing, width,
      endStyle, gapEnabled, startStyle, connector, fade, fadeColors);
    const right = blocks.filter((_, index) => segments[index]!.placement === 'right');
    if (right.length === 0) return left;
    return {left, right: fitRightPowerlineBlocks(right, width - displayWidth(left) - 1 - RIGHT_CONTEXT_MIN_DIVIDER,
      candidate => renderPowerlineBlocks(candidate, gap, spacing, endStyle, gapEnabled, startStyle, connector, fade, fadeColors))};
  }
  const plainSpans = segments.map(segment => `${rgbStyle(
    historyColor(segment.foreground, ARCHIVE_DIVIDER_COLOR, 'foreground', segment, appearance),
    historyColor(segment.background, ARCHIVE_BLOCK_COLOR, 'background', segment, appearance),
  )}${segment.text}`).join('');
  return truncateAnsi(plainSpans, width);
}

/**
 * One header row above a historical command, or none when both the divider
 * and the historical prompt are off. Presentation only: stored snapshots and
 * raw PTY output are never modified.
 */
export function renderHistoricalContext(context: HistoricalContextSnapshot, width: number,
  appearance: TranscriptAppearance = DEFAULT_TRANSCRIPT_APPEARANCE): WrappedRow | undefined {
  if (!appearance.divider && !appearance.historicalPrompt) return undefined;
  const divider = DIVIDER_STYLES[appearance.dividerDensity];
  if (!appearance.historicalPrompt) {
    const line = repeatToWidth(divider.glyph, width);
    return {ansi: `${divider.color}${line}\u001B[0m`, plain: line, isHistoricalHeader: true};
  }
  const parts = historicalPrompt(context, Math.max(0, width - (appearance.divider ? 1 : 0)), appearance);
  const prompt = typeof parts === 'string' ? parts : parts.left;
  const right = typeof parts === 'string' || !parts.right ? '' : parts.right;
  const rightWidth = right ? displayWidth(right) + 1 : 0;
  if (!appearance.divider) {
    const pad = right ? ' '.repeat(Math.max(1, width - displayWidth(prompt) - displayWidth(right))) : '';
    const ansi = right ? `${prompt}\u001B[0m${pad}${right}\u001B[0m` : `${prompt}\u001B[0m`;
    return {ansi, plain: stripAnsi(ansi), isHistoricalHeader: true};
  }
  const remaining = Math.max(0, width - displayWidth(prompt) - 1 - rightWidth);
  const fill = repeatToWidth(divider.glyph, remaining);
  const rightAnsi = right ? ` ${right}\u001B[0m` : '';
  return {ansi: `${prompt}\u001B[0m ${divider.color}${fill}\u001B[0m${rightAnsi}`, plain: `${stripAnsi(prompt)} ${fill}${right ? ` ${stripAnsi(right)}` : ''}`, isHistoricalHeader: true};
}

function rgbStyle(foregroundColor?: Rgb, backgroundColor?: Rgb): string {
  const fg = foregroundColor ? `\u001B[38;2;${foregroundColor.red};${foregroundColor.green};${foregroundColor.blue}m` : '';
  const bg = backgroundColor ? `\u001B[48;2;${backgroundColor.red};${backgroundColor.green};${backgroundColor.blue}m` : '\u001B[49m';
  return `${fg}${bg}`;
}
