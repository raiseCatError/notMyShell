# notMyShell Architecture

## 1. The 30-second explanation

notMyShell (NMSh) is a terminal frontend. It is not a shell: your real zsh, Bash, or Fish still interprets commands and runs programs. It is not a terminal emulator: Ghostty, Terminal.app, Kitty, or another terminal application still draws the window, fonts, and terminal cells.

NMSh sits between them and owns the interaction around commands: the composer, suggestions, history presentation, command feedback, session navigation, panels, themes, and integrations.

```text
Terminal emulator: window, fonts, terminal protocols
                         ↕
NMSh frontend: editor, transcript, panels, presentation
                         ↕ session client
Session owner: usually a separate local NMSh service
                         ↕ pseudo-terminal (PTY)
              Real zsh / Bash / Fish
                         ↕
                   Programs / OS
```

The shell stays alive between commands. `cd`, exported variables, aliases, functions, and jobs therefore belong to a real continuing shell, rather than to a simulation assembled by NMSh. This document describes the current implementation, including development features; it is not a statement that every feature described has been released.

## 2. What NMSh is made from

The application is **TypeScript running on Node.js**, built into JavaScript for its command-line launcher. Node supplies process management, streams, filesystem access, events, and local sockets. TypeScript makes the contracts between shell events, settings, panels, and actions explicit.

**node-pty** creates a pseudo-terminal: a communication channel that looks like a terminal to the shell and its programs. Ordinary pipes would not provide the same interactive behavior, terminal sizing, and job control.

The frontend draws using **ANSI and related terminal escape sequences**. These are byte instructions for colors, cursor movement, screen modes, hyperlinks, and input reporting. NMSh has its own renderer and screen planner rather than a general web UI framework. **string-width** measures terminal cell widths so wide characters and decorative glyphs do not break wrapping and cursor placement.

Small **shell bootstrap scripts** load the user's normal shell environment, suppress competing shell prompt/editor UI, and report command lifecycle events. Local JSON stores settings and transcripts. **smol-toml**, **yaml**, and **fast-xml-parser** support bounded data imports and reviewed configuration formats; they do not make executable configuration safe to run.

The main coordinator is `TerminalApp`. It connects input, shell events, output state, panels, settings, and rendering. The editor, shell transport, transcript, and domain controllers provide more focused responsibilities around that coordinator.

## 3. The terminal + shell relationship

The outer terminal translates physical keys into bytes and displays bytes NMSh writes. NMSh reads those keys and usually edits its own command buffer. The real shell runs inside an inner PTY.

The object that owns that PTY is `ShellSession`. It launches one persistent interactive shell, writes submissions, forwards interrupts, resizes the PTY, and separates authenticated lifecycle messages from program output. Normally a separate `SessionService` owns `ShellSession`; an in-process fallback can own it inside the frontend.

```text
Normal command:
keys → NMSh editor → shell PTY → program
screen ← NMSh transcript ← PTY output

Interactive/fullscreen program:
keys ─────────────────→ shell PTY → program
screen ←─────────────── program's terminal output
          NMSh presentation suspended
```

The shell remains authoritative for parsing, expansion, pipes, redirections, working directory, and jobs. NMSh owns the editable text and its presentation. It does not turn each command into a separate Node subprocess.

For fullscreen and interactive programs, NMSh switches to **passthrough**: it suspends its screen, gives the program the full terminal dimensions, and forwards input and output. A known-command heuristic can select this immediately; output classification can also detect terminal behavior that requires it. Terminal modes are tracked so attachment and return to the composer can restore the appropriate state.

Typing `caffeinate -i` invokes a program through the shell and occupies that shell until it finishes. `/zoomies` invokes NMSh's separate Keep Awake controller. It can keep an OS assertion alive without occupying the managed shell.

## 4. What happens when I type a command?

Consider `npm test`:

