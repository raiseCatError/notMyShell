import test from 'node:test';
import assert from 'node:assert/strict';
import {mapSearch} from '../src/githubWorkspace/source.js';
import {SEARCH_QUERY} from '../src/githubWorkspace/queries.js';
import type {PrSummary} from '../src/githubWorkspace/model.js';
import {relatedPullRequests} from '../src/worktrees/relatedPr.js';
import type {WorktreeRecord} from '../src/worktrees/model.js';

const HEAD = 'a'.repeat(40);
const pr = (number: number, extra: Partial<PrSummary> = {}): PrSummary => ({ref: {kind: 'pr', owner: 'raiseCatError', repo: 'notMyShell', number}, title: `PR ${number}`,
  state: 'open', draft: false, headRef: 'feature/x', headRepository: 'raiseCatError/notMyShell', headSha: HEAD, reviewDecision: 'none', mergeable: 'unknown', checks: 'unknown', ...extra});
const worktree = (extra: Partial<WorktreeRecord> = {}): WorktreeRecord => ({id: '/w', path: '/w', ref: 'refs/heads/feature/x', branch: 'feature/x', head: HEAD, detached: false,
  bare: false, main: false, locked: false, prunable: false, pathState: 'present', status: {kind: 'clean'}, ...extra});

test('related pull requests: same-repository head branch only; forks, unknown heads and partial names are not evidence', () => {
  const prs = [
    pr(1),
    pr(2, {headRepository: 'someone/notMyShell'}),
    pr(3, {headRepository: undefined}),
    pr(4, {headRef: 'feature/x-2'}),
    pr(5, {state: 'merged', updatedAt: '2026-10-11T00:00:00Z', headSha: 'b'.repeat(40)}),
    pr(6, {ref: {kind: 'pr', owner: 'other', repo: 'repo', number: 6}, headRepository: 'other/repo'}),
  ];
  const related = relatedPullRequests(worktree(), 'raiseCatError/notMyShell', prs);
  assert.deepEqual(related.map(item => [item.pr.ref.number, item.atHead]), [[1, true], [5, false]], 'open first; the merged PR is related but its head is not this HEAD');
  assert.deepEqual(relatedPullRequests(worktree({detached: true, branch: undefined}), 'raiseCatError/notMyShell', prs), [], 'a detached HEAD has no branch to match');
  assert.deepEqual(relatedPullRequests(worktree(), 'RAISECATERROR/NOTMYSHELL', prs).length, 2, 'owner/name compare case-insensitively, as GitHub does');
  assert.equal(relatedPullRequests(worktree({head: undefined}), 'raiseCatError/notMyShell', [pr(1)])[0]!.atHead, undefined, 'unknown, not false');
});

test('PR summaries carry the head repository and head commit from the search query', () => {
  assert.match(SEARCH_QUERY, /headRefOid\s+headRepository \{ nameWithOwner \}/u);
  const page = mapSearch({search: {issueCount: 1, pageInfo: {hasNextPage: false}, nodes: [{__typename: 'PullRequest', number: 7, title: 't', state: 'OPEN', headRefName: 'b',
    headRefOid: HEAD, headRepository: {nameWithOwner: 'fork/notMyShell\u001b[31m'}, repository: {name: 'notMyShell', owner: {login: 'raiseCatError'}}}, {__typename: 'PullRequest', number: 8, title: 't', state: 'OPEN',
    headRefOid: 'not-a-sha', repository: {name: 'notMyShell', owner: {login: 'raiseCatError'}}}]}});
  const [first, second] = page.items as PrSummary[];
  assert.equal(first!.headSha, HEAD);
  assert.doesNotMatch(first!.headRepository!, /\u001b/u, 'hostile text is sanitized');
  assert.equal(second!.headSha, undefined, 'a malformed commit id is not kept');
  assert.equal(second!.headRepository, undefined);
});
