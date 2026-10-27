# Combined performance integration

The implementation PRs are merged into `dev` in the approved order. Each approved head was checked against freshly fetched remote `dev`, GitHub mergeability, review/check state and a clean local merge simulation. Each actual result matched its predicted tree and parents, and its exact push CI passed before the next merge. A PR's reported base snapshot is informational; it is not required to equal the live remote branch tip.

| PR | Resulting dev merge | Exact push CI |
|---|---|---|
| [#511: fullscreen reattach geometry](https://github.com/raiseCatError/notMyShell/pull/511) | `fa3091d705d31255081172665801450a0d4c8890` | [40477837690](https://github.com/raiseCatError/notMyShell/actions/runs/40477837690) |
| [#506: output paints](https://github.com/raiseCatError/notMyShell/pull/506) | `fe40fd52fb68f0db81b3d35011d15e10e49119c4` | [40481488888](https://github.com/raiseCatError/notMyShell/actions/runs/40481488888) |
| [#508: composer layout](https://github.com/raiseCatError/notMyShell/pull/508) | `acc61dad2f8ccea1d48e9b6ad7fa718ec6a431de` | [40482503313](https://github.com/raiseCatError/notMyShell/actions/runs/40482503313) |
| [#510: transcript indexes](https://github.com/raiseCatError/notMyShell/pull/510) | `317f2e80d5b1ce81d775657c7e5922acb75c94ee` | [40483855963](https://github.com/raiseCatError/notMyShell/actions/runs/40483855963) |

All listed push runs include Quality, the macOS/Ubuntu suites, Node 22 compatibility, Fedora and both timing-smoke jobs. Original source branches and commits remain preserved. No `master`, release, tag, deployment or Homebrew action is part of this integration.

## Regression coverage and correctness

The focused follow-up imports `tests/performanceIntegration.test.ts` byte-for-byte from the reviewed and validated integration commit `3173058d48668d6c3f5ba8839518a7dfb91beb15`. Runtime, dependency, script, CI and test content then matches the validated combined snapshot `bd1d7750fcb84263ba864c5e721585f6551890fb`; only reporting/QA documentation differs. This adds no runtime feature, dependency, timer budget or assertion relaxation. The new file enters the canonical suite and sharding automatically.

The tests interleave output bursts with wrapped Unicode editing, Page Up/FOLLOW and resizing in a populated transcript; check complete output and command order; retain pending-click targets on last-painted rows; require exact Unicode clipboard bytes through a fake backend; and verify interrupt/stop paint cancellation. They use the production decoded-input path and the existing fixture's resource teardown. The user's clipboard is not modified.

The original Linux failure was a pre-existing attachment geometry race, reproduced on unchanged dev production source with controlled runtime scheduling. Early intermediate geometry/repaint could precede renderer suspension; native less 590 could receive the final WINCH while flushing and defer size processing behind input. #511 negotiates deferred sizing and explicit post-suspension repaint intent, tracks successfully applied PTY geometry and invalidates stale restoration callbacks. It relies on the kernel's normal `TIOCSWINSZ` foreground-process notification, without additional manual signals.

The controlled probe establishes reachability, not natural frequency or causation by one optimization. Separate uninstrumented alternating Linux controls passed across original dev, the old integration and both fixed snapshots, including owned CPU load. Native less, less -X and vim tests require genuine post-clear repaint at changed/identical attachment sizes, successive resizes and successful quit/return. The existing same-size neighboring-size repaint fallback remains; no claim covers every native application's possible signal race.

[Comprehensive exact-head validation](https://github.com/raiseCatError/notMyShell/actions/runs/40454608512) and full local canonical verification passed on the prior combined snapshot, including these interaction tests. The actual follow-up PR head and final dev push are verified separately; consult the linked performance issues/PR checks for the final merge's exact SHA and run. Automated passage is not physical terminal QA. The known intermittent macOS read/input issue and existing Arcade disposal TODO are not claimed fixed.

## Representative combined measurements

These are the matched 2026-10-27 pre-merge experiment, not measurements of a later merge commit. Apple M2 / 8 GiB / macOS 27 / Node 26.12.0, identical locked dependencies, separate built CLIs, Native provider, persistent private zsh service, 100x30 PTY and private HOME/config on T7. Frontend bytecode caching was disabled; the service retained its minimal environment. No local tests/profiles ran during timings, no OS cache was purged and no true cold-cache claim is made. Existing user workloads were preserved.

| Warm observation | Original dev | Integration before geometry fix | Integration with fix |
|---|---:|---:|---:|
| 10,000 Unicode lines, median ms | 47,830.18 | 336.57 | 308.78 |
| Post-output frontend RSS, median MiB | 525.56 | 327.17 | 313.75 |
| 2,500-command history Page Up, median ms | 1,077.65 | 30.82 | 29.89 |
| Same archive restore, median ms | 782.58 | 274.39 | 273.87 |
| Large-history typing, p95 ms | 629.52 | 36.47 | 38.91 |
| Long-command typing, p95 ms | 40.97 | 24.03 | 22.35 |
| Long-command deletion, p95 ms | 17.74 | 4.23 | 4.33 |

Measured fixed-versus-pre-fix differences include **6.7% slower large-history typing p95** and **2.3% slower deletion p95**. These remain reported; small correlated samples and sequential ordering do not establish causation by the geometry fix. Original-dev output ranged 35.72–68.37 seconds, showing host variation. The broad gains do not imply every metric improves. RSS is a sampled frontend post-output value, not idle/peak/process-tree memory; no idle CPU or startup gain is claimed.

Output uses three warm sessions after one excluded observation; history uses four warm sessions with ten key observations each; input uses seven warm sessions with fifteen typed/deleted keys each. p95 is nearest rank. Every output row and archived record was checked for exact order/content outside timing. [Summary and provenance](2026-10-27-integration-summary.json) retain the source identities and method. Final merged-head repetition is recorded in the integration handoff on [#505](https://github.com/raiseCatError/notMyShell/issues/505), [#507](https://github.com/raiseCatError/notMyShell/issues/507) and [#509](https://github.com/raiseCatError/notMyShell/issues/509); do not pool absolute values from separate experiments.

Functional built-CLI PTY stress separately verified all numbered Unicode output, exact raw payload bytes/SHA256, concurrent draft editing/scrolling/selection/copy, command order, one draft execution and Ctrl+C exit 130 followed by a new command. Clipboard capture is a fixture, not the host clipboard.

## Physical QA and service lifetime

Ghostty/Zed physical QA is **NOT RUN**. Follow the [performance integration QA handoff](../testing/performance-integration-physical-qa.md). Keep the performance issues open until human results are recorded. Existing services retain the code with which they started until their sessions naturally end; do not terminate existing sessions to force an upgrade.