1. **Keystrokes arrive.** The key decoder turns terminal bytes into editing actions. NMSh's `CommandEditor` keeps the command text and cursor position.
2. **Presentation updates.** A synchronous lexical highlighter identifies words, strings, operators, and other tokens. Background command classification supplies facts such as whether `npm` is an executable, alias, or builtin. Suggestions and completion services offer candidates without executing the unfinished command.
3. **Enter submits.** `TerminalApp` reads the actual editor text and checks for an NMSh slash action. For a shell command, it creates a command block, captures historical context, starts activity feedback, and sends the text through the session client to `ShellSession`.
4. **The real shell executes.** Its bootstrap reports a command-start marker. The shell resolves `npm`, performs its own parsing, and launches the program in its continuing environment.
5. **Output returns through the PTY.** Shell protocol decoding removes NMSh lifecycle messages. Program output flows into the output buffer, where terminal formatting and progress updates are represented for the transcript. A session service also retains sequenced events for recovery and reattachment.
6. **The shell becomes ready again.** A marker reports exit status and working directory. NMSh completes the block, records elapsed time, updates history and context, and refreshes the prompt and suggestions.

```text
key → editor → highlight/suggestions → submit → session client
    → persistent shell → program → PTY output → transcript
    → shell readiness marker → completed block + next prompt
```

The command's displayed colors never become part of the submitted text. A command can have rich NMSh presentation while the shell receives ordinary command text.

## 5. The composer

The **composer** is the whole input area: editable text, optional prompt/context, suggestions, and surrounding edges. The editor inside it supports multiline input and owns editing rather than delegating to the shell's line editor.

The composer can be docked at **Bottom**, docked at **Top**, or placed in **Flow** after the newest transcript output. A one-line layout places context alongside input; a two-line layout separates them. Long input still wraps and can contain explicit newlines. Prompt None currently uses the one-line geometry.

Prompt/context describes the shell and project; editable input is the command being composed. Dividers and borders are presentation around those regions. Accessories such as Keep Awake can occupy an available edge, an adjacent row, or trailing input space according to the screen plan. They do not become prompt-provider content or editable text.

Each frame has one geometry plan, produced by `src/app/screenPlan.ts`. Rendering, cursor placement, wrapping, mouse hit testing, viewport height, panel placement, and PTY sizing use this shared plan. That prevents a border or accessory from shifting the cursor while another subsystem still assumes the old coordinates.

## 6. Prompts and providers

The prompt supplies context; NMSh supplies the composer that contains it. Current choices are:

| Choice | Where context comes from |
|---|---|
| NMSh Native | NMSh modules for directory, project, Git, toolchains, and other context |
| None | No prompt/context content |
| Starship | A bounded invocation of the installed Starship executable |
| Powerlevel10k | An isolated zsh helper loading the installed theme and its configuration |
| Oh My Posh | A bounded invocation of the installed Oh My Posh executable |

External renderers receive shell context such as directory and exit status. Their output is parsed into prompt content that NMSh lays out. They do not receive ownership of the live shell's editor. Powerlevel10k's helper deliberately disables ZLE, zsh's interactive line editor, so it cannot compete with NMSh.

These helpers have time/output limits and use pipes rather than attaching their UI to the host terminal. They are still trust boundaries: running an installed prompt program or loading Powerlevel10k configuration can execute that provider's code.

### Native modules and the Context Engine

Native context follows a shared pipeline:

```text
shell prompt / editor demand / refresh / command end
    → Context Engine: trusted core capabilities, scheduled on demand
    → immutable facts → native and declarative (pack) modules
    → Surface Router → Main Prompt / Right Context / Context Rail / Status Strip
    → semantic segment painter → shared screen plan
```

Capabilities own collection and its safety policy: what they read, which allowlisted environment variables they may see (as the live shell reports them each prompt), cost, timeout, cache lifetime and the privacy class of each field. The engine resolves only what visible modules demand, off the typing path, with bounded concurrency, timeouts and backoff, cancellation on directory change, staged scopes and stale-while-revalidate caching. Facts describe values with provenance, freshness, trust and privacy metadata. Modules consume resolved values; rendering and routing do not perform discovery or launch probes. The legacy shell-context snapshot is adapted into the same fact model, so providers, history and Rich Git keep working.

