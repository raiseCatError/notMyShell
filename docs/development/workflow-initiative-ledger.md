# Workflow initiative ledger

Current gate (2026-10-14): **freeze PENDING**. The current exact-head state is below; older source-family and investigation entries are retained historical evidence.

**Current new-source gate (2026-10-14):** **frontend freeze PENDING**. The following is captured exact-head evidence, not stack acceptance. Final reconciliation must read the latest actual CI again.

- Input #348 `c9fcbf92701ef30d72a83e3cb75c31237dba160f`: local canonical **PASS**; captured candidate CI [SUCCESS 38510302856](https://github.com/raiseCatError/notMyShell/actions/runs/38510302856); captured actual PR CI [SUCCESS 38510689515](https://github.com/raiseCatError/notMyShell/actions/runs/38510689515).
- Queue #357 `6739b30b5e4ed58389373185f44d361ec4c927e0`: local canonical **PASS**; captured candidate CI [SUCCESS 38511614653](https://github.com/raiseCatError/notMyShell/actions/runs/38511614653); captured actual PR CI [SUCCESS 38512062080](https://github.com/raiseCatError/notMyShell/actions/runs/38512062080).
- Copy #358 `fe73f30ada1afa939e98860a96966e823dbb13ea`: local canonical **FAIL**; captured candidate CI pending; captured actual PR CI pending.
- Report #360 `6dc44515e3561ec3480b87c6cbbf36cc7a28fb03`: local canonical **pending**; captured candidate CI pending; captured actual PR CI pending.
- Compare #361 `4c744895b2d18cb9d191127df201de1d598573f3`: local canonical **pending**; captured candidate CI pending; captured actual PR CI pending.
- Vocabulary #367 `7f4470e32a45158926d181f6b1e9bda8a997da77`: local canonical **pending**; captured candidate CI pending; captured actual PR CI pending.
- References #368 `3908bc550c5373a39bd5edc5bdb599fe6fa6ed8c`: local canonical **pending**; captured candidate CI pending; captured actual PR CI pending.

A publication/CI hold is recorded: Copy fe73f30 canonical failed nativeCaptureLifecycle.test.ts:113: expiry recovery returned no capture-file candidate; exact cause under controlled investigation. No failed-run rerun. All eight local source refs retain the reviewed single test-file correction additively, with exact changed-file/blob checks and independent Vocabulary/References siblings. Host driver `74808` serializes the downstream focused/canonical and References benchmark/security gates. Publisher `63480` requires canonical, full candidate CI and actual parent PR CI before original promotion, then awaits actual PR CI. Linux waiter `27626` remains behind all host gates and storage/memory guards; the owned VM stays stopped until that gate. A failure holds later work while any active child finishes naturally. Fresh full Linux/Fish, security reconciliation and final actual-head CI remain required. Physical QA is unperformed. No integration or protected-branch merge is authorized.

**Pager investigation checkpoint (2026-10-14):** the unchanged Report `690ff65` fixture reproduced the less quit timeout on Ubuntu 24.04 arm64 with less 590, Node 26.11.1 and Fish 3.7 installed. Failure-only observations found a live foreground less process, both PTYs at 35×110 and a later complete repaint after the single quit key. A separate frontend observation confirmed `q` entered the active raw passthrough path and was written to the live client socket; this does not prove delivery through every later layer. Strict cleanup completed and the owned VM stopped normally after each control. Service/native instrumentation runs passed and therefore do not isolate the failed path.

