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
Linux probe validation and observed CI remain pending.

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
