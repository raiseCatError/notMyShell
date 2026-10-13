import {type MergeMethod, type PrDetail, repositoryName} from './model.js';

/**
 * Merge *planning* only. This phase never merges, submits reviews or deletes
 * branches: `executeRemoteWrite` always refuses, and no transport method can
 * issue a mutation. A plan records exactly what GitHub reported at fetch time
 * so a future integration can show it, re-fetch it, and guard the write with
 * the exact head SHA (`expectedHeadOid` / `sha`).
 *
 * Local Git is never consulted: GitHub is the authority for mergeability,
 * checks, permissions and repository policy.
 */

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
  merge: 'Merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
};

export type MethodSupport = 'allowed' | 'disabled_by_repository' | 'unknown';

export interface MergeCondition {
  severity: 'blocker' | 'unknown' | 'warning';
  message: string;
}

export interface MergePlan {
  type: 'MergePlan';
  repository: string;
  number: number;
  title: string;
  /** The exact head commit a future merge must be guarded on. Undefined blocks the plan. */
  headSha?: string;
  headRef?: string;
  baseRef?: string;
  method: MergeMethod;
  methods: Record<MergeMethod, MethodSupport>;
  deleteBranch: {requested: boolean; repositoryAutoDeletes?: boolean; crossRepository: boolean};
  mergeable: PrDetail['summary']['mergeable'];
  mergeStateStatus: PrDetail['mergeStateStatus'];
  conditions: MergeCondition[];
  /** As-of time of the GitHub data this plan was built from. */
  fetchedAt: number;
  warnings: string[];
  /** Always false in this phase. */
  executable: false;
  disabledReason: string;
}

export const REMOTE_WRITES_DISABLED_REASON =
  'Remote writes are not implemented in this phase. A future integration must re-fetch the PR from GitHub, show this preview, '
  + 'require explicit confirmation, and guard the merge on the exact head SHA.';

export function methodSupport(detail: PrDetail): Record<MergeMethod, MethodSupport> {
  const support = (value: boolean | undefined): MethodSupport => (value === undefined ? 'unknown' : value ? 'allowed' : 'disabled_by_repository');
  return {merge: support(detail.policy.merge), squash: support(detail.policy.squash), rebase: support(detail.policy.rebase)};
}

