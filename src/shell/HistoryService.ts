import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {findExecutable, runExternal} from '../providers/providers.js';
import {HistoryIndex, historyId, journalHistory, type HistoryEntry} from './HistoryIndex.js';
import {nmshConfigDirectory} from '../configuration/paths.js';
import type {CompletedCommand} from '../output/OutputBuffer.js';
import {Worker} from 'node:worker_threads';
import type {CommandEntry} from '../suggestions/types.js';

const ATUIN_FORMAT = '{time}\t{exit}\t{directory}\t{command}';

/**
 * Local shell history, loaded once in the background so startup and
 * keystrokes never wait for it. Atuin (with cwd, exit and time) when
 * installed, otherwise $HISTFILE.
 */
export class HistoryService {
  private entries: CommandEntry[] = [];
  private worker?: Worker;
  private readonly lifetime = new AbortController();
  readonly index = new HistoryIndex(join(nmshConfigDirectory(), 'history-deletions.json'));

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** Loads (or reloads) history; callers start it once the app is running. */
  dispose(): void { this.lifetime.abort(); void this.worker?.terminate(); }

  async reload(): Promise<void> {
    if (this.lifetime.signal.aborted) return;
    await this.index.loadDeletions();
    await this.loadSource();
    this.entries.forEach((entry, index) => this.index.add({...entry, id: historyId('shell', `${entry.at ?? 0}:${entry.command}`), source: 'zsh'}));
    await this.loadJournals();
    this.index.all();
  }

  private loadJournals(): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../../scripts/read-command-history.cjs', import.meta.url),
        {workerData: {directory: join(nmshConfigDirectory(), 'sessions')}});
      this.worker = worker;
      worker.on('message', (batch: {session: string; records: CompletedCommand[]}) => {
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

  search(query: string, signal?: AbortSignal): Promise<HistoryEntry[]> { return this.index.search(query, signal); }

  private async loadSource(): Promise<void> {
    const atuin = findExecutable('atuin', this.env.PATH ?? '');
    if (atuin) {
      const result = await runExternal(atuin, ['history', 'list', '--format', ATUIN_FORMAT, '--print0', '--timezone', '+0'],
        {timeoutMs: 15000, maxBytes: 128 * 1024 * 1024, env: this.env, signal: this.lifetime.signal});
      if (result.ok) {
        this.entries = parseAtuinHistory(result.stdout);
        return;
      }
    }
    try {
      const path = this.env.HISTFILE || join(homedir(), '.zsh_history');
      this.entries = await parseZshHistoryInChunks(await readFile(path));
    } catch {
      this.entries = [];
    }
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
