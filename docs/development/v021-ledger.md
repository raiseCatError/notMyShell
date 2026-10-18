# v0.21 ledger

Durable state of the v0.21 candidate ([#410](https://github.com/raiseCatError/notMyShell/issues/410)) so a later
session can resume without rediscovering it. Design and acceptance: [v0.21 design](../design/v021-terminal-intelligence.md).
Automated results here are not physical-terminal validation.

## Baseline (verified 2026-10-18)

- `master` = `dev` = `6af5cbab`; latest release v0.20.0 (`65e4de55`); CI green on both.
- Open PRs: draft #394 (`/track` first slice, based on an older line; reconciled by hand in slice 5, not merged).
- Work happens in disposable worktrees under `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/`; scratch on the T7.

## Slices

| # | Slice | Issues | Branch / PR | Merged commit | State |
| --- | --- | --- | --- | --- | --- |
| 0 | Design and ledger | #410 | `docs/v021-design` / [#411](https://github.com/raiseCatError/notMyShell/pull/411) → `dev` | | PR open, CI green |
| 1 | Reliability gates | #403, #408, #388 | `fix/v021-reliability` / [#412](https://github.com/raiseCatError/notMyShell/pull/412) → #411 | | PR open, CI green |
| 2 | `/view` | #397, #402 | `feature/v021-view` / [#413](https://github.com/raiseCatError/notMyShell/pull/413) → #412 | | PR open, CI green |
| 3 | `/edit` | #402 | `feature/v021-edit` / [#414](https://github.com/raiseCatError/notMyShell/pull/414) → #413 | | PR open, CI green |
| 4 | Semantic Output | #386 | `feature/v021-semantic` / [#415](https://github.com/raiseCatError/notMyShell/pull/415) → #414 | | PR open, CI green (one rerun) |
| 5 | `/track` | #393 (#394) | `feature/v021-track` / [#416](https://github.com/raiseCatError/notMyShell/pull/416) → #415 | | PR open, CI green |
| 6 | Modules and diagnostics | #364, #365 | `feature/v021-modules` / [#417](https://github.com/raiseCatError/notMyShell/pull/417) → #416 | | PR open, CI green (one rerun) |
| 7 | Themes and controls | #401, #336 | `feature/v021-themes` / [#418](https://github.com/raiseCatError/notMyShell/pull/418) → #417 | | PR open, CI green |
| 8 | Checkpoint ledger | #410 | `docs/v021-checkpoint` / [#419](https://github.com/raiseCatError/notMyShell/pull/419) → #418 | | PR open, CI green |
| 9 | `/track` refresh and finalization lifecycle | #393 | `fix/v021-track-review-hardening` / [#420](https://github.com/raiseCatError/notMyShell/pull/420) → #419 | | PR open, CI green |
| 10 | `/track` review: repetition safety gate, process cleanup, presentation | #393 | `fix/v021-stabilize` / [#421](https://github.com/raiseCatError/notMyShell/pull/421) → #420 | | PR open, CI green |
| 11 | Flaky CI at the cause | #410 | `fix/v021-flaky-tests` / [#422](https://github.com/raiseCatError/notMyShell/pull/422) → #421 | | PR open, CI green |
| 12 | Bugs: #388 wrapped rows, command colors after a slow zshrc, #365 width | #388, #408, #365 | `fix/v021-bugs` / [#423](https://github.com/raiseCatError/notMyShell/pull/423) → #422 | | PR open, CI green |
| 13 | Stabilization ledger (this) | #410 | `docs/v021-stabilization` → #423 | | PR open |

## Decisions

- #403 is a test-fixture race (Fish's detached completion generator), not a product leak; the fix makes test homes
  hermetic rather than adding retries.
- #408 is a production race in `SemanticService` (superseded lookups resolved `unknown`), plus a test that raced the
  real shell's startup knowledge.
- `/track` stays window-owned like `/watch` in v0.21; service-owned scheduling is deferred and documented.
- PR #394's `WatchTasks.ts`/`WatchPanel.ts` were adopted as written (neither file changed on `dev` since its base) and
  its tests kept; its other edits were re-applied by hand. #394 itself is superseded by the slice 5 PR and was not merged.
- #336: the editor's unsaved-changes and conflict dialogs use the existing `src/ui/actionControls.ts` renderer (slice 3);
  no other v0.21 surface needed a new control, so no further consolidation was made.
- #401: Oxocarbon, GitHub Primer, Material/Palenight and Monokai were deferred (see theme-families.md for why).
- `/track` samples run `sh -c` (as `/watch` always has) with the live shell's PATH, not the session shell, so `/watch`
  semantics stay the same for Fish users.

## Physical QA still required

Checklist: [v0.21 physical QA](../testing/v021-physical-qa.md). Slice 1: section 1 (multi-row progress in Ghostty
and Terminal.app, queued highlight colors). Slice 2: section 2 (`/view` keys, rendering, refusals, hostile text,
NO_COLOR). Slice 3: section 3 (`/edit` editing keys, saving, conflicts, refusals). Slice 4: section 4 (overview rows, details
toggle, copy flags, Off). Slice 5: section 5 (`/track` block, refresh, copy, stop, cleanup). Slice 6: section 6 (Bun, Nix, container, reports). Slice 7: section 7 (theme families, filter, contrast, host untouched).

## Verification notes

- Slice 1 evidence: each new regression fails on the unfixed code and passes on the fix (Fish generator present;
  superseded lookup settled `unknown` and the stored line never recolored; 9 of 10 redraw tests fail on the old parser,
  the tenth being the documented unchanged absolute-positioning case). #408 tests passed 16/16 in two concurrent loops.
- Local full `npm run verify` on this 8 GB Mac: run with `NMSH_TEST_TMPDIR` at the T7 storage root
  (`/Volumes/T7Tmp/ai-dev`), never a deeper directory: the runner requires test roots under 32 characters for Unix
  sockets, and a longer root fails the runner self-test, tmux and session-socket tests for environmental reasons.
  Live PTY tests can time out under full-suite load here and pass alone; exact-head CI is the independent gate.

## Open risks

- Merging into `dev`: see "Ordered integration" below. Use regular merge commits, in order.
- #388: absolute rows (`CSI H/f/d`) are deliberately not mapped and scroll regions are not emulated (a program's
  status row below its region is not stored); the contract is explicit and tested (stabilization).
- Nothing in v0.21 has had a physical-terminal pass yet. Every slice issue stays open until its pass is recorded.
- The three CI flakes seen during the stack were fixed at their cause in #422 (two were product defects).

## Integration verification (stack head, 2026-10-18)

Run on `feature/v021-themes` (all eight slices) in a T7 worktree, `NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev`.

- `npm run verify:release`: 3,118 tests, 3,115 pass, 2 skipped, 1 fail. The failure,
  `nativeCaptureLifecycle` "native cancellation reaps a PTY before it can process the initialization command", timed
  out waiting for the inner shell under full-suite load; the file passes 3 of 3 alone. v0.21 does not touch native
  capture.
- `npm run typecheck:bench` passes; `npm run bench:smoke` passes (see "Performance" below).
- CI on each stacked PR (Ubuntu and macOS shards, Node 22 compatibility, Quality): green on #411–#419 at their current
  heads. Flakes seen once each, all in code v0.21 does not change and all passing on rerun: #415's Ubuntu shard hit
  the 10-minute job limit with output stalled in `tests/shellFrameworks.test.ts` (an orphaned Fish process); #417's
  macOS shard failed `tests/backgroundSession.test.ts:92` (task removal timing); #417's Ubuntu shard failed
  `tests/configuredCompletion.test.ts:89` (the helper's private root still present just after a startup timeout).
  Each is worth its own issue.

## Performance

- `npm run bench:smoke` at the stack head (`8bb85d5e`) passed every budget: pty-ready p50 23 ms, service-ready p50
  233 ms, cold context collection p50 48 ms, every-module render p50 39 ms, configured completion warm p50 10 ms,
  `transcript/wrap-present-10000` p50 48 ms, `transcript/wrap-present-100000` p50 467 ms.
- `transcript/wrap-present-100000` is noisy on this 8 GB Mac: a `dev` baseline worktree measured p50 501–606 ms
  across runs, and earlier stack runs 484–1,161 ms with the slow ones not repeating. No consistent regression was
  found. The one per-row cost v0.21 adds, the `/track` live-row lookup, is now skipped entirely when the transcript
  has no trackers (#416).
- Bounded by design and covered by tests: `/view` layout per line (a 1 MB single line no longer takes 17 s), file
  loads (8 MiB / 200,000 lines), `/edit` (1 MiB), Semantic Output recognizers (linear, 2 MiB scanned, 20 items),
  `/track` samples (200 kB, 12 live rows, at most 8 trackers).

## Stabilization (2026-10-18)

A second pass after the stack: every open `type:bug` issue, a joint review of `/track` (#416 and #420), the CI
flakes, and the v0.21 integration. Linux evidence comes from a Debian container (Node 26.12, zsh 5.9, Fish 3.6,
Bash 5.2) whose disk is on the T7 (Colima, `/Volumes/T7Projects/.colima-suma`); macOS from this Mac (Node 26.10,
Fish 4.9.3). Every new regression test was run against the unfixed code first and failed there.

**`/track` review (#421).** Commands started at once and repeated without asking: `echo x > ~/.zshrc 2>/dev/null`
(the shared classifier excused every redirect once `>/dev/null` appeared; paste review called it read-only),
`env rm …`, `npm publish`/`login`/`audit fix`, `npm x`/`pnpm dlx`/`bun x`, `ssh host rm …`, `scp`, `rsync`,
`curl -X POST`/`-d`/`-o`, plain `wget`, `git -c core.fsmonitor=… status`, `git log --output=…`; `npm test 2>&1` was
wrongly refused. A repetition gate (`src/tasks/repeatSafety.ts`) now sits on top of the classifier, and `&>` stays
refused (dash reads it as a background job). A TERM-ignoring child survived `/track stop` because the close handler
cancelled the KILL fallback; leftovers in a sample's process group are now ended. #420's refresh event fires after
the child is wired; a vanished directory is named; many trackers share one summary row; Safe glyphs; result rows
cached per result (1–3 ms to ~0.5 ms per frame with eight large trackers). #420 itself: no re-entrancy, stale
reference or duplicate finalization found.

**Flaky CI (#422).** `backgroundSession.test.ts:92` was a product defect: a cleanly exiting background task showed
"exited, processes left" (and Delete was refused) until its guard confirmed the group empty; the supervisor now
finishes on the guard's verdict. `configuredCompletion.test.ts:89` was a product defect: removing the helper's
private root raced the helper's own `rm -rf` and late pid writes (rmSync threw ENOTEMPTY on macOS, returned with the
directory present on Linux); the root is renamed away first, then removed entry by entry. The 6-minute Ubuntu hang
was a test that stalled past its timeout with a live shell PTY: the runner now preloads a file teardown that ends,
and names, what a file left running. `nativeCaptureLifecycle`: its tight bound no longer covers a cold `tsx` start. A fourth
flake appeared once on `dev` itself (dispatched CI): `codexAdapter.test.ts:84` read the fake Codex server's log when
the turn settled, before the server had read the client's last response; the fixture now forces that order every run
and the helper waits for what the test asserts.

**Bugs (#423).** #388: the live region moved by stored lines while programs count terminal rows, so a redraw over a
wrapped line erased the program's earlier output at narrow widths (parser, real PTY at 40 columns, and through the
frontend); rows are now the terminal's rows. Found verifying #408: a zsh configuration slower than 1.5 s made the
first semantic lookup time out and end the helper, so commands lost their known/unknown color for the session;
lookups are now timed from when the helper reads them. #365: `/modules explain` says when the Rail or Strip left a
module out, or shortened it, for width in the last frame.

**Investigated, not reproducible.** #356 (Fish typeahead after a read): 40/40 on macOS Fish 4.9.3 under 8× parallel
load; 22/22 Linux Fish 3.6 runs that got past startup under 2× load (the other 2 stalled on VM I/O before drawing).
#403: every interactive Fish in tests has a home marked generated; non-interactive uses never start the generator.
#408's generation/re-ask synchronization holds.

**Also checked.** Semantic Output: 99 adversarial input/recognizer combinations up to a 2 MB single line, none over
150 ms. Docker-specific `/track` checks were not run against a Docker daemon of NMSh's own (the only one available
runs the maintainer's containers); `docker system df` stays the one Docker verb allowed at once, by unit test.

**Verification (stabilization).**
- CI on each new PR (#420–#423: macOS and Ubuntu shards, Node 22 compatibility, Quality): green at their heads.
- Full CI dispatched on the stack head, which also runs the Fedora portability subset and both timing smokes:
  `bb210ce5` and the final head `e8411e1a` (test-only changes since), all jobs green on both.
- Timing smoke against `dev` in the same window (dispatched pair, CI runners): Ubuntu `pty-ready` p50 415 vs 416 ms,
  `service-ready` 580 vs 580 ms, `transcript/wrap-present-100000` 811 vs 848 ms; macOS `pty-ready` 28 vs 33 ms,
  `transcript/wrap-present-100000` 1,132 vs 1,165 ms. No consistent regression; single runs vary by more than that.
- The paired `dev` run failed a fourth flake (`codexAdapter.test.ts:84`), fixed in #422 (above).
- Local `npm run verify:release` on this 8 GB Mac could not give a clean full-suite result during the session: the
  machine was shared with other workloads (two container queue workers at about 120% CPU each in the Colima VM, other
  agent sessions, a browser), with load averages of 35–167 and 4.6 GB of swap in use. One run (`bb210ce5`, load 35–67)
  had 3,127 of 3,142 passing, 2 skipped and 13 failures, all live tests timing out (tmux, screen, service lifecycle,
  per-frame budgets) plus two capture tests whose windows included the owner's cold `tsx` start (fixed in #422). All
  seven failing files then passed 69/69 three times in a row at normal load. A clean local run on `dev` after
  integration remains a gate.

## Ordered integration

`dev` is unprotected and allows merge commits; merged branches are not deleted automatically. Merge with regular merge
commits, in order: #411 into `dev`; then for each of #412 … #423 and this ledger PR, retarget it to `dev`
(`gh pr edit N --base dev`), check that its diff shows only its own changes, and merge it (`gh pr merge N --merge`).
Then let `dev` CI pass (push runs include Fedora and both timing smokes) and run `npm run verify:release` on `dev`.

## Release readiness

Not ready to release; ready for integration. Exact-head CI on the stack head `e8411e1a` is green in every job, including
Fedora portability and both timing smokes. Remaining gates, in order:

1. **Integration** (maintainer, or the agent where its permission policy allows): the ordered merges above, #411 to
   #423 and this ledger PR, with regular merge commits; then `dev` CI green on push.
2. **Local `npm run verify:release` on `dev`** at normal machine load (the in-session runs were overloaded; see above).
3. **Physical QA, mandatory and not run**: every pass in the [checklist](../testing/v021-physical-qa.md), in Ghostty
   and Terminal.app, recorded in its results table. Headless PTY tests and CI do not count.
4. Then close the issues whose acceptance is met (#388, #393, #397, #401, #402 viewer and editor phases, #403, #408,
   #364, #365, #386 first phase, #336 where applicable), move `[Unreleased]` to `[0.21.0]` in the changelog, and
   prepare the tag, release notes and distribution. Tagging, the GitHub release, the Homebrew tap and the website
   deploy stay with the maintainer.

Known limitations shipped deliberately: `/track` is window-owned (stops on detach); Semantic Output is its first
phase (no `jc`/`delta` providers); inline absolute cursor positioning is not mapped and scroll regions are not
emulated (#388 contract); the Main Prompt has no per-segment truncation trace (#365); four theme families deferred
(#401); type-ahead *during* a Fish read stays subject to Fish's own editor queries (#356).
