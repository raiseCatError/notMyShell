---
title: Shell and platform compatibility
description: Supported backends, terminal hosts and honestly stated validation limits.
group: Understand the system
order: 12
sources: [README.md, docs/architecture/shell-adapter.md, docs/architecture/platforms.md]
---

## Three real shell backends

| Shell | Requirements and limits |
| --- | --- |
| zsh | Default backend; NMSh owns input instead of ZLE UI |
| Bash | 4.4+; macOS's bundled Bash 3.2 is too old |
| Fish | Native Fish adapter; completion and history use Fish semantics |

`/shell` switches the current backend with safety checks. Jobs and session state
matter: switching is not just changing the text in a shell label. PowerShell and
Nushell are not supported shell backends in the stable release.

Your startup configuration is loaded through a controlled private bootstrap.
NMSh does not silently rewrite your rc files. Prompt widgets, instant prompts,
and editor plugins that expect to own the UI may need ordinary-shell use instead.

## Platform maturity

| Platform | Current evidence |
| --- | --- |
| macOS | Primary platform; earlier physical testing exists, latest-release physical QA pending |
| Linux | Beta; Ubuntu CI and Fedora subset, physical validation pending |
| Windows through WSL 2 | Beta supported path; detection fixtures, no real WSL physical QA |
| WSL 1 | Detected but not supported |
| Native Windows | Not supported |

Install and run Linux Node.js and NMSh **inside WSL 2**, not a native Windows Node
process. Runtime sockets must use a private Linux filesystem path, not `/mnt/c`.

## Terminal hosts

NMSh does not require a particular host. Ghostty, Terminal.app and editor-integrated
terminals have different capability profiles. Advanced key combinations, mouse,
clipboard helpers and terminal selection depend partly on that outer host.

Linux copy uses `wl-copy` or X11 helpers when available; notifications need a
reachable desktop environment. Missing optional helpers should be reported, not
treated as proof that the underlying shell cannot run.

See [platform evidence](/docs/reference/platforms/) and the
[open release QA checklist](/docs/reference/physical-qa/). Automated testing is not
physical acceptance in Ghostty, Terminal.app, Linux or WSL.
