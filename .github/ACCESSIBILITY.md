# Accessibility in notMyShell

notMyShell (NMSh) is a terminal frontend over a persistent real shell. We aim to make its essential workflows usable from the keyboard, in narrow terminal windows, without relying on color or animation alone. This is a statement of **intent, known limitations and contribution guidance**, not a certification of WCAG conformance or comprehensive screen-reader compatibility.

## Accessibility principles

- **Keyboard first.** Primary actions should be available without a mouse; focus, cancellation, prompts and explicit confirmations should be legible. Focusing a menu item never authorizes executing its command.
- **Communicate status with words.** Distinguish running, awaiting input, paused, succeeded, failed and interrupted states using text and clear glyphs as well as color, with factual exit status where appropriate.
- **Support different terminal capabilities.** Test narrow widths, text wrapping, Safe/ASCII glyph fallbacks, `NO_COLOR`, low-color terminals, and reduced visual effects. Keep relevant content separate from decorative chrome.
- **Respect motion preferences.** Motion and screen effects should be optional and not the only way to learn the state of a command.
- **Preserve terminal ownership.** Fullscreen or interactive tools, hidden input, shell readers and password prompts require correct input handoff; NMSh should not steal those keys.
- **Keep output faithful.** Copying or exporting command output should not add NMSh-specific visual escape sequences or omit meaningful raw text.

## Testing and present limitations

NMSh's behavior depends on the operating system, real shell, terminal host and any multiplexer. Ghostty and macOS Terminal.app are important targets; supported Linux configurations also need testing. Keyboard shortcuts can be intercepted by host software, and not every UI surface has completed physical verification.

**We do not currently claim comprehensive screen-reader support or formal WCAG conformance.** Screen-reader behavior and terminal accessibility vary. Treat the project's issue tracker and physical release-QA checklists as the authoritative record of test coverage; automated tests and screenshots are not equivalent to physical keyboard or assistive-technology testing.

## Areas to improve

- Validate keyboard focus, escape/cancel paths, modal handoffs and alternative shortcuts across terminal hosts and multiplexers.
- Test screen readers and assistive technology in real supported configurations.
- Verify Safe/NO_COLOR, narrow rendering, reduced motion, contrast, glyph fallback, mouse alternatives and alternate-screen compatibility for new features.
- Report known gaps accurately rather than marking untested accessibility criteria passed.

## Report an accessibility issue

Please [open an accessibility issue](https://github.com/raiseCatError/notMyShell/issues/new/choose) with NMSh version/commit, OS, terminal emulator, shell, screen-reader or assistive technology if relevant, text/glyph/motion settings, steps to reproduce, expected behavior and actual barrier. Report whether an equivalent keyboard path exists.

**Do not publish secrets, private terminal history, credentials or sensitive output.** Report vulnerabilities or unexpected secret disclosure confidentially using [SECURITY.md](../SECURITY.md). General help is covered by [SUPPORT.md](../SUPPORT.md), and code contributions by [CONTRIBUTING.md](../CONTRIBUTING.md).

Accessibility reports and tests are welcome. Please preserve NMSh's existing PTY, exact-output, safe keyboard/input ownership and optional visual-presentation guarantees. Revisit this statement whenever major supported-host or input-interface behavior changes.
