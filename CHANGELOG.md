# Changelog

All notable changes to NMSh are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.17.0] - 2026-10-06

Context Engine, Themes & Discovery: native context routing and Rail foundations, Theme Studio and Theme Bridge, shell/transcript refinements, contextual tools and portability hardening.

### Context Engine and shell/transcript UX
- **Context Engine foundation:** immutable fact metadata (provenance, freshness, trust, sensitivity and persistence), a native module registry, bounded trusted metadata/Git collection, and Surface Router placement across Main Prompt, Context Rail and Right Context. Repository entry never executes arbitrary repository-controlled code through discovery. General capability scheduling, a broader first-party module catalog and installable declarative Context Packs remain upcoming; no finalized pack SDK or executable plugin API is available.
- **Context Rail:** independent relation, direction, integration, spacing and divider-anchor controls; one or two actual content rows; horizontal Inside dividers; priority overflow; shared preview/live geometry. Right shell context retains its independent anchor, and existing custom prompt/module configurations are preserved.
- `/transcript` exposes the same Normal / Chat live presentation setting as `/layout` and Settings, alongside historical prompt and divider controls.
- `/shell` keeps the current row visibly ticked and highlighted independently of keyboard focus, with explicit current/default markers. Shell indicator Hidden / When not default / Always and Left / Right edit the existing prompt module; changing Side preserves a saved Hidden state and never changes the active session.
- `/btw` is the canonical local guidance command; `/ask` remains a compatibility alias of the same feature.
- Portable shell/default-selection coverage, selection-band assertions and canonical CI sharding; full macOS/Ubuntu suites, Node 22 compatibility, Fedora portability and bounded timing smoke cover release candidates.

### UI consistency and showcase
- Shared bold accent focus labels across menus, settings, pickers and setup; `/tools` keeps full-row semantic selection bands when focus moves, with reverse video without color.
- Consistent Chroma preview state and base-color guidance; `/syntax` exposes the shared theme families and variants, with previews and cache updates for custom colors and accents.
- First launch opens Setup Cat. Apply completes onboarding even without appearance edits; presets and completed onboarding bypass discovery.
- The current-shell module leads the default Native prompt; the former untouched default migrates, while customized module ordering is preserved.
- Larger opaque demo recordings with neutral welcome identity, expanded feature/screensaver coverage, two architecture diagrams and a standalone silent motion promo.

### Themes, Theme Bridge and host cooperation
- **Prompt provider None**: composer only (no prompt row, modules or right prompt; the input marker stays) while editing, suggestions, syntax colors, history, themes and Theme Bridge keep working; commands submitted under None store no prompt snapshot.
- **Historical prompt** Full / Compact / Minimal / Off (`/transcript`, Settings, Setup); presentation only over the unchanged stored snapshot.
- **Native theme library**: any number of Custom and Imported themes with stable ids (bounded to 64); the single custom theme migrates into it and stays active. Imported is provenance only: imported themes are ordinary Native themes you can edit, rename, duplicate, export, select and pin.
- **Theme Studio** (`/theme`): Built-in · Imported · Custom · Import tabs, one editor and the real Native preview for every theme. Settings → Theme and `/setup appearance` select Built-in, Imported and Custom themes directly.
- **Imports**: NMSh Theme JSON, Base16, Base24, Windows Terminal, Oh My Posh (JSON, YAML, TOML; static colors only), Kitty, Ghostty (allowlist), iTerm2 `.itermcolors` (no XML entities) and WezTerm TOML (Lua refused). Data only, previewed with mapping and loss disclosure before saving; exports never include local source paths.
- **Theme Bridge** (`/theme-bridge`, opt-in, default Off): one switch plus **Apply themes** Manual / Follow NMSh / Choose theme. Under Manual each tool is Independent / Follow NMSh / Choose theme; under a global policy per-tool rows are view-only and the Manual choices are kept for later. One persistent panel with inline rows (Esc collapses before it closes), grouped by capability. fzf launched by NMSh, less/man termcap colors and **File listing colors** (GNU `ls`/`gls` via LS_COLORS with vivid when installed, BSD/macOS `ls` via CLICOLOR/LSCOLORS) through an NMSh-owned shell environment applied by the zsh, Bash and Fish adapters at the next prompt; generated tmux, Neovim, Vim, Helix and bat themes (bat: a real `.tmTheme`, a reviewed `bat cache --build` verified with `bat --list-themes`, `BAT_THEME` through the environment) with an ownership ledger, staged validated writes, a typed tmux reload and exact includes added only after review. delta is shown and not editable. "Remove managed setup" removes NMSh's files and includes; "Set Independent" only stops applying. No rc file, terminal or editor theme, or git config is changed.
- Theme Studio: local **Preview Chroma** (default Off, never saved) and **Duplicate current** into Custom (`<name> - Custom`). Chroma is reachable from `/prompt`, `/appearance` and Setup (Appearance and Prompt, with a Setup-local preview toggle).
- **Host semantics**: OSC 7 working directory and OSC 133 command zones derived from NMSh's command lifecycle on capable hosts and tmux; NMSh-authored OSC 8 links in `/help` and dev-server task rows, kept separate from program links.
- `/appearance` is a compact launcher: Theme Studio, Prompt, Cursor & effects, UI chrome, Chroma, Motion, Theme Bridge and host window.

