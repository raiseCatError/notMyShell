# Post-v0.20 preferences and onboarding QA

Source: `825336393562a37cb5cdf9baf916e8d6d3bb4e6d` on
`stabilize/post-v020-slice3`. Implementation branch:
`feature/post-v020-preferences-onboarding`. No package version change or merge.
Specification: [accepted scope](../design/post-v020-preferences-onboarding.md).

## Behavior and compatibility

Recommended is the canonical fresh configuration: NMSh / Lavender Native,
standard vibrance, theme UI text On, text tint Off, Lavender surface, theme
chrome and Chroma Off. Rich motion uses Expressive context/events, Sweep launch,
Vivid completion highlight, Seal completion, cursor travel On, Medium/Normal
independent tuning; effects, shimmer and milestones are On. Reduced Motion is
Off by default; environment/user accessibility and color gates still apply.

Transcript: Chat, Full snapshots, Grayscale history, divider On / Normal /
Follow history, Smart folding. Typed queue summary saving is On, Detailed /
center / left, durations and exit codes On, waits Off. Queue output remains
Inline and failure policy Pause. Title uses Project + Session. Cursor is Auto /
Fire / Follow theme; shape and blink remain host owned, idle effect Off.

Missing configuration receives Recommended. Saved objects with omitted fields
retain historical Clean/no added motion, no cursor effect, neutral surface,
Normal transcript, Follow prompt history/Chroma divider, summaries Off and title
Off. Explicit fields and unknown declarative fields survive the ordinary atomic
save path. Theme surface tint remains specific to Lavender Native. Portable
exports include motion/cursor settings and exclude installation progress.

Minimal uses Native Minimal, Flow, Normal, historical prompt display Off,
Chroma/effects Off, no welcome or greeting, restrained spacing; One-line is
`composerLayout=oneLine`, Two-line is `twoLine`, both with composer placement.
Shell, queue, clipboard and safety behavior are preserved. An archived greeting
is hidden under Minimal without deleting it from the saved transcript.

Fresh onboarding has a finite skippable introduction, then the quick choices.
`introSeen` is separate from completion: fresh False, legacy missing True,
persisted before displaying the introduction. Canceling setup does not replay
it next launch. Attach and explicit setup routes bypass installation onboarding.
A failed save keeps the draft and displays the error. Manual retains the full
wizard, nested editors and direct routes. `/setup` opens it directly;
`/setup quick` and Settings → Choose a preset reopen the quick selector.
Quick apply explicitly reviews replacement; custom fire gradients and explicit
Reduced Motion survive. Optional tools are not detected or installed on quick
paths. D/B/F open only the chosen official community link; /help lists URLs.

Fire presets are gradients over existing particles, not a new engine. Purple,
Blue, Green and Classic have hot-to-cool stops. Follow theme derives several
stops from the resolved cursor theme. Custom opens the existing gradient editor.
Ghostty native uses generated palette endpoints after managed shader setup;
Auto falls back to Portable on Terminal.app and unconfigured/unsupported hosts.
Forced native reports its limits. NO_COLOR, effects Off and Reduced Motion gate
effects; Safe glyphs use existing portable glyph capabilities. Physical caret
color never changes. Native shaders remain subject to explicit host setup/reload.

## Folding investigation — physical Test B

The reported failure was a queued `seq 1 450` with Fold requested. The original
session's effective value was not recorded. It remains **unreproduced**; no
production folding policy or threshold was changed.

Real zsh, Bash and Fish tests traverse `/settings queue` and `/queue settings`,
verify the immediate saved and live outputDisplay value, queue through the real
composer behind `sleep`, and inspect `OutputBuffer.complete()` arguments.
Observed Fold: Smart, queued=true, foldQueued=true, holdOpen=false,
interrupted=false, FOLLOW/no selection → collapsed, 442 hidden, all output intact.
Inline intentionally passes foldQueued=false and stays expanded. Detached or
selected inspection and queued failures/interruption stay visible. Foreground
Smart still folds normally; Never remains Never. Boundary/large-output tests
cover copy/newlines, tabs/Unicode, resize, explicit expansion and restore.

The headless real-PTY fixture answers the pre-ready device-attributes query Fish
4 sends at startup. Without a reply, local Fish 4.9.3 waits 10 seconds, warns
and continues — the tests' own 10-second budgets cannot afford that, and this
was a fixture failure, not a shell or folding behavior. The session answers the
editor's queries only after it has read the readiness marker, so the fixture
also answers a query that arrives in the same read as that marker (captured as
startup output and otherwise owed an answer); a plain pre-readiness guard left
exactly that read unanswered, which was the residual focused-suite flake. No
production folding behavior was altered to bypass it.