The Main Prompt carries identity and navigation context. Right Context is a separately anchored prompt area. The Context Rail is live native context attached to the composer, vertically or Right of Prompt; its position does not turn it into Right Context. Width fitting preserves the independent right-context anchor and drops Rail content by priority when space is scarce. Rail rows are frontend geometry, not transcript output, and the live Rail is not archived into command history.

**Context Packs are data.** A pack (`nmsh.context-pack/v1`, bounded and strictly parsed) names capabilities core implements and describes modules over them; it cannot carry commands, code, paths, templates or hooks, and gains no authority by being installed. First-party modules (project, runtimes, environment managers, infrastructure, cloud, system, Git extras, Claude Code agent context) ship as bundled packs; `nmsh packs` installs local ones atomically with integrity checks. Recommendations explain local evidence and never install or enable anything. These are on the development line after v0.17.0. See [Context Modules](docs/architecture/context-modules.md) and the [Context Engine design](docs/design/context-engine.md).

**Prompt None can still show a composer marker.** The marker identifies where input starts and belongs to NMSh's editor presentation. Removing context does not remove the editor's own marker or accessories.

## 7. Output and transcript

NMSh separates **program output** from **NMSh-authored presentation**. The output buffer, `OutputBuffer`, holds command records and parsed output lines. A transcript presenter decides how those records appear: command headers, historical context, feedback, folding, and spacing.

Raw output is not blindly printed over the composer. `AnsiOutputParser` interprets a bounded subset of terminal behavior, including colors, carriage returns, backspaces, and hyperlinks, to retain a usable representation. Classification can choose transcript presentation, progress handling, or passthrough. This is not semantic recoloring of arbitrary stdout: the program's text and color choices remain its own.

NMSh-authored submitted command lines can keep semantic highlighting. Folding changes which output rows are visible; it does not rerun commands or turn hidden output into a different result. Search, selection, and copy work from transcript state. `/copy` exports plain text without NMSh's ANSI chrome.

The Status Strip is one frontend row at the top or bottom edge of the NMSh pane, planned by the same screen plan as everything else, with left, center and right groups fitted in display cells. Its clock, CPU, RAM, battery and uptime are Context Engine facts demanded only while the row shows; strip-routed modules are the same facts every surface uses. Painting it reads no files and starts no process. Passthrough hides it and panels own their screen as before.

Historical command blocks retain prompt/context snapshots from submission time. Viewing an old command should not pretend it ran in today's directory or Git state. Frontend chrome such as the Status Strip, find bar, and accessory rows stays outside the transcript.

The viewport follows the newest output during execution (**FOLLOW**). Scrolling into history enters **DETACHED** viewport mode so new output does not pull the view away. This is a viewing state, distinct from detaching a live shell session.

## 8. Sessions

A **live session** is a running shell and PTY. A **saved transcript** is a record of what happened. Those have different lifetimes.

Normally the frontend connects to a per-user local service, starting it on demand. The service owns shells independently of terminal windows, permits one controlling frontend per session, and keeps running when that frontend detaches or disappears.

```text
create → attached ⇄ detached → shell exits / explicit termination
             │          │                    │
             └──── transcript journal ────────┘
                              ↓
                       saved transcript
```

Reattaching a live session reconnects to the same shell: aliases, variables, jobs, and current program remain there. The frontend restores its journal and replays later service events. Restoring an archived transcript through `/resume` replaces this window's presentation, archiving its current view first, while retaining its current live shell. It cannot resurrect the archived shell's environment or jobs.

Retention is bounded. Unacknowledged stream events begin in memory and spill to a JSON-lines spool. Once a frontend has durably journaled events, it acknowledges their sequence numbers. Output beyond spool limits can be dropped, with truncation reported on replay.

If the service cannot be established before session creation is confirmed, NMSh falls back to an in-process shell with a notice. That shell cannot survive frontend exit or be detached and reattached. A service crash or OS restart also does not magically preserve live processes.

Session status combines authenticated shell lifecycle, observed terminal modes, activity emitted by programs, and the PTY's foreground-process name when available. Silence does not prove completion or a need for attention. Unknown facts remain unknown rather than being guessed from an animation or command name.

## 9. ShellAdapter

