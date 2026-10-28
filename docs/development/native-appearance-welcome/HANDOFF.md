# Native appearance and Welcome Studio handoff

## Slice 3 state (Ghostty native shaders) — read first

- Branch `feature/ghostty-native-shaders-20261028` (worktree `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/ghostty-native-shaders-20261028`) is stacked on Slice 2 `feature/kitty-native-shaders-20261028` @ de2afd02 (PR #516, draft). Its draft PR targets the Slice 2 branch; retarget only after review, never automatically.
- Code map: `src/appearance/ghosttyShaderCatalog.ts` (version table, uniforms, presets, GLSL generation), `src/appearance/ghosttyShaders.ts` (inspection, effective-list simulation, compose/plan/apply/remove, sync, reload-pending, launch inspection), `src/appearance/glslStudio.ts` (app controller; TerminalApp never names hosts), `src/appearance/ShaderStudioPanel.ts` (shared Kitty/Ghostty studio), `GhosttyShaderPanel.ts`, cursor integration in `cursor/backends.ts` (`GHOSTTY_TRAIL_BACKEND`, pending suppression) and `cursor/native.ts` (legacy fragment pause).
- Owned files (host-appearance dir): `ghostty-shaders.conf`, `ghostty-shaders/<id>.glsl`, `ghostty-shaders.json` (ledger), `ghostty-reload.json` (pending trails), plus one hook `config-file = ?…ghostty-shaders.conf` at the end of the effective root config.
- Next slices (all still required): 4 render routing (semantic surfaces → native/portable/off with reasons; native only for cursor trail and host focus) + Chroma-driven native colors via `idleStops`; 5 Shader Studio UX with previews; 6 Welcome Studio (uses the animation decoder branch); 7 integration, performance, QA, docs.
- Known follow-up (Slice 2 scope, not fixed here): Kitty integrated with motion Smear may draw Kitty's tail while Portable draws smear.
- Physical Ghostty/Kitty/Zed QA: NOT RUN. GPU rendering: NOT verified.

## Slice 2 state (Kitty native shaders) — read first

- Slice 2 branch `feature/kitty-native-shaders-20261028` (worktree `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/kitty-native-shaders-20261028`) is stacked on Slice 1 `feature/appearance-welcome-20261028` @ 4abd014d (PR #515, draft, unmerged). Its PR targets the Slice 1 branch so the diff is Slice 2 only; after #515 merges, rebase/retarget to `dev` only after review — never automatically.
- Code map: `src/appearance/kittyShaderCatalog.ts` (Kitty-parity parser, constants, curated presets, `kitty +runpy` discovery), `src/appearance/kittyShaders.ts` (inspection, composition, refusals, ledger, plan/apply/remove, sync, launch inspection, `writtenKittyTrail`), `src/appearance/kittyShaderSettings.ts` (persisted `hostShaders.kitty`), `src/appearance/KittyShaderPanel.ts` (studio UI), wiring in `TerminalApp.ts` (`openKittyShaders`, `handleKittyShaderKey`, `syncKittyShaderFiles`, `addKittyShaderRow`), hub row in `AppearanceHub.ts`, cursor ownership in `cursor/backends.ts` (`kittyTrail`, `KITTY_LIGHTNING_BACKEND`) and the Portable `cursor_trail` fix in `cursor/native.ts`.
- Owned files (macOS default): `~/Library/Application Support/notMyShell/host-appearance/kitty-shaders.{conf,pipeline,json}` plus one recorded hook `# NMSh Kitty shaders …` / `include …kitty-shaders.conf` at the end of the effective kitty.conf.
- Next slices (all still required): Ghostty GLSL backend enhancements; GPU-enhanced prompt/Chroma/Clean-Rich/completion feedback (only where documented targeting exists); full Shader Studio (remaining catalog: crt-blue, fireworks-rockets, bloom/tft/water/underwater/negative shaders, per-preset viewport); animated Fastfetch/Neofetch and imported logos; Welcome Studio; real full-terminal animated welcome preview; integration, performance and physical QA.
- Physical Kitty/Ghostty/Zed QA: NOT RUN. GPU rendering: NOT verified (headless compile only).

## Objective and required scope

Implement native GPU Shader Studio and host appearance, plus a comprehensive Welcome Studio under /appearance. /cursor and /welcome must open canonical editors. Preserve persistent zsh/Bash/Fish PTY, input ownership, raw output, copy, viewport and existing settings. No duplicate engines or contradictory Clean/Rich, Chroma, cursor or welcome settings.

Shaders: Auto/Host Native/Portable per host; decorative effects opt-in; initial exact config diff and consent; ownership ledger, safe atomic writes, conflict disclosure, rollback/removal. Kitty >=0.49 Slang/pipelines with installed official catalog, bounded variables, composition/event/texture validation. Ghostty GLSL is separate. Extend opacity/blur/background, fix false reads/discovery, truthful capabilities/reload/restart. No remote-control permissions or automatic source download/execution. Do not overwrite user config/themes/keybindings/shaders.

Welcome: preserve Vespyr/Fastfetch/installed-only Neofetch/Macchina/Zigfetch/None, add customizable native layout. Existing external configuration and logos read-only. Local path entry (absolute, relative, ~/), local navigable image-filtered picker, metadata, contain/cover/crop/alpha, PNG/JPEG/WebP/GIF/APNG and safe ANSI/ASCII. Validate assets, bounded animation decode/composition and cache, preserve originals. Still-image effects: float, pulse, layered parallax, glow, shimmer, particles, reveal, pan/zoom, original. No fabricated character motion, cloud uploads or implicit generators. Rich layout/palette/title/borders/mascot/text/links/greeting/module customization and preset save/duplicate/import/export/reset. Sensitive facts opt-in; no arbitrary shell fields. Do not export private source images/paths silently.

Both live editor preview (pause/replay, compact/expanded, narrow/wide, theme/reduced-motion, imported before/after) and P actual full-terminal alternate-screen preview are REQUIRED. Preview and actual startup share composition/layout/renderer/animation sequencing. Real host images and animations where supported; production fallback explained otherwise. Esc restores unsaved draft/selection. No OS resize/fullscreen, duplicate shell/session/startup commands, transcript frames or input leakage. Startup must not block shell readiness. Stop on input/leave/resize/detach/shutdown/handover and release graphics/timers. Keep saved-session semantics and one provider capture.

All visual systems need investigation and justified integration: prompt, Chroma, Clean/Rich, expressions, command lifecycle, queue/approval, notifications, welcome, idle. Extend common semantic animation model (event/target/timeline/look/colors/intensity/speed/cancel/capability/preference). Existing text/layout/renderers remain authoritative. Use native only with reliable documented targeting/events, otherwise existing Portable. Never fake targeting through pixels or config writes/reloads per event. No overlapping native/Portable effects. Reduced Motion, Effects Off, NO_COLOR win. Clean stays foreground-only/transparency-safe; Rich keeps intentional fills. No shader impacts on unrelated apps/windows.

## Exact state

Read progress.md and CHECKPOINT.json, then reconcile with Git. The explicit human design-gate waiver is granted. Slice1 product changes are uncommitted on pushed research HEAD a7bbfb33f515ad5c7f0359a3f7baa0eb92b2a13c. Baseline source c690de055daeb7b33ed8b5e302ef01133b3e55b4 is unchanged remotely. No feature PR yet. Do not discard the dirty files: they contain the safe host appearance implementation and tests. Dependencies installed in this isolated worktree.

Evidence: /Volumes/T7Tmp/ai-dev/nmsh-native-appearance-welcome-20261028. Tracked synchronized snapshots: docs/development/native-appearance-welcome/. The JSON receipt is the current local event record; tracked documents travel with Git. Preserve raw logs and source manifest.

Primary checkout remains separate and must not be switched/reset. Preserve shared stashes and active sessions. #513 head a57568be5e8b11cf927a00371c1b4783cadde53d and draft #514 head416bc51a4f6151236d959ef6a62d2d1653772287 remain unrelated/open/unmerged with failed comprehensive gates. No stabilization source was imported.

## Environment

Sandbox diskutil cannot access DiskManagement; sandbox t7run fails identity. Elevated t7run --check PASSED and verified physical T7 UUID73CBDC38-3B3A-32A4-B18C-C06D627FB10F, APFS UUID62D4E8A9-087C-4927-A62F-25BB88B7F1C7, backing /Volumes/T7 Shield/nmsh-tmp.sparsebundle. Use real elevated preflight, never bypass guard or fall back internally. Scratch free approximately6.1GiB at checkpoint. Reads/network sometimes need elevation too. Launch scratch tools via t7run; NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev for short test socket paths. Read full AGENTS, ~/.codex/RTK.md and ~/.config/ai-storage/policy.md. Prefix shell commands with rtk.

Installed Kitty reports0.49.2. Installed Ghostty remains1.3.1. User authorized updating hosts, then latest addendum prohibits further Homebrew work. Homebrew metadata/runtime were refreshed7.0.10->7.0.11; Ghostty1.4.0 download succeeded but upgrade failed at hdiutil attach Permission denied. No installed Ghostty app/config was replaced. Official DMG checksum3a02075dbd24318d778426af41dee5507d53ecc4578ede96912ec9ce6d18d3e8. diskutil image attach --readOnly worked. Signature-verified1.4.0 staged at /Volumes/T7Tmp/ai-dev/downloads/nmsh-ghostty-1.4.0-20261028/Ghostty.app; --version confirms1.4.0. Installer image disk17 was ejected successfully. No Ghostty GUI process/window launched. Staged app is preserved for validation, not a claim system Ghostty upgraded. Fastfetch reports2.68.1; animation support in this binary not yet established.

## Next exact action

**Claude continuation (2026-10-28):** newline-removal fix and Kitty `/keyboard` fix are in the working tree with regressions (see progress.md). Next: canonical verify on frozen source, independent review, commit/push Slice 1, then Slice 2 (Kitty native shaders). The Codex text below is historical.


Finish stable Slice1 canonical verification; source/test contents are frozen and captured in slice1-source-manifest.json. Full first attempt overlapped edits and failed configuredCompletion.test.ts4096-record capture (actual0), so it is not baseline proof. Final focused32/32 and typecheck passed. Read logs and inspect every failure, without weakening tests or expanding into unrelated stabilization fixes. Complete independent re-review, preserve a coherent commit and focused draft PR targeting dev when safe; report physical QA pending. Never merge. Then continue PLAN.md Slice2 actual capability/catalog/native backends, not more design approval.

Known limits of Slice1: static in-home non-symlink config graph only; unresolved themes/dynamic includes report unknown, not fabricated effective values. CLI overrides are not visible. Nested include conflicts can block setup intentionally. File identity is rechecked after staging, but POSIX pathname rename is not atomic compare-and-swap against arbitrary hostile races. No GPU support is claimed from this slice. Host installed/staged apps remain untouched.

## Restrictions

No merges, master edits, release/tag/deploy/Homebrew actions. No production host-config writes. Do not enable broad remote control. No automatic shader downloads or execution. Private HOME/config tests only. Physical Kitty/Ghostty/Zed QA is NOT RUN. No fabricated GPU, performance or terminal validation claims. Cleanup only task-owned disposable resources; keep worktree, original assets, stashes and unique evidence.

## Claude Code — Resume from this checkpoint

1. Run t7run --check in the actual environment (elevated if sandbox blocks DiskManagement); verify physical T7/APFS backing and GitHub connectivity. Stop disposable work if verification fails.
2. Read AGENTS.md, RTK/storage policy and these checkpoint files, plus the referenced ownership report when local; tracked snapshots preserve portable continuation context.
3. cd /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/appearance-welcome-20261028; run git status --short --branch, git rev-parse HEAD, git remote -v, git log -5 --oneline and git ls-remote origin refs/heads/dev refs/heads/feature/appearance-welcome-20261028.
4. Reconcile repository truth with progress.md/HANDOFF/TEST_RESULTS. Preserve all user edits/sessions/stashes and this existing branch. Do not create a duplicate feature branch or repeat completed functionality without evidence.
5. The human explicitly approved implementation and waived the design gate; continue the next incomplete slice without repeating that gate. Independently review existing changes before integration. Do not merge.
6. Update the SAME checkpoint files after every slice/meaningful validation and before costly tests/CI/compaction/end. Record exact HEAD, dirty state, committed/pushed changes, commands/results, PR/CI, decisions/risks and precise next task. Keep repository snapshots synchronized and push coherent checkpoints when safe.
