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

## Per-Entry Click vs. Ctrl+O — Two Distinct Actions

These are separate features and must not be conflated.

| Action | Scope | Mechanism |
|---|---|---|
| **Click / local action** | One execution entry | Toggles that single entry's expanded/collapsed state |
| **Ctrl+O** | Broader transcript mode | Toggles compact vs. detailed view for the relevant command |

On hosts where mouse is supported, clicking a collapsed entry (or its expand hint) expands that individual entry locally. This is a per-entry action.

**Ctrl+O** is a broader global toggle — a compact/details transcript mode switch.

---

## Ctrl+O — Compact / Details Mode

**Ctrl+O** toggles between compact and detailed execution views.

**COMPACT MODE:**
```
❯ npm test

● Tests completed · 136 passed · 2.9s
  297 lines hidden  (Ctrl+O for details)
```

**DETAILS MODE (after Ctrl+O):**
```
❯ npm test

● Tests completed · 136 passed · 2.9s
  $ npm test

  TAP version 13
  ...
  136 tests passed
```

The `(Ctrl+O for details)` hint uses neutral/dim styling to avoid visual noise. Safe behavior applies when no applicable entry exists — no error, no crash.

Exact semantics for "most relevant" entry (active command vs. most recent vs. history-selected) may evolve during implementation after OutputBuffer/history architecture is reviewed.

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

## Interaction Feedback — Interactive Rows Must Never Look Dead

Interactive rows (collapsed output hints, timeline rows, expandable metadata) must have clearly distinct visual states. A row that can be interacted with must never appear static or inert.

**Required visual states:**

| State | Appearance |
|---|---|
| **DEFAULT** | SECONDARY / muted — present but not dominant |
| **HOVER** | (Optional) Brightens toward PRIMARY if supported safely |
| **FOCUSED** | Clearly visible keyboard focus indicator (never invisible) |
| **EXPANDED** | Clearly distinguished from collapsed state |

**Examples of interactive rows:**

- `297 lines hidden  (Ctrl+O for details)`
- `Running xcodebuild · 35s`
- Execution summary rows
- Collapsed raw output metadata

**Rules:**
- Visible keyboard focus is REQUIRED
- Precise click interaction is REQUIRED where mouse reporting is supported
- Keyboard alternative is REQUIRED for every mouse action
- Usable native terminal text selection is REQUIRED (Shift+drag accepted when mouse reporting owns ordinary clicks/drags)
- Passive hover feedback is OPTIONAL / capability-dependent. Do not degrade terminal text selection merely to force hover support.
- Expanded state must be visually distinct from collapsed state — not just a content change

---

## LIVE vs. FOLDED — Output Volume Does Not Determine Mode

**Large output does NOT automatically mean folded output.**

The distinction:

| Mode | Trigger |
|---|---|
| **FOLDED** | Output is *finite and complete* — a burst that ends |
| **LIVE** | Output is *continuous and ongoing* — sustained stream |

Streaming commands (`ping`, `tail -f`, `vite`, `npm run dev`, servers, continuously updating tools) belong in **LIVE** mode even when they produce many lines. They are never automatically folded.

Classification signals that indicate LIVE over FOLDED:
- Sustained output rate with no sign of termination
- Carriage-return rewrites (progress bars updating in place)
- Continuous heartbeat-style output

---

## FOLLOW / DETACHED Mode — Preserved by Structured Execution

Structured execution integrates with the existing FOLLOW/DETACHED viewport model and does not replace it.

- **FOLLOW mode:** during execution, the viewport is pinned to the bottom — new output scrolls into view
- **DETACHED mode:** scrolling away during execution switches to DETACHED — new output no longer drags the viewport back down
- **Jump to bottom:** an affordance to return from DETACHED to FOLLOW mode

These invariants hold for all presentation modes (INLINE, FOLDED, LIVE, PASSTHROUGH). Structured execution must not introduce any path that overrides the user's explicit scroll position.

---

## Design Principles (Summary)


1. Raw PTY output is never discarded
2. Presentation state is separate from storage
3. Classification is generic-first, deterministic-only
4. Timeline rows are facts, never fabricated — no AI-generated prose
5. The composer remains the primary interaction model
6. NMSh does not recolor or semantically transform raw process output
7. Passthrough programs own their screen completely
8. Interactive rows must never look dead — default, focused, and expanded states are required. Hover is optional based on safe capabilities.
9. Every mouse action must have a keyboard alternative
10. Large output volume does not automatically mean FOLDED — streaming output is LIVE
11. FOLLOW/DETACHED viewport behavior is preserved by structured execution, never overridden
