# UI and showcase pass

## Changes

- Shared focus labels use the live NMSh accent and bold weight. Current-provider/status markers, checked actions, tabs and disabled values retain separate meanings. Tools show persistent `[x]` markers independently of the focus band.
- Chroma labels distinguish the saved setting from local preview state and explain how to see base theme colors. `/syntax` shares theme families and variants with `/theme`, and its cache includes accent/custom-prompt context.
- First launch uses Setup Cat. Apply marks discovery complete even without appearance edits; Escape skips for now, leaving discovery pending. Completed legacy onboarding and explicit presets bypass it.
- A differing shell leads the default Native prompt. Only the former untouched default order migrates; customized orders, placement, visibility and colors remain authoritative.
- Related stack/toolkit/shell-switch docs are corrected. `ARCHITECTURE.md` is unchanged.
- All GIF demos and their stills were regenerated with larger opaque framing and a neutral welcome. New clips cover onboarding, syntax, Chroma, Rich motion, Ask, Fish/Vim and all named screensavers. VHS remains the reproducible recorder; these are not desktop captures of Ghostty/Zed.
- Simple and detailed architecture SVGs use the production Vespyr sprite. A separate 20-second silent H.264 promo combines real recordings with title cards and transitions.

## Assets and reproduction

`npm run demos` records all tapes in disposable homes. `npm run promo` creates `assets/promo/nmsh-promo.mp4` and its PNG poster using ffmpeg and macOS Quick Look. `npm run demos:check` probes and fully decodes the media. `node --import=tsx scripts/demos/architecture-svg.ts` regenerates both diagrams.

The demo identity changes only the welcome presentation. `/version` remains factual, and motion remains live. Recordings use no real home/config/history; installs are reviewed and cancelled, Keep Awake uses its inert backend, and `/llm` demonstrates configuration without model downloads or claims of inference. Failed recordings clean up and GIF replacement is atomic.

## Verification

Focused UI, syntax, Chroma, onboarding, prompt-order and tool tests passed. `npm run verify:fast` passed. A full `npm run verify` passed before the final optional Chroma-context correction; that correction has its own passing regression test.

The subsequent default parallel run passed the new regression but intermittently failed two unchanged fixtures: native nested-path completion returned no candidates, and a real-tmux teardown timed out in `lsof`. Both fixtures and their support code match the base commit, and both passed a serial recheck. No timeout or assertion was weakened.

The final build passed. The final full canonical test selection, using the supported `npm test -- --test-concurrency=2` override, passed the completion and tmux checks and all new regressions, but had one intermittent failure in the unchanged fake Oh My Posh provider fixture (`tests/shellFrameworks.test.ts`, effective-provider assertion). That entire file passed immediately in isolation. This is a remaining test-reliability caveat, not a claimed all-green final run. `git diff --check` passed.

`npm run demos:check` passed: every GIF, still, promo and poster decoded completely and met its dimensions/format checks. Documentation tests passed for links, tape coverage, all named screensavers, neutral identity and personal-data checks. The architecture generator typechecked; recording/check/promo scripts passed syntax checks. Key generated frames and both diagrams were reviewed locally.

Local rendering and automated PTY fixtures do not constitute physical terminal validation.

## Recommended physical QA

Use Ghostty and Terminal.app, with a quick Zed comparison where available.

1. Traverse `/setup`, `/settings`, `/appearance`, `/theme`, `/prompt`, `/providers`, `/cursor`, `/zoomies`, `/shell`, `/syntax` and `/tools`. Focused labels should use the accent and weight; current items and unavailable values should stay distinct.
2. In `/tools`, select two missing installable items with Space, move away, review with Enter, cancel, and toggle one off. Repeat with `NO_COLOR=1` and Safe glyphs: `[x]` must remain visible independently of focus and footer count.
3. Compare Chroma Off/base previews and enabled previews in `/prompt`, `/theme` and `/setup appearance`. C in Theme Studio and P in Setup affect only the local preview; C in `/prompt` changes its draft. `/chroma` supplies the full controls.
4. In `/syntax`, switch families and variants, use grayscale and highlighting Off, save, and inspect input and new history. Custom and Catppuccin accents should update; arbitrary command output must keep its colors.
5. Start with a temporary XDG config directory and `nmsh --new`. Setup should open automatically. Apply unchanged defaults, exit and relaunch against that directory: setup should stay completed. Escape should skip only for now.
6. Use `/shell fish`, wait for readiness, and inspect the leading shell module with default ordering. Reordered modules should stay where saved. Enter/exit Vim and check the restored composer, terminal modes, selection and viewport behavior; compare themes before and after the switch.
7. Inspect the README and expanded gallery on GitHub at desktop and narrow widths. Check animation playback, text size, all screensavers including raiseCatError, and standalone promo playback. Generated screenshots were reviewed locally; signed-in GitHub rendering was not exercised.

