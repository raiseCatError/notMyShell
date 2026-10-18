# Context Engine lifecycle failure matrix

Uncommitted review evidence. Branch: `feature/305-context-engine`. Exact base and
unchanged HEAD: `6adfe8524da79f071de886f5a3f97bd49074bc60`.
Physical Ghostty QA belongs to the user and is not evaluated here.

## Controls and interpretation

- B: full branch canonical suite, external child/ownership-probe observer.
- A: full Git-backed exact-base canonical suite, same observer.
- H: exact-base existing tests plus the branch Context Engine test worker at
  its ordinary `tests/contextEngine.test.ts` position. The added symlink was
  removed afterward; no base tracked source changed. This is a workload control,
  **not** a pure-base gate: the added worker imports branch implementation.
- F: ordinary branch canonical suite after diagnostics and the scan-timeout fix, no observer.
- N: subsequent exact-base canonical comparison for newly observed failures.
- G: ordinary branch canonical rerun after both test-only cleanup fixes.
- All canonical controls use the normal four-worker cap, sorted whole-file
  ordering, TERM=xterm-256color / COLORTERM=truecolor, and unset NO_COLOR. A
  lacks the new file; H matches the branch file list/order. Tests remain enabled.
- Isolated columns execute each implicated case/file separately. Test-name
  selection is used only for diagnostic isolation; focused/final gates include
  whole files. A base hot-swap availability guard skipped once under load; the
  reported retry executed and passed with no skips.
- All cases existed at the accepted base: confirmed from base source and
  executed canonical results, including dynamically named cases.
- Elapsed values below are **whole-test milliseconds**, not cleanup latency.
  Successful retries alone do not establish a pre-existing flake.

## Current result

G passed every lifecycle/teardown case listed below. Its remaining failures
were the four stale rightPrompt/Tools assertions and the dense screensaver
budget. That exact screensaver assertion also failed in an exact-base canonical
run (blackHole 34.61 ms/frame vs 14.02 ms/frame in G). The normal gate remains
non-green; no assertion was weakened. Passing G does not retroactively resolve
the twelve insufficiently diagnosed historical variants. The other sixteen
rows classify their reported ownership-probe deadline error, not an inferred
body pass or proof that the exact case failed at base.

## Exact test names and recorded failures

X = earlier overlapping branch verification; O = original later canonical run;
L = subsequent branch canonical run. X is historical evidence, not a matched
load comparison. Q = affected-suite run; its additional failure case is included
for completeness. Earlier runs lacked the new process-state diagnostics.

