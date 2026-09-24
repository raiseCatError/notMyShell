# NMSh Roadmap

## Tracking

| | |
|---|---|
| **Current release** | [v0.2.0 — Structured Execution](https://github.com/raiseCatError/notMyShell/releases/tag/v0.2.0) |
| **Development branch** | `dev` |
| **Active milestone** | [v0.3.0 — Session & Interaction UX](https://github.com/raiseCatError/notMyShell/milestone/2) |
| **Project board** | [NMSh Development](https://github.com/users/raiseCatError/projects/1) |

GitHub issues define actionable remaining work. A merged implementation may still be open with `needs-human-test` while physical terminal checks are pending. Closed issues represent completed work, not a promise that future refinements are finished.

## Released — v0.2.0 Structured Execution

[Milestone #1](https://github.com/raiseCatError/notMyShell/milestone/1) is closed and shipped. Its design record remains at [docs/design/structured-execution.md](docs/design/structured-execution.md), and release notes remain in [CHANGELOG.md](CHANGELOG.md).

## Now — v0.3.0 Session & Interaction UX

The core v0.3 interaction features are implemented on `dev`: safe zsh handoff, modular Native and Starship prompts, themes, composer layout and placement, rich paste atoms, persistent transcripts, first-run prompt setup, observed nested activity, and build identity. Remaining work is focused on outstanding human validation and the follow-up items below; the milestone is not a list of unstarted features.

**Design record:** [docs/design/session-interaction-ux.md](docs/design/session-interaction-ux.md)

### Implemented; human terminal validation remains

Keep these issues open with `needs-human-test` until the listed physical checks pass:

| Issue | Implemented scope | Remaining validation |
|---|---|---|
| [#36](https://github.com/raiseCatError/notMyShell/issues/36) | `/zsh` handoff and nested-NMSh prevention | Real interactive zsh lifecycle and terminal-mode handoff |
| [#21](https://github.com/raiseCatError/notMyShell/issues/21) | Large multiline paste atoms and exact-source submission | Paste/edit/delete/unwrap behavior in Ghostty and Terminal.app |
| [#22](https://github.com/raiseCatError/notMyShell/issues/22) | Local transcript archive, `/clear`, and `/resume` | Shell-state continuity and archive behavior in real terminals |
| [#47](https://github.com/raiseCatError/notMyShell/issues/47) | Directly observed nested Node TAP activity | Live/folded activity, shimmer, and parent detail behavior |
| [#49](https://github.com/raiseCatError/notMyShell/issues/49) | One-line/two-line composer and `header`/`composer` placement | PR #64 placement choices and narrow-terminal visuals |
| [#53](https://github.com/raiseCatError/notMyShell/issues/53) | Build-time identity and `/version` / `--version` | Verify both commands after rebuilding the globally linked app |
| [#56](https://github.com/raiseCatError/notMyShell/issues/56) | Welcome metadata, full-body cat, and blink animation | Blink timing/appearance and welcome lifecycle; cat design itself is approved |
| [#58](https://github.com/raiseCatError/notMyShell/issues/58) | Native/Starship providers, six Native themes, synthetic previews, semantic snapshots | PR #64 theme variants/previews and final theme rendering |

The current `/prompt` layout is visually approved. Cool First, one-line mode, and muted theme-preserving historical prompts are also approved. PR #64's changed theme variants, placement choices, blink animation, and silver shimmer still need final Ghostty validation; automated tests do not replace that check.

### Open follow-up engineering

These are remaining tasks, not completed v0.3 scope:

| Issue | Remaining work |
|---|---|
| [#8](https://github.com/raiseCatError/notMyShell/issues/8) | Separate Native Start, Connector, Gap, and End semantics; add configurable prompt icons/no-icons; continue modular prompt improvements. The current `startStyle` still affects independent internal segment openings. |
| [#9](https://github.com/raiseCatError/notMyShell/issues/9) | Optional first-run shell-tool discovery/setup for zoxide, fzf, and Atuin, with Recommended / Choose individually / Skip and explicit confirmation before installation. Prompt/provider/layout setup is already implemented. |
| [#52](https://github.com/raiseCatError/notMyShell/issues/52) | Design and implement a safe zsh completion/editor protocol. Native `fzf-tab` support remains unresolved and is not currently claimed. |

Issue #58 also tracks the later expansion of visual themes into broader NMSh presentation themes, including semantic editor/syntax colors where appropriate. Planned core directions are Lavender Native, Brand / Semantic, Cool First, Warm First, and Grayscale. Soft Semantic may be consolidated or retired after review; it is not a separate required long-term theme.

Issue #16 remains the broader zsh/tool interoperability issue: preserve compatible shell lifecycle hooks and improve aliases, ordinary completion, Atuin, zoxide, and fzf behavior. `fzf-tab` protocol work belongs to #52, not a claim of current support. zsh-autosuggestions and zsh-syntax-highlighting are not required; NMSh provides those UI roles itself.

Issue #43 (muted theme-preserving historical snapshots) is implemented, visually approved, and closed. Issue #53 (compiled `/version` and `--version`) is implemented but remains open for its explicit global-install runtime check.

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
| [#16](https://github.com/raiseCatError/notMyShell/issues/16) | zsh-first quality and tool/plugin interoperability |
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
