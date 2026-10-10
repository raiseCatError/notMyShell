# Terminal workflow initiative: ledger

The durable record for the "make the result of one command useful for the next" initiative (queue, copy,
paste, reports, comparison, references, error navigation, pins/recipes, integrations). A fresh session resumes
from this file and Git, not from a conversation. Update it with every slice.

Design and research: [docs/design/terminal-workflow.md](../design/terminal-workflow.md).

## Rules this work keeps

- The real shell is authoritative; NMSh never executes clipboard, AI or output-derived text without an explicit
  submit or confirmation, and never runs a queued entry twice.
- Copying reads stored command data; folding is presentation. Only "Auto-expand copied output" connects them.
- Nothing is persisted (clipboard, pins, recipes) unless the person asks.
- No merge to master, tag, release, deploy or change to real account configuration without explicit approval.
- Commits and PRs carry no AI attribution lines (repository rule).

## Branch stack (bottom to top)

| Branch | Worktree | PR | State |
| --- | --- | --- | --- |
| `release/v0.18.0` | `/private/tmp/nmsh-rel-fix` | #345 | base of the stack; CI green |
| `feature/input-awareness` | `../notMyShell-input-awareness` | #348 | timed-read test fixed (Ubuntu); lapsed-wait start fixed (macOS); CI re-running |
| `feature/command-queue` | `../notMyShell-command-queue` | draft, base #348 | complete; full verify green when the machine is not saturated |
| `feature/copy-selection` | `../notMyShell-copy` | draft, base queue | copy selection, picker, settings, sticky controls, Smart folding fix |

Other open PRs (independent, not part of this stack): #347 agent workspace, #349 notice word wrap, #346 mods.

## Work completed

| Slice | Commits | Evidence |
| --- | --- | --- |
| PR #348 Ubuntu failure: a timed `read -t` waits in poll/select, so Linux evidence is "probably" (test assumption) | `68ea9d7` | syscall unit test; live suite 30/30 |
| PR #348 macOS failure: a lapsed prompt resumed as a new wait (product bug) | `c4c891e` | unit test pins same start, time counted once |
| Command queue (session-owned, same shell, pause on failure/interrupt, detach-safe) | `b302cd9` | 13 live PTY tests zsh/Bash/Fish; unit + protocol tests |
| Queue: exec events carry "from queue" so late-attaching windows show it | in `b302cd9` | detach/reattach live test |
| Queue: a fresh prompt's reply is answered, never queued (security review) | in `b302cd9` | `read -s` live test |
| Queue: Ctrl+Q compose mode never leaks Enter to the program | in `b302cd9` | key-input live test |
| Queue: command text drawn safely (security review: escape injection) | `15147d1` | hostile-content unit test |
| Queue: type-ahead after Ctrl+C/Ctrl+Z bounded to 2 s (security review: input routing) | `a257438` | surviving-program live test |
| Live tests: a start that never becomes ready disposes its sandbox (was hanging the suite) | in `b302cd9` | — |
| Copy: `/copy` and `/cp` N, -N, A-B, lists, `latest`, `ui`, `--status/--no-status` | `7a94ce5` | unit + 5 live PTY tests |
| Copy settings (mode, include status, auto-expand); picker with search/preview | `7a94ce5` | unit, live, settings/setup coverage |
| Direct block Copy + sticky Copy/Actions on the sticky header | `7a94ce5` | app-level tests; captures `docs/captures/sticky-*.png` |
| Smart folding: long output folds whatever the command; important lines stay visible | `7a94ce5` | rewritten policy tests incl. 5/50/200/500/5000 lines, wrapped lines, errors mid-log |
| Copy never changes folding; opt-in auto-expand of copied blocks only | `7a94ce5` | `tests/copyFolding.test.ts` |

## Findings worth remembering

- Smart folding root cause: the policy only folded output that looked noisy; varied diagnostics scored about 0
  against a threshold of 3, and one "error" word anywhere vetoed folding. Now length decides above 120 lines.
- `/copy` expanding a block could not be reproduced on release or this branch (app-level and PTY). Most likely
  the block was never folded (the Smart bug). Regression tests now pin that no copy path changes fold state.
- Full-suite failures while other heavy work runs on the machine (VHS recordings, parallel suites) are load
  timeouts in startup/service tests; the same files pass 65/65 when run alone. Run `npm run verify` on an idle
  machine before trusting a red result.
- Known flake, still tracked: Fish can lose keys typed within ~1 s after a handed-over `read` returns
  (docs/development/fish-typeahead.md).

## Next

1. Push the stack, open draft PRs, file the initiative issues (epic + slices).
2. Phase B: Copy as Report (Markdown/plain, review + optional redaction), Compare output, contextual references,
   error navigation.
3. Paste batches → queue (`/ps`, syntax-aware splitting), clipboard-change suggestion (opt-in where detection is
   reliable).
4. Phase C: pins and recipes, queue conditions (manual approval).
5. Phase D: integrations where they add value (delta for compare, fzf/Television preview).
6. Integration branch for physical QA; prioritized QA checklist.

## Physical QA needed (not yet done by a person)

- Sticky Copy/Actions while scrolling long blocks; click targets in your terminal; "Copied" feedback.
- `/copy ui` picker keys, search and preview at your usual window sizes.
- Queue in daily use: Enter while a command runs, Ctrl+Q/Ctrl+S, a failing step pausing the rest.
- Smart folding on your adb/diagnostic commands; the important-lines preview.
