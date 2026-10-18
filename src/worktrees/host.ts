import {basename, dirname, join} from 'node:path';
import {succeeded, type GitRunner} from './git.js';
import type {NewWorktreeRequest} from './mutations.js';
import type {WorktreeSnapshot} from './model.js';

/**
 * Host-side input for `n` in /worktrees: one branch name. The destination is a
 * sibling of the main worktree named `<repo>-<branch>` ('/' becomes '-'); an
 * existing local branch is checked out, otherwise a new branch starts at the
 * main worktree's HEAD. The core plans, validates and asks for confirmation.
 */
export function worktreeDestination(mainPath: string, branch: string): string {
  return join(dirname(mainPath), `${basename(mainPath)}-${branch.replace(/\//gu, '-')}`);
}

export async function newWorktreeRequest(git: GitRunner, snapshot: WorktreeSnapshot, branch: string): Promise<NewWorktreeRequest | {error: string}> {
  const name = branch.trim();
  if (!name) return {error: 'Type a branch name first.'};
  const main = snapshot.worktrees.find(worktree => worktree.main && !worktree.bare);
  if (!main) return {error: 'No main worktree to place the new one beside.'};
  const destination = worktreeDestination(main.path, name);
  const exists = await git(main.path, ['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${name}`], {timeoutMs: 2000, maxBytes: 4096});
  return succeeded(exists)
    ? {kind: 'existingBranch', destination, branch: name}
    : {kind: 'newBranch', destination, branch: name, startPoint: main.ref?.startsWith('refs/heads/') ? main.ref : main.head ?? 'HEAD'};
}
