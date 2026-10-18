# v0.19 physical QA

## Status

- **v0.19.0 was never published on its own.** Its work first ships in v0.20.0, and the physical status of both is
  recorded in [v020-physical-qa.md](v020-physical-qa.md); this checklist was not completed item by item. Every automated gate (canonical local
  verification, PR and `workflow_dispatch` CI with Fedora and both timing smokes, Node 22, report/compare/clipboard
  security, and the frozen per-feature Linux/Fish 3.7 evidence) is evidence, not acceptance.
- **What does not count:** headless PTY fixtures, synthetic keys sent through tmux, and screenshots of a window driven
  that way. Each item below needs a person typing at a real terminal on a real keyboard.
- **Build under test:** the exact `release/v0.19.0` commit named in the release PR. Build it from a clean checkout
  (`npm ci && npm run build`) and record `node dist/index.js --version`, which prints the version and commit.
- **Isolation:** run with a throwaway `HOME` (or at least a throwaway `XDG_CONFIG_HOME`) and a temporary working
  directory. Do not point it at real provider or account configuration. Every secret below is fake.

Detailed per-feature steps, including the exact shell commands for hidden reads in each shell, are in
[workflow-physical-qa.md](../development/workflow-physical-qa.md). This page is the release gate: what has to pass, on
which hosts, and where results are recorded.

## Results

Record one row per host and shell actually used. `Result` is Pass, Fail (with the item number) or Not run.

| Pass | Host and version | OS | Shell and version | Commit (`--version`) | Result | Notes |
|---|---|---|---|---|---|---|
| 1 Core workflow | Ghostty | macOS | zsh | | Not run | |
| 1 Core workflow | Ghostty | macOS | Fish 3.7+ or Bash 4.4+ | | Not run | |
| 1 Core workflow | Terminal.app | macOS | zsh | | Not run | |
| 1 Core workflow | physical Linux terminal | Linux | Fish 3.7 | | Not run | |
| 2 Fullscreen and sessions | Ghostty | macOS | zsh | | Not run | |
| 2 Fullscreen and sessions | Terminal.app | macOS | zsh | | Not run | |
| 3 Presentation | Ghostty | macOS | zsh | | Not run | |
| 3 Presentation | Terminal.app | macOS | zsh | | Not run | |

**Minimum to publish v0.19.0:** pass 1 in Ghostty and Terminal.app with zsh plus at least one of Bash or Fish on
macOS, pass 1 on a physical Linux terminal with Fish 3.7, and passes 2 and 3 in both macOS hosts. Anything not run is
listed as outstanding in the release notes; it is never implied.

## Pass 1 — core workflow (normal width, about 120×36)

### Persistent shell
- [ ] 1.1 Launch. `cd /tmp && export DEMO=1 && f() { echo fn-ok; }` (Fish: `function f; echo fn-ok; end`), then
  `pwd; echo $DEMO; f`. Directory, variable and function survive across commands: one real shell, not one per command.
- [ ] 1.2 An ordinary command's output appears raw and complete; the completion row shows its time.

### Waiting for input
- [ ] 1.3 Hidden read (commands per shell in workflow-physical-qa.md, Input and queue step 1): the waiting state shows
  beside the composer; typing `FAKE_ONLY` is not drawn anywhere; only `ANSWER-ACCEPTED` appears.
- [ ] 1.4 A single-key question (`read -k 1` in zsh, `read -n 1` in Bash): one key answers it, with no stray Enter
  reaching the next prompt.
- [ ] 1.5 Type a command immediately after a read returns and immediately after Ctrl+C: it reaches the shell once, in
  order. In Fish, note any dropped keys against [#356](https://github.com/raiseCatError/notMyShell/issues/356)
  rather than counting them as a new failure.

### Queue: exact once
- [ ] 1.6 Run `sleep 5`; while it runs, type `echo QUEUED-1` Enter and `echo QUEUED-2` Enter. `/queue` lists both. Each
  prints exactly once, in order, after `sleep` ends.
- [ ] 1.7 While `read reply` waits, Enter answers the reader; Ctrl+Q instead composes a queue entry that runs after.
- [ ] 1.8 A queued `cd /tmp/x && export Q=1` (create the folder first) is followed by a queued `pwd; echo $Q`: same
  shell, same state.
- [ ] 1.9 `false` with an entry queued behind it pauses the queue; resume runs it once. Ctrl+C on a running command
  pauses the queue too. An entry marked `always` runs after a plain failure but not after Ctrl+C.
- [ ] 1.10 An entry set to ask first waits for approval; editing it after approval withdraws the approval.

### Copy and clipboard bytes
- [ ] 1.11 `printf 'a\tb\n  indented\nüñí\n'` then `/copy`; `pbpaste | od -c` (Linux: `xclip -o -selection clipboard |
  od -c` or `wl-paste | od -c`) shows exactly those bytes: tab, two spaces, UTF-8, trailing newline as printed, and no
  `✔ Completed` row.
- [ ] 1.12 `seq 1 400` then fold and `/copy`: all 400 lines are copied. `/copy ui` picker and `/copy 1-2` select what
  they say.

### Report with a planted secret
- [ ] 1.13 `echo 'token=ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE path=/Users/someone/private'` then Copy as Report from
  the block's Actions. The review shows the token and private path redacted. Enter copies exactly the reviewed text
  (check with `pbpaste`). Esc instead leaves the clipboard as it was.

### Compare
- [ ] 1.14 Run `printf 'one\ntwo\n'` and then `printf 'one\nthree\n'`; `/compare` shows the changed line. At 140+
  columns it is side by side, below that unified. `r` opens a reviewed report; `c` copies the plain diff (a planted
  fake token shows the caution and is **not** redacted, by design).

### Reuse
- [ ] 1.15 F8 and Shift+F8 walk failed commands and keep the draft. Pin a history command from the palette; `/pins`
  stages it without running it.

## Pass 2 — fullscreen, resize and sessions

- [ ] 2.1 `vim`, then resize the window several times; quit. The final size is repainted, and the composer comes
  back with the cursor in place. Repeat with `less` on a long file, quitting immediately after a resize.
- [ ] 2.2 Run a command, detach (close the window), reattach from a new window with `/resume`: transcript, queue and
  the running command's activity phrase are intact; nothing queued runs twice.
- [ ] 2.3 Detach while a hidden read is open and reattach: input stays hidden and answers the original reader.
- [ ] 2.4 Detach with `vim` open and reattach: vim gets the screen at the new window's size at once.

## Pass 3 — presentation

- [ ] 3.1 `NO_COLOR=1 nmsh`: NMSh's own rows have no color; a program's own colors (`ls --color=always`, `git diff
  --color`) stay as the program wrote them.
- [ ] 3.2 At 40, 80 and 120 columns and a short height (about 15 rows): queue line, waiting indicator, report review
  and comparison stay readable and reachable; nothing overlaps the composer.
- [ ] 3.3 Expressive wording is the default (a playful phrase while running, its pair on success); failures and
  interrupts read factually. Settings → Live activity → Activity wording → Classic persists across restart.
- [ ] 3.4 FOLLOW and DETACHED scrolling while output streams; native selection with the mouse copies terminal text.

## After the pass

Fill the Results table, attach captures of any failure with the exact keys typed, and record the outcome on
[#359](https://github.com/raiseCatError/notMyShell/issues/359). A failure blocks publication until it is fixed on
`release/v0.19.0` and the affected items are rerun.
