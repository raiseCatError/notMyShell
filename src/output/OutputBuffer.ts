import {AnsiOutputParser, type SerializedLine} from './AnsiOutputParser.js';
import {wrapStyledLine, type WrappedRow} from './viewport.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {PresentationMode} from './PresentationMode.js';
import {CommandClassifier} from './Classifier.js';
import {displayWidth, repeatToWidth, stripAnsi, truncateText} from '../util/text.js';
import {formatDuration} from '../status/commandTiming.js';
import {homedir} from 'node:os';
import {fitPowerlineBlocks, type PowerlineBlock} from '../prompt/powerline.js';

const ARCHIVE_DIVIDER = foreground({red: 162, green: 151, blue: 190});
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

export interface HistoricalContextSnapshot {
  cwd: string;
  project?: string;
  branch?: string;
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
      records: this.completed.map(record => ({
        ...record,
        historicalContext: record.historicalContext ? {...record.historicalContext} : undefined,
        activities: record.activities?.map(activity => ({...activity})),
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
      activities: record.activities?.map(activity => ({...activity})),
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
    this.active = {command, start: startId, outputStart: startId + formattedLines.length, historicalContext, activities: []};
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
      historicalContext: this.active.historicalContext ? {...this.active.historicalContext} : undefined,
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
    const result: WrappedRow[] = [];
    let skipUntil = -1;
    const activitiesByStart = new Map<number, SecondaryActivity>();
    for (const activity of [
      ...this.completed.flatMap(command => command.activities ?? []),
      ...(this.active?.activities ?? []),
    ]) activitiesByStart.set(activity.outputStartId, activity);

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
    return result;
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

function renderHistoricalContext(context: HistoricalContextSnapshot, width: number): WrappedRow {
  const cwd = context.cwd.replace(CONTROL_CHARACTERS, '�');
  const home = homedir().replace(/\/$/u, '');
  const cwdLabel = cwd === home ? '~' : cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
  const modules: PowerlineBlock[] = [];
  const project = context.project?.replace(CONTROL_CHARACTERS, '�');
  const archiveForeground = {red: 220, green: 211, blue: 237};
  if (project) {
    modules.push({text: project, foreground: archiveForeground, background: {red: 82, green: 73, blue: 111}});
  }
  if (!project || project !== cwdLabel) {
    modules.push({text: cwdLabel, foreground: archiveForeground, background: {red: 70, green: 65, blue: 98}});
  }
  const branch = context.branch?.replace(CONTROL_CHARACTERS, '�');
  if (branch) modules.push({text: `${GLYPHS.branch} ${branch}`, foreground: archiveForeground, background: {red: 91, green: 80, blue: 119}});

  const visibleBlocks = fitPowerlineBlocks(modules, 1, 1, Math.max(0, width - 1), true);
  const remaining = Math.max(0, width - displayWidth(visibleBlocks) - 1);
  const plain = `${stripAnsi(visibleBlocks)} ${repeatToWidth('─', remaining)}`;
  return {
    ansi: `${visibleBlocks}\u001B[0m ${ARCHIVE_DIVIDER}${repeatToWidth('─', remaining)}\u001B[0m`,
    plain,
    isHistoricalHeader: true,
  };
}
