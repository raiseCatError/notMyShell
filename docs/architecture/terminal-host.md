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

Existing host configuration is exposed through a passive optional integration
adapter. Core invokes operations only from explicit keyboard/appearance panel
actions. Finding a configuration file for a different terminal no longer enables
those actions. Host-specific guidance and zsh bootstrap terminal hints live under
`src/host/`; architecture tests pin that boundary. No new preference-management
feature is introduced.

## Additional passive profiles

| Profile | Kitty keyboard hint | Mouse / movement / clicks | Selection with reporting | OSC 8 / truecolor | Graphics hint | Configuration adapter |
| --- | --- | --- | --- | --- | --- | --- |
| iTerm2 | Probe only | Yes | Host selection override (verify settings) | Yes | iTerm2 inline images | None |
| Kitty | Yes | Yes | Shift | Yes | Kitty | None |
| WezTerm | Probe only (configuration dependent) | Yes | Shift (configurable) | Yes | iTerm2 inline images | None |
| Unknown / nested | No | No | Native | No / explicit color evidence | None | None |

All synchronized output remains probe-only. A graphics hint never emits image
bytes; rich previews remain research-first. WezTerm supports multiple image
protocols; the single preferred hint is deliberately conservative. Current
iTerm2 documentation also describes Kitty graphics; older installations retain
the established inline-image protocol. No graphics version inference is made.

Explicit `TERM_PROGRAM` takes precedence over inherited outer-host variables.
Missing program evidence may use `xterm-kitty`, `KITTY_WINDOW_ID`, `WEZTERM_PANE`
or the existing resource hint. Multiplexers and `TERM=dumb` suppress profiles.
Color overrides retain their existing precedence; hyperlink overrides use the
existing `NMSH_HYPERLINKS` setting. No preferences are changed for these hosts.

Reattach fixtures switch Ghostty → baseline → Kitty → iTerm2 → WezTerm over one
real persistent shell. Each frontend resolves fresh input modes while the shell
retains its original environment. This is protocol coverage, not GUI validation.

Protocol references: [iTerm2 OSC 8](https://iterm2.com/documentation-escape-codes.html),
[Kitty keyboard](https://sw.kovidgoyal.net/kitty/keyboard-protocol/),
[WezTerm keyboard configuration](https://wezterm.org/config/key-encoding.html),
[WezTerm mouse selection](https://wezterm.org/config/mouse.html), and
[WezTerm graphics features](https://wezterm.org/features.html).
