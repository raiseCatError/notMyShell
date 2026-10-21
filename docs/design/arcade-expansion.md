# Vespyr Arcade expansion: 33 offline games

Status: program specification, started 2026-10-21 on top of the published v0.22.0 (`95da2c8c`). It extends
[arcade.md](arcade.md), which stays the reference for the game contract, and it does not change the v0.22.0 release.
All 33 games are implemented and registered on `feature/arcade-batch3` (unreleased, planned as v0.23.0) with automated
evidence; physical Ghostty/Zed QA has not been run, so the Physical column of the acceptance matrix is still open. See
[the status ledger](../development/arcade-expansion-status.md) for per-game evidence and known limits.

The goal is one offline arcade of **33 complete, polished games** inside NMSh: a full-viewport *Horizon* hub, full-viewport
*Stage* gameplay, one shared engine and one visual language. It is delivered in reviewed batches; the program is not
complete until every row of the [acceptance matrix](#acceptance-matrix) is.

## Non-negotiables

- Offline always: first launch, puzzles, daily challenges, dictionaries, assets and scores ship in the package. No
  network, accounts, telemetry, ads, downloads or remote validation.
- Gameplay stays in NMSh's terminal UI, drawn through the arcade `Canvas` and the shared renderer. No Kitty graphics,
  browser or external runtime is required; capability-dependent touches (OSC 66 typography) keep text fallbacks.
- Input ownership: while the Arcade is open it owns every key. Nothing typed reaches the PTY, the composer, command
  history or the transcript. It opens over a running command only by NMSh's own Ctrl+T key and only when the session's
  evidence says the command is not reading the keyboard; a program that asks for input pauses it, and one that takes the
  terminal closes it ([background work](arcade-background-work.md)).
- No new shell session, no transcript loss, no PTY resize (see [Viewport ownership](#viewport-ownership)).
- 8 GB Apple Silicon target: one running game, one animated hub preview, bounded pools, no background simulation.
- Saved data is never silently lost; renames migrate ([Records v2](#records-v2)).
- GPL-3.0-only. Every adapted algorithm or dependency is recorded under [Provenance](#provenance-and-licenses).

## Catalog

Ids are stable record keys and `/game <id>` names; aliases keep older names working. "Systems" names the shared
modules a game relies on (see [Engine](#engine)).

| # | Id | Title | Category | Core mechanic (must be real) | Systems |
|---|---|---|---|---|---|
| 1 | `run` | Vespyr Run | Runners | Endless runner: jump, duck, fair spawn spacing | fixed step, kinematics, parallax |
| 2 | `flight` | Vespyr Flight | Runners | Flap through gaps; gravity, gap fairness | fixed step, kinematics |
| 3 | `dash` | Vespyr Dash | Runners | Rhythm platformer; solver-validated courses | fixed step, solver |
| 4 | `sudoku` | Classic Sudoku | Logic | Unique-solution 9×9, notes, hints | grid, solver, undo |
| 5 | `queens` | Vespyr Queens | Logic | One cat per row, column and region, no touching (was Vespyr Doku) | grid, solver, undo |
| 6 | `leap` | Vespyr Leap | Runners | Auto-bounce upward; moving/breaking platforms, springs; reachability-checked layouts | kinematics, procgen |
| 7 | `alley` | Alley Sprint | Runners | Three lanes; lane change, jump, slide, combined obstacles | lanes, procgen |
| 8 | `orbit` | Color Orbit | Reflex | Pass rotating rings only through the matching color arc | angular collision |
| 9 | `glass` | Glass Rush | Reflex | Advance through panes; limited spheres, projectile timing, shatter chains | projectiles, ballistics |
| 10 | `parade` | Kitten Parade | Runners | Crowd count through + − × ÷ gates and hazards; bounded crowd rendering | lanes, arithmetic gates |
| 11 | `rover` | Vespyr Rover | Physics | Hill-climb driving: throttle, brake, tilt; wheel-terrain contact, fuel, distance | rigid body, terrain |
| 12 | `brickfall` | Brickfall | Arcade | Breakout: paddle angle control, bricks, power-ups, layouts | ball physics, particles |
| 13 | `pong` | Purr Pong | Arcade | Pong vs. AI (three levels) or two players on one keyboard | ball physics, AI |
| 14 | `snake` | Tail Chase | Arcade | Snake on a grid; growth, obstacles, speed modes | grid movement |
| 15 | `tower` | Cat Tower | Arcade | Precision stacking; overhang is trimmed | kinematics |
| 16 | `catapult` | Catapult Cats | Physics | Slingshot trajectories into destructible block structures; per-cat abilities | rigid body, ballistics |
| 17 | `bullseye` | Vespyr Bullseye | Reflex | Darts from below into a rotating target; angular collision with embedded darts | angular collision |
| 18 | `pinball` | Vespyr Pinball | Physics | Flippers, bumpers, plunger, multipliers; circle-segment collision | ball physics |
| 19 | `prowler` | Maze Prowler | Arcade | Maze chase; four distinct pathfinding enemies, power treats | grid, BFS/A* |
| 20 | `sandfall` | Sandfall | Falling | Pieces become sand grains; cellular settling; a color spanning wall to wall clears | cellular automaton |
| 21 | `merge` | Merge 2048 | Number | Slide and merge, legal-move detection, undo | grid, undo |
| 22 | `yarn` | Yarn Drop | Falling | Suika-style: drop yarn balls, equal sizes fuse, circle physics in a jar | circle physics |
| 23 | `treats` | Treat Match | Logic | Match three: swaps, cascades, specials, objectives; never dead boards | grid, cascades |
| 24 | `mines` | Minefield | Logic | Minesweeper with first-click safety, flags, chords, presets | grid, flood fill |
| 25 | `fleet` | Cat Fleet | Logic | Battleship vs. a fair offline AI (hunt/target with parity) | grid, AI |
| 26 | `purrword` | Purrword | Word | Wordle-style deduction; offline list; date-seeded daily; practice; streaks | daily seed, dictionary |
| 27 | `slide` | Tile Slide | Logic | 15-puzzle (3×3–5×5), numbers or pixel pictures; solvable shuffles | grid, parity |
| 28 | `lines` | Yarn Lines | Logic | Flow: connect pairs, no crossing, fill the board; generator + solver | grid, solver, undo |
| 29 | `circuit` | Circuit | Logic | Rotate tiles; current flows along real graph connectivity to every lamp | grid, graph |
| 30 | `escape` | Box Escape | Logic | Rush-hour block sliding; BFS-verified boards, hints | grid, BFS, undo |
| 31 | `ice` | Ice Paws | Logic | Frictionless sliding to a goal; BFS-verified minimum moves | grid, BFS |
| 32 | `moonjars` | Moonjars | Logic | Liquid sort: pour contiguous top colors; capacity rules; solvable generation | search, undo |
| 33 | `driftkeys` | Driftkeys | Typing | Floating phrases typed in place, no echo; Programmer and Words modes | typing engine |

Naming: Vespyr is in the title where the cat is the player and it reads naturally; elsewhere a short original name.
Conflict search (2026-10-21): "Typefall" is an existing itch.io typing game and "Chromatubes" an existing iOS tube
puzzle, so the requested provisional names were replaced by **Driftkeys** and **Moonjars**. "Purrdle" is a 2025 cat puzzle
book and "Purdle" a Wordle-like, so the word game is **Purrword**. Lane Dash became **Alley Sprint** (Vespyr Dash already
exists), Crowd Dash **Kitten Parade**, Tower Stack **Cat Tower**, Fruit Merge **Yarn Drop**, Match Three **Treat Match**,
Flow Lines **Yarn Lines**, Sliding Escape **Box Escape**, Ice Slide **Ice Paws**, Vespyr Climb **Vespyr Rover**. No other
proposed title matched a known game.

Interpretations recorded rather than silently changed: Tower Stack is the moving-block stacking game ("Stack"); Glass
Rush keeps Smash Hit's resource-and-timing loop in a 2D lane view, because a terminal cannot render a 3D corridor
legibly: panes approach on a perspective-free scrolling track and spheres follow a ballistic arc.

## Viewport ownership

The Arcade is a full-viewport application. It follows the idle screensaver's precedent (`TerminalApp.paintIdle`):

- `render()` takes an early branch while the Arcade is open and paints the whole terminal (`terminalDimensions()`,
  ignoring the workspace sidebar, Status Strip, notices, banner and composer) through the same `TerminalRenderer`, with
  the caret hidden. No alternate screen is entered: the renderer already owns the visible screen, and leaving the branch
  repaints the ordinary frame from state that was never touched.
- The PTY keeps its size: `ptyRows` comes from the reference layout (#443), and the Arcade branch never calls
  `session.resize`. Transcript, queue, background tasks and the shell session are untouched.
- Opening and closing use one presentation-only transition (First Prompt's handoff idea, no Aurora): the hub rises in
  from the bottom edge over ~320 ms and recedes the same way on exit; any key finishes it; Reduced Motion, Effects Off or
  NO_COLOR skip it. During the transition the rows outside the Arcade's part are the real frame's rows.
- Guards: typed `/games` is refused over a running command or foreground program (Ctrl+T is the explicit way, with its own
  fail-closed checks); a command that starts from outside the queue closes it, while an authorised queued entry runs behind
  it; focus out pauses; Ctrl+C closes (it never interrupts a command); resize re-lays out without restarting a game. See
  [arcade-background-work.md](arcade-background-work.md).
- Mouse: wheel scrolls the library; a click selects a game, a second click plays it. Games may opt in to clicks.

## Horizon hub

Uses Horizon's layout principles (a list on the left, the highlighted choice opening into a rich detail on the right, a
powerline-style selected segment, square keycaps) without its sky, Aurora or startup code.

```
 Vespyr Arcade                                    / search     ★ favorites   ◷ recent     33 games
 ─────────────────────────────────────────────────────────────────────────────────────────────────
  RUNNERS                         ▌                                                              ▐
  ▶ Vespyr Run          1,240 m   ▌        live preview of the highlighted game                  ▐
    Vespyr Flight         ★ 38    ▌        (only this one animates)                              ▐
    Vespyr Dash                   ▌                                                              ▐
  LOGIC                           ▌                                                              ▐
    Classic Sudoku     ✓ today    ─────────────────────────────────────────────────────────────────
    Vespyr Queens                  Vespyr Run · Runners                                Best 1,240 m
  …                                Vespyr dashes across a scrolling landscape …        Runs 41
                                   ⎵ jump   ↓ duck   Esc pause
 ─────────────────────────────────────────────────────────────────────────────────────────────────
  ↑↓ choose  ⏎ play  / search  f favorite  Tab category  1-9 jump  Esc close
```

- Tiers: **wide** ≥ 110 columns (list 34–40 columns, preview at most 16:9 of the remaining space, details beside or under
  it); **standard** 72–109 (list 30, preview above details); **narrow** < 72 or < 18 rows (one game at a time: title,
  preview strip, details; ←→ or ↑↓ change game, the list is one line of dots); **tiny** < 40 × 12: a plain list and keys.
- The list is grouped by category with sticky headers, scrolls to keep the selection visible (two rows of context), and
  shows each game's one-line best or daily state. Favorites (`f`) and recently played (last 8) are virtual categories at
  the top. `/` opens an inline filter that matches title, id, alias and category; Esc clears it. `Tab`/`Shift+Tab` jump
  between categories.
- Returning from a game, and reopening the Arcade, selects the game last played (stored in `hub.selected`).
- Only the highlighted preview animates (10 fps, 0 with Reduced Motion: one representative still). A change of
  highlight cross-fades the preview over 180 ms; the list and details are cached per state and size.
- No empty padding: the preview takes the space the details do not need; with nothing to show, the details expand.

## Stage gameplay

- Entering a game hides the library: the game gets the whole viewport except one row at the bottom carrying the game's
  title and its controls as keycaps (dropped below 10 rows). Games draw their own score and status inside the playfield.
- Puzzle boards stay square-celled and centered at an integral cell size; a side panel (timer, difficulty, counters)
  sits beside the board when width allows, below it otherwise. Boards never stretch.
- Esc or `p` opens the shared pause sheet (Resume, Restart, How to play, Back to Arcade, Exit) over the dimmed playfield;
  effects follow NMSh's own motion settings (Reduced Motion, Effects Off), so there is no separate Arcade toggle. Results
  use the shared results sheet (score count-up, details, record badge, Retry, Back, Exit) after the game's own finale.

With a command or queue behind it the Arcade reserves its top row for a strip (running label, toasts, attention state), so
games keep a constant size; see [arcade-background-work.md](arcade-background-work.md).

## Visual system

`src/arcade/theme/` (new) adds an **Arcade look** on top of `arcadePalette()`:

- Foundation: lavender `#c9b8ff`-family ink, graphite surfaces, deep purple night, derived from Chroma roles so themes
  still recolor it. A small set of **distinct secondary hues** (peach, mint, sky, butter, rose, teal) chosen in OKLCH at
  spaced hues with a minimum ΔE and a contrast check against the surface, for gameplay meaning (pieces, regions, lanes).
- Surface tiers: `base`, `raised`, `sunken`, `selected`, `focus`, each with a minimum contrast step against its
  neighbours (tests assert it), so "15 nearly identical purples" cannot recur.
- Per-game palettes may override secondaries for clarity; every meaning also has a glyph or pattern (NO_COLOR, color
  blindness).
- Sprites: original pastel pixel art on half-block `PixelBuffer`s; Vespyr's silhouette comes from `src/idle/catSprite.ts`
  with pose variants (idle, run, jump, crouch, happy, startled, sleep) shared by every game.
- Backgrounds: shared parallax layers (stars, hills, city, clouds), gradients and vignette, all cached per size.

## Effects and celebrations

`effects.ts` remains the low-level layer. A new `src/arcade/fx/` adds bounded, deterministic, skippable sequences:

| API | Purpose |
|---|---|
| `Timeline` | Ordered, timed cues with easing; `skip()` jumps to the end state; driven by `animate(dt)` only |
| `Reveal` | Sweep / stagger reveal over a set of cells (Sudoku rows and boxes, Queens cats, Purrword tiles) |
| `Ripple` | Ring highlight expanding from a cell over a grid |
| `CountUp` | Score count-up with eased ticks; ends at the exact value |
| `Celebration` | The victory sequence: highlight → particles → badge → results sheet; record variant |
| `Combo` | Streak meter with tiers and decay |
| `Shatter` | Pixel fragments from a rectangle (bricks, glass, blocks) into the shared `ParticleSystem` |
| `ShakeImpulse` | Shake with magnitude ≤ 1 cell, off under Reduced Motion |
| `Transition` | Screen transitions (fade-through-surface, wipe) for hub ↔ stage |

Rules: every effect reads `MotionPreferences`; Reduced Motion replaces motion with a static highlight and no shake;
Effects Off draws only what gameplay needs; no full-screen flash above 3 Hz and no flash brighter than a set luminance
step; effects draw under HUD text and never over a hazard's silhouette; any key skips a celebration to its results;
tests run them on a fake clock and compare plain-text captures.

## Engine

| Module | Contents |
|---|---|
| `engine/math.ts` | `Vec2`, angles, clamp/lerp, segment and circle helpers |
| `engine/collide.ts` | AABB, circle–circle, circle–segment (with restitution), swept circle, angular interval overlap |
| `engine/body.ts` | Small rigid-body helpers (impulse, gravity, damping, sleeping) for Rover, Catapult, Pinball, Yarn Drop |
| `engine/grid.ts` | `Grid<T>`, neighbours (4/8), flood fill, BFS shortest path, connected components |
| `engine/history.ts` | Undo/redo stack with bounded depth |
| `engine/daily.ts` | Local calendar date → seed (`YYYY-MM-DD` + game id hashed), stable across restarts and time zones of the same date |
| `engine/search.ts` | Bounded BFS/IDA* for solvers with node limits |
| `engine/input.ts` | Key intent mapping (arrows, WASD, hjkl, Space, Enter) shared by games |
| `engine/replay.ts` | Recorded key + time streams for deterministic tests |

All of it is plain TypeScript with no dependency. Matter.js, Planck.js and Box2D ports were evaluated and rejected: each
is larger than the whole arcade, and the bodies needed here (balls, boxes, wheels on a height field) are a few hundred
lines with tests.

The game contract gains, compatibly: `category`, `records` (schema version and migration), `daily?`, `difficulties?`,
`howToPlay`, and optional `pointer(event)`. Old fields keep their meaning.

## Records v2

`arcade.json` v1 allows 16 games. v0.22 silently keeps only the first 16 entries and would drop the rest on its next
write, so the expanded file is **version 2**:

- v1 → v2 on first write: the old file is copied to `arcade.json.v1-backup` once; `vespyr-doku` becomes `queens`;
  other ids are unchanged; per-game data is kept verbatim.
- An older NMSh sees version 2 as "saved by a newer NMSh" and shows scores read-only instead of rewriting them.
- v2 adds a top-level `hub` record: `selected`, `favorites` (≤ 33 ids), `recent` (≤ 8 ids), `settings` (per-game
  options such as Driftkeys mode). Limits: 64 games, 512 KiB.
- Each game record carries `v` (its schema version) and its definition migrates older shapes on read.

## Driftkeys input and safety

- Keys arrive only while the Arcade owns input; the session hands Driftkeys `text` keys including Space. Nothing is
  echoed, buffered for the PTY, written to history or the transcript; strings are data and are never executed.
- `paste` keys are refused with a visible "paste is not allowed" note and no score change (fair-play policy).
- Esc pauses, Ctrl+C closes the Arcade, resize re-lays out targets inside the new bounds, focus out pauses.
- One active target at a time, with a focus ring; a correct key lights the next character in the target itself; a wrong
  key flashes the next character (no advance, combo reset, small time penalty); no Backspace; completion on the last
  character, no Enter. Difficulty is a function of elapsed play time, not frame rate.
- Programmer Mode (default) phrases are a fixed in-repo list; a test asserts the game never imports process, PTY or
  shell modules.

## Delivery batches

| Batch | Contents | Tracking |
|---|---|---|
| 1 Foundations | Viewport ownership, Horizon hub, Stage, records v2 + Queens migration, visual system, fx, engine core | UI/graphics tracker |
| 1b Five games | Run, Flight, Dash visual upgrades; Sudoku redesign; Queens redesign | UI/graphics tracker |
| 2 Arcade classics | Snake, Pong, Brickfall, Cat Tower, Bullseye, Leap, Color Orbit | arcade tracker, Leap tracker |
| 3 Puzzles | Minefield, Merge 2048, Purrword, Cat Fleet, Tile Slide, Yarn Lines, Circuit, Box Escape, Ice Paws, Moonjars, Treat Match | puzzle tracker |
| 4 Physics and action | Catapult Cats, Pinball, Sandfall, Yarn Drop, Rover, Glass Rush, Alley Sprint, Kitten Parade, Maze Prowler | physics tracker |
| 5 Driftkeys and audit | Driftkeys; the full 33-game visual and performance audit | Driftkeys tracker, QA tracker |

## Acceptance matrix

A game is **done** only when every column is checked. "Physical" is a person playing in Ghostty and Zed; automated
evidence never fills it.

| Column | Meaning |
|---|---|
| Rules | Core mechanic implemented and unit-tested (see the catalog's "must be real") |
| Gen | Procedural/curated content validated (solvable, fair, reachable) by seeded property tests |
| Det | Deterministic replay test with a fake clock and seed |
| Input | Keys, pause, Esc, Ctrl+C, resize, focus out |
| Records | Best/stats persisted, corrupt data tolerated, migration where relevant |
| FX | Completion/record celebration, reduced-motion and Effects Off variants |
| Visual | Captures reviewed: preview, first launch, play, pause, progression, end, record, narrow, wide, reduced, NO_COLOR |
| Perf | Frame budget and memory within limits on the 8 GB target |
| Docs | Help, How to play, design note |
| Physical | Played by a person in Ghostty and Zed |

The live status per game is kept in the epic issue (#481; trackers #474–#480) and in [arcade-expansion-status.md](../development/arcade-expansion-status.md).

## Provenance and licenses

No third-party code or asset is copied. Algorithms used are textbook (mulberry32, BFS, flood fill, DLX-free backtracking,
cellular sand rules, hunt/target Battleship). The Purrword and Driftkeys word lists are written for NMSh and released
under the repository's GPL-3.0-only license. Any later import is added here with its license and origin before use.

## Related issues

Reuses concepts from #172 (semantic motion profiles), #173 (deterministic presentation), #78 (Chroma effects) and #151
(rich preview surfaces), without reopening their scopes; respects #473's input risks. Does not touch #460–#469.
