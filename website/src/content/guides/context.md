---
title: Context Engine and modules
description: Facts become native modules, then route to the surfaces you choose.
group: Make it yours
order: 11
sources: [docs/architecture/context-modules.md, SECURITY.md, docs/privacy.md]
---

## From a fact to a useful detail

The pipeline is **Capability → Fact → Module → Surface Router**. A trusted
capability collects bounded context; a module turns it into presentation; the
router chooses where it belongs. Context is collected on demand for visible
modules, with deadlines, cancellation and caching.

Examples include project identity, runtimes, environment managers, local cloud
profiles, infrastructure context, system information and Git facts. Local cloud
configuration does not mean NMSh calls a cloud API or reads credential values.

## Choose a surface

`/modules` opens the manager; `/prompt` exposes native module routing and details.
Main Prompt, Right Context and Context Rail serve different reading needs.
`/strip` composes the Status Strip with top/bottom placement and left/center/right
groups. Width fitting is deliberate; a narrow terminal cannot display everything.

## Context Packs

v0.18.0 ships bundled declarative packs and the `nmsh.context-pack/v1` format.
`nmsh packs` manages local pack files with integrity checks and optional SHA-256
pinning. Packs name core capabilities and presentation; they cannot carry arbitrary
commands, hooks, includes or executable code.

There is no remote pack registry in this release. Installing a pack does not grant
new execution authority, and opening a repository does not install its suggestions.

## Discovery must not execute the project

Context discovery does not source `.envrc`, run PATH binaries to discover versions,
execute kubeconfig credential plugins or run repository scripts. It uses bounded
local parsing and a shell-reported environment allowlist. Display-only sensitive
facts do not enter exported settings or historical prompt data.

Read the [canonical module reference](/docs/reference/context-modules/) for the
capability inventory, what each reads and the exact security boundaries.
