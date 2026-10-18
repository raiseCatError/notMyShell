# Context Rail composition

Presentation-only extension of [context-engine.md](context-engine.md). Facts,
field demand, capabilities, async collection/cache, routing and transcript
policy are unchanged. Implementation remains uncommitted pending review/physical QA.

## Model and defaults

Rows means one/two content rows. Independent controls: Relation (Vertical /
Right of Prompt), Direction (Follow Main / Forward / Mirrored), Integration
(Auto / Outside / Inside), Spacing (Attached / Gap / Spacious), Divider Anchor
(Prompt Level / Rail Level / Above Group), existing theme/style and Priority overflow.

New defaults: Auto, one row, Vertical, Follow Main direction, Outside, Gap,
Prompt Level, Follow Main theme/style, Priority. A saved Rail object with missing
spacing preserves the earlier Attached behavior; valid saved spacing and all
other fields remain intact. No versioned schema or duplicate Main geometry field.

Vertical Gap adds one blank row between Rail and Main; Spacious also adds a blank
row between two Rail rows. Right spacing reserves a minimum 0/1/4-cell gap from
the editor budget. Remaining slack keeps the independent Right Context anchor.
Spacing is a row/cell descriptor, never a module or fake third content row.

Mirrored uses the existing Powerline reflection painter, placing highest priority
nearest its right anchor. Text glyphs remain readable. Follow Main follows its
forward anchor; mirrorRight still belongs solely to independent Right Context.

## Horizontal-divider integration

**Inside never draws vertical sides, corners or a rectangular box.** NMSh's
existing Inside layout is `composerLayout: twoLine`, `placement: composer`,
with composerDividers enabled. Those settings mean content between horizontal
rules; they do not imply a box or an editor gutter.

Outside vertical Rail stays outside Main's existing pair of rules even when Main
uses Inside. Inside vertical Rail moves the relevant horizontal boundary outward
so Rail, explicit gaps, Main and input share the band. Prompt Level retains
Main's inline divider ownership plus a shared outer boundary; Rail Level aligns
the boundary/fill to Rail; Above Group owns a standalone full-width outer line.
For Top, the outward boundary faces below the composer/Rail group. Rows/spacing
and horizontal direction do not change the chosen vertical side.

Right Rail is a separate rectangle between Main/editor and independent far-right
context. Outside keeps Main's boundary width independent of the Rail rectangle;
Inside shares full-width horizontal boundaries. Prompt Level owns Main's fill;
Rail Level uses the existing upper edge as the prominent Rail boundary; Above
Group retains a standalone upper line over the composition. Shell context remains
on its original Main/inline row, never duplicated into a secondary Rail row.

Two right rows align with Main/input; Rail Level with an existing standalone edge
uses that edge then Main. One-line Outside uses a secondary accessory row on the
transcript-facing side (above Bottom/Flow, below Top), keeping input anchored.
Explicit Inside on incompatible Main is a proposed two-line conversion, not a
silently applied one. Auto integrates only with already-compatible Main; otherwise
Outside. Dividers Off produces unframed Outside; explicit Inside can request their
activation through the confirmation below.

## Preview and consent

Pure `mainSupportsRailInside`, `railNeedsPromptConversion` and
`railPreviewConfiguration` derive compatibility and proposed geometry from existing
settings. Preview clones the draft and shows `Requires Main Prompt: Inside`.
Arrows never mutate draft Main geometry or either saved setting.

Save on incompatible explicit Native Rail Inside enters `railInsideConfirm`:
Change & Save / Cancel / Keep Current, initially Cancel. Consent applies the
previewed two-line/composer/dividers changes and Rail draft in one config save.
Escape/Cancel returns to the draft without saving; ordinary panel Escape discards
it. Already-compatible Main needs no extra confirmation. Inactive external-provider
Rail settings are retained without silently switching providers.

## Shared geometry, overflow and lifecycle

A pure planner supplies row descriptors and horizontal cell budgets. ScreenPlan
projects content/gap/boundary rows and right slots. One painter serves live and
Current/Showcase preview; Current uses real routed facts, Showcase synthetic facts
without stealing Main/Right routes. Styling uses existing semantic themes,
NO_COLOR, safe glyphs and Chroma clock; there is no new timer or color system.

The editor uses its actual right-side budget without box gutters. Priority fitting
compacts/drops lower context before compromising input or overlapping Right Context.
Forced Right does not silently jump vertical. Bottom/Top remain anchored. Flow
consumes view space first; empty/short Flow shifts only by missing actual group
height, including spacing/boundaries. Growing transcript restores anchoring.
Detached clipping does not change measured PTY capacity. Optional spacing/decoration
yields at tiny heights; raw/fullscreen and panel takeover remove Rail chrome.
Nothing is added to PTY output, transcripts or copy.

## Review evidence

Tests cover no vertical border cells, all anchors/relations, old/new defaults,
priority/mirroring, narrow widths, Main consent/save/cancel/reopen and proposed
Current/result parity, live/preview parity, multiline cursor, Flow transitions,
resize/detach, NO_COLOR/safe glyphs, raw passthrough and renderer purity. Physical
original Bottom rendering was user-confirmed; this horizontal-only refinement
remains PENDING physical retest. Historical lifecycle investigation is untouched.
