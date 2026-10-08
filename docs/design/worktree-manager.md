# Worktree manager core (#337)

Status: core, controller and presentation model implemented and tested in
`src/worktrees/`. **Not wired into the live product**: `/worktrees`, key
dispatch, shell `cd`, session/tmux focus, the diff panel and PR evidence are
deferred (see the end of this document).

## Boundary

Git owns worktree metadata, checkouts, branches, locks and prunable state.
NMSh owns discovery, factual presentation, navigation *intent*, previews,
confirmation and typed invocation. There is no NMSh checkout database, no
hidden branch state, no daemon, no polling, no automatic cleanup and no
force removal.

## Modules

| File | Role |
| --- | --- |
| `git.ts` | The only Git runner: trusted binary, argv array, minimal env, time/output bounds, execution-path overrides. |
| `model.ts` | `WorktreeRecord`/`WorktreeSnapshot`, porcelain and status parsers, sanitized display helpers. |
| `discovery.ts` | One list call, bounded concurrent status enrichment, per-worktree failure isolation. |
| `mutations.ts` | `plan → confirm → revalidate → apply` for new worktrees and removal. |
| `controller.ts` | Selection by identity, explicit refresh with stale snapshot, local search, keys, action availability, typed intents. |
| `view.ts` | Pure renderer: no I/O, no environment reads; display-cell fitting, Safe/ASCII, NO_COLOR. |

## Where each field comes from

| Field | Source |
| --- | --- |
| `path`, `id` | `worktree` line of `git worktree list --porcelain -z` (raw; `-z` means no C-quoting). `id` is this path exactly as Git reports it. |
| `head` | `HEAD` line (accepted only as 40/64 hex). |
| `ref`, `branch` | `branch` line; `branch` only when `ref` is under `refs/heads/`. Never derived from the folder name. |
| `detached`, `bare` | `detached` / `bare` lines. |
| `locked`, `lockedReason` | `locked [reason]` line. |
| `prunable`, `prunableReason` | `prunable [reason]` line. |
| `main` | First entry (Git lists the main worktree first). |
| `pathState` | `lstat` of the path: `present` (a real directory), `missing`, `notDirectory` (includes symlinks), `unknown`. |
| `status` | `git status --porcelain=v2 -z --untracked-files=normal --ignore-submodules=all --no-renames` per worktree. `clean` only on a complete successful probe; otherwise `unknown` with a reason. Counts: staged (X≠`.`), unstaged (Y≠`.`), conflicted (`u`), untracked (`?`). Truncated output yields lower-bound counts (`N+`). |
| `commonDir` | `git rev-parse --path-format=absolute --git-common-dir`: repository identity. |
| `discoveredAt` | Wall clock at snapshot completion (freshness for future hosts). |

Unknown stays unknown: a failed or blocked status probe is never "clean", a
missing path is never probed, a bare entry has no status.

## Execution safety

Every Git invocation (`git.ts`):

- uses `trustedGit()` from `src/context/trustedServices.ts` (Homebrew Cellar
  Git or `/usr/bin/git`; never a PATH/workspace candidate), `spawn` with an
  argv array and `shell: false`;
- prefixes `-c core.fsmonitor=false -c core.hooksPath=/dev/null
  -c protocol.allow=never -c credential.helper=`. Command-line config outranks
  repository config and includes, and reaches Git's own child processes
  (e.g. the status check inside `worktree remove`) via `GIT_CONFIG_PARAMETERS`;
- runs with a minimal environment: `PATH=/usr/bin:/bin`, `HOME`, `LANG/LC_ALL=C`,
  `TMPDIR`, `GIT_TERMINAL_PROMPT=0`, `GIT_NO_LAZY_FETCH=1`, askpass/editor set
  to `/usr/bin/false`, and `GIT_OPTIONAL_LOCKS=0` for reads. No inherited
  `GIT_*` variables (`GIT_DIR`, `GIT_EXEC_PATH`, ...);
- uses only builtins, so aliases (which cannot shadow builtins) never apply;
- is bounded: default 5 s / 1 MiB stdout / 16 KiB stderr; the process is
  `SIGKILL`ed on timeout or when stdout reaches the bound.

Content filters (`filter.*.clean/smudge/process`) cannot be neutralized
generically and would run during status and checkout. Before status, new
worktree creation and removal, `git config --local --no-includes --name-only`
checks for `filter.*`, `include.*`, `includeIf.*`, `extensions.worktreeConfig`,
`extensions.partialClone`, `remote.*.promisor` and `core.worktree`. If any is
present the operation fails closed: status becomes `unknown (repository
configures filters or includes; status not run)`, and creation/removal are
refused. This mirrors the Context Engine's status policy.

Status runs as `git -C <worktree>`, which follows that worktree's own `.git`
pointer. So before each status probe (and the removal preview's ignored-file
probe), `worktreeStatusBlock` checks in that worktree that the common Git
directory is the repository being listed and that the config Git reads there
has none of the entries above. A worktree whose pointer leads elsewhere shows
`unknown (worktree points at a different repository; status not run)`.

The user's own global Git configuration is still read (it is the user's
trusted configuration, as for their own `git`), but the overrides above win.

Proof is by test, not inspection: `tests/worktreeDiscovery.test.ts` arms a
repository with executable hooks, `core.fsmonitor`, `core.hooksPath`,
`core.pager`, an alias and a content filter, shows discovery runs none of them,
and then shows ordinary `git status` *does* run the fsmonitor (the fixture is
live). `tests/worktreeMutations.test.ts` shows `worktree add` does not run
`post-checkout` and removal does not run fsmonitor.