Shell-specific behavior lives behind a common boundary called `ShellAdapter`. Its three implementations support **zsh**, **Bash 4.4 or newer**, and **Fish**. All launch real persistent interactive shells and report the same lifecycle grammar.

Adapters own executable selection, bootstrap files, environment setup, builtins, history parsing, and completion sources. The composer, transcript, session transport, and panels remain shared. Capabilities describe real differences: Bash completion does not provide Fish-style descriptions, for example.

The zsh adapter uses a private bootstrap directory and disables ZLE. Bash uses a private rcfile and disables Readline editing. Fish retains its editor internally, so NMSh suppresses its prompt-to-command redraw bytes and answers necessary terminal queries. Consequently, Fish messages printed while idle at its prompt can also be suppressed.

The interactive shell loads the user's startup configuration as part of normal shell startup. NMSh does not rewrite those files to establish its UI. Startup output is bounded and sanitized; typed input waits for readiness so it cannot accidentally answer a `read` in a startup file. Bootstrap also suppresses automatic Fastfetch startup.

Command classification uses an isolated zsh helper, `SemanticService`, or live-name snapshots plus PATH classification for Bash/Fish. Completion helpers are separate from the execution PTY. They query trusted shell facilities without executing the partial command as a submission.

Switching backend replaces the shell while keeping NMSh session identity, history, draft, and settings. The current implementation archives the old presentation and starts a fresh view for the new backend. It does not migrate aliases, variables, or jobs. Switching is refused while execution, startup, or known background/stopped jobs make replacement unsafe.

## 10. Slash commands and NMSh actions

`npm test` goes to the real shell. Recognized slash commands such as `/theme`, `/tools`, and `/zoomies` are parsed into **NMSh actions** and dispatched inside the frontend.

These actions open panels, update settings, navigate sessions, or invoke a domain controller. They are not aliases installed in the user's shell. The slash parser returns structured action kinds instead of treating every action as a shell string. Unknown single-line slash input currently reports an unknown NMSh command rather than executing it.

Panels are control surfaces for NMSh state and supported integrations. Where an action changes external files or installs software, its controller builds a specific reviewed operation rather than handing panel text to a shell.

## 11. notMyUI / panel system

**notMyUI** is the shared terminal UI vocabulary used by NMSh panels. It is implemented in this repository, primarily under `src/ui/`, rather than as an independent application framework.

Shared primitives handle panel frames, tabs, grouped lists, selected rows, controls, colors, glyphs, and focus presentation. Domain panels hold their own state and turn keyboard or mouse interaction into actions; the coordinator dispatches those actions and integrates the panel with screen geometry.

Rows identify selectable settings or commands. Focus determines whether navigation operates on a list, tabs, or an editing control. Settings and the command palette reuse these ideas, making different features feel related without forcing every panel into an identical widget implementation.

## 12. Themes and appearance

A **semantic palette** names colors by purpose: primary text, subtle text, success, warning, failure, selection, syntax roles, and so on. Native themes map those roles to actual colors. Renderers can then agree on what a warning means without each choosing a hardcoded color.

**Theme Studio** creates, edits, imports, duplicates, and exports NMSh themes. Imported colors become normal local theme assets with stable IDs and source metadata. They do not require the original application or source file to remain installed. Imports parse supported formats as data rather than executing Lua, templates, shell snippets, or includes.

**Chroma** adds decorative treatments, gradients, and motion to eligible NMSh surfaces. It is a presentation layer, not a replacement for the palette's underlying meaning. It does not enter generated external artifacts.

Glyph modes choose between richer symbols and more portable alternatives. Color capability detection, `NO_COLOR`, and reduced-motion settings degrade presentation without changing command behavior. Cursor presentation, idle visuals, and UI chrome have their own settings around the shared appearance system.

Theme Studio controls NMSh's appearance. **Theme Bridge** is the separate mechanism for extending selected colors to external tools.

## 13. Theme Bridge

Choosing an NMSh theme does not automatically rewrite application configuration. Theme Bridge is an explicit, initially disabled system with known target adapters.

Its global policy can **Follow NMSh**, **Choose theme** to pin a theme, or **Manual** to use each target's saved choice. Per-target choices are Independent, Follow NMSh, and Choose theme. Global policy changes preserve the Manual choices for later restoration.

