# Terminal host capabilities (unreleased v0.10)

`TerminalHost` combines diagnostics/window launching with a plain capability
record. `src/host/capabilities.ts` owns conservative adapter hints; general
presentation consumes values, not terminal names. Unknown hosts and Terminal.app
have a keyboard-only baseline. No host preferences change during detection.

Every new frontend constructs its own host, including live-session reattach.
Capabilities never enter the shell service protocol, journal or shell environment.
The old shell's inherited environment remains authoritative for its commands.

Before renderer entry, one parallel batch requests Kitty keyboard flags and
DEC mode 2026 status. Both share an 80 ms maximum wait. Split replies are gathered
before parsing; early typing is replayed to the editor, and bracketed paste
contents are preserved. Listener cleanup also runs on failed writes. Reattached
interactive applications retain query ownership: startup skips probes there.
No probes occur per render. A new attachment does not reuse old query results.

The renderer gates Kitty push/pop and mouse modes on capabilities. Keyboard
alternatives (Ctrl+J, Ctrl+W, Ctrl+R, F1, Ctrl+O, focus navigation) remain available.
Synchronized output wraps only one owned redraw and closes in `finally`, never
PTY streams. Suspended rendering cannot repaint over an interactive application
or pop the owned keyboard stack twice during exit.

Protocol references: [Kitty keyboard detection](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)
and [synchronized output](https://ghostty.org/docs/help/synchronized-output).
Adapter hints are fallback evidence, not physical compatibility certification.
Physical validation remains deferred.
