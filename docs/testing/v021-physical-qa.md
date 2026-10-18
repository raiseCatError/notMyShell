# v0.21 physical QA

## Status

- **Candidate, not released.** Every v0.21 slice is merged into `dev` (#411–#424, `433af8fd`); see the
  [ledger](../development/v021-ledger.md). Nothing below has been run yet. The [walkthrough](#walkthrough) groups the
  passes into three sittings with ready-made fixtures.
- **What does not count:** headless PTY fixtures, synthetic keys, captures of a window driven that way, and green CI.
  Each item needs a person at a real terminal with a real keyboard and pointer.
- **Build under test:** the release candidate commit, built from a clean checkout (`npm ci && npm run build`); record
  `node dist/index.js --version` (version and build commit) in every row.
- **Isolation:** `scripts/qa/v021-fixtures.sh` makes a throwaway folder with its own NMSh configuration
  (`XDG_CONFIG_HOME`) and session service (`NMSH_RUNTIME_DIR`), so the QA build neither reads your settings nor
  attaches to your running sessions. `HOME` is unchanged: your shell's own startup files run as usual, and copy
  items replace your clipboard.

## Results

| Pass | Host and version | OS | Shell and version | Commit | Result | Notes |
|---|---|---|---|---|---|---|
| 1 Multi-row progress (#388) | Ghostty | macOS | zsh | | Not run | |
| 1 Multi-row progress (#388) | Terminal.app | macOS | Bash or Fish | | Not run | |
| 2 `/view` | Ghostty | macOS | zsh | | Not run | |
| 2 `/view` | Terminal.app | macOS | zsh | | Not run | |
| 3 `/edit` | Ghostty | macOS | zsh | | Not run | |
| 3 `/edit` | Terminal.app | macOS | Bash or Fish | | Not run | |
| 4 Semantic Output | Ghostty | macOS | zsh | | Not run | |
| 5 `/track` | Ghostty | macOS | zsh | | Not run | |
| 5 `/track` | Terminal.app | macOS | Fish | | Not run | |
| 6 Modules | Ghostty | macOS | zsh | | Not run | |
| 7 Themes | Ghostty | macOS | zsh | | Not run | |
| 7 Themes | Terminal.app | macOS | zsh | | Not run | |

Not available on the QA Mac, with the coverage that exists instead: 1.5b (`apt` progress; Linux only: parser and live
PTY tests, Ubuntu and Fedora CI), 4.3 `cargo build` (not installed; Rust diagnostics recognizer tests), 6.2
(`nix-shell`; the module reads only `IN_NIX_SHELL`, unit-tested), 6.3 inside a container (marker files and host
variables, unit-tested; the host half is checked here). Each stays *Not run* in the table, never *Pass*.

## Walkthrough

Three sittings, about 90 minutes in all. Every command below is typed in NMSh unless it says "second tab".

**Prepare once.** In a plain terminal window (not inside NMSh):

```sh
cd /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/v021-qa     # the release candidate build
node dist/index.js --version                              # record version and build commit
scripts/qa/v021-fixtures.sh /Volumes/T7Tmp/ai-dev/q21
```

Each sitting starts from a plain window: `/Volumes/T7Tmp/ai-dev/q21/nmsh` (zsh), `… nmsh fish` or `… nmsh bash`. NMSh
opens in `q21/work`; paths below are relative to it. Quit with `exit`. If a launch offers to resume a detached
session (after 5.8), press R and `exit` it.

**Reporting.** One line per pass, for example `Pass 2 · Ghostty 1.3.1 · zsh 5.9: PASS` or `Pass 2: FAIL 2.7 (the FIFO
hung)`; a screenshot helps. Each result is recorded in the table with the build commit. A skipped item is *Not run*.

### Sitting A: Ghostty, zsh (passes 1–7, about 60 minutes)

1. **Progress.** 1.1 as listed, then at 40 columns. 1.2 `node progress/multirow.mjs`: two `layer` rows count up in
   place; `LOG pulling two layers`, `LOG checkpoint 1`–`4` and `LOG done` all stay, in order. 1.3 `node
   progress/multirow.mjs 120` (30 s) while you resize. 1.4 `/copy`, then `pbpaste`: the final rows once. 1.5 as listed.
   1.5a at 40 columns `node progress/wrapped.mjs`: both `LOG kept line` lines and `LOG done` stay, with one `Downloading
   … 100%` and one `eta 0s`. 1.6 `vim view/tabs.txt`, `less view/README.md`, `top` (htop is not installed). 1.7 `sleep
   5`, then `ls` Ctrl+Q and `pwd` Ctrl+Q while it runs.
2. **`/view`.** 2.1 `/view view/README.md`. 2.2 `/view view/ViewerPanel.ts`. 2.3 in either. 2.4 as listed. 2.5 `/view
   view/tabs.txt`, `c`, Esc, `pbpaste | cat -vet`: `^I` between columns, `$` only at line ends. 2.6 `/view
   view/hostile.txt`. 2.7 `/view view/folder`, `view/missing.txt`, `/dev/zero`, `view/fifo` (returns at once),
   `/bin/ls`, `view/big.log` (20 MB: the first 8 MiB with a note). 2.8 as listed, with `node progress/multirow.mjs 120`
   running. 2.9 in step 8.
3. **`/edit`.** 3.1 `cd edit/empty`, then as listed, with `cat -vet notes.txt` (macOS `cat` has no `-A`): `^I` and a
   final `$`. 3.2–3.4 on that file. 3.5 second tab: `echo x >> /Volumes/T7Tmp/ai-dev/q21/work/edit/empty/notes.txt`.
   `cd ../..`. 3.6 `/edit edit/crlf-bom.txt`, change a word, save; `xxd edit/crlf-bom.txt | head -1` starts `efbb bf`
   and lines end `0d0a`. `/edit edit/mode640.txt`, save, `ls -l edit/mode640.txt` is `-rw-r-----`. `/edit
   edit/link.txt`, save, `ls -l edit/link.txt` still points to `target.txt`. 3.7 `/edit /bin/ls`, `/etc/hosts`,
   `edit/big.txt` (2 MB), `edit/readonly.txt`, then `/view` each. 3.8 with `view/README.md` and `edit/target.txt`.
   3.9 `/edit edit/alias/new.txt` (`alias` links to `real`).
4. **Semantic Output.** 4.1 `cd semantic/pass && npm test` (40 passing tests stand in for this repository's suite).
   4.2 `cd ../fail && npm test` (2 failing). 4.3 `cd ../ts && npx --no-install tsc --noEmit bad.ts` (2 errors); `cd
   ../c && make` (1 error). 4.4 `cd ../../git && git status`, `ls`, `cat tracked.txt`. 4.5 `cd ../semantic/fail &&
   npm test`, then as listed, with `pbpaste` after each copy. 4.6 as listed. 4.7 in step 8. `cd ../..` when done.
5. **`/track`.** 5.1 `/track df -h`; `/track --every 5s -- docker system df` is optional (read-only, but it asks your
   Docker daemon every 5 s). 5.2 `/track --every 2s -- cat track/f.txt`; second tab: `seq 1 2 >
   /Volumes/T7Tmp/ai-dev/q21/work/track/f.txt`, then `seq 1 40 > …`. 5.3–5.7 as listed (5.7's `/tmp/t` commands are
   refused and never run; answer No to the ones that ask). 5.8 `/track --every 3s -- sh -c 'sleep 2; echo QA-TRACK'`
   (Yes), close the window while it runs, then in a new window `pgrep -fl QA-TRACK` prints nothing. 5.9 and 5.10 as
   listed. 5.11 in step 8.
6. **Modules.** 6.1 `cd modules/bun-app`, `/modules`: Bun is recommended; enabled, typing `bun` shows `1.1.30`
   requested (Bun is not installed, so nothing active). 6.2 Not run (no Nix). 6.3 on this Mac the container module shows
   nothing; the in-container half is Not run. 6.4 and 6.5 as listed. `cd ../..`.
7. **Themes.** 7.1–7.3 as listed. 7.4 in step 8. 7.5 second tab, before and after switching themes: `shasum
   "$HOME/Library/Application Support/com.mitchellh.ghostty/config"*`: unchanged. Older configuration: `exit`, then in
   a plain window `mkdir -p /Volumes/T7Tmp/ai-dev/q21/config-copy/nmsh && cp "$HOME/Library/Application
   Support/notMyShell/config.json" /Volumes/T7Tmp/ai-dev/q21/config-copy/nmsh/` and `/Volumes/T7Tmp/ai-dev/q21/nmsh
   copy`: the theme and prompt saved by your v0.20 install load unchanged (only the copy can change).
8. **No color and Safe glyphs** (2.9, 4.7, 5.11, 7.4). `exit`, relaunch as `NO_COLOR=1 /Volumes/T7Tmp/ai-dev/q21/nmsh`,
   Settings → Appearance → Safe glyphs, then 2.9 on `view/README.md`, 4.7 with `cd semantic/fail && npm test` at 40
   columns (`cd ../..` after), 5.11 with `/track df -h`. Then 7.4's second half: `exit`, relaunch as `env -u COLORTERM TERM=xterm-256color
   /Volumes/T7Tmp/ai-dev/q21/nmsh` and switch between two new themes.

### Sitting B: Terminal.app, Fish (passes 1, 3 and 5, about 20 minutes)

`/Volumes/T7Tmp/ai-dev/q21/nmsh fish`, then 1.1–1.7 (not 1.5b), 3.1–3.9 and 5.1–5.10 as in sitting A, and 5.11 with
`NO_COLOR=1 /Volumes/T7Tmp/ai-dev/q21/nmsh fish` as in step 8. Terminal.app is a 256-color terminal: note anything that
reads differently from Ghostty.

### Sitting C: Terminal.app, zsh (passes 2 and 7, about 15 minutes)

`/Volumes/T7Tmp/ai-dev/q21/nmsh`, then 2.1–2.8 and 7.1–7.5 as in sitting A, and 2.9 and 7.4 as in step 8.

When every result is recorded: `rm -rf /Volumes/T7Tmp/ai-dev/q21`.

## 1. Multi-row progress redraws (#388)

- [ ] 1.1 `node -e 'for (let i=0;i<=10;i++){process.stdout.write((i?"\x1b[1A\x1b[2K":"")+"Downloading "+i*10+"%\n")}'`
  leaves one `Downloading 100%` line, at 80 columns and at 40 columns.
- [ ] 1.2 A two-row display (for example `docker pull` of a multi-layer image, or `brew install` of a formula with
  concurrent downloads) updates its rows in place; log lines printed between frames all stay. Record the command.
- [ ] 1.3 Resize the window narrower and wider while 1.2 runs: no earlier command, prompt or NMSh notice is erased.
- [ ] 1.4 `/copy` of that block copies the final rows once, not every frame.
- [ ] 1.5 `printf '10%%\r20%%\r100%%\n'` still shows one `100%` line; `clear` still clears.
- [ ] 1.5a At 40 columns, a progress display whose line is wider than the window (for example `pip install` of a
  large wheel, `cargo build` of a crate with a long name, or the wrapped-row fixture in `tests/ansiLiveRegion.test.ts`)
  redraws in place and every log line printed before it stays.
- [ ] 1.5b On Linux, `sudo apt install <small package>` (fancy progress on): the transcript keeps the dpkg log lines and
  contains no `Progress: [ nn%]` fragments.
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
- [ ] 3.9 A new file in a folder reached through a symlink (macOS `/tmp`, or `alias -> real`): `/edit alias/new.txt`,
  type a line, Ctrl+S, type another, Ctrl+S: *Saved* both times and no conflict question (#425); `real/new.txt` has
  both lines.

## 4. Semantic Output

- [ ] 4.1 `npm test` in this repository (long, passing): one overview row under the command (`✔ node --test · … passed ·
  0 failed …`) above the folded output; nothing else changed; the lifecycle row appears once.
- [ ] 4.2 A failing run (break one test): the overview says how many failed and a details row lists the failing tests;
  details are open when the output is folded, closed when it is expanded; clicking the row and Actions → Show or hide
  details toggle it; Ctrl+O still folds only the raw output.
- [ ] 4.3 `npx tsc --noEmit` with an error, `cargo build` with an error, `make` of a C file with an error: a
  diagnostics overview with `file:line:col` items.
- [ ] 4.4 `git status`, `ls`, `cat README.md`: no overview.
- [ ] 4.5 `/copy --semantic` and `/copy --both` on the failing run (paste into an editor); `/copy latest` is the raw
  output only; find (Ctrl+F) never matches the overview text.
- [ ] 4.6 Settings → Transcript → Semantic Output Off: the rows disappear from every block; On brings them back.
- [ ] 4.7 `NO_COLOR=1` and Safe glyphs: the overview reads `+`/`x` and stays readable at 40 columns.

## 5. `/track`

- [ ] 5.1 `/track df -h` and (where Docker runs) `/track --every 5s -- docker system df`: one block, a status row and the
  result; it updates in place every interval while you run other commands; scrolling up and selecting text in other
  blocks is never disturbed.
- [ ] 5.2 Make the result shorter and longer (`/track --every 2s -- cat f.txt` while editing `f.txt`): shorter results
  do not move what is below; longer ones say how many lines are not shown.
- [ ] 5.3 `/track refresh` twice quickly: the second is refused, never overlapped. `/track pause`, `/track resume`.
- [ ] 5.4 A failing command (`/track --every 2s -- ls missing`): the status shows the exit code, never a healthy result.
- [ ] 5.5 `/track copy` copies only the latest result; find (Ctrl+F) never matches the live rows.
- [ ] 5.6 `/track stop`: the last result appears once in the transcript; `/resume` of the saved session shows it
  without any per-refresh copies.
- [ ] 5.7 An unknown command asks for Yes first ("Track …?"); `rm`, `sudo`, `cd`, `$(...)`, `&` and heredocs are
  refused. Also refused: `/track echo x > /tmp/t 2>/dev/null`, `/track git log --output=/tmp/t`, `/track npx jest -u`.
  Asks first: `/track env ls`, `/track curl -X POST http://localhost:1/`, `/track npm publish`, `/track ssh localhost
  true`. Starts at once: `/track npm test 2>&1`, `/track curl -s http://localhost:1/` (fails, shows the exit code).
- [ ] 5.8 Close the window with a tracker running: no `sh` or command processes are left (`ps`). `/watch git status`
  still opens its manager.
- [ ] 5.9 Four trackers at once (`ls`, `df -h`, `cat f.txt`, a failing one): each block refreshes on its own, the
  composer area shows one `4 trackers · 1 failing` row, narrowing the window to 60 columns and back keeps every block
  readable, and `/track stop all` leaves each last result once.
- [ ] 5.10 `/track --every 2s -- sh -c 'trap "" TERM; exec >/dev/null 2>&1; exec sleep 300'` (Yes), then `/track stop`:
  within 3 seconds `pgrep -f "sleep 300"` finds nothing.
- [ ] 5.11 Safe glyphs (Settings → Appearance) and `NO_COLOR=1`: the status marks are ASCII (`*`, `=`, `#`) and the
  status still says live, paused or stopped in words.

## 6. Native modules and diagnostics

- [ ] 6.1 In a folder with `bun.lock` and `"packageManager": "bun@1.1.30"`, `/modules` recommends Bun; enabled, typing
  `bun` shows its version (requested, and active when installed through Homebrew).
- [ ] 6.2 `nix-shell -p hello` (or `nix develop`) with the Nix shell module enabled: it shows `impure`; it disappears
  after `exit`.
- [ ] 6.3 In a Docker or Podman container (or a Codespace), the container module names it; on the host it shows nothing.
- [ ] 6.4 `/modules explain` lists every configured module with its surface and reason; `/modules timings` lists the
  slowest collections; neither changes what is collected (the Status Strip CPU stays as it was).
- [ ] 6.5 Route three modules to the Context Rail (Modules → Surface), narrow the window until one disappears, then run
  `/modules explain`: that module says "left out for width in the last frame"; widen the window and run it again: the
  note is gone. The same with the Status Strip.

## 7. Theme families

- [ ] 7.1 `/theme`: the Built-in list shows Ayu, Kanagawa, Everforest, Flexoki and Night Owl; `/` then `kanagawa` leaves
  three; `/` then `light` leaves the light variants; Esc clears the filter, Esc again closes.
- [ ] 7.2 Activate each new variant on a dark terminal: prompt fills, branch, status, selection band and transcript
  chrome are readable; module text stays readable on every fill.
- [ ] 7.3 Activate the light variants (Ayu Light, Kanagawa Lotus, Everforest Light, Flexoki Light, Light Owl) on a light
  and on a dark terminal: accents and rules change, NMSh's text tiers stay readable.
- [ ] 7.4 `NO_COLOR=1` and a 256-color terminal (`TERM=xterm-256color`, no `COLORTERM`): nothing breaks.
- [ ] 7.5 Switching themes never changes Ghostty's or Terminal.app's own colors or configuration files; a config saved
  with an older theme id still loads that theme.
