---
title: Getting started
description: Install NMSh, start a real shell session and learn your way around.
group: Start here
order: 1
sources: [README.md]
---

NMSh runs **inside your terminal**, around your existing shell. Keep Ghostty,
Terminal.app, Zed, VS Code or another compatible terminal host. You do not need
to replace your shell configuration or learn a new command language.

## Install and launch

On macOS, the recommended installation method is Homebrew:

```sh
brew install raiseCatError/tap/nmsh
nmsh
```

The tap can trail the latest public release. The [installation page](/install/)
shows the independently verified release and tap versions, plus exact source-build
instructions. NMSh requires Node.js 22+ and zsh, Bash 4.4+ or Fish.

These docs describe the published v0.20.0 release. If the tap still provides an
older version, the installation page says so and gives the exact source build.
On first launch, [Setup](/docs/setup/) offers a starting point and reviews it before applying anything.

> **Do not use `chsh` to make NMSh your login shell.** NMSh is a frontend, not a
> shell. Launch it from your terminal or configure your terminal to start it.

## Try a familiar command

Type `pwd` and press Enter. Your actual shell runs it. Now try `cd` into a directory
and run `pwd` again: the working directory persists because this is one continuing
shell, not a series of unrelated subprocesses.

The composer is where you edit. Output appears in the transcript. NMSh adds command
status, timing and presentation around the output; it does not rewrite arbitrary
program output with semantic colors.

## Find your bearings

| Action | Where to go |
| --- | --- |
| Explore available NMSh actions | Type `/`, or open `/help` |
| Adjust preferences | `/settings` |
| Move the composer | `/layout` |
| Choose a theme | `/theme` |
| Revisit sessions | `/resume` |
| Inspect your environment | `/status` or `/doctor` |

Slash commands belong to NMSh. Ordinary commands, pipelines and scripts still
belong to your selected shell. F1 opens the command palette when the host forwards it.

## Leave the frontend

`/exit` hands off to your configured default ordinary shell. `/zsh` deliberately
hands off to ordinary interactive zsh. Closing the terminal window normally detaches
a service-backed session; that is not the same as stopping its running programs.
Read [Sessions and resume](/docs/sessions/) before relying on this behavior.

Physical-terminal evidence for v0.20.0 is partial and macOS-only; see
[compatibility](/docs/shells/) for limitations rather than assuming every host
and shell configuration behaves identically.
