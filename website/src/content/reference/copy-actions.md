---
title: "Output selection and Copy Actions"
description: "Canonical output selection and copy actions from the v0.22.0 published source."
group: Technical reference
order: 120
source: "docs/development/copy-actions-slice-3.md"
---

This records the original isolated implementation. For the later 2C integration, see [the integration handoff](slice-3-integration.md).

Branch: `feature/post-v020-copy-actions`.
Worktree: `/Volumes/nmsh-opus/wt/post-v020-copy-actions`.
Exact base: `069d954e21d4e35c69d2510f8173bddcd7c1b7c3` (verified before edits).
The worktree was created before the updated storage policy. It remains in place under that policy's existing-worktree exception. Subsequent test scratch and generated evidence use verified `/Volumes/T7Tmp/ai-dev` storage. No merge, rebase, cherry-pick, tag, release, protected-branch update or other active-worktree edit was performed.

## Behavior and architecture

`OutputSelection.ts` is transient identity/navigation state, not transcript storage or an action registry. Its candidates come only from `recentShellCommands()`. It records session/shell identity and the OutputBuffer presentation generation, which changes on clear/restore so reused numeric IDs cannot be targeted accidentally. The frontend resolves the live record again before activation. Disappearance cancels without moving an action to a neighboring record.

New configurations use transcript output navigation for bare `/copy` and `/cp`. Explicitly persisted `quick` and `picker` values remain meaningful, including settings transfer. Explicit selectors, latest, status/report flags, auto-expand and `/copy ui` keep their existing paths. Enter uses `copyRecords()`; no payload or clipboard sanitization logic changed. A failed or empty copy leaves navigation available. Async clipboard completion only auto-expands records from the same presentation and live identity.

`/actions` and `/action` use the same controller. Enter opens `openBlockPalette()` using `blockPaletteItems()` and the existing `BLOCK_ACTIONS`/`runBlockAction()` registry/dispatcher. The originating palette returns to selection on Esc; the second Esc restores the entry viewport. An explicit action ends navigation before edit/rerun/pager/report handoff. Numeric Actions forms open that existing palette directly. Live contextual availability is checked again at activation.

Input ownership remains derived from the workspace/composer model. The selector excludes only itself and its own palette when checking eligibility. Running commands, startup, shell switch, hidden/key reads, passthrough, searches, workspace regions and foreign modal UI retain input. Normal typing exits navigation and continues editing. Passive pointer reports and page/wheel inspection keep selection available.

Focus uses `selectedRowBand()`, including inverse video without color. Reveal operates over existing wrapped rows and leaves folded/filtered representations intact. Anchors distinguish historical headers, folded hints and filter hints from raw rows; synthetic gaps anchor to a neighboring stable row instead of the shared `lineIndex: -1`. The composer is never rewritten during navigation, preserving cursor, draft and paste atoms and avoiding stale restoration. Fold/filter state stays in its existing authority and is preserved by not mutating it.

The independent multi-picker retains search, multi-selection, preview, ordering, status toggle, report and key operations. Checkmarks replace checkbox text, with independent focus bands and Safe equivalents. Compare reuses `framePanel()` rules and focus bands; paging/rendering reserve the same frame/header/footer geometry, with compact headers/controls on short screens. The diff engine, reports and clipboard diff are unchanged.

## Verification and evidence

Focused serial affected-area tests passed, including the existing copy/report/compare tests and the real-PTY zsh, Bash and Fish navigation fixtures. Source typechecking and diff checks passed. Normal color and Safe/NO_COLOR presentation are tested in separate process environments, matching production capability initialization. Tests clean up private shells/services and semantic resources.

Canonical `verify`, `verify:release`, full-suite completion and performance benchmarks are **pending**, deliberately deferred because Gemini's canonical verification could still be using the shared host. No exact-feature CI was requested or claimed. Physical terminal validation remains pending. Linux Fish 3.7 issue #356 remains unresolved; passing local Fish fixtures do not settle it.

Evidence directory:
`/Volumes/T7Tmp/ai-dev/runs/-u/post-v020-copy-actions-0f911fd7/20261016-221535-KGRW40/copy-actions-evidence`.

Open `index.html` for production-renderer SVGs, or inspect `frames.json`, `.ansi` and `.txt` captures. Cases: Copy selection, Actions selection, contextual palette, palette return, `/copy ui`, Compare; 80×30 and 32×18; normal and Safe/NO_COLOR. `frames.json` records the source commit and tracked-dirty state. These are deterministic production frames using a simulated session boundary, not physical screenshots or real execution of displayed commands. Raw verification logs are `focused.log`, `pty.log`, `review-fixes.log`, `safe-no-color.log`, and `typecheck.log`.

Reproduce focused tests (use explicit test paths, never bare npm test for this slice while verification is shared):

```sh
rtk t7run --check
rtk t7run env -u NO_COLOR -u NMSH_COLOR TERM=xterm-256color COLORTERM=truecolor node scripts/dev/copy-actions-checks.mjs tests/outputSelection.test.ts tests/outputSelectionApp.test.ts tests/outputSelectionClipboard.test.ts tests/outputSelectionLive.test.ts tests/copyActionsPresentation.test.ts tests/copySelection.test.ts tests/compareOutput.test.ts
rtk t7run env NO_COLOR=1 NMSH_ICONS=safe node scripts/dev/copy-actions-checks.mjs tests/copyActionsPresentation.test.ts
rtk t7run npm run typecheck
rtk t7run node --import=tsx scripts/dev/copy-actions-frames.ts /absolute/T7/evidence/path
```

