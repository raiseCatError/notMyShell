# v0.16: settings portability, uninstall, diagnostics

## Settings export / import

```
nmsh config categories
nmsh config export [--categories theme,layout] [--output FILE [--force]]
nmsh config import FILE [--categories a,b] [--yes]
nmsh config path
```

- One source of truth: categories are views over existing configuration keys
  (`src/configuration/portability.ts`), and import goes through the same
  normalizer and atomic, merge-preserving save every Settings change uses.
- Categories: prompt, theme, chroma, chrome, syntax, transcript, layout,
  suggestions, providers, statusStrip, idle, notifications, tools, sessions,
  agents, shell, editor.
- Format: `{"format": "nmsh-settings", "version": 1, "categories": {…}}`,
  human-readable JSON written with mode 0600 and never overwriting a file
  without `--force`.
- Never exported: onboarding progress, Starship/Powerlevel10k config paths
  (absolute host paths), history, transcripts, agent stats, install records,
  credentials or anything outside `config.json`.
- Import previews every change (`path: before -> after`) and starts on No;
  non-interactive use needs `--yes`. Invalid values are rejected and listed,
  never silently turned into defaults. Unknown categories and fields are
  listed as ignored. A newer format version is refused with "update NMSh".
  Keys this NMSh does not know that already exist in `config.json` survive.

## Uninstalling optional tools (`/tools`, X)

- **Installed by NMSh** (recorded in `tool-installs.json` when an install NMSh
  ran succeeded): `brew uninstall <package>` is offered with its provenance
  ("Installed by NMSh on 2026-10-03 with `brew install jq`"), starting on No.
- **Homebrew-owned but not installed by NMSh**: an advanced path with two
  fresh confirmations, both starting on No, saying NMSh did not install it.
- **Anything else**: no command; NMSh says it did not install the tool and
  cannot tell how it was installed.
- argv only, no sudo, no shell; package names must be plain formula names.

## Uninstalling NMSh (`nmsh uninstall`)

`nmsh uninstall [--dry-run] [--delete-data] [--yes]`

- Previews first. Removes only `nmsh` launcher symlinks (on PATH and in the
  npm global prefix) whose targets resolve into this installation, each
  re-verified just before removal. Regular files and unrelated `nmsh`
  links are never removed.
- Keeps the source checkout (you cloned it) and says how to remove it.
- Keeps NMSh data unless `--delete-data`, which needs its own confirmation
  and removes only the NMSh config directory for this environment.
- Never touches `.zshrc`, `.bashrc`, `config.fish` or shell history (NMSh never
  writes them). Ghostty keybind lines that `/keyboard` may have added have no
  ownership marker, so they are listed for manual cleanup instead of deleted.
- Refuses while a live-session service is running.
- Goodbye: "NMSh is uninstalled. Your shell is exactly as you left it."
- Tested only in temporary homes and fake prefixes.

## Shell environment diagnostics

Read-only detection (`src/shell/ShellEnvironment.ts`), from bounded file reads
and well-known paths, ignoring commented lines; nothing is sourced, executed,
installed or disabled:

- Frameworks: Oh My Zsh, Prezto, Zim, Oh My Fish, Oh My Bash, Bash-it.
- Plugin managers: Antidote, Zinit, Sheldon, zplug, Fisher.
- Plugins: zsh-autosuggestions, zsh-syntax-highlighting,
  fast-syntax-highlighting, fzf-tab (NMSh owns that surface inside NMSh; the
  plugin keeps working in `/zsh` and ordinary zsh), zsh-completions
  (compatible: its definitions feed the NMSh menu).

**No plugin manager required.** NMSh provides its editor, completion menu,
prompt, transcript and sessions without one; existing frameworks and plugin
managers keep providing compatible shell-level functionality (aliases,
functions, completion definitions, hooks). Users who want a plugin manager can
use any maintained one (for example Antidote or Zinit for zsh, Fisher for Fish);
NMSh does not install or configure them.

## `/status` and `nmsh doctor`

`/status` adds platform support, shell and its capabilities, completion
sources, session notices, agent activity, the editor bridge, framework and
plugin detection, and the runtime directory. `nmsh doctor` prints the same
kind of summary outside NMSh for issue reports: build, Node, platform and
support statement (including WSL), terminal host and capabilities, providers,
feature switches, framework/plugin detection and paths with `~`. No
environment dump, secrets or history.
