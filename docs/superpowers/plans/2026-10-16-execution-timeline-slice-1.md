# Execution Timeline Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace nested queue chrome with an observed execution timeline and safe discoverable queue controls, stopping at production-renderer visual review.

**Architecture:** Keep CommandQueue/QueueDispatcher as the only dispatch authority. Add bounded session-owned execution facts, negotiated protocol fields and one pure timeline renderer; screenPlan owns geometry and existing motion owns time.

**Tech Stack:** TypeScript, Node >=22, existing node:test/tsx, real node-pty shell fixtures; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-execution-interaction-design.md` (approved with maintainer amendments).

## Global Constraints

- No merge, tag or publication; protected branches/worktrees and QA sessions stay untouched.
- Do not change package version or introduce archived pending-command persistence.
- Preserve persistent zsh/Bash/Fish execution, raw output, hidden-input ownership, exactly-once queue dispatch and passthrough.
- Independent foreground commands begun while paused remain outside the chain and cannot replace its pause reason or resume it.
- Failure policy is captured per chain; interrupts always pause; edits invalidate approval.
- Stop after Slice 1 production-renderer previews at normal/narrow widths; no larger summary/Settings work yet.
- Linux Fish 3.7 typingAfterRead remains unresolved regardless of focused results.

## Review Focus

- An unrelated foreground failure after manual pause must leave chain counts, provenance and pause cause intact (Task 1).
- Clearing pending work while a chain entry runs must not terminate it or claim successful completion (Task 1).
- A stale review transported after a queue edit must be refused by the owner (Task 2).
- A timeline transition must not change PTY dimensions or capture password input (Tasks 3–4).
- Legacy services must fail closed on new review/policy operations (Tasks 2–4).

### Task 1: Observed chain lifecycle

**Files:** Create `src/session/ExecutionTimeline.ts`, `tests/executionTimeline.test.ts`; modify `CommandQueue.ts`, `QueueDispatcher.ts`, both session owners and protocol/client integration.

**Interfaces:** QueueState gains optional revision/timeline; QueueDispatcher emits enriched snapshots. `onExec(command, at?)` and `onPrompt(exitCode, at?, waits?)` consume owner observations. ExecutionTimeline snapshots retain bounded observed outcomes with source, times, counts and terminal cause. No raw output or input is stored here.

- [x] Add failing tests: manual predecessor adopted once; paused independent foreground excluded; success/failure/interrupt; manual clear while running; comment-only submission; bounded results; source timestamps and unknown waits.
- [x] Run `rtk node --import=tsx --test tests/executionTimeline.test.ts`; confirm intended failures.
- [x] Implement observed lifecycle with injected clock and preserve prior pause cause. Capture monotonic elapsed duration and epoch chronology; do not infer subcommand facts.
- [x] Run new tests plus commandQueue/queueConditions; confirm pass.
- [x] Commit coherent owner/model changes after transport validation in Task 2.

### Task 2: Reviewed operations, aliases and captured policy

**Files:** Modify `CommandQueue.ts`, `QueueDispatcher.ts`, `SessionProtocol.ts`, session clients/owners, `slashCommands.ts`, `QueuePanel.ts`, `TerminalApp.ts`, prompt configuration and one existing Settings row; tests in executionTimeline/queueConditions/slashRouting/configuration and a focused review test.

**Interfaces:** QueueOp review precondition carries expected revision; owner rejects stale resume/approve/clear before mutation. New policy operation captures Pause/Continue for future chains. Feature `queue-timeline` is negotiated. `/q` aliases every canonical form; `/qp`, `/qr`, `/qc`, collision-free `/pause` map to canonical operations.

- [x] Add failing assertions for alias parity, policy normalization, old frames and malformed bounds, stale review refusal, interruption under Continue and preserved always/approve behavior.
- [x] Run focused tests and observe failures before implementing their behavior.
- [x] Extend strict transport validation, session stamps and configuration; wire centralized two-step resume/clear review and Esc confirmation without changing foreground-input priority.
- [x] Run focused model/protocol/config/queue/ownership tests; compare against unchanged legacy protocol fixtures.
- [x] Commit session model, transport and safe controls as a coherent checkpoint.

### Task 3: Shared production timeline renderer and geometry

**Files:** Create `src/status/executionTimeline.ts`, renderer tests and deterministic preview script; modify `queueStatus.ts`, `screenPlan.ts`, `TerminalApp.ts`, queue manager and relevant presentation tests.

**Interfaces:** `renderExecutionTimeline(state, columns, rows, options)` returns bounded ANSI rows; options carry now, existing activity glyph/motion policy and review affordance. `withQueueRows` gains explicit placement before activity for the new renderer while preserving legacy fallback. Renderer consumes session facts only.

- [x] Add failing tests for chronological results/running/next, real exit code, pause cause, no connectors, Safe/NO_COLOR, width/height bounds, terminal outcomes and no duplicate animation/time.
- [x] Add geometry assertions for Bottom/Top/Flow, tiny heights, input waits and unchanged ptyRows; run red.
- [x] Implement renderer and shared-plan placement; retain old queue fallback for older services. Reuse activity glyph, duration, divider, palette and finite event feedback. Keep one running glyph, complementary aggregate activity, eight-second transient expiry and last-chain review through manager.
- [x] Run focused renderer/geometry/motion tests; confirm exact raw-copy behavior is unaffected.
- [x] Commit coherent production presentation.

### Task 4: Real-PTY integration and visual checkpoint

**Files:** Create focused real-PTY regression test and production-renderer capture script/evidence; update plan/verification handoff.

**Interfaces:** Existing liveFrontend fixture launches only this worktree's build with private homes and owned service sockets. Captures call the production timeline renderer and screen-plan adapter with deterministic states.

- [x] Add and run real-PTY tests for aliases, safe clear/resume, paused independent foreground provenance and sequential success/failure/interrupt across installed zsh/Bash/Fish.
- [x] Run relevant unchanged input ownership, queue preview/conditions, exact copy and restore tests. Preserve failures without weaker assertions/deadlines.
- [ ] Run `rtk npm run verify:release` with one worker; inspect results and any cleanup failures. No physical QA claim.
- [x] Generate running/success/failure/manual pause/interrupted/completed previews at 80 and 32 columns, including Safe/NO_COLOR. Show actual production output and source SHA.
- [ ] Commit coherent changes and evidence; review whole Slice 1 diff. Do not start Slice 2 before maintainer visual review. Remote feature push/CI may be recorded if connectivity and authorization permit; no merge/tag/publication.

## Execution ledger

- 2026-10-16: Revised design committed at 2639209; inline Slice 1 explicitly authorized by maintainer. Tasks share QueueState/timeline/revision; Task 2 validates Task 1 fields before Task 3 consumes them. No interface conflict found.
- Ruling: this plan covers Slice 1 only. Archived persistence is excluded; summary history/Settings and shared Copy/Actions are retained in the approved specification for later slices.

- Slice 1 implementation: session-owned bounded execution facts and negotiated timeline metadata; centralized aliases and revision-bound controls; captured failure policy in existing Settings; pure production renderer above the existing activity region. No new pending-command archive persistence.
- Focused queue/model/protocol/geometry and real-PTY verification passed before the final individual-clock correction. zsh/Bash/Fish covered sequential persistent state, grouped submissions, Pause/Continue, paused independent failure, approval, interrupt, hidden/single-key input and live reattachment.
- Review found manager approval missing a revision, a pre-exec manual-submission window, attachment revisions surviving controller changes, transient-only PTY resizing, and epoch-based interpolation. Regressions reproduced those defects before corrections; focused owner/frontend tests passed. A further frontend regression reproduced an epoch jump in the new individual timer; it now uses owner-sampled monotonic running duration. Final canonical verification follows.
- Historical iteration failures remain visible: original queue live assertions expected the replaced nested UI; updates assert the new presentation without weaker safety checks. A multiline test counted terminal repaint bytes as executions; diagnostic output showed repeated complete redraws. It now verifies the authoritative raw record and an independent shell side effect, both exactly once. Early new live fixtures polled before the frontend became ready; they now use the established authenticated-start helper sequence and retain failure output. One missing duration import was caught and corrected by build validation. Inherited TERM=dumb/NO_COLOR caused existing color fixtures to fail; documented truecolor test environment passed without changing those fixtures.
- Read-only specialist review was confined to this feature worktree. No physical terminal QA is claimed; Linux Fish 3.7 typingAfterRead remains unresolved.

- First canonical `verify:release` ran the full suite and failed: Ask alias coverage, Setup coverage/order for the new policy, and three unchanged tmux/startup cases. Ask and Setup integration were corrected. The test environment inherited NMSH_RETURN_SESSION and NMSH_HANDOFF_SHELL; the repeated return-session notice was present in the failing terminal output. Follow-up verification removes these host handoff variables only from the private test process; no host session or settings are modified. Preserve the failed run as historical evidence.
- Additional RED→GREEN regressions cover sent-before-exec shell exit (one unobserved submission, pending-only skipped work, no lingering Starting state), code-first narrow failure/interruption reasons, and captured policy disclosure in the existing manager. The shared policy wording also appears in resume review and existing batch/recipe review.
- Final gate environment: `env -u NO_COLOR -u NMSH_RETURN_SESSION -u NMSH_HANDOFF_SHELL TERM=xterm-256color COLORTERM=truecolor NMSH_TEST_CONCURRENCY=2 npm run verify:release`. This is the complete canonical suite with bounded workers and unchanged assertions/budgets. Results for the final committed snapshot are reported in the checkpoint handoff; physical visual review remains outstanding.

- Implementation checkpoint: `80b9736` contains the reviewed Slice 1 code and tests. `verify:fast` passed; focused follow-up covering every failure from the first canonical run passed with unchanged existing tmux/startup assertions after removing inherited handoff variables. Final production captures record this clean source HEAD; subsequent capture/ledger changes are documentation only.
- Visual gate remains pending maintainer review. The committed capture gallery is the checkpoint evidence; no later slice has started. Final exact-head canonical/CI results belong to the checkpoint handoff and linked CI run, without changing this source snapshot during verification.