### Providers, tools and integrations

- **Keep Awake** (`/caffeinate`, `/awake`, `/zoomies`; one surface and state): Idle, Display, System and All, optional `30m`/`2h` timeouts, `status` and `stop`. Backends are detected, not assumed: Apple `/usr/bin/caffeinate` (fixed flags; System needs AC power), `systemd-inhibit` with `idle`/`sleep` only around an NMSh-owned wait helper (Display is reported unsupported on Linux), and Windows `SetThreadExecutionState` from a fixed hidden PowerShell helper (no away mode, no `powercfg`). The assertion is a detached process that outlives the window; ownership is a random token plus the exact command line, so an unverifiable record is cleared and nothing is killed. Changing mode asks first (default No) and starts the new assertion before releasing the old.
- Keep Awake **presentation**: while active, `Awake · <mode>` is NMSh composer chrome (never prompt or provider output). Placement **Composer edge** (default) uses a plain top divider, else the bottom divider when a header prompt owns the top edge, else one row next to the composer; **Above composer** and **Input row** (only when it is completely safe; editor width, caret and hit testing account for it) are explicit choices, and a fallback never rewrites the setting. Both edges render through one shared edge renderer, so animated Chroma dividers keep it. An enabled **Status Strip** always includes it (narrowing before it drops); after 30 s without NMSh input an **idle reminder** adds the time and a muted `/zoomies stop`; the **screensaver** shows a small positioned status (default Bottom left). Display is Text, Icon or Icon + text. Off shows nothing. The panel gains Duration and these settings; Ask answers status questions and plans timed, change and stop requests through the same controller.
- Fixed: `/caffeinate`, `/awake` or `/zoomies` without arguments opened a panel that was never drawn, so the composer looked occupied until Ctrl+C (the Mise panel had the same problem). A start or stop from the panel now returns to the composer at once; the assertion was and remains an NMSh-owned background process, never a shell command.