A native-only controlled pair, without NMSh, confirms an independent hazard: after less successfully reads its single `q`, a real PTY resize at that read boundary can leave it running through the original 15-second observation, while the same read without resize exits promptly. This agrees with [less v590's command loop](https://github.com/gwsw/less/blob/v590/command.c), which skips decoding a character when signals are pending. It proves a native signal/input interaction, **not the exact cause of the historical CI failures**. The old first-text oracle can accept an intermediate attach-nudge repaint; its readiness assumption is unsafe independently of historical attribution. Same-prompt legacy-oracle controls also passed, so the new prompt/wait is not claimed as a one-variable reconstruction of CI.

Test-only Cedar `c9fcbf92701ef30d72a83e3cb75c31237dba160f` waits for the complete final-size pager frame (last content row plus explicit native prompt) before one `q`. It preserves the single existing repaint wait, the 15-second completion deadline, Vim coverage and strict cleanup. Bounded read-only failure observations now cover both repaint and quit stages before teardown. Uninstrumented Ubuntu full-frame controls, actual macOS lifecycle/resize checks, fast verification and focused read-only review passed. Its clean-head canonical run passed; additive propagation is complete and candidate publication/CI is underway. Downstream canonical, all new-head CI, sibling/security and fresh full Linux/Fish remain pending. Accumulated terminal text is not an input acknowledgement or a terminal-screen model. No production input change, retries, skipped assertion, deadline inflation, failed-run rerun or harmless-flake classification occurred.

Evidence is preserved on T7 under `verification/`: `report-690ff65-linux-quit-control`, `report-690ff65-linux-quit-delivery-observable`, `report-690ff65-linux-service-delivery-interop`, `report-690ff65-linux-native-read-window`, `report-690ff65-linux-pager-complete-frame-literal` and `report-690ff65-linux-pager-legacy-oracle` log/result pairs. Initial setup-only dependency/import failures and the incorrect diagnostic prompt-format repaint failure remain separately recorded; they are not production failures. The new fixture's focused/fast, review and exact-commit canonical records use the `pager-fixture-` prefix. Previous stopped drivers must not be restarted with their obsolete pins.

**Current published-head blocker (2026-10-14):** Report original/fix `690ff65f8b356f2a9d06b399bff17befbca57c4e` passed exact canonical and [comprehensive candidate CI 38500138503](https://github.com/raiseCatError/notMyShell/actions/runs/38500138503), but [actual Report PR CI 38500575001](https://github.com/raiseCatError/notMyShell/actions/runs/38500575001) attempt 1 failed Ubuntu shard 1/2 (job 115646332214). `sessionLifecycle.test.ts:260` saw the reattached less display, sent one `q`, then timed out at the unchanged 15-second wait for command completion. Both macOS shards, the other Ubuntu shard, Node 22 and Quality passed; the failed job found no process leaks. This differs from the historical `0d092ac` macOS first-repaint timeout. Exact cause remains unknown; neither failed run was rerun or classified harmless. The subsequent controlled native hazard and fixture correction are recorded above; exact historical CI attribution remains unknown.

Input `e601829`, Queue `473a7f2` and Copy `ce6cee1` now all pass exact canonical, comprehensive candidate CI and actual published PR CI. Compare `c01b6e7` completed canonical naturally before host driver `33430` exited at the next owned clean-worktree guard; no active test was interrupted. Publisher `70020` stopped on failed actual Report CI before Compare or sibling publication. Linux waiter `43413` exited at the failed gate without starting the VM. The exact owned marker was removed after the guard stopped; the preceding source family was clean. Later sibling canonical/benchmark/security and fresh Linux/Fish remain pending; the new committed fixture now has its own active canonical gate. **Frontend freeze remains PENDING; integration stays separate.**

All six downstream targeted lifecycle gates pass. Additive merges verify exactly the reviewed two-file exit-cleanup correction and preserve other track code and sibling ancestry. The now-stopped host driver `33430` used one worker, private T7 roots, clean-head/storage guards and a stopped owned VM; it performs no publication. Lightweight publisher `70020` advances candidate refs only after canonical, then originals only after complete candidate CI and latest parent PR CI, and awaits each actual published PR CI. Any genuine gate failure holds subsequent publication without reruns or active-test interruption. The now-stopped Linux waiter `43413` was guarded behind every host canonical/benchmark/security child, then checks resources before starting only the owned VM and stopping it normally afterward. The preceding family's green Linux/Fish/security/CI evidence does not accept these new heads. All exact published refs were read for this checkpoint. **Freeze remains PENDING; no integration or protected-branch merge is authorized.**




Canonical tracker: [#359](https://github.com/raiseCatError/notMyShell/issues/359). Updated 2026-10-13.

## Current stabilization checkpoint

The [current durable handoff](workflow-stabilization-handoff.md) supersedes historical tables below. **Frontend freeze is PENDING; no integration or release/master merge has begun.** Initial inspection confirmed the original pushed handoff; no recovery/reimplementation was necessary.

Source candidates retain the earlier `9cfdf9a` stopped-prompt and `058f81e` late-replay/startup corrections. Current Cedar `e2b1ca5` adds controlled current-owner withdrawal/renewal, historical replay isolation, renderer-entry/repaint ordering, current mode restoration, owned pre-entry Kitty-stack cleanup and stopped exec/data guards. Failing-before/passing-after startup/journal/renderer tests and fast/build/core/diff verification pass; focused source review found no remaining material issue. The initial exact Cedar canonical run failed only an inconsistent entered-renderer notification fixture; its one-line correction `6ada1fe` passes unchanged assertions and ownership controls. Corrected Cedar `6ada1fe` passed its complete canonical gate; its fix candidate was published for comprehensive CI 38394523897, before the original feature was subsequently promoted; the later published-head status is below. The active canonical driver performs no publication. The reviewed Birch conflict resolution preserves queued metadata and passed real zsh/Bash/Fish queue/startup plus fast checks before commit. The vocabulary resolution preserves activity-pair hooks and passed affected live activity/startup and fast checks. All eight source refs now retain the correction additively, with independent sibling ancestry; fresh verification is recorded in the handoff. See the handoff for exact committed/published heads and continuation state.

The changelog-only live-base conflict is resolved by additive docs-only synchronization `bef2b49`; runtime/test/dependency/CI source is unchanged by that merge. No release/master ref or other owner's worktree changed. Exact-head host canonical verification passes Input `bef2b49`, Queue `1a119fa`, Copy `bb6a441`, Report `648002f`, Compare `0f46a07` and Vocabulary `24cb4fb`. References `1e8febd` also passed canonical, benchmark script typechecking and timing smoke; the entire host driver finished naturally.

Published Input/Queue/Copy actual PR CI passes at those heads (38401264414 / 38403046562 / 38404304434); Input's comprehensive candidate CI 38399308262 also passes timing/Fedora. **Report `648002f` actual CI 38405554008 fails Ubuntu shard 1/2:** unchanged fullscreen repaint wait expects 33×90, while trap output reports 29×90 and 28×90. Other applicable jobs and Vim/less repaint pass. Compare and both sibling originals remain held. Current ownership fixes address independently reproduced defects but do not prove the cause of this live failure. Isolated diagnostic `50ba4dc` has passed host canonical and macOS/Linux geometry/lifecycle controls; its comprehensive CI attempt 1 is incomplete because one macOS job never acquired a hosted runner; only that unexecuted job was retried once, and attempt 2 passes all required gates. A standalone Linux control proves the zsh trap can omit a final 33-row size while a held external sample reports 28 rows. This is a confirmed fixture assumption defect. The synchronized real-NMSh control also produces the unchanged 20-second failure despite both PTYs at 33×90, while a main-loop flag variant repaints 33 rows. Historical failed-run geometry remains uncaptured. The shared repository regression subsequently failed as intended on macOS and passes after the minimal main-loop flag correction; original assertions/deadlines and production code are unchanged; no assertion/deadline change or harmless-flake classification is justified.

The driver performs no automatic publication; exact source/published tables and evidence are in the handoff. The first latest Linux run failed under an overly long configured guest root; unchanged affected files pass with a short private root. The complete one-variable rerun, sibling checks and Node 22 compatibility passed at `1e8febd` / `24cb4fb`; optional/platform skips remain explicit. The owned VM is stopped. The first failed log remains retained. Latest-head host security/live clipboard stand-ins pass in canonical verification; Prior-head Linux security/live acceptance also passes. Fresh corrected-head Linux, final actual published-head CI and physical QA remain incomplete. **TerminalApp.ts remains unfrozen.** Integration remains outside this session.

Cedar correction `063c3e5` was committed from its unchanged preceding verified code tree and published only as a fix candidate. Comprehensive CI 38431477737 now passes all required jobs, but fresh exact-head canonical driver `85004` naturally failed the blocked-startup detach/reattach cleanup gate and stopped before later heads. The retained shell is an owned detached pipe-backed helper, not a proved managed-shell teardown defect. The primary failure was masked by cleanup. Controlled reproduction proves the initial-composer timing assumption and unconditional helper gate can produce that path; test correction is in progress. Evidence and exact pending heads are in the handoff. Original Input remains `bef2b49`; later original/fix refs remain held. No freeze or integration is authorized by the green CI alone. Test-only `c350df5` is now committed/unpublished after focused startup/color/shell checks, strict test typechecking, build and diff validation. It deterministically submits before the notice and preserves strict cleanup and both error causes; the delayed-journal UI variant passes. Exact-commit canonical session `69125` is active with an explicit established color baseline. The initial incorrectly configured full invocation and its failed assertions remain recorded; later source propagation and publication stay held.

The old retained worker remains unattributed. Isolated observed CI `2510d22` and bounded-five `2eb70c7` passed with service workers and tracked PTY children exiting. Superseded Report `7bf0dbe` failed unchanged ranking, then its complete rerun failed the fullscreen WINCH-trap expectation; unchanged isolated probes passed. Those observations do not establish exact failed-run causes. The bounded export-security source review found no material defect; export source remains unchanged by the startup correction. Automated/live and physical evidence remain separate.

All branches/history and other owners' resources are preserved. New source heads must be canonically verified and deliberately promoted before the shared interface is declared ready. The frontend remains owned by this workflow track. Integration is outside the current session authorization and will be planned separately after stabilization. Future integration must use canonical #370 Ruby/PHP and bounded verified slices.

## Confirmed findings and work

- **Fish 3.7 reader ownership:** the native read editor deliberately does not enable bracketed paste. Waiting answers
  remained in the composer/queue. The authenticated `fish_read` marker fixes handover before the prompt, including
  hidden readers inside functions and detached readers. `answersByDefault` was not weakened. Details and exact
  baseline evidence: [#356 comment](https://github.com/raiseCatError/notMyShell/issues/356#issuecomment-6106773236),
  `docs/development/fish-typeahead.md`.
- **Fish multiline submission:** use native `begin`/`end`; zsh/Bash use brace groups. Composer, dispatcher and parse
  checks must use the real shell ID. Queue regressions verify persistence of shell variables and one logical record.
- **Fixture synchronization:** unique runtime-built read prompts prevent historical redraws authorizing a reply;
  the Ctrl+C survivor waits for trap installation, uses a timed-read-capable shell and an explicit release file.
- **Attach privacy follow-up:** a final canonical run caught a password echoed by the outer PTY during journal I/O.
  A slow-journal real-PTY fixture reproduces it. Raw input is now protected before passthrough output and throughout
  probing/journaling; the later fixture follow-ups require their own final gate. Key diagnostics now exclude all running/startup input.
- **Gemfile security:** `18e94d9` applies the bounded single-line Ruby declaration parser to the duplicate in #368.
  Malicious-whitespace and cross-line declaration regressions pass. #370 remains the canonical runtime owner.
- **Workflow additions (a16d556, 3097cbb):** clips deliberately kept in bounded frontend memory, reviewed through the
  existing Paste Review/palette, history selection pinning with recorded cwd, and F8/Shift+F8 failure navigation.
  Copy/folding remain independent. Clip and reference actions never submit commands automatically.
- **Clipboard suggestions (a16d556):** off by default and frontend-only. macOS uses only NSPasteboard changeCount
  while idle; contents are read only by explicit `/ps`. Linux has no supported metadata-only counter and fails closed.
  The fixed native metadata query and lifecycle/privacy unit regressions passed.
- **Guide/fixture corrections:** paste batches and pins are included in the guide; app fixtures pause the queue before
  asserting accepted entries, preventing asynchronous parse checks from racing first-entry dispatch.
- **Diagnostics/import audit:** module explanations distinguish uncollected/unknown/stale facts from known data;
  collection metadata does not prove conditional visibility. Starship/Oh My Posh previews disclose loss, save only
  after a second explicit action, and preserve source files. External-tool decisions describe bat's actual Theme
  Bridge support; dedicated source-preview launching is not implemented.
- **Fish parse-only transport:** Fish 3.7 on Linux rejects Node's socket-backed stdin with “Unable to read input
  file: Is a directory”. Paste verification supplies Fish's script through `--no-execute -c` instead; failed/oversized
  argv submission refuses the split. Regression checks prove neither commands nor substitutions execute.
- **Diagnostic privacy:** module details show safe collection failure states, rather than raw exception paths or
  values. Measured durations remain available; no new collector is invoked by opening details.

- **Comparison UI trust boundary (5570d34):** restored command labels in the chooser header bypassed display sanitization. Both chooser and diff now use safe labels; format and separator controls become visible in authored review UI. Adversarial tests cover narrow layouts and actual clipboard bytes.
- **Report Markdown status (25af5ba):** restored lifecycle text was a raw Markdown fact. It now uses the existing delimiter-sized inline-code representation, so HTML, links and backticks remain literal.
- **Vocabulary (d4619e4):** selected activity pairs survive live detach/reattach, including previous-choice collision avoidance. Optional journal indices are validated; factual status still derives from lifecycle and exit code.
- **Module diagnostics (1a372fb, 06433f1):** details show capability/source, freshness TTL, invalidation and demand-refresh policy, retained-cache availability and measured collection wall time excluding queue delay. Details reuse fact snapshots and renderer conditions; they add no collectors. Exact last-frame width-compaction decisions are not recorded.
- **Cross-feature queue fixture (4636672):** the combined workflow's optional batch action changes the paste-preview footer. The fixture accepts that optional action while still testing whole-paste insertion and explicit once-only queueing. The original regex failure reproduced, and corrected real-PTY cases passed for zsh, Bash and Fish.

- **Report fixture (ee5483e):** the existing live Copy as Report assertion now expects the literal Markdown status added by the security fix. Its name accurately states that every report is reviewed. Review, cancellation and actual clipboard-byte tests passed.
- **Linux prerequisites:** the disposable minimal Ubuntu VM initially lacked less and vim. Their command-not-found failures are recorded; both tools are now installed in that VM. This changes no application installer policy.
- **Metadata/installer fixtures (86fb4e4):** identical size and timestamps after an immediate mise config edit reproduced even at nanosecond precision. The stat-only cache test now supplies a definite timestamp change and documents explicit refresh for unchanged metadata. Provider review tests supply their own fake executable installer; they do not require host Homebrew or run an installer.

- **Completion and home isolation (566c321):** the queue full run at f081c42 failed its first nested-path candidate assertion after about 1.5 seconds. Controlled slow initialization reproduces a bounded empty result and transport cleanup. Functional capture/cache fixtures now prepare their own completion cache; a new expiry/recovery test retains the production startup deadline. The suite runner also assigns a private home inside its selected temporary root, preventing generated shell caches from reaching the host home. The new isolation test failed before the correction; affected lifecycle/completion tests and verify:fast passed afterward. Final canonical/CI verification is pending.

- **Fixture ownership follow-up (48a0ded, e2adc1e):** a visible composer preceded the third shell's authenticated startup prompt in the SIGHUP fixture; a controlled startup release gate now proves and waits for that transition. Same-shell queue tests use a release file rather than a fixed sleep, keeping all five entries pending until assertions finish. Interrupt typeahead waits for actual foreground process ownership before signalling. The focused SIGHUP case and all three shell queue cases plus Ctrl+C/Ctrl+Z passed.
- **Short module details (52db115):** diagnostic rows now honor the panel's height and remain reachable through arrows/PageUp/PageDown. The viewport is ephemeral; reading and resizing do not change settings or demand collectors. Focused unit and real-PTY tests in a 50-column NO_COLOR Safe terminal, direct typecheck and verify:fast passed. Exact last-frame module width-compaction explanations remain an acceptance-integration follow-up.

## Verification recorded so far

Newest exact-head evidence is in the handoff above. Historical statements below
apply to their recorded commits, not later head acceptance.

- macOS canonical verification passed at 566c321 with the isolated child home. Its later startup-gate fixture commit needs a new exact-head gate.
- The macOS queue run at 2dd8b80 failed five cases: a transient five-entry assertion after the holding sleep expired, signalling before actual foreground ownership, two no-output frontend startup deadlines and the bounded zoxide query fixture. The first two assumptions are corrected above. At inspection this 8 GiB/8 CPU host had load averages 18.05/50.35/59.36 and unrelated Xcode/xctest work active. Their processes are preserved. Host verification now runs one test worker with this track's Linux VM stopped; resource pressure is evidence, not a blanket explanation for remaining failures.
- The Ubuntu run at 895aae5 passed ranking and multiplexer cases but failed SIGHUP's third-shell readiness. That exact run is failed evidence; the controlled startup correction must pass a new full gate.
- macOS canonical verification and direct typecheck passed at 86fb4e4. [Actions 38150534791](https://github.com/raiseCatError/notMyShell/actions/runs/38150534791) passed the Ubuntu/macOS shards, Quality, Node 22 and aggregate checks; timing/Fedora jobs were skipped on the PR event. The isolated-home follow-up needs its own final gates.
- Ubuntu canonical verification passed at 5e45e87 with Fish 3.7.0, including the unchanged ranking threshold. Multiplexer tests were skipped because the minimal VM lacked tmux/screen; those tools are now installed for the next run.
- The Ubuntu canonical run at 5756f7c failed the report assertion, two missing-tool fixtures, mise timestamp assertion, provider installer availability assertion and the unchanged suggestion timing threshold. The timing test passed an isolated rerun; the final canonical gate must pass before publication.
- Typecheck and canonical verification of published #348: passed; exact Actions head `684a3fbc837be97f185cc938f4fb13cbccf1533b`.
- Queue candidate canonical verification passed before the additional attach privacy finding; that later failed run
  is retained and must be superseded by a clean final run before pushing #357.
- Ubuntu 24.04 arm64 / Fish 3.7.0 / Node 26.10.0: published queue baseline fails both original Fish read tests; fixed
  snapshot passes `inputAwarenessLive`, `typingAfterRead`, `queryOrder`, `commandQueueLive` including detach,
  interruption, same-shell grouping and narrow/NO_COLOR/Safe presentation. Ubuntu amd64 CI remains an independent gate.
- Focused report/diff sanitization, hostile pin rendering, clip/paste staging, recipe review, history pinning, failure
  keys, clipboard failure/EPIPE/size bounds, and actual stand-in clipboard diff bytes passed.
- Live Report cancellation and actual clipboard bytes passed on macOS and in the Ubuntu canonical run at 5e45e87 with hostile controls, invisible Unicode, tokens and fence content.
- Early full local runs inherited disabled colors/dumb TERM and one hit ENOSPC. They are failed runs, not evidence
  of passing behavior. Final fixture runs explicitly set their truecolor environment; explicit NO_COLOR tests remain.

## Cross-track boundary and remaining work

[Native/workspace handoff PR #385](https://github.com/raiseCatError/notMyShell/pull/385) documents the current
independent heads and remaining frontend wiring. It explicitly waits for the #359 stabilization checkpoint.
Do not modify its handoff or branches. Ruby/PHP duplication is security-patched locally; reconcile against canonical
#370 after its verified freeze, retaining module diagnostics, theme imports and independent workflow behavior.

The overlap is localized and deliberately retained until the canonical native heads are frozen:

| File | Integration decision |
| --- | --- |
| `src/context/capabilities/runtimes.ts` | #368's duplicate Ruby/PHP remains patched by `18e94d9`; take canonical #370's stronger runtime implementation at integration |
| `src/context/packs/builtin/nmsh.project.json` | take the highest frozen native stack's catalog once, not both variants |
| `tests/contextCapabilities.test.ts` | preserve workflow-independent tests; retain malicious-whitespace/declaration regressions and canonical runtime tests |
| `tests/moduleManager.test.ts` | reconcile expected catalog contents with the highest native stack, preserving workflow diagnostics |
| `docs/design/native-module-coverage.md` | retain #368's coverage research; update adoption status against the exact integrated native heads |

No destructive revert of the published runtime commit is needed. Removing the duplicate before the native handoff
would remove currently tested functionality from the standalone workflow PR; resolve these known file overlaps on
the acceptance integration branch while preserving both security regressions. #370 owns additional install-layout
support in `services.ts`, which this track has not changed.

Next: complete final canonical verification and exact-head GitHub CI for every owned PR, then publish the frontend freeze checkpoint in #359. Acceptance integration follows both freezes in a separate `integration/nmsh-acceptance-*`
branch/worktree; no master/release merge is authorized.

Physical QA must cover Ghostty and Terminal.app, hidden input and immediate typing after completion/interrupt,
queue/paste approval, clipboard/report/diff rendering, long-output folding, references, narrow/Safe/NO_COLOR,
reattach, vocabulary and theme previews. Headless fixtures are not physical validation.

---

## Historical records (superseded; retained for context)

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
| `feature/command-queue` | `../notMyShell-command-queue` | #357 (draft, base #348) | complete; full verify green when the machine is not saturated |
| `feature/copy-selection` | `../notMyShell-copy` | #358 (draft, base #357) | copy selection, picker, settings, sticky controls, Smart folding fix |

| `feature/copy-report` | `../notMyShell-report` | #360 (draft, base #358) | Copy as Report; security fixes below |
| `feature/compare-output` | `../notMyShell-compare` | #361 (draft, base #360) | Compare output; contains #360 by merge |

| `feature/expressive-activity-vocabulary` | `../notMyShell-activity` | none yet (PR body ready; opening it was held) | #362: Expressive/Classic wording, 663 curated pairs; contains #361 by merge; full suite green |
| `feature/output-references` | `../notMyShell-references` | none yet | #353 references + failure navigation; #354 paste batches, `/ps`; #355 queue conditions, pins, recipes (separate commits); contains #361 |

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

## Security acceptance (#363), checked against current heads

Verified fixed or not reproducible: parser/redaction differential (skeleton matching with span mapping), token
splitting by zero-width, combining and full-width characters, bidi controls inside key names, private paths,
URL credentials, auth headers, report fence sizing, editing (edited text is rescanned and labelled as not redacted).

Found and fixed in this session (unit tests in `tests/compareSecurity.test.ts` and `tests/copyReport.test.ts`):

| Finding | Fix |
| --- | --- |
| `c` copied the raw unified diff: escape bytes, bidi and invisible characters from program output reached the clipboard | `copyableDiff` applies the report character policy |
| `c` gave no hint that the copy was not reviewed or redacted | the note says what looks sensitive and points to `r` |
| Comparison report fence was sized before invisible characters were removed; hidden characters or U+2028 could close it | the diff is cleaned first, then the fence is sized |
| Side labels (command text) sat in single-backtick inline code | `inlineCode` sizes its delimiter and folds to one line |
| Report `Directory`/`Status` facts accepted line breaks and backticks | folded to one line, directory as `inlineCode` |

Remaining limits: redaction is pattern based; secrets with no recognisable shape or context are not found.

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

## Issues

Epic #359. Slices: #350 folding/copy (fixed in #358), #351 report, #352 compare, #353 references and failure
navigation, #354 paste batches and clipboard, #355 pins/recipes/queue conditions, #356 Fish type-ahead flake.

## Next

1. (done) Stack pushed; draft PRs #357, #358; issues filed.
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

## Session 2 checkpoint (branches pushed, no PRs opened by this session)

- `feature/expressive-activity-vocabulary` (#362): full suite green (2227 pass). PR body ready; `gh pr create` was held by the safety hook, so open it with base `feature/compare-output`.
- `feature/output-references`: full suite green after fixing three deterministic count/registry tests (see last commit).
- Security: the batch splitter got three review rounds; it is now gated by real-shell parse checks (`pasteBatchCheck.ts`) and a whole-versus-split execution differential test. `displaySafe` now shows bidi/format characters.
- Not done: clipboard-change suggestions and ephemeral clips (#354), pin from history selection (#355), #365 explain/timings, #304 import, #366 decisions, native runtime modules (matrix in `docs/design/native-module-coverage.md`), workspace work (#330), physical QA for everything.
- CI: Ubuntu Fish live tests (`read` hand-over, alt-screen passthrough) time out on #357/#358 runs; they pass locally on macOS. Tracked under #356; needs a Linux repro.

Investigation checkpoint: diagnostic-only `fix/workflow-less-reattach-probe` / `b0673ad` inherits Report `0d092ac`. Unchanged local lifecycle and bounded real-program controls passed, as did focused and full canonical verification of the identical diagnostic source. Comprehensive [diagnostic CI 38474559278](https://github.com/raiseCatError/notMyShell/actions/runs/38474559278) passed every required job on `b0673ad`, attempt 1. Only failure observations were added; production/assertions/deadlines are unchanged. Original Report remains failed and later promotion/freeze held; all three bounded affected three-worker controls passed with strict cleanup. Candidate-only canonical driver `61566` verifies Vocabulary then References sequentially, without publication.

Current References candidate `b43b2559be489e7e4022b17ad15ce34038317793` passed focused report/compare adversarial and real-PTY clipboard stand-in tests, benchmark typechecking and bounded timing smoke. These exact candidate results are preserved under `verification/`; final published-head security reconciliation, full canonical and current Linux/Fish 3.7 remain required. They do not claim physical clipboard or terminal QA.

The published `5053677` source family completed all seven exact-head macOS canonical gates. Compare `4b25770`, Vocabulary `0dbd527` and References/Elm `b43b255` fix refs were checkpointed by guarded atomic nonforce push; original later feature heads remain unchanged. Comprehensive candidate CI passed every required job on attempt 1: [Compare 38478806738](https://github.com/raiseCatError/notMyShell/actions/runs/38478806738), [Vocabulary 38478810115](https://github.com/raiseCatError/notMyShell/actions/runs/38478810115), [References 38478813450](https://github.com/raiseCatError/notMyShell/actions/runs/38478813450). Exact `b43b255` full Linux canonical/Fish 3.7.0, exact `0dbd527` sibling/lifecycle and three-worker Keep Awake/tool checks, and official Node 22.23.3 curated verification passed. The owned VM stopped normally afterward. Expected optional/platform skips remain explicit in the logs; these runs are not physical terminal QA.

**New confirmed frontend lifecycle blocker:** `run()` registered an anonymous process-exit callback and `stop()` did not release it. Each stopped frontend remained referenced by that callback during CLI session switching. A regression against unchanged production failed because an anonymous callback remained after stop; the unrelated owner callback remained intact. Commit `e601829983f90ee75453715228141a2dd376bc78` on `fix/workflow-cedar` gives the existing cleanup function an instance-owned identity and unregisters only that callback on stop. Its active-exit terminal restoration body is unchanged; journal durability and signal/helper ownership are preserved. Affected lifecycle regressions, fast build/core verification and explicit repository-option strict test typechecking pass. Earlier incomplete standalone compiler/API invocations are preserved separately and are not source errors. Fresh exact-head canonical and candidate CI now pass, with publication and downstream state recorded in the current checkpoint above. This bug does not attribute the earlier macOS less/spawn/retained-worker failures. The original failed Report CI remains retained and unattributed; newer final heads require their own acceptance gates.
