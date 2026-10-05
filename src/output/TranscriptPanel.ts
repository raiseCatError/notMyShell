import {DEFAULT_TREATMENT_SETTINGS, type TreatmentSettings} from '../chroma/treatment.js';
import {
  DIVIDER_COLOR_LABELS,
  HISTORICAL_PROMPT_LEVEL_LABELS,
  HISTORICAL_PROMPT_LEVELS,
  type HistoricalPromptLevel,
  DIVIDER_COLOR_MODES,
  NATIVE_PALETTE_IDS,
  type HistoryColorMode,
  type TranscriptAppearance,
} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import type {Key} from '../terminal/keys.js';
import {DRAFT_PANEL_ACTIONS, renderActionHelp} from '../ui/actions.js';
import {GLYPHS} from '../ui/glyphs.js';
import {focusForeground, foreground, UI_COLORS, lazyForeground} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import {renderHistoricalContext, type HistoricalContextSnapshot} from './OutputBuffer.js';
import {FOLD_HEAD_LINES, FOLD_TAIL_LINES, OUTPUT_FOLDING_MODES, type OutputFoldingMode} from './FoldPolicy.js';

export interface TranscriptPanelState {
  selectedIndex: number;
  draft: TranscriptAppearance;
  /** The appearance currently in effect; the draft is only a preview until saved. */
  saved: TranscriptAppearance;
  /**
   * Output folding: the same root `outputFolding` setting as Config and the
   * command palette, edited here as a draft. Absent: the row is not shown.
   */
  folding?: {draft: OutputFoldingMode; saved: OutputFoldingMode};
  message?: string;
}

type Row = 'divider' | 'density' | 'dividerColors' | 'prompt' | 'colors' | 'theme' | 'folding';

const PRIMARY = lazyForeground(UI_COLORS.primary);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const ACCENT = lazyForeground(UI_COLORS.accent);
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const RESET = '\u001B[0m';
const COLOR_MODES: readonly HistoryColorMode[] = ['followPrompt', 'theme', 'grayscale'];

function colorModeLabel(mode: HistoryColorMode): string {
  return mode === 'followPrompt' ? 'Follow prompt' : mode === 'theme' ? 'Choose theme' : 'Grayscale';
}

function onOff(value: boolean): string {
  return value ? 'On' : 'Off';
}

export function foldingLabel(mode: OutputFoldingMode): string {
  return mode === 'never' ? 'Off' : mode === 'smart' ? 'Smart' : 'Always';
}

/** Editable rows; the theme row exists only while Choose theme is selected. */
function rows(state: TranscriptPanelState): Row[] {
  return ['divider', 'density', ...(state.draft.divider ? ['dividerColors' as const] : []), 'prompt', 'colors', ...(state.draft.historyColors === 'theme' ? ['theme' as const] : []),
    ...(state.folding ? ['folding' as const] : [])];
}

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + delta + values.length) % values.length]!;
}

const PROMPT_LEVELS = [...HISTORICAL_PROMPT_LEVELS, 'off'] as const;

/** Full / Compact / Minimal while on, Off otherwise: one presentation choice over the two stored fields. */
export function historicalPromptLevel(appearance: TranscriptAppearance): HistoricalPromptLevel | 'off' {
  return appearance.historicalPrompt ? appearance.historicalPromptLevel ?? 'full' : 'off';
}

