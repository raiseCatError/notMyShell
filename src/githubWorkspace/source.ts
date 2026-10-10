import {
  type CheckConclusion, type CheckItem, type CheckStatus, type ChecksRollup, type CommentItem, type CommitItem, type FileChangeType,
  type FileSummary, GithubError, type IssueDetail, type IssueSummary, type ItemRef, LIMITS, type Mergeability, type MergeStateStatus,
  type PrDetail, type PrState, type PrSummary, type RelatedLink, type ReviewDecision, type SearchItem, type SearchPage, type Truncation,
} from './model.js';
import {ISSUE_DETAIL_QUERY, PR_DETAIL_QUERY, SEARCH_FIRST_QUERY, SEARCH_QUERY} from './queries.js';
import {boundedInt, optionalLine, safeGithubUrl, sanitizeBlock, sanitizeLine} from './sanitize.js';
import {GhCliTransport, type GithubTransport} from './transport.js';

/** One raw file entry from GitHub's PR files REST API, sanitized only at diff-model time. */
export interface RawPatchFile {
  filename: string;
  previousFilename?: string;
  status: FileChangeType;
  additions?: number;
  deletions?: number;
  /** Absent when GitHub omitted the patch (binary, too large, or not provided). */
  patch?: string;
}

export interface PatchFetch {
  files: RawPatchFile[];
  /** True when the PR reports more files than were fetched (GitHub caps at 3000; NMSh at LIMITS.files). */
  truncated: boolean;
  reportedFileCount?: number;
}

/** The only boundary between the workspace and GitHub. Every method is read-only. */
export interface GithubSource {
  search(effectiveQuery: string, cursor?: string): Promise<SearchPage>;
  pullRequest(ref: ItemRef): Promise<PrDetail>;
  pullRequestPatches(ref: ItemRef, reportedFileCount?: number): Promise<PatchFetch>;
  issue(ref: ItemRef): Promise<IssueDetail>;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const nodes = (value: unknown): unknown[] => arr(obj(value).nodes);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const login = (value: unknown): string | undefined => optionalLine(obj(value).login, LIMITS.nameLength);

function repoOf(value: unknown): {owner: string; repo: string} | undefined {
  const repository = obj(value);
  const owner = optionalLine(obj(repository.owner).login, LIMITS.nameLength);
  const repo = optionalLine(repository.name, LIMITS.nameLength);
  return owner && repo ? {owner, repo} : undefined;
}

function enumOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const lower = typeof value === 'string' ? value.toLowerCase() : '';
  return (allowed as readonly string[]).includes(lower) ? lower as T : fallback;
}

export function mapPrState(value: unknown): PrState { return enumOf(value, ['open', 'closed', 'merged'] as const, 'unknown'); }

export function mapReviewDecision(value: unknown): ReviewDecision {
  if (value === null) return 'none';
  return enumOf(value, ['approved', 'changes_requested', 'review_required'] as const, 'unknown');
}

export function mapMergeable(value: unknown): Mergeability { return enumOf(value, ['mergeable', 'conflicting'] as const, 'unknown'); }

export function mapMergeState(value: unknown): MergeStateStatus {
  return enumOf(value, ['clean', 'blocked', 'behind', 'dirty', 'draft', 'has_hooks', 'unstable'] as const, 'unknown');
}

export function mapRollup(commitNode: unknown): ChecksRollup {
  const commit = obj(obj(commitNode).commit);
  if (!('statusCheckRollup' in commit)) return 'unknown';
  if (commit.statusCheckRollup === null) return 'none';
  return enumOf(obj(commit.statusCheckRollup).state, ['success', 'failure', 'error', 'pending', 'expected'] as const, 'unknown');
}

function mapPrSummary(node: Json): PrSummary | undefined {
  const repository = repoOf(node.repository);
  const number = boundedInt(node.number);
  if (!repository || !number) return undefined;
  const commits = nodes(node.commits);
  return {
    ref: {kind: 'pr', ...repository, number},
    title: sanitizeLine(node.title, LIMITS.titleLength) || '(untitled)',
    author: login(node.author),
    state: mapPrState(node.state),
    draft: node.isDraft === true,
    headRef: optionalLine(node.headRefName, LIMITS.nameLength * 2),
    baseRef: optionalLine(node.baseRefName, LIMITS.nameLength * 2),
    updatedAt: str(node.updatedAt),
    reviewDecision: 'reviewDecision' in node ? mapReviewDecision(node.reviewDecision) : 'unknown',
    mergeable: mapMergeable(node.mergeable),
    checks: commits.length ? mapRollup(commits[commits.length - 1]) : 'unknown',
    additions: boundedInt(node.additions),
    deletions: boundedInt(node.deletions),
    changedFiles: boundedInt(node.changedFiles),
    url: safeGithubUrl(node.url),
  };
}

