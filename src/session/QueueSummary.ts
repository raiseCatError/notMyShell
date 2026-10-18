import {scanSensitive} from '../clipboard/report.js';
import {BundledCatalog} from '../shell/BundledCatalog.js';
import {shellAdapter} from '../shell/adapters/registry.js';
import {SHELL_IDS, type ShellId} from '../shell/adapters/ShellAdapter.js';
import {ignorePatternFromEnv, isPrivateCommand} from '../suggestions/types.js';
import {TIMELINE_RESULTS_LIMIT, TIMELINE_TEXT_LIMIT, type QueueFailurePolicy, type QueueTimeline} from './ExecutionTimeline.js';

/**
 * A saved Queue Summary: typed NMSh metadata about one observed chain, never shell output and never a
 * `CompletedCommand`. Automatic artifacts keep only recognized identities and observed facts; command text (reviewed
 * and redacted) is stored only through an explicit review the owner re-validates. Nothing here is ever replayed.
 */
export const QUEUE_SUMMARY_VERSION = 1;
export const SUMMARY_ENTRY_LIMIT = TIMELINE_RESULTS_LIMIT;
export const SUMMARY_LABEL_LIMIT = 64;
export const SUMMARY_TEXT_LIMIT = TIMELINE_TEXT_LIMIT;
/** Saved artifacts retained in one session, newest last; a chain's artifact outlives its review detail. */
export const SUMMARY_LIMIT = 20;

export type QueueSummaryOutcome = 'succeeded' | 'failed' | 'interrupted';

export interface QueueSummaryEntry {
  outcome: QueueSummaryOutcome;
  /** A recognized executable name or a generic `command N` label: never raw arguments. */
  label: string;
  durationMs?: number;
  exitCode?: number;
  inputWaitMs?: number;
  /** Only from a reviewed save, and only text the owner verified is already clean. */
  text?: string;
}

export interface QueueSummary {
  version: typeof QUEUE_SUMMARY_VERSION;
  /** Stable identity: exactly one artifact per chain, so replays cannot duplicate it. */
  id: string;
  chainId: number;
  savedAt: number;
  origin: 'automatic' | 'reviewed';
  status: 'finished' | 'cleared' | 'shell-ended';
  failurePolicy: QueueFailurePolicy;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  elapsedMs: number;
  counts: QueueTimeline['counts'];
  entries: QueueSummaryEntry[];
  /** Detailed results that left the review detail; counted, never invented. */
  entriesOmitted: number;
}

export type RecognizedExecutables = ReadonlySet<string> | ((name: string) => boolean);

const recognized = (names: RecognizedExecutables, name: string): boolean => typeof names === 'function' ? names(name) : names.has(name);

let catalogRoots: ReadonlySet<string> | undefined;

function bundledRoots(): ReadonlySet<string> {
  if (!catalogRoots) {
    try { catalogRoots = new Set(new BundledCatalog().rootNames()); } catch { catalogRoots = new Set(); }
  }
  return catalogRoots;
}

/** The names an automatic artifact may keep: shell builtins plus bundled catalog roots. */
export function recognizedExecutables(shell?: ShellId): ReadonlySet<string> {
  const builtins = shell ? [...shellAdapter(shell).builtins] : SHELL_IDS.flatMap(id => [...shellAdapter(id).builtins]);
  return new Set([...builtins, ...bundledRoots()]);
}

/** Executable-name shape only: no path, assignment, quote, glob, substitution or shell metacharacter. */
const EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;

/**
 * The identity one command may keep in an automatic artifact, or undefined when eligibility or safety is unknown:
 * private (leading space, ignore patterns), multi-line, unrecognized, or carrying a sensitive shape.
 */
export function summaryLabel(command: string, names: RecognizedExecutables): string | undefined {
  if (isPrivateCommand(command, ignorePatternFromEnv()) || /[\r\n]/u.test(command)) return undefined;
  const [word] = command.split(/\s/u);
  if (!word || word.length > SUMMARY_LABEL_LIMIT || !EXECUTABLE.test(word) || scanSensitive(word).length) return undefined;
  return recognized(names, word) ? word : undefined;
}

/** Reviewed text is stored only while the owner can still verify it: bounded, one line, no findings. */
export function reviewedTextSafe(text: string): boolean {
  if (!text.trim() || text.length > SUMMARY_TEXT_LIMIT) return false;
  if (/[\u0000-\u001f\u007f]/u.test(text)) return false;
  return scanSensitive(text).length === 0;
}

export interface QueueSummaryOptions {
  savedAt: number;
  origin: QueueSummary['origin'];
  names: RecognizedExecutables;
  /** One entry per retained execution, already validated; absent for automatic artifacts. */
  reviewed?: readonly (string | null)[];
  entriesOmitted?: number;
}

