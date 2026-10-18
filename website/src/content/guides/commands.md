---
title: Command reference
description: Find frontend actions by purpose, with links to deeper guides.
group: Understand the system
order: 18
sources: [README.md, src/commands/slashCommands.ts]
---

This is a map of common actions in v0.20.0, not a replacement for the generated
`/help` in your installed version. A slash action controls NMSh; ordinary programs
and absolute executable paths still run in your real shell.

## Interaction and sessions

| Action | Purpose |
| --- | --- |
| `/help`, `/palette` | Browse available actions |
| `/layout` (`/composer`) | Composer placement and layout |
| `/syntax`, `/cursor` | Input presentation |
| `/transcript` | Transcript settings |
| `/history`, `/find`, `/filter`, `/copy` | Recall, inspect, narrow and copy |
| `/actions`, `/compare` | Act on completed output and compare results |
| `/queue`, `/pause`, `/qr`, `/qc` | Serial execution, pause and reviewed resume/clear |
| `/background` (`/bg`) | Separate session-owned background tasks |
| `/pins`, `/clips`, `/ps` | Kept commands, in-memory clips and reviewed clipboard paste |
| `/resume`, `/sessions` | Session navigation |
| `/shell` | Switch supported shell backend |
| `/zsh`, `/exit` | Hand off to an ordinary shell |

## Preferences and appearance

| Action | Purpose |
| --- | --- |
| `/settings` (`/config`), `/setup`, `/startup` | Preferences, guided setup and starting points |
| `/prompt`, `/modules` | Prompt providers and native modules |
| `/appearance`, `/theme`, `/theme-bridge` | Appearance, palettes and opt-in tool themes |
| `/chroma`, `/motion`, `/glyphs`, `/chrome` | Frontend presentation controls |
| `/strip`, `/screensaver` | Status Strip and idle presentation |

## Tools and control

| Action | Purpose |
| --- | --- |
| `/tools`, `/providers`, `/integrations` | Optional tooling and provider health |
| `/configure`, `/tmux`, `/dotfiles` | Reviewed configuration workflows |
| `/claude`, `/ai`, `/mods` | Managed Claude Code, agent surfaces and mod inventory |
| `/worktrees` | Worktree inventory and explicit management plans |
| `/sidebar`, `/panel`, `/keys` | Opt-in experimental workspace regions and bindings |
| `/github` (`/prs`, `/issues`) | Read-only GitHub workspace |
| `/zoomies` (`/awake`, `/caffeinate`) | Keep Awake |
| `/btw` (`/ask`) | Local typed-action guidance |
| `/status`, `/doctor`, `/update` | Status, diagnostics and update plan |

## CLI entry points

```sh
nmsh --version
nmsh --sessions
nmsh doctor
nmsh config export --output nmsh-settings.json
```

Context Packs are managed through `nmsh packs`; refer to the
[pack reference](/docs/reference/context-modules/) for the format and safety model.
