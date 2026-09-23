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

14. **Merge the PR into `dev` when all conditions are met:**
    - Implementation is coherent and complete
    - Canonical local verification passes
    - Required GitHub CI checks pass
    - PR is mergeable with no conflicts
    - No unresolved review concern exists
    - Issue does not explicitly require human validation before merge
    - No material architectural uncertainty requiring user review

    Do NOT merge if CI is failing, tests are failing, conflicts remain, implementation is incomplete, or the issue explicitly requires pre-merge human review.

    **NEVER apply this rule to `master`.** Agents must never promote dev work to master merely because CI is green.

15. **If the task requires no human runtime validation** (e.g. certain documentation or research tasks), it may be closed with normal closing keywords where appropriate.

16. **After merging into `dev`:** if physical/manual terminal validation is still required:
    - Move issue: In Progress → **Needs Human Test**
    - Leave a concise testing handoff containing:
      - what changed
      - exact thing to test
      - useful commands/actions
      - expected behavior
      - relevant terminal hosts
      - automated verification completed
    - Issue remains **open**
    - Do NOT claim the user performed the test
    - Independent Ready work may then continue

17. **After merge + required human validation**, the issue may be closed; the Project's closed-item automation will move it to Done.

## Project status semantics

| Status | Meaning |
|---|---|
| **Backlog** | Tracked but not currently selected for work |
| **Ready** | Sufficiently defined and available to start |
| **In Progress** | An agent or person is actively implementing it |
| **Needs Human Test** | Implementation merged into dev; automated checks passed; physical/manual terminal validation pending |
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

When explicitly told "Continue developing NMSh", "Work through Ready issues", "Continue autopilot", or equivalent, that instruction is **STANDING AUTHORIZATION** to continue through safe work.

You MUST NOT ask "Would you like me to start the next Ready issue?" or "Should I open the PR?" after completing a step. Instead, follow this continuous loop until a documented stop condition occurs:

issue completed → PR green → merge into dev → delete merged branch → manual-test handoff if required → refresh dev → immediately begin next safe issue.

**Standing Authorization / Do Not Ask for Routine Permission:**
Once authorized, do NOT pause merely to ask for permission for routine steps (opening PRs, merging green PRs, starting the next issue). Ask/stop ONLY when there is a MATERIAL user decision required:
- Conflicting product/design choices
- Destructive operations or security-sensitive uncertainty
- Unclear issue scope that materially changes implementation
- Failing CI that cannot be resolved safely
- Hard dependency on unperformed human validation
- Resource/quota exhaustion warning
- No appropriate current-milestone work remains

**Project Board Access is Best-Effort:**
GitHub Project status updates are DESIRED but MUST NOT block development. For each transition, try the Project update. If it fails or access is denied, do NOT repeatedly retry, do NOT stop development, and never claim it succeeded if it didn't.
- **IN PROGRESS:** An active feature branch, PR, or issue activity is sufficient durable evidence.
- **NEEDS HUMAN TEST:** Add the existing `needs-human-test` issue label, leave the normal testing handoff, and keep the issue open.
- **DONE:** Issue closure remains authoritative. Project automation may catch up separately.

**DO NOT mirror Project Status with Labels:**
Do NOT create duplicate labels for every Project column (e.g., `status:ready`, `status:in-progress`, `status:done`). The existing `needs-human-test` label is useful because it represents an important manual-validation gate. Keep the system simple.

**Autopilot Fallback when Project Status cannot be read:**
If GitHub Project Ready/Backlog fields cannot be reliably read, use this fallback hierarchy to proceed safely:
1. Current milestone
2. ROADMAP ordering
3. Open issue acceptance criteria
4. Explicit dependencies between issues
5. `needs-human-test` label / open PR state
6. Current dev state

**Allow Safe Current-Milestone Progression:**
If no readable Ready status remains, you MAY advance to the next open issue in the CURRENT ACTIVE MILESTONE when ALL of these are true:
- Acceptance criteria are sufficiently defined
- Dependencies are satisfied enough for safe implementation
- Follows the current milestone/ROADMAP order
- No human decision is required first
- No unvalidated dependency makes proceeding unsafe
- Does not require changing product direction

