# Release train: v0.19.0 and v0.20.0

Owner of this document and of the release integration branches `release/v0.19.0` and `release/v0.20.0`: the release
agent (Opus). The workflow stabilization track (#359, Codex) owns its feature/fix branches, worktrees, VM and
`src/app/TerminalApp.ts` until it publishes a frontend freeze. Nothing here authorizes changing those.

**Draft PR ≠ merged, released or physically validated.** Verify heads before acting; this file is a checkpoint, not a
status source of truth. Status lives in #359, the PRs and the checkpoint log at the bottom.

## Goals

- **v0.19.0:** integrate and publish the accepted workflow stack (#348 → #357 → #358 → #360 → #361, siblings #367 and
  #368). Publication only when every gate below passes, including a real-terminal smoke test.
- **v0.20.0:** integrate the workspace, native module, panel, background task and agent workspace work on top of v0.19
  in `release/v0.20.0`, verify it, and stop at a reviewable release-candidate PR. **No v0.20.0 tag or release** until
  the maintainer's physical QA and explicit approval.

Out of scope: new feature work, #386, #388, the website (`site/`, Pages workflow), Homebrew tap changes.

## Starting state (2026-10-13)

| Ref | SHA |
| --- | --- |
| `v0.18.0` / `master` | `9ec0676` (release PR #345 merge) |
| `release/v0.18.0` | `8efcc14` |
| Workflow stack fork point | `7122468` (6 commits before `v0.18.0`; those touch only `CHANGELOG.md`, docs and `site/`) |

Homebrew: `raiseCatError/homebrew-tap` `Formula/nmsh.rb` still points at `v0.17.0`; the v0.18.0 bump is **pending** and
needs the maintainer's approval. Not modified by this track.

### Workflow stack (#359) — FROZEN 2026-10-14

Freeze: [#359 comment](https://github.com/raiseCatError/notMyShell/issues/359#issuecomment-6173699296), handoff
[`ca26b9be`](https://github.com/raiseCatError/notMyShell/blob/ca26b9be62f2d7eb7f083e05bd6a2fcff9334811/docs/development/workflow-frontend-freeze.md)
with `workflow-frontend-freeze-evidence.json`. Remote PR heads re-read before integration: all equal.

| Track | Accepted head | Candidate CI | PR CI |
| --- | --- | --- | --- |
| Input #348 | `6aba63bd78f467af8aeaf60421faef05c608646b` | 38525959028 | 38527326783 |
| Queue #357 | `5ab9892060fb0aed2d89f34842a9739c6e860163` | 38528656051 | 38529888852 |
| Copy #358 | `839d23f3bfb780c164b3fa19137170944abe0d21` | 38565279297 | 38566317316 |
| Report #360 | `cb28d4586197e563e4f98c1f0a96e9e3b8f95251` | 38567509019 | 38568288217 |
| Compare #361 | `f1abe217c6a27034a93182bf423dfb45e18ef73d` | 38584973991 | 38585746229 |
| Vocabulary #367 | `5009033c553c882c27a9aeb5a136323637ab302f` | 38586511315 | 38587380619 |
| References #368 | `2395dad5b52895fe041d93d2c75123b25f6669fe` | 38588753923 | 38589604854 |

Per-feature canonical, Linux/Fish 3.7, Node 22.23.3 and report/compare/clipboard security evidence is Codex's and is
reused, not rerun. The 2026-10-13 candidate table and dry runs were on obsolete heads and are superseded (see this file's history at
`9959d23`).

### Frozen-head dry runs (2026-10-14, read-only `git merge-tree`)

- `v0.18.0` + References `2395dad5`: **clean** (the stack now carries `release/v0.18.0` `8efcc14`; v0.18.0 differs from
  it only in `site/`).
- References + Vocabulary (merge base Compare `f1abe217`): **clean**. Only `src/app/TerminalApp.ts` is changed by both.
- v0.19 RC `9e85a910` + `integration/v020-modules` `8f07920`: conflicts in `runtimes.ts`, `nmsh.project.json`,
  `contextCapabilities.test.ts`, `moduleManager.test.ts` (the predicted Ruby/PHP duplicate). + #347 `ebdb1ad9`: clean.
  + #349 `66b60f3c`: conflicts in `CHANGELOG.md`, `src/output/TranscriptPresenter.ts`.


## v0.19.0 plan

Scope: exactly the frozen workflow stack. #349 (notice word wrap) and #347 (agent workspace) are independent and go
to v0.20 so that v0.19's diff is the accepted stack only.

1. **Ownership.** After the freeze, create `release/v0.19.0` from `v0.18.0` (`9ec0676`) and comment on #359 that the
   release track owns that branch. Codex's branches are only read and merged from; never pushed to.
2. **Integrate, history preserved** (merge commits, no rebase/squash):
   1. merge the frozen References head (contains Input → Queue → Copy → Report → Compare → References);
   2. merge the frozen Vocabulary head (sibling);
   3. resolve `CHANGELOG.md` by keeping v0.18.0's released section intact and placing the stack's entries under
      `[Unreleased]`.
   If the frozen heads differ from the dry run, re-run the dry run first and record the result here.
3. **Release metadata:** CHANGELOG `[0.19.0]` section written for users (Input awareness, Command queue, Copy
   selection / picker / Smart Folding, Copy as Report, Compare output, References / paste batches / pins / recipes /
   queue conditions, Activity wording, module explain diagnostics), with Compatibility and Known limitations taken
   from the handoff's disclosed limits; version bump (`npm version 0.19.0 --no-git-tag-version`); README, ROADMAP,
   SECURITY, AGENTS, `llms.txt` pointers (not `site/`).
4. **Gates (all required before publication):**
   - [ ] Codex freeze + exact-head evidence recorded here.
   - [ ] Local canonical `npm run verify:release` on the integrated head, run only when no other heavy suite is active
         (checked with `ps`), private temp roots on `/Volumes/nmsh-opus`, logs retained.
   - [ ] GitHub Actions on the integrated head: PR CI **and** a `workflow_dispatch` run (timing smoke on both
         platforms and the Fedora portability subset run only on non-PR events).
   - [ ] Security acceptance (#363): Codex's current-head report/compare/clipboard gate on the frozen heads, plus the
         report/compare/redaction/clipboard tests passing on the integrated head, plus a bounded review of the
         integration diff (merge resolution only).
   - [ ] Portability: Fedora subset, Node 22 compatibility, Linux/Fish (CI Ubuntu and Codex's Fish 3.7 evidence).
   - [ ] Real-terminal smoke test on the integrated head (see below). If it cannot be performed, v0.19 stops as a
         release candidate.
5. **Publish** (only with every box ticked): PR `release/v0.19.0` → `master`, merge commit, tag `v0.19.0` on the merge,
   GitHub Release from the changelog section. No Homebrew change without approval.

### v0.19 integration and exact-head evidence ledger

Branch `release/v0.19.0` (release track), draft PR [#390](https://github.com/raiseCatError/notMyShell/pull/390).

| Commit | What |
| --- | --- |
| `9ec0676` | `v0.18.0` |
| `58749dbe` | merge References #368 `2395dad5` (carries #348 → #357 → #358 → #360 → #361) |
| `9c5beff8` | merge Vocabulary #367 `5009033c` |
| `9e85a910` | release metadata: CHANGELOG 0.19.0 (unreleased candidate), version 0.19.0, `docs/testing/v019-physical-qa.md`, RC notes in README/ROADMAP/AGENTS |

Merge-resolution review: no conflicts. The merged tree equals References except Vocabulary's 13 files (byte-identical to
Vocabulary) and `site/` (identical to v0.18.0); each side's `TerminalApp.ts` delta applies byte-identically. Vocabulary's
TerminalApp change (decorative phrase choice, factual stored wording, optional journal fields) touches no References
region. Typecheck clean.

Gates on **`9e85a9100d1a377ccb3b270c99d98cbae0ff2605`**:

| Gate | Result | Evidence |
| --- | --- | --- |
| Local canonical `npm run verify:release` (macOS arm64, Node 26.10.0, temp roots on `/Volumes/nmsh-opus/t`) | **pass**: 2431/2431, 0 skipped; bench typecheck and timing smoke pass | 17:30:09–17:38:41Z, clean before/after; `/Volumes/nmsh-opus/logs/receipts/verify-release-9e85a910….{log,json}` (log sha256 `511675d0…`) |
| Report/compare/clipboard security subset (Codex's exact command) | **pass**: 77/77, no leaked roots | `security-focused-9e85a910….{log,json}` |
| PR CI | **pass** (Fedora/timing skipped by design on PR) | [38607118484](https://github.com/raiseCatError/notMyShell/actions/runs/38607118484) |
| `workflow_dispatch` CI: Ubuntu/macOS shards, Node 22, Quality, Fedora, both timing smokes | **pass**, every job, attempt 1 | [38607125000](https://github.com/raiseCatError/notMyShell/actions/runs/38607125000) |
| Node 22 | **pass** in both CI runs (no local Node 22 outside Codex's read-only volume) | as above |
| Linux/Fish 3.7 | Codex's frozen-source receipts (References + Vocabulary); CI Ubuntu on the integrated head | freeze evidence `linux` |
| Physical terminal QA | **NOT PERFORMED** | `docs/testing/v019-physical-qa.md` |

Failures: none on the integrated head. Retained historical failures are Codex's (see the freeze handoff); none is
reattributed here.

**v0.19.0 status: verified release candidate, unpublished.** The only outstanding gate is maintainer physical QA.
Publication steps once it passes: set the CHANGELOG date and `[0.19.0]` link, flip the "latest published release"
pointers (README, ROADMAP, AGENTS, SECURITY, `llms.txt`), rerun dispatch CI on that commit, mark #390 ready, merge with a
merge commit, tag `v0.19.0` on the merge, GitHub Release from the changelog section. Homebrew needs separate approval.

### Real-terminal smoke (v0.19)

Minimum, on the exact integrated head, in a real terminal emulator window (not a PTY harness), zsh plus at least one
of Bash/Fish: launch; ordinary command and output; a command that waits for input shows waiting and accepts the
answer; queue a command while one runs and see it run once, after; copy a block and compare `pbpaste` bytes; Copy as
Report preview with a planted fake secret redacted; compare two runs; detach and reattach; resize; NO_COLOR launch.
Record terminal, OS, shell versions, SHA and exactly which steps were and were not performed. Anything not performed
is listed as outstanding, never implied.

## v0.20.0 plan

Base: the v0.19 integrated head. Branch `release/v0.20.0`, owned by this track.

1. Merge in the #385 order, resolving native conflicts in favor of the canonical #370 lineage:
   #370 → #372 → #373, #374, #369, #381, #379, #380, #375 → #376 / #377 / #378, #383 → #384, #347, #349.
   Ruby/PHP: take #370's `runtimes.ts` / `nmsh.project.json`, #370's Ruby/PHP test, module count of the highest merged
   runtime PR (16 with #373); keep #368's `docs/design/native-module-coverage.md` and mark #370/#372/#373/#374 done.
2. Frontend wiring against the frozen workflow interfaces (the only new code; integration, not new features), each a
   separate commit with tests: workspace column plan and drawers through `screenPlan.ts` (one plan per frame for
   render, cursor, hit testing, PTY size); sidebar and detail panel slots; `/sidebar`, `/panel`, `/keys`;
   background task submission hook for direct composer submissions only (never queued, startup or passthrough input,
   never while a foreground program owns input); task bar and `/background`; related PRs in `/worktrees`; #365
   explain output in the panel's fact detail. Up precedence from an idle composer: opt-in keymap binding, agent
   shelf, task bar, history.
3. Keep out of the candidate: executable Portable Mods (stay disabled, #379), Claude Remote Control for managed
   targets, OpenCode adapter, Codex app-server adapter unless wired and verified (otherwise ship it unwired and
   unadvertised), anything not CI-green.
4. Verify: full local canonical once, PR + dispatch CI matrix, fix confirmed regressions only.
5. CHANGELOG `[Unreleased]` maintained; draft v0.20 release notes; physical-QA checklist
   (`docs/testing/v020-physical-qa.md`) covering Ghostty, Terminal.app, zsh, Bash, Fish, tmux, resize, passthrough,
   clipboard, sessions, managed Claude, worktrees, background tasks.
6. Draft PR `release/v0.20.0` → `master`. Stop. No tag, no release.

### v0.20 preparation branch (no frontend code)

`integration/v020-modules` from `v0.18.0`, merging only the standalone PRs that do not touch `TerminalApp.ts`:
#373 (contains #370, #372), #374, #369, #381, #379, #380, #376/#377/#378 (contain #375), #384 (contains #383).
Head `8f07920`. #347 (edits `TerminalApp.ts`) and #349 (transcript presenter) wait for the freeze.

- One conflict: #374 against the runtime lineage in `docs/architecture/context-modules.md`,
  `tests/contextCapabilities.test.ts`, `tests/contextPacks.test.ts`, all additive (both sides append); resolved
  by keeping both (`fe84476`).
- Local: typecheck clean; 19 targeted files (context, packs, module manager, workspace, keymap, panel, sidebar,
  background, worktrees, GitHub, providers, portable mods, Codex adapter): 182/182 pass.
- [CI 38343182141](https://github.com/raiseCatError/notMyShell/actions/runs/38343182141) (`workflow_dispatch`,
  full matrix incl. timing on both platforms and Fedora): **success** on `8f07920`.

At v0.20 this branch merges into `release/v0.20.0` after the v0.19 head; the Ruby/PHP conflict against #368 is then
resolved as in the table above.

### Real-terminal smoke: what is available on this host

- Screen capture of a single window works (`screencapture -l <id>`, window ids from a small CGWindowList helper at
  `/Volumes/nmsh-opus/tools/winid`).
- Terminal.app opens through LaunchServices (`open -a Terminal x.command`) without AppleScript.
- AppleScript control of Terminal.app is **not** granted: the first attempt left a pending macOS dialog ("Zed.app
  wants access to control Terminal.app"). It was not answered by this agent; granting it is the maintainer's call.
- Keys can reach NMSh through a private tmux server (`tmux -L opus-smoke`) running inside the Terminal.app window;
  the result is read from window captures. Direct keyboard input to Terminal.app or Ghostty is not available to
  this agent (injecting into a terminal's input queue was refused by the session's permission policy and is not
  pursued).
- Harness: `/Volumes/nmsh-opus/tools/smoke/smoke.sh` (`[HOST=terminal|ghostty] smoke.sh start <worktree> [shell]`,
  `keys …`, `shot <name>`, `text`, `stop`). Isolated `HOME`, `XDG_CONFIG_HOME`, `NMSH_RUNTIME_DIR`; Ghostty runs as
  a separate instance (`open -na`, `--title=nmsh-smoke`) that quits with its window. Dry run on `8f07920`: NMSh
  starts (Setup on a fresh home), commands run, `text` returns the screen.
- **Blocked on this host's display state (2026-10-13 09:30 IST):** Mission Control is open with the unanswered
  Automation dialog on top, so every window is drawn as a scaled thumbnail (a 124×38 window captures at
  330×239 px). Dismissing either needs keyboard/pointer input this agent does not have. Window captures are not
  legible evidence until the maintainer closes Mission Control and answers the dialog.
- Left behind deliberately: Terminal.app (started 09:15 by the AppleScript probe) with three idle windows; quitting it
  was refused by the session's permission policy. Nothing else from the probes is running.
- Therefore a smoke run here exercises real Terminal.app rendering through tmux with synthetic keys. Whether that
  satisfies the v0.19 real-terminal gate is recorded explicitly with the run; direct-keyboard Ghostty/Terminal.app
  use remains maintainer physical QA either way.

### v0.20 wiring design notes (from the candidate frontend, read-only)

Candidate `TerminalApp.ts` (References + Vocabulary) is ~10.1k lines. Render path (`render()` → `planFrame` →
`frameRows` by `ScreenPlan` regions → `presentationFrame` → `paintPresentation` → `renderer.render`) takes the
width once from `this.dimensions()` and resizes the PTY from that width.

- **Workspace columns, smallest change:** split `terminalDimensions()` (real size) from `dimensions()`, which returns
  `planWorkspaceColumns(...).center` width whenever a region is docked, so wrapping, ScreenPlan, panels and PTY size
  follow it unchanged; drawers do not change it (no reflow on open). Compose sidebar/panel/drawer cells only at the
  final `renderer.render` call (after transitions and cursor effects), offset `cursorColumn` by `center.start`, keep
  `frame.columns` the terminal width, and render the Status Strip row at full width. Pointer: `columnAt` first, then
  translate x into center-relative columns for the existing handlers. Suppress (hidden) during passthrough,
  external passthrough and idle visuals, as the contract says.
- **Keys:** `routeWorkspaceKey` before owner-specific handling, only for non-protected owners; sidebar filter keys
  before it. Up precedence from an idle composer: opt-in keymap binding, agent shelf, task bar, history.
- **Background tasks:** service protocol (`task-start/stop/remove/output`, `tasks` on attach/change, feature
  `background-tasks` in `SERVICE_FEATURES`) plus an in-process supervisor when the window runs its shell
  in-process; submission hook only for direct composer submissions; task bar via `withNoticeRows`; `/background`.
  Touches `SessionService.ts`/`SessionProtocol.ts`, also Codex-stabilized files: after the freeze only.

### v0.20 integration and exact-head evidence ledger

Branch `release/v0.20.0`, pinned to the unpublished v0.19 RC `9e85a910`; draft PR
[#392](https://github.com/raiseCatError/notMyShell/pull/392) based on `release/v0.19.0` (retarget to `master` after v0.19
publishes). Current head **`c71a42846da4a3832e578f3fb9c28f192510d08e`** (was `44f4c232` until 2026-10-15 10:53Z).

| Commit | What |
| --- | --- |
| `9f8f1085` | merge `integration/v020-modules` `8f079208`; Ruby/PHP per #385 (#370's files, count 16), v0.19 "declaration never spans lines" test kept |
| `7377af4f` | merge #347 `ebdb1ad9` (clean) |
| `207de26b` | merge #349 `66b60f3c` (TranscriptPresenter: NO_COLOR restore + word wrap; changelog entry carried) |
| `fe60bdc4` | workspace sidebar/panel wiring (`workspaceHost.ts`, `workspaceFrame.ts`), `/sidebar`, `/panel`, `/keys` |
| `1c418629` | #379 portable-mod gate reconciled with #347 (exact reviewed argv allowlist; `view.ts` type imports) |
| `960e925f` | background tasks: `SessionTasks`, protocol feature `background-tasks` |
| `5d547246` | background tasks: frontend, task bar, `/background`, composer-only hook, suggestions default off |
| `84730131` | related PRs in `/worktrees` from the last `/github` listing; `p` opens the PR |
| `62c6fad0` | release metadata, `docs/testing/v020-physical-qa.md` |
| `44f4c232` | `/keys` host profile moved out of TerminalApp (hostIntegration) |
| `00163da7` | portable-mod gate refuses eight demonstrated ways around it (self-test); plugin ids and the validated path can no longer reach Claude's argv as options (security review of `1c418629`) |
| `1861666a` | Codex adapter: a cancel made before Codex names the turn is sent when it does (real defect found by the canonical run) |
| `c71a4284` | background supervisor test: the leader exits only after the sleeper ignores the hangup (test race found by the canonical run) |

| Gate | Head | Result |
| --- | --- | --- |
| Merge-only dispatch CI [38608819740](https://github.com/raiseCatError/notMyShell/actions/runs/38608819740) | `207de26b` | **failed** (portable-mod gate vs #347) → fixed in `1c418629`; failure preserved |
| PR CI [38649082204](https://github.com/raiseCatError/notMyShell/actions/runs/38649082204), dispatch [38649080918](https://github.com/raiseCatError/notMyShell/actions/runs/38649080918) | `62c6fad0` | **failed**: hostIntegration (real defect) → fixed in `44f4c232` |
| Local canonical `verify:release` | `62c6fad0` | **failed** 3/2609: hostIntegration (fixed), `configuredCompletion` "capture bounded to 4096" (0 records, 3.26 s) and `copyFolding` "Auto-expand On" (3.27 s). The latter two passed in 3 isolated reruns and in CI; unexplained, preserved, not classified |
| PR CI [38650280119](https://github.com/raiseCatError/notMyShell/actions/runs/38650280119) | `44f4c232` | **pass**, every job |
| Dispatch CI [38650273295](https://github.com/raiseCatError/notMyShell/actions/runs/38650273295) (Fedora, both timing smokes) | `44f4c232` | **pass**, every job |
| Local canonical `verify:release` | `44f4c232` | **failed** 2/2609 under heavy unrelated load (load avg ~21: another project's svelte-check, a Codex session): `absolutePathLive` live fish (53 s; ownership probes ETIMEDOUT) and `codexAdapter` cancellation (10.4 s settle timeout). Both passed 3/3 isolated reruns. Preserved, not classified. **A clean, uncontended full rerun on this head is still required.** Note added 2026-10-15: run 2's load samples show this suite alone drives load averages of 10–70 on this 8-core, 8 GB host, so "heavy unrelated load" was not established as the cause; `codexAdapter` was later shown to be a real defect (below). Receipt archived read-only as `/Volumes/nmsh-opus/logs/archive/run1-2026-10-14T2250Z-verify-release-44f4c232….{json,log}` (log sha256 `2ba49b34…`) because the receipt tool names files by head |
| Local canonical `verify:release`, run 2 | `44f4c232` | **failed** 5/2609 (2603 pass, 1 skipped; bench typecheck and timing smoke not reached), 10:19:33–10:30:57Z, clean before/after, Node 26.10.0. Pre-run: load 5.9, 32 % memory free, 5 GB swap used, no other test/build workload (a `colima-suma` VM resident, Chrome, an idle Codex app session; none stopped). Sampled load during the run 5–70 (`/Volumes/nmsh-opus/logs/v020/load-run2-44f4c232.log`), mostly the suite's own node workers. Failures: `backgroundSupervisor` ×2 (leftovers false at 1.4 s; timed out waiting for leftovers, 10.3 s), `codexAdapter` cancellation (timed out waiting for settled; events user/started/model), `configuredCompletion` "capture bounded to 4096" (0 records, 5.7 s) and "warm cancellation backs off" (0 results, 4.0 s). Investigation below. Log sha256 `6e52d141abd607126ada4e05647627cf4eb5bc66e631b24b32f75412af49b596`, json `2fb760bb…` |

| Skipped | all | 1: `the real installed Claude, read-only` (opt-in `NMSH_REAL_CLAUDE=1`; must not touch real accounts) |
| Local `backgroundSupervisor` "leftover group that ends later" | dev runs | one 10.27 s failure in a combined local run (message not captured), then 1 isolated + 2 combined passes; plausibly a load-delayed exit observation; unconfirmed, preserved. 2026-10-15: same signature as run 2; cause found (fixture race, below) |
| Report/compare/clipboard security subset (v0.19's exact command) | `c71a4284` | **pass** 77/77, 0 skipped, no leaked roots; 10:52:10–10:52:36Z, clean before/after; `security-focused-c71a4284….{log,json}` (log sha256 `023d922b…`) |
| Supplementary v0.20 security tests (`portableModGate`, `claudePlugins`, `sessionProtocol`, `backgroundSession`, `backgroundIntegration`, `backgroundSupervisor`, `workspaceIntegration`, `workspaceFrame`, `workspaceKeymap`, `codexAdapter`) | `c71a4284` | **pass** 72/73, 1 skipped (opt-in real Claude), no leaked roots; `security-v020-c71a4284….{log,json}` (log sha256 `a4870446…`) |
| PR CI [38723507272](https://github.com/raiseCatError/notMyShell/actions/runs/38723507272), dispatch [38723501877](https://github.com/raiseCatError/notMyShell/actions/runs/38723501877) | `c71a4284` | **pass**, attempt 1. PR: every job (Fedora and timing smokes skipped by design on PR). Dispatch: every job, including Fedora, both timing smokes, Node 22 |
| Local canonical `verify:release`, run 3 | `c71a4284` | **pass**: 2612 tests, 2611 pass, 0 fail, 1 skipped (opt-in real Claude); serial benchmark group 8/8; bench typecheck and timing smoke pass; exit 0. 10:54:13–11:01:45Z (test phase 431 s), clean before/after, macOS arm64 8 GB, Node 26.10.0, temp roots on `/Volumes/nmsh-opus/t`. Pre-run load 3.7, 36 % memory free, swap 5.4 of 6 GB used; no other test/build workload (the `colima-suma` VM idle at start); sampled peak load 20 (`load-run3-c71a4284.log`). Every test that failed in run 2 passed, including the unfixed `configuredCompletion` (1.1 s), which therefore stays an open record, not a resolved one. Log sha256 `dfa333189d1f8d90ebd637346020ef8e33b8ee45974e162c7e041dbf9d4d09ee`, json `7895dd70…` |
| Physical QA | — | **NOT PERFORMED** |

Logs: `/Volumes/nmsh-opus/logs/receipts/`, `/Volumes/nmsh-opus/logs/ci/`, `/Volumes/nmsh-opus/logs/v020/`,
`/Volumes/nmsh-opus/logs/archive/`. Experiment scripts and outputs from the investigation below were kept in the
session scratch area; their results are summarized here.

#### Run 2 failure investigation (2026-10-15)

No timeout was raised, no test disabled, no selection changed. Each signature reproduced or bounded by a controlled
experiment, serially, with nothing else of this track running:

- **`codexAdapter` cancellation: real defect.** `send()` queues the text while the thread starts, and `cancel()`
  returned silently without a thread and turn id: no interrupt, no word to the person, and the turn ran. Deterministic
  reproduction (cancel at 0 and 300 ms after `send` without waiting for `started`): events exactly `user, started,
  model`, no `turn/interrupt`, never settled. Under 8 CPU-bound burners the unmodified test failed 2/2 (10.5 s, 10.4 s);
  idle it passes. Fixed in `1861666a` (pending cancel sent when the turn is named); the new test fails on the old
  adapter with the canonical signature and passes on the fix idle and 2/2 under burners. The adapter remains unwired.
- **`backgroundSupervisor` leftovers ×2: test race; supervisor verdicts correct.** The tests start a background Node
  sleeper and let the leader exit after `sleep 1` / `sleep 0.2`, assuming the sleeper has already ignored SIGHUP. Node
  start-to-exit measured 0.28–0.46 s at load ~8. Real-supervisor matrix: a member that has ignored the hangup before
  the leader exits is reported as leftover; one that has not is ended by it (plain `sleep` 2/2, a trap set 0.5 s late
  3/4) and the task correctly reports no leftovers. The hangup's timing relative to the leader's exit itself varied
  between trials and is not fully characterized. With an 800 ms slow-starting sleeper the old shape lost the member
  1/10, the readiness-wait shape 0/10. Fixed in `c71a4284` (the sleeper reports readiness; the leader waits, bounded);
  file passes 3/3 idle and 2/2 under burners. The 2026-10-14 dev-run failure had the same signature.
- **`configuredCompletion` ×2: not reproduced; open.** Product behavior is fail-closed by design when the real zsh
  helper (`zpty`, inner `zsh -i` with `compinit`) misses its startup deadline (`startupMs: 4000` in the tests, 1500
  in the product). Isolated: 15/15 idle; 2/2 under 8 burners; 3/3 combined with three PTY-heavy live files at
  concurrency 4. `zsh -i` with `compinit -D` starts in 0.18–0.36 s idle and 0.30–0.56 s under 8 burners. Within the
  canonical runs, neighbouring completion tests took 0.3–0.6 s on v0.19 (`9e85a910`), 2–3 s in v0.20 run 1 and
  ~3.7 s in run 2, i.e. within reach of the 4 s deadline, while the suite overall was 1.09× (median) / 2.9× (p90)
  slower than v0.19. Consistent with suite-induced slowdown in that part of the run, but **the cause is not
  established**; it stays an open record, as do `copyFolding` (62c6fad0) and `absolutePathLive` (44f4c232 run 1).

### v0.20 physical-QA checklist audit (2026-10-15, against `44f4c232`)

Every item of `docs/testing/v020-physical-qa.md` checked against the code it exercises. "Testable" means a person
can judge the item as written; it says nothing about whether it passes. The checklist on the release branch is
**unchanged**: the proposals below need the maintainer's approval before the checklist is edited.

| Item | Status | Evidence / gap |
|---|---|---|
| 1.1 widths, docked vs drawer, `tput cols` | Implemented, testable | `planWorkspaceColumns`; `dimensions()` is the center width; drawers never resize the PTY |
| 1.2 Safe glyphs, `NO_COLOR` | Implemented, testable | `composeWorkspaceFrame` style (safe/color) |
| 1.3 regions hide for vim/less | Implemented, testable | `workspaceSuppressed()` on passthrough |
| 1.4 tmux section, Enter switches pane, prefix/`bind -n` reach tmux first | Implemented, testable | `tmuxResources`, `tmuxNavigationArgs`, `trustedTmux` |
| 1.4 "`/keys` names them" | **Partially implemented** | `hostNotes` can name root-table keys, but `keymapHostProfile` never fills `tmuxRootKeys` and nothing reads tmux's key tables or prefix: inside tmux `/keys` only notes Esc's escape-time. `docs/design/workspace.md` never promised it; the checklist clause overreaches |
| 1.5 worktree Enter stages `cd -- '…'`; draft kept | Implemented, testable | `performWorkspaceIntent` + `directoryCommand` |
| 1.6 click sidebar/panel/transcript: focus follows; transcript hits land right with the sidebar docked | Implemented, testable | `routeWorkspacePointer`: a click in a region focuses it, a center click returns focus, center events are translated to center columns |
| 1.6 (implied) clicking a **row** selects it | **Explicitly deferred** | a click in the sidebar or panel only focuses the region; the row under the pointer is not selected (handover item 7). The item never says "select a row", but a tester will try it: the checklist should say what to expect |
| — wheel over sidebar/panel scrolls that region | **Explicitly deferred**, not in the checklist | wheel events carry no position (`keys.ts`), so they bypass the pointer router and scroll the transcript wherever the pointer is (as the CHANGELOG's known limitations say) |
| 1.7 `keymap.json` Left → `sidebar.focus` with `"replaces": true`; `/keys`; Terminal.app Page Up/Down note | Implemented, testable | `applyKeymap`, `hostNotes` (apple-terminal) |
| 2.1–2.7 background tasks | Implemented, testable | task bar, `entersBar` (Up from idle composer), view follow/End, `ESCALATION_PAUSE_MS` x pacing, session-owned tasks, foreground default (`suggestions: 'off'`), hook only on direct composer submission |
| 2.3 `adb logcat` part | Testable only with an Android device/emulator | otherwise Not run |
| 3.1–3.2 native modules | Implemented; testable only where the toolchains are installed | per-toolchain Not run is legitimate |
| 3.3 related PR `p`; fork PR not offered | Implemented, testable | `relatedPr.ts` requires the same head repository |
| 4.1 `/model`, `/effort` | Implemented, testable with a disposable account | `agents/input/pickers.ts` |
| 4.2 `/mods` enable/disable | Implemented; **never verified against a live account**; needs a disposable account | `setPluginEnabled`, `toggleMod` |
| 4.3 multi-line approval shows every line | Implemented (agent approval view), testable with a disposable account | |
| 5 v0.19 core on this build | Testable | as v0.19 |

Missing despite being an acceptance requirement: only the 1.4 `/keys` clause. Other known deferrals and whether the
checklist needs them:

| Deferred capability | In a v0.20 acceptance item? | Recommendation |
|---|---|---|
| NMSh sessions / managed-target sidebar rows | No | defer; the sidebar lists tmux, worktrees and manager links only |
| Sidebar click-to-select | Not required; implied by 1.6 wording | defer; add an explicit "expected: focus only" line to 1.6 |
| Pointer-region-aware wheel | No | defer (already a CHANGELOG known limitation); mention in 1.6 so a tester does not log it as a regression |
| Module diagnostics in the detail panel | No (`/modules` is canonical) | defer (decision 4) |
| Live task output in transcript blocks | No; 2.5 requires the opposite | defer (decision 3) |
| Module compaction explanations (from v0.19) | No | defer |
| External source previews (from v0.19) | No | defer |
| `/keys` naming tmux prefix and `bind -n` keys | **Yes (1.4)** | **maintainer choice:** (a) defer and reword 1.4 to "the prefix and `bind -n` keys reach tmux first; `/keys` notes tmux's Esc delay", recorded as a v0.20 known limitation; or (b) implement before v0.20: read `tmux show-options -g prefix` and `tmux list-keys -T root` once per `/keys` through the existing `trustedTmux` runner, with tests. Recommended: (a). The behavior that matters (tmux keeps its keys) is implemented and testable; (b) adds a new process call to a help command and would need its own review and verification cycle |

Proposed checklist changes, for approval (not applied): 1.4 as above; 1.6 add "a click focuses the region; it does
not select the row under the pointer, and the wheel scrolls the transcript wherever the pointer is (both deferred,
both already CHANGELOG known limitations)". No item is
removed. The QA runbook (`docs/development/release-qa-runbook.md`) tells the tester to record the 1.4 clause as
**Fail (known gap)** until the maintainer decides.

### v0.20 security review of the integration (`fe60bdc4..44f4c232`, 2026-10-15)

Scope: the integration commits only (the merged PRs carry their own reviews). Read-only review of
`src/session/*`, `src/backgroundTasks/{protocol,sessionTasks}.ts`, `src/app/{workspaceHost,workspaceFrame,backgroundHost}.ts`,
the TerminalApp wiring, `src/workspace/tmux.ts`, `src/agents/mods/*` and `tests/portableModGate.test.ts`.

| Area | Finding |
|---|---|
| Background task ownership | `task` requests are honored only for the connection that owns the session and listed `background-tasks`; output and lists are sent only while `session.controller === send`, so a superseded or older frontend receives nothing; every frame is validated (`taskOpFrom`, `tasksFrom`, `taskUpdateFrom`; ids `t\d+`, bounded sizes). Tasks end with the session (service shell exit, service close; in-process kill/detach). No issue |
| Suggestions vs foreground input | the hook runs only from `routeComposer`'s final direct submission (`fromComposer`), and not while `running`, `startupPending`, `passthrough` or `externalPassthrough`; queued entries, program input (`send`, answers while running), startup and other `submit()` callers never reach it. Default `suggestions: 'off'`. No issue |
| Session protocol compatibility | feature negotiation both ways (`SERVICE_FEATURES`/`CLIENT_FEATURES`); the client sends `task` only when the service listed it; a service never sends task frames to a client that did not list it; `backgroundAvailable()` hides `/background` otherwise. No issue |
| Workspace focus and routing | workspace keys after protected owners; pointer events translated to center columns; protected owners keep the keyboard on a click beside them. No issue |
| tmux | executable only from fixed system paths through `realpath` (`trustedTmux`); argv only. No issue |
| Worktree `cd` | staged, never run; `directoryCommand` refuses unsafe paths and single-quotes the rest. No issue |
| Related PR `p` | opens NMSh's own GitHub panel; no external process. No issue |
| Clipboard / transcript isolation | task output never enters transcript blocks, so `/copy`, Copy as Report and `/compare` cannot include it (physical item 2.5 confirms). No issue |
| **Portable-mod gate (`1c418629`)** | see below: **acceptable with conditions**; hardening and regression tests added |

**`1c418629` assessment.** The gate change itself is a tightening of #379's single allowed call into four reviewed
argv forms through `execFile` without a shell, and it is consistent with keeping executable Portable Mods disabled:
no loader check was removed, and none of the four calls loads or runs mod code inside NMSh. But the static test could
not establish what it claimed. Gaps found, each reproduced as a fixture against the gate:

1. `shell: '/bin/sh'` (a shell given by path) passed; only `shell: true` was refused.
2. A second `import * as cp from 'node:child_process'` beside the named import passed.
3. The executable was never checked (`run('/bin/sh', …)` passed), and an argv array not starting with `'plugin'`
   was never compared with the reviewed list.
4. `args` could be changed after its reviewed literal (`args.push(...)`).
5. `createRequire`/`node:module`/`process.dlopen` were not in the loader list.
6. Only files inside `src/agents/mods` were scanned: a process helper imported from elsewhere passed.

Runtime, two values from outside NMSh reached Claude's argv in option position: `PLUGIN_ID` accepted ids starting
with `-` (`--settings@market`), and `validate` received `entry.reference` (the listing's `installPath`) without
checking it is an absolute path. Both come from Claude's own `plugin list --json`, so exploitation would need
Claude's listing to carry such a value; it is still argument injection into a process NMSh starts, and it is closed.

What static tests cannot establish, and stays a residual risk recorded for the maintainer:
- that `claude plugin validate` and `claude plugin details` never execute plugin code (Claude's implementation;
  NMSh's own claim is "Claude's documented review step"). Only an explicit Inspect action runs them;
- that `claude plugin list --json`, run with the shell's directory as cwd when `/mods` opens, does not act on an
  untrusted repository's `.claude/settings*.json` beyond listing (Claude's trust model);
- the live behavior of `enable`/`disable` against a real account (never verified; physical item 4.2);
- anything reachable more than one import level away from `src/agents/mods`.

Fixed in `00163da7`: every gap above is now refused, and a self-test feeds each fixture through the gate (the
gate as committed in `1c418629` accepted all eight, re-run outside the test to confirm); runtime ids must start
with a word character and only an absolute install path is validated (a behavioral test against a recording fake
`claude` fails on the old code).

Conditions for accepting the gate change: `00163da7` on the release head; physical item 4.2 run with
a disposable account before the Claude plugin controls are advertised as working; the maintainer's explicit
sign-off (decision 1).

## Physical QA findings and stabilization (2026-10-15/16)

The maintainer's first physical QA in Ghostty (screenshots and notes) stopped both releases. **Neither candidate head
moved:** `release/v0.19.0` is still `9e85a910`, `release/v0.20.0` still `c71a4284`; their evidence above stands. The
fixes are on separate branches (below) for review. Automated real-PTY evidence here is not physical QA.

### Triage

| Finding | Class | Result |
|---|---|---|
| `read`, hidden and single-key reads lose the answer; Enter or text goes to the queue (1.3, 1.4, 1.5, 1.7) | **Confirmed defect (P0)** | Reproduced on `9e85a910` through the real frontend, PTY and session service; fixed |
| Waiting state too subtle | Confirmed UX defect | Redesigned |
| `seq 1 400` copies 399 lines (1.12); 1.11 bytes | **Confirmed defect (P1)** | The final newline was lost and tabs became spaces, before the clipboard; fixed |
| `/queue`, `/copy`, `/compare` inside a multi-line submission | Test-procedure contamination (expected parser contract) | Not a defect; the paste review now says it |
| Cannot reconnect after closing the window; only an archive in `/resume` (2.2–2.4) | **Misunderstood procedure, not a product defect** | Window close leaves the session live on both candidates; the QA helper made a new directory each launch. Five QA sessions from 19:46–20:30 are still running. New launcher fixes the procedure |
| Queue-pause notice twice | Confirmed UX defect | One transcript notice; the row is state and action |
| Queue approval only via `/queue` + `a`; no preview of what runs next | UX change | Implemented (queue preview, contextual review) |
| Task bar: dot, misalignment, purple selection, lingering finished tasks | Confirmed UX defects | Fixed |
| Setup previews empty/unrelated; Chroma change shows nothing; activity wording hard to read | Confirmed UX defects | Fixed (narrow, tested); step reorder proposed only |
| Sidebar/detail panel too large, detached | Design | Proposal: `workspace-ui-decision.md` (recommends delegate, then retire); nothing changed |
| `z notMyShell` fails | **QA environment**, not NMSh | NMSh never initializes zoxide; the isolated QA home has no `.zshrc`, so `z` is undefined |
| `/compare` unified diff; Report redaction; NO_COLOR program colors; no composer overlap; mouse focus; `/background run` started | Positive observations | Recorded as observations only; the items still need their full checklist steps |
| Native modules work in limited use; full module QA and task lifecycle QA | Unverified | Outstanding |
| Managed Claude (4.1–4.3) | **Deferred by the maintainer** | Not performed; plugin writes now off by default (below) |

### Diagnostics (real PTY, isolated sandbox; macOS, zsh 5.9, Bash 5.3, Fish 4.9)

**A: `read -r QA_REPLY; printf 'ANSWER=%s\n' "$QA_REPLY"`, answer `hello`, at 0, 150 and 700 ms after the command's
Enter.** On `9e85a910`: zsh and Bash never answered (the text was queued); single-key reads (`read -k 1`, `read -n 1`)
never answered; hidden reads and Fish failed at 0 ms. On the fix: every case in zsh, Bash and Fish answered, exactly once
in the journal (zsh/Bash), nothing queued, nothing run as a command, no hidden character drawn.

**B: `printf 'a\tb\n  indented\nüñí\n'`, then `/copy` on its own.** Candidate (bytes handed to the clipboard tool):
`6120202020202020620a2020696e64656e7465640ac3bcc3b1c3ad` (tab as 7 spaces, no final newline). Fix, through the real
`pbcopy`/`pbpaste`: `6109620a2020696e64656e7465640ac3bcc3b1c3ad0a` (expected). The person's clipboard was saved (all 4
types) and restored; hashes matched.

**C: `seq 1 400`, then `/copy`.** Candidate: 400 records, 399 newlines, no frontend text, folding irrelevant (392 lines
were folded and all copied). Fix: `pbpaste | wc -l` = 400; `awk 'END {print NR, $0}'` = `400 400`;
`tail -c 16 | xxd -p` = `3339370a3339380a3339390a3430300a`; no non-numeric lines. Root cause: output was stored through
the screen model, which draws a tab as spaces and joins lines without recording the final line break.

### Root causes and fixes

- **Input:** on macOS the only line/key-read evidence was a question-shaped prompt left open, so prompt-less reads
  were invisible; a key typed before the first probe (150–400 ms, backing off to 10 s) was routed on no evidence.
  Fix: the shell holding its own terminal is a builtin's read (keys: confirmed; line: likely after two samples);
  an on-demand `input-look` probe (negotiated feature) before routing the first key of a draft or an Enter that would
  queue; held keys reach a program that took the terminal; an answer clears the frontend's stale request.
  Known limit: on macOS a `wait` builtin looks like a line read (shown as "Probably").
- **Copy:** tab spans kept; a per-record `outputNewline` from program output only; one exact copy path.
- **Recovery:** procedure. `nmsh-qa.zsh` (this branch) with `nmsh_qa`, `nmsh_qa_reopen`, `nmsh_qa_sessions`,
  `nmsh_qa_list`, `nmsh_qa_adopt`; it refuses non-QA directories.
- **Security review** of the fix commits found two issues, both fixed with tests: a quadratic trailing-escape regex
  (`4cb32e32`) and an NMSh-command paste label that could mask a risk label (`bbb7b384`).

### Branches (nothing merged into a release branch; nothing tagged, released or retargeted)

| Branch | Base | Commits | For |
|---|---|---|---|
| `fix/v019-input-ownership` | `9e85a910` | `d9676fa8` input ownership, `d21ebb4c` waiting state, `3907848f` exact copy, `4cb32e32` linear ending | **v0.19 required** (P0/P1) |
| `fix/v019-queue-ux` | input branch | `a3bec80f` queue preview and review, `ce63a575` + `bbb7b384` paste disclosure | v0.19 recommended (P2) |
| `fix/v019-setup-ux` | input branch | `afd88117` previews, Chroma clarity, activity example | v0.19 recommended (P2) |
| `stabilize/v0.19.0` | input branch | merges the two above | the v0.19 candidate to verify |
| `fix/v020-stabilization` | `c71a4284` | `62305167` merge of the input branch | **v0.20 required** (backport) |
| `fix/v020-task-ux` | v0.20 stabilization | `3f946be0` task bar | v0.20 recommended |
| `fix/v020-claude-defer` | v0.20 stabilization | `968f2974` plugin writes off by default | v0.20, per the managed-Claude deferral |
| `stabilize/v0.20.0` | v0.20 stabilization | merges `stabilize/v0.19.0`, task bar, Claude deferral | the v0.20 candidate to verify |

Backport rule: every v0.19 fix reaches v0.20 by merge (never cherry-pick); v0.20-only work stays off v0.19.

### Verification log (stabilization heads)

| Head | Gate | Result | Evidence |
|---|---|---|---|
| `stabilize/v0.19.0` `1179936b` | local canonical `verify:release` | **fail 4/2456** (kept): three tests still pinned the dropped final newline or the old Setup Chroma preview; one new live test exposed a real race (below) | `verify-release-1179936bbc655a520c39c9ab9a9ef17ebb48f0cf.{log,json}` |
| `stabilize/v0.19.0` `bcc8e760` | local canonical | **pass** 2457/2457 | `verify-release-bcc8e760….{log,json}` (log sha256 `f4f31b00…`) |
| `stabilize/v0.19.0` `bcc8e760` | PR CI 38803588641, dispatch CI 38803613336 | **fail** (kept): Ubuntu shard 1/2 only; a new live test read the journal before Linux wrote it (test synchronization, fixed `23fcb4f4`); macOS, Fedora, Node 22 and timing jobs passed | GitHub Actions |
| `stabilize/v0.20.0` `36858e76` | local canonical | **fail 2/2641** (kept): the portable-mod gate's textual `shell:` rule matched the deferral note's words; reworded (`7f18d766`), the gate unchanged | `verify-release-36858e76….{log,json}` (sha256 `a7fd9f1c…`) |
| `stabilize/v0.20.0` `aff3f8cc` | local canonical | **fail 1/2641** (kept): the same journal timing in the Bash live test, under local load; fixed by `23fcb4f4` | `verify-release-aff3f8cc….{log,json}` (sha256 `2647a07d…`) |
| **`stabilize/v0.19.0` `adfce9c1`** | local canonical | **pass** 2457/2457, 0 skipped; bench typecheck and timing smoke | `verify-release-adfce9c1….{log,json}` (sha256 `6f0087ac…`), 20:50:59–20:56:47Z, clean before/after |
| **`stabilize/v0.19.0` `adfce9c1`** | PR CI 38805295259, dispatch CI 38805309388 (all shards, Node 22, Fedora, timing) | **pass** | GitHub Actions |
| **`stabilize/v0.20.0` `2f00b301`** | local canonical | **pass** 2640/2641, 1 skipped (the pre-existing skip) | `verify-release-2f00b301….{log,json}` (sha256 `c8fa7b90…`), 20:56:47–21:02:57Z, clean before/after |
| **`stabilize/v0.20.0` `2f00b301`** | PR CI 38805309322, dispatch CI 38805314450 | **pass** | GitHub Actions |

Draft PRs (not ready, not merged): **#395** `stabilize/v0.19.0` → `release/v0.19.0`; **#396** `stabilize/v0.20.0` →
`release/v0.20.0`. #390, #392 and #394 are untouched. The physical QA gate is unchanged and not passed.
Visual checks (VHS stills, not physical QA): waiting states, queue preview and review, task bar, and on v0.20 the
activity line, queue block, task bar and composer stacked without overlap.

**Race found by that run (fixed, `fb395506`):** after Ctrl+C on a read with a question open, the frontend still held the
question, so the next command's first key started a draft marked as a reply; when the prompt came back mid-typing,
the existing reply rule discarded it and the rest ran as a fragment. Reproduced deterministically (a trap delays the
prompt by 1.5 s) before the fix; the test passes after it. Ctrl+C and Ctrl+Z now end the question in the frontend.

### Physical QA still required (nothing above passes a checklist item)

All of v0.19 passes 1–3 and v0.20 passes 1–3 and 5 must be repeated by a person on the stabilized builds, with
particular attention to 1.3, 1.4, 1.5, 1.7 (input), 1.11–1.12 (bytes), 2.2–2.4 (reopen with `nmsh_qa_reopen`), the
queue preview and review, the task bar, and Setup's previews. Physical Linux/Fish 3.7 remains outstanding for both.
Managed Claude 4.1–4.3: **deferred by the maintainer, not performed, not passed**.

## Checkpoint and handover (2026-10-15, resumed session)

State at the end of the resumed session; the earlier handover below is kept as written.

| Release | Branch head (remote = local) | Working tree | PR |
|---|---|---|---|
| v0.19.0 | `9e85a9100d1a377ccb3b270c99d98cbae0ff2605` (unchanged) | clean | #390, draft |
| v0.20.0 | `c71a42846da4a3832e578f3fb9c28f192510d08e` | clean | #392, draft, base `release/v0.19.0` |

Automated gates: v0.19 all pass (unchanged, not rerun). v0.20 on `c71a4284`: local canonical run 3
**pass** (2611/2612, 1 skipped), security subset 77/77, supplementary security 72/73 (1 skipped), PR CI
38723507272 and dispatch CI 38723501877 pass on attempt 1. Earlier failed runs are preserved above.

**Maintainer decisions still requiring explicit sign-off** (provisional direction in brackets):

1. **Portable-mod gate** (`1c418629` + `00163da7`): acceptable **with conditions** (security review above). [Keep
   execution disabled; accept the four reviewed Claude CLI forms.]
2. **Background suggestions Off by default** [as built]. Trade-off: #383 designed `ask`; with Off, nobody discovers
   backgrounding from Enter, but Enter on `tail -f`, `npm run dev`, `ping` behaves exactly as in v0.19.
3. **Task output separate from the transcript** [as built]: bar, output view and `/background` only; consequence:
   no `/copy`, Copy as Report or `/compare` of task output in v0.20 (physical item 2.5 checks exactly that).
4. **Module diagnostics stay in `/modules`** [as built]; the detail panel shows sidebar selections only.
5. **Codex adapter unwired and unadvertised** [as built]; `1861666a` fixes a real cancel defect in it, which does not
   change that.
6. **Claude plugin enable/disable**: never verified against a live account. Options: (a) run physical item 4.2 with a
   disposable account before v0.20 sign-off; (b) if that cannot happen, defer the controls for v0.20 (inventory and
   Inspect stay; Space/Enter toggling reports "not verified in this release" instead of running `claude plugin
   enable|disable`), a small change with its own tests and re-verification; (c) ship as is with the existing
   CHANGELOG known limitation. Recommended: (a), else (b). (c) ships an unverified write path into the person's
   Claude settings.
7. **`/keys` and tmux root keys** (checklist 1.4): defer and reword (recommended), or implement before v0.20 (see the
   audit above).
8. **Checklist wording** for 1.4 and 1.6 as proposed in the audit (nothing removed).
9. **Open, unexplained local failures** (`configuredCompletion` ×2 on `44f4c232` run 2 and on `62c6fad0`,
   `copyFolding` on `62c6fad0`, `absolutePathLive` on `44f4c232` run 1): whether a passing canonical run on the final
   head is sufficient with these recorded as open, or whether they must be explained first.

**Physical QA:** not performed for either release. Execution guide: `docs/development/release-qa-runbook.md`
(this branch). Human-only gates: v0.19 passes 1–3 in Ghostty and Terminal.app, Bash or Fish on macOS, and a
**physical Linux terminal with Fish 3.7**; v0.20 passes 1–5, of which pass 4 needs a disposable Claude account. If no
physical Linux machine with Fish 3.7 is available, both releases are blocked on that row; a VM or CI does not
substitute.

**Publication:** unchanged from item 6 below. Nothing was merged, tagged, released, retargeted or force-pushed.

## Checkpoint and handover (2026-10-15)

Work paused at the maintainer's request. Nothing is running; all release worktrees are clean and pushed. Not done:

1. **v0.20 local canonical on `44f4c232` without contention.** Check `ps`/load first; run
   `/Volumes/nmsh-opus/tools/receipt.sh verify-release /Volumes/nmsh-opus/wt/v020 -- npm run verify:release`.
   Investigate any failure with controlled reproductions; do not weaken deadlines.
2. **Security subset on the v0.20 head** (Codex's report/compare/clipboard command, as run on `9e85a910`), plus a
   bounded security review of the new wiring diff (`fe60bdc4..44f4c232`).
3. **Update #392's gate checklist** and the #359/#385 coordination comments with v0.20 status (not yet posted).
4. **Maintainer decisions requested** (listed in #392): the portable-mod gate change in `1c418629`; background
   suggestions default off; task output out of the transcript; detail panel without module diagnostics; Codex adapter
   unwired; Claude mod toggle unverified live.
5. **Physical QA for v0.19 and v0.20** (`docs/testing/v019-physical-qa.md`, `v020-physical-qa.md`): unperformed. The
   display state: no Terminal.app windows on screen; the Automation permission was not touched. Synthetic tmux keys do
   not count.
6. **Publication** (only after all gates + explicit approval): v0.19 first (set date and `[0.19.0]` link, flip
   "latest published" pointers in README/ROADMAP/AGENTS/SECURITY/`llms.txt`, rerun dispatch CI, mark #390 ready,
   merge commit, tag, GitHub Release); then rebase nothing: retarget #392 to `master`, merge `master` into
   `release/v0.20.0`, re-verify, and stop again for v0.20 approval. Homebrew needs separate approval.
7. **Not wired, by decision:** sidebar rows for NMSh sessions/managed targets, click-to-select sidebar rows,
   region-aware wheel, #365 explain in the detail panel, Codex control in `harnesses.ts`/`manager.ts`, live
   transcript blocks for task output. Deferred from v0.19: module compaction explanations, external source previews.
8. **Leftover processes:** two idle 2026-10-13 smoke session services (pids 94753, 95205,
   `/Volumes/nmsh-opus/tmp/smoke/run`) still run; stopping them was refused by the permission policy. The maintainer
   can stop them (`kill -TERM 94753 95205`). **Resolved 2026-10-15:** the maintainer's
   `ps -p 94753,95205 -o pid,ppid,command` returned no entries, and this track's own check at 10:19Z agreed. Nothing
   was signalled by this track; nothing is inferred about other processes.
9. Unexplained local failures above remain open records; Codex's historical failures remain Codex's.

## Coordination rules

- Never edit Codex-owned worktrees (`/Volumes/nmsh-t7/*`, `fix/workflow-*`, `feature/*` of the workflow stack), its
  VM, its scratch image or its logs. Read-only `git` inspection of shared objects is fine.
- No competing heavy local suites: check `ps` for `scripts/test.mjs` / `verify-*` before any full run.
- Release-track scratch: `/Volumes/nmsh-opus` (own APFS sparsebundle on the T7 Shield). Codex's `/Volumes/nmsh-t7` is
  a separate 17 GB image with ~8 GB free and its own storage guards; do not consume it.
- No force pushes, history rewrites, branch deletions, PR closures or retargets of other owners' PRs.
- No AI/model attribution in commits, PRs or releases.

## Monitoring

While the freeze is pending: check #359, the workflow PR heads and CI every 30–60 minutes; between checks, only
independent v0.20 preparation. If the freeze has not arrived within the session's monitoring window, update the log
below and stop cleanly with no background processes left.

## Checkpoint log

- 2026-10-13 09:10 IST — Stage 1 inspection complete. Freeze pending (Codex running remaining canonical verification
  for Report). Dry runs recorded above. Scratch image `/Volumes/nmsh-opus` created. No integration started.
  Coordination note posted on #359.
- 2026-10-13 09:45 IST — `integration/v020-modules` `8f07920` built and green on full CI. Smoke-harness
  feasibility recorded. Freeze still pending.
- 2026-10-13 09:35 IST — v0.19 changelog draft pushed (`docs/development/v019-changelog-draft.md`). Smoke harness
  ready; legible window capture blocked by Mission Control + pending dialog (see above). Unless the display
  state changes, the v0.19 real-terminal gate cannot be met unattended, and v0.19 will stop as a release candidate.
- 2026-10-13 10:01 IST — Check: freeze pending; no feature head moved; Codex started
  `verify-late-replay-final-canonical.sh` (09:40) with the Fish 3.7 VM. No action taken.
- 2026-10-13 10:56 IST — Check: freeze pending; all seven PR heads unchanged (`9cfdf9a` `b6fe785` `940b85f`
  `9fb09c9` `032365e` `99019ae` `5993218`); `docs/workflow-oak-checkpoint` still `d4a13c6`; no new #359 comment.
  Codex's late-replay driver still running. Window bounds still thumbnail-scale (Mission Control).
- 2026-10-13 14:17 IST — Check (the 11:51 timer fired late; the machine appears to have slept): freeze still
  pending; all seven PR heads and `docs/workflow-oak-checkpoint` unchanged; no new #359 comment since 03:21Z.
  Codex's `verify-late-replay-final-canonical.sh` (started 09:40) is still running.
  **Monitoring stopped cleanly after ~5 h blocked on the freeze.** No release branch exists and nothing of the
  release track is running. To resume: read this file, re-check #359 for an explicit freeze with exact SHAs,
  then follow "v0.19 steps once frozen" above. `integration/v020-modules` `8f07920` remains the green v0.20 prep base.
- 2026-10-14 22:55 IST — Freeze confirmed (#359 comment 6173699296); all seven remote heads equal the frozen SHAs.
  Leftover release-track smoke services from 2026-10-13 (pids 94753, 95205, `/Volumes/nmsh-opus/tmp/smoke/run`) are still
  running: stopping them was refused by this session's permission policy; harmless (idle, ~2 MB). Maintainer may stop them.
- 2026-10-14 23:00 IST — `release/v0.19.0` created and integrated (`9e85a910`); ownership recorded on #359
  (comment 6174328706); draft PR #390.
- 2026-10-14 23:10 IST — All automated v0.19 gates pass on `9e85a910` (ledger above). v0.19 stops as a verified release
  candidate pending physical QA. v0.20 integration starts on `release/v0.20.0` pinned to `9e85a910`.
- 2026-10-15 04:40 IST — v0.20 RC at `44f4c232`: CI PR + dispatch green; local canonical failed under contention (see ledger). Paused at maintainer request; handover above.
- 2026-10-15 15:49 IST — Resumed. Release image re-attached (it was detached; worktrees intact, clean, at the recorded SHAs; remote heads equal). Old smoke PIDs 94753/95205 confirmed absent. Earlier failed `44f4c232` receipt archived read-only before rerunning.
- 2026-10-15 16:01 IST — `44f4c232` canonical run 2 failed 5/2609; investigated (ledger). Security review of the integration; gate bypasses found.
- 2026-10-15 16:22 IST — `00163da7`, `1861666a`, `c71a4284` pushed (fast-forward). Security subsets pass.
- 2026-10-15 16:31 IST — `c71a4284`: local canonical run 3 pass; PR and dispatch CI pass. All automated v0.20 gates pass on this head. Physical QA for both releases outstanding; maintainer decisions listed in the resumed handover.
