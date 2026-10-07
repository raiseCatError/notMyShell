# Terminal multiplexer interoperability (#175)

NMSh is a terminal frontend over zsh and a real PTY. It runs inside and alongside terminal multiplexers, but it is not one: it never launches, wraps, nests or manages tmux, Zellij or screen, and no multiplexer is a dependency. This note records how NMSh behaves with them today, what was verified and how, and the follow-ups worth doing. Scope stays reliable coexistence; general CLI/TUI compatibility is #14 and agent terminal hosts are #15.

## How it was verified

Checked on macOS with tmux 3.7c and GNU screen 4.00.03, in isolated sandboxes (own HOME, config and session-service runtime directory). Each row of the matrix says which kind of evidence supports it:

- **Automated test:** pinned in `tests/muxInterop.test.ts`, which gives automated contract coverage for *selected* tmux/screen paths. It uses real tmux and screen where they are installed and skips otherwise, so CI never depends on a multiplexer. The tests strip any multiplexer variables (`TMUX`, `TMUX_PANE`, `STY`, `WINDOW`, `ZELLIJ*`) from the environment they inherit, so an outer multiplexer cannot leak in. Nothing else is changed.
- **Manual observation:** seen during scripted probes for this research (tmux `send-keys`/`capture-pane`, node-pty), but not pinned by a test.
- **Expected:** inferred from how the multiplexer works, or not checkable here. Zellij and TUIOS were not available, so everything about them is expected, not observed.

## Behavior matrix

