# Native theme library, imports and Theme Bridge

Tracker: [#304](https://github.com/raiseCatError/notMyShell/issues/304). Module and ecosystem work stays in [#305](https://github.com/raiseCatError/notMyShell/issues/305).

## One Native theme model

```
external theme file → bounded data parser → palette facts → semantic role mapping → NMSh Native theme asset → the existing renderer
```

There is one renderer and one theme format (NMSh Theme JSON). *Imported* is provenance, not a second engine: an imported theme is an ordinary Native theme plus a record of where it came from. It keeps working with the source app uninstalled, the file moved, the machine offline or the upstream gone. Nothing watches or re-syncs source files.

### Library

`themes` in the configuration holds every user-owned theme asset:

| Field | Meaning |
| --- | --- |
| `id` | stable identity (`t-` + 12 hex). Names are display only. |
| `theme` | NMSh Theme JSON (prompt roles, UI roles, `dark`, optional `terminal` palette from terminal schemes) |
| `origin` | present only for imports: `kind`, source name, local `sourcePath`, importer version, time. Its presence makes the category **Imported**. |
| `modified` | an imported theme edited in NMSh (the source file is never touched) |

`nmsh.themeId` names the asset the `custom` palette uses. **Canonical state is `themes` + `nmsh.themeId`.** `customTheme` is a deterministic mirror of that asset, rewritten by normalization on every load and save so existing renderers and older NMSh versions keep reading one theme; a stored `customTheme` is read only to migrate a configuration that has no library yet.

Migration: a valid legacy `customTheme` becomes one Custom asset with id `legacy-custom`, still active when it was active. Malformed data falls back to Lavender Native. The library holds at most 64 themes; malformed entries are dropped individually.

Deleting never leaves a dangling reference: the active theme cannot be deleted (choose another first), and a theme pinned by Theme Bridge targets is deleted only after explicit confirmation that those targets become Independent (never another theme).

Theme references are stable strings: `builtin:<palette>`, `builtin:<palette>@<accent>` (Catppuccin) or `asset:<id>`. One pure resolver turns any reference into an immutable semantic palette (`src/appearance/semanticPalette.ts`); a missing asset is reported, never replaced.

### Theme Studio (`/theme`)

Built-in | Imported | Custom | Import, on the shared tab strip. Built-ins are immutable (Set active, Duplicate to Custom, edit a copy). Imported and Custom themes share one editor and the same real Native preview (project, path, Git, Node/Go/Python/Docker, Kubernetes, success/failure, UI text tiers and roles, a syntax sample). Export writes NMSh Theme JSON to the NMSh config `themes/` directory; library provenance (and so any local path) is not part of the exported theme, and settings transfers drop `sourcePath`.

Selection is available without the studio: Settings → Theme and `/setup appearance` list Built-in families, Imported and Custom themes.

## Import formats and safety

Every import is bounded (256 KiB) local data parsing. No network, remote schemas or inheritance, shell sourcing, subprocesses, Lua, zsh themes or template execution. Names are sanitized; every generated role is validated as an NMSh theme. The preview shows the format, name, dark/light interpretation, role swatches, the role mapping and every lossy or ignored concept; Esc stores nothing.

| Format | Read | Not imported (reported) |
| --- | --- | --- |
| NMSh Theme JSON | everything, validated | – |
| Base16 | base00–base0F (YAML or JSON) | – |
| Base24 | all 24 slots required; ANSI per the Base24 styling spec 0.1.3 | base06, base09, base0F, base10, base11 have no NMSh role |
| Windows Terminal | scheme colors, selection, cursor | – |
| Oh My Posh (JSON, YAML, TOML) | literal hex colors, static `palette` references (`p:name`), segment types as role hints | templates and `*_templates`, conditional `palettes`, named terminal colors, `extends`/remote config, every segment's logic. Roles without a static source keep the base theme's colors. |
| Kitty | `foreground`, `background`, `selection_*`, `cursor`, `color0`–`color15` | `include`/`globinclude`/`envinclude` (never followed), every other directive |
| Ghostty | allowlist: `palette = N=#hex` (0–15), background/foreground, selection colors, cursor color | `config-file` (never followed) and every other option |
| iTerm2 `.itermcolors` | Ansi 0–15, background, foreground, selection, selected text, cursor | DOCTYPE internal subsets and ENTITY declarations are rejected; other color keys are listed as unrepresented |
| WezTerm | declarative TOML `[colors]` (ansi, brights, foreground, background, selection, cursor) and `[metadata] name` | Lua (`.wezterm.lua`) is refused with guidance to export TOML |

Terminal schemes map through one documented ANSI → role table (project ← magenta, path ← bright black, Git ← blue, Node ← green, Go ← cyan, Python ← yellow, Docker ← bright blue, Kubernetes ← bright magenta, success ← green, failure ← red, accent ← magenta, warning/info ← yellow/cyan), and keep the real background, foreground and 16 colors in the theme's `terminal` palette for Theme Bridge. Parsers: `yaml` (ISC), `smol-toml` (BSD-3-Clause), `fast-xml-parser` (MIT), all data-only.

Oh My Zsh `.zsh-theme` files are executable shell code; they are never imported or evaluated.

## Theme Bridge (`/theme-bridge`)

A master switch (Setup: “Extend colors to tools?”, default No) and one setting per target:

- **Independent** – NMSh injects and changes nothing for that target.
- **Follow NMSh** – the active Native theme; future supported launches/environments follow theme changes.
- **Choose theme** – a pinned stable reference to any Built-in, Imported or Custom theme; the main theme never changes it.

All targets consume the one resolved semantic palette; each target only maps semantic roles onto its documented roles. Chroma is a live presentation treatment and never reaches generated files. NO_COLOR (non-empty) or no color capability injects nothing.

| Target | Mechanism | Writes |
| --- | --- | --- |
| fzf | `--color` for fzf launched by NMSh only (version-gated color names, 256/16-color fallback); precedence: Theme Bridge colors first, the launching surface's explicit options last (they win). NMSh-owned launches never read `FZF_DEFAULT_OPTS`. | nothing |
| less / man | `LESS_TERMCAP_md/mb/me/us/ue/so/se` and `GROFF_NO_SGR` through the shell environment sink. `LESS`, `PAGER` and `MANPAGER` are never set. BSD/macOS mandoc already emits the overstrike these recolor; GNU groff needs `GROFF_NO_SGR`. NMSh sets `PAGER=cat` for its own transcript, so plain `man` output inside NMSh is paged only when your `MANPAGER` selects less. | env file |
| LS_COLORS | `vivid generate <NMSh theme file>` when vivid is installed (local, bounded, output validated), otherwise a deliberately small mapping (file kinds plus a few broad extension groups). Replaces LS_COLORS in NMSh shells while active; Independent restores the previous value. | env file, vivid theme file |
| tmux | NMSh-generated fragment of style/colour options only (status, window status, pane borders, messages, modes, menus, popups, clock, display-panes, copy-mode); no keys, layout, plugins, commands or behavior; `set -gq` so older tmux skips unknown options. Optional typed reload `tmux source-file <fragment>` on request. New servers need one include line (below). Theme plugins or explicit styles in your tmux.conf are reported as conflicts, not fought. | fragment; include after confirmation |
| Neovim | generated Lua colorscheme `nmsh-bridge` (classic groups, floats, separators, diff, diagnostics with underline/sign/virtual text, common Tree-sitter captures linked onto base groups); data only. | colorscheme; include after confirmation |
| Vim | separate Vim colorscheme with classic groups only, truecolor plus 256-color `cterm` fallback, `background` from the theme. | colorscheme; include after confirmation |
| bat, delta | detected only. bat applies custom themes only from its own theme cache (`bat cache --build`); delta takes syntax themes from that cache and diff styles from git config. NMSh does not modify either, and does not fake fidelity with an unrelated built-in theme. | nothing |

Already-running editors and shells outside NMSh are not recolored live; Follow NMSh applies to new instances (and NMSh shells at their next prompt).

### Shell environment sink

NMSh writes one generated, validated file per shell syntax (`theme-bridge/environment.{zsh,bash,fish}` in the NMSh config directory): a generation guard plus `nmsh_bridge_apply NAME <quoted literal>` / `nmsh_bridge_clear NAME` lines for an allowlist of variables, with exact zsh/Bash ANSI-C and Fish quoting. Each ShellAdapter's own bootstrap (static NMSh code in its private per-session directory, never the user's rc files) applies it from the prompt hook when it is a regular file owned by the user. `apply` remembers the value it replaced; `clear` restores it only if the variable still holds NMSh's value, so Independent removes exactly what NMSh set. Nothing reaches history or the transcript. New shells apply it at their first prompt; running NMSh shells at their next prompt.