Dependencies were reused through read-only local package links; no package or lockfile changed. A fresh checkout can use the baseline's normal `npm ci` when resource coordination allows.

## Failure history and review

The first attempted focused `npm test` invocation unexpectedly expanded to the canonical suite. Only this agent's runner was interrupted; its queued-file cancellation errors are not suite validation. Later checks use `runTestFiles()` directly with explicit files. No other agent process was signaled.

Initial red tests established missing navigation/defaults/aliases, clipboard generation reuse, vanished-target feedback, direct palette generation safety, synthetic-gap/fold anchors, passive mouse reports, and short Compare framing/chooser. Those tests remain and now pass. One test initially called a nonexistent `exportTranscript`/filter getter; those fixture API typos were corrected. The Compare fixture's final-side expectation was corrected to match existing A/B ordering; the diff algorithm was not changed.

Existing `selectionRendering` assertions failed under the inherited unconfigured color environment, then passed under explicit xterm/truecolor with no assertion changes. Switching NO_COLOR inside an already imported colored process also exposed cached presentation constants in a test fixture; the Safe case now launches with NO_COLOR already established. The legacy copy-fold fixture now explicitly models a ready prompt when injecting completed records. Existing direct-copy live tests explicitly configure the preserved Quick Copy preference rather than depending on the changed new-config default. No failing assertion was weakened.

One focused read-only reviewer found three important issues (gap anchors, passive pointer dismissal, and no diff on short screens). Each received a failing regression and fix. Follow-up inspection found no remaining Critical/Important concern; its minor short-chooser concern was also reproduced and fixed.

## Integration sequence and overlaps

No moving Slice 2 branch or uncommitted Gemini changes were read or incorporated. Reconciliation is intentionally deferred to the maintainer-approved integration window:

1. Preserve this independent branch and finish/review Slice 2B, then Slice 2C on their own branches.
2. In a separate integration branch, apply Slice 3 after 2B/2C. Resolve `TerminalApp.ts` by responsibility rather than taking an entire side: imports/fields, slash dispatch, modal ownership, render decoration, Copy and palette handlers, notices, `/keys`, shutdown.
3. Reconcile `OutputBuffer.ts` clear/restore changes with summary metadata and folding. Keep `presentationGeneration` changes when IDs can be reused; do not bump it for ordinary fold/filter/reflow. Keep exact output/copy storage untouched.
4. Reconcile shared `configuration.ts`, `SettingsPanel.ts`, `slashCommands.ts` and generated help additions. Preserve both Queue settings/history additions and all saved Copy modes. `CopyPicker.ts` and `ComparePanel.ts` should remain focused presentation changes.
5. Verify typed Queue Summary metadata never enters `recentShellCommands()`, numeric copy numbering, Compare candidates or copied output. Summary rows must not inherit a command's `blockStartId` and receive its focus highlight accidentally. Test this with real 2B metadata after integration; this baseline has no typed saved-summary implementation.
6. Verify 2C's visible folded output still carries the completed record's stable `startId` through `blockStartId`. Extend the anchor representation discriminator if 2C adds a new hint kind. Confirm copying all 400 lines from folded queued output, search/filter restoration, and unchanged journal/raw exports.
7. Rerun affected tests and canonical/release verification on the integrated source once the host is free, then exact-feature CI. Obtain physical QA before release claims.

Anticipated textual conflicts: `src/app/TerminalApp.ts`, `src/output/OutputBuffer.ts`, `src/prompt/configuration.ts`, `src/ui/SettingsPanel.ts`, `src/commands/slashCommands.ts`, `src/help/helpContent.ts`. Behavioral overlaps: summary row ownership, fold hints and viewport anchors, copied-output auto-expand, modal priority and shared notice geometry. New controller/tests are independently testable on the pinned baseline.

## Physical QA still required

Use Ghostty and Terminal.app at normal and narrow widths, including Safe/NO_COLOR, Bottom/Top/Flow and Normal/Chat. Try `/copy`, `/cp`, `/copy latest`, saved Quick Copy/picker preferences and numeric/range/list selectors; copy tabs, Unicode, trailing blank lines and `seq 1 400` into an external editor. Check silent output and clipboard-unavailable retry.

Try `/actions`, `/action`, numeric forms, failure/reference filtering, Enter to palette, Esc to the same selection, Esc to the entry viewport/draft; confirm focus alone triggers nothing. Exercise edit/rerun/pager handoff and pointer Actions parity. Keep `/copy ui` search/multi-select/preview/report/status/order working. Inspect Compare at short heights, page to the last change, and copy the exact existing diff/report. Review fake-token/private-path redaction before report copy.

During a running command, hidden/password read, single-key read and fullscreen application, confirm input stays with its owner and selection never opens. Check resize and wheel inspection, synthetic gaps/folded blocks and restoration from DETACHED/FOLLOW. No physical QA is claimed by this checkpoint.
