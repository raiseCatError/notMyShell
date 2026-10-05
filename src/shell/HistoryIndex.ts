import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {isPrivateCommand, type CommandEntry} from '../suggestions/types.js';
import type {CompletedCommand} from '../output/OutputBuffer.js';
import type {TranscriptSession} from '../sessions/TranscriptStore.js';
import {detectAgentCommand} from '../agents/agents.js';

export interface HistoryEntry extends CommandEntry {
  id: string;
  project?: string;
  session?: string;
  durationMs?: number;
  source: 'zsh' | 'fish' | 'bash' | 'atuin' | 'nmsh';
  /** Known agent CLI this command started, from its program word only. */
  agent?: string;
}

/** Context a ranked search is relative to. Everything is local and already known to the frontend. */
export interface HistoryRankContext {
  cwd?: string;
  project?: string;
  session?: string;
  now: number;
}

export interface RankedHistoryEntry extends HistoryEntry {
  /** How many times this exact command appears among the matches. */
  count: number;
  score: number;
}

/** Ranking weights; each signal is normalized to 0..1 first. Deterministic: ties break on recency, then the search's own (newest-first) order. */
export const HISTORY_RANK_WEIGHTS = {recency: 1, frequency: 0.8, directory: 1.2, project: 0.5, session: 0.6, prefix: 1.5, failure: 0.6};
const RECENCY_HALF_LIFE_MS = 7 * 86_400_000;
/** Matches considered for ranking (newest first); keeps a keystroke bounded on 100k-entry histories. */
export const RANK_SCAN_LIMIT = 5000;

interface Aggregate { entry: HistoryEntry; count: number; failures: number; inCwd: boolean; inProject: boolean; inSession: boolean }

/**
 * Collapse identical commands and rank them against the current context. The
 * representative entry is the newest instance, so deletion still targets a
 * real record and metadata shown is the latest run.
 */
export function rankHistory(matches: readonly HistoryEntry[], query: string, context: HistoryRankContext): RankedHistoryEntry[] {
  const groups = new Map<string, Aggregate>();
  for (const entry of matches) {
    let group = groups.get(entry.command);
    if (!group) { group = {entry, count: 0, failures: 0, inCwd: false, inProject: false, inSession: false}; groups.set(entry.command, group); }
    else if ((entry.at ?? 0) > (group.entry.at ?? 0)) group.entry = entry;
    group.count += 1;
    if (entry.exitCode !== undefined && entry.exitCode !== 0 && entry.exitCode !== 130) group.failures += 1;
    if (context.cwd && entry.cwd === context.cwd) group.inCwd = true;
    if (context.project && entry.project === context.project) group.inProject = true;
    if (context.session && entry.session === context.session) group.inSession = true;
  }
  let maxCount = 1;
  for (const group of groups.values()) maxCount = Math.max(maxCount, group.count);
  const plain = query.split(/\s+/u).filter(term => term && !/^[a-z]+:/u.test(term)).join(' ').toLowerCase();
  const w = HISTORY_RANK_WEIGHTS;
  const ranked: RankedHistoryEntry[] = [];
  for (const group of groups.values()) {
    const age = Math.max(0, context.now - (group.entry.at ?? 0));
    const recency = group.entry.at === undefined ? 0 : Math.pow(0.5, age / RECENCY_HALF_LIFE_MS);
    const frequency = Math.log1p(group.count) / Math.log1p(maxCount);
    const prefix = plain && group.entry.command.toLowerCase().startsWith(plain) ? 1 : 0;
    const score = w.recency * recency + w.frequency * frequency + w.directory * Number(group.inCwd) + w.project * Number(group.inProject)
      + w.session * Number(group.inSession) + w.prefix * prefix - w.failure * (group.failures / group.count);
    ranked.push({...group.entry, count: group.count, score: Math.round(score * 1e6) / 1e6});
  }
  // Array#sort is stable, so equal scores keep the incoming newest-first order.
  return ranked.sort((a, b) => b.score - a.score || (b.at ?? 0) - (a.at ?? 0));
}

export function historyId(source: string, key: string): string {
  return createHash('sha256').update(source).update('\0').update(key).digest('hex');
}

export function journalHistory(record: CompletedCommand, session: string): HistoryEntry | undefined {
  if (record.historyEligible !== true || isPrivateCommand(record.command)) return undefined;
  const agent = detectAgentCommand(record.command)?.id;
  return {id: historyId('nmsh', `${session}:${record.startId}`), source: 'nmsh', session, command: record.command, ...(agent ? {agent} : {}),
    cwd: record.historicalContext?.cwd, project: record.historicalContext?.project, exitCode: record.exitCode,
    at: record.startedAt, durationMs: record.durationMs};
}

function duration(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/u.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * ({ms: 1, s: 1000, m: 60000, h: 3600000}[match[2] ?? 'ms'] ?? 1);
}

