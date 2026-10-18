# Workspace: sidebar, detail panel and regional focus

Program: [#330](https://github.com/raiseCatError/notMyShell/issues/330). This document covers the shared foundation
(`src/workspace/`) that the Workspace Sidebar (#331), the contextual detail panel (#332) and the semantic keymap
(#335) build on, and the narrow contract by which the frontend (`src/app/TerminalApp.ts`) adopts them.

Status: **wired into the frontend on `release/v0.20.0`** (`src/app/workspaceHost.ts`, `src/app/workspaceFrame.ts`, and
the glue in `TerminalApp.ts`), following the [integration contract](#integration-contract). Physical QA is pending.

## Boundary

NMSh is a terminal-first control and presentation surface over a persistent real shell. Navigation never transfers
ownership: tmux owns sessions, windows, panes, their PTYs, layout and detach; Git owns worktrees; GitHub owns PRs and
issues; a provider owns its agent loop. The sidebar lists what those owners report and proposes an activation the
frontend performs through a supported path. It never creates PTYs for listed objects, edits code or renders a browser.

## Regions

```text
┌ sidebar ─┬─ center (transcript, composer) ─────────────┬─ detail panel ┐
│ where to │ the current work: unchanged in behavior,    │ what is       │
│ go       │ sized as the PTY                             │ selected      │
└──────────┴──────────────────────────────────────────────┴───────────────┘
  Status Strip (full width, at its configured edge)
```

The regions span the rows of the NMSh pane except the Status Strip row, which stays full width. Rows inside the
center keep using ScreenPlan; `planWorkspaceColumns` is its column counterpart.

### Column plan (`layout.ts`)

| Mode | Meaning | PTY |
| --- | --- | --- |
| `docked` | own columns, one divider cell from the center | center width |
| `compact` | a narrower docked sidebar (markers, short labels) | center width |
| `drawer` | drawn over the center while open **and focused** | **unchanged**: opening/closing never resizes the shell |
| `hidden` | closed, or suppressed by fullscreen/raw passthrough or an idle screen | full width |

Constants (cells): center minimum 60, sidebar docked 28 / compact 18, panel 36–72 (default about 38% of the width),
drawer minimum 24 (narrower terminals give a drawer the whole width). A docked region never squeezes the center below
60; it becomes a drawer instead. Sidebar first (docked, then compact), then the panel; when both are open and do not
fit, the sidebar narrows to compact before the panel becomes a drawer. The plan is a pure function of its input, so
resizing back restores the earlier layout. `columnAt` gives pointer hits (drawers win where they overlap);
`frameColumn` maps a center-relative column to the frame.

**Drawers follow the keyboard.** Below about 80 columns a drawer covers the center, composer included, and at 40
columns both regions would be full-width drawers on top of each other. With `focus` (`regionOf(owner)`) in the input,
an open drawer is drawn only while it has the keyboard; otherwise it is `tucked` (open, not drawn, mode `hidden`).
So at most one drawer shows, and nothing covers the region typing goes to. Tucking is not a resize and keeps the
region open: focusing it again, or widening the terminal until it docks, shows it again. `applyFocusAction(state,
action, columns)` focuses a region opened where it can only be a drawer (an unfocused drawer would show nothing),
and toggling a tucked drawer brings it forward instead of closing what cannot be seen; docked regions still open
without taking focus and toggle closed.

These thresholds are a starting point chosen so an 80-column shell stays usable; they still need physical
measurement in Ghostty and Terminal.app (see QA).

## Regional focus (`focus.ts`, `keymap.ts`)

Owners extend the Managed Target `InputOwner` set from #329 with `LEFT_SIDEBAR` and `RIGHT_PANEL`; there is no second
dispatcher. Exactly one owner holds the keyboard.

- `routeWorkspaceKey(key, context)` returns a workspace action or `undefined` ("not mine; handle as before").
- Protected owners are never intercepted: `PASSTHROUGH`, `APPROVAL`, `CHOICE`, `SEARCH`, `AGENT_MESSAGE`, `PANEL`,
  `TRANSCRIPT`.
- In `COMPOSER` only explicit `composerEmpty` bindings apply, only with an empty draft, and never to text or paste.
  **The defaults bind nothing in the composer**: arrows, Tab and Shift+Tab already mean something there. The regions are
  reached with `/sidebar` and `/panel` (and `/sidebar focus`, `/panel focus`); #335 lets a person opt into keys.
- Region defaults: sidebar ↑ ↓ Home End, → expand, ← collapse, Enter open, `/` filter, Tab next region, Esc composer;
  panel ↑ ↓ PgUp PgDn, `q` close, Tab, Esc.
- `applyFocusAction` handles focus/visibility actions. Closing a focused region returns focus to the composer;
  opening a docked region does not steal focus (a drawer opens focused, see the column plan); Tab cycles composer →
  sidebar → panel, skipping closed regions.
- `resumeFocus` restores the previous owner after passthrough or an idle screen if its region is still open.
- Help rows come from the bindings in effect (`bindingHelp`), so help cannot drift from behavior.

Focus is shown without color: the focused region's edge and title are marked (`▸`/`>`), the selected row has a marker,
and the active resource has its own marker; Safe glyphs and NO_COLOR keep all three distinct.

## Resources (`resources.ts`)

A `WorkspaceResource` has a stable id (selection follows it across refreshes), a kind, sanitized bounded text, and an
explicit support level:

- `activatable`: carries an `ActivationIntent` (tmux session/window/pane target, change directory, NMSh session,
  managed target, or open a dedicated manager). An `activatable` claim without an intent is downgraded to
  `unsupported` with a reason, so nothing is drawn as actionable without a path.
- `informational`: shown, not activatable, with a reason.
- `unsupported`: says why.

Selected, focused, active, attention (`input`, `approval`, `failed`, `finished`) and stale are separate. An unknown
observation time is stale, never fresh. Trees are bounded: 512 resources, four levels, 80-cell labels; external text
has whole escape sequences removed (NMSh's `stripTerminalControls`, so no `]0;title` debris), then controls, format
characters and newlines.

Selection never activates. Moving the selection may ask for a **cached, read-only** preview in the detail panel; only
Enter/→ (or the same semantic action from the pointer) activates.

## Slices

Each slice has its own design document, delivered with its PR, so the slices do not edit the same file:

| Slice | Issue | Document |
| --- | --- | --- |
| Workspace Sidebar, tmux navigation | #331, #333 | [workspace-sidebar.md](workspace-sidebar.md) |
| Detail panel | #332 | [workspace-panel.md](workspace-panel.md) |
| Keymap | #335 | [workspace-keymap.md](workspace-keymap.md) |

## Integration contract

Integration into `TerminalApp.ts` is deliberately a separate, later step: that file is under active input-routing
stabilization on the workflow track (#359), and this slice does not touch it. When the stabilization checkpoint is
published, the adoption is:

1. **State.** The app holds one `WorkspaceFocusState` and the sidebar/panel controllers (later slices). Persisted:
   only `sidebarOpen`/`panelOpen` preferences and the panel width.
2. **Geometry.** Each frame computes `planWorkspaceColumns({columns, sidebarOpen, panelOpen, suppressed,
   focus: regionOf(owner)})` beside ScreenPlan, and focus actions pass the width: `applyFocusAction(state, action,
   columns)`. Transcript and composer render into `center` (center-relative columns); `ptyColumns` replaces the
   terminal width when sizing the PTY. A change in `ptyColumns` is the only workspace event that resizes the shell.
3. **Keys.** Before the existing owner-specific handling, call `routeWorkspaceKey`. `undefined` means continue
   unchanged. A focus action goes to `applyFocusAction`; a region action goes to that region's controller.
4. **Passthrough and idle.** Set `suppressed: true` while fullscreen/raw passthrough or an idle screen owns the pane;
   on return, `resumeFocus(previous, current)`.
5. **Pointer.** `columnAt` decides the region; within a region, the region's own hit-testing yields the same semantic
   actions as keys.
6. **Commands.** `/sidebar [focus]` and `/panel [focus]` dispatch `sidebar.toggle`/`sidebar.focus` and
   `panel.toggle`/`panel.focus`.
7. **Chrome stays out of content.** Sidebar and panel rows are frontend chrome: never written to the transcript,
   journals, snapshots or plain-text `/copy`.

Conflict-prone paths for the integration branch: `src/app/TerminalApp.ts` (key routing, render composition, PTY
sizing), `src/commands/slashCommands.ts` (two commands) and `src/help/helpContent.ts`.

## As integrated (v0.20)

- **One geometry path.** `TerminalApp.dimensions()` returns the center's width whenever a region is open; the
  terminal's own size is `terminalDimensions()`. Wrapping, ScreenPlan, every panel, hit testing and the PTY therefore
  follow one plan. Sidebar, panel and drawer cells are composed only at the final paint (`composeWorkspaceFrame`),
  after effects, transitions and caret placement; the Status Strip row stays full width; erase-in-line is removed
  from center rows so it cannot wipe a neighbouring region.
- **Owner.** Derived each time from the frontend's state: startup, a program reading hidden or single-key input,
  passthrough and idle visuals are `PASSTHROUGH`; the agent view is `AGENT_MESSAGE`; every panel, review, picker and
  the focused agent shelf are `PANEL`; history, directory and find editing are `SEARCH`. Only then a focused region,
  otherwise the composer. Workspace keys are routed after every one of those handlers in `handleKey`, so none of them
  can lose a key; a focused region keeps unbound keys except Ctrl+C/Ctrl+Z/Ctrl+D and the palette.
- **Pointer.** One translation point at the top of `handleKey`: `columnAt` decides; a click focuses a region (or
  returns from one to the composer) and center events continue with center-relative columns. Clicks do not select
  sidebar rows, and the wheel carries no column, so it keeps scrolling the transcript.
- **Sources.** Listed on open and on focus only: the tmux server NMSh runs inside, through tmux from fixed system
  locations (`trustedTmux`), and this repository's worktrees. Nothing polls.
- **Detail panel.** Shows the sidebar selection (`resourceDetail`). Module diagnostics stay in `/modules` details,
  the canonical #365 explain view; the panel does not grow a second one.
- **Commands.** `/sidebar [focus]`, `/panel [focus]`, `/keys [reload]`; `keymap.json` is read at start and on reload.

## QA still required

Automated tests cover geometry, focus routing, protection of owners and drafts, resource bounds and sanitization.
Physical checks remain separate and are not claimed:

- Ghostty and Terminal.app at 200, 120, 100, 89, 80, 70 and 40 columns: docked/compact/drawer transitions, divider
  placement, no horizontal scroll, and that opening a drawer does not reflow the shell.
- Safe glyphs and `NO_COLOR=1`: focus, selection and active markers distinguishable.
- Inside tmux: the sidebar's keys are not consumed by the tmux prefix table; passthrough (vim, less) hides the regions
  and focus returns afterwards.
