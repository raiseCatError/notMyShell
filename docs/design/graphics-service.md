# Graphics service

Every actual image NMSh draws goes through one service, `src/graphics/` (`GraphicsService`). The standalone image viewer, Markdown and HTML
documents, the document preview fallback, the browser's page frames and any future image surface ask it; none of them decodes, scales,
encodes, numbers, uploads, positions, resizes, caches or deletes an image itself. Menus, text, selection controls and chrome stay terminal text:
graphics protocols are for real images, never a replacement for NMSh's text UI (see AGENTS.md, "Graphics and typography").

## Architecture decision

| Option | Verdict |
|---|---|
| **Chafa as an optional external renderer** (LGPLv3+) | Best character-art quality and every input format, but absent on most machines, so a stock Homebrew install would need a second package or a silent downgrade; detection of Kitty graphics by terminal name is weaker than a query; a process per frame is too slow for live frames. Not required. |
| Chafa as a library or WASM (third-party bindings) | Pulls a multi-megabyte binary through an npm package NMSh would have to vet and keep current. Rejected for v0.22. |
| A small **Rust sidecar around viuer** (MIT) | A second toolchain and a binary to build, sign and package for macOS and Linux; viuer decides its protocol by environment, not by query. Rejected. |
| **timg** (GPL-2.0-only) | Not compatible with NMSh's GPL-3.0-only for code reuse or linking, and a heavy dependency set (GraphicsMagick, FFmpeg). Not used; shown here only as prior art. |
| **Native in-process hybrid** | **Chosen.** Small TypeScript modules: safe decoders (PNG, GIF first frame, JPEG through `jpeg-js` 0.4.4 BSD-3, WebP through an installed converter), a box-filter scaler, Kitty graphics with Unicode placeholders, iTerm2 inline images, Sixel, and a quadrant-block character-art renderer as the reliable fallback. Capabilities come from terminal replies, not names. |

Licenses: `jpeg-js` is BSD-3-Clause (no dependencies, ~75 KB). Nothing from timg, viu, viuer or Chafa is copied or linked; the protocols are implemented from their specifications. Chafa is
not invoked. A future optional Chafa backend would be an external executable (LGPLv3+), not linked.

## Pipeline

```
file ──readImageFile (regular file, ≤32 MB) ──identify (header only) ──decode (PNG/GIF/JPEG/WebP) ──store (≤1920 px long side) ── LoadedImage (cached, ≤6 / 48 MB)
                                                                                                                                  │
GraphicsHost.decision() ── decideGraphics(capabilities, env, setting) ───────────────────────────────────────────────────────────┤
                                                                                                                                  ▼
place(image, box, owner, surface) ─► kitty-placeholder rows │ character-art rows │ overlay (iTerm2, Sixel, direct Kitty) │ text placeholder
release*(owner) / releaseAll / keepOnly ─► deletes terminal-side uploads
```

## Backend choice (`decideGraphics`)

Evidence, strongest first: a reply to the terminal's own query (Kitty graphics `a=q`, DA1 attribute 4 for Sixel); a known-host record where
the protocol has no query (iTerm2 inline images, labelled "known host"); an explicit person's choice in Settings (labelled "chosen, not
confirmed" unless a query also confirmed it). A terminal's name never turns a protocol on, except to refine an already verified one: Unicode
placeholders are used only on hosts known to implement them (Kitty 0.28+, Ghostty), after Kitty graphics was verified.

| Setting (Settings → General → Images) | Behavior |
|---|---|
| Auto (default) | Kitty graphics if verified, else iTerm2 (known host), else Sixel if DA1 listed it, else Unicode character art. |
| Kitty graphics / iTerm2 inline / Sixel | Explicit choice; used even if the terminal did not confirm it, and `/doctor` says so. Never inside tmux, screen or Zellij. |
| Unicode character art | Always available. Quadrant blocks in truecolor/256, half blocks in 16 colors, ASCII with NO_COLOR or Safe Glyphs. |
| Off | A placeholder line names each image. |

