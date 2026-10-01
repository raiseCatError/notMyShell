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

## OSC 8 additions (#150)

All checks below remain pending physical host validation. Test on available
hosts; installing every terminal is unnecessary. Repeat capable checks after
reattaching from a capable host to a baseline host and back.

- Print `https://example.com/path?x=1` and `http://example.com`; visible text must
  match, with clickable targets only when the attachment supports hyperlinks.
- From a command cwd containing `file.txt`, print `file.txt`, `./file.txt` and a
  missing path. Existing paths open the correct local file; missing paths stay
  plain. Change cwd and inspect the old command to verify its original context.
- In a GitHub repository with an explicit origin, print `#123`, `#tag` and
  `#123abc`. Only the numeric reference links. Outside a known repository all
  stay plain. GitHub resolves PR numbers through the issue URL.
- Print a program-owned OSC 8 label followed by an unlinked URL. Resize narrowly
  and expand/fold output. Program target and generated target remain distinct;
  no link extends into neighboring rows or the editor.
- Compare `/copy`, exported transcript/journal and command history before/after
  enabling `NMSH_HYPERLINKS`; no generated OSC 8 appears in stored/copy text.
- Ghostty, iTerm2, Kitty and WezTerm: check host click modifiers and selection.
  Terminal.app, unknown hosts and tmux baseline: text remains plain unless the
  explicit `NMSH_HYPERLINKS=1` override is used; no escape garbage appears.

## Compatibility additions (#14)

- Run the deterministic fixture modes in `tests/fixtures/compatibility.mjs` from
  an available host. Finite/noisy commands complete with intact history; streaming
  stays LIVE through resize and Ctrl+C; interactive modes receive keys/paste and
  return cleanly. Automated PTY passage does not certify their visual appearance.
- With tmux mouse enabled, try native Shift selection, Ctrl+J multiline fallback,
  keyboard disclosure navigation, interactive mouse ownership and bracketed paste.
  Detach/reconnect the tmux client: the same NMSh remains in the pane. Close the
  pane and reattach the NMSh live session from another available host: capabilities
  refresh while shell cwd/environment/state persist.
- In available Ghostty/Terminal.app/iTerm2/Kitty/WezTerm installations, try ordinary
  CLI, noisy builds, streaming tools, vim/less/fzf, and available agent CLIs. Check
  resize, Ctrl+C, Ctrl+Z/fg, clean exit and restored keyboard/mouse/paste modes.
- zoxide and Atuin require a real configured installation to validate integration;
  no account/tool-specific behavior is claimed by the deterministic fixture suite.

See [coverage matrix](v010-compatibility.md) for automated vs optional vs pending
status. All new physical entries remain pending.
