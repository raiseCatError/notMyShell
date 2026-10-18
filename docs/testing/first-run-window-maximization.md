# First-run window maximization: support and physical QA

Design: [first-run startup](../design/first-run-startup.md#one-time-window-maximization).
Code: `src/host/window/`. Tests: `tests/hostWindow.test.ts` (adapters, routing,
the one-time session), `tests/startupWindow.test.ts` (selector and app).

During the genuine first-ever onboarding only, NMSh may offer
**Use more screen space for setup?** with **M** Maximize for setup and **K** Keep
current size. It never maximizes without that answer, never on `/startup` or a
later launch, and keeps nothing about it beyond process memory. The window is
put back after the ending finishes (never mid-transition), at once on Leave, and
synchronously on exit, only if it is still exactly as NMSh left it. Onboarding
is identical everywhere else; the offer simply never appears.

## What is verified, and how

| Evidence | What it covers |
| --- | --- |
| Fake commands and a fake `/proc` (`hostWindow`) | Routing, identity, state checks, the exact commands and argv, refusal outcomes, never toggling blindly, never restoring over user changes. Five deliberate mutations of safety checks each fail a test. |
| Fake window (`startupWindow`) | First run vs `/startup` and later launches, accept, decline, Leave, Reduced Motion, exit, a refused maximize, nothing saved. |
| Real macOS run (developer Mac) | The geometry JXA reads displays and a CoreGraphics window without any permission prompt; the three Terminal.app AppleScripts compile against Terminal's dictionary (no Apple events sent). |
| Real Linux run (CI, `ubuntu-24.04`) | `/proc` pty-master ownership on a real pty from `node-pty`. |
| Not yet verified | Any real window being zoomed or maximized and put back. Fill in the checklists below before claiming it. |

## Supported hosts

| Platform and host | Mechanism | Status |
| --- | --- | --- |
| macOS Terminal.app | AppleScript (Automation, never Accessibility): the window whose tab's tty is NMSh's, `zoomed` and bounds read first; native fullscreen detected from the display frame | Implemented; physical QA pending |
| macOS kitty | Remote control over `KITTY_LISTEN_ON` (`unix:` only; kitty accepts socket requests without asking whenever it listens); ownership by ancestry, `ls --match`, the kitty window's tty and CoreGraphics; state from bounds | Implemented; physical QA pending |
| macOS Ghostty | No geometry in its AppleScript, `toggle_maximize` has no effect on macOS | Unsupported, silently |
| Linux Hyprland 0.55+ with a Lua config (current Omarchy) | `hyprctl` IPC: version and config type checked; the one client owned by NMSh's nearest terminal ancestor (and holding its pty where `/proc` shows it); `hl.dsp.window.fullscreen({ window = "address:…", action = "set"/"unset", mode = "maximized" })` | Implemented; physical QA pending |
| Linux Hyprland 0.52–0.54, or 0.55+ with a hyprlang config | Its maximize acts on the focused window only (focusing first would move the pointer) | Unsupported, silently |
| Linux Hyprland before 0.52 | Toggle only | Unsupported, silently |
| Linux X11 (any terminal) | No dependency-free way to read the window's state | Unsupported, silently |
| Linux GNOME / KDE Wayland | Compositors keep window control from a terminal's children | Unsupported, silently |
| kitty on Linux outside Hyprland | kitty reports no maximized state, so any toggle would be blind | Unsupported, silently |
| SSH, tmux, screen, Zellij | The window cannot be proven NMSh's | Unsupported, silently |
| Zed, VS Code, JetBrains, Emacs and Neovim terminals | The editor's window | Unsupported, silently |
| Windows, WSL, Windows Terminal | Not managed | Unsupported, silently |
| iTerm2, WezTerm, Alacritty and Foot on macOS | Not implemented | Unsupported, silently |

NMSh never writes Ghostty, kitty, Terminal.app, Hyprland or Omarchy
configuration; never uses xdotool, wmctrl, ydotool, keyboard injection or
Accessibility; never sends a focus or pointer move; runs every command as an
absolute executable with argv (no shell) and a timeout.

## Physical QA: macOS

For each host: a fresh profile (`HOME` and `XDG_CONFIG_HOME` pointing at an empty
directory), run `nmsh`, and record the result next to each step.

**Terminal.app**

- [ ] Normal window: the offer appears; **K** removes it and nothing resizes.
- [ ] Fresh again; **M**: the window zooms once (title bar kept, same Space, not fullscreen).
- [ ] Apply: the ending plays at the larger size; once it finishes, the window returns to its exact original position and size.
- [ ] Two displays: the window zooms on the display it was on, within the menu bar and Dock.
- [ ] Already zoomed or filling the screen: no offer.
- [ ] Native fullscreen (green button, or Ctrl+Cmd+F): no offer, and nothing changes.
- [ ] **M**, then move or resize the window by hand, then Apply: it is left where you put it.
- [ ] **M**, then Leave (Esc, →, Enter): the window is put back at once.
- [ ] **M**, then quit NMSh during setup: the window is put back.
- [ ] Two Terminal windows: only the one running NMSh changes.
- [ ] No macOS permission prompt appears at any point (Terminal is scripting itself).
- [ ] Launch again and `/startup`: no offer.

**kitty** (once with `allow_remote_control socket-only` and `listen_on unix:/tmp/kitty`, once without)

- [ ] Without a listen socket: no offer.
- [ ] With it: the offer appears; **M** maximizes only this OS window (other kitty windows untouched).
- [ ] The steps above for Apply, Leave, quit, manual changes, already maximized and fullscreen.
- [ ] No kitty permission overlay appears, and no escape sequence is visible in the terminal.
- [ ] A terminal started from a shell inside kitty (it inherits `KITTY_*`): no offer there.

**Ghostty**

- [ ] No offer; onboarding otherwise identical.

## Physical QA: Omarchy (Hyprland, Wayland)

Record `hyprctl version` and whether the config is Lua (`hyprctl eval 'return true'`
prints `ok`). Repeat for Foot, Ghostty, kitty and Alacritty.

- [ ] Tiled window: the offer appears; **M** maximizes it with the bar and gaps kept (as Super+Alt+F does); after the ending it returns to its tile.
- [ ] Floating window: the same; it returns to its floating position and size.
- [ ] Two monitors: it maximizes on its own monitor and workspace.
- [ ] Already maximized (Super+Alt+F) or fullscreen (Super+F): no offer, nothing changes.
- [ ] **M**, then un-maximize, fullscreen or move it by hand, then Apply: left as you set it.
- [ ] **M**, then Leave, and **M**, then quit: put back.
- [ ] Focus another window during the ending: NMSh's window is still the one put back; focus and the pointer do not move.
- [ ] Several windows of one terminal process (Ghostty, or `foot --server` with `footclient`): no offer.
- [ ] Inside tmux, over SSH, or reattached with `nmsh --attach`: no offer.
- [ ] A hyprlang configuration, or Hyprland older than 0.55: no offer.
- [ ] Aurora, Vespyr, the selector and the ending render correctly in Foot, with and without maximization.
- [ ] Launch again and `/startup`: no offer.
- [ ] No file under `~/.config/hypr`, `~/.config/omarchy` or any terminal's config changed (compare `ls -la --time-style=full-iso` before and after).

## Known limits

- A maximize still running when NMSh exits is not waited for.
- A window closed with its terminal (SIGHUP) is not put back: it no longer exists.
- Restore after the ending uses the state NMSh saw; if the host rounds the zoom differently on unzoom, Terminal.app is given the original bounds explicitly, kitty relies on its own unzoom.
