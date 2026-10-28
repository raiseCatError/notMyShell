# Preliminary verified research (2026-10-28)

## Slice 2 — Kitty 0.49.2 custom shaders (verified 2026-10-28)

Sources: installed Kitty 0.49.2 (headless `kitty +runpy`, private HOME/config/cache under the T7 evidence folder `slice2-probe/`), official https://sw.kovidgoyal.net/kitty/custom-shaders/, and `kitty/shaders/slang.py` at tag v0.49.2 (saved as `slice2-probe/src/kitty_shaders_slang.py`).

- Catalog: `list_kitty_resources('kitty.shaders.custom')` + `read_kitty_resource(name, 'kitty.shaders.custom')` return every shipped `.pipeline` and `.slang` (no loose files on disk). 0.49.2 ships pipelines crt-blue, cursor-trail-{blaze,default,lightning,motion-blur}, dim-inactive-windows, fireworks, fireworks-rockets, focus-highlight, inside-the-matrix, northern-lights, pond-ripple, spotlight, tab-change; extra shaders bloom, crt, negative, sample, tft, underwater, water; modules types/pipeline.
- `custom_shaders` is ONE value split with POSIX shlex; a later line replaces earlier ones (confirmed with Kitty's own `load_config` through an include). Names are loaded in order and their groups concatenated (`merge_pipelines`), at most 16 groups in total.
- Lookup: absolute path (`~` expanded) → `<config_dir>/shaders/<name>.pipeline` → shipped pipeline → a shader of that name with a default one-group pipeline. Shaders in a group: `<pipeline_dir>/<name>.slang` → `<config_dir>/<name>.slang` → shipped. A same-named user `.slang` therefore replaces a shipped shader.
- Grammar (`parse_pipeline_definition`): top level `slot end`, `textures a|b|persist`, `var`, `startgroup`; group `viewport_pos/size`, `output_texture`, `shaders`, `var`, `animation_start` (events joined with `|`), `animation_stop` (events, ms, `never`), `animation_curve` (CSS names, cubic-bezier/linear/steps), `animation_step` (ms ≥ 0), `attach`, `endgroup`. First group cannot attach; final group outputs default with no viewport. Events: pointer-left-button-press, os-window-focus-in/out, window-focus-in/out, tab-change, bell-in-window, user-activity, user-idle, cursor-trail-move, cursor-trail-stop.
- `var <type> <name> [=] <value>`: types int/uint/float/double/bool and 2–4 vectors. It replaces only `static const <SAME type> <name> = …` lines (regex); a type mismatch silently does nothing. Pipeline-level vars of ALL chained pipelines merge into one dict applied to every group (group vars win) — they leak across pipelines. Named textures are shared by name across pipelines.
- A group subscribing to `cursor-trail-move` suppresses Kitty's built-in trail; trail shaders draw only while `cursor_trail` > 0.
- Validation capability: Kitty bundles `slangc` (`/Applications/kitty.app/Contents/MacOS/slangc`). `parse_pipeline` + `merge_pipelines` + `build_custom_shader_pipeline_glsl` compile a configuration headlessly (~1–3 s) in a private cache. This proves parse + Slang→GLSL compilation only, NOT GPU rendering. Kitty logs build errors itself at load. No documented reload-on-command without remote control; `auto_reload_config` defaults to reloading changed config files.
- Licensing: shipped shaders are Kitty's (GPLv3; CRT's original is CC BY-NC-SA 3.0; Blaze ports a third-party gist). NMSh references them BY NAME from the installed Kitty and never copies their source into the repository or the user's files; tests use synthetic stand-ins with the same structure.

This is not completed implementation research. Pin exact upstream revisions and per-preset variables/licenses before vendoring or generating production pipelines.

## Kitty

Official https://sw.kovidgoyal.net/kitty/custom-shaders/ and https://sw.kovidgoyal.net/kitty/conf/ establish0.49+ Slang and .pipeline support. Catalog includes cursor motion blur/blaze/lightning, Matrix/Northern Lights/Fireworks/Water, Pond Ripple/Spotlight, focus/window/tab and CRT/TFT. custom_shaders takes ordered pipeline names; shader pipelines are not Ghostty GLSL. Groups have ordered shaders, optional scoped static vars, viewport, named texture output and animation events; at most16 groups and final default output. Events include cursor-trail, pointer, focus, tab, bell and activity/idle. This does not expose arbitrary NMSh widget/event data; fixed pipeline viewport is not a live per-widget targeting channel. No native prompt/queue/completion claim is justified yet.

Official CRT source https://raw.githubusercontent.com/kovidgoyal/kitty/master/kitty/shaders/custom/crt.slang declares opaque-background requirement and upstream Shadertoy CC BY NC SA3.0 alongside its GPLv3 port notice. Do not copy based on repository-level license assumptions; prefer referencing installed shipped assets after capability checks and warn about opacity.

Remote control https://sw.kovidgoyal.net/kitty/remote-control/ inspected initially; no remote command/permission enabled. Need pin available exact scoped reload behavior before offering it; manual reload is safer default.

## Ghostty

