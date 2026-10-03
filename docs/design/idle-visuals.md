# Idle visuals (Screensaver)

An optional, presentation-only overlay NMSh draws inside its own terminal
screen. It is not an OS screensaver and never touches the transcript, the
draft, selection, scroll position, history, prompt or session state.

## Settings

- `/settings` → Idle visuals: **Never** (default), 1, 5, 15, 30 or 60 minutes;
  nested Mode and Colors.
- Mode default: **Aurora Drift**, so enabling a timeout without choosing a mode
  gives Aurora Drift. Nothing animates for users who never enable it.
- Colors: **Follow Appearance** (Chroma's palette when Chroma is on, otherwise
  the current theme) or **Current Theme**. A third "Current Chroma" choice was
  left out: with Chroma off it would need its own fallback and the distinction
  would stop being clear.
- `/screensaver` opens a gallery with a live preview from the real renderer;
  `/screensaver start [mode]` starts one immediately. Setup Cat has an Idle
  visuals step with a live preview.

## Activation and exit

Starts only when NMSh owns the screen, the shell is at an interactive prompt
with no running or waiting command, no panel, picker or palette is open, no
passthrough program owns the terminal, and nothing (keys, mouse, output,
resize) happened for the timeout. Focus does not matter: an unfocused
terminal is often still visible (another monitor, beside a browser or
editor), so blur neither blocks activation, resets the countdown, nor pauses
the scene.

While active, the idle scene is the **only** presentation owner: every other
animation subscription (prompt/divider Chroma, effects, task panels, status
strip, notices, the gallery preview) is stopped, and the normal paint paths
return without drawing. Starting is idempotent and arms no timer.

Ends immediately on any key, mouse move, click, wheel, focus return, resize,
new shell output, passthrough or session lifecycle change. The waking key or
focus report is not typed into the composer. Dismissal invalidates the
renderer, repaints the exact presentation underneath (including an open
`/screensaver` gallery, whose preview resumes) and re-arms the countdown.

## Shipped modes

| Mode | Frame interval | Notes |
| --- | --- | --- |
| Aurora Drift | 160 ms | layered aurora bands with folding lower edges, vertical rays fading upward, drifting bright patches and breathing intensity over a starry night sky; half-block cells give two samples per row |
| Deep Space | 250 ms | three star layers with slow parallax, gentle twinkle (15 % amplitude, multi-second periods), occasional bright and warm stars |
| Warp Starfield | 100 ms | stars from a clear vanishing point, accelerating into short radial streaks; neutral stars mixed with palette accents |
| Rain | 100 ms | sparse palette-tinted streaks at depth-dependent speeds and lengths |
| Sparkles | 150 ms | bounded particles that brighten and fade with tiny drift |
| Fireworks | 100 ms | a launch every ~1.7 s, at most three concurrent; ring, sphere and willow bursts with drag, gravity droop, short trails and a calm fade |
| Bouncing Vespyr | 125 ms | the approved Vespyr pixel cat bouncing around, mirrored horizontally to face its direction (never flipped vertically), an occasional 160 ms blink, a rare corner sparkle |

Every scene is a pure function of size, time, seed and palette. Particle counts
are capped independently of terminal size. No mode flashes rapidly.

## Deferred modes

Recorded in the tracking issue; none appear in the UI:

- **Bouncing NMSh mark**: NMSh has no established cell-sized logo mark; a
  made-up one would not meet the bar.
- **Digital Rain, Lava, Pipes, Bonsai Growth** (inspired by neo, lavat,
  pipes.sh and cbonsai): each needs its own design and quality pass; Digital
  Rain would also overlap Rain. Nothing from those projects was copied.

## Reduced Motion and Effects Off

Reduced Motion (Settings or `NMSH_REDUCED_MOTION=1`) shows one still frame
with no animation timer: Aurora Drift and Deep Space hold still, and the
high-motion modes (Warp, Rain, Sparkles, Fireworks, Vespyr) become a still star
field. Effects Off keeps idle visuals off entirely. Both are the existing
presentation preferences; nothing is configured twice.

## Terminal-native rendering and degradation

Truecolor ANSI, half and shade blocks, Braille-free simple glyphs (· • ✦ ✧ │ ─
╱ ╲). Safe glyph mode uses ASCII marks (. + * | - / \) and keeps only the
standard half-block cells. 256-color hosts get the same scenes quantized; under
NO_COLOR the scenes are drawn with characters only. No image protocol, sixel,
GPU API or image file is used.

## Performance

A reused `CellGrid` (typed arrays) is resized only when the terminal size
changes; rows are serialized with SGR only on color changes, blank cells carry
no foreground escape, and the renderer rewrites only rows that changed. Frames
run on the shared `PresentationClock` at the intervals above (at most 10 frames
per second). A frame costing over 35 ms slows that scene's cadence (up to
500 ms). There is no idle timer when the timeout is Never, no frame timer when
the overlay is not showing, paused or still, and both are cleared on stop.

`node --expose-gc --import=tsx scripts/idle-benchmarks.ts` measures
computation, changed rows, bytes written, heap growth and timer cleanup at
80×24, 120×40 and 180×55.

## Deterministic captures

With `NMSH_DETERMINISTIC=1`, scene time is the frame count times the mode's
interval plus `NMSH_IDLE_START_MS`, and the seed is fixed, so captures are
repeatable without patching clocks or randomness. Reduced Motion is not
implied by this seam for idle visuals, so demos still move.
