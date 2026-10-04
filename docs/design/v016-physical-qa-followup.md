# v0.16 physical-QA follow-up

Findings from a real Ghostty window (transparent and frosted) and what changed.
Behavior here is covered by automated tests; the physical checklist is in
[../testing/v016-physical-qa.md](../testing/v016-physical-qa.md).

## One rule for motion: keep the host's background

SGR has no per-cell alpha, so any cell background is an opaque box on a
transparent terminal, and mixing with a hard-coded near-black only makes that
box darker. Motion and cursor effects therefore never paint a background behind
text (`src/presentation/cellOverlay.ts`):

- a **text cell** may only shift its own foreground toward a color (`tint`),
  add `dim`, `bold` or `underline`; the glyph never changes;
- a **blank cell** may draw a glyph in a foreground color (trail shading, ripple
  rings, particles, the Bar/Underline caret);
- only the **visual caret** (`caret` + `caretShape`) fills a cell, and only a
  Block does.

Transitions (`src/motion/transitions.ts`): context changes dim the not-yet-revealed
part of a changed module and tint a moving front; command launch tints the
command and the rule; completion highlight underlines and tints only the inserted
range; Block Seal and Semantic Echo tint the header or rule in the outcome color.
The live frame and every preview call the same `transitionPaint` functions.
Reduced Motion, Decorative Effects Off, NO_COLOR, Safe glyphs, 256-color and
truecolor are unchanged (colors go through `colorEscape`, so the capability level
applies).

The Motion preview's context fixture keeps one module unchanged
(`before ~/project main Node 22` → `after ~/src feature/theme Node 22`): only cwd
and branch are painted. The hub drops the intro, then the preview, before it
clips the list or the controls on a short terminal.

## Cursor

**Capability matrix** (`src/cursor/backends.ts`): a feature is listed only when the
implementation draws that named thing.

| | Motion | Effect | Idle effect |
|---|---|---|---|
| Portable | Smooth, Smear, Tail | Fire, Sparks, Lightning, Railgun, Ripple, Wireframe | Glow, Embers, Flame, Sparks |
| Ghostty native | Smear, Tail | Fire, Sparks, Ripple | none |
| Kitty native | Tail | none | none |

`availabilityOf` answers per value under the effective renderer: Portable and Auto
offer everything Portable draws; Auto labels `Lightning · Portable fallback` when a
native backend is active but does not draw it; forced Host native offers only what
the host draws and otherwise shows `Unavailable` with the reason (for example
`Ghostty Native does not provide this idle effect.`), with no arrows and no cycling.
A forced host renderer where the host has none draws nothing and says so. The same
rows serve /cursor, Settings and Setup (`CURSOR_ROWS`). Defaults stay Motion Off,
Effect None, Idle Off, Renderer Auto.

