# v0.13 cumulative development acceptance

v0.13 is an unmerged development stack, not a Linux/Windows public release.
Physical QA is intentionally deferred. Package and lockfile remain **0.7.0**.
Independent-QA fixes are recorded in [post-QA acceptance](v013-post-qa-acceptance.md).
No lower published branch was rewritten; no merge, tag or release occurred.

## Review stack and scope

Frozen base [#278](https://github.com/raiseCatError/notMyShell/pull/278),
`docs/v012-cumulative-acceptance` at
`cfc9c08a5fb7b5f3bc637400a59da7a714a58ae4`, was verified against GitHub and fetched
origin before work and rechecked unchanged. It remains open, non-draft and unmerged.

| Order | PR / branch | Published implementation SHA |
| --- | --- | --- |
| 1 | [#280](https://github.com/raiseCatError/notMyShell/pull/280), `feature/v013-linux-baseline` | `78010a140b675684a75640bdd0a2b5abb985e7a6` |
| 2 | [#282](https://github.com/raiseCatError/notMyShell/pull/282), `feature/v013-portability-hardening` | `3b0fc8ac9aba880bb0dd0fdc95e9d87e8ad73a9b` |
| 3 | Final acceptance/docs, `docs/v013-cumulative-acceptance` | This document's branch head |

Each targets its immediate predecessor. Review #278 → #280 → #282 → final docs.
[Milestone #13](https://github.com/raiseCatError/notMyShell/milestone/13) tracks
research #18/#19 and implementation children #279/#281. Issues remain open with
this unmerged stack. Project field updates were unavailable because the token
lacks read:project; issue and PR activity records progress instead.

Custom prompts #73, rich previews #151, layout redesign #79, additional shell
backends and v0.14 work are outside scope.

## Platform findings

[Linux foundations](../architecture/v013-linux-foundations.md) records actual
source findings, PTY dependency, shell discovery, paths, adapters and packaging.
The real persistent-zsh/session architecture is reused on Linux; bash is never
substituted. Ubuntu native binding installation and canonical PTY fixtures
provide runtime evidence, rather than compile-only platform guards.

Narrow boundaries added/extended: executable zsh discovery, Linux secure runtime
path selection, absolute configuration defaults and factual existing Status
diagnostics. Existing TerminalHost capabilities and notification services remain
the boundaries for optional features. There is no generic OS adapter.

Linux sockets prefer a private uid-owned XDG_RUNTIME_DIR/nmsh when its socket
path fits; invalid roots fall back to os.tmpdir()/nmsh-uid. Configuration uses
absolute XDG_CONFIG_HOME or ~/.config/nmsh. Journals stay under existing config.
macOS storage is unchanged. Unicode/spaces/symlinks/quoted HOME and absent HOME
have regressions. Optional Linux notifications are no-op; macOS keeps its bounded
privacy-preserving osascript backend. Terminal.app/Ghostty macOS window adapters
remain isolated; unsupported launchers show manual fallback.

Linux revealed insecure global Ubuntu completion permissions before isolated
bootstrap; CI audits/repairs only system completion paths and keeps compaudit
enabled. Slow startup exposed a genuine initial-prompt command lifecycle race,
fixed above #278 for live submission and unacknowledged reattach replay. Pipe flushing and journal-based fixture checkpoints were also
corrected; detach fixtures require the service preexec marker, rather than
interpreting a submitted journal entry as proof that bootstrap has finished.
PTY chunk boundaries differ: beyond the cap, output including the tail can be
dropped by the existing retention policy. Tests require bounded retention and
a factual marker, complete output within limits, lifecycle and later execution. No divergent Linux PTY transport implementation was necessary.

[Windows/ConPTY/WSL feasibility](../architecture/v013-windows-feasibility.md)
recommends **no-go for native Windows in v0.13**. node-pty 1.1.0 supplies ConPTY
transport, but zsh lifecycle/completion, signals/process ownership, named-pipe
ACL transport, executable/path/quoting and persistence semantics remain blockers.
PowerShell is not a drop-in backend. WSL with Linux Node/zsh is a candidate Linux
route, not native Windows or physically validated WSL support. No Windows child
or shell implementation was justified.

Packaging: reviewed source checkout with Node >=22, zsh and native build tools,
then npm ci/build/link. private:true currently prevents registry publication.
No distro-specific installer child, deb/rpm/AUR or GUI packaging was added.

## Automated evidence

Local macOS arm64 / Node 26.8.1: **868 tests passed**, zero failure/skip; focused
lifecycle/status/semantic checks **12 passed**, replay/detach **9 passed**, retention/backlog **10 passed**
and tmux interoperability **8 passed**. Build, typecheck, benchmark-script
typing and git diff --check passed. Local inherited NO_COLOR was removed for
truecolor-pinned snapshots; dedicated NO_COLOR/baseline fixtures still ran.
Sandbox-denied process-inspection runs were invalid and excluded from acceptance.

The final cumulative workflow runs macos-latest/ubuntu-24.04 × Node 22/26,
including native install, build/typecheck, benchmark typing, bounded timing,
canonical tests, diff and process leak checks. Feature push duplication is
disabled; no OS or Node lane was reduced. Per-file 120-second timeout bounds
compound lifecycle fixtures while their internal waits stay unchanged. History
latency tests run separately from competing PTY fixtures with the same budget.

Implementation [CI run 37033963287](https://github.com/raiseCatError/notMyShell/actions/runs/37033963287)
at `3b0fc8ac9aba880bb0dd0fdc95e9d87e8ad73a9b` passed all four lanes:

| Runner | Node | Total | Passed | Skipped | Failed |
| --- | --- | ---: | ---: | ---: | ---: |
| macOS | 22 | 868 | 860 | 8 | 0 |
| macOS | 26 | 868 | 860 | 8 | 0 |
| Ubuntu 24.04 | 22 | 868 | 864 | 4 | 0 |
| Ubuntu 24.04 | 26 | 868 | 864 | 4 | 0 |

Build, typecheck, benchmark typing, diff and process-leak gates passed in each
lane. The acceptance branch reruns these same canonical lanes and adds existing
10k/100k transcript presentation timings. Its live CI result is on the final PR;
this table pins the completed implementation evidence rather than predicting
a future run.

Earlier #280 Linux CI remains red at its frozen published head; runner security
and runtime fixes live in #282. Acceptance uses the later cumulative head,
without rewriting lower branches. Optional-tool skips must not be mistaken for
physical QA or exhaustive host coverage.

## Performance and cleanup

Three-sample timing probes measure initial PTY prompt, persistent-service prompt
and service socket removal. Existing benchmarks measure cold/warm configured
completion, composer planning and 10k/100k transcript wrapping/presentation. Values are informational; cross-OS equality
is not a requirement. History latency retains its regression budget.

An idle local macOS sample measured PTY p50 23.15 ms, service 130.18 ms and
cleanup 11.89 ms. Under full-suite competition these rose to 74.10/706.21/10.11
ms, illustrating why unlike runner workloads should not be compared equally.
The final local presentation samples measured 10k/100k wrapping p50
12.38/178.52 ms, configured completion cold/warm 223.62/10.33 ms, and
composer planning ≤0.01 ms. Hosted timing/counts are recorded with CI evidence
below.

Hosted implementation p50 timings (ms):

| Runner / Node | PTY ready | Service ready | Cleanup | Completion cold / warm |
| --- | ---: | ---: | ---: | --- |
| macOS / 22 | 54.93 | 240.20 | 11.08 | 262.22 / 29.56 |
| macOS / 26 | 35.44 | 250.56 | 11.88 | 236.39 / 22.77 |
| Ubuntu / 22 | 477.91 | 650.99 | 10.23 | 643.49 / 7.04 |
| Ubuntu / 26 | 483.37 | 654.60 | 9.88 | 645.58 / 7.02 |

Ubuntu global completion initialization contributes startup cost; warm queries
and cleanup stay bounded. Composer planning p50 was ≤0.04 ms in all lanes.
Readiness/cleanup probes enforce 10s/5s bounds, while history retains its 60ms
p95 budget. No comparison claims identical host load or cross-OS equality.

Local final process inspection found no NMSh semantic/completion/session/test
processes. Private suite roots enforce/report helper-directory leaks before
removing only their own artifacts. Initial pre-existing name-replay temp data
and .serena were preserved. Empty screen roots from interrupted verification
and the identified owned interrupted bootstrap fixture were cleaned precisely.
No unrelated user data was removed.

Disk started around 2.42 GiB free. Checks before/after full suites remained above
the user's 1 GiB hard stop; final available space is recorded in the handoff.
The threshold was not replaced with a larger comfort margin.

## Remaining limits and later QA

Use [v0.13 additive physical QA](v013-physical-qa.md) for install/startup/zsh,
ordinary/streaming/fullscreen commands, resize, persistence/reconnect, configured
completion, /tools, prompts, effects and baseline hosts. Start with Kitty then
GNOME Terminal; regress macOS Ghostty/Terminal.app. WSL checks apply only to the
Linux candidate route. Nothing here claims human validation.

Linux CI covers Ubuntu x64, not every distro/architecture/terminal host. Trusted
user startup code can still block or fail; insecure completion configuration
requires user repair. Native Windows is unsupported. Very long explicit runtime
socket paths can fall back factually to in-process operation. Registry publishing,
distro packages and desktop notification parity remain unimplemented.
