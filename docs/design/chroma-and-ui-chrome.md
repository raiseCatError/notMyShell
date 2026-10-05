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

## Light sweep (Shimmer)

A soft band of light crosses stationary cells: characters, widths and
positions never change; only each cell's own foreground color is lifted.
Per cell: base color → tint (the Chroma gradient at that cell when Chroma is
on, otherwise a hint of the UI accent; none under Grayscale chrome) →
luminance lift in OKLCH that keeps hue and at least the cell's own
colorfulness, toward a ceiling below white → blend from the exact base by a
Gaussian envelope (σ ≈ 2.4 cells, exactly zero beyond ≈ 7.7 cells) →
capability degradation. With Semantic Preserve, semantic cells take only a
faint compatible tint; Override lets them take the Chroma tint.

It is event-driven, one pass per event, never a loop on static UI:

- a new selection or a changed value in the active NMSh panel (the `›` row:
  Settings, Setup Cat, palette, pickers, tools, prompt options),
- Setup Cat's title when the step changes, and its Appearance preview sample,
- submitting a command (the prompt row, a slightly stronger pass),
- Setup Cat Apply and Theme Studio Save & use (prompt row, stronger).

A new event replaces the running pass (no queue). The only repeating sweep is
the live "Working…" status while a command runs (a calm gap between passes).
One clock subscription (40 ms frames) exists only while a pass runs (≈0.6 to
1.2 s). Shimmer On/Off lives with the decorative effects; Decorative effects
Off, Shimmer Off and Reduced Motion start nothing; NO_COLOR and 16-color
hosts are left untouched; 256-color hosts get quantized colors. Transcript,
history, journal and command text are never touched.

`node --import=tsx scripts/shimmer-demo.ts` (or `vhs dev/tapes/shimmer.tape`)
plays deterministic passes over a multicolored line for Full Chroma with
Override and Preserve, theme accent, and Grayscale.
