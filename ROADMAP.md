# NMSh Roadmap

## Tracking

| | |
|---|---|
| **Current release** | [v0.7.0 — UI Foundation & Customization](https://github.com/raiseCatError/notMyShell/releases/tag/v0.7.0) |
| **Development branch** | `dev` |
| **Next direction** | [v0.8.0 — Command Intelligence & Navigation](https://github.com/raiseCatError/notMyShell/milestone/8), in development |
| **Stacked development** | [v0.9.0 — Tools, Integrations & Workflows](https://github.com/raiseCatError/notMyShell/milestone/9), incomplete and unmerged |
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

## Released — v0.5.0 Interaction & Intelligence

[Milestone #4](https://github.com/raiseCatError/notMyShell/milestone/4) shipped after final human validation in Ghostty. Release notes are in [CHANGELOG.md](CHANGELOG.md).

### Shipped scope

| Issue | Implemented scope |
|---|---|
| [#122](https://github.com/raiseCatError/notMyShell/issues/122) | Transcript presenter: one row pipeline for every layout and presentation |
| [#134](https://github.com/raiseCatError/notMyShell/issues/134), [#135](https://github.com/raiseCatError/notMyShell/issues/135) | Shared provider framework; Welcome providers (Vespyr, Fastfetch, Neofetch legacy, None) |
| [#136](https://github.com/raiseCatError/notMyShell/issues/136) | Output folding Off / Smart / Always |
| [#137](https://github.com/raiseCatError/notMyShell/issues/137), [#138](https://github.com/raiseCatError/notMyShell/issues/138), [#139](https://github.com/raiseCatError/notMyShell/issues/139) | Suggestion providers, NMSh Native Suggestions v2, optional Deja provider |
| [#123](https://github.com/raiseCatError/notMyShell/issues/123), [#124](https://github.com/raiseCatError/notMyShell/issues/124) | Dock Top composer position; Chat transcript presentation |
| [#146](https://github.com/raiseCatError/notMyShell/issues/146) | Command palette |
| [#149](https://github.com/raiseCatError/notMyShell/issues/149) | Native prompt styles: Powerline, Soft, Minimal, Outline |

## Released — v0.6.0 Sessions & Continuity

[Milestone #5](https://github.com/raiseCatError/notMyShell/milestone/5) shipped after physical QA of Flow, `/resume`, multi-session restore, Terminal.app startup, inline interactive UIs and Claude detach/reattach. Release notes are in [CHANGELOG.md](CHANGELOG.md). tmux, Zellij and VS Code were not physically re-verified for this release; see [multiplexer interoperability notes](docs/architecture/multiplexer-interop.md).

### Shipped scope

| Issue | Implemented scope |
|---|---|
| [#125](https://github.com/raiseCatError/notMyShell/issues/125)–[#131](https://github.com/raiseCatError/notMyShell/issues/131) | Persistent live sessions: protocol, session service, detach/reattach, detached output capture, `/resume` Live + Archived, hardening |
| [#197](https://github.com/raiseCatError/notMyShell/issues/197) | User-controlled startup restore and multi-session picker |
| [#174](https://github.com/raiseCatError/notMyShell/issues/174) | Agent-aware live session status |
| [#175](https://github.com/raiseCatError/notMyShell/issues/175) | Multiplexer interoperability research notes |
| [#132](https://github.com/raiseCatError/notMyShell/issues/132), [#133](https://github.com/raiseCatError/notMyShell/issues/133) | Flow composer position; `/layout` showcase |
| [#199](https://github.com/raiseCatError/notMyShell/issues/199), [#206](https://github.com/raiseCatError/notMyShell/issues/206), [#211](https://github.com/raiseCatError/notMyShell/issues/211), [#212](https://github.com/raiseCatError/notMyShell/issues/212) | Physical-QA fixes: resize on closed PTY, stray suspended job, inline interactive UIs, multi-session restore |

## Released — v0.7.0 UI Foundation & Customization

[Milestone #6](https://github.com/raiseCatError/notMyShell/milestone/6) shipped after physical QA of Settings v2, generated help, color and motion modes, surfaces, and Flow/Chat regressions. Release notes are in [CHANGELOG.md](CHANGELOG.md). Screen-reader behavior is unverified; see [accessibility baseline](docs/accessibility/baseline.md).

### Shipped scope

| Issue | Implemented scope |
|---|---|
| [#164](https://github.com/raiseCatError/notMyShell/issues/164) | notMyUI internal toolkit and acceptance documentation |
| [#165](https://github.com/raiseCatError/notMyShell/issues/165) | Surface primitives: frames, fills, layout |
| [#166](https://github.com/raiseCatError/notMyShell/issues/166) | Shared actions and generated contextual help |
| [#167](https://github.com/raiseCatError/notMyShell/issues/167) | Shared form controls |
| [#168](https://github.com/raiseCatError/notMyShell/issues/168) | Authored Markdown renderer and `/help` |
| [#169](https://github.com/raiseCatError/notMyShell/issues/169) | Settings v2: simple/advanced view, changed markers, reset, remembered position |
| [#170](https://github.com/raiseCatError/notMyShell/issues/170) | Accessibility baseline, no-color and reduced-motion modes |
| [#171](https://github.com/raiseCatError/notMyShell/issues/171) | Chroma shared color roles, gradients and fallback |
| [#172](https://github.com/raiseCatError/notMyShell/issues/172) | Semantic motion engine; shimmer migrated onto it |
| [#173](https://github.com/raiseCatError/notMyShell/issues/173) | Deterministic presentation mode |

## In development — v0.8.0 Command Intelligence & Navigation

[Milestone #8](https://github.com/raiseCatError/notMyShell/milestone/8) contains #140, #141, #142, #143, #144, #145, #147 and #152. The [architecture and implemented scope](docs/design/command-intelligence.md) describe the unmerged review stack; the [physical-QA checklist](docs/qa/v0.8.0-physical-qa.md) remains pending. Package version stays at 0.7.0 during development.

Native structured completion, command-level history, reusable optional pickers, explicit directory navigation and conservative edit-only corrections build on the released UI foundation. External completion sources remain research; #52 stays parked. #155 / #193 supply measurements without absorbing the full performance issue into this milestone.

The earlier milestone #7 now represents unscheduled Discoverability & Integrations; its unrelated scope remains separate.

The continuation's final acceptance head is [#251](https://github.com/raiseCatError/notMyShell/pull/251),
`docs/v08-continuation-final-verification` at `2dfbf9c12c54ada8af364bc44db87bc70f0b77c0`.
It includes command inspector, block actions, notifications and fixture hygiene.
These remain implemented/unmerged with cumulative physical QA pending, not reopened backlog.

## Stacked development — v0.9.0 Tools, Integrations & Workflows

[Milestone #9](https://github.com/raiseCatError/notMyShell/milestone/9) adopts #9,
#83, #153, #154, #176, #177 and #178. Research children #252 (supported config)
and #253 (mise awareness) are also included. #176/#177/#178 moved from the
unscheduled grouping; #179/#180 remain there. The stack consumes the pinned
final v0.8 head without modifying or merging it; package version remains 0.7.0.

Current review order: #251 → #182 → #181 → #183 → #254 → draft #255.
Linguist identity, external welcome adapters, deterministic VHS tooling and
supported Starship configuration are implemented. Tools discovery/install work
is checkpointed as a draft. Mise implementation and session presets remain pending;
no final milestone acceptance is claimed. Local disk exhaustion interrupted
verification/continuation. See the [checkpoint](docs/development/v0.9.0-checkpoint.md)
and [single additive QA checklist](docs/qa/v0.9.0-physical-qa.md).

## Backlog — Research and Future Features

These remain open and are not scheduled for a release.

| Issue | Title |
|---|---|
| [#52](https://github.com/raiseCatError/notMyShell/issues/52) | Configured-zsh completion parity and fzf-tab interoperability |
| [#75](https://github.com/raiseCatError/notMyShell/issues/75) | Native parity with common zsh editor plugins |
| [#73](https://github.com/raiseCatError/notMyShell/issues/73) | Custom user-defined prompt modules |
| [#78](https://github.com/raiseCatError/notMyShell/issues/78) | Chroma: gradients, animated color treatments, and transient visual effects |

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