export function planMerge(detail: PrDetail, request: {method: MergeMethod; deleteBranch: boolean}, now = Date.now(), staleAfterMs = 60_000): MergePlan {
  const {summary} = detail;
  const methods = methodSupport(detail);
  const conditions: MergeCondition[] = [];
  const block = (message: string) => conditions.push({severity: 'blocker', message});
  const unknown = (message: string) => conditions.push({severity: 'unknown', message});

  if (summary.state !== 'open') block(`Pull request is ${summary.state}`);
  if (summary.draft) block('Pull request is a draft');
  if (!detail.headSha) block('Head commit SHA unknown; a merge cannot be guarded');
  if (methods[request.method] === 'disabled_by_repository') block(`${MERGE_METHOD_LABELS[request.method]} is disabled for this repository`);
  if (methods[request.method] === 'unknown') unknown(`Whether ${MERGE_METHOD_LABELS[request.method]} is allowed was not reported`);

  if (summary.mergeable === 'conflicting') block('GitHub reports merge conflicts');
  if (summary.mergeable === 'unknown') unknown('GitHub has not computed mergeability yet; refresh before acting');
  switch (detail.mergeStateStatus) {
    case 'blocked': block('GitHub reports the merge is blocked (branch protection, required reviews or checks)'); break;
    case 'behind': block('Head branch is behind base and the repository requires it to be up to date'); break;
    case 'dirty': block('GitHub reports a dirty merge state'); break;
    case 'unstable': conditions.push({severity: 'warning', message: 'Non-required checks are failing'}); break;
    case 'unknown': unknown('Merge state status was not reported'); break;
    default: break;
  }
  if (summary.reviewDecision === 'changes_requested') block('Changes were requested in review');
  if (summary.reviewDecision === 'review_required') block('A required review is missing');

  const required = detail.checks.filter(check => check.required === true);
  const failingRequired = required.filter(check => check.status === 'completed' && check.conclusion !== 'success' && check.conclusion !== 'skipped' && check.conclusion !== 'neutral');
  const pendingRequired = required.filter(check => check.status !== 'completed');
  for (const check of failingRequired) block(`Required check failed: ${check.name} (${check.conclusion ?? 'unknown'})`);
  for (const check of pendingRequired) block(`Required check not finished: ${check.name}`);
  if (detail.checks.some(check => check.required === undefined)) unknown('Required status of some checks was not reported');
  if (detail.truncation.checks) unknown(`Only ${detail.truncation.checks.shown} of ${detail.truncation.checks.total ?? '?'} checks were loaded`);
  if (summary.checks === 'unknown') unknown('Check rollup was not reported');

  const permission = detail.policy.viewerPermission?.toUpperCase();
  if (permission && !['ADMIN', 'MAINTAIN', 'WRITE'].includes(permission)) block(`Your permission (${permission.toLowerCase()}) cannot merge`);
  if (!permission) unknown('Your repository permission was not reported');

  const crossRepository = !!detail.headRepository && detail.headRepository.toLowerCase() !== detail.baseRepository.toLowerCase();
  const warnings = [
    `Remote, shared action: merging changes ${detail.baseRepository} ${summary.baseRef ?? '(base unknown)'} for everyone.`,
  ];
  if (request.deleteBranch) {
    warnings.push(crossRepository
      ? `Branch deletion requested, but the head branch lives in ${detail.headRepository}; deletion would be a separate action there.`
      : `Destructive: deletes remote branch ${summary.headRef ?? '(unknown)'} after a successful merge. Reported separately; may partially succeed.`);
  }
  if (now - detail.fetchedAt > staleAfterMs) unknown('This GitHub data is stale; refresh before any action');

  return {
    type: 'MergePlan', repository: repositoryName(summary.ref), number: summary.ref.number, title: summary.title,
    headSha: detail.headSha, headRef: summary.headRef, baseRef: summary.baseRef, method: request.method, methods,
    deleteBranch: {requested: request.deleteBranch, repositoryAutoDeletes: detail.policy.deleteBranchOnMerge, crossRepository},
    mergeable: summary.mergeable, mergeStateStatus: detail.mergeStateStatus, conditions, fetchedAt: detail.fetchedAt, warnings,
    executable: false, disabledReason: REMOTE_WRITES_DISABLED_REASON,
  };
}

export class RemoteWriteDisabledError extends Error {
  constructor(readonly action: string) {
    super(`${action}: ${REMOTE_WRITES_DISABLED_REASON}`);
    this.name = 'RemoteWriteDisabledError';
  }
}

export type RemoteWrite =
  | {type: 'merge'; plan: MergePlan}
  | {type: 'deleteBranch'; repository: string; branch: string}
  | {type: 'submitReview'; repository: string; number: number}
  | {type: 'closeIssue'; repository: string; number: number};

/** The single gate for remote writes. In this phase it always refuses. */
export function executeRemoteWrite(write: RemoteWrite): Promise<never> {
  return Promise.reject(new RemoteWriteDisabledError(write.type));
}

/**
 * Typed hand-off to the worktree manager (#337). This module only describes
 * the intent; it never inspects or changes local worktrees. Related worktree
 * state is `unknown` until a factual adapter from #337 provides it.
 */
export interface OpenRelatedWorktreeIntent {
  type: 'OpenRelatedWorktree';
  repository: string;
  number: number;
  headRef?: string;
  headRepository?: string;
  headSha?: string;
  worktreeState: 'unknown';
}

export function relatedWorktreeIntent(detail: PrDetail): OpenRelatedWorktreeIntent {
  return {type: 'OpenRelatedWorktree', repository: repositoryName(detail.summary.ref), number: detail.summary.ref.number,
    headRef: detail.summary.headRef, headRepository: detail.headRepository, headSha: detail.headSha, worktreeState: 'unknown'};
}