## Focused-suite fixture determinism

The real-PTY folding suites assert disclosure decisions, queue provenance and
exact copies. Three fixture mechanics were made deterministic without changing
production policy:

- The reader-inspection guard detaches by scrolling to the very top of history.
  A near-bottom offset could be undone by any later render:
  `HistoryViewport.resolve()` re-attaches FOLLOW once the clamped offset reaches
  the viewport maximum, so a small PTY tail chunk delivered while the command
  still ran flipped the viewport back to FOLLOW and the completion decision
  correctly stopped holding the block open. At the top, the re-attach condition
  (`maximum = 0`) cannot be reached while the run holds more rows than the
  viewport height (the guard only scrolls past 30 rows).
- The queued composer lifecycle keeps its foreground (`sleep 1.5`) alive past
  the ownership look. The composer Enter is held while NMSh probes which
  program owns the terminal; the look gets an 800 ms budget
  (`OWNERSHIP_LOOK_MS`) before the held Enter is released. If that release
  landed only after the foreground ended, the replay routed as an idle
  submission instead of a queue entry; 1.5 s leaves roughly 700 ms of margin
  under load.
- Enqueue observability waits for both observables — the synchronous editor
  clear and the asynchronous `queueState` event — because the two can separate
  by a task tick under load. The wait stays bounded by the test's deadline.

`copyExactLive` teardown can time out its sandbox ownership scan (`lsof`, 2 s
per scan) on the loaded external volume. A timed-out scan is treated as "owners
not established"; disposal keeps polling inside its existing budget, and root
removal retries (`maxRetries: 5`). This is an environment-latency class, not a
product failure. A bash job-control race can also inject
`child setpgid (…): Operation not permitted` into command output under 4-way
load, breaking exact-byte copy comparisons in bash variants; it is classified
environmental and deliberately not filtered, because filtering it would weaken
the exact-output assertions.

## Selected surface root cause

The old shared band only reopened its background after exact SGR 0 resets.
Historical prompt segments explicitly set backgrounds and SGR 49; Powerline
connector foregrounds retained the old segment color. Those cells punched
through the band. Selection now uses the existing cell overlay after each cell's
own styles, blends connector foregrounds into the selected surface, preserves
readable semantic text and neutralizes inverse video during selected painting.
Unselected text, glyphs, widths, data, copy payloads and hit testing stay intact.
The cell evidence helper accounts for inverse video's displayed color swap.

## Automated evidence and independent review

Focused affected suites passed at concurrency 4 on the fixed tree: 182/182
including the real-PTY folding file (`runs/bash/notMyShell-bbb70309/20261017-164655-Jl0NjO`
with `NMSH_TEST_TMPDIR` on T7). The folding file then held across 13 consecutive
runs under the original 4-way load class — one quiet run (9/9) plus three waves
of four concurrent runs each (12/12) — `20261017-164758-8oAyYY`. `verify:fast`
passed before full verification. Canonical full release verification passed on
the final tree: build, 2877 tests / 2876 pass / 0 fail (1 skipped),
`git diff --check`, benchmark typecheck and timing smoke, exit 0 —
`20261017-170015-jS37Hi`. A first full run in the same environment produced the
same suite with one environmental disposal failure (`20261017-164959-dfGJNm`):
an unrelated Finder process briefly matched a live sandbox's process-ownership
scan, a transient false positive with no handle left behind. The rerun was fully
green and no production behavior was changed for it. Exact-commit CI is recorded
in the final handoff and external evidence manifest; do not infer physical
acceptance from CI.

One independent read-only review found seven issues, each reproduced RED before
its fix: below-minimum preview cleanup, explicit welcome restoration, inverse
selection colors, Custom flame labels, attach onboarding, hidden Manual save
errors and 16×6 controls. Their regression suite passed GREEN after the bounded
fix pass. Capture inspection also caught Recommended preserving an old Never
fold preference; explicit Recommended now selects Smart, with a lifecycle demo
regression. No review finding was intentionally deferred.

## Reproduce without touching real preferences

The reusable external runner defaults to focused tests; expensive release
verification is opt-in, never a pre-commit hook:

