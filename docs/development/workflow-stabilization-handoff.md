# Workflow stabilization handoff — 2026-10-13

Canonical tracker: [#359](https://github.com/raiseCatError/notMyShell/issues/359).
**Frontend freeze is PENDING. No integration has begun.** This checkpoint records committed candidates and incomplete final verification, not accepted workflow heads.

The original handoff at `cc853707cf6060bc4b8edc2c84313949075c557b` remains preserved in Git at this same path. Initial inspection confirmed its eight pushed heads; no lost-work recovery or reimplementation was needed. Its historical head/failure tables are superseded by this checkpoint and current #359 updates.

## Exact source and publication state

These are candidates, not accepted heads. The published column is the last observed original feature head; verify remote refs again before changing them. Corresponding `fix/workflow-*` refs initially matched those feature heads; the verification driver may publish the new Cedar fix candidate independently for unobserved CI.

| Track | Committed local source candidate | Last observed feature head |
| --- | --- | --- |
| Input #348 | `9cfdf9a145655abe158ec66d61dc05b3acae1722` | `5206db0615c0345937455fa2cc8f1120849854ec` |
| Queue #357 | `b6fe785b3fa6c0d9dc51fcdc4c3f9dbd23074bb5` | `45a0c071ea390d8c01ad33c8eb55ab2012e40c94` |
| Copy #358 | `940b85f267f23baa4ffd331a15091354d07e899d` | `5fb68e8881fde0741cd64621a58a40e2e83677a2` |
| Report #360 | `7bf0dbeaf15d4c09a9b49bbce0eef0996efd219f` | `9fb09c975d1f4e07d34265793c78d34b7eea6cdc` |
| Compare #361 | `459d715af3e986bd92c857ac74eed03a39f90ecd` | `032365e2ffa9fd42563ae93e66fd487b41e66841` |
| Vocabulary #367 | `949a367d90b4d114c91eb74845dce660c48693c1` | `99019ae3fad1c27f8233aa53d3314116a62df355` |
| References #368 | `3518231155225e4b3130e467ede7b703f366f8a0` | `5993218d86f67e91e940b098e7259af081fdd64b` |

Elm's source branch is aligned with References at `3518231155225e4b3130e467ede7b703f366f8a0`. Its existing worktree temporarily holds `docs/workflow-oak-checkpoint` for this documentation; the source ref is preserved. Cedar → Birch → Amber → Coral → Indigo retain additive ancestry. Willow and Maple are independent siblings above Indigo; neither contains the other. Elm/Maple retain the former incomplete acceptance regressions and all subsequent corrections.

No branch/history is to be discarded. No force pushes, hard resets, destructive rebases, release/master merges, tags or releases are authorized. Main checkout remains `feature/status-strip-2` at `7916f2e160e713878db9fbe52b2fbb126a3b698c` (ahead one, preserved). Observed protected heads: master `260f614b7d4be6be7565424b79a27a6363981941`; release/v0.18.0 `7122468f0550f415ab6041cce94abda3a9fb6fa1`.

## Confirmed corrections and retained failed evidence

- Runtime socket requests validate the private owned directory before every helper connection, including list/notice/dismiss/rename/kill. Reachable insecure/symlink fake peers reproduced the refusal gap before correction; valid private peers remain supported.
- Held socket kill/detach now discard withheld output, flush the lifecycle request and drain EOF. Started clients preserve ordered final data. Controlled held/started regressions failed before correction on macOS and Node 22/Linux. The older CI worker's exact retained resource was not captured.
- Authenticated cwd reaches command snapshots before async workspace collection; older collection generations cannot overwrite newer context. Original submission directories and fact privacy policies remain intact. Project/branch facts may lag while collection is pending.
- Restored NMSh command/status rows obey the attaching frontend's NO_COLOR policy through presentation clones. Raw program SGR and stored transcript cells remain intact.
- Settled fullscreen attach restores terminal ownership before journal IO; ordinary/unsettled startup retains the durable identity barrier. Shutdown waits for persistence. Capture fixtures require an owned safe-integer PID greater than one before publication; tmux fixtures retain the host PATH.
- Explicit live-session views now refresh from validated polls while preserving session-ID selection, query, draft and command focus. Notices Off still refreshes the visible view. Failed polls retain the last validated registry; valid empty registries clear it. The unchanged live detach/read probe passes controlled repetitions. The historical Amber `5fb68e8` macOS wait and retained Ubuntu shard remain recorded failures with exact causes unproved.
- **Newest correction `9cfdf9a`:** a buffered prompt after frontend shutdown still started context work, projected a host prompt and changed cwd. Shell-free in-process/service regressions failed before the listener guard and now pass with active positive controls. Included in Node 22 selection; focused and fast/build/diff gates pass. This is independently confirmed and does not establish the cause of the older retained zsh/worker.
- Report/comparison fragments are redacted before Markdown formatting; toggles rebuild from the chosen snapshot, edits are rescanned and explicitly labelled when unredacted. Short reviews reserve reachable body rows; a height below four refuses Enter. Iterative backtick delimiter sizing preserves enclosure without argument-limit exceptions. Historical draft submission now exits both action menu and command focus before explicitly submitting once. Atomic fake clipboard publication prevents transient-empty completion assertions. Corrected bounded Ruby parsing/regressions remain on the workflow ancestry; #370 is canonical for final Ruby/PHP integration.

[Input `5206db0` CI 38286298684](https://github.com/raiseCatError/notMyShell/actions/runs/38286298684) passed Quality and macOS/Ubuntu shards but timed out Node 22 `serviceCompat.test.ts` after all bodies returned. Its retained resource remains **unattributed**. No starvation/harmless-flake classification is justified. The earlier macOS `posix_spawnp` failure and historical startup/ownership failures likewise remain recorded without fabricated causes.

Isolated diagnostic branch `fix/workflow-cedar-lifecycle-probe` preserves opt-in worker/resource/PTY signal-attempt and exit observation, never forced exit or new signals. [2510d22 CI](https://github.com/raiseCatError/notMyShell/actions/runs/38334798139) and [2eb70c7 bounded five-iteration CI](https://github.com/raiseCatError/notMyShell/actions/runs/38335262827) passed all applicable gates, including macOS/Ubuntu, Node 22, timing and Fedora. Each observed service worker and every tracked PTY child exited. Five controlled Linux arm64 iterations also passed. Observation may perturb timing; those passing snapshots do not attribute the failed unobserved feature worker. Signals are recorded as attempts because node-pty can swallow delivery errors. See the diagnostic branch's `docs/development/workflow-lifecycle-investigation.md`.

## Verification completed and still required

Cedar `5206db0`, Birch `6ed34cd`, Amber `e823bc7` and Coral `623fc81` passed host canonical verification on official Node 26.11.1/macOS arm64 with one worker/private T7 roots. Those are **pre-9cfdf9a** evidence. The old remaining-head driver was paused without interrupting Coral's test child, then resumed after additive promotion; its expected-head guard stopped obsolete continuation. It left no paused workload.

The newest source heads above require their own canonical and actual published-head CI gates. The pinned driver is `verification/verify-stopped-prompt-final-canonical.sh`, progress `post-handoff-stopped-prompt-final-canonical-progress.log`, manifest `post-handoff-stopped-prompt-final-candidates.json` on owned T7 storage. It serializes all seven heads, checks storage before each, and publishes only the canonically verified Cedar fix candidate for **unobserved** manual CI. Original feature publication remains held until appropriate actual-head gates pass. Inspect the dispatched CI URL and conclusions before promotion; do not rely on an older or observed run.

A host diagnostic invocation inherited `NO_COLOR=1` and failed color-specific goldens/Theme Bridge expectations. The failed log is retained. A one-variable preview reproduction and unchanged color-enabled Setup/Theme Bridge/monochrome selection checks passed, followed by a passing complete canonical run. No assertion, production color policy or deadline changed. Canonical color goldens use the established color-enabled baseline; explicit NO_COLOR regressions retain their own overrides.

Full latest Linux/Fish 3.7 verification remains pending. The owned `cedar-fish37` VM is stopped during host verification (Ubuntu arm64, 2 CPUs/2 GB). The offline mirror is fast-forwarded to the new source heads. Prepared pinned script: `maple-linux/verify-stopped-prompt-final-linux.sh`; it runs the full Maple canonical suite, sibling vocabulary/live checks and the Node 22 minimum-runtime suite. Do not overlap it with heavy host verification. No timeout/assertion/ranking threshold was increased.

Current-head #363 report/comparison unit and real-PTY clipboard-backend acceptance, final timing/portability evidence and exact-head CI must complete before freeze. Physical clipboard/terminal QA remains distinct. Private logs/caches/temporary roots are on `/Volumes/nmsh-t7`; do not delete other owners' resources. Last host observation: internal free about 2.9 GB, T7 free over 8 GB; per-head guards stop before internal falls below 2 GB or T7 below 3 GB. Recheck disk and competing workloads before more heavy work.

## Provisional integration boundaries — not a freeze signal

- Foreground input belongs to the persistent real ShellSession and active program; zsh/Bash brace grouping and Fish begin/end preserve native multiline semantics. Queue dispatch requires authenticated idle/readiness, pauses on failure/interruption, and withdraws exact-entry approval after edits. Detach does not auto-approve.
- Route direct human composer submission through safety/install review before any future background hook and before foreground recording. Queue dispatch, startup input and passthrough do not use that hook. Historical Enter opens actions; preserving/recalling a draft does not execute it automatically.
- Raw/program, approval, choice, search, panel and agent input ownership precede workspace/tasks. User keymap replacement wins; empty idle Up precedence is agent shelf, enabled background bar, then history. Workspace drawer focus/resize must use actual per-frame geometry.
- `screenPlan.ts` remains the shared geometry source. Plan once per frame and use the same regions for rendering, cursor, hit testing and PTY sizing. Workspace drawer hides/ceases hit testing; drawer opening does not resize the PTY; a docked drawer uses center width.
- Task output stays in a bounded task-ID view, separate from normal transcript/copy/failure/compare. Background task IDs and graceful termination remain authoritative at the session service, with bounded private IPC, feature negotiation, session membership and spawn-time environment. Do not adopt unknown/restarted processes or infer foreground shell state into fresh background processes.
- #370 `417d105e3f513e36bf35d0efb7c0b79574a31f9b` is the final Ruby/PHP module implementation; preserve its catalog/regressions instead of #368's older duplicate. Native/workspace heads were rechecked unchanged. Read #385 at `c9a368663fc334304f6631f664bbdf5e5459dc59`, `docs/development/context-workspace-handoff.md`; components remain standalone and disconnected from the frontend.

After accepted stabilization, begin a bounded nonrelease acceptance branch: reconcile the vocabulary sibling and canonical parser/catalog first, verify, then a separate geometry/focus slice, then direct-composer background submission. Do not merge the entire native/workspace backlog at once.

## Remaining physical QA

Record exact tested SHA, host/OS and shell. No physical validation is claimed here.

- Ghostty and Terminal.app, zsh/Bash 4.4+/Fish: hidden/function/key reads, immediate typing after read/interrupt, Ctrl+C/Ctrl+Z, detach/reattach, fullscreen keys, selection and resize; queue holding/failure/approval/edit and exactly-once dispatch.
- Historical Enter/action-menu/focus Escape and preserved original draft submission; rapid cwd changes followed immediately by submit/pin; folded output and FOLLOW/DETACHED navigation.
- Actual clipboard bytes for copy/report/diff, cancel preserving contents, backend failure, sensitive edits/toggles, long/narrow Unicode/control/Markdown cases. Headless stand-ins do not validate the physical clipboard.
- NO_COLOR and Safe presentation at 40/50/80/120 columns; report body reachable at short sizes and refusal below four rows; vocabulary/diagnostic/import previews and their limitations.
- Live session view updates despite a new earlier row, failed poll and Notices Off, without losing selected ID/query/draft/focus. Quit/ordinary-shell handoff must not allow a buffered prompt to restart frontend work.
- Workspace/background physical QA comes after wiring: configured keymap/shelf/bar/history precedence, drawer focus/geometry, task identity/graceful stop, separate output, foreground/queued ownership and WSL2/provider limitations.

Redaction remains best-effort. Linux has no supported metadata-only clipboard counter. Exact last-frame module width-compaction diagnostics remain deferred. Failed registry polls may temporarily retain a stale validated view; async project/branch collection may lag authoritative cwd. Fresh background tasks do not inherit live shell aliases/functions/unexported variables/options. Residual native process-group reuse and unperformed WSL2/provider physical behavior remain disclosed integration risks.
