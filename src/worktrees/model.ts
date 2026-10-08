import {stripTerminalControls} from '../util/terminalControls.js';

/**
 * Factual worktree data. Every field comes from Git or the filesystem; anything
 * not proven is `undefined`/`'unknown'`, never inferred (a branch is never read
 * from a folder name, a failed status probe never means "clean").
 */
export interface WorktreeRecord {
  /** Stable identity for selection and actions: the path exactly as Git reports it (absolute, canonical in Git's view). */
  readonly id: string;
  readonly path: string;
  /** Full ref when attached (`refs/heads/x`); undefined when detached, bare or not reported. */
  readonly ref?: string;
  /** Short branch name derived from `ref` only when it is under `refs/heads/`. */
  readonly branch?: string;
  readonly head?: string;
  readonly detached: boolean;
  readonly bare: boolean;
  /** Git lists the main worktree first; every other entry is linked. */
  readonly main: boolean;
  readonly locked: boolean;
  readonly lockedReason?: string;
  readonly prunable: boolean;
  readonly prunableReason?: string;
  /** From lstat after discovery: `present`, `missing`, or `notDirectory` (including symlinks). */
  readonly pathState: 'present' | 'missing' | 'notDirectory' | 'unknown';
  readonly status: WorktreeStatus;
}

export type WorktreeStatus =
  | {readonly kind: 'clean'}
  | {readonly kind: 'dirty'; readonly counts: StatusCounts}
  | {readonly kind: 'unknown'; readonly reason: string};

export interface StatusCounts {
  readonly staged: number;
  readonly unstaged: number;
  readonly conflicted: number;
  readonly untracked: number;
  /** Output hit the bound: counts are lower bounds (still proof of dirtiness when non-zero). */
  readonly partial: boolean;
}

export interface WorktreeSnapshot {
  /** The repository's common Git directory: its identity across all of its worktrees. */
  readonly commonDir: string;
  readonly worktrees: readonly WorktreeRecord[];
  /** Git listed more worktrees than {@link MAX_WORKTREES}; the rest are not shown. */
  readonly truncated: boolean;
  readonly discoveredAt: number;
}

export const MAX_WORKTREES = 200;

/** Raw porcelain entry before filesystem/status enrichment. */
export interface PorcelainWorktree {
  path: string;
  head?: string;
  ref?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockedReason?: string;
  prunable: boolean;
  prunableReason?: string;
}

/**
 * Parse `git worktree list --porcelain -z`: NUL-terminated attribute lines,
 * entries separated by an empty record. With `-z`, paths and reasons are raw
 * (never C-quoted), so newlines in names cannot split records.
 */
export function parseWorktreePorcelainZ(output: string): PorcelainWorktree[] {
  const entries: PorcelainWorktree[] = [];
  let current: PorcelainWorktree | undefined;
  for (const record of output.split('\0')) {
    if (record === '') { if (current) entries.push(current); current = undefined; continue; }
    const space = record.indexOf(' ');
    const label = space < 0 ? record : record.slice(0, space);
    const value = space < 0 ? undefined : record.slice(space + 1);
    if (label === 'worktree') {
      if (current) entries.push(current);
      current = {path: value ?? '', detached: false, bare: false, locked: false, prunable: false};
      continue;
    }
    if (!current) continue;
    if (label === 'HEAD' && value && /^[0-9a-f]{40,64}$/u.test(value)) current.head = value;
    else if (label === 'branch' && value) current.ref = value;
    else if (label === 'detached') current.detached = true;
    else if (label === 'bare') current.bare = true;
    else if (label === 'locked') { current.locked = true; if (value) current.lockedReason = value; }
    else if (label === 'prunable') { current.prunable = true; if (value) current.prunableReason = value; }
  }
  if (current) entries.push(current);
  return entries.filter(entry => entry.path.startsWith('/'));
}

/** Count `git status --porcelain=v2 -z` records. Rename/copy records carry a second NUL-separated path. */
export function parseStatusCounts(output: string, partial: boolean): StatusCounts {
  let staged = 0, unstaged = 0, conflicted = 0, untracked = 0;
  const records = output.split('\0');
  // A truncated tail record is incomplete: ignore it.
  const complete = partial ? records.length - 1 : records.length;
  for (let index = 0; index < complete; index += 1) {
    const record = records[index]!;
    if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const xy = record.slice(2, 4);
      if (xy[0] !== '.') staged += 1;
      if (xy[1] !== '.') unstaged += 1;
      if (record.startsWith('2 ')) index += 1;
    } else if (record.startsWith('u ')) conflicted += 1;
    else if (record.startsWith('? ')) untracked += 1;
  }
  return {staged, unstaged, conflicted, untracked, partial};
}

export function statusFromCounts(counts: StatusCounts): WorktreeStatus {
  if (counts.staged + counts.unstaged + counts.conflicted + counts.untracked > 0) return {kind: 'dirty', counts};
  if (counts.partial) return {kind: 'unknown', reason: 'status output exceeded the safety bound'};
  return {kind: 'clean'};
}

export function hasTrackedChanges(status: WorktreeStatus): boolean {
  return status.kind === 'dirty' && status.counts.staged + status.counts.unstaged + status.counts.conflicted > 0;
}

export function hasUntracked(status: WorktreeStatus): boolean {
  return status.kind === 'dirty' && status.counts.untracked > 0;
}

/** Hostile Git/filesystem text made safe for NMSh chrome: no controls, no bidi spoofing; ordinary Unicode preserved. */
export function displayText(value: string, maxLength = 4096): string {
  return stripTerminalControls(value, maxLength);
}

/** The short label for a worktree's checkout. Never derived from the folder name. */
export function checkoutLabel(worktree: WorktreeRecord): string {
  if (worktree.bare) return '(bare)';
  if (worktree.branch) return displayText(worktree.branch);
  if (worktree.ref) return displayText(worktree.ref);
  if (worktree.detached) return worktree.head ? `(detached ${worktree.head.slice(0, 7)})` : '(detached)';
  return '(unknown checkout)';
}

/** Factual state words, in priority order. Shared by the view and local search. */
export function stateWords(worktree: WorktreeRecord): string[] {
  const words: string[] = [];
  if (worktree.main) words.push('main worktree');
  if (worktree.bare) words.push('bare');
  if (worktree.pathState === 'missing') words.push('missing path');
  if (worktree.pathState === 'notDirectory') words.push('not a directory');
  if (worktree.locked) words.push(worktree.lockedReason ? `locked: ${displayText(worktree.lockedReason, 200)}` : 'locked');
  if (worktree.prunable) words.push(worktree.prunableReason ? `prunable: ${displayText(worktree.prunableReason, 200)}` : 'prunable');
  const status = worktree.status;
  if (status.kind === 'clean') words.push('clean');
  else if (status.kind === 'unknown') words.push(`status unknown (${displayText(status.reason, 200)})`);
  else {
    const plus = status.counts.partial ? '+' : '';
    if (status.counts.conflicted) words.push(`${status.counts.conflicted}${plus} conflicted`);
    if (status.counts.staged) words.push(`${status.counts.staged}${plus} staged`);
    if (status.counts.unstaged) words.push(`${status.counts.unstaged}${plus} modified`);
    if (status.counts.untracked) words.push(`${status.counts.untracked}${plus} untracked`);
  }
  return words;
}
