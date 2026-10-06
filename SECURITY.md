# Security Policy

Security is critical for NMSh, as it executes and presents shell commands and handles PTY input/output. Security reports are treated seriously.

## Supported Versions

Security fixes target the latest stable release (currently v0.17.0, the `master` branch) and the active development branch. Older releases are not patched separately; update with `/update`.

## Scope

Examples of in-scope security vulnerabilities include:
- Command injection
- Unintended command execution
- Unsafe shell escaping
- Environment leakage
- Terminal escape handling vulnerabilities
- Arbitrary file access
- Privilege or security boundary mistakes
- Unsafe configuration writes
- A path where NMSh executes content it should only read (theme imports, dotfiles repositories, tool configs)
- NMSh stopping, replacing or deleting something it cannot prove it created

## Boundaries NMSh is designed to keep

Reports that break any of these are in scope:

- **Shell configuration is executable.** NMSh never sources, merges or silently edits rc files or framework code; the few edits it offers (an include line, restoring a backed-up `.zshrc`) are exact diffs applied only after confirmation.
- **Imports are data.** Theme imports use bounded data parsers (no includes, templates, Lua, entities or network). `/dotfiles` never runs repository content, clones only after confirmation (no submodules, hooks disabled), and fails closed when a copy cannot be verified exactly.
- **Ownership.** Generated files are tracked in an ownership ledger and replaced or removed only while their content still matches; Keep Awake signals only a process whose token and exact command line match its record.
- **Installers.** Tool installs are typed package-manager argv shown before confirmation; nothing elevates silently. Special installers (Oh My Zsh) are never run by NMSh.
- **External prompt providers** (Starship, Oh My Posh, Powerlevel10k) run as bounded, non-interactive helpers with argv only; their output is treated as untrusted display text.
- **Context discovery is not execution.** Entering a directory never runs repository-controlled code, sources `.envrc`, runs kubeconfig `exec` plugins, calls the network or reads credential values. Versions come from install layouts and metadata; executables on PATH are never run for context, and one inside the current workspace is not even inspected.
- **Context Packs are data.** A pack names capabilities NMSh core implements and describes presentation; it cannot contain commands, code, paths, templates, includes or hooks, gains no authority by being installed, and is never installed or enabled because a repository was opened.
- **Terminal text is hostile.** Directory names, Git metadata, pack metadata and agent reports pass one display boundary before reaching the screen or a terminal title: no control characters, escape sequences or bidi formatting.

## Reporting a Vulnerability

**Please do not open a public issue for a suspected security vulnerability.** 

Use GitHub's private vulnerability reporting / Security Advisory feature for this repository (under the "Security" tab). If private vulnerability reporting is not currently available, please check if the repository owner has updated contact mechanisms in this file, or reach out through GitHub's standard moderation/contact mechanisms.
