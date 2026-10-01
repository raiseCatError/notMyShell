# Additive v0.10 physical QA (pending)

This unmerged development stack has not shipped. Package/release version is
0.7.0. Automated protocol fixtures are separate from physical terminal validation.
Use the existing v0.8/v0.9 checklists for their features; the checks below add host
coverage. Do not install every host solely for this checklist.

- [ ] Terminal.app: startup; Ctrl+J multiline; Ctrl+W word deletion; completion;
  Ctrl+R history; inspector; F1/palette and keyboard block controls; resize;
  INLINE/FOLDED/LIVE; long-running command; TUI passthrough and exit; `/copy`.
- [ ] Terminal.app: Safe glyphs, narrow widths, 256/16 colors and NO_COLOR;
  restore a session previously displayed in an enhanced host.
- [ ] Ghostty: Shift+Enter, Option+Backspace, hover/click; Shift selection;
  synchronized redraw if reported; links; detach and attach from another host.
- [ ] iTerm2 / Kitty / WezTerm where available: startup; `/settings` Status host
  capabilities; input; resize; passthrough and exit; links. Graphics only if an
  implementation is added (currently none).
- [ ] tmux: nested session, resize, alternate screen, mouse ownership, Shift
  selection, passthrough, suspend/resume and detach/reattach.
- [ ] Available agent-oriented terminal: persistent shell, worktree cwd, resize,
  agent CLI ownership and exit restoration. Accounts/tools remain optional.

Every row remains pending until an actual human result is recorded. Host
configuration is not applied automatically.

- [ ] iTerm2: mouse hover/click and native selection override with current host
  settings; Ctrl+J fallback; Kitty keyboard only if startup probe confirms it.
- [ ] Kitty: enhanced keyboard push/pop across TUI exit and detach; Shift
  selection with mouse reporting; no automatic remote-control configuration.
- [ ] WezTerm: keyboard encoding with `enable_kitty_keyboard` disabled/enabled;
  fallback Ctrl+J; configurable Shift selection; synchronized output only when
  the shared startup query reports support.
- [ ] Reattach Ghostty → Terminal.app → Kitty → iTerm2 → WezTerm where available:
  new frontend capabilities, same shell cwd/exports, no stale input modes.
