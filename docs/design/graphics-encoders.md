# Graphics encoders

Pure raster-to-output functions for NMSh's graphics service. They take a `Raster` (straight-alpha RGBA, `src/graphics/raster.ts`)
and return strings or bytes; none touches the filesystem or the terminal, and none throws anything but `ImageError`.

| Module | Export | Output |
| --- | --- | --- |
| `scale.ts` | `scaleBox`, `flatten`, `fitCells`, `assertRaster` | resampled / flattened rasters, cell fit |
| `unicode.ts` | `renderCells` | character-art rows for terminals with no graphics protocol |
| `sixel.ts` | `encodeSixel`, `SIXEL_MAX_PIXELS` | a complete DCS sixel stream |
| `pngEncode.ts` | `encodePng`, `kittyRgba`, `crc32` | PNG bytes; raw/zlib RGBA for Kitty `f=32` |

## Scaling

`scaleBox` is an area-average (box) filter in premultiplied alpha, computed on an integer axis (target pixel `x` covers
`[x*sw, (x+1)*sw]`, source pixel `i` covers `[i*w, (i+1)*w]`), so integer ratios are exact means and there is no float drift
at pixel edges. A transparent pixel never tints its neighbours. Upscaling is nearest-neighbour by construction (a target pixel
inside one source pixel copies it; one straddling a boundary is the area blend), which keeps pixel art crisp. Memory is the
result plus one row of accumulators.

`fitCells(w, h, maxColumns, maxRows, cell = 8x16, allowUpscale = false)` keeps the aspect ratio from the real cell pixel size,
returns at least 1 x 1 and never more than the maximum, and does not grow an image past its natural size unless asked.

## Character art (`renderCells`)

Options: `columns`, `rows` (maximums), `mode`, `color`, `safe`, `background?`. The image is fitted into the box (cells are
treated as 8 x 16 px), scaled with the box filter to the mode's pixel grid and rendered. The result is `{rows, columns, height}`
where `columns` is the fitted width: every row is exactly that many display cells wide (no padding is needed because the grid
is exactly the fitted size) and `height` is the number of rows. Sizes are clamped to 1024 cells a side.

| Mode | Pixels per cell | Glyphs |
| --- | --- | --- |
| `half` | 1 x 2 | `▀` (fg top, bg bottom), `▄`/`▀` with default bg at a transparent edge |
| `quadrant` | 2 x 2 | the 16 block elements; least-squares best two-color split |
| `braille` | 2 x 4 | U+2800 dots; fg = mean of lit dots, bg = mean of unlit |
| `ascii` | 1 x 2 | ` .:-=+*#%@` luminance ramp |

- **Quadrant fit.** For an opaque cell, the seven distinct ways to split the four pixels in two groups are scored by
  `|sum_A|^2/n_A + |sum_B|^2/n_B` (minimising squared error); the best wins, and the brighter group is the foreground, so a
  white-on-black pattern is its own glyph. A uniform cell is `█` in its color. Braille lights the dots at or above the cell's
  mean luminance.
- **Color.** `truecolor` uses `38;2` / `48;2`; `ansi256` and `ansi16` go through `colorEscape` (`src/chroma/escape.ts`); `none`
  emits no escape at all, so shape comes from luminance: a flat cell is a shade (` ░▒▓█`), otherwise the bright part is the
  glyph. Adjacent equal SGR state is not re-emitted, glyphs that ignore a layer (space, full block) leave it alone, and a
  styled row ends with `ESC[0m`. Nothing but SGR and glyphs is ever emitted.
- **Safe.** `safe: true` renders every mode as `ascii`, so glyphs are printable ASCII only (0x20-0x7e). Color escapes still
  follow `color`; use `color: 'none'` for ASCII-only bytes. In color ascii the fg is the cell hue at full brightness and the
  glyph carries the lightness.
- **Transparency.** Alpha below 128 is transparent. With `background` the image is composited over it first; without it the
  cell stays unpainted (a plain space, or a half/quadrant/braille shape drawn with the default background), so the terminal's
  own background shows.

Performance (Apple silicon dev Mac, warmed, Node 26): 1600 x 1200 -> 200 x 60 cells in quadrant mode, truecolor: about
14-19 ms total, of which the box scale is about 11-14 ms. (The first call in a cold process costs more.)

## Sixel (`encodeSixel`)

`ESC P 0;<p2>;0 q "1;1;<w>;<h>`, palette `#n;2;r;g;b` (0-100 percent), bands of six rows, `!n` runs (for runs over three), `$`
between colors, `-` between bands, `ESC \`. P2 is 1 only with `transparent: true` (alpha below 128 is left undrawn); otherwise
alpha is flattened over `background` (black). Only colors that are used are defined; trailing empty columns of a color row are
trimmed.

- **Palette.** Median cut over an evenly strided sample of at most 65,536 pixels: exact when the sample has no more colors than
  `maxColors`, otherwise the box with the widest weighted spread is split at its weighted median, ties broken by color value.
  Palette entries are the values a terminal draws after percent rounding (so 100/255 comes back as 99).
- **Dither.** `none`, `ordered` (Bayer 4 x 4, +-24 levels) or `floyd` (Floyd-Steinberg, left to right, deterministic).
- **Limits.** Wider or taller than 4096 pixels is `ImageError('too-large')`; `SIXEL_MAX_PIXELS` = 4096 x 4096; the stream is
  capped at 32 MiB (`too-large` rather than building more). Callers should scale to the terminal's pixel size first.
- **Cost.** 800 x 600 gradient, 256 colors: about 250 ms (none), 350 ms (ordered), 300 ms (floyd). Output 80 KB without dither,
  about 390 KB dithered.
- `P1 = 0` follows the brief; the raster attributes `"1;1` declare square pixels.

## PNG and Kitty (`pngEncode.ts`)

`encodePng` writes signature, IHDR (8-bit RGBA), one IDAT (zlib via `node:zlib`, level 0-9, default 6) and IEND with correct
CRC32s. Each row picks the filter (none, sub, up, average, paeth) with the smallest sum of absolute residuals (ties: the lower
type); `{filter}` forces one type (used by the tests). Pixels are written as given, so decoding returns the raster exactly.
800 x 600 gradient: about 50 ms. `kittyRgba` returns the raw RGBA bytes (a view of the raster's buffer) or their zlib stream
for `f=32,o=z`.

## Verification

`tests/graphicsEncode{Scale,Unicode,Sixel,Png}.test.ts`: small deterministic rasters, exact widths via `displayWidth`, zero
escapes for `none`, byte range for safe mode, all 15 quadrant patterns, braille bit order, a test-only sixel decoder (exact
round trip of a two-color image, tolerance for gradients), a test-only PNG decoder (inflate + all five unfilters, CRC
checks), size limits, determinism and seeded fuzzing. These are automated tests, not physical terminal verification.
