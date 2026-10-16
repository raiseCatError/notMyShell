# Execution Timeline Slice 2B Implementation Plan — Queue history and saved summaries

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a bounded, session-owned history of observed execution chains beside the live timeline, and let the person save a typed, privacy-safe Queue Summary for a chain — persisted with the transcript journal, presented by one shared renderer, and configured from the existing Queue Settings destination.

**Architecture:** The session owner (`QueueDispatcher` / `ExecutionTimeline`, used by both `SessionService` and `InProcessSessionClient`) already observes every chain, execution start/end, exit code, interruption, skip and captured failure policy. 2B adds a bounded archive of settled chains to that owner, derives a typed `QueueSummary` artifact from those observed facts (never from output or input), and sends both over the existing `queue-state` message behind a negotiated `queue-history` client feature. The transcript journal carries the saved summaries as typed metadata (never records), one shared renderer draws them for the chrome, the Queue history panel and the Settings preview, and `/queue history` / `/queue save-summary` are the reviewed surfaces.

**Tech Stack:** TypeScript, Node >=22, existing node:test/tsx and real node-pty fixtures; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-execution-interaction-design.md` (Slice 2: history, summaries, Settings group table, privacy section).

## Slice scope (2B only)

- Owner-side bounded chain history: recent 10 chains, up to 2 MiB of review metadata, at most 500 detailed results per chain with truthful aggregate rollups.
- Typed NMSh Queue Summary metadata: stable identity, exactly-once/idempotent by chain, journal persistence and restore, never a `CompletedCommand` and never shell output.
- Summary presentation: Compact/Detailed, container Left/Center/Right, independent internal alignment, optional individual durations, actual exit codes, optional observed input waits, factual aggregate counts and wall elapsed. Default centered container, left-aligned contents.
- Queue Settings destination extension: automatic saving, detail level, placement, alignment and the optional facts; existing 2A rows untouched.
- `/queue history`, `/queue save-summary`, a contextual Save action where the history review owns focus, and the saved summary's bounded container in the existing queue chrome.
- Excluded and untouched by this slice: queued-output folding and the multiline-paste choice (2C), `/copy`, `/cp`, `/actions` and Compare navigation (3), scrolling (4), archived pending-command persistence, release work.

## Global constraints

- No merge, tag or publication; protected branches and other worktrees stay untouched. `package.json` version stays `0.20.0`.
- Queue/session authority, observed timestamps, exact raw output, `copyText`, hidden-input ownership, stale-review refusal, legacy protocol behavior and PTY dimensions are unchanged.
- Authoritative facts only: no invented durations, input waits, exit codes or per-subcommand results for grouped shell commands; no output, input response or inferred answer length is ever copied into a summary.
- Automatic artifacts carry recognized executable labels (or a generic label); reviewed artifacts may add redacted command text only through an explicit review, and the owner re-validates what it stores.
- Physical Ghostty/Terminal.app QA remains outstanding; Linux Fish 3.7 `typingAfterRead` and the Linux background-session ESRCH race remain unresolved.

### Task 1: Bounded session-owned chain history

**Files:** `src/session/ExecutionTimeline.ts`; tests in `tests/queueHistory.test.ts`.

**Interfaces:** `QueueHistoryRecord` (chain id, creation/start/end observations, wall elapsed, captured failure policy, terminal status, aggregate counts, retained `results`, `resultsOmitted`); `TIMELINE_HISTORY_LIMIT = 10`; `TIMELINE_HISTORY_BYTES_LIMIT = 2 MiB`; `ExecutionTimeline.history` (chronological compact records) and `ExecutionTimeline.record(id)` (full settled chain, bounded to `TIMELINE_RESULTS_LIMIT` with `resultsOmitted` rollups).

- [ ] RED: a settled chain is archived exactly once, in chronological order; the active chain is never archived twice; older chains are evicted at 10; metadata bytes are bounded; per-chain detail is bounded with truthful rollups; a restored/observation-free chain never invents a duration; `queueTimelineFrom` still rejects malformed chains.
- [x] Implement the archive on settle (including `cleared`/`shell-ended`), byte accounting, eviction and rollups. Never advance a settled chain's elapsed time.

### Task 2: Typed, privacy-safe Queue Summary metadata

**Files:** `src/session/QueueSummary.ts` (new); tests in `tests/queueSummary.test.ts`.

**Interfaces:** `QueueSummary {version, id, chainId, savedAt, origin: 'automatic' | 'reviewed', status, failurePolicy, createdAt, startedAt?, endedAt?, elapsedMs, counts, entries, entriesOmitted}`; `QueueSummaryEntry {outcome, label, durationMs?, exitCode?, inputWaitMs?, text?}`; `buildQueueSummary(chain, options)`; `summaryLabel(command, recognized)`; `recognizedExecutables()`; `queueSummaryFrom(raw)` (fail-closed protocol/journal validation); bounds `QUEUE_SUMMARY_VERSION`, `SUMMARY_ENTRY_LIMIT`, `SUMMARY_LABEL_LIMIT`, `SUMMARY_TEXT_LIMIT`.

- [ ] RED: a summary carries only observed facts; a missing duration/wait/exit stays absent; grouped submissions produce one entry, never fabricated sub-results; unsafe first words (paths, assignments, quotes, globs, substitutions, multi-line, comment-only, leading space, pattern-shaped secrets) become generic labels; a recognized executable keeps its name; counts and omits stay truthful; `queueSummaryFrom` refuses malformed artifacts and anything out of bounds.
- [x] Implement the artifact, the conservative label derivation (shell builtins + bundled catalog roots, `scanSensitive` clean) and validation.

### Task 3: Owner ops, idempotence and protocol negotiation

**Files:** `src/session/QueueDispatcher.ts`, `src/session/CommandQueue.ts`, `src/session/SessionProtocol.ts`, `src/session/SessionService.ts`; tests in `tests/queueHistory.test.ts`, `tests/sessionService.test.ts`.

**Interfaces:** `QueueState.history?: QueueHistoryRecord[]` and `QueueState.summaries?: QueueSummary[]`; ops `{op: 'history-detail'; chainId?}`, `{op: 'save-summary'; chainId; reviewed?: {text?: string[]}}`, `{op: 'summaries-auto'; enabled}`; `queueStateMessage(state, event, {timeline, history})`; client feature `queue-history`.

- [ ] RED: saving is idempotent by chain id (a repeated save stores exactly one summary, `savedAt` unchanged); an unknown/active/evicted chain is refused; auto-save defaults off and saves each settled chain once while on; detail is only included for the requested chain; summaries are never shell output and never re-enter `entries`; an older client/service never receives or sends the new fields; malformed transported history/summaries fail closed.
- [x] Implement the ops, the bounded projections and the negotiated message gating.

### Task 4: Summary presentation renderer

**Files:** `src/status/queueSummaryView.ts` (new); tests in `tests/queueSummaryView.test.ts`.

**Interfaces:** `renderQueueSummary(summary, columns, height, options)` with `options: {detail?, placement?, align?, durations?, exitCodes?, inputWaits?, treatment?, now?}`; `queueSummaryLines(summary, columns, options)` for the plain/rereviewed form.

- [ ] RED: the default is a centered bounded container with left-aligned contents; Container Left/Center/Right move the whole block; internal alignment changes only the text inside it; Compact and Detailed differ only in presentation; exit codes and durations can each be hidden; hidden facts never change status truthfulness; a missing duration/wait renders nothing; 80×30 and 32×18 stay readable without cutting an exit code away; the aggregate lines always state factual counts and wall elapsed (or `no execution observed`); Safe glyphs and NO_COLOR keep the same shape.
- [ ] Implement the renderer over the shared dividers, palette roles, glyphs and `formatDuration`.

### Task 5: Settings, portability and discovery

**Files:** `src/prompt/configuration.ts`, `src/ui/SettingsPanel.ts`, `src/status/queueSettingsPreview.ts`, `src/status/queueSummaryView.ts`, `src/configuration/portability.ts`, `src/setup/SetupCat.ts`, `src/ask/concepts.ts`; tests in `tests/queueSettings.test.ts`.

**Interfaces:** `QueuePresentationSettings` gains `autoSaveSummary`, `summaryDetail`, `summaryPlacement`, `summaryAlign`, `summaryDurations`, `summaryExitCodes`, `summaryInputWaits` with stepper/preset constants and normalization; `QUEUE_SETTINGS_ROW_IDS` gains the new rows plus the summary preview.

- [ ] RED: defaults are auto-save Off, detailed, centered/left, durations On, exit codes On, input waits Off; normalization clamps/rejects malformed values; the preview draws the production summary renderer for the current settings; portability round-trips the group; Setup and Ask discover the destination.
- [ ] Implement the rows, normalization, preview and discovery.

### Task 6: Application integration, journal and privacy boundaries

**Files:** `src/app/TerminalApp.ts`, `src/queue/QueueHistoryPanel.ts` (new), `src/commands/slashCommands.ts`, `src/output/OutputBuffer.ts`, `src/sessions/TranscriptStore.ts`, `src/status/queueStatus.ts`, `src/help/*`; tests in `tests/queueHistoryApp.test.ts`, `tests/queueSummaryJournal.test.ts`.

**Interfaces:** `/queue history` and `/queue save-summary` (alias-preserving); a history panel over the shared panel shell; a summary review bound to one chain; `OutputTranscript.queueSummaries?: QueueSummary[]` persisted/restored through `SessionJournal`; the queue chrome's summary block after the transient completed view dismisses.

- [ ] RED: the journal round-trips summaries and refuses malformed ones; restoring never runs or queues anything; reattachment/journal replay never duplicates a summary; `/copy`, compare, search and exports never include summary chrome; the chrome shows the newest saved summary after the transient view dismisses and a new active chain replaces it; the reviewed save stores what the review showed; every `/queue` form keeps its meaning.
- [ ] Implement the panel, slash routing, chrome block, journal field and restore path.

### Task 7: Evidence and verification

**Files:** `scripts/dev/queue-summary-preview.ts`, `docs/development/execution-timeline-slice-2b/`.

- [ ] Deterministic production-renderer captures (real `renderQueueSummary` and the real history panel at 80×30 and 32×18: defaults, Compact, Left/Right placement, centered alignment, Safe glyphs, NO_COLOR).
- [ ] Focused suites, real-PTY queue/history suites, canonical `npm run verify:release`.
- [ ] Commit source and evidence; stop at the 2B checkpoint.

## Execution ledger

- 2026-10-16: The maintainer approved the Slice 1 and 2A checkpoints and authorized Slice 2B on the same feature branch (`feature/post-v020-execution-ux`, last verified checkpoint `069d954e`). Automated approval is not physical QA; Ghostty/Terminal.app validation stays outstanding.
- 2026-10-16: Tasks 1–3 implemented: bounded chain archive (`ExecutionTimeline`), typed artifacts (`QueueSummary`), owner ops (`history-detail`, `save-summary`, `summaries-auto`), transported validation and `queue-history` negotiation. `tests/queueHistory.test.ts` 18/18; affected suites 108/108; build clean.
