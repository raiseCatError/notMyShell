# NMSh Roadmap

## Tracking

| | |
|---|---|
| **Current release** | [v0.2.0 — Structured Execution](https://github.com/raiseCatError/notMyShell/releases/tag/v0.2.0) |
| **Development branch** | `dev` |
| **Active milestone** | [v0.3.0 — Session & Interaction UX](https://github.com/raiseCatError/notMyShell/milestone/2) |
| **Project board** | [NMSh Development](https://github.com/users/raiseCatError/projects/1) |

GitHub issues define actionable work. Milestones group releases, the project board tracks work state, and [docs/design/](docs/design/) records durable product decisions.

## Released — v0.2.0 Structured Execution

[Milestone #1](https://github.com/raiseCatError/notMyShell/milestone/1) is closed and shipped. Its design record remains at [docs/design/structured-execution.md](docs/design/structured-execution.md), and release notes remain in [CHANGELOG.md](CHANGELOG.md).

## Now — v0.3.0 Session & Interaction UX

Improve NMSh's day-to-day interaction model: safe movement between NMSh and ordinary zsh, modular context customization, rich text-paste editing, persistent local transcript sessions, and first-run onboarding/configuration. Keep NMSh zsh-first and preserve the real persistent shell underneath.

**Design document:** [docs/design/session-interaction-ux.md](docs/design/session-interaction-ux.md)

| Order | Issue | Title |
|---:|---|---|
| 1 | [#36](https://github.com/raiseCatError/notMyShell/issues/36) | Safe `/zsh` escape and nested-NMSh prevention |
| 2 | [#8](https://github.com/raiseCatError/notMyShell/issues/8) | Modular NMSh prompt/context system |
| 3 | [#21](https://github.com/raiseCatError/notMyShell/issues/21) | Rich paste atoms for large multiline text |
| 4 | [#22](https://github.com/raiseCatError/notMyShell/issues/22) | Persistent local sessions: archive `/clear` history and resume with `/resume` |
| 5 | [#9](https://github.com/raiseCatError/notMyShell/issues/9) | First-run onboarding and appearance configuration |
| 6 | [#42](https://github.com/raiseCatError/notMyShell/issues/42) | Display sub-second command durations in milliseconds |
| 7 | [#43](https://github.com/raiseCatError/notMyShell/issues/43) | Muted command block dividers with historical context snapshots |

Issue #9 depends on #8 and the safe-shell/startup foundation. Issues #21, #22, and #42 can proceed independently when their implementation prerequisites are met. Issue #43 builds on local transcript persistence from #22 and records cwd/branch snapshots as presentation metadata, not copied shell output.

## Later — Terminal Host Independence

Keep TerminalHost abstraction and platform work separate from v0.3. NMSh core remains host agnostic; enhanced host capabilities must not become structural dependencies.

| Issue | Title |
|---|---|
| [#10](https://github.com/raiseCatError/notMyShell/issues/10) | TerminalHost capability abstraction |
| [#11](https://github.com/raiseCatError/notMyShell/issues/11) | Make macOS Terminal the baseline host |
| [#12](https://github.com/raiseCatError/notMyShell/issues/12) | Ghostty enhanced integration (post-abstraction) |
| [#13](https://github.com/raiseCatError/notMyShell/issues/13) | Compatibility passes for iTerm2, Kitty, and WezTerm |
| [#15](https://github.com/raiseCatError/notMyShell/issues/15) | Investigate NMSh interoperability with Supacode and agent-oriented terminal hosts |

## Ongoing — CLI/TUI Compatibility and Polish

NMSh provides the surrounding interaction and presentation layer; tools such as `gh`, zoxide, Atuin, tmux, editors, and agent CLIs keep their own interfaces.

| Issue | Title |
|---|---|
| [#14](https://github.com/raiseCatError/notMyShell/issues/14) | CLI and TUI interoperability compatibility suite |
| [#20](https://github.com/raiseCatError/notMyShell/issues/20) | Ongoing polish: mouse, Unicode, completions, history, performance, and installation |

## Longer Term — Shells and Platforms

zsh remains the only first-class backend. ShellAdapter research and Linux/Windows investigations remain future work; multi-shell and those platform targets are not promised today.

| Issue | Title |
|---|---|
| [#16](https://github.com/raiseCatError/notMyShell/issues/16) | zsh-first quality: aliases, completions, Atuin, zoxide, fzf, and plugin compatibility |
| [#17](https://github.com/raiseCatError/notMyShell/issues/17) | Research ShellAdapter architecture for future multi-shell support |
| [#18](https://github.com/raiseCatError/notMyShell/issues/18) | Investigate Linux support |
| [#19](https://github.com/raiseCatError/notMyShell/issues/19) | Research Windows / ConPTY feasibility |

## Design Principles

- NMSh is a frontend over a persistent real zsh session.
- The terminal host renders cells and interprets ANSI; NMSh is not a terminal emulator.
- Raw PTY output remains recoverable and is not semantically recolored.
- Fullscreen applications retain the passthrough path.
- NMSh core remains terminal-host agnostic and interoperates with CLI/TUI tools.
- The core experience uses deterministic local logic without cloud inference or model API calls.

## GitHub Project

**[NMSh Development →](https://github.com/users/raiseCatError/projects/1)**

Status columns: **Backlog → Ready → In Progress → Needs Human Test → Done**
