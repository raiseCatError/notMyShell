# v0.20 physical QA

## Status

- **Not run. v0.20.0 is a release candidate and is not published until this pass and v0.19's
  ([v019-physical-qa.md](v019-physical-qa.md)) are recorded.** v0.20 is built on the unpublished v0.19 candidate, so
  a v0.19 failure blocks both.
- **What does not count:** headless PTY fixtures, synthetic keys sent through tmux, and captures of a window driven
  that way. Each item needs a person at a real terminal with a real keyboard and pointer.
- **Build under test:** the exact `release/v0.20.0` commit named in the release PR. Build it from a clean checkout
  (`npm ci && npm run build`) and record `node dist/index.js --version`.
- **Isolation:** a throwaway `HOME` (or `XDG_CONFIG_HOME`), a temporary working directory, and for managed Claude a
  disposable Claude account directory. Never point a probe at a real account; every secret below is fake.

## Results

| Pass | Host and version | OS | Shell and version | Commit (`--version`) | Result | Notes |
|---|---|---|---|---|---|---|
| 1 Workspace regions Off (default) | Ghostty | macOS | zsh | | Not run | |
| 1 Workspace regions Off (default) | Terminal.app | macOS | zsh | | Not run | |
| 1E Experimental regions (optional, not a release gate) | Ghostty, Terminal.app, tmux | macOS | zsh | | Deferred | experimental, Off by default |
| 2 Background tasks | Ghostty | macOS | zsh | | Not run | |
| 2 Background tasks | physical Linux terminal | Linux | Fish 3.7 or Bash | | Not run | |
| 3 Modules and worktrees | Ghostty | macOS | zsh | | Not run | |
| 4 Managed Claude | Ghostty | macOS | zsh | | Not run | |
| 5 Regression of v0.19 core | Terminal.app | macOS | Bash or Fish | | Not run | |

## Pass 1 — workspace regions

The docked sidebar and detail panel are **experimental and Off by default** in v0.20 (maintainer decision,
`workspace-ui-decision.md`). The release gate is that Off is really off and that turning them on and off is safe;
the docked regions themselves (1E) are not a release feature and are recorded as **Deferred** unless someone runs
them. A 1E result never counts as release evidence for anything else.

- [ ] 1.0a Fresh QA home: `/sidebar`, `/panel`, `/sidebar focus`: each prints that the regions are experimental and
  Off and names Settings → Layout → Workspace sidebar & panel; nothing opens, the composer keeps the keyboard, and
  `tput cols` is the full width before and after.
- [ ] 1.0b Settings → Layout shows **Workspace sidebar & panel  Off** with its experimental description; Setup → Editor
  shows the same row. `/keys` says the workspace bindings take no key while it is Off. `/worktrees`, `/sessions`,
  `/github` and `/background` work as usual.
- [ ] 1.0c Turn it On in Settings, `/sidebar` then `/panel focus` at 160 columns: both dock and `tput cols` is the
  middle width. Turn it Off in Settings: both close at once, focus is back in the composer, and `tput cols` is the full
  width again; `/sidebar` opens nothing until it is turned on again.

### 1E — experimental regions (optional; turn the setting On first; not a release gate)

- [ ] 1.1 At 200, 120, 100, 89, 80, 70 and 40 columns: `/sidebar`, then `/panel`. Wide: both dock, the transcript
  rewraps to the middle and `tput cols` in the shell matches the middle width. 70 and below: `/sidebar` opens a drawer
  with the keyboard; `tput cols` is unchanged (opening a drawer never resizes the shell); Esc tucks it and the
  composer is never covered while it has the keyboard. No horizontal scroll anywhere.
- [ ] 1.2 Safe glyphs and `NO_COLOR=1`: focus, selection and the active item stay distinguishable without color.
- [ ] 1.3 With the sidebar docked, run `vim` and `less`: the regions hide, the program gets every column, and they come
  back with focus where it was after the program exits.
- [ ] 1.4 Inside tmux: the tmux section lists sessions, windows and panes; Enter on another pane switches to it; the
  prefix and any `bind -n` keys still reach tmux first (`/keys` names them).
- [ ] 1.5 Enter on a worktree with an empty composer stages `cd -- '…'`; with a draft it says the draft is kept.
- [ ] 1.6 Click the sidebar, the panel and back in the transcript: focus follows; selection and hover in the transcript
  land on the right rows with the sidebar docked.
- [ ] 1.7 A `keymap.json` binding Left (empty draft, `"replaces": true`) to `sidebar.focus`: Left with a draft still
  edits; with an empty draft it focuses the sidebar; `/keys` lists it. On Terminal.app check the Page Up/Down note.

## Pass 2 — background tasks

- [ ] 2.1 `/background run ping -c 100 127.0.0.1` (Linux: `ping 127.0.0.1`): the bar shows it; Up from an empty prompt
  focuses the bar; Enter shows live output; End follows again after scrolling back.
- [ ] 2.2 `x` interrupts. With a program that ignores SIGINT (`/background run sh -c 'trap "" INT; sleep 60'`): `x`
  says to wait, then offers terminate; holding `x` never jumps to kill.
- [ ] 2.3 A dev server (`/background run npx --yes http-server -p 8765`, or any local one): stop leaves nothing listening
  (`lsof -i :8765`). With a real device or emulator: `adb logcat` stops and `adb devices` still works.
- [ ] 2.4 Detach the window while a task runs, reattach with `/resume`: the task and its recent output are there and
  nothing restarted. End the session: the task ends.
- [ ] 2.5 Task output never appears in the transcript, `/copy`, Copy as Report or `/compare`.
- [ ] 2.6 By default `tail -f somefile` + Enter runs in the foreground at once. After `/background suggestions on`, the
  strip offers it; Enter runs it here; `b` backgrounds once; typing another key returns the draft with the key typed.
- [ ] 2.7 While a foreground command reads input, queued commands run and Up/typing go to the program, never the bar.

## Pass 3 — native modules and worktrees

- [ ] 3.1 Real projects for .NET, Swift, Zig, Deno, Elixir, Dart, Flutter, Ruby and PHP installed through Homebrew,
  asdf, mise or FVM: requested and active versions match what the tools report, and no tool process starts while
  collecting (watch with `ps`).
- [ ] 3.2 The build module in a Gradle, Maven, CMake and Bazel project; a Mercurial and a Jujutsu repository.
- [ ] 3.3 `/github`, then `/worktrees` in the same repository: a worktree whose branch has an open PR offers `p`, which
  opens that PR; a fork PR with the same branch name is not offered.

## Pass 4 — managed Claude (disposable account only)

- [ ] 4.1 `/model` and `/effort` change the managed target; the change shows as requested until Claude confirms it.
- [ ] 4.2 `/mods`: enable and disable a plugin installed in the disposable account; the settings change is Claude's
  own; the running managed session reloads it.
- [ ] 4.3 A multi-line command approval shows every line before you answer.

## Pass 5 — v0.19 core on the integrated build

Repeat items 1.1–1.15 of [v019-physical-qa.md](v019-physical-qa.md) once on this build in Terminal.app with Bash or
Fish, with the default settings (the experimental workspace regions Off). Running half of them again with the
regions docked belongs to 1E and is optional.

## After the pass

Fill the Results table, attach captures of any failure with the exact keys typed, and record the outcome on the
release PR. A failure blocks publication until it is fixed on the release branch and the affected items are rerun.
