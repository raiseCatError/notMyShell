import {readFile, writeFile, mkdtemp, rm, stat} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {isAbsolute, join} from 'node:path';
import {resolveCommand, runExternal, type ProviderDescriptor} from '../providers/providers.js';
import {fuzzyMatch} from '../suggestions/NativeSuggestions.js';
import type {HistoryEntry} from './HistoryIndex.js';

export type NavigationProviderId = 'native' | 'zoxide';
export interface DirectoryCandidate {path: string; score: number; visits?: number; project?: string}
export const NAVIGATION_PROVIDERS: readonly ProviderDescriptor<NavigationProviderId>[] = [
  {id: 'native', family: 'navigation', label: 'NMSh Native', kind: 'native', description: 'frequency and recency from approved command history'},
  {id: 'zoxide', family: 'navigation', label: 'zoxide', kind: 'external', executable: 'zoxide', versionArgs: ['--version'],
    description: 'rank your existing directories through a private database snapshot', recipe: {brew: 'zoxide'}, source: 'https://github.com/ajeetdsouza/zoxide'},
];
const safePath = (path: string): boolean => isAbsolute(path) && !/[\u0000-\u001f\u007f-\u009f]/u.test(path);
/** Literal zsh argument; expansions, option parsing and aliases cannot turn a path into code. */
export function directoryCommand(path: string): string {
  if (!safePath(path)) throw new Error('Invalid directory path');
  return `cd -- '${path.replace(/'/gu, "'\\''")}'`;
}

/** Recent visits contribute more; the aggregate yields regularly on large histories. */
export async function rankDirectories(entries: readonly HistoryEntry[], now = Date.now(), signal?: AbortSignal): Promise<DirectoryCandidate[]> {
  const paths = new Map<string, DirectoryCandidate>();
  for (let index = 0; index < entries.length; index++) {
    if (signal?.aborted) return [];
    const entry = entries[index]!;
    if (entry.cwd && safePath(entry.cwd)) {
      const candidate = paths.get(entry.cwd) ?? {path: entry.cwd, score: 0, visits: 0, project: entry.project};
      candidate.visits = (candidate.visits ?? 0) + 1;
      const days = entry.at === undefined ? 30 : Math.max(0, now - entry.at) / 86_400_000;
      candidate.score += 1 / (1 + days / 7);
      paths.set(candidate.path, candidate);
    }
    if (index % 2048 === 2047) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return [...paths.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}
export function filterDirectories(candidates: readonly DirectoryCandidate[], query: string): DirectoryCandidate[] {
  const needle = query.trim().toLowerCase();
  return candidates.filter(candidate => !needle || fuzzyMatch(needle, candidate.path.toLowerCase()) !== undefined).slice(0, 500);
}
export function parseZoxide(output: string): DirectoryCandidate[] {
  const candidates = new Map<string, DirectoryCandidate>();
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+(?:\.\d+)?)\s+(.+)$/u.exec(line);
    if (!match || !safePath(match[2]!)) continue;
    const score = Number(match[1]);
    if (Number.isFinite(score)) candidates.set(match[2]!, {path: match[2]!, score});
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

export function zoxideDirectory(env: NodeJS.ProcessEnv, platform = process.platform): string | undefined {
  if (env._ZO_DATA_DIR) return isAbsolute(env._ZO_DATA_DIR) ? env._ZO_DATA_DIR : undefined;
  const home = env.HOME ?? homedir();
  return platform === 'darwin' ? join(home, 'Library', 'Application Support', 'zoxide')
    : platform === 'linux' ? join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'zoxide') : undefined;
}

export class DirectoryService {
  private nativeSnapshot?: readonly HistoryEntry[];
  private nativeCache: DirectoryCandidate[] = [];
  private nativeAt = 0;
  private zoxideCache?: {at: number; candidates: DirectoryCandidate[]};
  status: {active: NavigationProviderId; detail?: string} = {active: 'native'};
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async query(entries: readonly HistoryEntry[], query: string, provider: NavigationProviderId, signal?: AbortSignal): Promise<DirectoryCandidate[]> {
    if (signal?.aborted) return [];
    if (provider === 'zoxide') {
      try {
        if (!this.zoxideCache || Date.now() - this.zoxideCache.at > 30_000) {
          const candidates = await this.queryZoxide(signal);
          if (signal?.aborted) return [];
          this.zoxideCache = {at: Date.now(), candidates};
        }
        this.status = {active: 'zoxide'};
        return filterDirectories(this.zoxideCache.candidates, query);
      } catch { this.status = {active: 'native', detail: 'zoxide unavailable; using Native'}; }
    } else this.status = {active: 'native'};
    if (this.nativeSnapshot !== entries || Date.now() - this.nativeAt > 60_000) {
      const candidates = await rankDirectories(entries, Date.now(), signal);
      if (signal?.aborted) return [];
      this.nativeSnapshot = entries; this.nativeAt = Date.now(); this.nativeCache = candidates;
    }
    return signal?.aborted ? [] : filterDirectories(this.nativeCache, query);
  }

  private async queryZoxide(signal?: AbortSignal): Promise<DirectoryCandidate[]> {
    const binary = resolveCommand('zoxide', this.env.PATH ?? '', []);
    const source = zoxideDirectory(this.env);
    if (!binary || !source) throw new Error('zoxide not available');
    const file = join(source, 'db.zo');
    if ((await stat(file)).size > 16 * 1024 * 1024) throw new Error('zoxide database too large');
    const data = await readFile(file);
    if (data.length > 16 * 1024 * 1024) throw new Error('zoxide database too large');
    const directory = await mkdtemp(join(tmpdir(), 'nmsh-zoxide-'));
    try {
      await writeFile(join(directory, 'db.zo'), data, {mode: 0o600});
      // zoxide query sorts/saves its database even with --all. Only the copy is writable.
      const result = await runExternal(binary, ['query', '--list', '--score', '--all'],
        {env: {...this.env, _ZO_DATA_DIR: directory}, signal, timeoutMs: 1500, maxBytes: 4 * 1024 * 1024});
      if (!result.ok) throw new Error('zoxide query failed');
      const candidates = parseZoxide(result.stdout);
      if (result.stdout.trim() && candidates.length === 0) throw new Error('Unrecognized zoxide output');
      return candidates;
    } finally { await rm(directory, {recursive: true, force: true}); }
  }
}
