# Execution Timeline Slice 2C Implementation Plan — Queued Output Folding and Multiline Paste

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement reversible queued-output folding scoped to queued command provenance, and extend the reviewed multiline paste workflow with a 4-way execution choice (Run as one reviewed block, Queue separately, Edit in composer, Cancel), stopping at the verified 2C checkpoint.

**Architecture:**
- **Queued output folding:** Presentation-only display setting (`inline` [default] vs `fold`) on `PromptConfiguration.queue.outputDisplay`. Handled during command completion in `OutputBuffer.complete({queued, foldQueued, interrupted})`. Successful queued commands start collapsed (`autoFolded: true, expanded: false`). Nonzero exit codes, interrupted commands, foreground commands, and empty output never fold automatically. Complete output, exact raw PTY records, `copyText`, transcript export, journal recovery, and reversibility via `Ctrl+O` (`toggleExpanded`) are preserved verbatim.
- **Multiline paste execution choice:** Integrated into `BatchReviewState` (`choice?: 'block' | 'queue' | 'edit' | 'cancel'`, `refusal?: string`, `verifiedCount?: number`). Navigable via `Left`/`Right`/`Tab`/`Shift+Tab` and direct `1`-`4`/`b`/`c`. Focusing a choice never executes anything. Enter confirms the focused choice. If command separation is refused (syntax check failure or unclosed constructs), `queue` is disabled and clearly explained while `block`, `edit`, and `cancel` remain available. Grouped block execution submits the entire paste as 1 outer execution in the real shell. Shell switching and composer editing invalidate active reviews.

