# Input awareness: when a command needs you

A running command that waits for an answer (`e2fsck`'s `Fix<y>?`, a password, `rm -i`, a `read` prompt) used to look
like any other running command: `Running · 30s`. NMSh now tells the two apart, shows the question where it stays in
view, routes typing the way the program reads it, and keeps waiting time separate from execution time.

Verified on macOS 27 (zsh 5.9, Bash 5.3, Fish 4.9) on 2026-10-10. The Linux kernel layer is implemented and unit-tested
against the kernel's documented `/proc` formats, but it has not been run on a Linux host in this change.

## Principles

- **NMSh stays a frontend over the real shell.** It reads the terminal's own state and the process table. It never
  pauses, signals or writes to a program to find out, and it never answers for you.
- **One authoritative state.** `InputWatch` runs beside the PTY: in the session service, or in-process when there is
  no service. It publishes one `InputState` that every surface renders: the live activity line, the composer, the
  window title, `/sessions`, `/resume` and cross-session notices. No surface infers anything on its own.
- **Silence is not evidence.** A quiet process might be sleeping, computing or waiting on the network. A request needs
  positive evidence, and its confidence is shown in words.

## What NMSh can know, and how

| Layer | Signal | Platforms | Confidence |
|---|---|---|---|
| Kernel | A foreground thread is blocked in `read()` on this terminal (`/proc/PID/task/TID/syscall` plus the fd's link). If every thread is blocked elsewhere, that vetoes the other layers. | Linux | confirmed |
| Terminal line settings | `stty -a` on the PTY device: echo off with line input on means a hidden line (password). Line input off with a prompt left open on the cursor's line means single keys (`e2fsck`, `read -k`, `read -n1`). | macOS, Linux | confirmed |
| The shell holds its terminal | While a command runs, the shell itself (the terminal's session leader, ps state `s`) is the foreground group: one of its builtins has the terminal. Line input off there means single keys (`read -k 1`, `read -n 1`, no prompt needed); ordinary line settings with the shell idle across two samples (the second 100 ms after the first) mean a line read (`read -r reply`). A loop's shell between commands is seen for one sample only and is not a request. | macOS, Linux | confirmed (keys), likely (line) |
| Prompt evidence | A question-shaped line left open (ends in `?`, `:`, `]`, `)`, `>`), written once and never rewritten or cursor-drawn, output quiet for 0.7 s or more, and the foreground group idle across two samples (nothing running on a CPU, no CPU time gained). | macOS, Linux | likely |

Raw mode alone is never a request: spinners and terminal proxies (`docker run -it`) set it without asking anything. A
program that owns the terminal is never reported, because it draws and reads its own interface. That covers the
alternate screen, bracketed paste, mouse or focus reporting, the kitty keyboard protocol, and NMSh's known full-screen
commands.

**Reliable:** password and other no-echo reads (`sudo`, `ssh`, `getpass`, `read -s`); single-key questions (`e2fsck`,
`read -k1`, `read -n1`, menu libraries that read keys); on Linux, any blocking read of the terminal, including prompts
that end with a newline.

**Inferred (shown as "Probably waiting for input"):** ordinary line reads on macOS, such as `read -p`, `rm -i`, Python
`input()` and `apt`'s `[Y/n]`. macOS exposes no wait channel without privileges (`ps -o wchan` is empty for every
process), so the open question plus an idle process is the best available evidence.

**Not detected generically:**
- Line reads on macOS by programs other than the shell whose prompt ends with a newline, or that print no prompt at all
  (`cat`, Python `input()` with no prompt). The shell's own `read` is detected with or without a prompt.
- On macOS, a `wait` builtin looks like a line read (the shell holds the terminal, idle); it is shown as "Probably".
  Linux's kernel report tells them apart.
- The shell's own prompt hooks are never taken for the command reading (#436). After a command ends, zsh and Bash run
  their prompt hooks (the person's and NMSh's) before the prompt marker, and a slow hook holds the terminal, idle, as a
  builtin `read` does. Each shell's first hook prints an authenticated `done` marker; from it to the next command
  nothing is sampled and a sample already under way is dropped. zsh's single `precmd` function and Fish's other
  postexec handlers can run before it.
- A question that began before Ctrl+C or Ctrl+Z, reported late, is the one the stop ended: the frontend drops it, so it
  never turns what was typed after the stop into a reply (#436).
- Programs reading through `poll`/`select` on macOS.
- Programs that own the terminal. Fish 4's own `read` is one: it is fish's line editor, with bracketed paste and OSC 133
  marks, so NMSh hands it the terminal and fish answers natively. It is not reported as waiting.

In all of these cases NMSh shows "Running", as before.

**False-positive guards:**
- **Builds:** busy CPU or a process in state `R`.
- **`sleep`, network waits, background tasks:** no question left open.
- **Progress bars:** a carriage-return rewrite marks the line unreliable.
- **Status lines:** `Downloading...` is not question-shaped, and cursor-drawn lines are ignored.
- **Log streams:** no open line, and probes are rate-limited.
- **Questions printed as ordinary output:** later output ends the wait at once.
- **Interactive full-screen or inline programs:** they own the terminal.

### Looking on demand

Probes back off (every 10 s after a minute of quiet), and the first look comes 150–400 ms after a command starts. A key
typed in that time would be routed on no evidence. So the frontend holds the keys that decide where typing goes, the
first key of a draft and an Enter that would queue, and asks the session to look now (`input-look`, answered by
`input-looked` after any `input-state` the look produced). Keys typed right after Enter wait for the shell's exec first.
The hold ends when the look is done, when evidence arrives, or after 800 ms, and the keys are then routed on what is
known, in the order typed. A program that took the terminal meanwhile (Fish's reader) gets them as raw keys. Ctrl+C is
never held, and typing right after Ctrl+C or Ctrl+Z stays type-ahead for the prompt. Both ends negotiate the feature;
an older service is never asked and behaves as before.

When an answer goes to the program (a key in key mode, Enter otherwise), the frontend counts the question as answered
until the session reports again, so the next command typed at speed is routed on fresh evidence.

### Cost

Probes start only after a running command's output goes quiet:
- **First look:** 150 ms after quiet with a line left open, 400 ms otherwise.
- **Then:** at 1 s and 2.5 s, every 3 s, and every 10 s after a minute of quiet.
- **Closed line:** at most one look every 2 s.

Each look runs `/bin/stty -a` and `/bin/ps` (plus `/proc` reads on Linux) with fixed arguments and a 1.5 s timeout. A
probe that started before newer output is discarded.

## States and time

- **Running:** no credible request. The line keeps its shimmer and adds `· waited 18s` once the command has waited.
- **Waiting for input** (◆, attention color and weight) or **Probably waiting for input** (◇): the attention line plus the open
  question.
- **Running again:** after an answer (a key in key mode, Enter otherwise, or Ctrl+C or Ctrl+D), or when the program
  writes again.
- **Completed, failed or interrupted:** unchanged.

`durationMs` stays the whole wall-clock time. Waiting is measured separately:
- **Start:** when the program wrote the prompt it waits on.
- **End:** at the answer, at new output, or at completion.
- **Evidence that simply disappears:** if a read times out silently, the wait ends at the look that saw it gone, so
  that one boundary is accurate to within a probe interval.

Intervals are summed per command and carried with the completing prompt (`inputWaitMs`, `inputWaits`), so they survive
detach and replay. They are recorded on the transcript record, and the completion row reads
`✔ Completed · 1m 25s · 18s waiting for input (2 prompts) · 15:42`. Active time is not shown: waiting is the only
boundary NMSh observes.

## Presentation

The activity region already reserves two rows while a command runs (the working line and a spacer). A wait uses both,
so nothing new is reserved and the PTY never resizes:

```
◆ Waiting for input · e2fsck · 18.0s · 1m 40s total
  Padding at end of inode bitmap is not set. Fix<y>?
❯ Press a key · it goes straight to e2fsck · Ctrl+Q queues a command
```

A read that left no question says what it reads, and the composer says how to answer, once:

```
◇ Probably waiting for input · zsh · 3.2s
  zsh is probably reading a line
❯ Type your answer · Enter sends it to zsh · Ctrl+Q queues a command
```

Hidden input: `Hidden input · nothing you type is shown · Enter sends it to sudo · Ctrl+Q queues a command`. Nothing
typed is drawn, not even as dots.

- **Its own color:** the attention hue (cyan) on the headline and the composer's `❯`, apart from running (lavender
  shimmer), paused (amber), failed (red) and done (green). `/sessions` and `/resume` rows for a waiting session use it
  too. The instruction reads at secondary contrast, not the subtle tier.
- **Said once:** the activity rows carry the state and the question; the composer carries the instruction.
- **The question stays in view** however far the transcript has scrolled or folded.
- **Narrow widths:** the line drops detail first (total time, then program name); the question keeps its row.
- **No animation:** no shimmer and no flashing. The timer only counts.
- **NO_COLOR:** keeps the weight and the glyph.
- **Safe glyphs:** `!` for confirmed and `?` for likely.
- **Window title:** reads `◆ e2fsck needs input · project`, so a background tab shows it.

## Input ownership

- **Line input** (confirmed or likely): the composer is the line editor, as before. Enter sends the line to the running
  program, never to the shell. A reply that is still unsent when the command ends is discarded with a note. It never
  runs as the next command.
- **Hidden lines and single keys** (confirmed): each key goes straight to the program as the bytes a plain terminal
  sends, so line-discipline editing, Enter-as-default and no-echo all behave natively.
  - The composer shows only where typing goes. A draft typed before the question appeared stays hidden and untouched.
  - Keys typed after the question appeared, in the moment before NMSh knew how the program reads, are handed over as a
    terminal would have delivered them.
  - Ctrl+C, Ctrl+D and Ctrl+Z keep their meaning, and PageUp/PageDown and the wheel still scroll the transcript.
  - NMSh gestures and pointer events are never sent.
  - Nothing typed is shown, journaled, put in history or written to the key-debug log.
- **There are no answer buttons.** NMSh never submits an answer on your behalf.

## Other sessions

The service is the one owner of every session's state:
- **`/sessions` and `/resume`** lead the row with `◆ Waiting for input` and the question.
- **Cross-session notice:** a wait that lasts 3 s becomes one sticky notice in other windows, for example
  `Mango · e2fsck is waiting for input · 2m · /resume`. It is withdrawn when the wait ends or the session is focused.
- **Returning:** go back through `/resume`, which attaches. Attaching shows the waiting question; nothing is answered
  automatically.
- **Older frontends:** the frontend lists `input-state` in its hello. An older frontend gets neither the new message
  nor the new notice kind, so it never rejects a frame.

## Managed agents

Managed Claude sessions (`/claude`) do not run in a PTY. Their permission requests and questions arrive as structured
events, and the agent view already marks them with the same ◆ attention. Input awareness never parses an agent's
screen. A coding agent run as a shell command (`claude`, `codex`) owns the terminal, so NMSh hands it over and reports
it through its own attention signals (bell, OSC 9/777), not as "waiting for input".

## Files

- `src/session/InputWatch.ts`: the decision and timing (one per session, beside the PTY).
- `src/session/terminalProbe.ts`: read-only `stty`, `ps` and `/proc` facts.
- `src/session/openLine.ts`: the open line and the prompt shape.
- `src/session/inputState.ts`: the shared state.
- Protocol, service and clients: `SessionProtocol.ts` (`input-state`, `CLIENT_FEATURES`), `SessionService.ts`,
  `SocketSessionClient.ts`, `InProcessSessionClient.ts`.
- `src/status/inputStatus.ts`: wording and painting.
- `src/terminal/keyBytes.ts`: direct key bytes.
- Tests: `tests/inputAwareness.test.ts` (unit) and `tests/inputAwarenessLive.test.ts` (real PTY: zsh, Bash, Fish, detach
  and reattach, other windows, narrow, NO_COLOR and Safe). The harmless e2fsck-style fixture is `tests/fixtures/askyn.py`.
