# Execution timeline and output interaction

Status: proposed design for maintainer review; no product implementation authorized by this document itself.
Date: 2026-10-16. Scope includes the subsequent `/actions` and `/action` request.

## Intent and protected state

Make command history, queue activity, output navigation, summaries and motion feel like one terminal frontend. The main composer and expressive activity remain familiar for a single foreground command. Additional queued work creates a compact chronological timeline; output navigation operates directly on completed transcript blocks.

The user supplied the product requirements. The concrete model, defaults, bounds and compatibility rules below are proposed engineering decisions, requiring review before implementation. Scrolling remains an independently reviewed performance experiment before production animation changes.

An isolated managed worktree was created at `/Users/jaisukka/.codex/worktrees/d62e/notMyShell` on `feature/post-v020-execution-ux`. Its base is the observed v0.20 stabilization head `891ee5835b956952ae5c15e1929e8dab22908d7d`, following the user's explicit base instruction rather than normal development's `dev` default. No merge, tag or publication is permitted.

Observed remote refs and PR metadata on 2026-10-16:

| Ref | SHA | Observation |
| --- | --- | --- |
| `stabilize/v0.20.0`, PR #396 | `891ee5835b956952ae5c15e1929e8dab22908d7d` | Open draft targeting `release/v0.20.0`; latest reported aggregate CI success; timing/Fedora jobs skipped |
| `stabilize/v0.19.0`, PR #395 | `1aeb05c0d569c06562e8fa9219eae3069686e0cd` | Open draft targeting `release/v0.19.0`; latest reported aggregate CI success; timing/Fedora jobs skipped |
| `release/v0.20.0` | `c71a42846da4a3832e578f3fb9c28f192510d08e` | Original release candidate |
| `release/v0.19.0` | `9e85a9100d1a377ccb3b270c99d98cbae0ff2605` | Original release candidate |
| `docs/post-v020-proposals` | `7a892521beed0e8442078bd66841d027a2a708e7` | Existing proposals, read only |
| `dev` | `4a02520d30c617aeac700715d666a877855166f5` | Observed only; not this task's requested base |

The original checkout was clean on `feature/status-strip-2` at `7916f2e1`. Existing worktrees, pinned QA builds and active QA sessions must remain untouched. Never change package version during this work.

Green aggregate CI is not release-equivalent acceptance or physical validation. The intermittent Linux Fish 3.7 `typingAfterRead` failure remains unresolved under #356. Earlier failure evidence and uncompleted physical checklists remain intact.

## Existing implementation and change boundaries

| Area | Existing authority | Proposed extension |
| --- | --- | --- |
| Sequential execution | `src/session/CommandQueue.ts`, `QueueDispatcher.ts` | Keep `take()` and prompt-driven dispatch; add bounded observed chain metadata |
| Service and fallback | `SessionService.ts`, `InProcessSessionClient.ts`, `SessionClient.ts` | Feed the same lifecycle observations and timestamps to both implementations |
| Protocol | `SessionProtocol.ts`, socket client | Negotiate timeline support; validate new fields and bounds; preserve old service behavior |
| Queue chrome | `src/status/queueStatus.ts`, `src/queue/QueuePanel.ts` | Replace nested preview; retain manager and entry operations |
| Geometry | `src/app/screenPlan.ts`, `TerminalApp.planComposer` | Plan timeline before activity; preserve PTY size and focus geometry |
| Activity and motion | `src/status/activity.ts`, `src/motion/*` | Share glyph sampling, timing and finite event effects |
| Transcript | `OutputBuffer.ts`, `TranscriptPresenter.ts` | Retain raw storage; introduce typed summary metadata and display policy |
| Session journal | `src/sessions/SessionJournal.ts`, `TranscriptStore.ts` | Serialize bounded metadata; no recovery-triggered execution |
| Paste | `pasteBatch.ts`, `pasteBatchCheck.ts`, `BatchReview.ts`, paste guard | Add explicit block-versus-batch choice around existing analysis |
| Output navigation | `BlockActions.ts`, `openBlockPalette`, transcript focus/reveal | Shared single-block selector for Copy and Actions |
| Copy and comparison | `CopyPicker.ts`, `copySelection.ts`, `ComparePanel.ts` | Preserve payloads/algorithms; improve navigation and presentation |
| Settings and discovery | `SettingsPanel.ts`, `prompt/configuration.ts`, `slashCommands.ts`, help, `/keys` | Extend existing rows/destinations and generated action help |

