# Slice 3 integration verification plan

Base: e888b06a561a753cfda4ec05f1650380f9d347d9, verified Slice 2C.
Source implementation: 877c6f607f93836a9c4c7e80856f5430fdc8498c (local branch preserved).
Spec: docs/superpowers/specs/2026-10-16-execution-interaction-design.md.
Supporting plans: execution-timeline-slice-2, slice-2b, slice-2c (2026-10-16).

- [x] Verify commits, common ancestor, mounts, source worktree cleanliness and create isolated T7 integration worktree. Original checkout has unrelated package edits; source 2C and 3 worktrees are clean.
- [x] Apply existing Slice 3 delta without committing a blind cherry-pick. Resolve modal ownership conflict by retaining Queue history and the selector's originating-palette exception together. Preserve all 2B/2C code.
- [x] Add integration regressions for summary/paste modal priority, folded queued output selection, exact copying, numbering and transcript restoration.
- [x] Run focused integration and affected real-PTY zsh/Bash/Fish checks, Safe/NO_COLOR, compatibility, verify:fast and canonical verify:release with bounded concurrency and T7 scratch. Diagnose failures; preserve evidence.
- [ ] Generate production Copy/Actions/Esc/folded/multi/Compare frames at normal/narrow widths from exact source. Review branch.
- [ ] Commit and push only integration branch; dispatch comprehensive exact-head CI and investigate results. Document physical QA and next maintainer gate; no merge/tag/release/version bump/Slice 4.

## Decisions and evidence ledger

- Common ancestor is 069d954e21d4e35c69d2510f8173bddcd7c1b7c3. Slice 3 exists locally; no dependency on an origin ref.
- Existing source worktrees preserved. New worktree: /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/post-v020-slice3-integration, branch integration/post-v020-slice3. T7 policy check verifies external device and APFS scratch backing image.
- Historical run 38930716614 at Slice 2B SHA 8a6ac8f7 failed Ubuntu shard 1/2 in queuePreviewLive approval/typed-y/n routing. The verified 2C SHA has no remote run. Historical logs retained in /Volumes/T7Tmp/ai-dev/runs/s3int-yj9vopp_/historical-ci.log. Local success does not settle Linux regressions.

- Integration RED: summary save review did allow Copy to take input. Added guards for both the armed review and its asynchronous pending-detail phase; the existing review retains ownership. Folded queued output/typed-summary roundtrip and paste focus-only behavior were already preserved.
- All unchanged 2B/2C/source Slice 3 focused checks passed after the deliberate modal union. The tmux test now respects tmpdir() rather than hardcoding internal /tmp, needed to satisfy the required external-only canonical run.

- Review quota ended before a complete review. Its concrete pointer-coordinate concern was reproduced: restoring before mouse hit testing could target the entry viewport. Pointer events now retain selection/view through existing hit testing; the regression checks exact old-block Actions identity. No further reviewer delegation.

- Real queued-fold PTY cases pass Bash/Fish. zsh exposed fixture-only clipboard file truncate/write timing: waiting for any change from KEEP could observe an empty in-progress file. Wait now requires exact expected bytes before the unchanged byte assertion. Initial failure retained in final-focused.log; no assertion weakened.
- verify:fast passed, and Safe/NO_COLOR integration/presentation checks passed.

- Canonical verification found a genuine discovery omission inherited from isolated Slice 3: Ask coverage did not classify /actions and /action. Added an actionable Output actions concept and an actual natural-language routing expectation. Initial canonical failure remains recorded; a clean canonical rerun is required after fixes.

- Original full canonical run completed with discovery, two fixture/environment failures, and seven pre-action startup/ownership-scan timeouts. Startup failures reported alive frontends with 0/13 bytes before any tested action, and disposal lsof timeouts. Complete error evidence is preserved.
- The canonical temp-root constraint is <32 characters. NMSH_TEST_TMPDIR=/Volumes/T7Tmp/ai-dev gives private nt-* roots satisfying it without internal fallback or assertion changes. The welcome identity fixture now uses a controlled cwd under the private test HOME, preserving its 80-column assertions while avoiding checkout-path truncation. Failed live cases are rerun serially before a clean serial canonical run.

- Serial diagnosis passed the original startup, ownership hygiene, Ask and Welcome cases. Two inline-agent fixtures instead raced the post-exit handoff. A diagnostic run records `agent-account2` still running after PICKED-1, before the next command. They now wait for the actual completed journal; production routing, assertions and deadlines are unchanged.

- Full serial canonical run finished: new selector/folded-copy/Actions and handoff tests passed. Three failures: output-actions missing from Guide section (fixed in History & transcripts), legacy picker disposal lsof ETIMEDOUT after assertions, and startupDiscovery detached-session setup timeout. Preserved in verify-release-serial.log. Affected cases rerun unchanged after the catalog fix.

- Guide and picker pass their affected rerun. A different startup Always-resume case asks despite saved Always. The same failure reproduces immediately on untouched e888b06a in a new detached T7 control (baseline-startup-control.log). It predates Slice 3. Local verify:release remains red; no startup refactor, skipped test, relaxed deadline or weakened ownership assertion is included. Exact-head remote CI must be reported separately.

- Final verify:fast and benchmark typechecking pass. First bounded timing smoke failed configured-cold with no candidates; unchanged cold fixture passes alone on 2C control. Query budgets remain unchanged; preserve release-tail.log and fresh timing-smoke-recheck.log separately.

- Fresh bounded timing smoke passed with original budgets. The first failure remains in release-tail.log; local full canonical remains red as documented.

- Correction to the initial baseline diagnosis: focused/control commands inherited NMSH_RETURN_SESSION. An unavailable handoff target intentionally forces Ask rather than Always in src/index.ts. This is expected safety behavior, not an established startup preference bug. Canonical commands already removed handoff variables; their detached-session setup and cleanup timeouts remain separate. Clean-environment reruns preserve every assertion.

- Clean-environment startup discovery passes in full on the integration source; the baseline Always-resume control passes too. No production startup regression is established. The earlier full-run detached setup and lsof timeouts remain preserved; local canonical is not claimed green.

- Exact-head CI 38956521560 exposes historical echo DIRECT timeout, Linux background stop ESRCH and macOS paste mock assuming optional supported Bash. All new selector cases pass, but backend labels could hide intentional zsh fallback on missing shells. Added actual live backend identity assertion and explicit adapter availability skips, with a failing system-PATH identity proof. The mocked paste switch now targets the required zsh from a simulated Bash state, asserts the switch call and retains invalidation checks; system-only PATH reproduces RED then GREEN. Queue pause acknowledgement and task-group signalling remain owner-level integration blockers, not speculative fixes in this slice.
