# v0.22 physical QA

## Status

- **Candidate, not released.** The single release candidate is v0.22.0 on `release/v0.22.0`: the unpublished v0.21.0
  candidate (#429, never run through physical QA, never published) plus the v0.22 work. This walkthrough replaces
  [v0.21 physical QA](v021-physical-qa.md): test this build once. Nothing below has been run yet.
- **What does not count:** headless PTY fixtures, synthetic keys, captures of a window driven that way, and green CI.
  Each item needs a person at a real terminal with a real keyboard and pointer.
- **Build under test:** the release candidate commit, built from a clean checkout (`npm ci && npm run build`); record
  `node dist/index.js --version` (version and build commit) in every row.
- **Isolation:** `scripts/qa/v022-fixtures.sh` makes a throwaway folder with its own NMSh configuration
  (`XDG_CONFIG_HOME`) and session service (`NMSH_RUNTIME_DIR`), so the QA build neither reads your settings nor
  attaches to your running sessions. `HOME` is unchanged: your shell's own startup files run as usual, copy items
  replace your clipboard, and `/llm` finds models already in `~/.local/share/nmsh/models`.

## Results

| Pass | Host and version | OS | Shell and version | Commit | Result | Notes |
|---|---|---|---|---|---|---|
| 1 Multi-row progress (#388) | Ghostty | macOS | zsh | | Not run | |
| 1 Multi-row progress (#388) | Terminal.app | macOS | Fish | | Not run | |
| 2 `/view` | Ghostty | macOS | zsh | | Not run | |
| 2 `/view` | Terminal.app | macOS | zsh | | Not run | |
| 3 `/edit` | Ghostty | macOS | zsh | | Not run | |
| 3 `/edit` | Terminal.app | macOS | Fish | | Not run | |
| 4 Semantic Output | Ghostty | macOS | zsh | | Not run | |
| 5 `/track` | Ghostty | macOS | zsh | | Not run | |
| 5 `/track` | Terminal.app | macOS | Fish | | Not run | |
| 6 Modules | Ghostty | macOS | zsh | | Not run | |
| 7 Themes | Ghostty | macOS | zsh | | Not run | |
| 7 Themes | Terminal.app | macOS | zsh | | Not run | |
| 8 History browsing (#389) | Ghostty | macOS | zsh | | Not run | |
| 8 History browsing (#389) | Terminal.app | macOS | Fish | | Not run | |
| 9 Passwords and replies (#426) | Ghostty | macOS | zsh | | Not run | |
| 9 Passwords and replies (#426) | Terminal.app | macOS | Fish | | Not run | |
| 9 Passwords and replies (#426) | Terminal.app | macOS | Bash | | Not run | |
| 10 Prompt hooks and Ctrl+C (#436) | Ghostty | macOS | zsh | | Not run | |
| 10 Prompt hooks and Ctrl+C (#436) | Terminal.app | macOS | Fish | | Not run | |
| 10 Prompt hooks and Ctrl+C (#436) | Terminal.app | macOS | Bash | | Not run | |
| 11 Editors (#366) | Ghostty | macOS | zsh | | Not run | |
| 11 Editors (#366) | Zed or VS Code terminal | macOS | zsh | | Not run | 11.6, 11.11 |
| 12 Ask command suggestions (#432) | Ghostty | macOS | zsh | | Not run | |
| 13 Session lifecycle | Ghostty | macOS | zsh | | Not run | |
| Z Supplementary | Zed | macOS | zsh | | Not run | not a release gate |

Not available on the QA Mac, with the coverage that exists instead: 1.5b (`apt` progress; Linux only: parser and live
PTY tests, Ubuntu and Fedora CI), 4.3 `cargo build` (not installed; Rust diagnostics recognizer tests), 6.2
(`nix-shell`; the module reads only `IN_NIX_SHELL`, unit-tested), 6.3 inside a container (marker files and host
variables, unit-tested; the host half is checked here). Each stays *Not run* in the table, never *Pass*.

## Walkthrough

Three sittings, about two and a half hours in all, plus a short Zed check. Every command below is typed in NMSh unless it says
"second tab".

**Prepare once.** In a plain terminal window (not inside NMSh):

```sh
cd /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/v022-qa     # the release candidate build
node dist/index.js --version                              # record version and build commit
scripts/qa/v022-fixtures.sh /Volumes/T7Tmp/ai-dev/q22
```

Each sitting starts from a plain window: `/Volumes/T7Tmp/ai-dev/q22/nmsh` (zsh), `… nmsh fish` or `… nmsh bash`. NMSh
opens in `q22/work`; paths below are relative to it. Quit with `exit`. If a launch offers to resume a detached
session, press R and `exit` it.

**Reporting.** One line per pass, for example `Pass 9 · Ghostty 1.3.1 · zsh 5.9: PASS` or `Pass 9: FAIL 9.4 (the
second password ran)`; a screenshot helps. Each result is recorded in the table with the build commit. A skipped item
is *Not run*.

### Sitting A: Ghostty, zsh (passes 1–13, about 85 minutes)

Passes 1–7 are v0.21's, unchanged:

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
   running. 2.9 in step 14.
3. **`/edit`.** 3.1 `cd edit/empty`, then as listed, with `cat -vet notes.txt` (macOS `cat` has no `-A`): `^I` and a
   final `$`. 3.2–3.4 on that file. 3.5 second tab: `echo x >> /Volumes/T7Tmp/ai-dev/q22/work/edit/empty/notes.txt`.
   `cd ../..`. 3.6 `/edit edit/crlf-bom.txt`, change a word, save; `xxd edit/crlf-bom.txt | head -1` starts `efbb bf`
   and lines end `0d0a`. `/edit edit/mode640.txt`, save, `ls -l edit/mode640.txt` is `-rw-r-----`. `/edit
   edit/link.txt`, save, `ls -l edit/link.txt` still points to `target.txt`. 3.7 `/edit /bin/ls`, `/etc/hosts`,
   `edit/big.txt` (2 MB), `edit/readonly.txt`, then `/view` each. 3.8 with `view/README.md` and `edit/target.txt`.
   3.9 `/edit edit/alias/new.txt` (`alias` links to `real`).
4. **Semantic Output.** 4.1 `cd semantic/pass && npm test` (40 passing tests stand in for a large suite). 4.2 `cd
   ../fail && npm test` (2 failing). 4.3 `cd ../ts && npx --no-install tsc --noEmit bad.ts` (2 errors); `cd ../c &&
   make` (1 error). 4.4 `cd ../../git && git status`, `ls`, `cat tracked.txt`. 4.5 `cd ../semantic/fail && npm test`,
   then as listed, with `pbpaste` after each copy. 4.6 as listed. 4.7 in step 14. `cd ../..` when done.
5. **`/track`.** 5.1 `/track df -h`; `/track --every 5s -- docker system df` is optional (read-only, but it asks your
   Docker daemon every 5 s). 5.2 `/track --every 2s -- cat track/f.txt`; second tab: `seq 1 2 >
   /Volumes/T7Tmp/ai-dev/q22/work/track/f.txt`, then `seq 1 40 > …`. 5.3–5.7 as listed (5.7's `/tmp/t` commands are
   refused and never run; answer No to the ones that ask). 5.8 `/track --every 3s -- sh -c 'sleep 2; echo QA-TRACK'`
   (Yes), close the window while it runs, then in a new window `pgrep -fl QA-TRACK` prints nothing. 5.9 and 5.10 as
   listed. 5.11 in step 14.
6. **Modules.** 6.1 `cd modules/bun-app`, `/modules`: Bun is recommended; enabled, typing `bun` shows `1.1.30`
   requested (Bun is not installed, so nothing active). 6.2 Not run (no Nix). 6.3 on this Mac the container module shows
   nothing; the in-container half is Not run. 6.4 and 6.5 as listed. `cd ../..`.
7. **Themes.** 7.1–7.3 as listed. 7.4 in step 14. 7.5 second tab, before and after switching themes: `shasum
   "$HOME/Library/Application Support/com.mitchellh.ghostty/config"*`: unchanged. Older configuration: `exit`, then in
   a plain window `mkdir -p /Volumes/T7Tmp/ai-dev/q22/config-copy/nmsh && cp "$HOME/Library/Application
   Support/notMyShell/config.json" /Volumes/T7Tmp/ai-dev/q22/config-copy/nmsh/` and `/Volumes/T7Tmp/ai-dev/q22/nmsh
   copy`: the theme and prompt saved by your v0.20 install load unchanged (only the copy can change). `exit` and
   relaunch `/Volumes/T7Tmp/ai-dev/q22/nmsh` for the rest.

Passes 8–13 are v0.22's:

8. **History.** 8.1–8.6 as listed.
9. **Passwords and replies.** 9.1–9.11 as listed, from `q22/work`; 9.5 needs a second window with a heavy job.
10. **Prompt hooks and Ctrl+C.** 10.1–10.3 as listed.
11. **Editors.** 11.1–11.4 as listed (with `EDITOR` set as usual). Then `exit` and relaunch as
   `/Volumes/T7Tmp/ai-dev/q22/nmsh-noeditor` for 11.5 and 11.8–11.10. 11.6 and 11.11 are in the Zed sitting.
12. **Ask.** 12.1–12.6 as listed (the model takes about 1 GB of memory while it runs; `/llm` can stop it).
13. **Session lifecycle.** 13.1–13.3 as listed.
14. **No color and Safe glyphs** (2.9, 4.7, 5.11, 7.4). `exit`, relaunch as `NO_COLOR=1 /Volumes/T7Tmp/ai-dev/q22/nmsh`,
   Settings → Appearance → Safe glyphs, then 2.9 on `view/README.md`, 4.7 with `cd semantic/fail && npm test` at 40
   columns (`cd ../..` after), 5.11 with `/track df -h`, and 8.1 (the History position stays readable). Then 7.4's
   second half: `exit`, relaunch as `env -u COLORTERM TERM=xterm-256color /Volumes/T7Tmp/ai-dev/q22/nmsh` and switch
   between two new themes.

### Sitting B: Terminal.app, Fish (passes 1, 3, 5, 8, 9 and 10, about 35 minutes)

`/Volumes/T7Tmp/ai-dev/q22/nmsh fish`, then 1.1–1.7 (not 1.5b), 3.1–3.9, 5.1–5.10, 8.1–8.6, 9.1–9.7 (Fish forms are
given) and 10.1–10.3 as in sitting A, and 5.11 with `NO_COLOR=1 /Volumes/T7Tmp/ai-dev/q22/nmsh fish` as in step 14.
Terminal.app is a 256-color terminal: note anything that reads differently from Ghostty.

### Sitting C: Terminal.app, zsh then Bash (passes 2, 7, 9 and 10, about 30 minutes)

`/Volumes/T7Tmp/ai-dev/q22/nmsh`, then 2.1–2.8 and 7.1–7.5 as in sitting A, and 2.9 and 7.4 as in step 14. Then `exit`,
`/Volumes/T7Tmp/ai-dev/q22/nmsh bash`, 9.1–9.11 (in 9.11 use `history | tail -10`) and 10.1–10.3.

### Zed (about 15 minutes)

In Zed's terminal: `/Volumes/T7Tmp/ai-dev/q22/nmsh`, then 11.6 and 11.11 (the 11 row: Zed opens the file itself). The
rest is supplementary coverage, not a release gate (the Z row): 1.2, 2.1 and 2.3 (wheel scrolling), 3.1–3.2 (note any
key Zed keeps for itself, such as Cmd+Shift+arrows), 5.1 and `/track stop`, 8.1, and one theme switch.

When every result is recorded: `rm -rf /Volumes/T7Tmp/ai-dev/q22`.

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

- [ ] 2.1 `/view README.md` in the NMSh checkout: Markdown is rendered (headings, lists, code, tables); `m` shows the
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

- [ ] 4.1 `npm test` in the NMSh checkout (long, passing): one overview row under the command (`✔ node --test · … passed ·
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

## 8. History browsing (#389)

Run a multi-line command (Ctrl+J between lines, for example `echo one` Ctrl+J `echo two`) and a few one-line ones.

- [ ] 8.1 From an empty composer, Up recalls the newest; each further Up moves one command, passing the multi-line one in
  one press; Down comes back the same way; Down past the newest restores what you had typed.
- [ ] 8.2 Recall the multi-line command, press Left (or type a character), then Up: the caret moves within it.
- [ ] 8.3 Narrow window (about 46 columns) with a long one-line command: one press per entry.
- [ ] 8.4 While stepping, the bottom composer rule shows `History 1/N` for the newest, counting up as you go back. It
  disappears when you type, move the caret or go past the newest. No row is added and nothing moves.
- [ ] 8.5 With `/awake` on, Keep Awake keeps its place; the label is on the other rule or not shown. In a window of about
  30 columns, and with Settings → Composer dividers Off, no label appears and nothing wraps.
- [ ] 8.6 Light and dark themes: the label is readable. Up while a command runs recalls into the composer for the next
  command, never into the running program.

## 9. Passwords and replies while a command runs (#426)

Replies are made-up words, never a real password (except 9.7, which is your own `sudo`). Fish forms: `read reply` for
`read -r reply`, `read --silent reply` for `read -s`.

- [ ] 9.1 `read -r reply; echo got=$reply`. Type `hello` and Enter **at once**, without waiting: `got=hello`, the status
  row never shows `queued`.
- [ ] 9.2 The same after a two-second pause: same result.
- [ ] 9.3 `read -rs reply` (no prompt). Type `QSECRETQ` and Enter at once: the text never appears anywhere on screen
  and nothing is queued.
- [ ] 9.4 `sleep 5`, then type `echo next` and Enter at once: it is queued (`≡ 1 queued`) and runs after `sleep`.
- [ ] 9.5 Load: in a second window run something heavy (a large build or test suite, or several at once), then repeat 9.1
  and 9.3 a few times. The composer may briefly say `Checking whether … is waiting for input · your typing is kept`;
  either way the answer reaches the read and nothing is shown or queued. Ctrl+C right after typing during that note
  interrupts the command and discards the held typing. If NMSh still cannot tell after about five seconds, the row says
  `Can't tell whether … is reading your typing · held, not shown` and the composer offers `Ctrl+S sends it to … · Tab
  shows it · Esc discards it`: Ctrl+S sends it to the program, Tab shows it unsent, Esc discards it; nothing held runs
  as a shell command without one of these. Note whether the notes appeared (not expected on a lightly loaded machine).
- [ ] 9.6 `sh input/prompted.sh`: `QA password:` shows, typing shows nothing, Enter prints `got N characters`. Type
  `echo after` and Enter at once: it runs once as the next command (or, if the composer says `… held, not run · Tab
  shows it · Esc discards it`, Tab shows it and Enter runs it once).
- [ ] 9.7 `sudo -k true`: the password never appears on screen or in the queue; a wrong password and the retry behave
  the same. Ctrl+C at the password prompt returns to the composer with nothing queued.
- [ ] 9.8 (zsh, Bash) `bash input/two-passwords.sh`: type `X` and Enter as soon as it starts (no prompt is shown); while
  it waits 3 s, type a second word and Enter before NMSh says it is waiting again. That word is shown and queued (NMSh
  could not know); when the second read starts, a note says the command queued while it ran waits for your approval.
  Type the second word again and Enter: `lengths …` prints and the queued entry does not run. Delete it in `/queue`.
- [ ] 9.9 (zsh, Bash) `bash input/second-gives-up.sh`: type `X`, Enter, and at once a second word and Enter. Whatever the
  timing, the second word is never shown, queued or run: the second read takes it (`lengths 1/…`), or a note says it
  was discarded, not run, or the composer says `Typed during bash's hidden input · held, not run · Tab shows it · Esc
  discards it` (Esc discards it with a note; Tab would show it in the composer, unsent).
- [ ] 9.10 `sh input/plain-read.sh`: type `hello` and Enter at once: `reply was hello`, nothing queued.
- [ ] 9.11 Afterwards, `fc -ln -15` (Bash: `history | tail -15`; Fish: `history | head -15`): no word typed as a reply
  appears, only the commands you ran.

## 10. Prompt hooks and Ctrl+C (#436)

- [ ] 10.1 `sleep 30`, press Ctrl+C, then **at once** type `echo after` and Enter: `after` is printed exactly once, as its
  own command. Nothing is queued forever and nothing is taken as an answer.
- [ ] 10.2 A program that asks just before it is interrupted: `read -r x` (Fish: `read x`), Ctrl+C, then at once `echo
  after` Enter: same result.
- [ ] 10.3 A slow prompt hook, for this session only. zsh: `source input/slow-hook.zsh`. Bash 5.1+: `source
  input/slow-hook.bash`. Fish: `function qa_slow --on-event fish_prompt; sleep 2; end`. Then run `true` and, while the
  next prompt is still coming, type `echo after` and Enter: it runs once, whole (never `cho after` or `command not
  found`), after the hook, and is never shown as an answer to a waiting program. Repeat a few times, also under load (as
  in 9.5). Undo the hook as its file says (Fish: `functions -e qa_slow`).

## 11. Editors (#366)

`view/notes.txt` has 400 lines.

- [ ] 11.1 With `EDITOR=nvim` (or `vim`) set as usual: `/view view/notes.txt`, `:200` Enter, `o`. The viewer closes and
  the composer holds `nvim +200 /…/notes.txt` (nothing runs). Enter opens the editor at line 200; quitting it returns
  to NMSh's composer.
- [ ] 11.2 While a command runs: `sleep 20`, then `/view view/notes.txt`, `o`. The editor command is placed in the
  composer; Enter queues it (`≡ 1 queued`) and the editor opens after `sleep` ends.
- [ ] 11.3 A name with spaces: `printf 'x\n' > 'my notes.txt'`, `/view my notes.txt` (the rest of the line is the path,
  no quotes), `o`: the composer command quotes the path as one argument.
- [ ] 11.4 Markdown: `/view view/README.md` (rendered), `o` opens at the start; after `m` (source) it opens at the line
  shown. In a window of about 46 columns the footer wraps and `Esc close` stays visible.
- [ ] 11.5 With `VISUAL` and `EDITOR` unset (`nmsh-noeditor`), outside any editor: `o` says no editor is known and how to
  set one, and `/open view/notes.txt:3` names the terminal editors installed here.
- [ ] 11.6 Inside Zed's or VS Code's integrated terminal: `o` opens the file at the line in that editor; the viewer stays.
- 11.7 Not a physical item: a draft already in the composer is never replaced by `o`, but opening `/view` empties the
  composer, so only the automated tests reach that case.
- [ ] 11.8 (`nmsh-noeditor`) Settings → Sessions → Terminal editor (also Setup → Sessions & alerts → Terminal editor):
  Neovim, Helix, Micro, Vim, nano, Emacs and Kakoune, with the installed ones marked; the highlighted one previews the
  exact command. Choosing one that is not installed is refused, and nothing is installed. Choose one that is installed.
- [ ] 11.9 (`nmsh-noeditor`) `/open view/notes.txt:3:2` puts its command in the composer at the right line (and column
  where the editor supports it); nothing runs until Enter. Quitting the editor returns to NMSh.
- [ ] 11.10 (`nmsh-noeditor`) In `/view view/notes.txt`, `o` uses the chosen editor.
- [ ] 11.11 Inside Zed's or VS Code's integrated terminal, the surrounding editor still wins over the chosen one.

## 12. Ask command suggestions (#432)

Needs a local model in `/llm` (the QA configuration starts without one; `~/.local/share/nmsh/models` already holds one).

- [ ] 12.1 With Settings → Ask → Command suggestions Off (the default), `/btw convert every png here to webp` behaves as
  before: no model is asked.
- [ ] 12.2 Set Command suggestions to Local model (Settings, or Setup → Ask & local understanding). The same request
  shows one suggested command with `NMSh's check: …` first, then the model's words in quotes with its name. There is
  Copy and Insert, never Run.
- [ ] 12.3 Insert puts the command in the composer, unsent; Enter runs it. Copy runs nothing.
- [ ] 12.4 `/btw delete all my files` stays a refusal; no suggestion is offered.
- [ ] 12.5 With local understanding Off in `/llm`, the suggestion attempt says how to turn it on. Ask's own suggestions
  are still offered.
- [ ] 12.6 Activity Monitor: no new long-lived process appears beyond the shared model service while suggestions are on.

## 13. Session lifecycle

- [ ] 13.1 Run `sleep 60`, close the window, and launch the QA build again: it offers the detached session; R resumes it
  with `sleep` still running and its block intact; Ctrl+C ends it.
- [ ] 13.2 With `/track --every 2s -- sh -c 'echo QA-LIFE'` running (Yes), `exit`: in a plain window `pgrep -fl QA-LIFE`
  prints nothing.
- [ ] 13.3 Two windows on two sessions of the QA build: typing, queues and held input in one never appear in the other.
