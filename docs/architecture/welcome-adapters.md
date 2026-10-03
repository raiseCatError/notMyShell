# Optional external welcome adapters

Vespyr remains the Native default. Settings → Welcome selects a curated external
fetch adapter or None. Selection is opt-in; detection never changes it. Captures
are argv-only, bounded to 2.5 seconds and 128 KiB, sanitized into an SGR-only
screen, and stored as presentation rather than shell commands. Missing/failing
adapters fall back to Vespyr with a factual notice. No managed shell state changes.
NO_COLOR strips captured styling; narrow widths hide the capture.

The registry uses the existing provider framework, not a second integration
system. Fastfetch is the primary external choice. Neofetch remains archived/legacy
with no install recipe. [Macchina](https://github.com/Macchina-CLI/macchina)
explicitly declares maintenance mode; it is an installed-only option, not a
recommendation. [Zigfetch](https://github.com/utox39/zigfetch) is unarchived and
its upstream was active on 2026-09-20 when audited on 2026-10-01. Its upstream
documents macOS caveats. It remains an installed-only optional adapter with no
installation recommendation. These metadata claims are not compatibility tests.

Arbitrary custom commands are deferred. No discovered executable becomes a
welcome command automatically. A future custom adapter must require explicit
argv configuration and keep the same capture limits and sanitation boundary.
