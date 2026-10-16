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

- [ ] Add failing tests: manual predecessor adopted once; paused independent foreground excluded; success/failure/interrupt; manual clear while running; comment-only submission; bounded results; source timestamps and unknown waits.
- [ ] Run `rtk node --import=tsx --test tests/executionTimeline.test.ts`; confirm intended failures.
- [ ] Implement observed lifecycle with injected clock and preserve prior pause cause. Capture monotonic elapsed duration and epoch chronology; do not infer subcommand facts.
- [ ] Run new tests plus commandQueue/queueConditions; confirm pass.
- [ ] Commit coherent owner/model changes after transport validation in Task 2.

### Task 2: Reviewed operations, aliases and captured policy

**Files:** Modify `CommandQueue.ts`, `QueueDispatcher.ts`, `SessionProtocol.ts`, session clients/owners, `slashCommands.ts`, `QueuePanel.ts`, `TerminalApp.ts`, prompt configuration and one existing Settings row; tests in executionTimeline/queueConditions/slashRouting/configuration and a focused review test.

**Interfaces:** QueueOp review precondition carries expected revision; owner rejects stale resume/approve/clear before mutation. New policy operation captures Pause/Continue for future chains. Feature `queue-timeline` is negotiated. `/q` aliases every canonical form; `/qp`, `/qr`, `/qc`, collision-free `/pause` map to canonical operations.

- [ ] Add failing assertions for alias parity, policy normalization, old frames and malformed bounds, stale review refusal, interruption under Continue and preserved always/approve behavior.
- [ ] Run focused tests and observe failures before implementing their behavior.
- [ ] Extend strict transport validation, session stamps and configuration; wire centralized two-step resume/clear review and Esc confirmation without changing foreground-input priority.
- [ ] Run focused model/protocol/config/queue/ownership tests; compare against unchanged legacy protocol fixtures.
- [ ] Commit session model, transport and safe controls as a coherent checkpoint.

### Task 3: Shared production timeline renderer and geometry

**Files:** Create `src/status/executionTimeline.ts`, renderer tests and deterministic preview script; modify `queueStatus.ts`, `screenPlan.ts`, `TerminalApp.ts`, queue manager and relevant presentation tests.

**Interfaces:** `renderExecutionTimeline(state, columns, rows, options)` returns bounded ANSI rows; options carry now, existing activity glyph/motion policy and review affordance. `withQueueRows` gains explicit placement before activity for the new renderer while preserving legacy fallback. Renderer consumes session facts only.

- [ ] Add failing tests for chronological results/running/next, real exit code, pause cause, no connectors, Safe/NO_COLOR, width/height bounds, terminal outcomes and no duplicate animation/time.
- [ ] Add geometry assertions for Bottom/Top/Flow, tiny heights, input waits and unchanged ptyRows; run red.
- [ ] Implement renderer and shared-plan placement; retain old queue fallback for older services. Reuse activity glyph, duration, divider, palette and finite event feedback. Keep one running glyph, complementary aggregate activity, eight-second transient expiry and last-chain review through manager.
- [ ] Run focused renderer/geometry/motion tests; confirm exact raw-copy behavior is unaffected.
- [ ] Commit coherent production presentation.

### Task 4: Real-PTY integration and visual checkpoint

**Files:** Create focused real-PTY regression test and production-renderer capture script/evidence; update plan/verification handoff.

**Interfaces:** Existing liveFrontend fixture launches only this worktree's build with private homes and owned service sockets. Captures call the production timeline renderer and screen-plan adapter with deterministic states.

- [ ] Add and run real-PTY tests for aliases, safe clear/resume, paused independent foreground provenance and sequential success/failure/interrupt across installed zsh/Bash/Fish.
- [ ] Run relevant unchanged input ownership, queue preview/conditions, exact copy and restore tests. Preserve failures without weaker assertions/deadlines.
- [ ] Run `rtk npm run verify:release` with one worker; inspect results and any cleanup failures. No physical QA claim.
- [ ] Generate running/success/failure/manual pause/interrupted/completed previews at 80 and 32 columns, including Safe/NO_COLOR. Show actual production output and source SHA.
- [ ] Commit coherent changes and evidence; review whole Slice 1 diff. Do not start Slice 2 before maintainer visual review. Remote feature push/CI may be recorded if connectivity and authorization permit; no merge/tag/publication.

## Execution ledger

- 2026-10-16: Revised design committed at 2639209; inline Slice 1 explicitly authorized by maintainer. Tasks share QueueState/timeline/revision; Task 2 validates Task 1 fields before Task 3 consumes them. No interface conflict found.
- Ruling: this plan covers Slice 1 only. Archived persistence is excluded; summary history/Settings and shared Copy/Actions are retained in the approved specification for later slices.