The current queue contains pending entries only. It does not retain completed queue runs. The dispatcher already tracks the last command and interrupt, but lacks durable execution IDs and timings. `onPrompt()` can overwrite an existing pause reason after a later foreground failure. `/queue clear` currently clears immediately. The expanded preview is placed after activity and uses connectors; `withQueueRows()` deliberately leaves `ptyRows` unchanged. These are localized extension points, not reasons to replace execution or rendering architecture.

`CompletedCommand` already has authoritative stored output/copy text, stable `startId`, exit status, duration and observed input waits. `StreamStamp` carries service event timestamps and sequence numbers. Preserve those identities and facts. Do not derive command success from text or silence.

## Recommended model

Use session-owned execution-chain metadata beside the existing dispatcher, with a pure renderer shared by production and Settings previews. Frontend-only tracking is simpler but loses facts during detachment; parsing transcript text would lose identity and truthful timing. Neither alternative meets the requested lifecycle guarantees.

Each chain has a session-scoped immutable ID, captured failure policy, start/end observations, termination reason, aggregate counts and ordered execution references. Each execution has an immutable ID, optional queue-entry ID, original submission provenance, shell ID, observed start/end times, optional wait facts, result and optional transcript reference. Queue entries remain owned by `CommandQueue`; completed results must not be inserted back into pending entries.

A chain opens when work is queued. If a manually started command is active, adopt its already observed start timestamp and label its provenance as manual. If an older service cannot supply the timestamp, show it as unknown rather than using queue-add time. A submission waiting for an exec marker is `starting`, not completed or duplicated. A valid empty/comment-only submission that produces no exec marker receives a factual no-observed-execution result; never invent an execution duration or exit code for it.

The logical chain ends only when no pending entry, submitted entry or active chain execution remains. Queue additions while a chain is running join it. After a chain has ended, new work starts a new chain even while the preceding transient summary remains visible. A new active chain replaces that transient view; the old run remains reviewable within history retention.

Termination distinguishes natural completion, completion with failures, interrupted/abandoned, manually cleared and shell-ended. Removing an entry records it as skipped with its reason. Clearing pending work while a command runs does not interrupt that command: show the cleared count and remaining running result, then finalize as manually cleared. Never label a discarded chain successfully completed.

Proposed retention: recent 10 chains, up to 2 MiB of review metadata, with at most 500 detailed results per chain and explicit aggregate rollups for older details. Pending entries and raw output are outside this preview/history bound. Active pending work is never evicted. Command text in review metadata is bounded and redacted; raw command/output remains governed by the existing authoritative transcript retention. Existing service spool truncation limits must not be expanded or hidden; retain `outputIncomplete` reporting.

### Time and chronology

Capture one owner-side timestamp per lifecycle event and pass it consistently to the dispatcher, transport and journal. Record elapsed durations with a monotonic clock while the owner lives; retain epoch start/end observations for chronology and resume. A frontend reattach must not restart any clock. Restoring an archive creates no running process and must not advance a completed run's elapsed time.

Chain wall elapsed is the observed interval from first execution start to final chain end, including pauses/gaps/waits. Queue creation-to-start waiting is a separate fact. Individual duration is the execution interval. Input-wait duration is included within individual and chain wall time, never added again. Paused chains show `Paused` and explain that wall elapsed includes the pause. Missing wait evidence stays unknown, not zero. Wall-clock discontinuities must not produce negative or fabricated durations.

