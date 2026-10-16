# Post-v0.20 Slice 3 integration checkpoint

Branch: `integration/post-v020-slice3`.
Worktree: `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/post-v020-slice3-integration`.
Base: verified Slice 2C `e888b06a561a753cfda4ec05f1650380f9d347d9`.
Existing Slice 3 source: `877c6f607f93836a9c4c7e80856f5430fdc8498c`.
Common ancestor: `069d954e21d4e35c69d2510f8173bddcd7c1b7c3`.

This is integration of the existing implementation, not a new selector/diff/action system. The original Slice 3 branch and worktree remain intact. The Slice 2C source worktree remains intact. The original checkout's unrelated package edits, release branches and scrolling research are untouched. `package.json` stays at 0.20.0. No merge, tag, release, version bump or Slice 4 work is authorized by this checkpoint.

## Reconciliation

The existing Slice 3 delta was applied three-way to the pinned 2C base, then reviewed by responsibility. The only textual conflict was `TerminalApp` modal ownership. Resolution retains 2B Queue History in the modal list and Slice 3's narrow exemption for its own originating contextual palette. It does not bypass foreign modals.

Integration regressions exposed that the summary-save review and its pending detail fetch were not included in the selector's eligibility guard. Both now retain ownership. Paste review, running commands, direct/hidden input, passthrough, task bars, searches and other modal ownership remain protected. The existing 2C choice navigation and explicit Enter confirmation paths are unchanged.

A review found pointer hit testing could run after selection restored the entry viewport, retargeting the click. A failing regression reproduces this with different visible and entry blocks. Pointer events now reach existing hit testing with the displayed viewport intact; keyboard Esc still restores the entry anchor. No action runs merely because keyboard focus moves.

`OutputBuffer`'s presentation generation is additive to 2B/2C clear/restore behavior. Typed summaries remain metadata, outside completed shell records and numeric Copy/Compare candidates. Queue provenance, folded flags, all stored output and exact `copyText` survive journal roundtrips. Folding/filtering/reflow do not change generation. No persistence schema or diff algorithm changed.

Bare Copy defaults, saved Quick Copy/picker choices, aliases, explicit selectors and `/copy ui` retain Slice 3 behavior. Enter uses the existing clipboard pipeline. Existing registries remain authoritative for contextual Actions; palette return is scoped to the originating selector and ends before editor/program handoff.

Canonical discovery coverage caught an inherited Slice 3 omission: `/actions` and `/action` lacked an Ask concept. They now use the existing actionable concept registry, with a natural-language routing assertion. The subsequent Guide coverage assertion required adding that concept to the existing History & transcripts section as well. Both catalog audits remain intact; no new public surface is excluded.

The zsh/Bash/Fish PTY fixture now checks actual 2C queued provenance and folded state before copying all 400 lines. A file-boundary timing race was fixed in the fixture: a stand-in clipboard tool truncates its file before writing; the wait now requires the exact expected bytes, preserving the byte assertion. It never treats an empty in-progress file as successful copy.

The real tmux test's temporary root now honors `tmpdir()` rather than hardcoded `/tmp`, so canonical tests respect the externally supplied scratch environment. Socket paths remain bounded by the short private test root. No tmux behavior changed.

The inherited inline-agent PTY fixtures emitted `PICKED-1` before exiting, then immediately sent a shell command while the session still reported that program running. Diagnostic evidence confirms this race. They now wait for the authoritative completed journal before their unchanged next-command assertions. Program-owned bytes remain program-owned; no production input routing or deadlines changed.

The Welcome identity fixture uses a controlled cwd under its private test HOME, preserving its 80-column assertions independently of the integration checkout's long name. Canonical tests use the shortest external root `/Volumes/T7Tmp/ai-dev`, retaining the existing short-root assertion.

## Verification and failure evidence

All retained command output and generated previews are under:
`/Volumes/T7Tmp/ai-dev/runs/s3int-yj9vopp_`.

`t7run --check` verified the pinned Samsung T7 Shield device, APFS scratch volume and backing image before operations. The new worktree, clean npm installation, build output, test homes, runtime directories and generated evidence are external. Nothing belonging to another process/run was removed or interrupted.

Evidence files identify each run separately rather than overwriting failures:

- `initial-focused.log`: unchanged 2B/2C and source Slice 3 affected tests.
- `integration-red.log`: summary review ownership failure before its guard.
- `pointer-red.log`: displayed-block pointer identity failure before its fix.
- `focused-pty-compat.log`: real-PTY compatibility, paste, summary persistence and historical queue approval checks.
- `final-focused.log`: focused source check exposing clipboard fixture truncation timing.
- `queued-fold-pty.log`: corrected exact-byte zsh/Bash/Fish queued-fold tests.
- `safe.log`: Safe/NO_COLOR integration and bounded renderer checks.
- `ask-discovery.log`: Actions coverage and actual natural-language routing after the canonical discovery failure.
- `verify-fast.log`: fast aggregate.
- `verify-release.log`: original canonical run; discovery, fixture/environment and live timeout failures are preserved.
- `serial-diagnosis.log`: serial rerun confirms the discovery/temp-root/Welcome fixes and startup cases; two interactive follow-up commands raced completion.
- `handoff-diagnosis.log`: session diagnostics show the program still running after its exit marker.
- `handoff-fixed.log`: interactive fixtures wait for actual completed journal before the next shell command.
- `verify-release-serial.log`: full serial canonical run, with a Guide catalog omission, a picker cleanup ownership-scan timeout and detached-session setup timeout. All Slice 3 cases passed. The Guide entry is corrected; original failed logs remain.
- `canonical-failure-recheck.log`: Guide and picker pass after correction; a different startup case fails, asking despite saved Always.
- `baseline-startup-control.log`: the unchanged Always-resume test reproduces that same failure on pristine pinned 2C, first attempt. Control checkout: `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/slice3-control-e888`; detached at the base, external dependencies reused read-only. No startup production change is included.
- `verify-fast-checkpoint.log`: final fast aggregate after Guide registration.
- `release-tail.log`: benchmark typechecking passed; bounded timing smoke reached configured cold completion and failed with no candidates.
- `baseline-completion-control.log`: unchanged cold completion fixture passed alone on the 2C control. It uses the existing 300ms query budget, which is unchanged.
- `timing-smoke-recheck.log`: fresh bounded smoke passed after the isolated completion diagnosis; first failure retained. Budgets are unchanged.
- Subsequent canonical logs and remote CI result manifests stay beside these with distinct names.

