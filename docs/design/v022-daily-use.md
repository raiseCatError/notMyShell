# v0.22 design: daily-use reliability and workflow

Planning and acceptance record for the v0.22 candidate ([#431](https://github.com/raiseCatError/notMyShell/issues/431)). Durable progress lives in the
[v0.22 ledger](../development/v022-ledger.md). Automated results are not physical-terminal validation.

## Goal

Make NMSh better for everyday terminal work without turning it into a shell, a terminal emulator or an IDE. The
release starts from reliability: no typed key may be lost, duplicated, misrouted, shown when it should be hidden, or
run unexpectedly. On that foundation it adds a small number of workflow improvements that reuse what NMSh already has
(`/view`, `/edit`, `/open`, the editor bridge, Ask, the queue). Everything else stays where the issue tracker puts it.

## Baseline and the v0.21 release boundary

- Baseline: `dev` at `a8b383c2` (v0.21 integrated: #411–#424, then #425, #427 and #428).
- `release/v0.21.0` is now `86bb3a6c`: PR #430 merged `dev` (`a8b383c2`) into it on 2026-10-18. Draft PR #429 is the
  release itself; its physical QA has not run.
- **Rule:** v0.22 PRs target `dev` but stay **draft and unmerged until v0.21 has shipped**. A fix that v0.21's physical
  QA needs lands on `dev` and reaches the release branch by another `dev` → `release/v0.21.0` merge, as #430 did, so
  anything v0.22 merged into `dev` before the release would ride along. v0.22 never touches `release/v0.21.0`, its QA
  evidence, `master` or the publishing workflow.
- After v0.21 ships (release PR merged into `master`, tag published), reconcile: bring `master` back into `dev` if the
  runbook does, rebase the open v0.22 branches, and move v0.22 changelog entries into the new `[Unreleased]` section
  (they are written into `dev`'s `[Unreleased]` today, beside v0.21's).

## Scope

### Required reliability fixes (adopted)

| Slice | Issue | Summary | State |
| --- | --- | --- | --- |
| R1 | #426 | Keys typed before NMSh knows who reads them wait for the look instead of an 800 ms deadline; a runnable first sample is not "busy" | Implemented, draft PR |
| R2 | #356 | Fish key loss after a handed-over read: reproduce under load on the current harness; fix only what reproduces | Investigation |

### High-value user-facing improvements (adopted, from accepted issues)

| Slice | Issue | Summary | State |
| --- | --- | --- | --- |
| U1 | #366 | `/view` → open the file at the line on screen in the person's editor through the existing `/open` bridge; refusal messages offer the same | Planned |

### Optional, pending a maintainer decision

| Item | Issue | Decision needed |
| --- | --- | --- |
| D1 | #389 | A recalled history entry browses as one entry (Up/Down step entries until it is edited). Reproduced on `dev`; changes a behavior the maintainer triaged as acceptable and a test codifies. The position indicator is a separate, later step |
| D2 | #432 | Natural-language command suggestions from the composer ([design](v022-natural-language-commands.md)). Needs a product decision on remote model APIs, which the ROADMAP's design principles currently exclude from the core experience |
| D3 | #366 | Choose a terminal editor for "Open with" when `$VISUAL`/`$EDITOR` is unset (detected installed editors). Settings surface change; after U1 |

### Explicitly deferred (status unchanged)

#330–#332 (workspace sidebar/panel program, paused), #337 and #338 (worktree and GitHub write workflows, paused), #339
and #340 (managed-agent adapters, Remote Control research), #333–#335 (tmux Studio, Setup Cat profiles, keymap
remapping), #341 (executable mods), #398 (Learn, deferred by decision), #399 (host config writes), #304 (Theme Bridge
expansion), #296 (hosted demo), #15. The ongoing indices #14, #20 and #305 stay ongoing. Nothing here is reactivated by
v0.22 starting; none is a dependency of the adopted slices.

## R1 — #426: input ownership under load

**Behavior.** While a command runs and NMSh has no evidence yet that it reads input, the first key of a draft and an
Enter that would queue are held while the session looks (`input-look`). The hold now ends only when the look answers
or evidence arrives (bounded at 5 s), never at a fixed 800 ms. Until then nothing typed is drawn, sent or queued. A
look still running after 800 ms says so in the composer: `Checking whether <program> is waiting for input · your typing
is kept`. Ctrl+C is never held. In the session, a first sample that sees a process on a CPU with nothing earlier to
compare is "runnable", not computing; when the shell holds its terminal, the follow-up sample decides.

**Why not the issue's example (route text at 800 ms, hold only the Enter).** It fixes the queueing but still draws a
hidden reply in the composer whenever the look is slow, for a prompt-less `read -s` and for a prompted `sudo` or `ssh`
password alike. The unfixed baseline failed the live test's "the hidden answer is never drawn" assertion this way under
load. Holding until the owner is known keeps the privacy property independent of machine load. The cost is confined to
a loaded machine: type-ahead appears when the look answers instead of at 800 ms, with the note above.

**Boundaries.** `TerminalApp` hold policy and `InputWatch` sampling only. No protocol change; older services are never
asked and behave as before. No change to queue semantics, Fish's reader handover or the direct-key path.

**Tests.** Deterministic (mocked timers, a look the test settles): prompt-less line, hidden and prompted (`sudo`)
replies typed at once are never queued, drawn or run; keys after a held Enter stay behind it; the bound releases a
look that never answers; the command ending mid-hold runs the line once; Ctrl+C releases; quick looks add no delay. A
watch test for the runnable first sample (line and key reads) and for a busy shell staying not-waiting. Live: the
input-ownership, input-awareness, typing-after-read, query-order and queue PTY suites; the ownership file 4× in
parallel.

**Performance.** No added work per key. A look is the existing `stty` + `ps` probe (one or two samples). Normal-load
latency is unchanged; the bound is 5 s.

**Physical QA.** Ghostty and Terminal.app, zsh, Bash and Fish: `read -r reply; echo got=$reply` and `read -s` typed
at once and after a pause; `sudo -k true` typed at once; type-ahead during `sleep 5`; a heavy build in another window
(load) while repeating the reads: the note appears, nothing is queued or shown.

## R2 — #356: Fish keys after a handed-over read

v0.21 stabilization ran the reproducer 40/40 (macOS, Fish 4.9.3, 8× load) and 22/22 (Linux, Fish 3.6). v0.22 repeats
it on the v0.22 baseline at higher parallel load and with the #426 changes. The issue is not declared fixed without a
reproduction and a verified fix; a clean run is recorded on the issue and the status stays with the maintainer.

## U1 — #366: from `/view` to the person's editor

**Behavior.** In `/view` of a file, `o` opens that file at the first line on screen with the configured "Open with"
target: the surrounding editor (Zed, VS Code) is launched with argv; a terminal editor (`$VISUAL`/`$EDITOR`) gets a
reviewed command placed in the composer for the person to run, never executed silently. With no editor known, the
viewer says how to set one. `/view`'s refusals (too large, binary, not a regular file) name `/open <path>` as the way
on, where it applies. `e` (native `/edit`) is unchanged.

**Boundaries.** Reuses `resolveHostActions`, `editorArguments` and the `/open` dispatch; no new launcher, no editor
registry, no new PTY ownership. Paths stay single argv elements. Viewing output (not a file) offers nothing new.

**Tests.** Viewer key → action (`o` only for files, with the top visible line); dispatch for Zed/VS Code (spawn argv),
`$EDITOR` (composer text, nothing executed), none (message); narrow width and `NO_COLOR` footer.

**Physical QA.** Ghostty and Terminal.app with `$EDITOR=nvim` and with Zed/VS Code integrated terminals.

## D1 — #389 multiline history browsing (pending decision)

Reproduction on `dev` (`a8b383c2`): recall a two-line entry with Up, press Up again: the caret moves to the entry's
first line; a third Up recalls the older entry (`tests/composerHistory.test.ts` "a recalled multiline command navigates
its own lines before older history" codifies it). An N-line entry costs N extra presses. Proposed minimal rule: while
the composer shows an unchanged recalled entry, Up/Down step entries; any edit, paste, caret movement other than Up/Down,
or selection ends browsing. Draft multiline editing is unchanged. Implementation would sit in `TerminalApp`'s Up/Down
routing and `ComposerHistory`; `CommandEditor` stays as is. The `History n/N` indicator is a separate step.

## D2 — natural-language command suggestions (pending decision)

See [the design](v022-natural-language-commands.md). Summary: one optional, off-by-default `CommandSuggester` behind
Ask, with a local provider (the person's own OpenAI-compatible local runtime) and an optional bring-your-own-key remote
provider; a request is explicit (`/btw` or a `?? ` prefix), the suggestion is shown for review and inserted into the
composer, and only the person's Enter runs it. Nothing about files, environment or transcripts is sent unless the
person attaches it.

## Release gates

Per slice: regressions that fail on the old code, focused suites, `verify:fast`, and the full `npm run verify` before
the PR leaves draft. At integration: `verify:release` on the exact head, CI on the exact head (Ubuntu and macOS shards,
Node 22, Fedora subset, timing smoke), and physical QA per slice in Ghostty and Terminal.app. Local runs use
`NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev` (Unix socket path limit). No release, tag or deployment without the
maintainer.
