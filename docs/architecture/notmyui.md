# notMyUI: internal presentation and interaction toolkit

Internal to NMSh (not a published package). It exists only for NMSh-owned surfaces; raw PTY output, archived command output and `/copy` are never interpreted or recolored by it. The selected real shell stays authoritative.

## Primitives and their consumers

| Primitive | Module | What it owns | Real consumers |
| --- | --- | --- | --- |
| Deterministic clock | `presentation/environment` | `NMSH_DETERMINISTIC`, `NMSH_REDUCED_MOTION` display seams | completion time, shimmer phase, welcome blink |
| Capability | `presentation/capabilities` | color level: none / 16 / 256 / truecolor | `chroma/escape`, `ui/palette` |
| Chroma | `chroma/chroma`, `chroma/escape` | which color a cell gets: status / theme / identity roles, gradients, curves, fallback | palette helpers, shimmer, Settings status tones, surfaces |
| Actions | `ui/actions` | identity, label, key, enabled state; derived footers | command palette, layout/syntax/transcript panels |
| Form controls | `ui/formControls` | toggle, select, multi-select, text field, confirmation as proposals | Settings rows, Settings search |
| Surfaces | `ui/surface` | frame, fill, padding, inset, width, alignment | `framePanel` (all panels) |
| Shared clock | `motion/PresentationClock` | visibility-aware animation subscriptions | Chroma, cursor, live activity, previews and screensavers |
| Language identity | `languages/linguistLanguageColors` | vendored Linguist language colors | toolchain language identity |
| Focus | `ui/palette`, `ui/PanelShell` | bold accent labels, tab/focus bands; checked markers are separate | settings, pickers, providers, tools, setup |
| Motion | `motion/motion` | semantic motion profiles, sampled purely | shimmer |
| Authored Markdown | `help/markdown` | branded, NMSh-owned content only | `/help` |
| Settings v2 | `ui/SettingsPanel` | simple/advanced rows, changed marker, reset | `/settings` Config |

Boundaries: Chroma decides color; surfaces and layout decide where cells are; controls report proposals and the feature layer persists; motion yields intensities and owns no timers.

## Not built (no consumer yet)

User-remappable bindings remain future work. Shared animation scheduling, Linguist language colors, transient effects, terminal color capability detection and persisted Reduced Motion are implemented. See `motion/PresentationClock`, `languages/linguistLanguageColors`, `motion/` and `presentation/capabilities`.

## Acceptance

See `docs/accessibility/baseline.md` for accessibility criteria and known gaps.

## v0.7 physical QA record

The v0.7 physical QA pass was completed before release. The items below record the tested areas and known limitations; screen-reader behavior remains unverified.

- Ghostty and Terminal.app: `/settings` Config: `A` advanced, `/` search, `R` reset, changed `•` marker, remembered position after Esc and reopen.
- Narrow widths (about 24 to 40 columns) for Settings, palette and `/help`.
- `NO_COLOR=1`: panels stay legible; focus, changed and status cues remain visible; command-row bands (known gap).
- `NMSH_COLOR=256` on a 256-color terminal: palette looks acceptable.
- `NMSH_REDUCED_MOTION=1`: running-command shimmer and welcome blink stay still while the timer counts.
- `NMSH_DETERMINISTIC=1`: completion time and shimmer are stable across runs.
- `/help`: table, code fence and tips render in Ghostty and Terminal.app; safe-glyph mode (`NMSH_ICONS=safe`) shows ASCII.
- Command palette: footer hides Enter/↑↓ when no result matches; keyboard-only run and close.
- Passthrough transitions (vim, fzf) and Flow/Chat layouts unchanged; no motion or repaint artifacts after exit.
- Screen reader behavior is unverified and not promised.