| Current target | How colors reach it |
|---|---|
| fzf | NMSh-controlled invocation options |
| less / man | Allowlisted session environment values |
| File listing colors | GNU/BSD color variables and controlled listing behavior |
| bat | Generated theme file, reviewed cache setup, and theme environment selection |
| tmux | Generated managed configuration/colors and reviewed activation |
| Neovim / Vim | Generated colorschemes and reviewed activation hooks |
| Helix | Generated theme in its themes directory and reviewed selection |
| delta | Never managed (NMSh does not change git config); its syntax highlighting follows bat's theme through `BAT_THEME` unless git config pins it |

Environment changes reach a persistent shell through one **environment sink**: generated files for zsh, Bash, and Fish, applied by the adapter's prompt hook. Their grammar permits allowlisted variables and quoted literals. Values take effect at the next prompt. Clearing a value restores what NMSh replaced only while the shell still contains NMSh's value.

Generated files and inserted activation lines are recorded in an **ownership ledger**. Content hashes prove whether a file still matches what NMSh wrote. A user-edited or unrecognized artifact causes a conflict instead of being overwritten. Activation in executable configuration is an exact reviewed edit, not a generic merge of shell, Lua, or Vimscript. bat and Helix need artifacts in their own theme directories; many other artifacts live under NMSh's Theme Bridge directory.

## 14. Tools, providers and integrations

These terms describe different relationships:

| Term | Meaning in NMSh |
|---|---|
| Tool | A curated external utility or detected shell-environment component |
| Provider | A selected implementation of a frontend role, such as prompt, history, picker, suggestions, or navigation |
| Integration | A supported connection to an external system, including health and ownership information |
| Configurable tool | A tool with a reviewed configuration adapter; detection alone is insufficient |
| Shell framework | Shell code/plugins loaded by startup configuration, such as Oh My Zsh or Prezto |
| Package-manager infrastructure | Software such as Homebrew that installs and manages other packages |

`src/tools/catalog.ts` is the central curated tool registry. It records detection, categories, installation recipes, and relevant capabilities. Frameworks can be detected from filesystem evidence even when they have no executable on PATH. Detection grants no automatic installation or write authority.

The provider-family registry connects role choices to persisted settings. The tool-configuration registry separately determines what `/configure` may manage. `/integrations` presents integration readiness and repair/setup actions, including Theme Bridge health.

Homebrew is package-manager infrastructure: NMSh uses it for known install recipes and package facts. It is not simply another interchangeable prompt or utility provider. Special installers and framework setup have explicit flows and boundaries rather than being treated as ordinary package names.

## 15. Dotfiles

The dotfiles surface discovers recognized configuration in a local directory or checkout, including plain, Git, GNU Stow-style, and chezmoi layouts. An explicit remote flow can obtain a checkout before scanning. Repository content remains untrusted data.

Discovery is bounded by entry count, depth, and file size. Recognition uses the tool-configuration registry. Symlinks are shown without being followed; scripts and templates are identified without being run or rendered.

The review plan distinguishes supported field imports, exact copies, and inspect-only files. tmux imports supported options and bindings into NMSh's own model. Exact copying requires a registry-specific validator: being valid TOML or JSON alone is insufficient. Executable configurations remain inspect-only in this workflow.

Changes are reviewed before application. Copy plans check whether the destination changed since review and back up existing content. NMSh does not execute repository installers, hooks, Make targets, Stow operations, chezmoi scripts, or arbitrary configuration code to discover what a repository means.

## 16. Keep Awake

`/caffeinate`, `/awake`, and `/zoomies` are three names for one NMSh-owned feature. A controller creates an OS power assertion in a detached background process, independently of the shell PTY.

Backends use Apple's fixed-path `caffeinate` on macOS, `systemd-inhibit` around an NMSh wait helper on supported Linux systems, and an execution-state helper on Windows when its prerequisite is available. Capabilities differ: the Linux backend does not claim display inhibition. This backend's Windows code does not imply native Windows shell/frontend support.

