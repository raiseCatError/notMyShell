# v0.24.0 ledger — editor, document and workspace functionality

Durable progress record for the milestone. Another session can resume from here without repeating discovery. Baseline: `dev` = `master` = `bf9b532b` (v0.23.0 published; verified 2026-10-21). Work happens in disposable worktrees under `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/`, branches `feature/v024-*`, PRs target `dev`. Arcade: maintenance only. Nothing is merged to `master`, tagged or published without the maintainer.

## Scope decision

The paused issues #460–#469 are the milestone (the maintainer superseded the earlier "do not revive" instruction). Reliability work is supporting: only what blocks or hardens editor/workspace work, or a small independent fix. Parked outside this milestone: #473 item 2 (queue exec attribution; a failing test and a sketch of the fix exist as a git stash in the v024 worktree, needs a retitle of the active output block), #426/#436/#443 and the macOS live-test flake in #473 item 3.

## What exists (v0.23.0)

`/view` (read-only viewer, `ViewerPanel`), `/edit` (`EditorPanel` over `TextBuffer`, safe atomic save in `fileEdit.ts`), the document workspace for Markdown/HTML (`DocumentWorkspace`: source | edit | preview of one buffer; preview is Chromium when installed, else NMSh's renderer), `src/markdown/*` (marked-based blocks/inline/html, source-position-free), image/graphics transport, `/browser`. Not present: split view, hybrid rendering, any source-position map, diagnostics, snippets, recovery.

## Issue map, dependencies, order

| # | Feature | Depends on | Size | Order |
|---|---|---|---|---|
| 469 | Private crash recovery of unsaved buffers | `fileEdit`, `TextBuffer` only | S | **1 — this batch** |
| 463 | Table/list helpers, footnotes; hunk review of external changes | `TextBuffer`; hunk review reuses 469's compare | M | 2 (list/task helpers first, hunk review after) |
| 468 | Snippets and wrap actions; unsaved Playground | `TextBuffer` ops, workspace modes | M | 3 |
| 462 | Heading slugs/outline, `<details>`; Mermaid/math later | `src/markdown`; graphics for diagrams | M–L | 4 (slugs, outline, details first) |
| 466 | Static diagnostics (links, anchors, assets); runtime console later | slugs from 462; buffer versions | M | 5 |
| 461 | Source/preview split in one pane | ScreenPlan layout, 460's source anchors | L | 6 |
| 460 | Hybrid rendered Markdown with raw active line | source-span AST, 461 projection | L | 7 |
| 465 / 467 / 464 | Viewport presets, visual snapshots, Inspect→Edit | Chromium preview + split (461) | L each | last; browser-backed, optional |

469 first: no renderer dependency, protects every later editing mode, and its draft format carries cursor/scroll so split/hybrid reuse it. 462's slug rules feed 466. 460 and 461 share a source-position mapping that must be designed once (a source-span AST over `marked` tokens) before either starts.

## Batches

1. **#469 crash recovery** — branch `feature/v024-draft-recovery`. Done: `src/viewer/draftRecovery.ts`, editor `recover` dialog, app wiring, tests (`draftRecovery*.test.ts`), design section, changelog. Status of acceptance: restore/compare/discard/keep, byte/format preserved through the normal save, SIGKILL, symlinked store, liveness, bounds — automated. Not done: physical Ghostty/Zed pass (NOT RUN), encryption (decided against, see design), concurrent-window race beyond the per-pid files.

2. **#463 slice 1: list/task/link/wrap helpers** — branch `feature/v024-markdown-helpers`, stacked on PR #489 (needs `TextBuffer.replaceAll`'s neighbour `edit` and the editor dialog mechanism). Done: `markdownEdit.ts`, Enter / Tab / Shift+Tab / F1 menu, tests, design table, changelog. #463 remaining: **slice 2** (done, branch `feature/v024-markdown-tables`, stacked on slice 1): interactive GFM tables, **slice 3** hunk-by-hunk review of changes made on disk while editing — persistence and conflict safety, research first; #469's Compare is a one-line summary, not a merge.

3. **#463 slice 3: hunk-by-hunk external-change review** — branch `feature/v024-external-review`, stacked on slice 2. Done: `threeWayMerge.ts`, `ReviewPanel.ts`, wiring, tests, design section, changelog, `docs/testing/v024-editor-physical-qa.md`. Also fixed in the stack: #490 now carries the fence-state performance fix; #491 refuses a clipped table paragraph instead of editing part of a table. **#463 remaining:** physical QA only (NOT RUN); footnote renumbering was proposed in the issue and is not built.

4. **#468 slice 1: snippets** — branch `feature/v024-snippets` (worktree `v024-snip`), stacked on slice 3 (#492). Done: snippet engine, searchable palette, snippet mode, HTML and Markdown catalogs, footnote action, tests, docs. **#468 remaining:** the unsaved Playground (scratch document identity for recovery, Save As, dirty-close) — next slice; Split preview is **deferred to #461** (Playground must use whatever modes the workspace has: source, edit, preview).

5. **#468 slice 2: Playground** — branch `feature/v024-playground` (worktree `v024-snip`), stacked on slice 1. Done: scratch identity, Save As, dirty close, `/playground`, crash recovery of scratch drafts, native-renderer preview only. **#468 status:** snippets, structure actions and the unsaved Playground are implemented; the Source/Preview/Split acceptance item is met for Source and Preview, **Split is deferred to #461** (recorded, not faked). Also fixed on #492 after the independent review (see its design section). **#463** still lacks footnote renumbering (the footnote *insert* exists in the snippet palette) and all physical QA.

6. **#462 slice 1: source-position map and heading navigation** — branch `feature/v024-outline` (stacked on the Playground slice). Done: spans on every block, `MarkdownRow.line`, `DocumentIndex`, `SourceAnchor`, GitHub slugs, viewer `#` prompt + Backspace, editor *Go to heading…*/*Back*, `/view file#heading`, architecture note `docs/architecture/document-source-map.md`. **#462 remaining:** `<details>/<summary>` disclosure, Mermaid, math (distinct later slices), a persistent outline rail (not started: the prompt/palette fit the existing layout without taking width), following `#fragment` links inside a rendered document (no link focus exists yet). **Next in order:** #461 (Source/Preview/Split, using `rowForLine`/`lineForRow`), then #460, then #466. **#463** still lacks footnote renumbering.

7. **#461: split view** — branch `feature/v024-split` (stacked on #462 slice 1). Done: `split` mode with editor + native preview of one buffer, linked scrolling, focus/ownership, swap/ratio, narrow collapse, F2. **#461 remaining:** pointer input and hit testing, vertical orientation, the Chromium preview inside the split, preview→caret sync; physical QA. **Next:** #460 (hybrid Markdown editing) builds on `blockAt`/`rowForLine`; #466 diagnostics uses the heading index and block spans; #462's details/Mermaid/math slices; #463 footnote renumbering.

8. **#460: hybrid Markdown editing** — branch `feature/v024-hybrid` (from `dev` after #489–#496 merged). Done: hybrid mode, items from the source map, active-block raw editing, anchored viewport, split text-pane toggle, tests, independent review (see its section). **#460 remaining:** images in place, visual-line movement, pointer input, tables as a grid, HTML. **#461** still lacks pointer input, preview→caret sync, vertical orientation and the Chromium preview; **#463** footnote renumbering; **#466**, **#462** (details/Mermaid/math), **#464/#465/#467** not started.

## Environment notes

Scratch and test runs: `t7run`; focused tests via `/Volumes/T7Tmp/ai-dev/runtests.mjs` (see the testing-gotchas memory). `npm ci` was needed in a fresh worktree (the main checkout's `node_modules` is stale).
