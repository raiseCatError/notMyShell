# Multiline paste: execution modes

A multiline paste (or a typed block with Ctrl+J, or a recipe) that the shell grammar splits into two or more commands
opens **Review commands**. Nothing runs because text was pasted or shown; every mode that executes needs Enter on the
mode.

The review is drawn with the shared components: `framePanel`, the tab strip for the modes, the selected-row band for the
command list, `renderControlRows`. It works at narrow widths (the strip windows around the active mode), with Safe
Glyphs and with `NO_COLOR` (reverse video marks the active mode and the selected row). It has no pointer handling, as
the other review panels have none.

| Mode | What Enter does | Offered when |
|---|---|---|
| **One at a time** (default) | The first command goes to the composer, unsent. Each runs on your own Enter and the next is offered after a success; Esc stops. | Commands were separated. |
| **Queue all** | One confirmation, then the commands run in order without further Enter. Stops on a failure, an interrupt, a paused or cleared queue, or Esc. | Commands were separated, queueing is on, and the longest run of shell commands fits the queue. |
| **Run as block** | The whole paste is one original shell submission (one outer execution). A note warns that shells can read a block differently than line by line. | Shell-only pastes, also when the paste cannot be separated. Never when an NMSh command is in the list. |
| Edit / Cancel | Put the text in the composer for editing / discard it. Nothing is executed. | Always. |

When the paste cannot be separated safely (unclosed quote, a comment that holds shell syntax in zsh, …) only Run as
block, Edit and Cancel remain, Edit is the default, and the reason is shown.

## Queue all and NMSh commands

Queue all is a small sequencer (`src/input/batchSequence.ts`) that owns no queue of its own:

- A run of consecutive **shell** commands is added to the session's queue together. The session owner runs them one at a
  time in the session's shell with its own failure policy, approval, interrupt and session-isolation rules, and `/queue`
  shows them. The sequencer waits for that queue's execution chain to finish.
- An **NMSh command** (`/modules`, `/track …`, `/view`, `/theme`) is dispatched in NMSh through the composer's submit
  path, never added to the shell queue. Comment lines before it are dropped from what is dispatched.
- It never types into a running program. An NMSh step waits for a free prompt, an empty queue, an empty composer and a
  closed panel (a command that opened `/view` or `/modules` holds the next step until it closes). A command waiting for
  input is not answered or bypassed.
- The failure policy is the session's: with **pause** (default) a failure pauses the queue and the sequence stops, with
  **continue** the person chose to go on, but Ctrl+C always stops. Esc at an idle prompt stops what has not started.
  A queue the person paused still accepts the commands, which wait there for `/queue`.
- The strip above the composer shows `Queue all · 2 of 5 · Esc stops`. The commands not started are reported, never run.

NMSh commands have no exit status, so a failed NMSh command is detected only when it throws.

## Verified by

`tests/batchSequence.test.ts` (sequencer with a fake host: order, failure policy, interrupt, clear, Esc, panels, drafts,
busy prompts, queue capacity), `tests/pasteBatchChoice.test.ts`, `tests/pasteSlashCommands.test.ts` (app-level mixed
batches against the real queue owner) and `tests/pasteBatchApp.test.ts`. These are automated and headless: no row of the
physical QA is marked from them.
