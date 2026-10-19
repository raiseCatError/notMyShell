# v0.22 physical QA

One walkthrough for the v0.22.0 release candidate (#444). It replaces [v0.21 physical QA](v021-physical-qa.md)
(never run; v0.21.0 is not published) and the per-PR v0.22 passes. Sittings A and part of B were run on candidate
`68c1cbb7` (results below); the person running QA then stopped repetitive manual testing, and the remaining passes are
recorded as not run. Fixes made after that QA have their own short retests (see Retests after the stabilization fixes).
The final hardening pass (#457) then changed how typing while a command runs is routed and how NMSh sizes the shell's
terminal: A1, A9, A10 and B1 no longer stand for the new candidate and are replaced by R5–R7.

- **What counts:** a person at a real terminal, with a real keyboard and pointer. Headless tests, synthetic keys and green
  CI do not count, and no row is marked from them.
- **Isolation:** the QA launcher gives NMSh its own configuration and session service, so it never reads your settings
  or attaches to your sessions. Your shell's own startup files run as usual. Copy steps replace your clipboard.
  Nothing here changes your shell settings, editor preferences, themes or agent sessions.
- **Not physical here:** what the automated suites already exercise on macOS and Linux (refusal messages, file-format
  preservation on save, `/track` command classification, viewer numbering) is not repeated by hand; Linux (`apt`
  progress, Fish 3, Fedora), `cargo`, `nix-shell` and in-container checks stay *Not run* (CI covers them).

## Before you start (5 minutes)

1. **The build is the candidate.** In a plain window:

   ```sh
   cd /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/v022-qa
   git rev-parse --short HEAD          # must equal the commit in #444's latest "Candidate for physical QA" comment
   node dist/index.js --version        # notMyShell 0.22.0, build <the same commit>
   ```

   Different commits, or `dirty`: stop and report it; do not test.
2. **Fixtures:** `scripts/qa/v022-fixtures.sh /Volumes/T7Tmp/ai-dev/q22` (if it says the folder exists, it is ready).
3. **Launch** from a plain window of the terminal under test: `/Volumes/T7Tmp/ai-dev/q22/nmsh` (zsh), `… nmsh fish`,
   `… nmsh bash`, or `… nmsh-noeditor` (VISUAL and EDITOR unset). NMSh opens in `q22/work`; paths below are relative
   to it. The welcome banner shows `notMyShell 0.22.0` and `build <commit>`: check it once per sitting.
4. **Report** one line per pass: `Pass A9 · Ghostty 1.3.1 · zsh 5.9: PASS — notes` or `… FAIL — step 5: the word ran`.
   A step you skip makes the pass *Not run*, never *Pass*.
5. **If something goes wrong:** a screenshot (Cmd+Shift+4) of the whole window is the most useful evidence; for input
   cases add `fc -ln -30` (Bash: `history | tail -30`). Ctrl+C, then `exit`, then relaunch; if a launch offers to resume
   a detached session, press R and `exit` it. Reset all fixtures from `v022-qa`:
   `rm -rf /Volumes/T7Tmp/ai-dev/q22 && scripts/qa/v022-fixtures.sh /Volumes/T7Tmp/ai-dev/q22`.

## Results

| Pass | Terminal | Shell | Commit | Result | Notes |
|---|---|---|---|---|---|
| A1 Progress (#388) | Ghostty | zsh | 68c1cbb7 | PASS | steps 1–3 and 6 superseded by R7 (shell terminal size changed, #457) |
| A2 `/view` | Ghostty | zsh | 68c1cbb7 | PASS | embedded HTML shown literally: F01, see R3 |
| A3 `/edit` | Ghostty | zsh | 68c1cbb7 | PASS |  |
| A4 Semantic Output | Ghostty | zsh | 68c1cbb7 | PASS |  |
| A5 `/track` | Ghostty | zsh | 68c1cbb7 | PASS | multi-line paste of /track lines: F02, see R2 |
| A6 Modules | Ghostty | zsh | 68c1cbb7 | PASS | `cd` + `/modules` pasted: F02, see R2 |
| A7 Themes | Ghostty | zsh | 68c1cbb7 | PASS |  |
| A8 History (#389) | Ghostty | zsh | 68c1cbb7 | PASS |  |
| A9 Passwords and replies (#426) | Ghostty | zsh | 68c1cbb7 | PASS | step 9 (CPU load) not run (machine constraints); queue overview hidden during the wait: F03. Superseded by R5 (routing changed, #457) |
| A10 Prompt hooks and Ctrl+C (#436) | Ghostty | zsh | 68c1cbb7 | PASS | superseded by R6 (routing changed, #457) |
| A11 Editors (#366) | Ghostty | zsh | 68c1cbb7 | PASS |  |
| A12 Ask suggestions (#432) | Ghostty | zsh | 68c1cbb7 | **FAIL** | the folder listing instead of a suggestion: F04 (#446), see R1 |
| A13 Session lifecycle | Ghostty | zsh | 68c1cbb7 | PASS |  |
| A14 No color and Safe glyphs | Ghostty | zsh | 68c1cbb7 | PASS |  |
| B1 Progress | Terminal.app | Fish | 68c1cbb7 | PASS | superseded by R7 step 4 (#457) |
| B3 `/edit` keys | Terminal.app | Fish | 68c1cbb7 | PASS |  |
| B5 `/track` cleanup | Terminal.app | Fish |  | NOT RUN | user waived/deferred further manual QA |
| B8 History | Terminal.app | Fish |  | NOT RUN | user waived/deferred further manual QA |
| B9 Passwords and replies | Terminal.app | Fish |  | NOT RUN | user waived/deferred; covered by R4 if run |
| B10 Prompt hooks and Ctrl+C | Terminal.app | Fish |  | NOT RUN | user waived/deferred further manual QA |
| C2 `/view` rendering | Terminal.app | zsh |  | NOT RUN | user waived/deferred further manual QA |
| C7 Themes, 256 colors | Terminal.app | zsh |  | NOT RUN | user waived/deferred further manual QA |
| C9 Passwords and replies | Terminal.app | Bash |  | NOT RUN | user waived/deferred; covered by R4 if run |
| C10 Prompt hooks and Ctrl+C | Terminal.app | Bash |  | NOT RUN | user waived/deferred further manual QA |
| D11 Editor bridge | Zed | zsh |  | NOT RUN | required; user waived/deferred |
| Z Supplementary | Zed | zsh |  | NOT RUN | not a release gate |
| R1 Ask suggestions (F04) | Ghostty | zsh |  | Not run | retest on the new candidate |
| R2 Pasted NMSh commands (F02) | Ghostty | zsh |  | Not run | retest on the new candidate |
| R3 HTML in `/view` (F01) | Ghostty | zsh |  | Not run | retest on the new candidate |
| R4 Typing while a command runs (#426, #436) | Terminal.app | Fish, Bash |  | Not run | retest on the new candidate (rewritten for #457) |
| R5 Passwords and replies (#426, replaces A9) | Ghostty | zsh |  | Not run | retest on the new candidate |
| R6 Prompt hooks and Ctrl+C (#436, replaces A10) | Ghostty | zsh |  | Not run | retest on the new candidate |
| R7 Progress and window size (#443, replaces A1 1–3, 6 and B1) | Ghostty, Terminal.app | zsh, Fish |  | Not run | retest on the new candidate |

**NOT RUN is not PASS.** The nine required passes above were not performed; if the release goes ahead without them, that
is a recorded acceptance of their risk (below), not a result.

### Reduced coverage: what is and is not proven

- **Proven physically (Ghostty, zsh):** everything in sitting A except A12 (failed, now fixed: R1) and A9's load step.
- **Not proven physically:** Fish and Bash input security (B9, C9) and prompt hooks (B10, C10), Fish `/track` process
  cleanup (B5), Terminal.app's 256-color themes and `/view` drawing (C7, C2), Fish history (B8), and the Zed editor
  bridge (D11). Ghostty passing does not cover them: input routing depends on the shell (Fish's reader and Bash's
  `PROMPT_COMMAND` differ from zsh's hooks), and D11 is the only check of the Zed bridge.
- **Automated cover for those:** live tests run real Fish and Bash on CI (macOS and Ubuntu) for the input, queue,
  prompt-hook and typing-after-read paths, and locally on macOS for this candidate (Fish 4.9.3, Bash 5). They do not
  exercise a person's timing, Terminal.app or Zed.
- **Smallest meaningful remaining checks**, by unique risk: R4 (Fish and Bash typing security, about 10 min), D11 (Zed,
  2 min), then B10 and C10 (prompt hooks in Fish and Bash, 4 min). B5, B8, C2 and C7 repeat Ghostty-proven drawing and
  can reasonably be waived.

## Retests after the stabilization fixes (about 60 minutes)

The candidate changed after the QA above (fixes for F01–F04 and #426, #443; then the hardening pass #457; see the ledger).
Only what those changes touch is retested; every other result above stands for the new candidate. **What changed for
you in #457:** while a command runs, a plain Enter holds the line for your approval (shown as `(typed while … ran)`,
never by its text) and **Ctrl+Q** queues a command to run after; a line typed right after Ctrl+C runs once the prompt is
back; typing a program never reads is taken back when it ends and waits for approval.

**Build:** a separate QA build at the new candidate, so `68c1cbb7`'s build stays as it was:

```sh
git -C /Users/jaisukka/Projects/notMyShell fetch origin
git -C /Users/jaisukka/Projects/notMyShell worktree add --detach /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/v022-qa2 origin/release/v0.22.0
cd /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/v022-qa2 && t7run npm ci && t7run npm run build
git rev-parse --short HEAD    # the commit in #444's latest "Candidate for physical QA" comment
scripts/qa/v022-retest-fixtures.sh /Volumes/T7Tmp/ai-dev/q22 /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/v022-qa2
```

Launch with `/Volumes/T7Tmp/ai-dev/q22/nmsh2` (`nmsh2 fish`, `nmsh2 bash`): your QA configuration, the new build, its
own session service. The welcome banner names the new build. If a window says its session service is from an older
NMSh, `exit` every `nmsh2` window and start again.

### R1 · Ask command suggestions (F04, replaces A12), Ghostty, zsh, 8 min
0. Memory first, as in A12.
1. Settings → Ask → Command suggestions **Off**. `/btw convert every png here to webp`: Ask says it doesn't run shell
   tasks like this itself and names Settings → Ask → Command suggestions. No folder listing, no model asked.
2. Command suggestions → **Local model** (local understanding Auto, your model set up in `/llm`). `cd retest/images`,
   then `/btw convert every png here to webp`: one suggested command, `NMSh's check: …` first, then your model's words
   in quotes with its name, and Copy and Insert only. The model may suggest an imprecise command or none ("suggested
   no command for this"); either is a PASS for this step, a folder listing is a FAIL.
3. Insert: the command waits in the composer, unsent (Esc clears it). Copy: only the clipboard changes.
4. `/btw find files bigger than 100mb` and `/btw rename all .jpeg files to .jpg`: a suggestion (or "no command"),
   never a listing, "Install which shell?" or a transcript search.
5. `/btw delete all my files`: still refused; no suggestion.
6. `/llm` → local understanding Off; `/btw convert every png here to webp`: says suggestions need local understanding
   and how to turn it on. Finish with `/llm` → Stop model, and `cd ../..`.

**PASS** if no step shows an unrelated screen, nothing runs without your Enter, and the refusal stands.

### R2 · Pasted NMSh commands (F02), Ghostty, zsh, 4 min
1. `pbcopy < retest/paste-mixed.txt`, paste (Cmd+V), Enter (inserts), Enter: nothing runs; the reviewed list opens
   with `1 One at a time · 2 commands` and no Run as block or Queue choice. Enter: `cd modules/bun-app` waits in the
   composer with `Pasted command 1 of 2 · Enter runs it · Esc stops`. Enter: it runs; `/modules` is then offered.
   Enter: the Modules panel opens (no `zsh: no such file or directory`). Close it; `cd ../..`.
2. `pbcopy < retest/paste-track.txt`, paste, Enter, Enter, Enter: each `/track …` is offered in turn and runs as its
   own tracker on your Enter. `/track stop` each one.
3. Paste `retest/paste-mixed.txt` again, Enter, Enter, Enter, then Esc while `cd …` waits: the composer empties and
   nothing more is offered. A multi-line shell script with no NMSh line (`for i in 1 2` Ctrl+J `do echo $i` Ctrl+J
   `done`) still runs as one command.

**PASS** if no NMSh line ever reaches the shell and nothing runs without its own Enter.

### R3 · HTML in `/view` (F01), Ghostty, zsh, 5 min
1. `/view retest/README-html.md`: the logo and badge read `[image: QA logo]` and `[image: CI badge]`, the heading and
   list render, **Bold words** are bold, `Ctrl`+`C` look like keys; no `<div>`, `<picture>`, `<img>`, `<p>` or `<kbd>`
   text. `m` shows the source; `m` again returns.
2. `/view retest/page.html`: heading, paragraph styles, the numbered list with its nested item, the table (Value
   right-aligned), the code block, the quote, a rule, and `☑ done` / `☐ open`. `/` `nested` finds it. Narrow the window
   to about 40 columns: it still fits.
3. `/view retest/hostile.html`: `Hostile page` and `Visible text` only, plus `[image: local file reference]` and the two
   links shown with their targets as text. Nothing else: no `QA-SCRIPT-RAN`, no title change, no screen clear, no
   `QA-IFRAME`, no `/etc/passwd` contents, no network activity.
4. A2 step 1 again (`/view view/README.md`) and step 4 (`view/hostile.txt`): unchanged.

**PASS** if all hold.

### R4 · Typing while a command runs (#426, #436), Terminal.app, Fish then Bash, 12 min
Launch `nmsh2 fish`; then repeat in `nmsh2 bash`.
1. R5 steps 2, 3 and 4 in that shell.
2. R5 step 5 (`bash retest/timed-prompt.sh`).
3. R6 steps 1 and 3; for step 4 in Fish use `function qa_slow --on-event fish_prompt; sleep 2; end` (undo with
   `functions -e qa_slow`), in Bash `source input/slow-hook.bash`.
4. Fish: `history | head -30`; Bash: `history | tail -30`: no `QRETESTQ`, `123456` or other reply word.

**PASS** if no reply word ever runs by itself or reaches history, and every command you meant (Ctrl+Q, approved, or
typed after Ctrl+C or during a slow hook) runs exactly once. This also covers the input-security part of B9 and C9.

### R5 · Passwords and replies (#426, replaces A9), Ghostty, zsh, 14 min
Replies are made-up words, never a real password (only step 8 uses yours).
1. A9 steps 1 and 2 (a waiting `read`, a hidden `read -rs`): unchanged.
2. `sleep 5`: the empty composer says `Enter holds it for approval · Ctrl+Q runs it after · Ctrl+S sends to sleep`. Type
   `echo next` and Enter: a note says the line may be sleep's reply and never runs by itself; the queue shows
   `(typed while sleep ran)`, not the text. When `sleep` ends nothing runs. Empty Enter: the review opens without the
   text; Tab shows `echo next`; Enter approves: it runs once.
3. `sleep 5`, type `echo after` and **Ctrl+Q**: it runs after `sleep`, no approval asked.
4. `bash retest/timed-read.sh`; during its 2 s sleep type `ls` and Enter, then `QRETESTQ` and Enter. `QA-TIMED-DONE`
   prints; neither runs (no listing, no `command not found`). `/queue`: both show as `(typed while bash ran)`; delete
   them. A command typed at the prompt meanwhile runs at once (the held lines never block it).
5. `bash retest/timed-prompt.sh`: `QA code:` appears and gives up after 2 s. Then (within its 3 s) type `123456` and
   Enter. `QA-CODE-DONE` prints; `123456` never runs; a note says bash did not read some of your typing and it waits
   for your approval. `/queue`: delete it.
6. A9 step 5 (typed before the prompt, no Enter): unchanged.
7. `sh input/delayed-prompt.sh`, type `QSECRETQ` and Enter before the prompt: it is held for approval at once (the note
   never shows it). When `QA-Password:` appears, answer `answer`: `got 6 characters`; the held line never runs.
   `/queue`: delete it.
8. A9 step 8 (`sudo -k true` with your password): unchanged.
9. `fc -ln -30`: none of the reply words, only the commands you ran or approved.

**PASS** if no reply or password word is ever shown after its question appeared, run without your approval, or in
history. **FAIL** with a screenshot and `fc -ln -30`.

### R6 · Prompt hooks and Ctrl+C (#436, replaces A10), Ghostty, zsh, 6 min
1. `sleep 30`, Ctrl+C, then at once `echo after` and Enter: the composer may say `Runs at the prompt once sleep stops`;
   `after` runs once, as its own command, when the prompt is back.
2. `read -r x`, Ctrl+C, then at once `echo after` and Enter: the same.
3. `bash retest/survivor.sh` (it ignores Ctrl+C): Ctrl+C, then at once `yes` and Enter: about 2 s after the Ctrl+C the
   line reaches it as its answer (`QA-GOT=yes`); `yes` never runs as a command.
4. `source input/slow-hook.zsh`. Run `true`, and before the prompt returns (2 s) type `echo after` and Enter: it runs
   once at the prompt, whole (never `cho after` or `command not found`), never held for approval, and NMSh never says
   `true` is waiting for input. Three times. Undo: `precmd_functions=(${precmd_functions:#qa_slow_hook})`.

### R7 · Progress and window size (#443, replaces A1 steps 1–3 and 6, and B1), 8 min
1. Ghostty, zsh: A1 steps 1, 2, 3 and 6.
2. `sh -c 'trap "echo QA-WINCH" WINCH; sleep 10'`. While it runs, paste three lines (Enter inserts them, the composer
   grows), press Enter (held for approval), and run `/queue` then Esc: no `QA-WINCH`. Then resize the window: `QA-WINCH`
   while you drag. `/queue`: delete the held line.
3. `vim view/tabs.txt`, resize the window, `:q`: vim redraws at the new size and the composer returns.
4. Terminal.app, `nmsh2 fish`: A1 steps 2, 3, 5 and 6 (as B1).

**PASS** if progress reads as in A1, only real window resizes reach the program, and full-screen programs use the
whole window.

## Sitting A: Ghostty, zsh (about 80 minutes; a break fits after A7)

Launch `/Volumes/T7Tmp/ai-dev/q22/nmsh`.

### A1 · Multi-row progress (#388), 6 min
1. `node -e 'for (let i=0;i<=10;i++){process.stdout.write((i?"\x1b[1A\x1b[2K":"")+"Downloading "+i*10+"%\n")}'`
   leaves one `Downloading 100%` line. Narrow the window to about 40 columns and run it again: the same.
2. `node progress/multirow.mjs`: two `layer` rows count up in place; `LOG pulling two layers`, `LOG checkpoint 1`–`4`
   and `LOG done` all stay, in order.
3. `node progress/multirow.mjs 120` (30 s): drag the window narrower and wider while it runs. No earlier command, prompt
   or NMSh note is erased.
4. `/copy`, then `pbpaste`: the final rows once, not every frame.
5. At about 40 columns, `node progress/wrapped.mjs`: both `LOG kept line` lines and `LOG done` stay, with one
   `Downloading … 100%` and one `eta 0s`. `printf '10%%\r20%%\r100%%\n'`: one `100%`. `clear` clears.
6. `vim view/tabs.txt` (`:q`), `less view/README.md` (`q`), `top` (`q`): each takes the full screen and returns to the
   composer.
7. `sleep 5`, and while it runs `ls` Ctrl+Q, `pwd` Ctrl+Q: both queued lines end in the known-command color (#408) and
   run after `sleep`.

**PASS** if every step reads as described. **FAIL** on a repeated frame line, an erased line or a wrong color.

### A2 · `/view`, 6 min
1. `/view view/README.md`: Markdown rendered (headings, lists, code, tables); `m` shows the source with line numbers, `m`
   again returns.
2. `/view view/ViewerPanel.ts`: syntax colors and line numbers; `w` turns wrapping off and Left/Right scroll sideways with
   `‹`/`›` marks; `l` hides the numbers.
3. In it: `/` then `export` (lowercase ignores case), `n`/`N` step and wrap with a note; `:` `100` Enter; `G` and `g`;
   PageUp/PageDown; the mouse wheel scrolls. Esc.
4. `/view view/hostile.txt`: `␛` marks; no color change, no link, no screen clear.
5. `node progress/multirow.mjs 120`, and while it runs `/view view/README.md`, then Esc: the composer is as it was and the
   command's output kept arriving underneath. Narrow the window to about 32×10 with the viewer open: it still fits and
   shows Esc.

**PASS** if all hold. **FAIL** on a garbled frame, an escape sequence acted on, or a lost composer draft.

### A3 · `/edit`, 8 min
1. `cd edit/empty`, `/edit notes.txt`: it says *new file*. Type two lines (Enter between) with a Tab in one; Ctrl+S says
   *Saved*; Esc returns to the composer. `cat -vet notes.txt`: `^I` and a final `$`.
2. `/edit notes.txt`: Shift+arrows, Shift+Alt+arrows and Cmd+Shift+arrows select; typing replaces the selection; Ctrl+C
   copies, Ctrl+X cuts (Cmd+V pastes it back); Ctrl+Z undoes a typed word in one step, Ctrl+Y redoes; Ctrl+F finds,
   Enter goes to the next match.
3. Change a word, Esc: Save, Discard changes and Keep editing each do what they say.
4. `/edit notes.txt`, change a word; in a second tab `echo x >> /Volumes/T7Tmp/ai-dev/q22/work/edit/empty/notes.txt`;
   back in NMSh Ctrl+S: nothing is written until you choose; Overwrite writes yours. Repeat with Reload: theirs shows.
5. `cd ../..`, `/view view/README.md`, `e`: the editor opens the same file; Esc. `vim edit/target.txt` runs as usual.

**PASS** if all hold. **FAIL** on a lost edit, a silent overwrite, or a key that does something else.

### A4 · Semantic Output, 5 min
1. `cd semantic/pass && npm test`: one overview row (`✔ node --test · 40 passed · 0 failed …`) above the folded output.
2. `cd ../fail && npm test`: the overview says 2 failed and a details row lists them; details are open while the output
   is folded; clicking the row and Actions → Show or hide details toggle it; Ctrl+O folds only the raw output.
3. `cd ../ts && npx --no-install tsc --noEmit bad.ts`: `TypeScript · 2 errors` with `file:line:col` items.
4. `cd ../fail && npm test`, then `/copy --semantic`, `/copy --both` and `/copy latest`, with `pbpaste` after each: the
   reading, raw plus reading under NMSh separators, raw only. Ctrl+F `failed` never matches the overview row.
5. Settings → Transcript → Semantic Output Off: the rows disappear from every block; On brings them back. `cd ../..`.

### A5 · `/track`, 8 min
1. `/track df -h`: one block, a status row (`live · every …`) and the result, updated in place while you run `ls`;
   scrolling and selecting text in other blocks is not disturbed.
2. `/track --every 2s -- cat track/f.txt`; second tab: `seq 1 2 > /Volumes/T7Tmp/ai-dev/q22/work/track/f.txt`, then
   `seq 1 40 > …`: a shorter result does not move what is below; a longer one says how many lines are not shown.
3. `/track stop all`: each last result appears once. `/track env ls` asks first: answer No.
4. `/track --every 3s -- sh -c 'sleep 2; echo QA-TRACK'` (Yes), then close the window (Cmd+W) while it runs. In a new
   plain window `pgrep -fl QA-TRACK` prints nothing. Relaunch NMSh.
5. `/track --every 2s -- sh -c 'trap "" TERM; exec >/dev/null 2>&1; exec sleep 300'` (Yes), `/track stop`; within 3 s a
   second tab's `pgrep -f "sleep 300"` prints nothing.
6. `/track ls`, `/track df -h`, `/track cat track/f.txt`, `/track ls missing`: the composer area shows
   `4 trackers · 1 failing`; narrow to about 60 columns and back: every block stays readable. `/track stop all`.

**FAIL** on a block that grows per refresh, a process left running, or an unreadable block.

### A6 · Modules, 4 min
1. `cd modules/bun-app`, `/modules`: Bun is recommended; enable it; typing `bun` shows `1.1.30` requested.
2. `/modules explain` lists every configured module with its surface and reason; `/modules timings` lists the slowest
   collections; the Status Strip CPU stays as it was.
3. Route three modules to the Context Rail (Modules → Surface), narrow the window until one disappears, `/modules
   explain`: it says "left out for width in the last frame"; widen and run it again: the note is gone. `cd ../..`.

### A7 · Themes, 6 min
1. `/theme`: the Built-in list shows Ayu, Kanagawa, Everforest, Flexoki and Night Owl; `/` `kanagawa` leaves three; `/`
   `light` leaves the light variants; Esc clears the filter, Esc again closes.
2. Activate each new variant: prompt fills, branch, status, selection band, transcript chrome and module text stay
   readable on this dark terminal; the light variants stay readable too.
3. Second tab, before and after switching: `shasum "$HOME/Library/Application Support/com.mitchellh.ghostty/config"*` is
   unchanged.
4. `exit`; in a plain window `mkdir -p /Volumes/T7Tmp/ai-dev/q22/config-copy/nmsh && cp "$HOME/Library/Application
   Support/notMyShell/config.json" /Volumes/T7Tmp/ai-dev/q22/config-copy/nmsh/`, then `/Volumes/T7Tmp/ai-dev/q22/nmsh
   copy`: your v0.20 theme and prompt load unchanged (only the copy can change). `exit`, relaunch
   `/Volumes/T7Tmp/ai-dev/q22/nmsh`.

### A8 · History (#389), 4 min
Run `echo one`, a two-line command (`echo two` Ctrl+J `echo three`, Enter) and `echo four`.
1. From an empty composer, Up recalls `echo four`; each further Up moves one command, the two-line one in a single
   press; Down comes back the same way; Down past the newest restores what you had typed.
2. While stepping, the bottom composer rule shows `History 1/N`, counting up as you go back, in a subtle color. It
   disappears when you type, move the caret or go past the newest. No row is added and nothing moves.
3. Recall the two-line command, press Left, then Up: the caret moves within it.
4. `/awake` on: Keep Awake keeps its place; the position uses the other rule or is not shown. At about 30 columns no
   position appears and nothing wraps. `/awake` off.
5. `sleep 10`, then Up: history recalls into the composer for the next command, never into `sleep`.

### A9 · Passwords and replies (#426), 12 min
*Run on `68c1cbb7`; for the hardened candidate, R5 replaces it (steps 3, 6 and 7 describe the old routing).*

Replies are made-up words, never a real password (only step 8 uses yours). `≡ 1 queued` is the queue's count.

1. `read -r reply; echo got=$reply`: type `hello` and Enter **at once**: `got=hello`; `≡` never appears. Again after a
   2 s pause: the same.
2. `read -rs reply` (no prompt): type `QSECRETQ` and Enter at once: nothing appears, nothing is queued, the command ends.
3. `sleep 5`, then type `echo next` and Enter at once: `≡ 1 queued`; it runs after `sleep`.
4. `sh input/prompted.sh`: `QA password:`; typing shows nothing; Enter prints `got N characters`. Type `echo after` and
   Enter at once: it runs once.
5. **Typed before the prompt, as with `sudo`:** `sh input/delayed-prompt.sh`, and within 2 s, before `QA-Password:`
   appears, type `QSECRETQ` (no Enter). When the prompt appears, the composer empties: the word is not sent as the
   answer. Type `answer` and Enter: `got 6 characters`. When the command ends, the composer reads `Typed during sh's
   hidden input · held, not run · Tab shows it · Esc discards it`. Press Enter: nothing runs. Press Ctrl+Q, then Tab:
   `QSECRETQ` appears in the composer, unsent, and `≡` does not appear. Delete it (Ctrl+U).
6. The same with Enter: `sh input/delayed-prompt.sh`, type `QSECRETQ` and Enter before the prompt. Nothing asks yet, so
   it is queued (`≡ 1 queued`), as anything entered then is; since it does not start with a command, a note says at once
   that it waits for your approval. When the prompt appears, a note says the command queued while it ran waits for your
   approval, and the prompt is not answered with an empty line. Answer with `answer`:
   `got 6 characters`; the queued entry does not run. `/queue`: delete it. (If the Enter was still being checked when
   the prompt appeared, the word is held at the prompt instead: Esc says it was discarded, not sent or run.)
7. `bash input/two-passwords.sh`: type `X` and Enter as soon as it starts; during its 3 s pause type a second word and
   Enter. That word is shown and queued (NMSh cannot know yet), waiting for approval because it is not a command. When
   the second read starts, a note says the command
   queued while it ran waits for your approval. Type the second word again and Enter: `lengths 1/…`; the queued entry
   does not run. `/queue`: delete it.
8. `sudo -k true`: your password never appears on screen or in the queue; a wrong password and the retry behave the
   same; Ctrl+C at the prompt returns to the composer with nothing queued.
9. **Under load** (optional, valuable): in a second tab start four CPU burners, `yes >/dev/null & yes >/dev/null & yes
   >/dev/null & yes >/dev/null &` (CPU only, no memory). Repeat steps 1 and 2 a few times. The composer may say
   `Checking whether … · your typing is kept`; the answer still reaches the read. If `hello` is ever queued, NMSh must
   then say it waits for your approval, and it must not run after the command; note how often. Stop the burners in
   that tab: `kill %1 %2 %3 %4`.
10. `fc -ln -30`: none of the words typed as replies appear, only the commands you ran.

**PASS** if no reply or password word is ever shown after its question appeared, queued without a note, run, or in
history (step 10). **FAIL** with a screenshot and `fc -ln -30`.

### A10 · Prompt hooks and Ctrl+C (#436), 4 min
*Run on `68c1cbb7`; for the hardened candidate, R6 replaces it.*

1. `sleep 30`, Ctrl+C, then at once `echo after` and Enter: `after` once, as its own command.
2. `read -r x`, Ctrl+C, then at once `echo after` and Enter: the same.
3. `source input/slow-hook.zsh`. Run `true`, and before the prompt returns (2 s) type `echo after` and Enter: it runs
   once, whole (never `cho after` or `command not found`), and NMSh never says `true` is waiting for input. Three
   times. Undo: `precmd_functions=(${precmd_functions:#qa_slow_hook})`.

### A11 · Editors (#366), 8 min
1. With your usual `EDITOR` (a terminal editor such as `nvim` or `vim`): `/view view/notes.txt`, `:200` Enter, `o`. The
   viewer closes and the composer holds `nvim +200 /…/notes.txt` (nothing runs); Enter opens it at line 200; quitting
   returns to NMSh. With a GUI editor or none set, note what `o` does instead.
2. `sleep 20`, then `/view view/notes.txt`, `o`: the command is placed in the composer; Enter queues it (`≡ 1 queued`)
   and the editor opens after `sleep`.
3. `printf 'x\n' > 'my notes.txt'`, `/view my notes.txt` (no quotes), `o`: the command quotes the path as one argument.
4. `exit`, relaunch with `/Volumes/T7Tmp/ai-dev/q22/nmsh-noeditor`: `/view view/notes.txt`, `o` says no editor is known
   and how to set one; `/open view/notes.txt:3` names the terminal editors installed here.
5. Settings → Sessions → Terminal editor: Neovim, Helix, Micro, Vim, nano, Emacs and Kakoune, installed ones marked; the
   highlighted one previews its exact command; one that is not installed is refused. Choose an installed one (this
   changes only the QA configuration).
6. `/open view/notes.txt:3:2`: that editor's command at the line (and column where it supports one), unsent; Enter opens
   it; quitting returns. `/view view/notes.txt`, `o`: the chosen editor is used. `exit`, relaunch
   `/Volumes/T7Tmp/ai-dev/q22/nmsh`.

### A12 · Ask command suggestions (#432), 8 min
0. **Memory first.** In a plain window: `memory_pressure | tail -1`. Below 35% free, or with other heavy apps open, do
   not load the model: report `Pass A12 · Ghostty · zsh: NOT RUN — memory N%` (incomplete, not passed).
1. Settings → Ask → Command suggestions is Off. `/btw convert every png here to webp` behaves as before: no model asked.
2. `/llm`: set up the model already in `~/.local/share/nmsh/models` (about 1 GB while loaded). Then Command suggestions
   → Local model.
3. `/btw convert every png here to webp`: one suggested command with `NMSh's check: …` first, then the model's words in
   quotes with its name; Copy and Insert, never Run.
4. Insert puts it in the composer, unsent (Esc clears it); Copy only fills the clipboard.
5. `/btw delete all my files` stays a refusal; no suggestion.
6. `/llm` → local understanding Off: the suggestion attempt says how to turn it on; Ask's own suggestions still appear.
7. Activity Monitor: no new long-lived process beyond the model service. Finish with `/llm` → Stop model.

### A13 · Session lifecycle, 5 min
1. `sleep 60`, close the window, launch the QA build again: it offers the detached session; R resumes it with `sleep`
   still running and its block intact; Ctrl+C ends it.
2. `/track --every 2s -- sh -c 'echo QA-LIFE'` (Yes), `exit`: in a plain window `pgrep -fl QA-LIFE` prints nothing.
3. Two windows on two sessions of the QA build: typing, queues and held typing in one never appear in the other.

### A14 · No color and Safe glyphs, 5 min
1. `exit`, relaunch as `NO_COLOR=1 /Volumes/T7Tmp/ai-dev/q22/nmsh`; Settings → Appearance → Safe glyphs.
2. `/view view/README.md`, `/` a word: matches and the current match stay visible (reverse video).
3. At about 40 columns `cd semantic/fail && npm test`: the overview reads `+`/`x` and stays readable. `cd ../..`.
4. `/track df -h`: the status marks are ASCII (`*`, `=`, `#`) and say live, paused or stopped in words. `/track stop`.
5. Up through history: the `History n/N` position stays readable.
6. `exit`, relaunch as `env -u COLORTERM TERM=xterm-256color /Volumes/T7Tmp/ai-dev/q22/nmsh` and switch between two new
   themes: nothing breaks.

## Sitting B: Terminal.app, Fish (about 20 minutes)

Launch `/Volumes/T7Tmp/ai-dev/q22/nmsh fish`. Only what depends on the terminal or on Fish; Terminal.app is a
256-color terminal, so note anything that reads differently from Ghostty.

- **B1** A1 steps 2, 3, 5 and 6.
- **B3** A3 steps 1–3 (Terminal.app may keep Cmd+Shift+arrows for itself: note it).
- **B5** A5 steps 1, 4 and 5 (process cleanup under Fish).
- **B8** A8 steps 1–3.
- **B9** A9 steps 1, 2, 4, 5, 6 and 8 in Fish forms: `read reply; echo got=$reply` for step 1, `read --silent reply` for
  step 2. Then `history | head -30`: no reply word.
- **B10** A10 steps 1 and 2 (`read x`), and step 3 with `function qa_slow --on-event fish_prompt; sleep 2; end`; undo
  with `functions -e qa_slow`.

## Sitting C: Terminal.app, zsh then Bash (about 20 minutes)

`/Volumes/T7Tmp/ai-dev/q22/nmsh`:
- **C2** A2 steps 1–3 and 5.
- **C7** A7 steps 1 and 2, and A14 step 6.

Then `exit` and `/Volumes/T7Tmp/ai-dev/q22/nmsh bash`:
- **C9** A9 steps 1–8, then `history | tail -30`: no reply word.
- **C10** A10 steps 1 and 2, and step 3 with `source input/slow-hook.bash` (Bash 5.1+; start a new session to undo it).

## Sitting D: Zed (about 10 minutes)

In Zed's integrated terminal: `/Volumes/T7Tmp/ai-dev/q22/nmsh`.
- **D11 (required).** `/view view/notes.txt`, `:200` Enter, `o`: Zed opens `notes.txt` at line 200 and the viewer
  stays. With a terminal editor chosen in A11.5, `o` inside Zed still opens Zed.
- **Z (supplementary, not a release gate).** A1 step 2, A2 steps 1 and 3 (wheel scrolling), A3 step 2 (note keys Zed
  keeps for itself), A5 step 1 and `/track stop`, A8 step 1, and one theme switch.

When every result is recorded: `rm -rf /Volumes/T7Tmp/ai-dev/q22`.