| Situation | Behavior | Evidence |
| --- | --- | --- |
| NMSh inside tmux: environment | The managed zsh sees `TERM=tmux-256color`, `TERM_PROGRAM=tmux` and `TMUX`. | Automated test |
| NMSh inside tmux: resize | tmux resizes the pane, and NMSh gives the shell the pane minus its composer rows. Width follows exactly, and height grows with the pane (for example 100×30 → `25 100`; the exact rows depend on the prompt's height). | Automated test |
| NMSh inside tmux: Ctrl+Z | Suspends the foreground job; `jobs` lists it as suspended. | Automated test |
| NMSh inside tmux: `fg` | Resumes the job. | Manual observation |
| NMSh inside tmux: `less` | Passthrough, then NMSh repaints its composer. | Automated test |
| NMSh inside tmux: `vim` and other fullscreen apps | Same path as `less`. | Expected (physical QA) |
| NMSh inside tmux: bracketed paste | A multi-line `paste-buffer -p` lands in the composer as a paste; nothing runs. | Automated test |
| NMSh inside tmux: mouse | NMSh requests button and SGR mouse (1000/1002/1006, no motion tracking) inside tmux. tmux then enables mouse on the outer terminal and forwards wheel reports to the pane whether its own `mouse` option is on or off, so the wheel scrolls the NMSh transcript; copy mode and tmux's own bindings still come first, and Shift keeps the terminal's selection. Before this, NMSh asked for no mouse inside tmux and the outer terminal's alternate scroll turned the wheel into Up/Down, which walked composer history (physical QA, Ghostty 1.3.1). | Automated test (real tmux 3.x, `mouse` on and off, injected SGR wheel); physical re-test pending |
| NMSh inside tmux: Shift+Enter | NMSh asks for the kitty keyboard protocol, which tmux does not honor. NMSh already decodes both extended encodings tmux can forward (`CSI 27;2;13~`, `CSI 13;2u`). tmux's default `extended-keys off`, and `on` without a modifyOtherKeys request, most likely deliver Shift+Enter as plain Enter, and `set -g extended-keys always` should fix it. `tmux send-keys` cannot produce real extended keys, so this could not be probed. | Expected (physical QA); follow-up 2 |
| NMSh inside tmux: `/copy` | Uses `pbcopy`, which works inside tmux on current macOS. OSC 52 is not used, so tmux `set-clipboard` does not matter. | Expected (physical QA) |
| NMSh inside tmux: tmux server killed | The frontend gets SIGHUP and **detaches**: the live session keeps running in nmshd and appears in `nmsh --sessions`, `/resume` and the startup restore prompt. | Automated test |
| NMSh inside tmux: only its pane closed (`kill-pane`, server still running) | Same: the live session detaches and stays restorable, and the tmux server keeps running. | Automated test |
| NMSh inside tmux: tmux client detached | The pane (and NMSh) keep running, so the live session stays **attached**: other NMSh windows never offer it or take it over. Reattaching tmux shows the same NMSh. | Expected (from tmux semantics; physical QA) |
| tmux inside NMSh | Enters the alternate screen, so NMSh passes the terminal through. It repaints after reattach, and the app's mouse modes are restored on reattach (#131). | Automated test (existing `liveHardening` test) |
| Any alternate-screen program inside NMSh | Gets the full terminal size in passthrough. | Automated test |
| tmux inside NMSh inside tmux | tmux refuses to nest an attached client while `TMUX` is set, as in any shell. Unchanged by NMSh. | Expected |
| NMSh inside GNU screen | Renders; the shell sees `STY`; width follows a resize; Ctrl+Z suspends a job. | Automated test |
| NMSh inside GNU screen: `less` and return | Works. | Manual observation |
| GNU screen inside NMSh | screen switches to the alternate screen, so NMSh passes it through and returns cleanly. | Automated test |
| GNU screen inside NMSh: size | screen 4.00 keeps its window at the size it **started** with. Started from NMSh's composer, that is the composer-reduced height (for example 25 of 30 rows), and it does not grow when NMSh hands over the full terminal. Programs that follow resizes, such as tmux or any alternate-screen app, get the full size. Inside screen, `C-a F` (fit) corrects it. | Manual observation; follow-up 6 |
| Zellij (either direction) | Expected to behave like tmux: a PTY-backed multiplexer that forwards resizes and uses the alternate screen, with its own mouse and keyboard handling. Its kitty keyboard support may differ from tmux. | Expected (unverified) |
| TUIOS / terminal-native splits | Splits in Ghostty, kitty or WezTerm are separate terminals to NMSh; each NMSh is independent. | Expected (unverified) |

## Where persistence overlaps

tmux and NMSh can both keep a shell alive, at different layers:
- tmux keeps the **frontend process** (NMSh itself) alive while tmux runs; detaching a tmux client changes nothing for NMSh.
- nmshd keeps the **shell** alive when the frontend goes away (pane closed, tmux killed, window closed) as a detached live session.

They compose rather than conflict, because NMSh never inspects or depends on tmux state and a session attached in a tmux pane is never offered to, or taken over by, another NMSh window. The one real wrinkle is the environment:

**A live session keeps the environment it was created in.** A session started inside tmux and later reattached from a plain terminal still has `TERM=tmux-256color`, `TERM_PROGRAM=tmux` and `TMUX` (automated test). `TMUX` remains set after the originating tmux server is killed, and the test confirms that server is gone. The same applies in reverse: a session started in Ghostty and reattached inside tmux believes it is directly in Ghostty. A shell cannot have its environment replaced from outside, and #127 deliberately gives each session its creating frontend's environment.

This is not only cosmetic. Every command started later from that shell inherits the stale values:
- `tmux` may refuse to nest, or `tmux` commands may target a dead server.
- Programs choose terminal capabilities from `TERM`/`TERM_PROGRAM`, so they can pick the wrong terminal's features.
- Scripts that branch on `TMUX` behave as if they were inside tmux.

What is *not* affected is NMSh's own attaching frontend. It detects its host (for example for startup restore's window launcher) from its **own** environment, not from the shell's, so the reattached shell's stale `TMUX` does not confuse it. See follow-up 1.

