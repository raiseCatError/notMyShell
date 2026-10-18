---
title: "First-run behavior and validation"
description: "Canonical first-run behavior and validation from the v0.20.0 published source."
group: Technical reference
order: 121
source: "docs/testing/post-v020-preferences-onboarding.md"
---

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

Fresh onboarding opens the Reactive Horizon starting point (specified in
[first-run startup](../design/first-run-startup.md); the static centered modal
it replaces is archived): four choices under the real Aurora engine, whose mood
follows the highlight with a 700 ms cross-fade, Vespyr composited pixel by pixel
on the horizon, review before Apply and *Leave setup?* with Stay first.
`onboardingBackdrop` (aurora/subtle/off) is saved at once with `A`. `introSeen`
is separate from completion: fresh False, legacy missing True, persisted before
the selector displays, so leaving does not replay it next launch. Attach and
explicit setup routes bypass installation onboarding. A failed save keeps the
draft and displays the error. Customize Everything opens the guided setup (in
the selector's visual language) over the saved configuration; leaving it without
changes returns to the choices. Keep Existing reads the environment read-only.
Apply folds the sky into the real transcript and composer; a genuine first run
adds Vespyr's block and the first-run welcome once, whichever starting point it
chose (Minimal keeps no welcome on later launches); every later Apply adds one
receipt line. `/startup`, `/setup quick` and Settings → Starting point reopen the
selector; `/setup` opens the guided setup directly. Custom fire gradients and
explicit Reduced Motion survive. The one-time window offer and its checklists:
[first-run window maximization](first-run-window-maximization.md).

Setup Cat keeps one fixed frame: the header and step navigation stay put, rows
start on the same line on every step and scroll with the selection visible, the
keys sit on the last row, and the composer position never moves it. Editors it
cannot embed open over it; Esc comes back to the same step, row and unapplied
draft. Color editors opened from Setup write into its draft, nothing is saved
until Apply.

Tools: one panel and installer everywhere (`/tools`, Settings → Tools, the
guided setup, and the review's Tools line in `/startup`, changed with T).
Recommended is ripgrep, fd, fzf, jq, bat, zoxide and tealdeer; Fastfetch stays a
supported welcome provider without a tier. V cycles the view (Recommended →
Recommended + Enhanced → All curated tools; Recommended + Enhanced by default)
and never changes the selection. Keys act only outside search (`/` focuses it):
Space selects one, R adds the missing Recommended tools, E the missing
Recommended + Enhanced ones, C clears; Enter reviews the exact commands of every
selected tool, then one confirmation (No first; green Yes, install; red Yes,
uninstall) → per-tool results. `/startup` Recommended defaults to Review and
install Recommended + Enhanced: the view's verified missing tools are ticked
after the ending; Minimal and Keep Existing default to Skip. Status words carry
selection (✓ Selected); the band is the cursor only. A check that fails or does
not finish is *Unable to verify*, never Missing, and is never selected or
installed. Installing zoxide, fzf or Atuin does not turn on their shell hooks.

Custom colors: choosing Custom opens its editor at once (Setup and Settings).
The shared gradient editor offers Lavender, Purple, Blue, Cyan, Teal, Green,
Amber, Orange, Rose and White with P, a live preview bar, each stop's hex
(Enter edits it), S to apply and Esc to cancel. The cursor idle effect has its
own color: Follow cursor effect (the default, exactly as before), Follow theme,
a preset or Custom.

Updates: with Notify, a newer stable release shows one amber notice in the
transcript, once per version: both versions, two lines of notes, and the way to
update this installation (brew commands for Homebrew, `/update` for a verified
checkout, the release page otherwise; no install scripts). Automatic shows the
same notice when it cannot update this installation itself. Off checks nothing.

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

## Composer history while commands run

Physical QA on this branch found that ↑/↓ stopped recalling command history while
any command executed. The recall path had used the run state itself as the gate,
but execution is not input ownership: a command that reads nothing leaves the
composer — and its history — untouched. Recall is now decided by one predicate,
`composerHistoryEligible`: an explicit queued-entry edit, a passthrough program or
an external passthrough keeps the keys entirely; explicit Ctrl+Q queue-compose and
an idle composer always recall; a running command recalls exactly when no direct
reader (hidden line or single key) and no line-waiting state owns input. The
direct-reader and line-waiting checks are defense in depth — those keys are routed
to the program earlier in key handling. A shell switch (`/shell bash`) resets the
navigation so an arrow afterwards steps the new shell's history, never the old
shell's snapshot; the editor draft is untouched. Anything recalled reaches the
queue only through an explicit Enter. Evidence: 18 app-level key-routing cases
(`composerHistoryRunning`) plus real zsh/Bash/Fish PTY regressions in
`commandQueueLive`.

The live sandbox now isolates `XDG_DATA_HOME` like `HOME`. An ambient value (this
machine's environment sets one) pointed every Fish sandbox at one shared
`fish_history`; imported entries from earlier runs made the new Fish regression
order-dependent — a stale `echo QUEUED-NEXT` entry satisfied the "recorded by the
provider" filter for a freshly enqueued submission, so the first ↑ recalled the
queue entry instead of the executed command. With the sandbox value pinned to its
own home, the import is hermetic.

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

The static-onboarding correction was verified on its own tree: affected setup
suites 68/68 (`postV020Onboarding`, `postV020Preferences`, `setupQuickPreview`,
`setupCat`) and the wider eleven-file onboarding/chroma set 147/147, then
canonical full release verification passed — build, 2912 tests / 2911 pass /
0 fail (1 skipped), `git diff --check`, benchmark typecheck and timing smoke,
exit 0 — `20261017-194626-Mr0fg4`. Renderer-level captures for 16×6 TINY
through 200×50 (mutation states plus backdrop off/subtle at 80×24) are in the
external QA `onboarding-captures/` directory beside `run-qa.sh`: all frames
are byte-identical across renders and every capture stays inside its bounds.
The R-replay/`renderSetupIntro` engine remains tested but unreachable from the
quick path. Physical Ghostty/Terminal.app validation of the modal is pending.

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
replays recorded states of the retained selector engine; the quick setup modal
itself is static and has no replay affordance.
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

1. Fresh: the starting point appears with the aurora moving above the horizon
   and Vespyr standing on it (no rectangle behind the cat). ↑↓ and 1–4 move
   the highlight; the sky's mood follows it (aurora, calm, spectrum, out) in a
   short cross-fade with no flash, however fast you press. A cycles Aurora on,
   Subtle and Off, and a restart keeps it; after a minute without keys the sky
   holds still and the next key resumes it. Esc opens *Leave setup?* with Stay
   focused; Leave applies nothing and says so in one line. Resize through 125,
   96, 61 and 40 columns and down to 16×6: two columns, the accordion, the plain
   list, with every choice, Apply and Leave reachable. With Reduced Motion,
   Effects Off, NO_COLOR and 16 colors the sky is still or absent.
2. Recommended, Enter, Enter: the sky folds up into one fading rule, the real
   composer rises into place (the caret appears once it lands), and the
   first-run welcome arrives line by line under Vespyr's block. A key during
   the ending finishes it and types once. Restart with the same fixture: no
   selector, no second welcome. Minimal: Two-line by default, ←→ One-line, one
   receipt line, Flow composer, no greeting. Keep Existing on a machine with
   Starship started by `~/.zshrc`: it is kept, the receipt names it, and no file
   outside NMSh's configuration changes (compare timestamps before and after).
3. `/startup`, `/setup quick` and Settings → Starting point reopen the selector
   at the current starting point; applying it again adds only a receipt.
   Customize Everything opens the guided setup in the selector's language
   (route of steps, *Step N of M*, the selected row as a segment, keycaps; the
   live preview beside the rows from 96 columns); Esc there returns to the
   choices without closing setup. `/setup` opens the guided setup directly;
   `/setup prompt`, `/setup look`, `/setup motion` and `/setup cursor` remain
   direct. Manual errors stay visible and keep the draft. On Terminal.app and
   kitty the first run may also offer to maximize the window: follow
   [its checklist](first-run-window-maximization.md).
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
8. Composer history while a command runs (the queued-execution regression).
   Run `echo RECALL-ONE` then `echo RECALL-TWO`. Start `sleep 30`; while it
   runs, type `echo QUEUED-NEXT` and Enter — it queues (the queue row counts
   it). Type `echo DRAFT-KEEP`, then ↑: the composer shows `echo RECALL-TWO`,
   ↑ again `echo RECALL-ONE`; ↓ walks back and finally restores
   `echo DRAFT-KEEP` exactly at its original caret. Navigation alone never
   runs or queues anything. Ctrl+U then ↑ recalls freshly; Enter queues it.
   `/queue` still owns ↑/↓ for its list, and editing a queued entry keeps
   ↑/↓ in that entry's draft. With a program waiting for a line (`read`,
   `sudo`) or a full-screen app (`vim`, `less`), arrows belong to the program;
   Ctrl+Q while it waits composes a queue entry whose ↑/↓ recall history.
   `/shell bash` and then ↑ starts navigation fresh in the new shell while the
   typed draft survives.

Linux Fish 3.7 input safety and physical GUI/shader interaction are separate
acceptance evidence. Local real-PTY tests use installed macOS shell versions;
report remote CI package versions separately when available.
