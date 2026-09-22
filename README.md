# notMyShell

**NMSh** is a thin full-screen frontend for a persistent zsh session. It keeps command output in an independently scrollable upper viewport and owns a stable input area at the bottom of the existing terminal.

NMSh does not replace zsh or emulate a terminal. It runs inside terminals such as Ghostty and VS Code's integrated terminal.

## Run

Requires macOS, Node.js 22 or newer, and a terminal with a Powerline-capable font.

```sh
npm install
npm run dev
```

To exercise the local `nmsh` package executable without installing it globally:

```sh
npm run build
./bin/nmsh
```

To install the `nmsh` command globally so it can be used anywhere:

```sh
npm link
nmsh
```

The development and install scripts correct the executable bit on node-pty's macOS helper when dependencies have been restored from this repository.

## Controls

- `PageUp` / `PageDown`: scroll command history
- `Ctrl-G` or `Ctrl-End`: jump to the newest output
- `Up` / `Down`: move through visible slash-command suggestions when the panel is open
- `Tab`: insert the selected slash-command suggestion
- `Ctrl-C`: interrupt the active command, or clear idle input
- `Ctrl-D`: send EOF to an active command, or exit when input is empty
- `Shift-Enter`: insert a newline when the terminal reports modified Enter (CSI-u or modifyOtherKeys)
- `Ctrl-J`: reliably insert a newline
- `/appearance`: open the interactive Ghostty configuration panel
- `/copy`: copy the newest completed command output
- `/copy N`: copy the Nth newest completed command output

The input editor supports left/right/up/down arrows, line-relative Home/End, Backspace, and Delete. Plain Enter submits the entire buffer. Bracketed multiline paste preserves line breaks without submitting individual lines. Input grows upward to eight visible rows; longer input scrolls internally around the caret so a usable output viewport remains. Typing `/co` shows the available slash command in the live bottom area. When a foreground command reads standard input, entered lines and `Ctrl-D` are forwarded to that command.

## Visual system

The Powerline bar has a flat left edge, a sharp `` transition between project and Git segments, and a short `▓▒░` fade at the right edge. A running command has a pinned, temporary activity row with a calm equal-width star animation and subtle per-character left-to-right truecolor shimmer. Successful completion commits the selected activity phrase to permanent history; failures and interruptions use neutral wording. The former mascot experiment is disabled and retained under `archive/mascot-prototype/`.

## Architecture

NMSh uses a small alternate-screen compositor rather than Ink. It renders changed terminal rows only and separates permanent scrollable history from pinned jump, autocomplete, live-activity, context, multiline-input, and lower-separator rows. The activity scheduler runs at 10 FPS while row diffing limits shimmer writes to the live row.

A line-oriented ANSI boundary preserves common SGR colors, applies carriage-return progress updates in place, strips unsafe terminal control sequences, and wraps output to viewport width.

The persistent child is `/bin/zsh -f -i`. A process-local `precmd` hook emits private lifecycle and working-directory markers; no user shell or terminal configuration is read or changed. Repository context is refreshed only when zsh returns to the prompt.

Known full-screen commands are handled by one passthrough policy in `src/passthrough/PassthroughPolicy.ts`. While one runs, terminal bytes and input go directly between the real terminal and PTY. The frontend redraws after the command returns.

## Current limits

- The isolated shell deliberately does not source `~/.zshrc`, so user aliases, functions, and Powerlevel10k hooks are unavailable inside NMSh. Global configuration stays untouched.
- Passthrough detection covers common full-screen tools. Commands hidden inside complex shell expressions may need a future explicit passthrough command or shell integration signal.
- Output parsing handles common colors, line erasure, cursor movement within a line, carriage returns, Unicode, and wrapping. It does not emulate arbitrary two-dimensional cursor-addressed output; those programs belong in passthrough mode.
- Mouse reporting is not enabled, leaving Ghostty's native selection and copy-on-select behavior intact. Frontend-owned mouse selection and feedback remain future work.
- Shift-Enter depends on the host terminal reporting modified Enter distinctly; Ctrl-J is the portable newline fallback.