```sh
t7run --check
t7run bash /Volumes/T7Tmp/ai-dev/qa/post-v020-preferences-onboarding/run-qa.sh
# Explicit larger gate:
t7run bash /Volumes/T7Tmp/ai-dev/qa/post-v020-preferences-onboarding/run-qa.sh \
  /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/post-v020-preferences-onboarding release
# Production ANSI/cell/SVG/gallery evidence, no shell processes:
t7run bash /Volumes/T7Tmp/ai-dev/qa/post-v020-preferences-onboarding/run-qa.sh \
  /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/post-v020-preferences-onboarding captures
```

Logs/captures print their own external T7 directory. The gallery's R Replay
replays recorded states; in NMSh, R replays the full deterministic demonstration.
These captures use TerminalApp and production prompt, presenter, geometry,
motion and cursor components; the SVG viewer serializes their terminal cells.
They do not establish physical font/shader/keyboard or mouse correctness.

## Physical acceptance — Ghostty and Terminal.app

Use a disposable home/session, keeping all artifacts on the T7 drive. The
frontend runs from `dist/`, so build the branch first (`npm run build`; the
release verification does this automatically).

```sh
cd /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/post-v020-preferences-onboarding
t7run bash -c 'fixture=$(mktemp -d "$T7_STORAGE_ROOT/t/prefs-human-XXXXXX"); \
  mkdir -p "$fixture/home" "$fixture/config" "$fixture/runtime"; \
  chmod 700 "$fixture/runtime"; \
  HOME="$fixture/home" XDG_CONFIG_HOME="$fixture/config" \
  NMSH_RUNTIME_DIR="$fixture/runtime" NMSH_DISABLE_UPDATES=1 NMSH_SESSION_SERVICE=0 \
  node dist/index.js'
```

1. Fresh: intro lasts about 2.6 seconds. Any key skips only the intro. Select
   1/2/3 or ↑↓; R restarts typing, running output and completion. Switch focus
   mid-demo and resize to 32 columns, short heights and below 16×6: no stale
   animation, missing essential controls, background CPU loop or executed demo.
2. Minimal: 2, Left/Right/Tab to choose One-line/Two-line; Enter reviews,
   Enter applies. Expect immediate Flow composer, Normal output, no Vespyr or
   extra greeting. Restart using the same fixture paths: no intro/welcome.
   Attach/restore a session with a stored greeting: still no greeting.
3. `/setup` opens full Setup; `/setup prompt`, `/setup look`, `/setup motion`
   and `/setup cursor` remain direct. `/setup quick` does not play the intro.
   Review a preset, Esc: saved preferences remain unchanged. Manual errors must
   be visible and retain the draft. Docs/bug/feature actions need an explicit key.
4. Recommended: inspect requested defaults in `/settings`, `/theme`, `/motion`,
   `/transcript`, `/cursor` and `/queue settings`. Try colored flames and Custom;
   change theme, preserve custom stops. Ghostty native needs reviewed setup and
   host reload. Terminal.app uses Portable. Never expect hardware caret recolor.
5. Folding Test B: `/queue settings`; explicitly observe **Queued output display:
   Fold queued output**, then Esc (saves live). Run `sleep 5`; while it runs type
   `seq 1 450`, Enter. Stay at latest and avoid selecting. Expect head 1/2/3,
   **442 lines hidden**, tail 446–450. Ctrl+O expands; Ctrl+O collapses. `/copy`
   and `/cp` copy the complete output; `/copy ui` can preview/select/report it.
   Repeat while detached or drag-selecting: expanded retention is intentional.
   Repeat Inline and Never separately, including nonzero/interrupted queued work.
6. Select completed output by `/copy`, keyboard arrows and pointer. Inspect
   Lavender Native and another theme, Normal/Chat, folded/expanded, 32/50/80+
   columns, Nerd/Safe, truecolor/ANSI-16/NO_COLOR. Expect a continuous selected
   surface including wedges and inverse output, readable colors and unchanged
   click targets. Esc restores the draft/view; copy never acquires ANSI chrome.
7. If Test B fails, record host/shell versions, active config path, effective
   Queued output row, FOLLOW/DETACHED, active selection and exact key sequence.
   Do not assume the on-disk preference was active in the original session.

Linux Fish 3.7 input safety and physical GUI/shader interaction are separate
acceptance evidence. Local real-PTY tests use installed macOS shell versions;
report remote CI package versions separately when available.
