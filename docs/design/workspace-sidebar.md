# Workspace Sidebar (#331)

Part of the workspace program ([#330](https://github.com/raiseCatError/notMyShell/issues/330)); shared foundation and integration contract: [workspace.md](workspace.md).

`SidebarController` keeps browsing state only: selection by id, expansion, a filter and scroll. Its `dispatch(action)`
returns an outcome the frontend acts on:

| Outcome | When |
| --- | --- |
| `preview` | the selection moved; the detail panel may show a cached, read-only preview |
| `activate` | Enter (or → on a leaf) on an `activatable` resource: the frontend performs the intent |
| `unavailable` | the resource cannot be opened here; the reason is shown, nothing happens |

Tree behavior: → expands (or moves into an open node), ← collapses (or moves to the parent), Enter on a section
toggles it. Sections open the first time they appear; afterwards a person's expansion is kept across refreshes.
After a refresh the selection follows its id; if it vanished, the row now in its place is selected. `/` starts a
filter: matches show with their ancestors, the selection moves to the first direct match, Esc clears.

`renderSidebar` returns exactly `rows` lines of at most `width` cells. Marks (Unicode / Safe): focused title
`▸`/`>`, selected row `›`/`>`, active resource `●`/`*`, expanded `▾`/`-`, collapsed `▸`/`+`, attention `!input`,
`!approval`, `!failed`, an exited pane `(exited)`, an old listing `(stale)`. Color only reinforces them. Compact mode
drops details. Key help is shown only while focused, derived from the bindings.

Sections in this slice:

- **tmux** (`tmux.ts`). Only the server NMSh runs inside (`$TMUX`), through the trusted tmux executable, with one
  `list-panes -a -F` call per explicit refresh: 1.5 s and 256 KiB bounds, a minimal environment, no shell. Fields are
  separated by `|`; names are requested with tmux's `q:` modifier (which escapes `|`), and both that escaping and
  tmux's own output escaping (`\\`, `\ooo`, used by older builds such as Ubuntu 24.04's) are undone. Every row is
  validated, and a row with a wrong shape or id is dropped. Session → window → pane: one session with two windows and five panes is one session.
  NMSh's own pane (`$TMUX_PANE`) and the window/session holding it are `active`; tmux's own active window and pane
  are named in the detail. Activation uses tmux's own commands on ids (`$1`, `@2`, `%3`), never names, as one argv:
  `select-pane`/`select-window`, then `switch-client`. NMSh never creates panes or PTYs or changes layout. Outside
  tmux the section says so and offers nothing.
- **Worktrees** (`sources.ts`). From the `/worktrees` snapshot: opening a worktree changes the persistent shell's
  directory (the manager's own `cd` intent); a missing path or bare repository is listed with its reason. Creation and
  removal stay in `/worktrees`.
- **Open**: links to the managers that own deep control (`/github`, `/agents`, `/sessions`).

Not in this slice: NMSh live sessions and Managed Targets as first-class rows (they need the session service and
#329 target registry wired through the frontend), GitHub items (the `/github` manager is linked instead).
