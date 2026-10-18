import {serializeCopyPayload, type CompletedCommand} from '../output/OutputBuffer.js';
import {parseReportFlag, type ReportFormat} from './report.js';
import {semanticText, type SemanticResult} from '../output/semantic.js';

/**
 * Which completed commands /copy takes, by recency (1 is the latest), and whether NMSh's completion status follows
 * each one's output. One parser and one payload builder for /copy, the interactive picker and the per-block Copy
 * actions, so every path copies the same text for the same records.
 *
 * - `/copy`          the configured default (Output navigation; saved Quick Copy/Interactive Picker choices are honored)
 * - `/copy latest`   the latest output, whatever the default
 * - `/copy ui`       the Interactive Picker, whatever the default
 * - `/copy N`        the Nth latest output
 * - `/copy -N`       the latest N outputs
 * - `/copy A-B`      outputs A through B (either order)
 * - `/copy 1,3,5`    those outputs; items may be ranges (`1,3-5`)
 * - `--status` / `--no-status` override the "Include completion status" setting for this copy only. Flags always
 *   start with two dashes, so they never read as a negative count.
 * - `--report` (Markdown) or `--report=plain`: the selection as a structured report (see report.ts).
 * - `--raw` (the default), `--semantic` or `--both`: the stored output, the Semantic Output reading (raw for a record
 *   that has none), or both under labelled NMSh separators. One of them at most; never with --report.
 * `/cp` is the same command: it reaches this parser with the same arguments.
 */
export const COPY_MAX_INDEX = 999;
/** At most this many outputs in one copy. */
export const COPY_MAX_RECORDS = 100;

export type CopySelector =
  | {kind: 'default'}
  | {kind: 'picker'}
  | {kind: 'latest'; count: number}
  | {kind: 'indices'; indices: number[]};

export interface CopyRequest {
  selector: CopySelector;
  /** An explicit --status / --no-status; undefined follows the setting. */
  status?: boolean;
  /** Copy as a report in this format instead of plain output. */
  report?: ReportFormat;
  /** What of each record is copied; undefined is raw (the stored output). */
  content?: CopyContent;
}

export type CopyContent = 'raw' | 'semantic' | 'both';

export type CopyArgs = {ok: true; request: CopyRequest} | {ok: false; error: string};

const USAGE = 'Use /copy, /copy latest, /copy ui, /copy N, /copy -N, /copy A-B or /copy 1,3-5, optionally with --status, --no-status, --report[=plain], or one of --raw, --semantic, --both.';

/** The text after `/copy`. Nothing is guessed: anything unrecognised is an error that names the usage. */
export function parseCopyArgs(text: string): CopyArgs {
  let status: boolean | undefined;
  let report: ReportFormat | undefined;
  let content: CopyContent | undefined;
  const selectors: string[] = [];
  for (const token of text.trim().split(/\s+/u).filter(Boolean)) {
    const format = parseReportFlag(token);
    if (format === 'invalid') return {ok: false, error: `${token}: a report is --report (Markdown) or --report=plain.`};
    if (format) { report = format; continue; }
    if (token === '--raw' || token === '--semantic' || token === '--both') {
      const value = token.slice(2) as CopyContent;
      if (content !== undefined && content !== value) return {ok: false, error: 'Use one of --raw, --semantic or --both.'};
      content = value;
    } else if (token === '--status' || token === '--no-status') {
      const value = token === '--status';
      if (status !== undefined && status !== value) return {ok: false, error: 'Use either --status or --no-status, not both.'};
      status = value;
    } else if (token.startsWith('--')) return {ok: false, error: `Unknown option ${token}. ${USAGE}`};
    else selectors.push(token);
  }
  if (selectors.length > 1) return {ok: false, error: `One selection at a time (write lists with commas: /copy 1,3,5). ${USAGE}`};
  if (report && status !== undefined) return {ok: false, error: 'A report always includes each command\'s status; leave out --status and --no-status.'};
  if (report && content) return {ok: false, error: 'A report has its own format; leave out --raw, --semantic and --both.'};
  const withStatus = (selector: CopySelector): CopyArgs => ({ok: true, request: {selector, ...(status === undefined ? {} : {status}), ...(report ? {report} : {}), ...(content ? {content} : {})}});
  const selector = selectors[0];
  if (selector === undefined) return withStatus({kind: 'default'});
  if (selector === 'ui') return content && content !== 'raw' ? {ok: false, error: '--semantic and --both copy directly: name the outputs (/copy 2 --semantic).'} : withStatus({kind: 'picker'});
  if (selector === 'latest') return withStatus({kind: 'latest', count: 1});
  const latest = /^-([1-9]\d*)$/u.exec(selector);
  if (latest) {
    const count = Number(latest[1]);
    if (count > COPY_MAX_RECORDS) return {ok: false, error: `At most ${COPY_MAX_RECORDS} outputs in one copy.`};
    return withStatus({kind: 'latest', count});
  }
  const indices: number[] = [];
  for (const item of selector.split(',')) {
    const match = /^([1-9]\d*)(?:-([1-9]\d*))?$/u.exec(item);
    if (!match) return {ok: false, error: `${selector} is not a selection. ${USAGE}`};
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    if (Math.max(from, to) > COPY_MAX_INDEX) return {ok: false, error: `Outputs are numbered 1 to ${COPY_MAX_INDEX}.`};
    for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
      if (!indices.includes(index)) indices.push(index);
      if (indices.length > COPY_MAX_RECORDS) return {ok: false, error: `At most ${COPY_MAX_RECORDS} outputs in one copy.`};
    }
  }
  return withStatus({kind: 'indices', indices});
}

