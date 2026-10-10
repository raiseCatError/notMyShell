import type {CompletedCommand} from '../output/OutputBuffer.js';

/**
 * Copy as Report: one or several command blocks as a structured record to paste into an issue, a chat with an AI
 * assistant or a bug report. Built only from the command records (command, stored output, exit code, recorded
 * status, duration, start, directory), never from the rendered screen. Nothing here sends anything anywhere.
 *
 * Redaction is pattern-based and offered, never promised: it catches common token, key and credential shapes and
 * private paths, says what it changed, and the review lets the person read (and edit) the result before copying.
 */
export type ReportFormat = 'markdown' | 'plain';

export interface ReportOptions {
  format: ReportFormat;
  /** Include each command's working directory (when recorded). */
  directory: boolean;
  /** Include when each command started. */
  timestamps: boolean;
  /** Replace what looks like secrets and private paths. */
  redact: boolean;
  /** The home directory to show as ~ (and to recognise as private). */
  home?: string;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {format: 'markdown', directory: false, timestamps: false, redact: true};

export type FindingKind = 'private key' | 'token' | 'credential' | 'private path' | 'email address';

export interface ReportFinding { kind: FindingKind; count: number }

interface Pattern { kind: FindingKind; pattern: RegExp; replace: (match: string, ...groups: string[]) => string }

const REDACTED = '[REDACTED]';

/** Common shapes, most specific first. Each replaces only the secret part and keeps what makes the line readable. */
const PATTERNS: readonly Pattern[] = [
  {kind: 'private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/gu, replace: () => '[REDACTED PRIVATE KEY]'},
  {kind: 'credential', pattern: /\b((?:set-)?cookie\s*:\s*)[^\n]+/giu, replace: (_match, prefix) => `${prefix}${REDACTED}`},
  {kind: 'credential', pattern: /(--?(?:password|passwd|pass|token|secret|api-?key|access-?key|auth-?token|client-?secret)(?:=|\s+))(?!-)("[^"\n]*"|'[^'\n]*'|[^\s"']+)/giu, replace: (match, prefix, value) => /^["']?\[REDACTED/u.test(value) ? match : `${prefix}${REDACTED}`},
  {kind: 'credential', pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@/]+@/giu, replace: (_match, prefix) => `${prefix}${REDACTED}@`},
  {kind: 'credential', pattern: /\b(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)[^\s"']+/giu, replace: (_match, prefix) => `${prefix}${REDACTED}`},
  {kind: 'token', pattern: /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|npm_[A-Za-z0-9]{36}|[sr]k_(?:live|test)_[A-Za-z0-9]{16,})(?![A-Za-z0-9])/gu, replace: () => REDACTED},
  {kind: 'token', pattern: /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9])/gu, replace: () => REDACTED},
  {kind: 'credential', pattern: /\b((?:[A-Za-z0-9_.-]*?(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth))["']?\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"',;]+)/giu,
    replace: (match, prefix, value) => /^["']?\[REDACTED/u.test(value) || !value.replace(/["']/gu, '') ? match : `${prefix}${REDACTED}`},
  {kind: 'email address', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu, replace: () => '[REDACTED EMAIL]'},
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Private paths: the home directory becomes ~, other people's home directories lose their user name. */
function pathPatterns(home: string | undefined): Pattern[] {
  const patterns: Pattern[] = [];
  if (home && home.length > 1) patterns.push({kind: 'private path', pattern: new RegExp(`${escapeRegExp(home.replace(/\/+$/u, ''))}(?=/|\\b|$)`, 'gu'), replace: () => '~'});
  patterns.push({kind: 'private path', pattern: /(\/(?:Users|home)\/)(?!user\b)[A-Za-z0-9._-]+(?=\/|\b)/gu, replace: (_match, prefix) => `${prefix}<user>`});
  return patterns;
}

/** What redaction would change, by kind, without changing anything. */
export function scanSensitive(text: string, home?: string): ReportFinding[] {
  return redactText(text, home).findings;
}

/**
 * What the patterns are matched against: each character in compatibility form (NFKC: full-width and other look-alike
 * letters become their plain forms) with combining marks dropped, and, for every UTF-16 unit of that skeleton, the
 * span of the original text it came from. A secret dressed in look-alikes or decorated with marks is still found,
 * and only its own span of the original is replaced: the rest of the report keeps its exact characters.
 */
function skeleton(text: string): {text: string; from: number[]; to: number[]} {
  let out = '';
  const from: number[] = [];
  const to: number[] = [];
  let index = 0;
  for (const char of text) {
    const start = index;
    index += char.length;
    if (/\p{M}/u.test(char)) { if (to.length) to[to.length - 1] = index; continue; }
    for (const unit of char.normalize('NFKC').replace(/\p{M}/gu, '')) {
      for (let at = 0; at < unit.length; at += 1) { from.push(start); to.push(index); }
      out += unit;
    }
  }
  return {text: out, from, to};
}

export function redactText(text: string, home?: string): {text: string; findings: ReportFinding[]} {
  const counts = new Map<FindingKind, number>();
  let result = reportText(text);
  for (const {kind, pattern, replace} of [...PATTERNS, ...pathPatterns(home)]) {
    const view = skeleton(result);
    const edits: Array<{from: number; to: number; text: string}> = [];
    for (const match of view.text.matchAll(pattern)) {
      const replaced = replace(match[0], ...match.slice(1).filter((group): group is string => typeof group === 'string'));
      if (replaced === match[0] || !match[0].length) continue;
      edits.push({from: view.from[match.index]!, to: view.to[match.index + match[0].length - 1]!, text: replaced});
    }
    for (const edit of edits.reverse()) result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
    if (edits.length) counts.set(kind, (counts.get(kind) ?? 0) + edits.length);
  }
  return {text: result, findings: [...counts].map(([kind, count]) => ({kind, count}))};
}

/** 1-based line numbers of `text` that carry a redaction marker (what the review points the reader at). */
export function redactedLines(text: string): number[] {
  return text.split('\n').flatMap((line, index) => /\[REDACTED[^\]]*\]|(?:^|[\s=:"'(`])~(?=\/|[\s"'`)]|$)|\/(?:Users|home)\/<user>/u.test(line) ? [index + 1] : []);
}

/** "2 tokens and 1 private path" */
export function describeFindings(findings: readonly ReportFinding[]): string {
  const parts = findings.map(({kind, count}) => `${count} ${kind}${count === 1 ? '' : kind.endsWith('s') ? 'es' : 's'}`);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function duration(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function timestamp(at: number | undefined): string | undefined {
  if (at === undefined) return undefined;
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** A Markdown code fence longer than any backtick run inside the text, so output can never close it early. */
function fence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map(match => match[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Control characters (escape sequences, carriage returns) are not text a report should carry. */
/**
 * The text a report may carry: line breaks normalized (including U+2028/U+2029); control characters and every
 * default-ignorable code point (zero-width spaces and joiners, bidi controls, soft hyphens, variation selectors,
 * fillers) removed. The scanner, the review and the clipboard
 * then see the same characters, so a secret cannot hide from redaction behind something the review never shows.
 */
export function reportText(text: string): string {
  // Line and paragraph separators are line breaks to the editors and Markdown readers a report is pasted into: they
  // become real ones here, so a fence is sized for the lines a reader will see and cannot be closed from inside.
  return text.replace(/\r\n?|[\u2028\u2029]/gu, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]|\p{Cf}|\p{Default_Ignorable_Code_Point}/gu, '');
}
const clean = reportText;

/**
 * Untrusted one-line text as Markdown inline code: cleaned like the rest of a report, folded onto one line, and
 * delimited by more backticks than any run inside it, so it can neither end the code span nor add structure.
 */
export function inlineCode(text: string): string {
  const value = clean(text).replace(/\s*\n\s*/gu, ' ').trim();
  const longest = Math.max(0, ...[...value.matchAll(/`+/gu)].map(match => match[0].length));
  const ticks = '`'.repeat(longest + 1);
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${value}${pad}${ticks}`;
}

interface Fact { label: string; value: string; code?: boolean }

const oneLine = (text: string) => clean(text).replace(/\s*\n\s*/gu, ' ').trim();

function facts(record: CompletedCommand, options: ReportOptions): Fact[] {
  const list: Fact[] = [];
  const status = oneLine(record.lifecycleText);
  if (status) list.push({label: 'Status', value: status});
  list.push({label: 'Exit code', value: String(record.exitCode)});
  const took = duration(record.durationMs);
  if (took) list.push({label: 'Duration', value: took});
  const cwd = record.historicalContext?.cwd;
  if (options.directory && cwd) list.push({label: 'Directory', value: oneLine(cwd), code: true});
  const started = options.timestamps ? timestamp(record.startedAt) : undefined;
  if (started) list.push({label: 'Started', value: started});
  return list;
}

/**
 * The report for records in the order given (oldest first), and what redaction changed. Markdown uses one section
 * per command with its facts and a fenced output block; plain text uses labelled lines and clear separators.
 */
export function buildReport(records: readonly CompletedCommand[], options: ReportOptions): {text: string; findings: ReportFinding[]} {
  const count = records.length;
  const sections: string[] = [];
  if (options.format === 'markdown') {
    sections.push(`# Command report\n\n${count} command${count === 1 ? '' : 's'}, oldest first.`);
    records.forEach((record, index) => {
      const command = clean(record.command);
      const title = command.includes('\n') || command.includes('`') ? `## ${index + 1}. Command\n\n${fence(command)}sh\n${command}\n${fence(command)}`
        : `## ${index + 1}. \`${command}\``;
      const lines = facts(record, options).map(fact => `- **${fact.label}:** ${fact.code ? inlineCode(fact.value) : fact.value}`);
      const output = clean(record.output).replace(/\n+$/u, '');
      const body = output ? `${fence(output)}text\n${output}\n${fence(output)}` : '_No output._';
      sections.push(`${title}\n\n${lines.join('\n')}\n\n${body}`);
    });
  } else {
    sections.push(`Command report · ${count} command${count === 1 ? '' : 's'}, oldest first`);
    records.forEach((record, index) => {
      const output = clean(record.output).replace(/\n+$/u, '');
      const lines = [`=== ${index + 1}. $ ${clean(record.command).split('\n').join('\n    ')}`, ...facts(record, options).map(fact => `${fact.label}: ${fact.value}`),
        '--- output ---', output || '(no output)', '--- end ---'];
      sections.push(lines.join('\n'));
    });
  }
  const text = `${sections.join('\n\n')}\n`;
  return options.redact ? redactText(text, options.home) : {text, findings: []};
}

/** `--report`, `--report=markdown|md|plain|text`: undefined when the token is not a report flag. */
export function parseReportFlag(token: string): ReportFormat | 'invalid' | undefined {
  const match = /^--report(?:=(.*))?$/u.exec(token);
  if (!match) return undefined;
  const value = (match[1] ?? 'markdown').toLowerCase();
  if (value === 'markdown' || value === 'md') return 'markdown';
  if (value === 'plain' || value === 'text' || value === 'txt') return 'plain';
  return 'invalid';
}
