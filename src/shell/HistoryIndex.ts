import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {isPrivateCommand, type CommandEntry} from '../suggestions/types.js';
import type {CompletedCommand} from '../output/OutputBuffer.js';
import type {TranscriptSession} from '../sessions/TranscriptStore.js';

export interface HistoryEntry extends CommandEntry {
  id: string;
  project?: string;
  session?: string;
  durationMs?: number;
  source: 'zsh' | 'atuin' | 'nmsh';
}

export function historyId(source: string, key: string): string {
  return createHash('sha256').update(source).update('\0').update(key).digest('hex');
}

export function journalHistory(record: CompletedCommand, session: string): HistoryEntry | undefined {
  if (record.historyEligible !== true || isPrivateCommand(record.command)) return undefined;
  return {id: historyId('nmsh', `${session}:${record.startId}`), source: 'nmsh', session, command: record.command,
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
    const match = /^(cwd|project|exit|before|after|session|duration):(.*)$/u.exec(text);
    if (!match) { plain.push(text.toLowerCase()); continue; }
    const key = match[1]!;
    const value = match[2]!;
    if (!value) { predicates.push(() => false); continue; }
    if (key === 'cwd') predicates.push(entry => entry.cwd === value || Boolean(entry.cwd?.startsWith(`${value.replace(/\/$/u, '')}/`)));
    else if (key === 'project') predicates.push(entry => entry.project?.toLowerCase() === value.toLowerCase());
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
      this.deleted = new Set(data.ids);
    } catch (error) {
      // Only absence is safe: an unreadable tombstone must not resurrect deleted commands.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
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
    const count = Math.max(0, Math.min(500, limit));
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

  async delete(id: string): Promise<void> {
    if (!this.entries.has(id)) return;
    this.deleted.add(id);
    this.revision += 1;
    if (!this.deletionFile) return;
    const file = this.deletionFile;
    const data = JSON.stringify({version: 1, ids: [...this.deleted]});
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(file), {recursive: true, mode: 0o700});
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, data, {mode: 0o600});
      await rename(temporary, file);
    });
    await this.writes;
  }
}