Startup restore (#197) treats these sessions like any other. Its window launcher detects Ghostty from `GHOSTTY_RESOURCES_DIR`, which tmux inherits from the Ghostty that started it, so "Open all" from inside tmux opens new **Ghostty windows outside tmux** rather than tmux windows (automated test at the detection level). That is safe, since each window just runs `nmsh --attach`, but it may not be what a tmux user expects. See follow-up 3.

## Is environment detection needed?

Not for baseline coexistence. Everything in the matrix works with no multiplexer detection (screen's fixed starting size aside, which follow-up 6 addresses without detection), and unknown hosts keep the default behavior. Detection would only be justified for the targeted follow-ups below, and should use environment evidence (`TMUX`, `ZELLIJ`, `STY`, `TERM_PROGRAM`) rather than command names.

## Prioritized follow-ups

1. **Tell the user when a reattached session's environment differs.** When the attaching frontend's multiplexer or terminal (`TMUX`/`ZELLIJ`/`STY` presence, `TERM`, `TERM_PROGRAM`) differs from the session's creation environment, add one factual line to the reattach notice. No behavior change, just visibility. (P1)
2. **Shift+Enter inside tmux with default settings.** Also request modifyOtherKeys (`CSI > 4 ; 1 m`) alongside the kitty push, and pop it on exit, so tmux `extended-keys on` forwards Shift+Enter to NMSh without users changing tmux config. Verify physically in Ghostty and Terminal.app first. (P1)
3. **"Open all" from inside a multiplexer.** Decide whether startup restore should open tmux windows (`tmux new-window 'nmsh --attach …'`) when `TMUX` is set, or keep opening host windows. This is a product choice for the #197 host abstraction, not a bug. (P2)
4. **Physical Zellij pass.** Run the matrix in Zellij and record results; add Zellij to the `muxInterop` tests if it can be installed where tests run. (P2)
5. **Document recommended tmux settings** (`mouse on`, `extended-keys always`) in the README once 2 is decided. (P3)
6. **Done (development line):** `tmux` (no command, `new`, `new-session`, `attach`, `attach-session`), `screen` and `zellij` client invocations get the terminal from launch; listing and control commands (`tmux ls`, `screen -ls`, …) stay in the transcript. A tmux started from the composer also gets an ordinary zsh in its panes: NMSh's zsh bootstrap no longer exports its private `ZDOTDIR` or prompt override to child shells (they made the panes blank).

## Terminal ownership handoff

Whatever triggers it (a known command at submit, or evidence in the output: the alternate screen, an input mode, a kitty keyboard push), handing the terminal to a foreground program is one transaction:

- **To the program.** NMSh stops rendering and drops any half-decoded input (a pending Escape, part of a sequence), so nothing typed for the program can become composer text. From the evidence byte on, output is the program's screen paint: it goes to the terminal and never into the transcript, even when it arrives in the same read as earlier ordinary output. Text before it stays transcript output.
- **While it owns the terminal.** NMSh writes nothing: no frames, caret moves, cursor visibility, Chroma or motion, title or semantic marks. Measured in real PTYs with an agy-shaped program and with agy itself.
- **Back to NMSh** (at the shell's next prompt). Mode reconciliation, input decoder reset, and an authoritative full redraw. The transcript parser also never prints bytes of sequences it does not draw: charset designations such as tmux's `ESC ( B` (once a stray `B`), DCS/APC strings, and `CSI > … m` requests, which were mis-read as colour and re-emitted as `ESC[NaN;2m`.
- **Bounded control sequences.** The transcript parser keeps at most `MAX_CONTROL_SEQUENCE` (8 KiB) of one unfinished sequence across reads. Past it, OSC (ends at BEL or ST) and DCS/SOS/PM/APC (end at ST only) are discarded with only a possibly split ESC retained, CSI and nF escapes are skipped through their final byte, and parsing resumes after the terminator, with none of the content as text. C1 forms are not introducers and are dropped as characters. NMSh's own shell markers are bounded at 1 MiB (an oversized command line is reported truncated; an oversized prompt marker is dropped), and the key decoder holds at most 256 bytes of a partial key sequence. A bracketed paste is user data and is not truncated.
