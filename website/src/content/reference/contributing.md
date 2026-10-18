---
title: "Contributing to NMSh"
description: "Canonical contributing to nmsh from the v0.20.0 published source."
group: Technical reference
order: 114
source: "CONTRIBUTING.md"
editorial: ["The tagged document linked to a private GitHub Project. The link now points to the public issue tracker."]
---

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

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the pieces fit together; start here before changing a subsystem
- **[ROADMAP.md](ROADMAP.md)** — product direction and what is planned
- **[GitHub Issues](https://github.com/raiseCatError/notMyShell/issues)** — concrete actionable work; acceptance criteria in each issue are authoritative
- **[v0.20.0 Release](https://github.com/raiseCatError/notMyShell/releases/tag/v0.20.0)** — current stable release, merged through [PR #392](https://github.com/raiseCatError/notMyShell/pull/392) (see [ROADMAP.md](ROADMAP.md))
- **[CHANGELOG.md](CHANGELOG.md)** — the authoritative record of notable changes; see [Changelog](#changelog) below
- **GitHub Issues** — [raiseCatError/notMyShell issues](https://github.com/raiseCatError/notMyShell/issues) — public bug reports, proposals and development status

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

During implementation, run focused affected tests. Use `npm run verify:fast` for
ordinary iteration (build, an explicit core test subset, and diff checks); it is
not the final gate. Before pushing a meaningful checkpoint, run `npm run verify`
(build, the full canonical suite, and diff checks). Build already checks the
source TypeScript; `npm run typecheck` remains available for direct use.

For release-sensitive changes run `npm run verify:release`, which adds benchmark
script typechecking and bounded timing smoke. These commands reuse local
node_modules; use `npm ci` for clean CI/release environments. Batch coherent
changes and avoid pushing tiny or known-broken edits to use Actions as a test
runner. GitHub CI provides independent platform verification, not a replacement
for local checks. See [development verification](docs/development-verification.md)
for sharding, platform gates and exact-release evidence requirements.

```bash
npm run verify:fast
npm run verify
npm run verify:release
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

## Changelog

[CHANGELOG.md](CHANGELOG.md) is the single, authoritative changelog. It follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and is written for people using NMSh, not as a list of commits.

- **Update it in the same PR as the change.** Add notable user-visible changes under `## [Unreleased]` at the top, in `### Added`, `### Changed`, `### Fixed`, `### Security`, `### Deprecated` or `### Removed`. Internal refactors, test-only changes and doc typos need no entry.
- **Say what changed for the user,** in one or two sentences, with the issue or PR link when it helps traceability. Describe only what is implemented and reachable; first slices, foundations and deferred work go under Known limitations or stay in the issue, not under Added.
- **Keep verification honest.** Do not describe automated tests or headless recordings as physical-terminal acceptance.

When releasing:

1. Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` using the publication date, add a one-paragraph overview, and add `### Compatibility`, `### Upgrade notes` and `### Known limitations` where they apply. Start a new empty `## [Unreleased]` above it.
2. Update the link references at the bottom of the file: `[Unreleased]` compares the new tag with `HEAD`, and `[X.Y.Z]` compares the previous tag with the new one.
3. Bump `package.json` and `package-lock.json` together (`npm version X.Y.Z --no-git-tag-version`), and point README, ROADMAP, SECURITY, AGENTS and `llms.txt` at the new release.
4. Write the GitHub Release notes from the new changelog section (a shorter summary is fine) and link to the full CHANGELOG.md.

Past release sections are history: correct factual errors in them, but do not rewrite them otherwise.

## Visual docs and demos

README and [docs/demos.md](docs/demos.md) media come from committed VHS tapes in [`scripts/demos/`](scripts/demos/README.md). If a change alters what a clip shows, re-record it with `npm run demos` (or `npm run demos -- <name>`) and commit the tape and the regenerated asset together. Recordings run against a disposable demo home and never read your own NMSh config, shell rc files or history.