- **Shell frameworks and prompt engines:** `/tools` detects tools by an explicit strategy (executable or a registered filesystem detector), so Oh My Zsh, Powerlevel10k, Prezto, Zim, zinit and Antidote appear with factual status (`Installed · Zsh framework · used by Zsh only` under Bash/Fish). Detection grants no install, configuration or provider authority. Oh My Zsh has a guided install that keeps `.zshrc` and a `.zshrc.pre-oh-my-zsh` comparison with a reviewed restore; NMSh never runs its installer. Powerlevel10k is a `/tools` item that routes to the existing provider and `p10k configure` flow. **Oh My Posh** is a new Prompt provider (`oh-my-posh print primary`, argv only, no TTY, bounded, cancellable; Native fallback when it fails) and a curated `/tools` install (homebrew/core); its config can be imported into Theme Studio as static colors. Ask understands these requests; dotfiles treats `.p10k.zsh`, Oh My Zsh themes/plugins and Oh My Posh configs as inspect-only.
- `/providers` is one inline panel: each family with its status (● Active, ✓ Selected · fallback, Available, Missing · Enter to install); Enter selects immediately or installs after a confirmation (default No). Shortcuts `/picker` (`/pickers`), `/suggestions`, `/navigation`, `/welcome`, `/history-provider` and `/providers <family>` open it focused.
- Pickers follow the composer: with the composer at the bottom the query sits at the bottom and results above it (NMSh Native and fzf); at the top the query is at the top.
- **Tool Configuration** (`/configure`, `/tmux`): one first-party registry says which tools NMSh can configure (tmux, Starship), which it themes, and which are inspect-only (shell rc files, Neovim/Vim config). Detection never grants write authority.
- **tmux Config Studio** (`/tmux`): General settings from a documented catalog, keymaps and prefix with conflict display, a Status Studio with a live preview (status modules never run shell), an optional NMSh pane frontend (`default-command` that runs a fixed `/bin/sh` program with the NMSh path passed as quoted argv data, never as shell text, and falls back to your login shell inside NMSh; `default-shell` untouched), and import of a supported subset of an existing tmux.conf (`if-shell`, `run-shell`, `source-file` and `#()` are never followed). Each value shows where it comes from. Everything goes into one NMSh-managed tmux file, included once after review.
- `/integrations`: health of every managed integration (current, missing, stale, conflict) with Review all / Apply all (default No); after one-time activation, managed files update automatically when the theme changes.
- `/dotfiles [path or Git URL]`: plain, Git, GNU Stow and chezmoi sources. Remote sources are cloned only after confirmation (depth 1, no submodules, hooks disabled). Nothing in the repository is run, templates are not rendered, tmux imports supported fields only, Starship/Helix/bat and all executable configs are inspect-only (parseable config can still run commands, so nothing is copied without an explicit per-tool safety validator, and none exists today), conflicting values default to your current ones, and one combined review (default No) precedes any change. The repository is never modified.
- Ask maps tmux, provider, Theme Bridge, integrations and dotfiles requests onto these typed actions only, behind its final Yes/No.
- Commands: `/motion`, `/chrome`, `/glyphs` (`/glyph`), `/composer` (alias of `/layout`), `/strip` (`/status-strip`), `/configure`, `/tmux`, `/integrations`, `/dotfiles`. `/help` groups commands by area (Appearance, Composer & transcript, Providers, Tools & integration) and the palette lists each surface once with a readable label. Individual settings are not commands.

