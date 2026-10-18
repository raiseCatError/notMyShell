---
title: Commands and completion
description: Shell-aware candidates, providers and the limits of configured completion.
group: Daily work
order: 5
sources: [README.md, docs/design/configured-completion.md, docs/architecture/optional-tools.md]
---

## Two kinds of command discovery

Type `/` to discover NMSh actions. Type an ordinary shell command and use Tab for
shell-aware completion. `/help` groups actions; `/palette` offers an explicit
action picker. These do not replace your shell's own commands or manual pages.

## Candidates are not execution

NMSh renders and inserts candidates into the composer. Completion never submits
the unfinished command to the managed shell. A suggestion is editable text, not
permission to execute it.

The configured zsh bridge uses a detached helper and a hidden PTY to collect
structured completion data without taking over your terminal. It can load your
trusted shell configuration. That configuration is executable code: detached
terminal ownership is **not** a security sandbox against side effects.

## Choose providers deliberately

`/providers` manages the available picker, history, navigation and suggestion
providers. `/tools` explains optional dependencies. A shell-aware native path
remains useful without installing every enhancement.

## Expect differences between shells

Fish uses Fish's completion facilities and descriptions. Bash and zsh have their
own adapters and capabilities. NMSh does not promise that every external completion
plugin or widget works unchanged.

The configured zsh bridge has bounded startup and query deadlines, fallback and
cancellation. Unsupported nested/multiline contexts can fall back. Definitions
created only in the live managed shell are not all replicated into its helper.
Native fzf-tab is not supported; the optional fzf picker is a separate handoff.

For exact transport and compatibility details, read
[Configured completion](/docs/reference/configured-completion/).
