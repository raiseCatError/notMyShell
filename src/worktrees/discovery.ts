import {lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {executableRepositoryConfig, failureText, succeeded, type GitRunner} from './git.js';
import {
  MAX_WORKTREES, parseStatusCounts, parseWorktreePorcelainZ, statusFromCounts,
  type PorcelainWorktree, type WorktreeRecord, type WorktreeSnapshot, type WorktreeStatus,
} from './model.js';

export interface DiscoveryOptions {
  /** Concurrent per-worktree status probes. */
  readonly concurrency?: number;
  readonly listTimeoutMs?: number;
  readonly statusTimeoutMs?: number;
  /** Bytes of status output read per worktree; beyond this, counts are lower bounds. */
  readonly statusMaxBytes?: number;
  readonly maxWorktrees?: number;
  readonly now?: () => number;
}

export const DEFAULT_STATUS_CONCURRENCY = 4;

export class WorktreeDiscoveryError extends Error {}

/** The repository's common Git directory, which identifies it from any of its worktrees. */
export async function repositoryIdentity(git: GitRunner, cwd: string): Promise<string> {
  const result = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'], {timeoutMs: 2000, maxBytes: 16 * 1024});
  const dir = result.stdout.replace(/\n$/u, '');
  if (!succeeded(result) || !isAbsolute(dir)) throw new WorktreeDiscoveryError(succeeded(result) ? 'Not a Git repository' : failureText(result));
  return dir;
}

/**
 * One `git worktree list --porcelain -z` for every worktree, then bounded,
 * concurrent status probes. A failed probe marks that worktree's status
 * unknown; it never fails the whole snapshot. Only the list call is fatal.
 */
export async function discoverWorktrees(git: GitRunner, cwd: string, options: DiscoveryOptions = {}): Promise<WorktreeSnapshot> {
  const commonDir = await repositoryIdentity(git, cwd);
  const listed = await git(cwd, ['worktree', 'list', '--porcelain', '-z'], {timeoutMs: options.listTimeoutMs ?? 5000, maxBytes: 1024 * 1024});
  if (!succeeded(listed)) throw new WorktreeDiscoveryError(failureText(listed));
  const max = options.maxWorktrees ?? MAX_WORKTREES;
  const all = parseWorktreePorcelainZ(listed.stdout);
  const entries = all.slice(0, max);
  // Content filters etc. are shared repository config: checked once, and status is not run when present.
  const blocked = await executableRepositoryConfig(git, cwd);
  const statusBlock = blocked === undefined ? 'repository configuration could not be checked'
    : blocked.length ? 'repository configures filters or includes; status not run' : undefined;
  const records = await mapBounded(entries, options.concurrency ?? DEFAULT_STATUS_CONCURRENCY,
    (entry, index) => enrich(git, entry, index === 0, statusBlock, commonDir, options));
  return {commonDir, worktrees: records, truncated: all.length > entries.length, discoveredAt: (options.now ?? Date.now)()};
}

async function enrich(git: GitRunner, entry: PorcelainWorktree, main: boolean, statusBlock: string | undefined, commonDir: string,
  options: DiscoveryOptions): Promise<WorktreeRecord> {
  const pathState = await probePath(entry.path);
  let status: WorktreeStatus;
  if (entry.bare) status = {kind: 'unknown', reason: 'bare repository has no working tree'};
  else if (pathState !== 'present') status = {kind: 'unknown', reason: pathState === 'missing' ? 'path is missing' : 'path is not a directory'};
  else if (statusBlock) status = {kind: 'unknown', reason: statusBlock};
  else status = await probeStatus(git, entry.path, {...options, commonDir});
  return {
    id: entry.path, path: entry.path, ref: entry.ref,
    branch: entry.ref?.startsWith('refs/heads/') ? entry.ref.slice('refs/heads/'.length) : undefined,
    head: entry.head, detached: entry.detached, bare: entry.bare, main,
    locked: entry.locked, lockedReason: entry.lockedReason, prunable: entry.prunable, prunableReason: entry.prunableReason,
    pathState, status,
  };
}

export async function probePath(path: string): Promise<WorktreeRecord['pathState']> {
  try {
    const stat = await lstat(path);
    return stat.isDirectory() ? 'present' : 'notDirectory';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown';
  }
}

/**
 * Status runs `git -C <worktree>`, which follows that worktree's own `.git`
 * pointer. Before running anything there, prove the pointer resolves to the
 * same repository and that the config Git will read there executes nothing.
 * Returns a reason when status must not run.
 */
export async function worktreeStatusBlock(git: GitRunner, path: string, commonDir: string): Promise<string | undefined> {
  let identity: string;
  try { identity = await repositoryIdentity(git, path); } catch { return 'worktree repository could not be identified'; }
  if (identity !== commonDir) return 'worktree points at a different repository; status not run';
  const config = await executableRepositoryConfig(git, path);
  if (config === undefined) return 'repository configuration could not be checked';
  return config.length ? 'repository configures filters or includes; status not run' : undefined;
}

/** Status for one worktree: machine format, no renames, untracked files listed normally, submodules ignored. */
export async function probeStatus(git: GitRunner, path: string, options: Pick<DiscoveryOptions, 'statusTimeoutMs' | 'statusMaxBytes'> & {commonDir?: string} = {}): Promise<WorktreeStatus> {
  if (options.commonDir) {
    const block = await worktreeStatusBlock(git, path, options.commonDir);
    if (block) return {kind: 'unknown', reason: block};
  }
  const result = await git(path, ['status', '--porcelain=v2', '-z', '--untracked-files=normal', '--ignore-submodules=all', '--no-renames'],
    {timeoutMs: options.statusTimeoutMs ?? 5000, maxBytes: options.statusMaxBytes ?? 256 * 1024});
  if (result.truncated) return statusFromCounts(parseStatusCounts(result.stdout, true));
  if (!succeeded(result)) return {kind: 'unknown', reason: failureText(result)};
  return statusFromCounts(parseStatusCounts(result.stdout, false));
}

export async function mapBounded<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!, index);
    }
  };
  await Promise.all(Array.from({length: Math.max(1, Math.min(limit, items.length))}, worker));
  return results;
}
