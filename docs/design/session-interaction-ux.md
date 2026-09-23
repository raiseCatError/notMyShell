# Session & Interaction UX

**Milestone:** v0.3.0 — Session & Interaction UX

## Goal

Improve routine interaction with NMSh through a safe return to ordinary zsh, configurable context presentation, manageable large text pastes, persistent local transcripts, and first-run setup. NMSh remains a frontend over one persistent real shell.

## Safe shell transition

`/zsh` exits the NMSh frontend and hands the same terminal window to a real interactive zsh. It preserves cwd when practical, while making no promise to preserve shell-local state, jobs, or the hidden managed shell's runtime. Terminal modes owned by NMSh must be restored before handoff. An active foreground command must finish or be interrupted before transition. A managed-shell marker prevents recursive NMSh startup; it must not leak into the ordinary zsh handed to the user.

## Context modules and placement

Implement context modules once and render the same ordered module list in configurable placements. Header separator placement is the default. The other primary placement puts context on its own line inside the composer, above the input line; a below-input placement may be supported where inexpensive. Configuration covers order, visibility, separators, spacing, colors, and conditions. Initial modules are cwd, git branch, and previous exit status. Preserve NMSh's Powerline-style visual identity; do not delegate this layer to Starship or Powerlevel10k.

## Rich text paste

Large multiline text-only pastes may appear as one editable logical atom. Small pastes remain ordinary text. Cursor movement and adjacent deletion treat an atom as one unit; unwrap restores its original editable source. Submission uses the exact pasted source, never the visual label. Bracketed paste and multiline submission remain supported. Image clipboard behavior is out of scope.

## Local transcript sessions

`/clear` archives the current NMSh transcript locally, clears its visible presentation, and starts a new presentation session while retaining the same live zsh. It does not normally reset cwd/environment, kill zsh or jobs, or delete the archived transcript. `/resume` offers a keyboard-friendly archive picker and restores transcript history without rewinding real shell state. Store versioned logical/raw data resiliently on-device, with deterministic metadata and no cloud, telemetry, model API, AI summary, or automatic destructive pruning.

## Onboarding

Onboarding configures supported NMSh choices; it does not invent launcher mechanisms. It can be skipped, records completion persistently, and offers placement previews, basic module selection, host/setup guidance, keyboard forwarding help, appearance guidance, and an autostart preference where the established startup mechanism supports it. It does not run on every launch.

## Dependencies and non-goals

- Safe shell/startup behavior precedes onboarding's autostart setting.
- Onboarding's module and placement configuration depends on the context system.
- Rich paste and transcript persistence are otherwise independent interaction features.
- TerminalHost architecture (#10–#13), platform support, ShellAdapter research, broad compatibility/polish (#20), and unrelated future work are outside this milestone unless a narrow implementation dependency proves necessary.
- No shell-state time travel, chat-composer behavior, image paste, or replacement of NMSh presentation with Starship/Powerlevel10k.
