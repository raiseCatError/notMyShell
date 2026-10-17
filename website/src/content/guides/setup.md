---
title: Setup and first run
description: Choose a starting point, review the changes and return to setup whenever you need it.
group: Start here
order: 2.5
sources: [src/setup/SetupCat.ts, src/setup/startup/startingPoints.ts, src/setup/startup/view.ts, src/app/TerminalApp.ts, docs/testing/post-v020-preferences-onboarding.md, docs/testing/first-run-window-maximization.md]
---

## Choose how NMSh starts

The first-run selector offers four starting points. Highlighting one previews a
draft; it does not apply that configuration. Enter opens a review before Apply.

| Starting point | What it does |
| --- | --- |
| NMSh Recommended | Lavender Native presentation, richer motion and a Chat transcript |
| Minimal Terminal | A quiet Native Minimal prompt, Flow placement and no decorative motion |
| Customize Everything | Guided setup over your current configuration, with review before saving |
| Keep Existing | Read-only environment detection to preserve your prompt and existing setup |

Up and Down move between choices; 1–4 jump to a choice without applying it. Enter
reviews it, then Enter applies the reviewed draft. Customize instead opens the
guided wizard. For Minimal, Left/Right or Tab
switches the One-line/Two-line choice; it starts at Two-line. Esc opens a leave
confirmation with **Stay** selected first.

Keep Existing distinguishes detected evidence from assumptions. If the prompt choice
is ambiguous, review the offered provider options rather than assuming every shell
customization can be inferred. On an already configured installation it preserves
saved settings without re-detection unless you explicitly request it with R.

## Reactive Horizon

The selector places the choices below an Aurora sky whose mood follows the highlight.
Vespyr is composited on the horizon with transparent surrounding cells. Wider terminals
have room for the choice details; smaller layouts adapt rather than requiring a
particular window size.

A cycles the saved backdrop preference through Aurora, Subtle and Off. This backdrop
choice saves immediately, unlike the configuration draft waiting for Apply. Reduced
Motion and color/glyph capability gates still apply. Applying folds the sky away and
brings the real composer into place; reduced motion goes directly to the settled view.
The transition does not run a demonstration command or simulate shell output.

The first-run introduction is remembered separately from setup completion. Attaching
to a session and explicit setup entry points do not replay installation onboarding.
A failed configuration save keeps the draft and reports the error.

On supported, verified local host windows, a genuine first run can offer temporary
maximization: M accepts, K keeps the current size. It never happens automatically,
does not edit terminal configuration and is not a dependency of onboarding. Unsupported
hosts, remote sessions and uncertain window ownership keep the ordinary layout.
The adapters target Terminal.app and socket-enabled kitty on macOS, plus supported
Hyprland/Lua setups on Linux. macOS Ghostty, editor terminals, SSH, multiplexers and
WSL do not receive this offer. Actual maximize/restore behavior still needs physical
acceptance; unit fixtures are not evidence of a tested desktop interaction.

## Return to the starting points

Use `/startup`, `/setup quick` or Settings → Starting point to reopen the selector.
Use `/setup` to enter the guided wizard directly. Its visual steps follow
**Look → Prompt → Motion → Cursor**, and it reviews changes before saving them.

## Revisit a specific area

| Action | Opens |
| --- | --- |
| `/setup` | Guided setup using your current saved choices |
| `/startup` or `/setup quick` | Starting-point selector |
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

The [launch baseline](/releases/#launch-baseline) identifies the exact public code
these instructions describe. [First-run behavior and validation](/docs/reference/onboarding/)
records its defaults and remaining acceptance work. [Learn Mode](/learn/) is separate:
it remains a future learning proposal, not part of setup.
