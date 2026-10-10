# v0.18 physical QA

## Status

- **Automated:** `npm run verify` (unit and real-PTY tests), the bench type-check and the timing smoke run pass on the
  release branch. VHS recordings of real NMSh were checked for the transcript folding fix.
- **Still required:** every item below needs a person at a real terminal. Record host and version, OS, font (Nerd or
  Safe), commit, result and failures.
- **Not covered by the maintainer's hosts:** Linux and WSL 2 on real machines (#18), and iTerm2, Kitty and WezTerm
  (#13).

## Slash routing and absolute paths
- `/bin/zsh -c 'echo hi'`, `/usr/bin/env echo hi` and a path to a directory run in the shell exactly as typed, in
  zsh, Bash and Fish. `/zsh` still switches shells.

## /copy
- `/copy` after a command with output copies only that output: no `✔ Completed` row, no timestamps. Paste into
  another app to check line breaks and indentation.
- `/copy` after a command that printed nothing leaves the clipboard as it was and says so.

## Transcript folding after a screen clear
- Run a command with about 15 lines of output, then `clear`, then a command with five lines, then `/copy`. The five
  lines stay together, no fold row appears among them, and Ctrl+O folds and unfolds only that command, several times
  over. Repeat at a narrow width (about 46 columns) with a long command that wraps.
- Run `tmux`, detach or exit, then run a few commands: folding, `/copy` and Ctrl+O act on the right commands.
- `/resume` an older session that used `clear` or `tmux` before this release: no fold rows appear inside other
  commands' output. Older commands from before a clear may lose their fold control; their lines stay visible.
- Full-screen programs (`vim`, `less`), `printf '\e[J'` and a progress bar do not clear the transcript.

## Fish keystroke loss (known residual; keep on this list)
- In Fish, run `read -P 'Name: ' x; echo got=$x`, answer, and type the next command the moment the prompt returns.
  The command is never lost. Repeat with `read -s`, and while the machine is busy (for example during a build).
- Type-ahead *while* a fish `read` is still running (the answer and the next command in one fast burst) can still be
  lost. Fish itself drops it, in any terminal (see `docs/development/fish-typeahead.md`). Note whether it happens and
  how often on each host. If it is frequent on a fast local terminal, report it upstream to fish.
- zsh and Bash: the same steps, including type-ahead, never lose keys.

## Known issue: `ESC[3J` clears the whole transcript
- `printf '\e[3J'` alone empties NMSh's transcript, though in a real terminal it erases only scrollback and leaves the
  screen. `clear` (which sends `ESC[3J ESC[H ESC[2J` on macOS) and `clear -x` are unaffected, since `ESC[2J` clears
  anyway. The behavior dates from the first release. After the fold fix it is a consistent wipe, never misattributed
  output. Planned after v0.18: treat a lone `ESC[3J` as clearing nothing NMSh shows. Check that nothing you use emits
  it alone.

## Hosts
- Ghostty, macOS Terminal and VS Code or Zed integrated terminals, at normal and narrow widths, with `NO_COLOR=1` and
  Safe glyphs.
