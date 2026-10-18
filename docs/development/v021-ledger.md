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
| 0 | Design and ledger | #410 | | | in progress |
| 1 | Reliability gates | #403, #408, #388 | | | |
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

Recorded per slice when it merges.

## Open risks

None recorded yet.