| ID | Exact test name / source | Historical branch failure(s), ms |
|---|---|---|
| 1 | app hot swap: zsh → fish → bash → zsh keeps draft, transcript and cwd; rebinds completion, classification and history; temporary unless saved<br>[tests/shellSwitchApp.test.ts](../../tests/shellSwitchApp.test.ts) | X FAIL 48081.9 |
| 2 | frontend: a blocked startup read shows an explicit state with its prompt, swallows no answer, and Ctrl+C aborts<br>[tests/startupBlocked.test.ts](../../tests/startupBlocked.test.ts) | X FAIL 25331.4 |
| 3 | frontend: slow startup shows the state, keeps typed text, then becomes an ordinary ready composer<br>[tests/startupBlocked.test.ts](../../tests/startupBlocked.test.ts) | X FAIL 39398.3 |
| 4 | frontend: clean startup never shows the startup state<br>[tests/startupBlocked.test.ts](../../tests/startupBlocked.test.ts) | X FAIL 22999.4 |
| 5 | frontend: a command submitted early during a slow bootstrap still runs exactly once<br>[tests/startupBlocked.test.ts](../../tests/startupBlocked.test.ts) | X FAIL 22750.1 |
| 6 | service: detach and reattach during a blocked startup keep the state, the held input and the prompt text<br>[tests/startupBlocked.test.ts](../../tests/startupBlocked.test.ts) | X FAIL 21817.4 |
| 7 | new frontend refuses real legacy v2 service before attach/create; blocked session remains untouched<br>[tests/startupCompatibility.test.ts](../../tests/startupCompatibility.test.ts) | X FAIL 2744.5 |
| 8 | legacy frontend with new service cannot answer hidden startup read and queued input executes after readiness<br>[tests/startupCompatibility.test.ts](../../tests/startupCompatibility.test.ts) | X FAIL 2844.5 |
| 9 | new service explicitly rejects overflow, retains accepted writes and eventually runs them in order<br>[tests/startupCompatibility.test.ts](../../tests/startupCompatibility.test.ts) | X FAIL 5223.0 |
| 10 | socket-delayed submission rejection preserves newly typed text and retains rejected command in history<br>[tests/startupCompatibility.test.ts](../../tests/startupCompatibility.test.ts) | X FAIL 41825.9 |
| 11 | one detached session asks by default: Not now and Esc start fresh and leave it; Resume attaches; nothing is hijacked<br>[tests/startupDiscovery.test.ts](../../tests/startupDiscovery.test.ts) | X FAIL 23484.5 |
| 12 | Always and Never from the prompt persist; Never ends nothing and /resume still lists the session<br>[tests/startupDiscovery.test.ts](../../tests/startupDiscovery.test.ts) | X FAIL 23101.6 |
| 13 | Always resumes one detached session without asking<br>[tests/startupDiscovery.test.ts](../../tests/startupDiscovery.test.ts) | X FAIL 22621.5 |
| 14 | built nmsh: Open all from a picker attaches here and launches every other selected session<br>[tests/startupLaunch.test.ts](../../tests/startupLaunch.test.ts) | X FAIL 23391.9; L FAIL 27603.1 |
| 15 | built nmsh starts normally as Terminal.app<br>[tests/startupLaunch.test.ts](../../tests/startupLaunch.test.ts) | X FAIL 22242.7 |
| 16 | live fixture run waits for the command journal instead of matching echoed input<br>[tests/startupLifecycle.test.ts](../../tests/startupLifecycle.test.ts) | X FAIL 22743.5; L FAIL 31493.0 |
| 17 | closing just the tmux pane (server still running) detaches the live session<br>[tests/muxInterop.test.ts](../../tests/muxInterop.test.ts) | O FAIL 17718.7 |
| 18 | configured capture cleans its PTY and root after abrupt frontend death<br>[tests/nativeCaptureLifecycle.test.ts](../../tests/nativeCaptureLifecycle.test.ts) | O FAIL 8773.7; Q FAIL 3052.8 |
| 19 | service: shutting down the shell during a blocked startup leaves no session or process behind<br>[tests/startupBlocked.test.ts](../../tests/startupBlocked.test.ts) | L FAIL 31532.0 |
| 20 | frontend: early vim cannot steal ownership from SIGINT-ignoring startup<br>[tests/startupBlocked.test.ts](../../tests/startupBlocked.test.ts) | L FAIL 19774.5 |
| 21 | Terminal.app profile runs persistent editing, paste and resize without enhanced modes<br>[tests/terminalBaseline.test.ts](../../tests/terminalBaseline.test.ts) | L FAIL 21316.9 |
| 22 | real frontend: a foreground program SIGKILLed with modes enabled leaves the physical terminal in NMSh's state<br>[tests/terminalModeReconciliation.test.ts](../../tests/terminalModeReconciliation.test.ts) | L FAIL 31110.3 |
| 23 | NMSh inside tmux: environment, resize, job control, fullscreen, paste; killing the tmux server detaches the live session<br>[tests/muxInterop.test.ts](../../tests/muxInterop.test.ts) | Q FAIL 29116.5 |
| 24 | raw job-control, EOF and arrow bytes reach a full-screen program unchanged<br>[tests/compatibilityHarness.test.ts](../../tests/compatibilityHarness.test.ts) | F FAIL 34577.1 |
| 25 | slash Keep Awake runs in the background and the shell stays ready (no Ctrl+C needed)<br>[tests/keepAwakeForeground.test.ts](../../tests/keepAwakeForeground.test.ts) | F FAIL 23339.7 |
| 26 | service killed with a detached session: the next launch archives it factually and starts fresh<br>[tests/liveHardening.test.ts](../../tests/liveHardening.test.ts) | F FAIL 33170.7 |
| 27 | end to end: a CLI’s own title and notification reach /resume across detach, and typing after reattach clears attention<br>[tests/liveStatus.test.ts](../../tests/liveStatus.test.ts) | F FAIL 33469.5 |
| 28 | L: Browse optional tools → Esc returns to the exact step and row; the next key behaves normally<br>[tests/fullChromaQa.test.ts](../../tests/fullChromaQa.test.ts) | F FAIL 480.7 |

## Test-by-test status and timing matrix

