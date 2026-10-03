# v0.12 cumulative development acceptance

Development stack is unmerged and unreleased. Physical QA is intentionally deferred. The released package and lockfile remain **0.7.0**. No merges, tags, releases, history rewrites or lower-layer branch edits occurred.

## Resource and frozen-base verification

Initial free disk: 4,240,000 KiB (~4.04 GiB), above the user-authorized 1 GiB hard stop. No dependency restoration or generated media was required. Checks before/after suites remained above the threshold; latest pre-acceptance reading was 5,864,376 KiB (~5.59 GiB). No ENOSPC event occurred and no unrelated data was removed.

GitHub and fetched origin both verified PR #271 (`docs/v011-cumulative-acceptance`) at `4a5ef78968c6e4751ac977b39170514a4ec9e282`, open, non-draft, unmerged, mergeable, based on `feature/v011-shell-hardening`. Existing worktrees were inspected and left unchanged. `.serena/` is preserved as untracked user data.

## Milestone, findings and exact review order

[Milestone 12](https://github.com/raiseCatError/notMyShell/milestone/12): #78, #179, #180, #272, #274, #276. All remain open. #79 remains a compatibility reference and was not added. Project status updates were unavailable because the token lacks `read:project`; issue/PR activity and child `needs-human-test` labels provide tracking.

| Order | PR / branch | Exact implementation SHA | Base |
| --- | --- | --- | --- |
| Frozen | [#271](https://github.com/raiseCatError/notMyShell/pull/271) `docs/v011-cumulative-acceptance` | `4a5ef78968c6e4751ac977b39170514a4ec9e282` | v0.11 hardening |
| 1 | [#273](https://github.com/raiseCatError/notMyShell/pull/273) `feature/v012-chroma-treatments` | `71472b70b9e01b0a3822da09173ef3c8f9dd8d29` | #271 |
| 2 | [#275](https://github.com/raiseCatError/notMyShell/pull/275) `feature/v012-transient-effects` | `0815d909752552d16f5eb5480c2af2b563d900c9` | #273 |
| 3 | [#277](https://github.com/raiseCatError/notMyShell/pull/277) `feature/v012-presentation-hardening` | `45620a1f0a05e181b599b8ccbea4b8053b16735d` | #275 |
| 4 | Final acceptance `docs/v012-cumulative-acceptance` | See final PR head/commit metadata | #277 |

Review in this order without merging. No implementation layer depends on deferred physical QA to start later work in this milestone.

Research comments: [#78 architecture](https://github.com/raiseCatError/notMyShell/issues/78#issuecomment-5944765870), [#179 landscape](https://github.com/raiseCatError/notMyShell/issues/179#issuecomment-5944836863), [#180 frameworks](https://github.com/raiseCatError/notMyShell/issues/180#issuecomment-5944837102). Implementation children: [#272 treatments](https://github.com/raiseCatError/notMyShell/issues/272), [#274 effects/clock](https://github.com/raiseCatError/notMyShell/issues/274), [#276 hardening](https://github.com/raiseCatError/notMyShell/issues/276).

## Treatment architecture

`src/chroma/treatment.ts` samples owned plain graphemes/cells against explicit time and display-column position. It reuses Chroma color references/interpolation, Motion's waveform and existing capability/colorEscape logic. No sampler owns timers. `sampleTreatment` yields a cell foreground; `treatmentText` produces a styled projection without changing content or display width.

Independent axes:

- Preset: Off (default), Lavender (#A67CF3 and nearby purples), restrained Aurora, Chroma Theme, Custom.
- Geometry: Linear left-to-right, Center outward, Outside inward.
- Motion: Static, Travel (six-second cycle), Breathe (four-second cycle). Intensity blends against the ordinary surface foreground.

Eligibility roles are Native identity, divider, panel frame and effect. Status, focus, raw output and provider roles reject treatment. Representative integrations: Native Minimal/Outline identity modules (project/cwd/toolchain, excluding custom foreground overrides), static historical divider rules under Normal/Chat, Settings framing and the live composer rule across Bottom/Top/Flow. Filled prompts, selected rows, error/warning/success semantics and arbitrary provider-rendered content retain their established styling. No automatic animation of every surface.

Static treatments remain available with Reduced Motion or Effects Off. Reduced Motion also honors NMSH_REDUCED_MOTION and NMSH_DETERMINISTIC, freezes decorative phases and suppresses transients. Effects Off independently suppresses decorative movement/transients. Factual durations continue. Deterministic tests supply explicit timestamps/seed; no wall-clock randomness. Interactive deterministic sessions stay static.

Color downgrade remains truecolor → ANSI256 → ANSI16 → none through existing host capability detection. Explicit NMSH_COLOR overrides retain precedence. NO_COLOR preserves text and meaning. Safe glyphs and Unicode display widths remain supported.

## Scheduling, effects and restoration

`PresentationClock` is the single demand-driven frame owner shared by TerminalApp activity, #91 TaskProgress and welcome blink subscriptions. Motion and treatments consume time. Decorative frames run at 10 FPS maximum; welcome uses sparse deadlines; reduced task progress updates factual time at 1Hz. No subscriber means no scheduled timer. Shell/task timeout timers are resource deadlines, not animation clocks.

`/effects sparkles|rain [top|bottom]` is internal frontend behavior; `/effects stop` and Escape cancel. Triggers are user initiated, deterministic-seeded and replace the active effect. No event-triggered celebration is installed. At most 64 particles, three seconds, 512 columns × four rows of effect canvas; one active effect with no persisted particles. Placement selects the first/last eligible gap or decorative rule from ScreenPlan. No eligible region means cancellation. Full canvas/panel-side effects are deferred.

Ordinary shell execution, resize, passthrough/fullscreen, suspend, detach/stop and terminal write errors cancel effects. Underlying projected rows are retained and repainted from current state when the effect ends; raw content, editor source, journal, history, resume and copy data never receive overlay escapes. Terminal modes remain owned by existing handoff/renderer machinery. Animation ticks reuse cached rows: activity updates its own region, task progress updates its panel while geometry is stable, and decorations update only their regions. Geometry/state changes use the ordinary full render path.

## Settings and compatibility

Settings v2 exposes preset, Reduced Motion and Effects Off in Simple; geometry, motion and intensity are Advanced. Existing row order, changed markers and reset behavior are retained. `presentation` is an additive normalized object; missing values preserve the previous ordinary presentation. No schema version or destructive reset is required. Custom gradients use 2–8 validated `#RRGGBB` stops, entered through config JSON; the GUI selects an already valid Custom preset. Malformed/oversized lists safely disable Custom. Only declarative settings persist.

Config save preserves unknown object fields along the bounded normalized schema, including presentation fields, and flattens the legacy prompt wrapper to prevent stale provider/theme values shadowing current settings. No executable expressions or public plugin runtime was added.

## Research decisions

[Frontend landscape](../architecture/terminal-frontend-landscape-v012.md) compares Warp/Wave blocks and editor/widget ownership, Fish/Nushell/Xonsh shell semantics, tmux/Zellij/TUIOS multiplexing, prompt/history tools and modern terminal UI systems. NMSh remains a host-independent frontend over a real persistent shell, with owned composer, semantic transcript, optional providers, customization and resumption. It is not a terminal emulator, replacement shell language, multiplexer, IDE, cloud collaboration platform or agent manager.

[TUI primitive findings](../architecture/tui-primitives-v012.md) cover Bubble Tea, Lip Gloss, Bubbles, Huh, Glamour, OpenTUI, Ink, Ratatui and Textual. Borrow explicit lifecycle/messages, focus semantics, measured layouts, composition and diffing. Do not migrate frameworks. The only justified new primitive is the shared presentation clock already implemented in #274; no duplicate primitive child was manufactured.

## Performance and hardening

Run `node --import=tsx scripts/presentation-benchmarks.ts`. Local Node 26.8.1/macOS arm64 instrumented samples:

| Workload | Median / p95 ms |
| --- | --- |
| Static 40-cell prompt sampling | 0.029 / 0.067 |
| Animated 40-cell prompt sampling | 0.028 / 0.050 |
| Animated 120-cell divider | 0.061 / 0.123 |
| Cached effect + cell instrumentation, six layouts | 0.031–0.038 / 0.046–0.147 |
| Resize plan/effects at 20, 80, 320 columns | 0.030 / 0.043 |
| Fresh static 1,000-command transcript projection | 307.887 / 448.875 |

Cached effects changed one row, at most 46 particle cells in this fixture. Renderer work was 105 writes (100 samples plus five warmups), ~108 KiB total. Five timer wakeups in 550ms; zero subscribers and no scheduled timer afterward. Aggregate CPU per 100 instrumented effect frames was ~4.7–12ms. These are local computation measurements, not physical host or end-user CPU claims. A fresh transcript projection remains expensive; animation regressions assert no `wrapped()` scans for decorative, activity or stable task-panel frames.

Dedicated hardening fixed interrupt priority, motion settings propagation, welcome reconciliation, terminal error cleanup, absent-canvas cancellation, cached activity/panel frames, unknown config fields and legacy-wrapper migration. A focused independent safety review and recheck found no remaining important defect in the reviewed fixes. Lower published branches were untouched.

## Automated evidence and remaining limits

Treatment: 851/851 full tests. Effects: 856/856. Hardening: 858/858, plus focused lifecycle/deterministic/session tests. Build, typecheck and diff-check passed. Benchmark typing passed with `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --strict --skipLibCheck scripts/benchmarks.ts scripts/presentation-benchmarks.ts` (TypeScript 7 requires explicit command-line configuration and Node types).

[Node 22/26 treatment CI](https://github.com/raiseCatError/notMyShell/actions/runs/36958741727) and [effects CI](https://github.com/raiseCatError/notMyShell/actions/runs/36959202103) passed. [Hardening CI](https://github.com/raiseCatError/notMyShell/actions/runs/36960106299) also passed on Node 22/26. Final acceptance CI is recorded in final PR evidence after completion.

Failures were recorded and diagnosed: initial inherited NO_COLOR/override conflicts; Settings row ordering regression; legacy-wrapper shadowing; a canonical stty fixture completion/echo race; missing import and test-fixture API errors during focused development. The final fixture waits for persisted baseline completion. One local acceptance run stalled in the sticky-header worker with a live zsh child. The owned runner was terminated; the same file passed 13/13 in isolation. A cumulative rerun uses a 60-second per-test timeout. The stall was not reproduced and no product cause is asserted. No failure was silently retried without explanation.

Final cumulative run: 858/858 with zero failures, cancellations or skipped tests. Build/typecheck/diff-check and benchmark typing passed. After completion, no NMSh helper processes, private test roots or semantic/zsh/capture/completion temp roots remained. The private-root runner reports lifecycle leftovers before cleanup. Presentation cleanup tests finish with zero clock subscribers and no scheduled timer. Existing unrelated replay temp directories and `.serena/` were retained. No dependency restore or large media generation occurred.

Limits: Native modules and panel/history treatment are static; animated treatment currently targets the live rule. Filled prompt styles retain their prior rendering. Custom stops require config editing. Effects use only gaps/rules, fixed seed and two placements; no full-canvas, automatic triggers or effect palette editor. Fresh large-transcript projection cost remains a baseline limitation. No accessibility or physical animation-quality claim is made.

Physical QA: [v0.12-only checklist](v012-physical-qa.md), Ghostty primary and Terminal.app fallback. No new host installation is required. Research parents and milestone remain open. v0.13, multi-shell/platform work and a large public plugin API are deferred.
