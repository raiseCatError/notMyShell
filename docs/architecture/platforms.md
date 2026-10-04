# Platforms: macOS, Linux, WSL 2

| Platform | Status |
|---|---|
| macOS | Supported; physically validated on the hosts listed in the QA records. |
| Linux | Supported by automated tests (Ubuntu CI on Node 22 and 26; this run also exercised zsh 5.9, Fish 3.7 and Bash 5.2 on Ubuntu). **Physical terminal validation pending.** |
| WSL 2 | The supported Windows path: Windows terminal host → WSL 2 → Linux Node.js → NMSh → zsh / Fish / Bash. Detection and logic are tested with simulated kernels and environments. **No real WSL physical QA yet.** |
| WSL 1 | Detected and reported as not supported (no Linux kernel; PTY, signal and socket behavior can differ). Nothing is disabled pre-emptively; `nmsh doctor` and `/status` say so. |
| Native Windows | Not supported. A future ConPTY + PowerShell/Nu design is out of scope; zsh is never forced onto Windows. |

`src/host/platform.ts` separates the **guest** (where Node runs) from the
**terminal host** (which, under WSL, is a Windows application).

## WSL detection

Strongest evidence first: the kernel release (`…-microsoft-standard-WSL2`
means WSL 2; `4.4.0-<build>-Microsoft` means WSL 1), `/proc/version`, then
`WSL_DISTRO_NAME` / `WSL_INTEROP` (set by WSL 2). Unknown versions say
"version unknown; WSL 2 is the supported path".

## Linux audit (v0.16)

| Area | State |
|---|---|
| PTY lifecycle, process groups, signals | Same POSIX path as macOS (node-pty Unix backend). Interrupt, background jobs and shell switching tested live for zsh, Fish and Bash. |
| XDG paths | Config `$XDG_CONFIG_HOME/nmsh` (absolute only) else `~/.config/nmsh`; history import honors `XDG_DATA_HOME` for Fish. |
| Runtime/sockets | `$XDG_RUNTIME_DIR/nmsh` only when it is a private, owned, non-symlink directory with a short enough socket path; otherwise a per-uid temp directory. Windows mounts (`/mnt/c`, drvfs) never qualify because they fail the private-permission check. |
| Shell discovery | zsh: system paths then PATH. Fish: PATH only. Bash: PATH then system, version ≥ 4.4. |
| Clipboard | `wl-copy` (Wayland) or `xclip`/`xsel` (X11). WSLg provides Wayland; without it `/copy` explains what is missing. |
| Notifications | `notify-send` when installed and a desktop session (D-Bus, Wayland or X11) is reachable; otherwise unsupported, as before. |
| Package managers (v0.17) | `/tools` builds typed executable + argv plans for APT, DNF, pacman, zypper (chosen from `/etc/os-release` ID/ID_LIKE, WSL included) and Homebrew. Only curated, factual package names have a plan; everything else is shown as manual. Non-root plans are explicitly `sudo -n …` (never a password prompt) and name the command to run yourself if sudo needs one. |
| Open helper (v0.17) | `xdg-open`, then `wslview`; neither is required. |
| Install/uninstall | Same source-checkout + `npm link` model; `nmsh uninstall` works from XDG paths and refuses while live sessions run. |
| Config transfer | Exports contain no host paths, so they move between macOS and Linux. |
| Agent detection, history | Platform-independent. |
| Temp files | All bootstrap and helper directories are private `mkdtemp` directories, removed on exit; tests fail on leaks. |

A container without a UTF-8 locale makes zsh treat non-ASCII names as
non-alphanumeric; one existing zsh test depends on a UTF-8 locale, as CI has.

## Evidence levels (v0.17)

These are different claims and are not interchangeable.

| Platform | Supported | Tested in CI | Physically validated | Notes |
|---|---|---|---|---|
| macOS | Primary | Yes (macOS runner) | Yes (maintainer) | |
| Linux | Beta | Ubuntu 24.04 (full suite; zsh, Fish and Bash installed) and a Fedora subset | No | Package-manager plans, clipboard/notification/open fallbacks and XDG paths run from deterministic fixtures. |
| WSL 2 | Beta, documented limits | Fixtures only (detection, distro, Windows Terminal facts via `WT_SESSION`, mount handling, fallbacks); no WSL runner | No | NMSh inside WSL is a Linux environment. |
| WSL 1 | Detected and reported, not supported | Fixtures | No | |
| Native Windows | Unsupported | n/a | n/a | |

Package-name tables for APT, DNF, pacman and zypper are curated from distribution naming and covered by unit tests; they were not installed on real machines in this release.
