import {askFoldLabel} from '../ask/transcriptSummary.js';
import {paintDivider, DEFAULT_TREATMENT_SETTINGS, type TreatmentSettings} from '../chroma/treatment.js';
import {HyperlinkPresenter} from './Hyperlinks.js';
import {type StyledLine} from './AnsiOutputParser.js';
import {wrapStyledLine, type WrappedRow} from './viewport.js';
import {background, foreground, UI_COLORS, lazyForeground} from '../ui/palette.js';
import {mixRgb} from '../chroma/chroma.js';
import {GLYPHS} from '../ui/glyphs.js';
import {displayWidth, repeatToWidth, stripAnsi, truncateAnsi, truncateText} from '../util/text.js';
import {formatDuration} from '../status/commandTiming.js';
import {shimmerTextWithColors} from '../status/shimmer.js';
import {homedir} from 'node:os';
import {fitPowerlineBlocks, fitRightPowerlineBlocks, renderPowerlineBlocks, normalizeConnectorFadeColors, normalizePromptStyle, normalizeConnectorStyle, normalizeEdgeStyle, resolveConnectorFade, type PowerlineBlock, type PowerlineShape} from '../prompt/powerline.js';
import {normalizeStyleProfiles} from '../prompt/styles.js';
import {renderWelcome, type WelcomeCatFrame, type WelcomeSnapshot} from './Welcome.js';
import {foldWindow} from './FoldPolicy.js';
import {archiveColor, grayscaleArchiveColor} from '../prompt/snapshot.js';
import {isPromptRole, promptRoleColors} from '../prompt/prompt.js';
import {DEFAULT_TRANSCRIPT_APPEARANCE, normalizeConnectorFade, type GitColorMode, type TranscriptAppearance} from '../prompt/configuration.js';
import type {CompletedCommand, HistoricalContextSnapshot, SecondaryActivity} from './OutputBuffer.js';

/**
 * History rules are UI chrome, resolved at use so themes apply. The shipped
 * Lavender chrome keeps its original rule colors exactly; any other chrome
 * gets lighter and darker tones of its own separator.
 */
const SHIPPED_SEPARATOR = {red: 139, green: 132, blue: 178};
const shippedChrome = () => UI_COLORS.separator.red === SHIPPED_SEPARATOR.red && UI_COLORS.separator.green === SHIPPED_SEPARATOR.green
  && UI_COLORS.separator.blue === SHIPPED_SEPARATOR.blue;
/** History divider tones of the UI separator role (Follow UI theme); Chroma dividers use the shared divider source. */
const archiveDividerRgb = () => shippedChrome() ? {red: 162, green: 151, blue: 190} : mixRgb(UI_COLORS.separator, UI_COLORS.primary, 0.22);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;
const PRIMARY = lazyForeground(UI_COLORS.primary);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const RESET = '\u001B[0m';
/** Row surfaces: submitted command rows, hovered and focused disclosure rows. */
const COMMAND_SURFACE = background({red: 38, green: 38, blue: 48});
const HOVER_SURFACE = background({red: 45, green: 45, blue: 55});
const FOCUS_SURFACE = background({red: 60, green: 60, blue: 80});

/** Transcript presentation: Normal rows, or Chat with right-aligned command blocks. */
export type TranscriptLayout = 'normal' | 'chat';
/** Below this width Chat falls back to stacked Normal rows. */
export const CHAT_MIN_WIDTH = 60;

/** The bounded column chat command blocks and their headers live in, or undefined when too narrow. */
export function chatColumn(width: number): number | undefined {
  if (width < CHAT_MIN_WIDTH) return undefined;
  return Math.min(width - 8, Math.max(32, Math.min(100, Math.round(width * 0.66))));
}

function indentRow(row: WrappedRow, indent: number): WrappedRow {
  if (indent <= 0) return row;
  const pad = ' '.repeat(indent);
  return {...row, ansi: `${pad}${row.ansi}`, plain: `${pad}${row.plain}`, indent};
}

/**
 * Read-only view of what the transcript contains. `OutputBuffer` owns the
 * data; the presenter only turns it into rows.
 */
