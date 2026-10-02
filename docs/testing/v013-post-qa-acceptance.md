# v0.13 post-QA acceptance

This updates the [cumulative v0.13 acceptance](v013-cumulative-acceptance.md) after
three independent QA passes. v0.13 remains an unmerged development stack.
**Physical QA is still deferred and nothing here claims human validation.**
Package and lockfile remain **0.7.0**; no merge, tag, release or force push occurred.

## Review stack

[#278](https://github.com/raiseCatError/notMyShell/pull/278) →
[#280](https://github.com/raiseCatError/notMyShell/pull/280) →
[#282](https://github.com/raiseCatError/notMyShell/pull/282) →
[#283](https://github.com/raiseCatError/notMyShell/pull/283) (`e325bb3`, untouched) →
[#285](https://github.com/raiseCatError/notMyShell/pull/285), `fix/v013-post-qa-hardening`
(`ae45bbeca692950fd71f7f6d3dd1db867739fda9`) → this PR. Implementation issue:
[#284](https://github.com/raiseCatError/notMyShell/issues/284), milestone 13, left open.

QA originally froze #282 at `4f74efe`; #282 later advanced to `3b0fc8a` with startup
lifecycle fixes. Each finding below was re-checked against the final #283 source.

## Disposition of the confirmed findings

| Finding | Re-check on final source | Result |
| --- | --- | --- |
| M1 settings persistence | Reproduced: malformed/unreadable config replaced by a save; stale frontends overwrote each other | Fixed |
| N2 abnormal foreground app mode leak | Reproduced with the real frontend (SIGKILL fixture) and real tmux 3.7c | Fixed |
| M2 stale preset lock | Reproduced: a dead owner's lock blocked create/delete/acknowledge | Fixed |
| N1 interactive zsh startup prompt | Reproduced: `read -k1` in `.zshrc`; the v0.13 early-submit fix did not address it | Fixed (abort supported; explicit prompt input not offered) |
| M3 Linux clipboard | pbcopy only | Implemented |
| L1 monotonic scheduling | Reproduced: a backward wall clock stalled frames | Fixed |
| L3 welcome test path | Depended on the checkout name | Fixed |
| L4 notification slash | Any leading `/` suppressed the notification | Fixed |
| L5 mise cache identity | `mise.local.toml` / `.mise.local.toml` ignored | Fixed |

**M1.** An existing config that cannot be read or parsed is never replaced; the error
names the path and is shown in the transcript or panel. With a base state, only
changed settings are written over a fresh read, absent keys are filled in, and
unknown fields survive. Writes remain atomic. A narrow read-to-rename window
between two simultaneous writers remains; there is no locking subsystem.

**N2.** When passthrough ownership returns, or NMSh exits while an app still owns
the terminal, the renderer re-asserts the alternate screen, resets mouse modes
?1000/?1002/?1003/?1005/?1006/?1015 that NMSh does not want, restores keypad and
cursor-key modes, pops the whole keyboard-protocol stack and re-applies NMSh's own
modes. Modes NMSh requires stay enabled. Baseline hosts receive these resets
(idempotent) but never an enabling sequence; the baseline-host test was narrowed
accordingly. Coverage:

- a byte-stream terminal model fed the renderer output plus a fixture that sets every mode and dies without cleanup, compared with a clean run;
- a real-frontend fixture (nested node-pty) killed with SIGKILL, with a precondition that the leak was on the terminal;
- a bounded real-tmux 3.7c test comparing pane mode flags before and after the kill. It was observed failing without the fix. It is distinct from the nested node-pty fixtures.

Not covered: the main-screen keyboard stack, and terminals other than tmux.

**M2.** The preset lock follows the transcript-store ownership protocol. Dead owners
are recovered; live, reused-PID or unreadable owners are refused with the lock path
and left in place. A PID reused by an unrelated live process therefore fails safe
and needs manual removal. Writers wait up to one second.

**N1.** The shell holds input until its first prompt (64 KiB bound), so type-ahead
cannot answer a startup prompt; the early-submit flow from final v0.13 is preserved.
After 1.5 s (`NMSH_STARTUP_NOTICE_MS`) the frontend shows an explicit state with
the last 2 KiB of sanitized startup output (no escape sequences or controls),
holds Enter and aborts on Ctrl+C. A reattach to a still-starting session shows the
same state. The protocol gained an additive `startup` message and an optional
`startup` field on `attached`; the version number is unchanged.

Limitations: the composer is visible for the first 1.5 s; sending text to the
startup prompt is not offered; an abort ends the session; commands submitted
before the delay are queued by the shell rather than rejected; startup output is
shown only while the shell has not reached its first prompt.

**M3.** Linux uses `wl-copy` under Wayland, then `xclip -selection clipboard` or
`xsel --clipboard --input` under X11, resolved from PATH, argv-executed, payload on
stdin, 3 s timeout, 1 MiB cap. No backend gives a "Clipboard unavailable" message;
failures never affect command execution. pbcopy is unchanged. Backend selection is
tested with fake executables, not a desktop. Not tested: real Wayland/X11
clipboards. OSC 52 is deferred because TerminalHost has no explicit capability for it.

**Low findings.** L1: scheduling uses `performance.now()`, callbacks still receive
wall-clock time. L3: the welcome test asserts the actual cwd basename. L4: only
recognized NMSh slash commands are skipped, so `/usr/bin/make` notifies. L5: the
two local mise files are now markers and identity inputs; there is no filesystem
watching.

## Unresolved items

- Different `XDG_RUNTIME_DIR` visibility across launches, and a capability-probe reply split across chunks: assessed, no evidence of a bounded fix, left as documented.
- Detach/reattach during blocked startup is covered by a live test; held composer text is not carried to the new frontend.
- Downgraded earlier concerns (completion helper restarts, PID reuse, long socket paths, notification coverage, relative XDG_CONFIG_HOME) were not reopened.

## Automated evidence

Local macOS arm64: **897 tests, 897 passed**, zero failure/skip (up from 868).
Build, typecheck, benchmark-script typing and `git diff --check` passed. No NMSh
processes or owned temp roots were left behind. During development, parallel
full-suite runs showed `lsof` timeouts and one listing race in new fixtures; the
fixtures now wait for the session listing.

CI [run 37039105588](https://github.com/raiseCatError/notMyShell/actions/runs/37039105588)
at `ae45bbe`:

| Runner | Node | Total | Passed | Skipped | Failed |
| --- | --- | ---: | ---: | ---: | ---: |
| macOS | 22 | 897 | 888 | 9 | 0 |
| macOS | 26 | 897 | 888 | 9 | 0 |
| Ubuntu 24.04 | 22 | 897 | 893 | 4 | 0 |
| Ubuntu 24.04 | 26 | 897 | 893 | 4 | 0 |

The first Ubuntu Node 22 attempt failed in the existing tmux interoperability test
(`BACK-FROM-LESS`: a key sent to `less` did not arrive). It passed on a rerun of the
same commit and could not be reproduced locally; it is recorded as a suspected
timing flake, not diagnosed. The earlier macOS skip count was 8; one additional
skip is new on macOS CI and was not investigated.

## Physical QA

Still pending: use [v0.13 additive physical QA](v013-physical-qa.md). Additionally
check, on real terminals: a killed fullscreen/mouse app, a blocked `.zshrc` prompt,
and clipboard copy under Wayland and X11.
