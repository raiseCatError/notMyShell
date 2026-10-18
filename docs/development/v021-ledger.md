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
| 0 | Design and ledger | #410 | `docs/v021-design` / #411 | | PR open, CI green; awaiting merge |
| 1 | Reliability gates | #403, #408, #388 | `fix/v021-reliability` (stacked on #411) | | PR open |
| 2 | `/view` | #397, #402 | | | |
| 3 | `/edit` | #402 | | | |
| 4 | Semantic Output | #386 | | | |
| 5 | `/track` | #393 (#394) | | | |
| 6 | Modules and diagnostics | #364, #365 | | | |
| 7 | Themes and controls | #401, #336 | | | |

## Decisions

- #403 is a test-fixture race (Fish's detached completion generator), not a product leak; the fix makes test homes
  hermetic rather than adding retries.
- #408 is a production race in `SemanticService` (superseded lookups resolved `unknown`), plus a test that raced the
  real shell's startup knowledge.
- `/track` stays window-owned like `/watch` in v0.21; service-owned scheduling is deferred and documented.

## Physical QA still required

Checklist: [v0.21 physical QA](../testing/v021-physical-qa.md). Slice 1: section 1 (multi-row progress in Ghostty
and Terminal.app, queued highlight colors).

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
