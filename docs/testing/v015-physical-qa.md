# Setup Cat, appearance studio and idle visuals: physical QA (pending)

Nothing below has passed physical QA. Automated tests validate protocols,
rendering and lifecycle in fixtures, not a physical terminal. Record host and
version, macOS version, font (Nerd or Safe), commit, actual result and any
failure. Tracking: #297.

Hosts are grouped, not ranked; integrated and standalone terminals are
equally first-class. Mark a host physically validated only after a real
manual pass on it.

- **Integrated terminals:** Zed, VS Code, and other integrated hosts as they
  are physically tested.
- **Standalone terminals:** Ghostty, macOS Terminal, Superlogical where
  available, and other standalone hosts as they are physically tested.
- **Additional supported profiles:** Kitty, iTerm2, WezTerm (supported; no
  physical pass in this round).

## Zed (integrated terminal)

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

## Full Chroma review (pending your review)

This section is for the follow-up PR on `feature/v015-chroma-polish`. Do not
mark it passed until you have looked at it on a physical host (integrated or standalone).

### Chroma
- New config (or Settings → Chroma → Influence): Full Chroma is the default.
  An older config with Mixed keeps Mixed.
- Full Chroma + Semantic colors **Override**: success/failure and Git state
  segments take Chroma colors; their symbols and counts stay readable.
- Full Chroma + Semantic colors **Preserve**: those segments keep their
  meaning colors.
- Try several palettes: Aurora, Nebula, Rainbow, Black Hole, Current Theme,
  a Custom gradient; on a light-ish and a dark theme.
- Motion: Breathe, Pulse, Comet (should look as before), and the revised
  **Travel** (a smooth out-and-back flow with a soft crest; no snap at the
  end of a cycle). Speeds Slow/Normal; no flashing.
- Chroma ownership: with Chroma on, Settings frames, tabs, selection and
  labels look exactly as with Chroma off. Rules stay chrome-colored unless
  Chroma → Rules = Chroma. Chroma Off restores everything.

### UI chrome and themes
- UI chrome **Follow theme**: switch between Lavender, Forest, Ocean, Nord,
  Catppuccin Mocha: divider lines, panel frames, selected tabs, selection
  bands and markers follow each theme (no stray lavender).
- UI chrome **Custom → Native Lavender**, **Grayscale**, **Custom colors**
  (Edit colors, change accent and separator, Save).
- **Forest**: a forest feel (moss, pine, bark, amber, teal), readable text.
- Theme Studio: edit a role, **Reset to base** (asks first), Esc (saved
  custom theme unchanged), reset then **Save & use**; change Based on and
  reset; R on a color row resets one role.

### Setup Cat and commands
- `/setup`: **Vespyr** on the first page; every step keeps its controls at
  the top with a preview below; shrink the terminal: the preview gives way
  first.
- Previews change as you edit: glyph sample and drawn caret (the real cursor
  must not change until Apply), real prompt, theme/chrome/Chroma sample,
  composer/syntax, provider explanations, Welcome/status strip, idle visual.
- History & navigation: each provider explains itself; Native says no
  installation is required.
- Install from setup: select zoxide/fzf (not installed), press I, review the
  exact command, confirm; after install you return to the same step with the
  same draft and the tool shows installed. Try a cancel and, if possible, a
  failure: the draft survives either way.
- `/cursor` opens the cursor rows in Settings.
- Settings shows **Decorative effects On/Off**, never "Effects Off: Off".

### Shimmer (light sweep) — pending your review

The tests prove structure (text and positions unchanged, exact restoration,
left-to-right travel, hue kept, no timers when idle). They do not prove it
looks like the reference: width, brightness, speed, color mixing and
smoothness are yours to judge, and all are tunable constants in
`src/motion/lightSweep.ts`.

- `node --import=tsx scripts/shimmer-demo.ts`: one pass per row, left to
  right, then base colors exactly; compare Override vs Preserve (✔/✘ hues),
  theme accent, Grayscale (no color fringe).
- In `/settings`: move the selection (one sweep on the new row only; holding
  still does nothing); change a value with ←/→ (one replay); hold ↓ to scroll
  fast (no lag, no backlog).
- Setup Cat: changing step sweeps the title; on Appearance, the Shimmer
  sample replays when Chroma, Semantic colors or theme change.
- Submit a command: one sweep over the prompt row; the transcript is static.
- Setup Cat Apply / Theme Studio Save & use: one stronger sweep.
- `sleep 10`: the Working status sweeps calmly and stops when done.
- Decorative effects Off / Shimmer Off / Reduced Motion: no sweep at all.
- Activity Monitor: no CPU from shimmer while nothing is changing.