Every row existed at base. PASS is an executed result. F records the completed
pre-late-service-fix run and is never inferred from B. N is the later exact-base canonical run.

| ID | Existed at base | Isolated branch | Isolated exact base | B canonical | A canonical | H matched file-list load | F final canonical | N exact-base canonical | G post-fix canonical | Classification |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Yes | PASS 25875.1 | PASS 21843.4 | PASS 26123.7 | PASS 27996.0 | PASS 25612.0 | PASS 24236.4 | PASS 22022.9 | PASS 24184.6 | unresolved |
| 2 | Yes | PASS 3815.7 | PASS 2518.0 | PASS 4636.3 | PASS 4418.7 | PASS 3367.3 | PASS 3156.3 | PASS 2239.1 | PASS 2914.8 | suite-load/timing flake — ownership probe |
| 3 | Yes | PASS 6127.1 | PASS 1823.2 | PASS 3564.7 | PASS 4706.5 | PASS 4569.1 | PASS 3809.4 | PASS 1905.1 | PASS 2971.6 | suite-load/timing flake — ownership probe |
| 4 | Yes | PASS 1819.5 | PASS 1208.1 | PASS 3904.7 | PASS 4224.0 | PASS 2765.3 | PASS 2856.3 | PASS 1419.4 | PASS 2866.8 | suite-load/timing flake — ownership probe |
| 5 | Yes | PASS 3603.8 | PASS 3152.6 | PASS 6562.0 | PASS 12104.0 | PASS 6090.4 | PASS 4121.2 | PASS 3509.2 | PASS 5407.3 | suite-load/timing flake — ownership probe |
| 6 | Yes | PASS 4966.2 | PASS 4452.7 | PASS 9316.9 | PASS 20288.0 | PASS 11673.6 | PASS 6475.0 | PASS 4818.4 | PASS 7408.1 | unresolved |
| 7 | Yes | PASS 179.5 | PASS 163.3 | PASS 314.3 | PASS 233.5 | PASS 235.2 | PASS 242.5 | PASS 166.0 | PASS 439.0 | suite-load/timing flake — ownership probe |
| 8 | Yes | PASS 209.1 | PASS 187.2 | PASS 241.6 | PASS 245.9 | PASS 222.3 | PASS 171.2 | PASS 155.7 | PASS 164.5 | suite-load/timing flake — ownership probe |
| 9 | Yes | PASS 215.6 | PASS 194.7 | PASS 287.2 | PASS 202.5 | PASS 201.8 | PASS 213.1 | PASS 182.1 | PASS 304.5 | suite-load/timing flake — ownership probe |
| 10 | Yes | PASS 235.4 | PASS 183.8 | PASS 391.3 | PASS 267.6 | PASS 285.5 | PASS 271.4 | PASS 169.8 | PASS 289.7 | suite-load/timing flake — ownership probe |
| 11 | Yes | PASS 4194.3 | PASS 3012.7 | PASS 9848.3 | PASS 7576.9 | PASS 7039.2 | PASS 5630.0 | PASS 3038.5 | PASS 5511.4 | suite-load/timing flake — ownership probe |
| 12 | Yes | PASS 3752.6 | PASS 2626.4 | PASS 9323.4 | PASS 11463.4 | PASS 6603.9 | PASS 6607.1 | PASS 2699.3 | PASS 6745.0 | suite-load/timing flake — ownership probe |
| 13 | Yes | PASS 3303.9 | PASS 2469.4 | PASS 9320.2 | PASS 18496.3 | PASS 10050.9 | PASS 3706.2 | PASS 2701.4 | PASS 5608.0 | suite-load/timing flake — ownership probe |
| 14 | Yes | PASS 4122.3 | PASS 4090.4 | PASS 10019.9 | PASS 24917.0 | PASS 12954.4 | PASS 18145.6 | PASS 5464.3 | PASS 7457.6 | suite-load/timing flake — ownership probe |
| 15 | Yes | PASS 801.5 | PASS 837.9 | PASS 2131.8 | PASS 2491.3 | PASS 1944.5 | PASS 1335.5 | PASS 1252.9 | PASS 1456.5 | suite-load/timing flake — ownership probe |
| 16 | Yes | PASS 1259.2 | PASS 1308.6 | PASS 4871.3 | PASS 10929.0 | PASS 7249.8 | PASS 10034.3 | PASS 1940.4 | PASS 3324.1 | unresolved |
| 17 | Yes | PASS 1638.1 | PASS 1581.6 | PASS 2863.7 | PASS 5200.9 | PASS 5753.8 | PASS 4632.3 | PASS 1470.7 | PASS 5576.4 | suite-load/timing flake — ownership probe |
| 18 | Yes | PASS 1663.0 | PASS 1658.5 | PASS 1735.4 | PASS 2122.6 | PASS 2025.1 | PASS 1961.4 | PASS 1665.7 | PASS 1811.3 | unresolved |
| 19 | Yes | PASS 1336.0 | PASS 1329.0 | PASS 6003.3 | PASS 5797.7 | PASS 7076.3 | PASS 9419.6 | PASS 1574.3 | PASS 4411.9 | unresolved |
| 20 | Yes | PASS 2523.5 | PASS 2518.1 | PASS 5559.3 | PASS 5903.7 | PASS 7266.3 | PASS 5769.6 | PASS 3323.5 | PASS 6057.9 | suite-load/timing flake — ownership probe |
| 21 | Yes | PASS 1466.7 | PASS 1462.1 | PASS 6859.3 | PASS 6748.4 | PASS 8828.5 | PASS 5322.2 | PASS 4080.1 | PASS 4794.7 | unresolved |
| 22 | Yes | PASS 1653.7 | PASS 1685.8 | PASS 6191.7 | PASS 6431.7 | PASS 7785.3 | PASS 5489.6 | PASS 4102.0 | PASS 5550.9 | unresolved |
| 23 | Yes | PASS 2425.6 | PASS 2495.7 | PASS 2548.9 | PASS 9064.6 | PASS 10469.8 | PASS 10240.5 | PASS 2013.9 | PASS 3459.1 | suite-load/timing flake — ownership probe |
| 24 | Yes | PASS 4867.4 | PASS 5060.1 | PASS 2018.6 | PASS 6181.8 | PASS 8710.9 | FAIL 34577.1 | PASS 1855.6 | PASS 2276.0 | unresolved |
| 25 | Yes | PASS 4591.8 | PASS 10191.9 | PASS 2278.5 | PASS 6186.4 | PASS 9189.9 | FAIL 23339.7 | PASS 1850.7 | PASS 2355.2 | unresolved |
| 26 | Yes | PASS 15435.2 | PASS 4160.5 | PASS 3033.4 | PASS 10435.7 | PASS 8488.6 | FAIL 33170.7 | PASS 2572.7 | PASS 3529.8 | unresolved |
| 27 | Yes | PASS 7018.1 | PASS 5578.5 | PASS 3704.4 | PASS 12398.6 | PASS 9455.5 | FAIL 33469.5 | PASS 2904.1 | PASS 3929.4 | unresolved |
| 28 | Yes | PASS 2036.7 | PASS 2239.6 | PASS 1981.0 | PASS 3815.0 | PASS 4740.9 | FAIL 480.7 | PASS 1808.1 | PASS 2133.4 | unresolved |

