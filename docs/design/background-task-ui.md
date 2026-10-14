# Background tasks: task bar, keys, suggestion, manager and output

Issue [#382](https://github.com/raiseCatError/notMyShell/issues/382). Core architecture and integration contract:
[background-tasks.md](background-tasks.md). This slice is pure presentation and input logic in `src/backgroundTasks/`
(`bar.ts`, `suggestion.ts`, `view.ts`, `manager.ts`); it performs no I/O and changes nothing in the running app.
It is wired into the frontend on `release/v0.20.0`; see "As integrated" in [background-tasks.md](background-tasks.md).

## Task bar (`bar.ts`)

Frontend chrome directly above the composer, given rows the way notices are (`withNoticeRows`), so it never covers
the composer or the transcript.

| State | Rows |
| --- | --- |
| No tasks | none: no space, no work |
| Collapsed (default) | one summary: `● 3 background tasks · 2 running · 1 failed` |
| Collapsed, focused | the selected task: `›● adb logcat  04:21  running  1/3  Enter view · x stop · Esc back` |
| Expanded | a header, as many task rows as fit, `+N more · /background lists all`; at most four rows |

`rows()` and `renderTaskBar` share one layout, so the rows reserved are always the rows drawn. Every state has a
mark and a word (Unicode `● ◐ ✓ ✗ ■`, Safe `* ~ + x -`; `running`, `stopping (SIGTERM sent)`, `exited`,
`failed (exit 1)`, `stopped, processes left`), so color only reinforces. Labels are the command family
(`adb logcat`) or the command's first line, width-aware; durations are `mm:ss` or `h:mm:ss` from the task's own
start and end. The keys shown for the selection are the ones that apply to it (`x stop`, `x terminate (SIGTERM)`,
`x kill what is left`, `Del remove`), fitted to the width by dropping whole hints and keeping `Esc back`. In narrow
rows the label outlasts the timer and the long state words: at 40 columns a stopping task still says which task it is.
Removing the selected task selects its neighbour.

## Keyboard

The person asked for Up to reach the bar. Up already recalls history and moves between draft lines, so the rule is
the one NMSh already uses for the agent shelf above the composer:

- **Up enters the bar only from an idle composer**: empty draft, not browsing history, no foreground command running
  or waiting for input, no other owner (passthrough, approval, search, a panel, the agent message box). In every other
  state Up keeps its editor and history meaning. The trade-off is the same as the shelf's: with tasks shown, the
  first Up from an empty prompt goes to the bar; Ctrl+R and Up after typing still reach history. A preference turns
  it off.
- **Shift+Up** from an empty composer always enters the bar (with no draft it has nothing to select).
- **`/background`** (`/bg`) works when the terminal or tmux takes the keys.
- In the bar: ↑↓ select (↓ past the last task returns to the composer below), Enter view output, `x` stop (pressed
  again on a task that has not exited: the next escalation, named on screen), Delete remove a finished task, Space
  expand/collapse, Esc back. Any other typing leaves the bar and is forwarded to the composer, so nothing typed is
  lost.
- **Escalation is paced.** A stronger signal is offered and sent only `ESCALATION_PAUSE_MS` (1.5 s) after the previous
  request; before that `x` says to give the program a moment. A double press or a held key's repeat therefore cannot
  go from SIGINT to SIGKILL before the program could clean up. `/background kill t3` stays the immediate explicit path.
- **Leftovers.** A finished task whose processes still run offers `x kill what is left` (one SIGKILL to its group) and
  cannot be removed until nothing runs, so nothing is orphaned without a way to stop it. `stopChoice` and
  `removalBlocked` are the one rule the bar and the manager share.
- Nothing here runs while a foreground program owns input: the frontend only consults the bar for the composer
  owner, and `entersBar` refuses when a foreground command is busy.

Stop, dismiss and remove stay distinct: `x` stops a running task; leaving a view dismisses it and touches no task;
Delete removes a finished task (never a running one).

## Suggestion (`suggestion.ts`)

Shown when a submitted command is recognized and its family has no remembered decision. Not a modal:

```
↻ adb logcat keeps streaming device logs until it is interrupted.
b background · Enter run here · a always · n don't ask · Esc edit — in the background it runs separately, without this shell's aliases, functions or unexported variables
```

Enter runs the command in the foreground exactly as before, so pressing Enter twice is the old behavior. `b` runs
this invocation in the background, `a` remembers Always for the family, `n` remembers Never, Esc returns to the draft
unchanged. "Likely" families add "(it may keep running)". Below 48 columns it compacts to one row.

`/background run <command>` is the deliberate path: the text after `run ` is kept byte for byte. Programs that need
the terminal or the person (editors, pagers, `sudo`, `ssh`, `top`, `watch`, …) are refused with the reason; commands
with expansions or lists run, with a note that they run in a separate shell.

Subcommands: `run`, `stop t3`, `kill t3` (stop with escalation intent), `remove t3`, `clear`,
`suggestions on|off`, `forget <family>`. `/backgrounds` is not this command.

## Output (`view.ts`)

- **Transcript block**: NMSh-owned, labelled `Background · adb logcat · t4 · running 04:21`, the latest lines (six by
  default), `… N earlier lines (M beyond the retention limit) · /background t4`, the unfinished line while running.
  Foreground command blocks never receive task output. `taskBlockText` gives the plain text for copying, labelled
  with the task.
- **Focused live view** (Enter on a task): header with label, id, state, duration and directory; follows new output
  until the person scrolls back, then stays put and says `N new lines below · End follow`. The scrolled-back position
  is the seq of the first line shown, not a row index, so the retention limit dropping old lines does not move what is
  being read; if those very lines are dropped, the view shows the oldest kept line and says so. While following a live
  task its unfinished line (a progress bar, a prompt without a newline) is the last row.

## Manager (`manager.ts`)

Tasks tab: running first, newest first; details (command with a `(+N more lines)` note, directory, start, end and
status, processes left, lines kept and dropped, the separate-shell note); Enter output, `x` stop, Delete remove, `c`
clear finished. The selection is a task id, not a row: tasks finishing or starting while the manager is open reorder
the list, and `x` or Delete still act on the task the person chose. The list keeps at least three rows, scrolls with
the selection and counts the rows above and below it; the details get the remaining height.
Preferences tab: suggestions, bar, Up, notifications, output kept, finished kept, and the remembered families (←→ or
Enter flips Always/Never, Delete forgets). Changes return new preferences for the caller to save.

## Hostile text

Commands, families and directory names are not NMSh's words: a pasted command or a directory name can carry escape
sequences. `taskText` removes whole escape sequences, controls and bidi overrides before anything is drawn or copied
(tested with an OSC title, a screen clear and an RTL override in the command and an SGR sequence in the directory).

## Not in this slice

Wiring into TerminalApp (submission hook, rows above the composer, key routing, the panel slot, notifications), the
service protocol, and adopting the shared action controls (#369) once it lands. Physical QA: see
[background-tasks.md](background-tasks.md).
