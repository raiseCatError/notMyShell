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
- FOLLOW/DETACHED viewport behavior must not regress.
- terminal-host-specific enhancements cannot become structural dependencies of NMSh core.
- automated test passage is NOT equivalent to physical terminal validation.

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
- [GitHub Project](https://github.com/users/raiseCatError/projects/1) — live development status board
- [docs/architecture/terminal-stack.md](docs/architecture/terminal-stack.md) — terminology and stack model
- [docs/design/structured-execution.md](docs/design/structured-execution.md) — v0.2.0 design decisions

## Agent work loop

When given a task such as "work on the next Ready NMSh issue", follow this workflow:

1. **Read the relevant GitHub Issue first.** The issue's acceptance criteria define the concrete task scope — do not invent scope beyond it.

2. **Check supporting design/architecture docs** linked by the issue (e.g. `docs/design/`, `docs/architecture/`).

3. **Confirm the issue is appropriate to start.** Prefer items in Project status `Ready`. Do not silently pick up a Backlog item merely because no Ready item is visible.

4. **Move the selected issue: Ready → In Progress** on the [GitHub Project](https://github.com/users/raiseCatError/projects/1).

5. **Start from the latest `dev`:**
   ```bash
   git switch dev && git pull --ff-only origin dev
   ```

6. **Create a focused feature branch from `dev`:**
   ```bash
   git switch -c feature/short-description
   ```

7. **Inspect only the relevant source files before editing.** Do not recursively re-audit the entire repository unless there is a specific reason to do so.

8. **Implement the issue without silently broadening scope.** If a genuine blocker or related issue is discovered, note it and stop rather than expanding the PR.

9. **Add or update automated tests for behavior changes** where appropriate.

10. **Run the canonical verification suite:**
    ```bash
    npm run build
    npm run typecheck
    npm test
    git diff --check
    ```

11. **Commit and push the feature branch.**

12. **Open a focused Pull Request targeting `dev`.** See PR rules below.

13. **Link the PR to the issue.**

14. **If physical/manual terminal validation is still required:**
    - Move issue: In Progress → **Needs Human Test**
    - Use `Refs #N` in the PR body — **NOT** `Closes #N` or `Fixes #N`
    - Do NOT close the issue
    - Do NOT claim manual validation occurred

15. **If the task requires no human runtime validation** (e.g. certain documentation or research tasks), it may be closed with normal closing keywords where appropriate.

16. **Do not merge your own implementation PR by default.** Leave review and merge to the user unless the current task explicitly authorizes self-merge.

17. **After merge + required human validation**, the issue may be closed; the Project's closed-item automation will move it to Done.

## Project status semantics

| Status | Meaning |
|---|---|
| **Backlog** | Tracked but not currently selected for work |
| **Ready** | Sufficiently defined and available to start |
| **In Progress** | An agent or person is actively implementing it |
| **Needs Human Test** | Automated work is complete; real terminal/manual validation remains |
| **Done** | Issue is closed and fully verified |

> **Important:** "All tests passed" is NOT equivalent to "human terminal validation passed." These are distinct. Do not close or move to Done based on automated test results alone if the issue requires physical terminal testing.

## PR rules

Every implementation PR must:
- Target `dev` (never `master` directly)
- Stay focused on its issue — no unrelated cleanup or refactors
- Summarize what changed and why
- Report automated verification results
- Explicitly identify anything requiring human terminal testing

**For issues requiring human validation:**
```
Refs #N
```
**NOT** `Closes #N` or `Fixes #N` — this prevents the PR merge from prematurely closing an issue before real terminal testing has occurred.

**For work requiring no human validation** (docs, research), normal closing keywords may be used where appropriate.

## Multi-issue / autopilot behavior

When explicitly told to continue working through the project:

- Work one issue at a time by default
- Prefer the lowest-numbered / clearly highest-priority Ready issue unless dependencies suggest otherwise
- Never silently begin a Backlog item merely because no Ready item exists
- Do not create stacked PRs unless explicitly necessary
- If the next issue depends on an unmerged PR, stop and report it rather than building a fragile stack
- If a human decision or terminal validation blocks further safe work, stop and report it
- If there are no Ready issues, stop
- Do not invent new work just to remain busy

## Subagent / resource discipline

**Default: ONE primary agent.**

Do NOT automatically spawn teams of subagents for ordinary work.

A subagent may be used only when:
- The task is genuinely independent and parallelizable, OR
- A focused specialist investigation would materially reduce risk

**Maximum:** one subagent at a time unless the user explicitly authorizes more.

Do NOT use subagents for:
- Rereading docs or code search
- Running normal build/test commands
- GitHub issue or Project updates
- Straightforward implementation work
- Any task the primary agent can reasonably perform itself

Avoid worktrees unless a task genuinely requires isolated parallel branches.
