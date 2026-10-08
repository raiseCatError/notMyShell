/**
 * Typed, factual model of GitHub pull requests and issues for the terminal
 * GitHub workspace (#338). GitHub owns remote truth: every field that GitHub
 * did not report is `undefined` or an explicit `'unknown'` state, never a
 * guessed value. All strings are already sanitized (see sanitize.ts) before
 * they are stored here.
 */

/** Hard bounds. Every collection the workspace holds is finite. */
export const LIMITS = {
  queryLength: 256,
  pageSize: 25,
  maxPages: 8,
  maxResults: 200,
  titleLength: 300,
  nameLength: 100,
  bodyLength: 16_000,
  commentLength: 8_000,
  comments: 100,
  reviews: 50,
  reviewComments: 20,
  commits: 100,
  checks: 100,
  files: 300,
  labels: 20,
  assignees: 20,
  relatedLinks: 20,
  patchLinesPerFile: 1_500,
  patchLinesTotal: 20_000,
  patchLineLength: 1_000,
  cacheEntries: 32,
  searchHistory: 20,
  concurrentFetches: 2,
  responseBytes: 8 * 1024 * 1024,
} as const;

export type ItemKind = 'pr' | 'issue';

/** Stable identity across refreshes and pages: host-independent owner/name#number plus kind. */
export interface ItemRef {
  kind: ItemKind;
  owner: string;
  repo: string;
  number: number;
}

export function itemKey(ref: ItemRef): string {
  return `${ref.kind}:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`;
}

export function repositoryName(ref: Pick<ItemRef, 'owner' | 'repo'>): string {
  return `${ref.owner}/${ref.repo}`;
}

export type PrState = 'open' | 'closed' | 'merged' | 'unknown';
export type IssueState = 'open' | 'closed' | 'unknown';

/** GitHub `reviewDecision`; undefined means GitHub reported none (no required review, or not readable). */
export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required' | 'none' | 'unknown';

/** GitHub `mergeable`; UNKNOWN means GitHub is still computing it. */
export type Mergeability = 'mergeable' | 'conflicting' | 'unknown';

/** GitHub `mergeStateStatus` (a preview field; may be absent). */
export type MergeStateStatus = 'clean' | 'blocked' | 'behind' | 'dirty' | 'draft' | 'has_hooks' | 'unstable' | 'unknown';

/** Rollup reported by GitHub for the head commit's checks and statuses. */
export type ChecksRollup = 'success' | 'failure' | 'error' | 'pending' | 'expected' | 'none' | 'unknown';

export interface PrSummary {
  ref: ItemRef & {kind: 'pr'};
  title: string;
  author?: string;
  state: PrState;
  draft: boolean;
  headRef?: string;
  baseRef?: string;
  updatedAt?: string;
  reviewDecision: ReviewDecision;
  mergeable: Mergeability;
  checks: ChecksRollup;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  url?: string;
}

export interface IssueSummary {
  ref: ItemRef & {kind: 'issue'};
  title: string;
  author?: string;
  state: IssueState;
  labels: string[];
  updatedAt?: string;
  comments?: number;
  url?: string;
}

export type SearchItem = PrSummary | IssueSummary;

export type CheckStatus = 'queued' | 'in_progress' | 'completed' | 'waiting' | 'pending' | 'requested' | 'unknown';
export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required'
  | 'stale' | 'startup_failure' | 'error' | 'pending' | 'expected' | 'unknown';

/** One individual check run or commit status, exactly as GitHub reported it. */
export interface CheckItem {
  source: 'check_run' | 'status';
  name: string;
  status: CheckStatus;
  /** Undefined while the check has not completed. */
  conclusion?: CheckConclusion;
  required?: boolean;
  url?: string;
}

export type CommentSource = 'issue_comment' | 'review' | 'review_comment';

export interface CommentItem {
  source: CommentSource;
  author?: string;
  createdAt?: string;
  body: string;
  /** Review verdict for `review` entries. */
  reviewState?: string;
  /** File path for inline `review_comment` entries. */
  path?: string;
  line?: number;
  truncated: boolean;
}

export interface CommitItem {
  sha: string;
  shortSha: string;
  headline: string;
  author?: string;
  committedAt?: string;
}

export type FileChangeType = 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unknown';

export interface FileSummary {
  path: string;
  previousPath?: string;
  changeType: FileChangeType;
  additions?: number;
  deletions?: number;
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

/** Repository merge policy; `undefined` per method means GitHub did not tell us. */
export interface MergePolicy {
  merge?: boolean;
  squash?: boolean;
  rebase?: boolean;
  deleteBranchOnMerge?: boolean;
  viewerPermission?: string;
  viewerCanUpdate?: boolean;
}

export interface Truncation {
  /** Collection name -> {shown, total?}; present only when GitHub reported more than we hold. */
  [collection: string]: {shown: number; total?: number};
}

export interface PrDetail {
  summary: PrSummary;
  body: string;
  bodyTruncated: boolean;
  headSha?: string;
  headRepository?: string;
  baseRepository: string;
  mergeStateStatus: MergeStateStatus;
  checks: CheckItem[];
  comments: CommentItem[];
  commits: CommitItem[];
  files: FileSummary[];
  policy: MergePolicy;
  truncation: Truncation;
  fetchedAt: number;
  /** Partial GraphQL errors GitHub reported alongside data. */
  warnings?: string[];
}

export interface RelatedLink {
  kind: 'closing_pr' | 'cross_reference';
  ref: ItemRef;
  title: string;
  state?: string;
}

export interface IssueDetail {
  summary: IssueSummary;
  body: string;
  bodyTruncated: boolean;
  assignees: string[];
  createdAt?: string;
  comments: CommentItem[];
  related: RelatedLink[];
  truncation: Truncation;
  fetchedAt: number;
  /** Partial GraphQL errors GitHub reported alongside data. */
  warnings?: string[];
}

export interface SearchPage {
  items: SearchItem[];
  /** GitHub's reported total (search caps navigable results at 1000). */
  total?: number;
  endCursor?: string;
  hasNextPage: boolean;
  rateLimit?: RateLimitInfo;
  warnings?: string[];
}

export interface RateLimitInfo {
  remaining?: number;
  resetAt?: string;
}

/** Truthful, recoverable error categories. Messages are sanitized and never contain credentials. */
export type GithubErrorKind = 'auth' | 'rate_limit' | 'network' | 'not_found' | 'unavailable' | 'invalid_query' | 'too_large' | 'timeout' | 'unknown';

export class GithubError extends Error {
  constructor(readonly kind: GithubErrorKind, message: string, readonly retryAfter?: string) {
    super(message);
    this.name = 'GithubError';
  }
}

export function errorKindLabel(kind: GithubErrorKind): string {
  switch (kind) {
    case 'auth': return 'Not authenticated with GitHub';
    case 'rate_limit': return 'GitHub rate limit reached';
    case 'network': return 'GitHub unreachable (offline?)';
    case 'not_found': return 'Not found or not visible to this account';
    case 'unavailable': return 'GitHub CLI unavailable';
    case 'invalid_query': return 'GitHub rejected the query';
    case 'too_large': return 'Response exceeded the size bound';
    case 'timeout': return 'GitHub request timed out';
    case 'unknown': return 'GitHub request failed';
  }
}
