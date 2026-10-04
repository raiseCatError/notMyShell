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

/** Bounded, local Git facts for Ask. Nothing here contacts a remote or reads credentials. */
export interface GitFacts {
  branch?: string;
  detached: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  remotes: string[];
  staged: string[];
  modified: string[];
  deleted: string[];
  renamed: string[];
  untracked: string[];
  conflicted: string[];
}

/** Paths kept per category; counts beyond this are reported as "and N more" by callers. */
export const GIT_PATH_LIMIT = 200;

/**
 * Parse `git status --porcelain=v2 --branch -z` (machine format, not the
 * human one). Each category is bounded; a staged-and-modified file appears in
 * both, as Git reports it.
 */
export function parseStatusV2(output: string, remotes: readonly string[] = []): GitFacts {
  const facts: GitFacts = {detached: false, remotes: [...remotes], staged: [], modified: [], deleted: [], renamed: [], untracked: [], conflicted: []};
  const push = (list: string[], path: string) => { if (list.length < GIT_PATH_LIMIT) list.push(path); };
  const records = output.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.startsWith('# branch.head ')) {
      const head = record.slice(14);
      if (head === '(detached)') facts.detached = true; else facts.branch = head;
    } else if (record.startsWith('# branch.upstream ')) facts.upstream = record.slice(18);
    else if (record.startsWith('# branch.ab ')) {
      const match = /^\+(\d+) -(\d+)$/u.exec(record.slice(12));
      if (match) { facts.ahead = Number(match[1]); facts.behind = Number(match[2]); }
    } else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const fields = record.split(' ');
      const xy = fields[1]!;
      const path = fields.slice(record.startsWith('1 ') ? 8 : 9).join(' ');
      if (record.startsWith('2 ')) { push(facts.renamed, path); index += 1; }
      if (xy[0] !== '.') push(facts.staged, path);
      if (xy[1] === 'M' || xy[1] === 'T') push(facts.modified, path);
      if (xy[1] === 'D') push(facts.deleted, path);
    } else if (record.startsWith('u ')) push(facts.conflicted, record.split(' ').slice(10).join(' '));
    else if (record.startsWith('? ')) push(facts.untracked, record.slice(2));
  }
  return facts;
}

const GIT_ENV = () => ({...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0'});
function gitOutput(cwd: string, args: string[]): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, ...args], {timeout: 2000, maxBuffer: 1024 * 1024, env: GIT_ENV()}, (error, stdout) => resolve(error ? undefined : stdout));
  });
}

/** Local status and remote names only (fixed argv, read-only, no network); undefined outside a repository. */
export async function readGitFacts(cwd: string): Promise<GitFacts | undefined> {
  const [status, remotes] = await Promise.all([gitOutput(cwd, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal']), gitOutput(cwd, ['remote'])]);
  if (status === undefined) return undefined;
  return parseStatusV2(status, (remotes ?? '').split('\n').map(line => line.trim()).filter(line => /^[\w.@/-]+$/u.test(line)));
}