function mapIssueSummary(node: Json): IssueSummary | undefined {
  const repository = repoOf(node.repository);
  const number = boundedInt(node.number);
  if (!repository || !number) return undefined;
  return {
    ref: {kind: 'issue', ...repository, number},
    title: sanitizeLine(node.title, LIMITS.titleLength) || '(untitled)',
    author: login(node.author),
    state: enumOf(node.state, ['open', 'closed'] as const, 'unknown'),
    labels: nodes(node.labels).slice(0, LIMITS.labels).map(label => sanitizeLine(obj(label).name, LIMITS.nameLength)).filter(Boolean),
    updatedAt: str(node.updatedAt),
    comments: boundedInt(obj(node.comments).totalCount),
    url: safeGithubUrl(node.url),
  };
}

export function mapSearch(data: unknown, partialErrors: readonly string[] = []): SearchPage {
  const search = obj(obj(data).search);
  const items: SearchItem[] = [];
  for (const raw of arr(search.nodes).slice(0, LIMITS.pageSize)) {
    const node = obj(raw);
    const item = node.__typename === 'PullRequest' ? mapPrSummary(node) : node.__typename === 'Issue' ? mapIssueSummary(node) : undefined;
    if (item) items.push(item);
  }
  const pageInfo = obj(search.pageInfo);
  const rateLimit = obj(obj(data).rateLimit);
  return {
    items,
    total: boundedInt(search.issueCount),
    endCursor: str(pageInfo.endCursor),
    hasNextPage: pageInfo.hasNextPage === true,
    rateLimit: {remaining: boundedInt(rateLimit.remaining), resetAt: str(rateLimit.resetAt)},
    ...(partialErrors.length ? {warnings: [...partialErrors]} : {}),
  };
}

const CHECK_STATUSES = ['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'] as const;
const CHECK_CONCLUSIONS = ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure'] as const;

export function mapCheck(raw: unknown): CheckItem | undefined {
  const node = obj(raw);
  const required = typeof node.isRequired === 'boolean' ? node.isRequired : undefined;
  if (node.__typename === 'CheckRun') {
    const status = enumOf(node.status, CHECK_STATUSES, 'unknown') as CheckStatus;
    return {source: 'check_run', name: sanitizeLine(node.name, LIMITS.titleLength) || '(unnamed check)', status,
      conclusion: node.conclusion == null ? undefined : enumOf(node.conclusion, CHECK_CONCLUSIONS, 'unknown') as CheckConclusion,
      required, url: safeGithubUrl(node.detailsUrl)};
  }
  if (node.__typename === 'StatusContext') {
    const state = enumOf(node.state, ['success', 'failure', 'error', 'pending', 'expected'] as const, 'unknown');
    const done = state === 'success' || state === 'failure' || state === 'error';
    return {source: 'status', name: sanitizeLine(node.context, LIMITS.titleLength) || '(unnamed status)',
      status: done ? 'completed' : state === 'unknown' ? 'unknown' : 'pending', conclusion: done ? state : undefined, required,
      url: safeGithubUrl(node.targetUrl)};
  }
  return undefined;
}

function comment(raw: unknown, source: CommentItem['source']): CommentItem {
  const node = obj(raw);
  const body = sanitizeBlock(node.body, LIMITS.commentLength);
  return {source, author: login(node.author), createdAt: str(node.createdAt) ?? str(node.submittedAt), body: body.text, truncated: body.truncated,
    reviewState: source === 'review' ? optionalLine(node.state, 40)?.toLowerCase() : undefined,
    path: source === 'review_comment' ? optionalLine(node.path, 500) : undefined,
    line: source === 'review_comment' ? boundedInt(node.line) : undefined};
}

function noteTruncation(truncation: Truncation, name: string, shown: number, total: number | undefined): void {
  if (total !== undefined && total > shown) truncation[name] = {shown, total};
}

const FILE_TYPES = ['added', 'modified', 'removed', 'renamed', 'copied', 'changed'] as const;

