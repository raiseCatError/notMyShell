# v0.16 acceptance (automated)

Branch `feature/v016-platform-portability-agents`, started at `dev`
`04ec6b56c81a90fbb847a2346e0ce2439d35594c`. Automated validation only; nothing
here is physical terminal QA (see [v016-physical-qa.md](v016-physical-qa.md)).

## Environment (cloud container)

Linux x64 (Ubuntu), Node 22.22.0, zsh 5.9, Fish 3.7.0, Bash 5.2.21. No
bash-completion package (the Bash completion fallback path was exercised).
Locale set to `C.UTF-8` for the suite: without a UTF-8 locale one pre-existing
zsh test (`λ` alias name) fails on the untouched baseline as well.

## Canonical suite (final run)

- `npm run build`, `npm run typecheck`: pass.
- `npm test`: 1144 tests, 1137 pass, 0 fail, 7 skipped (optional tools not
  installed: zoxide, fzf, GNU screen ×2, Powerlevel10k; macOS window
  integration; the unreadable-config case, which prints no skip reason); history ranking group
  8/8.
- `git diff --check`: clean.
- An earlier full run had two failures: `/open-diff`'s palette insertion
  parsing as unknown (fixed), and `liveHardening` "mouse reports … after
  reattach" timing out once under full-suite load; it passed 3/3 in isolation
  and in the final full run.
- One hot-swap service test failed once during development before Fish
  executable resolution was made PATH-only; it passed 5 consecutive runs after.

## Benchmarks

`npm run bench` completed; figures remain in the existing ranges (for example
history structured query 100k p50 ≈ 25 ms, suggestions 100k repeated p50 ≈ 7 ms,
screen plan < 0.1 ms). New hot paths have their own budgets in tests: ranked
history over 100k entries (< 250 ms per query, observed far lower), completion
aggregation deadlines, notices polled every 4 s outside passthrough only, find
recomputed only on row changes.

## New focused test files

sessionNotices, agentActivity, historyRanking, completionSources,
portabilityUninstall, imageSurface, shellAdapters (live zsh/Fish/Bash and
service hot swap), shellSwitchApp, linuxPlatform, transcriptSearch,
hostActions, idleLifecycle.

## CI

GitHub CI (macOS and Ubuntu, Node 22 and 26) runs on the pull request; its
results are reported there, not claimed here.

## Post-QA follow-up (cursor, motion, paste, notices, Setup)

Automated validation of the changes in
[../design/v016-physical-qa-followup.md](../design/v016-physical-qa-followup.md),
on macOS (Apple silicon), `LANG=C.UTF-8`. Not physical validation; the new
checklist is in [v016-physical-qa.md](v016-physical-qa.md).

- `npm run build`, `npm run typecheck`, `git diff --check`: pass.
- `npm test -- --test-concurrency=2`: 1426 tests + the 8-test ranking group,
  1434 in all, 0 fail, 0 skipped. At the default concurrency two PTY or
  timing-sensitive tests (`native fuzzy filtering preserves nested path capture
  context…` plus one varying PTY test) fail under this machine's load; they pass
  alone and at lower concurrency, and the same fuzzy-filtering test fails the same
  way on the untouched `4b04351`.
- New focused files: `pasteReview`, `cursorCapabilities`, `setupCoverage`; extended:
  `motionTransitions`, `motionPreview`, `cursorEffects`, `sessionNotices`, `askApp`,
  `appearanceUi`, `chromaPolish`.
- What they pin: Local Understanding fresh default Auto with a saved Off kept;
  the four-line paste classification, prose, unknown input, read-only Git and
  `nmsh --version`, project scripts, risky pipelines; bounded Paste Review over 5000
  lines at several heights, exact source, Enter/Esc paths and the short-terminal
  route; notice TTLs on an injected clock and sticky attention; no ANSI background
  from any motion paint or portable cursor effect (only the caret cell); the
  unchanged context module untouched on every preview frame; the capability matrix,
  Unavailable rows without arrows, `Portable fallback` labelling, forced native
  drawing nothing without a host backend; Block/Bar/Underline/Host previews differing;
  shape/blink applying to the live renderer; Follow vs Choose theme, family →
  variant → accent, validated custom color through the picker; configuration
  migration; managed-file refresh states and reload lines; Setup coverage of every
  Settings row and entry point, syntax color mode and theme selection with the real
  preview, routes, and the embedded /cursor editor leaving the draft until Apply.
