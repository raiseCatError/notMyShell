import type {Key} from '../terminal/keys.js';
import {consoleCopyText, sourcePosition, type ConsoleLog, type ConsoleOrigin, type ConsoleRecord, type ConsoleSeverity} from '../browser/console.js';
import {renderControlRows} from '../ui/controls.js';
import {editText} from '../ui/formControls.js';
import {getIconStyle} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, stripAnsi, truncateAnsi, truncateText} from '../util/text.js';
import {inert} from './document.js';

/**
 * The runtime Console of a document's browser preview (#466), shown the way Problems is: a list under the editor's text, with
 * the same keys (↑↓, Tab filters, typing searches, Enter goes to the source, Esc back). It reads a `ConsoleLog` the preview's
 * page fills; it never changes the page (no script or network rule, no evaluation, no input to it) and never writes the
 * buffer except moving the caret on Enter, so the text, selection history, dirty state and undo stay exactly as they were.
 *
 * Runtime entries are told apart from Problems' static findings: the header says Console and how the page ran, each row
 * names where it came from (JS, log, net, CSP, NMSh, page), and an entry whose source cannot be mapped exactly says why
 * instead of pretending to have a place in the file.
 */

/** What the workspace hands the Console when it opens: the live log and what is needed to map entries to the text. */
export interface ConsoleFeed {
  log: ConsoleLog;
  documentName: string;
  /** Scripts run in the page (the person trusted this file). */
  scripts: boolean;
  /** How the page was made from the file. */
  kind: 'html' | 'markdown';
  /** The text the loaded page was built from. */
  servedText(): string | undefined;
}

export type ConsoleFilter = 'all' | 'problems' | 'errors';

export interface ConsoleDialog {
  feed: ConsoleFeed;
  filter: ConsoleFilter;
  query: string;
  /** The focused entry, by record id, so entries arriving do not move the focus. */
  focusId?: number;
  /** Entries marked for copying (Shift+↑↓, select all). */
  marked: Set<number>;
  /** The copy review: exactly the text that would be copied, waiting for Enter. */
  review?: {text: string; count: number};
  /** A one-line answer (why Enter cannot go to the source, what was copied). */
  note?: string;
}

export interface ConsoleHost {
  /** The buffer's current text and lines, for mapping an entry to the source. */
  text(): string;
  lines(): readonly string[];
  /** Move the caret to a position (a jump the editor's Back can return from). */
  jump(line: number, column: number): void;
  close(): void;
}

export type ConsoleKeyResult = {kind: 'copy'; text: string} | undefined;

const FILTERS: ConsoleFilter[] = ['all', 'problems', 'errors'];
const FILTER_LABEL: Record<ConsoleFilter, string> = {all: 'all', problems: 'errors and warnings', errors: 'errors'};
const ORIGIN_TAG: Record<ConsoleOrigin, string> = {exception: 'JS', console: 'log', network: 'net', security: 'CSP', policy: 'NMSh', page: 'page'};
const ROWS = 6;

export function openConsoleDialog(feed: ConsoleFeed): ConsoleDialog {
  return {feed, filter: 'all', query: '', marked: new Set()};
}

/** The entries shown: newest first, by severity filter and search words. */
export function consoleList(dialog: ConsoleDialog): ConsoleRecord[] {
  const allowed: ConsoleSeverity[] = dialog.filter === 'errors' ? ['error'] : dialog.filter === 'problems' ? ['error', 'warning'] : ['error', 'warning', 'info'];
  const words = dialog.query.toLowerCase().split(/\s+/u).filter(Boolean);
  return dialog.feed.log.entries()
    .filter(record => allowed.includes(record.severity) && words.every(word => `${record.message} ${record.location?.label ?? ''} ${ORIGIN_TAG[record.origin]} ${record.severity}`.toLowerCase().includes(word)))
    .reverse();
}

function focusIndex(dialog: ConsoleDialog, items: readonly ConsoleRecord[]): number {
  const index = items.findIndex(record => record.id === dialog.focusId);
  return index >= 0 ? index : 0;
}

function where(record: ConsoleRecord): string {
  const location = record.location;
  if (!location) return '';
  return `${location.label}${location.line !== undefined ? `:${location.line + 1}${location.column !== undefined ? `:${location.column + 1}` : ''}` : ''}`;
}

