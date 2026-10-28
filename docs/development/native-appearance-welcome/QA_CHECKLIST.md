# Physical QA checklist (native appearance, shaders, Welcome Studio)

Automated tests use private HOMEs, headless host parsers and proxy compiles. None of them prove GPU output, real graphics protocols or input feel. Run these by hand on real hosts. Use a scratch config first, and keep a copy of your real `~/.config/ghostty`, kitty.conf and NMSh config.

## Ghostty (installed 1.3.1; repeat on 1.4.x when installed)

### Ghostty shaders
1. Open `/appearance` → Ghostty shaders. The version and offered presets must match (Aurora and Dim need 1.3+).
2. Enable Smear with `/cursor` Motion Tail, then press S. Check the diff: one `config-file = ?…` line, your own `custom-shader` lines unchanged, Enter to write.
3. Reload Ghostty config (⌘⇧,). Exactly ONE trail appears: Ghostty's, and Portable draws none. Press L in the studio.
4. Switch `/cursor` renderer to Portable. NMSh rewrites only its files. Until you reload, Portable shows no trail. Reload, press L, and Portable's trail returns. There should never be two trails.
5. Turn on Reduced Motion and Effects Off. NMSh passes are removed and your passes stay.
6. Enable Aurora (Follow Chroma), then change the `/chroma` preset and reload. The tint follows Chroma.
7. Press R and review the removal. Your config bytes must be restored exactly (compare against your copy).
8. With your own cursor shader listed, a trail is refused, with the reason given.

## Kitty (0.49.x)

### Kitty shaders
1. Open `/appearance` → Kitty shaders. Enable Lightning trail, Northern Lights, then CRT or CRT (blue) (only one can be on), and Bloom or Water.
2. Check the review diff. Your `custom_shaders` names stay in order, and placement is Before/After.
3. Kitty auto-reloads. Check that every effect is visible and that there is exactly one cursor trail.
4. Press R. kitty.conf is restored exactly.

## Studio previews (both hosts)
1. Select each preset. The preview plays once, then stops (CPU returns to idle). P replays it.
2. Move a slider. The preview restarts with the new look. Kitty sliders change it too.
3. Check these cases:
   - Reduced Motion: a still frame.
   - NO_COLOR: no preview.
   - A short window: the preview is hidden and the controls stay.
4. Effects routing (`/appearance` → Effects routing) lists the cursor and window effects you enabled as "Host GPU". NMSh's rows are listed as Portable.

## Welcome Studio
1. With no saved layout, the startup card is the historical one.
2. Open `/welcome`. Build a native layout and try these:
   - Edit title and greeting.
   - Toggle hostname and path (both off by default).
   - Pick a PNG with O, then a GIF, an APNG and an `.ans` file.
   - Check fit and alpha.
3. Check each still effect:
   - Each moves smoothly for at most 5 s, then settles.
   - Pause and replay work.
   - The width, theme, Reduced Motion and before/after toggles work.
4. Press P. The full screen shows the same card that startup will show, and any key returns you with the draft unchanged. A paste during P must not reach the shell.
5. Save with S, then run `/clear` or open a new window:
   - The card animates (GIF/APNG) and settles.
   - The prompt is usable immediately.
   - Typing stops the animation.
   - Resizing stops it.
6. Export a preset. The file has no image path unless you opted in, and never contains image bytes. Import it again.
7. On a host without verified inline graphics (for example Terminal.app), the image falls back to cell art with the reason shown.

## Record
Note the host, version, OS, and pass/fail per item. Attach screenshots for anything visual. Report anything that writes outside NMSh's own files.
