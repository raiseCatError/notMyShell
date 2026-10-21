# Vespyr Flight

An endless flier for the Vespyr Arcade (`/game flight`, aliases `vespyr-flight`, `flap`). Vespyr, the NMSh cat, flies to
the right on a pair of small paper wings; gravity pulls him down and each flap lifts him. He weaves through towers of
books, glass chimneys and crates, each with a vertical gap. The mechanics are those of the familiar one-button flapper;
the art, the obstacles and the course generator are original.

## Controls and rules

| Key | Effect |
|---|---|
| Space or Up | Start the run (from *ready*) and flap. |
| p / Esc | Shared pause menu / menu (handled by the host). |

There are no key-release events, so the game never needs one. A flap sets the upward speed (an impulse; the position
does not jump). A wingbeat takes 7 steps (0.12 s): presses inside it are ignored, so a held key (which repeats) flaps
steadily and cannot climb faster than the fairness proofs assume.

Score is +1 when the cat has fully passed an obstacle (its hitbox's left edge beyond the obstacle's right edge), exactly
once per obstacle and never for one that was hit. The run ends on touching an obstacle, the ceiling or the ground; the
cat is shown hit for about 0.4 s (0.13 s with reduced motion), then the shared game over card with Retry.

## Physics (`physics.ts`)

Fixed step 1/60 s, semi-implicit Euler (`motion`, the single place gravity is applied). World units are pixels (one canvas
column wide, half a row tall; y grows down). `GRAVITY = 330 px/s^2`, `FLAP_V = 72 px/s`, `TERMINAL_V = 108 px/s`
(1.8 px per step). One flap climbs `FLAP_CLIMB = 7.26 px` and takes 13 steps to peak. The hitbox is 8 x 5 px inside the
14 x 8 sprite (ear tips, tail, wings and whiskers do not hurt); an obstacle is 8 px wide. Touching an edge is clear; only
a real overlap, or crossing the ceiling (`y < 0`) or the ground (`y + 5 > height`), is a hit.

The world is `height` pixels tall, fixed when a run starts from the panel's rows (`worldHeightFor`: 26 to 56, even). Speed
and the course do not depend on the canvas width. If the canvas later shrinks below the world, the picture is compressed
vertically; a taller canvas gets a cloud-bank ceiling and a deeper ground.

Speed rises linearly from 44 to 76 px/s over the first 7000 px and then stays there (`speedAt`); `difficultyAt` (0 to 1
over the same distance) also narrows the gap, tightens the spacing and raises how far gap centers may move.

## Fairness arithmetic and generation (`physics.ts`, `course.ts`)

Everything is computed from `motion`, so the proof and the game cannot drift apart:

- `climbIn(n)`: the most height gainable in n steps (flap at step 0 and again every 7 steps; a flap sets the velocity, so
  the start state does not matter and no strategy climbs faster).
- `fallIn(n)`: the most height lost in n steps without flapping, starting from the worst case (a flap just before).
- `GAP_MIN = CAT_H + ceil(FLAP_CLIMB + FALL_PER_STEP) + 1 = 16 px`: room for one flap arc (a hovering cat flaps when it
  would touch the lower edge and rises one arc), one terminal-speed step of overshoot and a pixel. The generated gap
  starts at most 28 px, narrows to `GAP_MIN` at the cap and never goes below it (`minGap(speed)`).
- `minSpacing(speed)`: clear distance of at least `REACT_STEPS + 16 = 28` steps between clearing one obstacle and touching
  the next, plus the obstacle and cat widths.
- `shiftLimit(direction, speed, free, gapA)`: for the clear distance `free`, the steps left after `REACT_STEPS = 12` (0.2 s of
  reaction) give `SAFETY = 0.85` of `climbIn` or `fallIn`, minus half the free travel of the first gap (the player may leave
  it from its far end). The second gap's own slack is not counted. At 52 free steps this is 23 px up and 15 px down.
