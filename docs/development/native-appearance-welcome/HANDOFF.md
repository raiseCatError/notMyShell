# Native appearance and Welcome Studio handoff

## Objective and required scope

Implement native GPU Shader Studio and host appearance, plus a comprehensive Welcome Studio under /appearance. /cursor and /welcome must open canonical editors. Preserve persistent zsh/Bash/Fish PTY, input ownership, raw output, copy, viewport and existing settings. No duplicate engines or contradictory Clean/Rich, Chroma, cursor or welcome settings.

Shaders: Auto/Host Native/Portable per host; decorative effects opt-in; initial exact config diff and consent; ownership ledger, safe atomic writes, conflict disclosure, rollback/removal. Kitty >=0.49 Slang/pipelines with installed official catalog, bounded variables, composition/event/texture validation. Ghostty GLSL is separate. Extend opacity/blur/background, fix false reads/discovery, truthful capabilities/reload/restart. No remote-control permissions or automatic source download/execution. Do not overwrite user config/themes/keybindings/shaders.

Welcome: preserve Vespyr/Fastfetch/installed-only Neofetch/Macchina/Zigfetch/None, add customizable native layout. Existing external configuration and logos read-only. Local path entry (absolute, relative, ~/), local navigable image-filtered picker, metadata, contain/cover/crop/alpha, PNG/JPEG/WebP/GIF/APNG and safe ANSI/ASCII. Validate assets, bounded animation decode/composition and cache, preserve originals. Still-image effects: float, pulse, layered parallax, glow, shimmer, particles, reveal, pan/zoom, original. No fabricated character motion, cloud uploads or implicit generators. Rich layout/palette/title/borders/mascot/text/links/greeting/module customization and preset save/duplicate/import/export/reset. Sensitive facts opt-in; no arbitrary shell fields. Do not export private source images/paths silently.

Both live editor preview (pause/replay, compact/expanded, narrow/wide, theme/reduced-motion, imported before/after) and P actual full-terminal alternate-screen preview are REQUIRED. Preview and actual startup share composition/layout/renderer/animation sequencing. Real host images and animations where supported; production fallback explained otherwise. Esc restores unsaved draft/selection. No OS resize/fullscreen, duplicate shell/session/startup commands, transcript frames or input leakage. Startup must not block shell readiness. Stop on input/leave/resize/detach/shutdown/handover and release graphics/timers. Keep saved-session semantics and one provider capture.

All visual systems need investigation and justified integration: prompt, Chroma, Clean/Rich, expressions, command lifecycle, queue/approval, notifications, welcome, idle. Extend common semantic animation model (event/target/timeline/look/colors/intensity/speed/cancel/capability/preference). Existing text/layout/renderers remain authoritative. Use native only with reliable documented targeting/events, otherwise existing Portable. Never fake targeting through pixels or config writes/reloads per event. No overlapping native/Portable effects. Reduced Motion, Effects Off, NO_COLOR win. Clean stays foreground-only/transparency-safe; Rich keeps intentional fills. No shader impacts on unrelated apps/windows.

## Exact state

Read progress.md and reconcile with git. Worktree branch starts at c690de055daeb7b33ed8b5e302ef01133b3e55b4 (origin/dev). No product changes/tests/PR yet. Only checkpoint docs are pending at initial write. Initial branch tracked origin/dev; upstream may become its feature branch after push. No dependency install/build/test attempted.

Evidence: /Volumes/T7Tmp/ai-dev/nmsh-native-appearance-welcome-20261028
Tracked snapshots: docs/development/native-appearance-welcome/. These are synchronized checkpoint snapshots of the same files, not a separate status system. Update both from one content set at every checkpoint; unique raw evidence stays under evidence root. Read actual Git HEAD for the checkpoint commit.

Primary checkout was feature/status-strip-2 ahead 1 with package.json/package-lock.json edits; preserve it and shared stashes. Never switch/reset it. #513 head a57568be5e8b11cf927a00371c1b4783cadde53d and draft #514 head416bc51a4f6151236d959ef6a62d2d1653772287 are OPEN, unrelated and unmerged, comprehensive CI failure unresolved.

