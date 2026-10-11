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
| #375 | #330 | `feature/workspace-foundation` | `release/v0.18.0` | `dc25989` | column plan, regional focus, semantic bindings, resource model |
| #376 | #331, #333 | `feature/workspace-sidebar` | #375 | `272f302` | Workspace Sidebar, tmux discovery and navigation, worktree/manager sections |
| #377 | #332 | `feature/workspace-panel` | #375 | `961716d` | detail panel: resource, worktree, diff, fact details |
| #378 | #335 | `feature/semantic-keymap` | #375 | `a7ba086` | validated keymap, composer-meaning conflicts, host notes |
| #379 | #341 | `feature/portable-mod-gate` | `release/v0.18.0` | `fccf68e` | executable Portable Mods stay disabled: threat model + regression gate |
| #380 | #339, #340 | `feature/codex-app-server-adapter` | `release/v0.18.0` | `8854bb7` | Codex app-server adapter (not wired); provider evidence; Remote Control go/no-go; approval-target security fix (Claude + Codex) |
| #381 | #337, #338 | `feature/worktree-pr-evidence` | `release/v0.18.0` | `8a40b76` | related PR evidence for `/worktrees`; PR summaries carry head repository and SHA |
| #383 | #382 | `feature/background-tasks-core` | `release/v0.18.0` | `fd49bfa` | background task supervisor, detector, preferences, output |
| #384 | #382 | `feature/background-task-ui` | #383 | `b4f48a2` | task bar, keys, suggestion strip, manager, output views |

CI and local verification per head are recorded in each PR description and in the #330 / #382 checkpoint comments.
Local full-suite runs on this machine were affected by load (load average 24–48 from concurrent suites) and by a full
disk at one point; failures were rerun in isolation before being judged, and CI is the reference.

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
  (window closes on stop), a dev server, detach/reattach; macOS, Linux and WSL2.
