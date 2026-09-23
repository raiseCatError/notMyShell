# NMSh Agent Guide

## What NMSh is
notMyShell (NMSh) is a terminal frontend that operates over a persistent, real zsh session. Instead of replacing the shell or running commands as isolated subprocesses, NMSh orchestrates a hidden pseudo-terminal (PTY) running zsh. It captures input via a fixed editor, highlights it semantically, and sends it to the real shell. 

## Core invariants
- NMSh is a frontend over a persistent real shell.
- Do not replace ShellSession with command-by-command spawning.
- Preserve real zsh state between commands.
- Raw PTY stdout/stderr must remain raw/presentation-safe.
- Do not semantically recolor arbitrary PTY output.
- NMSh-owned submitted command lines may have semantic highlighting.
- `/copy` must remain plain text without NMSh ANSI presentation chrome.
- fullscreen/interactive terminal applications use the passthrough path.
- NMSh owns its input editor; do not casually re-enable ZLE UI.
- Powerlevel10k/ZLE prompt UI must not fight NMSh.
- Fastfetch automatic startup remains intentionally suppressed during shell bootstrap.
- semantic helper processes must never attach to the host controlling TTY.
- preserve the detached SemanticService isolation.
- test-created TerminalApp instances must clean up ShellSession and SemanticService resources.

## UI model
- **history viewport**: Scrollable past commands and raw PTY output
- **autocomplete/suggestions**: Real-time completion hints below the input
- **live activity**: Real-time animation and elapsed time for running commands
- **context/prompt**: Evaluated from the shell and displayed on the bottom editor
- **persistent editor**: The fixed input box at the bottom of the screen
- **separator**: A visual divider between output and the editor

NMSh uses a FOLLOW mode during execution, pinning the output viewport to the bottom. During historical inspection, it enters DETACHED mode.

## Input invariants
- `Shift+Enter`: newline (multiline)
- `Ctrl+J`: fallback newline
- `Option+Backspace`: standard word-deletion via Ghostty forwarding
- `multiline input`: supported natively by the editor
- `selection`: standard terminal selection applies
- `Kitty enhanced keyboard handling`: supported for advanced key combos

## Semantic highlighting
NMSh uses a synchronous lexical `Highlighter` coupled with an asynchronous `SemanticService`.
As the user types, partial input is tokenized. Known executables, aliases, and builtins are resolved asynchronously in the background. Partial or incomplete input is NOT blindly executed.

Submitted commands retain their semantic presentation in the NMSh output history. The styling (e.g. lavender for known commands, red for unknown commands) persists even after the command completes.

## Shell compatibility
Current: zsh-first
Future: The ShellAdapter architecture (detailed in ROADMAP.md) is designed to eventually support Bash, Fish, Nushell, and pwsh. Multi-shell support does not exist yet.

## Testing / verification
Canonical verification commands:
```bash
npm run build
npm run typecheck
npm test
git diff --check
```

When writing tests involving `TerminalApp`, you must carefully tear down child processes and temp ZDOTDIRs:
```typescript
app['stop'](0);
app['session'].kill();
```

## Coding-agent behavior
- Normal work should start from and target `dev`.
- Do not commit directly to `master` unless the task explicitly concerns a release or stable-branch maintenance.
- `master` represents the stable/released state.
- inspect existing architecture before changing it
- prefer localized changes
- do not casually rewrite the renderer or PTY architecture
- no fabricated manual verification
- distinguish automated verification from human GUI/runtime validation

## Planning and GitHub tracking

GitHub is the durable source of truth for what NMSh is building, what comes next, and why.

For substantial implementation work:

1. **Check the relevant GitHub issue** — acceptance criteria in the issue are authoritative; do not invent scope
2. **Work from `dev`** — always branch from and target `dev`
3. **Update issue/Project status** during work (In Progress when started, Needs Human Test when automated work is done but terminal validation remains)
4. **Automated verification and human terminal validation are distinct** — do not close issues requiring human terminal validation until that validation has occurred
5. **Only close work requiring human validation after that validation occurs**

Key references:
- [ROADMAP.md](ROADMAP.md) — product direction and issue index
- [GitHub Issues](https://github.com/raiseCatError/notMyShell/issues) — actionable work
- [v0.2.0 Milestone](https://github.com/raiseCatError/notMyShell/milestone/1) — current release target
- [docs/architecture/terminal-stack.md](docs/architecture/terminal-stack.md) — terminology and stack model
- [docs/design/structured-execution.md](docs/design/structured-execution.md) — v0.2.0 design decisions
