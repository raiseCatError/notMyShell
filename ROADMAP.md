# NMSh Roadmap

## Tracking

| | |
|---|---|
| **Current release** | [v0.16.0 — Sessions, Agents & Portability](https://github.com/raiseCatError/notMyShell/releases/tag/v0.16.0) — released |
| **Prepared release candidate** | v0.17.0 — Context Engine, Themes & Discovery; on `master`, tagging and publication pending |
| **Current engineering focus** | [#305 — Native modules / Context Engine](https://github.com/raiseCatError/notMyShell/issues/305); foundation and Context Rail implemented on `master` in the v0.17.0 release candidate |
| **Included in the release candidate** | Theme Studio, Theme Bridge, tool configuration, shell frameworks, Keep Awake and Context Engine foundation; merged through [PR #322](https://github.com/raiseCatError/notMyShell/pull/322), see CHANGELOG → 0.17.0 |
| **Unscheduled** | [Future / Backlog](https://github.com/raiseCatError/notMyShell/milestone/7) |
| **Development branch** | `dev` |
| **Project board** | [NMSh Development](https://github.com/users/raiseCatError/projects/1) |

GitHub issues define actionable remaining work. Closed issues represent completed work, not a promise that future refinements are finished. The latest published release is 0.16.0; the package on `master` is the 0.17.0 release candidate.

## Current engineering focus — native modules and Context Engine

The primary current direction is [#305](https://github.com/raiseCatError/notMyShell/issues/305): a native module ecosystem built around **Capability → Fact → Module → Surface Router → presentation surfaces**. The [Context Modules guide](docs/architecture/context-modules.md) explains the public model. The foundation is in the v0.17.0 release candidate on `master`; the broader module ecosystem remains ongoing.

| State | Scope |
|---|---|
| Implemented in the v0.17.0 release candidate | Typed fact metadata and privacy filtering; trusted bounded metadata/Git collection; the first-party module registry; Main Prompt / Right Context / Context Rail routing; Rail geometry, priority fitting and shared previews |
| Preserved | Existing Native module order, visibility and left/right placement; real zsh/Bash/Fish sessions; prompt snapshots and fullscreen passthrough |
| Upcoming | General capability scheduling and fuller fact migration; a bounded expansion of useful first-party modules; installable declarative Context Packs with validation and policy |
| Deferred | Status Strip module routing and any executable extension tier; no finalized public pack API |

Repository entry must never grant authority to execute arbitrary repository-controlled code. Discovery remains parser-only or uses curated core probes with explicit bounds and policy.

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

## Released — v0.16.0 Sessions, Agents & Portability

The work formerly planned as v0.8–v0.15 ships together with v0.16 in one cumulative release. PR #303 is merged; final CI and the maintainer physical sanity pass passed. User-facing changes are in [CHANGELOG.md](CHANGELOG.md). Linux/WSL and other-host physical follow-ups remain in v0.17.

| Area | Implemented scope |
|---|---|
| Command intelligence (formerly v0.8) | Structured completion menu with a bundled static catalog generated from withfig/autocomplete and carapace-bin plus the live shell source; structured `/history`; Atuin, zoxide, fzf and Television providers; command inspector; block actions; correction suggestions; completion notifications |
| Tools & workflows (formerly v0.9) | `/tools` browser and curated catalog (#306/#307), supported Starship configuration, optional mise awareness, session presets, welcome providers, Linguist language colors, VHS tapes |
| Hosts & compatibility (formerly v0.10) | TerminalHost capabilities, Terminal.app baseline, Ghostty integration, passive iTerm2/Kitty/WezTerm profiles, CLI/TUI fixtures, OSC 8 links |
| Shell intelligence (formerly v0.11) | Configured-zsh completion bridge, alias/function metadata, syntax roles, ShellAdapter research (now implemented, below) |
| Chroma & motion (formerly v0.12) | Composable Chroma treatments, bounded transient effects on a shared clock |
| Portability (formerly v0.13) | Linux baseline and CI, hardening; WSL reporting; Windows research (native Windows is no-go) |
| Sessions, agents, platform (v0.16) | Session notices (short-lived events), agent activity, `/resume` viewer, `nmsh config export/import`, `nmsh uninstall`, `nmsh doctor`, images, Linux/WSL, ShellAdapter with zsh, Fish and Bash, `/find` and `/filter`, editor bridge, `/watch`, `/doctor`, paste preview and review |
| Ask & Local Understanding | Deterministic Ask, optional local model (Auto by default, never downloads without a Yes), `/llm` |
| Appearance | `/appearance` hub; Clean and Rich motion rendering with per-rendering tuning; cursor effects with a capability matrix; Setup Cat as the complete customization entry point; grouped Config and Status |

## Release candidate — v0.17 Context Engine, Themes & Discovery

[Milestone #15](https://github.com/raiseCatError/notMyShell/milestone/15). Code and automated coverage for `Relevant here`, package-manager plans with bulk install, activation detection, host profiles, Linux/WSL hardening, automatic update staging and startup session kill. Physical validation in iTerm2, Kitty, WezTerm, Linux and WSL 2 is tracked as a separate `needs-human-test` follow-up and does not block the release.

| Issue | Disposition |
|---|---|
| [#9](https://github.com/raiseCatError/notMyShell/issues/9) | Implemented in v0.17 |
| [#13](https://github.com/raiseCatError/notMyShell/issues/13) | Code and fixtures in v0.17; physical pass moved to a follow-up |
| [#14](https://github.com/raiseCatError/notMyShell/issues/14) | Maintainer exercised real CLI/TUI use; deterministic suite extended; ongoing regression tracking |
| [#15](https://github.com/raiseCatError/notMyShell/issues/15) | Moved to Future / Backlog; NMSh already degrades by capability in unknown embedded hosts |
| [#18](https://github.com/raiseCatError/notMyShell/issues/18) | Code and CI in v0.17; physical Linux/WSL pass moved to a follow-up |

## Planned releases

| Release | Theme | Tracker |
|---|---|---|
| v0.18.0 | Theme Bridge and semantic terminal integration | [#304](https://github.com/raiseCatError/notMyShell/issues/304), core Theme Bridge and host semantics are included in the v0.17.0 release candidate; remaining refinements follow in focused slices. Still deferred: terminal title ownership (OSC 0/2), delta custom styles, terminal emulator and editor base-theme takeover. |
| v0.19.0 | NMSh Native module ecosystem: capability scheduling beyond the v0.17.0 Context Engine foundation and Rail, a bounded first-party module expansion and declarative packs | [#305](https://github.com/raiseCatError/notMyShell/issues/305) |

## Backlog — future, unscheduled

[Future / Backlog](https://github.com/raiseCatError/notMyShell/milestone/7). These remain open and are not scheduled for a release.

| Issue | Title |
|---|---|
| [#304](https://github.com/raiseCatError/notMyShell/issues/304) | (planned v0.18) Theme Bridge and semantic terminal integration |
| [#296](https://github.com/raiseCatError/notMyShell/issues/296) | Hosted SSH demo (post-1.0) |
| [#20](https://github.com/raiseCatError/notMyShell/issues/20) | Ongoing polish triage index |

zsh-autosuggestions and zsh-syntax-highlighting are not required plugins; NMSh provides those UI roles natively. Native fzf-tab interoperability is a documented non-goal (it would require ceding editor ownership).

## Longer term — shells and platforms

In v0.16.0 zsh, Fish and Bash 4.4+ are implemented backends behind a real [ShellAdapter](docs/architecture/shell-adapter.md). Nushell and PowerShell remain later. Linux and WSL 2 are supported by automated validation, with physical validation tracked in #18; native Windows (ConPTY) is a no-go per the [Windows feasibility research](docs/architecture/v013-windows-feasibility.md). See also [Linux foundations](docs/architecture/v013-linux-foundations.md).

## Design Principles

- NMSh is a frontend over a persistent real shell session (zsh, Fish or Bash through ShellAdapter).
- The terminal host renders cells and interprets ANSI; NMSh is not a terminal emulator.
- Raw PTY output remains recoverable and is not semantically recolored.
- Fullscreen applications retain the passthrough path.
- NMSh core remains terminal-host agnostic and interoperates with CLI/TUI tools.
- The core experience uses deterministic local logic without cloud inference or model API calls.

## GitHub Project

**[NMSh Development →](https://github.com/users/raiseCatError/projects/1)**

Status columns: **Backlog → Ready → In Progress → Needs Human Test → Done**
