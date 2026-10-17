---
title: Themes, Chroma and Theme Bridge
description: Shape NMSh's palette and optionally extend it to supported tools.
group: Make it yours
order: 9
sources: [README.md, docs/design/theme-bridge.md, docs/design/chroma-and-ui-chrome.md]
---

## Theme Studio

Open `/theme` to browse built-in themes, inspect imports and edit custom themes.
Imported themes become ordinary NMSh theme data; they do not require the original
application to stay installed or connect to a remote service.

Built-ins are immutable. Duplicate one when you want an editable copy. Imports
show what maps cleanly and what is ignored, instead of pretending every source
theme concept has a direct NMSh equivalent.

## Chroma is presentation

`/chroma` adds optional color treatments to NMSh-owned presentation. Motion is
controlled separately. These settings never add NMSh ANSI decoration to `/copy`
and do not semantically recolor arbitrary PTY output.

## Extend a palette carefully

`/theme-bridge` is opt-in. It can carry a palette to supported targets including
fzf, less/man, file listings, bat, tmux, Vim, Neovim and Helix. Generated files and
reviewed include lines are tracked with ownership records.

Review the exact plan before applying it. NMSh only replaces or removes files it
can still prove it wrote. If a managed file has changed independently, it must not
silently overwrite your work.

> Theme Bridge affects new tool instances. It does not recolor editors and shells
> already running outside NMSh. It does not manage delta or rewrite your Git config.

## Imports are not executable themes

Supported imports are bounded local data parsing. Includes, templates, remote
inheritance, Lua and shell code are not executed. See the
[Theme Bridge reference](/docs/reference/theme-bridge/) for exact formats, limits,
ownership rules and removal behavior.
