# v0.19.0 changelog draft (not yet in CHANGELOG.md)

Drafted from the workflow candidates (References `3518231` + Vocabulary `949a367`), the PR descriptions, the help text
and `docs/design/terminal-workflow.md`. **Recheck every line against the frozen heads before it moves into
`CHANGELOG.md`**: commands, keys and defaults below were confirmed in the candidate source on 2026-10-13, not in the
frozen heads. The existing Input awareness entries already on the stack stay as written.

---

## [0.19.0] - YYYY-MM-DD

**Terminal workflow.** One command's result becomes useful for the next without NMSh taking execution away from the
real shell. NMSh notices when a running command is waiting for you, lets you prepare the next commands while one
runs, copies exactly what you choose, turns output into reviewed reports and comparisons, and keeps the commands you
reuse. Nothing derived from output, the clipboard or a recipe ever runs without an explicit, reviewed action.

Verification: <fill from the gates: canonical run, CI runs, security acceptance, smoke test>. Physical-terminal QA
status: <fill>.

### Added

#### Command queue ([#357](https://github.com/raiseCatError/notMyShell/pull/357))
- Commands typed while another runs are **queued in the same shell** and run after it, one at a time, keeping the
  directory, variables and functions. `/queue` shows, edits, reorders, pauses, resumes or clears them.
- When the running program is waiting for an answer, Enter answers it; **Ctrl+Q** composes a queue entry instead.
  While a program reads keys directly, Ctrl+Q takes the next command for the queue and **Ctrl+S** sends to the
  program.
- A failure or interrupt **pauses** the rest of the queue. An entry can ask first (approval is withdrawn if it is
  edited) or be marked to run even after a failure, never after an interrupt. Detach and reattach never submit an
  entry twice.

#### Copy ([#358](https://github.com/raiseCatError/notMyShell/pull/358), [#350](https://github.com/raiseCatError/notMyShell/issues/350))
- `/copy N`, `/copy -N` (the latest N), ranges `A-B` and lists `1,3,5`; `--status` adds the completion row; `/cp`
  is the same command.
- `/copy ui` opens an interactive picker; `/copy settings` chooses Quick Copy or the picker by default and whether
  copies include status.
- Block controls stay reachable while a long block's header is scrolled away.
- **Smart Folding** keeps long diagnostics readable; the full output stays available, and copying includes folded
  lines unless a selection says otherwise.

#### Copy as Report ([#360](https://github.com/raiseCatError/notMyShell/pull/360), [#351](https://github.com/raiseCatError/notMyShell/issues/351))
- Markdown or plain-text reports of commands, their output, directory and exit status, always shown for review
  first. Enter copies exactly the reviewed text; cancel leaves the clipboard unchanged.
- Likely secrets and private paths are **redacted** in the review; edited text is rescanned and labelled when left
  unredacted. Redaction is best-effort (see Known limitations).

#### Compare output ([#361](https://github.com/raiseCatError/notMyShell/pull/361), [#352](https://github.com/raiseCatError/notMyShell/issues/352))
- `/compare` (latest with its previous run), `/compare N`, `/compare N M`, or Actions → Compare output…: a line diff
  with counts, hunks and collapsed unchanged regions, side by side from 140 columns and unified below,
  with labelled whitespace normalization.
- `c` copies a plain diff; `r` opens it as a reviewed, redacted report. Output lost while detached is marked
  incomplete.

#### References, paste review, pins and recipes ([#368](https://github.com/raiseCatError/notMyShell/pull/368), [#353](https://github.com/raiseCatError/notMyShell/issues/353)–[#355](https://github.com/raiseCatError/notMyShell/issues/355))
- Files, links, commits and device names in output can be opened or staged from Actions; nothing runs by itself.
- **F8 / Shift+F8** walk failed commands (exit status, not text matching) and keep your draft.
- **Paste Review** can split a pasted zsh, Bash or Fish sequence into commands and parse-check each without running
  it; confirming queues the reviewed list. `/ps` reads the clipboard only when you run it.
- `/clips`: text deliberately kept for this window, in memory only, reviewed before insertion and gone when the
  window closes. Optional clipboard-change hints on macOS (`/clips suggestions on`) use only the pasteboard's change
  counter, never its contents; other platforms say they are unavailable.
- `/pins`: pinned commands (from the palette: Pin selected history command, with its directory) and recipes with
  quoted placeholders, staged or reviewed and queued, never run automatically.

#### Activity wording ([#367](https://github.com/raiseCatError/notMyShell/pull/367), [#362](https://github.com/raiseCatError/notMyShell/issues/362))
- **Expressive** (default) gives each running command a stable playful phrase (`✦ Cooking… · 18s`,
  `✔ Cooked for 18.0s`); **Classic** keeps plain wording (Settings → Live activity → Activity wording, and Setup).
  Failures, interrupts, waiting for input and queued runs always use factual wording, and copies and reports always
  store the factual form.

#### Modules and themes
- Module details explain where a fact came from, its freshness, cache and measured collection time, and say when a
  fact is uncollected or unknown rather than implying it ([#365](https://github.com/raiseCatError/notMyShell/issues/365)).
- Ruby and PHP version modules (canonical implementation arrives with the native module set in v0.20).
- `/theme` imports **Starship** configurations as Native themes from their static colors only; format strings and
  custom commands are never evaluated, and the preview lists what was not carried over.

### Fixed / Security
- Session helper requests (list, notices, dismiss, rename, kill) verify the private runtime directory before
  connecting, like attach already did.
- A detached or killed session no longer leaks withheld output to a paused client.
- Restored command and status rows follow the attaching window's NO_COLOR setting.
- Report and comparison text is redacted before Markdown is added, and hostile command, status and directory text
  stays enclosed.
- Fullscreen programs get the terminal back immediately on reattach, before the journal is saved.
- A prompt arriving after the window closed can no longer restart context collection or change the directory.

### Known limitations
- Redaction is pattern-based and can miss custom, encoded or unknown secret forms; review every report.
- A clipboard tool that reports failure may already have written part of the text.
- Linux has no supported metadata-only clipboard counter, so change hints are unavailable there.
- Project and branch facts can lag a fast directory change while collection is pending.
- Fish can drop type-ahead entered while its own `read` is still running (#356).
- Exact last-frame module width-compaction explanations are not recorded yet (#365).
- Physical-terminal QA: <fill>.
