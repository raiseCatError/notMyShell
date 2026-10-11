# Workspace keymap (#335)

Part of the workspace program ([#330](https://github.com/raiseCatError/notMyShell/issues/330)); shared foundation and integration contract: [workspace.md](workspace.md).

A person's keymap is declarative data, validated before use, and never executed:

```json
{"version": 1,
 "bind": [{"key": "Left", "context": "composerEmpty", "action": "sidebar.focus", "replaces": true}],
 "unbind": [{"key": "q", "context": "panel"}]}
```

- **Bindable keys** are only those NMSh's input parser tells apart: `Up Down Left Right Home End PageUp PageDown Tab
  Shift+Tab Esc Enter Backspace Ctrl+O Ctrl+F Ctrl+G Ctrl+N Ctrl+P Ctrl+R Ctrl+X F1` and single printable characters.
  Anything else (`Ctrl+B`, `Cmd+K`, `Alt+Left`) is refused with the reason: the terminal may send it as something
  else or not at all.
- **Never bindable**: Ctrl+C/D/Z (job control), paste, pointer and focus events; in the composer also typing and
  Enter.
- **Composer bindings replace a meaning**, and must say so. Every bindable key already does something with an empty
  draft (Left opens Sessions, Right accepts the inline suggestion, Up recalls history, Tab completes, Shift+Tab moves
  through blocks, …, recorded in `COMPOSER_MEANINGS` from the composer's dispatch); a binding there needs
  `"replaces": true`, and an active draft still wins.
- **Actions per context**: the composer takes only focus/visibility actions; regions take their own actions plus
  focus actions.
- **Conflicts** (one key twice in a context) are errors, the first binding kept. Invalid entries are skipped and
  reported; the defaults stand where an entry failed.
- **Unreachable features are reported**: an action left with no key and no command, or a sidebar with no way back to
  the composer, is a warning (the slash commands still work).
- **Host notes** (`hostNotes`) say when a key usually never reaches NMSh: Terminal.app scrolls its own window on Page
  Up/Down and Home/End, macOS may take F1, a tmux root-table binding (`bind -n`) takes the key first, and Esc waits
  for tmux's `escape-time`. These are notes, never delivery guarantees.
- `describeKeymap` lists every binding in effect and the commands that always work.

Integration: the keymap file lives beside NMSh's other configuration (`keymap.json` in the config directory), is read
at start and on `/keys reload`, and `/keys` shows `describeKeymap` plus problems and host notes. Those commands are
part of the integration step.
