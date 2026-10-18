# Execution Timeline Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the execution timeline a discoverable Settings destination (`/settings queue`, `/queue settings`) with normalized, portable presentation controls and production-renderer previews, stopping at the 2A checkpoint.

**Architecture:** Reuse the existing Settings system — canonical rows in `SettingsPanel.ts`, the shared `RowPanel`, one destination route — plus the existing theme, glyph and motion systems. Presentation-only values live on `PromptConfiguration.queue`; the production timeline renderer accepts bounded counts; the app gates the live timeline and the completed view on them. Dispatch, pause, approval, review, ownership, raw output and PTY dimensions are untouched.

**Tech Stack:** TypeScript, Node >=22, existing node:test/tsx and real node-pty fixtures; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-execution-interaction-design.md` (Slice 2, Settings group table).

## Slice scope (2A only)

- Behavior: Queue enabled and the captured failure policy, with the session-ownership and reviewed resume/clear explanation.
- Appearance: Live timeline On by default, recent results 0–2, upcoming entries 1–2, current glyph mode and theme roles through the production preview.
- Motion: links to the existing Rendering, Event feedback and Reduced Motion rows; no second animation system.
- Completed view: transient On with the existing eight-second default, retention configurable 6–30 seconds.
- Configuration normalization, import/export/reset, Settings previews and keyboard navigation.
- Excluded and untouched by this slice: saved summaries/history serialization, output folding, multiline-paste choice, Copy/Actions changes and scrolling (2B/2C/3/4). Archived pending-command persistence stays excluded from the program entirely.

## Global constraints

- No merge, tag or publication; protected branches and other worktrees stay untouched.
- Queue/session authority, observed timestamps, exact raw output, hidden-input ownership, stale-review refusal, legacy protocol behavior and PTY dimensions are unchanged.
- The classic one-line queue row and pending list remain the fallback with the live timeline off.
- Physical Ghostty/Terminal.app QA remains outstanding; Linux Fish 3.7 `typingAfterRead` remains unresolved.

### Task 1: Presentation settings model

**Files:** `src/prompt/configuration.ts`; tests in `tests/queueSettings.test.ts`.

**Interfaces:** `QueuePresentationSettings {liveTimeline, recentResults, upcoming, transient, transientSeconds}` on `PromptConfiguration.queue`; `normalizeQueuePresentation` clamps integers to bounds and falls back to defaults for non-integers and malformed groups; `QUEUE_RECENT_RESULTS_STEPS`/`QUEUE_UPCOMING_STEPS`/`QUEUE_TRANSIENT_SECONDS_STEPS` are the stepper presets.

- [x] RED: defaults (timeline On, two results, two upcoming, transient On for eight seconds), integer bounds, malformed-group fallback.
- [x] Implement the interface, defaults, normalization and stepper presets; existing `commandQueue`/`queueFailurePolicy` are reused unchanged.

### Task 2: Renderer options, Queue destination and preview

**Files:** `src/status/executionTimeline.ts`, `src/status/queueStatus.ts`, `src/status/queueSettingsPreview.ts`, `src/ui/SettingsPanel.ts`, `src/ui/RowPanel.ts`, `src/app/TerminalApp.ts`; tests in `tests/queueSettings.test.ts`.

**Interfaces:** `QueueRowOptions` gains flat `liveTimeline?`, `recentResults?`, `upcoming?`; `queueBlock` renders the classic pending list when `liveTimeline === false`; counts are re-bounded inside the renderer. The Queue destination (`/settings queue`, `/queue settings`) shows the canonical rows `commandQueue`, `queueFailurePolicy`, the five new rows and the existing motion rows as links.

- [x] RED: configured counts, `recentResults: 0`, live-timeline-off classic fallback, row dependencies, panel fit, preview determinism.
- [x] Renderer options and bounds; `timelineVisible()` and the transient expiry read the configuration.
- [x] Settings rows with `parent`/`when` dependencies, the `queue` entry and destination, `QUEUE_SETTINGS_ROW_IDS`, `RowPanel.preview`, `rowPanelPreview` and `queueSettingsPreview`.

### Task 3: Slash discovery and integrations

**Files:** `src/commands/slashCommands.ts`, `src/configuration/portability.ts`, `src/setup/SetupCat.ts`, `src/ask/concepts.ts`, `src/queue/QueuePanel.ts`.

- [x] `/settings queue` (and `/config queue`, `/queue settings`, `/q settings`) route through the Settings context so Esc returns to Settings; every existing `/queue` form keeps its behavior and the manager gains one discovery line.
- [x] Portability `sessions` category carries the queue presentation and failure policy; Setup rows and `SETUP_ENTRY_COVERAGE.queue`; Ask concept covers `settings:Queue`.

### Task 4: Evidence and verification

**Files:** `scripts/dev/queue-settings-preview.ts`, `docs/development/execution-timeline-slice-2/`.

- [x] Deterministic captures of the real RowPanel with `queueSettingsPreview`: defaults, timeline off, 80×24, configured counts, Safe glyphs, plus the default ANSI capture.
- [x] Focused suites, typecheck and the real-PTY queue suites.
- [x] Canonical `npm run verify:release`; commit source and evidence; stop at the 2A checkpoint.

## Execution ledger

- 2026-10-16: Maintainer approved the Slice 1 checkpoint (`701d2434e8f0fc2906c2f9514b429a8339e3216d`, CI run `38894168928`) and authorized Slice 2A on the same feature branch. This plan covers 2A only; 2B/2C/3/4 are not started.
- RED first: `tests/queueSettings.test.ts` covered defaults, normalization bounds, renderer counts, the live-timeline-off classic fallback, slash routing, rows/steppers/dependencies, RowPanel navigation, preview determinism, portability and app wiring before implementation; the initial run failed at the missing preview module.
- Implementation notes: presentation is additive on `PromptConfiguration.queue`; the renderer re-bounds hand-edited values; `queueBlock` bypasses the timeline when the setting is off; the app reads the configuration for `timelineVisible()`, the transient expiry and the block options. Slash parsing is additive (`settings queue`, `queue settings`) and `/settings` stays before `/settings queue` for `describeSlashCommand` order.
- Two test-authoring corrections, not product changes: after the timeline switch hides its dependent rows the panel selection stays on the switch (the test now moves to the next visible row), and the transient-window assertions sample the clock before the call so a sub-millisecond overshoot cannot fail them.
- The 80×24 capture exposed a real fit defect in the shared `RowPanel`: its checks under-reserved the frame's top line, so the footer controls were cut at exactly the height where the preview fit. The reservation is now exact (frame, preview and controls stay visible); the copy panel and the status-strip preview gain the same guarantee. A focused regression test pins the priority: the description yields before the controls do.
- The destination explains the invariants in the preview caption — "Queue state lives in the live session · resume and clear are always reviewed" — rather than lengthening the established row descriptions, which the panel truncates.
- Canonical gate on the implementation commit `3e3ab6c4`: `env -u NO_COLOR -u NMSH_RETURN_SESSION -u NMSH_HANDOFF_SHELL TERM=xterm-256color COLORTERM=truecolor NMSH_TEST_CONCURRENCY=2 npm run verify:release` passed — build, 2731 tests with 0 failures (626 s), `git diff --check`, benchmark typecheck and the timing smoke. The real-PTY zsh/Bash/Fish queue suites ran green inside it. No failure evidence was suppressed and no assertion was weakened.
- Automated evidence: `docs/development/execution-timeline-slice-2/queue-settings-preview.md` and `queue-settings-default.ansi` are production-renderer captures over frozen observed facts with the current palette and glyph mode; no shell is started and nothing is executed. Automated evidence is not physical terminal QA.
- Remaining and unresolved: physical Ghostty/Terminal.app QA for Slice 1 and 2A, and Linux Fish 3.7 `typingAfterRead`. 2B/2C/3/4 are not started.