### Ownership ledger and staged generation

`theme-bridge/ledger.json` records each managed artifact (target, the fixed NMSh path, mode, theme reference, format, sha256, adapter version) and the exact include lines NMSh inserted. Generation is resolve → render → stage → validate → atomic rename. A file is replaced or removed only when its content still matches the recorded hash; an edited or unrecorded file is reported and left alone. A ledger cannot point NMSh at any other path. One target's failure never affects the others or the active NMSh theme.

### Includes

For new tmux/Neovim/Vim instances NMSh offers one exact include, shown as a diff with the exact target path and applied with the verified config-edit planner (refuses if the file changed since it was shown). Removal removes exactly those lines (and refuses to guess if they appear more than once).

| Target | File (existing one preferred) | Lines |
| --- | --- | --- |
| tmux | `~/.tmux.conf` or `$XDG_CONFIG_HOME/tmux/tmux.conf` | `# NMSh Theme Bridge …` and `source-file -q '<fragment>'` |
| Neovim | `init.lua` (or `init.vim` when only that exists) | `pcall(function() vim.opt.runtimepath:append('<dir>'); vim.cmd.colorscheme('nmsh-bridge') end)` |
| Vim | `~/.vimrc` or `~/.vim/vimrc` | `silent! execute 'set runtimepath+=' . fnameescape('<dir>') \| silent! colorscheme nmsh-bridge` |

Every include tolerates a missing file, so an Independent target with an include left in place does nothing.

## Host semantics

- **OSC 7**: `file://host/path` (percent-encoded) when the shell reports a new directory.
- **OSC 133**: projected from NMSh's authenticated OSC 777 lifecycle: ready → `D;status` (if a command ran) then `A`, `B`; exec → `C`; a shell that ends mid-command closes its zone with `D` and no invented status. Nothing is written while a fullscreen program owns the terminal; anything due is written when NMSh owns the screen again.
- Sent on Ghostty, Kitty, WezTerm, iTerm2, Windows Terminal and inside tmux; OSC 7 only on Terminal.app; nothing on unknown hosts. `NMSH_SEMANTIC=0` turns both off, `=1` forces them on. NMSh never depends on them.
- **OSC 8**: NMSh-authored links (help/docs, dev-server URLs) are stored as authored cells after a target check (http/https without credentials, local `file:`) and painted only on hosts with hyperlink support; raw program OSC 8 stays the separate preserved program-output path. Copy/plain text never contains escape bytes.

## Not in this slice

Terminal title / OSC 0/2 ownership; terminal emulator or editor base-theme takeover (Ghostty/Kitty palettes, Zed/VS Code); bat/delta custom themes; arbitrary Oh My Zsh theme import; an Oh My Posh runtime provider; the #305 module ecosystem.