### Contextual tools
- `/tools` Discover shows a conservative **Relevant here** group from cheap local facts (Git repository, shell scripts, JavaScript/Node, Python, Go, Rust, container files, Kubernetes files or kubeconfig) and each tool's declared relevance. Only missing tools appear; nothing is executed, crawled or sent anywhere.
- Typed package-manager plans for Homebrew, APT, DNF, pacman and zypper (WSL uses the distribution's manager). Tools without a verified package name stay manual. Non-root plans are explicit `sudo -n` argv; nothing elevates silently.
- Bulk install: Space selects missing installable tools, Enter reviews a tool → manager → package plan, one confirmation (default No), per-tool results.
- Tool details separate Installed, selected in NMSh and **Active in this shell** (zoxide, Atuin, fzf), from the running shell's name snapshot for all three shells; rc files are never read.

### Compatibility
- Windows Terminal (seen from WSL), iTerm2 and WezTerm host facts and new-window launchers behind the host boundary; deterministic multiplexer/`TERM=dumb` degradation tests for every profile. Physical validation in these hosts is not claimed.
- Linux: `xdg-open`/`wslview` open helper, clipboard fallback-order tests, Fish installed in Ubuntu CI and a Fedora portability job.
- Regression coverage that raw job-control, EOF and arrow bytes reach full-screen programs.

### Screensavers
- Four screen-based savers join the idle visuals: **Black Hole**, **Fireworks**, **Circletastic** and **raiseCatError**, plus **Random** (switches only after a full loop). They animate the current screen's own text as presentation only (transcript, PTY, history and journals are untouched), keep the host background, dismiss on the first input (which is consumed), stop on resize, and never start automatically under Reduced Motion. Still off by default (Idle visuals: Never); new **Run while busy** setting never overrides passthrough or fullscreen programs. The earlier scene is now labelled Night Fireworks.

### Polish
- Shell Environment (Status and `nmsh doctor`) starts with the shell backing the session (never inferred from `$SHELL`), says "none · plain zsh/bash/fish" when there is no framework, and scopes framework and plugin rows to that shell; other shells' environments are listed separately.
- Screensavers: the capture keeps authored backgrounds and readable glyph colors (no black-on-dark chrome), Circletastic forms a few small circles completely before it stabilizes, rotates, accelerates and explodes (all at once or staggered, keeping ring momentum), and raiseCatError now uses the NMSh cat sprite, roams the whole screen, overlaps text freely, meows, and sometimes sits on a purely visual fake keyboard (never reaching the editor or shell).
- Any exact command in the curated `/tools` catalog (not only Recommended ones) is recognized when missing; the prompt names the package when it differs (`tldr` is provided by tealdeer). TLDR (tealdeer) is now Recommended; Ask uses only its local cache (`--no-auto-update`) and says when examples are unavailable.

### Polish (this pass)
- `/tools`: the selected row is the shared selected band (the active tab's treatment): full width, bold, readable on the band, reverse video under `NO_COLOR`.
- Prompt None wording: the input marker stays (it always did); help, the prompt picker and Setup now say so.

### Docs and demos
- [ARCHITECTURE.md](ARCHITECTURE.md): a plain-language overview of how NMSh works, linked from the README, CONTRIBUTING, AGENTS and llms.txt.
- README rewritten around what NMSh is, a GitHub-hosted reel hero with YouTube/X links, a mascot-left-of-logo lockup, a visual tour and the safety model; stale zsh-only, fixed-bottom, bat and release claims corrected.
- Reproducible visual docs: `npm run demos` renders the README and [demo gallery](docs/demos.md) clips from committed VHS tapes in `scripts/demos/` against a disposable demo home (no user config, no network, the inert Keep Awake backend). It replaces the old asciinema/tmux recorder. A small Vespyr divider is generated from the real sprite.

### Updates and sessions
- **Automatic updates** (Automatic / Notify only / Off, Daily or Weekly). New installs default to Automatic / Daily; saved Daily/Weekly checks migrate to Notify only and Off stays Off. Automatic prepares a verified stable release only where `/update apply`'s own checks pass, with the same build verification and rollback; the running session keeps its version. Status shows Running version, Latest, Mode and State.
- Homebrew install provenance prevents the source-checkout updater from mutating the Cellar. Homebrew distribution is now available through `brew install raiseCatError/tap/nmsh`; automated publishing from this repository remains disabled.
- Detached sessions can be ended from the startup picker with `X` and confirmation; the transcript is archived and stays in `/resume`.

## [0.16.0] - 2026-10-04

Sessions, Agents & Portability: a cumulative release of the work formerly planned as v0.8–v0.15, together with v0.16.

### Sessions & agents
- Persistent live shells, detach/reattach, session presets and a clearer `/resume` and `/sessions` viewer with factual state, age and duration.
- Short-lived cross-session notices, sticky attention, and familiar session names and accents.
- `/agents` local activity counts, durations and heatmaps; `/ai` managed and observed agent sessions. Activity tracking can be disabled or reset and does not store prompts or output.

### Shells & portability
- A shared ShellAdapter for zsh, Fish and Bash 4.4+; `/shell` switches the current session and Settings chooses the default for new sessions.
- Linux/WSL groundwork, platform diagnostics, Linux notifications through `notify-send`, host capability profiles and conservative presentation fallbacks. Physical Linux/WSL and additional-host validation remains follow-up work.
- Settings export/import, launcher uninstall with data retained by default, and provenance-aware tool removal.

### Ask, completion & developer tooling
- Ask explains NMSh capabilities locally, with optional Qwen Local Understanding through `/llm`; model downloads require explicit confirmation.
- Structured completion with live shell knowledge, a bundled Fig + Carapace static catalog, provenance, custom declarative specs and richer completion descriptions.
- Context-ranked history with agent/source filters; optional Atuin, zoxide, fzf and Television providers; command inspection and conservative correction suggestions.
- Curated `/tools`, supported Starship configuration, consent-based mise project/task awareness, project workflows and `/watch` scheduled commands.

### Appearance & interaction
- `/appearance`, richer prompt customization, Chroma treatments and bounded effects; Clean and Rich motion with independent intensity and speed.
- Portable cursor effects and capability-gated Ghostty/Kitty integration with previews and clear fallback behavior.
- Expanded Setup Cat, grouped Config and Status, idle visual galleries and completion UI polish.

### Transcript, safety & fixes
- `/find`, presentation-only `/filter`, transcript selection, block actions, OSC 8 links, `/open` references and `/open-diff` editor integration.
- Capability-gated images with a text fallback; deterministic paste classification, preview and scrollable review; `/doctor` read-only diagnostics and failure explanations.
- Hardened session recovery, shell helper isolation, terminal modes, completion cancellation and configuration preservation; fixes to divider colors, slash-command history and presentation lifecycles.

## [0.7.0] - 2026-10-01

UI Foundation & Customization: a shared internal UI toolkit (notMyUI), Chroma color roles, reduced-presentation modes, Markdown-authored help, and Settings v2.

### Added
- **notMyUI toolkit:** an internal presentation and interaction foundation for NMSh-owned surfaces (not a published package). [docs/architecture/notmyui.md](docs/architecture/notmyui.md) maps each primitive to its real consumers and lists what is deliberately not built.
- **Shared actions and contextual help:** panel and palette actions share one model (identity, label, key, enabled state), and footer help is derived from it, so it stays in step with what a panel can actually do.
- **Shared form controls:** toggles, selects, multi-selects, text fields and confirmations are reusable controls that report proposals while the feature layer persists. Settings rows and Settings search use them.
- **Accessibility baseline:** `NO_COLOR` (or `TERM=dumb`) stops NMSh-generated color escapes while bold, inverse and glyphs remain. `NMSH_COLOR=none|256|truecolor` overrides the color level explicitly. `NMSH_REDUCED_MOTION=1` holds the shimmer and the welcome blink still while durations keep counting. Focus, changed and error states are also carried by text or glyphs, not color alone. See [docs/accessibility/baseline.md](docs/accessibility/baseline.md) for criteria and known gaps.
- **Deterministic presentation:** `NMSH_DETERMINISTIC=1` fixes the displayed completion time, the shimmer and activity phase, and the welcome blink for repeatable captures, and implies reduced motion. Shell behavior, PTY output and measured durations stay real. See [docs/testing/deterministic-presentation.md](docs/testing/deterministic-presentation.md).
- **Chroma:** shared color roles for NMSh-owned UI in three distinct categories (semantic status, theme and identity colors), plus gradients and curves, with truecolor, 256-color and no-color fallback.
- **Surface primitives:** frames, fills, padding, insets, width and alignment, used by the shared panel frame.
- **Semantic motion engine:** a pure engine of motion profiles per state, sampled at an elapsed time. It owns no timers and never changes width. The existing running-command shimmer and activity glyph now run on it.
- **Authored Markdown and `/help`:** `/help` renders NMSh-authored Markdown (headings, tables, code fences, tips, links). Through the transcript, links appear as `text (url)` rather than clickable hyperlinks.
- **Settings v2:** a simple and an advanced view, a changed marker on settings that differ from their defaults, reset of the current setting, search, and a remembered position within a run.

### Notes
- Authored Markdown applies to NMSh-owned content only. Raw PTY output, transcript command output, `/copy` and archived shell data are never interpreted as authored UI content or recolored.
- Not included: automatic 256-color detection (`NMSH_COLOR=256` selects it), a persisted reduced-motion setting, user key remapping, a shared animation scheduler, Linguist language colors (#176) and transient visual effects (#78). Screen-reader behavior is unverified, and not every surface uses authored Markdown yet.

## [0.6.0] - 2026-09-29

Sessions & Continuity: persistent live sessions you can detach from and reattach to, a Flow composer, and a `/layout` showcase.

### Added
- **Persistent live sessions:** zsh now runs in a small per-user session service (`nmshd`, started on demand over a private Unix socket), so closing a window **detaches** its shell instead of ending it. Running commands keep going. `exit`, Ctrl+D and `/zsh` still end the session. `NMSH_SESSION_SERVICE=0` runs the shell in-process as before.
- **Reattach:** get back to a detached session from the startup prompt, from `/resume` (LIVE sessions are listed above ARCHIVED transcripts; Enter attaches, and Ctrl+K kills after confirmation), or with `nmsh --attach <id>`. `nmsh --sessions` lists live sessions, and `nmsh --new` always starts a fresh one. A session attached in another window is never taken over.
- **Output while detached:** what a detached session prints is kept (1 MB in memory, then up to 64 MB spooled to disk; `NMSH_BACKLOG_MEMORY_BYTES`, `NMSH_BACKLOG_SPOOL_BYTES`). It is added to the transcript on reattach, with a note of commands that completed and anything that exceeded the limit. Fullscreen apps are repainted at the new window size.
- **Multiplexer interoperability notes:** [docs/architecture/multiplexer-interop.md](docs/architecture/multiplexer-interop.md) records how NMSh behaves inside and around tmux and GNU screen (rendering, resize, job control, fullscreen, paste, and live-session detach when a pane closes), what remains unverified (Zellij), and follow-ups. NMSh stays independent of any multiplexer.
- **Live session status:** `/resume` LIVE rows and `nmsh --sessions` show what each live session is doing, from evidence only: the running command and elapsed time, the foreground process or a known CLI's name (Claude Code, Codex, Aider, …), active or quiet output, *needs attention* when the program sent a terminal notification or bell, fullscreen, the title it set, and the last command's result while idle. Nothing is guessed, and paths under your home directory are shown as `~/…`.
- **`/layout` showcase:** preview composer position (Bottom, Top, Flow) × transcript presentation (Normal, Chat) on sample content through the real renderer, then save and apply live. Also under Config → Layout. Nothing in the preview runs or reaches the transcript, journal or `/copy`.
- **Flow composer:** Config → Composer position → Flow (the command palette's Toggle composer position cycles Bottom, Top and Flow). The prompt and input follow the newest output inside NMSh's document, like a conventional terminal, and scroll with it. Typing while scrolled back returns to them; scrolling alone does not. Menus open below the input, panels pin to the bottom, and Chat presentation and fullscreen passthrough work as before.
- **Startup restore is your choice:** Config → Sessions → Startup restore (Ask, the default; Always; or Never) and Multiple detached sessions (Ask which, or Open all). With one detached session, NMSh asks: Resume, Not now, Always or Don't resume at startup. With several, a picker restores the ones you select: this window takes one, and the others open in new Ghostty, Terminal.app or kitty windows. Where a host can't open windows, NMSh names the `nmsh --attach` command for each. Never only skips restoring at launch; it never ends a session.
- **Live-session hardening:** live sessions that end while no window is attached are archived at the next launch or `/resume`, with the real exit code or a note that the service stopped or the system restarted. Output captured while detached is kept. A frontend that loses its service reports it and archives the transcript. `/resume` shows how long each idle live session has been at its prompt.
- **Exactly-once archiving:** launch recovery, Kill Session and live journal checkpoints share a cross-process lock per journal, so concurrent launches never archive a session twice or overwrite a complete archive with partial state.
- **Fullscreen reattach:** reattaching to a running fullscreen app restores the terminal modes it had turned on, including mouse reporting and bracketed paste.
- **Safe updates:** each session-service protocol version has its own socket, so live sessions owned by an older service keep running after an update. A newer frontend never touches sessions it cannot verify, and it tells you they exist.
- **Session limit:** at most 16 live sessions per service (`NMSH_MAX_SESSIONS`). When the limit is reached, a new window falls back to an in-process shell with a notice. Detached sessions are never ended to make room.

### Fixed
- **Interactive terminal UIs that draw inline** (agent CLIs such as Claude Code, including under a wrapper or alias like `claude-account2`) now get the terminal. NMSh hands over as soon as a running program turns on terminal input modes (bracketed paste, mouse, focus events or the kitty keyboard protocol), not only when it switches to the alternate screen or has a known name. Keys reach the program, NMSh's composer steps aside, no control sequences leak into the transcript, and the same applies after reattaching. Ordinary commands, including progress output, stay in NMSh.
- **Restoring several detached sessions** (the startup picker or Open all) opens every selected session again. NMSh used to exit while waiting for the first extra window to open, printing "Detected unsettled top-level await": only that window appeared, and the current window never attached. In Terminal.app this looked like `nmsh` failing to start. A window launcher that hangs now times out after 15 s, and that session's `nmsh --attach` command is named instead.
- Ctrl+Z suspends the foreground job again (raw `^Z` and the Kitty keyboard encoding), and `jobs` and `fg` work as in plain zsh.
- After Ctrl+Z, `jobs` could list a stray `suspended (tty output)` job. NMSh's own prompt hook ran `stty` as a job, and it could be stopped when it ran before zsh had taken the terminal back. The hooks now change terminal modes outside job control.
- The session service no longer crashes when a window resize races a shell's exit. node-pty could throw `EBADF` for a PTY that had just closed, which inside nmshd would have ended every live session. Other resize failures are now reported to that window instead of ending the service.
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