export interface TranscriptView {
  lines: readonly StyledLine[];
  completed: readonly CompletedCommand[];
  /** The running command, when one is active. */
  active?: {activities: readonly SecondaryActivity[]; start?: number; historicalContext?: HistoricalContextSnapshot};
  visualGaps: ReadonlySet<number>;
  lineTypes: ReadonlyMap<number, 'command' | 'metadata'>;
  historicalContexts: ReadonlyMap<number, HistoricalContextSnapshot>;
  welcome?: WelcomeSnapshot;
  /** Structural block ownership from command records (never from text). */
  ownerOf: (lineIndex: number) => number | undefined;
}

/** Transient interaction state the app tracks; the presenter decides how it looks. */
export interface RowInteraction {
  hoveredLineIndex?: number;
  focusedLineIndex?: number;
  focusedCommandIndex?: number;
  focusedActivityId?: string;
  now: number;
}

/**
 * How transcript rows look. Deterministic: the same view, settings and width
 * produce the same rows. Presentation-only state (appearance, idle welcome
 * frame) lives here and is never serialized.
 */
export class TranscriptPresenter {
  private hyperlinks = false;
  private readonly links = new HyperlinkPresenter();

  setHyperlinks(enabled: boolean): void { this.hyperlinks = enabled; }

  private wrap(view: TranscriptView, index: number, width: number): WrappedRow[] {
    const owner = view.ownerOf(index);
    const context = owner === undefined ? undefined : view.historicalContexts.get(owner);
    const line = view.lines[index] ?? [];
    return wrapStyledLine(this.hyperlinks ? this.links.line(line, context?.cwd) : line, width, this.hyperlinks);
  }

  private treatment = DEFAULT_TREATMENT_SETTINGS;

  setTreatment(settings: TreatmentSettings): void { this.treatment = {...settings, motion: 'static'}; }

  private appearance: TranscriptAppearance = {...DEFAULT_TRANSCRIPT_APPEARANCE};
  private welcomeFrame: WelcomeCatFrame = 'open';
  private layout: TranscriptLayout = 'normal';

  setLayout(layout: TranscriptLayout): void {
    this.layout = layout;
  }

  get transcriptLayout(): TranscriptLayout {
    return this.layout;
  }

  setAppearance(appearance: TranscriptAppearance): void {
    this.appearance = {...appearance};
  }

  setWelcomeFrame(frame: WelcomeCatFrame): void {
    this.welcomeFrame = frame;
  }

