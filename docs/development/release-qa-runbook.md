# Physical QA runbook: v0.19.0 and v0.20.0 candidates

The execution path for the maintainer's physical QA. The acceptance gates themselves are unchanged and stay in
[`docs/testing/v019-physical-qa.md`](https://github.com/raiseCatError/notMyShell/blob/release/v0.19.0/docs/testing/v019-physical-qa.md)
and
[`docs/testing/v020-physical-qa.md`](https://github.com/raiseCatError/notMyShell/blob/release/v0.20.0/docs/testing/v020-physical-qa.md)
on the release branches. This page gives the order, the commands to type, what Pass and Fail look like, and what
to send back. Item numbers refer to those files: `v19 1.6` is item 1.6 in the v0.19 checklist.

**Counts as QA:** a person typing on a real keyboard (and using a real pointer for clicks) in a real Ghostty or
Terminal.app window, and on a physical Linux machine for the Linux rows. **Does not count:** tmux `send-keys`,
AppleScript, headless PTY runs, screenshots of a window driven any of those ways, a VM or CI.

## 0. Before you start (about 5 minutes)

1. Attach the release image if `/Volumes/nmsh-opus` is missing:
   `hdiutil attach -nobrowse "/Volumes/T7 Shield/nmsh-opus-release.sparsebundle"`
2. Confirm the exact candidates. Each should print the SHA below, then nothing for `status`, then the version lines.

   ```sh
   for v in v019 v020; do w=/Volumes/nmsh-opus/wt/$v; git -C $w rev-parse HEAD; git -C $w status --porcelain; node $w/dist/index.js --version; done
   ```

   | Candidate | Expected `HEAD` | Expected `--version` |
   |---|---|---|
   | v0.19.0 | `9e85a9100d1a377ccb3b270c99d98cbae0ff2605` | `notMyShell 0.19.0` / `build 9e85a91 (release/v0.19.0)` |
   | v0.20.0 | `c71a42846da4a3832e578f3fb9c28f192510d08e` (if #392's gate list names a newer head, that one) | `notMyShell 0.20.0` / `build c71a428 (release/v0.20.0)` |

   If `--version` shows a different commit, run `npm run build` in that worktree (it only rewrites the ignored
   `dist/`), then check again. A non-empty `status` means stop and report it.
3. Paste this helper into a zsh in each terminal you test from. It launches a candidate with a throwaway home,
   configuration, runtime directory and working directory, so your real NMSh sessions (`nmsh` already running on this
   Mac), settings, history and Claude accounts are never touched.

   ```sh
   nmsh_qa() {  # nmsh_qa v019|v020 [VAR=value ...]
     local w=/Volumes/nmsh-opus/wt/$1; shift
     local q=$(mktemp -d /Volumes/nmsh-opus/t/qa-XXXXXX)
     mkdir -p $q/home $q/work $q/run; chmod 700 $q/run
     print "QA dir $q"; git -C $w rev-parse --short HEAD; node $w/dist/index.js --version
     (cd $q/work && env HOME=$q/home XDG_CONFIG_HOME=$q/home/.config NMSH_RUNTIME_DIR=$q/run "$@" node $w/dist/index.js)
   }
   ```

   The first launch shows Setup (fresh home): accept the defaults. To leave, `exit` the shell or close the window.
   Detach/reattach tests must reuse the **same** QA dir: reattach with
   `(cd <QA dir>/work && env HOME=<QA dir>/home XDG_CONFIG_HOME=<QA dir>/home/.config NMSH_RUNTIME_DIR=<QA dir>/run node /Volumes/nmsh-opus/wt/<v>/dist/index.js)`
   and use `/resume` inside.
4. Record once per machine: `sw_vers`, `zsh --version`, `bash --version | head -1`, `fish --version`, and the
   terminal's version (Ghostty: `ghostty +version`; Terminal.app: Terminal → About Terminal).

Switch the managed shell inside NMSh with `/shell bash` or `/shell fish` (NMSh stays open). `/bash` and `/fish`
are different: they leave NMSh for a plain shell.

## 1. v0.19 (do this first; a v0.19 failure blocks both releases)

Minimum to publish v0.19 (from its checklist): pass 1 in **Ghostty** and **Terminal.app** with zsh, plus pass 1 once
with **Bash or Fish** on macOS; pass 1 on a **physical Linux terminal with Fish 3.7**; passes 2 and 3 in both macOS
terminals. Order that covers this with the fewest launches:

| Session | Terminal | Shell | Items |
|---|---|---|---|
| A | Ghostty | zsh | v19 1.1–1.15, 2.1–2.4, 3.1–3.4 |
| B | Terminal.app | zsh | v19 1.1–1.15, 2.1–2.4, 3.1–3.4 |
| C | Ghostty or Terminal.app | `/shell bash` (or fish) | v19 1.1–1.15 |
| D | physical Linux terminal | Fish 3.7 | v19 1.1–1.15 (see section 3) |

Window size about 120×36 unless an item says otherwise. Quick reference for what to type and what passes:

| Item | Type | Pass | Fail |
|---|---|---|---|
| 1.1 | `cd /tmp && export DEMO=1 && f() { echo fn-ok; }` then `pwd; echo $DEMO; f` (Fish: `function f; echo fn-ok; end`) | `/tmp`, `1`, `fn-ok` | any of them missing |
| 1.3 | zsh `read -s 'reply?Demo password: '; [[ $reply == FAKE_ONLY ]] && print ANSWER-ACCEPTED`; Bash `read -rs -p 'Demo password: ' reply; test "$reply" = FAKE_ONLY && echo ANSWER-ACCEPTED`; then type `FAKE_ONLY` Enter | waiting indicator beside the composer; `FAKE_ONLY` never drawn; only `ANSWER-ACCEPTED` | the typed text appears anywhere, or runs as a command |
| 1.4 | zsh `read -k 1 x; echo got:$x` / Bash `read -n 1 x; echo; echo got:$x`, press `y` | `got:y`, next prompt clean | an extra empty command or stray newline runs |
| 1.6 | `sleep 5`, then `echo QUEUED-1` Enter, `echo QUEUED-2` Enter, `/queue` | both listed; each printed once, in order, after sleep | run early, twice, or out of order |
| 1.7 | `read reply` waiting: type `hi` Enter; again with Ctrl+Q `echo AFTER` Enter | Enter answers the reader; Ctrl+Q entry runs after | Enter queues, or Ctrl+Q text reaches the reader |
| 1.9 | `false` with `echo NEXT` queued | queue pauses; resume runs `NEXT` once; Ctrl+C on `sleep 10` also pauses; an `always` entry runs after `false` but not after Ctrl+C | anything else |
| 1.11 | `printf 'a\tb\n  indented\nüñí\n'` then `/copy`, then `pbpaste \| xxd` | exactly `6109 620a 2020 696e 6465 6e74 6564 0ac3 bcc3 b1c3 ad0a` (no `✔ Completed` bytes) | any other bytes |
| 1.12 | `seq 1 400`, fold it, `/copy`, then `pbpaste \| wc -l` | `400` | fewer |
| 1.13 | `echo 'token=ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE path=/Users/someone/private'` → block Actions → Copy as Report | review shows token and path redacted; Enter copies exactly the reviewed text (`pbpaste`); Esc leaves the old clipboard | the fake token or path reaches the clipboard after Enter, or Esc changes it |
| 1.14 | `printf 'one\ntwo\n'`, `printf 'one\nthree\n'`, `/compare` | changed line shown; side by side at ≥140 columns, unified below; `c` copies an unredacted plain diff with a caution | wrong lines, or `c` redacts silently |
| 2.1 | `vim`, resize several times, `:q`; `less /etc/services`, resize, `q` at once | final size repainted; composer back with the cursor in place | stale size, garbage, lost cursor |
| 2.2 | `sleep 30`, queue `echo ONCE`, close the window; relaunch the same QA dir, `/resume` | transcript, queue and activity intact; `ONCE` prints once | anything runs twice or is lost |
| 3.1 | launch with `nmsh_qa v019 NO_COLOR=1`, then `ls --color=always /` (macOS: `ls -G /` or `git -c color.ui=always diff`) | NMSh's rows plain; the program's colors as written | NMSh colors appear, or program colors are stripped |
| 3.2 | resize to 40, 80, 120 columns and ~15 rows while a queue entry, a waiting read, a report review and a compare are visible | everything readable and reachable; nothing overlaps the composer | overlap, unreachable controls |

Items not in the table (1.2, 1.5, 1.8, 1.10, 1.15, 2.3, 2.4, 3.3, 3.4) are exactly as written in the checklist.
For 1.5 in Fish, note dropped keys against #356 instead of counting them as a new failure.

## 2. v0.20 (only after v0.19 passes)

Launch with `nmsh_qa v020`. Every v0.19 item must still pass on this build (v20 pass 5: Terminal.app with Bash or
Fish, sidebar docked for half of the items).

| Session | Terminal | Shell | Items |
|---|---|---|---|
| E | Ghostty | zsh | v20 1.1–1.3, 1.5–1.7, 2.1–2.7, 3.1–3.3 |
| F | Terminal.app | zsh | v20 1.1–1.3, 1.5–1.7 (and the Page Up/Down note in 1.7) |
| G | Ghostty, inside tmux | zsh | v20 1.4 (see below), 1.3 |
| H | physical Linux terminal | Fish 3.7 or Bash | v20 2.1–2.7 (section 3) |
| I | Ghostty | zsh, disposable Claude account | v20 4.1–4.3 (see below) |
| J | Terminal.app | `/shell bash` or fish | v20 pass 5 (= v19 1.1–1.15) |

What to watch for, beyond the checklist text:

- **1.1 widths:** check `tput cols` inside NMSh after each `/sidebar` or `/panel`. Docked: it equals the middle
  width. Drawer (70 columns and below): it does not change when the drawer opens.
- **1.4 tmux (session G):** start an isolated tmux with a root-table binding so the item can be judged:
  `print 'bind -n M-Left select-pane -L' > /Volumes/nmsh-opus/t/qa-tmux.conf; tmux -L nmsh-qa -f /Volumes/nmsh-opus/t/qa-tmux.conf new -s qa`,
  split a pane (`prefix %`), run `nmsh_qa v020` in one pane, open `/sidebar`. Pass: sessions, windows and panes are
  listed; Enter on the other pane switches to it; the prefix and Alt+Left reach tmux first. **Known gap on the
  candidate:** `/keys` does not name your tmux prefix or `bind -n` keys (it only notes tmux's Esc delay). Record
  that clause as **Fail (known gap)** unless the maintainer has approved deferring it (see the ledger); judge the
  rest of 1.4 on its own.
- **1.6 clicks:** a click on the sidebar or panel moves keyboard focus there; a click in the transcript returns it.
  **Clicking a row does not select that row**, and the mouse wheel scrolls the transcript wherever the pointer is,
  even over the sidebar or panel. Both are the candidate's documented limitations, not a pass of row selection or
  region scrolling: write what you saw.
- **2.2:** hold `x` for two seconds on the trap task: it must say to wait and then offer terminate, never kill.
- **2.3 without the network:** `/background run python3 -m http.server 8765`; after stopping it,
  `lsof -nP -iTCP:8765 -sTCP:LISTEN` prints nothing.
- **2.5:** after a task has printed, check `/copy`, Copy as Report and `/compare` on the neighbouring blocks: no
  task line appears in any of them.
- **2.6:** suggestions are **off** by default. `tail -f /etc/hosts` + Enter must run in the foreground at once.
- **Pass 4 (session I) only with a disposable Claude account**, never your own: `mkdir -p
  /Volumes/nmsh-opus/t/qa-claude && nmsh_qa v020 CLAUDE_CONFIG_DIR=/Volumes/nmsh-opus/t/qa-claude`, then run
  `claude` inside NMSh, `/login` with the disposable account, and install one small plugin into it. Claude Code on
  macOS keeps logins in the Keychain: before relying on this, confirm your own Claude Code is still signed in to
  your account afterwards, or use a separate macOS user. If no disposable account is available, mark 4.1–4.3
  **Not run (no disposable account)**. That blocks the Claude plugin controls (see the ledger's decision list), not
  the rest of v0.20.
- **3.1–3.2** need real projects and toolchains. Mark any toolchain you do not have as Not run with the name.

## 3. Physical Linux with Fish 3.7 (v19 row D, v20 row H)

A physical machine with a real terminal emulator; not a VM, container, SSH session from this Mac, or CI.

In a Fish session (Node 22 or newer installed):

```fish
fish --version            # must be 3.7.x for the v0.19 gate row
git clone https://github.com/raiseCatError/notMyShell.git ~/nmsh-qa && cd ~/nmsh-qa
git checkout --detach 9e85a9100d1a377ccb3b270c99d98cbae0ff2605   # v0.19; v0.20: c71a42846da4a3832e578f3fb9c28f192510d08e (or the newer head in #392)
npm ci && npm run build && node dist/index.js --version
set q (mktemp -d); mkdir -p $q/home $q/work $q/run; chmod 700 $q/run
cd $q/work; env HOME=$q/home XDG_CONFIG_HOME=$q/home/.config NMSH_RUNTIME_DIR=$q/run node ~/nmsh-qa/dist/index.js
```

Inside NMSh run `/shell fish`. Clipboard bytes: `wl-paste | xxd` (Wayland) or `xclip -o -selection clipboard | xxd`
(X11); expect the same bytes as in item 1.11. Fish commands for the hidden read: `read --silent --prompt-str 'Demo
password: ' reply; test "$reply" = FAKE_ONLY; and echo ANSWER-ACCEPTED`. On Linux use `ping 127.0.0.1` for v20 2.1.

**If no physical Linux machine with Fish 3.7 is available, both releases are blocked on that row.** Report it; do not
substitute a VM or CI.

## 4. What to send back

For each session (A–J) one line, in the Results tables' shape:

```
<session> | <terminal + version> | <macOS/Linux version> | <shell + version> | <--version output> | Pass / Fail <items> / Not run <items> | notes
```

For every Fail: the item number, the exact keys typed, what you expected and what you saw, plus a screenshot if
the screen was wrong. "Looked fine" for an item you did not perform is not a result: mark it Not run. The release
track turns these into the Results tables and the #359/#390/#392 records; nothing is marked passed that you did not
report.

Cleanup afterwards: `exit` each QA session's shell so its session service has nothing left to keep; check
`ps -axo pid,command | grep '[n]msh-opus/wt/v0'` and stop only processes listed there. Then
`tmux -L nmsh-qa kill-server` if you used session G, and remove the QA scratch only: `rm -rf /Volumes/nmsh-opus/t/qa-*`.
