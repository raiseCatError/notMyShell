# Classic Sudoku

`/game sudoku` (alias `classic-sudoku`). A calm 9x9 puzzle in four difficulties with unlimited fresh puzzles, pencil notes,
hints, undo and a saved puzzle in progress. Code: `src/arcade/games/sudoku/`.

| File | Responsibility |
|---|---|
| `solver.ts` | Rules and an independent solver: units and peers, conflicts, candidate bitmasks, backtracking that counts solutions up to a limit, naked and hidden singles. No drawing, no clock. |
| `generator.ts` | Seeded puzzle generator (see below). |
| `state.ts` | Puzzle state: clues, entries, notes, cursor, undo/redo, hints, restart. |
| `record.ts` | Record schema v1: validation on load, statistics, the hub summary, time formatting. |
| `layout.ts` | Board geometry: the largest cells that fit, HUD beside or above. |
| `view.ts` | Drawing: board, HUD, start menu, completion band. |
| `index.ts` | The `GameDefinition` and the instance that wires keys, the clock, effects and persistence. |

## Rules and controls

Fill every row, column and 3x3 box with 1-9 once. Given clues cannot be changed, erased or annotated.

| Key | Action |
|---|---|
| arrows, `h` `j` `k` `l` | move the cursor |
| `1`-`9` | enter a digit (a pencil mark in notes mode) |
| `0`, Backspace, Delete | erase the digit, or the notes when the cell has no digit |
| `n` | toggle notes mode |
| `u` | undo |
| `y`, Ctrl+Y | redo |
| `t` | hint |
| `r` (twice) | restart this puzzle from its clues |
| `m` | back to the start menu (the puzzle is kept; Continue resumes it) |
| Esc / `p` | pause (handled by the host), Esc in the start menu leaves |

