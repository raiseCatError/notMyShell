import {lstat, readFile, realpath} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, normalize} from 'node:path';
import {executableRepositoryConfig, failureText, succeeded, type GitRunner} from './git.js';
import {discoverWorktrees, probeStatus, repositoryIdentity} from './discovery.js';
import {displayText, type WorktreeRecord} from './model.js';

/**
 * Every mutation follows plan() → explicit confirmation → revalidate() → apply().
 * A plan is an exact, displayable statement of what Git will be asked to do,
 * plus the evidence it was based on. apply() re-establishes that evidence first
 * and refuses (requiring a new review) if anything moved. Git stays
 * authoritative: removal is always non-forced, so Git refuses dirty or locked
 * worktrees itself even if a change lands after revalidation.
 */
export type Refusal = {readonly ok: false; readonly reason: string; readonly requiresReview?: boolean};
export type Outcome<T> = {readonly ok: true; readonly value: T} | Refusal;

const refuse = (reason: string, requiresReview = false): Refusal => ({ok: false, reason: displayText(reason, 400), requiresReview});
const MUTATION_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------- new worktree

export type NewWorktreeRequest =
  | {readonly kind: 'existingBranch'; readonly destination: string; readonly branch: string}
  | {readonly kind: 'newBranch'; readonly destination: string; readonly branch: string; readonly startPoint: string};

export interface NewWorktreePlan {
  readonly kind: 'newWorktree';
  readonly repository: string;
  readonly destination: string;
  readonly branch: string;
  readonly createsBranch: boolean;
  /** The start point as typed, and the commit it resolved to (what Git is actually given). */
  readonly startPoint?: {readonly input: string; readonly commit: string};
  /** Commit of the existing branch at planning time. */
  readonly branchCommit?: string;
  /** The exact argv after Git's fixed safety prefix. */
  readonly argv: readonly string[];
}

async function branchCommit(git: GitRunner, cwd: string, branch: string): Promise<string | undefined> {
  const result = await git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${branch}^{commit}`], {timeoutMs: 2000, maxBytes: 4096});
  return succeeded(result) ? result.stdout.trim() : undefined;
}

/** Git's own branch-name rule, without Git's `@{-N}` shorthand expansion or a leading dash. */
async function validBranchName(git: GitRunner, cwd: string, branch: string): Promise<boolean> {
  if (!branch || branch.startsWith('-') || branch.startsWith('@') || /[\u0000-\u001f\u007f]/u.test(branch) || branch.length > 255) return false;
  const result = await git(cwd, ['check-ref-format', '--branch', branch], {timeoutMs: 2000, maxBytes: 4096});
  return succeeded(result) && result.stdout.trim() === branch;
}

export async function planNewWorktree(git: GitRunner, repository: string, request: NewWorktreeRequest): Promise<Outcome<NewWorktreePlan>> {
  let commonDir: string;
  try { commonDir = await repositoryIdentity(git, repository); } catch (error) { return refuse((error as Error).message); }
  if (!isAbsolute(request.destination)) return refuse('Destination must be an absolute path');
  const requested = normalize(request.destination).replace(/(.)\/+$/u, '$1');
  if (/[\u0000]/u.test(requested)) return refuse('Destination contains a NUL byte');
  const leaf = basename(requested);
  if (!leaf || leaf === '.' || leaf === '..') return refuse('Destination needs a final path component');
  // NMSh does not create directories: the parent must already exist; Git creates only the worktree itself.
  // The parent is canonicalized so the plan names the path exactly as Git will report it.
  let destination: string;
  try {
    const parent = await realpath(dirname(requested));
    if (!(await lstat(parent)).isDirectory()) return refuse('Destination parent is not a directory');
    destination = join(parent, leaf);
  } catch { return refuse('Destination parent does not exist'); }
  try { await lstat(destination); return refuse('Destination already exists'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return refuse('Destination could not be checked');
  }
  if (!await validBranchName(git, repository, request.branch)) return refuse('Not a valid branch name');
  const config = await executableRepositoryConfig(git, repository);
  if (config === undefined) return refuse('Repository configuration could not be checked');
  if (config.length) return refuse('Repository configures filters or includes that a checkout would execute');
  const snapshot = await discoverWorktrees(git, repository, {concurrency: 1}).catch(() => undefined);
  if (!snapshot || snapshot.commonDir !== commonDir) return refuse('Worktrees could not be listed');
  if (snapshot.worktrees.some(worktree => worktree.path === destination)) return refuse('Git already has a worktree at this path');
  const existing = await branchCommit(git, repository, request.branch);
  const ref = `refs/heads/${request.branch}`;
  if (request.kind === 'existingBranch') {
    if (!existing) return refuse('Branch does not exist');
    const holder = snapshot.worktrees.find(worktree => worktree.ref === ref);
    if (holder) return refuse(`Branch is already checked out at ${holder.path}`);
    return {ok: true, value: {kind: 'newWorktree', repository: commonDir, destination, branch: request.branch, createsBranch: false,
      branchCommit: existing, argv: ['worktree', 'add', '--', destination, request.branch]}};
  }
  if (existing) return refuse('Branch already exists');
  if (!request.startPoint || request.startPoint.startsWith('-')) return refuse('An explicit start point is required');
  const start = await git(repository, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${request.startPoint}^{commit}`], {timeoutMs: 2000, maxBytes: 4096});
  if (!succeeded(start)) return refuse('Start point does not resolve to a commit');
  const commit = start.stdout.trim();
  return {ok: true, value: {kind: 'newWorktree', repository: commonDir, destination, branch: request.branch, createsBranch: true,
    startPoint: {input: request.startPoint, commit}, argv: ['worktree', 'add', '--no-track', '-b', request.branch, '--', destination, commit]}};
}

