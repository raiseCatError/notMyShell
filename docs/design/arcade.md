# Vespyr Arcade

`/games`, `/game` and `/arcade` open one full-screen arcade, all offline and local: **Vespyr Run**, **Vespyr Flight**,
**Vespyr Dash**, **Classic Sudoku** and **Vespyr Queens** (formerly Vespyr Doku) in v0.22.0; the unreleased v0.23.0 work
extends it to 33 games (the full list with ids, aliases and controls is in
[arcade-expansion-status.md](../development/arcade-expansion-status.md)). `/game <id or alias>` (for example
`/game run|flight|dash|sudoku|queens|leap|pinball`; aliases are in `src/arcade/registry.ts`) opens a game directly. There is one command implementation and no
per-game global command: a new game is one directory under `src/arcade/games/` and one line in the registry. The
program growing it to 33 games, its hub, Stage, visual system and acceptance matrix are in
[arcade-expansion.md](arcade-expansion.md).

Vespyr, the NMSh cat (`src/idle/catSprite.ts`), is the player in every action game. Games draw their cat from that
sprite's silhouette, tinted by the theme through `arcadePalette().cat`.

## What owns what

| Piece | File | Responsibility |
|---|---|---|
| Session | `ArcadeSession.ts` | The Horizon hub (library, preview, details), a running game on the Stage, the pause sheet, the finale and the results sheet. The only code that talks to a game. Owns keys and frames while the Arcade is open. |
| Host wiring | `app/TerminalApp.ts` (`openArcade`, `paintArcade`, `closeArcade`, `syncArcadeClock`) | Paints the whole viewport while open (an early branch in `render`, like the screensaver; the PTY is never resized), with the rise-in and recede handoff; refuses to open over a running command or a foreground program; closes if a command starts; subscribes to `presentationClock` for exactly as long as the session wants frames; releases everything on close and on stop. |
| Contract | `types.ts` | `GameDefinition`, `GameInstance`, `GameContext`. |
| Drawing | `Canvas.ts` | Cell grid, half-block `PixelBuffer`, `BrailleBuffer`, cached row encoding that honours color level, NO_COLOR and Safe Glyphs. |
| Loop | `loop.ts` | `FixedStep`: equal simulation steps at any frame rate; stalls are clamped. |
| Randomness | `rng.ts` | Seeded `Rng` (mulberry32). Never `Math.random`. |
| Effects | `effects.ts` | `ParticleSystem`, `Trail`, `Popups`, `Flash`, `Shake`, scaled by the effects level; reduced motion removes shake and flashes. |
| Celebrations | `fx/sequence.ts`, `fx/cells.ts` | `Tween`, `Sequence`, `CountUp`, `Combo`; `Reveal`, `Ripple`, `shatter`, `confetti`. Clock-free, skippable, still under Reduced Motion. A game's `finale` is one of these. |
| Colors | `palette.ts`, `look.ts` | `arcadePalette()` derives from the active theme and Chroma roles; `arcadeLook()` adds the Arcade's own surfaces (tested lightness steps and contrast), text tones and eight distinct gameplay hues, anchored on Vespyr's lavender. |
| Scenery | `scenery.ts` | Gradient skies, stars, sun and moon, seeded ridges and skylines for the action games' worlds. |
| Engine | `engine/` | Collision (`collide.ts`), grid searches (`grid.ts`), undo (`history.ts`), offline daily seeds (`daily.ts`). |
| Menus | `menu.ts` | The shared vertical choice list with the standard selection treatment. |
| Scores | `scores.ts` | `<config dir>/arcade.json` (version 2): versioned, bounded, validated, atomically written, owner-only, with the hub's state (selection, favorites, recent). A damaged file is set aside; a newer file is read-only; a version 1 file is kept as `arcade.json.v1-backup` on the first version 2 write. |
| Typography | `ui/typography.ts` | Semantic roles (`title`, `celebration`, `counter`…); scaled by OSC 66 where verified, ordinary styled text elsewhere. |

## Game contract

A game is a deterministic state machine plus a renderer. It never reads the clock, the terminal, the filesystem or the
global theme; `GameContext` hands it a size, a seed and `Rng`, motion preferences, color level, Safe Glyphs, a record
handle and `now()`.

- `step(dtMs)` is called with exactly one fixed step (1000/60 ms) and only while `status === 'playing'`.
- `animate(dtMs)` is called every frame with real elapsed time, for purely visual timers.
- `render(canvas, alpha, palette)` draws the whole playfield and HUD into the canvas it is given (any size from 20 × 8).
- `key(key)` receives every key except Esc and `p` while `status === 'playing'` (the session pauses the game and shows the shared pause menu) and Ctrl+C (the session closes). A game with `typing: true` also receives `p`.
  Return `'back'` to leave to the hub, `'exit'` to close the arcade.
- Status is `ready → playing → over | won`; `result` carries the score text, `record: true` for a new best, and detail
  lines for the shared game over card (Retry, Back to Arcade, Exit).
- `finale`, when set after the game ends, plays before the results sheet; any key skips it.
- `persist()` saves whatever must survive leaving (a puzzle in progress); `dispose()` releases everything.

NMSh delivers key presses only (no key release). A held key repeats, so "variable jump height" is built from repeated
presses or a short window, never from release events.

## Records

Each game keeps its statistics under its id in `arcade.json` (`run`: `best`, `bestDistance`, `runs`; `flight`:
`best`, `bestPassed`, `attempts`; `dash`: `best`, `bestDistance`, `attempts`; `sudoku`: `bestTimes.<difficulty>`,
`completed`, `streak`, `current`; `queens` (formerly `vespyr-doku`, migrated by records v2): likewise). Values are bounded plain JSON; the store refuses anything
else. QA launchers use their own `XDG_CONFIG_HOME`, so test sessions never touch personal scores.

## Accessibility and safety

- NO_COLOR: nothing relies on color alone; solid glyphs, patterns and labels carry meaning (the canvas encoder degrades
  pixels to solid glyphs, and Safe Glyphs to ASCII).
- Reduced motion: no screen shake, no flashes, no parallax drift beyond what play needs; the hub stops animating.
- Typed `/games` never opens over a running command. Ctrl+T (NMSh's own key, never sent to a program) may, only while the
  session's evidence says the command is not reading input; a question or a full-screen program pauses or closes the
  arcade, so a game cannot take a password or reply meant for a program. It never writes to queues, sessions or tasks; it
  only reads their state for toasts ([arcade-background-work.md](arcade-background-work.md)).
- Frames are drawn into the panel; they are never written to the transcript or history.

## Libraries evaluated

| Library | License | Size | Decision |
|---|---|---|---|
| `sudoku-gen` | MIT | 32 KB, no dependencies | Candidate generator for Classic Sudoku; see the Sudoku notes for what was verified. |
| `sudoku.js` (robatron) | MIT | small | Not used (unmaintained, global style). |
| `terminal-kit` | MIT | 4 MB + dependency tree | Not used: a competing terminal framework. |
| `blessed` | MIT | large | Not used: a competing terminal framework, unmaintained. |
| `rot.js` | BSD-3 | 2.5 MB | Not used: roguelike toolkit; the Canvas covers rendering. |
| Queens / Star Battle generators | various, mostly unlicensed | tiny | Not used: none vetted; Vespyr Queens has its own generator and an independent solver. |
