# Vespyr Queens

A cat-placement logic puzzle in the family of Queens / Star Battle (mechanics only; no assets or levels are shared). A
square N x N board is split into N colored regions, each a connected set of cells. Place Vespyr cats so that every row,
every column and every region holds exactly one cat, and no two cats touch, diagonals included. `/game doku` or
`/game vespyr-doku`. Kind: `puzzle` (`stepsPerSecond` 0, `refreshMs` 1000, faster only while something animates).

## Controls

| Key | Action |
|---|---|
| arrows, `h` `j` `k` `l` | move the cursor |
| Space, Enter | empty or X becomes a cat, a cat becomes empty |
| `x` | empty becomes X (excluded), X becomes empty; a cat is left alone; placing a cat clears the X |
| `u` | undo |
| Ctrl+Y or `y` | redo |
| `t` | hint: the first press explains the next logical step and highlights the cells, the second press applies it |
| `c` | clear every mark (one undoable move) |
| `r` twice | restart the same puzzle (marks, history, clock and hint count reset) |
| `n` | back to the start menu (the puzzle is kept; the menu offers Continue) |
| Esc / `p` | the host's pause (the board is hidden while paused) |

Start menu: Continue (when a puzzle is saved) and New easy / medium / hard / expert puzzle. The pause menu's Restart opens a
new game instance, i.e. the start menu, where Continue resumes the saved puzzle.

## Difficulty

Rated by the hardest technique the logical solver needs, not by size:

| Level | Technique | Meaning |
|---|---|---|
| 1 | single | a row, column or region has one open cell: place the cat |
| 2 | confined | a region lies within one line (so exclude the rest of that line), or a line can only hold one region's cat |
| 3 | blocked | a cat on this cell would leave another unit with no open cell |
| 4 | pair | two regions fit in two lines (or two lines in two regions) |
| 5 | triple | the same with three |

| Difficulty | Board | Accepted levels |
|---|---|---|
| Easy | 5x5 or 6x6 | 1-2 |
| Medium | 7x7 | 2-3 |
| Hard | 8x8 | 3-4 |
| Expert | 9x9 (most) or 10x10 | 4-5 |

The solver always applies the easiest available technique, and the puzzle's level is the highest one it had to use. If no
generated candidate lands in the band the closest rating is returned.

## Generator and solver (`src/arcade/games/queens/`)

- `generator.ts`: plants a placement (random backtracking over a permutation with no touching), grows N connected regions
  from the planted cats (the smaller of two random regions grows first), then repairs ambiguity: given another solution
  (supplied by the caller) it moves one of its cells into a neighboring region, keeping regions connected and planted cats
  in place. It imports nothing but types.
- `solver.ts`: independent of the generator (a test checks the imports). `countSolutions` (bitmask search, stops at the
  limit) proves uniqueness; `LogicBoard` solves by the techniques above; `rate` returns solved/level; `nextHint` produces
  hints. It also imports only types.
- `puzzle.ts`: `makePuzzle(seed, difficulty)` is a pure function of its arguments: candidates are generated, repaired,
  kept only if the count is exactly 1 and the techniques solve it. At most 400 attempts per seed, then a derived seed (6
  rounds); the closest rating wins when none fits. Typical cost: about 1-5 ms for sizes up to 8, about 100 ms average for
  Expert (9x9 mostly; 10x10 is picked one time in five and can take a second).
- `rules.ts`: the validator (`analyze`): conflicts per cat, per-unit counts, which rows, columns and regions are done,
  solved.

## Hints

`nextHint(size, regions, solution, marks)` reads the board and changes nothing. A cat that is not in the solution or an X on a
cat's only home is pointed out first (`fix`). Otherwise the board is rebuilt from the cats and X marks, and the easiest
technique that adds something the board does not show yet is explained in words, e.g. "Row 3 has only one open cell
(row 3, column 4): place a cat there." or "Region B is confined to column 4, so exclude column 4 elsewhere." The cells that
justify it get a `◇` and the cells it would change a `◆` (`o` and `*` in Safe Glyphs) plus a tint, and the cursor jumps to
the first target. A hint is counted when shown; applying it is one undoable move and is not counted again. Any other change
to the board drops the pending hint.

## Presentation

Cells are chosen to fit, biggest first: 7x3 and 6x2 with a full lattice (region borders in box-drawing glyphs between
cells), 4x1 and 3x1 with vertical borders and an underline for borders below, and 2x1 with letters only. Each cell shows its
region letter (A, B, ...) in the corner, region backgrounds come from `regionColors`, completed regions glow, row and
column labels turn into a tick when done and `!` when crowded. The cat is a mini Vespyr drawn with half blocks from the head
and ears of `idle/catSprite.ts` (settles in with an easeOutBack drop, blinks and flicks its tail every few seconds); under
NO_COLOR and Safe Glyphs it is text: `( o.o )` and `/\_/\`, `^.^`, `^^`. A clashing cat shows `!` eyes (`( !.! )`, `^!^`)
and a red tint. X marks are drawn as a small cross (`\ /`, `×`, `x`). The selected cell has a ring (or brackets in the
small layouts). Reduced motion removes the drop, blink, tail and particles; the victory shows the finished board with a
restrained particle burst (only when motion allows) under the shared card with the `celebration` heading.
A canvas too small for the board shows `Needs at least WxH`.

## Record (`vespyr-doku`, schema v1)

```
{ version: 1,
  bestTimes: {easy?, medium?, hard?, expert?}  // ms, hint-free solves only
  completed, completedByDifficulty: {easy, medium, hard, expert},
  streak, bestStreak,                          // consecutive hint-free solves
  current?: { difficulty, seed, size, regions: "N*N letters A..", solution: "c0,c1,...",
              marks: "N*N of . x c", elapsedMs, hints } }
```

Every field is validated on load. `current` is accepted only when sizes and letters agree, every region exists and is
connected, `solution` is a valid placement, the layout has exactly one solution, marks use only `.xc`, the clock is finite
and non-negative; otherwise it is deleted. Statistics are clamped to bounded integers. The board is saved after every
move, on pause and when leaving; a win removes `current`.

## What the tests prove

`tests/arcadeDokuLogic.test.ts`: validator accepts a solution and rejects two cats in a row, column or region and diagonal
touching; counting finds multiple solutions; 200 seeds for each size from 5 to 9 (and a few at 10) give sound, unique,
logically solvable puzzles; determinism; ratings fall in their band; generation averages well under 200 ms up to 9x9;
hints finish a puzzle from an empty board without touching what they read; wrong cat and X are flagged first;
undo/redo round trips; persistence round trip and every corrupt field discarded; layout bounds.
`tests/arcadeDoku.test.ts`: keys, marks, undo/redo, the clock (animate only, not in the menu or paused), hints (explain,
apply, count, undo), winning and statistics, restart, Continue, corrupt recovery, every canvas size from 20x8 to 200x60
within its width, region letters and borders, cats, X marks and clashes under NO_COLOR and Safe Glyphs (ASCII only),
reduced motion static, the shared session pause and resume.

## Limits

Automated tests are not physical play: feel, color contrast on real themes, and the animations still need a person at a
terminal. Mouse is not supported. Best times ignore hinted solves. Guessing is never needed, but the solver only knows
techniques up to triples, so every shipped puzzle is solvable by them and none harder is generated.
