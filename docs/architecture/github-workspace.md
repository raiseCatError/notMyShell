# GitHub workspace core (#338, phase 1)

Status: **read-only core, controller, renderer and a development-only preview.**
Not wired into NMSh. There is no `/prs`, `/issues` or `/github` command yet, and
no remote mutation of any kind. Physical terminal QA is **still pending**.

Boundary: GitHub owns remote PR and issue truth. Git owns local checkouts (see #337).
NMSh owns presentation, navigation and safe interaction. This is a terminal control
surface, not an IDE or a GitHub replacement.

## Try it

From the isolated worktree:

```sh
cd /private/tmp/notMyShell-github-workspace
npx tsx scripts/dev/github-workspace-preview.ts
```

| Mode | Command |
| --- | --- |
| Fixtures (offline, default) | `npx tsx scripts/dev/github-workspace-preview.ts` |
| Fixture error scenario | `… --scenario=auth` (`ok empty auth rate_limit offline slow partial flaky`) |
| Live, read-only | `… --live --repo=raiseCatError/notMyShell` (uses your authenticated `gh`) |
| Printed frames (no TTY) | `… --static --width=40 --height=20 --keys=down,enter,tab,m` |
| Safe glyphs / no color | `… --safe`, `… --no-color` (`NO_COLOR=1` is honored) |

Keys that only exist in the preview:

| Key | Action |
| --- | --- |
| Ctrl-E | Next fixture scenario |
| Ctrl-G | Switch between Safe and Nerd glyphs |
| Ctrl-K | Color on/off |
| Ctrl-W | Cycle the simulated width: 30/40/50/80/120/200/terminal |
| Ctrl-C or Q | Quit; the terminal is restored |

The preview uses the alternate screen and restores the terminal on exit, on a signal
and on an uncaught error. It is not imported by `src/` and does not change NMSh startup.

## Modules (`src/githubWorkspace/`)

| File | Role |
| --- | --- |
| `model.ts` | Typed facts and `LIMITS`. Fields GitHub did not report stay `undefined` or `'unknown'`. |
| `sanitize.ts` | Untrusted text goes through here: control and escape sequences and bidi overrides are stripped, and length is bounded. Also holds the owner/repo allowlist and `https://github.com`-only URLs. |
| `query.ts` | GitHub search query passthrough, view scoping, honest notices, bounded history. |
| `transport.ts` | Read-only `gh api` transport: argv only, bounded by time and bytes, credential-free errors. |
| `queries.ts` | Bounded GraphQL documents that request `totalCount`, so truncation is reported. |
| `source.ts` | `GithubSource` interface, GraphQL/REST to model mapping, `GhSource`. |
| `service.ts` | Bounded LRU caches, request de-duplication, 2-request concurrency limit. Patches are keyed by head SHA. |
| `diff.ts` | Bounded read-only diff model, compact summary, external-review intent. |
| `mergePlan.ts` | Merge plan contract, the always-refusing `executeRemoteWrite`, and the `OpenRelatedWorktree` intent. |
| `controller.ts` | Keyboard-first state machine with one focus owner. Fetches only on explicit actions. |
| `render.ts` | Pure renderer: state to exactly `rows` lines of at most `columns` cells. No I/O. |
| `fixtures.ts` | Deterministic raw GitHub-shaped data, including hostile entries. It runs through the real mappers. |

## Data sources (factual)

| Data | Source |
| --- | --- |
| List and search | GraphQL `search(type: ISSUE)`, 25 results per page, cursor pagination, `issueCount`, `rateLimit`. Summary fields only: state, draft, head/base, review decision, `mergeable`, head commit `statusCheckRollup`, additions/deletions/files. |
| PR detail | GraphQL `repository.pullRequest`, fetched lazily when you press Enter on an item. It includes `headRefOid`, `mergeStateStatus`, individual CheckRuns and StatusContexts (with `isRequired`), the last 100 commits, issue comments, reviews and inline review comments (kept distinct), the first 100 files, and repository merge policy (`mergeCommitAllowed`, `squashMergeAllowed`, `rebaseMergeAllowed`, `deleteBranchOnMerge`, `viewerPermission`). |
| Patches | REST `GET repos/{o}/{r}/pulls/{n}/files`, fetched lazily the first time the Diff tab opens. Up to 3 pages of 100, cached per head SHA. |
| Issue detail | GraphQL `repository.issue`: labels, assignees, comments. Related links come only from `closedByPullRequestsReferences` and `CROSS_REFERENCED_EVENT`. Nothing is inferred from titles or branch names. |

Partial GraphQL errors keep the data that did arrive and show it labelled "Partial
results" or "Partial data". Collections GitHub reports as larger than what NMSh holds
are labelled "Showing N of M".

## Authentication boundary

- Authentication belongs to `gh` (keyring or config). NMSh never reads, prints, stores
  or passes a token, and never puts credentials in argv.
- `execFile('gh', argv)` runs without a shell. The query, owner, repo and number are
  GraphQL variables: strings go through `-f` (a raw field, never expanded as `@file`),
  and validated integers go through `-F`. The working directory is `$HOME`, so the
  repository you are in has no effect.
- Each call has a 20 s timeout and an 8 MiB output limit. The environment sets
  `GH_PROMPT_DISABLED`, `NO_COLOR` and `GH_PAGER=cat`, and removes `GH_DEBUG` and `DEBUG`.
- Error text has token-shaped strings redacted and is sanitized. Failures are
  classified as `auth`, `rate_limit`, `network`, `not_found`, `invalid_query`,
  `timeout`, `too_large`, `unavailable` (gh missing) or `unknown`. All are recoverable
  with R. Results already on screen stay visible and are labelled with their age.
- Network access only happens on explicit actions: submitting a query, Tab to a view
  that has never loaded, N for more results, Enter on an item, opening the Diff tab, or R.

## Read-only policy

`GhCliTransport` has exactly two methods: `graphql` and `restGet`. `graphql` rejects
any document that is not a single `query`. `restGet` always sends `--method GET` and
accepts only `repos/<owner>/<repo>/…` paths built from validated parts.
`executeRemoteWrite` (merge, deleteBranch, submitReview, closeIssue) always throws
`RemoteWriteDisabledError`. Tests assert all of this. No background agent may merge.

## Query semantics

The text you type is kept as the **original** query. The **effective** query is
exactly what GitHub receives, and it is displayed. GitHub's search remains the
authority on what a query means.

- **PRs view:** adds `is:pr` when the query does not specify a type. A query that
  asks only for issues is refused with an explanation.
- **Issues view:** the same, with `is:issue`.
- **Search view:** the query is passed through unchanged and can return both PRs and issues.
- Local checks reject: empty queries, more than 256 characters, control characters,
  an unbalanced `"`, and more than 5 AND/OR/NOT operators (a GitHub limit).
- An undocumented `qualifier:` produces a warning that GitHub may treat it as text.
  It is never silently dropped.
- Queries run only when submitted with Enter, never per keystroke. Search history
  keeps at most 20 entries.
- Results are capped at 8 pages and 200 items. GitHub search itself navigates at most 1000.
- Selection identity is `kind:owner/repo#number`. A refresh keeps the selected item
  when it is still present, and says so when it is gone.

## Keyboard UX

Exactly one region owns the keyboard: `list`, `query`, `detail` or `merge`. The
header names it (`[focus: …]`). The active tab is shown in brackets, and the selected
row has a marker (`>` or `›`) and is also shown inverse when color is on. None of this
depends on color.

| Context | Keys |
| --- | --- |
| List | Up/Down (j/k) to select, PgUp/PgDn, Home/End, Enter to inspect, `/` to search, Tab/Shift-Tab to switch PRs/Issues/Search, R to refresh, N for more, O to open on GitHub (intent), Q/Esc to quit |
| Query | Type, Backspace, Enter to submit, Esc to cancel, Up/Down for history |
| Detail | Tab/Shift-Tab between sections, Up/Down/PgUp/PgDn to scroll, N/P for next/previous file, Enter on Files to open its diff, D for compact/review depth, R to refresh, M for merge preview, W for worktree intent, O to open, Esc to go back |
| Merge preview | Tab for method, B to toggle branch deletion, Up/Down to scroll, R to refresh and replan, Esc to close. Enter only explains that merging is disabled. |

The footer shows only the actions available right now. At narrow widths it falls back
to keys only (`Esc back Tab ^v Pg R M W O`).

## Diff behavior and limitations

The diff has three depths:

- **Compact:** files changed, +/- totals and the largest files.
- **Review:** one file at a time, with hunks, old/new line numbers and context lines. N/P move between files.
- **External:** an `OpenExternalReview` intent pointing at the PR's `/files` URL on GitHub.

Every diff view is headed with its source: "Remote GitHub PR diff", the repository and
PR number, base ← head, and the head SHA. Each file is labelled with how complete its patch is:

| Label | Meaning |
| --- | --- |
| `complete` | Patch present, and its +/- counts match what GitHub reported. |
| `incomplete` | Patch shorter than GitHub's counts; GitHub abbreviated it. |
| `truncated` | NMSh's 1,500-lines-per-file bound cut the patch. |
| `omitted` | GitHub sent no patch (binary or too large). A rename without content changes is labelled as such. |
| `skipped` | NMSh's 20,000-line total budget was already used. |

When GitHub reports more files than were loaded (the 300-file bound), the diff says
it is NOT complete. Patch lines are sanitized, tabs are expanded, and each line is
limited to 1,000 characters. Nothing in a patch is evaluated. In color mode, long
lines are truncated rather than wrapped. There is no syntax highlighting and no
side-by-side view; those are for #332.

## Unknown and stale states

- Mergeability: GitHub `UNKNOWN` displays as "unknown (GitHub has not computed it)".
- Merge state: "unknown (not reported)" when GitHub did not report it.
- Checks: the rollup, plus each individual check with its status and conclusion.
  Required is shown as `(required)`, `(required: unknown)`, or not shown when GitHub says it is not required.
- Review decision: a `null` decision is shown as "no review decision reported".
- Data older than 2 minutes is labelled STALE with its age. A failed refresh keeps
  the earlier data with an explicit "Refresh failed; showing … from Xm ago".

## Secure future merge transaction (not implemented)

`planMerge(detail, {method, deleteBranch})` builds the preview: repository, PR number,
**exact head SHA**, head → base, per-method support (`allowed`,
`disabled_by_repository` or `unknown`), mergeability, merge state, and conditions
(blockers, unknowns, warnings: draft, conflicts, blocked or behind, requested
changes, required checks that failed or are pending, permission, stale data,
truncated checks). It also carries a warning that this is a remote, shared action,
and a separate destructive warning when branch deletion is requested (noting a
cross-repository head when there is one). `executable` is always `false`.

A future integration must:

1. Re-fetch the PR from GitHub immediately before acting and rebuild the plan.
2. Show the plan and require explicit confirmation from a human.
3. Call the merge with `expectedHeadOid` (GraphQL) or `sha` (REST) set to the
   previewed head SHA, so a push in between makes the merge fail.
4. Delete the branch as a separate, separately confirmed step, and report partial
   success (merged, branch kept) truthfully.
5. Never bypass branch protection, and never infer readiness from local Git.

## Future integrations

- **#329 (input ownership):** feed `WorkspaceKey`s from the managed input-owner
  dispatcher. Map `FocusRegion` to the shared owners.
- **#336 (semantic actions):** `availableActions()` becomes the action list. Mouse
  actions call the same handlers.
- **#331 (sidebar):** reuse `SearchItem`, `itemKey` and `checksLabel` for quick links.
  Deep management stays here.
- **#332 (detail and diff panel):** consume `DiffModel` and `detailLines`. The right
  panel replaces the inline review depth.
- **#337 (worktrees):** handle the `OpenRelatedWorktree` intent (repository, PR number,
  head ref, head repository, head SHA). Worktree state stays `unknown` until #337
  provides a factual adapter. Nothing here imports `src/worktrees`.
- **Live routing:** `/prs`, `/issues` and `/github` construct `GhSource`,
  `GithubWorkspaceService` and `GithubWorkspaceController`, and render inside a panel.
  This happens only after #329 lands.

## Verification

Automated: `tests/githubWorkspace.test.ts` covers queries, identity, pagination,
refresh, stale and error states, transport safety, hostile content, layout at
widths from 30 to 200, Safe and NO_COLOR rendering, the diff, checks, merge
planning, disabled writes, the keyboard, intents, bounds, and render purity.

**Human physical QA in real terminals is pending.**
