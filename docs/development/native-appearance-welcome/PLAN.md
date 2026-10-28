# Native appearance and welcome implementation plan

> Agent execution: use superpowers:executing-plans inline; test-first behavior changes and one independent review per coherent slice. Existing checkpoint files are the ledger. The human has explicitly approved direct execution, so no further plan-approval round applies.

Goal: deliver opt-in native host shader/appearance customization and a shared startup/full-preview welcome pipeline without changing shell/input ownership.
Architecture: keep canonical PromptConfiguration/editors, existing GraphicsService and semantic Transitions. Separate host parsers/compilers and ownership transactions from TerminalApp. Native semantic rendering requires documented target/event support; otherwise existing Portable painters remain authoritative.
Tech stack: TypeScript/Node, node:test, existing parsers/decoders and terminal host adapters; no new dependency without demonstrated need.
Spec: HANDOFF.md plus DECISIONS.md and RESEARCH.md in this directory (approved requirements, including all addenda).

Global constraints: no master/merges/releases/tags/deployments/Homebrew; no real host-config writes; preserve both Ghostty copies and PRs513/514. T7 guard before scratch work. All physical QA NOT RUN until performed.
Review focus: stale config edits, symlink/permission/path swaps, include precedence/cycles, partial-write recovery, unsupported native event/target claims. Each belongs in the owning slice tests.

## Slice1: usable safe host appearance (issue399 foundation)
Files: appearance/hostPaths.ts (discovery); appearance/hostConfiguration.ts (bounded provenance-aware reads); appearance/hostAppearance.ts (typed settings/plans/transactions); appearance/hostFiles.ts (safe snapshots/atomic mutation); existing host integration, hub and TerminalApp action wiring. Tests: hostAppearance.test.ts, appearanceHub.test.ts, hostIntegration.test.ts.
Interfaces: readHostAppearance(host,context) returns true values/origins/problems; planHostAppearance(host,settings,context) and planHostRemoval(host,context) return exact preview or refusal; applyHostAppearance(plan) verifies captured files before atomic writes and records only owned artifacts.
- [ ] Add failing private-HOME tests for discovery, includes, read-only/blocked/stale configs, symlinks, owned writes and removal preserving unrelated settings.
- [ ] Implement readers and transactions; no executable include or broad remote control.
- [ ] Replace silent save with an exact preview/explicit confirmation in existing hub; expose safe restore.
- [ ] Run focused tests, full canonical verify and independent slice review; fix findings, commit/push draft focused PR targeting dev. Keep issue open for physical QA.

## Slice2: real native shader backends
Files: cursor/backends.ts/native.ts, new appearance shader catalog and host-specific pipeline generators; deterministic backend/config tests.
- [x] Test version detection, installed catalog checks, controls, ordering/texture/event validation, opacity conflicts and no duplicate trail. (Kitty)
- [x] Kitty Slang/pipeline generator referencing installed shipped shaders by name (kittyShaderCatalog.ts, kittyShaders.ts). [ ] Ghostty GLSL enhancements: next Ghostty slice (separate PR).
- [x] Curated controls/persistence and safe ownership-based plans for Kitty (KittyShaderPanel.ts, /appearance row, /cursor link); Portable/unsupported states truthful.
- [x] Kitty headless compile in private config (tests/kittyShadersLive.test.ts); NOT GPU rendering. Review and stacked PR: see TEST_RESULTS/HANDOFF.

## Slice3: semantic animation integration
Files: motion/transitions.ts, existing Chroma/motion/cursor/queue/prompt/notification/idle call sites and tests.
- [ ] Audit every listed surface, extend current semantic event/target/timeline/look/gate/cancel model and select native/Portable/off without duplicate scheduler.
- [ ] Test unchanged Clean/Rich paints on unsupported/unconfigured hosts, explicit Portable, timing/cancellation, NO_COLOR/reduced motion and alpha.
- [ ] Only native-map documented reliable target/event mechanisms; unsupported widget events keep current renderer. No pixel inference or per-event config rewrite/reload.
- [ ] Review/test/performance-check as its own slice/PR.

## Slice4: Welcome Studio layout and canonical editor
Files: output/Welcome.ts/WelcomeProviders.ts, new welcome composition/model/editor, prompt config normalization, slash/hub/setup wiring and tests.
- [ ] Test provider preservation, canonical settings normalization, templates/custom modules and privacy-safe preset import/export.
- [ ] Implement shared pure composition used by startup/editor preview; local path input/picker and read-only logo discovery; explicit fact collection only.
- [ ] Implement live preview, narrow/wide/reduced-motion/before-after and canonical /welcome access. Preserve originals/config.
- [ ] Focused/canonical tests and review; separate PR.

## Slice5: bounded animation and actual full-terminal preview
Files: existing GraphicsService/typed ImageSurface and decoder extensions, welcome sequencing/lifecycle, TerminalApp/renderer surface ownership and tests.
- [ ] Test bounded actual GIF/APNG frame composition/disposal, corrupt inputs, aggregate allocation budgets, local still transforms, no original mutation.
- [ ] Extend shared graphics service and welcome sequencer with typed frame upload/control/cleanup and deterministic still fallback.
- [ ] P uses SAME production composition/renderer/sequence in managed alternate screen; Esc restores draft/input/selection; no extra shell/capture.
- [ ] Test startup/full-preview parity across widths/capabilities/missing assets, resize/detach/input/shutdown cancellation and zero live timers/uploads afterward. Review/verify separate PR.

## Slice6: integration and evidence
- [ ] Canonical build/typecheck/tests, exact-head hosted CI and independent review for implemented slices.
- [ ] Measure idle CPU/RSS, command latency and observable native costs with disabled/enabled configurations; no fabricated GPU claims.
- [ ] Document exact implemented vs required remaining scope, safe reset/reload/restart, config preservation proof and physical Kitty/Ghostty/Zed QA checklist.
- [ ] Update the same checkpoint files after every milestone/validation and before expensive operations. Preserve unique evidence/commits/dirty state and next exact action. Never merge automatically.
