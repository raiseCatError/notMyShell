# Linux platform foundations

Refs #18, implementation #279, hardening #281. Frozen base #278:
`cfc9c08a5fb7b5f3bc637400a59da7a714a58ae4`. No release or physical support claim.

## Architecture and PTY

The current persistent real-zsh architecture runs on POSIX PTYs. The installed
[node-pty v1.1.0](https://github.com/microsoft/node-pty/tree/v1.1.0) uses its Unix
implementation for both Linux and macOS. Its shipped prebuild directories cover
macOS and Windows; Ubuntu builds the Linux native binding during installation.
CI installs zsh, Python 3 and C++/make prerequisites before `npm ci`.

There is no new shell backend, operating-system god object or command-by-command
spawn path. ShellSession retains authenticated lifecycle markers, real zsh
state, raw output and resize/interrupt semantics. Detached helpers retain their
isolated process groups. Session service ownership remains independent of the
frontend; Unix sockets, journaling, detach/reattach and recovery stay unchanged.

`resolveZsh` is a narrow executable-discovery boundary. It preserves system zsh
preference (`/bin/zsh`, `/usr/bin/zsh`) and accepts executable symlinks in absolute
PATH directories. Missing/non-executable zsh produces a factual requirement;
bash is never substituted. Managed bootstrap, semantic helper, configured
helper and `/zsh` handoff use this resolver. Native fallback retains its existing
PATH-based zsh invocation and conservative failure behavior.

## Linux runtime evidence and a runner-specific difference

The Ubuntu 24.04 runner initially blocked before NMSh startup: global zsh
completion printed an insecure-directory confirmation prompt. That prompt then
consumed command input, causing missing characters and failed completion. A
bounded raw-byte capture from an empty fixture HOME identified the prompt.
CI now audits completion security, repairs only reported system zsh completion
paths in its disposable runner, and re-audits. Product compaudit checks are
never disabled. Ordinary installations should also resolve unsafe system/user
completion permissions; NMSh does not bypass interactive startup configuration.

Slower Linux bootstrap exposed a frontend lifecycle race: a command submitted
before initial shell readiness was incorrectly completed by the initial prompt.
The frontend now retains that queued command until its execution/completion
markers arrive, including an unacknowledged submission restored on reattach.
Deterministic protocol regressions cover both orderings.
Live fixtures await journal completion rather than echoed command text; gated
detach fixtures also wait for the service execution marker before detaching. History
latency tests run separately from concurrent PTY fixtures without relaxing their
regression budget.

Another Linux fixture difference was pipe flushing: immediate `process.exit`
truncated noisy output. Finite/noisy fixtures now set exitCode and drain output.
PTY read boundaries also differ: after the backlog cap, the existing policy
may discard the final output chunk. Fixtures require complete output within
limits, bounded retention/factual truncation beyond them, preserved lifecycle
and successful commands after reattach. They no longer assume macOS chunk
boundaries guarantee a retained tail. These are environment/fixture fixes,
not a divergent Linux PTY implementation.
Actual canonical runtime results are recorded in the cumulative acceptance note.

## Paths and trust

- Linux configuration: absolute XDG_CONFIG_HOME/nmsh, otherwise ~/.config/nmsh.
  Relative XDG values are ignored. Missing/relative HOME uses the OS home lookup.
- macOS retains ~/Library/Application Support/notMyShell and existing absolute
  XDG override behavior. No existing user data is relocated.
- Journals remain `sessions/` inside the existing configuration directory.
- Linux sockets prefer an existing absolute, uid-owned private XDG_RUNTIME_DIR
  plus `nmsh/`, only if the socket stays within a conservative 100-byte budget.
  Invalid, symlink, shared or long XDG roots fall back to os.tmpdir()/nmsh-uid.
- NMSH_RUNTIME_DIR remains the explicit override. Runtime creation still rejects
  symlinks, foreign ownership and group/other permissions. An excessively long
  explicit/TMPDIR socket path can fall back factually to in-process operation;
  use a short private runtime override when persistent attachment is required.
- Bootstrap HOME is quoted literally. Empty HOME never permits configured
  completion to source cwd startup files. Tests cover Unicode, spaces, quotes,
  dollar signs, symlinks, private/relative runtime roots and absent HOME.

[XDG rules](https://specifications.freedesktop.org/basedir/latest/) inform the
Linux runtime and absolute-configuration choices. No XDG state/cache migration
is required for this milestone.

## Optional platform features and audit classification

| Classification | Source areas | Result |
| --- | --- | --- |
| A: portable as-is | PTY/session protocol, renderer/composer, history/transcript, POSIX process groups/signals, helper temp roots, capability resolution | Reuse existing interfaces and real runtime tests |
| B: portable correction | zsh discovery, HOME quoting, missing-HOME trust boundary, absolute config fallback, Linux runtime choice, inaccurate shell diagnostics | Narrow changes plus deterministic/real-shell regressions |
| C: optional no-op/manual fallback | osascript notifications, Terminal.app windows, brew suggestions, macOS Ghostty configuration | Linux does not require these integrations to start |
| D: unsupported | Native Windows zsh/process/security transport; arbitrary host window launchers | No support promise; manual attach commands for unsupported window launch |

`darwin` hits in notification/host/config/provider adapters are intentional.
`osascript` is confined to macOS notification and window adapters. `/Users`
occurrences are sample fixture paths, not runtime roots. `/private/tmp` has no
core runtime dependency. `/bin/zsh` is an executable preference/shebang or
helper fallback, not a macOS-only API. Unix mode/uid/group-signal code is an
explicit POSIX foundation; it is not claimed portable to native Windows.
Terminal.app identity remains a host fixture, not a core renderer dependency.

Linux notifications are a no-op. `notify-send` would need optional executable
and desktop-session delivery policy; parity is not necessary for a runnable CLI
baseline and no dependency was added. macOS notification tests remain intact.
Known Kitty/WezTerm profiles are reused. GNOME Terminal, Konsole, Alacritty and
unknown hosts use conservative baseline plus shared capability evidence.
First later physical target: Kitty, followed by GNOME Terminal baseline.

## CI, diagnostics and packaging

The single workflow has macOS/Ubuntu 24.04 × Node 22/26. Feature pushes do not
create duplicate runs; all stacked PRs receive the same gates. Matrix fail-fast
is disabled so one platform failure does not erase the other evidence. Existing
optional-tool skips remain; no full runtime coverage is replaced with compile
checks. `/status` reports OS/architecture/Node and existing host capabilities,
without environment dumps or telemetry.

For now use a reviewed source checkout: install Node >=22, zsh and native build
tools, then `npm ci`, `npm run build`, `npm link`. Package `private: true` means
an npm registry publication is not currently available. A future release may
use an npm/global CLI package after intentional packaging review. Homebrew
Linux/deb/rpm/AUR create additional maintenance; AppImage/Flatpak/Snap are poor
first choices for this terminal frontend. No installer child or distro package
system is justified in v0.13.

The first portability pass is small (days plus CI/physical QA), not a backend
rewrite. Physical Linux/macOS and candidate WSL checks are additive in
[the deferred QA checklist](../testing/v013-physical-qa.md).