Queued commands continue through the same persistent shell. Grouped submissions have one outer observable execution; informational subcommands receive no fabricated independent status or timing.

### Failure policy and approvals

Persistent setting: **On queued command failure**, `Pause remaining queue` by default or `Continue remaining queue`. Capture it when a new chain is admitted/reviewed. Changes affect future chains, never silently modify an existing chain's reviewed policy. Review surfaces state the captured policy.

Compatibility: queues without a captured policy use Pause. Saved recipes keep their explicit `always`/`approve` entry conditions; staging a recipe for a new chain displays the current policy before confirmation. Joining an active chain uses that chain's captured policy and displays it. Restored pending entries retain their captured policy but are held for reviewed resume; absent legacy metadata means Pause. No automatic replay occurs from a journal.

Eligibility order:

1. Interrupt, shell switch, restored-state hold, manual pause or active edit prevents dispatch.
2. An unapproved `approve` entry always requires explicit approval of its exact current identity/text.
3. On plain failure, a next entry marked `always` may continue under the existing semantics. Otherwise the captured chain failure policy decides whether to hold the default entry or continue.
4. A Ctrl+C observation or exit 130 always pauses regardless of Continue or `always`.

Approval invalidation after edits/condition changes remains. A plain later foreground failure cannot replace an already recorded pause cause. Explicit shell-switch/restore safety events may establish a fresh safety hold and must be explained in the review. New execution settings/features are never sent optimistically to an old service that cannot honor them.

## Slice 1: execution timeline, safe controls and aliases

Normal single command, no queue: preserve the existing activity layout. Once queued work exists, show recent results (default two), one active command, next two entries and a hidden pending count. Order is chronological. The queue region sits above the principal activity row, separated from transcript output by the existing divider treatment.

The running entry uses the existing activity glyph sampled on the existing clock. The principal activity row owns expressive wording and timing; in chain mode it has a static queue marker so there is one animated running glyph. It can say `Queue activity · 11.3s elapsed · 1 completed` in Classic, or use the current expressive active phrase with factual queue timing. Do not append another completion message to transcript lifecycle rows.

Completed rows have outcome and individual duration; failures include actual exit code. Only next-eligible pending work gets the navigation marker. An approval-blocked next entry says `Awaiting approval`; manual pause, failure, interruption, shell switch and restore show their actual cause. Pending rows are subdued/static. Use palette roles, glyph fallbacks and existing focus surfaces; no bright full-line accent or permanent enclosing border.

Geometry uses `screenPlan.ts` for rendering, hit-testing, reveal, cursor and viewport. Keep `ptyRows` independent of transient timeline expansion and dismissal. The screen plan allocates timeline rows from the captured transcript history viewport; rows never overlay output cells. A smaller history view retains its anchor and full stored output. This must not change the active shell PTY dimensions. Hide the expanded timeline during known input requests and all timeline chrome during passthrough; those programs retain their complete terminal surface.

Preserve the transcript anchor when timeline capacity changes. Do not emit terminal scroll commands merely because a result row changes. Use a stable budget through result promotion, keeping recent results visible. On short terminals, priority is current safety reason, running entry, next entry and compact count; collapse optional history/upcoming rows first.

Aliases share one slash parser/handler: `/q` is exact `/queue`, `/qp` pause, `/qr` reviewed resume/approval, `/qc` reviewed clear, `/pause` pause if a fresh collision audit stays clear. Canonical subcommands remain. Register aliases as such for completion/help and avoid duplicate command-palette entries.

Review controls only when NMSh owns an empty composer, shell is idle, startup is ready, and no panel/modal owns input. Enter opens current review; a separate explicit Enter confirms. Esc with a nonempty paused queue opens `Clear queued commands?`; Enter confirms there, Esc cancels. `/qc` and `/queue clear` open the same reviewed clear. `/qr` and `/queue resume` open the same safe resume/approval review. No single idle key executes or discards work.

