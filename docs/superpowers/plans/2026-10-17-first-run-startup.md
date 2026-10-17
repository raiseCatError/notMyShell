# First-run starting points (reactive Horizon) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved reactive Horizon selector with four starting points, Keep Existing detection, Vespyr compositing and the ending into the real terminal.

**Architecture:** The selector stays Setup Cat's quick state (one draft, one Apply) with a new renderer in `src/setup/startup/`; the sky is the real Aurora engine with palette moods; the ending is a presentation stage in `TerminalApp.paintPresentation`; Keep Existing is a read-only detector plus a draft builder.

**Tech Stack:** TypeScript (NodeNext, strict), node:test via `scripts/test.mjs`, tsx, the existing `CellGrid`/`renderScene`/`TerminalRenderer`.

**Spec:** [docs/design/first-run-startup.md](../../design/first-run-startup.md)

## Global Constraints

- Scratch, test temp roots and captures on the T7: `t7run …` with `NMSH_TEST_TMPDIR=$T7_STORAGE_ROOT`; never `/tmp`.
- No merge, tag, release, version bump or Slice 4 work. Push only `feature/post-v020-preferences-onboarding`.
- `/startup` exact-match only; no `/preset`; `/presets` and `nmsh --preset` unchanged.
- Nothing applies on highlight; Leave applies nothing; Stay is the default.
- Explicit saved preferences survive normalization; only missing fields take defaults.
- One Aurora engine (`renderScene('aurora')`); one clock per surface; no timers after close.
- Commits carry no AI attribution; stage explicit paths only (the worktree's `node_modules` is an untracked symlink).

## Review Focus

- Keys arriving while the ending runs: the first key finishes the ending and is delivered to the real composer exactly once (test in Task 8).
- Resizing during the selector or the ending: no stale cached ground rows, no rows past the screen (tests in Tasks 6 and 8).
- A first run whose config save fails: the selector keeps its draft, shows the error, and no ending or welcome starts (test in Task 7).
- Startup files that are huge, unreadable, symlinked outside `$HOME` or contain `source` loops: bounded reads, no traversal, no hang (tests in Task 5).
- Reopening `/startup` after a Recommended first run: no second welcome, receipt only (test in Task 8).

---

### Task 1: Requested defaults

**Files:** Modify `src/prompt/configuration.ts`, `src/setup/SetupCat.ts` (cursor intro copy); Test `tests/postV020Preferences.test.ts`

- [x] Write failing assertions: `DEFAULT_PROMPT_CONFIGURATION.cursor.effect === 'none'`; `fireColorChoice({...DEFAULT_PROMPT_CONFIGURATION.cursor, effect: 'fire'}) === 'classic'`; `minimalPromptConfiguration().composerLayout === 'twoLine'`; `createQuickSetup(fresh).quick.layout === 'twoLine'`; a saved `{cursor: {effect: 'fire', particles: {source: 'theme'}}}` normalizes unchanged.
- [x] Run `t7run bash -c 'NMSH_TEST_TMPDIR=$T7_STORAGE_ROOT node scripts/test.mjs tests/postV020Preferences.test.ts'` → FAIL.
- [x] Set the defaults (cursor `{...DEFAULT_CURSOR, color: {source: 'theme'}}`; minimal default `'twoLine'`; quick layout default `'twoLine'`).
- [x] Run → PASS; commit `feat: Minimal starts Two-line, cursor effects start Off, Fire starts Classic`.

### Task 2: Pixel compositing and Vespyr

**Files:** Modify `src/idle/CellGrid.ts`, `src/idle/catSprite.ts`; Test `tests/vespyrCompositing.test.ts`

**Interfaces — Produces:** `CellGrid.halves(x, y): [upper: number, lower: number]`; `CellGrid.compositePixels(x, y, upper?: number, lower?: number): void`; `CellGrid.stamp(x, y, glyph: string, fg: number): void` (background = mean of the halves, or transparent); `compositeCat(grid, x, y, pose: CatPose, facingRight: boolean): void`.

- [x] Tests: `cells outside the silhouette keep their exact glyph, fg and bg over an aurora frame`; `a half-covered cell keeps the uncovered half's exact color`; `over no background, empty halves stay transparent and emit no 48; escape`; `whisker background is the mean of the pixels it covers`; `compositing over successive aurora frames leaves no ghost of the previous frame`.
- [x] Run → FAIL; implement; run → PASS; commit `fix: composite Vespyr pixel by pixel so no background rectangle remains`.

### Task 3: Aurora moods and the sky band

**Files:** Create `src/idle/auroraMoods.ts`, `src/setup/startup/sky.ts`; Test `tests/startupSky.test.ts`

**Interfaces — Produces:** `type SkyMood = 'aurora' | 'calm' | 'spectrum' | 'out'`; `skyStops(config): Rgb[]`; `moodPalette(mood, config, backdrop: 'aurora' | 'subtle'): IdlePalette`; `blendPalettes(a, b, t): IdlePalette`; `MOOD_SPEED: Record<SkyMood, number>`; `CROSSFADE_MS = 700`; `renderSkyBand(grid: CellGrid, input: SkyBandInput): {rows: string[]; horizon: string}` where `SkyBandInput = {width; height; now; started; mood; previousMood; changedAt; backdrop; reduced; config; cat?: {x: number; pose: CatPose}}`; `skyFrameMs(input): number` (0 still, 40 cross-fade, 200 aurora, 320 subtle).

- [x] Tests: `each mood draws through renderScene and differs from the others`; `cross-fade at 0, 350 and 700 ms moves monotonically from the old palette to the new one`; `out draws no sky rows after the fade but keeps the horizon`; `subtle is dimmer than aurora`; `reduced motion renders the same frame at any time`; `backdrop off returns no sky and a separator hairline`; `skyFrameMs is 40 during a cross-fade, 200/320 at rest, 0 when still`.
- [x] Run → FAIL; implement; run → PASS; commit `feat: Aurora moods and the starting-point sky band on the real engine`.

### Task 4: Starting points and the selector state machine

**Files:** Create `src/setup/startup/startingPoints.ts`; Modify `src/setup/SetupCat.ts`, `src/prompt/configuration.ts` (`startingPoint`), `src/configuration/portability.ts`; Test `tests/startupSelector.test.ts`

**Interfaces — Produces:** `STARTING_POINTS = ['recommended', 'minimal', 'customize', 'existing'] as const`; `STARTING_POINT_COPY`; `startingPointDraft(id, saved, options: {layout; keep?: KeepAnswer; evidence?}): PromptConfiguration`; `setupKey(state, key, now = Date.now())`; `SetupResult` apply gains `startingPoint: StartingPointId`; `PromptConfiguration.startingPoint?: StartingPointId` (normalized, never exported).

- [x] Tests: `four choices in order`; `↑↓ wrap and 1–4 jump, stamping changedAt and previousChoice`; `highlight changes only the draft`; `Minimal toggles Two-line and One-line on the draft`; `Enter reviews; Esc from review returns to the choices`; `Esc from the choices opens Leave setup? with Stay focused; Leave cancels; Stay returns`; `A cycles aurora → subtle → off and reports a backdrop result`; `Customize opens the guided setup from saved and Esc returns`; `Apply carries onboardingComplete, startingPoint and the draft`.
- [x] Run → FAIL; implement; run → PASS; commit `feat: four starting points with review, back and Stay-first leave`.

### Task 5: Keep Existing detection and draft

**Files:** Create `src/setup/environment/detect.ts`, `src/setup/environment/keepExisting.ts`; Modify `src/prompt/starship.ts`; Tests `tests/environmentDetection.test.ts`, `tests/keepExisting.test.ts`

**Interfaces — Produces:** `detectEnvironment(options?: {env?; home?; probe?: ProviderProbe}): Promise<EnvironmentEvidence>`; `scanStartupFiles(shell, home, env, read: (path) => string | undefined): StartupScan`; `IntegrationState = 'active' | 'configured' | 'installed' | 'broken'`; `keepExistingPlan(evidence, saved): KeepPlan` (`{found; question?: {kind: 'several' | 'none'; options}; noop: boolean}`); `keepExistingDraft(saved, evidence, answer: number, redetect: boolean): PromptConfiguration`.

- [x] Tests (fixture homes under the test temp root): one active Starship → kept; Starship and p10k both started → question `several`; custom `PROMPT=` → question `none` with Composer only first; configured-not-started Starship offered by name; started-but-missing binary is `broken`; Fish `functions/fish_prompt.fish` is custom; `source` loops, outside-home targets and >512 KiB files are bounded; detection never writes (directory snapshot equal before/after); configured install → `noop` unless redetect; draft keeps Theme Bridge, sets Grayscale chrome, effects off, welcome none, Flow, provider as answered; Starship two-line output drops a trailing lone prompt character, keeps single-line output intact.
- [x] Run → FAIL; implement; run → PASS; commit `feat: Keep Existing reads the environment read-only and keeps what it finds`.

### Task 6: The Horizon renderer

**Files:** Create `src/setup/startup/view.ts`; Modify `src/setup/SetupCat.ts` (`renderSetup(state, columns, height, now = Date.now())` routes quick to `renderStartup`); Test `tests/startupRender.test.ts`

**Interfaces — Consumes:** Tasks 3–5. **Produces:** `renderStartup(state, columns, height, now, context: StartupContext): string[]`; `startupLayout(columns, height, backdrop): {skyHeight; twoColumn; tier: 'full' | 'accordion' | 'tiny'}`; `StartupContext = {sky: CellGrid; started: number; reopened: boolean; preview: (config, width) => string[]}`.

- [x] Tests: all four titles at 200×50, 130×38, 96×30, 80×24, 60×20, 40×14, 16×6 inside bounds; the highlighted choice's row holds the notch and wedge glyphs; the horizon row is `▔` and not inside the sky rows; Keep Existing shows `read-only` evidence; the leave sheet dims ground rows and leaves sky rows byte-identical; NO_COLOR uses reverse video and paints no 48; codes; Safe glyphs use ASCII ends; ground rows are reused from cache across frames until state or size changes.
- [x] Run → FAIL; implement; run → PASS; commit `feat: the reactive Horizon selector`.

### Task 7: App integration

**Files:** Modify `src/app/TerminalApp.ts`, `src/ui/SettingsPanel.ts`, `src/commands/slashCommands.ts`, `src/help/helpContent.ts`, `src/setup/SetupCat.ts` (route rows); Test `tests/startupApp.test.ts`

- [x] Tests (frame fixture): `/startup` parses to the quick entry and opens the same state as `/setup quick`; Settings row *Starting point* opens it; `onboardingBackdrop` row exists and `A` persists the level; the sky clock repaints only the panel and stops on close, on manual, after 60 s idle and under Reduced Motion; evidence loads once per open without blocking keys; a failed save keeps the selector and its draft with the error and starts no ending.
- [x] Run → FAIL; implement; run → PASS; commit `feat: open the selector with /startup and keep its sky on one bounded clock`.

### Task 8: The ending and the welcome

**Files:** Create `src/setup/startup/ending.ts`, `src/output/FirstRunWelcome.ts`; Modify `src/output/OutputBuffer.ts`, `src/output/TranscriptPresenter.ts`, `src/app/TerminalApp.ts`; Test `tests/startupEnding.test.ts`

**Interfaces — Produces:** `StartupEnding = {start; skyHeight; mood; palette; groundRows: string[]; composerFrom: number; welcome: boolean}`; `ENDING_MS = 880`; `paintStartupEnding(rows, plan, columns, now, ending, sky): {rows; caretVisible; done}`; `FirstRunSnapshot = {version: 1}`; `OutputBuffer.setFirstRunWelcome(snapshot)`; presenter rows carry `firstRunLine?: number`.

- [x] Tests: frames at 0, 120, 300, 520, 700, 880 ms show ground fading then gone, sky height non-increasing then a single rule then nothing, composer rows offset non-increasing to 0, caret hidden until done; a key at 300 ms finishes the ending and types into the composer once; resize finishes it; Reduced Motion produces the final frame on Apply; first run + Recommended adds the welcome once and `/startup` → Recommended adds only a receipt; Minimal and Keep Existing add one receipt and no welcome; no clock remains after 880 ms.
- [x] Run → FAIL; implement; run → PASS; commit `feat: Apply folds the sky and raises the real composer into the transcript`. (As built, `StartupEnding` also carries the size it was planned for, the sky timing, `catX` and `welcomeLines`; no clock remains once the ending, including a first-run welcome, has finished.)

### Task 8b: One-time window maximization (macOS and Linux)

Added 2026-10-18 by the maintainer, with Linux and Omarchy/Hyprland addenda. Portable onboarding comes first: the
selector, sky, Vespyr, keys, compact layouts and the ending never depend on this, and no platform automation enters
shared onboarding or rendering code.

**Files:** Create `src/host/window/` (capability, routing, Terminal.app, Kitty and Hyprland adapters, first-run
session); Modify `src/setup/startup/view.ts` (the offer line), `src/setup/SetupCat.ts` (M/K keys), `src/app/TerminalApp.ts`
(offer, maximize, restore after the ending, on Leave and on exit); Tests `tests/hostWindow.test.ts`, `tests/startupWindow.test.ts`.

- Offer only on the genuine first-ever run (`state.onboarding`), never on `/startup`, never automatically: "Use more
  screen space for setup?" with **M** Maximize for setup and **K** Keep current size. Process memory only; no
  preference, no host, compositor or terminal configuration is ever written.
- Outcomes are explicit: available · unsupported · permission denied · uncertain identity · already maximized ·
  fullscreen · failed. Anything but *available* means no offer and onboarding continues untouched.
- Exact ownership or nothing: SSH, tmux/screen and nested or remote frontends are unsupported; a host name or a
  compositor variable alone never proves ownership. Never a blind toggle: the prior state is read first.
- macOS Terminal.app: AppleScript/JXA over the window whose tab tty is this frontend's tty; `zoomed` and bounds read
  first; native fullscreen detected from the screen frame and left alone.
- macOS Kitty: remote control over `KITTY_LISTEN_ON` only (never the in-band TTY NMSh reads); the OS window of
  `KITTY_WINDOW_ID`, its state from its CoreGraphics bounds against the screen's visible frame; toggles only from a
  verified unmaximized state. Refused or unconfigured remote control: unsupported, Kitty's security is not changed.
- macOS Ghostty: unsupported (no geometry in its AppleScript; `toggle_maximize` has no effect on macOS).
- Linux Hyprland (Omarchy and others; Foot, Ghostty, Kitty, Alacritty alike): `hyprctl` IPC, version-checked; the one
  client whose pid is an ancestor of this frontend (several windows of one process: uncertain); maximized state
  (`fullscreenstate 1`), never fullscreen; tiled/floating and workspace kept; restore only from the state NMSh left,
  deferred until the window is active again rather than moving focus.
- Other Linux (X11 without a verified dependency-free mechanism, GNOME/KDE Wayland), Windows Terminal, WSL, Zed,
  VS Code: unsupported, silently. No xdotool, wmctrl, ydotool or keyboard injection.
- Restore after the ending finishes (one resize, never during the Aurora transitions), at once on Leave, best effort
  on exit; never when the user moved, resized, unmaximized or fullscreened the window in the meantime.
- [x] Tests with fake runners: first run vs later runs and `/startup`; accept and decline; already maximized and
  fullscreen; restore; Leave and exit; permission failures; several windows and monitors; manual changes; unsupported
  hosts; Kitty restrictions; Hyprland versions, tiled/floating, focus moved, IPC missing; no configuration writes.
  (`tests/hostWindow.test.ts`, `tests/startupWindow.test.ts`; a real `/proc` pty test runs on Linux CI.)
- [x] Physical QA checklist for Ghostty, Kitty and Terminal.app on macOS and Foot, Ghostty, Kitty and Alacritty on
  Omarchy; mocked tests are not claimed as real window behavior (`docs/testing/first-run-window-maximization.md`).
- As built: Hyprland is used only on 0.55+ with a Lua configuration, whose `hl.dsp.window.fullscreen` names the
  window; 0.52–0.54 and hyprlang configurations maximize only the focused window (and `focuswindow` warps the
  pointer), so they are unsupported. Omarchy's current configuration is Lua.

### Task 9: The guided setup in the Horizon language

**Files:** Modify `src/setup/SetupCat.ts` (manual render chrome); Tests `tests/setupCat.test.ts` (updated expectations), `tests/startupRender.test.ts`

- [x] Tests: the guided setup shows a sky ribbon (when roomy), a route of steps with the current step as a segment, *Step N of M*, the selected row as a segment with `‹ value ›`, keycap footer; every existing row, chooser, preview, tool browser and cursor panel behavior still passes. (`tests/guidedSetup.test.ts`; existing suites updated only where the chrome's text changed.)
- [x] Run → FAIL; implement; run → PASS; commit `feat: the guided setup speaks the selector's visual language`.
- As built (`src/setup/startup/guided.ts`): the ribbon is a still frame of the real engine in Customize's mood, shown only
  when the step fills most of the screen (the panel then takes the full height, so the sky is always at the top); short
  steps keep a content-height panel, so the NMSh panel position still shows where panels sit. Two columns from 96
  columns when there is a preview (the left as wide as its rows, 40–60), the preview rendered for its column; the step's
  intro spans the width and its facts follow at full width. Footer keys shorten one at a time, least needed first.

### Task 10: Benchmarks and captures

**Files:** Create `scripts/startup-benchmarks.ts`, `scripts/dev/startup-captures.ts`; Modify `package.json` (`typecheck:bench`)

- [x] `t7run node --import=tsx scripts/startup-benchmarks.ts` prints median ms and KB/s at 100×30, 130×38, 200×55 for each mood; production captures (ANSI, SVG, VHS PNG/MP4 of the built app in a disposable T7 home) and side-by-side comparisons with the archived references; commit `test: startup benchmarks and production captures`. (Results in the design's Performance section; captures with `scripts/dev/startup-captures.ts DIR --stills --built`, each built still its own fresh first run, since VHS's frame rate is not uniform.)

### Task 11: Documentation and verification

**Files:** Modify `docs/design/post-v020-preferences-onboarding.md`, `docs/testing/post-v020-preferences-onboarding.md`, `README.md`, `docs/design/first-run-startup.md`

- [ ] Update docs (selected direction vs preserved alternatives, `/startup`, Keep Existing limits, Ghostty checklist); run `npm run verify:release` through `t7run` with T7 temp roots; review the diff; commit `docs: first-run starting points`; push; dispatch exact-head CI.
