---
title: Queue and background tasks
description: Run a sequence in your shell, review the queue and keep long-running tools alongside it.
group: Daily work
order: 6.2
sources: [src/commands/slashCommands.ts, src/prompt/configuration.ts, docs/design/terminal-workflow.md, docs/design/background-tasks.md, docs/development/slice-3-stabilization.md]
---

## Two different ways to keep work moving

A **queue** runs commands one at a time in the same persistent shell. A **background
task** runs in a separate session-owned PTY. Choose the queue when commands need
the shell's continuing state; choose a background task for a dev server or log stream
that should not occupy the foreground.

## Queue commands in order

While a command runs, compose the next one and submit it to the queue. Commands run
serially, so a directory or environment change can affect later entries. Program
input takes priority: when the foreground program needs an answer, NMSh must not
treat that answer as a queued command. Ctrl+Q opens queue composition; Ctrl+S sends
composer text to direct program input when that input path is available.

| Action | Behavior |
| --- | --- |
| `/queue` or `/q` | Inspect and manage the queue |
| `/pause` or `/qp` | Pause pending work |
| `/qr` | Review before resuming |
| `/qc` | Review before clearing |
| `/settings queue` | Queue behavior, timeline, output and motion preferences |
| `/queue history` | Inspect recent settled chains |
| `/queue save-summary` | Review the exact text before saving a summary |

By default, failure or interruption pauses pending work. Resuming and clearing are deliberate
actions, not automatic recovery. A saved summary records what happened; opening it
does not restore executable queue entries or run anything again.

An entry can require its own approval; editing it withdraws that approval. Explicitly
marking an entry `always` allows it to run after a plain failure, never after an
interrupt. Review those conditions along with the commands, not just the queue order.

## When a command needs input

NMSh uses terminal-state evidence to distinguish running work from a program that
needs an answer. Confirmed password/no-echo and single-key reads go directly to the
program without being displayed or kept. An ordinary line question can be shown as
“Probably waiting for input” rather than being presented as certain.

The question stays near the composer while you inspect earlier output. Enter answers
the program; Ctrl+Q is the separate route for composing queued work. If the program
ends before you send a reply, NMSh discards that reply instead of running it as a
shell command. These protections do not make arbitrary program prompts trustworthy.

## Follow the sequence without losing the output

The execution timeline shows running, recent and upcoming commands. In the current
candidate it starts enabled, with two recent and two upcoming entries and an
eight-second completed-chain display.

Queued output starts **Inline**. The optional **Fold** setting collapses eligible
successful output while retaining the full text. Failures, interruptions and active
inspection remain visible. Ctrl+O reverses the relevant fold state. Folding does not
discard lines or shorten what plain-text copy receives.

Fresh Recommended configurations enable typed queue-summary saving. Existing saved
configurations with that field omitted keep the historical Off behavior; selecting
a different starting point can also change the preference. Automatic summaries omit
raw command arguments and output. Check the saved text and retention settings before
sharing it. The final release's first-run defaults remain a launch validation item.

## Review multiline pastes

A multiline paste can be run as one block, queued separately, kept for editing or
cancelled. Tab, arrows and number keys move the choice; **Enter confirms**. NMSh
refuses separate queueing when it cannot safely split the pasted shell structure.
Reviewing a paste is not a guarantee that its commands are safe.

## Run a background task

```sh
/background run tail -f ./application.log
```

Use an actual log path in place of `./application.log`. `/bg run` is an alias.
The task inherits the shell's working directory and exported PATH. It does **not**
inherit shell aliases, functions or unexported variables, and it does not become a
job in the foreground shell.

Open `/background` for the manager. Up from an idle composer reaches the agent
shelf first if present, then the task bar; Shift+Up can focus the task bar. Enter
opens output, `x` requests a stop, and Delete removes a finished task. Esc returns.
Stronger stop signals are paced; a held key must not skip straight to killing.
“Stopping” is a request state, not proof that the process has exited.

Task output is bounded and kept separate from the shell transcript. It does not
enter `/copy`, reports or comparisons. Tasks survive frontend detach and return
with the live session; ending that session ends its tasks. This requires the
matching session service and POSIX process groups on macOS, Linux or WSL 2.

Background suggestions start **Off**. `/background suggestions on` opts in to
recognized command-family suggestions. In that prompt, `b` backgrounds once,
Enter runs in the foreground, `a` remembers Always, `n` remembers Never and Esc
returns to the draft. Ordinary commands do not move to the background by themselves.

See [background task architecture](/docs/reference/background-tasks/) and
[terminal workflow design](/docs/reference/terminal-workflow/) for the underlying
contracts and historical design context.