## Per-case process/transport state and classification limits

| ID | Relevant state/evidence |
|---|---|
| 1 | X: zsh PID 41712 alive, isReady=false, switchedShellStarting=true, startupRaw empty; blocked while awaiting the replacement shell prompt. A/B/H completed all switches. Host rc/scheduling vs branch interaction not distinguished by the original snapshot. |
| 2 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 3 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 4 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 5 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 6 | X timed out waiting for the frontend prompt. PID/exit/transport state absent. A/B/H passed detach, held-input replay and cleanup. Startup delay vs exited frontend remains unresolved. |
| 7 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 8 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 9 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 10 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 11 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 12 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 13 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 14 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. L recorded a 2093 ms probe, status=null, SIGTERM. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 15 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 16 | X: 2000 ms ownership probe timeout. L: 10000 ms ownership-wait deadline; ps text empty, but ps status/error not captured. Empty text cannot prove the owners were gone. A/B/H completed journals and cleanup; the L variant remains unresolved. |
| 17 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 18 | Q: 3000 ms startup observation failed before owner SIGKILL or cleanup; owner-loaded/process diagnostics were added afterward. O: 8000 ms cleanup predicate expired; transport existence, PID state and zombie status were not captured. A/B/H passed transport removal, inner PID death and process-group exit. Failure-only diagnostics now distinguish those states; they did not fire in passing controls. See configured-capture investigation below. |
| 19 | L: 10000 ms ownership-wait deadline, empty ps text with unknown ps status/error. The same exact base case previously failed at 9420.6 ms total with lsof ETIMEDOUT; that establishes its base 2000 ms probe variant, not the cause of L’s different wait variant. A/B/H passed shell/service exit and disposal. L variant remains unresolved. |
| 20 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. L recorded a 2042 ms probe, status=null, SIGTERM. No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 21 | L: frontend prompt wait exceeded 20000 ms with empty captured output; frontend PID/exit state unavailable then. A/B/H passed editing, paste, resize and cleanup. New waitFor diagnostics report PID/elapsed/exitCode/output length/ps state on recurrence. Cause remains unresolved. |
| 22 | L: 10000 ms ownership-wait deadline after terminal-mode assertions, with empty ps text and unknown ps status/error. A/B/H passed mode reconciliation and disposal. Which owner outlasted the deadline is unresolved. |
| 23 | Historical failure was the unchanged OS ownership probe exceeding 2000 ms during finally/disposal. A cleanup exception can mask an earlier body exception; its historical body status was not preserved. Q recorded a 2064 ms probe, status=null, SIGTERM; last probe had no output PIDs and runtime socket list was empty (a timed-out scan does not prove no owners). No historical surviving PID state was captured. A/B/H cleanup completed with no live sessions/listening sockets/owners. Classification applies to the probe deadline failure, not a claim that this exact case failed at base. |
| 24 | F: disposal exceeded its existing 10-second ownership deadline; Node service PID 58908 and esbuild 59308 remained visible to lsof across completed and timed-out probes. Final ps showed them as sleeping with parent 1/service; kill-zero alive list was empty, indicating exit during diagnostic sampling. No sockets remained. The cleanup exception may have masked a prior body error; that status was not preserved. N passed; historical onset/order remains unresolved. |
| 25 | F: initial 20-second prompt wait produced zero output; frontend PID 58429 alive and runnable (Rs+) at 21,611 ms, no exit recorded. Keep Awake actions had not begun. N and the 43-test affected-file branch run passed. Import/scheduling vs branch startup interaction is unresolved. |
| 26 | F: repeated successful lsof probes still found an orphaned Node service plus esbuild. Both were alive/sleeping at the 10-second ownership deadline; nmshd-v2.sock remained. A finally exception could have masked a body failure. For row 26 PIDs were 64936/65139; row 27 65072/65617. All recorded PIDs were gone on a later scoped ps check. N and the 43-test affected-file branch run passed. Late service startup/shutdown vs another owner is unresolved; not a proven base failure. |
| 27 | F: repeated successful lsof probes still found an orphaned Node service plus esbuild. Both were alive/sleeping at the 10-second ownership deadline; nmshd-v2.sock remained. A finally exception could have masked a body failure. For row 26 PIDs were 64936/65139; row 27 65072/65617. All recorded PIDs were gone on a later scoped ps check. N and the 43-test affected-file branch run passed. Late service startup/shutdown vs another owner is unresolved; not a proven base failure. |
| 28 | F: finally cleanup ran, potentially masking a prior body exception; rmSync of the private isolated config directory failed ENOTEMPTY at 480.7 ms. No writer PID/file snapshot was captured. Its helper restores the process-global XDG_CONFIG_HOME before removing the directory. A/B/H/N and the whole-file affected suite passed. Late writer vs transient filesystem removal/shared in-worker state remains unresolved; renderer was stubbed in this case. |

