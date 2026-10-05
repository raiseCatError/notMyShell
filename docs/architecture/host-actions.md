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

## Transcript find (`/find`, Ctrl+F)

- **Terms AND together.** Each `/find <term>` adds a clause; a logical line
  matches only when every clause matches it. OR lives inside one regex clause
  (`/find -r 'error|disk'`). There is no boolean expression language.
- Each clause keeps its own options: `-c` case-sensitive, `-r` regex.
- Matching is on **logical lines** (all wrapped rows of a line together), so
  terminal width never changes whether a line matches. Navigation moves
  between matching lines; every clause's spans are marked on them, the active
  line most strongly.
- **Ctrl+F** opens a new clause input while NMSh owns the idle composer
  (raw `^F` and Kitty CSI-u). A running command or passthrough program still
  receives Ctrl+F unchanged. Cmd+F and the host's own find are not touched.
- In the clause input: typing edits only the new clause; Enter applies it (or,
  when the input is empty, steps to the older match); Shift+Enter / Ctrl+J
  steps newer; Up/Down step too; Tab cycles plain → case → regex → regex + case;
  Esc discards only the uncommitted input — applied clauses stay.
- `/find` alone opens the input; `/find remove N` removes one clause;
  `/find clear` removes all. `/find -b <term>` (first clause) scopes to the
  current block. Archived sessions are a future scope behind the same model.
- Matches are recomputed only when the presented rows or clauses change.

## Output filter (`/filter`)

- Each `/filter <term>` adds a clause to the filter set of one block (the
  focused block, else the newest completed one, chosen when the set is
  created). Kept lines satisfy every clause; `-v` inverts a clause, `-C N`
  keeps N lines of context (the set uses the largest), `-r`, `-c`.
- The set stays attached to its block: a newer command never takes it over.
  `/filter remove N` removes one clause; `/filter clear` (or `/filter` alone)
  removes the set and restores every line.
- The hint row inside the block remains. Presentation only: stored lines,
  records, journals and `/copy` are unchanged.

## Find / filter chrome

Above the composer, at most **two rows**: Find on the left, Filter on the
right, at most two visible clauses per side, and `+N more` (the exact number of
hidden clauses) on the second row. Tags are concise (`[case]`, `[regex]`,
`[invert]`, `[±N]`); the clause being typed shows a caret and stays visible.
Narrow terminals shorten terms, then collapse to `⌕ N terms · 2/5` and
`⧩ N filters` on one row.

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

Inside Zed or VS Code without its CLI on PATH, NMSh says the editor was
detected and how that editor installs its CLI (Zed: command palette →
`cli: install cli binary`, which symlinks into `/usr/local/bin` and may ask for
administrator rights; on Linux, official releases use `~/.local/bin` and some
packages name it `zeditor`, `zedit` or `zed-editor`. VS Code on macOS: command
palette → "Shell Command: Install 'code' command in PATH"). NMSh does not run
these installs itself; `/status` shows Integrated editor, Editor bridge
unavailable, and the missing CLI.

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