Always character art: tmux, screen and Zellij (the real terminal is hidden, and graphics would need passthrough, which NMSh does not use),
`TERM=dumb`, `NMSH_IMAGES=0`. NO_COLOR keeps the standalone surface on pixels where verified, but documents use character art because Kitty placeholders carry the image id in a text color.

`/doctor` (Host terminal) shows the chosen backend, its evidence, what documents use, the character-art style and the cell size with its source.

## Surfaces

- **Inline in a document (Markdown, HTML):** an image alone in its paragraph is drawn as rows when it can be shown, left aligned, at most 16 rows (`maxImageRows`) and the text width. Kitty
  placeholders make the image behave like text, so it scrolls, clips, wraps and repaints with the rows around it; the diff renderer needs no knowledge of it. Text around images keeps `[image: alt]`
  with the reason: "(remote images are not fetched)", "(outside this folder, not shown)", "(file not found)", "(SVG is not drawn)", "(loading…)". `i` in the viewer opens the image nearest the top in the image viewer; Esc returns to the same place.
- **Standalone (`/view image.png`):** the viewer's own frame, header and controls. Fit (aspect kept), zoom 150–400% with pan, `n`/`p` through the folder's images (regular files only, symlinks not followed, ≤500), `c` copies the path. iTerm2 and Sixel are placed as overlays by the renderer (re-drawn when their rows repaint, removed with the panel); Kitty uses placeholders.
- **Not images:** menus, tabs, selection bands and controls are always text.

## Security and limits

- Local files only. Remote (`http:`, `https:`), `data:` and `file:` references are never fetched; absolute and relative paths must resolve inside the document's folder or its git project (checked lexically before any filesystem call, then on the real path, so a symlink out is refused and nothing is learned about paths outside).
- Files: regular files only (descriptor checked, FIFOs never block), ≤32 MB, ≤24 megapixels, ≤16384 px per side, inflation capped by the header's implied size and 160 MB. Malformed, truncated or hostile files produce an `ImageError`, never an exception or a hang (fuzzed in tests).
- SVG is never rendered (scripts, external references); `/view icon.svg` shows its source as text.
- WebP is converted by a tool the machine already has (`sips` on macOS, `dwebp`, ImageMagick, `ffmpeg`) with `execFile`, an args array, relative file names in a private 0700 temp directory, an 8 s timeout and capped output. Without one the image shows its placeholder and says what to install.
- File names are drawn with control characters replaced; escape sequences from a file never reach the terminal. GIF/WebP animation is not played: the first frame is shown and the header says so.
- Memory: decoded cache ≤48 MB / 6 images, stored images ≤1920 px, uploads ≤32 MB (oldest deleted first), per-placement upload ≤2048 px; nothing runs when no image is open. All terminal-side images are deleted when a surface closes, when a foreground program takes the screen and on exit.

## What the automated tests establish, and what they do not

Tests cover the decision matrix, the Kitty placeholder encoding and lifecycle (upload once, share between owners, delete when the last owner leaves, cap), character-art output (widths, color levels, NO_COLOR, Safe Glyphs, no graphics bytes), overlays for iTerm2/Sixel, reference safety (traversal, symlinks, remote, UNC-style), hostile files, document integration (placeholders, linked images, row cap, `src` bounds) and the image viewer in a headless frame. They do **not** prove how any of it looks in a real terminal.

| Terminal | Backend | Physical verification |
|---|---|---|
| Ghostty | Kitty graphics + Unicode placeholders | NOT RUN |
| Kitty | Kitty graphics + Unicode placeholders | NOT RUN |
| Zed | Character art (no protocol NMSh can verify; Zed's terminal is Alacritty-based) | NOT RUN |
| Terminal.app | Character art | NOT RUN |
| iTerm2 | iTerm2 inline images (known host) | NOT RUN |
| WezTerm | Kitty graphics when it answers; documents use character art | NOT RUN |
| Alacritty | Character art | NOT RUN |
| tmux / screen / SSH without graphics | Character art | NOT RUN |
