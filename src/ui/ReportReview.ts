import type {Key} from '../terminal/keys.js';
import type {CompletedCommand} from '../output/OutputBuffer.js';
import {renderControlRows} from './controls.js';
import {foreground, UI_COLORS} from './palette.js';
import {truncateAnsi, truncateText} from '../util/text.js';
import {displaySafe} from '../input/PasteReview.js';
import {buildReport, describeFindings, scanSensitive, type ReportFinding, type ReportOptions} from '../clipboard/report.js';

/**
 * The review before a report is copied: the exact text that will go to the clipboard, what looks sensitive in the
 * unredacted report, and the switches that change it. Nothing is copied until Enter; Esc copies nothing.
 */
export interface ReportReviewState {
  /** Oldest first. */
  records: CompletedCommand[];
  options: ReportOptions;
  /** What the unredacted report contains that looks sensitive (decides whether review is needed at all). */
  sensitive: ReportFinding[];
  /** The report as it will be copied. */
  text: string;
  /** What redaction changed in `text`. */
  redacted: ReportFinding[];
  /** The person edited the text in their editor: switches no longer rebuild it until they reset. */
  edited: boolean;
  scroll: number;
  /** An editor can be offered (VISUAL/EDITOR is set). */
  canEdit: boolean;
}

export function createReportReview(records: readonly CompletedCommand[], options: ReportOptions, canEdit: boolean): ReportReviewState {
  const state: ReportReviewState = {records: [...records], options: {...options}, sensitive: [], text: '', redacted: [], edited: false, scroll: 0, canEdit};
  rebuild(state);
  return state;
}

function rebuild(state: ReportReviewState): void {
  const raw = buildReport(state.records, {...state.options, redact: false}).text;
  state.sensitive = scanSensitive(raw, state.options.home);
  const built = buildReport(state.records, state.options);
  state.text = built.text;
  state.redacted = built.findings;
  state.edited = false;
}

/** Whether a report needs the review before copying: something in it looks sensitive. */
export function reportNeedsReview(records: readonly CompletedCommand[], options: ReportOptions): boolean {
  return scanSensitive(buildReport(records, {...options, redact: false}).text, options.home).length > 0;
}

export type ReportReviewAction = {kind: 'close'} | {kind: 'copy'; text: string} | {kind: 'edit'};

export function reportReviewKey(state: ReportReviewState, key: Key, height: number): ReportReviewAction | undefined {
  const lines = state.text.split('\n').length;
  const page = Math.max(1, height - 8);
  if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value === 'q')) return {kind: 'close'};
  if (key.kind === 'enter') return {kind: 'copy', text: state.text};
  if (key.kind === 'up' || key.kind === 'down') { state.scroll += key.kind === 'up' ? -1 : 1; }
  else if (key.kind === 'pageUp' || key.kind === 'pageDown') { state.scroll += key.kind === 'pageUp' ? -page : page; }
  else if (key.kind === 'text') {
    const toggles: Record<string, () => void> = {
      r: () => { state.options.redact = !state.options.redact; },
      f: () => { state.options.format = state.options.format === 'markdown' ? 'plain' : 'markdown'; },
      d: () => { state.options.directory = !state.options.directory; },
      t: () => { state.options.timestamps = !state.options.timestamps; },
    };
    if (key.value === 'e' && state.canEdit) return {kind: 'edit'};
    const toggle = toggles[key.value];
    if (toggle) { toggle(); rebuild(state); }
  }
  state.scroll = Math.max(0, Math.min(state.scroll, lines - 1));
  return undefined;
}

/** The person's edited text replaces the report as it will be copied (switches rebuild from the records again). */
export function applyReportEdit(state: ReportReviewState, text: string): void {
  state.text = text;
  state.edited = true;
  state.scroll = 0;
}

export function renderReportReview(state: ReportReviewState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const warning = foreground(UI_COLORS.failure);
  const reset = '\u001b[0m';
  const width = Math.max(10, columns - 4);
  const count = state.records.length;
  const format = state.options.format === 'markdown' ? 'Markdown' : 'plain text';
  const out = [`  ${primary}Copy as report${reset}  ${subtle}${truncateText(`${count} command${count === 1 ? '' : 's'} · ${format}${state.edited ? ' · edited' : ''}`, Math.max(4, width - 16))}${reset}`];
  if (state.sensitive.length) {
    const what = describeFindings(state.sensitive);
    const how = state.edited ? 'check your edit' : state.options.redact ? `redacted ${describeFindings(state.redacted) || 'nothing'}` : 'NOT redacted';
    out.push(`  ${warning}${truncateText(`Looks sensitive: ${what} · ${how}`, width)}${reset}`);
  } else out.push(`  ${subtle}${truncateText('No common secret shapes found. Redaction is a pattern match, not a guarantee: read before sharing.', width)}${reset}`);
  out.push(`  ${subtle}${truncateText(`Redact ${state.options.redact ? 'on' : 'off'} (r) · Directory ${state.options.directory ? 'on' : 'off'} (d) · Times ${state.options.timestamps ? 'on' : 'off'} (t) · Format (f)`, width)}${reset}`, '');
  const controls = renderControlRows([['↑↓', 'scroll'], ['Enter', 'copy'], ...(state.canEdit ? [['e', 'edit'] as const] : []), ['Esc', 'cancel']], width);
  const room = Math.max(1, height - out.length - controls.length - 1);
  const lines = state.text.split('\n');
  for (const line of lines.slice(state.scroll, state.scroll + room)) out.push(`  ${secondary}${truncateText(displaySafe(line), width)}${reset}`);
  if (state.scroll + room < lines.length) out[out.length - 1] = `  ${subtle}… ${lines.length - state.scroll - room + 1} more lines (↓)${reset}`;
  out.push('', ...controls.map(row => `  ${row}`));
  return out.map(line => truncateAnsi(line, columns)).slice(0, Math.max(1, height));
}
