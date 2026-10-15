# Live command tracking (`/track`)

Tracking is a native command over the existing bounded `/watch` scheduler and display. It periodically executes a **finite** command outside the foreground PTY and replaces the latest completed **display snapshot** in one persistent live command view. It does not append a foreground transcript entry for each refresh.

## Usage

```sh
/track df -h /Volumes/T7Projects
/track docker system df
/track --every 5s -- docker system df
/track list
/track refresh
/track pause 1
/track resume 1
/track stop 1
/track stop all
```

The `--` delimiter after the cadence is optional, but preferred when arguments are ambiguous. `/watch` continues to accept its existing syntax, and both names manage the **same** tracked commands. A bare `/track` opens the shared manager. Indexes in controls are current *active* positions; use the panel for selection.

The compact track row above the composer reports the command, cadence, latest completion freshness, state and run count. Open the panel to see current output, previous summary and detected changes; **Enter** toggles full current output, **P** pauses/resumes, **R** refreshes once, **C** copies the latest completed sanitized snapshot, **S** stops. A still-running sample never replaces a completed sample early. Errors and exit codes remain visible.

## Command execution and safety

- Every sample starts a separate finite `/bin/sh -c` process with its own process group and the working directory captured on creation. It does **not** run inside or inherit aliases/functions/unexported variables from the persistent interactive zsh/Bash/Fish shell.
- Default interval: five seconds; minimum two seconds locally and 15 seconds for remote network commands. Explicit intervals must be positive, finite, and at most 60 minutes; invalid intervals fail closed before any shell spawn. Up to eight active trackers are permitted. A sample never overlaps another sample of the same tracker. Manual refresh cancels its pending timer but never interrupts a sample already executing.
- Repeated commands may have side effects. A read-only `df` or exact `docker system df` report can start immediately. Unknown commands require explicit confirmation; classified destructive/privileged/modifying commands are refused. Other Docker operations are **not** automatically trusted.
- Each run captures at most 200,000 bytes of stdout/stderr with incremental UTF-8 decoding. Truncation, spawn failures, signals and timeouts remain visible; completion awaits captured stdio close and records the result as failure on timeout. The run timeout is the lesser of 60 seconds or three refresh intervals. Stop requests SIGTERM to the owned process group, then SIGKILL after a bounded grace period if still running, and releases inherited output streams. Detached descendants that escape the owned process group cannot be guaranteed terminated.
- Shell/process substitutions, detached background operators, heredocs, multiline input and obviously destructive commands fail closed before repeated execution. Other non-read-only or unknown commands need explicit confirmation. Full terminal control sequences are removed from the **displayed** text. Copying from the track panel copies this sanitized latest display snapshot, *not* raw PTY bytes or all prior refreshes. It is explicit and unredacted, like plain `/copy`; do not copy secrets casually.

## Scope and outstanding design

This initial delivery reuses the currently **window-scoped** `/watch` implementation: trackers stop when this NMSh frontend exits, rather than surviving detach as #382 service-owned tasks. The current UI is a compact live row plus a detail panel, **not an editable transcript command block**. It does not yet implement persistent/restorable session-service scheduler identity, deep historical snapshot search, full raw-byte clipboard parity, or durable one-block transcript integration.

Those remain tracked on [#393](https://github.com/raiseCatError/notMyShell/issues/393). Do not claim full #393 acceptance or physical terminal validation from automated tests. Any service integration should reuse #382's supervision and preserve foreground input/queue ownership, rather than introducing a second task service.

This branch is a **post-v0.20 draft feature**. It does not expand v0.19 or v0.20 release gates and should not be merged into either release candidate without a separate maintainer decision.
