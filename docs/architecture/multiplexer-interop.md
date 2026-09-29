# Terminal multiplexer interoperability (#175)

NMSh is a terminal frontend over zsh and a real PTY. It runs inside and alongside terminal multiplexers, but it is not one: it never launches, wraps, nests or manages tmux, Zellij or screen, and no multiplexer is a dependency. This note records how NMSh behaves with them today, what was verified and how, and the follow-ups worth doing. Scope stays reliable coexistence; general CLI/TUI compatibility is #14 and agent terminal hosts are #15.

## How it was verified

Verified on macOS with tmux 3.7c and GNU screen 4.00.03, in isolated sandboxes (own HOME, config and session-service runtime directory):
- NMSh inside tmux was driven with `tmux send-keys`, `paste-buffer -p`, `resize-window` and read with `capture-pane`.
- NMSh inside screen and screen inside NMSh were driven through node-pty.
- The contract below marked **tested** is pinned in `tests/muxInterop.test.ts`. Those tests skip themselves where tmux or screen is not installed, so CI never depends on a multiplexer.

Zellij and TUIOS were not available and are marked **unverified**; the expectations for them are reasoning from how they work, not observations.

## Behavior matrix

| Situation | Behavior | Status |
| --- | --- | --- |
| NMSh inside tmux: rendering | Normal NMSh screen. The managed zsh sees `TERM=tmux-256color`, `TERM_PROGRAM=tmux` and `TMUX`. | tested |
| NMSh inside tmux: resize | tmux resizes the pane; NMSh gives the shell the pane minus its composer rows (observed 100×30 → `25 100`, 120×40 → `35 120`; the exact rows depend on the prompt's height). | tested |
| NMSh inside tmux: Ctrl+Z / job control | Suspends the foreground job; `jobs`, `fg` work. | tested |
| NMSh inside tmux: fullscreen apps (`less`, `vim`) | Passthrough, then NMSh repaints its composer. | tested |
| NMSh inside tmux: bracketed paste | A multi-line `paste-buffer -p` lands in the composer as a paste; nothing runs. | tested |
| NMSh inside tmux: mouse | NMSh requests SGR mouse (1000/1003/1006). tmux forwards mouse events only with `set -g mouse on`; otherwise the wheel is tmux's (copy mode/scrollback). | expected, physical QA |
| NMSh inside tmux: keys | NMSh asks for the kitty keyboard protocol, which tmux does not honor. NMSh already decodes both extended encodings tmux can forward (`CSI 27;2;13~`, `CSI 13;2u`), but tmux's default `extended-keys off`, and `on` without a modifyOtherKeys request, deliver Shift+Enter as plain Enter. `set -g extended-keys always` should make Shift+Enter insert a newline. | expected, physical QA; see follow-up 2 |
| NMSh inside tmux: `/copy` | Uses `pbcopy`, which works inside tmux on current macOS. OSC 52 is not used, so tmux `set-clipboard` does not matter. | reasoned |
| NMSh inside tmux: pane closed or tmux killed | The frontend gets SIGHUP and **detaches**: the live session keeps running in nmshd and appears in `nmsh --sessions`, `/resume` and the startup restore prompt. | tested |
| NMSh inside tmux: tmux client detached | The pane (and NMSh) keep running; the live session stays **attached**, so other NMSh windows never offer or take it. Reattaching tmux shows the same NMSh. | reasoned from tmux semantics |
| tmux inside NMSh | Enters the alternate screen, so NMSh passes the terminal through; it repaints after reattach, and the app's mouse modes are restored on reattach (#131). | tested (existing `liveHardening` test) |
| tmux inside NMSh inside tmux | tmux refuses to nest an attached client while `TMUX` is set, as in any shell. Unchanged by NMSh. | reasoned |
| NMSh inside GNU screen | Rendering, resize (120×40 → `35 120`), Ctrl+Z, `less` and return all work. | tested |
| GNU screen inside NMSh | screen switches to the alternate screen, so NMSh passes it through and returns cleanly. screen's very first size query can report the composer-reduced size; the SIGWINCH from NMSh's passthrough resize corrects it. | tested |
| Zellij (either direction) | Expected like tmux: a PTY-backed multiplexer that forwards resize and uses the alternate screen, with its own mouse and keyboard handling. Its kitty keyboard support may differ from tmux. | unverified |
| TUIOS / terminal-native splits | Splits in Ghostty, kitty or WezTerm are separate terminals to NMSh; each NMSh is independent. | unverified |

## Where persistence overlaps

tmux and NMSh can both keep a shell alive, at different layers:
- tmux keeps the **frontend process** (NMSh itself) alive while tmux runs; detaching a tmux client changes nothing for NMSh.
- nmshd keeps the **shell** alive when the frontend goes away (pane closed, tmux killed, window closed) as a detached live session.

They compose rather than conflict, because NMSh never inspects or depends on tmux state and a session attached in a tmux pane is never offered to, or taken over by, another NMSh window. The one real wrinkle is the environment:

**A live session keeps the environment it was created in.** A session started inside tmux and later reattached from a plain Ghostty window (tested) still has `TERM=tmux-256color`, `TERM_PROGRAM=tmux` and `TMUX` pointing at a tmux server that may be gone. The same applies in reverse: a session started in Ghostty and reattached inside tmux believes it is directly in Ghostty. A shell cannot have its environment replaced from outside, and #127 deliberately gives each session its creating frontend's environment. Effects are usually small (`tmux` inside that shell may refuse to nest; programs may pick capabilities for the wrong terminal), but they are invisible to the user. See follow-up 1.

Startup restore (#197) treats these sessions like any other. Its window launcher detects Ghostty from `GHOSTTY_RESOURCES_DIR`, which tmux inherits from the Ghostty that started it, so "Open all" from inside tmux opens new **Ghostty windows outside tmux** rather than tmux windows (tested at the detection level). That is safe, since each window just runs `nmsh --attach`, but it may not be what a tmux user expects. See follow-up 3.

## Is environment detection needed?

Not for baseline coexistence. Everything in the matrix works with no multiplexer detection, and unknown hosts keep the default behavior. Detection would only be justified for the targeted follow-ups below, and should use environment evidence (`TMUX`, `ZELLIJ`, `STY`, `TERM_PROGRAM`) rather than command names.

## Prioritized follow-ups

1. **Tell the user when a reattached session's environment differs.** When the attaching frontend's multiplexer or terminal (`TMUX`/`ZELLIJ`/`STY` presence, `TERM`, `TERM_PROGRAM`) differs from the session's creation environment, add one factual line to the reattach notice. No behavior change, just visibility. (P1)
2. **Shift+Enter inside tmux with default settings.** Also request modifyOtherKeys (`CSI > 4 ; 1 m`) alongside the kitty push, and pop it on exit, so tmux `extended-keys on` forwards Shift+Enter to NMSh without users changing tmux config. Verify physically in Ghostty and Terminal.app first. (P1)
3. **"Open all" from inside a multiplexer.** Decide whether startup restore should open tmux windows (`tmux new-window 'nmsh --attach …'`) when `TMUX` is set, or keep opening host windows. This is a product choice for the #197 host abstraction, not a bug. (P2)
4. **Physical Zellij pass.** Run the matrix in Zellij and record results; add Zellij to the `muxInterop` tests if it can be installed where tests run. (P2)
5. **Document recommended tmux settings** (`mouse on`, `extended-keys always`) in the README once 2 is decided. (P3)
