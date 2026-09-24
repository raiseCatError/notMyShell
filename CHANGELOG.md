# Changelog

All notable changes to NMSh are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- First-run terminal glyph compatibility choice (Nerd Font or Safe/ASCII), persisted under NMSh settings; existing v0.3 configurations retain their appearance.
- Central `/settings` browser with glyph style, prompt, transcript, and keyboard entry points, and a temporary shared panel boundary.
- `/settings` and `/config` open one shared panel on its Config view; `/status` opens it on Status. ←/→ switch between Settings (entry points to the Appearance, Glyph style, Prompt, Transcript, and Keyboard panels, plus planned v0.4 areas), Status (read-only build, shell, prompt, and session-journal facts), and Config (a compact, aligned list of real settings with a bordered search field). In Config, ←/→ or Enter/Space change the selected value and save it immediately; `/` focuses search, Esc clears it, then closes.
- Continuous local presentation-session checkpoints with retention of 1000 unpinned sessions by default, plus `/resume` search and date navigation.
- Reusable elapsed-time task progress with a per-character travelling shimmer, factual completion states, and bounded diagnostic details; Starship Homebrew installation uses it.
- A focused Starship module editor in `/prompt` that previews changes through Starship's own CLI, preserves unrelated config, and backs up existing files before applying reviewed changes.

## [0.3.0] - 2026-09-24

Session & Interaction UX, plus the appearance and customization system.

