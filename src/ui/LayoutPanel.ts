import {planScreen, type RegionKind} from '../app/screenPlan.js';
import {OutputBuffer} from '../output/OutputBuffer.js';
import {
  COMPOSER_POSITION_LABELS,
  COMPOSER_POSITIONS,
  TRANSCRIPT_PRESENTATION_LABELS,
  TRANSCRIPT_PRESENTATIONS,
  type ComposerPosition,
  type TranscriptPresentation,
} from '../prompt/configuration.js';
import {completedActivity, liveActivityParts} from '../status/activity.js';
import type {Key} from '../terminal/keys.js';
import {truncateAnsi, repeatToWidth} from '../util/text.js';
import {DRAFT_PANEL_ACTIONS, renderActionHelp} from './actions.js';
import {GLYPHS} from './glyphs.js';
import {foreground, UI_COLORS, lazyForeground} from './palette.js';

export interface LayoutChoice {
  composerPosition: ComposerPosition;
  transcriptPresentation: TranscriptPresentation;
}

export interface LayoutPanelState {
  selectedIndex: number;
  draft: LayoutChoice;
  /** The layout in effect; the draft is only a preview until saved. */
  saved: LayoutChoice;
  message?: string;
}

const PRIMARY = lazyForeground(UI_COLORS.primary);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const ACCENT = lazyForeground(UI_COLORS.accent);
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const SEPARATOR = lazyForeground(UI_COLORS.separator);
const RESET = '\u001B[0m';

/** A fixed date so completion times in the preview never change between renders. */
const FIXTURE_TIME = new Date(2026, 0, 1, 9, 41, 0);

/**
 * The showcase transcript: a folded build, a multi-line command, a failure and
 * a command still running. It lives in its own OutputBuffer,
 * so nothing here runs, and nothing reaches the real transcript, journal or /copy.
 */
function fixture(presentation: TranscriptPresentation): {output: OutputBuffer; running: string} {
  const output = new OutputBuffer();
  output.setOutputFolding('smart');
  output.presenter.setLayout(presentation);
  const finish = (command: string, exitCode: number, elapsedMs: number) => {
    output.complete(exitCode);
    const parts = completedActivity(command, elapsedMs, FIXTURE_TIME, exitCode, false);
    output.setCompletionLifecycle(`${parts.main}${parts.detail}`);
    output.addHistoryLine(`${parts.main}${parts.detail}`);
  };
  output.beginCommand('npm run build', ['❯ npm run build']);
  output.write(Array.from({length: 40}, (_, index) => `compiled module ${index + 1}/40\r\n`).join(''));
  finish('npm run build', 0, 2_400);
  output.beginCommand('for f in *.log\ndo gzip "$f"\ndone', ['❯ for f in *.log', '  do gzip "$f"', '  done']);
  finish('for f in *.log\ndo gzip "$f"\ndone', 0, 310);
  output.beginCommand('cat missing.txt', ['❯ cat missing.txt']);
  output.write('cat: missing.txt: No such file or directory\r\n');
  finish('cat missing.txt', 1, 8);
  const running = 'npm test';
  output.beginCommand(running, [`❯ ${running}`]);
  output.write('▶ suite\r\n  ✔ renders the layout (3ms)\r\n');
  return {output, running};
}

/**
 * A deterministic mini-screen for one layout: the fixture through the real
 * presenter, placed by the real ScreenPlan. Only the composer's own text is a
 * fixed placeholder.
 */
/** Rows the whole fixture needs with a composer and spare rows below it, so Flow is visibly different. */
export function layoutPreviewHeight(columns: number): number {
  return fixture('normal').output.wrapped(Math.max(10, columns)).length + 8;
}

const POSITION_CAPTIONS: Record<ComposerPosition, string> = {
  bottom: 'Bottom: the composer stays docked at the bottom edge.',
  top: 'Top: the composer stays at the top, and the transcript reads downward below it.',
  flow: 'Flow: the prompt follows the newest output and scrolls with it; it reaches the bottom once output fills the screen.',
};

