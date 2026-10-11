import {basename} from 'node:path';
import {checkoutLabel, stateWords, type WorktreeSnapshot} from '../worktrees/model.js';
import type {WorkspaceResource} from './resources.js';

/**
 * Sidebar sections from data other owners already reported. Each adapter is
 * pure: it shapes a snapshot the caller obtained (worktree discovery, the tmux
 * listing) into resources, and claims activation only where a supported path
 * exists. Deep control stays in the dedicated managers; the sidebar links to
 * them instead of growing their features.
 */

/**
 * Git worktrees of the current repository. Opening one changes the persistent shell's directory (the same intent
 * `/worktrees` uses); a worktree whose path is missing is listed but cannot be opened.
 */
export function worktreeSection(snapshot: WorktreeSnapshot | undefined, cwd: string): WorkspaceResource {
  if (!snapshot) return {id: 'worktrees', kind: 'section', label: 'Worktrees', support: 'informational', reason: 'not in a Git repository, or not listed yet'};
  // Worktrees can live inside another's directory (`.worktrees/feature` in the main checkout): the current one is the
  // innermost that holds the shell's directory, so only one is marked active.
  const current = snapshot.worktrees.filter(worktree => cwd === worktree.path || cwd.startsWith(`${worktree.path}/`))
    .reduce<string | undefined>((best, worktree) => (best === undefined || worktree.path.length > best.length ? worktree.path : best), undefined);
  const children: WorkspaceResource[] = snapshot.worktrees.map(worktree => {
    const present = worktree.pathState === 'present' && !worktree.bare;
    return {
      id: `worktree:${worktree.id}`, kind: 'worktree', label: checkoutLabel(worktree), detail: [basename(worktree.path), ...stateWords(worktree)].join(' · '),
      ...(present ? {support: 'activatable' as const, activation: {kind: 'changeDirectory' as const, path: worktree.path}}
        : {support: 'unsupported' as const, reason: worktree.bare ? 'a bare repository has no working directory' : 'the worktree path is missing'}),
      active: worktree.path === current,
      observedAt: snapshot.discoveredAt,
    };
  });
  if (snapshot.truncated) children.push({id: 'worktrees:more', kind: 'section', label: 'more in /worktrees', support: 'activatable',
    activation: {kind: 'openManager', command: '/worktrees'}});
  return {id: 'worktrees', kind: 'section', label: 'Worktrees', support: 'activatable', activation: {kind: 'openManager', command: '/worktrees'},
    observedAt: snapshot.discoveredAt, children};
}

/** Links to dedicated managers that already exist; the sidebar never duplicates their lists or actions. */
export function managerLinks(): WorkspaceResource {
  return {id: 'managers', kind: 'section', label: 'Open', support: 'informational', children: [
    {id: 'managers:github', kind: 'section', label: 'GitHub PRs and issues', detail: '/github', support: 'activatable', activation: {kind: 'openManager', command: '/github'}},
    {id: 'managers:agents', kind: 'section', label: 'Agents', detail: '/agents', support: 'activatable', activation: {kind: 'openManager', command: '/agents'}},
    {id: 'managers:sessions', kind: 'section', label: 'NMSh sessions', detail: '/sessions', support: 'activatable', activation: {kind: 'openManager', command: '/sessions'}},
  ]};
}