export function consoleKey(dialog: ConsoleDialog, key: Key, host: ConsoleHost): ConsoleKeyResult {
  const items = consoleList(dialog);
  let index = focusIndex(dialog, items);
  const focus = (next: number) => { index = Math.max(0, Math.min(items.length - 1, next)); dialog.focusId = items[index]?.id; };
  dialog.note = undefined;
  if (dialog.review) {
    if (key.kind === 'enter') { const {text, count} = dialog.review; dialog.review = undefined; dialog.marked.clear(); dialog.note = `Copied ${count} entr${count === 1 ? 'y' : 'ies'}.`; return {kind: 'copy', text}; }
    if (key.kind === 'escape' || key.kind === 'interrupt') dialog.review = undefined;
    return undefined;
  }
  if (key.kind === 'escape') { host.close(); return undefined; }
  if (key.kind === 'up' || key.kind === 'focusPrevious' || key.kind === 'suggestPrevious') { focus(index - 1); return undefined; }
  if (key.kind === 'down' || key.kind === 'suggestNext') { focus(index + 1); return undefined; }
  if (key.kind === 'pageUp') { focus(index - ROWS); return undefined; }
  if (key.kind === 'pageDown') { focus(index + ROWS); return undefined; }
  if (key.kind === 'selectUp' || key.kind === 'selectDown') {
    const record = items[index];
    if (record) { if (dialog.marked.has(record.id)) dialog.marked.delete(record.id); else dialog.marked.add(record.id); }
    focus(index + (key.kind === 'selectUp' ? -1 : 1));
    return undefined;
  }
  if (key.kind === 'selectAll') {
    const all = items.length > 0 && items.every(record => dialog.marked.has(record.id));
    for (const record of items) { if (all) dialog.marked.delete(record.id); else dialog.marked.add(record.id); }
    return undefined;
  }
  if (key.kind === 'complete') { dialog.filter = FILTERS[(FILTERS.indexOf(dialog.filter) + 1) % FILTERS.length]!; dialog.focusId = undefined; return undefined; }
  if (key.kind === 'delete') { dialog.feed.log.clear(); dialog.marked.clear(); dialog.focusId = undefined; dialog.note = 'Cleared. New entries appear as the page reports them.'; return undefined; }
  if (key.kind === 'interrupt') {
    const chosen = items.filter(record => dialog.marked.has(record.id));
    const records = (chosen.length ? chosen : items.slice(index, index + 1)).slice().sort((a, b) => a.id - b.id);
    if (!records.length) { dialog.note = 'Nothing to copy.'; return undefined; }
    dialog.review = {text: consoleCopyText(records, dialog.feed.documentName), count: records.length};
    return undefined;
  }
  if (key.kind === 'enter') {
    const record = items[index];
    if (!record) return undefined;
    const position = sourcePosition(record, {kind: dialog.feed.kind, servedText: dialog.feed.servedText(), currentText: host.text(), lines: host.lines()});
    if ('reason' in position) { dialog.note = `No place in the text to go to: ${position.reason}.`; return undefined; }
    host.jump(position.line, position.column);
    host.close();
    return undefined;
  }
  const next = editText(dialog.query, key);
  if (next !== undefined) { dialog.query = next.slice(0, 80); dialog.focusId = undefined; }
  return undefined;
}

