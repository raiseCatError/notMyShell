import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  attachRenderer, BoundedCache, buildDiffModel, classifyFailure, compactSummary, ConcurrencyLimit, executeRemoteWrite, GhCliTransport,
  ghEnvironment, GhSource, type GhRunner, GithubError, GithubWorkspaceController, GithubWorkspaceService, itemKey, LIMITS, mapPrDetail,
  parseRepository, planMerge, prepareQuery, redactMessage, RemoteWriteDisabledError, rememberQuery, renderWorkspace, type RenderOptions,
  type SearchPage, type GithubSource, type WorkspaceKey, sanitizeBlock, sanitizeLine,
} from '../src/githubWorkspace/index.js';
import {FIXTURE_NOW, FixtureSource, HOSTILE_TITLE} from '../src/githubWorkspace/fixtures.js';
import {displayWidth} from '../src/util/text.js';

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;
const WIDTHS = [30, 40, 50, 80, 120, 200];

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
}

function setup(sourceOptions: ConstructorParameters<typeof FixtureSource>[0] = {}) {
  const calls: string[] = [];
  const source = new FixtureSource({...sourceOptions, onCall: op => calls.push(op)});
  let now = FIXTURE_NOW;
  const controller = new GithubWorkspaceController(new GithubWorkspaceService(source), {
    title: 'raiseCatError/notMyShell', clock: () => now,
    initialQueries: {prs: 'repo:raiseCatError/notMyShell is:open', issues: 'repo:raiseCatError/notMyShell is:open', search: 'repo:raiseCatError/notMyShell'},
  });
  const view = {columns: 80, rows: 24, glyphs: 'safe' as const, color: 'none' as const};
  const options = (): RenderOptions => ({...view, now});
  controller.setViewport(view.columns, view.rows);
  attachRenderer(controller, options);
  const render = (overrides: Partial<RenderOptions> = {}) => renderWorkspace(controller.snapshot, controller.availableActions(), {...options(), ...overrides});
  const press = async (...keys: WorkspaceKey[]) => { for (const key of keys) { controller.handleKey(key); await settle(); } };
  return {calls, source, controller, render, press, advance: (ms: number) => { now += ms; }, view};
}

function deepStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) deepStrings(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) deepStrings(item, out);
  return out;
}

// --- Query semantics ------------------------------------------------------------------------

test('GitHub queries pass through verbatim and are scoped only when the view requires it', () => {
  const pr = prepareQuery('  is:pr is:open author:@me  ', 'pr');
  assert.ok(pr.ok);
  assert.equal(pr.query.original, 'is:pr is:open author:@me');
  assert.equal(pr.query.effective, 'is:pr is:open author:@me');
  const scoped = prepareQuery('review-requested:@me', 'pr');
  assert.ok(scoped.ok);
  assert.equal(scoped.query.effective, 'review-requested:@me is:pr');
  assert.match(scoped.query.notices[0].message, /added is:pr/u);
  const issue = prepareQuery('is:issue is:open label:bug', 'issue');
  assert.ok(issue.ok && issue.query.effective === 'is:issue is:open label:bug');
  const all = prepareQuery('repo:raiseCatError/notMyShell is:pr is:open', 'all');
  assert.ok(all.ok && all.query.effective === 'repo:raiseCatError/notMyShell is:pr is:open');
  const negated = prepareQuery('-is:pr label:bug', 'issue');
  assert.ok(negated.ok && negated.query.effective === '-is:pr label:bug is:issue');
});

test('query validation reports conflicts, unknown qualifiers and limits honestly', () => {
  assert.equal(prepareQuery('is:issue label:bug', 'pr').ok, false);
  assert.equal(prepareQuery('is:pr', 'issue').ok, false);
  assert.equal(prepareQuery('', 'pr').ok, false);
  assert.equal(prepareQuery('"unbalanced', 'all').ok, false);
  assert.equal(prepareQuery('a\u001b[31m', 'all').ok, false);
  assert.equal(prepareQuery('x'.repeat(LIMITS.queryLength + 1), 'all').ok, false);
  assert.equal(prepareQuery('a OR b OR c OR d OR e OR f OR g', 'all').ok, false);
  const unknown = prepareQuery('is:pr frobnicate:yes', 'pr');
  assert.ok(unknown.ok);
  assert.ok(unknown.query.notices.some(n => n.level === 'warning' && n.message.includes('frobnicate')));
  assert.ok(prepareQuery('is:pr "title with spaces" label:"good first issue"', 'pr').ok);
});

