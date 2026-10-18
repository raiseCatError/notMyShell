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
| **[Atuin](https://github.com/atuinsh/atuin/blob/main/docs/docs/configuration/config.md)** | Curated in `/tools`; usable as the explicit history provider (`/providers`); NMSh reads local commands and metadata for suggestions | **Adopt as is** | NMSh keeps shell history authority and uses Atuin as an optional source. Project/session-aware ranking is already NMSh's own (directory affinity, frecency); do not add a second history store |
| **[fzf](https://github.com/junegunn/fzf#usage)** | Curated in `/tools`; selection provider; shell keybindings remain external configuration | **Adopt as is** | The existing picker provider covers selection. No new picker subsystem |
| **[Television](https://github.com/alexpasmantier/television#readme)** | Curated in `/tools`; picker provider choice | **Adopt as is** | Same provider slot as fzf. Preview/select actions for output references (#353) already use NMSh's own palette, which is enough |
| **[zoxide](https://github.com/ajeetdsouza/zoxide#readme)** | Curated in `/tools`; directory provider behind `/dirs`, queried through a private database copy | **Adopt as is** | zoxide can write while querying. NMSh protects the original database and falls back to Native when it cannot obtain a bounded snapshot |
| **[bat](https://github.com/sharkdp/bat#adding-new-themes)** | Curated in `/tools`; Ask knows it; Theme Bridge offers an owned theme and explicitly reviewed cache build | **Adopt as is** | No dedicated source-preview launcher is implemented. Users can invoke bat in their shell; Compare and reports use native plain text |
| **[delta](https://github.com/dandavison/delta#readme)** | Curated in `/tools`; Theme Bridge offers optional Git diff colours and bat-backed syntax theme support | **Adopt as is; do not use for Compare** | Native Compare uses a bounded edit distance, reviewed reports and a sanitized plain diff copy. Sending output to an external renderer creates another presentation/copy boundary without addressing the accepted workflow needs |
| **[Pueue](https://github.com/Nukesor/pueue#readme)** | No Pueue adapter | **Defer** | Its separate daemon provides durable jobs, but it owns independent execution and persisted output. A reviewed handoff would need output capture and transcript provenance. The same-shell queue stays native. Workspace background-task work (#383/#384) belongs to the other track; adding a second adapter before that handoff is premature |
| **[Yazi](https://yazi-rs.github.io/docs/tips/)** | No chooser adapter | **Defer** | Returning paths through `--chooser-file` is plausible, but needs a bounded private result file, validated shell quoting, passthrough handoff and explicit insertion. No accepted implementation slice supersedes the existing deferral |
| **[Gum](https://github.com/charmbracelet/gum#readme)** | No Gum-specific adapter | **Reject** | Gum provides script prompts. NMSh retains ordinary passthrough and input ownership rather than adding a forms framework. Gum-specific physical interoperability has not been validated |

## What stays native, and why

- **Command queue** (same shell, once-only, pauses on failure or interrupt, optional approval): needed because the next
  command depends on the state the previous one left in the person's shell.
- **Compare** and **Copy as Report**: exact, reviewed, redactable text; the properties that make them safe to share would
  be lost behind an external renderer.
- **Output references and failure navigation**: use the existing editor/browser bridges instead of a picker tool.

## Follow-ups worth a ticket each

1. Yazi chooser handoff (isolated, high value).
2. Pueue *send to background* with status (needs the output-capture design first).

## Implementation evidence and limits

Re-audited 2026-10-11. Existing optional-provider behavior is implemented in
[`historyProviders.ts`](../../src/shell/historyProviders.ts),
[`HistoryService.ts`](../../src/shell/HistoryService.ts),
[`Picker.ts`](../../src/pickers/Picker.ts),
[`DirectoryService.ts`](../../src/shell/DirectoryService.ts) and
[`Theme Bridge runtime`](../../src/themeBridge/runtime.ts).
Provider and bridge tests cover bounded reads, absent dependencies, native fallbacks and owned configuration;
live queue, alternate-screen and report/diff acceptance covers the retained native paths. No new CLI adapter is
claimed by this audit. Host-specific picker visuals and physical interoperability remain human QA.
