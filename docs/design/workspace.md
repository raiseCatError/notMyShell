# Workspace: sidebar, detail panel and regional focus

Program: [#330](https://github.com/raiseCatError/notMyShell/issues/330). This document covers the shared foundation
(`src/workspace/`) that the Workspace Sidebar (#331), the contextual detail panel (#332) and the semantic keymap
(#335) build on, and the narrow contract by which the frontend (`src/app/TerminalApp.ts`) adopts them.

Status: **foundation modules and tests only.** Nothing here is wired into the running app yet; `TerminalApp.ts` is
not modified by this slice (see [Integration contract](#integration-contract)).

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
| `drawer` | drawn over the center while open | **unchanged**: opening/closing never resizes the shell |
| `hidden` | closed, or suppressed by fullscreen/raw passthrough or an idle screen | full width |

Constants (cells): center minimum 60, sidebar docked 28 / compact 18, panel 36–72 (default about 38% of the width),
drawer minimum 24 (narrower terminals give a drawer the whole width). A docked region never squeezes the center below
60; it becomes a drawer instead. Sidebar first (docked, then compact), then the panel; when both are open and do not
fit, the sidebar narrows to compact before the panel becomes a drawer. The plan is a pure function of its input, so
resizing back restores the earlier layout. `columnAt` gives pointer hits (drawers win where they overlap);
`frameColumn` maps a center-relative column to the frame.

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
  opening a region does not steal focus; Tab cycles composer → sidebar → panel, skipping closed regions.
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
has controls, format characters and newlines removed.

Selection never activates. Moving the selection may ask for a **cached, read-only** preview in the detail panel; only
Enter/→ (or the same semantic action from the pointer) activates.

## Keymap (`keymapConfig.ts`, #335)

A person's keymap is declarative data, validated before use, and never executed:

```json
{"version": 1,
 "bind": [{"key": "Left", "context": "composerEmpty", "action": "sidebar.focus", "replaces": true}],
 "unbind": [{"key": "q", "context": "panel"}]}
```

- **Bindable keys** are only those NMSh's input parser tells apart: `Up Down Left Right Home End PageUp PageDown Tab
  Shift+Tab Esc Enter Backspace Ctrl+O Ctrl+F Ctrl+G Ctrl+N Ctrl+P Ctrl+R Ctrl+X F1` and single printable characters.
  Anything else (`Ctrl+B`, `Cmd+K`, `Alt+Left`) is refused with the reason: the terminal may send it as something
  else or not at all.
- **Never bindable**: Ctrl+C/D/Z (job control), paste, pointer and focus events; in the composer also typing and
  Enter.
- **Composer bindings replace a meaning**, and must say so. Every bindable key already does something with an empty
  draft (Left opens Sessions, Right accepts the inline suggestion, Up recalls history, Tab completes, Shift+Tab moves
  through blocks, …, recorded in `COMPOSER_MEANINGS` from the composer's dispatch); a binding there needs
  `"replaces": true`, and an active draft still wins.
- **Actions per context**: the composer takes only focus/visibility actions; regions take their own actions plus
  focus actions.
- **Conflicts** (one key twice in a context) are errors, the first binding kept. Invalid entries are skipped and
  reported; the defaults stand where an entry failed.
- **Unreachable features are reported**: an action left with no key and no command, or a sidebar with no way back to
  the composer, is a warning (the slash commands still work).
- **Host notes** (`hostNotes`) say when a key usually never reaches NMSh: Terminal.app scrolls its own window on Page
  Up/Down and Home/End, macOS may take F1, a tmux root-table binding (`bind -n`) takes the key first, and Esc waits
  for tmux's `escape-time`. These are notes, never delivery guarantees.
- `describeKeymap` lists every binding in effect and the commands that always work.

Integration: the keymap file lives beside NMSh's other configuration (`keymap.json` in the config directory), is read
at start and on `/keys reload`, and `/keys` shows `describeKeymap` plus problems and host notes. Those commands are
part of the integration step.

## Integration contract

Integration into `TerminalApp.ts` is deliberately a separate, later step: that file is under active input-routing
stabilization on the workflow track (#359), and this slice does not touch it. When the stabilization checkpoint is
published, the adoption is:

1. **State.** The app holds one `WorkspaceFocusState` and the sidebar/panel controllers (later slices). Persisted:
   only `sidebarOpen`/`panelOpen` preferences and the panel width.
2. **Geometry.** Each frame computes `planWorkspaceColumns({columns, sidebarOpen, panelOpen, suppressed})` beside
   ScreenPlan. Transcript and composer render into `center` (center-relative columns); `ptyColumns` replaces the
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

## QA still required

Automated tests cover geometry, focus routing, protection of owners and drafts, resource bounds and sanitization.
Physical checks remain separate and are not claimed:

- Ghostty and Terminal.app at 200, 120, 100, 89, 80, 70 and 40 columns: docked/compact/drawer transitions, divider
  placement, no horizontal scroll, and that opening a drawer does not reflow the shell.
- Safe glyphs and `NO_COLOR=1`: focus, selection and active markers distinguishable.
- Inside tmux: the sidebar's keys are not consumed by the tmux prefix table; passthrough (vim, less) hides the regions
  and focus returns afterwards.
