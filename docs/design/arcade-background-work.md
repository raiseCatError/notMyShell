# Arcade over background work: Ctrl+T, the strip and toasts

Status: implemented on `feature/arcade-batch3` for v0.23.0. Extends [arcade-expansion.md](arcade-expansion.md) and replaces its
v0.22 rule that the Arcade "never opens over a running command". The Arcade is a **presentation and input surface**; the
shell session is untouched by it.

## What the person gets

1. Start a long noninteractive command (`npm run build`, `npm test`).
2. Press **Ctrl+T**. The Horizon hub opens over the whole terminal; the command keeps running behind it.
3. Play. A one-row **strip** at the top says what runs behind the Arcade (`◷ npm run build running · 12.0s`) and, at the
   right edge, shows short **toasts** (`✓ npm run build finished · 42.0s`, `✕ npm test failed · exit 1 · 3.0s`,
   `◷ Queue waiting for approval`, `✓ Queue finished · 4 commands`).
4. Nothing pauses, closes or steals a key because a command finished. Ctrl+C (or Exit) returns to NMSh, where the real
   output, status, timing and journal are exactly where they would have been.

`/games`, `/game <id>` and `/arcade` behave as before at the prompt. Typed over a running command they stay refused,
because typed text is a program's input; the refusal now points at Ctrl+T.

## Ownership: who may open it, and when

Ctrl+T is a frontend key (`Key.kind === 'arcade'`, bytes `0x14` or Kitty `CSI 116;5 u`). `TerminalApp.handleKey` consumes it
before any composer or program routing and it is **never written to a program**. Opening goes through one function,
`arcadeBlocker()`, which fails closed. Over a running command it opens only when all of these hold; any doubt keeps it closed
and says why in the transcript's usual frontend-interaction line:

| Condition | Why |
|---|---|
| No full-screen/passthrough program, no frontend suspension, no start-up wait, no replay | the program owns the terminal |
| No open panel, queue review, queue edit or queue compose | another surface owns the keys |
| The session advertises `input-state` and `input-look` | otherwise NMSh cannot tell whether the command reads input, so it assumes it might |
| The command has started (`!awaitingExec`) and is not being stopped, finished or in a Ctrl+C/Z type-ahead window | |
| No ownership look in progress (`ownershipLook`) | keys held for it would be replayed into the game |
| No confirmed or likely input request and no terminal owner in `InputState` | the session's own evidence says the command reads the keyboard |

The evidence is the session's `InputState` (InputWatch). Output text is never parsed to decide ownership.

## Opening by typing `/games` (the offer)

While a command runs, a complete, valid Arcade command in NMSh's own composer (`/games`, `/arcade`, `/game`, `/game <id>`) shows
an inline offer after the text: `Open Arcade while the command runs? Enter Open · Esc Cancel`. It is **derived on every
frame, never stored** (`arcadeOffer()`): it exists only while the composer text is exactly one valid Arcade command and
`arcadeBlocker(true)` (the same checks as Ctrl+T) passes, and there is no queue compose/edit, no held-key replay and no
`answersByDefault()` (a program probably reading). So editing the text, Esc, a question, a terminal owner, passthrough, a
queue review or the command ending withdraws it with nothing to replay.

