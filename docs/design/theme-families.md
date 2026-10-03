# Theme families, custom themes and NMSh chrome

NMSh themes color NMSh-owned UI only: Native prompt module fills, syntax
colors derived from them, and NMSh chrome (accent, rules, selection, status
and, for dark variants, text tiers). They never recolor the terminal window,
editor, tab chrome, desktop appearance or any host configuration. Zed's
`/appearance` still says "Appearance is configured by Zed."

## Model

The configuration stores one palette id (`nmsh.palette`). Family and variant
are derived, so older configurations load unchanged:

| Family | Variants (ids) | Notes |
| --- | --- | --- |
| NMSh | the twelve existing Native themes | unchanged ids; Lavender and Brand keep the shipped chrome, others derive theme-aware chrome (see chroma-and-ui-chrome.md); Forest is moss, pine, bark, amber and stream teal |
| Catppuccin | Latte, Frappé, Macchiato, Mocha | `nmsh.accent` selects one of 14 accents (default Mauve) |
| Dracula | Dracula | Alucard is not bundled: it is not part of the MIT-licensed `dracula/spec` repository |
| Tokyo Night | Night, Storm, Moon, Day | |
| Gruvbox | Dark, Light | contrast variants only change the editor background, which NMSh does not paint |
| Rosé Pine | Main, Moon, Dawn | |
| Nord | Nord | |
| Solarized | Dark, Light | |
| One Dark | One Dark, One Light | |
| Custom | the user's theme (`customTheme`) | NMSh Theme JSON |

Settings shows `Theme family`, then nested `Variant` (hidden for one-variant
families) and `Accent` (Catppuccin only). Vibrance and Chroma stay independent
and compose with every family, including Custom.

Light variants recolor accents, rules and status but keep NMSh's own text
tiers: NMSh cannot read the terminal background, and dark-on-dark text would be
unreadable. Module text on every fill is chosen for at least 4.5:1 contrast.
Status fills (success, failure) never change with the accent.

## Sources and licenses

Palette values were copied from each project's canonical repository and
checked against it when bundled. Update them deliberately during release work;
NMSh never fetches palettes at runtime.

| Family | Source (revision checked) | License | Copyright |
| --- | --- | --- | --- |
| Catppuccin | github.com/catppuccin/palette `palette.json` (07d02aa110ef) | MIT | Copyright (c) 2021 Catppuccin |
| Dracula | github.com/dracula/spec `dracula-spec.md` | MIT | Copyright (c) 2020 Dracula Theme |
| Tokyo Night | github.com/folke/tokyonight.nvim `lua/tokyonight/colors`, generated extras (cdc07ac78467) | Apache-2.0 | folke (repository owner); the license has no copyright line and the repository has no NOTICE file |
| Gruvbox | github.com/morhetz/gruvbox (README) | MIT/X11 | Pavel Pertsev (morhetz) |
| Rosé Pine | github.com/rose-pine/neovim `lua/rose-pine/palette.lua` (ff483051a47e) | MIT | Copyright (c) 2023 Rosé Pine |
| Nord | github.com/nordtheme/nord `src/nord.css` | MIT | Copyright (c) 2016-present Sven Greb |
| Solarized | github.com/altercation/solarized (README) | MIT | Copyright (c) 2011 Ethan Schoonover |
| One Dark / One Light | github.com/atom/one-dark-syntax, one-light-syntax `styles/colors.less` (HSL converted to hex) | MIT | Copyright (c) 2016 GitHub Inc. |

Only color values are used; no code, assets or names beyond the theme names
for identification. Random gallery or theme-site copies were not used.

## Custom themes (`/theme`)

Theme Studio edits a draft and applies it as the Custom theme on Save. It can
clone any built-in theme ("Based on"), reset the draft to that base (Reset to
base, confirmed when there are edits; R resets one role),  edit semantic roles with the color
picker, import and export. Roles:

- Prompt: project, path, Git branch, Node, Go, Python, Docker, Kubernetes,
  success, failure.
- Interface: accent, primary, secondary, muted, separator, selection, success,
  warning, failure, info.

Explicit per-module colors in the prompt configuration remain authoritative.

### NMSh Theme JSON

```json
{
  "schema": "nmsh-theme",
  "version": 1,
  "name": "My Nord",
  "basedOn": "Nord",
  "dark": true,
  "prompt": {"project": "#88c0d0", "cwd": "#4c566a", "...": "#rrggbb"},
  "ui": {"accent": "#88c0d0", "primary": "#eceff4", "...": "#rrggbb"}
}
```

Every role must be a `#rrggbb` color; anything else is rejected with the role
named. A newer `version` loads with a warning, and unknown top-level fields are
preserved on export. Imported data is parsed as data and never executed.
Exports go to `<config dir>/themes/<name>.nmsh-theme.json` (mode 0600).

### Palette imports

Base16 (YAML `baseXX` lines or JSON) and Windows Terminal color scheme JSON are
accepted. ANSI palettes carry no NMSh semantic roles, so they are mapped
explicitly (for example Base16 `base0E` → project and accent, `base08` →
failure) and the preview says the mapping is not lossless. Nothing is applied
until the user saves.

## Color picker

- Truecolor: a saturation/value field drawn with half-block cells (two
  samples per row), a hue strip, a swatch and hex entry.
- 256-color: the xterm palette (216-color cube plus 24 grays) as a grid with
  the nearest index shown.
- NO_COLOR: red/green/blue channel editing and hex entry, text only.

Arrow keys adjust, Shift moves faster, Tab moves between controls, `#` types a
hex value, Enter keeps and Esc cancels. Nothing depends on the mouse.
