# Input ownership implementation plan

> Implement inline using executing-plans; use independent review at the end.

**Goal:** safely recover ambiguous answers through explicit confirmation.
**Architecture:** localized TerminalApp ownership hold; unchanged InputWatch/protocol/service approval semantics.
**Tech stack:** existing TypeScript/Node/PTYS.
**Spec:** ../specs/2026-10-28-input-ownership-design.md

## Constraints and review focus
No automatic merge/release, no changes to PR513, no deadline/CI relaxation. Check combined and separate holds, late likely/hidden evidence, cancellation leaving editor drafts, owner/lifecycle invalidation, and explicit queue intent.

## Task 1: ownership quarantine
- [x] Add deterministic tests in inputOwnershipLook.test.ts for explicit confirmation, late inference, completion, cancellation, queue and ordering. Run on unchanged source and retain expected failures.
- [x] Add confirmation hold state and atomic draft capture in TerminalApp.ts. Guard late state routing and lifecycle transitions; preserve older-service behavior and explicit actions.
- [x] Run affected unit and real-PTY tests; document changed Enter semantics in input-awareness.md.

## Task 2: validation checkpoint
- [x] Controlled real-PTY old-red/new-green, immediate/delayed reads/password/non-reader/unknown cases; bounded stress.
- [x] Independent whole-change review and address safety findings; full npm run verify.
- [ ] Commit/push focused branch and open dev PR. Obtain exact-head hosted CI once, no retries for green. Keep unmerged.
- [ ] Report exact evidence/risks, unchanged PR513 and performance observations; leave separate deferred resource investigation plan.

## Ledger
Fresh dev c690de05; primary checkout unchanged. Design reviewed before implementation. Native owner change cancels quarantine before handover to preserve privacy/order.

Final local ledger: canonical `npm run verify` passed with TERM=xterm-256color, COLORTERM=truecolor, NO_COLOR unset and NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev. The longer T7 path's two unchanged test failures were reproduced on exact dev and resolved by the shortest compliant root, without test changes. Fixed two-round/two-worker PTY stress passed; original source fails the controlled approval-enqueue assertion and corrected source recovers exactly once with Ctrl+S. Independent findings are addressed. Completion retains review-only typing rather than losing it; combined submissions are guarded after the real editor/action parser; merely likely hidden ownership never releases held bytes. Hosted results belong to the PR checkpoint. No automatic merge.
