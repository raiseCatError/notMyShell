# v0.8 continuation acceptance — integration and physical QA pending

This additive continuation starts at PR #241, verified on GitHub as
`2da4d025ff0a352a90e7594c7dc1083d6c5e0fe5`. All ten supplied lower-stack heads
matched at session start. Those branches were left unchanged. Nothing here is
merged or released; package version remains **0.7.0**. Neither the original
stack nor this continuation has passed physical terminal QA in this session.

The [original design](command-intelligence.md) and
[physical QA checklist](../qa/v0.8.0-physical-qa.md) still apply. This document
covers only the continuation.

## Scope and review order

| Order | Implementation | Issue | PR / branch | Implementation head |
| --- | --- | --- | --- | --- |
| 1 | Local command inspector | #242, research #84 | #244 `feature/v08-command-inspector` | `f63182b` |
| 2 | Interactive block actions | #243, research #85 | #245 `feature/v08-block-actions` | `83d8b07` |
| 3 | Live completion notifications | #106 | #246 `feature/v08-command-notifications` | `7919fdf` |
| 4 | Test temp lifecycle | #208 | #247 `test/208-tmpdir-hygiene` | `573ca03` |
| 5 | Inspector cursor-role hardening | #242 | #248 `fix/v08-continuation-hardening` | `8e61137` |
| 6 | Architecture and additive QA snapshot | — | #249 `docs/v08-continuation-acceptance` | `0de4805` |
| 7 | Fixture writer ownership barrier | #208 | #250 `test/208-fixture-writers` | `b1ab55e` |
| 8 | Final acceptance evidence | — | `docs/v08-continuation-final-verification` | See PR head |

Each PR targets its immediate predecessor branch; #244 targets #241's branch.
Review/integrate in this order, after the original stack. Keep all branches
unmerged for the planned combined QA. Do not close implementation issues based
on automated tests. Research #84/#85 remain research; only child #242/#243 and
implemented #106 were added to milestone #8. #208 remains test hygiene outside
the product milestone. Project updates could not be made because the token
lacks `read:project`; active issues/PRs are the durable work record.

