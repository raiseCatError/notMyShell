import {execFile} from 'node:child_process';
import type {AskWorktree} from './types.js';

/** Parse `git worktree list --porcelain`: factual paths and branches only. */
export function parseWorktrees(porcelain: string, currentRoot?: string): AskWorktree[] {
  const worktrees: AskWorktree[] = [];
  let current: Partial<AskWorktree> | undefined;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current?.path) worktrees.push(current as AskWorktree);
      current = {path: line.slice(9), current: false};
    } else if (line.startsWith('branch ') && current) current.branch = line.slice(7).replace(/^refs\/heads\//u, '');
  }
  if (current?.path) worktrees.push(current as AskWorktree);
  for (const item of worktrees) item.current = item.path === currentRoot;
  return worktrees;
}

/** Read-only, fixed argv, bounded in time and size; failure means "no worktree facts". */
export function gitWorktrees(cwd: string, currentRoot?: string): Promise<AskWorktree[]> {
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {timeout: 1500, maxBuffer: 256 * 1024, env: {...process.env, GIT_OPTIONAL_LOCKS: '0'}},
      (error, stdout) => resolve(error ? [] : parseWorktrees(stdout, currentRoot)));
  });
}
