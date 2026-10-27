# Host-profile completion stabilization

Refs [#473](https://github.com/raiseCatError/notMyShell/issues/473). Source base: merged dev `c690de055daeb7b33ed8b5e302ef01133b3e55b4`. All five performance integration PRs are already merged; this work changes test synchronization only.

## Hosted failure and what is known

[Final integration push CI 40512364215](https://github.com/raiseCatError/notMyShell/actions/runs/40512364215) failed macOS shard 2/3 in `hostProfiles.test.ts`: `timed out waiting for completed journal for echo SIZE-$(stty size)`. Other platform shards, Node 22, Fedora and both timing jobs passed. This was a test timeout, not the earlier Node 22 workflow-budget cancellation. Identical test source on old/new dev does not establish runtime correctness.

The original test submitted a bracketed STATE command, waited only for matching screen text, then queried size. Its outer `until` awaits each `app.run` sequentially: a completed wrong-width probe can cause another submission, but exceptions escape rather than being retried. Each run waits for exact-command journal count growth. The outer deadline is checked between callbacks, not while an inner command completion wait is pending.

Two observation defects are established:

- A rendered STATE row does not acknowledge that this frontend has processed the command's completion. The helper's independent service-idle query can be ahead of frontend event delivery. The existing input-ownership rules correctly hold input entered while a command still owns the reader; such a held probe has no execution/completion record.
- A resized/redrawn viewport can repeat an older SIZE row. An observed natural trace finalized a new probe at 60 columns, then advanced to the next profile despite expecting 50. A fresh output suffix therefore did not identify which command produced the matched geometry.

A controlled completion-batch gate reproduced the exact hosted journal-timeout message on unchanged original dev `be3f6abe26a112a39f3a23c800954b8981ae5b0e`. The size command was held for approval, never delivered/executed, so no completion marker, finalized record or journal entry was missing. Corrected synchronization passes the same event-driven observer gate. Other controlled runs failed earlier at output waiting; they are not presented as exact-symptom reproductions.

The historical hosted failure had no lifecycle trace, so its precise cause and natural frequency remain unconfirmed. Ungated isolated, bounded two-worker and representative full-shard local controls passed. This establishes a reachable pre-existing harness mechanism and a concrete false pass, not proof that all #473 macOS failures share it or that production cannot regress.

## Focused correction and regression

The STATE submission remains bracketed paste, with a unique profile tag in its single printf command. Before resizing, the test requires exactly one durable completed record, successful status and that record's actual expected environment output. Every sequential size attempt has a unique tag; its own completed journal record must have successful status, the matching tag and width 50. All six hosts, mode assertions, persistent shell, existing deadlines and detach checks remain. No production/helper behavior, dependencies, test skips or expected geometry changed; no timing grace was added.

`hostProfileSynchronization.test.ts` invokes the real profile test through the existing private-home test runner with `hostProfileCompletionGate.mjs`. The explicit fixture delays a reattached STATE command's done/prompt delivery until the test polls its completion, or records premature SIZE input before releasing it. No fake output or shell completion is generated. The test requires every reattachment to exercise/release the gate and no premature probe. The child budget is shorter than the outer canonical budget to retain teardown margin; other existing test budgets are unchanged. Watchers close on release/stop; existing sandbox disposal owns its files/services. Failures print only compact fixture event metadata before removing their private trace.

Explicit reproduction:

```sh
node --import=tsx --import=./tests/fixtures/hostProfileCompletionGate.mjs --test --test-name-pattern='reattaching across profiles' tests/hostProfiles.test.ts
```

For detailed instrumentation, retain only isolated fixture metadata: attachment/profile/PIDs, hashed command identity, submission and actual PTY delivery, exec/data/done/prompt events, record finalization, journal save/durability and expected/observed count. Never enable arbitrary private output logging. Local ordered traces and all failed diagnostic attempts remain preserved on T7. The production marker path is unchanged: shell protocol → ShellSession → service sequence/backlog → frontend completion → OutputBuffer record → serialized atomic SessionJournal/TranscriptStore save → helper readback.

Independent review found no blocker in the final synchronization design. Its concrete readback-diagnostic and child-budget/failure-trace findings were addressed. Local/hosted final validation and measurements are recorded in the focused PR and #473 handoff; do not equate proposed-head passage with a green push on a later dev commit.

## Performance and human QA

Runtime code remains identical to the merged performance source. Final measurements must use built original dev versus actual mergeddev under equivalent conditions, with no local verification/profiling running concurrently. Report output/history/input median and nearest-rankp95, sampled frontend RSS and CPU separately from startup and idle observations. Retain the prior +6.7% large-history typing p95 and +2.3% deletion p95 fixed-versus-pre-fix differences without attributing causation. Do not pool absolute values across experiments or call PTY observations physical pixel latency. See the [integration report](../performance/2026-10-26-integration.md).

Physical Ghostty/Zed QA remains **NOT RUN**. #473 and performance issues remain open; this test correction does not resolve the other queue attribution, read/input or physical-validation risks. Existing live user services/sessions must remain alive. Follow the [physical QA guide](performance-integration-physical-qa.md).