Bind review to a queue revision plus exact affected IDs/text/policy, with compare-and-apply validation at the session owner so a transport race cannot act on unseen changes. Negotiate this capability; an older service must retain its existing explicit manager flow rather than receive an unsupported operation. Any material change, shell switch, ownership transfer or restore invalidates the review. Preserve the existing rapid-confirmation settle guard and explicit Ctrl+Q ownership path. Foreground keys, hidden input and Ctrl+C routing precede these affordances.

Queue add/start/result/failure/pause/resume/clear/finish trigger finite existing transition primitives. Waiting queues do not subscribe to a looping animation. Reduced Motion, effects Off and NO_COLOR settle immediately, with status conveyed in text/glyphs. Unsubscribe on settle, panel ownership changes, stop and passthrough.

## Slice 2: summaries, history, Settings and multiline choice

Transient completed view defaults On for 8 seconds (bounded setting 6–30 seconds); history remains available after it dismisses. Opening a review pauses dismissal while focused. Live timeline defaults On. Automatic saved summaries default Off.

Saved Queue Summary is typed NMSh metadata, anchored chronologically after its chain, with a stable summary ID to prevent duplicate saves/replay. It is neither shell output nor a fake `CompletedCommand`. Serialization, journal validation and presentation explicitly understand it. `/copy`, compare and raw exports do not pick up its chrome. Explicit summary copying/export may serialize its reviewed plain representation separately.

Default placement: centered bounded container with left-aligned contents. Container placement and internal alignment independently support Left/Center/Right. Compact/Detailed, individual durations, exit codes and optional observed wait times affect only presentation. Failure/interruption status remains factual regardless of detail toggles. Automatic save is idempotent by chain ID; manual `/queue save-summary` uses the same path and a review. A contextual Save action exists only when a summary/menu owns focus.

Privacy: summary input is command identity/outcome metadata, never answers or input buffers. Reuse `createReportContent`, `redactText`, `scanSensitive` and exact-text review safeguards. Commands excluded by existing sensitive/history policy receive a generic label in automatic artifacts. Pattern redaction is not proof arbitrary text is safe: automatic artifacts omit raw arguments and output, using recognized executable labels (or a generic label when eligibility/safety is unknown) plus facts. Detailed command text requires an explicit redacted review. Never persist hidden/password responses or inferred answer lengths. Save no private cwd by default.

Output display setting: Inline (default) / Fold queued output. Folding is reversible presentation over retained records. No changes to raw writes, exact `copyText`, search sources, reports, export or journal recovery. Displaying a summary never replaces raw records. Scope this to queue provenance; do not implement semantic-output issue #386.

Use the existing Settings system: a Queue destination accessible through `/settings queue` and `/queue`, with shared configuration rows and normalization/export/import/reset behavior. Groups:

| Group | Controls |
| --- | --- |
| Behavior | Queue enabled, failure policy, default approval for new entries, persistence policy, reviewed resume/clear explanation |
| Appearance | Live timeline, recent 0–2, upcoming 1–2, existing glyph mode, theme-role preview |
| Motion | Link to existing Clean/Rich, event feedback and Reduced Motion controls; no second engine |
| History and summaries | Transient On/Off, retention seconds, auto-save, output display mode, placement/alignment, Compact/Detailed, duration/exit/wait display |

Persistence default remains session-owned live state; do not start automatically persisting queued text across shell restarts. Opt-in archived queue persistence must redact/minimize stored text and restore to a held review; unsafe/unverifiable content is not persisted. This setting never promises to restore shell variables or jobs. Reviewed resume/clear are safety invariants, not toggles that enable one-keystroke execution/discard.

Previews use the exact pure timeline/summary renderer with frozen simulated metadata, the current palette and glyph/motion policy, no real execution. Fixtures: running with two upcoming, success promotion, failed/paused with exit code, manual pause, completed, 32 columns, and saved summary in all three container placements. Color customization reuses existing semantic roles rather than a separate queue palette.

