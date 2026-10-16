# Slice 3 Copy and Actions Implementation Plan

**Goal:** Shared stable completed-output navigation for Copy and Actions on the approved Slice 2A baseline.
**Architecture:** A pure transient controller stores identities and a return snapshot. TerminalApp resolves authoritative records, input ownership, viewport and the existing palette/clipboard paths. No transcript or action registry duplication.
**Spec:** docs/superpowers/specs/2026-10-16-execution-interaction-design.md (Slice 3).
**Execution:** Inline, isolated branch only, as explicitly requested. No integration, releases or protected branch changes.

## Constraints and review focus

- Base 069d954e21d4e35c69d2510f8173bddcd7c1b7c3; never read Gemini's uncommitted work.
- Output identity must survive reflow/folding and refuse reused IDs after clear/restore.
- A vanished focused record cancels; never dispatch a neighboring record.
- Ownership changes cancel without restoring stale composer state.
- Existing saved quick/picker choices persist; new configuration navigates.
- Focused serial tests/typecheck only during Gemini canonical verification; full verification may be deferred.

## Tasks

- [x] 1. Pure controller and viewport snapshot/reveal tests, then implementation. Cover navigation, scope changes, vanished records, folded/narrow anchors and FOLLOW restoration.
- [x] 2. Frontend Copy/Actions integration tests, then implementation. Reuse copyRecords/openBlockPalette/runBlockAction. Cover exact data, preference migration, aliases, numeric selectors, ownership, palette return and handoff.
- [x] 3. Picker checkmarks/focus and Compare frame geometry tests, then implementation. Preserve independent picker operations and diff payloads.
- [x] 4. Discovery/help, deterministic production-renderer evidence, focused real-PTY checks, review and checkpoint commit. Record overlaps, failures and physical QA.

## Verification commands

Use the private-home focused helper: t7run node scripts/dev/copy-actions-checks.mjs tests/outputSelection.test.ts tests/outputSelectionApp.test.ts (and explicit related affected files); t7run npm run typecheck. The repository npm test wrapper appends canonical files to positional paths and must not be used for focused selection. Generate deterministic frames via a dedicated scripts/dev entrypoint. Evidence/logs live on verified T7 scratch; see the Slice 3 handoff. Canonical verification is pending unless host availability is established.
