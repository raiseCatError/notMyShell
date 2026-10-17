---
title: Troubleshooting
description: Diagnose installation, keyboard, prompt, clipboard and session problems.
group: Understand the system
order: 15
sources: [README.md, SUPPORT.md, SECURITY.md, docs/architecture/platforms.md]
---

## Start with facts

```sh
nmsh --version
nmsh doctor
```

Include the installed version, shell, operating system, terminal host and a minimal
reproduction in a bug report. Diagnostics are designed to omit history, prompts
and secrets, but review anything you share, especially additional command output.

## NMSh does not start

Check Node.js 22+ and a supported shell. A source build needs the `node-pty` native
install step; refusing its install script prevents a working PTY. Build failures
can require the platform's C/C++ toolchain and Python. macOS Bash 3.2 is too old:
use zsh or install a newer supported Bash.

GUI terminals can have a different PATH from an interactive shell. Use absolute
Node/launcher paths in terminal launch configuration as described on the
[installation page](/install/#troubleshooting).

## Keys, glyphs or prompt look wrong

Try Ctrl+J for a newline, safe glyphs for font issues and reduced motion for visual
comfort. Confirm the terminal forwards your keybinding. Do not restore ZLE UI to
fix a composer shortcut. External prompt providers have documented limitations;
try Native or None to isolate provider-specific behavior.

## Clipboard or notifications are unavailable

On Linux, check `wl-copy` under Wayland or `xclip`/`xsel` under X11. A headless
environment may not have a clipboard or D-Bus desktop notification service.
This is a host capability issue, not evidence that `/copy` should add ANSI chrome.

## A session still runs after I close a window

That is normal for a service-backed live session. List it with `nmsh --sessions`
and attach explicitly. Do not uninstall while work is still running. Saved
transcripts and live processes are different; see [Sessions](/docs/sessions/).

## Known release limitations

Physical acceptance for the final v0.20 launch build is pending. Fish type-ahead
during `read` remains a tracked compatibility concern. Managed targets are Claude
Code beta only; the GitHub workspace is read-only and workspace regions are
experimental, Off by default. Background tasks need a matching session service.
Check the [candidate changelog](/docs/reference/changelog/) and
[release status](/releases/#launch-baseline) for the exact source checkpoint.

## Ask for help safely

[Open a bug report](https://github.com/raiseCatError/notMyShell/issues/new?template=bug_report.yml)
for reproducible problems. **Do not disclose a suspected vulnerability publicly.**
Use the repository's [private security reporting](https://github.com/raiseCatError/notMyShell/security/advisories/new)
and [security policy](/docs/reference/security/) instead.