NMSh records the PID, launch arguments, ownership token where applicable, mode, and timing. Before stopping an assertion it verifies that the live process matches its owned record, rather than killing any process named `caffeinate` or trusting a reused PID. Stop sends termination to that verified process and only escalates while ownership still matches.

The assertion can outlive an NMSh window. Duration and explicit stop control its lifetime. Presentation can use a composer accessory, Status Strip, idle reminder, or screensaver state; those are views of the controller's state, not text sent to the shell.

## 17. Host / terminal integration

Terminal integration uses optional escape-sequence protocols. **OSC** means Operating System Command, a terminal protocol family; these messages are not shell commands.

- **OSC 7** tells a host the current directory, helping it open new tabs or panes in the right place.
- **OSC 8** attaches hyperlink targets to displayed text.
- **OSC 133** marks prompt, input, command-start, and command-end zones for cooperating terminals or multiplexers.
- **Private OSC 777 NMSh messages** carry shell readiness and execution events with a per-session token. NMSh validates that token before treating output as lifecycle evidence.

- **OSC 0/2** sets the window title (opt-in: Off, Project, Project and session) only while NMSh owns the screen; programs own the title while they run.

Public host markers are derived from NMSh's authenticated lifecycle. NMSh does not depend on receiving them back. It writes command start (`C`) at once, holds prompt-time markers while a fullscreen program owns the screen, re-reports the directory after one did, and replays no history on reattach.

Capability detection combines passive host profiles and active probes. Ghostty, Kitty, WezTerm, iTerm2, and Windows Terminal have specific hints; Terminal.app receives conservative baseline behavior plus directory signaling. Windows Terminal detection can describe a WSL host without implying native Windows execution support.

Keyboard, mouse, synchronized drawing, hyperlinks, colors, and graphics degrade independently. Direct preference/keyboard configuration integration is currently Ghostty-specific. tmux and other multiplexers hide outer-host hints, so NMSh does not assume that an outer terminal's graphics or keyboard features work unchanged inside a pane.

## 18. tmux

tmux is an independent multiplexer that owns sessions, windows, panes, borders, and its status line. NMSh can run inside a pane, or a shell command can launch tmux through passthrough.

Theme Bridge supplies colors. **Config Studio**, opened through `/tmux`, manages supported options, keys, a status layout, and an optional pane frontend. NMSh stores a typed model and generates one managed configuration file that combines its settings and applicable Bridge colors. The user's config includes that file through a reviewed activation step.

The optional **NMSh pane frontend** changes tmux's `default-command` for new panes/windows without an explicit command. It does not change `default-shell`, which still identifies the shell tmux uses to launch commands. Existing panes retain their current processes. The generated launcher guards against recursively starting NMSh inside NMSh's managed shell.

The prompt inside a pane belongs to the program running there; tmux's status appearance is a different owner. Config Studio imports only supported literal settings and bindings, leaving dynamic commands and unsupported configuration outside its model.

## 19. Ask

`/btw` opens **Ask NMSh**; `/ask` remains a compatibility alias for the same feature. Ask resolves plain-English requests into NMSh's existing capabilities. Its first path is deterministic: intents, command knowledge, project facts, and supported actions work without a model.

Results are typed answers, proposals, choices, unsupported requests, or refusals. Actions identify specific operations such as opening a panel, attaching a session, changing a setting, running a fixed command, or applying a verified edit plan. Existing controllers perform those operations.

Optional **local understanding** can help interpret requests when enabled. Auto uses a model when deterministic interpretation is unclear or ambiguous; Always prefers model assistance while still using deterministic action builders. A separate local model service manages runtime work. Model assistance chooses from a bounded capability inventory and produces validated structured interpretations. NMSh then resolves those interpretations against known facts and its deterministic policies; a failed model leaves the deterministic result available.

Model text is not directly executed as a shell command or filesystem operation. Configuration, mutation, and installation require confirmation of the exact action in Ask; destructive suggestions are Copy/Insert only. Copying or inserting a suggested command does not execute it. File plans and supported configuration still use their normal path, hash, and ownership checks.

## 20. Configuration and persistence

Let `<NMSh config>` mean the directory selected by the shared path resolver:

