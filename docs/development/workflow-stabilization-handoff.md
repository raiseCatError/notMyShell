# Workflow stabilization handoff — 2026-10-12

Canonical initiative: [#359](https://github.com/raiseCatError/notMyShell/issues/359).
This is a preservation checkpoint, **not release acceptance or a frontend freeze**.
Development and verification were stopped at the user's request. No new full suite
was started for this handoff. No PR was merged, no shared history rewritten, and no
protected worktree modified.

## Commands to run first

Read this file, workflow-initiative-ledger.md and current issue/PR discussion.
GitHub heads can advance; these tables are checkpoint observations.
Recover this file from origin/fix/workflow-maple after fetching.

~~~sh
git status
git branch -vv
git worktree list --porcelain
git remote -v
git fetch origin
git show origin/fix/workflow-maple:docs/development/workflow-stabilization-handoff.md
gh issue view 359 --repo raiseCatError/notMyShell --comments
gh issue view 356 --repo raiseCatError/notMyShell --comments
gh pr view 385 --repo raiseCatError/notMyShell
gh run view 38157687343 --repo raiseCatError/notMyShell --log-failed
~~~

Use an isolated worktree, never develop in the main checkout. On this host, temporary
files, caches, VM disks and new worktrees belong on T7 Shield. Use neutral tree/color/
fruit names and project commits without authorship trailers. Preserve other owners'
worktrees, including their names and stale registrations.

Main checkout is clean on feature/status-strip-2 at
7916f2e160e713878db9fbe52b2fbb126a3b698c (ahead one, preserved).

## Owned checkpoint branches and worktrees

All eight trees were clean after acceptance commit 5447eb9, before this documentation.
Each is published under the identical neutral remote name. The Maple SHA below is
its implementation base; the final branch tip additionally contains this documentation.
Use the #359 comment/remote ref for the documentation commit's SHA.

| Branch | Implementation/checkpoint SHA | Worktree |
| --- | --- | --- |
| fix/workflow-amber | 000736ddc47e78d322d2ba6ff83fd4e205c7ca26 | /Volumes/nmsh-t7/nmsh-amber-copy |
| fix/workflow-birch | 3adc4515a10e9f7a3af958683b1f389522fc0119 | /Volumes/nmsh-t7/nmsh-birch-queue |
| fix/workflow-cedar | 48a0ded6a9eecaca6753300ea33785d05e08f4db | /Volumes/nmsh-t7/nmsh-cedar-input |
| fix/workflow-coral | 80bd0cfaf3cabd0b36229317372e16995cbd0505 | /Volumes/nmsh-t7/nmsh-coral-report |
| fix/workflow-elm | 5447eb9e8a33f4496bd2f06c175b0a5f1c390cb6 | /Volumes/nmsh-t7/nmsh-elm-acceptance |
| fix/workflow-indigo | 0117a3439b05b1e4dab933e9da31c4fb795ef24a | /Volumes/nmsh-t7/nmsh-indigo-compare |
| fix/workflow-maple | e942523f3f352cc766c94eddfcc61e775a60df3d | /Volumes/nmsh-t7/nmsh-maple-workflow |
| fix/workflow-willow | be037a0861546705687bc4d633d4281e50fedf46 | /Volumes/nmsh-t7/nmsh-willow-vocabulary |

Elm contains **incomplete acceptance regressions** at
5447eb9e8a33f4496bd2f06c175b0a5f1c390cb6, based on Maple e942523.
It is not merged into Maple or any published feature PR.
Maple and Willow are independent siblings above Indigo.

Older local fix/workflow-*-checkpoint and *-resume refs are recovery history, not
active branches. All workflow stabilization commits reachable from those old refs
must remain recoverable; check ancestry before cleaning anything.

## Published workflow PRs

| PR | Published branch | Exact published head | Base |
| --- | --- | --- | --- |
| #345 | release/v0.18.0 | 7122468f0550f415ab6041cce94abda3a9fb6fa1 | master |
| #348 | feature/input-awareness | 48a0ded6a9eecaca6753300ea33785d05e08f4db | release/v0.18.0 |
| #357 | feature/command-queue | 7fb6b5ac23aeecc21e7a0d7ba5b824af95f505aa | feature/input-awareness |
| #358 | feature/copy-selection | 790fd740cc607cbf6e834bd01501006fa9183f82 | feature/command-queue |
| #360 | feature/copy-report | afe7f695ef803d0de11f53afd540f0a24d992a01 | feature/copy-selection |
| #361 | feature/compare-output | b1cdfbe9c28e7af58f5a181a51922f103f520bf5 | feature/copy-report |
| #367 | feature/expressive-activity-vocabulary | 66e164d973fab278823f773036800d9c6b0fd6a3 | feature/compare-output |
| #368 | feature/output-references | 5a795ed6214bbbb43223e6625cd15d552b84466e | feature/compare-output |

Only #348 received the current input candidate. Other feature PRs retain old published
heads; candidate work is preserved on the neutral checkpoint refs, without opening
new PRs or dispatching CI. Do not claim those feature PRs contain candidate fixes.

Dependency order: #345 → #348 → #357 → #358 → #360 → #361;
**#367 and #368 are siblings** based on #361. Preserve additive merge history.

Related issues/ownership: #348 input; #357 queue; #358 copy selection/picker/sticky/
folding; #360 report; #361 comparison; #367/#362 vocabulary; #368/#353–#355 references,
failure navigation, staging/clips, pins/recipes/conditions; #356 Fish; #363 security;
#365 existing diagnostics; #304 theme imports; #366 integrations; #359 coordination.
Manual acceptance remains outstanding; do not close issues from headless results.

## Implemented work and limits

- **Input:** authenticated Fish fish_read markers hand over before native reader prompts,
  including hidden/function/detached readers. answersByDefault was not weakened.
  Same-shell grouping uses Fish begin/end or zsh/Bash braces and explicit shell identity.
  Attach privacy protects input before passthrough/probe/journal delay; key diagnostics
  exclude startup/running input. Real PTY regressions cover private input and reattach.
- **Fish 3.7 parsing:** no-config/no-execute script via -c avoids socket-backed stdin's
  “Unable to read input file: Is a directory”; oversized argv refuses splitting. Sentinel
  regressions prove no commands/substitutions execute.
- **Security:** authored report/diff/reference/pin UI boundaries cover hostile controls,
  bidi/invisible format characters, restored labels and Markdown fence/link/status
  injections. Final clipboard bytes use stand-in clipboard programs; review/cancellation
  and copy failure cases have evidence. Report status uses delimiter-sized inline code.
  Secret scanning remains best-effort. Raw program output remains raw.
- **Workflow:** bounded ephemeral clips (12 entries / 1 MiB), explicit review, history
  pinning with recorded cwd, F8/Shift+F8 factual failure navigation. Opt-in macOS idle
  suggestions query clipboard changeCount only; contents require explicit /ps. Linux
  metadata counter unsupported/fails closed. No derived command auto-executes.
- **Vocabulary:** stable per-command pairs and optional validated journal indices survive
  live reattach; previous-pair collision avoidance retained. Failure/interruption/wait
  are factual. Expressive default and Classic persistence retained; archived/copy/report
  wording stays factual.
- **Imports:** bounded static Starship TOML and Oh My Posh JSON/YAML/TOML mappings,
  unsupported/lossy disclosure, preview and second explicit save; no provider-source
  rewrites, template execution or parallel theme engine.
- **Diagnostics:** availability, source/trust, TTL/invalidation/demand/cache state, safe
  failure and measured collector wall time excluding queue delay. Reading details adds
  no collectors. Short panels scroll via arrows/PageUp/PageDown, preserving draft and
  settings. **Exact last-frame width-compaction decisions remain unimplemented.**
- **Runtime duplicate:** workflow Gemfile parser bounded at 18e94d9, retaining hostile
  whitespace/cross-line regressions. #370 owns canonical native additions. Old published
  #368 still lacks candidate fixes; no native catalog expansion was performed here.
- **Verification infrastructure:** explicit external temp roots fail closed; private child
  HOME. Completion expiry/recovery retains production deadlines. Fixtures wait for
  authenticated startup and foreground process ownership, replacing fixed holding sleeps.

See the canonical ledger, fish-typeahead.md, workflow-physical-qa.md and linked issues
for individual fixing commits/design. These features are implemented, but **the whole
stack lacks final exact-head canonical/CI acceptance**.

## Exact commands and results

Host: macOS arm64, Node 26; one worker with own Linux VM stopped.
The suite supplies private child HOME. Do not alter personal/provider config.

~~~sh
export TMPDIR=/Volumes/nmsh-t7/t TMP=/Volumes/nmsh-t7/t TEMP=/Volumes/nmsh-t7/t
export NMSH_TEST_TMPDIR=/Volumes/nmsh-t7/t
export XDG_CACHE_HOME=/Volumes/nmsh-t7/cache/xdg
export npm_config_cache=/Volumes/nmsh-t7/cache/npm
export TERM=xterm-256color COLORTERM=truecolor NMSH_TEST_CONCURRENCY=1
unset NO_COLOR
npm run verify
~~~

Canonical verification builds/typechecks source, runs canonical tests plus separate
ranking and checks diffs. Counts are historical evidence for these runs, not a fixed
project test total.

| Exact source head | Command and result |
| --- | --- |
| Cedar 48a0ded6a9eecaca6753300ea33785d05e08f4db | npm run verify PASS; runtime 2149 passed, 0 failed/skipped; ranking 8 passed; cleanup gate passed; runtime 648807.530084 ms |
| Birch 3adc4515a10e9f7a3af958683b1f389522fc0119 | npm run verify PASS; runtime 2176 passed, 0 failed/skipped; ranking 8 passed; cleanup gate passed; runtime 769361.74225 ms |
| Amber 000736ddc47e78d322d2ba6ff83fd4e205c7ca26 | npm run verify FAIL; runtime 2200 passed / 3 failed / 0 skipped; ranking 8 passed; runtime 948723.419 ms |
| Coral 80bd0cf / Indigo 0117a34 / Willow be037a0 / Maple e942523 | Final host canonical NOT RUN: serial loop stopped at Amber |
| Elm 5447eb9 source | Focused command below FAIL: 15 passed / 4 failed / 0 skipped; 92825.112 ms. Run preceded commit; commit preserves the same files |
| Maple diagnostics 52db115 | npm run typecheck PASS; focused moduleManagerUx/moduleExplain/moduleManager/moduleDiagnosticsLive: 25 passed; npm run verify:fast PASS (67 focused tests) |

Current verification was finished before preserving Elm. **No new suite was launched
for this handoff**. Exact last focused command with the environment above:

~~~sh
node /Volumes/nmsh-t7/run-selected.mjs "$PWD" \
  tests/queueConditionOwnershipLive.test.ts tests/queueConditionsLive.test.ts \
  tests/outputReferencesLive.test.ts tests/historyReuseLive.test.ts \
  tests/compatibilityHarness.test.ts --test-reporter=spec
~~~

Local helper imports cwd's scripts/test.mjs, validates selected file existence, calls
runTestFiles and returns its exit code. Passing files to scripts/test.mjs directly
does not focus tests. Cloud equivalent (do not run until development resumes):

~~~sh
node --input-type=module -e "
import {runTestFiles} from './scripts/test.mjs';
process.exitCode = (await runTestFiles([
'tests/queueConditionOwnershipLive.test.ts', 'tests/queueConditionsLive.test.ts',
'tests/outputReferencesLive.test.ts', 'tests/historyReuseLive.test.ts',
'tests/compatibilityHarness.test.ts'
], ['--test-reporter=spec'])).code;"
~~~

### Elm acceptance failures — preserved, not fixed

1. outputReferencesLive.test.ts:72: “timed out waiting for the original composer draft
   executes only on its explicit Enter”. Earlier restored navigation/reference copy
   assertions passed; final draft submission timed out. Cause unestablished.
2. queueConditionOwnershipLive.test.ts:110, zsh/Bash/Fish: “AssertionError: NO_COLOR
   stays plain”. Expected no ESC[38;[25]; in output slice; actual has
   ESC[38;2;242;240;236m and other colors in restored command/status rows.
   Approval/failure/interrupt checks reached this assertion; subsequent transcript/cwd
   assertions were **not reached**. Establish restored ANSI vs live rendering/fixture
   boundary before changing product or checks.
3. historyReuseLive passed; existing queueConditionsLive passed across all three shells.
   Every compatibilityHarness case passed in this focused rerun.

### Amber full-suite failures — remain failed evidence

- Agent fixture clean-exit ownership: disposal timed out; four lsof ownership probes
  ETIMEDOUT at 2120/2357/3002/2287 ms. Frontend PID 8730 already dead, sockets empty,
  ownership still unproven.
- Nested fixture clean-exit ownership: same failure, five ETIMEDOUT probes at
  2007/2041/2059/2041/2047 ms; frontend PID 8978 dead, sockets empty.
- Canonical inline restoration: startup /❯/ deadline expired after 20184 ms; zero
  frontend output bytes; PID 9277 alive. No prompt/test command executed.

8 GiB / 8 CPU host had unrelated Xcode/xctest/Shortcuts/Docker work; load reached
34.51/16.34/11.29 during failure. Their processes were preserved.
**Scheduling/resource effects are suspected, not confirmed flakes.** A passing focused
rerun does not erase failed canonical evidence. Do not weaken deadlines or ownership
checks. Disposal may mask body assertions; preserve both errors during investigation.

### Current input GitHub CI

[Actions 38157687343](https://github.com/raiseCatError/notMyShell/actions/runs/38157687343)
at 48a0ded6a9eecaca6753300ea33785d05e08f4db: **FAIL**.

- Ubuntu both shards, macOS shard 2/2, Quality Node 26 and Node 22 compatibility passed.
- macOS shard 1/2 failed tests/flowComposer.test.ts: “Bottom and Top keep their existing
  behavior: typing does not change the scrolled view”, Error: posix_spawnp failed.
  Stack: node-pty UnixTerminal → ShellSession → InProcessSessionClient → TerminalApp →
  flowApp line 88 → test line 163. Cause not investigated at checkpoint.
- Command: npm test -- --shard=1/2 --test-timeout=120000, after npm run build.
- Aggregate CI failed. Verify 26 failed / Verify 22 cancelled at aggregate-success gate;
  these wrappers are not independent test failures.
- Timing/Fedora skipped on PR event.
- Older 86fb4e4 had green [38150534791](https://github.com/raiseCatError/notMyShell/actions/runs/38150534791).
  Historical green does not establish the current head.
- Remaining checkpoint refs lack final exact-head CI. Neutral checkpoint-only pushes
  do not match master/dev push filters; no PR or dispatch was created.

### Linux/Fish evidence

Ubuntu 24.04 arm64 / Fish 3.7.0 / zsh 5.9 / Bash 5.2 / Node 26.10.0:
original queue baseline reproduced both Fish reader failures. Fixed input/read/query/
queue PTY focused cases passed, including detach, interrupt and narrow/NO_COLOR/Safe.

Full workflow 5e45e87 canonical PASS: runtime 2327 passed, 15 platform/missing-mux skips;
ranking 8 passed. Later 895aae5 full run failed third-shell SIGHUP startup readiness,
while ranking and tmux/screen passed. Controlled 48a0ded correction passed focused and
host canonical; **new full Linux verification remains pending**.

Earlier 5756f7c failed literal report expectation, missing less/vim, unchanged mise
stat metadata, host installer fixture and unchanged timing threshold. Corrections/
isolated timing rerun are recorded in the ledger. They are not current-head acceptance.
less/vim and tmux/screen are now installed in the owned VM.

### Evidence remaining local on T7

Under /Volumes/nmsh-t7/verification/:

- cedar-input-48a0ded6a9eecaca6753300ea33785d05e08f4db-canonical.log
- birch-queue-3adc4515a10e9f7a3af958683b1f389522fc0119-canonical.log
- amber-copy-000736ddc47e78d322d2ba6ff83fd4e205c7ca26-canonical.log
- elm-acceptance-checkpoint-focused.log
- checkpoint-input-ci-failed.log and checkpoint-input-ci-jobs.json
- host-stack-canonical-progress.log
- birch-ownership-lifecycle-navigation.log (34 focused passed)
- birch-queue-gates-focused.log (4 focused passed)
- cedar-session-startup-gate-focused.log (1 focused passed)
- maple-detail-typecheck.log, maple-detail-focused-final.log, maple-detail-fast.log.

Raw logs, node_modules, selected runner and VM are **local only**. Important commands,
assertions/results and failures are copied here for GitHub/cloud recovery. Fresh
sessions must not depend on local caches or hidden conversation.

## #356, #359 and shared frontend boundaries

[#356](https://github.com/raiseCatError/notMyShell/issues/356) remains open. Confirmed
Fish reader ownership and parse transport fixed in checkpoint ancestry. Immediate
input after read/interrupt, fullscreen and privacy acceptance must remain green on
final heads. Current CI failure is macOS PTY spawning, not a Fish failure diagnosis.

[#359](https://github.com/raiseCatError/notMyShell/issues/359) remains open.
TerminalApp.ts remains exclusively owned by workflow stabilization. **No frontend freeze**.
Native/workspace shared wiring awaits explicit verified #359 freeze; do not integrate
unfinished heads.

Interfaces to preserve: authenticated Fish reader/terminalOwner; explicit shell ID in
grouping/parse/queue; privacy protection before passthrough/journal I/O; optional validated
journal activity indices; reserved F8/Shift+F8; diagnostics hasValue/renderer condition
metadata and ephemeral detail viewport. Inspect actual code before conflict resolution.

## Protected native/workspace branches

Use [PR #385](https://github.com/raiseCatError/notMyShell/pull/385)'s separate handoff.
Protected heads advanced during this checkpoint. These observed heads supersede our
old manifest, not that track's ownership documentation. No edits to protected worktrees/
branches. Functional provider names in existing branch names are not authorship.

| PR | Protected published branch | Exact observed head | Base |
| --- | --- | --- | --- |
| #369 | feature/action-controls | 85ab93026e564b4f763e63d63a4326487e118032 | release/v0.18.0 |
| #370 | feature/native-runtimes | 417d105e3f513e36bf35d0efb7c0b79574a31f9b | release/v0.18.0 |
| #372 | feature/runtimes-elixir-dart | 72775e6aea273f71cb2ddf402cdb7952c0740c95 | feature/native-runtimes |
| #373 | feature/project-build-module | 029fac47d0007336d6829e9f7c9aaead62e5670d | feature/runtimes-elixir-dart |
| #374 | feature/vcs-hg-jj | d7d348886d008a7a70ffac3df2fa46daea9cf3e1 | release/v0.18.0 |
| #375 | feature/workspace-foundation | 111af0daf15bce06ea10645b56eab50ca239ccab | release/v0.18.0 |
| #376 | feature/workspace-sidebar | 955d29f292d99494fa0acaa7db65c8eaa6bd807e | feature/workspace-foundation |
| #377 | feature/workspace-panel | f5ef4b2da679f6c56dfd3b3bc5df114f8fd00968 | feature/workspace-foundation |
| #378 | feature/semantic-keymap | 1dc8a24177ed8a2d643c3061d4e88257d4b76b19 | feature/workspace-foundation |
| #379 | feature/portable-mod-gate | fccf68eabc0aaacbd771a3cea9a17d5b13ad66b1 | release/v0.18.0 |
| #380 | feature/codex-app-server-adapter | 8854bb78629acdb1fbaa3e8390b6b9d366724857 | release/v0.18.0 |
| #381 | feature/worktree-pr-evidence | 8a40b76aa3317e85d1525bb6b506e2b6e2470892 | release/v0.18.0 |
| #383 | feature/background-tasks-core | 4b9685d37f6ffffa8a1dba8d8614b1e52d2374ef | release/v0.18.0 |
| #384 | feature/background-task-ui | 85ac4210faf6de804729a8e8b7dc724aa12b9b8e | feature/background-tasks-core |
| #385 | docs/context-workspace-handoff | c9a368663fc334304f6631f664bbdf5e5459dc59 | release/v0.18.0 |

Protected worktree paths come from git worktree list --porcelain; their checked-out
heads may lag GitHub. Do not update them. PR #385's description calls published #368's
Gemfile parser quadratic; Maple's candidate already contains bounded fix 18e94d9.

Known retained Ruby/PHP overlap:

| File | Integration decision |
| --- | --- |
| src/context/capabilities/runtimes.ts | Prefer canonical #370 implementation/security fix, retain regression intent |
| src/context/packs/builtin/nmsh.project.json | Take highest frozen native catalog once |
| tests/contextCapabilities.test.ts | Preserve workflow tests and both malicious whitespace/declaration regressions |
| tests/moduleManager.test.ts | Reconcile catalog expectations, preserve diagnostics |
| docs/design/native-module-coverage.md | Preserve research and update adoption |

#370 owns install-layout services.ts changes; workflow did not edit those.
Do not revert unrelated #368 diagnostics/imports/docs to remove duplication.
Shared frontend conflicts are resolved only after both freezes.

## Recommended next development steps (separate authorization)

1. Audit current heads/issues/ownership, read protected handoff. Use isolated neutral
   external worktrees; leave main checkout and others' trees untouched.
2. Focused investigation of current input flowComposer spawn failure and Amber
   startup/disposal. Preserve body and cleanup errors; no deadline/security weakening.
3. Review Elm 5447eb9: draft/palette context and restored NO_COLOR. Checkpoint intentionally
   incomplete, not release-ready.
4. Complete remaining host exact-head canonical, exact-head Ubuntu/Fish full verification
   including installed tmux/screen, source/benchmark typecheck and timing smoke.
   Serialize own host tests with own VM stopped; preserve unrelated processes.
5. Propagate fixes additively up original stack and into both siblings independently.
   Merge corrected Elm acceptance into Maple deliberately. Verify coherent final heads
   then publish to original feature refs; report actual exact-head CI and update PRs.
   No force-push/rebase. Timing/Fedora need applicable final verification event.
6. Publish explicit #359 freeze only after workflow gates, with exact heads/interfaces.
   Native/workspace track must separately freeze and document final frontend wiring.
7. **After both freezes**, dedicated external integration/nmsh-acceptance-* branch/tree,
   based on verified workflow tip. Merge Willow sibling; highest native ancestry once
   (currently #373 includes #372/#370); independent #374/#369; highest workspace
   foundation ancestry once then independent sidebar/panel/keymap; #379/#380/#381;
   highest background UI ancestry once (#384 includes #383). Recheck ancestry and
   protected handoff order/contracts at integration time; never merge ancestry twice.
   Resolve runtime/shared-frontend conflicts preserving both security fixes.
8. Full cross-feature acceptance on integration branch. Never merge master/release or
   tag/publish. Physical Ghostty/Terminal.app QA remains required; workflow-physical-qa.md.

### External storage / VM recovery

APFS image lives physically on external ExFAT T7:

~~~sh
hdiutil info
# Only if owned image is absent:
hdiutil attach -nobrowse -owners off -mountpoint /Volumes/nmsh-t7 \
  "/Volumes/T7 Shield/nmsh-maple-scratch.sparsebundle"
~~~

Do not unmount active storage or delete others' files. Owned Lima cedar-fish37 confirmed
**Stopped**. Binary /Volumes/nmsh-t7/maple-linux/bin/bin/limactl;
LIMA_HOME=/Volumes/nmsh-t7/maple-linux/state. Guest temp/cache physically on T7.

Prepared maple-source-readiness.git and verify-readiness.sh snapshot e942523, **not Elm**
or this doc commit; no new run performed. Refresh an immutable snapshot after changes
rather than resetting a running guest checkout.

## Deferred / manual

#366 retains optional supported Atuin/fzf/Television/zoxide/bat/delta paths. Pueue/Yazi
dedicated contracts deferred; native queue remains same-shell sequential. Embedded Gum
rejected; ordinary passthrough retained. Dedicated bat source-preview launching not
implemented. See recorded integration decisions.

Physical QA outstanding: hidden input/immediate typing, Ctrl+C/Z, alternate-screen,
exact queue approval/detach, clip lifecycle/history pins, host clipboard success/failure,
hostile report/diff, narrow/NO_COLOR/Safe, long output/folding, vocabulary/resume,
theme preview/save and diagnostics scroll. No personal config changes or physical QA
were claimed.

All implementation and incomplete acceptance source is recoverable from the eight
checkpoint refs. Final verification/CI/freeze/integration remain incomplete.
