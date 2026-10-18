# Changelog

All notable changes to NMSh are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Notable user-visible changes are added under [Unreleased] as they land; see [CONTRIBUTING.md](CONTRIBUTING.md#changelog).

## [Unreleased]

### Added

- **`/view`, a native read-only viewer** for files and completed output ([#397](https://github.com/raiseCatError/notMyShell/issues/397)). `/view README.md` opens a file relative to the shell's directory (`~` for home): Markdown renders (`m` shows the source), source files get syntax colors and line numbers, `.diff`/`.patch` files and `git diff`/`git show` output read as diffs. `/view N` opens completed output N (numbered as `/copy` numbers it) and `/view` the latest; Actions → View output does the same for a block. Find with `/` and `n`/`N`, go to a line with `:`, `w` toggles wrapping (Left/Right scroll sideways), `l` line numbers, `c` copies the whole text, Esc closes. Viewing never changes the file or the transcript.
  - Limits: regular files only (directories, devices and pipes are refused), at most 8 MiB and 200,000 lines (the rest is named, with `less` or an editor as the way to read it), binary and UTF-16 files are refused, invalid UTF-8 is shown with `�` and a note. Control characters, escape sequences and invisible format characters are shown as visible marks, never interpreted. Open in pager, `less`, `bat` and Glow are unchanged.
- **`/edit`, a small native editor** for one text file ([#402](https://github.com/raiseCatError/notMyShell/issues/402)). `/edit notes.md` (or `e` in `/view`) opens the file in a panel: type, select with Shift, Ctrl+Z / Ctrl+Y undo and redo, Ctrl+F find, Ctrl+C / Ctrl+X copy and cut, Ctrl+S save, Esc close (it asks about unsaved changes). A path that does not exist yet is created on the first save. It is for quick edits, not an IDE: `vim`, `nano`, `micro` and your `$EDITOR` still run as usual.
  - Safe saving: the new text is written beside the file and renamed over it, keeping its mode, group, line endings, BOM and final newline; a symlink stays a symlink. If the file changed, was replaced or was deleted since you opened it, nothing is written until you choose Keep editing, Overwrite or Reload. A new file never replaces one that appeared meanwhile.
  - Limits: your own regular UTF-8 text files up to 1 MiB with one hard link, writable, with one kind of line ending. Others are refused with the reason and stay readable in `/view`. Extended attributes and ACLs are not carried over by a save. Unsaved text is lost if the NMSh window itself is closed.
- **Semantic Output** for test runs and builds ([#386](https://github.com/raiseCatError/notMyShell/issues/386), first phase). A completed block whose output NMSh recognizes gets one overview row with the counts the tool printed (`✔ node --test · 1,772 passed · 0 failed · 25 skipped`, `✘ TypeScript · 3 errors in 2 files`) and, when it listed failures or diagnostics, a details row that opens them, taken verbatim from the output. Recognized: Node's test runner (spec and TAP), Jest, Vitest, pytest, `cargo test`, `go test`, TypeScript, Rust and GCC/Clang diagnostics; anything else stays raw only, and short passing output gets nothing. Details start open when the raw output is folded; click the details row or use Actions → Show or hide details. The output itself, its folding, search, selection and plain `/copy` are unchanged. `/copy --semantic` copies the reading (raw for an output without one, as the note says) and `/copy --both` the raw output and the reading under labelled NMSh separators. Settings → Transcript → Semantic Output turns it off.
- **Native modules: Bun, Nix shell and container** ([#364](https://github.com/raiseCatError/notMyShell/issues/364)). Bun's requested version comes from `.bun-version` or `package.json` (`packageManager`, `engines.bun`) and the active one from its install location; the Nix shell module shows `pure`/`impure` from `IN_NIX_SHELL`; the container module names Docker, Podman, a dev container or Codespaces from marker files and host variables. None runs anything; all are off until enabled in `/modules`, which recommends Bun and Nix when their files are present.
- **`/modules explain` and `/modules timings`** ([#365](https://github.com/raiseCatError/notMyShell/issues/365)) write a plain-text report into the transcript: each configured module's surface, whether it is on screen and why (including when the Context Rail or Status Strip left it out, or shortened it, to fit the width in the last frame), and its sources' state, age and last collection time; or the slowest last collections. They read what the Context Engine already has and collect nothing.
- **Five more bundled theme families** ([#401](https://github.com/raiseCatError/notMyShell/issues/401)): Ayu (Dark, Mirage, Light), Kanagawa (Wave, Dragon, Lotus), Everforest (Dark, Light), Flexoki (Dark, Light) and Night Owl (Night Owl, Light Owl), with colors copied exactly from each project's MIT-licensed source at a recorded revision. They theme NMSh's own prompt fills and chrome only; the terminal's own colors and configuration are never changed. Existing theme ids and saved choices are unchanged, and Lavender stays the default. Theme Studio's Built-in list gains `/` to filter by name, family, or `dark`/`light`.
- **`/track`** keeps one live result of a finite command in the transcript, refreshed in place ([#393](https://github.com/raiseCatError/notMyShell/issues/393)). `/track df -h` or `/track --every 5s -- docker system df` writes the command once, then shows a status row (`live · every 5s · updated 13:49:25 · exit 0`, a failing exit, a timeout, paused, stale, refreshing) and the latest result under it, with a stable height. The shell stays free; nothing accumulates per refresh, and find, selection and `/copy` never include the live rows. `/track copy` copies the latest result, `/track refresh`, `pause`, `resume` and `stop` control it, and stopping leaves the last result in the transcript once. Samples run `sh -c` from the starting directory with your shell's PATH (not its aliases or functions), never overlap, and are bounded (200 kB, a timeout, at most 8 trackers); destructive and unknown commands are refused or need a Yes, as for `/watch`. Trackers stop with the window that started them. `/watch` keeps its manager and its behavior; both share one scheduler, which gains stricter interval parsing, refusals for substitutions, background jobs and heredocs, UTF-8-safe bounded capture, visible timeouts and a stop grace period (from draft #394).
- **Command suggestions in Ask, from your local model** ([#432](https://github.com/raiseCatError/notMyShell/issues/432), first part). Off by default; Settings → Ask → Command suggestions → Local model turns them on. When Ask cannot place a request (`/btw convert every png here to webp`), your local model (set up in `/llm`) may suggest one shell command. Ask shows it with NMSh's own check (reads only, changes things, installs software, destructive), never the model's, and offers Copy or Insert only: Insert puts it in the composer unsent, and only your Enter runs it. The model is sent the request, the shell and the OS family, nothing else; requests Ask refuses stay refused. Remote providers are not part of this release.

### Fixed

- Multi-line progress displays that redraw their own rows (cursor up and erase line, as concurrent downloads and container pulls do) now update in place instead of leaving a copy of every frame in the transcript ([#388](https://github.com/raiseCatError/notMyShell/issues/388)). A program can redraw only its own recent rows, at most a screen height up, never NMSh's lines or earlier commands; `/copy` copies the final rows once. Rows are the terminal's rows: a line wider than the window counts as the rows it occupies, so a display that redraws over its own wrapped line no longer erases the log lines above it at narrow widths. A status row an installer reserves below a scroll region is not written into the log. Absolute cursor positioning is not mapped.
- A queued command whose command word was still being classified when the next prompt reported new shell knowledge no longer keeps the unclassified color ([#408](https://github.com/raiseCatError/notMyShell/issues/408)).
- With a slow zsh configuration (one that takes longer than a second and a half to load, as nvm or a large framework can), command colors no longer stop for the rest of the session: the first lookup waited on the configuration, timed out, and ended the helper that tells known commands from unknown ones.
- Paste review and `/track`: a redirect into a file is recognized wherever `>/dev/null` also appears (`echo x > ~/.zshrc 2>/dev/null` was labelled read-only), and `>|` is a redirection, not a pipe.
- `/track` and `/watch` no longer start, without asking, commands that change things through the network or another command: `env <command>`, `NAME=value` prefixes, git's `-c`/`--ext-diff`, `npm publish`/`login`/`x`, `pnpm dlx`, `ssh`, `curl -X POST`/`-d`/`-o file`, plain `wget`; options that write files (`git … --output`, `sort -o`, `jest -u`, `--fix`) are refused. Read-only probes (`ping`, `dig`, `nc -z`, a curl GET) still start at once, and `npm test 2>&1` is no longer refused as a background job ([#393](https://github.com/raiseCatError/notMyShell/issues/393)).
- `/track stop` and a closing window end every process a tracked command left in its process group, including one that ignored TERM; a tracker whose directory disappeared names it instead of reporting `spawn /bin/sh ENOENT`.

## [0.20.0] - 2026-10-18

**Terminal workflow, first-run setup, background tasks & native modules.** The first stable release since v0.18.0. A new first run lets you pick a starting point under a live aurora and review it before anything applies; queued commands read as a chronological timeline with saved summaries; completed output can be selected, copied and acted on from the keyboard; optional tools are discovered, reviewed and installed through one flow; long-running commands can run as background tasks beside the shell; and the native module catalog covers twelve more runtimes and build tools. Every new control is reached through an explicit command, key or review, and the persistent shell, the queue and program input keep their behavior.

**v0.19.0 was never published.** Its terminal workflow (input awareness, command queue, copy and Smart Folding, Copy as Report, Compare output, references, paste review, pins and recipes, activity wording) ships for the first time in this release; there is no v0.19.0 tag or download. Its notes are kept below as [0.19.0 — not released separately](#0190---not-released-included-in-0200). Upgrading from v0.18.0 brings both sections.

Verification: one full canonical `verify:release` on the release commit (build, the complete unit and real-PTY suite, benchmark typecheck and timing smoke) and exact-commit CI (Ubuntu and macOS shards, Node 22 and 26, Fedora portability subset, both timing smokes). Physical-terminal evidence: the maintainer tested and accepted the first-run starting point, guided Setup and Tools flow on macOS; the formal v0.19 and v0.20 checklists were not completed item by item, and no physical Linux, Omarchy or WSL pass has been made ([v0.20 physical QA record](docs/testing/v020-physical-qa.md)).

### Added

#### First run: starting points under a reactive aurora
- A fresh installation opens one starting point: four choices (**NMSh Recommended**, **Minimal Terminal**, **Customize Everything**, **Keep Existing**) under NMSh's real Aurora engine, with Vespyr on the horizon. Highlighting a choice changes the sky's mood in a short cross-fade; nothing applies until you review the choice and press Enter, and Esc asks *Leave setup?* with Stay first. `A` cycles the backdrop through Aurora, Subtle and Off and is saved at once. Reduced Motion, Effects Off, `NO_COLOR` and 16-color terminals get a still or plain sky, and every choice, Apply and Leave stay reachable down to 16 × 6.
- Apply folds the sky into one rule and raises the real composer into place; a genuine first run adds Vespyr's welcome once, whichever starting point it chose. Later applies add one receipt line.
- **Keep Existing** reads your environment read-only (Starship, Powerlevel10k or Oh My Posh, colors and tools) and keeps what it finds; it can also offer NMSh Native or another installed prompt. No file outside NMSh's configuration is changed.
- **Minimal Terminal** starts Two-line (←→ One-line) with a quiet Flow composer and no greeting; an existing greeting is hidden, not deleted.
- **Customize Everything** opens the guided setup in the selector's visual language (route of steps, *Step N of M*, keycaps, a live preview from 96 columns). Esc returns to the choices without closing setup. The guided setup keeps one fixed frame, and editors it opens return to the same step, row and unapplied draft.
- `/startup`, `/setup quick` and Settings → Starting point reopen the selector; `/setup` opens the guided setup directly, and `/setup prompt|look|motion|cursor` stay direct.
- On the first run only, where NMSh can prove the window is its own (Terminal.app; kitty on macOS with a remote-control socket; Hyprland 0.55+ with a Lua configuration), it offers to maximize the window for setup and restores it afterwards if it is still as NMSh left it. Nothing about the offer is saved ([first-run window maximization](docs/testing/first-run-window-maximization.md)).

#### Optional tools: one discovery and install flow
- `/tools`, Settings → Tools, the guided setup and the starting point's review share one panel and installer. Tools have tiers: **Recommended** (ripgrep, fd, fzf, jq, bat, zoxide, tealdeer) and **Enhanced** (for example eza, gh, lazygit, delta, Atuin, jc, Glow, xh, direnv, ShellCheck, shfmt), plus the rest of the curated catalog. `V` switches the view (Recommended → Recommended + Enhanced → All curated tools; Recommended + Enhanced by default) without changing the selection.
- Space selects one tool, `R` and `E` add the missing Recommended or Recommended + Enhanced tools, `C` clears; keys never type into search (`/` focuses it). Enter reviews the exact package-manager command of every selected tool, then one confirmation with semantic buttons (No first; green *Yes, install*; red *Yes, uninstall*) and per-tool results.
- A check that fails or does not finish reads *Unable to verify*, never Missing, and is never selected or installed; a missing tool without an installer on this system reads *Unsupported here*. Installing zoxide, fzf or Atuin never turns on their shell hooks. Fastfetch stays a supported welcome provider without a tier.

#### Execution timeline and queue
- Queued commands are shown as a safe chronological timeline: the running command, up to two recent results and up to two upcoming commands, with semantic motion that respects Reduced Motion.
- `/settings queue` and `/queue settings` open one Queue destination: queue behavior, failure policy, the live timeline, recent and upcoming counts, completed-view retention, queued output display and saved summaries. Short forms: `/q`, `/qp` or `/pause` (pause), `/qr` (review, then resume), `/qc` (review, then clear).
- **Queued output folding:** with *Fold queued output*, a successful queued command's long output folds behind a hint and `Ctrl+O` expands or collapses it. Folding is presentation only: copies keep every line, tabs and Unicode. Inline is the default; failures, interruptions and output you are inspecting stay expanded.
- **Queue summaries:** settled chains are kept for review (`/queue history`, newest first, with results on demand) and can be saved as typed, privacy-safe summaries in the session's transcript (`/queue save-summary` after an exact-text review). Saved summaries hold observed facts only; restoring or reattaching never runs anything.
- **Multi-line paste choices:** reviewing a multi-line paste offers Run as block, Queue separately, Edit or Cancel. Separation that would not be safe is refused with the reason; block and edit stay available.

#### Output selection and Actions
- `/copy` selects completed output from the keyboard: Up/Down moves between outputs, Enter copies, Esc returns to the draft and view. `/actions` (and `/actions N`) opens the actions for a completed output. Saved Quick Copy and picker preferences still apply, and the selected surface stays continuous across prompt segments, wedges and inverse output.

#### Colors, cursor and updates
- Choosing Custom colors opens a real editor at once: ten presets (Lavender, Purple, Blue, Cyan, Teal, Green, Amber, Orange, Rose, White), a live preview, each stop's hex, `S` to apply and Esc to cancel. The cursor idle effect gets its own colors (Follow cursor effect by default, as before).
- `/cursor` offers Purple, Blue, Green, Classic, Follow theme and Custom Fire colors. Auto uses the portable effect until a supported native integration is configured; the terminal still controls its physical caret color.
- With update notifications set to Notify, a newer stable release shows one short amber notice in the transcript, once per version, with the way to update *this* installation: brew commands for Homebrew, `/update` for a verified source checkout, the release page otherwise.

#### Workspace sidebar and detail panel — experimental, Off by default ([#330](https://github.com/raiseCatError/notMyShell/issues/330)–[#335](https://github.com/raiseCatError/notMyShell/issues/335))
- **Experimental and Off by default.** Turn it on in Settings → Layout → Workspace sidebar & panel (or Setup → Editor). While Off, `/sidebar` and `/panel` say how to turn it on and open nothing, and `keymap.json` workspace bindings are kept but take no key (`/keys` says so). Turning it Off closes open regions and gives the shell every column again. `/worktrees`, `/sessions`, `/github` and `/background` never depend on it. The docked layout is expected to be replaced by integrations with dedicated Git tools in a later release.
- When on, `/sidebar` lists tmux panes of the server NMSh runs inside, this repository's worktrees and links to `/github`, `/agents` and `/sessions`; `/panel` explains the selected item. `/sidebar focus` and `/panel focus` give them the keyboard; Esc returns, Tab moves between regions, a click focuses a region.
- On a wide terminal the regions dock beside the transcript and the shell is sized to the middle; on a narrow one a region opens as a drawer over the transcript only while it has the keyboard, and the shell keeps its width. Fullscreen programs and idle visuals hide them.
- Opening a worktree stages its `cd` in an empty composer; tmux navigation selects panes and windows by id through tmux from fixed system locations. Nothing runs by itself.
- `keymap.json` binds workspace keys, opt-in and validated (composer keys must say what they replace); `/keys` shows the keys in effect, problems in the file and keys the terminal or tmux may take first; `/keys reload` reads it again.

#### Background tasks ([#382](https://github.com/raiseCatError/notMyShell/issues/382))
- `/background run <command>` (`/bg run`) starts a long-running command (`adb logcat`, `tail -f`, a dev server) in its own terminal beside the shell, in the shell's directory with its PATH, without the shell's aliases, functions or unexported variables.
- A task bar above the composer: Up from an idle composer (after a shown agent shelf) or Shift+Up focuses it; Enter opens a task's output, `x` stops it (again later: terminate, then kill, paced so a held key cannot jump to SIGKILL), Delete removes a finished one. `/background` lists every task with details and preferences; `/background t3`, `stop`, `kill`, `remove` and `clear` act directly.
- Tasks belong to the session: they keep running while the window is detached, a reattached window shows them and their recent output, and ending the session ends them. Task output never enters the shell, the transcript, copies, reports or comparisons; the transcript gets one line when a task starts and when it fails.
- Suggestions are **off by default**. `/background suggestions on` offers a recognized command's family when you submit it: `b` background once, Enter here as before, `a` always, `n` never ask, Esc back to the draft.

#### Native modules ([#364](https://github.com/raiseCatError/notMyShell/issues/364))
- Runtimes: .NET, Swift, Zig and Deno ([#370](https://github.com/raiseCatError/notMyShell/pull/370), which also becomes the canonical Ruby and PHP implementation), Elixir, Dart and Flutter ([#372](https://github.com/raiseCatError/notMyShell/pull/372)). Requested versions come from the project's own files, active versions from the install location; no tool is ever run and a binary inside the workspace is refused.
- One `build` module for Bazel, Gradle, Maven, CMake, Meson and Make with the version the project pins ([#373](https://github.com/raiseCatError/notMyShell/pull/373)).
- Mercurial bookmark or branch and Jujutsu repository state in the version-control extras pack ([#374](https://github.com/raiseCatError/notMyShell/pull/374)).

#### Managed Claude Code ([#347](https://github.com/raiseCatError/notMyShell/pull/347))
- `/model` and `/effort` as native pickers over Claude's documented control requests; a change shows as requested until Claude reports it.
- Claude mods with their real types and states per launch identity (read only). Turning a Claude plugin on or off from NMSh is **off in this release**: it was never verified against a live account and it would write your Claude settings, so the row names the `claude plugin enable|disable … --scope …` command to run yourself. Behind the experimental `NMSH_EXPERIMENTAL_CLAUDE_PLUGIN_TOGGLE=1`, it goes through Claude's own command at the installed scope and running managed sessions reload. NMSh never edits Claude's settings files. Managed Claude stays beta; its physical QA was deferred for this release.
- A context panel beside the agent conversation, provenance on every runtime fact, and Markdown rendering for agent output that reveals real link destinations and refuses smuggled characters.

#### Worktrees and controls
- `/worktrees` shows a related pull request only from evidence: the last `/github` listing of the same repository, with the PR's head branch in its own repository exactly the worktree's branch; `p` opens it in `/github` ([#381](https://github.com/raiseCatError/notMyShell/pull/381)).
- A shared action-control renderer whose states are told apart by marks, not color, first used by the `/worktrees` confirmation ([#369](https://github.com/raiseCatError/notMyShell/pull/369)).

### Changed
- **Fresh defaults are NMSh Recommended:** Lavender Native, Rich motion (Expressive context and events, Sweep launch, Seal completion, cursor travel), Chat transcript with grayscale history, Smart folding, automatic typed queue summaries and a Project + Session window title. Cursor effects start Off with a theme-colored caret (choosing Fire starts on the Classic flame), and Minimal starts Two-line. **Saved configurations keep their behavior:** fields missing from an existing file read as their previous values (no added motion, no cursor effect, Normal transcript, summaries and title Off), and explicit and unknown fields survive saving.
- Setup runs Look → Prompt → Motion, and Chroma is chosen in Look only. Setup previews show the real result (real screen-saver previews, a Chroma preview that follows the setting and says what hides it, a legible activity-wording example).
- Menus share one set of selection glyphs with ASCII forms under Safe glyphs; the selection band marks the cursor only, and status words such as *✓ Selected* carry the selection. Panels opened from Settings return to Settings.
- Confirmations use semantic Yes/No controls: No is focused first, and an install or uninstall names what it will do.
- The background task bar is readable at rest; finished tasks show their outcome briefly (6 s, 30 s after a failure) and then stay listed in `/background`.
- NMSh's own lines (`/copy` confirmations, notices, completion rows) wrap at word boundaries in narrow windows, with continuation rows indented under the text instead of splitting words such as `5 l`/`ines`. Copying a selection still gives the line exactly as stored. Shell output keeps the terminal's column wrapping ([#349](https://github.com/raiseCatError/notMyShell/pull/349)).

### Fixed
- **Input ownership:** replies to `read`, `read -k 1`, `read -n 1` and hidden reads are no longer queued, left in the composer or lost, however soon they are typed; Ctrl+C or Ctrl+Z ends a waiting question and what you type next is for the prompt. A waiting read is shown in its own color with the program's question and one instruction.
- **Exact `/copy`:** copies are the bytes the program printed, tabs and the final newline included.
- **Composer history while a command runs:** ↑/↓ recall history again while a command that reads nothing is running; a program reading input, a full-screen program or an edited queue entry keeps the keys. Recalled text reaches the queue only through Enter, and `/shell` starts navigation fresh in the new shell.
- Queued, attached and restored commands get the composer's syntax colors once their command word is classified.
- The queue shows what runs next and in what order, and resume and approve are reviewed in place; nothing runs from one key and a typed `y` never approves. Paste review never lets an NMSh command label mask what the shell would run.
- Pausing the queue or declining an approval is acknowledged only once the session owner reports it, and the draft is kept. An interruption (Ctrl+C, exit 130) holds pending queued work.
- The selected surface no longer lets prompt segment backgrounds, Powerline connectors or inverse video punch through it.
- Vespyr is composited pixel by pixel, with no background rectangle behind the cat.
- Tools: recommended tools stay listed once installed, and a tool check's timeout always fires.
- Background tasks signal only their own process group through a task-local guard, never a saved numeric group id, so a reused process id cannot be signalled.
- The Codex app-server adapter sends a cancel made before Codex names the turn as soon as it does (the adapter remains unwired).

### Security
- Approval prompts show everything they approve: a multi-line command is shown on every line (cut at 600 characters with the remainder counted), so a harmless first line can no longer hide what follows; this fixes the shipped Claude adapter's permission prompts ([#380](https://github.com/raiseCatError/notMyShell/pull/380)).
- Executable Portable Mods stay disabled behind a documented threat model and a regression gate; the only processes the mods code may start are Claude's own `plugin` commands in four reviewed forms, without a shell ([#379](https://github.com/raiseCatError/notMyShell/pull/379)).
- Background tasks: every request, task record and output update crossing the session boundary is validated; task output is sanitized line by line and bounded; signals reach only a task's own process group; the environment is used for the spawn only and never stored.
- Workspace text from tmux, Git and keymap files has whole escape sequences removed before it is drawn.
- Saving a queue summary goes through the same scrollable exact-text review as reports; compact display can never hide persisted command arguments, redacted text cannot be edited in that review, and automatic summaries keep recognized command labels only when the session owner observed that the command is eligible for history.
- Reviewed paste blocks submit exactly the entries you kept, in the order shown; a removed or empty block can never submit the original paste.
- Keep Existing detection and the window-maximization probe are read-only; the probe never changes a window it cannot prove is NMSh's own.

### Compatibility
- Node.js 22 or newer; zsh, Bash 4.4+ and Fish, as in v0.18.0. CI covers Node 22 and 26 on Ubuntu, Node 26 on macOS, and a Linux portability subset on Fedora.
- Queue history, summaries and acknowledged pause need a session service from this release; a service started by an older NMSh keeps the older queue behavior until it restarts.
- Background tasks need a session service from this release (a service started by an older NMSh says so until it restarts) and POSIX process groups (macOS, Linux, WSL 2).
- The tmux section of the sidebar needs tmux in `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` or `/bin`.

### Upgrade notes
- **From v0.18.0:** settings, themes, modules, sessions and history carry over. An existing installation does not see the first-run starting point (`/startup` opens it any time) and keeps its saved presentation; fields it never saved read as their previous behavior. The v0.19.0 upgrade notes below also apply: activity wording becomes Expressive and the command queue is on by default.
- With update notifications on Notify, NMSh shows one amber notice per new stable release; Off checks nothing.
- Nothing new is on after the upgrade: the experimental sidebar and panel are Off (a configuration without the new `workspacePanels` setting reads as Off, and nothing else in it changes), the composer binds no workspace keys, and background suggestions are off.
- Restart the session service (or start a new session) to use background tasks, queue history and summaries.
- Homebrew: `brew upgrade raiseCatError/tap/nmsh` installs whatever version the tap's formula points to; check `nmsh --version` (see the README for the tap's status).

### Known limitations
- **Physical-terminal evidence is partial.** The maintainer tested and accepted the first-run starting point, guided Setup and Tools flow on macOS; physical QA during stabilization found the input-ownership, exact-copy, queue and Setup issues fixed above. The formal checklist passes for background tasks, the new modules, managed Claude and the v0.19 workflow were not recorded item by item. No physical Linux (including Omarchy/Hyprland), WSL 2, iTerm2, kitty, WezTerm or Windows Terminal pass has been made; Linux remains beta on automated CI. The experimental workspace regions, drawers and keymap host notes are not physically tested.
- The first-run window offer on Hyprland/Omarchy and kitty is covered by automated tests only.
- Clicks focus a region but do not select sidebar rows; the mouse wheel scrolls the transcript wherever the pointer is.
- The sidebar lists tmux and worktrees only; NMSh sessions and managed targets as rows, and module diagnostics in the detail panel (they stay in `/modules` details), are not included.
- Background tasks run in a separate shell: aliases, functions and unexported variables of the live shell are not available. A service restart ends the tasks it owned. Output kept by the task owner is 5,000 lines or 2 MiB per task.
- The Codex app-server adapter is included but not wired: Codex and OpenCode sessions are shown, not controlled. Claude Remote Control stays unsupported for managed targets.
- Claude mod enable/disable has not been exercised against a live Claude account in this release's verification.
- Everything listed under v0.19.0's known limitations still applies.

## [0.19.0] - Not released (included in 0.20.0)

**Terminal workflow.** One command's result becomes useful for the next without NMSh taking execution away from the real shell. NMSh notices when a running command is waiting for you, lets you prepare the next commands while one runs, copies exactly what you choose, turns output into reviewed reports and comparisons, and keeps the commands you reuse. Nothing derived from output, the clipboard, a pin or a recipe runs without an explicit action, and every queued command still runs in your one persistent shell.

Verification: automated CI (unit and real-PTY suites on macOS and Ubuntu, Node 22 and 26, a Fedora portability subset and the timing smoke) on the integrated head, plus the per-feature canonical, Linux/Fish 3.7 and report/compare/clipboard security gates recorded in [the frontend freeze handoff](https://github.com/raiseCatError/notMyShell/blob/ca26b9be62f2d7eb7f083e05bd6a2fcff9334811/docs/development/workflow-frontend-freeze.md). This candidate was never published on its own: no v0.19.0 tag or release exists, and everything below first ships in v0.20.0. Physical-terminal status is recorded with v0.20.0 ([v0.19 physical QA checklist](docs/testing/v019-physical-qa.md)).

### Added

#### Input awareness ([#348](https://github.com/raiseCatError/notMyShell/pull/348))
- **Input awareness:** a command that waits for an answer is no longer just "Running". NMSh reads the terminal's own state, without touching the program. A password or other no-echo read, or a single-key question such as `e2fsck`'s `Fix<y>?`, is confirmed; on Linux, any blocking read of the terminal is confirmed too. An ordinary line question left open by an idle process is shown as "Probably waiting for input". The question stays visible beside the composer however far the transcript has scrolled, and the window title, `/sessions`, `/resume` and a cross-session notice show the wait. Hidden and single-key input goes straight to the program, keystroke by keystroke, and is never shown or kept. A reply left unsent when the command ends is discarded, never run as a shell command. Waiting time is measured separately from wall-clock time and reported on completion. See `docs/design/input-awareness.md`.
- Fish's own `read` and other builtin readers are recognized from authenticated terminal ownership, and input typed during startup, before the shell is ready, or while a hidden read is open goes only to the program that currently owns the terminal.

#### Command queue ([#357](https://github.com/raiseCatError/notMyShell/pull/357))
- Commands typed while another runs are **queued in the same shell** and run after it, one at a time, only when the shell reports it is ready, keeping the directory, variables and functions. Multiline entries keep their meaning (Fish `begin`/`end`, zsh and Bash brace groups). `/queue` shows, edits, reorders, pauses, resumes or clears them; queued command text is drawn, never interpreted.
- When the running program is waiting for an answer, Enter answers it and **Ctrl+Q** composes a queue entry instead. While a program reads keys directly, Ctrl+Q takes the next command for the queue and **Ctrl+S** sends the composer's text to the program.
- A failure or interrupt **pauses** the rest of the queue. Detach and reattach never submit an entry twice; switching shells pauses the queue, and a shell that exits drops its entries instead of replaying them in another shell. Silence is never taken as completion.

#### Copy and Smart Folding ([#358](https://github.com/raiseCatError/notMyShell/pull/358), [#350](https://github.com/raiseCatError/notMyShell/issues/350))
- `/copy N`, `/copy -N` (the latest N), ranges `A-B` and lists `1,3,5`; `--status` adds the completion row; `/cp` is the same command in every form.
- `/copy ui` opens an interactive picker; `/copy settings` chooses Quick Copy or the picker by default and whether copies include status.
- A sticky Copy control keeps block actions reachable while a long block's header is scrolled away.
- **Smart Folding** keeps long diagnostics readable; the full output stays stored, and copies include folded lines.

#### Copy as Report ([#360](https://github.com/raiseCatError/notMyShell/pull/360), [#351](https://github.com/raiseCatError/notMyShell/issues/351))
- One or several command blocks as a Markdown or plain-text report with command, output, directory and exit status, always shown for review first. Enter copies exactly the reviewed text; cancel leaves the clipboard unchanged.
- Likely secrets and private paths are **redacted** in the review before any Markdown is added; edited text is rescanned, changed lines are marked, and an unredacted choice is labelled. Redaction is best-effort (see Known limitations).

#### Compare output ([#361](https://github.com/raiseCatError/notMyShell/pull/361), [#352](https://github.com/raiseCatError/notMyShell/issues/352))
- `/compare` (the latest output with its previous run), `/compare N`, `/compare N M` (numbers as for `/copy`), or Actions → Compare output…: a line diff with counts, hunks and collapsed unchanged regions, side by side from 140 columns and unified below, with labelled whitespace normalization. Output lost while detached is marked incomplete.
- In the comparison, `r` opens the diff as a reviewed, redacted report. `c` copies the sanitized plain diff **directly, without redaction** (it shows a caution when the detector flags a likely secret).

#### References, paste review, clips, pins and recipes ([#368](https://github.com/raiseCatError/notMyShell/pull/368), [#353](https://github.com/raiseCatError/notMyShell/issues/353)–[#355](https://github.com/raiseCatError/notMyShell/issues/355))
- Files, links, commits and device names in a block's output can be opened, copied or staged from its Actions; nothing runs by itself.
- **F8 / Shift+F8** walk failed commands (by exit status, not text matching) and keep your draft; the palette offers Previous/Next failed command too.
- **Paste review:** a pasted zsh, Bash or Fish sequence can be split into commands and parse-checked without running anything; confirming queues the reviewed list. `/ps` reads the clipboard only when you run it.
- **Queue conditions:** an entry can wait for its own approval (withdrawn if the entry is edited) or be marked `always` to run even after a plain failure, never after an interrupt.
- `/clips`: text deliberately kept in memory for this window, reviewed before insertion and gone when the window closes. Optional clipboard-change hints on macOS (`/clips suggestions on`, off by default) read only the pasteboard's change counter, never its contents.
- `/pins`: pinned commands with their directory (palette → Pin selected history command) and recipes with quoted placeholders, staged or reviewed and queued, never run automatically.

#### Activity wording ([#367](https://github.com/raiseCatError/notMyShell/pull/367), [#362](https://github.com/raiseCatError/notMyShell/issues/362))
- **Expressive** (the new default) gives each running command one stable phrase from a curated 663-pair vocabulary (`✦ Cooking… · 18s`, then `✔ Cooked for 18.0s`), kept across detach and reattach; **Classic** keeps plain Running/Completed wording (Settings → Live activity → Activity wording, and Setup). Failures, interrupts, agents and queued runs keep factual wording, and copies, reports and restored records always store the factual form.

#### Modules and themes
- Module details explain where a fact came from, its freshness, cache retention and measured collection time, and say when a fact is uncollected or unknown rather than implying it; `/doctor` reports Context Engine health ([#365](https://github.com/raiseCatError/notMyShell/issues/365)).
- Ruby and PHP version modules read the project's own files and the install location, never running an interpreter. The Gemfile `ruby` declaration is parsed in linear time.
- `/theme` imports **Starship** configurations as Native themes from their static colors only; format strings and custom commands are never evaluated, and the preview lists what was not carried over.

### Changed
- **Setup Cat order: Look → Prompt → Motion.** The first steps after Terminal are now **Look** (formerly Appearance): theme family, variant, accent, theme text, UI chrome, then Chroma (the only place Setup chooses it) with its dependent rows under it; **Prompt**, which shows Chroma as a read-only line that goes to Look; and **Motion**, which now starts with Reduced Motion, Decorative effects, Shimmer and Milestone effects above the motion rows they govern. Cursor follows Motion. Every setting stays reachable and saved values are unchanged; `/setup look` opens Look (`/setup appearance` and `/setup chroma` still work).

### Fixed
- **Single-key prompts:** answering a single-key question through the composer no longer sends a stray Enter that answered the next question with its default.
- **Passwords:** text typed at a password prompt is no longer drawn in the composer.
- Startup and termination: a quit or termination signal at any point during startup cleans up the frontend; a prompt that arrives after the window has closed can no longer restart context collection or queue work.
- Reattaching to a fullscreen program gives it the terminal and its size at once, before the session journal is written.
- Native completion accepts readiness that arrives in fragments (LF or CRLF) within its existing bounds.
- The command directory recorded with a command is the shell's authenticated directory at submission, even when asynchronous context collection still describes the previous prompt.
- Restored command and status rows follow the attaching window's NO_COLOR setting.
- `/sessions` refreshes live session facts without losing the selection, query, draft or focus.
- A clipboard write is reported as complete only when the whole payload was delivered and the clipboard tool exited successfully.

### Security
- Every session socket request (listings, notices, dismiss, rename, kill), not only create and attach, verifies the private runtime directory's ownership before connecting.
- A client cancelled before it started discards output withheld for it instead of exposing it.
- Report and comparison text is redacted before Markdown is added; hostile command, status and directory text (line breaks, backticks) stays enclosed, with bounded delimiter sizing for backtick-rich data. Report review stays readable at extreme terminal widths.
- Comparison chooser headings and pasted-text review show control, bidi and zero-width characters visibly instead of sending them to the terminal.
- The pins panel shows control and bidi characters in labels and prompts instead of writing them to the terminal.

### Compatibility
- Node.js 22 or newer, as before. CI covers Node 22 and 26 on Ubuntu, Node 26 on macOS, and a Linux portability subset on Fedora.
- zsh, Bash 4.4+ and Fish. Fish 3.7 on Linux is covered by the frontend freeze verification; automated Bash coverage is 5.x, so the 4.4 minimum was not exercised directly.
- The command queue and queue conditions need a session service from this release: a service started by an older NMSh reports the queue as unavailable until it restarts.
- Clipboard-change hints need macOS; Linux has no supported metadata-only clipboard counter.

### Upgrade notes
- Activity wording becomes **Expressive** by default, including for existing settings. Choose Classic in Settings → Live activity → Activity wording to keep the previous wording.
- The command queue is on by default (Settings can turn it off). Existing session services keep running; restart them (or start a new session) to use the queue.
- Settings, themes, modules and history carry over unchanged. Clipboard suggestions stay off until turned on.

### Known limitations
- Physical-terminal status for these features is recorded under v0.20.0's known limitations.
- Redaction is pattern-based and can miss custom, encoded or unknown secret forms and private paths; review every report. Comparison `c` and plain `/copy` copy without redaction by design.
- A clipboard tool that fails after it started writing may already have changed the clipboard; NMSh cannot roll it back.
- Fish can drop type-ahead entered while its own `read` is still running, as in any terminal ([#356](https://github.com/raiseCatError/notMyShell/issues/356)).
- Project and branch facts can lag a fast directory change while collection is pending; a failed `/sessions` poll keeps the last validated view.
- A concurrent resize and quit key in native `less` can lose the quit key; synchronized automated tests do not prove arbitrary physical resize timing.
- A forced SIGKILL of the frontend can bypass helper cleanup; normal stop, SIGTERM and SIGHUP clean up owned helpers.
- Exact last-frame module width-compaction explanations and dedicated external source previews are not included ([#365](https://github.com/raiseCatError/notMyShell/issues/365)).
- Ruby and PHP were the candidate's only new runtimes; the full native runtime set (.NET, Swift, Zig, Deno, Elixir, Dart, Flutter, build systems) is part of v0.20.0.


## [0.18.0] - 2026-10-13

**Context Engine, Managed Agents & Workspaces.** Context modules become a platform: facts are collected on demand by bounded, privacy-labelled capabilities, the first-party catalog ships as declarative Context Packs, and the Status Strip becomes a full second surface for modules. Claude Code can run as a managed target inside NMSh, with its permission requests and questions answered natively. `/worktrees` and a read-only `/github` workspace are the first delivered slices of the workspace work. The release also carries the fixes from the v0.17 Ghostty physical-QA pass and a set of passthrough, tmux, transcript and Fish correctness fixes.

Verification: the release gate is automated CI (unit and real-PTY suites on macOS and Ubuntu, Node 22 and 26, a Fedora portability subset and the timing smoke). **Physical-terminal QA has not been performed**; see Known limitations below and the [v0.18 physical QA checklist](docs/testing/v018-physical-qa.md).

### Added

#### Context Engine and Context Packs ([#305](https://github.com/raiseCatError/notMyShell/issues/305), [#316](https://github.com/raiseCatError/notMyShell/issues/316)–[#320](https://github.com/raiseCatError/notMyShell/issues/320), [PR #326](https://github.com/raiseCatError/notMyShell/pull/326))
- **Capability scheduler:** typed capabilities declare what they read, their environment, cost, timeout, cache lifetime and per-field privacy. Only facts that visible, routed modules demand are resolved, off the typing path, with bounded concurrency, coalescing, timeouts with backoff (and a cold-start allowance), cancellation on directory change, staged scopes that keep the old context visible until the new one settles, stale-while-revalidate caching and command-completion invalidation. Hidden modules cost nothing.
- **Shell-reported environment:** each zsh, Bash and Fish prompt reports an allowlisted set of non-secret environment values (and only the presence of credential variables), so context follows the live shell, not NMSh's launch environment.
- **First-party catalog** as bundled declarative packs: project package; Node, Python, Go, Rust and Java versions from pins and install layouts (never by running them); mise/asdf tool requests and direnv state (never reading `.envrc`); Terraform/OpenTofu, Helm, Pulumi; AWS, Google Cloud and Azure from local non-secret configuration (no API calls, no credentials); OS, user/host/SSH, jobs, session duration, time, memory and battery; Git stash and upstream. Every module has a deterministic preview, Safe-glyph labels and Theme/Neutral roles.
- **Declarative Context Packs** (`nmsh.context-pack/v1`): bounded, strictly parsed data naming core capabilities, with license, provenance, compatibility and recommendations. `nmsh packs` lists, inspects, installs (optionally pinned by `--sha256`), enables, disables and removes local packs atomically; a tampered pack reports an integrity failure. Packs cannot run commands or code and gain no authority by being installed; recommendations explain local evidence and never install or enable anything.
- **Claude Code agent context** through Claude Code's official status line: `nmsh agent-status setup` shows and applies one reviewed settings change, and `nmsh agent-status remove` undoes exactly that change. The bridge keeps an allowlisted, private record per NMSh session, and modules show model, effort, context-window use and 5-hour/7-day limits. No terminal scraping; prompts and transcripts are never read.
- **`/modules`** opens the module manager directly and saves each change as it is made; inside `/prompt` it says it edits the draft, and `A` saves module changes alone. `/` searches Modules, Catalog and Packs over loaded data, footers only offer controls that can act, details wrap at narrow widths (the prompt preview yields first), and under Starship, Powerlevel10k, Oh My Posh or Prompt None the manager marks which surfaces cannot show modules and why, keeping their settings.
- `/prompt` → Modules gains **Catalog** (every module by category, with local recommendations) and **Packs** tabs, and a details view saying what a module reads, how fresh each fact is and whether it may enter command history.

#### Status Strip 2.0 ([PR #328](https://github.com/raiseCatError/notMyShell/pull/328))
- The strip is one row at the **Top** or **Bottom** of the NMSh pane (inside tmux, Bottom sits above tmux's own status line) with independent **Left, Center and Right** groups. Width fitting is deterministic in display cells: compact forms first, then lowest priority, the center before the edges; Keep Awake still narrows full → short → glyph, and the row hides below 30 columns.
- Styles: Plain with a dot (Minimal), bar (Divided) or space separator, or Powerline using the prompt's own geometry; Safe glyphs and NO_COLOR stay readable. Every built-in module except the exit status can be routed to the strip, with a strip-only group.
- **`/strip` Status Strip Studio:** on/off, edge, style, separator, which system items show and where, and the group and order of modules on the strip, with a live preview from the real renderer at the panel width and at 50 columns. The Minimal, Developer and System presets (Custom after edits) preview what they would change before Enter applies them, `U` undoes, and no preset touches cloud or agent modules or turns the strip on.

#### Managed Claude Code and `/mods` ([PR #329](https://github.com/raiseCatError/notMyShell/pull/329), [PR #344](https://github.com/raiseCatError/notMyShell/pull/344), [PR #346](https://github.com/raiseCatError/notMyShell/pull/346))
- **Managed Claude Code targets:** `/claude` focuses or resumes existing work, or opens a launcher listing targets under their launch profile with `+ New target`; `/claude new` always starts fresh, and `/ai` keeps the supervisor. Named launch profiles keep each Claude account's configuration and identity apart. NMSh drives Claude Code through its structured stdio interface, so tool permission requests (allow/deny) and AskUserQuestion questions are answered in NMSh, never by scraping a terminal. Turn results give the real reason ("authentication failed", "Interrupted"), and the model is shown only as Claude reports it.
- **Target shelf:** live targets sit above the composer. Up from an idle composer focuses the shelf, Left/Right select, Enter opens, Down/Esc return.
- **Agent view:** a full-height conversation workspace. A compact welcome (provider, reported model, identity, folder and branch) rests on the composer and gives way as turns arrive; the target's state rides the composer rule; your turns are marked and the agent's prose is the body; tool calls are quiet rows with failures in words. It follows the transcript's Normal or Chat presentation and the composer's Top or Bottom position. The agent draft uses the shell composer's editing geometry and the terminal's own caret, so `/cursor` shape and color apply; Up and Down move through multiline drafts, scrollback reaches the first turn, and a scrolled-back view stays put while new events arrive.
- **`/mods`** (also `/extensions`, `/claude mods`, `/codex mods`): one searchable, keyboard-first inventory of portable mods, provider-native plugins and settings hooks, and Context Packs, in NMSh's own tabs, grouped lists and selection bands. Rows give one state word with scope and version; the selected entry's execution facts stay visible, and Enter opens its full execution and provenance record. Provider plugins are labelled as running inside the provider with no NMSh sandbox. Discovery reads files only and never runs mod code.

#### Worktrees and GitHub (first slices of [#337](https://github.com/raiseCatError/notMyShell/issues/337) and [#338](https://github.com/raiseCatError/notMyShell/issues/338))
- **`/worktrees`** ([PR #342](https://github.com/raiseCatError/notMyShell/pull/342)): this repository's Git worktrees with branch, HEAD, dirty/untracked, locked and prunable state. Enter stages `cd -- '<path>'` in an empty composer (it never runs it and never replaces a draft). `n` takes a branch name and shows the exact plan; nothing is created until Enter on that plan, and Git state is revalidated first. `x` previews removal; removal is never forced, keeps the branch, and is refused for the main, current, locked, prunable or dirty worktree and while a managed agent works inside it.
- **`/github`, `/prs`, `/issues`** ([PR #343](https://github.com/raiseCatError/notMyShell/pull/343)): a read-only workspace for the `origin` repository through your own `gh` login: PR and issue lists with GitHub search syntax, PR overview, checks (with required flags), reviews and comments, commits, files and a bounded diff, and a merge *preview* that only describes what a merge would do. `o` opens the item on github.com and `w` jumps to the PR branch's worktree.
- Ask knows `/worktrees`, `/github`, `/prs` and `/issues`.

#### Terminal and shell ([#304](https://github.com/raiseCatError/notMyShell/issues/304))
- **Terminal title** (Settings → Sessions, Off by default): Project, or Project and session, written only while NMSh owns the screen. Programs keep their own titles, and hosts with a title stack get their previous title back on exit.
- **Open in pager** block action: a command and its complete stored output in your pager on the host terminal, through stdin only (never shell source), with escape sequences shown inert.
- Typo correction works in Bash and Fish, and Bash/Fish command recognition, correction and install offers use the live shell's `PATH`.
- delta's status says whether its syntax highlighting follows bat's NMSh theme or your git config pins it (read as data); diff colors stay in git config.

### Changed
- **One owner for strip facts:** the strip's clock, CPU, RAM, battery and uptime are Context Engine capabilities (new `system.cpu` and `system.uptime`), demanded only while the row shows and only for items switched on. The strip's separate stats poller is removed, and painting the strip performs no I/O.
- **Tab / Shift+Tab** switch tabs in every visual tab bar (`/prompt` views, Modules, Settings, Tools, tmux configuration, Theme Studio), wrapping at the ends; text fields keep Tab.
- Without color (NO_COLOR or Color None), the active tab in every NMSh tab strip is reverse video, matching selected rows; before, only its weight changed.
- Host semantics: command start (OSC 133 `C`) is written at once, even ahead of a fullscreen program; the directory is reported again after a program owned the screen; a reattach replays no history to the host.
- Renderer **Portable** leaves NMSh's managed Ghostty cursor shader off (NMSh draws the trail itself), and the managed shader files follow `/cursor` inside tmux.
- Context Engine benchmarks (cold/warm collection, rapid directory changes, every module on every surface, hidden modules, a large repository) with budgets enforced by CI's timing smoke.

### Fixed
- **Absolute executable paths** typed in the composer (`/Volumes/tools/adb devices`, `/bin/zsh`, `/usr/bin/env …`) run in the shell exactly as typed instead of being refused as unknown NMSh commands, and keep shell completion and suggestions. A first word with a `/` after the leading one is a path (no NMSh command name contains one), so `/zsh` still switches shells while `/bin/zsh` runs; a directory used as a command gets the shell's own behavior.
- **`/copy`** and `/copy N` copy only the command's own output (stdout and stderr, line breaks and spacing kept), never NMSh's completion row such as `✔ Completed · 21.6s · 15:42`, nor NMSh lines (such as a `/copy` confirmation) added inside a running command's block; output that merely looks like a completion row is kept. A command that printed nothing leaves the clipboard as it was and says so.
- **Folding after a screen clear:** after `clear`, tmux, or any program writing `ESC[2J`/`ESC[3J`, fold rows such as `15 lines shown · Ctrl+O` no longer appear inside the next command's output, and Ctrl+O no longer folds another command's lines together with `/copy` and status rows. A clear now retires the records of the lines it removed; a command that clears the screen owns, and `/copy` copies, what it writes afterwards. Transcripts saved before this fix are repaired when opened: a record is kept only if its lines show it owns them, and older commands from before an unrecorded clear lose their fold control and `/copy N` while their lines stay visible. Full-screen programs, partial erases (`ESC[J`, `ESC[1J`, `ESC[K`) and progress redraws never clear the transcript.
- **Fish keystrokes around `read`:** keys typed quickly around a fish `read` are no longer lost to NMSh's query round trip; NMSh answers fish's terminal queries itself, as it already did at fish's prompt, and input waits until fish has redrawn its prompt. For any program, keys never overtake the answer to a device-attributes query.
- **Passthrough programs get their bytes exactly as written:** output processing (`ONLCR`) is off while a program owns the terminal, so raw-mode TUIs that move down with a bare LF no longer overwrite their own prompt or jump the cursor. Two-byte Alt+key prefixes are no longer held as possible terminal answers.
- Terminal queries a program writes before it takes the screen (synchronized output, grapheme clustering, colors) reach the host, and the answers go back to the program instead of the key decoder.
- Ownership handoff: output from the first sign a program owns the screen (alternate screen, an input mode, a kitty keyboard push) belongs to the program, so its paint no longer stays in the transcript after it exits; undrawn sequences no longer print debris (`ESC ( B` → `B`, `ESC[NaN;2m`), zero color components are kept, and half-decoded input is dropped at every handoff.
- **tmux:** `tmux` typed in the composer opens ordinary panes again (tmux no longer inherits NMSh's private `ZDOTDIR` or `POWERLEVEL9K_DISABLE_PROMPT`, and children get the person's own `XDG_CACHE_HOME` back), and a window says when its session service is an older build that still writes the old bootstrap. The mouse wheel scrolls the NMSh transcript instead of cycling composer history (NMSh now asks tmux for button and SGR mouse reports, which tmux forwards with its `mouse` option on or off). NMSh no longer wraps frames in its own DEC 2026 synchronized-output block inside tmux, and repaints that leave the caret in place no longer toggle cursor visibility, so host cursor trails and blink stop jumping.
- **Terminal title** (from the Ghostty QA pass, [#321](https://github.com/raiseCatError/notMyShell/issues/321)): Project and session titles show the session's name at once after `/rename` (and its signature after a reset); after Vim or another passthrough program sets its own title on exit, NMSh writes its title back as soon as it has the screen.
- Theme Bridge colors are valid on 16- and 8-color terminals (theme ANSI slots instead of 256-color codes for less/man, listings and Vim).
- Apply themes → Follow NMSh / Choose theme themes NMSh's own fzf launches even when fzf's Manual setting is Independent.
- A detached session's spooled prompt events are no longer dropped on replay when the shell's knowledge exceeds 64 KiB.
- Unmodified F1 in its kitty keyboard form (`CSI P`) opens the palette.
- Ask's config edits no longer refuse files in a home folder or project reached through a symlink (macOS `/tmp` and `/var` are symlinks); a symlink leading out of them is still refused.

### Security
- Context discovery never runs a discovered executable; one inside the current workspace (followed through symlinks) is not even inspected. Hostile-workspace coverage spans control/bidi/OSC payloads, huge, malformed and symlinked files, fake executables, malicious PATH entries, `.envrc`, kubeconfig `exec`, hostile Git metadata and malicious packs.
- Every NMSh display path (prompt, modules, path, Status Strip, `/prompt` and `/modules` disclosures, fact cache, historical prompt blocks, welcome, startup picker, `/resume` and live-session lists, `nmsh packs` and `nmsh agent-status` output) removes escape sequences whole instead of leaving visible debris; an unterminated OSC in a session-reported directory can no longer swallow the startup screen. Hostile directory names in the terminal title lose whole escape sequences instead of showing `]0;PWNED` debris.
- Retained control sequences are bounded: the transcript parser keeps at most 8 KiB of one unfinished sequence (OSC, DCS, SOS, PM and APC are discarded to their terminator), NMSh's shell markers are capped at 1 MiB and the key decoder at 256 bytes.
- Keys held behind a terminal answer are discarded by Ctrl+C before it is delivered, as a terminal discards pending input, so a cancelled line cannot still run; bracketed pastes are never searched, split or reordered by the hold.
- `/github` writes nothing to GitHub and stores no credentials; IPv4 and IPv6 addresses in GitHub error text are shown as `[address]`.

### Compatibility
- Node.js 22 or newer, as before. CI covers Node 22 and 26 on Ubuntu, Node 26 on macOS, and a Linux portability subset on Fedora.
- zsh, Bash 4.4+ and Fish, as in v0.17.0.
- Managed targets need Claude Code installed. `/github` needs the GitHub CLI (`gh`) logged in and a github.com `origin` remote.

### Upgrade notes
- Homebrew: `brew upgrade raiseCatError/tap/nmsh` once the tap's formula reaches 0.18.0 (the tap's own automation bumps it). `/update` in a Homebrew install points to Homebrew instead of changing the keg; source checkouts update with `/update` as before.
- Settings carry over: existing prompts, modules and Status Strip placement (Top, right-aligned) are kept, and nothing new is turned on by the upgrade. The terminal title stays Off until chosen in Settings → Sessions.
- Claude Code agent context needs one reviewed settings change from `nmsh agent-status setup`; `nmsh agent-status remove` undoes exactly that change.
- A session service started by an older NMSh keeps writing the old shell bootstrap until it restarts; new windows say when this is the case.

### Known limitations
- **Physical-terminal QA was not performed for this release.** `/worktrees`, `/github`, the managed agent view and `/mods` are covered by automated tests and headless terminal recordings; the fixes for absolute paths, `/copy`, folding after a screen clear and Fish keystrokes by automated real-PTY tests. None has had a hands-on pass in Ghostty or Terminal.app. The checklist stays open as post-release follow-up: [docs/testing/v018-physical-qa.md](docs/testing/v018-physical-qa.md). Physical checks in iTerm2, Kitty, WezTerm, Linux and WSL 2 also remain open.
- A lone `ESC[3J` (erase scrollback, without `ESC[2J`) empties NMSh's whole transcript, where a real terminal keeps the screen. `clear` and `clear -x` are unaffected. This dates from the first release; the planned fix is to treat a lone `ESC[3J` as clearing nothing NMSh shows.
- Type-ahead while a fish `read` is still running (the answer and the next command in one fast burst) can still be dropped by fish itself, as in any terminal ([docs/development/fish-typeahead.md](docs/development/fish-typeahead.md)).
- Managed targets are Claude Code only. Codex, OpenCode and other agents' running sessions are shown, not controlled, and live attach to a Claude session started outside NMSh is not supported.
- `/mods` is an inventory: enabling or disabling entries is done in the provider (or with `nmsh packs` for Context Packs), and NMSh does not run portable mod code.
- `/worktrees` and `/github` are first slices; [#337](https://github.com/raiseCatError/notMyShell/issues/337) and [#338](https://github.com/raiseCatError/notMyShell/issues/338) stay open. `/worktrees` navigates by staging `cd` in the composer (focusing an NMSh session or tmux pane is not implemented), and the GitHub workspace is read-only: no merging, reviewing, commenting or closing from NMSh.
- Context Packs install from local files only; a remote pack registry, downloads, signature trust and any executable extension tier are not implemented.
- Still deferred from [#304](https://github.com/raiseCatError/notMyShell/issues/304): delta diff styles (git config) and terminal emulator or editor base-theme takeover.

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

[Unreleased]: https://github.com/raiseCatError/notMyShell/compare/v0.20.0...HEAD
[0.20.0]: https://github.com/raiseCatError/notMyShell/compare/v0.18.0...v0.20.0
[0.18.0]: https://github.com/raiseCatError/notMyShell/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/raiseCatError/notMyShell/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/raiseCatError/notMyShell/compare/v0.7.0...v0.16.0
[0.7.0]: https://github.com/raiseCatError/notMyShell/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/raiseCatError/notMyShell/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/raiseCatError/notMyShell/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/raiseCatError/notMyShell/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/raiseCatError/notMyShell/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/raiseCatError/notMyShell/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/raiseCatError/notMyShell/releases/tag/v0.1.0
