# v0.22 physical QA

## Status

- **Candidate slices, not integrated.** Each pass belongs to a draft PR held until v0.21 ships; see the
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
| 3 Type-ahead after Ctrl+C and slow hooks (#436, #437) | Ghostty | macOS | zsh | | Not run | |
| 3 Type-ahead after Ctrl+C and slow hooks (#436, #437) | Terminal.app | macOS | Bash | | Not run | |
| 3 Type-ahead after Ctrl+C and slow hooks (#436, #437) | Ghostty | macOS | Fish | | Not run | |
| 4 History browsing and History n/N (#389, #438, #441) | Ghostty | macOS | zsh | | Not run | |
| 4 History browsing and History n/N (#389, #438, #441) | Terminal.app | macOS | Fish | | Not run | |
| 5 Terminal editor choice (#366, #439) | Ghostty | macOS | zsh | | Not run | |
| 5 Terminal editor choice (#366, #439) | Zed or VS Code terminal | macOS | zsh | | Not run | |
| 6 Ask command suggestions (#432, #440) | Ghostty | macOS | zsh | | Not run | |

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
1.6 Ctrl+C right after typing during 1.5's note: the command is interrupted and **the held typing is discarded** (it is
neither sent to the shell nor shown); the composer is empty.
1.7 If NMSh still cannot tell after about five seconds (heavy load, swap), the activity row says `Can't tell whether …
is reading your typing · held, not shown` and the composer offers `Ctrl+S sends it to … · Tab shows it · Esc discards
it`. Try each: Ctrl+S sends the held text to the program (the read gets it); Tab puts it in the composer, visible and
unsent; Esc discards it. Nothing held is ever run as a shell command without one of these. If the state never appears,
note that; it is expected on a lightly loaded machine.

### Pass 2: `/view` → your editor (#366)

Make a long file first: `seq 1 500 > long.txt`.

2.1 With `EDITOR=nvim` (or `vim`) exported in your shell startup or the launching window: `/view long.txt`, scroll to
about line 200 (`:200` Enter), press `o`. The viewer closes and the composer holds `nvim +200 /…/long.txt` (nothing
runs). Enter opens the editor at line 200; quitting it returns to NMSh's composer.
2.2 While a command runs: `sleep 20`, then `/view long.txt`, `o`. The editor command is placed in the composer;
Enter queues it (`≡ 1 queued`) and the editor opens after `sleep` ends. (A draft already in the composer is never
replaced; that case is covered by automated tests, since opening `/view` empties the composer.)
2.3 A name with spaces: `printf 'x\n' > 'my notes.txt'`, `/view my notes.txt` (the rest of the line is the path, no
quotes), `o`: the composer command quotes the path as one argument.
2.4 With `VISUAL` and `EDITOR` unset, outside any editor: `o` says no editor is known and how to set one.
2.5 Inside Zed's or VS Code's integrated terminal: `o` opens the file at the line in that editor; the viewer stays.
2.6 Markdown: `/view README.md` (rendered), `o` opens at the start; after `m` (source) it opens at the line shown.
2.7 Narrow window (about 46 columns): the footer wraps and `Esc close` stays visible.

### Pass 3: type-ahead after Ctrl+C and a slow prompt hook (#436)

3.1 `sleep 30`, press Ctrl+C, then **at once** type `echo after` and Enter: `after` is printed exactly once, as its own
command. Nothing is queued forever and nothing is taken as an answer.
3.2 A program that asks just before it is interrupted: `read -r x` (Fish: `read x`), Ctrl+C, then at once `echo after`
Enter: same result.
3.3 A slow prompt hook. zsh: `slow() { sleep 1 }; precmd_functions+=(slow)`. Bash: `PROMPT_COMMAND='sleep 1'`. Fish:
`function slow --on-event fish_prompt; sleep 1; end`. Then run `true` and, while the next prompt is still coming, type
`echo after` and Enter: it runs once, after the hook, and is never shown as an answer to a waiting program. Repeat a few
times, also under load (as in 1.5).

### Pass 4: history browsing and `History n/N` (#389)

Run a multi-line command (Ctrl+J between lines, for example `echo one` Ctrl+J `echo two`) and a few one-line ones.

4.1 From an empty composer, Up recalls the newest; each further Up moves one command, passing the multi-line one in one
press; Down comes back the same way; Down past the newest restores what you had typed.
4.2 Recall the multi-line command, press Left (or type a character), then Up: the caret moves within it.
4.3 Narrow window (about 46 columns) with a long one-line command: one press per entry.
4.4 (#441) While stepping, the bottom composer rule shows `History 1/N` for the newest, counting up as you go back. It
disappears when you type, move the caret or go past the newest. No row is added and nothing moves.
4.5 (#441) With `/keep-awake display` running, Keep Awake keeps its place; the label is on the other rule or not shown.
In a window of about 30 columns, and with Settings → Composer dividers Off, no label appears and nothing wraps.
4.6 (#441) Light and dark themes: the label is readable.

### Pass 5: terminal editor choice (#366)

Launch with `VISUAL` and `EDITOR` unset: `env -u VISUAL -u EDITOR /Volumes/T7Tmp/ai-dev/q22/nmsh`.

5.1 `/open README.md:3` explains that no editor is set and names the terminal editors installed here.
5.2 Settings → Sessions → Terminal editor (also Setup → Sessions & alerts → Terminal editor): installed editors are
marked; the highlighted one previews the exact command. Choosing one that is not installed is refused, and nothing is
installed. Choose one that is installed.
5.3 `/open README.md:3:2` puts its command in the composer at the right line (and column where the editor supports
it); nothing runs until Enter. Quitting the editor returns to NMSh.
5.4 In `/view README.md`, `o` uses the chosen editor (once #434 and #439 are both in the build under test).
5.5 Inside Zed's or VS Code's integrated terminal, the surrounding editor still wins.

### Pass 6: Ask command suggestions (#432)

Needs a local model set up in `/llm`.

6.1 With Settings → Ask → Command suggestions Off (the default), `/btw convert every png here to webp` behaves as
before: no model is asked.
6.2 Set Command suggestions to Local model (Settings, or Setup → Ask & local understanding). The same request shows
one suggested command with `NMSh's check: …` first, then the model's words in quotes with its name. There is Copy and
Insert, never Run.
6.3 Insert puts the command in the composer, unsent; Enter runs it. Copy runs nothing.
6.4 `/btw delete all my files` stays a refusal; no suggestion is offered.
6.5 With local understanding Off in `/llm`, the suggestion attempt says how to turn it on. Ask's own suggestions are
still offered.
6.6 Activity Monitor: no new long-lived process appears beyond the shared model service while suggestions are on.

**Reporting.** One line per pass, for example `Pass 1 · Ghostty 1.3.1 · zsh 5.9: PASS (note seen once, ~1 s)`.