- An absolute `$XDG_CONFIG_HOME/nmsh` when `XDG_CONFIG_HOME` is set.
- Otherwise `~/Library/Application Support/notMyShell` on macOS.
- Otherwise `~/.config/nmsh`.

| State | Location / owner |
|---|---|
| Settings, provider choices, theme assets, Bridge policy | `<NMSh config>/config.json` |
| Saved transcripts and summary metadata | `<NMSh config>/sessions/` |
| Bridge environment files and ownership ledger | `<NMSh config>/theme-bridge/` |
| Most generated Bridge artifacts | Subdirectories of `theme-bridge/`; bat/Helix themes use their tool directories |
| tmux's typed configuration model | `<NMSh config>/tools/tmux.json` |
| Keep Awake process record | `<NMSh config>/keep-awake.json` |
| Live service sockets and stream spools | Private runtime directory, separate from configuration |

On Linux, a verified private `$XDG_RUNTIME_DIR/nmsh` is preferred for live runtime data. Otherwise NMSh uses a private per-user temporary directory; `NMSH_RUNTIME_DIR` can override it. Socket names distinguish protocol versions. Live shell environment stays in memory, not in the transcript store as a recoverable shell image.

Configuration loading normalizes data, supplies defaults, and migrates older shapes. Theme-library normalization maintains stable references and a compatibility mirror of the active custom theme. Saving settings uses staged replacement and preserves unrelated fields; unreadable or malformed existing settings are refused for saving rather than silently overwritten.

## 21. Security boundaries

The central distinction is between **data NMSh can validate** and **code an external system executes**. Normal interactive shell startup and explicitly selected providers execute trusted user-installed code. Import and discovery workflows do not receive that same authority.

Entering a repository must never itself execute arbitrary repository-controlled code through NMSh context discovery. Context metadata is read as bounded data; executables found on PATH are never run for context (versions come from install layouts), and only fixed system tools and trusted Git are spawned. Context Packs are declarative and grant no authority. Normal user-configured shell startup and explicitly chosen external providers remain separate trust boundaries.

Theme imports use bounded parsers without templates, includes, or code execution. Arbitrary configuration is not generically rewritten. Supported installs and helper operations use fixed executables and structured argument arrays rather than interpolating requests into shell strings. Helpers have time/output bounds appropriate to their role.

Generated-file hashes and ownership records protect external artifacts; process verification protects stop/kill operations. A discovered file, tool, or PID is not proof that NMSh owns it. Raw PTY output retains program formatting through a controlled presentation path, and unauthenticated output cannot complete an NMSh command by impersonating its private protocol.

These boundaries do not make arbitrary shell commands or providers harmless. They constrain NMSh's own authority. See [SECURITY.md](SECURITY.md) for the security policy and detailed trust boundaries.

## 22. Repository map

| If you want to understand… | Start here |
|---|---|
| Startup and frontend orchestration | `src/index.ts`, `src/app/` |
| Screen layout and terminal drawing | `src/app/screenPlan.ts`, `src/terminal/` |
| Editing, highlighting, suggestions | `src/input/`, `src/suggestions/` |
| PTY, adapters, shell knowledge and completion | `src/shell/` |
| Live service, sockets, replay and attachment | `src/session/` |
| Saved transcripts and resume UI | `src/sessions/` |
| Output parsing, folding, selection and presentation | `src/output/` |
| Context Engine, capabilities, facts, packs and surface routing | `src/context/` (`engine.ts`, `capabilities/`, `packs/`), `src/prompt/configuration.ts`, `src/prompt/ModulesPanel.ts`, `src/prompt/railLayout.ts` |
| Native/external prompts and shared settings | `src/prompt/`, `src/configuration/` |
| Panels and shared UI primitives | `src/ui/` plus feature-specific panel modules |
| Theme Studio, palettes and decoration | `src/appearance/`, `src/chroma/`, `src/motion/`, `src/cursor/`, `src/idle/` |
| External colors and ownership | `src/themeBridge/` |
| Curated tools, configuration and packages | `src/tools/`, `src/providers/`, `src/packages/` |
| Dotfiles and Keep Awake | `src/dotfiles/`, `src/keepAwake/` |
| Slash actions, Ask and optional local models | `src/commands/`, `src/ask/`, `src/understanding/` |
| Host capabilities and passthrough policy | `src/host/`, `src/presentation/`, `src/passthrough/` |
| Agent-session integration, the Claude Code status-line bridge and managed tasks | `src/agents/`, `src/cli/agentStatus.ts`, `src/tasks/` |
| Automated behavior evidence | `tests/`, verification scripts in `scripts/` |