export async function revalidateNewWorktree(git: GitRunner, repository: string, plan: NewWorktreePlan): Promise<Outcome<NewWorktreePlan>> {
  const fresh = await planNewWorktree(git, repository, plan.createsBranch
    ? {kind: 'newBranch', destination: plan.destination, branch: plan.branch, startPoint: plan.startPoint!.input}
    : {kind: 'existingBranch', destination: plan.destination, branch: plan.branch});
  if (!fresh.ok) return refuse(fresh.reason, true);
  const same = fresh.value.repository === plan.repository && fresh.value.branchCommit === plan.branchCommit
    && fresh.value.startPoint?.commit === plan.startPoint?.commit && fresh.value.destination === plan.destination;
  return same ? {ok: true, value: plan} : refuse('The repository changed since the preview; review again', true);
}

export async function applyNewWorktree(git: GitRunner, repository: string, plan: NewWorktreePlan, confirmation: {confirmed: boolean}): Promise<Outcome<string>> {
  if (!confirmation.confirmed) return refuse('Not confirmed');
  const valid = await revalidateNewWorktree(git, repository, plan);
  if (!valid.ok) return valid;
  const result = await git(repository, plan.argv, {timeoutMs: MUTATION_TIMEOUT_MS, maxBytes: 256 * 1024, readOnly: false});
  return succeeded(result) ? {ok: true, value: plan.destination} : refuse(failureText(result));
}

// ------------------------------------------------------------------- removal

export interface RemovalEvidence {
  readonly repository: string;
  readonly path: string;
  readonly ref?: string;
  readonly head?: string;
  /** Directory identity: a path swapped for another directory (or a symlink) fails revalidation. */
  readonly device: number;
  readonly inode: number;
  /** The worktree's `.git` file, which points at its administrative directory. */
  readonly gitFile: string;
}

export interface RemovalPlan {
  readonly kind: 'removeWorktree';
  readonly evidence: RemovalEvidence;
  /** Untracked ignored entries Git will delete along with the worktree (Git reports collapsed directories). */
  readonly ignoredEntries: number;
  readonly ignoredPartial: boolean;
  readonly argv: readonly string[];
}

/** Why removal is or is not offered, from the snapshot alone (cheap, render-safe). */
export function removalAvailability(worktree: WorktreeRecord, currentPath?: string): {available: true} | {available: false; reason: string} {
  if (worktree.main) return {available: false, reason: 'The main worktree cannot be removed'};
  if (worktree.bare) return {available: false, reason: 'Bare repository entry'};
  if (worktree.locked) return {available: false, reason: 'Locked by Git; unlock it with Git first'};
  if (worktree.prunable) return {available: false, reason: 'Git reports it prunable; pruning is not offered here'};
  if (worktree.pathState !== 'present') return {available: false, reason: 'Path is missing or not a directory'};
  if (currentPath && (currentPath === worktree.path || currentPath.startsWith(`${worktree.path}/`))) return {available: false, reason: 'The current shell is inside this worktree'};
  if (worktree.status.kind === 'unknown') return {available: false, reason: 'Cleanliness is unknown'};
  if (worktree.status.kind === 'dirty') {
    const c = worktree.status.counts;
    return {available: false, reason: c.staged + c.unstaged + c.conflicted ? 'Has uncommitted tracked changes' : 'Has untracked files'};
  }
  return {available: true};
}