## Exact changed files

### Application and shared UI

- `src/app/TerminalApp.ts`
- `src/appearance/AppearanceHub.ts`
- `src/appearance/AppearancePanel.ts`
- `src/appearance/ChromeEditor.ts`
- `src/appearance/ThemeStudio.ts`
- `src/appearance/chromaNotes.ts`
- `src/ask/AskPanel.ts`
- `src/cursor/CursorPanel.ts`
- `src/doctor/DoctorPanel.ts`
- `src/dotfiles/DotfilesPanel.ts`
- `src/host/OpenPanel.ts`
- `src/idle/IdleVisuals.ts`
- `src/input/SyntaxPanel.ts`
- `src/input/syntaxTheme.ts`
- `src/keepAwake/KeepAwakePanel.ts`
- `src/keyboard/KeyboardPanel.ts`
- `src/output/TranscriptPanel.ts`
- `src/output/Welcome.ts`
- `src/prompt/PromptPanel.ts`
- `src/prompt/configuration.ts`
- `src/providers/ProviderPanel.ts`
- `src/providers/ProvidersOverview.ts`
- `src/setup/SetupCat.ts`
- `src/setup/glyphDiagnostic.ts`
- `src/shell/ShellPanel.ts`
- `src/themeBridge/ThemeBridgePanel.ts`
- `src/tools/ToolsPanel.ts`
- `src/tools/config/ConfigureList.ts`
- `src/tools/config/TmuxPanel.ts`
- `src/ui/ColorPicker.ts`
- `src/ui/CommandPalette.ts`
- `src/ui/GradientEditor.ts`
- `src/ui/LayoutPanel.ts`
- `src/ui/RowPanel.ts`
- `src/ui/SettingsPanel.ts`
- `src/ui/formControls.ts`
- `src/ui/palette.ts`
- `src/understanding/UnderstandingPanel.ts`

### Tests

- `tests/chromaQuickControl.test.ts`
- `tests/docsAssets.test.ts`
- `tests/promptProviders.test.ts`
- `tests/rightPrompt.test.ts`
- `tests/setupCat.test.ts`
- `tests/shellModule.test.ts`
- `tests/syntaxHighlighting.test.ts`
- `tests/uiConsistency.test.ts`

### Recording and rendering

- `scripts/demos/README.md`
- `scripts/demos/architecture-svg.ts`
- `scripts/demos/ask.tape`
- `scripts/demos/check.mjs`
- `scripts/demos/chroma.tape`
- `scripts/demos/motion.tape`
- `scripts/demos/promo.mjs`
- `scripts/demos/render.mjs`
- `scripts/demos/screensavers-cats.tape`
- `scripts/demos/screensavers-motion.tape`
- `scripts/demos/screensavers.tape`
- `scripts/demos/settings.tape`
- `scripts/demos/setup.tape`
- `scripts/demos/shell-vim.tape`
- `scripts/demos/syntax.tape`
- `scripts/demos/tools.tape`

### Assets

- `assets/promo/nmsh-promo.mp4`
- `assets/promo/nmsh-promo.png`
- `assets/readme/architecture-detailed.svg`
- `assets/readme/architecture.svg`
- `assets/readme/ask.gif`
- `assets/readme/chroma.gif`
- `assets/readme/composer.gif`
- `assets/readme/keep-awake.gif`
- `assets/readme/keep-awake.png`
- `assets/readme/motion.gif`
- `assets/readme/nmsh-composer.png`
- `assets/readme/nmsh-demo.gif`
- `assets/readme/screensavers-cats.gif`
- `assets/readme/screensavers-motion.gif`
- `assets/readme/screensavers.gif`
- `assets/readme/sessions.gif`
- `assets/readme/setup.gif`
- `assets/readme/shell-vim.gif`
- `assets/readme/syntax.gif`
- `assets/readme/theme-bridge.gif`
- `assets/readme/theme-studio.png`
- `assets/readme/themes.gif`
- `assets/readme/tools.gif`

### Documentation and metadata

- `CHANGELOG.md`
- `README.md`
- `docs/architecture/notmyui.md`
- `docs/architecture/shell-adapter.md`
- `docs/architecture/terminal-stack.md`
- `docs/demos.md`
- `docs/design/theme-families.md`
- `docs/ui-showcase-pass.md`
- `package.json`
