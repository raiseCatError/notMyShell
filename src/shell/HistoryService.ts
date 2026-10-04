import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {resolveCommand, runExternal} from '../providers/providers.js';
import {HistoryIndex, historyId, journalHistory, type HistoryEntry, type HistoryRankContext, type RankedHistoryEntry, RANK_SCAN_LIMIT, rankHistory} from './HistoryIndex.js';
import {nmshConfigDirectory} from '../configuration/paths.js';
import type {CompletedCommand} from '../output/OutputBuffer.js';
import {Worker} from 'node:worker_threads';
import type {CommandEntry} from '../suggestions/types.js';

import {ATUIN_METADATA_FORMAT, type HistoryProviderId} from './historyProviders.js';


/**
 * Local shell history, loaded once in the background so startup and
 * keystrokes never wait for it. Native is the default; Atuin is read-only
 * and queried only when explicitly selected.
 */
export class HistoryService {
  private entries: CommandEntry[] = [];
  private worker?: Worker;
  private request?: AbortController;
  private generation = 0;
  status: {selected: HistoryProviderId; active: HistoryProviderId; detail?: string} = {selected: 'native', active: 'native'};
  private readonly lifetime = new AbortController();
  readonly index: HistoryIndex;
  /**
   * The active backend's own history file and parser. Absent means zsh (the
   * original source). Set by the frontend when the session's shell changes.
   */
  shellHistory?: {id: 'fish' | 'bash'; file: string | undefined; parse: (content: Uint8Array) => Promise<CommandEntry[]>};

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    this.index = new HistoryIndex(join(nmshConfigDirectory(env), 'history-deletions.json'));
  }

  /** Loads (or reloads) history; callers start it once the app is running. */
  dispose(): void { this.lifetime.abort(); this.request?.abort(); void this.worker?.terminate(); }

  async reload(provider: HistoryProviderId = 'native'): Promise<boolean> {
    if (this.lifetime.signal.aborted) return false;
    const generation = ++this.generation;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    void this.worker?.terminate();
    await this.index.loadDeletions();
    const loaded = await this.loadSource(provider, request.signal);
    if (generation !== this.generation || request.signal.aborted) return false;
    this.entries = loaded.entries;
    this.status = {selected: provider, active: loaded.source === 'atuin' ? 'atuin' : 'native', detail: loaded.detail};
    this.index.clearImported();
    await indexImportedHistory(this.index, this.entries, loaded.source, request.signal);
    if (generation !== this.generation || request.signal.aborted) return false;
    await this.loadJournals(generation);
    if (generation !== this.generation || request.signal.aborted) return false;
    this.index.all();
    return true;
  }

  private loadJournals(generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../../scripts/read-command-history.cjs', import.meta.url),
        {workerData: {directory: join(nmshConfigDirectory(this.env), 'sessions')}});
      this.worker = worker;
      worker.on('message', (batch: {session: string; records: CompletedCommand[]}) => {
        if (generation !== this.generation || this.lifetime.signal.aborted) return;
        for (const record of batch.records) this.record(record, batch.session);
      });
      worker.once('error', reject);
      worker.once('exit', code => {
        if (this.worker === worker) this.worker = undefined;
        code === 0 ? resolve() : reject(new Error('History journal reader failed'));
      });
      if (this.lifetime.signal.aborted) void worker.terminate();
    });
  }

  record(record: CompletedCommand, session: string): void {
    const entry = journalHistory(record, session);
    if (entry) this.index.add(entry);
  }

  search(query: string, signal?: AbortSignal, limit?: number): Promise<HistoryEntry[]> { return this.index.search(query, signal, limit); }

  /** Ranked against where you are now; Native only (an external provider's own order is respected via `search`). */
  searchRanked(query: string, context: HistoryRankContext, signal?: AbortSignal): Promise<RankedHistoryEntry[]> {
    return this.search(query, signal, RANK_SCAN_LIMIT).then(matches => (signal?.aborted ? [] : rankHistory(matches, query, context).slice(0, 100)));
  }

  private async loadSource(provider: HistoryProviderId, signal: AbortSignal): Promise<{entries: CommandEntry[]; source: 'zsh' | 'fish' | 'bash' | 'atuin'; detail?: string}> {
    let detail: string | undefined;
    if (provider === 'atuin') {
      const atuin = resolveCommand('atuin', this.env.PATH ?? '', []);
      if (atuin) {
        const result = await runExternal(atuin, ['history', 'list', '--format', ATUIN_METADATA_FORMAT, '--print0', '--timezone', '+0'],
          {timeoutMs: 15000, maxBytes: 128 * 1024 * 1024, env: this.env, signal});
        if (result.ok) {
          const entries = await parseAtuinMetadataInChunks(result.stdout);
          if (!result.stdout.trim() || entries.length || result.stdout.split('\0').some(record => record.startsWith('nmsh-v1\u001f')))
            return {entries, source: 'atuin'};
        }
        detail = `Atuin unavailable (${result.error ?? 'query failed'}); using Native`;
      } else detail = 'Atuin is not installed; using Native';
    }
    const shell = this.shellHistory;
    if (shell) {
      try { return {entries: shell.file ? await shell.parse(await readFile(shell.file)) : [], source: shell.id, detail}; }
      catch { return {entries: [], source: shell.id, detail}; }
    }
    try {
      const path = this.env.HISTFILE || join(this.env.HOME ?? homedir(), '.zsh_history');
      return {entries: await parseZshHistoryInChunks(await readFile(path)), source: 'zsh', detail};
    } catch { return {entries: [], source: 'zsh', detail}; }
  }

  /** Commands, oldest first. */
  getAll(): string[] {
    return this.entries.map(entry => entry.command);
  }

  /** Commands with whatever metadata the source had, oldest first. */
  getEntries(): readonly CommandEntry[] {
    return this.entries;
  }
}

