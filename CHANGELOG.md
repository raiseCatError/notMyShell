# Changelog

All notable changes to NMSh are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **`/layout` showcase:** preview composer position (Bottom, Top, Flow) × transcript presentation (Normal, Chat) on sample content through the real renderer, then save and apply live. Also under Config → Layout. Nothing in the preview runs or reaches the transcript, journal or `/copy`.
- **Flow composer:** Config → Composer position → Flow (the command palette's Toggle composer position cycles Bottom, Top and Flow). The prompt and input follow the newest output inside NMSh's document, like a conventional terminal, and scroll with it. Typing while scrolled back returns to them; scrolling alone does not. Menus open below the input, panels pin to the bottom, and Chat presentation and fullscreen passthrough work as before.
- **Startup restore is your choice:** Config → Sessions → Startup restore (Ask, the default; Always; or Never) and Multiple detached sessions (Ask which, or Open all). With one detached session, NMSh asks: Resume, Not now, Always or Don't resume at startup. With several, a picker restores the ones you select: this window takes one, and the others open in new Ghostty, Terminal.app or kitty windows. Where a host can't open windows, NMSh names the `nmsh --attach` command for each. Never only skips restoring at launch; it never ends a session.
- **Live-session hardening:** live sessions that end while no window is attached are archived at the next launch or `/resume`, with the real exit code or a note that the service stopped or the system restarted. Output captured while detached is kept. A frontend that loses its service reports it and archives the transcript. `/resume` shows how long each idle live session has been at its prompt.
- **Exactly-once archiving:** launch recovery, Kill Session and live journal checkpoints share a cross-process lock per journal, so concurrent launches never archive a session twice or overwrite a complete archive with partial state.
- **Fullscreen reattach:** reattaching to a running fullscreen app restores the terminal modes it had turned on, including mouse reporting and bracketed paste.
- **Safe updates:** each session-service protocol version has its own socket, so live sessions owned by an older service keep running after an update. A newer frontend never touches sessions it cannot verify, and it tells you they exist.
- **Session limit:** at most 16 live sessions per service (`NMSH_MAX_SESSIONS`). When the limit is reached, a new window falls back to an in-process shell with a notice. Detached sessions are never ended to make room.

### Fixed
- A launch notice (for example, sessions archived while no window was attached) is no longer erased when the window reattaches to a live session.

### Removed
- `scripts/pty-history-smoke.mjs`: its checks had gone stale (it asserted retired UI text), it ran against the real config and live session service, and deterministic tests now cover everything it checked.

## [0.5.0] - 2026-09-28

Interaction & Intelligence: predictive suggestions, new layouts and presentations, a command palette, and a shared provider framework.

### Added
- **Suggestions v2 (NMSh Native):** ghost text ranked by fuzzy and acronym matching, frecency, the current directory, and what usually follows the previous command. → / End accepts, Alt+→ accepts the next word, Ctrl+N / Ctrl+P list ranked alternatives, and Esc dismisses. Empty-prompt prediction is optional (Config → Empty-prompt prediction). Leading-space and `HISTORY_IGNORE` commands are never suggested or learned, and everything stays local. History loads in the background from Atuin or `$HISTFILE`.
- **Optional Deja suggestion provider:** uses an installed [Deja](https://github.com/Giammarco-Ferranti/deja) through its query CLI while NMSh draws the ghost text. Deja keeps recording through its own zsh hooks. If it is missing or unhealthy, NMSh falls back to Native with a notice.
- **Welcome providers:** Vespyr, the native cat (default), Fastfetch using your installed configuration, Neofetch (legacy, used only if already installed), or None. New sessions and `/clear` use the selection, and `/resume` keeps each session's original welcome.
- **Shared provider framework:** Welcome and Suggestions providers show installed, missing, version, and health status with a preview in one gallery (`/settings`). Installs run only after explicit confirmation, and unavailable providers fall back safely. Prompt providers use the same descriptors.
- **Dock Top:** Config → Composer position: Bottom (default) or Top. With Top, the composer and its menus sit at the top, and the newest output and live activity stay together at the transcript's end.
- **Chat presentation:** Config → Transcript presentation: Normal or Chat. Submitted commands align right with their prompt snapshot and a divider local to the command, and output stays left. It works with either composer position and falls back to Normal below 60 columns. Stored transcripts and `/copy` are unchanged.
- **Output folding modes:** Off, Smart (default), and Always. Always folds every long block, failures included, keeping head and tail visible. Existing `never` settings load as Off.
- **Command palette:** `/palette`, F1, or Ctrl+Shift+P / Cmd+Shift+P where the terminal reports them. It searches NMSh commands, settings, layout toggles, and prompt themes, runs only NMSh actions, and never runs shell text.
- **Native prompt styles:** Powerline (default), Soft, Minimal, and Outline (`/prompt` → Style or Config → Prompt style), with Nerd and Safe glyphs. History snapshots keep the style they were captured with.

### Changed
- Transcript rows are drawn by a single presenter, so layouts and presentations share one row pipeline without changing stored data.

### Fixed
- NMSh-owned Homebrew installs (Starship, Fastfetch, Deja) now find `brew` in its standard Apple Silicon and Intel locations when NMSh's PATH lacks it, and report clearly when it is missing.
- Right-aligned Chat commands no longer lose their final character at the terminal's last column.
- The command palette list stays put while moving the selection and scrolls only at its edges.

### Known limitations
- Completion, richer History, and Picker providers are future work. Configured-zsh completion parity and `fzf-tab` remain unsupported (#52).
- Flow / Classic composer mode and persistent live sessions are not part of this release.
- Deja is optional and is not bundled. Neofetch is archived upstream and is never installed by NMSh.
- NMSh renders with truecolor. There is no separate 256-color mode.
- Command-completion desktop notifications are not part of this release.
- Final v0.5.0 visual and interaction validation passed in Ghostty.

## [0.4.0] - 2026-09-26

Shell Intelligence & Extensibility: a richer, context-aware prompt, calmer command output, and a settings, session, and update foundation.

### Added
- **Right-side prompt context:** in `/prompt` → Modules, `P` moves any module (Project, Path, Git branch, Git status, Toolchains, Exit status, Kubernetes, Docker context) between the left prompt and a right-aligned area. By default everything stays left, and the left side may be empty. The right side works in every composer layout, yields first on narrow terminals, and is recorded in history.
- **Mirror right side** (`M`, default On) reflects the right area's geometry to face left while module order, colors, and Previous/Next fade semantics stay the same.
- **Deterministic prompt showcase:** the Modules, layout, and appearance previews render every module type from synthetic data through the real prompt renderer, independent of the current directory.
- **Show-on-command modules:** Kubernetes (current kubectl context, for `kubectl`, `helm`, `k9s`, and similar) and Docker context (for `docker` and `docker-compose`) appear only while such a command is typed. Toolchains can also be set to *on command*. Typed text is only tokenized, never executed, and context comes from cached asynchronous reads of kubeconfig and the Docker CLI config.
- **Intelligent directory shortening:** as the terminal narrows, the path abbreviates parents to their shortest unambiguous prefix, then directories inside the repository, then collapses runs to `…`, and finally shows only the current directory. The repository name and current directory stay whole, `~` stays `~`, and history keeps the full path.
- **Richer Git prompt state:** one segment each for staged, modified, untracked, conflicts, ahead, behind, diverged, and merge/rebase/cherry-pick, plus a small clean-tree marker; an unknown status never shows as clean. Rich Git state is its own **Git status** module next to the branch. The **Rich Git** view in `/prompt` sets Enabled, Colors (Semantic / Follow theme / Grayscale), Geometry, and Connector fade, with a showcase of every state.
- **Connector fade and Gap Wide:** the opening cap into the next segment can fade (Off by default, Follow connector, or a fixed shape), Fade colors choose Previous, Next, or Mixed, and Gap gains Wide alongside Off, Compact, and Normal.
- **Theme-aware syntax highlighting** and a `/syntax` panel: Highlighting On/Off, and Colors Follow prompt theme / Choose theme / Grayscale, with live previews. Submitted commands keep their original styling, and PTY output and `/copy` are unaffected.
- **Smart output folding:** finished commands fold only when their output is long and low-information (repetition, progress rewrites, install/build/test chatter). Failures, output of 30 lines or less, diagnostics, stack traces, compiler/test errors, diffs, and commands whose output is the result stay expanded. A folded block keeps its first 3 and last 5 lines around `› N lines hidden · Ctrl+O`. It is presentation only: `/copy`, the session journal, `/resume`, and expansion keep the full output. Config → **Output folding**: Smart (default) / Never.
- **Sticky command headers:** while scrolling, the command that owns the top of the viewport stays pinned as a one-row header; clicking it jumps to the real header.
- **Central `/settings`:** `/settings` and `/config` open one tabbed panel on Config, and `/status` opens it on Status. Settings holds entry points to the Appearance, Glyph style, Prompt, Transcript, Syntax, and Keyboard panels, Status shows build, shell, prompt, and journal facts, and Config is a searchable list of settings edited in place.
- **Shared panel shell:** every NMSh panel uses one temporary top boundary, title, optional tabs and search, and a context-aware key bar. Panel chrome is never stored in the transcript, `/resume`, or `/copy`.
- **Glyph compatibility choice:** first run offers Nerd Font and Safe/ASCII previews and persists the choice. It can be changed in Config → Glyph style; `NMSH_ICONS` overrides it per process. Existing v0.3 configurations keep Nerd Font styling.
- **Continuous session journal and advanced `/resume`:** the presentation session is checkpointed during use, so it survives interruption. `/resume` groups retained sessions by day, searches command text, project, cwd, and date, and navigates weeks (←/→) and months (Shift+←/→). 1000 unpinned sessions are kept by default.
- **Reusable task progress:** long-running child processes show elapsed time, a per-character travelling shimmer, factual success or failure, and bounded details (`D`/Enter). Starship's Homebrew installation uses it.
- **Starship module editor:** `/prompt` → Starship → Configure modules toggles supported modules and previews the exact lines Starship's own CLI would change. It asks for confirmation, backs up an existing `starship.toml`, and preserves comments and unrelated keys.
- **Powerlevel10k configurator handoff:** `/prompt` can run the official `p10k configure` wizard on the real terminal after backing up `~/.p10k.zsh` and `.zshrc`, and reports which files changed.
- **Update discovery and `/update`:** `/update` reports current → available with a release summary. `/update apply` fast-forwards a clean official source checkout to the verified release tag, rebuilds, verifies the build identity, and rolls back on failure; other installations get manual steps. Background checks are opt-in (Config → Update checks: Off / Daily / Weekly).

### Changed
- Connector fade defaults to Off; explicitly saved values are kept.
- Gap is stored as width 0 / 1 / 2 (Compact / Normal / Wide); legacy widths above 2 read as Wide.

### Fixed
- Compatible zsh `precmd`/`preexec` hooks from your own config (for example zoxide and Atuin) keep working inside NMSh (#16).
- A zsh prompt theme such as Powerlevel10k no longer paints its own prompt, including its right-side status, into command output.
- Esc in Prompt, Transcript, and Keyboard panels opened from `/settings` returns to `/settings`, and Esc is decoded correctly under Ghostty's Kitty keyboard protocol.

### Known limitations
- Configured-zsh completion parity and `fzf-tab` interoperability are not supported yet; NMSh uses its own completion (#52).
- Command-completion desktop notifications are not part of this release.
- Powerlevel10k: NMSh shows only its left prompt. The right prompt, gitstatus daemon, instant prompt, and settings defined only in `.zshrc` are not reproduced.
- Nested activity is limited to directly observed Node TAP v13 streams.
- `/update apply` automates only clean source checkouts of the official repository.
- Final v0.4.0 visual and interaction validation passed in Ghostty.

## [0.3.0] - 2026-09-24

Session & Interaction UX, plus the appearance and customization system.

### Added
- **Prompt providers:** NMSh Native (default), optional Starship, and optional Powerlevel10k. Starship and Powerlevel10k supply prompt content only; NMSh keeps the editor, composer, history, and structured execution. `.zshrc`, `starship.toml`, and `.p10k.zsh` are never written.
- **Powerlevel10k** renders your left prompt in an isolated helper zsh (no ZLE, no controlling TTY). Without its prompt character, git state comes from p10k's `vcs_info` fallback, and there is no right prompt yet.
- **Native prompt themes:** Lavender Native (default, brand lavender `#A67CF3`), Brand / Semantic, Cool First, Warm First, and Grayscale, with per-theme previews in `/prompt`.
- **Native geometry:** independent Start, Connector, Gap (Off / Compact / Normal), and End. Shapes are Wedge, Flat, Rounded, Slant `/`, and Slant `\`, with fading variants on outer edges only.
- **Native icons** On/Off for git and toolchain modules; toolchain modules for Node, Go, Python, and Docker are detected from marker files.
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
