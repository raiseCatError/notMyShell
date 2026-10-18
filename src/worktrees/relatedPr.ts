import type {PrSummary} from '../githubWorkspace/model.js';
import type {WorktreeRecord} from './model.js';

/**
 * Pull requests related to a worktree, from evidence only: a PR whose head branch, in the same repository as the PR,
 * is exactly the worktree's checked-out branch. A fork's PR with a branch of the same name is not related (its head
 * lives elsewhere), a PR whose head repository GitHub did not report is not counted (fail closed), and nothing is
 * inferred from titles, folder names or partial branch matches. Whether the worktree is at the PR's head commit is
 * reported separately, because a local branch can be ahead of or behind what GitHub has.
 */

export interface RelatedPr {
  pr: PrSummary;
  /** The worktree's HEAD is the PR's head commit; undefined when either is unknown. */
  atHead?: boolean;
}

export function relatedPullRequests(worktree: WorktreeRecord, repository: string, prs: readonly PrSummary[]): RelatedPr[] {
  if (!worktree.branch || worktree.detached || worktree.bare) return [];
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return prs
    .filter(pr => same(`${pr.ref.owner}/${pr.ref.repo}`, repository) && pr.headRepository !== undefined && same(pr.headRepository, repository) && pr.headRef === worktree.branch)
    .map(pr => ({pr, ...(pr.headSha && worktree.head ? {atHead: pr.headSha === worktree.head} : {})}))
    // Open first, then most recently updated.
    .sort((a, b) => Number(b.pr.state === 'open') - Number(a.pr.state === 'open') || (b.pr.updatedAt ?? '').localeCompare(a.pr.updatedAt ?? ''));
}
