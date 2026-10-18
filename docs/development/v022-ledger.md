# v0.22 ledger

Durable state of the v0.22 candidate (#431) so a later session can resume without rediscovering it. Design and
acceptance: [v0.22 design](../design/v022-daily-use.md). Automated results here are not physical-terminal validation.

## Baseline (verified 2026-10-18)

- `dev` = `a8b383c2` (v0.21 integrated, plus #425, #427, #428). `master` = `6af5cbab` (v0.20.0 line), an ancestor of
  `dev`. `release/v0.21.0` = `d9e08393` (`dev` at `433af8fd` plus the candidate commit).
- PR #430 (`dev` → `release/v0.21.0`) was open at the start of the session and merged at 22:02 IST the same day:
  `release/v0.21.0` = `86bb3a6c`, which contains `dev` `a8b383c2`. Draft PR #429 is the v0.21 release.
- **v0.22 PRs stay draft against `dev` until v0.21 ships**: a fix v0.21's QA needs lands on `dev` and reaches the
  release by another `dev` → release merge, which would carry anything v0.22 merged earlier. Nothing in v0.22
  touches `release/v0.21.0`, its QA evidence, `master` or publishing.
- Worktree: `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/v022` (APFS volume `T7Tmp`, UUID
  `62D4E8A9-087C-4927-A62F-25BB88B7F1C7`); unfixed comparison worktree `…/v022-base` (detached at `a8b383c2`).
  Scratch and evidence: `/Volumes/T7Tmp/ai-dev/scratch/v022/`. Tests run with `NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev`.

## Slices

| # | Slice | Issues | Branch / PR | State |
| --- | --- | --- | --- | --- |
| 0 | Design, ledger, NL proposal | #431, #432 | `docs/v022-design` (this ledger's PR) | Draft PR |
| R1 | Input ownership under load | #426 | `fix/v022-input-ownership-look` / #433 | Draft PR; local full verify and CI green |
| R2 | Fish keys after a handed-over read | #356 | — | Investigation |
| U1 | `/view` → open in editor | #366 | `feature/v022-view-open-editor` / #434 | Draft PR; local full verify green |
| D1 | Multiline history browsing | #389 | — | Reproduced; awaiting maintainer decision |
| D2 | Natural-language command suggestions | #432 | — | Proposal; awaiting maintainer decision |

## Decisions

- **#426: hold until the owner is known, not the issue's split example.** Routing text at 800 ms and holding only the
  Enter fixes queueing but still draws a hidden reply whenever the look is slow (prompt-less `read -s`, prompted
  `sudo`/`ssh`). The unfixed baseline failed the live "hidden answer is never drawn" assertion that way under load.
  Held keys now wait for the look (bounded at 5 s) with a composer note after 800 ms. Cost only on a loaded machine.
- **#426: a runnable first sample is inconclusive.** One sample of a process on a CPU with nothing to compare no longer
  ends a look; when the shell holds its terminal the follow-up decides. Every other evidence path is unchanged.
- **macOS has no kernel read report.** `ps -o wchan` prints `-` for every process on macOS 27 (checked: zsh/bash
  `read`, `cat`, `sleep`, a busy loop, Python `select`, Node stdin), so the two-sample rule stays on macOS.
- **#389 needs a decision, not a guess.** Reproduced on `dev`; the maintainer triaged it as working in practice and a
  test codifies the current behavior, so the change waits for an explicit yes.
- **NL suggestions are a product-direction question** (remote model APIs vs. the ROADMAP principle). Proposal only.
- **Paused/deferred issues stay as they are** (#330–#332, #337–#340, #333–#335, #341, #398, #399, #304, #296, #15).

## Verification notes

- R1 regressions: 7 tests fail on `a8b383c2` and pass on the fix (`tests/inputOwnershipLook.test.ts`, the #426 watch
  test in `tests/inputAwareness.test.ts`). On the unfixed code a password typed at once for a prompt-less `read -s`
  is queued as a shell command when the look outlasts 800 ms.
- R1 live, 4 copies of `tests/inputOwnershipLive.test.ts` in parallel (load and swap from other work on the machine):
  the unfixed baseline reproduced #426 itself (load 33–121: `timed out waiting for ANSWER=hello`, status
  `Probably waiting for input · zsh · ≡ 1 queued`) and, in another round, a drawn hidden reply (`hidden line after 0
  ms: the hidden answer is never drawn`). The final fix: 15 of 16 copies clean across four rounds (load 3–20). The one
  failure, `a command typed right after a read returns, or right after Ctrl+C` (`timed out waiting for the command
  after Ctrl+C to run`), then passed 18/18 targeted runs (12 of them 4× parallel) on the fix and 18/18 on the baseline;
  it does not exercise held keys (typing after Ctrl+C is type-ahead). Filed as #436 (needs reproduction; possible
  race: Enter right after Ctrl+C writes the line to the PTY before the shell has acted on SIGINT).
- R1 full `npm run verify` on `6958c277` (load 9–14): 3,152 tests, 3,150 pass, 2 skipped, 0 failed. CI on #433
  (macOS and Ubuntu shards, Node 22, Quality, Verify 22.x/26.x): green.
- U1: 5 new tests fail before the change and pass after; full `npm run verify` on `5d81d93e` (load 4–13): 3,148
  tests, 3,146 pass, 2 skipped, 0 failed.
- CPU contention alone does not reproduce #426: at load 64 a probe (`stty` + `ps`) took 10 ms p50, 39 ms max. The
  audit's slow looks came with memory pressure (5–7 GB of swap); this session did not induce swap deliberately.
- Environment, not product: a Finder window on the T7 makes `LiveSandbox.dispose`'s `lsof +D` see Finder (pid 44738)
  as a sandbox process and time out; a round at load ~20 stalled every frontend's startup on both builds.

## Physical QA still required

Checklist: [v0.22 physical QA](../testing/v022-physical-qa.md). Pass 1 for R1 (#433), pass 2 for U1 (#434). Nothing in
v0.22 has had a physical pass.

## Open risks

- v0.21 unreleased: v0.22 cannot integrate into `dev` yet (see the rule above).
- The changelog entries sit in `dev`'s `[Unreleased]` beside v0.21's and move at reconciliation.
