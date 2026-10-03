# Setup Cat, appearance studio and idle visuals: physical QA (pending)

Nothing below has passed physical QA. Automated tests validate protocols,
rendering and lifecycle in fixtures, not a physical terminal. Record host and
version, macOS version, font (Nerd or Safe), commit, actual result and any
failure. Tracking: #297.

Host order: **Zed** (primary), **Ghostty** (first-class enhanced),
**Terminal.app** (baseline), **Kitty** (supported profile). iTerm2 and
WezTerm are supported profiles without a physical pass in this round.

## Zed (primary)

### Setup Cat
- `/setup`: every step shows your current choices; nothing changes until the
  last step. Esc after an edit asks before discarding; the config file is
  unchanged afterwards (compare modification time).
- Apply with no edits says "no changes". Apply one edit; `/settings` shows it.
- `/setup prompt`, `/setup appearance`, `/setup chroma`, `/setup tools`,
  `/setup editor` open the matching step; Tab and Shift+Tab move between steps.
- Tools step: wording says NMSh works fully without external tools; zsh
  completion facts read Detected/Not detected truthfully (fzf-tab line only
  if it is installed).
- Idle visuals step shows a moving preview.

### Cursor
- Settings → Cursor: Block, Bar, Underline each change the caret at once.
- Blink On/Off with a shape (Blink is hidden under Host default).
- Run `vim -u NONE`: the caret is Zed's own inside vim; after `:q` NMSh's
  caret returns. Same for `less`.
- `/zsh`, Ctrl+Z then `fg`, closing the tab, and `nmsh` exiting normally all
  leave Zed's own cursor.

### Themes
- Settings → Theme family: NMSh, Catppuccin, Dracula, Tokyo Night, Gruvbox,
  Rosé Pine, Nord, Solarized, One Dark, Custom. Variant and Accent appear
  nested only where they apply.
- Catppuccin Latte/Frappé/Macchiato/Mocha and several accents: prompt fills,
  syntax, selection and accents change; Zed's own colors do not.
- `/theme`: clone a theme, edit a role with the color picker (field, hue,
  hex), Save, Export; Import the exported file and see the preview first.
- Picker with `NMSH_COLOR=256` (grid) and `NO_COLOR=1` (channels/hex).

### Nested Settings, prompt glyphs, small displays
- `/settings` (Config): Chroma Off hides its children; turning it on shows
  Intensity, Scope, Geometry, Motion; Motion Travel shows Speed and Ramp;
  indentation is small and plain.
- `/prompt` Minimal and Breadcrumb: built-in separators and a Custom glyph
  (try `→`, `»`, a wide glyph, an emoji); the preview updates; switching
  styles keeps each style's glyph. Prompt symbol choices and a custom symbol.
- Resize below 44×12 with `/setup` open: "Display too small" with sizes;
  resize back: Setup Cat returns at once. Very small: one line.

### Status strip
- Enable it: clock top right; on a laptop the battery appears, on a desktop
  it does not. Enable CPU, RAM (Percent/Absolute/Both) and uptime.
- It hides in vim/less, while a panel is open, and below 30 columns. It is not
  in `/copy` output or `/resume` transcripts.

### Idle visuals
- `/screensaver`: each mode previews live; Enter starts it full screen.
- Aurora Drift, Deep Space, Warp Starfield, Rain, Sparkles, Fireworks,
  Bouncing Vespyr: smooth, calm, no flashing; colors follow Chroma when on,
  otherwise the theme.
- Set 1 minute: it starts only at an idle prompt; not while `sleep 120` or
  `read x` runs, not with a panel open, not in vim.
- Each of key, mouse move, click, wheel, resize and new output (e.g. a
  background `(sleep 70; echo hi) &`) ends it. The draft, selection and scroll
  position are exactly as before; the waking key is not typed.
- Switch to another app (focus out): it pauses; returning ends it.
- Reduced Motion: still frame. Effects Off: never starts.
- Activity Monitor: CPU of the NMSh process while idle visuals run (record
  per mode at your usual window size) and ~0 % when not showing.

## Ghostty, Terminal.app, Kitty (core behavior)

- `/setup` opens, applies and cancels correctly.
- Cursor Block/Bar/Underline and restoration around vim and on exit
  (Terminal.app may ignore DECSCUSR: record what happens; NMSh must not leave
  a changed cursor behind).
- Catppuccin Mocha and a custom theme render; Display too small recovers.
- Status strip and `/screensaver start aurora` render and dismiss on a key.
- Terminal.app: note whether its default font draws the half-block aurora and
  ✦ glyphs cleanly in Nerd mode, and Safe mode output.

## Not claimed

No row above is marked passed. Physical results are recorded in #297 once a
person has run them.
