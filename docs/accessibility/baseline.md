# Accessibility and reduced-presentation baseline

This applies to NMSh-owned surfaces only: panels, the composer, status rows, help and the transcript chrome. Raw PTY output, archived command output and `/copy` are never restyled.

Accessibility flows through the shared primitives (`ui/palette`, `ui/glyphs`, `ui/actions`, `ui/formControls`, `presentation/environment`), not a separate renderer.

## Controls

| Setting | Effect |
| --- | --- |
| `NO_COLOR=1` (non-empty) or `TERM=dumb` | `foreground()`/`background()` emit nothing. Bold, inverse and glyphs remain. |
| `NMSH_COLOR=none` / `256` / `truecolor` | Explicit override, wins over `NO_COLOR`/`TERM`. `256` maps NMSh colors to the xterm 256 palette. |
| `NMSH_ICONS=safe` | ASCII-safe glyph set (existing). |
| `NMSH_REDUCED_MOTION=1` | Shimmer/activity glyph phase and the welcome blink stay still. Durations keep counting. Deterministic presentation implies it. |

These are environment controls. A persisted setting would change the public configuration schema and is left to the Settings work.

## Acceptance criteria

1. Every action is reachable by keyboard; the pointer only adds shortcuts (`ui/actions`).
2. The focused row is identifiable without color: a pointer glyph (`›`, or `>` in safe mode) or `>` in plain form controls.
3. Changed and error states are text (`(changed)`, `Error: ...`), not color alone (`ui/formControls`).
4. Success/failure rows carry distinct glyphs (`✔`/`✘`, or `+`/`x` in safe mode) in addition to color.
5. With `NO_COLOR`, no NMSh-generated color escape is written; layout is unchanged.
6. With reduced motion, no NMSh-owned decoration changes between frames unless state changes.
7. No width-changing animation.

## Audit result

- Met: keyboard operation in palette, Settings, draft panels; pointer-free navigation; safe glyph set; status glyphs; footer help derived from actions.
- Known gaps: command-row background bands (`TranscriptPresenter`) are a color-only cue for "this is a command" under `NO_COLOR`; the prompt prefix is the remaining cue. Provider panels (prompt, welcome, suggestions) keep hand-written footers.
- Not supported: automatic 256-color detection (only explicit `NMSH_COLOR=256`), 16-color output, and a persisted reduced-motion setting.

## Screen readers

NMSh redraws full-screen frames in the alternate screen. Terminals expose that to assistive technology inconsistently, so NMSh cannot guarantee screen-reader-friendly output. What it does provide is text-carried state and no pointer requirement; behavior with a specific terminal and reader has not been verified.
