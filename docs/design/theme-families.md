# Theme families, custom themes and NMSh chrome

NMSh themes color NMSh-owned UI only: Native prompt module fills, syntax
colors derived from them, and NMSh chrome (accent, rules, selection, status
and, for dark variants, text tiers). They never recolor the terminal window,
editor, tab chrome, desktop appearance or any host configuration. Zed's
`/appearance` still says "Appearance is configured by Zed."

Custom and imported themes now live in a Native theme library, and the
opt-in Theme Bridge can extend a theme to selected terminal tools; see
[theme-bridge.md](theme-bridge.md). With Theme Bridge Off (the default)
the statement above holds unchanged.

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
| Ayu | Dark, Mirage, Light | v0.21; Mirage is the family default |
| Kanagawa | Wave, Dragon, Lotus | v0.21 |
| Everforest | Dark, Light | v0.21; medium contrast (soft/hard change only the editor background) |
| Flexoki | Dark, Light | v0.21 |
| Night Owl | Night Owl, Light Owl | v0.21 |
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
| Ayu | github.com/ayu-theme/ayu-colors `themes/dark.yaml`, `mirage.yaml`, `light.yaml` (d461f029) | MIT | Copyright (c) Konstantin Pschera (LICENSE gives no year) |
| Kanagawa | github.com/rebelot/kanagawa.nvim `lua/kanagawa/colors.lua`, `themes.lua` (bb85e4bf) | MIT | Copyright (c) 2021 Tommaso Laurenzi |
| Everforest | github.com/sainnhe/everforest `palette.md` (85a86eb6) | MIT | Copyright (c) 2019 sainnhe |
| Flexoki | github.com/kepano/flexoki `README.md` palette tables (8d723bac) | MIT | Copyright (c) 2023 Steph Ango |
| Night Owl | github.com/sdras/night-owl-vscode-theme `themes/Night Owl-color-theme.json`, `Night Owl-Light-color-theme.json` (cc291eba) | MIT | Copyright (c) 2018 Sarah Drasner |

v0.21 mapping notes. Values are used exactly as each source writes them; the mapping to NMSh roles follows the
theme's own semantics where it has them:

- **Ayu**: the YAML's base palette colors (not the generated syntax tones), `editor.fg`, `ui.fg`, `ui.panel.bg`,
  `common.accent.tint` and `common.error`. Ayu defines one text color, so primary and secondary are the same.
- **Kanagawa**: each theme's roles from `themes.lua`: project = `fun`, path = `bg_p2`, branch = `keyword`,
  Node = `string`, Go = `type`, Python = `identifier`, separator = `nontext`, subtle = `comment`, selection =
  `bg_visual`, status = `ok`/`error`.
- **Everforest**: backgrounds by their position in `palette.md` (bg_dim, bg0…bg5), the seven accents and three greys.
- **Flexoki**: dark uses the 400 accents and base tiers (tx base-200, tx-2 base-500, tx-3 base-700, ui-2 base-850,
  ui-3 base-800); light uses the 600 accents, as Flexoki documents its standard palette.
- **Night Owl**: editor, selection, line-number and terminal ANSI colors, and the comment token color.

Considered for v0.21 and not bundled: **Oxocarbon** (its grays are computed at runtime in HSLuv by the theme's own
code; reproducing them would need running that code or re-implementing it, and the issue asks for no
approximations), **GitHub Primer** (values come from a built `@primer/primitives` release, not the theme
repository), **Material/Palenight** and **classic Monokai** (licensing and canonical source not verified), and
Tier 2 families. The Built-in list in Theme Studio gains `/` to filter by name, family, or dark/light.

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

## Syntax selection

`/syntax` uses the same family/variant registry as `/theme` and Settings. Follow prompt uses the saved NMSh palette even when an external provider supplies the prompt. Choose theme selects a family, then its variant; Custom is available when a custom theme exists. Catppuccin uses the shared theme accent. Grayscale and Highlighting Off remain separate simple choices.

Previews use the real Highlighter with fixed example semantics and execute nothing. Palette and accent changes affect NMSh-owned input and new submitted commands, never raw PTY output or external artifacts.
