# External TUI tools: Git and container clients (proposal, 2026-10-16)

**Status: proposal for post-v0.20 work. Nothing here is implemented.** Its own feature branch and PR, after the
v0.19/v0.20 stabilization gates. It implements Direction B of
[`workspace-ui-decision.md`](https://github.com/raiseCatError/notMyShell/blob/docs/release-train-v019-v020/docs/development/workspace-ui-decision.md):
delegate Git and container dashboards to mature tools instead of growing a native manager.

Tools: **Lazygit**, **GitUI**, **Serie**, **GitOUI** (a Serie fork with staging, rebase, conflicts and GitHub; a
separate integration, never an alias) and **Lazydocker**. All five stay optional; NMSh is complete with none installed.

## What already exists (reused, not rebuilt)

| Piece | Where | Used for |
|---|---|---|
| Curated catalogue, tiers, detection, reviewed install recipes | `src/tools/catalog.ts`, `src/providers/providers.ts` | registration; Lazygit is already `tool('lazygit', …, 'Git & Development', ENHANCED)` |
| `/tools` browser with previewed, confirmed installs | `ToolsPanel` | install; nothing installs without its own preview and Yes |
| Persistent shell + native alternate-screen passthrough | `PassthroughPolicy`, `TerminalModes` | the tools run as ordinary commands in the real shell; NMSh restores composer, focus and PTY size when they leave the alternate screen |
| Slash routing (an absolute executable path runs in the shell) | `slashCommands.ts` | `/git` and `/containers` are free names (checked: no `/git`, `/diff`, `/docker` today) |
| Theme Bridge: master switch, Independent / Follow NMSh / Choose theme, ledger, staged generation, environment sink, reviewed includes | `src/themeBridge/*`, `docs/design/theme-bridge.md` | colors (below) |

## Commands

- **`/git`** with no argument: one compact chooser of the *installed* Git clients (Lazygit, GitUI, Serie, GitOUI),
  the preferred one first, `Enter` launches, `d` makes the highlighted one the default (a setting,
  `externalTools.git.default`, default **Lazygit** when installed — the conservative choice, never chosen because a
  newer tool has more features). None installed: a factual line (`git status --short --branch` stays one shell
  command away) and a `/tools` link; nothing is offered for install from `/git` itself.
- **`/git lazygit|gitui|serie|gitoui`**: that client directly. An unknown or missing one says so, with its `/tools`
  entry.
- **`/containers`** (Lazydocker): a clear name that never shadows `docker` or `docker compose` in the shell.
- **`/diff`: not proposed.** `git diff` (with delta/bat via Theme Bridge), `/compare`, `/github` and the clients
  above already cover it; a shortcut would add a fifth path to the same thing.

**Launch = one command line in the persistent shell**, exactly as if typed: `lazygit` (plus the Theme Bridge
arguments/environment below, prefixed for that one command only). It runs in the current directory, worktree and
environment, sees the user's own config, and the existing passthrough gives it the whole screen and the real PTY
size; resizes go straight through. When it exits (normally, by Ctrl+C or by failing to start) the shell prompt
returns and NMSh draws its composer as after any full-screen program; a non-zero exit is an ordinary failed block.
Nothing new owns processes: the tool is a child of the shell, so job control, Ctrl+Z and session detach behave as for
`vim`. NMSh never authenticates to GitHub, reads tokens, changes Docker configuration or installs anything here.

## Catalogue entries

| Tool | Executable | Category | Install recipes offered (each previewed and confirmed in `/tools`) | Source |
|---|---|---|---|---|
| Lazygit | `lazygit` | Git & Development (existing entry) | Homebrew `lazygit`; distro packages where present | github.com/jesseduffield/lazygit |
| GitUI | `gitui` | Git & Development | Homebrew `gitui`; `cargo install gitui --locked` | github.com/gitui-org/gitui |
| Serie | `serie` | Git & Development | Homebrew `serie`; `cargo install --locked serie` | github.com/lusingander/serie |
| GitOUI | `gitoui` | Git & Development | Homebrew `nayji7/tap/gitoui` (third-party tap, labelled so); `cargo install gitoui`. Its `curl … \| sh` installer is **not** offered (NMSh never pipes a remote script to a shell) | github.com/NayJi7/gitoui (MIT, v0.3.6 at the time of writing) |
| Lazydocker | `lazydocker` | Containers / Infrastructure | Homebrew `lazydocker` | github.com/jesseduffield/lazydocker |

Install recipes and versions are curated data, re-checked during release work; nothing is fetched at run time.

## Images (Serie, GitOUI)

Serie draws its graph with the iTerm2 or Kitty graphics protocols (`--protocol auto|iterm|kitty|kitty-unicode`; in
tmux only `kitty-unicode`); GitOUI adds Sixel and falls back to a Unicode box-drawing graph (`graph_renderer = ascii`
or its own detection). NMSh does not decide from `TERM`: it passes the protocol only when its own host profile
(`src/host/capabilities.ts`, the same evidence that gates NMSh's own images) says the host renders it, and otherwise
leaves the tool's own detection alone, with one exception: inside tmux, where Serie supports only the Unicode
placeholder variant, NMSh passes `--protocol kitty-unicode` only when the outer host is Kitty-protocol capable and tmux
passes it through, and otherwise tells the person that the graph needs a supporting terminal (GitOUI: `ascii` keeps a
useful graph). Physical checks in Ghostty, Terminal.app and tmux are part of the PR's QA list; Terminal.app has no
image protocol, so the expected result there is GitOUI's Unicode graph and Serie's own message.

## Theme Bridge: five new targets

Each target uses the existing per-target modes (Independent / Follow NMSh / Choose theme), the master switch (Off by
default), the one semantic palette resolver, the ledger (owned paths, sha256, adapter version) and staged
generation. Chroma never reaches them (stable palettes only). NO_COLOR or no color capability injects nothing; on
16-color hosts roles map to the theme's nearest ANSI slots, as the existing targets do. Light themes use the
palette's own light roles; each generated selection pair is checked for contrast (≥ 4.5:1 text on selection), and the
foreground is swapped to the palette's dark/light text when the accent background would fail.

Upstream facts below were read from each project's documentation and source on 2026-10-16.

| Target | Upstream mechanism (verified) | NMSh mechanism | Writes in the user's config? |
|---|---|---|---|
| **Lazygit** | `LG_CONFIG_FILE` / `--use-config-file` take a comma-separated list; files are loaded in order onto the defaults, a later file overrides an earlier one (`loadUserConfig` loops the list); `gui.theme` keys: `activeBorderColor`, `inactiveBorderColor`, `searchingActiveBorderColor`, `optionsTextColor`, `selectedLineBgColor`, `inactiveViewSelectedLineBgColor`, `selectedLineFgColor`, `cherryPicked*`, `markedBaseCommit*`, `unstagedChangesColor`, `defaultFgColor`, `authorColors`, `branchColorPatterns`; hex accepted | a generated `theme-bridge/lazygit-theme.yml` (only `gui.theme`) appended **after** the user's own config on that one launch: `LG_CONFIG_FILE=<user's existing config path(s)>,<generated>` (the user's file only if it exists, honouring an `LG_CONFIG_FILE` they already set and `CONFIG_DIR`/`XDG_CONFIG_HOME`). Keybindings, custom commands and repo `.git/lazygit.yml` keep working | **No** |
| **GitUI** | `-t <file>`: GitUI joins it onto its config dir (`confpath.join(arg)`), so an absolute path is used as is; theme files are partial patches over defaults; roles: `selected_tab`, `command_fg`, `selection_bg/fg`, `use_selection_fg`, `cmdbar_bg`, `disabled_fg`, `diff_line_add/delete`, `diff_file_added/removed/moved/modified`, `commit_hash/time/author`, `danger_fg`, `push_gauge_bg/fg`, `tag_fg`, `branch_fg`, `block_title_focused`, `syntax`, `line_break` | a generated RON patch `theme-bridge/gitui-theme.ron`, launched with `gitui -t <absolute path>`. A user's own `-t` in their alias wins (NMSh adds it only when the command line has none) | **No** |
| **Serie** | config at `$XDG_CONFIG_HOME/serie/config.toml`; `SERIE_CONFIG_FILE` replaces it (a missing file is an error); `[color]` (≈40 UI roles, names/256/hex) and `[graph.color]` (`branches` array, `edge`, `background`, hex) are separate | at launch, NMSh reads the user's config as bounded TOML data (if any), replaces only `[color]` and `[graph.color]`, writes the result to an NMSh-owned `theme-bridge/serie-config.toml` and sets `SERIE_CONFIG_FILE` for that one launch; the user's file is never edited and every other setting (protocol, graph style, keybindings) is preserved. Graph branches get 6–8 palette hues chosen for mutual distance, never the selection color | **No** |
| **GitOUI** | config `$XDG_CONFIG_HOME/gitoui/config.toml`, override `GITOUI_CONFIG_FILE`; custom themes are `themes/<name>.toml` with `base = "…"` inheritance and ~45 tokens, selected by `[core.option] theme = "<stem>"`; `[graph.color]` separate | a generated theme `nmsh-bridge.toml` (`base` from the closest dark/light built-in, then NMSh's roles) in `~/.config/gitoui/themes/` — an NMSh-owned, ledger-tracked file; a same-named file NMSh did not write is never touched. Selection at launch, like Serie: the user's config read as data, `core.option.theme` set to `nmsh-bridge`, written to an NMSh-owned file and passed with `GITOUI_CONFIG_FILE` for that launch. Its own built-in themes and settings stay as they are | one owned file in its `themes/` directory (reviewed once, like Helix's theme) |
| **Lazydocker** | config only in `<dir>/config.yml`; `CONFIG_DIR` swaps the **whole** directory; no file flag, no merge of several files; `gui.theme`: `activeBorderColor`, `inactiveBorderColor`, `selectedLineBgColor`, `optionsTextColor` only; colors are named attributes (hex not documented) | **no launch-time override exists that does not take over its config directory**, which NMSh will not do. Offered only through the reviewed managed-configuration workflow: one exact `gui.theme` block shown as a diff and inserted into the user's `config.yml` on Yes (refused when the file already sets `gui.theme`; removal removes exactly that block). Roles reported as **not representable**: text, muted text, success/failure/warning, Git and container states, hex colors (nearest ANSI names are used) | only after a reviewed diff |

Changing the NMSh theme regenerates owned files where they are unchanged (hash match); running instances keep their
colors until relaunched. A tool's launcher (`/git …`, `/containers`) applies its target's policy itself: Follow NMSh
needs no second theme setting inside the tool.

### `/theme-bridge` additions

Two groups, **Git & Development** (Lazygit, GitUI, Serie, GitOUI) and **Containers** (Lazydocker). Each row: installed
or missing · Independent / Follow / the chosen theme · Applied (launch-time) / Pending (needs a reviewed edit) /
Unsupported · and, when present, the conflict (the user's config already selects a theme, an unowned file in the way)
or the unrepresentable roles.

## Smallest meaningful implementation (order of PR commits)

1. Catalogue: GitUI, Serie, GitOUI, Lazydocker entries (Lazygit's is reused), with recipes and detection; tests for
   detection, recipes and categories.
2. `/git` chooser + default setting, `/git <client>`, `/containers`; launch through the shell; tests: missing
   executable, failed start, exit restores composer/focus/PTY size, resize during the tool, Ctrl+C, Ctrl+Z, subprocess
   cleanup, key ownership (no key reaches the composer while the tool owns the screen).
3. Theme Bridge Lazygit and GitUI (launch-time only, no user files): mapping, contrast, NO_COLOR, 16-color, light
   themes; generated-file validation; ledger.
4. Serie and GitOUI (config read as data, owned files, image-protocol policy).
5. Lazydocker through the reviewed managed-config workflow, with its unsupported roles stated.
6. Physical QA list: each tool in Ghostty, Terminal.app and tmux (rendering checked, not only generated files).

Each step is independently reviewable; 1–3 alone already integrate the conservative default.