test('search history is bounded, de-duplicated and most recent first', () => {
  let history: string[] = [];
  for (let i = 0; i < LIMITS.searchHistory + 10; i++) history = rememberQuery(history, `q${i}`);
  history = rememberQuery(history, 'q20');
  assert.equal(history.length, LIMITS.searchHistory);
  assert.equal(history[0], 'q20');
  assert.equal(history.filter(h => h === 'q20').length, 1);
});

// --- Identity, pagination, ordering ------------------------------------------------------------

test('item identity is kind- and repository-qualified and case-insensitive for names', () => {
  assert.equal(itemKey({kind: 'pr', owner: 'Foo', repo: 'Bar', number: 1}), itemKey({kind: 'pr', owner: 'foo', repo: 'bar', number: 1}));
  assert.notEqual(itemKey({kind: 'pr', owner: 'foo', repo: 'bar', number: 1}), itemKey({kind: 'issue', owner: 'foo', repo: 'bar', number: 1}));
  assert.notEqual(itemKey({kind: 'pr', owner: 'foo', repo: 'bar', number: 1}), itemKey({kind: 'pr', owner: 'foo', repo: 'baz', number: 1}));
  assert.deepEqual(parseRepository('raiseCatError/notMyShell'), {owner: 'raiseCatError', repo: 'notMyShell'});
  for (const bad of ['a/b/c', '-flag/x', 'a/..', 'a b/c', 'a/b;rm', '']) assert.equal(parseRepository(bad), undefined, bad);
});

test('pagination appends in GitHub order without duplicates and stops at the reported end', async () => {
  const {controller, calls} = setup({pageSize: 5});
  await controller.submitQuery('search');
  const list = controller.snapshot.lists.search;
  assert.equal(list.items.length, 5);
  assert.ok(list.hasNextPage);
  const total = list.total!;
  const firstPage = list.items.map(i => itemKey(i.ref));
  for (let i = 0; i < 20; i++) await controller.loadMore('search');
  const all = controller.snapshot.lists.search.items;
  assert.equal(controller.snapshot.lists.search.pages, LIMITS.maxPages, 'page count is bounded');
  assert.match(controller.snapshot.message ?? '', /Result bound reached/u);
  assert.deepEqual(all.slice(0, 5).map(i => itemKey(i.ref)), firstPage);
  assert.equal(new Set(all.map(i => itemKey(i.ref))).size, all.length);
  assert.equal(all.length, Math.min(total, LIMITS.maxResults, 5 * LIMITS.maxPages));
  const sorted = [...all].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  assert.deepEqual(all.map(i => i.updatedAt), sorted.map(i => i.updatedAt));
  // Listing never fetches details.
  assert.ok(calls.every(call => call === 'search'));
});

test('selection identity survives a refresh that reorders results', async () => {
  let order = [1, 2, 3];
  const page = (): SearchPage => ({hasNextPage: false, total: order.length, items: order.map(n => ({
    ref: {kind: 'pr' as const, owner: 'o', repo: 'r', number: n}, title: `PR ${n}`, state: 'open' as const, draft: false,
    reviewDecision: 'none' as const, mergeable: 'unknown' as const, checks: 'unknown' as const}))});
  const source: GithubSource = {search: async () => page(), pullRequest: async () => { throw new Error('unused'); },
    pullRequestPatches: async () => { throw new Error('unused'); }, issue: async () => { throw new Error('unused'); }};
  const controller = new GithubWorkspaceController(new GithubWorkspaceService(source), {initialQueries: {prs: 'is:open'}});
  await controller.submitQuery('prs');
  controller.handleKey('down');
  assert.equal(controller.selectedItem()?.ref.number, 2);
  order = [3, 1, 2];
  await controller.submitQuery('prs');
  assert.equal(controller.selectedItem()?.ref.number, 2);
  assert.equal(controller.snapshot.lists.prs.selectionLost, false);
  order = [3, 1];
  await controller.submitQuery('prs');
  assert.equal(controller.snapshot.lists.prs.selectionLost, true);
});

// --- Refresh, stale and error states ------------------------------------------------------------