/** Unknown key-like text stays plain search; invalid known filters match nothing. */
export function historyPredicate(query: string): (entry: HistoryEntry) => boolean {
  const predicates: Array<(entry: HistoryEntry) => boolean> = [];
  const plain: string[] = [];
  for (const token of query.match(/(?:[^\s"]+|"[^"]*")+/gu) ?? []) {
    const text = token.replace(/"/gu, '');
    const match = /^(cwd|project|exit|before|after|session|duration|agent|source):(.*)$/u.exec(text);
    if (!match) { plain.push(text.toLowerCase()); continue; }
    const key = match[1]!;
    const value = match[2]!;
    if (!value) { predicates.push(() => false); continue; }
    if (key === 'cwd') predicates.push(entry => entry.cwd === value || Boolean(entry.cwd?.startsWith(`${value.replace(/\/$/u, '')}/`)));
    else if (key === 'project') predicates.push(entry => entry.project?.toLowerCase() === value.toLowerCase());
    else if (key === 'agent') predicates.push(entry => (entry.agent ?? detectAgentCommand(entry.command)?.id) === value.toLowerCase());
    else if (key === 'source') predicates.push(entry => entry.source === value.toLowerCase());
    else if (key === 'session') predicates.push(entry => Boolean(entry.session?.startsWith(value)));
    else if (key === 'exit') predicates.push(entry => entry.exitCode !== undefined && (value === 'success' ? entry.exitCode === 0 : value === 'failure' ? entry.exitCode !== 0 : /^\d+$/u.test(value) && entry.exitCode === Number(value)));
    else if (key === 'before' || key === 'after') {
      const at = Date.parse(value);
      predicates.push(entry => Number.isFinite(at) && entry.at !== undefined && (key === 'before' ? entry.at < at : entry.at > at));
    } else {
      const comparison = /^(<=|>=|<|>|=)?(.*)$/u.exec(value)!;
      const ms = duration(comparison[2]!);
      predicates.push(entry => ms !== undefined && entry.durationMs !== undefined &&
        (comparison[1] === '<' ? entry.durationMs < ms : comparison[1] === '>' ? entry.durationMs > ms :
          comparison[1] === '<=' ? entry.durationMs <= ms : comparison[1] === '>=' ? entry.durationMs >= ms : entry.durationMs === ms));
    }
  }
  return entry => predicates.every(predicate => predicate(entry)) && plain.every(term => entry.command.toLowerCase().includes(term));
}

/** Derived in-memory view; only deletion IDs persist, never a second copy of commands. */
export class HistoryIndex {
  private readonly entries = new Map<string, HistoryEntry>();
  private deleted = new Set<string>();
  private writes: Promise<void> = Promise.resolve();
  private revision = 0;
  private snapshot: HistoryEntry[] = [];
  private snapshotRevision = -1;

  constructor(private readonly deletionFile?: string) {}

  async loadDeletions(): Promise<void> {
    if (!this.deletionFile) return;
    try {
      const data: unknown = JSON.parse(await readFile(this.deletionFile, 'utf8'));
      if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('ids' in data)
        || !Array.isArray(data.ids) || !data.ids.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/u.test(id))) throw new Error('Invalid history deletion file');
      for (const id of data.ids) this.deleted.add(id);
    } catch (error) {
      // Only absence is safe: an unreadable tombstone must not resurrect deleted commands.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      for (const entry of await readdir(`${this.deletionFile}.d`, {withFileTypes: true})) {
        if (!entry.isFile() || !/^[a-f0-9]{64}$/u.test(entry.name)) throw new Error('Invalid history tombstone');
        this.deleted.add(entry.name);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.revision += 1;
  }

  clearImported(): void {
    for (const [id, entry] of this.entries) if (entry.source !== 'nmsh') this.entries.delete(id);
    this.revision += 1;
  }

  add(entry: HistoryEntry): void {
    if (isPrivateCommand(entry.command) || this.deleted.has(entry.id)) return;
    this.entries.set(entry.id, entry);
    this.revision += 1;
  }

  addJournal(session: TranscriptSession): void {
    for (const record of session.transcript.records) {
      const entry = journalHistory(record, session.id);
      if (entry) this.add(entry);
    }
  }

  /** Changes whenever entries or deletions change; cheap staleness check for derived views. */
  get version(): number {
    return this.revision;
  }

  all(): readonly HistoryEntry[] {
    if (this.snapshotRevision !== this.revision) {
      this.snapshot = [...this.entries.values()].filter(entry => !this.deleted.has(entry.id)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
      this.snapshotRevision = this.revision;
    }
    return this.snapshot;
  }

  async search(query: string, signal?: AbortSignal, limit = 100): Promise<HistoryEntry[]> {
    const entries = this.all();
    const predicate = historyPredicate(query);
    const result: HistoryEntry[] = [];
    const count = Math.max(0, Math.min(RANK_SCAN_LIMIT, limit));
    if (count === 0) return result;
    for (let index = 0; index < entries.length; index += 1) {
      if (signal?.aborted) return [];
      const entry = entries[index]!;
      if (predicate(entry)) result.push(entry);
      if (result.length >= count) break;
      if (index % 2048 === 2047) await new Promise<void>(resolve => setImmediate(resolve));
    }
    return signal?.aborted ? [] : result;
  }

  /**
   * Context-ranked search: identical commands collapse into one row, ranked by
   * directory, project and session affinity, recency, frequency, prefix match
   * and failure rate. Scans newest-first, bounded, yielding like `search`.
   */
  async searchRanked(query: string, context: HistoryRankContext, signal?: AbortSignal, limit = 100): Promise<RankedHistoryEntry[]> {
    const matches = await this.search(query, signal, RANK_SCAN_LIMIT);
    if (signal?.aborted) return [];
    return rankHistory(matches, query, context).slice(0, Math.max(0, Math.min(500, limit)));
  }

  async delete(id: string): Promise<void> {
    if (!this.entries.has(id)) return;
    this.deleted.add(id);
    this.revision += 1;
    if (!this.deletionFile) return;
    if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('Invalid history ID');
    const directory = `${this.deletionFile}.d`;
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(directory, {recursive: true, mode: 0o700});
      // Independent immutable IDs avoid lost updates between persistent-session frontends.
      try { await writeFile(join(directory, id), '', {mode: 0o600, flag: 'wx'}); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    });
    await this.writes;
  }
}
