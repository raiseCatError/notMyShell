# External tool integrations: decisions

Issue [#366](https://github.com/raiseCatError/notMyShell/issues/366), under [#359](https://github.com/raiseCatError/notMyShell/issues/359).
Every candidate was checked against what NMSh already does (the curated `/tools` catalog in `src/tools/catalog.ts`, the
provider registry behind `/providers`, `/dirs`, `/open`, Theme Bridge, the clipboard writer and reader, the same-shell
command queue, native Compare). A decision is one of **adopt** (already supported or built), **defer** (a plausible
slice, not now) or **reject**.

## Principles that decide every row

- Optional and absent-safe: NMSh works fully without any of these. Nothing is installed, configured or enabled without
  a deliberate action and a preview.
- The native same-shell **queue** stays the way to prepare commands for the person's own shell. It keeps the shell's
  state (directory, variables, functions) and its input ownership. A detached job runner is a different tool for a
  different job, never a replacement.
- Native **Compare** stays the comparison of two stored command outputs. An external diff renderer adds colour, not
  meaning.
- No tool receives clipboard or output contents unless the person invoked that tool on that content.
- No second picker, file manager or form framework inside NMSh.

## Decisions

| Tool | Already in NMSh | Decision | Why |
| --- | --- | --- | --- |
| **Atuin** | Curated in `/tools`; usable as the explicit history provider (`/providers`); NMSh reads its metadata for suggestions | **Adopt as is** | NMSh keeps shell history authority and uses Atuin as an optional source. Project/session-aware ranking is already NMSh's own (directory affinity, frecency); do not add a second history store |
| **fzf** | Curated in `/tools`; picker provider; keybinding integration offered by its own installer | **Adopt as is** | The existing picker provider covers selection. No new picker subsystem |
| **Television** | Curated in `/tools`; picker provider choice | **Adopt as is** | Same provider slot as fzf. Preview/select actions for output references (#353) already use NMSh's own palette, which is enough |
| **zoxide** | Curated in `/tools`; directory provider behind `/dirs` | **Adopt as is** | NMSh's directory navigation already asks zoxide when it is the chosen provider. Nothing to add |
| **bat** | Curated in `/tools`; Ask knows it; used for source previews where configured | **Adopt as is** | Not needed for Compare or reports, which are plain text on purpose |
| **delta** | Curated in `/tools` as optional Git diff presentation | **Adopt as is; do not use for Compare** | Native Compare keeps exact bytes, a bounded edit distance and a safe, redactable copy path. Piping outputs through delta would add a process, colours that the copy path must strip, and no new information |
| **Pueue** | None | **Defer** | Durable detached jobs are useful (long builds, transfers that outlive the window). But it is a separate runner with its own state and output, so integrating it means a second place where "what ran" lives. If built: an explicit *Send to Pueue* action on a reviewed command, a read-only status row, and no change to the queue. Needs a design for output capture and for how finished jobs appear in the transcript. Not started |
| **Yazi** | None | **Defer** | A file-selection handoff that returns paths to the composer is the one slice with clear value. It needs a safe protocol (yazi's `--chooser-file`, quoting for the active shell, no auto-execution) and a passthrough hand-over like other full-screen programs. Not built; it would be a small, isolated feature |
| **Gum** | None | **Reject** | It is a toolkit for scripts to draw prompts. NMSh already hands the terminal to any program that wants it (passthrough) and keeps input ownership; adding gum-specific behaviour would imitate a forms framework. A script that uses gum simply works |

## What stays native, and why

- **Command queue** (same shell, once-only, pauses on failure or interrupt, optional approval): needed because the next
  command depends on the state the previous one left in the person's shell.
- **Compare** and **Copy as Report**: exact, reviewed, redactable text; the properties that make them safe to share would
  be lost behind an external renderer.
- **Output references and failure navigation**: use the existing editor/browser bridges instead of a picker tool.

## Follow-ups worth a ticket each

1. Yazi chooser handoff (isolated, high value).
2. Pueue *send to background* with status (needs the output-capture design first).