/** Derive the artifact from observed facts only; missing durations, waits and exits stay absent. */
export function buildQueueSummary(chain: QueueTimeline, options: QueueSummaryOptions): QueueSummary {
  const omitted = Math.max(0, Math.floor(options.entriesOmitted ?? 0));
  const entries: QueueSummaryEntry[] = [];
  chain.executions.forEach((execution, index) => {
    if (execution.status === 'running') return;
    const text = options.reviewed?.[index] ?? undefined;
    const safe = text && reviewedTextSafe(text) ? text : undefined;
    const label = (execution.summaryEligible === true ? summaryLabel(execution.text, options.names) : undefined) ?? (safe ? summaryLabel(safe, options.names) : undefined) ?? `command ${index + omitted + 1}`;
    entries.push({outcome: execution.status, label,
      ...(execution.durationMs === undefined ? {} : {durationMs: execution.durationMs}),
      ...(execution.exitCode === undefined ? {} : {exitCode: execution.exitCode}),
      ...(execution.inputWaitMs === undefined ? {} : {inputWaitMs: execution.inputWaitMs}),
      ...(safe ? {text: safe} : {})});
  });
  return {version: QUEUE_SUMMARY_VERSION, id: `chain-${chain.id}`, chainId: chain.id, savedAt: options.savedAt, origin: options.origin,
    status: chain.status as QueueSummary['status'], failurePolicy: chain.failurePolicy, createdAt: chain.createdAt,
    ...(chain.startedAt === undefined ? {} : {startedAt: chain.startedAt}), ...(chain.endedAt === undefined ? {} : {endedAt: chain.endedAt}),
    elapsedMs: chain.elapsedMs, counts: {...chain.counts}, entries, entriesOmitted: omitted};
}

/** A transported or journaled summary fails closed: anything malformed is refused, never guessed. */
export function queueSummaryFrom(raw: unknown): QueueSummary | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as QueueSummary;
  const nonnegative = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const id = (n: unknown) => nonnegative(n) && Number.isSafeInteger(n);
  if (value.version !== QUEUE_SUMMARY_VERSION || typeof value.id !== 'string' || !/^chain-\d{1,15}$/u.test(value.id)
    || !id(value.chainId) || value.id !== `chain-${value.chainId}` || !nonnegative(value.savedAt) || !nonnegative(value.createdAt)
    || !['automatic', 'reviewed'].includes(value.origin) || !['finished', 'cleared', 'shell-ended'].includes(value.status)
    || !['pause', 'continue'].includes(value.failurePolicy) || !nonnegative(value.elapsedMs)
    || (value.startedAt !== undefined && !nonnegative(value.startedAt)) || (value.endedAt !== undefined && !nonnegative(value.endedAt))
    || !value.counts || !['succeeded','failed','interrupted','skipped','unobserved'].every(key => id(value.counts[key as keyof QueueTimeline['counts']]))
    || !Array.isArray(value.entries) || value.entries.length > SUMMARY_ENTRY_LIMIT || !id(value.entriesOmitted)) return undefined;
  const entries: QueueSummaryEntry[] = [];
  for (const rawEntry of value.entries as unknown[]) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return undefined;
    const entry = rawEntry as QueueSummaryEntry;
    if (!['succeeded', 'failed', 'interrupted'].includes(entry.outcome) || typeof entry.label !== 'string' || !entry.label.length
      || entry.label.length > SUMMARY_LABEL_LIMIT || scanSensitive(entry.label).length
      || (entry.durationMs !== undefined && !nonnegative(entry.durationMs)) || (entry.exitCode !== undefined && !Number.isSafeInteger(entry.exitCode))
      || (entry.inputWaitMs !== undefined && !nonnegative(entry.inputWaitMs))
      || (entry.text !== undefined && (typeof entry.text !== 'string' || !reviewedTextSafe(entry.text)))) return undefined;
    entries.push({outcome: entry.outcome, label: entry.label, ...(entry.durationMs === undefined ? {} : {durationMs: entry.durationMs}),
      ...(entry.exitCode === undefined ? {} : {exitCode: entry.exitCode}), ...(entry.inputWaitMs === undefined ? {} : {inputWaitMs: entry.inputWaitMs}),
      ...(entry.text === undefined ? {} : {text: entry.text})});
  }
  return {version: QUEUE_SUMMARY_VERSION, id: value.id, chainId: value.chainId, savedAt: value.savedAt, origin: value.origin, status: value.status,
    failurePolicy: value.failurePolicy, createdAt: value.createdAt, ...(value.startedAt === undefined ? {} : {startedAt: value.startedAt}),
    ...(value.endedAt === undefined ? {} : {endedAt: value.endedAt}), elapsedMs: value.elapsedMs, counts: {...value.counts}, entries, entriesOmitted: value.entriesOmitted};
}
