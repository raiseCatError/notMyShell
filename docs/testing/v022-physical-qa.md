# v0.22 physical QA

## Status

- **Candidate slices, not integrated.** Each pass belongs to a draft PR held until #430 merges; see the
  [ledger](../development/v022-ledger.md). Nothing below has been run yet.
- **What does not count:** headless PTY fixtures, synthetic keys, captures of a window driven that way, and green CI.
  Each item needs a person at a real terminal with a real keyboard.
- **Build under test:** the PR head (or the later integration commit), built from a clean checkout (`npm ci && npm run
  build`); record `node dist/index.js --version` in every row.
- **Isolation:** `scripts/qa/v021-fixtures.sh <new-directory>` (unchanged, from v0.21) makes a throwaway folder with its
  own NMSh configuration and session service, so the QA build neither reads your settings nor attaches to your running
  sessions. Your shell's own startup files still run.

## Results

| Pass | Host and version | OS | Shell and version | Commit | Result | Notes |
|---|---|---|---|---|---|---|
| 1 Input ownership under load (#426, #433) | Ghostty | macOS | zsh | | Not run | |
| 1 Input ownership under load (#426, #433) | Terminal.app | macOS | Bash | | Not run | |
| 1 Input ownership under load (#426, #433) | Ghostty | macOS | Fish | | Not run | |
| 2 `/view` → your editor (#366, #434) | Ghostty | macOS | zsh | | Not run | |
| 2 `/view` → your editor (#366, #434) | Terminal.app | macOS | Fish | | Not run | |
| 2 `/view` → your editor (#366, #434) | Zed or VS Code terminal | macOS | zsh | | Not run | |

## Walkthrough

**Prepare once,** in a plain terminal window (not inside NMSh), from the checkout of the build under test:

```sh
node dist/index.js --version
scripts/qa/v021-fixtures.sh /Volumes/T7Tmp/ai-dev/q22
```

Launch with `/Volumes/T7Tmp/ai-dev/q22/nmsh` (zsh), `… nmsh bash` or `… nmsh fish`; quit with `exit`.

### Pass 1: input ownership (#426)

1.1 `read -r reply; echo got=$reply` (Fish: `read reply; echo got=$reply`). Type `hello` and Enter **at once**, without
waiting: `got=hello`, the status row never shows `queued`.
1.2 The same after a two-second pause: same result.
1.3 `read -s` (no prompt; Bash: `read -rs`; Fish: `read --silent reply`). Type `QSECRETQ` and Enter at once: the text
never appears anywhere on screen and nothing is queued. Then `sudo -k true` (Cancel with Ctrl+C after typing if you
prefer not to authenticate): the password is never shown in the composer.
1.4 `sleep 5`, then type `echo next` and Enter at once: it is queued immediately (`≡ 1 queued`) and runs after `sleep`.
1.5 Load: in a second window run something heavy (a large build or test suite, or several at once), then repeat 1.1 and
1.3 a few times. The composer may briefly say `Checking whether … is waiting for input · your typing is kept`; either
way the answer reaches the read and nothing is shown or queued. Note whether the note appeared and roughly how long.
1.6 Ctrl+C right after typing during 1.5's note: typing is routed (as before the change) and the command is interrupted.

### Pass 2: `/view` → your editor (#366)

Make a long file first: `seq 1 500 > long.txt`.

2.1 With `EDITOR=nvim` (or `vim`) exported in your shell startup or the launching window: `/view long.txt`, scroll to
about line 200 (`:200` Enter), press `o`. The viewer closes and the composer holds `nvim +200 /…/long.txt` (nothing
runs). Enter opens the editor at line 200; quitting it returns to NMSh's composer.
2.2 Type a draft (`git status`), then `/view long.txt` via Actions or `/view`, press `o`: the viewer stays and says the
composer has a draft; the draft is unchanged after Esc.
2.3 A name with spaces: `printf 'x\n' > 'my notes.txt'`, `/view my notes.txt` (the rest of the line is the path, no
quotes), `o`: the composer command quotes the path as one argument.
2.4 With `VISUAL` and `EDITOR` unset, outside any editor: `o` says no editor is known and how to set one.
2.5 Inside Zed's or VS Code's integrated terminal: `o` opens the file at the line in that editor; the viewer stays.
2.6 Markdown: `/view README.md` (rendered), `o` opens at the start; after `m` (source) it opens at the line shown.
2.7 Narrow window (about 46 columns): the footer wraps and `Esc close` stays visible.

**Reporting.** One line per pass, for example `Pass 1 · Ghostty 1.3.1 · zsh 5.9: PASS (note seen once, ~1 s)`.
