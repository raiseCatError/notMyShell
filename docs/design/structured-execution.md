# Structured Execution — Design Document

**Milestone:** v0.2.0  
**Status:** Design (pre-implementation)

NMSh v0.2.0 focuses on making ordinary shell execution structured, readable, compact, and recoverable while preserving complete raw PTY behavior.

---

## Three Information Layers

Every command entry in NMSh history is composed of three visually distinct layers. Today these can look too similar. v0.2.0 makes their roles immediately recognizable.

### 1. User Input

What the user typed. This is the submitted command line, rendered with its semantic highlighting (lavender for known commands, red for unknown commands, etc.) retained from the editor.

Visually: a subtle lighter-background strip or block in the history. Terminal-like and restrained — not a chat bubble, not a dialog box. It clearly communicates "this is what I typed."

### 2. NMSh Execution Metadata

Factual timeline rows produced by NMSh — elapsed time, exit status, summary observations. These are deterministic observations from process signals and output patterns, not AI-generated prose.

Visually: subordinate styling — dimmer, smaller, or indented relative to user input and raw output. They report process state without drawing more attention than warranted.

### 3. Raw Process Output

The unmodified PTY output from the process. NMSh never semantically recolors or transforms this content — it is presented as-is from the PTY.

Visually: standard terminal output. No NMSh chrome applied.

---

## User Input Visual Identity

Submitted commands must become visually distinct from shell output in the history viewport.

**Design decisions:**
- Subtle lighter background or visual strip behind the submitted input block
- Semantic highlighting (from the editor) is preserved on the submitted text
- Does not look like a chat bubble
- Does not look like a dialog element
- Remains terminal-appropriate and restrained
- The persistent bottom composer remains NMSh's primary interaction model — the submitted-in-history style is a _copy_ of that input, not a replacement for the composer

---

## Factual Timeline Rows

NMSh may show factual milestones as timeline rows alongside command entries.

**Examples:**

```
● Running npm test · 2.1s
● 136 tests passed · 2.9s
● Build failed · 4 errors · exit 1
● 14 packages updated
● Running xcodebuild · 35s
● 4 errors · 5 warnings
● Command failed · exit 65
```

**Rules:**
- All rows are deterministic observations: process signals, exit codes, elapsed time, or output line pattern matching
- No AI-generated prose
- No speculative or fabricated status messages (e.g. "I'll investigate the failing tests now." is explicitly forbidden)
- NMSh is reporting process state, not pretending to think

---

## Raw Output Preservation

**Raw PTY output must never be discarded merely because it is hidden.**

Even when output is folded (collapsed), the full raw bytes are retained and available for:
- Manual expansion (Ctrl+O)
- `/copy` — which always operates on the full raw output
- Debugging
- History replay
- Future search features

Presentation state (collapsed/expanded) is a display property, never a storage property.

---

## Four Presentation Modes

NMSh classifies each command execution into one of four presentation modes. Classification may change dynamically while a command is running — NMSh does not require perfect prediction before execution starts.

### INLINE

Small, ordinary output. Displayed directly in the history viewport without any special chrome.

**Examples:** `echo hello`, `pwd`, `git branch --show-current`, `date`, `which git`

### FOLDED

Finite but noisy output. The output is retained in full but collapsed by default, with a summary row and a hint to expand.

**Collapsed appearance:**
```
● Build failed · 4 errors · 5 warnings · 18.4s
  284 lines hidden  (Ctrl+O to expand)
```

The `(Ctrl+O to expand)` text is rendered in neutral/dim styling.

**Examples:** `npm test`, `xcodebuild`, `brew update`, large grep/find operations

### LIVE

Continuous or sustained updating output. Rendered in place with live scrolling. No folding applied while the command is active.

**Examples:** `ping`, `tail -f`, `npm run dev`, `vite`, servers, continuously updating netstat-style commands

### PASSTHROUGH

Interactive or fullscreen applications that take over the terminal. NMSh routes them through the raw PTY without any presentation overlay.

**Examples:** `nano`, `vim`, `fzf`, `less`, `top`, `btop`, `lazygit`, interactive SSH, Claude Code, Codex, OpenCode, Aider

---

## Ctrl+O — Raw Output Toggle

Planned keyboard behavior: **Ctrl+O** toggles raw output expansion for the most relevant command entry.

**Collapsed state:**
```
● Build failed · 4 errors · 5 warnings · 18.4s
  284 lines hidden  (Ctrl+O to expand)
```

**After Ctrl+O (expanded):** the full original PTY output is visible.

**Ctrl+O again:** collapses back to the summary row.

The `(Ctrl+O to expand)` text uses neutral/dim styling to avoid visual noise. Safe behavior applies when no foldable entry exists — no error, no crash.

Exact semantics for "most relevant" entry (active command vs. most recent vs. history-selected) may evolve during implementation.

---

## Automatic Classification — Generic Heuristics

Presentation mode classification is driven by generic heuristics, not a hardcoded command-name database. This ensures useful behavior for arbitrary commands, not just a known list.

**Generic signals used for classification:**

- Output line count and rate
- Elapsed time
- Exit status
- Stderr activity
- Carriage-return rewriting (progress bars, spinners)
- Cursor movement sequences
- Alternate-screen activation
- Sustained output patterns
- Last meaningful output lines
- Common warning/error patterns

**Dynamic promotion:** classification may change while a command is running. For example:
- A command starting INLINE may be promoted to FOLDED as output volume grows
- A command starting INLINE may be promoted to LIVE as continuous streaming is detected
- Alternate-screen activation always triggers PASSTHROUGH

---

## Deterministic Adapters (later, after generic baseline)

After the generic heuristics are working, opt-in deterministic adapters may improve summaries for common tools:

| Tool | Potential summary data |
|------|------------------------|
| git | branch, commit hash, files changed |
| gh | PR/issue number, action taken |
| npm / pnpm | test count, packages updated |
| jest / vitest | pass/fail counts, duration |
| xcodebuild | error/warning counts, build result |
| brew | packages installed/updated, caveats |

**Rules:**
- All parsing is deterministic regex/string matching against real PTY output
- No inference or AI
- Generic fallback always remains active for unrecognized tools
- Each adapter degrades gracefully if output format changes

---

## Design Principles (Summary)

1. Raw PTY output is never discarded
2. Presentation state is separate from storage
3. Classification is generic-first, deterministic-only
4. Timeline rows are facts, never fabricated
5. The composer remains the primary interaction model
6. NMSh does not recolor or semantically transform raw process output
7. Passthrough programs own their screen completely
