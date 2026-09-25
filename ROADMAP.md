# NMSh Roadmap

## Tracking

| | |
|---|---|
| **Current release** | [v0.4.0 — Shell Intelligence & Extensibility](https://github.com/raiseCatError/notMyShell/releases/tag/v0.4.0) |
| **Development branch** | `dev` |
| **Next direction** | [#79 Interaction layout modes](https://github.com/raiseCatError/notMyShell/issues/79) (design/research) |
| **Project board** | [NMSh Development](https://github.com/users/raiseCatError/projects/1) |

GitHub issues define actionable remaining work. A merged implementation may still be open with `needs-human-test` while physical terminal checks are pending. Closed issues represent completed work, not a promise that future refinements are finished.

## Released — v0.2.0 Structured Execution

[Milestone #1](https://github.com/raiseCatError/notMyShell/milestone/1) is closed and shipped. Its design record remains at [docs/design/structured-execution.md](docs/design/structured-execution.md), and release notes remain in [CHANGELOG.md](CHANGELOG.md).

## Released — v0.3.0 Session & Interaction UX

The [v0.3.0 release](https://github.com/raiseCatError/notMyShell/releases/tag/v0.3.0) shipped after final human validation in Ghostty, Terminal.app, and VS Code integrated terminal. Its milestone is closed.

**Design record:** [docs/design/session-interaction-ux.md](docs/design/session-interaction-ux.md)

### Shipped scope

| Issue | Implemented scope |
|---|---|
| [#8](https://github.com/raiseCatError/notMyShell/issues/8) | Native Start / Connector / Gap / End geometry, rounded and slanted shapes, outer-edge fades, icons On/Off, module manager |
| [#58](https://github.com/raiseCatError/notMyShell/issues/58) | NMSh Native / Starship providers, final five-theme set, synthetic previews, semantic snapshots |
| [#66](https://github.com/raiseCatError/notMyShell/issues/66) | `/transcript` divider, historical prompt, history colors, divider density |
| [#67](https://github.com/raiseCatError/notMyShell/issues/67) | Powerlevel10k provider via an isolated helper, with documented limitations |
| [#49](https://github.com/raiseCatError/notMyShell/issues/49) | One-line/two-line composer and `header`/`composer` placement |
| [#56](https://github.com/raiseCatError/notMyShell/issues/56) | Welcome header, bold wordmark, full-body cat and blink |
| [#36](https://github.com/raiseCatError/notMyShell/issues/36) | `/zsh` handoff and nested-NMSh prevention |
| [#21](https://github.com/raiseCatError/notMyShell/issues/21) | Rich paste atoms |
| [#22](https://github.com/raiseCatError/notMyShell/issues/22) | Local transcript archive, `/clear`, `/resume` |
| [#47](https://github.com/raiseCatError/notMyShell/issues/47) | Nested Node TAP activity and shimmer |
| [#53](https://github.com/raiseCatError/notMyShell/issues/53) | Build identity, `/version`, `--version` |

The final release candidate also included the passive-hover selection fix.

## Released — v0.4.0 Shell Intelligence & Extensibility

[Milestone #3](https://github.com/raiseCatError/notMyShell/milestone/3) shipped after final human validation in Ghostty. Release notes are in [CHANGELOG.md](CHANGELOG.md).

### Shipped scope

| Issue | Implemented scope |
|---|---|
| [#69](https://github.com/raiseCatError/notMyShell/issues/69) | Right-side prompt context, per-module left/right placement, mirrored right-side geometry, deterministic prompt showcase |
| [#70](https://github.com/raiseCatError/notMyShell/issues/70) | Show-on-command Kubernetes, Docker, and toolchain modules |
| [#71](https://github.com/raiseCatError/notMyShell/issues/71) | Width-aware intelligent directory shortening |
| [#72](https://github.com/raiseCatError/notMyShell/issues/72) | Rich Git state, Rich Git settings, connector fade, Gap Wide |
| [#68](https://github.com/raiseCatError/notMyShell/issues/68) | Theme-aware syntax highlighting and `/syntax` |
| [#113](https://github.com/raiseCatError/notMyShell/issues/113) | Smart output folding with preserved head/tail and a Smart/Never setting |
| [#104](https://github.com/raiseCatError/notMyShell/issues/104) | Sticky command headers |
| [#86](https://github.com/raiseCatError/notMyShell/issues/86), [#90](https://github.com/raiseCatError/notMyShell/issues/90), [#100](https://github.com/raiseCatError/notMyShell/issues/100) | Central `/settings`, shared panel shell, consistent Esc/back navigation |
| [#88](https://github.com/raiseCatError/notMyShell/issues/88) | Continuous session journal and advanced `/resume` |
| [#89](https://github.com/raiseCatError/notMyShell/issues/89) | Persisted glyph style and first-run compatibility choice |
| [#91](https://github.com/raiseCatError/notMyShell/issues/91) | Reusable long-running task progress UI |
| [#92](https://github.com/raiseCatError/notMyShell/issues/92), [#93](https://github.com/raiseCatError/notMyShell/issues/93) | Starship module editor and Powerlevel10k configurator handoff |
| [#16](https://github.com/raiseCatError/notMyShell/issues/16) | Compatible user zsh hooks (zoxide, Atuin) preserved |
| [#74](https://github.com/raiseCatError/notMyShell/issues/74) | Update discovery and safe `/update` |

## Next — Interaction Layout Modes

[#79](https://github.com/raiseCatError/notMyShell/issues/79) is the next planned design/research direction. It is not implemented. It explores two independent axes over the same real shell and session semantics:

- **Composer placement:** Dock Bottom (today), Dock Top, or Flow / Classic Terminal.
- **Transcript presentation:** Normal transcript or Chat presentation.

Any placement can combine with any presentation. Shell execution, raw PTY output, `/copy`, persistence, and passthrough stay unchanged.

## Backlog — Research and Future Features

These remain open and are not scheduled for a release.

| Issue | Title |
|---|---|
| [#52](https://github.com/raiseCatError/notMyShell/issues/52) | Configured-zsh completion parity and fzf-tab interoperability |
| [#75](https://github.com/raiseCatError/notMyShell/issues/75) | Native parity with common zsh editor plugins |
| [#9](https://github.com/raiseCatError/notMyShell/issues/9) | Optional shell-tool discovery and first-run setup |
| [#73](https://github.com/raiseCatError/notMyShell/issues/73) | Custom user-defined prompt modules |
| [#78](https://github.com/raiseCatError/notMyShell/issues/78) | Chroma: gradients, animated color treatments, and transient visual effects |
| [#83](https://github.com/raiseCatError/notMyShell/issues/83) | Tool configuration center inside `/settings` |
| [#84](https://github.com/raiseCatError/notMyShell/issues/84) | Command inspector |
| [#85](https://github.com/raiseCatError/notMyShell/issues/85) | Interactive command/output block controls |
| [#106](https://github.com/raiseCatError/notMyShell/issues/106) | Command completion notifications for long-running commands |

zsh-autosuggestions and zsh-syntax-highlighting are not required plugins; NMSh provides those UI roles natively.

## Later — Terminal Host Independence

Keep TerminalHost abstraction and host compatibility separate from v0.3. NMSh core remains host agnostic; enhanced host capabilities must not become structural dependencies.

| Issue | Title |
|---|---|
| [#10](https://github.com/raiseCatError/notMyShell/issues/10) | TerminalHost capability abstraction |
| [#11](https://github.com/raiseCatError/notMyShell/issues/11) | Make macOS Terminal the baseline host |
| [#12](https://github.com/raiseCatError/notMyShell/issues/12) | Ghostty enhanced integration (post-abstraction) |
| [#13](https://github.com/raiseCatError/notMyShell/issues/13) | Compatibility passes for iTerm2, Kitty, and WezTerm |
| [#15](https://github.com/raiseCatError/notMyShell/issues/15) | Investigate NMSh interoperability with Supacode and agent-oriented terminal hosts |

## Ongoing — CLI/TUI Compatibility and Polish

NMSh provides the surrounding interaction and presentation layer; tools such as `gh`, zoxide, Atuin, tmux, editors, and agent CLIs keep their own interfaces. See [#14](https://github.com/raiseCatError/notMyShell/issues/14) for compatibility work and [#20](https://github.com/raiseCatError/notMyShell/issues/20) for uncategorized polish that does not already have a focused issue.

## Longer Term — Shells and Platforms

zsh remains the only first-class backend. ShellAdapter research and Linux/Windows investigations remain future work; multi-shell and those platform targets are not promised today.

| Issue | Title |
|---|---|
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