/** The Console's rows under the editor's text, `width` columns wide (the editor's footer area). */
export function consoleRows(dialog: ConsoleDialog, width: number): string[] {
  const accent = foreground(UI_COLORS.accent), subtle = foreground(UI_COLORS.subtle), reset = '\u001b[0m';
  const safe = getIconStyle() === 'safe';
  const glyph = (severity: ConsoleSeverity) => safe ? ({error: 'E', warning: 'W', info: 'i'})[severity] : ({error: '✖', warning: '▲', info: 'ℹ'})[severity];
  const tone = (severity: ConsoleSeverity) => severity === 'error' ? foreground(UI_COLORS.failure) : severity === 'warning' ? foreground(UI_COLORS.warning) : subtle;
  const log = dialog.feed.log;
  const items = consoleList(dialog);
  const index = focusIndex(dialog, items);
  if (dialog.review) {
    const lines = dialog.review.text.split('\n');
    const shown = lines.slice(0, ROWS).map(line => `${subtle}  ${truncateText(inert(line), Math.max(4, width - 2))}${reset}`);
    if (lines.length > ROWS) shown.push(`${subtle}  … ${lines.length - ROWS} more line${lines.length - ROWS === 1 ? '' : 's'}${reset}`);
    const header = `${accent}Copy ${dialog.review.count} Console entr${dialog.review.count === 1 ? 'y' : 'ies'}?${reset}${subtle} Addresses and likely secrets are already replaced; this is exactly what will be copied.${reset}`;
    return [truncateAnsi(header, width), ...shown.map(row => truncateAnsi(row, width)), ...renderControlRows([['Enter', 'copy'], ['Esc', 'back']], width)];
  }
  const counts = {error: 0, warning: 0, info: 0};
  for (const record of log.entries()) counts[record.severity] += record.count;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const how = dialog.feed.scripts ? 'scripts on' : 'scripts off';
  const summary = [plural(counts.error, 'error'), plural(counts.warning, 'warning'), ...(counts.info ? [`${counts.info} message${counts.info === 1 ? '' : 's'}`] : []), ...(log.dropped ? [`${log.dropped} older dropped`] : [])].join(' · ');
  // Runtime, not static: the word Console and the page's script state come first, so it is never mistaken for Problems.
  const lead = `${accent}Console${reset}${subtle} (page runtime, ${how}) · ${summary} · ${FILTER_LABEL[dialog.filter]}${dialog.marked.size ? ` · ${dialog.marked.size} marked` : ''} · ${reset}`;
  const header = `${lead}${truncateText(inert(dialog.query), Math.max(1, width - displayWidth(stripAnsi(lead)) - 1))}${accent}▏${reset}`;
  const narrow = width < 60;
  const start = Math.max(0, Math.min(index - Math.floor(ROWS / 2), items.length - ROWS));
  const shown = items.slice(start, start + ROWS).map((record, offset) => {
    const focused = start + offset === index;
    const mark = dialog.marked.has(record.id) ? (safe ? '*' : '•') : ' ';
    const tag = ORIGIN_TAG[record.origin].padEnd(4);
    const count = record.count > 1 ? ` ×${record.count}` : '';
    const place = narrow ? '' : where(record);
    const placeWidth = narrow ? 0 : Math.min(28, Math.max(10, Math.floor(width * 0.25)));
    const placeText = place ? `${subtle}${truncateText(inert(place), placeWidth).padEnd(placeWidth)}${reset} ` : narrow ? '' : `${' '.repeat(placeWidth)} `;
    const lead = `${focused ? `${accent}▸` : ' '}${mark}${reset}${tone(record.severity)}${glyph(record.severity)}${reset} ${subtle}${tag}${reset} `;
    const room = Math.max(4, width - 8 - (narrow ? 0 : placeWidth + 1) - count.length);
    return `${lead}${placeText}${truncateText(inert(record.message.split('\n')[0] ?? ''), room)}${subtle}${count}${reset}`;
  });
  if (!items.length) {
    const empty = log.size === 0
      ? (dialog.feed.scripts ? 'Nothing reported yet. Entries appear as the page loads and runs.' : 'Nothing reported yet. Scripts are off, so only failed loads and refusals appear; T in the preview turns scripts on for this file.')
      : 'Nothing matches this filter.';
    for (const line of wrapWords(empty, Math.max(8, width - 2)).slice(0, 3)) shown.push(`${subtle}  ${line}${reset}`);
  }
  // One line about the focused entry: where it is, or why it has no place in the text; or the latest answer.
  const focused = items[index];
  const detail = dialog.note ?? (focused ? detailLine(focused, width) : '');
  return [truncateAnsi(header, width), ...shown.map(row => truncateAnsi(row, width)), truncateAnsi(`${subtle}${truncateText(inert(detail), Math.max(1, width))}${reset}`, width),
    ...renderControlRows([['↑↓', 'choose'], ['Enter', 'go to source'], ['Tab', 'filter'], ['Shift+↑↓', 'mark'], ['Ctrl+C', 'copy…'], ['Del', 'clear'], ['Esc', 'back']], width)];
}

function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && displayWidth(`${line} ${word}`) > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.map(item => truncateText(item, width));
}

function detailLine(record: ConsoleRecord, width: number): string {
  const place = where(record);
  const frame = record.stack?.[0];
  const target = record.location?.target === 'document' ? '' : record.location?.target === 'local' ? ' (a file beside the document)' : record.location ? ' (outside the document)' : '';
  // A row shows the first line of a message; a longer or multi-line one says how to read all of it.
  const more = record.message.includes('\n') || displayWidth(record.message) > width - 40 ? 'Ctrl+C shows all of it' : '';
  return [place ? `at ${place}${target}` : 'no source location', frame && !frame.endsWith(`(${place})`) ? `from ${frame}` : '', more].filter(Boolean).join(' · ');
}
