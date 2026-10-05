# Context Engine first proof — uncommitted review handoff

## Git state

- Approved Tools checkpoint, committed and normally pushed: `6adfe8524da79f071de886f5a3f97bd49074bc60` (`fix(tools): use semantic selection surface for queued rows`). Focused Tools tests and build passed before commit.
- Review branch: `feature/305-context-engine`.
- Exact base and unchanged HEAD: `6adfe8524da79f071de886f5a3f97bd49074bc60`.
- Context Engine changes are uncommitted and unpushed. No merge, release, tag, version bump, media regeneration or showreel worktree change.

## Durable tracking

[#305 roadmap/checklist](https://github.com/raiseCatError/notMyShell/issues/305#issuecomment-5990398500) marks the shared-discovery foundation and Tools checkpoint complete.

| Issue | Boundary |
|---|---|
| [#316](https://github.com/raiseCatError/notMyShell/issues/316) | Capability kernel, fact model and module contract |
| [#317](https://github.com/raiseCatError/notMyShell/issues/317) | Surface Router and Context Rail |
| [#318](https://github.com/raiseCatError/notMyShell/issues/318) | Declarative format, registry, recommendation and integrity |
| [#319](https://github.com/raiseCatError/notMyShell/issues/319) | First-party project/runtime catalog |
| [#320](https://github.com/raiseCatError/notMyShell/issues/320) | DevOps/cloud/shell/agent context |
| [#321](https://github.com/raiseCatError/notMyShell/issues/321) | Security/performance/hostile workspace/physical QA |

Each includes goal, architecture boundary, non-goals, dependencies, security, acceptance and deferred work. All remain open; this tree is not an accepted checkpoint.

## Architecture and migration

The canonical design is [context-engine.md](../design/context-engine.md); continuation rules and the issue checkpoint template are in [context-engine-agent-protocol.md](context-engine-agent-protocol.md). AGENTS.md adds only a short pointer.

Already-resolved legacy PromptContext values adapt to typed `ContextFact<T>` / `ContextFacts`. Metadata includes capability/evidence provenance, timestamp/freshness, trust, sensitivity, persistence and cheap/bounded-async resolution. Named `ContextCapabilityId` operations belong to core; these are not arbitrary commands. The adapter is evolutionary, not a wholesale collector rewrite. Unknown legacy freshness remains unknown.

The existing registry gains `ContextModuleDefinition`: category, declared facts/capabilities, demand, priority, supported/preferred surfaces, semantic icon policy and compact/drop behavior. Rendering projects only allowed declared facts into the existing module switch. `routeModule` is pure policy. `ContextSurface`, `ModuleSurface` and `ContextRailSettings` represent placement and bounded presentation.

No surface field preserves legacy left/right placement. Explicit Auto is opt-in. Main Prompt, Right Context, Rail and Hidden work; Status Strip is designed but not a selectable dead setting. Existing defaults remain in Main/Right. Default Rail Auto/one row therefore occupies no space until a user routes content there. No version bump or new dependencies.

Rail uses existing semantic themes, segment painter and style profiles. `/prompt` adds a Context Rail view with Mode, Rows, Follow Main/Choose theme, Follow Main/Soft/Minimal/Compact, and Priority overflow. Modules keep P for legacy sides and gain S for surfaces. Highest-priority groups fit first; padding compacts and lower-priority groups drop. Rows never exceed configured one/two. Show-on-command uses current editor words and already-cached facts; demand occurs outside render.

ScreenPlan owns Rail geometry, cursor/hit testing, viewport and PTY capacity. Bottom attaches above the composer; Top below its group. Flow attaches above and normally consumes view rows. The accepted empty/short Flow exception moves the composer only by missing visible group height, then resumes normal anchoring as transcript grows. The presentation refinement includes explicit gaps/outer edge in that height; content remains bounded to one/two rows. Detached clipping preserves PTY capacity. Fullscreen/raw passthrough and panel/idle takeover hide frontend Rail.

Rail is never PTY output or wholesale transcript state. Native snapshots filter fact policy; live updates retain sensitivity/persistence. External-provider snapshot segments lack provenance and fail closed when any fact is snapshot-denied. Existing ordinary snapshots stay compatible.

## Files changed

- Docs: AGENTS.md; docs/design/context-engine.md; docs/development/context-engine-agent-protocol.md; this handoff.
- Core: src/context/facts.ts; src/context/surfaceRouter.ts; src/context/trustedServices.ts.
- Prompt: src/prompt/configuration.ts; prompt.ts; commandContext.ts; PromptPanel.ts.
- Integration: src/app/TerminalApp.ts; screenPlan.ts; src/shell/ShellContext.ts; src/ui/LayoutPanel.ts.
- Tests: tests/contextEngine.test.ts; promptProviders.test.ts; rightMirror.test.ts. The latter two update footer wording assertions for the new S surface control. Follow-up investigation adds failure diagnostics in tests/helpers/liveFrontend.ts and tests/nativeCaptureLifecycle.test.ts and regression coverage in tests/tmpdirHygiene.test.ts. Product behavior/deadlines are unchanged; deterministic test-only cleanup fixes are described below.
- Manual QA: docs/development/context-rail-manual-qa.md, with dedicated isolated presets and expected physical behavior.

## Security evidence and limits

Central display handling bounds input before width work and neutralizes C0/C1, ANSI introducers, bidi overrides/isolates and line controls. Secret/never-store facts cannot display or enter prompt snapshots; display-only facts cannot enter snapshots. Raw PTY output remains raw.

Trusted Git uses a known host installation, exact contextual argv allowlist, narrow environment, hooks/fsmonitor overrides, timeout/output bounds, no lazy fetching and no submodule inspection. Status fails closed on filters/includes/worktree-config/partial-clone/promisor configuration. This intentionally loses Rich Git status detail in those repositories while retaining safe branch/root discovery. Wider support needs a separately audited capability.

Kube/Docker metadata readers bound bytes and refuse leaf symlinks and special files; kubeconfig exec is data and is never run. Parent-directory symlink resolution is not a complete filesystem sandbox and is documented as a future collector boundary. No future pack parsers, download transport or executable extension were added.

Hostile temporary fixtures exercise fake PATH Git, fsmonitor, clean filters, submodules, partial-clone/promisor config, executable-looking `.envrc`/theme/script files, huge/malformed metadata, symlinks, kubeconfig exec, ANSI/bidi strings and privacy-policy snapshots. Sentinel tests confirm no project execution. Renderer spies forbid filesystem calls, subprocess spawning and network calls through repeated renders, with unchanged local-inventory counters. Local collector transport cannot be reached for rejected partial clones.

A focused read-only security review reproduced submodule filter execution and partial-clone lazy-fetch execution in the initial collector. Both paths were closed and locked by regression tests. The independent follow-up review encountered a runtime content filter; do not interpret it as completed approval. Local regression verification remains the evidence for the fixes.

## Lifecycle investigation and evidence correction

The authoritative [test-by-test lifecycle matrix](context-engine-lifecycle-matrix.md)
records every observed branch lifecycle failure, exact names, source, elapsed
milliseconds, isolated branch/base results, four-worker canonical controls,
matched added-worker load, process/transport state and classification limits.
It includes the later raw-byte, Keep Awake startup, crash-recovery and live-status
cleanup failures. Successful isolated tests do not establish base flakes.

The old `/tmp/nmsh-context-accepted-base` archive contained an unintended
`home: homedir()` edit and failed build. Its evidence is superseded. Current
comparisons use a Git-backed detached checkout at the full accepted SHA,
with tracked source clean before/after comparisons. `node_modules` is only a
symlink to the existing installation. Tests explicitly unset NO_COLOR and set
TERM=xterm-256color / COLORTERM=truecolor; the default TERM=dumb environment
is not a matched presentation control.

Two deterministic **test-harness** defects were reproduced and fixed:

- A two-second ownership scan timing out previously aborted disposal without
  using its existing ten-second wait budget. A timeout now means unknown
  ownership; only a later completed scan with no owners allows removal.
  The real late-writer regression failed before and passed after the fix;
  persistent unknown ownership still fails at the original deadline.
- A real service can begin listening after disposal's first socket check.
  Ownership polling now revisits late session/socket lifecycle within the same
  budget. The gated real-service test failed at 10,660.9 ms before the fix,
  reproduced against exact-base harness/production source at 10,315.9 ms,
  and passed at 619.1 ms after the fix. No production timeout was changed.
  The fixture's longer idle lifetime only keeps this race deterministic and
  prevents automatic idle exit from masking it. The diagnostic fixture was
  removed from the base checkout afterward.

The latter reproduction establishes a pre-existing harness race. It resembles
recent orphan-service/socket failures but does **not** establish their exact
historical cause. Those cases remain unresolved without startup/socket timing
at the failing instance. Historical blank-startup and configured-capture
variants likewise remain unresolved. No Context Engine production regression
has been demonstrated, and absence of a reproduced regression is not proof
that added branch load cannot contribute.

Configured capture's unchanged helper import tree excludes direct Engine code
changes but not indirect load. The exact-base-plus-proof-worker canonical
control restores the added file's ordering/work while existing lifecycle files
use exact-base source. Capture passed that control. The proof worker had exited
well before capture, with no tracked child survivors/pending requests. Native
PTY grandchildren are not exhaustively covered by ChildProcess telemetry.
Failure-only diagnostics now distinguish owner import, transport presence,
inner PID state, output and process exit without relaxing assertions.

The final gate before the late-service fix had four new lifecycle failures.
Two had live orphaned Node/esbuild processes and a socket at the deadline; one
had owners exiting during diagnostic sampling; one had a runnable frontend
with zero output after 21.6 seconds. All recorded owner PIDs had exited on a
later scoped check. A finally cleanup exception may also mask a preceding
body failure; no historical body passage is inferred. The subsequent exact-base canonical run passed all these
cases; neither that pass nor their focused passes proves a base flake.

## Validation

Final build, direct typecheck, verify:fast and the expanded whole-file affected
suite passed after both test-only cleanup fixes, with no affected-suite skips.
The ordinary canonical rerun passed every lifecycle/teardown case in the matrix;
its independent ranking suite also passed. Canonical verification still fails
on four stale assertions and the dense screensaver timing budget. That exact
screensaver assertion failed against the Git-backed accepted base at blackHole
34.61 ms/frame; the branch rerun measured 14.02 ms/frame. No budget was changed.
The latest exact-base canonical comparison passed every implicated lifecycle
case and failed on the four stale assertions plus the theme-cache assertion.

The matrix classifies sixteen reported ownership-probe errors as suite timing
failures and retains twelve historical variants as **unresolved**. No production
Context Engine regression was confirmed. This proof remains uncommitted and
is **not ready to checkpoint** while those historical variants and physical QA
remain unresolved. Current lifecycle passage does not erase that limitation.
Four stale assertions reproduce at the exact base: rightPrompt expectations
omit discoveredTools, and uiConsistency expects intentionally removed Tools
checkboxes. Separate native fuzzy completion and theme-cache failures have
also occurred at the exact base. The reported Chroma optional-tools error was ENOTEMPTY during temporary
config removal. That finally exception may have masked a body error;
historical navigation assertion status and the cleanup cause are unresolved.

The reported physical empty-Rail failure is recorded below; its corrected
fixture/preview retest and remaining Ghostty checks are **PENDING**. Automated PTY,
synthetic geometry and rendering tests are not physical validation.

## Measurements

Synthetic width-100 warm renders, macOS Node 26.8.1, 100 warmups and 1,000 measured samples, with concurrent canonical test load:

| Rendering | Median | p95 | Mean |
|---|---:|---:|---:|
| Main Prompt | 1.826 ms | 2.891 ms | 2.019 ms |
| Ten modules, two-row Rail | 1.472 ms | 6.649 ms | 2.550 ms |

These measure pure rendering, not cold collection, physical terminal behavior or a future catalog budget. Renderer tests show zero repeated inventory scans.

A separate synthetic default-app frame comparison (100×30 viewport, private
HOME/config, 100 warmups and 1,000 samples, renderer output stubbed) measured:

| Default frame | Median | p95 | Mean |
|---|---:|---:|---:|
| Exact base | 0.426 ms | 0.497 ms | 0.452 ms |
| Context Engine branch, no routed Rail modules | 0.467 ms | 0.581 ms | 0.499 ms |

The median increase is about 42 microseconds per synthetic frame. This is
bounded render-cost evidence, not proof that branch imports/test-worker load
cannot affect cold startup thresholds under host pressure. The ordinary
canonical run before the late-service fix coincided with host load above 42;
the subsequent rerun began at load 19.29 on eight available CPUs. These are
observed host conditions, not controlled load equality or proven hard resource
exhaustion. No external work was stopped or throttled.


## Physical testing handoff

**Physical Ghostty QA: user confirmed the initial Bottom Rail renders. Presentation refinement and wider QA remain PENDING.**
Accessibility/capture troubleshooting remains stopped. Only the user-reported initial Bottom result is accepted; no new composition pass is claimed.
Use [the exact manual checklist](context-rail-manual-qa.md), including isolated
QA-host presets. The dedicated fixture uses private HOME/config/runtime,
synthetic QA-KUBE/QA-DOCKER contexts and a fresh transcript on each launch.
No personal config migration is required. Preparing/launching that window
does not constitute visual QA. Terminal.app physical QA also remains pending.

Earlier native Ghostty launch requests returned window identifiers, but those windows
did not remain discoverable and no dedicated QA frontend process remained.
The remaining terminal reported a showreel directory and was left untouched.
The private QA state/launcher is prepared; the user must run the checklist's
one-line launcher in a new Ghostty window. No further capture or Accessibility
attempts were made. A separate launcher smoke under an RTK-mediated PTY
reached the QA-host prompt but NMSh rejected that proxy's noninteractive
streams; it is not evidence of Ghostty runtime behavior.

## Reported empty Rail: fixture and preview correction

The user supplied a physical screenshot and reported normal Main Prompt,
right-side zsh, composer and command execution, but no visible Bottom Rail
after Node/Python/Git commands. Current was empty while Showcase rendered.
The saved isolated config revealed Git/toolchain hidden and only kubeContext /
dockerContext routed to Rail with `onCommand`. Those submitted commands do
not activate the routed modules. Always reserves rows; it does not override
visibility or route unrelated facts. No product default placements changed.

The misleading preview was a real UI defect: `['']` for an empty Always Rail
was treated as visible content. Current now tests nonblank content and explains
empty visibility and Always's reservation. The focused test failed before the
preview change and passed afterward. An actual frame regression confirms one
blank reserved row immediately above Bottom, unchanged input coordinates and
one less viewport row than Off. A real frontend PTY regression loads saved
routing, enters a dirty `rail-qa` repo with the reported manifest markers,
observes branch text painted above input, and types kubectl to trigger cached
context through normal collection/rendering. Rail is absent from command output.

The dedicated launcher now starts a separate `qa-project bottom 1 always zsh`
preset: explicit Git branch/status/toolchain Rail routing, project identity in
Main, zsh in Right. Its owned fixture includes package.json, pyproject.toml,
Dockerfile and modified README.md. `qa` still selects command-only contexts
for Auto appear/disappear testing. The user's `/tmp/nmsh-context-qa` files and
personal config were not edited. Chosen theme/style settings are retained.

Build, direct typecheck, verify:fast, and the whole-file affected suite passed.
The exact launcher passed a private PTY smoke (Rail branch visible; Ctrl+D
returns to host; clean outer exit). Launcher scripts passed syntax checks.
These are automated checks, **not physical Ghostty verification**. The full
canonical gate was not rerun for this preview/fixture correction; the preceding
canonical results and unresolved historical failures remain recorded above.

Relaunch in a new Ghostty terminal:

```sh
/bin/zsh -f /private/tmp/nmsh-context-ghostty-qa/launch-terminal.zsh
```

First retest only: branch `rail-qa` / dirty Git context should appear immediately
above the Bottom composer, with toolchain labels when width permits. Current
should show routed context. Remaining physical checks stay pending; see the
updated manual checklist. Implementation remains uncommitted and unpushed.

## Current presentation correction and /btw identity (uncommitted)

Physical review rejected the boxed Inside interpretation. The canonical
[composition design](../design/context-rail-composition.md) now explicitly forbids
vertical sides/corners and defines a horizontal-divider band. Original Bottom
Rail rendering was user-confirmed; these corrected layouts remain physical
RETEST PENDING. [The exact presets](context-rail-manual-qa.md) include default,
all three vertical anchors, Right Outside/Inside, and consent conversion.

Main Inside uses existing twoLine + placement composer + composerDividers On.
No duplicate geometry enum. Rail Outside remains outside Main's band. Explicit
Inside on incompatible Native Main previews a cloned proposed conversion and
shows Requires Main Prompt: Inside. Save opens Change & Save / Cancel / Keep
Current, initially Cancel. Only confirmation changes/saves both; Cancel/Esc
keeps saved settings. Auto integrates only with already-compatible Main.
No facts, demand, collection, cache, capabilities, routing or security changes.

New defaults use Auto / 1 / Vertical / Follow Main / Outside / Gap / Prompt
Level / Follow Main theme/style / Priority. Saved Rail objects lacking spacing
keep old Attached geometry; valid saved fields persist unchanged. Removing the
box also removes its editor gutter. Shared ScreenPlan/painter remains the one
live/preview geometry path, with independent Right Context and priority overflow.
Narrow forced Right drops context before sacrificing inline command text. No
new timer/color system, transcript chrome or PTY output.

/btw is the primary slash command, completion/help/palette/guide/setup/docs/demo
source identity. /ask parses to the same existing Ask action/state/resolver;
parked conversations work across spellings. Ask NMSh stays the human-readable
panel heading and internal Ask/config names remain. Newly recorded canonical
conversations use /btw; legacy invocations retain /ask identity, and stored old
records/folding restore unchanged. No provider/model/action/session rewrite.
Existing media was not regenerated; demo source uses /btw for future recording.

Focused tests include horizontal-only geometry, independent boundary widths,
Main consent/save/cancel/reopen, proposed Current/result parity, alias/parked
state/legacy identity, help/palette discovery and unchanged local-intelligence
behavior. Final validation logs are `/private/tmp/nmsh-no-box-btw-focused.log`,
`nmsh-no-box-btw-fast.log`, `nmsh-no-box-typecheck.log`, and launcher smoke.
Final whole-file focused verification, build, direct typecheck, verify:fast and
diff checks passed. The exact default launcher and Right / two rows / Inside /
Above / Mirrored preset passed an automated PTY smoke with clean shell exit;
Zsh/Node launcher syntax checks passed. This is not physical Ghostty QA.
Historical lifecycle investigation and classifications are unchanged; full
canonical verification was not rerun during this scoped correction.

Additional files: railLayout.ts, railComposition.ts, configuration.ts,
PromptPanel.ts, TerminalApp.ts, screenPlan.ts; slashCommands.ts, AskPanel.ts,
OutputBuffer.ts, TranscriptPresenter.ts, concepts.ts, guide.ts, SetupCat.ts;
README/current architecture/demo docs and ask.tape source; tests for Rail,
conversion, canonical/alias and transcript presentation. No dependencies,
version bump, media, commit, push or showreel changes.

## Deliberately deferred

Actual Context Packs/catalogs/downloads/registry/marketplace; executable extension tier; Status Strip module routing; wholesale Rich Git collector migration; automatic historical Rail persistence; richer stale/cache/error UI; expanded workspace parsers; complete filesystem sandboxing and broader Git support; Linux/older-system-Git and physical terminal QA. Existing core caches are reused; a generalized capability scheduler is future work.

No unresolved product architecture choice remains after the accepted Flow-group clarification. Capture's historical timeout and the unresolved historical lifecycle variants remain validation concerns; see the matrix. Security/performance rollout remains gated by #321 and physical QA. Do not commit/push this branch until authorized. The next investigation must preserve any body error that a finally/disposal exception could mask, correlate late service startup/socket times, and distinguish configured-capture owner import from cleanup/inner-PID state. Do not infer a base failure from another successful retry.


## Physical-QA transcript and shell refinement (uncommitted)

Branch remains `feature/305-context-engine`; HEAD remains
`6adfe8524da79f071de886f5a3f97bd49074bc60`. The existing uncommitted Context
Engine/Rail proof is preserved. No commit, push, integration, release/version
change, or showreel worktree change occurred. This is the requested bounded UX
slice; historical lifecycle archaeology was not reopened.

`/transcript` now starts with Live presentation → Presentation (Normal / Chat),
then History with the existing historical prompt, divider/color/theme and folding
controls. Its presentation draft saves the root `transcriptPresentation` also
used by `/layout` and Settings → Layout. Esc cancels; a failed save retains the
draft and current live config. The preview uses OutputBuffer/TranscriptPresenter,
including Chat's narrow-width fallback. Preview rows yield to editable controls,
error messages and save/cancel help at normal terminal height. `/layout` remains
the combined Composer position × Transcript presentation preview. Slash/Ask
concept discovery copy now includes the transcript's live controls.

The current `/shell` row has one tick, a persistent restrained full-width band
(reverse video under NO_COLOR), and explicit `[current]`. Selection keeps its
independent pointer/weight. `[default]` stays text and is bold. Version details
truncate before badges at ordinary narrow widths. Existing switching, default
selection, install confirmation and explanatory copy are retained.

Shell's new Prompt shell indicator controls edit immediately with ←/→ and share
the existing shell ContextModule with `/prompt` and Settings. Visibility labels
are Hidden / When not default / Always over `visible` + `condition: shellDiffers |
always`; **no new config field or migration**. Existing valid visibility,
module order, surface and Left/Right placement survive opening/normalization.
A saved explicit Hidden surface is recognized as Hidden; explicitly enabling it
removes that hide override. Side uses the existing placement field and removes
an overriding surface only when the user chooses a side. `/prompt` P now toggles
the resolved side, so explicit Right Context/Auto also switches correctly.
An unusual saved shell Rail route is retained and reported until the user
explicitly chooses a prompt side; this pass does not silently reroute configs.

When not default compares the actual `shellId` of the session to
`promptConfiguration.shellBackend`, through the existing promptContext shell
fact. Changing the default updates the comparison without switching the session.
Right uses the same independently anchored Right Context painter/budget; no new
shell label, Rail geometry, provider, shell lifecycle or PTY implementation.

Validation: new refinement regressions and affected transcript/layout/Chat,
shell presentation/module/switching, prompt customization/placement, Context
Engine/Rail geometry/conversion, Settings/Setup and `/btw`/`/ask` checks ran.
The whole affected run still includes the two previously documented stale
`rightPrompt` expectations that omit `discoveredTools`; no new failure appeared.
The remaining Right Prompt checks also passed with those exact cases explicitly
excluded. The stale assertions were left unchanged. Final focused refinement
and transcript tests, build, direct typecheck, verify:fast and diff checks passed.
The exact launcher plus Right / two rows / Inside / Above / Mirrored preset
passed an automated PTY smoke with clean exit to the host. These checks are
**not physical Ghostty validation**. Full canonical/lifecycle verification was
not intentionally rerun; an accidentally expanded npm-test invocation was
stopped, then explicit scoped runner calls were used.

Logs: `/private/tmp/nmsh-ux-final-focused.log` (including the known stale failures),
`nmsh-ux-final-regressions.log`, `nmsh-ux-right-prompt.log`, `nmsh-ux-fast.log`,
`nmsh-ux-typecheck.log`, and `nmsh-ux-launcher-smoke.log` in the same directory.
The existing launcher executes current source and required no script change.
[Fresh physical QA steps](context-rail-manual-qa.md#transcript-and-shell-ux-refinement--fresh-physical-retest)
cover the full transcript synchronization and shell indicator matrix. All new
physical observations remain PENDING; the earlier accepted Bottom result is
unchanged. Everything remains uncommitted for review.


## Hidden/Side fix and exact-base readiness evidence (uncommitted)

The user confirmed the preceding physical QA passed. The later read-only review
found a real branch bug: Side cleared `surface: hidden` while `visible: true`,
revealing the shell indicator. That confirmed blocker is now fixed. Shared
`applyModulePlacement` preserves Hidden while updating only stored placement;
`/prompt` P resolves the stored side without treating Hidden as a side. Neither
operation changes `visible` or `condition`. Explicitly enabling visibility later
uses the side chosen while hidden. No new config/migration or shell switching
change.

The focused regression failed before the fix with `surface` becoming undefined.
It now covers a saved Hidden shell module, Right → Left from `/shell`, retained
Hidden and no rendered shell label, saved config, reopening `/shell`, shared
`/prompt` draft, P in both directions while Hidden, prompt save and Shell reopen,
and explicit enabling at the selected side. Focused shell/prompt tests passed.
The post-QA fix is automatically verified; the user's earlier physical PASS is
accepted without claiming they physically tested this later fix.

### Four assertion failures: identical exact-base reproductions

Accepted branch base / unchanged HEAD:
`6adfe8524da79f071de886f5a3f97bd49074bc60`.
An isolated archive of **that exact commit**, not another dev revision, was
extracted under `/private/tmp/nmsh-exact-base-hqzi_4k7/checkout`. Its dependency
link uses this checkout's installed node_modules; package-lock.json, the canonical
runner and both implicated test files have identical contents. No worktree,
checkout switch, stash, reset or showreel change was used.

Both versions ran the identical command:

```sh
rtk node /private/tmp/nmsh-stale-compare.mjs
```

Only cwd differed (current branch versus the exact-base archive). The script
imports that cwd's canonical `scripts/test.mjs` and executes both **whole files**
without skips or name filters:

```js
const {runTestFiles} = await import(pathToFileURL(process.cwd() + '/scripts/test.mjs'));
delete process.env.NO_COLOR;
delete process.env.NMSH_COLOR;
process.env.TERM = 'xterm-256color';
process.env.COLORTERM = 'truecolor';
process.exitCode = (await runTestFiles(
  ['tests/rightPrompt.test.ts', 'tests/uiConsistency.test.ts'],
  ['--test-concurrency=1', '--test-reporter=/private/tmp/nmsh-stale-reporter.mjs'],
)).code;
```

Environment: macOS, Node v26.8.1; inherited environment equal except isolated
runner-owned config/temp paths. NO_COLOR is cleared initially; the NO_COLOR
assertion sets it internally in both versions. The reporter extracts name,
assertion code/operator, actual and expected. All four records compare equal
between branch and base, including the actual tool row's spacing. Both runs exit
1 on exactly the same assertions; all other cases in those files pass.

| Exact failing assertion | Actual versus expected in both versions | Classification |
| --- | --- | --- |
| rightPrompt: placement defaults left, every module may move right, and it persists | Actual has an extra trailing `left` for the default hidden discoveredTools module; expectation omits it | Exact-base/pre-existing stale assertion |
| rightPrompt: v0.3 configs gain Git status right after the branch, wherever it was moved, with its visibility | Actual module IDs end with `discoveredTools`; expectation omits it | Exact-base/pre-existing stale assertion |
| uiConsistency: chosen tool checkboxes remain visible with NO_COLOR and focus elsewhere | Actual bat row is `… Checking` / `Enhanced`, without the expected `[x]` | Exact-base/pre-existing stale assertion |
| uiConsistency: chosen tools retain an explicit checkbox when keyboard focus moves away | Same actual bat row and missing expected `[x]` | Exact-base/pre-existing stale assertion |

Evidence: `/private/tmp/nmsh-stale-base.jsonl`, `nmsh-stale-branch.jsonl`, and
`nmsh-stale-comparison.json` in the same directory. The branch comparison was
repeated after the Hidden fix and remained identical. Neither implicated test
file nor its assertions was modified. These four failures are **not Context
Engine blockers**, as requested by the user.

### Final validation and readiness scope

The canonical runner reran the complete affected Context Engine/Rail,
transcript/layout/Chat, screen/composer, prompt/provider/placement, shell/context/
adapter/switching, Ask/alias/discovery, Settings/Setup, native capture and temp
hygiene files without skips or filters, with two file workers and required
process-table/local-socket access. Its only failures are the four identical
exact-base stale assertions above. All branch regressions and affected lifecycle
checks pass; no new helper-resource leaks were reported.

`npm run build`, `npm run typecheck`, `npm run verify:fast` and `git diff --check`
passed. Logs: `/private/tmp/nmsh-hidden-side-red.log`, `nmsh-hidden-side-focused.log`,
`nmsh-hidden-side-affected.log`, `nmsh-hidden-side-build.log`,
`nmsh-hidden-side-typecheck.log`, and `nmsh-hidden-side-fast.log` in the same
directory. The source fix is confined to the shared placement helper and the
prompt placement shortcut; regression coverage and this evidence are added.

Final read-only review finds no confirmed branch blocker in the requested slice.
This readiness decision follows the user's instruction to count only confirmed
branch blockers; it does not rewrite historical lifecycle classifications or
claim a full release/cross-platform canonical gate. Physical QA PASS is accepted.
The prior NOT READY finding for Hidden/Side is resolved. **READY TO CHECKPOINT**
for the requested review; no commit/push is performed or implied. Branch and HEAD
remain unchanged, package version remains 0.16.0, all Context Engine/Rail work is
preserved and uncommitted, and the separate showreel worktree remains untouched.
