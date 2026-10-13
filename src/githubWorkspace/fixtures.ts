import {GithubError, type IssueDetail, type ItemRef, type PrDetail, type SearchPage} from './model.js';
import {tokenizeQuery} from './query.js';
import {type GithubSource, mapIssueDetail, mapPatchFiles, mapPrDetail, mapSearch, type PatchFetch} from './source.js';

/**
 * Deterministic, offline sample data for tests and the development preview.
 * Raw shapes mirror GitHub's GraphQL/REST responses and flow through the
 * real mappers, so sanitization and unknown-state handling are exercised.
 * Hostile entries are deliberate. No network, no credentials.
 */

export type FixtureScenario = 'ok' | 'empty' | 'auth' | 'rate_limit' | 'offline' | 'slow' | 'partial' | 'flaky';

export const FIXTURE_SCENARIOS: readonly FixtureScenario[] = ['ok', 'empty', 'auth', 'rate_limit', 'offline', 'slow', 'partial', 'flaky'];

export const FIXTURE_NOW = Date.parse('2026-10-08T12:00:00Z');
const OWNER = 'raiseCatError';
const REPO = 'notMyShell';
const repository = {name: REPO, owner: {login: OWNER}};
const hoursAgo = (hours: number) => new Date(FIXTURE_NOW - hours * 3_600_000).toISOString();
const sha = (seed: number) => (seed.toString(16).padStart(8, '0').repeat(5)).slice(0, 40);

export const HOSTILE_TITLE = 'Fix \u001b]0;PWNED\u0007title \u001b[31mred\u001b[0m \u001b]8;;https://evil.example\u001b\\link\u001b]8;;\u001b\\ ‮eman‬';

interface RawPr { number: number; title: string; state: string; isDraft?: boolean; head: string; base?: string; author?: string | null;
  updated: number; review?: string | null; mergeable?: string; rollup?: string | null; additions?: number; deletions?: number; changedFiles?: number }

const PRS: RawPr[] = [
  {number: 329, title: 'Add keyboard-first managed Claude targets and unified mod inventory', state: 'OPEN', head: 'feature/claude-agent-ui', updated: 3,
    review: 'REVIEW_REQUIRED', mergeable: 'UNKNOWN', rollup: 'PENDING', additions: 1840, deletions: 212, changedFiles: 7},
  {number: 342, title: 'Add safe Git worktree manager core', state: 'OPEN', head: 'feature/worktree-manager-core', updated: 5,
    review: null, mergeable: 'CONFLICTING', rollup: 'FAILURE', additions: 1968, deletions: 1, changedFiles: 12},
  {number: 315, title: 'Theme Bridge', state: 'OPEN', head: 'feature/theme-bridge', updated: 30, review: 'APPROVED', mergeable: 'MERGEABLE',
    rollup: 'SUCCESS', additions: 420, deletions: 80, changedFiles: 9},
  {number: 328, title: 'Status Strip 2.0', state: 'MERGED', head: 'feature/status-strip-2', updated: 20, review: 'APPROVED', mergeable: 'UNKNOWN',
    rollup: 'SUCCESS', additions: 900, deletions: 300, changedFiles: 21},
  {number: 301, title: 'Draft: experimental idle scenes', state: 'OPEN', isDraft: true, head: 'draft/idle', updated: 200, review: null,
    mergeable: 'MERGEABLE', rollup: null, additions: 12, deletions: 2, changedFiles: 1},
  {number: 666, title: HOSTILE_TITLE, state: 'OPEN', head: 'evil/\u001b[2Jbranch', updated: 1, author: 'mallory', review: 'CHANGES_REQUESTED',
    mergeable: 'MERGEABLE', rollup: 'ERROR', additions: 3, deletions: 3, changedFiles: 3},
  {number: 350, title: '幅の広い文字 🧪 wide-cell title with emoji and CJK', state: 'CLOSED', head: 'i18n/wide', updated: 50, review: null,
    mergeable: 'UNKNOWN', rollup: 'SUCCESS'},
  {number: 290, title: 'Ghost author PR', state: 'OPEN', head: 'ghost', updated: 400, author: null},
];
for (let i = 0; i < 30; i++) PRS.push({number: 200 - i, title: `Maintenance change ${i + 1}`, state: i % 3 ? 'MERGED' : 'CLOSED', head: `chore/${i}`, updated: 500 + i * 10, review: null, mergeable: 'UNKNOWN', rollup: 'SUCCESS', additions: i, deletions: i, changedFiles: 1});