Research findings:
[#84 comment](https://github.com/raiseCatError/notMyShell/issues/84#issuecomment-5924074969),
[#85 comment](https://github.com/raiseCatError/notMyShell/issues/85#issuecomment-5924075196).

## Inspector architecture

`CommandKnowledge` shares explicit local facts with completion enrichment.
Native candidate descriptions have priority only when their buffer, cwd,
replacement bounds and value match the inspected token. Inspection reuses
`Highlighter` and the editor's grapheme cursor, converting offsets to UTF-16
for candidate provenance. It does not evaluate shell syntax or submit text.

The initial table covers conventional git/npm command and subcommand names
and a small set of rg flags. Known facts include optional usage/value hints.
Other tokens show their context and **No local description available**;
unknown argument words are not guessed to be subcommands. `--` ends flag
interpretation. Quoted/path words retain command context; descriptions for quoted/dynamic
contexts and wrappers are deliberately
conservative; this is lexical context, not a complete zsh AST or alias/function
expansion. Conventional-name facts are not installed-version documentation.

Use F1 or Ctrl+Shift+P, search **Toggle command inspector**, and press Enter.
The session-local toggle survives temporary hiding. `ScreenPlan` allocates
one or two bounded rows above Bottom, below Top and before the Flow composer
in the scrolling document. Chat changes transcript presentation only.
Execution, panel takeover, slash input and paste atoms hide the inspector.
Small terminal heights can suppress its region; widths below 32 use one line.
Plain truncated text is deterministic and works with Safe glyphs/NO_COLOR.

Safe-source research considered existing candidates, shared authored facts,
local man/whatis and explicitly supported help adapters, in that order. Only
the first two are implemented. Bounded asynchronous extraction/caching and
platform ambiguity need separate work before man/help sources are added.
There is no new parser ecosystem, documentation browser, program invocation
or network knowledge lookup in the inspector.

## Block action architecture

`BlockActions` is the shared registry consumed by pointer-opened and
keyboard-opened palettes. Actions are copy command, copy output, copy both,
open in pager, rerun, edit & rerun, fold/unfold and (on failed blocks) explain
failure. Shift+Tab traverses completed block focus;
Enter opens its actions. The global palette includes the focused/latest
block's actions. Typing clears block focus; Escape closes the palette, and
Escape at the composer clears focus.

Passive hover adds a right-aligned `[Actions]` opener on an owning visible
command/output row only if it fits without covering text. Clicking opens the
same keyboard palette; it does not immediately run a shell command. At narrow
widths the opener disappears and keyboard access remains. Structural
`blockStartId` from the transcript presenter determines ownership, including
Chat output rows. Historical headers and sticky overlays retain their
existing interactions.

Copy reads authoritative `CompletedCommand.command/output`, including folded
output. Copy both excludes lifecycle/presentation chrome; existing `/copy`
semantics (output plus plain lifecycle) are unchanged. Fold uses the same
record state as Ctrl+O. Rerun explicitly uses normal visible submission in
**the current shell cwd**, not the historical cwd. Edit replaces the composer
with stored command text and waits for a separate Enter. Actions apply only
to completed records while idle. Clearing a transcript invalidates its actions.

Open in pager shows the same text as copy both (the stored command, then the
complete stored output including folded lines) in a pager on the host
terminal, the way the fzf picker borrows it: NMSh releases raw mode and its
screen, and restores both when the pager exits. The text reaches the pager
only on its stdin through an owned pipe; it is never written into shell
source, a command line, an argument or history, and the managed shell never
sees it. Control characters left in stored text are shown in caret notation
first. The pager is `PAGER` when it names a plain program with plain options
(typed argv, no shell; `PAGER=cat`, which NMSh shells use for their own
transcript, does not count), else `less`, else `more`, resolved under the
same rules as other NMSh tools (absolute PATH entries, nothing inside the
current workspace, nothing writable by others). `LESSOPEN`/`LESSCLOSE` are
dropped for it, since an input preprocessor would run on the block's text;
the Theme Bridge less colors apply when that target is active.

Shift mouse reports remain discarded before hit-testing: Shift click/drag
cannot reveal, focus or dispatch controls. Raw shell output, journal content
and stored rows are unchanged. Historical inspector browsing, bookmarks/pins,
filters, annotations and extra navigation are deferred.

## Notification architecture

The five Config settings default to On, 60 seconds, success On, failure On,
focused Suppress. Threshold is stored as seconds (1–86400), normalized and
preserved when custom; the UI steps through presets. Settings are read at
completion time. The command palette can target the same Config rows.

Terminal focus reporting (`CSI ? 1004 h`, `ESC [ I`, `ESC [ O`) is owned by the
renderer with its input modes. Reports are consumed before panels/editor.
Unknown focus permits delivery; definitely focused suppresses by default.
Ownership handoffs invalidate focus to unknown, disable reporting and restore
it on resume. Passthrough input remains owned by the foreground app. Exit,
external picker/wizard handoff and genuine SIGTSTP/SIGCONT suspension restore
terminal modes; Ctrl+Z still forwards shell job control rather than suspending
the frontend. External picker/wizard terminal ownership remains independent.

Only `onShellPrompt` completing a live `running` command delivers. Replay,
restored journals, redraw, resize, sticky headers and slash commands do not.
Clearing the running state prevents repeat prompt markers from notifying twice.
Interrupted commands count as failure. The macOS backend reuses the preserved
#107 argv-only `/usr/bin/osascript` implementation, with a fixed script,
`shell: false`, ignored stdin/stdout, bounded stderr and a 10s timeout. Delivery
errors are silent and cannot prevent shell completion; other platforms no-op.

Notification content is generic outcome/duration/exit status, with neither
command text nor output. Nothing is written to transcript, `/copy` or journal.
No sounds, icons, history, click actions, excerpts or per-command rules.
Native macOS sender identity/permissions and actual visible delivery remain
unverified: osascript exit 0 does not prove Notification Center presentation.

## Test hygiene and verification

Direct TerminalApp tests already had teardown; current leakage was reproduced
from intentional SIGKILL fixtures sharing host TMPDIR. `LiveSandbox` now owns
its nested TMPDIR and awaits tracked frontend exits, including external PTYs.
Completed wait-exit timers are cleared. #250 adds a test-only ownership barrier
using the suite's existing lsof tool: no process may hold the sandbox subtree
(including cwd references) when removal starts. This covers mux frontends
finishing journal writes after the outer PTY exits. A regression starts an
untracked late writer and proves it exits successfully before directory
removal. The barrier also exposed a background sleep left by the live-status
fixture; that fixture now records and kills its own background PID. Production
lifecycle is unchanged.
Normal stop/kill cleanup is tested without a sweep; a killed frontend's temp
directory is explicitly observed to remain until fixture disposal.

`npm test` uses a short private per-run root through `scripts/test.mjs` to keep
Unix socket paths small. Root-level semantic/zsh leftovers fail the run and
are reported **before** cleanup. Only that run's root is removed; pre-existing
host artifacts are untouched. Regression fixtures prove leak detection itself.
Two repeated full suites passed **732/732**, with host artifact count **2079
before and after**, zero additions and zero private roots remaining. The final
writer-ownership follow-up passes **733/733**. Build, typecheck and diff check
passed. Local full
PTY/socket suites required sandbox escalation; inherited NO_COLOR was unset
for existing ANSI assertion tests. Dedicated NO_COLOR tests remain present.

CI is explicitly workflow-dispatched because these PR bases are stacked
branches. Node 22 and Node 26 passed on #244, #246, #247 and the #249 acceptance
snapshot. Historical #245 Node 22 attempts failed in existing fixtures: GNU
screen teardown raced a journal write (`ENOTEMPTY`), `/resume` arrived before
the preceding prompt, and idle Ctrl+Z input arrived before completion. These
were not block-action assertion failures. #247 awaits fixture exit and
synchronizes the two input sequences on observed completion. #248 Node 26
passed, but Node 22 exposed the remaining GNU screen writer race after the
outer PTY had exited. #250 addresses that gap with the ownership barrier and
explicit background-job cleanup; it has its own dispatched matrix. Historical
failed runs are retained and are not described as green. The final acceptance
matrix and current required checks must pass before integration.

Informational measurements on local Node 26.8.1 / macOS arm64: shared benchmark
completion/filter-500 p95 0.11ms; ScreenPlan p95 0.02ms or less; the existing
long editor fixture p95 9.52ms. A 2000-sample warmed microbenchmark
measured inspector p95 0.014ms and visible-row affordance p95 below 0.001ms.
These are machine-specific observations, not a formal cross-host regression
proof. Inspection performs lexical/local lookups only; action decoration adds
no transcript-wide scan on pointer motion; notification work starts only at
completion. No background watcher or dependency was added.

## Deferred adjacent work

#75 still combines alias/function and broad syntax/error parity; it needs a
focused acceptance slice. #153 combines preset storage, launch and environment
policy. Neither was silently expanded here. #150 depends on #10; the current
TerminalHost only exposes window launching, without the required hyperlink
capability seam. No host refactor, fifth feature or new milestone was started.
The user-excluded directions and unrelated PRs were left alone.

Physical QA remains pending. Use the additive continuation section of the
existing checklist for both Ghostty and Terminal.app. No product decision
blocks review of this stack; notification identity/delivery may need a later
presentation decision after observations are available.
