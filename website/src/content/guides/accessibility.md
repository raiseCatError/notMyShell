---
title: Accessibility
description: Reduced motion, safe glyphs, color controls and known assistive-technology limits.
group: Understand the system
order: 14
sources: [docs/accessibility/baseline.md, README.md]
---

## Choose quieter presentation

NMSh-owned surfaces support reduced motion, safe glyphs and color controls.
These affect frontend presentation, not arbitrary output written by your programs.

```sh
NMSH_REDUCED_MOTION=1 NMSH_ICONS=safe nmsh
```

`NMSH_REDUCED_MOTION=1` holds decorative motion still while durations continue to
count. `NMSH_ICONS=safe` requests ASCII-safe glyphs when fonts or character widths
make decorative symbols unreliable.

## Color controls

| Environment | Effect |
| --- | --- |
| Non-empty `NO_COLOR` | Suppress NMSh-generated color escapes |
| `TERM=dumb` | Also suppress NMSh-generated color escapes |
| `NMSH_COLOR=none` | Explicit no-color override |
| `NMSH_COLOR=256` | Explicit xterm 256-color mapping |
| `NMSH_COLOR=truecolor` | Explicit full-color override |

The explicit `NMSH_COLOR` choice wins over `NO_COLOR` and `TERM`. Bold, inverse
and glyphs can remain without color. The canonical baseline includes known gaps,
including command-row cues that still depend partly on color.

## Keyboard and terminal behavior

NMSh actions are intended to remain keyboard reachable. Mouse interaction adds
shortcuts, not a second required input path. The host must forward the relevant
key combinations; Ctrl+J is the fallback when Shift+Enter is unavailable.

## Screen readers: not a guarantee

NMSh redraws alternate-screen terminal frames. Screen-reader behavior depends on
the terminal and assistive technology and has not been verified. Text-carried
state is useful, but **does not establish full screen-reader accessibility**.

This website separately provides semantic HTML, keyboard navigation, local search,
light/dark themes and reduced-motion styling. Website accessibility does not imply
the terminal application has the same assistive-technology support.
