# Runtime performance implementation plan

User-authorized performance and storage pass, 2026-10-25. Existing functionality only; focused PRs target dev and are never automatically merged. Physical Ghostty/Zed QA remains NOT RUN.

## Completed investigation and implementation

- Audited local NMSh storage, Git worktrees/refs/stashes, shared dependencies and process ownership. Removed 18 net proven redundant worktrees using Git, preserving all branches and unique work. Recorded and repaired the intermediate dependency-link cleanup mistake.
- Saved original-dev built-CLI real-PTY baselines, CPU/allocation profiles and component measurements before implementation.
- Rejected and reverted transcript wrapping caching: improved warm wrapping but retained ~53 MB extra heap and regressed resize cost. No cache remains.
- Implemented measured output-only paint coalescing, preserving synchronous parsing, queries, lifecycle, raw passthrough and immediate input/prompt/resize frames.
- Added regressions for ordering, timer cancellation, handoff, displayed-viewport mouse mapping, Unicode fragments, clear generation, active-drag redraws and exact copied content.
- Independent review found pointer/selection hazards; fixed both and obtained approval on the final implementation. Kept selection-drag output painting synchronous and retained only viewport rows for pending-event mapping.
- Repeated real-shell 1k/10k output measurements and alternating startup controls. Significant output improvement; no supported startup/idle gain. See docs/performance/2026-10-25-runtime.md for numbers and limitations.

## Remaining first-slice gates

- Full canonical verification passed with private short T7 roots, pinned truecolor environment, unchanged assertions and supported two-worker concurrency. Four-worker completion-helper failure and invalid-color cancelled attempt remain documented.
- Commit coherent implementation/evidence, push branch and open PR referencing #505, targeting dev. Report exact-head CI; never merge automatically.
- Preserve final evidence; remove owned disposable processes, dependencies and worktrees only after commits are safely preserved. Final storage/process audit.

## Next independent slice

CPU profiles identify grapheme segmentation and repeated prefix width computation during input layout. Establish an unchanged-dev baseline in the isolated input branch before implementation. Compare realistic editing/layout work and real-PTY typing, preserve Unicode/caret semantics, independently review and run canonical validation. No new dependency or worker.

Further ranking: unused optional module loading (121 Arcade modules observed before use), transcript resize/wrapping, long-session retention, provider/context scheduling and activated document/browser/graphics costs. These remain investigations, not claimed optimizations.