This exception applies to the CURRENT ACTIVE MILESTONE only. Do NOT automatically wander into Next, Later, Future, or arbitrary backlog issues. At the end of the current milestone, stop and report.

**Dependency Safety:**
Do not interpret continuous autopilot as "code everything regardless of risk." Before starting the next milestone issue, check whether work currently in Needs Human Test is a HARD dependency. If later work depends on a physical behavior whose correctness is unknown until the user validates it, stop at that dependency. Prefer useful throughput, not reckless throughput.

**Merge / Branch Cleanup Workflow:**
For each issue:
latest dev → focused feature branch → implementation → tests → PR targeting dev → required CI green → merge into dev → **delete merged feature branch** when safe → switch/fetch/pull latest dev → continue.
Do not accumulate a pile of stale completed PRs.

**Needs Human Test Workflow:**
After safe integration into dev, if physical/manual validation remains:
- Keep issue OPEN
- Add `needs-human-test` label
- Leave a useful testing handoff (including what changed, exact things to try, commands/actions, expected behavior, relevant terminal hosts, automated verification completed)
- Do not close the issue
- Do not wait for the human unless that validation blocks subsequent work. Then continue to the next safe milestone issue.

**Human test result flow:**

| Result | Action |
|---|---|
| **PASS** | Close issue → Done |
| **FAIL** | Move In Progress → create focused fix branch from current dev → fix → verify → PR → merge when green → Needs Human Test again |

Do not rewrite dev history merely because later human testing discovers a bug.


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

## Cloud agent sessions

NMSh development may be performed from cloud coding agents launched from web or mobile.

GitHub is the durable source of truth.

Cloud sessions must NOT depend on:
- the user's local checkout
- uncommitted local-only files
- old hidden chat context
- local-only shell state
- personal filesystem paths
- local-only MCP servers
- credentials not available in the cloud environment

A fresh session should reconstruct project state from `AGENTS.md`, GitHub Issues, GitHub Project, `ROADMAP.md`, `docs/design/`, `docs/architecture/`, git history, branches, and PRs.

### Critical cloud branch rule

GitHub's default branch is `master`. Normal development must NOT accidentally begin from `master` merely because a cloud environment opens the default branch.

Before implementation, cloud agents must establish current `dev` as base:
```bash
git fetch origin
git switch dev
git pull --ff-only origin dev
```

Then create/use a working branch based on current `origin/dev`. Provider-generated names (e.g., `claude/*`, `codex/*`) are fine. The NAME does not matter. The BASE must be current `dev`. The PR target must be `dev`. Do not direct-push feature implementation to `dev` merely to skip the PR process.

### Cloud verification limits

Cloud agents must detect their actual environment. Do not assume a cloud VM is macOS, Ghostty, Terminal.app, or the user's physical terminal setup.

The project requires Node >=22. Prefer `npm ci` then run supported canonical verification:
```bash
npm run build
npm run typecheck
npm test
git diff --check
```

GitHub CI remains an integration gate.

Cloud testing must NEVER be described as physical terminal validation. Examples still requiring real/manual testing when relevant: Ghostty visuals, Terminal.app visuals, mouse/hover behavior, keyboard behavior, terminal selection, resize behavior, fullscreen passthrough, actual TUI interaction. Such work may still merge into `dev` when automated gates are green, but the issue remains Needs Human Test.

## Resource-limit checkpointing

If Claude, Gemini, Codex, or another runtime exposes an approaching usage limit, quota limit, or context/session limit, then:
1. Do NOT start another issue.
2. Finish only the current small coherent step if safe.
3. Run the most relevant verification possible.
4. Commit coherent work.
5. Push current branch/state.
6. Update issue/PR/Project accurately.
7. Leave a concise handoff.
8. Stop cleanly.

The handoff should include:
- current issue
- branch
- latest commit
- completed work
- incomplete work
- verification already run
- verification still needed
- exact next step

Do NOT invent quota percentages. Only react to capacity information actually exposed by the runtime. Session/chat history is NOT durable project state. GitHub, commits, branches, and repo docs are.
