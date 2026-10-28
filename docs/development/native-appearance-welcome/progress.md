# Native appearance / welcome progress

## Claude continuation — 2026-10-28 (supersedes the Codex state below)

Codex hit its usage limit mid-checkpoint; Claude Code resumed in the same worktree and branch. Nothing was reset or discarded.

- Codex's last canonical run (slice1-canonical-verify.log, 10:54) never finished: no exit status, no live test process remained. Its three live failures (zsh/bash queue provenance, Flow fullscreen) all show the frontend produced 0 bytes in 20 s, i.e. startup timeouts under suite load. Not attributed to this slice without evidence; checked separately (see TEST_RESULTS).
- Newline-removal bug: the fix was NOT present. Fixed in `planHostRemoval` (`withoutHook`): removes only the owned span and restores one line break (CRLF if the hook used CRLF) only when both the remaining prefix and a later suffix are non-empty and neither supplies one; with nothing after the hook the original no-final-newline bytes return. Regression added for Ghostty/LF and Kitty/CRLF, with and without a later user append (red first, then green).
- New Kitty regression found during recovery and fixed: enabling `hostConfiguration` for Kitty made `/keyboard` open the Ghostty keybinding installer and end in "Failed to install binding". `installKeyboard`/`keyboardReload` are now optional and present only for Ghostty; `/keyboard` on Kitty shows guidance as on `dev`. Test added in hostIntegration.test.ts.
- Focused: hostAppearance, appearanceHub, hostIntegration, hostProfiles 36/36 pass; typecheck and git diff --check pass.
- Independent review of the final diff: no blocker; two should-fix items (INDEPENDENT_REVIEW.md, Claude section).
- Canonical `npm run verify` started 11:0x on manifest e894b2b5 → log `slice1-canonical-verify-claude.log` (background; check its last line for `exit=`).
- Kitty 0.49.2 facts (installed, headless private HOME): `custom_shaders` is ONE space-separated list of pipeline names loaded in order (a later line replaces an earlier one, so NMSh must compose the user's existing names, never append a competing line); `auto_reload_config` default 0.1 s auto-reloads when kitty.conf existed at start. Shipped catalog via `list_kitty_resources('kitty.shaders.custom')`: pipelines crt-blue, cursor-trail-{blaze,default,lightning,motion-blur}, dim-inactive-windows, fireworks, fireworks-rockets, focus-highlight, inside-the-matrix, northern-lights, pond-ripple, spotlight, tab-change; shaders also bloom, crt, negative, sample, tft, underwater, water. Built-in parameters are `static const` values overridden by pipeline `var <type> <name> <value>` lines (docs: sw.kovidgoyal.net/kitty/custom-shaders).
- DONE since: verify classified (2 load timeouts, both pass alone); both review should-fix items fixed with regressions; focused 39/39; Slice 1 committed (see git log).
- NEXT EXACT ACTIONS (superseded items 1–3 are done): (1) read the verify log result and classify any failure (rerun a failing live file alone once; compare with origin/dev only if it fails alone); (2) fix review should-fix 1 with a regression; verify Kitty config-dir order for should-fix 2 and fix if confirmed; focused tests + typecheck; (3) commit Slice 1 (no AI attribution), push branch; (4) Slice 2: Kitty pipeline generator referencing shipped shaders by name with `var` overrides parsed from installed `.slang` headers, composing existing `custom_shaders`.

---

## Codex state at interruption (historical)

Current phase: Slice1 usable safe host appearance implemented, awaiting stable canonical verification and final review. Overall Shader/Welcome/GPU program is INCOMPLETE.

Worktree: /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/appearance-welcome-20261028
Repository: https://github.com/raiseCatError/notMyShell
Branch: feature/appearance-welcome-20261028
Committed HEAD before this checkpoint: a7bbfb33f515ad5c7f0359a3f7baa0eb92b2a13c (research checkpoint, pushed).
Base: origin/dev c690de055daeb7b33ed8b5e302ef01133b3e55b4; unchanged on last remote check.
Source changes below are uncommitted/unpushed. No feature PR yet. Existing #513/#514 untouched/open/unmerged.

Human explicitly waived brainstorming design-document approval and approved direct implementation. No more routine approval gate. Production host-config writes, Homebrew, merges/releases/master/tags/deployments remain unauthorized.

Implemented Slice1: bounded static Ghostty/Kitty config inspection; actual file/include provenance and unsupported-value refusal; consent-separated exact plans, narrow owned fragments/ledger, stale/ownership/mode/symlink checks, atomic per-file staging and rollback; exact managed removal preserving later unrelated edits; safe host snapshot UI with RGB editing, review/confirm/cancel, restoration, readable small-window controls; passive Kitty appearance adapter.

Validation: slice1-focused-final.log32/32 passed; npm run typecheck passed; git diff --check passed. Independent review findings reproduced/fixed, final high-blur correction covered. Stable canonical verify starting now with source-manifest capture; no source/test changes while it runs. First full verify failed configuredCompletion.test.ts0vs4096 and overlapped edits, so not exact-baseline evidence. Physical QA, GPU rendering, performance and feature CI NOT RUN.

Next exact action: inspect stable canonical result and source-manifest match; complete final independent review, commit coherent Slice1, then draft focused PR targeting dev with Refs399 and accurate testing limits. Do not merge. Next implementation slice is real host capability/catalog/native shader integration; all semantic GPU and Welcome requirements remain in HANDOFF/PLAN.

Dirty files at this checkpoint:
```
 M docs/development/native-appearance-welcome/DECISIONS.md
 M docs/development/native-appearance-welcome/HANDOFF.md
 M docs/development/native-appearance-welcome/RESEARCH.md
 M docs/development/native-appearance-welcome/TEST_RESULTS.md
 M docs/development/native-appearance-welcome/progress.md
 M src/app/TerminalApp.ts
 M src/appearance/AppearanceHub.ts
 M src/appearance/AppearancePanel.ts
 M src/appearance/ghostty.ts
 M src/host/capabilities.ts
 M src/host/integration.ts
 M tests/appearanceHub.test.ts
 M tests/hostProfiles.test.ts
?? docs/development/native-appearance-welcome/PLAN.md
?? src/appearance/hostAppearance.ts
?? src/appearance/hostConfiguration.ts
?? src/appearance/hostFiles.ts
?? src/appearance/hostPaths.ts
?? tests/hostAppearance.test.ts
```

Final independent re-review: no material blocker found in Slice1. Current stable canonical run active (tool session83932). Project read attempt failed once for missing read:project; no retry or claimed status update.

New blocking slice edge case reproduced while canonical remains frozen: removing an owned hook from a config originally without final newline joins a later user-appended setting onto the previous line. Fix after current run, add LF/CRLF coverage, then revalidate. Do not commit as complete before fixing. Evidence newline-removal-red.md.
