# v0.11 additive physical QA (deferred)

Only v0.11 checks belong here. Existing milestone checklists remain separate.
Automated PTY fixtures do not certify these physical terminal behaviors.

## Configured completion (#52)

In Ghostty and Terminal.app where available:

- Try a real configured command completion, options with descriptions, custom
  compdef functions and aliases. Check groups and insertion without command execution.
- Complete paths containing spaces and Unicode, including an unfinished quote;
  complete in the middle of a word with trailing arguments. Check the caret.
- Type/delete/move the cursor rapidly and change cwd. Old candidates must disappear.
- Change completion configuration, then retry after the 60-second helper expiry
  or after a submitted command. Confirm refreshed knowledge and usable fallback.
- Dismiss with Escape; try repeated Tab. Test narrow width, Safe glyph and NO_COLOR.
- If fzf is already installed and selected as the picker, select/cancel/resize the
  candidate picker. Confirm composer and terminal modes return. Missing fzf must
  leave the native menu usable. This is not native fzf-tab UI support.
- Detach/reattach and run an interactive application: completion must never take
  the active application's input or render foreign plugin UI into NMSh.

No physical QA has been performed for v0.11.
