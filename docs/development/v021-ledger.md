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
| 8 | Checkpoint (this ledger) | #410 | `docs/v021-checkpoint` → #418 | | PR open, CI green |

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

- Merging into `dev` needs the maintainer (the agent's merge was refused by its permission policy). Slices are
  stacked PRs; merge them in order, each squashed.
- #388: programs that position rows absolutely inline (rare) still append; recorded in the design.
- Nothing in v0.21 has had a physical-terminal pass yet. Every slice issue stays open until its pass is recorded.
- Three CI flakes outside v0.21's changes were seen once each (below); none reproduced on rerun.

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

## Release readiness

Ready for the maintainer's decision, not for release. Before a v0.21 tag: merge #411→#418 in order (then this
checkpoint), let `dev` CI pass, run the [physical QA](../testing/v021-physical-qa.md) passes and record them, then
close the slice issues whose passes succeed. Tagging, the GitHub release, the Homebrew tap and the website deploy
stay with the maintainer.
