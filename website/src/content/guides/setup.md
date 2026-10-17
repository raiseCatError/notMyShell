---
title: Setup and first run
description: Review your initial preferences and revisit setup without discarding existing choices.
group: Start here
order: 2.5
sources: [src/setup/SetupCat.ts, src/app/TerminalApp.ts, tests/setupCat.test.ts, tests/setupOrder.test.ts]
---

## Start with a reviewable setup

The documented candidate opens Setup Cat on first run. It guides you through
terminal behavior, appearance, prompt, motion, cursor, editor and transcript choices,
then presents Review & Apply. Changes are drafted before they are saved.

The visual steps follow **Look → Prompt → Motion → Cursor**, so the theme and prompt
are in place before you choose their motion and cursor behavior. You can return to
setup later without starting from empty preferences.

## Revisit a specific area

| Action | Opens |
| --- | --- |
| `/setup` | Guided setup using your current saved choices |
| `/setup look` | Theme, frontend chrome and Chroma |
| `/setup prompt` | Prompt provider and style |
| `/setup motion` | Reduced motion and visual effects |
| `/setup cursor` | Cursor shape, effects and colors |
| `/setup syntax` | Editor, syntax colors and suggestions |
| `/setup transcript` | Transcript colors, dividers and folding |
| `/setup tools` | Optional tools and installation suggestions |

Opening setup is not permission to install every detected tool or rewrite your
shell configuration. Review individual changes and installation plans. Use
`/settings` for the general preferences surface, or a focused studio such as
`/theme`, `/layout` or `/strip`.

## First-run launch integration

The v0.20 launch is intended to include the approved Reactive Horizon onboarding.
Its selection-reactive Aurora, Vespyr transparency and transition into the composer
are still awaiting final integration into the public source checkpoint used here.
This guide deliberately does not invent their final controls or defaults.

The [launch baseline](/releases/#launch-baseline) identifies the exact code these
instructions describe. Once onboarding is integrated and verified, this section
will be replaced with its actual first-run flow. [Learn Mode](/learn/) is separate:
it remains a future learning proposal, not part of setup.