interface RawIssue { number: number; title: string; state: string; labels: string[]; updated: number; comments: number; author?: string }
const ISSUES: RawIssue[] = [
  {number: 338, title: 'GitHub terminal workspace: PR and issue search, review and supported remote actions', state: 'OPEN', labels: ['enhancement', 'workspace'], updated: 12, comments: 2},
  {number: 337, title: 'Git worktree manager', state: 'OPEN', labels: ['enhancement', 'workspace'], updated: 10, comments: 1},
  {number: 330, title: 'Workspace umbrella', state: 'OPEN', labels: ['epic'], updated: 14, comments: 0},
  {number: 312, title: 'Crash when prompt theme has a bad glyph', state: 'CLOSED', labels: ['bug'], updated: 90, comments: 4},
  {number: 667, title: 'Issue with \u001b[5mblink\u001b[0m and \u0007bell and a very long title '.repeat(4), state: 'OPEN', labels: ['bug', '\u001b[31mlabel'], updated: 2, comments: 1, author: 'mallory'},
];
for (let i = 0; i < 20; i++) ISSUES.push({number: 100 - i, title: `Backlog item ${i + 1}`, state: i % 2 ? 'OPEN' : 'CLOSED', labels: i % 4 ? [] : ['bug'], updated: 300 + i, comments: i % 3});

function rawPr(pr: RawPr): Record<string, unknown> {
  return {__typename: 'PullRequest', number: pr.number, title: pr.title, url: `https://github.com/${OWNER}/${REPO}/pull/${pr.number}`, state: pr.state,
    isDraft: pr.isDraft ?? false, updatedAt: hoursAgo(pr.updated), headRefName: pr.head, baseRefName: pr.base ?? 'master',
    additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles, reviewDecision: pr.review, mergeable: pr.mergeable,
    author: pr.author === null ? null : {login: pr.author ?? OWNER}, repository,
    commits: pr.rollup === undefined ? {nodes: []} : {nodes: [{commit: {statusCheckRollup: pr.rollup === null ? null : {state: pr.rollup}}}]}};
}

function rawIssue(issue: RawIssue): Record<string, unknown> {
  return {__typename: 'Issue', number: issue.number, title: issue.title, url: `https://github.com/${OWNER}/${REPO}/issues/${issue.number}`,
    state: issue.state, updatedAt: hoursAgo(issue.updated), author: {login: issue.author ?? OWNER}, repository,
    labels: {nodes: issue.labels.map(name => ({name}))}, comments: {totalCount: issue.comments}};
}

