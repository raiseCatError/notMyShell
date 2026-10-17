---
title: Core concepts
description: Understand the terminal host, frontend, shell and persistent session.
group: Start here
order: 2
sources: [ARCHITECTURE.md, docs/architecture/terminal-stack.md]
---

## Four layers, different responsibilities

1. **Terminal host** — the window, fonts, cells, keyboard protocols and terminal selection.
2. **NMSh frontend** — the composer, suggestions, transcript, panels and prompt presentation.
3. **ShellAdapter and PTY** — the shell-specific bootstrap and pseudo-terminal transport.
4. **Your real shell** — parsing, expansion, aliases, functions, environment and jobs.

NMSh is not a terminal emulator, a replacement shell or a multiplexer. It can run
inside an integrated editor terminal or alongside tmux without replacing either.

## One shell that keeps its state

Changing directory, defining a function or exporting a variable affects the
continuing shell. NMSh does not reconstruct shell state after each command.
The normal session service can keep that shell alive independently of a window.

The **composer** is the editable command area. The **transcript** is NMSh's
presentation of submitted commands and their output. A **live session** includes
an actual running shell. A saved transcript is a record, not a resurrected process.

## Frontend actions versus shell commands

`/theme` is an NMSh action. `git status` is interpreted by your shell. The complete
NMSh action list lives in `/help`. Absolute executable paths such as `/usr/bin/env`
are shell commands, not requests to an imaginary slash-command namespace.

## Interactive programs

Fullscreen and raw interactive applications use **passthrough**. NMSh suspends
its own presentation and forwards the program's terminal interaction. This is
why an editor is not expected to fit inside a transcript card.

Compatibility is not universal: terminal protocols, shell plugins and inline
redraws have edge cases. The [architecture reference](/docs/reference/architecture/)
explains the real runtime boundaries; [troubleshooting](/docs/troubleshooting/)
helps when an individual tool does not behave as expected.
