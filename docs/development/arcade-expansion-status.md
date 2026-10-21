# Arcade expansion status

Live status of the [33-game program](../design/arcade-expansion.md). Update this file in the same commit as the work.
Legend: ✓ done with evidence · ◐ in progress · · not started · — not applicable. "Physical" is filled only by a person.

| # | Game | Batch | Rules | Gen | Det | Input | Records | FX | Visual | Perf | Docs | Physical |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Vespyr Run | 1b | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ | · |
| 2 | Vespyr Flight | 1b | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ | · |
| 3 | Vespyr Dash | 1b | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ | · |
| 4 | Classic Sudoku | 1b | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ | · |
| 5 | Vespyr Queens | 1b | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ | · |
| 6 | Vespyr Leap | 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ | · |
| 7 | Alley Sprint | 4 | · | · | · | · | · | · | · | · | · | · |
| 8 | Color Orbit | 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ | · | ✓ | · |
| 9 | Glass Rush | 4 | · | · | · | · | · | · | · | · | · | · |
| 10 | Kitten Parade | 4 | · | · | · | · | · | · | · | · | · | · |
| 11 | Vespyr Rover | 4 | · | · | · | · | · | · | · | · | · | · |
| 12 | Brickfall | 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ | · |
| 13 | Purr Pong | 2 | ✓ | — | ✓ | ✓ | ✓ | ◐ | ◐ | · | ✓ | · |
| 14 | Tail Chase | 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ | · | ✓ | · |
| 15 | Cat Tower | 2 | ✓ | — | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ | · |
| 16 | Catapult Cats | 4 | · | · | · | · | · | · | · | · | · | · |
| 17 | Vespyr Bullseye | 2 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ | · |
| 18 | Vespyr Pinball | 4 | · | · | · | · | · | · | · | · | · | · |
| 19 | Maze Prowler | 4 | · | · | · | · | · | · | · | · | · | · |
| 20 | Sandfall | 4 | · | · | · | · | · | · | · | · | · | · |
| 21 | Merge 2048 | 3 | ✓ | — | ✓ | ✓ | ✓ | ◐ | ◐ | · | ✓ | · |
| 22 | Yarn Drop | 4 | · | · | · | · | · | · | · | · | · | · |
| 23 | Treat Match | 3 | · | · | · | · | · | · | · | · | · | · |
| 24 | Minefield | 3 | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ | · | ✓ | · |
| 25 | Cat Fleet | 3 | · | · | · | · | · | · | · | · | · | · |
| 26 | Purrword | 3 | ✓ | — | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ | · |
| 27 | Tile Slide | 3 | · | · | · | · | · | · | · | · | · | · |
| 28 | Yarn Lines | 3 | · | · | · | · | · | · | · | · | · | · |
| 29 | Circuit | 3 | · | · | · | · | · | · | · | · | · | · |
| 30 | Box Escape | 3 | · | · | · | · | · | · | · | · | · | · |
| 31 | Ice Paws | 3 | · | · | · | · | · | · | · | · | · | · |
| 32 | Moonjars | 3 | · | · | · | · | · | · | · | · | · | · |
| 33 | Driftkeys | 5 | · | · | · | · | · | · | · | · | · | · |

## Shared foundations

| Item | Status |
|---|---|
| Full-viewport ownership (no chrome, PTY unchanged) | ✓ automated (`tests/arcadeHub.test.ts`); physical not run |
| Horizon hub (tiers, categories, search, favorites, recent, sticky selection) | ✓ automated; captures reviewed (wide, standard, narrow, search) |
| Stage (controls row, pause sheet with How to play, finale, results sheet with count-up) | ✓ automated; captures reviewed |
| Records v2 and Vespyr Doku → Queens migration | ✓ (`tests/arcadeRecordsV2.test.ts`) |
| Arcade look (surface tiers, secondaries, contrast tests) | ✓ (`tests/arcadeLook.test.ts`) |
| fx: Tween, Sequence, CountUp, Combo, Reveal, Ripple, shatter, confetti | ✓ (`tests/arcadeFx.test.ts`) |
| engine: collide, grid, history, daily | ✓ (`tests/arcadeEngine.test.ts`); body, search, replay come with the games that need them |

## Visual evidence

Captures are deterministic frames (`scripts/arcade/frame.ts`) photographed by `scripts/arcade/shots.ts` (headless Chrome
over an HTML cell grid; VHS could not run inside the agent's sandbox). They are kept on the scratch volume, not in Git.
Reviewed for batch 1: hub wide/standard/narrow/search, every game's preview, Run/Flight/Dash play and game over, pause
sheet, Sudoku at 160×45, 120×36, 90×28 and 60×20 with the finale and results, Queens at 120×36, 90×26 and 60×20 with the
finale. Not yet captured: Reduced Motion and NO_COLOR / Safe Glyphs for every game (◐ in the table).

## Log

- 2026-10-21: batch 3 (in progress) on `feature/arcade-batch3`: Minefield, Merge 2048 and Purrword registered with tests (273 arcade tests pass, typecheck clean). Purrword verified: two-pass scoring, date-seeded daily, resume, streak rollover, practice, tile flip sequencing. Visual captures of batch 3 not yet reviewed; Treat Match (23) is the remaining batch 3 game.
- 2026-10-21: program started; spec and status written. Worktree `/Volumes/T7Tmp/ai-dev/worktrees/notMyShell/arcade`.
- 2026-10-21: batch 2 on `feature/arcade-batch2`: Vespyr Leap, Tail Chase, Purr Pong, Brickfall, Cat Tower, Vespyr Bullseye, Color Orbit (shared `kit.ts`; `outlineSprite` keeps Vespyr readable over lavender skies). FX ◐ where the game has hit and pass effects but no dedicated record celebration beyond the shared results sheet.
- 2026-10-21: batch 1 and 1b on `feature/arcade-expansion`: records v2 + Queens migration, look/fx/engine, full-viewport hub and Stage, Sudoku and Queens redesigns, Run/Flight/Dash worlds.