Host load outside these processes varied; matched settings/order do not imply
identical external host pressure. No external work was stopped or throttled.

The ownership-probe classification rests on observed **deadline errors**, an
unchanged harness primitive also failing in a pristine-base canonical run,
measured probe durations under load. A finally exception can mask a body error; historical body status is not inferred from cleanup stacks. It is
not inferred from isolated passes. A branch contribution to overall load is
not logically excluded by these controls. The insufficiently diagnosed
cases contain **unresolved** variants, not converted into base failures.

## Shared-cause audit

- The failing frontend fixtures start in private HOME. `resolvePromptContext`
  returns there before Git/toolchain work; discoveredTools is hidden by default.
  Their default config routes nothing to Rail and their command strings do not
  demand Kubernetes/Docker facts. Changed Git/metadata subprocess policy is not
  reached for those HOME prompt refreshes.
- Surface/fact/ScreenPlan paths are pure. No new polling timer, network task or
  renderer scan was introduced. CommandContextCache retains its existing TTL
  and coalescing; request/peek move reads outside rendering. File handles close
  in finally. Render-after-stop is guarded; session/semantic stop is unchanged.
- LiveSandbox roots, HOME/runtime/sockets/journals are per-fixture mkdtemp paths.
  The runner shares a private XDG root among workers, but lifecycle sandboxes
  override it. Test workers have separate JS globals; new test mocks/env values
  restore in finally. No cross-worker config writer was found in Context Engine
  tests. Import/thread telemetry is separated from TSX loader-worker events.
