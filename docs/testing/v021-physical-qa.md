# v0.21 physical QA

## Status

- **Candidate, not released.** Items are added as each v0.21 slice lands ([ledger](../development/v021-ledger.md)).
  Nothing below has been run yet.
- **What does not count:** headless PTY fixtures, synthetic keys, captures of a window driven that way, and green CI.
  Each item needs a person at a real terminal with a real keyboard and pointer.
- **Build under test:** record the exact commit (`node dist/index.js --version`) built from a clean checkout
  (`npm ci && npm run build`).
- **Isolation:** a throwaway `HOME` (or `XDG_CONFIG_HOME`) and a temporary working directory.

## Results

| Pass | Host and version | OS | Shell and version | Commit | Result | Notes |
|---|---|---|---|---|---|---|
| 1 Multi-row progress (#388) | Ghostty | macOS | zsh | | Not run | |
| 1 Multi-row progress (#388) | Terminal.app | macOS | Bash or Fish | | Not run | |
| 2 `/view` | Ghostty | macOS | zsh | | Not run | |
| 2 `/view` | Terminal.app | macOS | zsh | | Not run | |
| 3 `/edit` | Ghostty | macOS | zsh | | Not run | |
| 3 `/edit` | Terminal.app | macOS | Bash or Fish | | Not run | |

## 1. Multi-row progress redraws (#388)

- [ ] 1.1 `node -e 'for (let i=0;i<=10;i++){process.stdout.write((i?"\x1b[1A\x1b[2K":"")+"Downloading "+i*10+"%\n")}'`
  leaves one `Downloading 100%` line, at 80 columns and at 40 columns.
- [ ] 1.2 A two-row display (for example `docker pull` of a multi-layer image, or `brew install` of a formula with
  concurrent downloads) updates its rows in place; log lines printed between frames all stay. Record the command.
- [ ] 1.3 Resize the window narrower and wider while 1.2 runs: no earlier command, prompt or NMSh notice is erased.
- [ ] 1.4 `/copy` of that block copies the final rows once, not every frame.
- [ ] 1.5 `printf '10%%\r20%%\r100%%\n'` still shows one `100%` line; `clear` still clears.
- [ ] 1.6 `vim`, `less` and `htop` still take the full screen and return to the composer.
- [ ] 1.7 Queue two quick commands (`ls` then `pwd`) with Ctrl+Q while a short command runs: both stored command
  lines end with the known-command color (#408).

## 2. Native viewer (`/view`, View output)

- [ ] 2.1 `/view README.md` in this repository: Markdown is rendered (headings, lists, code, tables); `m` shows the
  source with line numbers; `m` again returns.
- [ ] 2.2 `/view src/viewer/ViewerPanel.ts`: syntax colors, line numbers, `w` turns wrapping off and Left/Right scroll
  sideways with `‹`/`›` marks, `l` hides numbers.
- [ ] 2.3 `/` finds text (lowercase ignores case), `n`/`N` step and wrap with a note, `:` + number goes to a line,
  `G`/`g` end and start, PageUp/PageDown, mouse wheel scrolls.
- [ ] 2.4 Run `seq 1 5000`, then `/view` (latest output) and Actions → View output on that block; `/view 2` opens the
  previous output. The transcript is unchanged after closing.
- [ ] 2.5 `c` copies the whole document; the clipboard has the exact text (tabs kept), and nothing else.
- [ ] 2.6 Hostile content: `printf '\033]8;;https://example.com\a\033[31mred\033[2J\n' > /tmp/h.txt && /view /tmp/h.txt`
  shows `␛` marks, no color change, no link, no screen clear.
- [ ] 2.7 Refusals say why: a directory, a missing file, `/dev/zero`, a FIFO (`mkfifo /tmp/f && /view /tmp/f` returns
  at once), a binary (`/view /bin/ls`), a 20 MB log (shows the first 8 MiB with a note).
- [ ] 2.8 Esc closes, the composer draft and cursor are where they were, and a running command's output kept
  arriving underneath. At 32×10 the viewer still fits and Esc is shown.
- [ ] 2.9 `NO_COLOR=1` and Safe glyphs: matches and the current match are still visible (reverse video).

## 3. Native editor (`/edit`)

- [ ] 3.1 `/edit notes.txt` in an empty folder: it says *new file*; type two lines with Enter and a Tab, Ctrl+S says
  *Saved*, Esc returns to the composer, `cat -A notes.txt` shows the tab and a final newline.
- [ ] 3.2 Shift+arrows, Shift+Alt+arrows and Cmd+Shift+arrows select; typing replaces the selection; Ctrl+C copies
  and Ctrl+X cuts it (paste it back with the terminal's paste); Ctrl+Z undoes a typed word in one step, Ctrl+Y redoes.
- [ ] 3.3 Ctrl+F finds (lowercase ignores case), Enter again finds the next match.
- [ ] 3.4 Edit, then Esc: the question offers Save, Discard changes and Keep editing; each does what it says.
- [ ] 3.5 Conflict: `/edit notes.txt`, change it from another terminal (`echo x >> notes.txt`), then Ctrl+S: nothing is
  written until you choose; Overwrite writes yours, Reload shows theirs.
- [ ] 3.6 A CRLF file with a BOM keeps both after saving (`xxd file | head -1`); `chmod 640` survives a save; editing
  through a symlink keeps the symlink.
- [ ] 3.7 Refusals: a binary (`/edit /bin/ls`), a root-owned file (`/edit /etc/hosts`), a 2 MB file, a read-only file
  (`chmod 444`) each explain why, and `/view` still opens them.
- [ ] 3.8 `e` in `/view README.md` opens the editor on the same file; `vim notes.txt` and `nano notes.txt` still run as
  usual from the composer.
