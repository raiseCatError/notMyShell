# v0.22 ledger

Durable state of the v0.22 candidate (#431) so a later session can resume without rediscovering it. Design and
acceptance: [v0.22 design](../design/v022-daily-use.md). Automated results here are not physical-terminal validation.

## Baseline (verified 2026-10-18)

- `dev` = `a8b383c2` (v0.21 integrated, plus #425, #427, #428). `master` = `6af5cbab` (v0.20.0 line), an ancestor of
  `dev`. `release/v0.21.0` = `d9e08393` (`dev` at `433af8fd` plus the candidate commit).
- PR #430 (`dev` → `release/v0.21.0`) has merged: merge commit `86bb3a6c` (dated 22:02 IST), which contains `dev`
  `a8b383c2`. GitHub still reported it open when this session first checked. Draft PR #429 is the v0.21 release.
- **v0.22 PRs stay draft against `dev` until v0.21 ships**: a fix v0.21's QA needs lands on `dev` and reaches the
  release by another `dev` → release merge, which would carry anything v0.22 merged earlier. Nothing in v0.22
  touches `release/v0.21.0`, its QA evidence, `master` or publishing.
- Worktree: `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/v022` (APFS volume `T7Tmp`, UUID
  `62D4E8A9-087C-4927-A62F-25BB88B7F1C7`); unfixed comparison worktree `…/v022-base` (detached at `a8b383c2`).
  Scratch and evidence: `/Volumes/T7Tmp/ai-dev/scratch/v022/`. Tests run with `NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev`.

## Slices

| # | Slice | Issues | Branch / PR | State |
| --- | --- | --- | --- | --- |
| 0 | Design, ledger, NL proposal | #431, #432 | `docs/v022-design` / #435 (this ledger's PR) | Draft PR |
| R1 | Input ownership under load | #426 | `fix/v022-input-ownership-look` / #433 | Draft PR; redesigned after review (held keys never fall through on a timeout) |
| R3 | Type-ahead eaten after Ctrl+C or a slow prompt hook | #436 | `fix/v022-ctrlc-type-ahead` / #437 | Draft PR; two mechanisms reproduced and fixed, the race family not declared solved |
| R2 | Fish keys after a handed-over read | #356 | — | Not reproduced (32/32 at 8×); left open, deferred |
| U1 | `/view` → open in editor | #366 | `feature/v022-view-open-editor` / #434 | Draft PR |
| D1 | History browsing, one step per entry | #389 | `feature/v022-history-browse` / #438 | Draft PR (approved as D1) |
| D1b | `History n/N` on a free composer rule | #389 | `feature/v022-history-position` / #441, based on #438 | Draft PR |
| D3 | Choose a terminal editor | #366 | `feature/v022-editor-choice` / #439 | Draft PR (approved as D3) |
| D2 | Ask command suggestions, local model only | #432 | `feature/v022-ask-command-suggestions` / #440 | Draft PR (approved as D2); remote BYOK is a later PR after a security review |

## Decisions

- **Maintainer decisions (2026-10-18):** D1 (#389) approved, with the position indicator as a separate slice that uses
  an existing composer edge. D2 (#432) approved as optional: deterministic Ask stays the default, suggestions are Off
  by default, the local model comes first, remote Anthropic/OpenAI-compatible keys (by environment-variable name only)
  come later after a security review, consumer subscriptions are never API credentials, and suggestions are display
  only (Insert is deliberate, Enter runs). D3 (#366) approved: discover installed terminal editors, keep explicit
  preferences first, never install anything.
- **#426: held keys wait for the owner; a timeout is not a route.** The first version routed held text after 5 s and
  on a failed probe, so a password typed for a slow `read -s` or `sudo` could reach the shell as a command. Now:
  - After 5 s without an answer, NMSh looks once more. If it still cannot tell, the keys stay held and the composer
    says so: Ctrl+S sends them to the program, Tab shows them, Esc discards them.
  - Ctrl+C discards held keys, and the command ending routes them as typed.
  - A probe that fails or is unavailable counts as "cannot tell", never as "the shell".
  - Echo-off canonical input is a hidden request.

  12 adversarial regressions fail on the first version (`6958c277`).
- **#426: a runnable first sample is inconclusive.** One sample of a process on a CPU with nothing to compare no longer
  ends a look; when the shell holds its terminal the follow-up decides. Every other evidence path is unchanged.
- **macOS has no kernel read report.** `ps -o wchan` prints `-` for every process on macOS 27 (checked: zsh/bash
  `read`, `cat`, `sleep`, a busy loop, Python `select`, Node stdin), so the two-sample rule stays on macOS.
- **#436: two mechanisms, both reproduced and explained.**
  1. A late input request from the interrupted command arrived after Ctrl+C and took the next typed command as its
     answer. A request older than the stop is now ignored, but only while typing still counts as type-ahead (2 s);
     after that it is re-applied if it is still the latest state.
  2. A slow prompt hook (zsh `precmd`, Bash `PROMPT_COMMAND`, Fish `fish_prompt`) looked like the finished command
     reading input. Each shell now emits an authenticated `done` marker before its other hooks, and it ends the
     look.

  The first hypothesis (the shell's read swallowed the line) was wrong; temporary instrumentation found both, and was
  removed. The wider family of input-timing races is not declared solved.
- **D2: NMSh's label is its own and conservative.** A review found `echo $(rm -rf ~)` labelled "reads only".
  - "Reads only" now needs every part to be plainly read-only: no substitution, no wrapper (`env`, `xargs`…), no
    `find` action, and nothing the `/track` gate questions.
  - The note leads with NMSh's verdict and quotes the model, attributed. An explanation that mentions NMSh is
    rejected.
- **Every new setting is reachable from Setup.** The Setup coverage audit caught D2's and D3's new rows missing from
  Setup; both were added (D3 as a route to the editor chooser).
- **Paused/deferred issues stay as they are** (#330–#332, #337–#340, #333–#335, #341, #398, #399, #304, #296, #15).

## Verification notes

Full canonical `npm run verify` (local, macOS 27, T7 scratch), with the load average at the time:

| PR | Head | Result |
| --- | --- | --- |
| #433 | `e566a1e6` | 3,161 tests, 3,159 pass, 2 skipped, 0 failed |
| #437 | `9aae2f03` | 3,149 tests, 3,147 pass, 2 skipped, 0 failed |
| #437 | `83135298` | 6 live tests timed out at load 20–23; all 6 files 46/46 on rerun. A clean full run is pending |
| #434 | `5d81d93e` | 3,148 tests, 3,146 pass, 2 skipped, 0 failed (load 4–13) |
| #438 | `29d73a69` | 3,143 pass, 1 live timeout (load 9–20); 16/16 rerun at load 5 |
| #439 | `4ab9f44a` | 3 Setup coverage failures (fixed in `898fbc33`), 2 live timeouts (16/16 rerun); a fresh full run is pending |
| #440 | `c1a30017` | pending |
| #441 | `48f70e96` | pending; the new tests and nearby suites pass |

- **CI:**
  - #434, #437, #438, #439 and #440: green.
  - #433's latest run (`e566a1e6`) failed one Ubuntu Fish live test: a queued `printf` got `write: Interrupted
    system call`. The diff changes no signal or resize path, and the test types nothing that would be held. The
    failed jobs were rerun; the result is recorded on #433.
- **R1 live:** 4 copies of `tests/inputOwnershipLive.test.ts` in parallel. The unfixed baseline reproduced #426
  under memory pressure, both as a queued answer and as a drawn hidden reply.
- **CPU contention alone does not reproduce #426:** at load 64 a probe (`stty` + `ps`) took 10 ms p50 and 39 ms
  max. The slow looks came with 5–7 GB of swap.
- **#436:** reproduced 6/8 and 4/8 on `dev` with live runs, and deterministically with a slow prompt hook at load 3.
  `tests/ctrlCTypeAhead.test.ts` and `tests/promptHookLive.test.ts` (live zsh and Bash) fail before the fix.
- **R2 (#356):** Fish 4.9.3, 8 copies in parallel, four rounds: 32/32. A 16-copy run failed at startup in every
  copy (environmental).
- **Environment, not product:**
  - A Finder window on the T7 makes `LiveSandbox.dispose`'s `lsof +D` time out.
  - Spotlight indexing (`mds_stores`) and load above about 20 stall live-test startup on every build.
  - Live tests started while another full run is going time out waiting for the first prompt.

## Physical QA still required

Checklist: [v0.22 physical QA](../testing/v022-physical-qa.md), one pass per PR. Nothing in v0.22 has had a physical
pass.

## Open risks

- v0.21 unreleased: v0.22 cannot integrate into `dev` yet (see the rule above). All v0.22 PRs stay draft.
- #441 is based on #438 and must merge after it.
- #439 and #434 both use the host-actions bridge; whichever merges second picks up the other.
- #436 fixes two explained mechanisms; other timing races in input ownership may remain.
- The changelog entries sit in `dev`'s `[Unreleased]` beside v0.21's and move at reconciliation.