/** Hashing and indexing imports must yield too, not only source parsing. */
export async function indexImportedHistory(index: HistoryIndex, entries: readonly CommandEntry[], source: 'zsh' | 'fish' | 'bash' | 'atuin', signal?: AbortSignal): Promise<void> {
  for (let position = 0; position < entries.length; position++) {
    if (signal?.aborted) return;
    const entry = entries[position]!;
    index.add({...entry, id: 'id' in entry && typeof entry.id === 'string' ? entry.id : historyId(source, `${entry.at ?? 0}:${entry.command}`), source});
    if (position % 1024 === 1023) await new Promise<void>(resolve => setImmediate(resolve));
  }
}

export function parseAtuinHistory(output: string): CommandEntry[] {
  const entries: CommandEntry[] = [];
  for (const record of output.split('\0')) {
    const [time, exit, directory, ...command] = record.split('\t');
    const text = command.join('\t').replace(/\n+$/u, '');
    if (!text.trim() || time === undefined) continue;
    const at = Date.parse(`${time.trim().replace(' ', 'T')}Z`);
    const exitCode = Number.parseInt(exit ?? '', 10);
    entries.push({command: text, ...(Number.isFinite(at) ? {at} : {}),
      ...(Number.isFinite(exitCode) && exitCode !== -1 ? {exitCode} : {}),
      ...(directory && directory !== 'unknown' ? {cwd: directory} : {})});
  }
  return entries.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/** zsh stores non-ASCII bytes "metafied": 0x83 followed by the byte XOR 0x20. */
export function unmetafy(bytes: Uint8Array): Buffer {
  const out = Buffer.alloc(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    out[length++] = byte === 0x83 && index + 1 < bytes.length ? bytes[++index]! ^ 0x20 : byte;
  }
  return out.subarray(0, length);
}

/** Plain or EXTENDED_HISTORY (`: start:elapsed;command`), with `\` continuation lines. */
function* zshHistoryEntries(content: Uint8Array | string): Generator<CommandEntry> {
  const text = typeof content === 'string' ? content : unmetafy(content).toString('utf8');
  let current: CommandEntry | undefined;
  for (const line of text.split('\n')) {
    if (current && current.command.endsWith('\\')) {
      current.command = `${current.command.slice(0, -1)}\n${line}`;
      continue;
    }
    if (current?.command.trim()) yield current;
    const match = /^: *(\d+):\d+;(.*)$/u.exec(line);
    current = match ? {command: match[2]!, at: Number(match[1]) * 1000} : line.trim() ? {command: line} : undefined;
  }
  if (current) {
    if (current.command.endsWith('\\')) current.command = current.command.slice(0, -1);
    if (current.command.trim()) yield current;
  }
}

export function parseZshHistory(content: Uint8Array | string): CommandEntry[] {
  return [...zshHistoryEntries(content)];
}

/** Import yields between batches; UI rendering never waits for the complete history. */
export async function parseZshHistoryInChunks(content: Uint8Array | string): Promise<CommandEntry[]> {
  const entries: CommandEntry[] = [];
  for (const entry of zshHistoryEntries(content)) {
    entries.push(entry);
    if (entries.length % 2048 === 0) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return entries;
}


/** Atuin's public CLI formats duration in its largest unit (approximate metadata). */
function* atuinMetadataEntries(output: string): Generator<HistoryEntry> {
  for (const record of output.split('\0')) {
    const [version, uuid, time, exit, cwd, duration, session, ...command] = record.split('\u001f');
    if (version !== 'nmsh-v1' || !uuid || !time || !/^\d+$/u.test(exit ?? '')) continue;
    const text = command.join('\u001f').replace(/\n+$/u, '');
    if (!text.trim() || /^\s/u.test(text)) continue;
    const at = Date.parse(`${time.trim().replace(' ', 'T')}Z`);
    const match = /^(\d+(?:\.\d+)?)\s*(ns|µs|μs|us|ms|s|m|h|d)$/u.exec(duration ?? '');
    const units: Record<string, number> = {ns: 0.000001, 'µs': 0.001, 'μs': 0.001, us: 0.001, ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000};
    yield {id: historyId('atuin', uuid), source: 'atuin', command: text, exitCode: Number(exit),
      ...(Number.isFinite(at) ? {at} : {}),
      ...(cwd && cwd !== 'unknown' ? {cwd} : {}), ...(session ? {session} : {}),
      ...(match ? {durationMs: Number(match[1]) * units[match[2]!]!} : {})};
  }
 }

export function parseAtuinMetadata(output: string): HistoryEntry[] {
  return [...atuinMetadataEntries(output)].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

export async function parseAtuinMetadataInChunks(output: string): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];
  for (const entry of atuinMetadataEntries(output)) {
    entries.push(entry);
    if (entries.length % 2048 === 0) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return entries.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}
