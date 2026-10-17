---
title: Architecture and development
description: Find runtime boundaries, canonical verification and contribution guidance.
group: Understand the system
order: 17
sources: [ARCHITECTURE.md, CONTRIBUTING.md, docs/development-verification.md]
---

## Start at the boundaries

The [architecture overview](/architecture/) gives the short explanation.
[Runtime architecture](/docs/reference/architecture/) covers input, rendering,
shell events, services, output and repository structure in depth.

Preserve the persistent ShellSession, raw PTY presentation, detached semantic
helpers, FOLLOW/DETACHED behavior and fullscreen passthrough. A website change
must not require touching those runtime boundaries.

## Contributing to the application

Read the current repository's `AGENTS.md`, architecture and relevant issue before
editing. Feature work normally starts from and targets `dev`; `master` represents
released work. Acceptance criteria live in GitHub issues. Architectural records
can describe development work, so cross-check against a released tag.

Application verification commands are:

```sh
npm run verify:fast
npm run verify
```

The first is an iteration gate, not final verification. Release-sensitive work
adds `npm run verify:release`. These are **application** commands from the repository
root, not prerequisites for building this website. See
[Development verification](/docs/reference/verification/) for platform gates.

## Contributing to this website

The site has its own package, lockfile, source tree and tests under `website/`.
It does not import the application runtime or compile NMSh. Its README explains
content updates, pinned source refresh, media replacement and deployment.

Canonical reference pages are generated from verified release sources; edit the
original document in a proper application contribution, not its website snapshot.
Curated guides provide the beginner-friendly path and link directly to that source.

## Open source and reporting

NMSh is independent software by **raiseCatError**, licensed GPL-3.0-only.
[Contributions](/docs/reference/contributing/), reproducible bug reports and careful
compatibility evidence are welcome. Automated checks and human physical-terminal
validation are distinct; never describe one as the other.
