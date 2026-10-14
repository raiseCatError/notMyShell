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
