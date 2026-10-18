# Keep Awake

`/caffeinate`, `/awake` and `/zoomies` are three names for one feature: keep the computer (and optionally the display) awake for a while, using the operating system's own mechanism, and show that it is on without turning it into a warning.

```text
/zoomies                 open the panel (starts nothing by itself)
/zoomies display         Display mode until stopped
/zoomies system 2h       System mode for two hours (durations: 45s, 30m, 2h; up to 7 days)
/zoomies status          mode, backend, start time, duration, timeout, PID
/zoomies stop            end it
```

## Backends

| Platform | Mechanism | Modes |
| --- | --- | --- |
| macOS | Apple `/usr/bin/caffeinate` with fixed flags (`-i`, `-d -i`, `-s`, `-d -i -s`, optional `-t`) | Idle, Display, System (AC power only, per Apple), All |
| Linux | `systemd-inhibit --what=idle\|sleep --mode=block` around an NMSh-owned wait helper | Idle, System, All. **Display is unavailable**: the systemd inhibitor is not a display API, so NMSh says so instead of pretending. Lid switch and power keys keep their normal behavior. Without `systemd-inhibit` there is no backend. |
| Windows | `SetThreadExecutionState` from a fixed hidden PowerShell helper (absolute System32 path) | Idle and System are the same Windows assertion; Display adds display-required. No away mode, no `powercfg`. |

Every value that reaches a child process is an enum or a validated integer. Power settings, desktop preferences and rc files are never changed.

## Ownership and lifecycle

- The assertion is a **detached NMSh-owned background process** started by the Keep Awake controller, never a command in the user's shell: it is not written to the PTY, has no terminal stdio, creates no shell history, transcript block or foreground-command state, and the composer comes back immediately. Typing `caffeinate` yourself is an ordinary foreground shell command and is never intercepted.
- It outlives the NMSh window and ends on Stop or its timeout.
- `keep-awake.json` in the NMSh config directory records a random token and the exact launch. A record counts as NMSh's only while its process is alive and its command line still matches; anything unprovable is cleared, never killed. `/zoomies stop` therefore never touches a `caffeinate` you started elsewhere.
- Changing mode asks first (default No) and starts the new assertion before releasing the old one.
- Ask reads and changes the same controller: status questions answer directly; start, change, timed and stop requests are typed actions behind Ask's Yes.

## Presentation

Off renders nothing anywhere. While active, NMSh shows it in this order of prominence:

1. **Composer accessory** — `Awake · Display` (Text), or with the semantic icon (Icon, Icon + text; Safe glyphs fall back to text).
2. **Status Strip** — always included while the strip is on (no per-item switch); it narrows to `Awake`, then the glyph, before anything would drop it. The strip is never turned on for it.
3. **Idle reminder** — after 30 s (configurable) without NMSh input, the accessory adds the time and a muted `/zoomies stop`; if that does not fit where the label is, one muted row next to the composer carries the time and the hint. The next input collapses it.
4. **Screensaver** — a small positioned status (`Awake · Display · 1h 13m`), default Bottom left, six positions, or Off. The saver and Vespyr are not changed.
5. **`/zoomies status`** — full facts.

### Placement

The prompt owns its structural space; the accessory moves around it. Each frame the composer's candidate slots (top edge, bottom edge, adjacent row, input trailing) are resolved against the real screen plan as available, occupied or unavailable:

- **Composer edge** (default): a plain top divider if it fits; otherwise the bottom divider (for example when a header prompt is drawn into the top edge); otherwise one row adjacent to the composer. Dividers Off means both edges are unavailable; dividers are never turned back on.
- **Above composer**: always the adjacent row, before the composer block (for Dock Top too).
- **Input row**: the end of the first input row only while the edit is single-line with room to spare and no right prompt shares that row; the editor's wrapping, caret, selection and mouse hit testing all use the narrowed width. Otherwise the adjacent row.

A fallback is per frame; the saved preference never changes. Prompt text, the right prompt and provider output are never truncated, shortened or edited for it, and it never enters the transcript, history, `/copy`, archives, the PTY or historical prompt snapshots.

Both composer edges render through one exact-width edge renderer that sets the accessory into the rule's trailing portion; the Chroma divider animation repaints that same composed edge, and transition tints skip the accessory, so the label neither disappears nor shimmers.

Colors are theme roles: the accent role while active, the muted role for the reminder, the failure role for errors. `NO_COLOR` and 256-color terminals follow the shared color escape. There is no animation and no recurring OS notification.

## Demos and tests

`NMSH_DETERMINISTIC=1 NMSH_KEEP_AWAKE_BACKEND=inert` selects an inert backend (the same detached wait helper without any inhibitor) so tests and VHS recordings exercise the real slash, controller, ownership and presentation paths without keeping a machine awake. `NMSH_DEMO_AWAKE_IDLE_MS` shortens the idle-reminder delay, also only under `NMSH_DETERMINISTIC=1`. Both are ignored otherwise.
