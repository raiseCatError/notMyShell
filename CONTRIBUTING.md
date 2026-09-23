# Contributing to NMSh

Thank you for your interest in contributing to notMyShell (NMSh)!

## Setup

To get started with development, clone the repository and build the project:

```bash
git clone https://github.com/raiseCatError/notMyShell.git
cd notMyShell
npm install
npm run build
```

## Tracking

Before starting work, check:

- **[ROADMAP.md](ROADMAP.md)** — product direction and what is planned
- **[GitHub Issues](https://github.com/raiseCatError/notMyShell/issues)** — concrete actionable work; acceptance criteria in each issue are authoritative
- **[v0.2.0 Milestone](https://github.com/raiseCatError/notMyShell/milestone/1)** — current release target
- **GitHub Project** — [NMSh Development](https://github.com/users/raiseCatError/projects/1) — live development status board

## Branch Model

Normal development and feature branches should target `dev`. `master` is reserved for stable/release-ready code.

Typical flow:
```bash
git switch dev
git pull --ff-only
git switch -c feature/example
# Work on feature/example...
```
Then submit a Pull Request from `feature/example` to `dev`.

## Canonical verification

Before submitting a pull request, ensure that your changes pass the canonical verification suite:

```bash
npm run build
npm run typecheck
npm test
git diff --check
```

*Note: When writing tests involving `TerminalApp`, you must carefully tear down child processes and temp ZDOTDIRs using `app['stop'](0)` and `app['session'].kill()` to prevent zombie processes.*

## Guidance

- **Read the docs**: Please read `README.md` first.
- **Understand the architecture**: Read `AGENTS.md` before making architectural changes.
- **Check the roadmap**: Review `ROADMAP.md` and the relevant [GitHub Issue](https://github.com/raiseCatError/notMyShell/issues) before starting large features. Acceptance criteria in the issue are authoritative.
- **Discuss first**: Open an issue to discuss large architectural changes before implementing them to ensure alignment.

## Architectural Contribution Rules

NMSh has several strict architectural invariants:

- NMSh is a frontend over a persistent real shell.
- Do not replace the persistent PTY with command-by-command spawning.
- Raw PTY output must not be semantically recolored.
- NMSh-owned command presentation (like the input editor and submitted commands in history) may be styled.
- Fullscreen/interactive apps use the passthrough path.
- Preserve real shell state.
- Keep `SemanticService` detached from the controlling TTY.
- Test-created `TerminalApp` instances must cleanly tear down resources.

For more details, see [AGENTS.md](AGENTS.md).

## Pull Request Guidance

When opening a Pull Request:
- **Keep it focused**: Address a single bug or feature.
- **Explain**: Describe what changed and why.
- **Test**: Include automated tests for behavior changes.
- **Validation**: Distinguish automated testing from physical terminal/manual verification (e.g., testing in Ghostty vs. macOS Terminal).
- **Scope**: Avoid unrelated formatting or refactors in the same PR.
- **Reproducibility**: Keep generated/demo assets reproducible using the scripts in `scripts/`.

Commits do not need to follow an excessively strict convention (e.g. Conventional Commits), but clear, descriptive messages are preferred.