/** A tiny, clearly simulated subset of GitHub search semantics, for offline browsing only. */
export function fixtureMatches(node: Record<string, unknown>, query: string): boolean {
  const tokens = tokenizeQuery(query) ?? [];
  for (const t of tokens) {
    const value = t.value?.toLowerCase();
    let ok = true;
    switch (t.qualifier) {
      case 'is': case 'type':
        if (value === 'pr' || value === 'pull-request') ok = node.__typename === 'PullRequest';
        else if (value === 'issue') ok = node.__typename === 'Issue';
        else if (value === 'open' || value === 'closed' || value === 'merged') ok = String(node.state).toLowerCase() === value || (value === 'closed' && node.state === 'MERGED');
        else if (value === 'draft') ok = node.isDraft === true;
        break;
      case 'state': ok = String(node.state).toLowerCase() === value; break;
      case 'author': ok = value === '@me' ? (node.author as {login?: string} | null)?.login === OWNER : (node.author as {login?: string} | null)?.login?.toLowerCase() === value; break;
      case 'label': ok = ((node.labels as {nodes: Array<{name: string}>} | undefined)?.nodes ?? []).some(label => label.name.toLowerCase() === value); break;
      case 'repo': ok = value === `${OWNER}/${REPO}`.toLowerCase(); break;
      case 'review-requested': ok = node.reviewDecision === 'REVIEW_REQUIRED'; break;
      case undefined: ok = String(node.title).toLowerCase().includes(t.text.replace(/"/gu, '').toLowerCase()); break;
      default: ok = true;
    }
    if (t.negated) ok = !ok;
    if (!ok) return false;
  }
  return true;
}

function longPatch(lines: number): string {
  const body = Array.from({length: lines}, (_, i) => `+line ${i + 1}`).join('\n');
  return `@@ -0,0 +1,${lines} @@\n${body}`;
}

const PATCH_FILES = [
  {filename: 'src/agents/launcher.ts', status: 'modified', additions: 4, deletions: 2,
    patch: '@@ -10,7 +10,9 @@ export function launch() {\n   const target = resolve();\n-  start(target);\n-  return target;\n+  if (!target) return undefined;\n+  start(target);\n+  focus(target);\n+  return target;\n   // trailing context\n \tindented();\n }\n\\ No newline at end of file'},
  {filename: 'docs/assets/logo.png', status: 'added', additions: 0, deletions: 0},
  {filename: 'src/ui/shelf.ts', previous_filename: 'src/ui/oldShelf.ts', status: 'renamed', additions: 0, deletions: 0},
  {filename: 'src/ui/header.ts', previous_filename: 'src/ui/title.ts', status: 'renamed', additions: 1, deletions: 1,
    patch: '@@ -1,3 +1,3 @@\n import x from "y";\n-export const title = 1;\n+export const header = 1;\n '},
  {filename: 'src/generated/huge.ts', status: 'added', additions: 2400, deletions: 0, patch: longPatch(2400)},
  {filename: 'src/abbrev.ts', status: 'modified', additions: 50, deletions: 10, patch: '@@ -1,2 +1,3 @@\n a\n+b\n c'},
  {filename: 'evil.txt', status: 'modified', additions: 2, deletions: 1,
    patch: '@@ -1 +1,2 @@\n-safe\n+\u001b]52;c;cGF5bG9hZA==\u0007clipboard\n+\u001b[2J\u001b[Hclear \u009b31m c1'},
];

function prDetailRaw(pr: RawPr): Record<string, unknown> {
  const base = rawPr(pr);
  const hostile = pr.number === 666;
  const checks = pr.rollup === null ? null : {state: pr.rollup ?? 'PENDING', contexts: {totalCount: hostile ? 140 : 6, nodes: [
    {__typename: 'CheckRun', name: 'build (macOS)', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/x/y/runs/1', isRequired: true},
    {__typename: 'CheckRun', name: 'test (node 22)', status: 'IN_PROGRESS', conclusion: null, isRequired: true},
    {__typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: pr.rollup === 'FAILURE' ? 'FAILURE' : 'SUCCESS', isRequired: false},
    {__typename: 'CheckRun', name: 'optional docs', status: 'COMPLETED', conclusion: 'SKIPPED', isRequired: false},
    {__typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING', targetUrl: 'javascript:alert(1)'},
    {__typename: 'CheckRun', name: hostile ? 'evil \u001b]0;check\u0007name' : 'security scan', status: 'QUEUED', conclusion: null},
  ]}};
  return {data: {rateLimit: {remaining: 4990, resetAt: hoursAgo(-1)}, repository: {
    mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, deleteBranchOnMerge: false, viewerPermission: 'ADMIN',
    pullRequest: {...base, headRefOid: pr.number === 290 ? null : sha(pr.number), mergeStateStatus: pr.mergeable === 'CONFLICTING' ? 'DIRTY' : pr.review === 'REVIEW_REQUIRED' ? 'BLOCKED' : pr.mergeable === 'UNKNOWN' ? 'UNKNOWN' : 'CLEAN',
      viewerCanUpdate: true,
      body: hostile ? `Body with \u001b]8;;https://evil\u001b\\hyperlink\u001b]8;;\u001b\\ and \u001b[?1049h alt screen\n\n${'spam '.repeat(5000)}`
        : `## Summary\n\nThis is fixture PR #${pr.number}.\n\n- Tabs\tare\texpanded\n- Lines wrap at the terminal width so long descriptions remain readable in narrow layouts.`,
      headRepository: {nameWithOwner: pr.number === 315 ? 'contributor/notMyShell' : `${OWNER}/${REPO}`},
      baseRepository: {nameWithOwner: `${OWNER}/${REPO}`},
      commits: {totalCount: hostile ? 250 : 3, nodes: [
        {commit: {oid: sha(pr.number + 1), messageHeadline: 'First step', committedDate: hoursAgo(30), author: {name: 'Jai', user: {login: OWNER}}}},
        {commit: {oid: sha(pr.number + 2), messageHeadline: hostile ? 'commit \u001b[31mred' : 'Second step', committedDate: hoursAgo(20), author: {name: 'Co Author', user: null}}},
        {commit: {oid: sha(pr.number), messageHeadline: 'Head commit', committedDate: hoursAgo(pr.updated), author: {name: 'Jai', user: {login: OWNER}}, statusCheckRollup: checks}},
      ]},
      comments: {totalCount: 2, nodes: [
        {author: {login: 'reviewer'}, createdAt: hoursAgo(10), body: 'Looks good overall.\nOne question below.'},
        {author: {login: 'mallory'}, createdAt: hoursAgo(9), body: hostile ? '\u001b]52;c;ZXZpbA==\u0007steal clipboard \u001b[8mhidden' : 'Thanks!'},
      ]},
      reviews: {totalCount: 1, nodes: [{author: {login: 'reviewer'}, state: 'CHANGES_REQUESTED', submittedAt: hoursAgo(8), body: 'Please handle the unknown case.',
        comments: {totalCount: 1, nodes: [{author: {login: 'reviewer'}, createdAt: hoursAgo(8), body: 'Unknown is not success.', path: 'src/agents/launcher.ts', line: 12}]}}]},
      files: {totalCount: hostile ? 400 : PATCH_FILES.length, pageInfo: {hasNextPage: false}, nodes: PATCH_FILES.map(file => ({path: file.filename,
        additions: file.additions, deletions: file.deletions, changeType: file.status.toUpperCase()}))},
    }}}};
}

function issueDetailRaw(issue: RawIssue): Record<string, unknown> {
  return {data: {repository: {issue: {...rawIssue(issue), createdAt: hoursAgo(issue.updated + 48),
    body: issue.number === 667 ? '\u001b]0;title\u0007Hostile body\u001b[2J' : `Fixture issue #${issue.number}.\n\nAcceptance criteria:\n- [ ] Accurate\n- [ ] Bounded`,
    labels: {totalCount: issue.labels.length, nodes: issue.labels.map(name => ({name}))},
    assignees: {totalCount: 1, nodes: [{login: OWNER}]},
    comments: {totalCount: issue.comments, nodes: Array.from({length: issue.comments}, (_, i) => ({author: {login: i ? 'teammate' : OWNER}, createdAt: hoursAgo(issue.updated - i), body: `Comment ${i + 1}`}))},
    closedByPullRequestsReferences: {nodes: issue.number === 338 ? [{number: 343, title: 'Add terminal-native GitHub workspace core', state: 'OPEN', repository}] : []},
    timelineItems: {nodes: issue.number === 338 ? [{source: {__typename: 'Issue', number: 330, title: 'Workspace umbrella', state: 'OPEN', repository}}, {source: {__typename: 'PullRequest', number: 329, title: 'Managed Claude targets', state: 'OPEN', repository}}] : []},
  }}}};
}

export interface FixtureSourceOptions {
  scenario?: FixtureScenario;
  pageSize?: number;
  delayMs?: number;
  /** Observes every call (tests assert on lazy fetching). */
  onCall?: (operation: string) => void;
  /** Clock for `fetchedAt` (defaults to FIXTURE_NOW). */
  now?: () => number;
}

export class FixtureSource implements GithubSource {
  scenario: FixtureScenario;
  private calls = 0;
  constructor(private readonly options: FixtureSourceOptions = {}) { this.scenario = options.scenario ?? 'ok'; }

  private async gate(operation: string): Promise<void> {
    this.options.onCall?.(operation);
    this.calls++;
    const delay = this.scenario === 'slow' ? Math.max(this.options.delayMs ?? 1200, 1) : this.options.delayMs ?? 0;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (this.scenario === 'auth') throw new GithubError('auth', 'gh: To get started with GitHub CLI, please run: gh auth login');
    if (this.scenario === 'rate_limit') throw new GithubError('rate_limit', 'API rate limit exceeded for user', hoursAgo(-1));
    if (this.scenario === 'offline') throw new GithubError('network', 'dial tcp: lookup api.github.com: no such host');
    if (this.scenario === 'flaky' && this.calls % 2 === 0) throw new GithubError('network', 'connection reset by peer');
  }

  async search(effectiveQuery: string, cursor?: string): Promise<SearchPage> {
    await this.gate('search');
    const pageSize = this.options.pageSize ?? 10;
    const all = this.scenario === 'empty' ? [] : [...PRS.map(rawPr), ...ISSUES.map(rawIssue)]
      .filter(node => fixtureMatches(node, effectiveQuery))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || Number(b.number) - Number(a.number));
    const offset = cursor ? Number(cursor.replace('cursor:', '')) : 0;
    const nodes = all.slice(offset, offset + pageSize);
    const hasNextPage = offset + pageSize < all.length;
    const data = {rateLimit: {remaining: 4990, resetAt: hoursAgo(-1)},
      search: {issueCount: all.length, pageInfo: {hasNextPage, endCursor: hasNextPage ? `cursor:${offset + pageSize}` : null}, nodes}};
    return mapSearch(data, this.scenario === 'partial' ? ['Some results could not be loaded (fixture partial error)'] : []);
  }

  async pullRequest(ref: ItemRef): Promise<PrDetail> {
    await this.gate(`pr:${ref.number}`);
    const pr = PRS.find(p => p.number === ref.number);
    if (!pr) throw new GithubError('not_found', 'Could not resolve to a PullRequest');
    const detail = mapPrDetail(prDetailRaw(pr).data, this.options.now?.() ?? FIXTURE_NOW);
    if (this.scenario === 'partial') detail.warnings = ['Resource not accessible: checks (fixture partial error)'];
    return detail;
  }

  async pullRequestPatches(ref: ItemRef, reportedFileCount?: number): Promise<PatchFetch> {
    await this.gate(`patches:${ref.number}`);
    const files = mapPatchFiles([PATCH_FILES]);
    const reported = ref.number === 666 ? 400 : reportedFileCount;
    return {files, truncated: reported !== undefined && reported > files.length, reportedFileCount: reported};
  }

  async issue(ref: ItemRef): Promise<IssueDetail> {
    await this.gate(`issue:${ref.number}`);
    const issue = ISSUES.find(i => i.number === ref.number);
    if (!issue) throw new GithubError('not_found', 'Could not resolve to an Issue');
    return mapIssueDetail(issueDetailRaw(issue).data, this.options.now?.() ?? FIXTURE_NOW);
  }
}

export const FIXTURE_REPOSITORY = `${OWNER}/${REPO}`;