| State | Enter | Esc |
|---|---|---|
| Offer showing | `routeComposer` opens the Arcade (same `openArcade` as Ctrl+T), clears the composer; nothing is queued or sent | clears the composer; nothing queued, approved or run |
| Partial/unknown/invalid command (`/gam`, `/foo`, `/game nosuch`) | the existing path (unknown: shell; invalid game: the existing explanation) | unchanged |
| Program asking, passthrough, ownership look, queue review | the existing path (the program's reply, the review, the hold); no offer | unchanged |
| Idle prompt | `/games` opens at once, no confirmation | unchanged |

Typing characters is never read by the offer: it only observes `editor.text` after NMSh's own ownership look has routed the keys
to the composer. It never inspects a program's stdin.

## Rendering ownership

While the Arcade is open exactly one component paints: `paintArcade`. v0.23 development found the shell's own
presentation-clock subscribers (the running command's activity rows, Chroma dividers, transitions) still firing
`paintPresentation`, which wrote the cached shell frame to the renderer between Arcade frames, so the host alternated
Arcade and shell. Fixed at the root: `paintPresentation` yields to the Arcade (as it does to idle visuals), and opening calls
`cancelPresentation()` so those clocks stop (`render()` recreates them when the Arcade closes). Output chunks repaint the
Arcade at most four times a second. Tests assert the host-bound stream (every `renderer.render` call, and the PTY's real byte
stream) contains no shell frame while the Arcade is open, before and after the fix.

## While it is open

- **Every key is the Arcade's** (the existing early branch in `handleKey`). Nothing reaches the PTY, the composer, history,
  the queue or the transcript. Enter, Space, Ctrl+Q and Ctrl+S inside a game mean what the game says; none approves,
  queues or sends. Ctrl+C closes the Arcade only; it never interrupts the command.
- **The session is not touched**: no second shell, no detach, no resize (`ptyRows` is unchanged), no kill. The same command
  object, start id and timing continue; `OutputBuffer`, the journal and activity observers keep receiving every chunk.
- **Output is recorded but not painted.** `render()` already takes the Arcade branch, so shell output cannot paint over the
  Arcade (verified with a real `ESC[2J ESC[H` after the Arcade opened). `onShellData` repaints the Arcade at most four times
  a second for output (the transcript is invisible then), so a burst costs the same as a quiet command. Retained output is
  still bounded by `OutputBuffer`'s own limits.
- **Leaving repaints the real transcript** through the existing `closeArcade` path (invalidate and render from untouched
  state).

### A program asks for input, or takes the terminal

`onInputState` informs the Arcade (`arcadeInputState`):

- A **request** (confirmed or likely, from `InputState.request`, never from text): the running game **pauses**, the strip
  shows `◆ <program> is waiting for input` (or `may be` for a likely request), and a toast is raised once. No key is
  forwarded. The person leaves with Ctrl+C or Exit; the program, its state and its question are untouched, and the shell's
  ordinary input ownership (direct hidden/key input, held type-ahead) applies again. Keys typed in the game were consumed by
  the game and are not replayed.
- A **terminal owner** (a native reader) or any **passthrough** (`render()` also closes the Arcade whenever
  `passthrough`, `externalPassthrough` or `frontendSuspended` is set): the Arcade **closes** with a note, because the
  program must receive keys directly.

### The queue

The Arcade never calls `session.queue`. It reads `QueueState` transitions (`arcadeQueueNews`) and nothing else:

- Already-authorised entries start by the queue's own rules. `onShellExec` keeps the Arcade open only when the start carries a
  queued entry (`queued !== undefined`); a start from another window or type-ahead still closes it (v0.22 behaviour).
- A held/`approve` entry stays held: the strip says `Queue waiting for approval`; no Arcade key is ever a queue operation.
- A failed queued entry pauses the queue exactly as before (the strip says `Queue paused`); later entries do not run.
- Opening the Arcade does not change pause/resume, ordering, exactly-once execution or Enter/Ctrl+Q semantics. Attribution
  of command to event is #473's open edge: the Arcade adds no attribution of its own, it only reports the events the existing
  handlers already emit, keyed by the command's start id.

## Presentation architecture

One owner, one adapter, no game knowledge:

```
shell/queue/input events ──► TerminalApp (noteBackground / arcadeQueueNews / arcadeInputState)
                                   │ ActivityEvent (label, status, duration only)
                                   ▼
                          BackgroundActivity  (src/notifications/backgroundActivity.ts)
                          history ≤ 24, seen keys ≤ 64, unread ≤ 99, one toast
                                   │ ArcadeCompanion { view, history, markRead, running }  (read-only)
                                   ▼
                          ArcadeSession  (reserved strip row, notifications log)
```

- `BackgroundActivity` exists only for the lifetime of an open Arcade and is fed only while it is open. It is presentation
  state: never written to the transcript, journal, history or clipboard. Closing the Arcade cancels its one scheduled repaint
  (`arcadeToast`) and drops it; shell/queue/journal handling never depended on it.
- Games see none of it. `ArcadeSession` lays games out in the viewport minus the strip and shifts pointer rows by one.
- Future full-screen experiences can take the same `ArcadeCompanion` shape.

### The strip and toasts

- The strip row is **reserved from the moment the Arcade opens with a command running or queue entries waiting**, and when a
  queued entry starts behind a bare Arcade (the game re-lays out through the existing `resize` path; it is not restarted). It is
  constant while a session runs, so a toast **never resizes or covers a game**.
- It needs 14 rows and 40 columns. Smaller terminals keep every row for the game and show a one-glyph marker plus the unread
  count in the row that is not gameplay (the Stage's controls row, the hub header, or the tiny hub's title line); the detail is
  in the log.
- A toast shows 3.6 s (extended to at most 8 s while a burst keeps arriving), slides in over 180 ms and out over 240 ms, and is
  static under Reduced Motion or Effects Off. Glyph + words carry meaning: `✓`/`✕`/`⊘`/`◷`, `+`/`x`/`-`/`!` in Safe Glyphs;
  NO_COLOR keeps the same text.
- **Coalescing**: bursts become `N commands finished · M failed`; a queue chain's own summary replaces the per-command toast;
  a quiet success never hides an attention toast, a failure always replaces one. Duplicate events are dropped by key.
- **Log**: `n` in the hub and *Notifications* in the pause sheet show the last 24 entries, newest first, with ages, and say that
  the output is in NMSh. Any key returns.
- **Privacy**: text comes only from a *label* (the program word, plus a script/verb for `npm|pnpm|yarn|bun run X|test|build…`),
  a status and a duration. Arguments, paths, tokens and output never appear. Nothing derives from command output.

## Resource lifecycle

One `presentationClock.after` for the next toast boundary or the next second of the running clock (none when neither exists);
the Arcade's existing frame subscription gains a 40 ms rate only while a toast moves. `closeArcade` cancels both; tests assert
no leaked subscription or timer after repeated open/close. No polling, no new process, no dependency.

## What this does not do

- It does not make the Arcade available over interactive programs. Passwords, editors, pagers, tmux and full-screen
  programs keep the old rule; an unknown ownership state keeps it closed.
- It does not detect "the program is probably done reading" from output. A question the session cannot prove is not a
  question; the Arcade then stays as it is, and the person can leave at any time.
- A command that begins *because of type-ahead or another window* still closes the Arcade.
- Two `Date.now`-based clocks drive the strip (command start and toast age); they are for display only.

## Tests

`tests/backgroundActivity.test.ts` (manager), `tests/arcadeCompanion.test.ts` (session layout, motion, glyph, log, pointer
rows), `tests/arcadeBackground.test.ts` (the real `TerminalApp` with a PTY session that throws on any write: ownership
refusals, no-write proof, queue approval safety, failure policy, bursts, input requests, passthrough, lifecycle),
`tests/arcadeBackgroundLive.test.ts` (a real zsh in a real PTY and session service: same session and shell, the command
unharmed, bursty output recorded, late `ESC[2J` kept off the Arcade, no game key becomes a command).
