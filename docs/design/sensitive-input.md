# Sensitive input: masking, hiding and revealing (architecture, 2026-10-16)

**Status: architecture for review before any implementation**, as requested. Post-v0.20, its own feature branch,
security review and real-PTY coverage; it does not touch the verified v0.19/v0.20 input fixes.

## Today (v0.19/v0.20 stabilization)

`InputWatch` (beside the PTY) reports a request `{mode: line | hidden | key, confidence: confirmed | likely}`:
`hidden` = the terminal is in **canonical mode with echo off** (confirmed); `key` = canonical mode off with a prompt
open, or the shell's own key read (confirmed). For confirmed `hidden` and `key` requests (`directInput()`), every
key goes straight to the PTY as typed (`sendDirectKey`); NMSh keeps nothing and draws nothing ("Hidden input ·
nothing you type is shown"). Ordinary `line` requests are composer-owned: the composer edits the line and Enter sends
it.

## The core finding

A **confirmed hidden** request is a canonical-mode read. In canonical mode the kernel's line discipline holds the line
and applies its own editing (VERASE, VKILL, VWERASE) until Enter; the program receives nothing before Enter. So NMSh
can own that line exactly like an ordinary line read — edit it in the composer and send it once on Enter — **without
changing what the program receives**. That makes masking and an exact character count possible without guessing the
program's editing, and reveal possible from the composer's own buffer.

A program that reads with canonical mode **off** (its own line editor, e.g. many Node/Go prompt libraries that draw
their own `*`) is reported as `key`. NMSh cannot know that program's buffer: it keeps forwarding each key as today,
shows no count and offers **no reveal**. The program's own masking is what the person sees.

## Proposed architecture

| Request | Classification | Composer behaviour | Bytes to the program |
|---|---|---|---|
| confirmed `hidden` | **sensitive (authoritative)** | composer-owned sensitive line; Masked by default (`•`/`*` per grapheme), Hidden (nothing, no count) or Plaintext (after confirmation) | the whole line on Enter, once |
| `line` whose open prompt matches a bounded sensitive wording list (password, passphrase, passcode, PIN, token, API key, secret, OTP …, word-boundary, case-insensitive, prompt text only, ≤ 200 chars) | **sensitive (wording, not proof)** | Masked by default with the same modes; the hint says *"This program shows what you type itself"* when the terminal echoes, because it does: on Enter the kernel echoes the line into the output and NMSh must not hide or rewrite program output | the whole line on Enter (unchanged from today's line reads) |
| other `line` | ordinary | normal text, no masking controls | unchanged |
| confirmed `key` (`[y/N]`, `read -k`, raw-mode prompt libraries) | single key / program-owned | no asterisks, no buffer; each key forwarded at once; Esc and Ctrl+C keep their meaning | unchanged |

Echo-on wording matches are deliberately only presentation in the composer: NMSh never changes the terminal's echo
mode and never claims that masking its own composer stops the program or the terminal from showing the value.

### The ephemeral buffer

- Lives only in the frontend's composer for the active request, as a separate `SensitiveDraft` object, never in the
  ordinary `EditorState`, so history, suggestions, completion, Ask, `/copy`, `/compare`, reports, session previews
  and draft journaling (none of which can see it) need no special cases that could be missed.
- Never sent to the session service or journal, never in configuration, transcript, archives, crash reports or debug
  key logs (`NMSH_DEBUG_KEYS` prints key kinds only while it exists).
- Cleared (references dropped) on Enter, Esc-cancel, Ctrl+C, Ctrl+Z, the request ending, the process exiting,
  ownership changing, detach, session end and frontend exit. JavaScript cannot guarantee memory zeroization; the doc
  and help say so and NMSh does not claim it. Strings are not retained in closures, logs or undo stacks (no undo for
  this draft).
- **Detach while typing a secret discards it** (the program has received nothing yet); on reattach the person types
  it again. This differs from today, where typed bytes already sit in the kernel buffer, and is stated in help.
- Editing: Backspace, Ctrl+U, Ctrl+W, Left/Right inside the draft, paste (bracketed paste inserted as text, never a
  submission), full Unicode graphemes for the count. What is sent is exactly the draft's text plus `\r`.
- Type-ahead: keys typed before the request is confirmed follow today's ownership path (held, then routed); they
  start the sensitive draft only once the request is confirmed hidden. The 0/150/700 ms cases are tests.

### Visibility modes and the shortcut

Masked → Hidden → Plaintext (confirmation) → Masked. Proposed key: **F2**, taken by the composer only while a
sensitive draft is active (never forwarded then). Rejected: Ctrl+] (telnet/ssh escape convention), Ctrl+R/Ctrl+H/
Ctrl+V and other control keys (line-editing or literal-next meanings), Alt+letters (Option-as-Meta differs per host),
and a slash command (typing it would itself be input). The final choice is audited against `src/terminal/keys.ts`,
the workspace keymap, `/keys` host notes and tmux root bindings, and is configurable; the current mode is shown beside
the waiting highlight (`🔒 Masked · F2`).

Plaintext needs the centered confirmation (existing modal and overlay focus): **Show once** (this request only, back
to Masked after it), **No** (default, also Esc and any background click), **Never show** (a setting, reversible in
Settings), **Always show** (a setting; a second confirmation spelling out that every future sensitive prompt will be
displayed and visible in screenshots). Modal keys never reach the program; closing it returns to the same draft with
nothing dropped, duplicated or submitted.

### Waiting highlight integration

The sensitive draft uses the waiting-input highlight
([waiting-input-highlight.md](waiting-input-highlight.md)); its one-shot attention cue runs when the request opens,
never while the person types a secret, and never animates or colors the secret's characters.

## Cases where reveal is not offered (stated in the UI)

- Raw-mode programs (`key`): their own buffer is unknowable.
- Programs that switch modes mid-line, or a hidden request NMSh only learned of after keys were already forwarded
  directly: the draft starts empty and says *"earlier keys went to the program directly"*; no count is shown for them.
- `likely` requests: never sensitive-owned; ordinary line handling with the wording hint at most.
- Several frontends attached to one session: only the frontend that holds the draft knows it; others show Hidden.

## Tests (real PTY where it matters)

zsh/Bash/Fish hidden reads; `sudo -k; sudo true` style echo-off prompts; an echo-on "API key:" prompt; plain `read
reply`; `[y/N]`, `read -k`, Esc confirmations; typing at 0/150/700 ms; Backspace, Unicode, bracketed paste, Ctrl+U,
Ctrl+W; cycling and cancelling; Show once reset; Never/Always settings; Ctrl+C, Ctrl+Z, completion and reattach; a
leak sweep that greps the transcript, journal, archives, clipboard writes and debug logs for the typed secret; exact
byte counts at the PTY (no duplicates, nothing missing, nothing queued); the modal at narrow widths.