test('a failed refresh keeps earlier results, labelled, and stale data is called stale', async () => {
  const {controller, source, render, advance} = setup();
  await controller.submitQuery('prs');
  const count = controller.snapshot.lists.prs.items.length;
  assert.ok(count > 0);
  source.scenario = 'offline';
  await controller.submitQuery('prs');
  assert.equal(controller.snapshot.lists.prs.items.length, count);
  assert.equal(controller.snapshot.lists.prs.error?.kind, 'network');
  assert.match(render().join('\n'), /Refresh failed; showing results from/u);
  source.scenario = 'ok';
  await controller.submitQuery('prs');
  assert.equal(controller.snapshot.lists.prs.error, undefined);
  advance(10 * 60_000);
  assert.match(render().join('\n'), /STALE: fetched 10m ago/u);
});

test('loading, empty, auth and rate-limit states render truthfully', async () => {
  for (const [scenario, pattern] of [['auth', /Not authenticated with GitHub.*gh auth login/u], ['rate_limit', /rate limit/iu],
    ['offline', /unreachable/u], ['empty', /No results for:/u], ['partial', /Partial results/u]] as const) {
    const {controller, render} = setup({scenario});
    await controller.submitQuery('prs');
    assert.match(render().join(' ').replace(/\s+/gu, ' '), pattern, scenario);
  }
  const {controller, render} = setup({delayMs: 50});
  const pending = controller.submitQuery('prs');
  assert.match(render().join('\n'), /Loading from GitHub/u);
  await pending;
});

// --- Transport: auth boundary, errors, argv safety -------------------------------------------------

function runnerReturning(result: Awaited<ReturnType<GhRunner>>, seen: string[][] = []): GhRunner {
  return async args => { seen.push([...args]); return result; };
}

