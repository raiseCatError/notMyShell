# Graphics decoders

`src/graphics/{formats,png,gif,jpeg,webp,decode}.ts` turn untrusted image files into a `Raster` (straight-alpha RGBA) for the
graphics service. They only ever throw `ImageError`; a stray exception inside a decoder is caught by `guard` and reported as `malformed`.

## API

- `identify(bytes): ImageInfo` reads the header only (PNG IHDR/acTL/tRNS, JPEG SOF scan, GIF screen plus a bounded image count, WebP
  VP8/VP8L/VP8X). SVG text is recognised as `svg` and never rendered. Unknown data is `format: 'unknown'`.
- `decodePng`, `decodeGif`, `decodeJpeg` (sync), `decodeWebp(bytes, {scratchDir, signal})` (async), `webpDecoderAvailable()`.
- `readImageFile(path, {maxBytes})` and `decodeImage(bytes, {scratchDir})`: the front door.

## Limits and safety

- Dimensions go through `checkDimensions` before any allocation (16384 per side, 24 MP).
- PNG: the inflated size is computed from the header (and the Adam7 pass sizes) and used as `maxOutputLength`; it is also capped at
  `IMAGE_LIMITS.maxInflatedBytes`. Critical-chunk CRCs are verified. Extra or short pixel data is `malformed`.
- GIF: first frame only; code sizes 1..8 for the minimum, 12 bits at most for codes; the frame must lie inside the logical screen and
  the LZW stream must produce exactly the frame's pixels.
- JPEG: `jpeg-js` with 24 MP / 256 MB caps after `identify`; lossless, arithmetic and hierarchical JPEGs are `unsupported`. EXIF
  orientation (1..8) is applied from a bounds-checked parse of the APP1 segment.
- WebP: no in-process decoder. The bytes are written to a fresh 0700 directory inside the caller's scratch directory and converted
  with the first tool found (macOS `sips`, then `dwebp`, `magick`, `convert`, `ffmpeg`), via `execFile` with an argument array, an 8 s
  timeout and a small output buffer; the PNG result is decoded by `decodePng` and the directory is always removed. With no tool the
  error is `unavailable` and says what to install. Tool availability is probed once per process.
- `readImageFile` opens with `O_NONBLOCK` and checks `fstat` on the same descriptor: only regular files up to `maxFileBytes`.

## Not covered

Animation (first frame only), colour profiles, 16-bit output, SVG. Automated tests are not physical terminal verification.
