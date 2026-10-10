import type {Key} from '../terminal/keys.js';
import type {CompletedCommand} from '../output/OutputBuffer.js';
import {renderControlRows} from './controls.js';
import {foreground, UI_COLORS} from './palette.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';
import {displaySafe} from '../input/PasteReview.js';
import {buildReport, describeFindings, redactedLines, redactText, reportText, scanSensitive, type ReportFinding, type ReportOptions} from '../clipboard/report.js';

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
  /** A finished document reviewed as is (a comparison report): only redaction applies; format, directory and times do not. */
  source?: {title: string; text: string};
}

export function createReportReview(records: readonly CompletedCommand[], options: ReportOptions, canEdit: boolean): ReportReviewState {
  const state: ReportReviewState = {records: [...records], options: {...options}, sensitive: [], text: '', redacted: [], edited: false, scroll: 0, canEdit};
  rebuild(state);
  return state;
}

/** Review a finished document (a comparison report) the same way: redaction, the exact text, the same keys. */
export function createTextReview(title: string, text: string, records: readonly CompletedCommand[], options: ReportOptions, canEdit: boolean): ReportReviewState {
  const state: ReportReviewState = {records: [...records], options: {...options}, sensitive: [], text: '', redacted: [], edited: false, scroll: 0, canEdit, source: {title, text}};
  rebuild(state);
  return state;
}

function rebuild(state: ReportReviewState): void {
  if (state.source) {
    const raw = reportText(state.source.text);
    state.sensitive = scanSensitive(raw, state.options.home);
    const redacted = state.options.redact ? redactText(raw, state.options.home) : {text: raw, findings: []};
    state.text = redacted.text;
    state.redacted = redacted.findings;
    state.edited = false;
    return;
  }
  const raw = buildReport(state.records, {...state.options, redact: false}).text;
  state.sensitive = scanSensitive(raw, state.options.home);
  const built = buildReport(state.records, state.options);
  state.text = built.text;
  state.redacted = built.findings;
  state.edited = false;
}


export type ReportReviewAction = {kind: 'close'} | {kind: 'copy'; text: string} | {kind: 'edit'};

export function reportReviewKey(state: ReportReviewState, key: Key, height: number): ReportReviewAction | undefined {
  const page = Math.max(1, height - 8);
  if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value === 'q')) return {kind: 'close'};
  if (key.kind === 'enter') return {kind: 'copy', text: state.text};
  if (key.kind === 'up' || key.kind === 'down') { state.scroll += key.kind === 'up' ? -1 : 1; }
  else if (key.kind === 'pageUp' || key.kind === 'pageDown') { state.scroll += key.kind === 'pageUp' ? -page : page; }
  else if (key.kind === 'text') {
    const toggles: Record<string, () => void> = {
      r: () => { state.options.redact = !state.options.redact; },
      ...(state.source ? {} : {
        f: () => { state.options.format = state.options.format === 'markdown' ? 'plain' : 'markdown'; },
        d: () => { state.options.directory = !state.options.directory; },
        t: () => { state.options.timestamps = !state.options.timestamps; },
      }),
    };
    if (key.value === 'e' && state.canEdit) return {kind: 'edit'};
    const toggle = toggles[key.value];
    if (toggle) { toggle(); rebuild(state); }
  }
  // The render clamps to the wrapped rows it shows; here only the lower bound is known.
  state.scroll = Math.max(0, state.scroll);
  return undefined;
}

/** A report line as display rows of at most `width` cells: wrapped, never cut, so every copied character is shown. */
function wrapRows(line: string, width: number): string[] {
  const rows: string[] = [];
  let row = '';
  let used = 0;
  for (const char of displaySafe(line)) {
    // Conservative cells: a character whose width a terminal may render wider (ambiguous, combining, emoji) counts
    // as two, so no row can overflow the panel and be cut.
    const cells = Math.max(displayWidth(char), (char.codePointAt(0) ?? 0) > 0xff ? 2 : 1);
    if (used + cells > width && row) { rows.push(row); row = ''; used = 0; }
    row += char;
    used += cells;
  }
  rows.push(row);
  return rows;
}

/** The person's edited text replaces the report as it will be copied (switches rebuild from the records again). */
export function applyReportEdit(state: ReportReviewState, text: string): void {
  // The same characters as a generated report: nothing invisible survives into what is checked and copied.
  state.text = reportText(text);
  state.edited = true;
  state.scroll = 0;
  // An edit is checked again: what it contains is what will be copied.
  state.sensitive = scanSensitive(state.text, state.options.home);
  state.redacted = [];
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
  const title = state.source?.title ?? 'Copy as report';
  const detail = state.source ? `Markdown${state.edited ? ' · edited' : ''}` : `${count} command${count === 1 ? '' : 's'} · ${format}${state.edited ? ' · edited' : ''}`;
  const out = [`  ${primary}${title}${reset}  ${subtle}${truncateText(detail, Math.max(4, width - displayWidth(title) - 4))}${reset}`];
  if (state.sensitive.length) {
    const what = describeFindings(state.sensitive);
    const how = state.edited ? 'in your edit, not redacted' : state.options.redact ? `redacted ${describeFindings(state.redacted) || 'nothing'}` : 'NOT redacted';
    out.push(`  ${warning}${truncateText(`Looks sensitive: ${what} · ${how}`, width)}${reset}`);
  } else out.push(`  ${subtle}${truncateText('No common secret shapes found. Redaction is a pattern match, not a guarantee: read before sharing.', width)}${reset}`);
  const marked = redactedLines(state.text);
  if (marked.length) out.push(`  ${subtle}${truncateText(`Changed lines (▸): ${marked.slice(0, 12).join(', ')}${marked.length > 12 ? ` and ${marked.length - 12} more` : ''}`, width)}${reset}`);
  out.push(`  ${subtle}${truncateText(state.source ? `Redact ${state.options.redact ? 'on' : 'off'} (r)` : `Redact ${state.options.redact ? 'on' : 'off'} (r) · Directory ${state.options.directory ? 'on' : 'off'} (d) · Times ${state.options.timestamps ? 'on' : 'off'} (t) · Format (f)`, width)}${reset}`, '');
  const controls = renderControlRows([['↑↓', 'scroll'], ['Enter', 'copy'], ...(state.canEdit ? [['e', 'edit'] as const] : []), ['Esc', 'cancel']], width);
  const room = Math.max(1, height - out.length - controls.length - 1);
  const markedSet = new Set(marked);
  // Every line wrapped to the panel: a long line is shown in full, never truncated out of sight.
  const rows = state.text.split('\n').flatMap((line, index) => wrapRows(line, width - 1).map((text, part) => ({text, marked: part === 0 && markedSet.has(index + 1)})));
  const more = rows.length > room;
  const visible = more ? room - 1 : room;
  state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, rows.length - visible)));
  for (const row of rows.slice(state.scroll, state.scroll + visible)) out.push(` ${row.marked ? `${warning}▸${reset}` : ' '}${secondary}${row.text}${reset}`);
  if (more) {
    const below = rows.length - state.scroll - visible;
    out.push(`  ${subtle}${below > 0 ? `… ${below} more row${below === 1 ? '' : 's'} below (↓)` : 'end of report (↑ to scroll back)'}${reset}`);
  }
  out.push('', ...controls.map(row => `  ${row}`));
  return out.map(line => truncateAnsi(line, columns)).slice(0, Math.max(1, height));
}