  rows(view: TranscriptView, width: number): WrappedRow[] {
    const {lines, completed, active, visualGaps, historicalContexts, welcome, ownerOf} = view;
    const column = this.layout === 'chat' ? chatColumn(width) : undefined;
    // A chat command block is right-aligned as a whole: its widest wrapped row sets the left edge.
    const blockWidths = new Map<number, number>();
    const commandBlockWidth = (line: number): number => {
      const start = ownerOf(line) ?? line;
      const cached = blockWidths.get(start);
      if (cached !== undefined) return cached;
      let widest = 0;
      for (let index = start; view.lineTypes.get(index) === 'command' && (ownerOf(index) ?? index) === start; index += 1) {
        for (const row of this.wrap(view, index, column!)) widest = Math.max(widest, displayWidth(row.plain));
      }
      blockWidths.set(start, widest);
      return widest;
    };
        const result: WrappedRow[] = welcome ? renderWelcome(welcome, width, this.welcomeFrame) : [];
    let skipUntil = -1;
    const activitiesByStart = new Map<number, SecondaryActivity>();
    for (const activity of [
      ...completed.flatMap(command => command.activities ?? []),
      ...(active?.activities ?? []),
    ]) activitiesByStart.set(activity.outputStartId, activity);

    for (let i = 0; i < lines.length; i++) {
      if (i < skipUntil) continue;

      if (visualGaps.has(i)) {
        result.push({ansi: '\u001B[0m', plain: '', lineIndex: -1});
      }

      const historicalContext = historicalContexts.get(i);
      // Chat: the header (prompt snapshot + local divider) spans the command column on the right.
      const rendered = historicalContext && renderHistoricalContext(historicalContext, column ?? width, this.appearance, this.treatment);
      const header = rendered && column ? indentRow(rendered, width - displayWidth(rendered.plain)) : rendered;
      if (header) {
        const owner = ownerOf(i);
        if (owner !== undefined) header.blockStartId = owner;
        result.push(header);
      }

      const cmd = completed.find(c => c.outputStartId === i);
      if (cmd && cmd.endId !== undefined && cmd.endId > cmd.outputStartId) {
        const hiddenLines = cmd.endId - cmd.outputStartId;
        // Activity-bearing parents use their lifecycle row as the disclosure control below.
        const hasActivities = Boolean(cmd.activities?.length);
        if (cmd.frontend === 'ask') {
          // A recorded Ask conversation folds whole: the /ask request line above stays as its identity.
          const turns = cmd.ask?.turns.length ?? hiddenLines;
          const label = cmd.ask ? askFoldLabel(cmd.ask.turns, cmd.command.replace(/^\/(?:btw|ask)\s*/u, '')) : `Ask conversation · ${turns} turn${turns === 1 ? '' : 's'} · Ctrl+O`;
          const commandIndex = completed.indexOf(cmd);
          if (!cmd.expanded) {
            const plain = foldHint(label, '›', width);
            result.push({ansi: `${foreground(UI_COLORS.secondary)}${plain}\u001B[0m`, plain, lineIndex: cmd.outputStartId, isFoldHint: true, commandIndex});
            skipUntil = cmd.endId;
            continue;
          }
          if (turns > 2) {
            const plain = foldHint(label, '⌄', width);
            result.push({ansi: `${foreground(UI_COLORS.secondary)}${plain}\u001B[0m`, plain, lineIndex: cmd.outputStartId, isFoldHint: true, commandIndex});
          }
        } else if (hasActivities) {
          if (!cmd.expanded) {
            skipUntil = cmd.endId;
            continue;
          }
        } else {
          const isFoldable = hiddenLines > 10 || !cmd.expanded;
          if (isFoldable) {
            if (!cmd.expanded) {
              // Collapsed: keep the head and tail of the stored output visible
              // around the disclosure row; the full output is never altered.
              const commandIndex = completed.indexOf(cmd);
              const {head, tail} = foldWindow(hiddenLines);
              const pushLines = (from: number, to: number) => {
                for (let line = from; line < to; line += 1) {
                  for (const row of this.wrap(view, line, width)) result.push({...row, lineIndex: line, commandIndex});
                }
              };
              pushLines(cmd.outputStartId, cmd.outputStartId + head);
              const plain = foldHint(`${hiddenLines - head - tail} lines hidden · Ctrl+O`, '›', width);
              const ansi = `${foreground(UI_COLORS.secondary)}${plain}\u001B[0m`;
              result.push({ansi, plain, lineIndex: cmd.outputStartId, isFoldHint: true, commandIndex});
              pushLines(cmd.endId - tail, cmd.endId);
              skipUntil = cmd.endId;
              continue;
            } else {
              const plain = foldHint(`${hiddenLines} lines shown · Ctrl+O`, '⌄', width);
              const ansi = `${foreground(UI_COLORS.secondary)}${plain}\u001B[0m`;
              result.push({
                ansi, plain, lineIndex: cmd.outputStartId, isFoldHint: true, commandIndex: completed.indexOf(cmd)
              });
              // Don't skip, let the output render below this hint
            }
          }
        }
      }

      const activity = activitiesByStart.get(i);
      if (activity) {
        if (active) {
          // During execution the activity owns this source range; render it in
          // the live chronological timeline below instead of duplicating it.
          skipUntil = Math.max(skipUntil, activity.outputEndId);
          continue;
        } else {
          result.push(renderActivityRow(activity, width));
          if (activity.expanded) appendActivityOutput(result, lines, activity, width, (index, columns) => this.wrap(view, index, columns));
          skipUntil = Math.max(skipUntil, activity.outputEndId);
          continue;
        }
      }

      const parentDisclosure = completed.find(command => command.activities?.length && command.endId === i);
      const chatCommand = column !== undefined && view.lineTypes.get(i) === 'command';
      const wrappedRows = chatCommand
        ? this.wrap(view, i, column!).map(row => indentRow(row, width - commandBlockWidth(i)))
        : this.wrap(view, i, parentDisclosure ? Math.max(1, width - 2) : width);
      const cmdIndex = completed.findIndex(c => c.startId <= i);
      if (parentDisclosure && wrappedRows.length > 0) {
        const finalRow = wrappedRows[wrappedRows.length - 1];
        if (finalRow) {
          const disclosure = parentDisclosure.expanded ? '⌄' : '›';
          finalRow.ansi = `${finalRow.ansi.replace(/\u001B\[0m$/u, '')}${foreground(UI_COLORS.secondary)} ${disclosure}\u001B[0m`;
          finalRow.plain += ` ${disclosure}`;
          finalRow.isFoldHint = true;
          finalRow.commandIndex = completed.indexOf(parentDisclosure);
        }
      }
      for (const row of wrappedRows) {
        row.lineIndex = i;
        if (parentDisclosure) row.commandIndex = completed.indexOf(parentDisclosure);
        else if (cmdIndex !== -1) row.commandIndex = cmdIndex;
        result.push(row);
      }
    }
    if (active) {
      for (const activity of active.activities) {
        result.push(renderActivityRow(activity, width));
        if (activity.expanded) appendActivityOutput(result, lines, activity, width, (index, columns) => this.wrap(view, index, columns));
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
   * One-row sticky rendering of a block's submitted command: the start of the
   * stored command row, ANSI-safe truncated with an ellipsis when it is wider
   * than the viewport or continues onto more rows. Never stored anywhere.
   */
  stickyHeaderRow(view: TranscriptView, startId: number, width: number): string | undefined {
    if (width <= 0 || view.lineTypes.get(startId) !== 'command') return undefined;
    const line = view.lines[startId];
    if (!line) return undefined;
    const ansi = this.wrap(view, startId, Number.MAX_SAFE_INTEGER)[0]?.ansi ?? '';
    const continues = view.lineTypes.get(startId + 1) === 'command' && view.ownerOf(startId + 1) === startId;
    if (continues && displayWidth(ansi) < width) return `${ansi}${foreground(UI_COLORS.secondary)}…\u001B[0m`;
    return truncateAnsi(ansi, width);
  }

  /** The sticky header painted on the command surface. */
  stickyHeaderSurface(row: string, indent = 0): string {
    return `${' '.repeat(indent)}${COMMAND_SURFACE}${row.replaceAll(RESET, `${RESET}${COMMAND_SURFACE}`)}\u001B[K${RESET}`;
  }

  /** The finished sticky row for a block, aligned like the block's command rows. */
  presentSticky(view: TranscriptView, startId: number, width: number): string | undefined {
    const column = this.layout === 'chat' ? chatColumn(width) : undefined;
    const row = this.stickyHeaderRow(view, startId, column ?? width);
    if (row === undefined) return undefined;
    return this.stickyHeaderSurface(row, column === undefined ? 0 : Math.max(0, width - displayWidth(row)));
  }

  /** Final ANSI for a visible row: live shimmer, command surface, hover and focus treatment. */
  decorate(row: WrappedRow, lineType: 'command' | 'metadata' | undefined, interaction: RowInteraction): string {
    let finalAnsi = row.ansi;
    if (row.isLiveActivity && row.activityStartedAt !== undefined) {
      finalAnsi = `${shimmerTextWithColors(row.plain, interaction.now - row.activityStartedAt, false,
        {red: 148, green: 155, blue: 166}, {red: 248, green: 250, blue: 252})}${RESET}`;
    }
    // Chat rows carry leading alignment padding that stays outside any surface.
    const pad = ' '.repeat(row.indent ?? 0);
    const applyBg = (bg: string) => {
      const content = pad && finalAnsi.startsWith(pad) ? finalAnsi.slice(pad.length) : finalAnsi;
      return `${pad}${bg}${content.replaceAll(RESET, RESET + bg)}${bg}\u001B[K${RESET}`;
    };
    const brighten = () => row.ansi.replaceAll(SECONDARY, PRIMARY).replaceAll(SUBTLE, SECONDARY);

    if (row.isFoldHint) {
      const isHovered = interaction.hoveredLineIndex === row.lineIndex;
      const isFocused = row.activityId
        ? interaction.focusedActivityId === row.activityId
        : row.commandIndex !== undefined
          ? interaction.focusedCommandIndex === row.commandIndex
          : interaction.focusedLineIndex === row.lineIndex;
      if (isHovered || isFocused) {
        if (!row.isLiveActivity) finalAnsi = brighten();
        finalAnsi = applyBg(isFocused ? FOCUS_SURFACE : HOVER_SURFACE);
      }
    } else if (row.lineIndex !== undefined) {
      if (lineType === 'command') {
        finalAnsi = applyBg(COMMAND_SURFACE);
      } else if (lineType === 'metadata') {
        const isHovered = interaction.hoveredLineIndex === row.lineIndex;
        const isFocused = interaction.focusedLineIndex === row.lineIndex;
        if (isHovered || isFocused) {
          finalAnsi = brighten();
          finalAnsi = applyBg(isFocused ? FOCUS_SURFACE : HOVER_SURFACE);
        }
      }
    }
    return finalAnsi;
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

function appendActivityOutput(result: WrappedRow[], lines: readonly StyledLine[], activity: SecondaryActivity, width: number, wrap: (index: number, width: number) => WrappedRow[]): void {
  for (let lineIndex = activity.outputStartId; lineIndex < Math.min(activity.outputEndId, lines.length); lineIndex += 1) {
    for (const row of wrap(lineIndex, Math.max(1, width - 4))) {
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
  normal: {glyph: '─', get color() { return archiveDividerRgb(); }},
  compact: {glyph: '┈', get color() { return shippedChrome() ? {red: 118, green: 112, blue: 138} : mixRgb(UI_COLORS.separator, {red: 0, green: 0, blue: 0}, 0.15); }},
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

/**
 * Compact and Minimal historical prompts: a quiet view of the stored facts
 * (project or short cwd, branch, marker). Presentation only; the snapshot and
 * /copy are unchanged, and nothing is invented that was not recorded.
 */
function condensedPrompt(context: HistoricalContextSnapshot, level: 'compact' | 'minimal', width: number): string {
  const marker = `${foreground(UI_COLORS.accent)}${GLYPHS.prompt}\u001B[0m`;
  if (level === 'minimal') return truncateAnsi(marker, width);
  const clean = (text: string) => text.replace(CONTROL_CHARACTERS, '�');
  const cwd = clean(context.cwd);
  const home = homedir().replace(/\/$/u, '');
  const place = context.project ? clean(context.project) : cwd === home ? '~' : cwd.split('/').filter(Boolean).pop() ?? cwd;
  const subtle = foreground(UI_COLORS.secondary);
  const branch = context.branch ? ` ${foreground(UI_COLORS.subtle)}${GLYPHS.branch} ${clean(context.branch)}` : '';
  return truncateAnsi(`${subtle}${place}${branch}\u001B[0m ${marker}`, width);
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
    const style = snapshot?.style ? normalizePromptStyle(snapshot.style) : undefined;
    const blocks: PowerlineBlock[] = segments.map(segment => ({
      ...(style && style !== 'powerline' ? {style} : {}),
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
    // History replays the submitted style profile; Chroma is a live treatment and never replays.
    const submitted = normalizePromptStyle(snapshot.style);
    const extras = {profiles: normalizeStyleProfiles(submitted === 'powerline' ? undefined : {[submitted]: snapshot.styleProfile}, gapEnabled ? gap : 0, spacing)};
    const left = fitPowerlineBlocks(blocks.filter((_, index) => segments[index]!.placement !== 'right'), gap, spacing, width,
      endStyle, gapEnabled, startStyle, connector, fade, fadeColors, extras);
    const right = blocks.filter((_, index) => segments[index]!.placement === 'right');
    if (right.length === 0) return left;
    return {left, right: fitRightPowerlineBlocks(right, width - displayWidth(left) - 1 - RIGHT_CONTEXT_MIN_DIVIDER,
      candidate => renderPowerlineBlocks(candidate, gap, spacing, endStyle, gapEnabled, startStyle, connector, fade, fadeColors,
        snapshot.mirrorRight ? 'mirrored' : 'normal', extras))};
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
/** Deliberately quiet neutral divider: readable, clearly secondary. */
const MUTED_DIVIDER: Rgb = {red: 98, green: 100, blue: 106};

/**
 * Historical divider color, by Divider colors: Follow Chroma (the active
 * palette, always static here; the UI-theme tone while Chroma is Off),
 * Follow history (the History colors mode), Follow UI theme (the separator
 * role's history tone) or Muted grayscale. Presentation only.
 */
function historicalDivider(text: string, context: HistoricalContextSnapshot, appearance: TranscriptAppearance,
  treatment: TreatmentSettings, uiTone: Rgb): string {
  const mode = appearance.dividerColors ?? 'chroma';
  if (mode === 'chroma') return paintDivider(text, {...treatment, rules: true}, 0, false, uiTone);
  if (mode === 'muted') return paintDivider(text, DEFAULT_TREATMENT_SETTINGS, 0, false, appearance.dividerDensity === 'compact' ? mixRgb(MUTED_DIVIDER, {red: 0, green: 0, blue: 0}, 0.15) : MUTED_DIVIDER);
  if (mode === 'history') {
    const first = context.prompt?.segments[0];
    const segment: HistoricalSegment = first ? {text: '', role: first.role, background: first.background} : legacySegments(context)[0] ?? {text: ''};
    const color = appearance.historyColors === 'theme' && isPromptRole(segment.role)
      ? archiveColor(promptRoleColors(segment.role, appearance.historyTheme, 'followTheme').background, 'foreground')
      : segment.background
        ? appearance.historyColors === 'grayscale' ? grayscaleArchiveColor(segment.background, 'foreground') : archiveColor(segment.background, 'foreground')
        : uiTone;
    return paintDivider(text, DEFAULT_TREATMENT_SETTINGS, 0, false, color);
  }
  return paintDivider(text, DEFAULT_TREATMENT_SETTINGS, 0, false, uiTone);
}

export function renderHistoricalContext(context: HistoricalContextSnapshot, width: number,
  appearance: TranscriptAppearance = DEFAULT_TRANSCRIPT_APPEARANCE,
  treatment: TreatmentSettings = DEFAULT_TREATMENT_SETTINGS): WrappedRow | undefined {
  // Prompt None submissions had no prompt: they render like the Off presentation, never a substituted one.
  const promptShown = appearance.historicalPrompt && !context.promptless;
  if (!appearance.divider && !promptShown) return undefined;
  const divider = DIVIDER_STYLES[appearance.dividerDensity];
  if (!promptShown) {
    const line = repeatToWidth(divider.glyph, width);
    return {ansi: `${historicalDivider(line, context, appearance, treatment, divider.color)}\u001B[0m`, plain: line, isHistoricalHeader: true};
  }
  const level = appearance.historicalPromptLevel ?? 'full';
  const parts = level === 'full' ? historicalPrompt(context, Math.max(0, width - (appearance.divider ? 1 : 0)), appearance)
    : condensedPrompt(context, level, Math.max(0, width - (appearance.divider ? 1 : 0)));
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
  return {ansi: `${prompt}\u001B[0m ${historicalDivider(fill, context, appearance, treatment, divider.color)}\u001B[0m${rightAnsi}`, plain: `${stripAnsi(prompt)} ${fill}${right ? ` ${stripAnsi(right)}` : ''}`, isHistoricalHeader: true};
}

function rgbStyle(foregroundColor?: Rgb, backgroundColor?: Rgb): string {
  const fg = foregroundColor ? foreground(foregroundColor) : '';
  const bg = backgroundColor ? background(backgroundColor) : '\u001B[49m';
  return `${fg}${bg}`;
}
