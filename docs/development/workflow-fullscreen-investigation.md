# Fullscreen reattach investigation

Coordination: [#359](https://github.com/raiseCatError/notMyShell/issues/359).
The frontend freeze remains pending. This diagnostic branch is additive above
Report `648002fcfb26b64b84718d0d386ae86dbe271dd1`; it is not a production fix or
an accepted feature head.

[Actual Report CI 38405554008](https://github.com/raiseCatError/notMyShell/actions/runs/38405554008)
failed Ubuntu shard 1/2. The real fullscreen fixture timed out waiting for
`REDRAW 33 90` at its unchanged deadline; trap output reported 29×90 and 28×90.
The frontend remained alive. Other applicable jobs and Vim/less repaint passed.
Local canonical verification of the exact Report head passed. These results do
not establish the failed-run cause.

## Failure-only observations

`tests/helpers/fullscreenFailure.ts` runs only after the original fullscreen
assertion has already failed, before sandbox cleanup. It appends its observations
and rethrows the original failure. No assertion, deadline or production source
changes. Diagnostic controls call the helper directly to validate it; their
successful observations do not attribute the historical failed run.

The helper validates the recorded session ID and backend PID against the private
live registry. It observes the backend and outer frontend PTY sizes with bounded,
read-only `stty size` calls using validated slave paths. It retains session state,
fullscreen/running-presence flags, bounded descendant process state and, on Linux,
foreground process group, wait channel and signal masks. Every subprocess shares
a five-second diagnostic budget with a one-second individual maximum. Missing,
failed, timed-out or unsupported observations remain explicit.

It sends no input, resize or signal. It records no environment, command arguments
or program output. PID discovery is limited to descendants of the validated owned
backend. The existing sandbox lifecycle still owns teardown. The focused source review found no material issue. On macOS arm64 / official
Node 26.11.1, one worker and private T7 roots, probe identity/geometry controls
and unchanged real lifecycle tests passed. The full `npm run verify` gate
passed afterward, including build, canonical runtime/ranking, cleanup and diff
checks. These passing observations do not attribute the historical CI failure.
Linux arm64 probe/lifecycle validation also passed. The isolated diagnostic
head `50ba4dc853cdbe2ca1b29575b22f1f22f3ef7b15` completed
[comprehensive CI 38421963998](https://github.com/raiseCatError/notMyShell/actions/runs/38421963998):
all required platform, Node 22, Fedora, timing and quality checks passed. Attempt
1 lacked a macOS hosted runner and produced no steps/log; GitHub explicitly
reported runner acquisition failure and arm64 capacity constraints. Only that
unexecuted job was retried once. This is diagnostic evidence, not acceptance of
the failed original Report head.

## Interpretation

- A final backend size of 29 rows points toward a missing or overwritten full-size
  resize. A subsequent bounded phase trace should locate that transition before
  proposing a production fix.
- A final backend size of 33 rows points toward WINCH delivery or trap sampling.
  The repaint assertion still fails; geometry alone does not prove repaint.
- A passing observed run does not clear the failed original head or prove a flake.
  No unobserved rerun is used to accept the known failing gate.

The WINCH fixture invokes an external `stty` from a zsh trap; its output samples
geometry rather than recording each applied resize. Signal/trap timing is a
hypothesis, not an established cause. Earlier startup/current-owner corrections
have independent failing-before/passing-after controls and are retained. They
are not claimed as retrospective attribution for this failure.

Full latest Linux/Fish, remaining published-head CI, security acceptance and
physical terminal/clipboard QA remain separate requirements. No integration or
release/master merge is authorized by this investigation.

## Confirmed fixture correction

A standalone Linux control showed the original zsh WINCH trap printing only an
older size while the final PTY was independently verified at 33×90. Signal state
showed WINCH blocked and pending while the trap's external `stty` sample was held.
The synchronized real-NMSh control confirmed the same defect after reattach:
hold a 32-row sample, resize to 33 rows, verify both PTYs, mark the new output
window, then release. The original trap missed the fresh 33-row repaint at its
unchanged 20-second deadline. A trap-set flag consumed in the main loop repainted
32 rows and then the current 33 rows under the same conditions.

The durable regression is `tests/fullscreenResizeSampling.test.ts`, sharing the
actual acceptance fixture with `tests/sessionLifecycle.test.ts`. It delegates
non-size termios operations to real `stty`, holds only an explicitly armed older
sample, verifies the current owned PTYs independently, and marks output after the
held window so historical redraws cannot satisfy the assertion. It also verifies
return to the composer and subsequent command execution. Sandbox teardown stays
unchanged. An initial reattach failure remains separate evidence; only the fresh
post-release failure proves this sampling regression.

The repository regression failed against the original shared fixture on macOS
arm64 at the expected 20-second repaint wait, despite both PTYs being 33×90. The
minimal fixture correction sets a dirty flag in the signal handler and clears it
before querying geometry in the main loop. A WINCH during that external query
therefore survives for the next repaint. The unchanged regression, geometry
controls, full lifecycle cases and real Vim/less repaint passed afterward.
Direct strict TypeScript checking of the new test helpers also passes; explicit
success/unavailable unions change no runtime observations.

Production geometry and startup/input behavior are unchanged by this fixture
correction. The original repaint assertion/deadline and real-program tests remain
intact. The historical CI run did not capture actual PTY size, so its exact final
geometry is still unknown. Earlier standalone synchronization and stale-output
control attempts were inconclusive and remain recorded in the handoff; no retry
of the genuine failed feature CI is used for acceptance. Fresh canonical and
actual published-head CI gates are required after this correction.
