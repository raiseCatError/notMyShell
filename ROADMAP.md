# NMSh Roadmap

## Tracking

| | |
|---|---|
| **Current release** | [v0.1.0](https://github.com/raiseCatError/notMyShell/releases/tag/v0.1.0) |
| **Development branch** | `dev` |
| **Next milestone** | [v0.2.0 — Structured Execution](https://github.com/raiseCatError/notMyShell/milestone/1) |
| **Project board** | [NMSh Development](https://github.com/users/raiseCatError/projects/1) |

**How the tracking system works:**

| Layer | Purpose |
|---|---|
| **ROADMAP.md** (this file) | High-level product direction and navigation |
| **[GitHub Issues](https://github.com/raiseCatError/notMyShell/issues)** | Concrete actionable work items |
| **[Milestones](https://github.com/raiseCatError/notMyShell/milestones)** | Work targeted at a specific release |
| **GitHub Project** | Live status board |
| **Pull Requests** | Implementation |
| **[CHANGELOG.md](CHANGELOG.md)** | Shipped and released work |
| **[docs/design/](docs/design/)** | Durable design decisions and architectural concepts |

---

## Now — Structured Execution ([v0.2.0](https://github.com/raiseCatError/notMyShell/milestone/1))

Making ordinary shell execution structured, readable, compact, and recoverable while preserving complete raw PTY behavior.

**Design document:** [docs/design/structured-execution.md](docs/design/structured-execution.md)

| Issue | Title |
|---|---|
| [#1](https://github.com/raiseCatError/notMyShell/issues/1) | Visual hierarchy: distinguish submitted commands, NMSh metadata, and shell output |
| [#2](https://github.com/raiseCatError/notMyShell/issues/2) | Output folding: preserve raw PTY output with per-command presentation state |
| [#3](https://github.com/raiseCatError/notMyShell/issues/3) | Ctrl+O: toggle compact and detailed execution views |
| [#4](https://github.com/raiseCatError/notMyShell/issues/4) | Automatic execution presentation: inline, folded, live, passthrough |
| [#5](https://github.com/raiseCatError/notMyShell/issues/5) | Execution timeline: factual command milestones and summaries |
| [#6](https://github.com/raiseCatError/notMyShell/issues/6) | Deterministic summaries for common CLI tools |
| [#7](https://github.com/raiseCatError/notMyShell/issues/7) | Structured execution compatibility and human validation pass |

---

## Next — Prompt & Personalization

A modular, configurable NMSh context/prompt system. Similar in spirit to Starship's modularity, but NMSh renders the context itself.

Potential modules: cwd, git branch, git dirty state, runtime version, exit status, time, battery, SSH/hostname.

Configuration will allow ordering, visibility, separators, colors, and conditional display. Context placement (inline, above/below editor) will be configurable.

Includes first-run onboarding to guide new users through basic NMSh configuration and terminal host setup.

Also in this phase: editor quality improvements including rich paste atom support for large multiline pastes.

| Issue | Title |
|---|---|
| [#8](https://github.com/raiseCatError/notMyShell/issues/8) | Modular NMSh prompt/context system |
| [#9](https://github.com/raiseCatError/notMyShell/issues/9) | First-run onboarding and appearance configuration |
| [#21](https://github.com/raiseCatError/notMyShell/issues/21) | Rich paste atoms for large multiline text |

---

## Later — Terminal Host Independence

NMSh core is **terminal-host agnostic**. It must not structurally depend on any specific terminal host. A TerminalHost capability abstraction gates enhanced behaviors so they do not leak into NMSh core.

**Host model:**

```
Terminal.app  Ghostty  iTerm2  Kitty  WezTerm  (others)
                          ↓
                        NMSh
                          ↓
                         zsh
```

- **Terminal.app** — baseline host; NMSh must look good and be fully functional here
- **Ghostty** — enhanced integration (keyboard protocol, appearance); must not become a structural dependency
- **iTerm2, Kitty, WezTerm** — capability-driven compatibility passes
- **Supacode** — agent/worktree environment; separate research, not treated as a standard terminal host

| Issue | Title |
|---|---|
| [#10](https://github.com/raiseCatError/notMyShell/issues/10) | TerminalHost capability abstraction |
| [#11](https://github.com/raiseCatError/notMyShell/issues/11) | Make macOS Terminal the baseline host |
| [#12](https://github.com/raiseCatError/notMyShell/issues/12) | Ghostty enhanced integration (post-abstraction) |
| [#13](https://github.com/raiseCatError/notMyShell/issues/13) | Compatibility passes for iTerm2, Kitty, and WezTerm |
| [#15](https://github.com/raiseCatError/notMyShell/issues/15) | Investigate NMSh interoperability with Supacode and agent-oriented terminal hosts |

---

## Ongoing — CLI/TUI Compatibility

NMSh interoperates with useful CLI tools rather than replacing their functionality.

- **gh** still handles GitHub
- **zoxide** still handles smart directory navigation
- **Atuin** can still handle advanced history
- **tmux** still multiplexes
- **nano/vim** still edit
- **Agent CLIs** (Claude Code, Codex, Aider) still own their interfaces

NMSh provides the surrounding interaction and presentation layer.

| Issue | Title |
|---|---|
| [#14](https://github.com/raiseCatError/notMyShell/issues/14) | CLI and TUI interoperability compatibility suite |

---

## Longer Term — Shells and Platforms

**zsh-first:** zsh is NMSh's only first-class shell backend for the foreseeable near term. Deep zsh quality is more important than shallow multi-shell support.

**ShellAdapter (future research):** A long-term architectural concept to make shells interchangeable beneath NMSh. No shell other than zsh is supported or promised today.

**Linux:** preferred first non-macOS platform — the POSIX PTY and zsh model maps naturally.

**Windows:** research only. Windows may require substantially different backend architecture (ConPTY, process/job control differences). Windows support is NOT promised.

| Issue | Title |
|---|---|
| [#16](https://github.com/raiseCatError/notMyShell/issues/16) | zsh-first quality: aliases, completions, Atuin, zoxide, fzf, and plugin compatibility |
| [#17](https://github.com/raiseCatError/notMyShell/issues/17) | Research ShellAdapter architecture for future multi-shell support |
| [#18](https://github.com/raiseCatError/notMyShell/issues/18) | Investigate Linux support |
| [#19](https://github.com/raiseCatError/notMyShell/issues/19) | Research Windows / ConPTY feasibility |

---

## Ongoing Polish

Mouse behavior, Unicode, completion quality, history, performance, installation, and demo assets.

| Issue | Title |
|---|---|
| [#20](https://github.com/raiseCatError/notMyShell/issues/20) | Ongoing polish: mouse, Unicode, completions, history, performance, and installation |

---

## Future — Session & Editor UX

| Issue | Title |
|---|---|
| [#22](https://github.com/raiseCatError/notMyShell/issues/22) | Persistent local sessions: archive /clear history and resume with /resume |

---

## Design Principles

- **Real persistent shell underneath** — NMSh is a frontend over a persistent real shell; it never replaces the shell with command-by-command subprocess spawning
- **NMSh is not a terminal emulator** — the terminal host renders cells and interprets ANSI sequences; NMSh does not
- **zsh-first** — deep zsh quality before multi-shell breadth
- **Terminal-host agnostic core** — NMSh core must not structurally depend on any specific terminal host
- **CLI/TUI interoperable** — NMSh wraps and coordinates CLI tools, does not replace them
- **Zero-AI core experience** — no LLM tokens, no model API calls, no cloud inference required for any core NMSh behavior; the UI feels intelligent through deterministic local logic
- **Raw PTY output remains recoverable** — output is never discarded merely because it is hidden; presentation state is separate from storage
- **Fullscreen apps retain passthrough** — interactive/fullscreen programs use the raw PTY path; NMSh applies no presentation overlay

---

## GitHub Project

**[NMSh Development →](https://github.com/users/raiseCatError/projects/1)**

Status columns: **Backlog → Ready → In Progress → Needs Human Test → Done**
