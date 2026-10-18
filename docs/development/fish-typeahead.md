# Fish keystroke loss after `read`

## Fish 3.7 input ownership (2026-10-11)

The published queue head `7fb6b5a` fails both Fish read tests on Ubuntu 24.04 / Fish 3.7.0:
`tests/inputAwarenessLive.test.ts` (read handover) and `tests/typingAfterRead.test.ts`. Reproduced in a disposable
Linux arm64 VM with Node 26.10.0, independently of the Ubuntu amd64 Actions run `38071796100`. The answer remains
in NMSh's composer or queue while Fish's reader waits. This is a routing bug, not the Fish 4 type-ahead limit below.

Fish 3.7's `__fish_config_interactive.fish` explicitly does not enable bracketed paste in `read`; its line editor
therefore does not supply the terminal-mode signal the frontend previously used for handover. Process probes and
an open-line heuristic cannot reliably recognize a reader that redraws its prompt. `answersByDefault` was not the
cause: it correctly keeps ordinary commands in the queue when no input request is known.

The adapter now uses Fish's own `fish_read` event (also emitted for a read inside a function) to send an authenticated
private `reader` marker. The session broadcasts terminal ownership before forwarding the prompt; the frontend
hands over the terminal until Fish returns to its command prompt. This also covers hidden reads and `read; cat`
without enabling extra terminal modes. Detached sessions retain this ownership for reattach. The marker never
enters raw program output, transcript content or clipboard text.

Regressions cover authentication and split markers, ownership lifecycle and serialization, real hidden-reader
detach/reattach, and input after completion. The typing test builds a unique prompt for each iteration: a historical
redraw of an earlier prompt must not authorize sending an answer to the current command.

Separate CI findings: multiline submission must use Fish's `begin`/`end`, rather than the brace group accepted by
Fish 4 and POSIX shells. The Ctrl+C survivor fixture must wait until its trap is installed, use a shell supporting
`read -t` (Ubuntu `/bin/sh` is dash), and remain alive until the assertion releases it. These corrections preserve
the same-shell queue and test actual routing rather than timing a fixed sleep.

Physical Ghostty/Terminal.app interaction remains unvalidated. The following investigation concerns Fish 4 only.

## Historical Fish 4 investigation

Investigated on 2026-10-10 with fish 4.9.3, zsh 5.9 and Bash 5.3 on macOS 27.

## Symptom

Under load, keys typed quickly after a fish `read` (fish's own line editor, which NMSh hands the terminal) could
vanish: the command never appeared in the composer and never ran. zsh and Bash were not affected.

## Cause

Two layers, measured separately.

**Fish.** Each time fish 4's line editor starts (its prompt and its `read` builtin), it queries the terminal
(background colour `OSC 11`, cursor position `CSI 6n`, primary device attributes `CSI c`) and waits for the device
attributes answer. Keys that are already queued when such a wait starts are dropped. This happens in a plain PTY
with no NMSh involved. Typing an answer and the next command in one burst while `read -s` runs, 10 runs per row,
under CPU load:

| Terminal answers | fish `read` kept | fish `read -s` kept | zsh / Bash kept |
|---|---|---|---|
| in the same read as the query | 10/10 | 8/10 | 10/10 |
| one event-loop tick later | 5/10 | 8/10 | 10/10 |

**NMSh.** In passthrough, fish's queries made a round trip through the session service, the frontend and the host
terminal and back: tens of milliseconds per query round, and fish asks in back-to-back rounds. Keys typed in that window
also reached fish before the answers. Through NMSh, type-ahead during a fish `read` was lost 8 of 8 times; typing
after the command was shown complete was never lost. The live test that first showed the loss typed ahead by
accident: it waited for any "Completed", which matched the previous command's row.

## Fix

- **Fish's editor is answered the same way wherever it runs.** At the prompt NMSh already answered fish's device
  attributes query itself and kept its queries from the host. When the terminal's foreground process is fish itself
  (its `read` builtin), `ShellSession` now does the same (`ShellAdapter.editorQueries`). The answer is written in the
  same event-loop turn as the query arrives, which matches the first row above.
- **Input waits until fish has redrawn its prompt.** Fish asks again as soon as it is answered and redraws, so
  answering alone is not enough. Keys could reach fish after its next question and before NMSh had read that question
  from the PTY. That happened in the full test suite under load: an answer typed after fish showed `Name: ` was lost.
  After NMSh answers fish's editor, input waits for the editor's own prompt-drawn mark (OSC 133;B), answering any
  further rounds on the way. This holds at fish's prompt and in its `read`, with the same bounded fallback.
- **Keys never overtake an answer** (`src/shell/QueryOrder.ts`). For any program, from the moment it asks for device
  attributes until the answer is delivered, other input is held and then delivered right after the answer, with
  answers to other queries first. A host that never answers cannot stall typing: held input goes through after 500 ms,
  or at once beyond 64 KiB.
- **Safety.** Ctrl+C discards held input, as a terminal's Ctrl+C discards pending input, so a cancelled line never
  arrives after the interrupt. Bracketed pastes are opaque: answer-like bytes inside a paste never end a hold and are
  never moved.

After the fix, under the same load, type-ahead during a fish `read` is kept in 6 of 10 runs (zsh and Bash 10 of 10),
in line with native fish. Keys typed once the command is shown complete are kept in every run on all three shells.

## Remaining limit

Type-ahead typed while a fish `read` is still running can be dropped by fish itself, as in any terminal. It is an
upstream fish behavior, not something NMSh can reorder: those keys are already in fish's input queue before fish asks.
Typing after the command finishes is unaffected.

## Tests

- `tests/queryOrder.test.ts`: the ordering rules, and a real fish `read` whose queries never reach the host. It fails
  without the fix.
- `tests/typingAfterRead.test.ts` (live): six reads per shell, with the next command typed the moment each read
  finishes. zsh and Bash also type ahead during `read`. No loss is tolerated.
