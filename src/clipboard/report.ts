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
  {kind: 'private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu, replace: () => '[REDACTED PRIVATE KEY]'},
  {kind: 'credential', pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@/]+@/giu, replace: (_match, prefix) => `${prefix}${REDACTED}@`},
  {kind: 'credential', pattern: /\b(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)[^\s"']+/giu, replace: (_match, prefix) => `${prefix}${REDACTED}`},
  {kind: 'token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|npm_[A-Za-z0-9]{36})\b/gu, replace: () => REDACTED},
  {kind: 'token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, replace: () => REDACTED},
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

export function redactText(text: string, home?: string): {text: string; findings: ReportFinding[]} {
  const counts = new Map<FindingKind, number>();
  let result = text;
  for (const {kind, pattern, replace} of [...PATTERNS, ...pathPatterns(home)]) {
    result = result.replace(pattern, (match: string, ...groups: unknown[]) => {
      const replaced = replace(match, ...groups.filter((group): group is string => typeof group === 'string'));
      if (replaced !== match) counts.set(kind, (counts.get(kind) ?? 0) + 1);
      return replaced;
    });
  }
  return {text: result, findings: [...counts].map(([kind, count]) => ({kind, count}))};
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
const clean = (text: string) => text.replace(/\r\n?/gu, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, '');

interface Fact { label: string; value: string; code?: boolean }

function facts(record: CompletedCommand, options: ReportOptions): Fact[] {
  const list: Fact[] = [];
  const status = clean(record.lifecycleText).trim();
  if (status) list.push({label: 'Status', value: status});
  list.push({label: 'Exit code', value: String(record.exitCode)});
  const took = duration(record.durationMs);
  if (took) list.push({label: 'Duration', value: took});
  const cwd = record.historicalContext?.cwd;
  if (options.directory && cwd) list.push({label: 'Directory', value: cwd, code: true});
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
      const lines = facts(record, options).map(fact => `- **${fact.label}:** ${fact.code ? `\`${fact.value}\`` : fact.value}`);
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