test('transport classifies auth, rate limit, network and missing gh failures without leaking tokens', async () => {
  const cases: Array<[Awaited<ReturnType<GhRunner>>, string]> = [
    [{stdout: '', stderr: 'HTTP 401: Bad credentials (https://api.github.com/graphql)', code: 1}, 'auth'],
    [{stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login', code: 4}, 'auth'],
    [{stdout: '{"errors":[{"type":"RATE_LIMITED","message":"API rate limit exceeded"}]}', stderr: 'gh: API rate limit exceeded', code: 1}, 'rate_limit'],
    [{stdout: '', stderr: 'error connecting to api.github.com\ndial tcp: lookup api.github.com: no such host', code: 1}, 'network'],
    [{stdout: '', stderr: '', code: null, failure: 'missing'}, 'unavailable'],
    [{stdout: '', stderr: '', code: null, failure: 'timeout'}, 'timeout'],
    [{stdout: '', stderr: '', code: null, failure: 'too_large'}, 'too_large'],
  ];
  for (const [result, kind] of cases) {
    const transport = new GhCliTransport(runnerReturning(result));
    await assert.rejects(transport.graphql('query { viewer { login } }', {}), (error: GithubError) => error.kind === kind, kind);
  }
  const leaky = redactMessage('HTTP 401 token ghp_abcdefghijklmnopqrstuvwxyz0123 github_pat_11ABCDEFG0123456789 Authorization: bearer xyz');
  assert.doesNotMatch(leaky, /ghp_|github_pat_|bearer xyz/u);
  assert.equal(classifyFailure('HTTP 404: Not Found'), 'not_found');
});

test('transport uses argv fields, never a shell, and refuses mutations and non-GET paths', async () => {
  const seen: string[][] = [];
  const transport = new GhCliTransport(runnerReturning({stdout: '{"data":{"search":{"nodes":[]}}}', stderr: '', code: 0}, seen));
  const hostile = 'is:pr "; rm -rf ~; echo $(whoami) `id` @/etc/passwd';
  await transport.graphql('query($q: String!) { search(query: $q) { issueCount } }', {q: hostile, first: 5});
  const args = seen[0];
  assert.deepEqual(args.slice(0, 2), ['api', 'graphql']);
  assert.ok(args.includes(`q=${hostile}`), 'query is a single raw-field argv element');
  assert.equal(args[args.indexOf(`q=${hostile}`) - 1], '-f', 'strings use -f (never @file expansion)');
  assert.equal(args[args.indexOf('first=5') - 1], '-F');
  await assert.rejects(transport.graphql('mutation { mergePullRequest(input: {}) { clientMutationId } }', {}));
  await assert.rejects(transport.graphql('query { a } mutation { b }', {}));
  await assert.rejects(transport.graphql('query { a }', {'bad-name': 'x'}));
  await assert.rejects(transport.restGet('repos/o/r/pulls/1/merge?x=1&method=PUT;'));
  await assert.rejects(transport.restGet('repos/o/../../user'));
  await transport.restGet('repos/o/r/pulls/1/files?per_page=100&page=1').catch(() => undefined);
  assert.deepEqual(seen.at(-1)?.slice(0, 3), ['api', '--method', 'GET']);
  const env = ghEnvironment({GH_DEBUG: 'api', DEBUG: '1', HOME: '/h'});
  assert.equal(env.GH_DEBUG, undefined);
  assert.equal(env.GH_PROMPT_DISABLED, '1');
  assert.equal(env.HOME, '/h');
});

test('partial GraphQL errors keep data and surface warnings', async () => {
  const data = {data: {rateLimit: {remaining: 1}, search: {issueCount: 0, pageInfo: {hasNextPage: false}, nodes: []}},
    errors: [{type: 'FORBIDDEN', message: 'Resource not accessible by integration'}]};
  const source = new GhSource(new GhCliTransport(runnerReturning({stdout: JSON.stringify(data), stderr: 'GraphQL: Resource not accessible', code: 1})));
  const page = await source.search('is:pr');
  assert.deepEqual(page.warnings, ['FORBIDDEN: Resource not accessible by integration']);
  await assert.rejects(new GhSource(new GhCliTransport(runnerReturning({stdout: '', stderr: '', code: 0}))).pullRequest({kind: 'pr', owner: '-x', repo: 'r', number: 1}),
    (error: GithubError) => error.kind === 'invalid_query');
});

// --- Hostile content -------------------------------------------------------------------------------

test('hostile titles, bodies, comments, branches and checks are sanitized at the model boundary', async () => {
  const source = new FixtureSource();
  const detail = await source.pullRequest({kind: 'pr', owner: 'raiseCatError', repo: 'notMyShell', number: 666});
  for (const value of deepStrings(detail)) assert.doesNotMatch(value, CONTROL, JSON.stringify(value).slice(0, 80));
  assert.ok(detail.bodyTruncated);
  assert.ok(detail.body.length <= LIMITS.bodyLength);
  assert.equal(detail.summary.title, 'Fix title red link eman');
  assert.equal(detail.checks.find(c => c.name === 'ci/legacy')?.url, undefined, 'javascript: URLs are dropped');
  const issue = await source.issue({kind: 'issue', owner: 'raiseCatError', repo: 'notMyShell', number: 667});
  for (const value of deepStrings(issue)) assert.doesNotMatch(value, CONTROL);
  assert.equal(sanitizeLine(HOSTILE_TITLE, 300), 'Fix title red link eman');
  assert.equal(sanitizeBlock('a\u001b]52;c;eA==\u0007b\n\tc', 100).text, 'ab\n  c');
});

test('rendered chrome contains no remote control sequences; NO_COLOR output has no escapes at all', async () => {
  const {controller, render, press} = setup();
  await controller.submitQuery('prs');
  await press('enter');
  for (const tab of ['overview', 'diff', 'checks', 'comments', 'commits', 'files']) {
    assert.equal(controller.snapshot.detail?.tab, tab);
    const plain = render({color: 'none'}).join('\n');
    assert.doesNotMatch(plain, /[\u001b\u0007\u009b\u009d]/u, tab);
    const colored = render({color: 'truecolor'}).join('\n');
    // Only NMSh's own SGR sequences survive in color mode.
    assert.doesNotMatch(colored.replace(/\u001b\[[0-9;]*m/gu, ''), /[\u001b\u0007\u009b\u009d]/u, tab);
    await press('tab');
  }
});

// --- Layout -----------------------------------------------------------------------------------------

test('every screen fits measured display cells at 30-200 columns in Safe and Nerd glyphs', async () => {
  const {controller, render, press} = setup();
  await controller.submitQuery('prs');
  const screens: Array<() => Promise<void>> = [
    async () => undefined,
    async () => press('enter'),
    ...Array.from({length: 5}, () => async () => press('tab')),
    async () => press('escape', 'tab'),
    async () => press('enter', 'tab', 'tab'),
    async () => press('escape', 'escape', 'tab', 'down', 'down', 'down', 'enter'),
    async () => press('escape', 'shiftTab', 'shiftTab', 'enter', {char: 'm'}),
    async () => press('escape', 'escape', {char: '/'}),
  ];
  for (const step of screens) {
    await step();
    for (const columns of WIDTHS) for (const glyphs of ['safe', 'nerd'] as const) for (const rows of [8, 24]) {
      const lines = render({columns, rows, glyphs});
      assert.equal(lines.length, rows, `rows ${columns}x${rows}`);
      for (const line of lines) assert.ok(displayWidth(line) <= columns, `${columns} ${glyphs}: ${JSON.stringify(line)} is ${displayWidth(line)}`);
    }
  }
  // Wide CJK/emoji title in a 30-column list.
  const wide = setup();
  await wide.controller.submitQuery('prs', 'repo:raiseCatError/notMyShell is:closed 幅の広い文字');
  const lines = wide.render({columns: 30});
  assert.ok(lines.some(line => line.includes('#350')));
  for (const line of lines) assert.ok(displayWidth(line) <= 30);
});

test('focus, selection and active tab are visible without color; Safe mode uses ASCII chrome', async () => {
  const {controller, render, press} = setup();
  await controller.submitQuery('prs');
  let screen = render({glyphs: 'safe', color: 'none'});
  assert.match(screen[0], /\[focus: list\]/u);
  assert.match(screen[1], /\[PRs\]/u);
  assert.equal(screen.filter(line => line.startsWith('> #')).length, 1);
  assert.ok(!screen.join('').includes('›'));
  await press('enter');
  screen = render({glyphs: 'safe', color: 'none'});
  assert.match(screen[0], /\[focus: detail\]/u);
  assert.match(screen[2], /\[Overview\]/u);
  await press({char: 'm'});
  assert.match(render()[0], /\[focus: merge preview\]/u);
  screen = render({glyphs: 'nerd', color: 'none'});
  assert.ok(screen.join('').includes('›'));
});

// --- Diff ---------------------------------------------------------------------------------------------

test('diff model reports binary, rename-only, abbreviated, truncated and skipped patches honestly', async () => {
  const source = new FixtureSource();
  const ref = {kind: 'pr' as const, owner: 'raiseCatError', repo: 'notMyShell', number: 329};
  const fetched = await source.pullRequestPatches(ref, 7);
  const model = buildDiffModel({repository: 'raiseCatError/notMyShell', number: 329, baseRef: 'master', headRef: 'x', headSha: 'a'.repeat(40)}, fetched);
  const byPath = Object.fromEntries(model.files.map(file => [file.path, file]));
  assert.equal(byPath['docs/assets/logo.png'].availability, 'omitted');
  assert.match(byPath['docs/assets/logo.png'].note!, /binary or too large/u);
  assert.equal(byPath['src/ui/shelf.ts'].previousPath, 'src/ui/oldShelf.ts');
  assert.match(byPath['src/ui/shelf.ts'].note!, /Renamed without content changes/u);
  assert.equal(byPath['src/ui/header.ts'].availability, 'complete');
  assert.equal(byPath['src/abbrev.ts'].availability, 'incomplete');
  assert.equal(byPath['src/generated/huge.ts'].availability, 'truncated');
  assert.ok(byPath['src/generated/huge.ts'].hunks.flatMap(h => h.lines).length < LIMITS.patchLinesPerFile);
  assert.equal(model.filesTruncated, false);
  const launcher = byPath['src/agents/launcher.ts'];
  assert.deepEqual(launcher.hunks[0].lines.filter(l => l.kind === 'add').map(l => l.newLine), [11, 12, 13, 14]);
  assert.ok(launcher.hunks[0].lines.some(l => l.kind === 'note' && /No newline/u.test(l.text)));
  assert.ok(launcher.hunks[0].lines.some(l => l.text.includes('    indented()')), 'tabs expanded');
  for (const value of deepStrings(byPath['evil.txt'])) assert.doesNotMatch(value, CONTROL);
  assert.match(compactSummary(model)[0], /^7 files changed, \+2457 -14$/u);

  const partial = buildDiffModel({repository: 'o/r', number: 1}, {...fetched, truncated: true, reportedFileCount: 400});
  assert.ok(partial.filesTruncated);
  assert.match(compactSummary(partial)[0], /400 files changed.*\(7 loaded\)/u);

  // A total line budget smaller than the files: later files are explicitly skipped, never silently empty.
  const many = {files: Array.from({length: 30}, (_, i) => ({filename: `f${i}`, status: 'added' as const, additions: 1000, deletions: 0,
    patch: `@@ -0,0 +1,1000 @@\n${Array.from({length: 1000}, () => '+x').join('\n')}`})), truncated: false};
  const budget = buildDiffModel({repository: 'o/r', number: 1}, many);
  assert.ok(budget.files.some(file => file.availability === 'skipped'));
  assert.ok(budget.files.reduce((sum, file) => sum + file.hunks.reduce((n, h) => n + h.lines.length + 1, 0), 0) <= LIMITS.patchLinesTotal);
});

test('the diff tab loads patches lazily, once per head SHA, and labels an incomplete file list', async () => {
  const {controller, calls, render, press} = setup();
  await controller.submitQuery('prs');
  await press('enter');
  assert.ok(!calls.some(call => call.startsWith('patches')), 'no patches before the Diff tab');
  await press('tab');
  assert.equal(calls.filter(call => call.startsWith('patches')).length, 1);
  assert.match(render().join('\n'), /Remote GitHub PR diff . raiseCatError\/notMyShell#666/u);
  assert.match(render().join('\n'), /Only 7 of 400 files loaded; the diff is NOT complete/u);
  await press({char: 'n'});
  assert.equal(controller.snapshot.detail?.fileIndex, 1);
  assert.match(render().join('\n'), /File 2\/7: docs\/assets\/logo.png/u);
  await press({char: 'p'}, {char: 'd'});
  assert.equal(controller.snapshot.detail?.diff.depth, 'compact');
  await press('tab', 'shiftTab');
  assert.equal(calls.filter(call => call.startsWith('patches')).length, 1, 'cached by head SHA');
});

// --- Checks, mergeability, merge plan --------------------------------------------------------------------

test('checks show individual status and conclusion, not a fabricated overall result', async () => {
  const {controller, render, press} = setup();
  await controller.submitQuery('prs');
  await press('down', 'enter', 'tab', 'tab');
  const screen = render().join('\n');
  assert.match(screen, /checks pending: 2 passed, 0 failed, 3 pending, 1 neutral\/skipped of 6/u);
  assert.match(screen, /\+ build \(macOS\) {2}success \(required\)/u);
  assert.match(screen, /~ test \(node 22\) {2}in progress \(required\)/u);
  assert.match(screen, /- optional docs {2}skipped/u);
  assert.match(screen, /ci\/legacy {2}pending \(required: unknown\) \(status\)/u);
});

test('merge planning: unknown mergeability, unsupported methods, exact SHA and branch deletion', async () => {
  const source = new FixtureSource();
  const pr329 = await source.pullRequest({kind: 'pr', owner: 'raiseCatError', repo: 'notMyShell', number: 329});
  const plan = planMerge(pr329, {method: 'rebase', deleteBranch: true}, FIXTURE_NOW);
  assert.equal(plan.executable, false);
  assert.equal(plan.headSha, pr329.headSha);
  assert.match(plan.headSha!, /^[0-9a-f]{40}$/u);
  assert.equal(plan.methods.rebase, 'disabled_by_repository');
  assert.ok(plan.conditions.some(c => c.severity === 'blocker' && /Rebase and merge is disabled/u.test(c.message)));
  assert.ok(plan.conditions.some(c => c.severity === 'unknown' && /mergeability/u.test(c.message)));
  assert.ok(plan.conditions.some(c => c.severity === 'blocker' && /Required check not finished: test/u.test(c.message)));
  assert.ok(plan.warnings.some(w => /Destructive: deletes remote branch feature\/claude-agent-ui/u.test(w)));
  assert.equal(plan.deleteBranch.requested, true);

  const unknownPolicy = mapPrDetail({repository: {pullRequest: {number: 1, title: 't', state: 'OPEN', repository: {name: 'r', owner: {login: 'o'}}}}}, FIXTURE_NOW);
  const unknownPlan = planMerge(unknownPolicy, {method: 'squash', deleteBranch: false}, FIXTURE_NOW);
  assert.equal(unknownPlan.methods.squash, 'unknown');
  assert.equal(unknownPlan.mergeable, 'unknown');
  assert.ok(unknownPlan.conditions.some(c => /Head commit SHA unknown/u.test(c.message)));
  assert.ok(unknownPlan.conditions.some(c => /permission was not reported/u.test(c.message)));
  assert.ok(planMerge(pr329, {method: 'squash', deleteBranch: false}, FIXTURE_NOW + 3_600_000).conditions.some(c => /stale/u.test(c.message)));

  const fork = await source.pullRequest({kind: 'pr', owner: 'raiseCatError', repo: 'notMyShell', number: 315});
  const forkPlan = planMerge(fork, {method: 'merge', deleteBranch: true}, FIXTURE_NOW);
  assert.equal(forkPlan.deleteBranch.crossRepository, true);
  assert.ok(forkPlan.warnings.some(w => /lives in contributor\/notMyShell/u.test(w)));
});

test('remote writes are disabled: the gate refuses and the merge preview never calls GitHub', async () => {
  await assert.rejects(executeRemoteWrite({type: 'deleteBranch', repository: 'o/r', branch: 'b'}), RemoteWriteDisabledError);
  await assert.rejects(executeRemoteWrite({type: 'closeIssue', repository: 'o/r', number: 1}), RemoteWriteDisabledError);
  const {controller, calls, render, press} = setup();
  await controller.submitQuery('prs');
  await press('down', 'enter', {char: 'm'});
  const before = calls.length;
  await press('enter', 'tab', {char: 'b'}, 'enter');
  assert.equal(calls.length, before);
  assert.match(controller.snapshot.message ?? '', /not implemented in this phase/u);
  const screen = render({rows: 80}).join('\n');
  assert.match(screen, /planning only: merging is disabled/u);
  assert.match(screen, /Head SHA: [0-9a-f]{40}/u);
  assert.ok(!controller.availableActions().some(a => /merge$/iu.test(a.label) && a.key === 'Enter'));
  // The transport itself has no method that can mutate.
  assert.deepEqual(Object.getOwnPropertyNames(GhCliTransport.prototype).sort(), ['constructor', 'graphql', 'restGet']);
});

// --- Keyboard and intents ------------------------------------------------------------------------------

test('typing a query never searches per keystroke; Enter submits once; Esc restores', async () => {
  const {controller, calls, press} = setup();
  await controller.submitQuery('prs');
  const start = calls.length;
  await press({char: '/'});
  assert.equal(controller.snapshot.focus, 'query');
  for (const char of ' label:bug') await press({char});
  await press('backspace');
  assert.equal(calls.length, start);
  assert.equal(controller.snapshot.lists.prs.draft, 'repo:raiseCatError/notMyShell is:open label:bu');
  await press('escape');
  assert.equal(controller.snapshot.focus, 'list');
  assert.equal(controller.snapshot.lists.prs.draft, 'repo:raiseCatError/notMyShell is:open');
  await press({char: '/'}, {char: ' '}, {char: 'x'}, 'enter');
  assert.equal(calls.length, start + 1);
  assert.equal(controller.snapshot.lists.prs.query?.original, 'repo:raiseCatError/notMyShell is:open x');
  await press({char: '/'}, 'up');
  assert.equal(controller.snapshot.lists.prs.draft, 'repo:raiseCatError/notMyShell is:open x');
});

test('keyboard navigation: tabs, detail sections, scrolling, Esc back and contextual help', async () => {
  const {controller, press, calls} = setup();
  await controller.submitQuery('prs');
  await press('tab');
  assert.equal(controller.snapshot.tab, 'issues');
  assert.equal(controller.snapshot.lists.issues.status, 'loaded');
  await press('shiftTab');
  assert.equal(controller.snapshot.tab, 'prs');
  assert.ok(!calls.some(call => call.startsWith('pr:')), 'selection alone never fetches detail');
  await press('down', 'down');
  assert.equal(controller.snapshot.lists.prs.selectedIndex, 2);
  await press('enter');
  assert.equal(controller.snapshot.focus, 'detail');
  assert.equal(calls.filter(call => call.startsWith('pr:')).length, 1);
  await press('shiftTab');
  assert.equal(controller.snapshot.detail?.tab, 'files');
  assert.ok(controller.availableActions().some(a => a.key === 'Enter' && a.label === 'diff'));
  await press('down', 'enter');
  assert.equal(controller.snapshot.detail?.tab, 'diff');
  assert.equal(controller.snapshot.detail?.fileIndex, 1);
  await press('tab', 'tab', 'pageDown', 'pageDown', 'pageDown');
  assert.equal(controller.snapshot.detail?.tab, 'comments');
  const scrolled = controller.snapshot.detail!.scroll;
  for (let i = 0; i < 50; i++) controller.handleKey('down');
  assert.equal(controller.snapshot.detail!.scroll, scrolled, 'scroll clamps at the end');
  await press('pageUp');
  assert.ok(controller.snapshot.detail!.scroll < scrolled || scrolled === 0);
  await press('escape');
  assert.equal(controller.snapshot.focus, 'list');
  assert.equal(controller.snapshot.detail, undefined);
  assert.equal(controller.selectedItem()?.ref.number, 342);
  // Reopening uses the bounded cache rather than refetching.
  await press('enter');
  assert.equal(calls.filter(call => call.startsWith('pr:')).length, 1);
  await press({char: 'r'});
  assert.equal(calls.filter(call => call.startsWith('pr:')).length, 2);
  assert.deepEqual(controller.availableActions().map(a => a.key).slice(0, 2), ['Esc', 'Tab']);
});

test('issues show reported relationships only, and intents are typed and never executed', async () => {
  const {controller, render, press} = setup();
  await controller.submitQuery('issues');
  await press('tab');
  const index = controller.snapshot.lists.issues.items.findIndex(item => item.ref.number === 338);
  for (let i = 0; i < index; i++) controller.handleKey('down');
  await press('enter');
  assert.match(render().join('\n'), /Labels: enhancement, workspace/u);
  await press('tab', 'tab');
  const related = render().join('\n');
  assert.match(related, /Closing PR {2}raiseCatError\/notMyShell#343/u);
  assert.match(related, /Cross-reference {2}raiseCatError\/notMyShell#330/u);
  await press('escape', 'down');
  await press('enter', 'tab', 'tab');
  assert.match(render().join('\n'), /GitHub reports no closing pull requests or cross-references/u);
  assert.equal(controller.handleKey({char: 'w'}), undefined, 'no worktree intent for issues');
  const open = controller.handleKey({char: 'o'});
  assert.equal(open?.type, 'OpenExternal');

  await press('escape', 'shiftTab');
  await press('enter');
  const worktree = controller.handleKey({char: 'w'});
  assert.equal(worktree?.type, 'OpenRelatedWorktree');
  assert.equal(worktree?.type === 'OpenRelatedWorktree' && worktree.worktreeState, 'unknown');
  assert.equal(controller.handleKey('escape'), undefined);
  assert.equal(controller.handleKey({char: 'q'})?.type, 'Exit');
});

// --- Bounds and purity -------------------------------------------------------------------------------------

test('cache and concurrency are bounded', async () => {
  const cache = new BoundedCache<number>(3);
  for (let i = 0; i < 10; i++) cache.set(String(i), i);
  assert.equal(cache.size, 3);
  assert.equal(cache.get('0'), undefined);
  assert.equal(cache.get('9'), 9);
  const limit = new ConcurrencyLimit(2);
  let peak = 0;
  await Promise.all(Array.from({length: 8}, () => limit.run(async () => {
    peak = Math.max(peak, limit.inFlight);
    await new Promise(resolve => setTimeout(resolve, 2));
  })));
  assert.equal(peak, 2);
  // Concurrent requests for the same detail are de-duplicated.
  const calls: string[] = [];
  const service = new GithubWorkspaceService(new FixtureSource({onCall: op => calls.push(op), delayMs: 5}));
  const ref = {kind: 'pr' as const, owner: 'raiseCatError', repo: 'notMyShell', number: 329};
  await Promise.all([service.pullRequest(ref), service.pullRequest(ref), service.pullRequest(ref)]);
  assert.equal(calls.length, 1);
});

test('rendering performs no network or subprocess work', async () => {
  const {controller, calls, render, press} = setup();
  await controller.submitQuery('prs');
  await press('enter', 'tab');
  const before = calls.length;
  for (let i = 0; i < 50; i++) for (const columns of WIDTHS) render({columns});
  assert.equal(calls.length, before);
  for (const file of ['render.ts', 'diff.ts', 'mergePlan.ts', 'controller.ts', 'query.ts', 'model.ts', 'sanitize.ts']) {
    const text = readFileSync(new URL(`../src/githubWorkspace/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /from 'node:(child_process|net|http|https|fs|dgram|tls)'/u, file);
    assert.doesNotMatch(text, /\b(fetch|execFile|spawn)\(/u, file);
  }
});
