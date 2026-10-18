# Deterministic presentation for tests

Set `NMSH_DETERMINISTIC=1` when launching NMSh to make its current presentation
more repeatable in visual and integration captures:

```sh
NMSH_DETERMINISTIC=1 npm run dev
```

This is a developer/testing aid for visual snapshots, integration tests, and
the VHS demo recordings. It is opt-in and does not change the normal runtime.

## Stabilized today

- NMSh's displayed command completion time is fixed to 09:41 local time. The
  measured command duration and the underlying shell event timestamp remain
  real.
- NMSh shimmer and live activity spinner presentation use a fixed phase.
  Command duration text remains based on real elapsed time.
- Vespyr stays in its open-eye frame; the ambient blink timer is not started.
  Its existing blink delay sequence is already deterministic and has no random
  choices.

The fixed completion clock uses the local-time formatter, so it stabilizes the
displayed hour and minute across runs on a host. It does not normalize locale,
terminal width, colors, or other host presentation settings.

- Keep Awake can run against an inert backend: with `NMSH_DETERMINISTIC=1`,
  `NMSH_KEEP_AWAKE_BACKEND=inert` starts the same detached NMSh-owned wait
  helper without any inhibitor, and `NMSH_DEMO_AWAKE_IDLE_MS` shortens the idle
  reminder delay. Both are ignored without `NMSH_DETERMINISTIC=1`.

The VHS demo pipeline (`npm run demos`, [scripts/demos](../../scripts/demos/README.md))
records with this mode on.

## Deliberately unchanged

This mode does not freeze `Date`, randomness, or timers globally. Shell commands,
zsh state, PTY output and timing, session expiry, service protocol timing,
timeouts/retries, external programs, persisted timestamps, and filesystem IDs
remain real. NMSh currently has no general animation engine or random ambient
visual choices; this seam does not implement the future #172 animation system.