export type CopyResolution =
  | {ok: true; records: CompletedCommand[]; indices: number[]}
  | {ok: false; error: string};

/**
 * The records a selection names, oldest first (the order they ran). `recent` holds completed shell commands newest
 * first. A named output that does not exist refuses the whole copy rather than copying part of what was asked;
 * `-N` takes what there is, up to N.
 */
export function resolveCopySelection(selector: Extract<CopySelector, {kind: 'latest' | 'indices'}>, recent: readonly CompletedCommand[]): CopyResolution {
  if (!recent.length) return {ok: false, error: 'No completed command output to copy yet.'};
  let indices: number[];
  if (selector.kind === 'latest') indices = Array.from({length: Math.min(selector.count, recent.length)}, (_, offset) => offset + 1);
  else {
    const missing = selector.indices.filter(index => index > recent.length);
    if (missing.length) {
      const available = recent.length === 1 ? 'only 1 completed command' : `only ${recent.length} completed commands`;
      return {ok: false, error: `No completed command output at ${missing.length === 1 ? missing[0] : missing.join(', ')}: there ${recent.length === 1 ? 'is' : 'are'} ${available}. Nothing was copied.`};
    }
    indices = [...selector.indices];
  }
  indices.sort((left, right) => right - left);
  return {ok: true, records: indices.map(index => recent[index - 1]!), indices};
}

/**
 * One record's part of the clipboard: its own output (stdout and stderr as stored, never presentation), then, when
 * asked, the completion status NMSh recorded for it when it finished (the same text the transcript shows). An
 * empty string means there is nothing of this record to copy.
 */
export function recordCopyText(record: CompletedCommand, includeStatus: boolean): string {
  const status = includeStatus ? record.lifecycleText.trim() : '';
  const exact = serializeCopyPayload(record);
  // A trailing newline in the output would leave a blank line before the status; the output itself is unchanged.
  return status ? [exact.replace(/\r?\n$/u, ''), status].filter(Boolean).join('\n') : exact;
}

/**
 * The clipboard text for records in the order given: each record's output, followed by its own status when included.
 * Records are separated by a line break unless the previous one already ends with its own.
 */
export function copySelectionPayload(records: readonly CompletedCommand[], includeStatus: boolean): string {
  return records.map(record => recordCopyText(record, includeStatus)).filter(Boolean)
    .reduce((payload, text) => !payload ? text : payload.endsWith('\n') ? payload + text : `${payload}\n${text}`, '');
}

/**
 * `/copy --semantic` and `--both`: per record, the Semantic Output reading as text, or (both) the raw output and the
 * reading under labelled NMSh separators that cannot be mistaken for output. A record without a reading copies its raw
 * output once, and is counted so the note can say so. Records keep their order and separation as in a raw copy.
 */
export function semanticCopyPayload(records: readonly CompletedCommand[], content: 'semantic' | 'both', includeStatus: boolean,
  reading: (record: CompletedCommand) => SemanticResult | undefined): {payload: string; unavailable: number} {
  let unavailable = 0;
  const parts = records.map(record => {
    const raw = recordCopyText(record, includeStatus);
    const result = reading(record);
    if (!result) { unavailable += 1; return raw; }
    if (content === 'semantic') return semanticText(result);
    return [`── NMSh · raw output ──`, raw.replace(/\r?\n$/u, ''), `── NMSh · Semantic Output ──`, semanticText(result)].join('\n');
  }).filter(Boolean);
  const payload = parts.reduce((joined, text) => !joined ? text : joined.endsWith('\n') ? joined + text : `${joined}\n${text}`, '');
  return {payload, unavailable};
}

/** The brief note after a successful copy: what was copied and how much (one output keeps the plain wording). */
export function copiedNote(count: number, stats: {characters: number; lines: number}, includeStatus: boolean): string {
  const what = count === 1 ? 'Copied' : `Copied ${count} outputs`;
  return `${what}${includeStatus ? ' with completion status' : ''} · ${stats.characters.toLocaleString()} character${stats.characters === 1 ? '' : 's'} · ${stats.lines.toLocaleString()} line${stats.lines === 1 ? '' : 's'}`;
}