export function mapPrDetail(data: unknown, now = Date.now()): PrDetail {
  const repository = obj(obj(data).repository);
  const pr = obj(repository.pullRequest);
  const summary = mapPrSummary(pr);
  if (!summary) throw new GithubError('not_found', 'Pull request not found or not visible to this account');
  const truncation: Truncation = {};
  const commitConnection = obj(pr.commits);
  const commitNodes = nodes(commitConnection);
  const head = commitNodes.length ? obj(obj(commitNodes[commitNodes.length - 1]).commit) : {};
  const rollup = obj(head.statusCheckRollup);
  const contexts = obj(rollup.contexts);
  const checks = nodes(contexts).slice(0, LIMITS.checks).map(mapCheck).filter((c): c is CheckItem => !!c);
  noteTruncation(truncation, 'checks', checks.length, boundedInt(contexts.totalCount));
  summary.checks = commitNodes.length ? mapRollup(commitNodes[commitNodes.length - 1]) : 'unknown';

  const commits: CommitItem[] = commitNodes.slice(-LIMITS.commits).map(raw => {
    const commit = obj(obj(raw).commit);
    const sha = /^[0-9a-f]{40}$/u.test(String(commit.oid)) ? String(commit.oid) : '';
    const author = obj(commit.author);
    return {sha, shortSha: sha.slice(0, 7) || '???????', headline: sanitizeLine(commit.messageHeadline, LIMITS.titleLength),
      author: login(author.user) ?? optionalLine(author.name, LIMITS.nameLength), committedAt: str(commit.committedDate)};
  });
  noteTruncation(truncation, 'commits', commits.length, boundedInt(commitConnection.totalCount));

  const comments: CommentItem[] = [];
  const issueComments = obj(pr.comments);
  for (const raw of nodes(issueComments).slice(0, LIMITS.comments)) comments.push(comment(raw, 'issue_comment'));
  noteTruncation(truncation, 'comments', nodes(issueComments).length, boundedInt(issueComments.totalCount));
  const reviews = obj(pr.reviews);
  for (const rawReview of nodes(reviews).slice(0, LIMITS.reviews)) {
    comments.push(comment(rawReview, 'review'));
    const inline = obj(obj(rawReview).comments);
    for (const raw of nodes(inline).slice(0, LIMITS.reviewComments)) comments.push(comment(raw, 'review_comment'));
    noteTruncation(truncation, 'review comments', nodes(inline).length, boundedInt(inline.totalCount));
  }
  noteTruncation(truncation, 'reviews', nodes(reviews).length, boundedInt(reviews.totalCount));
  comments.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

  const filesConnection = obj(pr.files);
  const files: FileSummary[] = nodes(filesConnection).slice(0, LIMITS.files).map(raw => {
    const node = obj(raw);
    return {path: sanitizeLine(node.path, 500) || '(unknown path)', changeType: enumOf(node.changeType, FILE_TYPES, 'unknown'),
      additions: boundedInt(node.additions), deletions: boundedInt(node.deletions)};
  });
  noteTruncation(truncation, 'files', files.length, boundedInt(filesConnection.totalCount) ?? summary.changedFiles);

  const body = sanitizeBlock(pr.body, LIMITS.bodyLength);
  const headSha = /^[0-9a-f]{40}$/u.test(String(pr.headRefOid)) ? String(pr.headRefOid) : undefined;
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : undefined);
  return {
    summary, body: body.text, bodyTruncated: body.truncated, headSha,
    headRepository: optionalLine(obj(pr.headRepository).nameWithOwner, 200),
    baseRepository: optionalLine(obj(pr.baseRepository).nameWithOwner, 200) ?? `${summary.ref.owner}/${summary.ref.repo}`,
    mergeStateStatus: mapMergeState(pr.mergeStateStatus),
    checks, comments, commits, files,
    policy: {merge: flag(repository.mergeCommitAllowed), squash: flag(repository.squashMergeAllowed), rebase: flag(repository.rebaseMergeAllowed),
      deleteBranchOnMerge: flag(repository.deleteBranchOnMerge), viewerPermission: optionalLine(repository.viewerPermission, 20),
      viewerCanUpdate: flag(pr.viewerCanUpdate)},
    truncation, fetchedAt: now,
  };
}

function relatedRef(raw: unknown, kind: 'pr' | 'issue'): ItemRef | undefined {
  const node = obj(raw);
  const repository = repoOf(node.repository);
  const number = boundedInt(node.number);
  return repository && number ? {kind, ...repository, number} : undefined;
}

