# Post-v0.20 preferences, setup and transcript polish

Base: `825336393562a37cb5cdf9baf916e8d6d3bb4e6d`.
Scope: canonical Recommended defaults, Minimal quick setup, shared Fire palettes,
completion folding and selected transcript surfaces. No release/version changes,
Slice 4 scrolling work, external installs or real-user configuration writes.

## Acceptance criteria

- Fresh configuration and explicit Recommended use NMSh/Lavender Native, theme
  text On, text tint Off, Lavender surface, standard vibrance, theme chrome,
  Chroma Off. Motion: Rich, Expressive context/events, Sweep launch, Vivid
  completion highlight, Seal completion, cursor travel On, Medium/Normal tuning;
  reduced motion Off, effects/shimmer/milestones On. Environment accessibility
  and color capability restrictions still win.
- Transcript: Chat, Full historical prompt snapshots, Grayscale history,
  divider On/Normal/Follow history, Smart folding. Queue summaries save by
  default, Detailed/center/left, durations and exit codes On, input waits Off;
  output display stays inline and failure policy Pause. Title uses session.
- Cursor: Auto, Follow theme, Fire; host shape/blink and idle Off. Fire/effect
  colors expose Purple, Blue, Green, Classic, Follow theme and Custom using
  existing particle colors/gradients and editor. Existing custom palettes survive.
  Ghostty uses managed shader only after setup; Auto falls back portably on
  other/unconfigured hosts; physical caret color remains host owned.
- Missing config receives Recommended. Saved objects missing new fields retain
  historical fallbacks; explicit/imported settings roundtrip. No duplicate
  persisted preset identity. Lavender surfaces affect Lavender Native only.
- Genuine first run and bare /setup show Recommended / Minimal / Manual.
  Quick selections preview a normalized draft and require explicit Apply,
  including a replacement warning for customized installations. Esc saves and
  runs nothing. Manual keeps every existing section/editor and direct route.
  Minimal uses native minimal style, Flow, Normal, snapshots Off, Chroma Off,
  effects Off, ordinary output and full shell/clipboard/queue safety.
- Smart foreground seq 1 450 folds on completion in FOLLOW absent inspection;
  head/tail, accurate hidden counts and Ctrl+O work. Never, queued provenance,
  detached/selected inspection, activities and failure visibility remain valid.
  Exact copy/search/report/export/restore retain all output and newline facts.
- Selected rows have continuous backgrounds across prompt wedges, explicit
  backgrounds, reset variants and SGR 49, preserving glyph widths, hit testing,
  syntax colors and original unselected rendering. Use semantic UI colors.

## Bounded implementation plan

1. Write and run failing regressions against production configuration, setup,
   TerminalApp completion, cursor palette and selection render boundaries.
   Capture existing selected rows before editing. Keep baseline failure logs.
2. Add canonical fresh Recommended values, explicit Minimal construction and
   legacy normalization coverage. Keep low-level legacy normalization defaults.
3. Add contextual Fire palette choices to the shared cursor editor and verify
   native generation, portable fallback and accessibility gates.
4. Reproduce folding through command submission/exec/data/prompt lifecycle;
   fix the proven cause without changing policy thresholds or queued output.
5. Repair shared selected-surface ANSI handling and test real production rows
   at 32/50/80 columns across themes, glyph/color modes and transcript layouts.
6. Add quick choice/review states to Setup Cat's existing draft/controller;
   defer optional-tool discovery to Manual. Preserve direct section routes.
7. Run affected tests, verify:fast, real available shell adapter PTY tests,
   verify:release; generate production renderer previews and a reusable T7 QA
   runner. One independent review, fix substantiated findings with regressions;
   at most three review passes total.
8. Update concise help and QA handoff, commit/push only the isolated branch,
   dispatch exact-head CI (macOS/Ubuntu/Node22/Fedora/timings). No merge/tag.

## Review focus

Legacy partial objects and imports; quick cancel/save failure and unknown fields;
unsupported native hosts and color suppression; ANSI resets/Powerline widths;
folding provenance/inspection and exact clipboard data; queue/modal/privacy and
session ownership. Physical Ghostty/Terminal.app behavior requires human QA.

## Evidence

Record red/green commands, root causes, review results, preview paths and physical
QA instructions in docs/testing/post-v020-preferences-onboarding.md.

## Accepted refinements

> **Superseded for first launch (2026-10-17):** the Reactive Horizon starting
> point in [first-run startup](first-run-startup.md) replaces the static modal
> described in the next two paragraphs. `introSeen`, `onboardingBackdrop`, the
> bypass rules and *Leave setup?* carry over (Stay is now focused first); the
> modal's design exploration is archived with that document.

First launch opens one static, centered setup modal in Setup Cat's existing
state; there is no introduction animation, playback or timer, and `introSeen`
persists separately from completion. Legacy objects without this marker count
as already seen, and a fresh install (`!onboardingComplete && !introSeen`) sees
the modal exactly once: keys act immediately, Esc opens a Leave setup?
confirmation (Continue is the default; Exit for now closes without applying),
and nothing auto-reopens afterwards. Explicit setup routes, attach/restore,
session creation and handoff never show it. Docs / bug / feature links are
explicit actions only and remain in /help.

The modal is a hand-rolled centered framed block (maximum 56 columns wide) over
a static deterministic aurora field (`onboardingBackdrop`: off, subtle or
aurora; default aurora; local presentation state, never exported). Block-fit
tiers use inner width and available height: narrow or short terminals get an
unframed TINY essential view instead of a cropped modal. Rendering is pure —
the same state renders the same rows at any time; nothing schedules a frame or
clock. The earlier animated introduction and selector engines
(`renderSetupIntro`, `SetupPreview.ts`) stay intact and tested as retained
presentation code, but the quick path never invokes them.

The three choices are NMSh Recommended, Minimal Terminal and Customize
Everything. Minimal offers One-line (default) / Two-line via Left/Right/Tab,
setting the real composerLayout with composer placement, Flow/Normal, no
snapshots or greetings; Enter reviews and Apply is explicit, with a replacement
warning for customized installations. Customize Everything opens the full
Setup Cat over the picker; cancelling the wizard returns to the picker without
closing setup. Bare /setup opens full Setup Cat; /setup quick opens the picker.
A concise status confirms application. Settings advertises preset choice.

The maintainer clarified the folding report was physical QA Test B: QUEUED
execution, not a paste or foreground command. Trace provenance, queue display
preference and completion holdOpen guards; foreground policy is out of scope
without contradictory evidence.
