# Terminal frontend landscape — #179 findings (current primary sources, 2026-10-02)

NMSh remains a terminal-agnostic TypeScript frontend over a persistent real zsh, with an owned composer, semantic transcript, optional providers, customization and resumable sessions. The following boundary conclusions are engineering inferences from the referenced designs, not a claim that one product wins.

| Category | Ownership and useful overlap | Boundary for NMSh |
| --- | --- | --- |
| [Warp blocks](https://docs.warp.dev/terminal/blocks) | A command/output block is a navigable, copyable unit inside its terminal product. Structured navigation and editor placement are useful precedents. | Retain host-independent ScreenPlan and faithful PTY archive. Do not adopt cloud collaboration or terminal-emulator ownership. |
| [Wave widgets](https://docs.waveterm.dev/widgets), [custom widgets](https://docs.waveterm.dev/customwidgets), [customization](https://docs.waveterm.dev/customization) | Resizable terminal/file/web widgets with a single focused widget; declarative widget configuration and explicit commands. | Borrow visible focus and explicit adapters. Web/GPU workspace and terminal palette ownership are outside NMSh. |
| [Fish design](https://fishshell.com/docs/current/design.html) | Interactive shell usability, discoverability and editor feedback. | Integrate suggestions over existing zsh; changing shell grammar/state is outside scope. |
| [Nushell](https://www.nushell.sh/book/thinking_in_nu.html) | Structured pipeline values and commands. | NMSh structures command metadata, not arbitrary program output or shell pipeline values. |
| [Xonsh](https://xon.sh/) | Python-powered shell language and extensibility. | No executable presentation configuration or replacement language. |
| [tmux](https://github.com/tmux/tmux/wiki), [Zellij](https://github.com/zellij-org/zellij) | Pane/session multiplexing, keyboard navigation, plugins (Zellij). | NMSh attaches to its managed shell session; host multiplexers remain independent. Do not create pane/window management. |
| [TUIOS](https://github.com/Gaurav-Gosain/tuios) | Terminal window management, workspaces, persistent sessions and agent-oriented inbox concepts. | Explicit ownership transfer and lifecycle are useful; no agent manager or window manager in NMSh. |
| [Starship](https://starship.rs/) and Powerlevel10k | Prompt providers own their rendered identity. | Keep external provider output faithful; treatments target Native semantics or NMSh framing. |
| [Atuin](https://docs.atuin.sh/cli/) | Dedicated searchable history and optional synchronization. | Existing optional read-only provider integration; no mandatory account or cloud persistence. |
| Charm / Ink / OpenTUI / Ratatui / Textual | Terminal-native composition, keyboard focus, events, styling and async lifecycle. | Concepts inform owned UI; framework rendering must never become shell/transcript authority. See #180. |

Across categories, visual customization and keyboard/mouse interaction only help when focus, ownership and recovery are explicit. NMSh keeps NO_COLOR, Safe glyphs, keyboard-only access and Reduced Motion first-class. This research does not assert accessibility parity between products: primary references describe mechanisms, not a comparative usability audit.

Product boundary: NMSh is not a terminal emulator, replacement shell language, multiplexer, IDE, cloud collaboration platform or agent manager. Provider adapters are integration seams, not a new public executable plugin runtime. Persistent/resumable shell sessions remain separate from presentation records. No migration or dependency change follows from this comparison.