- The Context Engine worker exited with no tracked ChildProcess survivors or
  pending requests. In B it used about 0.98 CPU seconds and exited 25.0 seconds
  before the capture worker started. In H it used about 3.35 CPU seconds and
  exited 92.4 seconds before capture started. PTY/native grandchildren are not
  exhaustively proven absent by ChildProcess telemetry; successful sandbox
  ownership/session/socket checks provide the additional scoped evidence.
- B/A/H ownership scans: respectively 88/88/87 samples, maxima
  1075/870/1745 ms, no probe timeout. This does not erase historical timeouts.
- During H, host load was 46.79 then 29.25 with eight available CPUs; swap was
  about 3 GB. Process metadata showed running test Node/esbuild processes and
  independent desktop/editor/agent activity. No other work was stopped. There
  is scheduling/resource pressure evidence, but no EAGAIN/EMFILE/OOM evidence
  establishing hard resource exhaustion. Later load fell to 4.82.
- No deterministic ordering dependency or production regression was confirmed.
  A/B/H pass/fail sets differ in unrelated completion/theme/performance tests;
  full verification remains non-green. No timeout, assertion, concurrency cap
  or suite membership was weakened to obtain passing lifecycle results.

## Configured-capture indirect-load question

The abrupt-death child imports the unchanged configured-completion subtree,
not the Context Engine. That rules out direct helper code changes, not indirect
load. H specifically restores the added worker’s order/resource footprint
while existing lifecycle workers execute exact-base source. Configured cleanup
passed in B, A and H (timings in row 18), as well as earlier repeated four/eight
worker controls and eight instrumented startup probes. The proof worker had
already exited well before capture in the observed controls. H nonetheless
reproduced other exact-base completion deadline failures under host pressure.
Added-worker load alone has **not reproduced** the historical eight-second
configured cleanup failure. It is **not ruled out** as a threshold contributor
under different host load; the original transport/PID evidence is missing.

## Changes and next evidence

The real late-listening-service regression also exposed a pre-existing harness
race: disposal finishes its initial socket checks before a still-importing
service begins listening. It then waited only for file owners. The gated real
SessionService case failed before the fix at 10660.9 ms and against exact-base
harness/source at 10315.9 ms; after the fix it passed at 619.1 ms. Ownership
polling now revisits late sessions/socket lifecycle within its unchanged budget.
The fixture uses a longer idle lifetime solely to prevent automatic idle exit
from masking the ordering race. No production timeout changed. This proves
a base harness defect, not the precise cause of every historical wait timeout.

A deterministic test-only ownership cleanup fix also changed the harness:
ETIMEDOUT now means ownership is unknown/pending inside the existing ten-second
disposal budget. The two-second scan timeout is unchanged. Only a subsequent
completed scan showing no owners permits success. Other inspection errors
still fail immediately. A real late-writer regression failed before this fix
and passed after it; persistent unknown ownership still fails at the original
deadline. No production timeout or ownership assertion was relaxed.

Additional test diagnostics include bounded recent ownership
probe history; failure-only owner PID/ps status/socket state; frontend PID/exit/
output diagnostics; configured transport/inner process diagnostics. Original
unresolved errors and cleanup deadlines remain failures; diagnostic collection does not
signal, kill, ignore or substitute ownership checks. No production fix is
claimed without a demonstrated cause. Existing late-writer hygiene coverage
is included in the affected suite.

On a recurrence, correlate the final ownership history with ps status/state
and socket/session state; for capture, distinguish leftover transport, live
helper and zombie PID. For blank startup/hot swap, record whether the frontend
or shell is alive/ready and whether any output arrived. Until that evidence
identifies the remaining variants, the proof is **not ready to checkpoint**.

Raw evidence lives in `/private/tmp/nmsh-lifecycle-matrix-*.log` and
`/private/tmp/nmsh-lifecycle-observations-*`; these temporary logs are not needed
for understanding the durable matrix above. No physical QA is claimed.
