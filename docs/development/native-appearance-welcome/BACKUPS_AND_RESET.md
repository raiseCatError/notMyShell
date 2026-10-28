# Backups and guarded reset

Implements the supplied BRIEF-BACKUPS.md in the assigned worktree. No dependencies, PTY changes, shader generation changes, or release version changes.

## Design
A private, bounded journal records checked before-images and expected after hashes before the existing host transaction can mutate files. All readers reject symlinks and oversized files. Restores capture current snapshots for stale checking and create another journal entry, making undo reversible. Shared studio shells render history and a four-step reset state machine; no write occurs while planning or rendering. Reset discovers ownership and delegates to existing removal planners, retaining user content and reporting refused areas.

The shared transaction is preferred over independent backup implementations because existing snapshot checking and rollback remain authoritative. Legacy writers retain their own validation and use that transaction for their final write. State metadata needed to undo ownership changes belongs in the same journal entry as external files.

## Implementation plan
- [ ] Journal: test missing behavior, implement private atomic read-back-verified entries, caps and pruning, integrate transact, run focused tests, commit.
- [ ] Writers: preserve preconditions, route external final writes through journaled transactions; daily settings checkpoint; focused regression tests, commit.
- [ ] Restore and history: stale snapshots, current-to-before diff, edited-file second confirmation, undoable restore, manual snapshots; shared responsive studio panel; tests, commit.
- [ ] Reset: discover owned areas, exact impact, backup location, exact typed reset confirmation, recheck all snapshots, per-area results; command/help wiring; tests, commit.
- [ ] Verify affected tests using supplied runner, TypeScript and diff checks; save panel snapshots and final evidence report.

## Review focus
Reject symlink swaps; refuse writes if backups cannot be read back; preserve user newlines and subsequent unrelated edits; refuse stale plans; keep cancellation and confirmation visible at small sizes. Tests use private home directories. Automated results do not establish physical terminal validation.