export function transcriptDraftChanged(state: TranscriptPanelState): boolean {
  return JSON.stringify(state.draft) !== JSON.stringify(state.saved) || state.folding?.draft !== state.folding?.saved;
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
      case 'dividerColors': draft.dividerColors = cycle(DIVIDER_COLOR_MODES, draft.dividerColors, delta); break;
      case 'prompt': {
        const level = cycle(PROMPT_LEVELS, historicalPromptLevel(draft), delta);
        draft.historicalPrompt = level !== 'off';
        if (level !== 'off') draft.historicalPromptLevel = level;
        break;
      }
      case 'colors': draft.historyColors = cycle(COLOR_MODES, draft.historyColors, delta); break;
      case 'theme': draft.historyTheme = cycle(NATIVE_PALETTE_IDS, draft.historyTheme, delta); break;
      case 'folding': state.folding!.draft = cycle(OUTPUT_FOLDING_MODES, state.folding!.draft, delta); break;
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
export function renderTranscriptPanel(state: TranscriptPanelState, columns: number, sample: HistoricalContextSnapshot, rowsAvailable = Infinity,
  treatment: TreatmentSettings = DEFAULT_TREATMENT_SETTINGS): string[] {
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
    dividerColors: `Divider colors     ${value(DIVIDER_COLOR_LABELS[draft.dividerColors], DIVIDER_COLOR_LABELS[saved.dividerColors])}`,
    prompt: `Historical prompt  ${value(HISTORICAL_PROMPT_LEVEL_LABELS[historicalPromptLevel(draft)], HISTORICAL_PROMPT_LEVEL_LABELS[historicalPromptLevel(saved)])}`,
    colors: `History colors     ${value(colorModeLabel(draft.historyColors), colorModeLabel(saved.historyColors))}`,
    theme: `History theme      ${value(NATIVE_PROMPT_THEMES[draft.historyTheme].label, NATIVE_PROMPT_THEMES[saved.historyTheme].label)}`,
    folding: state.folding ? `Output folding     ${value(foldingLabel(state.folding.draft), foldingLabel(state.folding.saved))}` : '',
  };
  available.forEach((row, index) => {
    const selected = index === state.selectedIndex;
    out.push(`${selected ? `${ACCENT}›` : ' '} ${focusForeground(selected)}${labels[row]}${RESET}`);
  });

  const preview = (appearance: TranscriptAppearance) => renderHistoricalContext(sample, width - 2, appearance, treatment)?.ansi;
  const gallery: string[] = [];
  if (available[state.selectedIndex] === 'dividerColors') {
    // Every choice through the real history-header renderer; history dividers never move.
    gallery.push('', `${PRIMARY}Divider colors${RESET}  ${SUBTLE}● selected · history stays static${RESET}`);
    for (const mode of DIVIDER_COLOR_MODES) {
      const row = renderHistoricalContext(sample, Math.max(1, width - 21), {...draft, dividerColors: mode}, treatment);
      gallery.push(`${draft.dividerColors === mode ? `${ACCENT}●` : `${SUBTLE}○`} ${SECONDARY}${DIVIDER_COLOR_LABELS[mode].padEnd(18)}${RESET} ${row?.ansi ?? ''}${RESET}`);
    }
  }
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
  if (state.folding) sampleRows.push(...foldingPreview(state.folding.draft));
  if (state.message) sampleRows.push(`${SECONDARY}${state.message}${RESET}`);
  const controls = ['', renderActionHelp(DRAFT_PANEL_ACTIONS)];

  // Short terminals keep the editable rows, preview, and controls; the gallery goes first.
  const includeGallery = out.length + gallery.length + sampleRows.length + controls.length <= rowsAvailable;
  return [...out, ...(includeGallery ? gallery : []), ...sampleRows, ...controls].map(row => truncateAnsi(row, columns));
}

const FOLD_NOTES: Record<OutputFoldingMode, string> = {
  never: 'long output always stays expanded',
  smart: 'long, repetitive successful output starts folded; failures stay open',
  always: 'every long block starts folded, failures included',
};

/** A long successful block as this mode would present it on completion (Space/Tab still expands it). */
export function foldingPreview(mode: OutputFoldingMode): string[] {
  const rows = [`  ${SECONDARY}${GLYPHS.prompt} npm install${RESET}  ${SUBTLE}${FOLD_NOTES[mode]}${RESET}`];
  const lines = Array.from({length: 120}, (_, index) => `added package-${index + 1}`);
  if (mode === 'never') return [...rows, ...lines.slice(0, 3).map(line => `  ${SUBTLE}${line}${RESET}`), `  ${SUBTLE}… 117 more lines${RESET}`];
  const hidden = lines.length - FOLD_HEAD_LINES - FOLD_TAIL_LINES;
  return [...rows, ...lines.slice(0, FOLD_HEAD_LINES).map(line => `  ${SUBTLE}${line}${RESET}`),
    `  ${ACCENT}${hidden} lines hidden · Ctrl+O  ›${RESET}`, ...lines.slice(-FOLD_TAIL_LINES).map(line => `  ${SUBTLE}${line}${RESET}`)];
}
