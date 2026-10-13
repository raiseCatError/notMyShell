# v0.18 physical QA

## Status

- **Automated (evidence, not acceptance):** `npm run verify` (unit and real-PTY tests), the bench type-check and the
  timing smoke run pass locally on the release branch, and PR CI passes on its head. CI's Fedora and timing-smoke jobs
  run only on push or manual dispatch, and the last dispatch predates the final fixes; run it again before merging.
  VHS recordings of real NMSh cover the transcript folding fix, `/worktrees`, `/github`, the managed agent view and
  `/mods`.
- **Physical acceptance: not run.** No item below has passed yet. Every item needs a person at a real terminal. Mark a
  result only from an actual run, and record host and version, OS, font (Nerd or Safe), commit and any failure.
- **Not covered by the maintainer's hosts:** Linux and WSL 2 on real machines (#18), and iTerm2, Kitty and WezTerm
  (#13). These stay open follow-ups.

## Results

| Pass | Host and version | Commit | Font | Result | Notes |
|---|---|---|---|---|---|
| 1 Core, both hosts | Ghostty | | | Not run | |
| 1 Core, both hosts | Terminal.app | | | Not run | |
| 2 Workspaces and agents | Ghostty | | | Not run | |
| 3 Narrow, NO_COLOR, Safe | Ghostty | | | Not run | |
| 3 Narrow, NO_COLOR, Safe | Terminal.app | | | Not run | |

## Order of work

Run pass 1 in Ghostty, then repeat it in Terminal.app. Run pass 2 once, in Ghostty. Run pass 3 in both hosts last,
since it repeats a few items under constrained settings. VS Code or Zed integrated terminals are optional spot checks.

## Pass 1 — core fixes (Ghostty, then Terminal.app; normal width)

### Slash routing and absolute paths
- [ ] `/bin/zsh -c 'echo hi'`, `/usr/bin/env echo hi` and a path to a directory run in the shell exactly as typed, in
  zsh, Bash and Fish.
- [ ] `/zsh` still switches shells.

### /copy
- [ ] `/copy` after a command with output copies only that output: no `✔ Completed` row, no timestamps. Paste into
  another app to check line breaks and indentation.
- [ ] `/copy` after a command that printed nothing leaves the clipboard as it was and says so.

### Transcript folding after a screen clear
- [ ] Run a command with about 15 lines of output, then `clear`, then a command with five lines, then `/copy`. The five
  lines stay together, no fold row appears among them, and Ctrl+O folds and unfolds only that command, several times
  over.
- [ ] Run `tmux`, detach or exit, then run a few commands: folding, `/copy` and Ctrl+O act on the right commands.
- [ ] `/resume` an older session that used `clear` or `tmux` before this release: no fold rows appear inside other
  commands' output. Older commands from before a clear may lose their fold control; their lines stay visible.
- [ ] Full-screen programs (`vim`, `less`), `printf '\e[J'` and a progress bar do not clear the transcript.

### Fish keystroke loss (known residual; keep on this list)
- [ ] In Fish, run `read -P 'Name: ' x; echo got=$x`, answer, and type the next command the moment the prompt returns.
  The command is never lost. Repeat with `read -s`, and while the machine is busy (for example during a build).
- [ ] Type-ahead *while* a fish `read` is still running (the answer and the next command in one fast burst) can still
  be lost. Fish itself drops it, in any terminal (see `docs/development/fish-typeahead.md`). Note whether it happens
  and how often on each host. If it is frequent on a fast local terminal, report it upstream to fish.
- [ ] zsh and Bash: the same steps, including type-ahead, never lose keys.

## Pass 2 — workspaces and managed agents (Ghostty)

### Managed agent view (`/claude`)
- [ ] With a real Claude account: `/claude` opens the launcher, `/claude new` starts fresh, and a turn completes. The
  welcome gives way as turns arrive, and the model shown is the one Claude reports.
- [ ] A tool permission request (allow and deny) and an AskUserQuestion question are answered in NMSh.
- [ ] Long replies with code blocks read correctly; scrollback reaches the first turn; a scrolled-back view stays put
  while new events arrive.
- [ ] A live window resize, with a native theme and a custom theme.
- [ ] Normal and Chat presentation, composer at Top and Bottom; `/cursor` shape and color apply to the agent draft.
- [ ] Shelf: Up from an idle composer focuses it, Left/Right select, Enter opens, Down/Esc return.

### /mods
- [ ] `/mods` with real plugin inventories: tabs, grouped rows and `/` search. Enter opens an entry's execution and
  provenance record. Provider plugins say they run inside the provider with no NMSh sandbox.

### /worktrees
- [ ] The list matches `git worktree list` (branch, HEAD, dirty/untracked, locked, prunable).
- [ ] Enter stages `cd -- '<path>'` in an empty composer and does not run it; with a draft present, the draft stays.
- [ ] `n` shows the exact plan and creates nothing until Enter on that plan.
- [ ] `x` previews removal; removal is refused for the main, current, locked, prunable or dirty worktree.

### /github, /prs, /issues
- [ ] With your `gh` login on a github.com `origin`: PR and issue lists, search, PR overview, checks, reviews,
  comments, files and diff.
- [ ] The merge preview only describes. `o` opens the item on github.com; `w` jumps to the PR branch's worktree.

## Pass 3 — narrow width, NO_COLOR and Safe glyphs (Ghostty, then Terminal.app)
- [ ] At about 46 columns, repeat the folding check with a long command that wraps.
- [ ] With `NO_COLOR=1` and Safe glyphs, open `/worktrees`, `/github`, `/mods` and the agent view: the active tab is
  reverse video, selections stay visible, and nothing overflows at 50 columns.

## Known issue: `ESC[3J` clears the whole transcript
- `printf '\e[3J'` alone empties NMSh's transcript, though in a real terminal it erases only scrollback and leaves the
  screen. `clear` (which sends `ESC[3J ESC[H ESC[2J` on macOS) and `clear -x` are unaffected, since `ESC[2J` clears
  anyway. The behavior dates from the first release. After the fold fix it is a consistent wipe, never misattributed
  output. Planned after v0.18: treat a lone `ESC[3J` as clearing nothing NMSh shows. Check that nothing you use emits
  it alone. Listed under Known limitations in CHANGELOG → 0.18.0.
