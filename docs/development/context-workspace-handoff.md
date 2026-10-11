# Context, native modules and workspace: handoff for integration

Track: native modules and Context Engine capabilities (#305, #364), the workspace program (#330–#341) and background
tasks (#382). The workflow track (#359, Astra) owns `src/app/TerminalApp.ts` input routing, the workflow stack
(#348 → #357 → #358 → #360 → #361, #367, #368), module diagnostics (#365) and the final combined integration branch.
This document is the cross-track record; status lives in the PRs and in issue comments.

Last updated: 2026-10-11. **Draft PR ≠ merged, released or physically validated.** Verify heads before acting.

## Status of the shared-file boundary

The #359 stabilization checkpoint has **not** been published. None of the branches below modifies
`src/app/TerminalApp.ts`. Every feature that needs the frontend is delivered as standalone modules plus a written
integration contract (linked per row); the wiring is the remaining step, to be done on feature branches against the
frozen interface after the checkpoint, and reconciled on the acceptance branch.

## Feature heads

All branches are on `origin`. Worktrees are local (`/Users/jaisukka/Projects/nmsh-opus-*`) and are working copies
only; nothing depends on them.

| PR | Issue | Branch | Base | Head | What it is |
| --- | --- | --- | --- | --- | --- |
| #370 | #364 | `feature/native-runtimes` | `release/v0.18.0` | `417d105` | Ruby, PHP, .NET, Swift, Zig, Deno runtimes; parser hardening (Gemfile ReDoS), icons, recommendations |
| #372 | #364 | `feature/runtimes-elixir-dart` | #370 | `72775e6` | Elixir, Dart, Flutter runtimes |
| #373 | #364 | `feature/project-build-module` | #372 | `029fac4` | one `build` module: Bazel, Gradle, Maven, CMake, Meson, Make |
| #374 | #364 | `feature/vcs-hg-jj` | `release/v0.18.0` | `d7d3488` | Mercurial bookmark/branch, Jujutsu repository state |
| #369 | #336 | `feature/action-controls` | `release/v0.18.0` | `85ab930` | shared action-control renderer; narrow-width fixes |
| #375 | #330 | `feature/workspace-foundation` | `release/v0.18.0` | `1740f4e` | column plan, regional focus, semantic bindings, resource model |
| #376 | #331, #333 | `feature/workspace-sidebar` | #375 | `04764c9` | Workspace Sidebar, tmux discovery and navigation, worktree/manager sections |
| #377 | #332 | `feature/workspace-panel` | #375 | `fcad006` | detail panel: resource, worktree, diff, fact details |
| #378 | #335 | `feature/semantic-keymap` | #375 | `55bf55c` | validated keymap, composer-meaning conflicts, host notes |
| #379 | #341 | `feature/portable-mod-gate` | `release/v0.18.0` | `fccf68e` | executable Portable Mods stay disabled: threat model + regression gate |
| #380 | #339, #340 | `feature/codex-app-server-adapter` | `release/v0.18.0` | `8854bb7` | Codex app-server adapter (not wired); provider evidence; Remote Control go/no-go; approval-target security fix (Claude + Codex) |
| #381 | #337, #338 | `feature/worktree-pr-evidence` | `release/v0.18.0` | `8a40b76` | related PR evidence for `/worktrees`; PR summaries carry head repository and SHA |
| #383 | #382 | `feature/background-tasks-core` | `release/v0.18.0` | `4b9685d` | background task supervisor, detector, preferences, output |
| #384 | #382 | `feature/background-task-ui` | #383 | `85ac421` | task bar, keys, suggestion strip, manager, output views |

The #375–#378 and #383/#384 heads are from the 2026-10-11 quality and security pass (below); the CI result for each
is in its PR. Every other head above had a green CI run (Ubuntu and macOS shards, Node 22, Quality, Verify) on 2026-10-11. Reruns were
needed for jobs that failed in tests outside these branches' files: #372 (a cancelled job), #378 (a live
reattach/fullscreen test) and #383 (`typingAfterRead`, the input race on the workflow track). Linux CI found three
real issues that are fixed: tmux 3.4 escaping its output (#376), dash not exec'ing the task's command (#383), and the
terminal hangup after a wrapper shell exits (#383 test fixture).

CI and local verification per head are recorded in each PR description and in the #330 / #382 checkpoint comments.
Local full-suite runs on this machine were affected by load (load average 24–48 from concurrent suites) and by a full
disk at one point; failures were rerun in isolation before being judged, and CI is the reference.

## Quality and security pass (2026-10-11)

A review of the workspace (#375–#378) and background task (#383, #384) slices, fixed in place on the same branches;
each child branch merges its parent's fixes. Every fix has a regression test that fails without it.

| Severity | Class | Finding | Fixed in |
| --- | --- | --- | --- |
| Medium | Confirmed (availability) | Task output cleaning used `/\r+$/`, quadratic on a run of carriage returns: 128 Ki of them took 3.7 s, freezing the process that reads the task. Reachable from any task's output (`tail -f` of a hostile log, `adb logcat` from a hostile app, `docker logs`). Now linear. | #383 `4b9685d` |
| Medium | Confirmed (wrong process signalled) | The `/background` manager selected by row index. A task starting or finishing reordered the list, so `x` or Delete acted on a task the person never chose (reproduced: with t1 selected, a new task made `x` stop t2). Selection is a task id. | #384 `85ac421` |
| Low–Medium | Confirmed logic flaw, plausible PID-reuse impact | Leftover group members were checked twice after the leader exited; a longer-lived member kept "processes left" forever, and a later kill request re-probed the old group id, which may have been reused by an unrelated group. The group is probed every 250 ms until empty, then forgotten. The design doc's claim that signals reach only unreaped leaders was inaccurate and is corrected. | #383 `4b9685d` |
| Low–Medium | Confirmed (orphaning) | Removing a finished task whose processes still ran left them with nothing that could stop them. Removal is refused until they are gone; `x` offers the kill. | #383, #384 |
| Low | Confirmed (unsafe default) | A double press or a held `x` escalated SIGINT → SIGTERM → SIGKILL in a fraction of a second. Escalation waits 1.5 s after the previous request (`stopRequestedAt`); `/background kill` remains immediate. | #383, #384 |
| Low | Confirmed (availability) | The panel's `diff --git` heading regex cost about 2 ms per hostile header (1.8 s for a 1,000-file diff of mode changes) and split names containing ` b/` wrongly. Parsed from the line now. | #377 `fcad006` |
| Low | Confirmed (self-inflicted) | `/background` parsing trimmed with `/\s+$/` (quadratic on a long pasted run of spaces). `trimEnd`. | #384 |
| Low | Defense in depth (spoofing debris) | `resourceText` turned only the ESC of a sequence into a space, leaving `]0;PWNED` in tmux names, branch labels and panel text. Whole sequences are removed first. | #375 `1740f4e` |
| Low | Defense in depth | `/keys` problem text echoed a keymap field name raw (escape sequences from the user's own file reached the terminal). | #378 `55bf55c` |

UX fixes in the same pass: the output view kept a scrolled-back position as a row index, so at the retention limit
the text being read drifted with every new line (anchored to seq now, with a notice when those lines are dropped);
the view shows a live task's unfinished progress line; at 40 columns a stopping task's label disappeared behind its
state words; key hints drop whole entries and keep Esc; the manager list scrolls with its selection; removing a task
selects its neighbour; the bar hint names Shift+Up when Up is off; below about 80 columns a drawer covered the
composer that had the keyboard, and at 40 columns both drawers stacked (drawers now follow focus); only the innermost
nested worktree is marked current; the panel returns to each content's scroll position.

### Investigated, not vulnerabilities

| Location | Result |
| --- | --- |
| `scripts/demos/render.mjs` | False positive. Every process is `spawnSync`/`execFileSync` with an argv array and no shell; inputs are the repository's own tapes and private `mkdtemp` paths; tape `Env` values are quoted. Developer tooling, no untrusted input. |
| `src/ask/configAssist.ts:164` | False positive for injection. Line 164 is a regular expression extracting a backticked snippet from the person's own Ask request; the snippet becomes edit content that `renderEditCommand` base64-encodes inside a single-quoted script, so it never reaches a shell as code. Nearby `snippetOf` patterns (`/\s+$/`, `/(\{[\s\S]*\})\s*$/`) are quadratic on huge pasted requests (measured: 40,000 `{` 715 ms; a newline then 40,000 spaces 927 ms): self-inflicted, low; shared file, not changed. Proposed: a hand-written trailing-space trim and a `lastIndexOf('}')`/`indexOf('{')` scan. |
| `renderEditCommand` (Node fallback) | Defense in depth only: a Node path outside `[\w@%+=:,./-]` has `"`, `$`, `` ` `` removed rather than escaped (a backslash is not escaped). The path is NMSh's own `process.execPath`, not attacker-controlled. Proposed: single-quote the path with the same `'\''` escaping `directoryCommand` uses. Shared file, not changed. |
| Session socket | Private runtime directory (owner, mode, no symlink) verified before the service listens and before a client attaches or starts a service; socket 0600; frames bounded at 8 MiB. Defense in depth (shared, not changed): `listLiveSessions`, `listSessionNotices`, `dismissSessionNotice` and `/rename` connect without `ensurePrivateRuntimeDir`; on a multi-user Linux host without `XDG_RUNTIME_DIR` a pre-created `/tmp/nmsh-<uid>` could serve a spoofed session list (attach is still refused). Proposed: call `ensurePrivateRuntimeDir` in those helpers too. |
| Git in untrusted repositories | Context Engine and `/worktrees` Git run with `core.fsmonitor=false`, `core.hooksPath=/dev/null`, no system/global config, an operation allow-list, and status refused when local config declares filters, includes or partial clones; branch names validated with `check-ref-format`, `--` before paths. No issue found. |
| Dependencies | `npm audit`: 0 vulnerabilities (68 packages). |
| Background task commands | Run as one argv element to the session's shell, exactly as typed; automatic background runs only for a family the person set to Always. The detector being stricter than fish's quoting changes only foreground vs background, never what runs. |

Not validated until integration and physical testing: that the frontend routes background and workspace keys only
for the composer owner and never for queued commands; PTY lifetime across detach/reattach and service restart (tasks
are designed to be lost, not adopted, on restart); real `adb`/`scrcpy`/dev servers; Windows (background tasks signal
process groups and are POSIX-only: macOS, Linux, WSL2); drawers and pacing at real widths in Ghostty, Terminal.app and
tmux; how the frontend bounds a `git diff` before `diffContent`.

### Contract changes Codex needs at integration

- `planWorkspaceColumns` takes `focus: regionOf(owner)`; an unfocused open drawer is reported `{mode: 'hidden',
  tucked: true}` and must not be drawn or hit-tested. Focus actions pass the width: `applyFocusAction(state, action,
  columns)`; opening a region that can only be a drawer focuses it.
- While the sidebar filter is being typed, keys go to `SidebarController.handleSearchKey` before `routeWorkspaceKey`.
- The sidebar's `changeDirectory` intent is performed like `/worktrees`' `cd`: `directoryCommand(path)` staged in an
  empty composer, never run directly.
- Background: `TaskBarController.handleKey` and `BackgroundManager.handleKey` take `now` (default `Date.now()`); pass
  the frame clock so pacing and rendering agree. `supervisor.remove(id)` returns false for a task with leftovers;
  `/background clear` should report those as kept. `/background kill t3` maps to `stop(id, 'kill')` directly.
- Up from an idle composer is shared by the agent shelf, the background task bar and any `"replaces": true` keymap
  binding on Up in `composerEmpty`. Decide one precedence in the composer dispatch (proposed: an opt-in keymap
  binding, then the shelf, then the task bar, then history) and update `COMPOSER_MEANINGS.up` (#378).

## Recommended integration order

1. **#370**, then **#372**, then **#373** (stacked: all edit `nmsh.project.json`, `runtimes.ts`, `contextCapabilities.test.ts`
   and the module count in `moduleManager.test.ts`). Retarget each to `release/v0.18.0` as the one below lands.
2. **#374** (independent: `vcs.ts`, `nmsh.vcs.json`).
3. **#369** (independent; touches `src/worktrees/view.ts`).
4. **#381** (independent; `src/worktrees/controller.ts`, GitHub summary query/model/mapper).
5. **#379**, **#380** (independent; new files, plus a narrow `approvalTarget` change in `claudeAdapter.ts` outside
   the lines #347 edits).
6. **#375**, then **#376**, **#377**, **#378** in any order (each adds its own files and its own design doc).
7. **#383**, then **#384**.
8. The frontend wiring for 6–7 (and the Codex control in `harnesses.ts`/`manager.ts` after #347), after #359.

## Overlap with #368 (Ruby/PHP duplicates)

#368 (`feature/output-references`, head `5a795ed`) carries an older copy of the Ruby and PHP runtimes in commit
`d120ba3`, and `docs/design/native-module-coverage.md` in commits `d120ba3` and `a686fb1`. **#370 is canonical.**

| Path | In #368 | In #370 | Resolution on the integration branch |
| --- | --- | --- | --- |
| `src/context/capabilities/runtimes.ts` | `rubyRuntime`, `phpRuntime`, `RUNTIME_CAPABILITIES` with seven entries | the same two plus .NET, Swift, Zig, Deno (`simpleRuntime`), hardened parsers, Ruby layouts in `services.ts` | take #370's file. **#368's Gemfile pattern `/^\s*ruby\s+['"]…/mu` is quadratic**: 730–817 ms on a 60 KB hostile Gemfile (#370: 0.3 ms; its regression test fails against #368's pattern) |
| `src/context/packs/builtin/nmsh.project.json` | `ruby`, `php` modules, `requires` with seven capabilities | twelve capabilities, six new modules, icons, recommendations | take #370's file |
| `tests/contextCapabilities.test.ts` | the Ruby/PHP test | the same test (strengthened: real home, layout bait) plus .NET/Swift/Zig/Deno, linear-time, declaration-location tests | take #370's version of that test and keep #368's other changes, if any |
| `tests/moduleManager.test.ts` | module count 8 | 12 (15 with #372, 16 with #373) | take the count of the highest merged runtime PR |
| `docs/design/native-module-coverage.md` | the coverage matrix (Ruby/PHP marked done) | not present | keep #368's file and mark as done: .NET, Swift, Zig, Deno (#370); Elixir, Dart, Flutter (#372); the `build` module (#373); Mercurial and Jujutsu (#374). Remaining candidates: Bun, Kotlin/Scala, Lua, Haskell, environment summaries (mise, Nix shell, devcontainer) |

#368's module explain view (`f84aed1`, #365) is the canonical diagnostics surface. #377's `factDetail` presents only a
fact's own provenance and should show #365's explain output at integration rather than grow a second view.

## Shared integration contracts

| Contract | Document | Shared files it needs |
| --- | --- | --- |
| Workspace regions, focus, keys, PTY width | `docs/design/workspace.md` (#375) | `TerminalApp.ts` (render composition, key routing, PTY sizing), `slashCommands.ts` (`/sidebar`, `/panel`), `helpContent.ts` |
| Sidebar sources and tmux navigation | `docs/design/workspace-sidebar.md` (#376) | `TerminalApp.ts` (perform intents) |
| Detail panel | `docs/design/workspace-panel.md` (#377) | `TerminalApp.ts` (panel slot) |
| Keymap file and `/keys` | `docs/design/workspace-keymap.md` (#378) | `slashCommands.ts`, config loading |
| Related PRs in `/worktrees` | `docs/design/worktree-manager.md` (#381) | `TerminalApp.ts` (pass the `/github` listing, open on `openPullRequest`) |
| Codex control | `docs/design/managed-providers.md` (#380) | `src/agents/harnesses.ts`, `src/agents/sessions/manager.ts` (after #347) |
| Background tasks: protocol and frontend | `docs/design/background-tasks.md` (#383), `docs/design/background-task-ui.md` (#384) | `src/session/SessionService.ts`, `SessionProtocol.ts`, `TerminalApp.ts` (submission hook, rows above the composer, keys, transcript blocks), `slashCommands.ts` (`/background`, `/bg`) |

Background tasks and the workflow track: the submission hook must run only for commands the person submits from the
composer, never for queued commands (#357 keeps its foreground semantics), and never while a foreground command owns
input (#348). The task bar takes keys only for the composer owner.

## Decisions recorded

- Executable Portable Mods: **disabled** until enforced isolation is demonstrated per platform (#379).
- Claude Remote Control: **no-go for Managed targets**; pass-through for raw Claude; no Never/Ask/Always policy yet
  (#380).
- OpenCode: no adapter until the v2 server's schema is pinned from a running instance (#380).
- GitHub writes stay impossible; merge remains a preview (#381 audit).
- Workspace defaults bind nothing in the composer; background tasks enter the bar with Up only from an idle
  composer, like the agent shelf (#378, #384).

## Physical QA still required (none performed)

- Workspace: Ghostty and Terminal.app at 200/120/100/89/80/70/40 columns; Safe glyphs and `NO_COLOR=1`; inside tmux
  (prefix and root-table keys, passthrough with vim/less); tmux navigation across sessions, windows and panes.
- Keymap host notes: Terminal.app Page Up/Down and Home/End, F1 on macOS, a tmux `bind -n` key, Esc delay in tmux.
- Native modules: a real project per runtime with Homebrew/asdf/mise/FVM installs; hostile repositories.
- Providers: signed-in Codex (`app-server`) message/approve/decline/interrupt; OpenCode `/doc`; Claude
  `--print … --remote-control` behavior.
- Background tasks: real `adb logcat` (stop leaves the adb server and other adb commands working), real `scrcpy`
  (window closes on stop), a dev server, detach/reattach; macOS, Linux and WSL2. Whether the 1.5 s escalation pause
  feels right with a real program that cleans up slowly, and a held `x` with the terminal's key repeat.
- Workspace drawers at 40–80 columns: opening `/sidebar` focuses the drawer, Esc tucks it, the composer is never
  covered while it has the keyboard.