**Local canonical release verification is not green.** Both full attempts are preserved. After the catalog fixes, the picker passes its focused rerun, while the startup Always-resume mismatch reproduces on the pristine 2C control. Cleanup scan timeouts remain recorded. Do not describe this checkpoint as locally release-verified or hide these failures behind focused success. Exact-head remote CI is independent evidence and may expose additional baseline failures.

The supported release gate is `verify:release`: build, complete canonical tests, diff checks, benchmark script typechecking and bounded timing smoke. CI must additionally confirm the exact pushed HEAD, including macOS/Ubuntu full shards, actual Node 22, Fedora, both timing jobs and aggregate aliases. A local pass is not proof of Linux or physical terminal behavior. GitHub Actions on the exact integration commit is the durable CI result; consult it rather than inferring green from earlier source branches.

Historical exact-head investigation: [run 38930716614](https://github.com/raiseCatError/notMyShell/actions/runs/38930716614), at 2B SHA `8a6ac8f7`, failed Ubuntu shard 1/2 in `queuePreviewLive` approval/typed-y/n routing, timing out on `echo DIRECT`'s completed journal. The corresponding test passed in local focused integration checks. The failing log is retained as `historical-ci.log`; local success does not by itself establish that the historical Linux failure is resolved. The initial remote Slice 2C ref was confirmed at the pinned base but had no recorded run; original Slice 3 was local only.

A read-only review was interrupted by its quota before a complete whole-branch assessment. Its pointer concern was reproduced and fixed with a regression; do not describe the review as complete. Subsequent author review and automated gates are separate evidence.

## Deterministic visual evidence

`scripts/dev/copy-actions-frames.ts` reuses `TerminalApp.render()`, the real OutputBuffer, screen plan and presentation primitives with a simulated session boundary. It starts no shell and executes none of the displayed commands. `previews/index.html` contains SVGs; `.ansi`, `.txt`, per-mode JSON and `frames.json` preserve the emitted rows, geometry, source SHA and dirty-state marker.

Cases at 80×30 and 32×18, normal and Safe/NO_COLOR: entry view, Copy selection, Esc restoration, Actions selection, contextual palette, palette back, independent multi-selection, Compare, and actual queued-fold selection. Regenerate from the committed source so `frames.json` names that exact SHA with `dirty: false`:

```sh
rtk t7run env -u NO_COLOR -u NMSH_COLOR TERM=xterm-256color COLORTERM=truecolor node --import=tsx scripts/dev/copy-actions-frames.ts /Volumes/T7Tmp/ai-dev/runs/s3int-yj9vopp_/previews
```

These captures are production-renderer evidence, not physical screenshots or physical QA.

## Remaining human QA and next gate

Maintainer approval of the integrated checkpoint and physical QA are required before any integration into the active execution branch/dev or release decision. This task stops with the integration branch pushed and its exact-head CI results reported.

- Ghostty and Terminal.app: Bottom/Top/Flow composer, Normal/Chat transcript, normal/narrow/short windows, resize and detached/FOLLOW restoration; folded hints, filtered output, pointer Actions/Copy, drag selection and keyboard navigation. Esc must restore the original view/draft/cursor; clicking must act on the displayed block.
- Copy: `/copy`, `/cp`, `/actions`, `/action`, numeric/range/list forms, `/copy latest`, configured Quick Copy/picker compatibility, `/copy ui` search/multi-select/preview/status/order/report; exact tabs/Unicode/trailing blank lines and `seq 1 400` from folded queued output in an external editor. Clipboard unavailable/no-output retry must preserve focus. Reports require explicit exact-text review, including fake tokens/private paths.
- Input routing: foreground read, hidden/password read, single-key input, type-ahead, queue composition and fullscreen TUIs. Selectors must never take program input. Explicit edit/rerun/pager actions must end navigation before handoff. Keyboard focus alone executes nothing.
- Queue: reviewed resume/clear/approval, typed y/n versus review confirmation, failure/interruption/manual pause, later independent foreground commands, summary-save privacy and idempotence, history modal, fold reversibility, detach/reattach and exact retained raw output. Exercise all 2C paste choices with explicit Enter; loops/heredocs/dependent shell syntax must remain intact.
- Task bar: keyboard/pointer focus, task output/detail, cancel/return and foreground handoff while queue/selector views are present. Hidden/key prompts and fullscreen ownership retain priority.
- Setup: Queue settings discovery, all Copy modes, saved preferences, preview fit and Safe/NO_COLOR; no accidental submission when leaving setup/review.
- Linux Fish 3.7: run `typingAfterRead` regression coverage on the actual runtime, including immediate zero-delay input, hidden-read exit status, typing after prompt return, background-session ESRCH and the historical approval/typed-input scenario. Local macOS Fish is not a substitute. Existing #356 and physical checklists are not closed retroactively.