https://ghostty.org/docs/config/reference documents ordered GLSL custom-shader passes with iChannel0 previous output, mainImage, cursor/focus/palette extensions; iMouse is unsupported. Compilation happens on render thread and errors are logged separately from config validation. Focused animation loop is controlled by custom-shader-animation; disabling it redraws only on updates. Cannot imply event-specific targeted GPU feedback or zero idle cost with animation enabled. Blur/alpha depend on host/platform; glass modes require relevant macOS support. Need installed-version uniform matrix before generator changes.

https://ghostty.org/docs/config documents config.ghostty and legacy config, XDG before macOS locations, later conflicts override earlier, includes processed at end. Existing cursor/native discovery ignores config.ghostty; appearance discovery differs. Both need a common provenance-aware resolver and include-cycle bounds, without writes on read.

https://ghostty.org/docs/install/release-notes/1-4-0 documents Kitty graphics animation in1.4.0 (released2026-10-27). Installed1.3.1 is insufficient evidence; staged1.4.0 available, physical validation NOT RUN.

## Fastfetch and graphics

https://github.com/fastfetch-cli/fastfetch/wiki/Logo-options documents logo-animation-frame0 playback,1 still/default, other indexes as still selection. kitty backend decodes/composes; direct/raw/icat routes differ. This flag alone cannot fix NMSh's capture, which deliberately drops image controls. Never loosen capture sanitization. Installed2.68.1 specific behavior still needs source/help verification.

NMSh GraphicsService already centralizes decode/scale/cache/upload/owner release. ImageSurface builds typed Kitty transmit/place/delete. GIF decoder is first-frame-only. Current Animated WebP is first-frame; APNG sequence decode not implemented. WelcomeSnapshot/renderWelcome handle semantic/static rows. startWelcome captures once asynchronously; existing Vespyr blink reschedules while welcome exists. Extend lifecycle deliberately, not additional unbounded timers.

## Community inspiration / provenance

https://www.reddit.com/r/KittyTerminal/comments/1x5yepi/i_cant_stop_playing_around_with_different_shaders/ was readable via search after direct fetch failed: author confirms two-shader pipeline and transparent GIF logo. Exact two shader identities/config/license were not supplied in observed text; do not invent them or redistribute the logo.

https://github.com/sahaj-b/cursor-shaders lists MIT and separate Kitty/Ghostty directories. https://github.com/noomz/kitty-shaders lists GPL3 with18 effects. Neither is vendored; individual source provenance/dependencies require review. Additional collection https://github.com/hackrdotsh/ghostty-shaders is inspiration only (individual shader licensing not verified). https://github.com/FractalCodeRicardo/dev-config/tree/master/kitty/shaders is another community reference, unverified license. No automatic downloads/execution.

## Repository audit map

Read src/cursor/native.ts, backends.ts, CursorPanel.ts, src/appearance/AppearanceHub.ts, ghostty.ts, AppearancePanel.ts, src/host/integration.ts/capabilities.ts, src/output/Welcome.ts/WelcomeProviders.ts, src/graphics/{service,decode,capabilities,gif,raster}.ts and presentation/ImageSurface.ts. Read motion/{transitions,effects,motion,PresentationClock}.ts, inspected Chroma/idle/cursor and notifications integration references. TerminalApp relevant startup/welcome/hub/save/handover hooks inspected, not a full recursive review. Remaining audit: all relevant call sites, prompt geometry, queueTransitions, overlays/selection, startup/session restore and exact renderer teardown.

Issue399 https://github.com/raiseCatError/notMyShell/issues/399 explicitly requires true appearance reads, safe preview/apply, include precedence and rollback. Its scope overlaps host foundation; user specification extends it with shader/welcome work. No issue/Project mutation or feature PR yet.

Correction from independent source review: the Ghostty1.4.0 default roots load legacy then preferred, but recursion is a SINGLE appended queue after all roots, not per-root DFS. Preserve source at evidence/ghostty-v1.4.0-Config.zig; official URL https://raw.githubusercontent.com/ghostty-org/ghostty/v1.4.0/src/config/Config.zig. The initial overview-based precedence model was wrong and its fixture was corrected from0.75 to0.6 using source behavior. Setup now simulates resulting precedence and refuses ineffective overrides.

Installed/staged host apps remain untouched. The attempted staged +show-config invocation does not accept generic configuration CLI flags in this action; its exit1 is retained and is not host parse/GPU validation. Do not retry it and claim validation from docs alone.

Kitty0.49.2 installed catalog probe (headless, private HOME): read_kitty_resource("shaders/custom/pond-ripple.pipeline") returns the shipped event-driven pipeline even though loose .pipeline files are absent. kitty.constants lists list_kitty_resources(package='kitty') and read_kitty_resource(name,package_name='kitty'); top-level listing does not recurse. pkgutil.get_data returned no pipeline, and inspect.getsource failed for frozen code. A future bounded helper should use the terminal's packaged resource API or native named catalog lookup, not advertise missing capability based solely on loose paths. Direct read succeeded; no GPU compile/render/physical QA claim.