export function renderLayoutPreview(choice: LayoutChoice, columns: number, rows: number): string[] {
  const width = Math.max(10, columns);
  const height = Math.max(4, rows);
  const {output, running} = fixture(choice.transcriptPresentation);
  const wrapped = output.wrapped(width);
  const plan = planScreen({rows: height, inputRows: 1, suggestions: 0, running: true, detached: false, hasOutput: wrapped.length > 0,
    contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine', composerPosition: choice.composerPosition,
    transcriptRows: wrapped.length});
  const start = Math.max(0, wrapped.length - plan.viewportRows);
  const visible = wrapped.slice(start, start + plan.transcript.height).map(row =>
    output.presenter.decorate(row, row.lineIndex === undefined ? undefined : output.lineTypes.get(row.lineIndex), {now: 0}));
  const activity = liveActivityParts(running, 12_000);
  const separator = `${SEPARATOR}${repeatToWidth(GLYPHS.separator, width)}${RESET}`;
  const paint: Record<RegionKind, string[]> = {
    transcript: visible,
    gap: [],
    jump: [],
    panel: [],
    inspector: [],
    suggestions: [],
    activity: plan.composerPosition === 'top'
      ? ['', `${SECONDARY}${activity.phrase}${SUBTLE}${activity.duration}${RESET}`]
      : [`${SECONDARY}${activity.phrase}${SUBTLE}${activity.duration}${RESET}`, ''],
    composerBorder: [separator],
    prompt: [`${ACCENT} ~/Projects/demo${RESET}  ${SUBTLE}main${RESET}`],
    input: [`${ACCENT}${GLYPHS.prompt}${RESET} ${PRIMARY}git push${RESET}`],
    separator: [separator],
    status: [],
    notices: [],
    find: [],
    awake: [],
  };
  const frame = new Array<string>(plan.rows).fill('');
  for (const region of plan.regions) {
    const content = paint[region.kind];
    for (let index = 0; index < region.height; index += 1) frame[region.top + index] = content[index] ?? '';
  }
  return frame.map(row => truncateAnsi(row, width));
}

type Row = 'position' | 'presentation';
const ROWS: readonly Row[] = ['position', 'presentation'];

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + delta + values.length) % values.length]!;
}

export function createLayoutPanel(saved: LayoutChoice): LayoutPanelState {
  return {selectedIndex: 0, draft: {...saved}, saved: {...saved}};
}

export function layoutDraftChanged(state: LayoutPanelState): boolean {
  return state.draft.composerPosition !== state.saved.composerPosition
    || state.draft.transcriptPresentation !== state.saved.transcriptPresentation;
}

export function handleLayoutPanelKey(key: Key, state: LayoutPanelState): boolean {
  if (key.kind === 'up' || key.kind === 'down') {
    state.selectedIndex = (state.selectedIndex + (key.kind === 'up' ? -1 : 1) + ROWS.length) % ROWS.length;
  } else if (key.kind === 'left' || key.kind === 'right') {
    const delta = key.kind === 'left' ? -1 : 1;
    if (ROWS[state.selectedIndex] === 'position') state.draft.composerPosition = cycle(COMPOSER_POSITIONS, state.draft.composerPosition, delta);
    else state.draft.transcriptPresentation = cycle(TRANSCRIPT_PRESENTATIONS, state.draft.transcriptPresentation, delta);
  } else return false;
  state.message = undefined;
  return true;
}

export function renderLayoutPanel(state: LayoutPanelState, columns: number, rowsAvailable: number): string[] {
  const {draft, saved} = state;
  const value = (text: string, savedText: string) => (text === savedText ? `‹ ${text} ›` : `‹ ${text} ›  ${SUBTLE}saved: ${savedText}`);
  const labels: Record<Row, string> = {
    position: `Composer position   ${value(COMPOSER_POSITION_LABELS[draft.composerPosition], COMPOSER_POSITION_LABELS[saved.composerPosition])}`,
    presentation: `Transcript          ${value(TRANSCRIPT_PRESENTATION_LABELS[draft.transcriptPresentation], TRANSCRIPT_PRESENTATION_LABELS[saved.transcriptPresentation])}`,
  };
  const out = [`${PRIMARY}  Layout${RESET}`, ''];
  ROWS.forEach((row, index) => {
    const selected = index === state.selectedIndex;
    out.push(`${selected ? `${ACCENT}›` : ' '} ${selected ? ACCENT : SECONDARY}${labels[row]}${RESET}`);
  });
  const controls = ['', renderActionHelp(DRAFT_PANEL_ACTIONS)];
  const header = ['', `${PRIMARY}Preview${RESET}  ${layoutDraftChanged(state) ? `${ACCENT}unsaved preview` : `${SUBTLE}matches current`}${RESET}  ${SUBTLE}sample content; nothing runs${RESET}`,
    `  ${SUBTLE}${POSITION_CAPTIONS[draft.composerPosition]}${RESET}`];
  const message = state.message ? [`${SECONDARY}${state.message}${RESET}`] : [];
  // The preview gets whatever height is left, between rules so its edges read as a screen.
  const previewRows = Math.max(0, Math.min(layoutPreviewHeight(columns - 2),
    rowsAvailable - out.length - header.length - controls.length - message.length - 2));
  const rule = `${SUBTLE}${'┄'.repeat(Math.max(1, columns - 2))}${RESET}`;
  const preview = previewRows >= 4
    ? [rule, ...renderLayoutPreview(draft, columns - 2, previewRows).map(row => `${SUBTLE}│${RESET} ${row}`), rule]
    : [`  ${SUBTLE}Enlarge the window to see the preview.${RESET}`];
  return [...out, ...header, ...preview, ...message, ...controls].map(row => truncateAnsi(row, columns));
}