**Shape and blink** apply to the live renderer in the configuration setter, so
Settings, Setup, /cursor and imports all take effect immediately. Blink needs an
explicit shape (Host default keeps the terminal's cursor and sends nothing).

**Preview** (`src/cursor/CursorPreview.ts`): finite, replayable (R), a pure function of
(settings, elapsed), fixed height. It demonstrates the selected row: the synthetic
caret in the real shape (Block fills, Bar and Underline draw thin glyphs, Host default
is a labelled placeholder), blink for a few seconds then steady, the engine through a
scripted jump for motion/effect/color/level rows, and the idle effect settling in.
Selecting, changing a value and R restart it; the frame clock stops when it settles.

**Color** (`src/cursor/colors.ts`): Follow current theme (stored as `theme`), Choose
theme (`chosen`, with `theme` and a Catppuccin `themeAccent`), NMSh accent, Host,
Custom. Theme colors come from `themeAccentColor` over the one theme system and are
resolved before they reach the engine, the preview, the Ghostty shader or the Kitty
fragment. Custom opens the shared color picker (validated #RRGGBB, nothing kept until
Enter); trail and particle colors (Follow / Custom / Gradient) live under Advanced and
reuse the picker and the gradient editor. Saved values are preserved; `chosen` and
its fields appear only when set.

**Native refresh** (`src/cursor/native.ts`): managed files are rewritten only when their
content changes, only NMSh's own fragment and shader, and only when the host
integration is already set up (also when the theme changes under Follow current theme).
The message is `Reload Ghostty config: ⌘⇧,` (Kitty: `⌃⌘,`; Linux: `Ctrl+Shift+,` /
`Ctrl+Shift+F5`). A shader-only change says the shader was updated and what to do if
it does not apply. NMSh never restarts the terminal and never signals a process.

## Paste Review

The compact strip above the composer stays compact (header, up to four source lines,
two lines of classifications, a hint). `R` opens a bounded, scrollable review
(`src/input/PasteReview.ts`) over the same screen as other panels: fixed height, exact
source with each command's classification beside the line it starts on, control
characters shown visibly, thousands of lines supported. Enter inserts the original
text (nothing runs), Esc returns, and a screen too short for the strip goes straight
to the review. Classification (`src/input/pasteGuard.ts`) is deterministic and local:
plain text, unrecognized shell input, read-only (including `git rev-parse`, `--version`,
`nmsh --version`), navigation, project script (`npm run build`, `make`, `./x`), network,
installs packages, modifies files, destructive, privilege, downloaded-code pipeline.
Ordinary prose is `pasted · text · N lines`, never "command".

## Session notices are events

Visibility is separate from retention (`src/session/SessionNotices.ts`). A success
shows ~12 s, a normal session end ~20 s, a failure or abnormal end ~45 s, a long-running
threshold ~10 s once; an agent asking for attention is sticky until it is focused or
replaced. Expiry is applied on every poll, at render time, and by a timer set for the
next expiry. /sessions, /resume and agent views own the history.

## Setup is the complete entry point

Every `SETTINGS_ROWS` entry is in a Setup section or mapped in `SETUP_EQUIVALENTS` to its
route; every Settings entry point maps in `SETUP_ENTRY_COVERAGE`; both are enforced by
`tests/setupCoverage.test.ts`. New Setup steps: Cursor, Motion, Sessions & alerts; Editor
gained syntax colors (mode, family, variant, accent) and paste preview; Prompt adapts the
Native style's own fields from `/prompt` (`appearanceRows`) so there is one logic;
Appearance gained the remaining Chroma rows. Editors Setup does not embed are labelled
routes that apply the draft first. The /cursor panel opens inside Setup over the draft
(Esc returns; nothing saves until Apply). Local understanding is Auto by default and its
Setup copy says what that means.

## Final polish before the v0.16 freeze

**Motion rendering: Clean and Rich.** One event system (`Transitions`: launch, completion
highlight, Block Seal, Semantic Echo, context morph) feeds either renderer; each transition
carries the look it was started with. *Clean* is the transparent-safe renderer above. *Rich* is
the filled-band look recovered from `4b04351` (`src/motion/transitions.ts` as of that commit:
`sweepCells`, `decayCells`, `morphCells` and the `transitionPaint` strengths), now `richSweepCells`,
`richDecayCells` and `richMorphCells` with the same blend against the same dark base, drawn as a
`fill` that only Rich sets. Persisted as `motion.rendering` (`clean` default; configs saved before
it existed stay Clean) and `motion.tuning.{clean,rich}.{intensity,speed}`; each rendering keeps its own
tuning when you switch. Intensity scales how strong the paint is, speed scales how long each effect
lasts (Normal is each renderer's baseline, so Rich starts exactly as the old look). Rendering and
the five effect choices are in `/appearance` → Motion, Settings and Setup from one table
(`src/motion/motionRows.ts`); Advanced (in `/appearance`) edits the selected rendering's tuning.
Reduced Motion, Decorative Effects Off and NO_COLOR gate both. The portable cursor engine stays
transparent-safe whichever rendering is chosen.

**Cursor effects** (all in `CursorEngine`, the same code the preview runs): Smear is a solid band of
shading, Tail a comet of shrinking dots, Smooth no trail; Fire is flame glyphs that climb and
wobble; Sparks are sparse twinkling points thrown sideways; Lightning is a jagged bolt of slanted
segments with forks that strikes twice; Railgun is one straight heavy beam with a flash where it
lands; Ripple is a wave with a crest on each side; Wireframe is a bracket around the travelled span.
Idle: Glow breathes beside the caret, Embers drift as soft dots, Flame climbs, Sparks twinkle.
Particle gravity was in the wrong units, which threw particles out of the input rows at once; it is
now a real acceleration. Glyphs show on blank cells (including spaces and past the end of the line);
over text the effect tints the glyph.

**Cursor color on Zed.** "Cursor color" colors NMSh's own effects, trails and previews (and, once
set up, Ghostty's shader or Kitty's trail). NMSh sends no terminal cursor-color sequence on any host,
so the physical caret keeps the host's color. Zed's terminal paints the caret from the active
theme's cursor color (`theme.players().local().cursor` in `terminal_element.rs`) and does not use a
terminal's dynamic cursor color, so an OSC 12 sequence would not help there. `HostCursorFacts`
records `caretColor: 'theme-controlled'` for Zed and `'host-controlled'` elsewhere, and the
Cursor color row, Setup and `/cursor` say so.

**Config** is grouped into General, Appearance, Prompt & Composer, Editor, Cursor & Motion,
Sessions & Alerts, Shell & Providers, Local Understanding and Transcript & Privacy. A row's group
comes from its root parent, then an explicit id, then its category (`CONFIG_GROUP_BY_ID`,
`CONFIG_GROUP_BY_CATEGORY`); the order inside a group is `CONFIG_ORDER`. Headings are display lines
(`src/ui/groupedList.ts`, shared with Status): never selectable, never in the selection index, never
orphaned at the bottom of the viewport; search keeps only the headings that still have a match;
Advanced rows appear inside their group. The selected row's description gets its own two lines
whenever the list keeps a useful size.

**Status** is grouped into Build & Platform, Shell & Session, Terminal, Local Understanding, NMSh &
Providers, Shell Environment, Services & Activity and Storage with the same facts as before.
Sections are still plain item arrays with a `title`, `statusLineCount` counts headings and the
blank lines between sections, and a viewport never ends on a heading.