export function mapIssueDetail(data: unknown, now = Date.now()): IssueDetail {
  const issue = obj(obj(obj(data).repository).issue);
  const summary = mapIssueSummary(issue);
  if (!summary) throw new GithubError('not_found', 'Issue not found or not visible to this account');
  const truncation: Truncation = {};
  const labels = obj(issue.labels);
  noteTruncation(truncation, 'labels', summary.labels.length, boundedInt(labels.totalCount));
  const assigneeConnection = obj(issue.assignees);
  const assignees = nodes(assigneeConnection).slice(0, LIMITS.assignees).map(login).filter((a): a is string => !!a);
  noteTruncation(truncation, 'assignees', assignees.length, boundedInt(assigneeConnection.totalCount));
  const commentConnection = obj(issue.comments);
  const comments = nodes(commentConnection).slice(0, LIMITS.comments).map(raw => comment(raw, 'issue_comment'));
  noteTruncation(truncation, 'comments', comments.length, boundedInt(commentConnection.totalCount));
  summary.comments = boundedInt(commentConnection.totalCount) ?? summary.comments;

  // Only relationships GitHub reports. Nothing is inferred from titles or branch names.
  const related: RelatedLink[] = [];
  const seen = new Set<string>();
  const add = (link: RelatedLink) => {
    const key = `${link.ref.kind}:${link.ref.owner}/${link.ref.repo}#${link.ref.number}`;
    if (seen.has(key) || related.length >= LIMITS.relatedLinks) return;
    seen.add(key);
    related.push(link);
  };
  for (const raw of nodes(issue.closedByPullRequestsReferences)) {
    const ref = relatedRef(raw, 'pr');
    if (ref) add({kind: 'closing_pr', ref, title: sanitizeLine(obj(raw).title, LIMITS.titleLength), state: optionalLine(obj(raw).state, 20)?.toLowerCase()});
  }
  for (const raw of nodes(issue.timelineItems)) {
    const source = obj(obj(raw).source);
    const kind = source.__typename === 'PullRequest' ? 'pr' : source.__typename === 'Issue' ? 'issue' : undefined;
    const ref = kind && relatedRef(source, kind);
    if (ref) add({kind: 'cross_reference', ref, title: sanitizeLine(source.title, LIMITS.titleLength), state: optionalLine(source.state, 20)?.toLowerCase()});
  }

  const body = sanitizeBlock(issue.body, LIMITS.bodyLength);
  return {summary, body: body.text, bodyTruncated: body.truncated, assignees, createdAt: str(issue.createdAt), comments, related, truncation, fetchedAt: now};
}

export function mapPatchFiles(pages: readonly unknown[]): RawPatchFile[] {
  const files: RawPatchFile[] = [];
  for (const page of pages) for (const raw of arr(page)) {
    if (files.length >= LIMITS.files) return files;
    const node = obj(raw);
    const filename = typeof node.filename === 'string' ? node.filename : undefined;
    if (!filename) continue;
    files.push({filename, previousFilename: str(node.previous_filename), status: enumOf(node.status, FILE_TYPES, 'unknown'),
      additions: boundedInt(node.additions), deletions: boundedInt(node.deletions), patch: str(node.patch)});
  }
  return files;
}

/** Validates a ref before any of its parts is used in a request. */
export function assertRef(ref: ItemRef): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u.test(ref.owner) || !/^[A-Za-z0-9._-]{1,100}$/u.test(ref.repo) || !Number.isSafeInteger(ref.number) || ref.number <= 0) {
    throw new GithubError('invalid_query', 'Invalid repository or item number');
  }
}

/** GitHub CLI-backed read-only source. */
export class GhSource implements GithubSource {
  constructor(private readonly transport: GithubTransport = new GhCliTransport()) {}

  async search(effectiveQuery: string, cursor?: string): Promise<SearchPage> {
    const {data, partialErrors} = cursor
      ? await this.transport.graphql(SEARCH_QUERY, {q: effectiveQuery, first: LIMITS.pageSize, after: cursor})
      : await this.transport.graphql(SEARCH_FIRST_QUERY, {q: effectiveQuery, first: LIMITS.pageSize});
    return mapSearch(data, partialErrors);
  }

  async pullRequest(ref: ItemRef): Promise<PrDetail> {
    assertRef(ref);
    const {data, partialErrors} = await this.transport.graphql(PR_DETAIL_QUERY, {owner: ref.owner, name: ref.repo, number: ref.number});
    const detail = mapPrDetail(data);
    if (partialErrors.length) detail.warnings = [...partialErrors];
    return detail;
  }

  async pullRequestPatches(ref: ItemRef, reportedFileCount?: number): Promise<PatchFetch> {
    assertRef(ref);
    const pages: unknown[] = [];
    const perPage = 100;
    for (let page = 1; page <= Math.ceil(LIMITS.files / perPage); page++) {
      const result = await this.transport.restGet(`repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=${perPage}&page=${page}`);
      pages.push(result);
      if (arr(result).length < perPage) break;
    }
    const files = mapPatchFiles(pages);
    return {files, truncated: reportedFileCount !== undefined ? reportedFileCount > files.length : files.length >= LIMITS.files, reportedFileCount};
  }

  async issue(ref: ItemRef): Promise<IssueDetail> {
    assertRef(ref);
    const {data, partialErrors} = await this.transport.graphql(ISSUE_DETAIL_QUERY, {owner: ref.owner, name: ref.repo, number: ref.number});
    const detail = mapIssueDetail(data);
    if (partialErrors.length) detail.warnings = [...partialErrors];
    return detail;
  }
}
