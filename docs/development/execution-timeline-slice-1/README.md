# Slice 1 visual checkpoint

The implementation is on `feature/post-v020-execution-ux`, based on verified v0.20 stabilization commit `891ee5835b956952ae5c15e1929e8dab22908d7d`. Release/stabilization branches, pinned QA builds and existing sessions are unchanged.

[Production-renderer captures](previews.md) · [Color gallery](previews.svg)

The capture script calls the real queue renderer, activity-summary formatter and screen-plan adapter with deterministic session-owner event fixtures. It never executes the displayed commands. These are implementation previews, not physical terminal validation. The captures record their source commit and include normal/narrow running, promoted success, failure, manual pause, interruption and completed states, plus Safe/NO_COLOR.

## Revised integrated-frame evidence (maintainer follow-up at `7f26f651`)

[Revised production frames](revised/previews.md) · [Mode color gallery](revised/gallery.svg) · [Recorded motion player](revised/motion.html)

The follow-up presentation pass adds theme-derived low-strength row tints behind semantic results, one identity-targeted transition per observed result/promotion/aggregate event on the existing motion store, a muted next arrow with an explicit `Paused` label, and narrow summaries that fit whole status/fact/time components. The revised evidence renders real `TerminalApp.render()` / `paintPresentation()` frames at 80×30 and 32×18 through the real OutputBuffer, screen plan, dividers, activity and composer with deterministic owner observations; displayed commands never execute. It covers Normal, Rich, Reduced Motion and Safe/NO_COLOR with first-queued, running, success sweep, failure, interruption, manual pause/resume, promotion, completion and settled frames. The committed review set is every raw ANSI frame plus the frame/state JSON, the mode gallery and the recorded Normal/Rich sequences; `node --import=tsx scripts/dev/execution-timeline-frames.ts --full` additionally writes one SVG per frame and replays every mode locally. The original 80b9736 gallery above stays as it was.

## Behavior to review

A single command retains ordinary activity presentation. Once work is queued, a bounded chronological timeline sits above the existing activity row. It shows two recent results when space allows, one existing live glyph, upcoming work and overflow. Failure/interruption reasons survive narrow widths. Raw command output remains in the ordinary transcript and authoritative storage. A completed chain remains briefly visible for eight seconds; `/queue` can show its latest bounded results after dismissal. Rich history and saved summaries belong to Slice 2.

`/q` aliases `/queue`, including its supported subcommands. `/qp` and `/pause` pause. `/qr` opens a reviewed resume/approval; `/qc` opens a reviewed clear. At an empty idle composer, Enter opens the current safe review and Esc can open clear review for a paused queue. A further explicit confirmation performs the operation. Edits, manual submission and controller reattachment invalidate stale owner-side review revisions. Foreground/hidden input retains priority.

Settings → Sessions and Setup → Sessions & alerts share **On queued command failure**. Pause is the default; Continue applies to future chains. Existing chain policy stays captured, explicit always/approve conditions remain, edits withdraw approval and Ctrl+C always pauses. The manager and relevant reviews disclose the captured policy. Independent foreground work begun while paused stays outside that chain and preserves its original pause cause and aggregate outcome counts.

No pending-command archive system was added. Existing live-session queue behavior remains. Multiline paste safety and grouping are preserved; a grouped entry receives one observable outer result. The larger multiline-choice UI, summary/history/Queue Settings UI, shared `/copy` and `/actions` navigation, comparison polish and independently gated scrolling prototype remain in their approved later slices. `/copy ui` is unchanged functionally.

## Verification and remaining QA

Focused tests cover observed timing/provenance, revision-bound controls, strict negotiated transport, legacy services, chronological rendering, bounded narrow/Safe/NO_COLOR output and full composer PTY geometry. Real-PTY checks cover zsh, Bash and Fish persistent state/order, exactly-once grouped execution, Pause/Continue, independent foreground failure while paused, reviewed aliases, approval, interruption, hidden/single-key input and live reattachment. Canonical verification and exact feature-SHA CI outcomes are recorded in the handoff, with prior failures retained in the plan ledger.

Physical review is still required in Ghostty and Terminal.app: readability, transition stability, keyboard ownership, resize, terminal selection and fullscreen programs. Automated PTY checks are not physical QA. Linux Fish 3.7 typingAfterRead remains unresolved. No release checklist is retroactively marked passed.

Stop here for maintainer visual review before Slice 2. Nothing is merged, tagged or released.