Paste review preserves `splitBatch()` plus parse-only `verifyCommands()` in the active shell. Add an explicit choice: Run as one reviewed shell block (1 outer execution), Queue separately (N verified top-level statements), Edit, Cancel. The count and preview come from validated analysis; showing the choice never submits anything. Queue separately retains ordered persistent-shell state.

Keep semicolon chains, dependent operators, heredocs, quoted multiline strings, loops/functions/conditions and ambiguous syntax intact. Existing conservative scanner groups semicolon statements within one top-level chunk; do not broaden it into arbitrary shell parsing. A valid parse-only result proves complete syntax, not semantic independence under aliases/options/state. Refuse uncertain separation and explain why. Switching shells or editing invalidates analysis and review. Grouped blocks expose no fictional subcommand measurements.

## Slice 3: shared Copy/Actions navigation and compare framing

Introduce one transient output-selection controller over completed shell records, identified by session/presentation generation plus `startId`. It stores intent (`copy` or `actions`), candidate identities, focused ID and a return snapshot of viewport anchor/FOLLOW state, fold/filter state and composer draft/cursor. It is not an Actions registry.

Bare `/copy` and `/cp` default to transcript output selection; explicit numeric/range/list selectors, flags, `/copy latest`, Quick Copy configuration and existing direct payload functions remain. Migrate existing persisted Quick Copy preference explicitly: honor an already saved choice, while the default for new configuration becomes navigation. `/copy ui` always opens the independent multi-selection picker. Report flags still enter the exact existing report-review path before clipboard operations.

Up/Down moves among completed command-output blocks, newest first initially; selection never copies or executes. Highlight the focused block with the existing theme-derived background/NO_COLOR fallback and reveal it minimally through viewport infrastructure. A folded block remains folded; render focus over its visible representation. Copying reads complete stored output including tabs, Unicode and trailing newline, regardless of preview/folding. Enter uses the existing `copyRecords()` pipeline and clipboard sanitization. A failure to copy keeps focus available with existing feedback. Esc restores the entry view/draft without copying; clamp vanished anchors safely and never replace the current draft with stale state after ownership changes.

`/actions` and `/action` enter the same selector with Actions intent. Enter calls `openBlockPalette(startId)` and gets `blockPaletteItems(record)`, exactly as pointer `[Actions]` does. A return token connects this palette to its selector. Esc from that palette returns to the same focused ID; Esc again closes/restores. `/actions N` (and exact alias `/action N`) may resolve using the same completed-output numbering as `/copy` and open the existing palette directly. Invalid/out-of-range selectors have no side effects.

Existing `BLOCK_ACTIONS`, `blockPaletteItems()`, `runBlockAction()` and all copy/report/compare/edit/rerun/fold/pin/clip/reference handlers remain the only action definitions and dispatch paths. Regenerate contextual availability from the live record at activation; disappearance closes/returns safely with feedback, never transfers an action to a neighboring output. Failure-only Explain and references-only entries keep their current filtering. Existing availability limitations must be handled in the shared registry, not a selector-specific action list.

Back state is scoped to this originating palette. Global command palette Esc remains unchanged. Once a user explicitly chooses a terminal handoff, edit or rerun action, end navigation before that existing handler runs, so stale restoration cannot clobber its composer or program ownership. Output selection's Enter itself never chooses/runs an action.

Selectors cannot open while a foreground program/fullscreen TUI owns input; revalidate after asynchronous setup and cancel safely if ownership changes. Ordinary letters keep their composer/program meaning. Keep Shift+Tab block focus and Enter-to-Actions where available; document these plus selector Up/Down/Enter/Esc in `/keys` and generated help. Add no new dedicated shortcut until host/shell/keymap conflicts are audited.