**Tech Stack:** TypeScript, Node >=22, existing node:test/tsx and real node-pty fixtures; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-execution-interaction-design.md` (Slice 2C: queued output display, multiline paste execution choice, safety boundaries).

## Slice scope (2C only)

- Output display preference: `Inline` (default) vs `Fold queued output` on `PromptConfiguration.queue.outputDisplay`.
- Presentation-only queued command folding: successful queued commands start collapsed; failures, interruptions, foreground commands, and empty outputs never fold automatically.
- OutputBuffer & transcript integration: `CompletedCommand.queued?: boolean`, exact `copyText`, complete 400+ line verbatim preservation, `Ctrl+O` toggle reversibility, transcript journal persistence.
- Multiline paste 4-way choice: 1. Run as one reviewed shell block (1 outer execution), 2. Queue separately (N verified top-level statements), 3. Edit (in composer), 4. Cancel (discard).
- Choice navigation (`Left`, `Right`, `Tab`, `Shift+Tab`, `1`-`4`, `b`, `c`) with focus-only updates; Enter confirms; no command runs merely on focus.
- Strict syntax and separation safety: syntax failures or ambiguous syntax refuse queueing with clear explanations while keeping block/edit/cancel available.
- Real-shell single outer execution for reviewed blocks via `runReviewedBlock` -> `submit(true, true, false)`.
- Invalidation on shell switch and composer edit.
- Queue Settings row `queueOutputDisplay` and discovery in `SetupCat`, `queueSettingsPreview`, and `ask/concepts.ts`.
- Excluded and untouched by this slice: Slice 3 (output block selector, `/copy`, `/actions`, Compare navigation), Slice 4 (scrolling prototype & easing), release preparation.

## Global constraints

- No merge, tag or publication; protected branches and other worktrees stay untouched. `package.json` version stays `0.20.0`.
- Persistent real shell session and PTY stdout/stderr presentation safety preserved.
- Automated tests and physical terminal QA remain distinct.
- No semantic recoloring or rewriting of arbitrary PTY output.
- Exact copying (`/copy`, `copyText`) remains plain text without presentation chrome.

### Task 1: Reversible queued-output folding

**Files:** `src/prompt/configuration.ts`, `src/ui/SettingsPanel.ts`, `src/setup/SetupCat.ts`, `src/status/queueSettingsPreview.ts`, `src/output/OutputBuffer.ts`, `src/sessions/TranscriptStore.ts`, `src/app/TerminalApp.ts`; tests in `tests/queueSettings.test.ts`, `tests/queueOutputFolding.test.ts`.

- [x] Add `QUEUE_OUTPUT_DISPLAYS = ['inline', 'fold']`, `QueueOutputDisplay`, `QUEUE_OUTPUT_DISPLAY_LABELS` and `outputDisplay` on `QueuePresentationSettings`.
- [x] Add `queueOutputDisplay` to `SETTINGS_ROWS` and `QUEUE_SETTINGS_ROW_IDS`.
- [x] Add `queued?: boolean` to `CompletedCommand` and handle `{foldQueued, queued, interrupted}` in `OutputBuffer.complete()`.
- [x] Wire `TerminalApp` command completion to pass `foldQueued` and `isQueued`, suppressing `adviseFolding` on queued commands.
- [x] Verify complete 400+ line preservation, tabs, Unicode, trailing newlines, `Ctrl+O` reversibility, transcript restore, and failure/interruption/foreground immunity.

### Task 2: Multiline paste execution choices in BatchReview

**Files:** `src/input/BatchReview.ts`; tests in `tests/pasteBatchApp.test.ts`, `tests/pasteBatchChoice.test.ts`.

- [x] Add `BatchChoice = 'block' | 'queue' | 'edit' | 'cancel'` and `BATCH_CHOICES`.
- [x] Add `choice?: BatchChoice`, `refusal?: string`, `verifiedCount?: number` to `BatchReviewState`.
- [x] Implement `batchAvailableChoices(state)` and `createBatchReviewWithRefusal(source, shell, capacity, refusal)`.
- [x] Implement choice navigation (`Left`, `Right`, `complete` [Tab], `focusPrevious` [Shift+Tab], `1`-`4`, `b`, `c`) in `batchReviewKey`.
- [x] Implement dynamic confirmation on Enter (`{kind: 'block'}`, `{kind: 'queue'}`, `{kind: 'edit'}`, `{kind: 'cancel'}`).
- [x] Render choice pills, verified statement count, refusal explanation, and dynamic Enter control in `renderBatchReview`.

### Task 3: TerminalApp integration, refusal handling & invalidation

**Files:** `src/app/TerminalApp.ts`; tests in `tests/pasteBatchChoice.test.ts`, `tests/pasteBatchApp.test.ts`, `tests/pasteBatchLive.test.ts`.

- [x] Handle `{kind: 'block'}` via `this.runReviewedBlock(review.source)` (1 outer execution).
- [x] Handle `{kind: 'edit'}` and `{kind: 'cancel'}` in `batchReview` key handler.
- [x] Update `openBatchReview` to open refusal review when split or syntax check fails.
- [x] Invalidate `batchReview`, `pasteReview`, and `pastePreview` on shell switch in `switchShell`.
- [x] Invalidate `pastePreview` on composer edit/typing.

### Task 4: Evidence & verification

**Files:** `scripts/dev/queue-slice-2c-preview.ts`, `docs/development/execution-timeline-slice-2c/`.

- [x] Generate deterministic visual captures: Queue settings (`inline` vs `fold`), 4-way choices (`queue`, `block`, `edit`), refusal display, 50x20 narrow terminal, safe glyphs.
- [x] Focused test suites (94/94 passing).
- [x] Fast verification (`npm run verify:fast`).
- [x] Canonical verification (`npm run verify:release`).
- [x] Stop at completed Slice 2C checkpoint.

## Execution ledger

- 2026-10-16: Maintainer authorized Slice 2C on `feature/post-v020-execution-ux` starting from confirmed checkpoint `8a6ac8f7`.
- Task 1 implemented: `QueueOutputDisplay` setting, normalization, Settings row, `OutputBuffer` queued folding options, transcript serialization, and TerminalApp integration. 10/10 focused tests passing in `tests/queueOutputFolding.test.ts`.
- Task 2 implemented: `BatchChoice`, `createBatchReviewWithRefusal`, `batchAvailableChoices`, choice navigation in `batchReviewKey`, and choice pills rendering in `renderBatchReview`.
- Task 3 implemented: `runReviewedBlock` 1 outer execution submission, refusal review display, review invalidation on shell switch and composer edit in `TerminalApp`. 9/9 focused tests passing in `tests/pasteBatchChoice.test.ts`.
- Regression check: 94/94 tests passing across all affected suites (`tests/queueOutputFolding.test.ts`, `tests/pasteBatchChoice.test.ts`, `tests/pasteBatchApp.test.ts`, `tests/pasteBatch.test.ts`, `tests/pasteReview.test.ts`, `tests/pasteBatchLive.test.ts`, `tests/queueSettings.test.ts`, `tests/queueSummaryLive.test.ts`, `tests/queueHistoryApp.test.ts`).
- Evidence generated: `scripts/dev/queue-slice-2c-preview.ts` produced ANSI captures and markdown documentation in `docs/development/execution-timeline-slice-2c/`.