## Environment

Sandbox diskutil cannot access DiskManagement; sandbox t7run fails identity. Elevated t7run --check PASSED and verified physical T7 UUID73CBDC38-3B3A-32A4-B18C-C06D627FB10F, APFS UUID62D4E8A9-087C-4927-A62F-25BB88B7F1C7, backing /Volumes/T7 Shield/nmsh-tmp.sparsebundle. Use real elevated preflight, never bypass guard or fall back internally. Scratch free approximately6.1GiB at checkpoint. Reads/network sometimes need elevation too. Launch scratch tools via t7run; NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev for short test socket paths. Read full AGENTS, ~/.codex/RTK.md and ~/.config/ai-storage/policy.md. Prefix shell commands with rtk.

Installed Kitty reports0.49.2. Installed Ghostty remains1.3.1. User authorized updating hosts, then latest addendum prohibits further Homebrew work. Homebrew metadata/runtime were refreshed7.0.10->7.0.11; Ghostty1.4.0 download succeeded but upgrade failed at hdiutil attach Permission denied. No installed Ghostty app/config was replaced. Official DMG checksum3a02075dbd24318d778426af41dee5507d53ecc4578ede96912ec9ce6d18d3e8. diskutil image attach --readOnly worked. Signature-verified1.4.0 staged at /Volumes/T7Tmp/ai-dev/downloads/nmsh-ghostty-1.4.0-20261028/Ghostty.app; --version confirms1.4.0. Installer image disk17 was ejected successfully. No Ghostty GUI process/window launched. Staged app is preserved for validation, not a claim system Ghostty upgraded. Fastfetch reports2.68.1; animation support in this binary not yet established.

## Next exact action

Resolve pending brainstorming opt-out/design approval; do not turn absent answer into approval. Then read relevant implementation skills, prepare a reviewable sliced plan, install dependencies on T7 and run baseline verification. First product slice: issue399 safe host discovery and effective reads plus verified owned fragments and explicit preview/apply/remove. Audit existing Theme Bridge ownership primitives before introducing new ones. Confirm newest dev still matches base before implementation; never pull stabilization heads. Research scope is preliminary, not a finished design or implementation.

## Restrictions

No merges, master edits, release/tag/deploy/Homebrew actions. No production host-config writes. Do not enable broad remote control. No automatic shader downloads or execution. Private HOME/config tests only. Physical Kitty/Ghostty/Zed QA is NOT RUN. No fabricated GPU, performance or terminal validation claims. Cleanup only task-owned disposable resources; keep worktree, original assets, stashes and unique evidence.

## Claude Code — Resume from this checkpoint

1. Run t7run --check in the actual environment (elevated if sandbox blocks DiskManagement); verify physical T7/APFS backing and GitHub connectivity. Stop disposable work if verification fails.
2. Read AGENTS.md, RTK/storage policy and these checkpoint files, plus the referenced ownership report when local; tracked snapshots preserve portable continuation context.
3. cd /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/appearance-welcome-20261028; run git status --short --branch, git rev-parse HEAD, git remote -v, git log -5 --oneline and git ls-remote origin refs/heads/dev refs/heads/feature/appearance-welcome-20261028.
4. Reconcile repository truth with progress.md/HANDOFF/TEST_RESULTS. Preserve all user edits/sessions/stashes and this existing branch. Do not create a duplicate feature branch or repeat completed functionality without evidence.
5. Resolve outstanding process approval if still pending, then continue the next incomplete slice. Independently review existing changes before integration. Do not merge.
6. Update the SAME checkpoint files after every slice/meaningful validation and before costly tests/CI/compaction/end. Record exact HEAD, dirty state, committed/pushed changes, commands/results, PR/CI, decisions/risks and precise next task. Keep repository snapshots synchronized and push coherent checkpoints when safe.
