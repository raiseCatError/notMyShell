---
title: Advanced usage
description: Terminal integration, tmux boundaries and deliberate shell escape routes.
group: Understand the system
order: 16
sources: [README.md, ARCHITECTURE.md, docs/architecture/multiplexer-interop.md]
---

## Make the host launch the frontend

Keep zsh, Bash or Fish as your login shell. Configure your terminal's launch
command instead of using `chsh`. An absolute path can avoid GUI PATH differences.
Host configuration is executable or operational configuration: inspect it before
changing it, and keep an ordinary terminal profile available for recovery.

## Work alongside tmux

NMSh is not a multiplexer. tmux owns panes and its own terminal layer; NMSh owns
the interaction within its frontend. `/tmux` is a configuration studio, not a
replacement for the tmux process. Nested terminal capabilities can differ, so
test your actual host/tmux combination before depending on advanced keys or mouse.

## Hand control back deliberately

`/zsh` hands off to an ordinary interactive zsh. `/exit` uses your configured
default shell. These are intentional escape routes, not aliases for launching a
recursive NMSh instance. Recursive NMSh within its own managed shell is unsupported.

Fullscreen applications use passthrough automatically when recognized. That path
preserves the real program's terminal interaction instead of converting it into
NMSh widgets. Compatibility with every terminal protocol is not guaranteed.

## Keep automation separate from presentation

Use the actual shell and programs for scripts and automation. NMSh slash actions
are frontend controls, not portable shell builtins. A script should not assume
that a theme, animation or folded transcript changes the underlying stdout or
exit status. `/copy` remains plain text.

## Experimental work is not stable functionality

Release branches, current implementation slices and proposals can describe
capabilities absent from your installed release. Consult the [roadmap](/roadmap/)
and verified [release history](/releases/) before treating a design as an API.