- `pairReachable(a, b, speed)`: gap height at least `GAP_MIN`, clear distance at least `minFree`, and the center shift
  within `shiftLimit`, at the faster (later) speed.

`Course` draws four random numbers per obstacle always (spacing, shift, gap, style), so what the check adjusts never changes
what follows; it places the obstacle, picks a gap center within `min(shiftLimit, lerp(5 px, 40 px, difficulty))` of the
previous (so variation grows with difficulty), clamps it inside the world (`EDGE = 2` px), and then verifies
`pairReachable`, stepping the gap toward the previous one until it holds. The first gap is centered on the cat's start.

## Visuals (`sprites.ts`, `scene.ts`)

Every pose is built from `catPixels('idle')`: ears, eyes, whiskers, body and four legs are Vespyr's. The wing cycle follows
flaps (down-stroke for 4 steps, level for 4, then raised while falling), legs tuck when rising and dangle when falling, the
tail trails, levels or streams according to a smoothed vertical speed, and he blinks and flicks an ear. Backdrop: day/night
sky from `skyAt` over the distance, parallax clouds, hills and rooftops, stars at night; the ground, ceiling bank and all
obstacle colors derive from the palette. A trail and small flap puffs (`Trail`, `ParticleSystem`), `+1` popups, the score
counter lighting up, and a sparkle plus popup every 10 points. The score uses `typeset({role: 'counter'})`; the title does
too. A crash bursts, flashes and shakes, then the frozen scene fades toward the palette's dusk over about 400 ms.

## Accessibility

- NO_COLOR and Safe Glyphs: the backdrop is dropped (`decor` off); obstacles become hollow outlines with a dotted fill and a
  solid lip, the ground has its own `▒` texture row, and the cat is solid, so all three read differently in a plain render.
  Safe Glyphs maps these to ASCII through the canvas.
- Reduced motion: no shake, flash, fade, sparkles, popups, trail or puffs, and no cloud drift; the crash hold is shorter.
- Effects `off`: no particles, trails or popups. Gameplay is identical in all modes.
- Below 30 x 16 cells the game shows `Needs at least 30x16` instead of the playfield.

## Records

`context.record` holds `{best, bestPassed, attempts}` (whole numbers, validated and clamped on read; anything else counts as 0).
`best` is the highest score and `bestPassed` the most obstacles passed (equal today because a point is an obstacle; they are kept
separate so the score can change without losing history). A finished run adds an attempt; a score above the best at the start
of the run sets `result.record`. `persist()` saves a better unfinished score without counting an attempt.

## What the tests prove (`tests/arcadeFlightPhysics.test.ts`, `tests/arcadeFlightGame.test.ts`)

- Flap impulse, gravity increments, terminal velocity, the wingbeat cooldown, and that `climbIn`/`fallIn` equal what the
  real simulation does.
- Collision boundaries to 0.001 px (pipe top and bottom, front and back, ceiling, ground); scoring exactly once.
- Over 5000 consecutive pairs (6 world heights, 7 starting speeds, 14 seeds) every pair is reachable, every gap at least
  `GAP_MIN`, every spacing at least `minSpacing`; ramps are monotonic and capped; shift variation grows.
- A simulated player that plays the real simulation (flap when the predicted position would cross the lower edge) survives
  20000 steps at the top speed and smallest gap on many seeds and world heights; a player 12 steps (0.2 s) late survives too;
  one 40 steps late does not always; idling or mashing dies.
- Determinism (state hash), course independence from canvas width, restart, records and corrupt records, resize from
  20 x 8 to 200 x 60 with every plain row within width, NO_COLOR, Safe Glyphs, reduced motion, effects off, the fade, and a run
  through `ArcadeSession`.

## Limits

The proofs assume the player reacts within 0.2 s and flaps at least once per wingbeat window when needed; they are about
reachability, not comfort. Automated tests are not physical gameplay verification: feel, readability of the sprites in a real
terminal and the look of the themes need hands-on play. Sized text depends on the terminal's support.
