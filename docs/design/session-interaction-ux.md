# Session & Interaction UX

**Milestone:** v0.3.0 — Session & Interaction UX

## Goal

Improve routine interaction with NMSh through a safe return to ordinary zsh, configurable context presentation, manageable large text pastes, persistent local transcripts, and first-run setup. NMSh remains a frontend over one persistent real shell.

## Safe shell transition

`/zsh` exits the NMSh frontend and hands the same terminal window to a real interactive zsh. It preserves cwd when practical, while making no promise to preserve shell-local state, jobs, or the hidden managed shell's runtime. Terminal modes owned by NMSh must be restored before handoff. An active foreground command must finish or be interrupted before transition. A managed-shell marker prevents recursive NMSh startup; it must not leak into the ordinary zsh handed to the user.

## Context modules and placement

Implement context modules once and render the same ordered module list in configurable placements. Header separator placement is the default. The other primary placement puts context on its own line inside the composer, above the input line; a below-input placement may be supported where inexpensive. Configuration covers order, visibility, separators, spacing, colors, and conditions. Initial modules are cwd, git branch, and previous exit status. Preserve NMSh's Powerline-style visual identity; do not delegate this layer to Starship or Powerlevel10k.

The first configurable implementation reads `config.json` from `~/Library/Application Support/notMyShell/` on macOS (or `$XDG_CONFIG_HOME/nmsh/` when set). Missing or invalid settings fall back to defaults. Settings are edited as JSON until onboarding adds a setup UI. The same local application directory is reserved for later transcript state.

The JSON configuration keeps ordered module definitions with `id`, `visible`, `condition`, and optional six-digit hex foreground/background colors. Top-level `placement`, `separator`, and `spacing` control the shared layout. For example:

```json
{
  "placement": "header",
  "separator": "",
  "spacing": 1,
  "modules": [
    { "id": "project", "visible": true, "condition": "always" },
    { "id": "cwd", "visible": true, "condition": "always" },
    { "id": "gitBranch", "visible": true, "condition": "inRepository" },
    { "id": "exitStatus", "visible": true, "condition": "nonzeroExit" }
  ]
}
```

## Rich text paste

Large multiline text-only pastes appear as one editable logical atom. Small pastes remain ordinary text. Cursor movement and adjacent deletion treat an atom as one unit; Ctrl+O unwraps the atom beside the caret back into editable source. NMSh blocks submission while any atom is folded, so the visual label can never be mistaken for executable input. Once unwrapped, submission uses the original pasted source. Bracketed paste and multiline submission remain supported. Image clipboard behavior is out of scope.

## Local transcript sessions

`/clear` archives the current NMSh transcript locally, clears its visible presentation, and starts a new presentation session while retaining the same live zsh. It does not normally reset cwd/environment, kill zsh or jobs, or delete the archived transcript. While a foreground command is running, `/clear` is refused so its transcript is not detached from active execution. `/resume` offers a keyboard-friendly archive picker and restores transcript history without rewinding real shell state; if the current presentation is non-empty, NMSh archives it before switching views. Archives live under `~/Library/Application Support/notMyShell/sessions/` on macOS (or `$XDG_CONFIG_HOME/nmsh/sessions/` when set), use schema version 1 JSON, and are written with mode `0600` in a mode `0700` directory to a synced temporary file before atomic rename and directory sync. They retain structured command/raw-text records and styled terminal cells, not ANSI-only output. Corrupt and unsupported-version archives are left untouched and omitted from the picker. Data is local-only, with no cloud, telemetry, model API, AI summary, or automatic destructive pruning. A temporary file left by a crash is ignored; the final archive is either present after atomic rename or absent.

Both `/clear` and `/resume` wait until the foreground command has finished or been interrupted; neither is sent as input to a running command.

## Onboarding

Onboarding configures supported NMSh choices; it does not invent launcher mechanisms. It can be skipped, records completion persistently, and offers placement previews, basic module selection, host/setup guidance, keyboard forwarding help, appearance guidance, and an autostart preference where the established startup mechanism supports it. It does not run on every launch.

## Dependencies and non-goals

- Safe shell/startup behavior precedes onboarding's autostart setting.
- Onboarding's module and placement configuration depends on the context system.
- Rich paste and transcript persistence are otherwise independent interaction features.
- TerminalHost architecture (#10–#13), platform support, ShellAdapter research, broad compatibility/polish (#20), and unrelated future work are outside this milestone unless a narrow implementation dependency proves necessary.
- No shell-state time travel, chat-composer behavior, image paste, or replacement of NMSh presentation with Starship/Powerlevel10k.
