import {
  NATIVE_PALETTE_IDS,
  type HistoryColorMode,
  type TranscriptAppearance,
} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import type {Key} from '../terminal/keys.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import {renderHistoricalContext, type HistoricalContextSnapshot} from './OutputBuffer.js';

export interface TranscriptPanelState {
  selectedIndex: number;
  draft: TranscriptAppearance;
  /** The appearance currently in effect; the draft is only a preview until saved. */
  saved: TranscriptAppearance;
  message?: string;
}

type Row = 'divider' | 'density' | 'prompt' | 'colors' | 'theme';

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const SUBTLE = foreground(UI_COLORS.subtle);
const RESET = '\u001B[0m';
const COLOR_MODES: readonly HistoryColorMode[] = ['followPrompt', 'theme', 'grayscale'];

function colorModeLabel(mode: HistoryColorMode): string {
  return mode === 'followPrompt' ? 'Follow prompt' : mode === 'theme' ? 'Choose theme' : 'Grayscale';
}

function onOff(value: boolean): string {
  return value ? 'On' : 'Off';
}

/** Editable rows; the theme row exists only while Choose theme is selected. */
function rows(state: TranscriptPanelState): Row[] {
  return ['divider', 'density', 'prompt', 'colors', ...(state.draft.historyColors === 'theme' ? ['theme' as const] : [])];
}

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + delta + values.length) % values.length]!;
}

export function transcriptDraftChanged(state: TranscriptPanelState): boolean {
  return JSON.stringify(state.draft) !== JSON.stringify(state.saved);
}

export function handleTranscriptPanelKey(key: Key, state: TranscriptPanelState): boolean {
  const available = rows(state);
  if (key.kind === 'up') state.selectedIndex = (state.selectedIndex - 1 + available.length) % available.length;
  else if (key.kind === 'down') state.selectedIndex = (state.selectedIndex + 1) % available.length;
  else if (key.kind === 'left' || key.kind === 'right') {
    const delta = key.kind === 'left' ? -1 : 1;
    const draft = state.draft;
    switch (available[state.selectedIndex]) {
      case 'divider': draft.divider = !draft.divider; break;
      case 'density': draft.dividerDensity = draft.dividerDensity === 'compact' ? 'normal' : 'compact'; break;
      case 'prompt': draft.historicalPrompt = !draft.historicalPrompt; break;
      case 'colors': draft.historyColors = cycle(COLOR_MODES, draft.historyColors, delta); break;
      case 'theme': draft.historyTheme = cycle(NATIVE_PALETTE_IDS, draft.historyTheme, delta); break;
      default: return false;
    }
    state.selectedIndex = Math.min(state.selectedIndex, rows(state).length - 1);
  } else return false;
  state.message = undefined;
  return true;
}

/**
 * `sample` is a representative historical context (a semantic prompt
 * snapshot); previews render it through the real history-header renderer.
 */
export function renderTranscriptPanel(state: TranscriptPanelState, columns: number, sample: HistoricalContextSnapshot, rowsAvailable = Infinity): string[] {
  const {draft, saved} = state;
  const width = Math.max(1, columns - 2);
  const out = [`${PRIMARY}  Transcript appearance${RESET}`, ''];
  const available = rows(state);
  const value = (text: string, savedText: string) => text === savedText
    ? `‹ ${text} ›`
    : `‹ ${text} ›  ${SUBTLE}saved: ${savedText}`;
  const labels: Record<Row, string> = {
    divider: `Divider            ${value(onOff(draft.divider), onOff(saved.divider))}`,
    density: `Divider density    ${value(draft.dividerDensity === 'compact' ? 'Compact' : 'Normal', saved.dividerDensity === 'compact' ? 'Compact' : 'Normal')}`,
    prompt: `Historical prompt  ${value(onOff(draft.historicalPrompt), onOff(saved.historicalPrompt))}`,
    colors: `History colors     ${value(colorModeLabel(draft.historyColors), colorModeLabel(saved.historyColors))}`,
    theme: `History theme      ${value(NATIVE_PROMPT_THEMES[draft.historyTheme].label, NATIVE_PROMPT_THEMES[saved.historyTheme].label)}`,
  };
  available.forEach((row, index) => {
    const selected = index === state.selectedIndex;
    out.push(`${selected ? `${ACCENT}›` : ' '} ${selected ? ACCENT : SECONDARY}${labels[row]}${RESET}`);
  });

  const preview = (appearance: TranscriptAppearance) => renderHistoricalContext(sample, width - 2, appearance)?.ansi;
  const gallery: string[] = [];
  if (draft.historyColors === 'theme') {
    gallery.push('', `${PRIMARY}History themes${RESET}  ${SUBTLE}● selected  ✓ saved${RESET}`);
    for (const id of NATIVE_PALETTE_IDS) {
      const marker = draft.historyTheme === id ? `${ACCENT}●` : `${SUBTLE}○`;
      const savedMark = saved.historyColors === 'theme' && saved.historyTheme === id ? '✓' : ' ';
      const row = renderHistoricalContext(sample, Math.max(1, width - 21),
        {...draft, historyTheme: id, historicalPrompt: true, divider: false});
      gallery.push(`${marker} ${SECONDARY}${NATIVE_PROMPT_THEMES[id].label.padEnd(17)}${ACCENT}${savedMark}${RESET} ${row?.ansi ?? ''}${RESET}`);
    }
  }

  const sampleRows: string[] = [''];
  sampleRows.push(`${PRIMARY}Preview${RESET}  ${transcriptDraftChanged(state) ? `${ACCENT}unsaved preview` : `${SUBTLE}matches current`}${RESET}`);
  for (const [command, output] of [['git status', 'On branch main'], ['npm test', '✔ 42 passing']] as const) {
    const header = preview(draft);
    if (header) sampleRows.push(`  ${header}`);
    sampleRows.push(`  ${SECONDARY}${GLYPHS.prompt} ${command}${RESET}`, `  ${SUBTLE}${output}${RESET}`);
  }
  if (state.message) sampleRows.push(`${SECONDARY}${state.message}${RESET}`);
  const controls = ['', renderControls([['↑↓', 'move'], ['←→', 'change'], ['Enter', 'save'], ['Esc', 'cancel']])];

  // Short terminals keep the editable rows, preview, and controls; the gallery goes first.
  const includeGallery = out.length + gallery.length + sampleRows.length + controls.length <= rowsAvailable;
  return [...out, ...(includeGallery ? gallery : []), ...sampleRows, ...controls].map(row => truncateAnsi(row, columns));
}