`/copy ui` stays functionally independent: search, multi-select, preview, report, order, status toggle and key operations remain. Replace `[x]`/`[ ]` with the existing selected-item checkmark/Safe equivalent; cursor focus uses background, independent of membership. Use the shared row/palette focus language.

Wrap Compare in existing menu framing/divider primitives, accounting for frame rows in scroll calculations and narrow layouts. Do not change `compareRecords`, diff generation, report review or clipboard text. No new diff engine.

## Slice 4: scrolling research and gate

The supplied YouTube URL could not be fetched by the browsing tool. Primary reference inspected: [neoscroll.nvim README](https://github.com/karb94/neoscroll.nvim), which documents finite line movement, easing, cancellation, fold handling and a performance mode. Use its interaction concept; do not depend on Neovim or its implementation.

Current `HistoryViewport` stores an integer row start plus FOLLOW/DETACHED. Wheel handlers use three rows; paging uses viewport height minus two. Transcript selection uses wrapped-row coordinates. `TranscriptPresenter.rows()` currently visits transcript lines for each presentation request; `OutputBuffer.wrapped()` only caches filtering over the presented rows. There is no demonstrated cheap full-history animation path yet. `TerminalRenderer` frame diffing alone does not eliminate row-generation cost.

Research deliverable before production changes: reproducible benchmark plus throwaway finite-scroll prototype over the existing viewport and shared `PresentationClock`; report source SHA, environment, histories, p50/p95 frame CPU/wall cost, bytes/writes/changed rows, event-loop delay and memory. Compare Instant, Smooth and Adaptive on identical 400-line and 10,000-line inputs, ANSI/Unicode/long lines, folded/unfolded and Normal/Chat, at 32/80/120 columns. Include continuous append, rapid direction changes and resizing. Separate cold wrap cost from repeated frame cost and renderer cost; do not claim a viewport-only microbenchmark establishes terminal smoothness.

Proposed initial controls: Instant default until performance/physical review, Smooth or Adaptive opt-in; wheel/key step independent of duration (initial 160 ms, bounded 60–400 ms) and easing (Linear / Ease out / Ease in-out using existing curve functions). Short finite movement samples integer rows at at most 25 fps; paint only when integer start changes. No timer remains when settled.

Adaptive proposal: ease moderate jumps of at most two viewport heights; jump instantly for larger distances, repeated inputs within 80 ms, active selection dragging or measured expensive frames. Opposite-direction input retargets from the current visible row; never queue an animation backlog. Input dispatch is never delayed. Reduced Motion forces Instant; NO_COLOR respects existing motion policy and communicates state without color. Active passthrough receives its own wheel/keyboard events unchanged.

Settle/cancel on search/failure/action reveal, latest, selection start, folding/filtering, restore, generation change, ownership transfer and resize; preserve stable anchors and exact selection. FOLLOW resumes only at the actual final bottom, not an intermediate easing point. Motion must not alter PTY dimensions.

Initial performance decision budget, subject to benchmark review: p95 <= 8 ms CPU per frame on the local host, <= 25 changed-row frames/s, zero settled wakeups and bounded memory growth. Record actual host memory; an 8 GB target is a constraint, not a claim about this machine. If this cannot be achieved with localized changes, present a separate caching/invalidation design and measured before/after prototype. Do not undertake a renderer rewrite under this task's existing approval.

## Deterministic visual targets

These are hand-authored design fixtures, not production renderer captures or physical QA evidence. Production previews/tests must later render the same cases through shared renderers.

Running at ordinary height:

```text
──────────────────── Queue · 5 commands ────────────────────
✓ npm run build                          8.2s
✳ npm test                               Running
› git status                             Next
  echo done                              Queued
  +1 more
✦ Queue activity · 11.3s elapsed · 1 succeeded · 1 running
───────────────────────────────────────────────────────────
❯ _
```

Failure at short height / Safe glyphs:

```text
---------- Queue paused ---------
x npm test              exit 2
> git status            2 pending
Paused after exit 2; Enter reviews
--------------------------------
> _
```

Manual pause and cleared results use `Paused manually` and `Cleared · N skipped`, never `Completed`.

Saved summary, centered container / left-aligned text:

```text
         ─────── Queue Summary ───────
         ✓ npm run build         8.2s
         ✕ npm run lint  exit 1 · 1.4s
         ✓ npm test             12.3s
         3 executed · 2 succeeded
         1 failed · wall time 23.9s
         ─────────────────────────────
```

Container Left/Center/Right moves the entire bounded summary. Internal alignment only changes text within it; statuses/durations retain readable columns. Narrow widths stack factual detail rather than truncate an exit code or pause reason away.

## Acceptance and verification strategy

Use independent coherent commits for each slice; no merge/tag/publication. A prototype is labelled as a prototype. Run focused meaningful tests first and canonical `verify:release` after integrated code, then exact-feature-SHA CI including release-equivalent manual-dispatch gates. Never replace failing evidence with an unrelated passing run or weaken tests.

| Slice | Automated acceptance | Real-PTY acceptance |
| --- | --- | --- |
| 1 | Chain promotion and terminal outcomes; manual predecessor; add/remove/edit/clear; captured failure policy; stable pause cause; always/approve; legacy protocol negotiation; alias parity; revision-bound reviews; geometry/PTY-size invariants; bounded clocks | zsh/Bash/Fish sequential state/order exactly once; failing/interrupted/surviving Ctrl+C; manual pause then unrelated failure; hidden/single-key reads; Ctrl+Q ownership; detach/reattach; narrow/Safe/NO_COLOR |
| 2 | Journal metadata validation/roundtrip/idempotence; retention; factual wall/wait counts; secret omission/redaction; reversible folding retains exact copy/search/report/export; production/preview renderer identity; settings normalization; grammar fixtures and invalidated review | Separate/block paste order and shared state; heredoc/function/loop; service reconnect/restored holds; exact 400-line copies with folded queued output |
| 3 | Stable-ID selector navigation; empty/no-output/disappearing blocks; restoration with folds/filter/resize; Copy versus Actions intent; palette Esc return; contextual registry parity; alias/N parsing; no selection side effects; independent multi-picker operation; Compare frame dimensions | Clipboard tabs/Unicode/trailing newline and `seq 1 400`; report fake-token/private-path redaction; compare unchanged; `/actions` keyboard and pointer parity; editor/rerun handoff; input ownership and fullscreen refusal |
| 4 | Recorded benchmark results and gate decision; deterministic easing endpoints/retarget/cancel; no idle subscription; FOLLOW/DETACHED; selection/search/fold/anchor invariants | Physical wheel/trackpad, page keys, selection, resize and fullscreen apps in Ghostty/Terminal.app; 400/10,000 lines; reduced motion/NO_COLOR responsiveness |

Every test-created TerminalApp must stop and kill its session and semantic helpers, using project fixtures and private test homes. Do not attach helper processes to the host TTY or disturb existing services. Use bounded file concurrency, preferably one on this shared host, and test-owned temporary storage only.

Physical QA stays outstanding until actually performed by the maintainer. Preserve the supplied v0.19 facts (exact-copy/report/compare passed; queue generally functional but visually unsatisfactory; `/q` absent; hidden-read exit 1 and immediate zero-delay input race unestablished). No retroactive checklist completion. Linux Fish 3.7 remains an explicit unresolved blocker, even if new focused tests pass.

## Review checkpoint

Approve or correct this written design before product code and implementation planning. Main decisions to review are captured-per-chain failure policy, conservative paste separation, safe-label-only automatic summaries, compatibility-preserving Copy preference migration, and the independently gated scrolling prototype. No additional permission is needed for routine isolated implementation/verification after design approval; merges, tags and publishing remain prohibited by the user's instruction.
