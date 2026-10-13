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

### Workflow stack (#359) — candidates, not accepted heads

From Codex's handoff (`docs/workflow-oak-checkpoint` `d4a13c6`, `docs/development/workflow-stabilization-handoff.md`):

| Track | Accepted / candidate | Published feature head | Status at last check |
| --- | --- | --- | --- |
| Input #348 | `9cfdf9a` | `9cfdf9a` | canonical + published PR CI passed; timing/Fedora passed on candidate CI |
| Queue #357 | `b6fe785` | `b6fe785` | canonical + published PR CI passed |
| Copy #358 | `940b85f` | `940b85f` | canonical + published PR CI passed |
| Report #360 | `7bf0dbe` (local) | `9fb09c9` | canonical ranking p95 failed once (73.2 ms > 60 ms); rerun active |
| Compare #361 | `459d715` (local) | `032365e` | pending canonical + CI |
| Vocabulary #367 (Willow) | `949a367` (local) | `99019ae` | pending |
| References #368 (Maple/Elm) | `3518231` (local) | `5993218` | pending |

Still gating the freeze per #359: latest-head canonical and published CI for the last four, full Linux/Fish 3.7 on
Codex's VM, current-head #363 report/compare security and clipboard acceptance.

**Freeze signal this track waits for:** an explicit statement on #359 (or a handoff document linked from it) that the
frontend is frozen, with exact SHAs for every head above and the verification evidence for them. Until then nothing in
the workflow stack is integrated.

### Pre-integration dry runs (read-only `git merge-tree`, no refs or worktrees)

- `v0.18.0` + References candidate `3518231`: conflict only in `CHANGELOG.md`.
- References `3518231` + Vocabulary `949a367`: **clean** (both contain Indigo `459d715`; neither contains the other).
- The combined workflow candidate + each v0.20 PR head:

| PR | Head | Result |
| --- | --- | --- |
| #370 / #372 / #373 native runtimes, build | `417d105` / `72775e6` / `029fac4` | conflict: `runtimes.ts`, `nmsh.project.json`, `contextCapabilities.test.ts`, `moduleManager.test.ts` (the Ruby/PHP duplicate #385 predicted) |
| #374 Mercurial/Jujutsu | `d7d3488` | conflict: `contextCapabilities.test.ts` |
| #369, #375–#381, #383, #384, #347 | see #385 | clean |

The References candidate already carries the bounded Gemfile pattern (`[ \t]*`, commit `18e94d9`), the same linear
form as #370, so v0.19 does not ship the quadratic parser #385 measured.

All v0.20 candidate PRs (#347, #349, #369, #370, #372–#381, #383, #384) had green CI (CI, Verify 22.x, Verify 26.x) on
their current heads on 2026-10-13.

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
- Therefore a smoke run here exercises real Terminal.app rendering through tmux with synthetic keys. Whether that
  satisfies the v0.19 real-terminal gate is recorded explicitly with the run; direct-keyboard Ghostty/Terminal.app
  use remains maintainer physical QA either way.

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
