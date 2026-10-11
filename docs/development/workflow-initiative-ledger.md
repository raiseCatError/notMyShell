# Workflow initiative ledger

Canonical tracker: [#359](https://github.com/raiseCatError/notMyShell/issues/359). Updated 2026-10-11.

## Current stabilization checkpoint

The shared frontend is **not frozen**. This record supersedes the historical status claims below. No workflow PR
has been merged to master or the release branch. Physical terminal QA remains outstanding.

| PR | Published branch/head at audit | Current evidence |
| --- | --- | --- |
| #345 | `release/v0.18.0` / `7122468` | unchanged stack base |
| #348 | `feature/input-awareness` / `684a3fb` | canonical local verification passed; [Actions 38122464924](https://github.com/raiseCatError/notMyShell/actions/runs/38122464924) green (Ubuntu/macOS shards, quality, Node 22); follow-up attach privacy fix pending |
| #357 | `feature/command-queue` / `7fb6b5a` | original Ubuntu Fish failures reproduced; local candidate `97e4270` contains reader/native-group and reattach privacy fixes; final canonical verification running |
| #358 | `feature/copy-selection` / `790fd74` | waiting for upstream propagation |
| #360 | `feature/copy-report` / `afe7f69` | waiting for upstream propagation and final clipboard acceptance |
| #361 | `feature/compare-output` / `b1cdfbe` | waiting for upstream propagation and final comparison acceptance |
| #367 | `feature/expressive-activity-vocabulary` / `66e164d` | sibling of #368; final lifecycle audit pending |
| #368 | `feature/output-references` / `5a795ed` | original CI includes independent paste, guide and fixture failures; local security commit `18e94d9`, workflow additions under verification |

Owned isolated branches/worktrees: `fix/workflow-input-checkpoint` (`nmsh-astra-input`),
`fix/workflow-fish-routing` (`nmsh-astra-queue`), and `fix/workflow-acceptance` (`nmsh-astra-workflow`). Existing
worktrees and tracked modifications were preserved. Published updates are additive; the #348 checkpoint was
merged into the queue candidate without rewriting history.

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
  probing/journaling; full verification is pending. Key diagnostics now exclude all running/startup input.
- **Gemfile security:** `18e94d9` applies the bounded single-line Ruby declaration parser to the duplicate in #368.
  Malicious-whitespace and cross-line declaration regressions pass. #370 remains the canonical runtime owner.
- **Workflow additions (uncommitted):** clips deliberately kept in bounded frontend memory, reviewed through the
  existing Paste Review/palette, history selection pinning with recorded cwd, and F8/Shift+F8 failure navigation.
  Copy/folding remain independent. Clip and reference actions never submit commands automatically.
- **Clipboard suggestions (local candidate):** off by default and frontend-only. macOS uses only NSPasteboard changeCount
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

## Verification recorded so far

- Typecheck and canonical verification of published #348: passed; exact Actions head `684a3fbc837be97f185cc938f4fb13cbccf1533b`.
- Queue candidate canonical verification passed before the additional attach privacy finding; that later failed run
  is retained and must be superseded by a clean final run before pushing #357.
- Ubuntu 24.04 arm64 / Fish 3.7.0 / Node 26.10.0: published queue baseline fails both original Fish read tests; fixed
  snapshot passes `inputAwarenessLive`, `typingAfterRead`, `queryOrder`, `commandQueueLive` including detach,
  interruption, same-shell grouping and narrow/NO_COLOR/Safe presentation. Ubuntu amd64 CI remains an independent gate.
- Focused report/diff sanitization, hostile pin rendering, clip/paste staging, recipe review, history pinning, failure
  keys, clipboard failure/EPIPE/size bounds, and actual stand-in clipboard diff bytes passed.
- Live Report cancellation and actual clipboard bytes passed on macOS with hostile controls, invisible Unicode,
  tokens and fence content; Linux execution of this new regression is pending.
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

Next: finish attach privacy verification, propagate fixes through each published workflow branch, verify security
and grammar acceptance on #368, audit vocabulary/theme/diagnostics/tool decisions, then publish an exact-head CI
checkpoint in #359. Acceptance integration follows both freezes in a separate `integration/nmsh-acceptance-*`
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
