# Product boundary, transcript find/filter and HostActions

> Use the best native surface that already exists around NMSh instead of
> duplicating IDE functionality in the terminal.

## Who owns what

| NMSh owns | The host / editor owns |
|---|---|
| command composer and editor | source-code editing |
| shell completion presentation | repository-wide source search |
| shell and NMSh history | rich Git diff, staging, merge editor |
| command/output transcript | file explorer |
| transcript find and output filtering | diagnostics, symbols, outline |
| sessions, session search and management | code navigation UI |
| shell switching, prompt and status | |
| terminal-native presentation | |
| recognizing source references in output | |

NMSh may **bridge** to the right column. It does not clone it: there is no
file explorer, code preview, project search, Git graph, staging UI or diff
viewer inside NMSh. Plain `git diff` keeps working in the transcript.

## Transcript find (`/find`)

- A one-row find bar directly above the composer (frontend chrome like
  notices; never transcript). The composer draft is untouched.
- Plain text by default; Tab cycles case-sensitive, regex, regex + case.
  Enter (or Up) steps to the older match, Shift+Enter / Ctrl+J (or Down) to
  the newer one; Esc closes. The count and options are always visible; an
  invalid regex is reported in the bar.
- Scopes: the current transcript, or the current block (`/find -b`). NMSh
  command history stays at `/history`. Archived sessions are a future scope
  behind the same `SearchScopeId` abstraction; they are not searched today.
- Matches are recomputed only when the presented rows change (generation
  key), never per frame. The active match's row is shown with the match
  marked and is scrolled into view.
- No default shortcut is assigned: Ctrl+F / Cmd+F are the host's own find in
  VS Code, Zed and Ghostty, and NMSh does not override them.

## Output filter (`/filter`)

- Shows only matching lines of one command block: the focused block, else the
  newest completed one. `-v` inverts, `-C N` keeps N lines of context, `-r`
  regex, `-c` case-sensitive. A hint row inside the block says a filter is
  active and how many lines are shown. `/filter clear` restores it.
- Presentation only: applied in `OutputBuffer.wrapped()`, so viewport math,
  hit-testing and plans agree; stored lines, completed records, journals and
  `/copy` are unchanged. The command row and other blocks are never hidden.

## HostActions (`src/host/HostActions.ts`)

Capabilities, not brand checks: `integratedEditor`, `nativeFileOpen`,
`nativeDirectoryOpen`, `nativeDiff`. Adapters implement them:

| Adapter | Open file at location | Folder | Diff |
|---|---|---|---|
| Zed | `zed <path>:<line>:<column>` | `zed <dir>` | `zed --diff <old> <new>`, only when `zed --help` lists `--diff` |
| VS Code | `code --goto <path>:<line>[:<character>]` | `code <dir>` | `code --diff <a> <b>` |
| VISUAL / EDITOR | a visible command in the composer (`nvim +12 'a b.ts'`, `hx a.ts:12:3`, `micro +12:3 a.ts`); unknown editors get no guessed flag | unsupported (explained) | unsupported (explained) |

These forms come from the editors' own CLI sources (Zed `crates/cli`:
"Use `path:line:column` syntax", `--diff` pairs; VS Code `argv.ts`: `--goto
file:line[:character]`, `--diff file file`).

Selection: an explicit **Open with** setting (`auto`, `zed`, `vscode`,
`editor`) wins; Auto uses the editor NMSh runs inside (from its own terminal
environment), then VISUAL/EDITOR. A terminal emulator is never treated as an
editor; inside Ghostty or Terminal.app with no editor configured, NMSh says so
and suggests nothing else.

Safety: paths are resolved to absolute paths before launch (so they can never
look like options), every launch is argv-based with `shell: false`, and GUI
editors are started detached. Terminal editors are never run silently; the
exact command is placed in the composer, quoted for the current shell, for the
user to run.

## Source references and `/open`

- References recognized in output: `path:line` and `path:line:column` with
  relative, absolute or `~` paths, and quoted forms containing spaces.
  URLs, times and bare words are not references.
- `/open <path>[:line[:column]]` resolves against the shell's cwd.
- `/open` alone lists references from the newest outputs, each resolved
  against the cwd its command ran in (not NMSh's process cwd).
- Missing files, directories passed to `/open-diff`, control characters and an
  unavailable editor all produce a factual message.
- Keyboard-first in this pass; clickable transcript links are not added.

`/open-diff <old> <new>` delegates to the editor's diff view where supported
and otherwise explains the fallback (`git diff` here).
