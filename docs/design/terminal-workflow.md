# Terminal workflow: making one command's result useful for the next

Status: living design for the workflow initiative. Ledger: [docs/development/workflow-initiative-ledger.md](../development/workflow-initiative-ledger.md).

NMSh already owns what most of these features need: a structured record per command (command text, stored
output, exit code, duration, waits, lifecycle row, stable `startId`), its own viewport and hit-testing, a
session service that owns the shell, the paste guard, and provider/tool integration. The work below builds on
those records instead of the rendered screen.

## What other terminals teach (and what NMSh takes)

| System | Proven idea | Cumbersome / not for NMSh | NMSh decision |
| --- | --- | --- | --- |
| Warp | Blocks as the unit of copy/share; per-block actions; "copy output" without selecting | Blocks require Warp's own shell integration and editor model; sharing defaults toward its cloud | Already block-based. Copy/report/compare act on block records; nothing leaves the machine. |
| Wave Terminal | Rich block widgets, file previews in place | Heavy UI per block; a second app model | Rejected: NMSh stays text-first; previews go to pager/editor handoffs. |
| iTerm2 | Triggers (regex → action), semantic history (cmd-click paths), "copy output of last command" via shell integration | Regex triggers run automatically on output; easy to make unsafe | References are recognized lazily, offered on explicit invocation, never auto-run. |
| Ghostty / WezTerm / Kitty | Hyperlinks (OSC 8), hints/quick-select modes that pick URLs/paths/hashes by keyboard | Mode-heavy key schemes | Keyboard "references in this block" list from the Actions menu; OSC 8 links already honoured. |
| Zellij / tmux | Session persistence, panes; copy mode | NMSh is not a multiplexer | Keep the session service; integrate with tmux, do not replace it. |
| Atuin | Context-rich history (cwd, exit, duration, session), fuzzy search | Separate history database and sync | NMSh already has a history provider for Atuin; pins/recipes reuse history and presets. |
| Pueue | A daemon queue for background jobs, separate shells, logs | Loses the interactive shell's state (cwd, env, functions) | Distinct concept. NMSh's queue runs in the *same* shell; Pueue is an optional integration for detached jobs, not the queue. |
| fzf / Television | Fast fuzzy pickers with preview | External process handoff | Native picker first; fzf/Television stay optional providers. |
| Yazi | File manager with previews | A whole TUI | Handoff only (open a directory/file with it when installed). |
| delta / bat | Readable diffs and highlighted sources | External binaries | Compare renders its own unified view; delta is an optional renderer when installed. |
| Nushell | Structured data between commands | A different shell language | Out of scope: NMSh preserves the user's shell. |
| Gum | Prompts for scripts (choose, confirm, input) | — | Must keep working: input awareness and passthrough already route keys to such prompts. |

## Decisions and defaults

| Capability | Default | Why |
| --- | --- | --- |
| `/copy` (Quick Copy), output only | Always available | Existing behaviour; fastest path. |
| Completion status in copies | Off; `--status` per copy | The output is what people paste; status is opt-in context. |
| Interactive copy picker | `/copy ui`, or Settings → Copy | Progressive disclosure. |
| Copy as Report (Markdown, plain) | Explicit action (`--report`, picker, Actions) | Reports carry commands, paths, exit codes: shared deliberately. |
| Report redaction | Offered in the review, never claimed complete | Heuristic; the person inspects the result. |
| Compare output | Explicit action ("Compare output…", `/compare`) | Computed lazily, never per command. |
| Reference recognition | Lazy, on Actions/hover; no decoration | Avoids noise and false confidence. |
| Error navigation | On demand (`/find` filters, Actions) | Exit status is authoritative; text matches are hints. |
| Pins and recipes | Explicit; nothing persisted otherwise | Never auto-run. |
| Queue after failure/interrupt | Paused | Dependent commands must not run blindly. |
| Paste | Never executes; batches are reviewed | Pasting is not execution. |
| Clipboard-change suggestion | Opt-in where detection is cheap and private | No polling of contents; no history. |
| Sticky block controls | Contextual: only while a block's header is scrolled away | No permanent buttons on every block. |
| Animation | Minimal; obeys reduced motion | Restraint. |

## Rejected or deferred

- Automatic execution of clipboard, AI or output-derived commands: never.
- Background AI interpretation of output; any AI dependency in these features.
- Clipboard history or persistence; transmitting output anywhere.
- A workflow engine: recipes are reviewed sequences fed to the existing queue.
- A competing log analyzer: error navigation extends `/find`.
- Embedded file manager or diff engine of our own beyond a small line diff for Compare (an LCS line diff
  is a few dozen lines; delta renders when present).

## Shared foundations

- **Block identity:** every action names a block by `startId`; records that fail ownership checks after clears or
  legacy restores are dropped (see transcript repair), so actions never land on recycled line positions.
- **Provenance:** `output` is what the command wrote (NMSh lines inside a running block excluded);
  `lifecycleText` is NMSh's completion row, kept separate; reports and copies compose from these.
- **One action path:** mouse, keyboard, slash commands and menus call the same handlers (`copyRecords`,
  `runBlockAction`, the queue's `QueueOp`s).
- **Input ownership:** a program waiting for input owns Enter; NMSh never turns a reply into a queued command.
- **Ephemeral by default:** pickers, staging and reviews hold data in memory only.

## Limits stated plainly

- Sticky controls exist in NMSh's viewport only; the terminal's own scrollback cannot be decorated.
- Redaction is pattern-based; it will miss things. The review exists for that reason.
- Clipboard-change detection depends on the platform. Reading the clipboard's contents to notice a change is
  not acceptable; only a change signal that does not expose the text qualifies (decided in the clipboard slice).
