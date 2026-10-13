# Workflow lifecycle investigation — 2026-10-13

[#359](https://github.com/raiseCatError/notMyShell/issues/359) remains the coordination tracker. **Frontend freeze is pending; integration has not begun.** This diagnostic branch preserves the production source of input head `5206db0615c0345937455fa2cc8f1120849854ec`. It adds opt-in CI observation without changing assertions, test deadlines, process signals or foreground ownership.

The original durable handoff is preserved at commit `cc853707cf6060bc4b8edc2c84313949075c557b`, `docs/development/workflow-stabilization-handoff.md`. Initial inspection confirmed its pushed checkpoint; no lost-work recovery was necessary. Current observations supersede its historical head table. Read the current #359 discussion and verify remote refs before continuing.

## Current blocking evidence

[Input CI 38286298684](https://github.com/raiseCatError/notMyShell/actions/runs/38286298684) passed Quality and all full macOS/Ubuntu shards on `5206db0`, but Node 22.23.3 compatibility timed out the `serviceCompat.test.ts` worker after its bodies returned. Its aggregate failures/cancellation are consequences of that primary job failure. The exact retained resource was not captured. No classification as resource starvation or harmless flakiness is justified.

Five controlled runs of the unchanged Node 22 compatibility suite, with three workers and its original deadline, passed in the owned Ubuntu arm64 VM. Snapshots show each service worker exited and every recorded PTY child reported exit. That evidence does not reproduce or explain the amd64 CI retention.

Earlier input `4eb8e2434469fc7f2c04d4662f50877f0562d145` and queue `45a0c071ea390d8c01ad33c8eb55ab2012e40c94` passed canonical verification and their actual-head CI. The paused-client EOF defect is independently reproduced and fixed: kill/detach discard withheld data, flush their lifecycle request and resume draining to EOF; started clients retain ordered final data. It does not prove the cause of this newer retained worker.

The latest live-session view correction refreshes an explicitly open panel from validated service polls, preserving session-ID selection, query, draft and command focus. Notices Off still refreshes the explicit view. A failed poll retains the previous validated snapshot; a valid empty registry clears it. Controlled regressions passed, as did repeated unchanged live detach/read probes. Amber `5fb68e8`'s historical CI wait and retained Ubuntu shard remain recorded failed evidence.

## Source candidates and published heads

These are observations, not accepted frontend heads. Original feature branches are deliberately held at the preceding CI failure.

| Track | Local source candidate | Published feature/fix head | Latest local canonical |
| --- | --- | --- | --- |
| Input #348 | `5206db0615c0345937455fa2cc8f1120849854ec` | same | passed, official Node 26.11.1/macOS arm64 |
| Queue #357 | `6ed34cd244d225034a52de852ea32ef6fd372d9e` | `45a0c071ea390d8c01ad33c8eb55ab2012e40c94` | passed, publication held |
| Copy #358 | `e823bc7f0c9da123d0ecff837d3045374c2ecee6` | `5fb68e8881fde0741cd64621a58a40e2e83677a2` | pending |
| Report #360 | `623fc813809db541e773be155e8428374a6078be` | `9fb09c975d1f4e07d34265793c78d34b7eea6cdc` | pending |
| Compare #361 | `88979c14351a16fad450e27500a17c5c9995140f` | `032365e2ffa9fd42563ae93e66fd487b41e66841` | pending |
| Vocabulary #367 | `182fb3b245fa975f8572d713d079c77cbff310c1` | `99019ae3fad1c27f8233aa53d3314116a62df355` | pending |
| References #368 / Elm | `e23cef6c82ea7e4759096cafdc938c94090823eb` | `5993218d86f67e91e940b098e7259af081fdd64b` | pending |

Input → Queue → Copy → Report → Compare retain additive ancestry. Vocabulary and References are independent siblings above Compare. Elm is aligned with the References source candidate. All prior checkpoint and feature history must remain recoverable. No force push, destructive rebase, release/master merge, tags or releases are authorized.

## Diagnostic procedure and limits

The Node 22 job preloads `scripts/test-lifecycle-observer.mjs`. Its timer is unreferenced; exit is never forced. It saves per-process resource/handle snapshots, native PTY creation/signal-attempt/exit records and Linux direct-child status/wait-channel data to the job's private runner temporary directory. The artifact is `node22-worker-lifecycle` and expires after seven days. It records no command arguments, environment values or output contents. Filesystem paths are included. Observation scans can perturb timing; only direct children and tracked PTYs are covered, not every descendant. The preload resolves dependencies from its own repository location even when a launcher changes cwd.

Inspect the failed worker's actual snapshot before changing termination behavior. A passing observed run is diagnostic evidence, not acceptance of the unobserved feature head. If retention does not reproduce, retain the failure and collect another bounded observation rather than guessing a production change.

Owned T7 verification logs include `cedar-5206db0-node22-failed.log` and `cedar-5206-node22-observed.log`. The Linux resource snapshots are under guest `~/maple-tests/cedar-5206-node22-resources`. The VM is stopped during heavy host verification. Use private temporary roots and one host test worker; preserve other owners' processes/resources.

The host diagnostic launch initially inherited `NO_COLOR=1`, causing the color-specific canonical goldens and Theme Bridge expectations to fail. This is recorded in `cedar-lifecycle-probe-canonical.log`; it is not a passing gate. The controlled Setup preview fails with that environment and passes after clearing only `NO_COLOR`; unchanged Setup, Theme Bridge and explicit monochrome selection fixtures then pass. The enabled observer's minimum-runtime test selection also passes on host Node 26.11.1. Canonical verification then passed on official Node 26.11.1/macOS arm64 with the established color-enabled baseline, one worker, private T7 roots, source build, full runtime/ranking groups and diff checks. The final observer also passed focused compatibility, socket lifecycle and actual launcher checks. Explicit NO_COLOR behavior tests retain their own environment overrides. No fixture assertion or production color policy was changed.

## Remaining stabilization gates

1. Resolve or precisely characterize the retained compatibility worker with controlled evidence and targeted regression.
2. Finish canonical verification for every latest candidate, deliberately promote fixes to the original feature chain, preserve both siblings, and wait for actual published-head CI.
3. Run full Linux/Fish 3.7 verification and applicable minimum-runtime/timing/portability checks, with the owned VM serialized against heavy host suites.
4. Complete current-head report/comparison/clipboard security acceptance from #363, recording physical clipboard and terminal QA separately.
5. Update the durable handoff and #359 with exact accepted heads, interface/ownership guarantees, known limitations and physical QA before declaring freeze.

Native/workspace #375–#378, #383–#385 heads remain unchanged on reinspection. They are standalone and disconnected from the frontend. #370 at `417d105e3f513e36bf35d0efb7c0b79574a31f9b` remains canonical for Ruby/PHP; preserve its corrected implementation and regressions during later acceptance integration. The native handoff is `docs/development/context-workspace-handoff.md` at #385 head `c9a368663fc334304f6631f664bbdf5e5459dc59`.

Physical Ghostty/Terminal.app input, selection, focus, fullscreen, resize, detach/reattach and actual clipboard behavior remain unperformed acceptance requirements. No headless run constitutes physical QA.