The start menu (the game's own `Menu`) offers Continue (when an unfinished puzzle is saved), Easy, Medium, Hard, Expert
(keys `1`-`4`) and Back to Arcade (`q`). Each choice makes a new puzzle from `context.rng`.

- **Notes.** Placing a digit clears that cell's notes and strikes the digit from its peers' notes (one undo step).
  Notes can only be added to empty cells.
- **Conflicts.** A digit that repeats in a row, column or box is flagged on every cell involved with a `!` glyph, bold
  warning color and a "N clashes" counter. Conflicts are judged by the rules only, never by comparing with the solution,
  so the game does not leak the answer.
- **Matching digits.** Cells holding the cursor cell's digit are underlined and tinted; the cursor's row, column and box
  get a soft tint.
- **Hints (`t`).** A hint fills one cell with its correct digit and says why in one line ("R3C5 is 4: only 4 fits this
  cell", "the only 4 left in its box"). The target is the cursor cell when it is empty or wrong; otherwise the next cell a
  naked or hidden single settles (computed from the clues plus the entries that are correct); otherwise the first open
  cell. A hint counts once, is one undo step, and writes only to the player's entries: the clue and solution arrays are
  never touched. A win with any hint is never a personal best.
- **Completion.** When the grid is a valid complete solution the clock stops, statistics are saved and the saved puzzle is
  cleared. With effects on, a short celebration plays first inside the game (a "Solved" band with the time, three quiet
  fountains of `ParticleSystem` confetti, softly lit finished rows/columns/boxes while playing), then the status becomes
  `won` and the arcade's card shows the result (`3:07`, difficulty, hints, best time, streak, "New record" when earned).
  Reduced motion or effects off skip the celebration and win at once. Any key skips it.

## Clock

`step()` does nothing. The timer runs from `animate(dt)` only while a puzzle is being played; a single tick is capped at
2 s so a suspended terminal cannot bank time. `refreshMs` is 1000 so the host repaints the clock, and 80 while an entry
pop, a glow, confetti or the resume frame needs animation. `pause()` saves the puzzle and hides the board (the grid
frame stays, no digits or notes are drawn) so pausing cannot be used to think. The host
resumes without telling the game, so the first `animate()` after `pause()` is the resume tick: it clears the pause and
adds no time.

## Generation

Decision: **own generator; `sudoku-gen` is not used and is not a dependency.** `sudoku-gen@1.0.3` (MIT) was evaluated by
running 200 puzzles per difficulty through the independent solver:

| sudoku-gen | valid / unique | clues (min-max, avg) | solvable by singles | by naked singles only |
|---|---|---|---|---|
| easy | 200/200 | 36-39, 37.6 | 200 | 147 |
| medium | 200/200 | 30-32, 30.4 | 200 | 112 |
| hard | 200/200 | 23-28, 25.5 | 56 | 0 |
| expert | 200/200 | 22-23, 22.7 | 0 | 0 |

Its puzzles are correct, but it draws from a fixed pool of 40 base puzzles (10 per difficulty) and relabels/permutes them
with `Math.random`, which cannot be seeded: the same seed could not give the same puzzle, and the clue counts and
techniques do not form a clean ladder (easy and medium both mix naked-only and hidden-single puzzles). The arcade
requires all randomness to come from `context.rng`, so the project generates its own.

The generator (`generatePuzzle(difficulty, rng)`): build a random solved grid by randomized backtracking, then remove
clues in 180-degree pairs (a tidy pattern) in random order, keeping a removal only while the puzzle is still solvable the way
the difficulty demands, and stop at a random clue count in the difficulty's range once the technique requirement holds.
Up to 40 attempts; if none meets the profile, the closest is returned (still unique and valid).

| Difficulty | Clue range | Must be solvable by | Must not be solvable by |
|---|---|---|---|
| Easy | 38-44 | naked singles | |
| Medium | 32-36 | singles (naked + hidden) | naked singles alone |
| Hard | 27-31 | singles | naked singles alone |
| Expert | 22-27 | (unique only) | singles |

Singles-solvable implies a unique solution; Expert is checked with `countSolutions(grid, 2) === 1`. Measured over 200
seeded puzzles per difficulty: Easy 37-44 clues (avg 40.4), Medium 30-36 (32.0), Hard 26-31 (28.6), Expert 24-28 (26.1),
all unique; Easy 200/200 naked-single solvable, Medium and Hard 200/200 singles-only and 0 naked-only, Expert 0 singles-only.
Generation takes about 0.2 ms (Easy) to 8 ms (Expert) on average, 70 ms worst case seen.

## Layout and accessibility

The board uses the largest cell size that fits: 7x3 cells with full grid lines (73x37) down to 2x1 cells (20x11), with
heavier lines and a subtle alternating tint for the 3x3 boxes. The HUD (title, difficulty, timer, hints, notes state,
clash count, remaining count per digit, status message) sits beside the board when 22+ columns remain, otherwise above
it. Below 20x13 the game prints "Needs at least 20x13".

Nothing depends on color: clues are bold and entries are plain; the cursor is reverse video with `[ ]` brackets; conflicts
carry `!`; matching digits are underlined; notes mode is spelled out ("Notes ON"); notes show as small digits (or a dot in
tiny cells); remaining digits are numbers with a check mark when complete. Safe Glyphs replace box-drawing with ASCII
(`#` and `=` for box lines, `:` and `-` for cell lines, `+` for joints), and the start menu draws the ASCII cat. Colors
come from `ArcadePalette` only. Reduced motion or effects off remove the entry pop, the glow, confetti and the celebration.

## Record schema (v1, `arcade.json` under `sudoku`)

```
{version: 1,
 bestTimes: {easy, medium, hard, expert: seconds},
 completed, completedByDifficulty: {easy, medium, hard, expert}, streak, bestStreak,
 current?: {difficulty, puzzle: 81 chars ('0' empty), solution: 81 chars, entries: 81 chars (player digits only),
            notes: 81 numbers (9-bit masks), elapsedMs, hints}}
```

No timestamps. `readRecord` validates every field; `current` is dropped silently unless the lengths and alphabets are
right, the solution is a valid complete grid, the clues match it, the puzzle has exactly one solution, entries and notes
avoid clue cells and filled cells, the numbers are bounded integers, and the grid is not already finished. An unknown
`version` is ignored. The puzzle is saved on `pause()`, `persist()`, the menu key and when a puzzle starts; finishing
clears it, and a finished or `over` state is never written. The streak counts puzzles finished in a row; starting a new
puzzle while the saved one has progress ends it (restart and hints do not). A best time is recorded only for a win with
no hints, and the first such win at a difficulty counts.

## Tests

`tests/arcadeSudokuLogic.test.ts`: solver counts and agreement; 200 seeded puzzles per difficulty are unique, valid, within
their clue range and obey the technique profile; determinism per seed; clue immutability; notes behavior; undo/redo round
trip; conflicts; hints never change clues or the stored solution, are counted and undoable; restart; record round trip
through the store's `cleanRecord`; a dozen corrupt records discarded; best-time and streak rules.
`tests/arcadeSudokuGame.test.ts`: menu and keys, timer and pause (board hidden), restart versus new game, completion
(celebration, result, record, saved puzzle cleared), reduced motion/effects off, confetti, streak, Continue across
sessions (in memory and through the real store), corrupt saves, layout sweep 20x8 to 200x60 (rows within width, board
inside the canvas, all clues visible or the "Needs at least" note), HUD contents, NO_COLOR and Safe Glyph encodings, a render
time bound, and a pass through `ArcadeSession` (pause, resume, win to the result card). These tests do not replace play.

## Limits

No puzzle sharing or entering a puzzle by hand; techniques beyond singles are not explained by hints; the difficulty is
graded by clue count and the weakest sufficient technique, not by a full human-style rating. The completion confetti is
drawn over the board for under two seconds. Real terminals, text sizing and long play sessions still need physical checks.
