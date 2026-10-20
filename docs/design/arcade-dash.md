# Vespyr Dash

A rhythm platformer for the Vespyr Arcade (`/game dash`, alias `vespyr-dash`). Vespyr, the NMSh cat, rides a glowing board
across a scrolling course at a steady pace and jumps spikes, gaps and platforms in time. The mechanics are those of the
familiar one-button rhythm platformers; the look, the patterns and the course are original.

## Controls and rules

| Key | Effect |
|---|---|
| Space or Up | Start (from *ready*) and jump. A press while standing jumps. A press in the air does nothing now but is remembered for 6 steps and jumps on touchdown. |
| p | Pause (shared pause menu). Esc pauses a run, leaves a game not yet started. |

There is no key release in a terminal, so jump height is fixed: one press, one full jump. Touching a spike's core, the side
of a platform or the far wall of a gap, or falling out of the world, ends the run. Landing on top of a platform is safe and
the cat rides along it, then drops off its end. Score is distance (1 point per 5 px, 1 m = 10 px) plus 10 per pattern
cleared, as a five digit counter (`typeset({role: 'counter'})`) that lights up every 100 points. A new best sets `result.record`.

## Physics (`physics.ts`)

Fixed step 1/60 s, semi-implicit Euler, world pixels (one column wide, half a row tall). `GRAVITY = 360`, `JUMP_V = 88`:
apex 10.03 px, 29 steps (0.48 s) in the air, 29 x speed/60 px of reach (29 px at 60 px/s, 51 px at 105 px/s).
`stepBody` is the single rule set, used by the game, the generator's proof and the tests.

* Hitbox: 5 x 5 inside the 7 x 6 sprite (the ear tips do not hurt).
* Surfaces: the ground (everywhere except gaps) and blocks. A surface above the feet is a wall unless it is within 1 px
  (`SNAP_PX`, a corner is forgiven) or the feet were above it a step earlier (a landing). Touching edges is clear.
* Spikes are drawn 6 x 4 and hurt in their 4 x 3 core.
* Speed rises in four levels, 60, 75, 90, 105 px/s, one per 1800 px, then stays at 105. Each is a multiple of a quarter pixel
  per step, which makes the cat's step grid align with the whole-pixel course in a handful of ways only (see below).

## Generation and the fairness proof (`course.ts`, `solver.ts`)

The course is built from a seeded stream (`rng.fork('course')`, fixed draws per pattern). Templates: a row of 1 to 3 spikes
(optionally spaced), a gap (12 px up to `GAP_MAX`), a platform (4, 6 or 8 px), a pole, a staircase of two platforms, an island
(a platform standing in a gap) and a perch (a platform with spikes at its far end). Which appear, their size and their spare room
depend on distance (`difficultyAt`) and on the speed they will be met at (islands, stairs and perches are sized from the px per
step so there is room to land, react and take off again).

Because the cat scrolls at a speed that depends only on distance, its position at step t is the same for every player. A
grounded state is therefore a step index, and `solve()` runs `stepBody` to find, for every step, where running on and
jumping lead (`next`, `jump`). Then, backwards:

* a touchdown is *robust* when, after `REACT_STEPS = 12` more steps of running (landing plus reaction), the player is at a robust step;
* a step is robust when a jump at each of at least `WINDOW_STEPS = 12` consecutive steps (0.2 s) lands robustly, or running on reaches a robust step.

A pattern is only placed (moved right pixel by pixel from the least safe position, plus random spare room that is itself
re-checked) when the whole stretch since the last rest is robust. The cat can meet the course at any of 4 to 7 alignments of its
step grid (every quarter pixel up to one step), and all of them are checked. A *rest*, a flat stretch of `REST_PX` after at most
5 patterns, lets any jump land and the reaction pass, so the proof restarts from a standing cat and the induction is exact.
Gaps never exceed `maxGapAt(speed)` (the width that still leaves a 13 step window, `AIR_STEPS + (PW - gap)/perStep`) less 4 px at
the cap; platform tops stay at least 1.5 px under the apex. Pattern `window` (the first jump's takeoff window in isolation) is kept per unit.

## Presentation

Half-block pixel scene over a themed gradient. Tints come from `ArcadePalette` roles (accent, success, warning, soft accent,
failure) blended with `mixRgb`: a new color phase every 80 m, blended in over 140 px. Platform tops glow where the cat lands (fades in 0.36 s).
A glowing trail (`Trail`), takeoff and landing sparks, an impact burst, flash and one-cell shake on death, floating score and
phase popups. A metronome runs on distance (one beat per 48 px): the sky and parallax layers pulse faintly and a tick in the HUD
alternates `•`/`·`. Two parallax layers of sharp triangles and pillars and, at speed, a few streaks.
Particles are capped at 120 and the trail at 20 points.

## Accessibility

* NO_COLOR or Safe Glyphs: the decorative backdrop, trail and particles are dropped; spikes become `▲` (`^` in Safe Glyphs), platforms
  and ground are solid blocks with a textured row, gaps are empty, and the cat is the NMSh ASCII cat.
* Reduced motion: no pulses, flashes, shake, streaks, parallax drift, landing glow or popups; a shorter hold after a crash.
* Effects `off`: no particles and no trail; `subtle` halves counts.
* Canvases under 40 x 12 show `Needs at least 40x12` (the course is not shown narrower than the reaction distance needs).

## Record (`arcade.json` -> `dash`)

`{best: number (score), bestDistance: number (meters), attempts: number}`, each validated on read (finite, nonnegative,
floored, capped at 1e9, otherwise 0). A finished run updates all three; `persist()` of an unfinished run only raises `best`/`bestDistance`.
Hub summary: `Best 420 · 210 m`. Result details: distance, best, attempts.

## Tests

`tests/arcadeDashPhysics.test.ts`: jump arc numbers per speed, speed ramp and cap, platform landing vs side hit and corner
forgiveness, spike hitbox edges, gap falls and crossings, gap maths per speed, templates proven at every phase, thousands of
generated pieces across seeds and speeds (spacing, integer positions, whole-course proof at every phase, and an independent forward
search of all press sequences in `tests/support/dashCheck.ts`), rests, bots on the real world (`tests/support/dashBot.ts`) pressing
early, middle, late and at random in the computed windows for 20,000 steps at the speed cap and from the start (an idle or spamming player dies),
determinism and the jump buffer. `tests/arcadeDashGame.test.ts`: state machine, scoring, crash and result, records and corrupt data,
persistence, pause/restart through the session, color phases, sprites, effects, reduced motion, NO_COLOR/Safe Glyphs, resize 20x8 to 200x60.

## Limits

Automated tests are not gameplay verification: feel (jump length, speed steps, rest frequency) and the look in real terminals
and themes need hands-on play. The proof guarantees a window of 12 steps in context for a player who acts inside it; a human
who jumps at the geometric edge of a hazard's window may land where the next pattern is tighter. Generating a pattern takes a few
milliseconds at the moment it is needed.
