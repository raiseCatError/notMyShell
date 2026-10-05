# Native prompt customization

The NMSh Native prompt is customized along independent axes. None of them is a
preset of the others, and each persists separately in `config.json`.

| Axis | Setting | What it changes |
| --- | --- | --- |
| Style | `nmsh.style` + `nmsh.styleProfiles` | Geometry and visual construction |
| Theme | `nmsh.palette` | Semantic module colors |
| Vibrance | `nmsh.vibrance` | Strength and separation of theme colors |
| Chroma | `presentation.*` | Optional color or gradient treatment |
| Motion | `presentation.motion/speed/curve/direction` | Optional animation of Chroma |

## Modules and surfaces

`/prompt` manages native modules and their routing to Main Prompt, Right Context,
Context Rail or Hidden; Auto uses each module's preferred surface. Existing saved
left/right placement remains valid. The Rail has its own presentation controls
and uses the shared native painter. See [Context Modules](context-modules.md) for
facts, discovery safety and the distinction between these surfaces.

`/shell` edits the same shell module's visibility and Left/Right placement as
`/prompt`. Hidden, When not default and Always control display only; they do not
switch shells. Changing Side preserves Hidden. When not default compares the
current session backend with the configured default for new sessions.

## Styles and their settings

Every style renders the same semantic modules through one cell painter
(`src/prompt/powerline.ts`). That painter supplies Nerd and Safe glyphs, left
and right (mirrored) modules, one- and two-line layouts, narrow fitting and
historical replay for all styles. `/prompt` shows only the controls that change
the selected style.

| Style | Look | Controls |
| --- | --- | --- |
| Powerline | Filled segments with shaped joins | Start, Connector, Connector fade (with a gap), Fade colors (with a fade), Gap, End, Padding |
| Soft | Filled pills, or one connected capsule | Caps, Layout, Gap (separated only), Padding, Fill (Filled / Subtle) |
| Minimal | Colored text, no fills | Separator, Spacing, Bold |
| Outline | Outlined segments, no fills | Outline (Rounded / Square / Angle), Layout, Gap (separated only), Padding |
| Breadcrumb | A text trail with one filled anchor | Separator, Anchor (first / last / none), Spacing |
| Compact | Dense filled cells, no gaps | Ends, Padding, Seams |
| Ribbon | One band; each module is colored text on it | Slant, Ends, Padding, Band |

Powerline keeps its long-standing storage (the Main Prompt geometry fields plus
root `gap`/`spacing`), so existing Powerline prompts render exactly as before.
Every other style owns a profile under `nmsh.styleProfiles.<style>`. Missing
profiles are seeded from the legacy shared gap and spacing, so an upgraded
Soft, Minimal or Outline prompt also renders unchanged. Switching styles never
discards another style's settings. History snapshots record the submitted
style's profile; older snapshots replay with the legacy seed.

## Themes and vibrance

The original five themes keep their ids: Lavender Native, Brand / Semantic,
Cool First, Warm First and Grayscale. Seven differentiated themes join them:
Aurora, Ocean, Sunset, Forest, Rose, Nebula and High Contrast Neon. Each has a
complete role map, and text on the newer themes is chosen for at least 4.5:1
contrast.

Vibrance works in OKLCH and always keeps hue. Standard is the identity, so
existing appearance is unchanged. Soft quiets chroma and pulls lightness toward
the middle. Vibrant raises chroma and spreads lightness so adjacent modules
separate. Text is re-chosen whenever a fill moves. Colors already at the gamut
edge (neon) are held. Explicit per-module colors and semantic Rich Git colors
are never changed by vibrance.

## Order of operations

1. Semantic theme role colors
2. Vibrance (theme-derived colors only)
3. Explicit per-module colors (authoritative)
4. Chroma treatment (eligible modules only)
5. Contrast correction: filled text is re-chosen, and text on the terminal background keeps a lightness floor
6. Terminal color-capability degradation (truecolor, 256, 16 or none)

Steps 1–3 happen in `renderedModules`; steps 4–5 in the renderer; step 6 in
`colorEscape`. Chroma never rewrites stored colors. Turning it Off restores the
exact base rendering.

## Chroma

Palettes are Off, Lavender, Aurora, Current Theme, Rainbow, Nebula, Black Hole,
Warm, Cool, Monochrome and Custom. Each preset is its own palette family:
Lavender stays violet, while Aurora sweeps green → cyan → violet → pink.
**Current Theme** derives from the active Native theme, not from generic UI
colors. On the prompt it varies each module's own color in lightness and chroma
along the gradient, so Cool First stays cool and Warm First stays warm. On
dividers and frames it uses stops taken from the theme's own module fills.

- **Influence** (Theme-aware 35%, Mixed 65%, Full 90%) is stored as the existing
  `intensity`. The pre-v2 default of 0.65 reads as Mixed and looks unchanged.
- **Applies to:** Identity modules (project, path and toolchains: the pre-v2
  behavior) or Whole prompt. Status segments (success/failure) and Rich Git
  state segments are always protected.
- **Custom module colors:** off by default, so explicit colors stay
  authoritative. This row appears only when a module has explicit colors.
- **Surfaces:** filled styles treat segment fills and re-choose readable text.
  Minimal, Outline and Breadcrumb treat text, separators and outlines per
  column. Ribbon treats text on its band. External Starship/Powerlevel10k
  prompts and raw PTY output are never treated.
- **Custom gradient:** 2–8 hex stops edited in `/prompt` → Chroma → Custom
  gradient (add, remove, edit, reorder, reset, live preview). Values are
  validated hex; nothing is evaluated.

## Motion

Motion: Static, Travel, Breathe, Comet or Pulse. Speed: Very Slow, Slow,
Normal or Fast; Normal keeps the pre-v2 6 s travel and 4 s breathe cycles. Ramp:
Linear, Ease In, Ease Out or Ease In-Out. Direction (Forward / Reverse) appears
only for Travel and Comet. Geometry (Left → Right, Center → Outward,
Outside → Center) is independent.

Reduced Motion and Effects Off always hold a stable static treatment. The live
prompt row and the Chroma previews repaint through the shared
`PresentationClock`, and only while an animated treatment is visible. A static
treatment adds no wakeups. The one-line (inline) prompt layout shows the static
frame.

## /prompt and /chroma

`/prompt` → Main Prompt shows Theme, Style, Vibrance, the style's own rows,
Icons and Modules, plus the theme gallery. `/prompt` → Chroma and `/chroma`
open the same view and edit the same `presentation` settings. That view shows
a live **Current** row (your context, saved style, theme, vibrance, modules and
icons), a synthetic full-module **Showcase** row, a gradient swatch, and a
palette gallery, all rendered by the real renderer.
