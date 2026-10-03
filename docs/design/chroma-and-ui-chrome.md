# Chroma, semantic colors and UI chrome

## Ownership

Chroma owns intentional Chroma surfaces only:

- the NMSh Native prompt (live and its previews: `/prompt`, `/chroma`, Setup Cat),
- Chroma swatches and previews,
- explicitly Chroma-aware effects,
- idle visuals with Colors = Follow Appearance while Chroma is on,
- composer and history rules **only** when Chroma → Rules is set to Chroma
  (default: UI chrome).

Everything else is UI chrome and never changes because Chroma is on: panel
frames (the Settings frame included), tabs, selection, focus accents, markers,
labels and the rules by default. Turning Chroma Off returns every Chroma
surface to its base theme color exactly.

## Color pipeline (Native prompt)

semantic theme role → vibrance → explicit per-module colors (authoritative
unless "custom colors" Chroma is on) → Chroma (by influence, scope and
semantic mode) → contrast correction (text chosen for ≥4.5:1 on fills, or a
lightness floor for text styles) → terminal capability degradation
(truecolor, 256, 16, NO_COLOR). Nothing rewrites escapes after the fact.

## Influence and semantic colors

- Influence: Theme-aware (0.35), Mixed (0.65), **Full Chroma (0.9, the
  default)**. An explicitly saved influence loads unchanged.
- Semantic colors: **Override** (the default with Full Chroma) lets Chroma
  recolor success, failure and Rich Git state segments; **Preserve** keeps
  their meaning colors. A saved choice is kept. With Override the meaning is
  still carried by symbols and counts (✔ 0, ✘ 1, +2, ~1, ?3, ↑2) and text
  contrast is corrected after Chroma. The textless clean-tree marker means
  "clean" by color alone, so it is always preserved.

## Motion

Choices lead with Breathe, then Comet, Pulse and Travel (stored ids are
unchanged). Travel used to slide positions through a non-cyclic gradient, so
each cycle snapped from the last stop back to the first; it now flows as a
seamless out-and-back loop with a gentle brightness crest, and the largest
frame-to-frame color step at a cell dropped from 231 to 56 (sum of channels,
Aurora, 50 ms steps). Breathe, Comet and Pulse are unchanged.

## UI chrome

Settings → UI chrome:

- **Follow theme** (default): Lavender Native and Brand keep the shipped NMSh
  chrome exactly; other NMSh themes derive chrome from their own colors (the
  project color becomes the accent, rules and selection use quieter tones of
  that hue, status uses the theme's success and failure); bundled families
  and custom themes use their UI roles.
- **Custom** → Preset: Native Lavender, Grayscale, or Custom colors (Edit
  colors opens the semantic UI roles with the color picker: accent, primary,
  secondary, muted, separator, selection, success, warning, failure, info).

Frames, rules, selected tabs, selection bands, focus accents and markers are
derived from those roles. History rules keep their original colors under the
shipped chrome and use tones of the active separator otherwise. The host
terminal and editor are never recolored.