## 23. A few end-to-end examples

### Running `git status`

`editor text → semantic command presentation → submission block → session client → real shell → Git → PTY output → parsed transcript → readiness/status marker → completed block and refreshed context`

Git chooses its output; NMSh supplies the surrounding command history and feedback.

### Opening `/theme`

`slash parser → Theme Studio state → shared panel primitives + screen plan → edit/select local theme → normalized settings save → NMSh surfaces repaint`

An enabled Follow NMSh Bridge policy can then synchronize supported external targets through their own adapters.

### Starting `/zoomies display`

`slash parser → Keep Awake controller → backend capability check → fixed OS launch → ownership record → accessory/status presentation`

On macOS this creates a display assertion outside the shell. A backend without display support reports that limitation instead of pretending it worked.

### Detaching and resuming a session

`/detach → journal checkpoint → frontend disconnect → service retains shell + output events → nmsh --attach <session-id> → same shell attachment → journal restore + event replay → composer or active-program passthrough`

`/resume` also offers saved transcripts. Selecting an archive restores its presentation into the current window without restoring its old shell, as described in section 8.

### Applying a Theme Bridge target

`enable Bridge + choose Neovim Follow NMSh → resolve semantic palette → validate generated colorscheme → check artifact ownership → write artifact + ledger → review activation diff → apply verified hook`

Later theme changes can regenerate the unchanged owned artifact. User modifications cause a conflict. The editor must load/reload the colorscheme for its display to change.

## 24. Deeper reading

These documents expand particular areas. Older design and research records explain decisions at their time; current code remains authoritative.

- [Shell adapters](docs/architecture/shell-adapter.md): backend contracts, differences, switching, and ordinary-shell handoff.
- [Terminal stack](docs/architecture/terminal-stack.md): layer terminology; its zsh-only and bottom-editor wording predates the current adapters/layouts.
- [Terminal hosts](docs/architecture/terminal-host.md) and [multiplexer interoperability](docs/architecture/multiplexer-interop.md): capability boundaries and nested-terminal behavior.
- [notMyUI](docs/architecture/notmyui.md) and [TUI primitives](docs/architecture/tui-primitives-v012.md): common controls, surfaces, and focus.
- [Context Modules](docs/architecture/context-modules.md): capabilities, facts, modules, surfaces, Context Packs and agent context; [Context Engine design](docs/design/context-engine.md): scheduler, invariants and test gates.
- [Prompt customization](docs/architecture/prompt-customization.md): Native context, shape, and appearance choices.
- [Supported tool configuration](docs/architecture/supported-tool-configuration.md): configuration classes, adapters, and ownership.
- [Theme Bridge design](docs/design/theme-bridge.md): imports, target behavior, environment sink, and generated-file safety.
- [Chroma and UI chrome](docs/design/chroma-and-ui-chrome.md): how decoration and semantic presentation fit together.
- [Structured execution](docs/design/structured-execution.md) and [session interaction](docs/design/session-interaction-ux.md): command blocks and viewport interaction decisions.
- [Session journal](docs/design/session-journal-v0.4.md) and [sessions, agents, and intelligence](docs/design/v016-sessions-agents-intelligence.md): persistence and later session capabilities.
- [Shell UX and Ask](docs/design/v016-shell-ux-ask.md): typed assistance and shell interaction policies.
- [Accessibility baseline](docs/accessibility/baseline.md): color, motion, glyph, keyboard, and host considerations.
- [SECURITY.md](SECURITY.md): trust model and reporting policy.
- [CONTRIBUTING.md](CONTRIBUTING.md): development setup, validation, and contribution workflow.