### Added
- **Prompt providers:** NMSh Native (default), optional Starship, and optional Powerlevel10k. Starship and Powerlevel10k supply prompt content only; NMSh keeps the editor, composer, history, and structured execution. `.zshrc`, `starship.toml`, and `.p10k.zsh` are never written.
- **Powerlevel10k** renders your left prompt in an isolated helper zsh (no ZLE, no controlling TTY). Without its prompt character, git state comes from p10k's `vcs_info` fallback, and there is no right prompt yet.
- **Native prompt themes:** Lavender Native (default, brand lavender `#A67CF3`), Brand / Semantic, Cool First, Warm First, and Grayscale, with per-theme previews in `/prompt`.
- **Native geometry:** independent Start, Connector, Gap (Off / Compact / Normal), and End. Shapes are Wedge, Flat, Rounded, Slant `/`, and Slant `\`, with fading variants on outer edges only.
- **Native icons** On/Off for git and toolchain modules; toolchain modules for Node, Go, Python, and Docker are detected from marker files.
- **Rich Git** in the Native prompt: one segment each for staged `+N`, modified `~N`, untracked `?N`, conflicts `!N`, ahead `↑N`, behind `↓N`, diverged `↑N ↓N`, and merge/rebase/cherry-pick. A genuinely clean tree adds a small success-colored marker shaped by the prompt geometry, and an unknown status never shows as clean. Status is collected asynchronously after commands and directory changes.
- **`/prompt` views**: Main Prompt (theme, geometry, connector fade, icons, modules, theme gallery) and Rich Git, switched with ←/→ from the view bar.
- **Rich Git settings**: Enabled (default On; Off keeps the plain branch and skips the status probe), Colors (Semantic default, Follow theme, Grayscale; the branch always follows the theme), Geometry (Follow main prompt default, or a fixed shape for Git state segments only), and Connector fade (Follow main prompt default, Follow Rich Git geometry, Off, or a fixed shape). A showcase previews every state.
- **Connector fade**: colors one gap cell between separated segments with a shade glyph (`▒`, `:` in safe mode) drawn in the previous segment's color over the next one's, shaping the caps around it. It replaces a gap cell and never adds width; with Gap Off or a zero-width gap there is no cell to color. Follow connector (default) tracks the Connector shape; a fixed shape overrides it; Off keeps neutral gaps. Start and End keep their three-step fades.
- Fixed: a zsh prompt theme such as Powerlevel10k no longer paints its own prompt into command output.
- **Module manager** in `/prompt`: show/hide, reorder, and the exit-status condition.
- **Composer layouts:** two-line with the prompt row as divider, two-line inside a bordered composer, or one-line (existing `composerLayout` and `placement` keys).
- **Semantic prompt history:** each command keeps a snapshot of its prompt; history renders a muted version of it.
- **`/transcript`:** divider and historical prompt On/Off, history colors (Follow prompt / Choose theme / Grayscale), and Compact/Normal divider density.
- **Persistent local sessions:** `/clear` archives the transcript and starts fresh on the same live zsh; `/resume` restores archives.
- **`/zsh`** hands off to an ordinary interactive zsh; nested NMSh is prevented.
- **Rich paste atoms** for large multiline pastes, submitted with exact source.
- **Nested activity rows** for directly observed Node TAP streams, with a per-character traveling shimmer.
- **Welcome header** with a terminal-native full-body cat (occasional blink), a bold `notMyShell` wordmark, build identity, start cwd, and shell.
- **Build identity** via `/version` and `--version`.
- **Settings panels** share a consistent controls row.

### Changed
- `startStyle: "pointed"` is now `wedge`, and Start no longer affects internal segment openings; existing configs normalize automatically.
- The retired Soft Semantic theme id (`semantic`) normalizes to Brand / Semantic.

### Fixed
- Prompt settings previews no longer change the live provider before saving, and a failed external provider now reports that NMSh Native is active.
- Wide Starship prompts in history are truncated to the row width.

### Known limitations
- Native `fzf-tab` support does not exist yet; configured-zsh completion parity is tracked for v0.4 (#52).
- Powerlevel10k: the right prompt, gitstatus daemon, instant prompt, and settings defined only in `.zshrc` are not reproduced.
- Nested activity is limited to directly observed Node TAP v13 streams.
- Final v0.3.0 candidate visual and interaction validation passed in Ghostty, Terminal.app, and VS Code integrated terminal.

## [0.2.0] - 2026-09-23

### Added
- **Structured Execution Presentation**: Dynamically classifies PTY output into `INLINE`, `FOLDED`, `LIVE`, or `PASSTHROUGH` modes based on output characteristics.
- **Factual Command Milestones**: Real-time status now states factual observations (e.g., `Running npm test`) and explicitly reports exit codes.
- **Deterministic Summaries**: Output adapters parse standard CLI tools (`npm`, `jest`, `mocha`, Node TAP, `brew cleanup`, `git commit`) to display rich, structured summary facts.
- **Output Folding**: Clickable and keyboard-navigable (`Ctrl+O`) toggles for collapsing or expanding noisy terminal output blocks in history.
- **Native Selection Preservation**: Shift+Drag natively selects terminal text while NMSh handles editor focus.

### Fixed
- Multiline shell commands no longer break the live-status renderer and clear correctly from the frame upon completion.
- Node.js TAP test summaries are accurately parsed matching the actual `ℹ` info glyphs emitted by the PTY.
- `SemanticService` is robust against host-specific terminal scripts (e.g. `Apple_Terminal` in macOS `.zshrc`) by isolating its environment with `TERM=dumb`.
- `SemanticService` gracefully prevents deadlocks by safely settling pending classification promises if the helper crashes or exits.

## [0.1.0] - 2026-09-23

### Added
- Persistent real zsh PTY frontend.
- Multiline editor locked to the bottom of the terminal.
- Semantic syntax highlighting via asynchronous helper processes.
- Semantic highlighting is preserved persistently in the history viewport.
- Autocomplete and completion bridge.
- History ghost suggestions.
- Lifecycle and animated activity UI for running commands.
- Fullscreen and interactive application passthrough handling.
- Integrated `/copy`, `/history`, `/appearance`, and `/keyboard` commands.
- Visual README demo generation pipeline.
- Controlled zsh bootstrap preventing aggressive startup tasks.
- Machine-readable discoverability configuration (`AGENTS.md`, `llms.txt`).

### Fixed
- Process cleanup teardown to safely kill detached helper shells and delete temporary configuration directories during testing.