## Hostile data

Paths, refs, lock/prunable reasons and Git error text are display data. They
pass through `displayText()` (the shared `stripTerminalControls`) before
reaching any message or rendered line: OSC/DCS/APC/PM/SOS/CSI, C0/C1 and bidi
controls are removed whole; ordinary Unicode is preserved. Actions never use
display text: identity is the raw path from Git, and argv receives that raw
path. Tests cover spaces, Unicode, leading dashes, embedded escape sequences,
C1 CSI, bidi overrides and 200-character names.

## Discovery bounds

- One `git worktree list` call regardless of count; at most `MAX_WORKTREES`
  (200) are enriched, with `truncated` reported.
- Status probes run with concurrency 4 (configurable), each 5 s / 256 KiB.
- One failed or slow probe marks only that worktree `unknown`.
- 100 linked worktrees: one list call, 101 status probes, peak concurrency
  within the bound (`tests/worktreeDiscovery.test.ts`).
- No polling; `refresh()` is explicit. A failed refresh keeps the previous
  snapshot and shows it as `stale: <reason>`; removal is unavailable while stale.

## Mutation lifecycle

`plan()` produces an exact plan (repository, destination, branch, whether a
branch is created, start point and the commit it resolved to, and the argv).
`apply(plan, {confirmed: true})` first **revalidates** by re-planning from
fresh Git state; any difference refuses with `requiresReview: true`.

### New worktree

- Destination must be absolute and must not exist; its parent must already
  exist (NMSh creates no directories; Git creates only the leaf). The parent is
  canonicalized so the plan names the path as Git will report it.
- Branch names: no leading `-` or `@`, no controls, then
  `git check-ref-format --branch` must echo the name unchanged.
- Existing branch: must exist and must not be checked out in another worktree.
- New branch: must not exist; the explicit start point is resolved with
  `rev-parse --verify --quiet --end-of-options <start>^{commit}` and Git is
  given the commit, not the text.
- Argv: `worktree add -- <dest> <branch>` or
  `worktree add --no-track -b <branch> -- <dest> <commit>`.

### Removal (never forced)

1. The selected row's identity is re-found in a **fresh** discovery.
2. Not offered for: main, bare, locked, prunable, missing/not-a-directory,
   the current shell's worktree, unknown status, tracked changes, untracked
   files. Each has a stated reason.
3. Evidence: common dir, path, ref, HEAD, directory `dev`/`ino`, the `.git`
   file contents, and the count of ignored entries Git will delete
   (`--ignored=traditional`), which the preview states.
4. Preview lists repository, path, checkout and "the branch itself is kept".
5. `apply` requires `{confirmed: true}`, then repeats steps 1–3 and compares:
   any change in repository, branch, HEAD, directory identity or ignored set,
   or new dirt, aborts with "review again".
6. Git is invoked as `worktree remove -- <path>` from the main repository.
   Because it is not forced, Git itself still refuses a dirty or locked
   worktree if something changes in the instant after revalidation.

There is no `rm -rf`, no manual `.git/worktrees` edit, no prune and no unlock.
Prunable and locked worktrees are displayed as Git reports them; their actions
are typed as unavailable with reasons.

## Controller and presentation

Keys (as a model, not wired): ↑/↓ select, Enter navigation intent, `n` new
(returns `requestNewWorktree` so the host can collect input, then `planNew`),
`x` removal preview only when available (otherwise a reason), `r` refresh,
`/` local search, Esc clears search, then cancels review, then `back`. In a
review, Enter confirms and Esc cancels.

Search matches loaded metadata only (checkout label, sanitized path, state
words); there is no Git I/O per keystroke and no fuzzy dependency.

Intents:

- `{kind: 'cd', path}` when the path is a present directory.
- `{kind: 'focusExistingResource', resourceId, path}` only when the host's
  `ResourceResolver` proves a resource for that path. The core ships no
  resolver.
- `DiffIntent {repository, worktreePath, ref, head}` for a future #332 caller.
- Related PR is always `unavailable: No pull request evidence yet` (#338).

Rendering: selection is a marker (`›`/`>`) plus weight, never color alone;
`level: 'none'` emits no escape bytes; Safe glyphs are pure ASCII (and use
`...`, never `~`, for truncation). Lines are fitted in display cells; paths keep
their leaf (`…/notMyShell-foo`); state words wrap to two lines; footer
controls wrap at control boundaries and only list available actions. Short
terminals window whole entries around the selection with an `a-b/N` indicator.

## Known limitations

- Repositories with local content filters or includes show `unknown` status
  and cannot create/remove worktrees here (fail closed).
- Submodule changes are ignored for status display; Git's own non-forced
  removal still refuses worktrees with initialized submodules.
- A tiny window remains between revalidation and Git's removal; Git's
  non-forced checks cover dirt and locks in that window.
- `id` is Git's path; a worktree moved with `git worktree move` is a new row.

## Deferred integration

- `/worktrees` command and TerminalApp key/panel wiring (after #329 lands; this
  PR does not touch `TerminalApp.ts`, `slashCommands.ts` or `src/input/**`).
- Shell `cd` (preserving the composer draft), NMSh session focus, tmux focus,
  and opening a new session — the host acts on intents.
- #331 sidebar quick navigation (can reuse `discoverWorktrees` and the model).
- #332 diff panel (consumes `DiffIntent`).
- #338 related PR evidence.
- #329 managed-target focus context.
- Physical terminal QA.