async function gatherEvidence(git: GitRunner, repository: string, id: string, currentPath?: string): Promise<Outcome<RemovalPlan>> {
  let snapshot;
  try { snapshot = await discoverWorktrees(git, repository, {concurrency: 1}); } catch (error) { return refuse((error as Error).message); }
  const worktree = snapshot.worktrees.find(candidate => candidate.id === id);
  if (!worktree) return refuse('Git no longer lists this worktree');
  const availability = removalAvailability(worktree, currentPath);
  if (!availability.available) return refuse(availability.reason);
  let stat, gitFile;
  try {
    stat = await lstat(worktree.path);
    if (!stat.isDirectory()) return refuse('Path is not a directory');
    gitFile = await readFile(join(worktree.path, '.git'), 'utf8');
  } catch { return refuse('Worktree path could not be inspected'); }
  const ignored = await git(worktree.path, ['status', '--porcelain=v2', '-z', '--ignored=traditional', '--untracked-files=normal', '--ignore-submodules=all', '--no-renames'],
    {timeoutMs: 5000, maxBytes: 256 * 1024});
  if (!ignored.truncated && !succeeded(ignored)) return refuse(`Status could not be checked: ${failureText(ignored)}`);
  const records = ignored.stdout.split('\0');
  const ignoredEntries = records.slice(0, ignored.truncated ? -1 : undefined).filter(record => record.startsWith('! ')).length;
  return {ok: true, value: {kind: 'removeWorktree', ignoredEntries, ignoredPartial: ignored.truncated,
    evidence: {repository: snapshot.commonDir, path: worktree.path, ref: worktree.ref, head: worktree.head, device: stat.dev, inode: stat.ino, gitFile},
    argv: ['worktree', 'remove', '--', worktree.path]}};
}

/** Fresh discovery and status for exactly this worktree; never trusts the (possibly stale) displayed row. */
export function planRemoval(git: GitRunner, repository: string, id: string, currentPath?: string): Promise<Outcome<RemovalPlan>> {
  return gatherEvidence(git, repository, id, currentPath);
}

export async function revalidateRemoval(git: GitRunner, repository: string, plan: RemovalPlan, currentPath?: string): Promise<Outcome<RemovalPlan>> {
  const fresh = await gatherEvidence(git, repository, plan.evidence.path, currentPath);
  if (!fresh.ok) return refuse(fresh.reason, true);
  const a = plan.evidence, b = fresh.value.evidence;
  const changed = a.repository !== b.repository ? 'repository' : a.ref !== b.ref ? 'branch' : a.head !== b.head ? 'HEAD commit'
    : a.device !== b.device || a.inode !== b.inode || a.gitFile !== b.gitFile ? 'directory identity'
      : fresh.value.ignoredEntries !== plan.ignoredEntries ? 'ignored files' : undefined;
  return changed ? refuse(`The worktree's ${changed} changed since the preview; review again`, true) : {ok: true, value: plan};
}

export async function applyRemoval(git: GitRunner, repository: string, plan: RemovalPlan, confirmation: {confirmed: boolean}, currentPath?: string): Promise<Outcome<string>> {
  if (!confirmation.confirmed) return refuse('Not confirmed');
  const valid = await revalidateRemoval(git, repository, plan, currentPath);
  if (!valid.ok) return valid;
  // Never --force: Git re-checks cleanliness and locks itself.
  const result = await git(repository, plan.argv, {timeoutMs: MUTATION_TIMEOUT_MS, maxBytes: 64 * 1024, readOnly: false});
  return succeeded(result) ? {ok: true, value: plan.evidence.path} : refuse(failureText(result));
}

/** Exactly-what-will-happen preview lines (sanitized). */
export function describePlan(plan: NewWorktreePlan | RemovalPlan): string[] {
  if (plan.kind === 'newWorktree') {
    return [
      `Repository   ${displayText(plan.repository)}`,
      `Destination  ${displayText(plan.destination)}`,
      `Branch       ${displayText(plan.branch)}${plan.createsBranch ? ' (new branch)' : ' (existing branch)'}`,
      ...(plan.startPoint ? [`Start point  ${displayText(plan.startPoint.input)} -> ${plan.startPoint.commit.slice(0, 12)}`] : []),
    ];
  }
  const e = plan.evidence;
  return [
    `Repository   ${displayText(e.repository)}`,
    `Remove       ${displayText(e.path)}`,
    `Checkout     ${e.ref ? displayText(e.ref.replace(/^refs\/heads\//u, '')) : `detached ${e.head?.slice(0, 12) ?? ''}`}`,
    'State        clean, no untracked files',
    ...(plan.ignoredEntries ? [`Ignored      ${plan.ignoredEntries}${plan.ignoredPartial ? '+' : ''} ignored entries will be deleted by Git`] : []),
    'The branch itself is kept.',
  ];
}
